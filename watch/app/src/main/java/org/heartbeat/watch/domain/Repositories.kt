package org.heartbeat.watch.domain

/** The answer to a read from the onboard server: what it sent, or why the call did not succeed. */
sealed interface ServerResult<out T> {
    data class Found<T>(val value: T) : ServerResult<T>

    data class Failed(val failure: ConnectionFailure) : ServerResult<Nothing>
}

/** Sends a batch of watch readings to the onboard server. */
fun interface ReadingsUploader {
    suspend fun upload(readings: List<Reading>): UploadResult
}

sealed interface UploadResult {
    data class Accepted(val accepted: Int, val duplicates: Int) : UploadResult

    data class Failed(val failure: ConnectionFailure) : UploadResult
}

/** Why a call to the onboard server did not succeed. */
sealed interface ConnectionFailure {
    /** True when sending the same request later can succeed; the server ignores duplicates, so retries are safe. */
    val isRetryable: Boolean

    data class Unreachable(val detail: String) : ConnectionFailure {
        override val isRetryable = true
    }

    data object MissingToken : ConnectionFailure {
        override val isRetryable = true
    }

    /** Retryable because the astronaut can fix the token in settings. */
    data object TokenRefused : ConnectionFailure {
        override val isRetryable = true
    }

    data class ServerError(val httpCode: Int) : ConnectionFailure {
        override val isRetryable = true
    }

    data class MalformedResponse(val detail: String) : ConnectionFailure {
        override val isRetryable = true
    }

    /**
     * The server refused readings in the request as invalid (400); sending them again would fail the same way, so the
     * batch is narrowed down and only the refused readings are dropped.
     */
    data class Rejected(val httpCode: Int, val detail: String) : ConnectionFailure {
        override val isRetryable = false
    }

    /** The server does not know the configured astronaut id; readings stay queued until the id is fixed in settings. */
    data class UnknownAstronaut(val astronautId: String) : ConnectionFailure {
        override val isRetryable = true
    }

    /**
     * The server refused the whole request, not particular readings (413, a 404 from a server that is not Heartbeat,
     * any other 4xx); readings stay queued and are retried (owner decision).
     */
    data class RequestRefused(val httpCode: Int, val detail: String) : ConnectionFailure {
        override val isRetryable = true
    }
}

/** Answers "can the watch reach the onboard server?" via `GET /api/health`. */
fun interface ServerHealthCheck {
    suspend fun check(): ConnectionFailure?
}

/** The newest reading of each metric the server holds for one subject (an astronaut, or the ship). */
fun interface LatestReadingsRepository {
    suspend fun latest(subjectId: String): ServerResult<List<Reading>>
}

/**
 * The server's rules engine (`GET /api/astronauts/:id/status`): statuses and derived values. A server without the
 * endpoint yet answers [StatusReport.NOT_AVAILABLE], so everything stays neutral; the watch never computes statuses.
 */
fun interface StatusRepository {
    suspend fun status(astronautId: String): ServerResult<StatusReport>
}

