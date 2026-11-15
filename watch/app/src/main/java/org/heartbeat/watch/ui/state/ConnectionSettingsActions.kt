package org.heartbeat.watch.ui.state

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.heartbeat.watch.domain.ServerHealthCheck
import org.heartbeat.watch.settings.SettingField
import org.heartbeat.watch.settings.SettingsStore
import org.heartbeat.watch.ui.model.RefusedInput
import org.heartbeat.watch.upload.ConnectionMonitor
import java.time.Instant

/** What the Connection settings screen can do: save a typed value, show why one was refused, test the connection. */
class ConnectionSettingsActions(
    private val store: SettingsStore,
    private val monitor: ConnectionMonitor,
    private val healthCheck: ServerHealthCheck,
    private val now: () -> Instant,
    private val requestUpload: () -> Unit,
) {
    private val _refused = MutableStateFlow<RefusedInput?>(null)

    /** The last typed value that was refused, until it is fixed or dismissed. */
    val refused: StateFlow<RefusedInput?> = _refused.asStateFlow()

    suspend fun save(field: SettingField, value: String) {
        _refused.value = store.save(field, value)?.let { RefusedInput(value, it) }
    }

    fun dismissRefused() {
        _refused.value = null
    }

    /** Checks address and token; when both pass, sends what is waiting right away. */
    suspend fun testConnection() {
        monitor.recordTestStarted()
        val failure = healthCheck.check()
        monitor.recordTestResult(now(), failure)
        if (failure == null) requestUpload()
    }
}
