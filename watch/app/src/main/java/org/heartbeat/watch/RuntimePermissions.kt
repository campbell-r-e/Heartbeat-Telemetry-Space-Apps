package org.heartbeat.watch

/** The runtime permissions the watch app asks for, which differ by Android version. */
object RuntimePermissions {
    private const val ANDROID_13 = 33
    private const val ANDROID_16 = 36

    private const val BODY_SENSORS = "android.permission.BODY_SENSORS"
    private const val POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"

    /** Android 16 / Wear OS 6 replaced BODY_SENSORS with one permission per health data type. */
    private val GRANULAR_HEALTH = listOf(
        "android.permission.health.READ_HEART_RATE",
        "android.permission.health.READ_SKIN_TEMPERATURE",
        "android.permission.health.READ_OXYGEN_SATURATION",
    )

    /** Samsung's permission for ECG and other extra sensor data from the Samsung Health Sensor SDK. */
    private const val SAMSUNG_ADDITIONAL_HEALTH_DATA =
        "com.samsung.android.hardware.sensormanager.permission.READ_ADDITIONAL_HEALTH_DATA"

    /** Android starts a health foreground service only if the app holds at least one of these. */
    private val HEALTH_SERVICE_ENABLERS = GRANULAR_HEALTH + BODY_SENSORS

    fun allowHealthService(granted: Collection<String>): Boolean = granted.any { it in HEALTH_SERVICE_ENABLERS }

    /** The permissions still to ask for, so no dialog is shown when everything is already granted. */
    fun missing(required: List<String>, isGranted: (String) -> Boolean): List<String> = required.filterNot(isGranted)

    fun forSdk(sdkInt: Int): List<String> = buildList {
        if (sdkInt >= ANDROID_16) addAll(GRANULAR_HEALTH) else add(BODY_SENSORS)
        add(SAMSUNG_ADDITIONAL_HEALTH_DATA)
        if (sdkInt >= ANDROID_13) add(POST_NOTIFICATIONS)
    }
}
