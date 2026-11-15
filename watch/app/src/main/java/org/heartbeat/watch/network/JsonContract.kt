package org.heartbeat.watch.network

import java.time.format.DateTimeParseException

/** The server sent something that is not the agreed JSON contract. */
class MalformedResponseException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Runs a decoder over a server reply. kotlinx.serialization reports a wrong shape as [IllegalArgumentException]
 * (its SerializationException is one) and a missing field as [NoSuchElementException]; with a bad time, all three
 * mean the server broke the contract, reported as [MalformedResponseException] naming [what] was being read.
 */
internal fun <T> decodingServerReply(what: String, decode: () -> T): T =
    try {
        decode()
    } catch (e: IllegalArgumentException) {
        throw MalformedResponseException("$what is not in the agreed format: ${e.message}", e)
    } catch (e: NoSuchElementException) {
        throw MalformedResponseException("$what is missing a field: ${e.message}", e)
    } catch (e: DateTimeParseException) {
        throw MalformedResponseException("$what has an invalid time: ${e.parsedString}", e)
    }
