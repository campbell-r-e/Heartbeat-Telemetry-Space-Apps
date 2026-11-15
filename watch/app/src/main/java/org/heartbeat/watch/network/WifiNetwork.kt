package org.heartbeat.watch.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest as PlatformNetworkRequest
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import kotlin.time.Duration.Companion.seconds

/**
 * On Wear OS the default network can be the phone's Bluetooth proxy, which cannot reach the onboard server
 * on the spacecraft LAN. Apps must ask for Wi-Fi explicitly and send their requests over it.
 */
class WifiNetworkRequester(context: Context) : NetworkRequester<Network> {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)

    override fun request(onAvailable: (Network) -> Unit, onLost: (Network) -> Unit): NetworkRequest {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = onAvailable(network)

            override fun onLost(network: Network) = onLost(network)
        }
        val wifiWithInternet = PlatformNetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        connectivity.requestNetwork(wifiWithInternet, callback)
        return NetworkRequest { connectivity.unregisterNetworkCallback(callback) }
    }
}

/** How long a request waits for held Wi-Fi to come up before it uses the default network. */
val WIFI_WAIT = 10.seconds

/** Opens HTTP connections over the held Wi-Fi when it is up, and over the default network otherwise. */
class WifiConnectionOpener(private val wifi: HeldNetwork<Network>) : ConnectionOpener {

    override suspend fun open(url: URL): HttpURLConnection {
        val network = wifi.current()
        if (network == null) Log.w(TAG, "Wi-Fi is not held or not up; using the default network")
        return (network?.openConnection(url) ?: url.openConnection()) as HttpURLConnection
    }

    private companion object {
        const val TAG = "WifiConnectionOpener"
    }
}
