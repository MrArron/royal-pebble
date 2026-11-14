package io.github.mrarron.royalpricecheck

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

class CheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val c = applicationContext
        if (!Prefs.hasConfig(c)) return@withContext Result.success()
        if (Prefs.useLatestScript(c)) PythonBridge.updateScript(c) // keeps the old copy on failure
        val previous = Prefs.loadLastResult(c)
        val log = ArrayList<String>()
        val result = runCatching { PythonBridge.run(c) { log.add(it) } }
            .getOrElse { RunResult.failure("${it::class.java.simpleName}: ${it.message}") }
        WatchAlertBridge.afterCheck(c, result)?.let { log.add(it) }
        Prefs.saveLast(c, result, log)
        Notifier.notifyChanges(c, previous, result, background = true)
        Result.success()
    }

    companion object {
        private const val NAME = "periodic-price-check"

        fun schedule(c: Context, hours: Int) {
            val wm = WorkManager.getInstance(c)
            if (hours <= 0) {
                wm.cancelUniqueWork(NAME)
                return
            }
            val req = PeriodicWorkRequestBuilder<CheckWorker>(hours.toLong(), TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            wm.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, req)
        }
    }
}
