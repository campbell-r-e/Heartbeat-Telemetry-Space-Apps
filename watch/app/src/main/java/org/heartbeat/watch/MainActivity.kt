package org.heartbeat.watch

import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.wear.input.RemoteInputIntentHelper
import org.heartbeat.watch.collect.TelemetryService
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.reminders.ExactAlarms
import org.heartbeat.watch.settings.SettingField
import org.heartbeat.watch.ui.WatchActions
import org.heartbeat.watch.ui.WatchApp
import org.heartbeat.watch.ui.WatchViewModel
import org.heartbeat.watch.ui.model.SettingsPresenter

/** Asks for permissions, starts collection, and hosts the Compose UI. */
class MainActivity : ComponentActivity() {

    private val viewModel: WatchViewModel by viewModels {
        viewModelFactory { initializer { WatchViewModel(appContainer.watchDependencies(this@MainActivity)) } }
    }

    private var fieldBeingEdited: SettingField? = null

    private val requiredPermissions = RuntimePermissions.forSdk(Build.VERSION.SDK_INT)

    private val permissionRequest = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        startCollectionIfAllowed()
    }

    private val textInput = registerForActivityResult(ActivityResultContracts.StartActivityForResult(), ::onTextEntered)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startCollectionIfAllowed()
        val missing = RuntimePermissions.missing(requiredPermissions, ::isGranted)
        if (missing.isNotEmpty()) permissionRequest.launch(missing.toTypedArray())
        openRequestedScreen(intent)
        setContent {
            val state by viewModel.uiState.collectAsStateWithLifecycle()
            state?.let { WatchApp(it, actions()) }
        }
    }

    override fun onResume() {
        super.onResume()
        viewModel.refreshExactAlarmPermission()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openRequestedScreen(intent)
    }

    /**
     * Collection (and uploading) needs the foreground service: without it Android's Doze and background
     * firewalls cut the app off from the network as soon as the screen goes off. Start it straight away when
     * the permissions are already granted, rather than only after a permission dialog that may never return.
     */
    private fun startCollectionIfAllowed() {
        val granted = requiredPermissions.filter(::isGranted)
        if (RuntimePermissions.allowHealthService(granted)) {
            TelemetryService.start(this)
        } else {
            Log.w(TAG, "No health permission granted yet; sensors are not collected")
        }
    }

    private fun isGranted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun actions() = WatchActions(
        onMeasure = viewModel::startMeasurement,
        onCloseMeasurement = viewModel::closeMeasurement,
        onOpenFoodToday = viewModel::openFoodToday,
        onCloseFoodToday = viewModel::closeFoodToday,
        onOpenNotes = viewModel::openOldestUnreadNote,
        onMarkNoteRead = viewModel::markNoteRead,
        onCloseNote = viewModel::closeNote,
        onOpenSettings = viewModel::openSettings,
        onCloseSettings = viewModel::closeSettings,
        onEditSetting = ::askForText,
        onDismissInputError = viewModel::dismissInputError,
        onTestConnection = viewModel::testConnection,
        onAllowExactAlarms = { startActivity(ExactAlarms.settingsIntent(this)) },
    )

    /** A reminder opens a measurement; a note's notification opens the note. */
    private fun openRequestedScreen(intent: Intent) {
        intent.getStringExtra(EXTRA_NOTE)?.let { noteId ->
            intent.removeExtra(EXTRA_NOTE)
            viewModel.openNote(noteId)
        }
        openRequestedMeasurement(intent)
    }

    private fun openRequestedMeasurement(intent: Intent) {
        val requested = intent.getStringExtra(EXTRA_MEASUREMENT) ?: return
        intent.removeExtra(EXTRA_MEASUREMENT)
        val kind = MeasurementKind.entries.firstOrNull { it.name == requested }
        if (kind == null) {
            Log.w(TAG, "Ignoring an unknown measurement in the launch intent: $requested")
            return
        }
        viewModel.startMeasurement(kind)
    }

    /** Opens the Wear OS keyboard / voice input for one setting. */
    private fun askForText(field: SettingField) {
        fieldBeingEdited = field
        val input = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel(SettingsPresenter.fieldLabel(field)).build()
        val intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
        RemoteInputIntentHelper.putRemoteInputsExtra(intent, listOf(input))
        textInput.launch(intent)
    }

    private fun onTextEntered(result: ActivityResult) {
        val field = fieldBeingEdited ?: return
        fieldBeingEdited = null
        val data = result.data ?: return
        val text = RemoteInput.getResultsFromIntent(data)?.getCharSequence(REMOTE_INPUT_KEY) ?: return
        viewModel.saveSetting(field, text.toString())
    }

    companion object {
        private const val TAG = "MainActivity"
        private const val EXTRA_MEASUREMENT = "org.heartbeat.watch.MEASUREMENT"
        private const val EXTRA_NOTE = "org.heartbeat.watch.NOTE"

        /** Its own action, so a note's PendingIntent never matches a reminder's that has the same request code. */
        private const val ACTION_OPEN_NOTE = "org.heartbeat.watch.OPEN_NOTE"
        private const val REMOTE_INPUT_KEY = "setting_value"

        /** Opens the app straight into a measurement, e.g. from a reminder notification. */
        fun openMeasurementIntent(context: Context, kind: MeasurementKind): Intent =
            Intent(context, MainActivity::class.java)
                .putExtra(EXTRA_MEASUREMENT, kind.name)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)

        /** Opens the app on a note from the flight surgeon, from its notification. */
        fun openNoteIntent(context: Context, noteId: String): Intent =
            Intent(context, MainActivity::class.java)
                .setAction(ACTION_OPEN_NOTE)
                .putExtra(EXTRA_NOTE, noteId)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)

        /** Opens the app on its home screen, for reminders with no watch screen of their own (meals, check-in). */
        fun openHomeIntent(context: Context): Intent =
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
}
