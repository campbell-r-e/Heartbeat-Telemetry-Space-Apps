package org.heartbeat.watch

import android.app.Application

class HeartbeatApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.start()
    }
}

val android.content.Context.appContainer: AppContainer
    get() = (applicationContext as HeartbeatApplication).container
