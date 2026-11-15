package org.heartbeat.watch.ui.model

import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.settings.AstronautNames
import org.heartbeat.watch.settings.ConnectionSettings
import org.heartbeat.watch.settings.SettingField
import org.heartbeat.watch.settings.TokenMask
import org.heartbeat.watch.settings.ValidationError
import org.heartbeat.watch.time.UtcTime
import org.heartbeat.watch.upload.ConnectionOutcome
import org.heartbeat.watch.upload.ConnectionStatus
import org.heartbeat.watch.upload.ReadingLosses
import java.net.URI
import java.net.URISyntaxException

/** A value the astronaut typed that was refused. */
data class RefusedInput(val enteredValue: String, val error: ValidationError)

/** Connection settings (approved mockups watch-settings, -not-tested, -failed and -input-error). */
class SettingsPresenter {

    fun settings(
        settings: ConnectionSettings,
        status: ConnectionStatus,
        crewNames: Map<String, String>,
        refused: RefusedInput?,
    ): SettingsUi {
        val layout = layout(status)
        return SettingsUi(
            layout = layout,
            rows = rows(settings, crewNames, status),
            status = statusLine(settings, status),
            lossesLine = lossesLine(status.losses),
            buttonLabel = buttonLabel(status.testing, layout),
            testing = status.testing,
            inputError = refused?.let(::inputError),
        )
    }

    private fun layout(status: ConnectionStatus): SettingsLayout =
        when {
            status.testing -> SettingsLayout.NORMAL
            status.lastOutcome is ConnectionOutcome.Failed -> SettingsLayout.FAILED
            status.lastOutcome == null -> SettingsLayout.NOT_TESTED
            else -> SettingsLayout.NORMAL
        }

    /** The failure layout leaves out the astronaut row, unless the astronaut id is what the server refused. */
    private fun rows(settings: ConnectionSettings, crewNames: Map<String, String>, status: ConnectionStatus): List<SettingRowUi> {
        val rows = listOf(
            SettingRowUi(SettingField.SERVER_URL, "Server", displayAddress(settings.serverUrl)),
            SettingRowUi(SettingField.TOKEN, "Token", tokenLabel(settings.token)),
            SettingRowUi(SettingField.ASTRONAUT_ID, "Astronaut", astronautLabel(settings.astronautId, crewNames)),
        )
        val failure = (status.lastOutcome as? ConnectionOutcome.Failed)?.failure
        val hideAstronaut = layout(status) == SettingsLayout.FAILED && failure !is ConnectionFailure.UnknownAstronaut
        return if (hideAstronaut) rows.filter { it.field != SettingField.ASTRONAUT_ID } else rows
    }

    private fun statusLine(settings: ConnectionSettings, status: ConnectionStatus): ConnectionStatusUi {
        val outcome = status.lastOutcome
        return when {
            status.testing -> ConnectionStatusUi("Testing…", "Calling /api/health", ConnectionTone.NEUTRAL)
            outcome is ConnectionOutcome.Failed -> failureLine(outcome.failure, settings, status.pendingReadings)
            outcome is ConnectionOutcome.Reached -> ConnectionStatusUi("● Connected", lastUploadLine(status), ConnectionTone.CONNECTED)
            else -> ConnectionStatusUi("○ Not tested yet", "Tap Test connection to check the server.", ConnectionTone.NEUTRAL)
        }
    }

    private fun lastUploadLine(status: ConnectionStatus): String {
        val upload = status.lastUpload ?: return "No uploads yet · ${waiting(status.pendingReadings)}"
        return "Last upload ${UtcTime.time(upload.at)} · ${readings(upload.readingCount)}"
    }

    private fun failureLine(failure: ConnectionFailure, settings: ConnectionSettings, pending: Int): ConnectionStatusUi {
        val (headline, explanation) = when (failure) {
            is ConnectionFailure.Unreachable ->
                "Can't reach server" to "No answer from ${displayAddress(settings.serverUrl)}. Check Wi-Fi and the address."
            ConnectionFailure.MissingToken -> "No token" to "Enter the token from the onboard server."
            ConnectionFailure.TokenRefused -> "Token refused" to "The server did not accept the token."
            is ConnectionFailure.ServerError -> "Server error" to "The server answered ${failure.httpCode}."
            is ConnectionFailure.MalformedResponse -> "Unexpected reply" to "Is ${displayAddress(settings.serverUrl)} the onboard server?"
            is ConnectionFailure.Rejected -> "Readings refused" to "The server answered ${failure.httpCode}."
            is ConnectionFailure.UnknownAstronaut -> unknownAstronaut(failure.astronautId)
            is ConnectionFailure.RequestRefused -> "Request refused" to "The server answered ${failure.httpCode}."
        }
        return ConnectionStatusUi("■ $headline", "$explanation ${waiting(pending)}.", ConnectionTone.FAILED)
    }

    private fun unknownAstronaut(astronautId: String): Pair<String, String> =
        if (astronautId.isBlank()) {
            "No astronaut set" to "Enter the astronaut id, for example a1."
        } else {
            "Unknown astronaut" to "The server has no astronaut \"$astronautId\". Check the astronaut id."
        }

    /** Lost readings are shown only when there are some (owner decision). */
    private fun lossesLine(losses: ReadingLosses): String? =
        if (!losses.any) null else "${readings(losses.rejected)} rejected · ${losses.droppedQueueFull} dropped (queue full)"

    private fun buttonLabel(testing: Boolean, layout: SettingsLayout): String =
        when {
            testing -> "Testing…"
            layout == SettingsLayout.FAILED -> "Try again"
            else -> "Test connection"
        }

    private fun inputError(refused: RefusedInput): InputErrorUi {
        val field = refused.error.field
        return InputErrorUi(
            field = field,
            title = FIELD_TITLES.getValue(field),
            fieldLabel = fieldLabel(field),
            enteredValue = if (field == SettingField.TOKEN) TokenMask.mask(refused.enteredValue) else refused.enteredValue,
            message = "■ ${refused.error.message}",
            hint = refused.error.hint,
        )
    }

    private fun tokenLabel(token: String): String = if (token.isBlank()) NOT_SET else "Saved ${TokenMask.MASK}"

    private fun astronautLabel(astronautId: String, crewNames: Map<String, String>): String =
        if (astronautId.isBlank()) NOT_SET else AstronautNames.label(astronautId, crewNames)

    private fun waiting(count: Int): String = "${readings(count)} waiting to send"

    private fun readings(count: Int): String = if (count == 1) "1 reading" else "$count readings"

    companion object {
        private const val NOT_SET = "Not set"
        private val FIELD_TITLES = mapOf(
            SettingField.SERVER_URL to "Server",
            SettingField.TOKEN to "Token",
            SettingField.ASTRONAUT_ID to "Astronaut",
        )
        private val FIELD_LABELS = mapOf(
            SettingField.SERVER_URL to "Server address",
            SettingField.TOKEN to "Token",
            SettingField.ASTRONAUT_ID to "Astronaut id",
        )

        /** The field's name, as the input-error screen and the watch keyboard's prompt both show it. */
        fun fieldLabel(field: SettingField): String = FIELD_LABELS.getValue(field)

        /** "http://192.168.2.1:4000" is shown as "192.168.2.1:4000", like the approved mockup. */
        fun displayAddress(serverUrl: String): String {
            if (serverUrl.isBlank()) return NOT_SET
            val uri = parseOrNull(serverUrl.trim())
            val host = uri?.host ?: return serverUrl
            val port = if (uri.port >= 0) ":${uri.port}" else ""
            return host + port + uri.path.orEmpty().trimEnd('/')
        }

        /** An address that does not parse is shown exactly as typed. */
        private fun parseOrNull(url: String): URI? =
            try {
                URI(url)
            } catch (_: URISyntaxException) {
                null
            }
    }
}
