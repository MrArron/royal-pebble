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
        // On board the cruise planner's prices rarely matter and there's often no internet: skip, unless asked.
        if (AppPhase.current(c) == io.github.mrarron.royalpebble.settings.TripPhase.Phase.ONBOARD && !AppPhase.checksAtSea(c)) {
            io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(c, "prices", "background check skipped: on board")
            return@withContext Result.success()
        }
        if (Prefs.useLatestScript(c)) PythonBridge.updateScript(c) // keeps the old copy on failure
        val previous = Prefs.loadLastResult(c)
        val log = ArrayList<String>()
        val result = runCatching { PythonBridge.run(c) { log.add(it) } }
            .getOrElse { RunResult.failure("${it::class.java.simpleName}: ${it.message}") }
        Prefs.saveLast(c, result, log)
        // Price watches, phone notifications and watch alerts; held during quiet hours.
        log.addAll(AlertDelivery.afterCheck(c, previous, result, background = true))
        Prefs.saveLast(c, result, log)
        // The same check also refreshes the schedule when it's due (ScheduleRefresh: its own switch and limits).
        runCatching { io.github.mrarron.royalpricecheck.cruise.ScheduleRefresh.runIfDue(c) }.onFailure {
            io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(c, "schedule", "background refresh failed unexpectedly (${it::class.java.simpleName})")
        }
        Result.success()
    }

    companion object {
        private const val NAME = "periodic-price-check"

        /** Prices > Checks > Run a background check now: the same work, once, for testing. */
        fun runOnce(c: Context) {
            val req = androidx.work.OneTimeWorkRequestBuilder<CheckWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(c).enqueueUniqueWork("one-price-check", androidx.work.ExistingWorkPolicy.KEEP, req)
            io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(c, "prices", "background check asked for now (Run a background check now)")
        }

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
