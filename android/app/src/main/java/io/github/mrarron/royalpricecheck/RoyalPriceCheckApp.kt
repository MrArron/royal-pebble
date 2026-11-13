package io.github.mrarron.royalpricecheck

import android.app.Application

class RoyalPriceCheckApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.createChannels(this)
    }
}
