package org.heartbeat.watch.network

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
class HeldNetworkTest {

    /** Stands in for ConnectivityManager: the test decides when the network appears or is lost. */
    private class FakeRequester : NetworkRequester<String> {
        var requests = 0
        var releases = 0
        var onAvailable: (String) -> Unit = {}
        var onLost: (String) -> Unit = {}

        override fun request(onAvailable: (String) -> Unit, onLost: (String) -> Unit): NetworkRequest {
            requests++
            this.onAvailable = onAvailable
            this.onLost = onLost
            return NetworkRequest { releases++ }
        }
    }

    private val requester = FakeRequester()
    private val network = HeldNetwork(requester, waitForNetwork = 10.seconds)

    @Test
    fun `waits for the held network to come up`() = runTest {
        network.hold()
        val current = async { network.current() }
        runCurrent()

        requester.onAvailable("wifi")

        assertEquals("wifi", current.await())
    }

    @Test
    fun `gives up after the wait so the caller can use the default network`() = runTest {
        network.hold()
        val current = async { network.current() }

        advanceTimeBy(11.seconds)

        assertNull(current.await())
    }

    @Test
    fun `stays held for as long as it is not released`() = runTest {
        network.hold()
        requester.onAvailable("wifi")
        network.hold()

        advanceTimeBy(6.hours)

        assertEquals("wifi", network.current())
        assertEquals(1, requester.requests)
        assertEquals(0, requester.releases)
    }

    @Test
    fun `release withdraws the request and hands out nothing`() = runTest {
        network.hold()
        requester.onAvailable("wifi")

        network.release()

        assertEquals(1, requester.releases)
        assertNull(network.current())
    }

    @Test
    fun `a lost network is not handed out`() = runTest {
        network.hold()
        requester.onAvailable("wifi")
        requester.onLost("wifi")

        val current = async { network.current() }
        advanceTimeBy(11.seconds)

        assertNull(current.await())
    }
}
