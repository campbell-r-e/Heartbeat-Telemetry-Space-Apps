package org.heartbeat.watch.domain

/**
 * Every metric the watch sends or shows, with the wire name and unit agreed in the server contract.
 * Exercise minutes and the radiation "times above normal" multiple are computed by the server but have no
 * agreed wire name yet, so they are deliberately absent. Steps and movement are not metrics: astronauts do not
 * walk in microgravity; the wrist angle is sent only for the server's sleep detection.
 */
enum class Metric(val wireName: String, val unit: String) {
    HEART_RATE("heartRate", "bpm"),

    /** Derived by the server from [IBI]; the watch only displays it and never sends it. */
    HRV("hrv", "ms"),

    /** Beat-to-beat intervals as the tracker delivers them, sent raw so the server can derive HRV. */
    IBI("ibi", "ms"),
    SKIN_TEMP("skinTemp", "°C"),
    SPO2("spo2", "%"),
    ECG("ecg", "mV"),
    /** Derived by the server from [WRIST_ANGLE]; the watch only displays it and never sends it. */
    SLEEP("sleep", "h"),

    /** The wrist's z-angle per 5-second epoch, 12 per minute, sent so the server can detect sleep. */
    WRIST_ANGLE("wristAngle", "deg"),

    /** Skeletal muscle mass from body composition. */
    BODY_COMPOSITION("bodyComposition", "kg"),
    PRESSURE("pressure", "hPa"),
    NOISE("noise", "dBA"),
    RADIATION_DOSE_RATE("radiationDoseRate", "µGy/h"),
    CO2("co2", "mmHg"),
    CABIN_TEMP("cabinTemp", "°C"),
    HUMIDITY("humidity", "%RH");

    companion object {
        private val byWireName = entries.associateBy(Metric::wireName)

        fun fromWireName(wireName: String): Metric? = byWireName[wireName]
    }
}
