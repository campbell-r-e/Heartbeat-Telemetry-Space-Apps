package org.heartbeat.watch.settings

import java.net.URI
import java.net.URISyntaxException

/** How the watch reaches the onboard server and who it measures. */
data class ConnectionSettings(
    val serverUrl: String,
    val token: String,
    val astronautId: String,
) {
    /** Base URL without a trailing slash, ready for `"$baseUrl/api/..."`. */
    val baseUrl: String get() = serverUrl.trimEnd('/')

    override fun toString(): String =
        "ConnectionSettings(serverUrl=$serverUrl, token=${TokenMask.mask(token)}, astronautId=$astronautId)"
}

enum class SettingField { SERVER_URL, TOKEN, ASTRONAUT_ID }

/** Why an entered value was refused, phrased for the watch screen (approved mockup watch-settings-input-error). */
data class ValidationError(val field: SettingField, val message: String, val hint: String)

/** The result of checking a typed value: the value to save, or why it was refused. */
sealed interface Checked {
    data class Valid(val value: String) : Checked

    data class Invalid(val error: ValidationError) : Checked
}

/** Checks values typed on the watch before they are saved. Pure, so it is unit-tested without Android. */
object SettingsValidator {
    private const val DEFAULT_SCHEME = "http://"
    private val ALLOWED_SCHEMES = setOf("http", "https")
    private val SCHEME_PREFIX = Regex("^[A-Za-z][A-Za-z0-9+.-]*://")
    private val ASTRONAUT_ID_PATTERN = Regex("^[A-Za-z0-9_-]{1,32}$")

    private val HINTS = mapOf(
        SettingField.SERVER_URL to "Use host:port, for example 192.168.2.1:4000",
        SettingField.TOKEN to "Enter the HEARTBEAT_TOKEN from the onboard server",
        SettingField.ASTRONAUT_ID to "Letters, digits, - or _, for example a1",
    )

    fun check(field: SettingField, value: String): Checked {
        val trimmed = value.trim()
        return when (field) {
            SettingField.SERVER_URL -> checkServerAddress(trimmed)
            SettingField.TOKEN -> checkToken(trimmed)
            SettingField.ASTRONAUT_ID -> checkAstronautId(trimmed)
        }
    }

    /** "192.168.2.1:4000" is accepted and saved as "http://192.168.2.1:4000"; the onboard server speaks HTTP. */
    private fun checkServerAddress(value: String): Checked {
        val withScheme = if (SCHEME_PREFIX.containsMatchIn(value)) value else DEFAULT_SCHEME + value
        val uri = parseUri(withScheme)
        val valid = uri != null &&
            uri.scheme?.lowercase() in ALLOWED_SCHEMES &&
            !uri.host.isNullOrBlank() &&
            uri.query.isNullOrEmpty() &&
            uri.fragment.isNullOrEmpty()
        return if (valid) Checked.Valid(withScheme) else invalid(SettingField.SERVER_URL, "That isn't a valid address")
    }

    private fun checkToken(value: String): Checked =
        if (value.isEmpty() || value.any(Char::isWhitespace)) invalid(SettingField.TOKEN, "That isn't a valid token")
        else Checked.Valid(value)

    private fun checkAstronautId(value: String): Checked =
        if (ASTRONAUT_ID_PATTERN.matches(value)) Checked.Valid(value)
        else invalid(SettingField.ASTRONAUT_ID, "That isn't a valid astronaut id")

    private fun invalid(field: SettingField, message: String) =
        Checked.Invalid(ValidationError(field, message, HINTS.getValue(field)))

    private fun parseUri(value: String): URI? =
        try {
            URI(value)
        } catch (_: URISyntaxException) {
            null
        }
}

/** Hides a saved token so no part of it is shown on screen or written to logs. */
object TokenMask {
    const val MASK = "••••"

    fun mask(token: String): String = if (token.isEmpty()) "" else MASK
}
