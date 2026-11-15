package org.heartbeat.watch.network

import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.DeviceInfo
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReceiptResult
import org.heartbeat.watch.domain.ServerResult
import org.heartbeat.watch.domain.StatusReport
import org.heartbeat.watch.domain.SurgeonNote
import org.heartbeat.watch.domain.UploadResult
import org.heartbeat.watch.readings
import org.heartbeat.watch.settings.ConnectionSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.time.Instant

class ServerClientTest {

    private class FakeTransport(private val respond: (String) -> HttpResponse) : HttpTransport {
        val requests = mutableListOf<String>()
        var lastToken: String? = null
        var lastBody: String? = null

        override suspend fun get(url: String): HttpResponse {
            requests += "GET $url"
            return respond(url)
        }

        override suspend fun postJson(url: String, json: String, bearerToken: String): HttpResponse {
            requests += "POST $url"
            lastToken = bearerToken
            lastBody = json
            return respond(url)
        }
    }

    private val settings = ConnectionSettings(serverUrl = "http://10.0.0.1:4000/", token = "secret", astronautId = "a1")

    private val device = DeviceInfo("6f1c2b0e-4d8a-4c3e-9b1f-2a7d5e8c0f13", batteryPct = 36)

    private fun client(transport: HttpTransport, current: ConnectionSettings = settings) = ServerClient(transport, { device }) { current }

    private fun answering(code: Int, body: String = "") = FakeTransport { HttpResponse(code, body) }

    @Test
    fun `posts readings with the bearer token and reads the counts`() = runTest {
        val transport = answering(200, """{"accepted":2,"duplicates":0}""")

        val result = client(transport).upload(readings(2))

        assertEquals(UploadResult.Accepted(2, 0), result)
        assertEquals(listOf("POST http://10.0.0.1:4000/api/readings"), transport.requests)
        assertEquals("secret", transport.lastToken)
        assertTrue(transport.lastBody!!.endsWith(""""device":{"watchId":"6f1c2b0e-4d8a-4c3e-9b1f-2a7d5e8c0f13","batteryPct":36}}"""))
    }

    @Test
    fun `does not call the server without a token`() = runTest {
        val transport = answering(200)

        val result = client(transport, settings.copy(token = "")).upload(readings(1))

        assertEquals(UploadResult.Failed(ConnectionFailure.MissingToken), result)
        assertTrue(transport.requests.isEmpty())
    }

    @Test
    fun `maps HTTP errors to connection failures`() = runTest {
        assertEquals(UploadResult.Failed(ConnectionFailure.TokenRefused), client(answering(401)).upload(readings(1)))
        assertEquals(UploadResult.Failed(ConnectionFailure.ServerError(503)), client(answering(503)).upload(readings(1)))
        assertEquals(UploadResult.Failed(ConnectionFailure.Rejected(400, "bad")), client(answering(400, "bad")).upload(readings(1)))
    }

    @Test
    fun `an unreachable server is a retryable failure`() = runTest {
        val transport = FakeTransport { throw IOException("connect timed out") }

        val result = client(transport).upload(readings(1))

        assertEquals(UploadResult.Failed(ConnectionFailure.Unreachable("connect timed out")), result)
    }

    @Test
    fun `a success with an unexpected body is a malformed response`() = runTest {
        val result = client(answering(200, "OK")).upload(readings(1))

        assertTrue(result is UploadResult.Failed && result.failure is ConnectionFailure.MalformedResponse)
    }

    @Test
    fun `loads the latest readings for a subject`() = runTest {
        val transport = answering(200, "[]")

        val result = client(transport).latest("ship")

        assertEquals(ServerResult.Found(emptyList<Reading>()), result)
        assertEquals(listOf("GET http://10.0.0.1:4000/api/astronauts/ship/latest"), transport.requests)
    }

    @Test
    fun `every read goes to its own path`() = runTest {
        val transport = answering(200, "[]")
        val client = client(transport)

        client.schedule("a1")
        client.astronauts()
        client.mealsBetween("a1", Instant.parse("2026-11-14T05:00:00Z"), Instant.parse("2026-11-14T19:00:00Z"))

        assertEquals(
            listOf(
                "GET http://10.0.0.1:4000/api/astronauts/a1/schedule",
                "GET http://10.0.0.1:4000/api/astronauts",
                "GET http://10.0.0.1:4000/api/astronauts/a1/meals?from=2026-11-14T05:00:00Z&to=2026-11-14T19:00:00Z",
            ),
            transport.requests,
        )
    }

    @Test
    fun `reads map failures the same way as uploads`() = runTest {
        assertEquals(ServerResult.Failed(ConnectionFailure.ServerError(503)), client(answering(503)).astronauts())
        assertEquals(
            ServerResult.Failed(ConnectionFailure.Unreachable("no route")),
            client(FakeTransport { throw IOException("no route") }).menu(),
        )
        assertTrue(client(answering(200, "{}")).schedule("a1").let { it is ServerResult.Failed && it.failure is ConnectionFailure.MalformedResponse })
    }

    @Test
    fun `a server without the status endpoint yet means neutral, not a failure`() = runTest {
        val transport = answering(404, """{"message":"Route GET:/api/astronauts/a1/status not found"}""")

        assertEquals(ServerResult.Found(StatusReport.NOT_AVAILABLE), client(transport).status("a1"))
        assertEquals(listOf("GET http://10.0.0.1:4000/api/astronauts/a1/status"), transport.requests)
        assertEquals(ServerResult.Failed(ConnectionFailure.ServerError(500)), client(answering(500)).status("a1"))
    }

    private val crew = """[{"id":"a1","name":"Astronaut 1","watchId":null,"age":35,"sex":"female","massKg":66,"heightM":1.68}]"""

    private fun healthyServer(crewList: String = crew) = FakeTransport { url ->
        when {
            url.endsWith("/api/astronauts") -> HttpResponse(200, crewList)
            else -> HttpResponse(200, """{"accepted":0,"duplicates":0}""")
        }
    }

    @Test
    fun `connection test checks the address, the token with an empty batch, and the astronaut id`() = runTest {
        val transport = healthyServer()

        assertNull(client(transport).check())
        assertEquals(
            listOf("GET http://10.0.0.1:4000/api/health", "POST http://10.0.0.1:4000/api/readings", "GET http://10.0.0.1:4000/api/astronauts"),
            transport.requests,
        )
        assertEquals("secret", transport.lastToken)
    }

    @Test
    fun `connection test reports an astronaut id the server does not know`() = runTest {
        assertEquals(ConnectionFailure.UnknownAstronaut("a7"), client(healthyServer(), settings.copy(astronautId = "a7")).check())
    }

    @Test
    fun `only a 400 refuses readings, and a refusal of the whole request keeps them for a retry`() = runTest {
        val unknown = client(answering(404, """{"error":"unknown_astronaut","astronautId":"a7"}""")).upload(readings(1))
        val tooLarge = client(answering(413, "Payload Too Large")).upload(readings(1))
        val notHeartbeat = client(answering(404, "<html>Not Found</html>")).upload(readings(1))

        assertEquals(UploadResult.Failed(ConnectionFailure.UnknownAstronaut("a7")), unknown)
        assertEquals(UploadResult.Failed(ConnectionFailure.RequestRefused(413, "Payload Too Large")), tooLarge)
        assertEquals(UploadResult.Failed(ConnectionFailure.RequestRefused(404, "<html>Not Found</html>")), notHeartbeat)
        listOf(unknown, tooLarge, notHeartbeat).forEach { assertTrue((it as UploadResult.Failed).failure.isRetryable) }
    }

    @Test
    fun `reads the notes that have reached the spacecraft`() = runTest {
        val transport = answering(
            200,
            """[{"noteId":"7","text":"Stay in the shielded area.","alertId":"12","sentAt":"2026-11-14T14:06:00.000Z",""" +
                """"receivedAt":"2026-11-14T14:06:00.000Z","readAt":null},""" +
                """{"noteId":"8","text":"Good night.","alertId":null,"sentAt":"2026-11-14T20:00:00.000Z",""" +
                """"receivedAt":"2026-11-14T20:00:00.000Z","readAt":"2026-11-14T20:05:00.000Z"}]""",
        )

        val notes = (client(transport).notes("a1") as ServerResult.Found).value

        assertEquals(listOf("GET http://10.0.0.1:4000/api/astronauts/a1/notes"), transport.requests)
        assertEquals(SurgeonNote("7", "Stay in the shielded area.", "12", Instant.parse("2026-11-14T14:06:00Z"), null), notes[0])
        assertEquals(Instant.parse("2026-11-14T20:05:00Z"), notes[1].readAt)
        assertNull(notes[1].alertId)
    }

    @Test
    fun `marks a note read with the token and reads the receipt's time`() = runTest {
        val transport = answering(202, """{"id":"9","kind":"readReceipt","payload":{"noteId":"7","astronautId":"a1","readAt":"2026-11-14T14:10:00.000Z"}}""")

        val readAt = client(transport).markRead("a1", "7")

        assertEquals(ReceiptResult.Sent(Instant.parse("2026-11-14T14:10:00Z")), readAt)
        assertEquals(listOf("POST http://10.0.0.1:4000/api/astronauts/a1/notes/7/read"), transport.requests)
        assertEquals("secret", transport.lastToken)
        assertEquals("{}", transport.lastBody)
    }

    @Test
    fun `a read receipt for a note the server does not have is told apart from an unreachable server`() = runTest {
        val unknown = answering(404, """{"error":"unknown_note","message":"no such note has reached this astronaut"}""")

        assertEquals(ReceiptResult.UnknownNote, client(unknown).markRead("a1", "7"))
        assertEquals(ReceiptResult.Failed(ConnectionFailure.ServerError(503)), client(answering(503)).markRead("a1", "7"))
        assertEquals(ReceiptResult.Failed(ConnectionFailure.TokenRefused), client(answering(401)).markRead("a1", "7"))
    }

    @Test
    fun `an upload answered 404 unknown_note keeps its readings for a retry`() = runTest {
        val body = """{"error":"unknown_note","message":"no such note has reached this astronaut"}"""

        val upload = client(answering(404, body)).upload(readings(1))

        assertEquals(UploadResult.Failed(ConnectionFailure.RequestRefused(404, body)), upload)
        assertTrue((upload as UploadResult.Failed).failure.isRetryable)
    }

    @Test
    fun `a read receipt needs the token`() = runTest {
        val transport = answering(202)

        assertEquals(ReceiptResult.Failed(ConnectionFailure.MissingToken), client(transport, settings.copy(token = "")).markRead("a1", "7"))
        assertTrue(transport.requests.isEmpty())
    }

    @Test
    fun `reads the titles of the alerts sent to the ground`() = runTest {
        val transport = answering(200, """[{"alertId":"12","title":"Radiation dose spike","area":"radiation"}]""")

        assertEquals(ServerResult.Found(mapOf("12" to "Radiation dose spike")), client(transport).alertTitles("a1"))
        assertEquals(listOf("GET http://10.0.0.1:4000/api/astronauts/a1/relayed-alerts"), transport.requests)
    }

    @Test
    fun `reads the astronaut's points, and an unknown astronaut is a failure`() = runTest {
        val body = """{"astronautId":"a1","day":"2026-11-14","totalPoints":45,"streak":{"days":2,"includesToday":true},"badges":[]}"""
        val transport = answering(200, body)

        assertEquals(45, (client(transport).points("a1") as ServerResult.Found).value.totalPoints)
        assertEquals(listOf("GET http://10.0.0.1:4000/api/astronauts/a1/points"), transport.requests)

        val unknown = client(answering(404, """{"error":"unknown_astronaut"}""")).points("a9")
        assertTrue((unknown as ServerResult.Failed).failure is ConnectionFailure.UnknownAstronaut)
    }

    @Test
    fun `connection test reports a refused token and a missing one`() = runTest {
        val refusing = FakeTransport { url -> if (url.endsWith("/api/health")) HttpResponse(200, "{}") else HttpResponse(401, "") }

        assertEquals(ConnectionFailure.TokenRefused, client(refusing).check())
        assertEquals(ConnectionFailure.MissingToken, client(answering(200, "{}"), settings.copy(token = "")).check())
        assertEquals(ConnectionFailure.ServerError(500), client(answering(500)).check())
    }
}
