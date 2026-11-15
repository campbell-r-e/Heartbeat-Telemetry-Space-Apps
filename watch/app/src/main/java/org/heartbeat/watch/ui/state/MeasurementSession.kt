package org.heartbeat.watch.ui.state

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.heartbeat.watch.domain.Measurement
import org.heartbeat.watch.domain.MeasurementHint
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.ui.model.MeasurementProgress

/**
 * One on-demand measurement at a time, from start to its result. SpO₂ shows an indeterminate ring and ECG counts its
 * recorded samples, so no clock is needed here. A failure's technical reason goes to [log]; the screen shows advice.
 */
class MeasurementSession(
    private val run: (MeasurementKind) -> Flow<Measurement>,
    private val log: (String) -> Unit,
) {
    private val _progress = MutableStateFlow<MeasurementProgress?>(null)
    private var job: Job? = null

    /** `null` while no measurement screen is open. */
    val progress: StateFlow<MeasurementProgress?> = _progress.asStateFlow()

    fun start(kind: MeasurementKind, scope: CoroutineScope) {
        job?.cancel()
        _progress.value = MeasurementProgress(kind, Measurement.InProgress(MeasurementHint.STARTING))
        job = scope.launch {
            run(kind).collect { latest ->
                if (latest is Measurement.Failed) log("$kind measurement failed: ${latest.reason}")
                _progress.value = MeasurementProgress(kind, latest)
            }
        }
    }

    fun close() {
        job?.cancel()
        job = null
        _progress.value = null
    }
}
