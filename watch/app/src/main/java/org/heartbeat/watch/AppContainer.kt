package org.heartbeat.watch

import android.content.Context
import android.util.Log
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.heartbeat.watch.collect.ContinuousStreams
import org.heartbeat.watch.collect.OnDemandMeasurements
import org.heartbeat.watch.collect.PartialWakeLock
import org.heartbeat.watch.collect.SensorHealth
import org.heartbeat.watch.collect.TelemetryCollector
import org.heartbeat.watch.collect.WornWakeLock
import org.heartbeat.watch.device.WatchIdentity
import org.heartbeat.watch.device.batteryPercent
import org.heartbeat.watch.device.currentBatteryPercent
import org.heartbeat.watch.device.minuteTicks
import org.heartbeat.watch.domain.DeviceInfo
import org.heartbeat.watch.network.HeldNetwork
import org.heartbeat.watch.notes.DataStoreSeenNotes
import org.heartbeat.watch.notes.NoteInbox
import org.heartbeat.watch.notes.NoteNotifications
import org.heartbeat.watch.network.ServerClient
import org.heartbeat.watch.network.UrlConnectionTransport
import org.heartbeat.watch.network.WIFI_WAIT
import org.heartbeat.watch.network.WifiConnectionOpener
import org.heartbeat.watch.network.WifiNetworkRequester
import org.heartbeat.watch.points.BadgeNotifications
import org.heartbeat.watch.points.DataStoreAnnouncedBadges
import org.heartbeat.watch.points.PointsTracker
import org.heartbeat.watch.poll.OnboardPoll
import org.heartbeat.watch.poll.PollStep
import org.heartbeat.watch.reminders.CachedSchedule
import org.heartbeat.watch.reminders.DataStoreScheduleCache
import org.heartbeat.watch.reminders.ExactAlarms
import org.heartbeat.watch.reminders.ReminderAlarms
import org.heartbeat.watch.sensors.HeartRateSource
import org.heartbeat.watch.sensors.PlatformSensors
import org.heartbeat.watch.sensors.WearState
import org.heartbeat.watch.sensors.body.BodySensorsFactory
import org.heartbeat.watch.sensors.motion.AccelerometerSource
import org.heartbeat.watch.sensors.motion.onlyWornSamples
import org.heartbeat.watch.sensors.onlyWhileWorn
import org.heartbeat.watch.settings.AstronautNames
import org.heartbeat.watch.settings.ConnectionSettings
import org.heartbeat.watch.settings.DataStoreAstronautNameCache
import org.heartbeat.watch.settings.DataStoreSettingsStore
import org.heartbeat.watch.ui.WatchDependencies
import org.heartbeat.watch.ui.state.ConnectionSettingsActions
import org.heartbeat.watch.ui.state.FoodTodayLoader
import org.heartbeat.watch.ui.state.MeasurementSession
import org.heartbeat.watch.ui.state.NoteSession
import org.heartbeat.watch.ui.state.OverlayNavigator
import org.heartbeat.watch.ui.state.ServerSnapshotPoller
import org.heartbeat.watch.upload.BatchDelivery
import org.heartbeat.watch.upload.ConnectionMonitor
import org.heartbeat.watch.upload.FileQueueStore
import org.heartbeat.watch.upload.ReadingRecorder
import org.heartbeat.watch.upload.UploadQueue
import org.heartbeat.watch.upload.UploadScheduler
import java.io.File
import java.time.Clock
import java.time.ZonedDateTime
import kotlin.time.Duration.Companion.minutes

private val Context.settingsDataStore by preferencesDataStore(name = "connection_settings")
private val Context.cacheDataStore by preferencesDataStore(name = "server_cache")

/** Builds the app's object graph once per process (manual dependency injection). */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext
    private val warn: (String) -> Unit = { Log.w(TAG, it) }

    /** Lives as long as the process; collection and uploads run here so they outlast any one screen. */
    val processScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** Read fresh each time, so a change to the system clock applies at once; every time shown is converted to UTC. */
    val clock: () -> Clock = { Clock.systemDefaultZone() }

    val settingsStore = DataStoreSettingsStore(
        appContext.settingsDataStore,
        defaults = ConnectionSettings(
            serverUrl = BuildConfig.DEFAULT_SERVER_URL,
            token = BuildConfig.DEFAULT_TOKEN,
            astronautId = BuildConfig.DEFAULT_ASTRONAUT_ID,
        ),
    )

    /** Held by the collection service for as long as it runs. */
    val wifi = HeldNetwork(WifiNetworkRequester(appContext), WIFI_WAIT)
    private val watchIdentity = WatchIdentity(File(appContext.filesDir, WATCH_ID_FILE))

    val serverClient = ServerClient(
        UrlConnectionTransport(WifiConnectionOpener(wifi)),
        device = { DeviceInfo(watchIdentity.watchId(), currentBatteryPercent(appContext)) },
    ) { settingsStore.settings.first() }

    val schedule = CachedSchedule(serverClient, DataStoreScheduleCache(appContext.cacheDataStore, warn), warn)
    val crewNames = AstronautNames(serverClient, DataStoreAstronautNameCache(appContext.cacheDataStore, warn), warn)

    /** Read fresh on every call, so a change on the Connection screen applies to the next request. */
    private val currentAstronautId: suspend () -> String = { settingsStore.settings.first().astronautId }

    /** Notes from the flight surgeon: polled with the uploads, each announced once. */
    val notes = NoteInbox(
        serverClient,
        DataStoreSeenNotes(appContext.cacheDataStore),
        NoteNotifications(appContext),
        currentAstronautId,
        warn,
    )
    private val noteSession = NoteSession(notes)

    val connectionMonitor = ConnectionMonitor()
    val uploadQueue = UploadQueue(
        BatchDelivery(serverClient) { reading, failure -> Log.w(TAG, "Server refused a ${reading.metric.wireName} reading; dropped: $failure") },
        FileQueueStore(File(appContext.filesDir, QUEUE_FILE)) { message, error -> Log.w(TAG, message, error) },
    )
    val uploadScheduler = UploadScheduler(uploadQueue, connectionMonitor, { clock().instant() })
    val recorder = ReadingRecorder(uploadQueue)

    val bodySensors = BodySensorsFactory.create(appContext)
    val measurements = OnDemandMeasurements(bodySensors, recorder, uploadScheduler::requestUpload)

    /** Points, streak and badges: polled with the notes, each badge announced once. */
    val points = PointsTracker(
        serverClient,
        DataStoreAnnouncedBadges(appContext.cacheDataStore),
        BadgeNotifications(appContext),
        measurementRunning = { measurements.isRunning },
        currentAstronautId,
        warn,
    )

    /** Surgeon notes, then points and badges, in one 15 s loop (owner decision: points are polled with the notes). */
    private val onboardPoll = OnboardPoll(
        listOf(PollStep("surgeon notes", notes::refresh), PollStep("points", points::refresh)),
        log = { message, error -> Log.w(TAG, message, error) },
    )

    val sensorHealth = SensorHealth()
    private val wear = WearState { clock().instant() }
    private val platformSensors = PlatformSensors(appContext)
    private val accelerometer = AccelerometerSource(appContext)

    /**
     * Picks up readings a previous run left unsent and keeps uploading; refreshes the schedule and crew names.
     * The queue loads its stored readings itself before the first enqueue or flush, so the order cannot go wrong.
     */
    fun start() {
        processScope.launch { uploadQueue.restore() }
        uploadScheduler.start(processScope)
        processScope.launch { refreshServerLists() }
        processScope.launch { onboardPoll.run() }
    }

    /** Everything the watch screens need, built here so the activity only deals with permissions, intents and input. */
    fun watchDependencies(context: Context): WatchDependencies {
        val foodToday = FoodTodayLoader(serverClient, clock, currentAstronautId, warn)
        return WatchDependencies(
            minuteTicks = minuteTicks(clock),
            batteryPercent = batteryPercent(context.applicationContext),
            localReadings = recorder.newestByMetric,
            unavailableSensors = sensorHealth.unavailable,
            bodySensors = bodySensors.state,
            settings = settingsStore.settings,
            connectionStatus = connectionMonitor.status,
            schedule = schedule.tasks,
            crewNames = crewNames.names,
            exactAlarmsAllowed = { ExactAlarms.allowed(appContext) },
            server = ServerSnapshotPoller(serverClient, serverClient, currentAstronautId, warn),
            points = points.summary,
            measurements = MeasurementSession(measurements::run, warn),
            foodToday = foodToday,
            notes = notes,
            noteSession = noteSession,
            navigator = OverlayNavigator(noteSession, foodToday),
            settingsActions = ConnectionSettingsActions(
                settingsStore, connectionMonitor, serverClient, { clock().instant() }, uploadScheduler::requestUpload,
            ),
        )
    }

    suspend fun rearmReminders() {
        ReminderAlarms.arm(appContext, schedule.ensureLoaded(), ZonedDateTime.now(clock()))
    }

    /** The processor stays awake only while the watch is worn and collecting (owner decision). */
    fun newWornWakeLock(): WornWakeLock = WornWakeLock(wear.worn, PartialWakeLock(appContext))

    fun newTelemetryCollector(): TelemetryCollector =
        TelemetryCollector(
            streams = ContinuousStreams(
                heartRate = HeartRateSource(appContext, wear).readings(),
                beatIntervals = bodySensors.interBeatIntervals(),
                skinTemperature = bodySensors.skinTemperature().onlyWhileWorn(wear),
                cabinPressure = platformSensors.cabinPressure(),
                wristMotion = accelerometer.samples().onlyWornSamples(wear),
            ),
            recorder = recorder,
            health = sensorHealth,
            onStreamFailed = { sensor, failure -> Log.w(TAG, "${sensor.wireName} stream failed; restarting", failure) },
        )

    private suspend fun refreshServerLists() {
        crewNames.loadCached()
        rearmReminders()
        while (processScope.isActive) {
            if (schedule.refresh(currentAstronautId())) rearmReminders()
            crewNames.refresh()
            delay(SERVER_LISTS_REFRESH)
        }
    }

    private companion object {
        const val TAG = "AppContainer"
        const val QUEUE_FILE = "upload-queue.jsonl"
        const val WATCH_ID_FILE = "watch-id"
        val SERVER_LISTS_REFRESH = 15.minutes
    }
}
