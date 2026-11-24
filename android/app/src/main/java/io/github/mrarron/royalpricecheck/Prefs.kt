package io.github.mrarron.royalpricecheck

import android.content.Context
import io.github.mrarron.royalpebble.alerts.AlertMutes
import io.github.mrarron.royalpebble.alerts.Muted
import io.github.mrarron.royalpebble.alerts.PriceWatch
import io.github.mrarron.royalpebble.alerts.PriceWatches
import io.github.mrarron.royalpebble.alerts.QuietHours
import java.io.File

object Prefs {
    private const val NAME = "settings"
    private fun sp(c: Context) = c.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    /** config.yaml in app-private storage, in exactly the upstream format. */
    fun configFile(c: Context): File = File(PythonBridge.workDir(c), "config.yaml")

    fun readConfig(c: Context): String =
        configFile(c).takeIf { it.exists() }?.readText()
            ?: c.assets.open("SAMPLE-SIMPLE-config.yaml").bufferedReader().use { it.readText() }

    fun writeConfig(c: Context, yaml: String) = configFile(c).writeText(yaml)

    /**
     * Save config.yaml with passwords swapped for placeholders (see [ConfigPasswords]); the real
     * ones go to [PasswordVault]. Returns the text as stored.
     */
    fun saveConfigScrubbed(c: Context, yaml: String): String {
        val ex = ConfigPasswords.extract(yaml, PasswordVault.all(c).keys)
        PasswordVault.remember(ex.passwords)
        PasswordVault.retain(c, ex.indices)
        writeConfig(c, ex.yaml)
        if (autoCheckHours(c) > 0) PasswordVault.saveEncrypted(c)
        return ex.yaml
    }

    /** A config written by an earlier build may hold a plain password; move it into the vault. */
    fun migratePlainPasswords(c: Context) {
        val f = configFile(c)
        if (f.exists()) saveConfigScrubbed(c, f.readText())
    }

    fun hasConfig(c: Context) = configFile(c).exists()

    /** Build a minimal config.yaml from the quick-setup form. */
    fun simpleConfig(username: String, password: String, cruiseLine: String): String {
        fun q(s: String) = "'" + s.replace("'", "''") + "'"   // YAML single-quoted scalar
        return buildString {
            appendLine(RoyalAccount.SIMPLE_HEADER + " Your password is kept out of this file. Full options:")
            appendLine("# https://github.com/jdeath/CheckRoyalCaribbeanPrice/blob/main/docs/config.md")
            appendLine("accountInfo:")
            appendLine("  - username: ${q(username.trim())}")
            appendLine("    password: ${q(password)}")
            appendLine("    cruiseLine: ${q(cruiseLine)}")
        }
    }

    fun useLatestScript(c: Context) = sp(c).getBoolean("use_latest_script", true)
    fun setUseLatestScript(c: Context, v: Boolean) = sp(c).edit().putBoolean("use_latest_script", v).apply()

    /** Advanced: take jdeath's main branch directly instead of the copy Royal Pebble verified. */
    fun followUpstream(c: Context) = sp(c).getBoolean("follow_upstream", false)
    fun setFollowUpstream(c: Context, v: Boolean) = sp(c).edit().putBoolean("follow_upstream", v).apply()

    fun autoCheckHours(c: Context) = sp(c).getInt("auto_check_hours", 0) // 0 = off
    fun setAutoCheckHours(c: Context, v: Int) = sp(c).edit().putInt("auto_check_hours", v).apply()

    /** Send new price drops, price watch hits, check-in changes and payment reminders to the watch (on unless turned off). */
    fun watchAlerts(c: Context) = sp(c).getBoolean("watch_alerts", true)
    fun setWatchAlerts(c: Context, v: Boolean) = sp(c).edit().putBoolean("watch_alerts", v).apply()

    /** Settings > About: look for a newer release when the app opens, at most once a day (on unless turned off). */
    fun updateCheckAuto(c: Context) = sp(c).getBoolean("update_check_auto", true)
    fun setUpdateCheckAuto(c: Context, v: Boolean) = sp(c).edit().putBoolean("update_check_auto", v).apply()
    fun updateCheckedAt(c: Context) = sp(c).getLong("update_checked_at", 0)
    fun setUpdateCheckedAt(c: Context, at: Long) = sp(c).edit().putLong("update_checked_at", at).apply()

    /** Keys of the alerts the watch has acknowledged, so each is sent once. */
    fun watchAlertKeys(c: Context): Set<String> = sp(c).getStringSet("watch_alert_sent", emptySet()) ?: emptySet()
    fun setWatchAlertKeys(c: Context, keys: Set<String>) = sp(c).edit().putStringSet("watch_alert_sent", keys).apply()

    /** Settings > Price watches: watches on Cruise Planner items not bought yet. */
    fun priceWatches(c: Context): List<PriceWatch> = PriceWatches.decode(sp(c).getString("price_watches", null))
    fun setPriceWatches(c: Context, list: List<PriceWatch>) = sp(c).edit().putString("price_watches", PriceWatches.encode(list)).apply()

    /** Settings > Price watches: the Cruise Planner's drinks, internet, dining, activities and spa, loaded from Royal (public listing data, no personal data). */
    fun catalogItems(c: Context): List<io.github.mrarron.royalpebble.royal.CatalogItem> =
        io.github.mrarron.royalpebble.royal.RoyalCatalog.decode(sp(c).getString("planner_catalog", null))
    fun setCatalogItems(c: Context, list: List<io.github.mrarron.royalpebble.royal.CatalogItem>) =
        sp(c).edit().putString("planner_catalog", io.github.mrarron.royalpebble.royal.RoyalCatalog.encode(list)).apply()

    /** Muted alerts (a booked item's price alert or a watch), shown with Unmute in Settings > Price watches. */
    fun mutes(c: Context): List<Muted> = AlertMutes.decode(sp(c).getString("alert_mutes", null))
    fun setMutes(c: Context, list: List<Muted>) = sp(c).edit().putString("alert_mutes", AlertMutes.encode(list)).apply()
    fun mutedKeys(c: Context): Set<String> = mutes(c).mapTo(HashSet()) { it.key }

    /** When background-check alerts may arrive (Settings > Price checks > Alert hours). */
    fun quietHours(c: Context): QuietHours =
        QuietHours.of(sp(c).getInt("alert_from", QuietHours.DEFAULT_FROM), sp(c).getInt("alert_until", QuietHours.DEFAULT_UNTIL))
    fun setQuietHours(c: Context, q: QuietHours) = sp(c).edit().putInt("alert_from", q.fromMinute).putInt("alert_until", q.untilMinute).apply()

    /** Phone notifications held for quiet hours (JSON array, [AlertDelivery.PhoneNotice]). */
    fun heldNotices(c: Context): String = sp(c).getString("held_notices", "[]") ?: "[]"
    fun setHeldNotices(c: Context, json: String) = sp(c).edit().putString("held_notices", json).apply()
    /** The time held alerts go out (epoch ms), 0 when nothing waits. */
    fun heldUntil(c: Context) = sp(c).getLong("held_until", 0)
    fun setHeldUntil(c: Context, at: Long) = sp(c).edit().putLong("held_until", at).apply()

    fun notifiedKeys(c: Context): Set<String> = sp(c).getStringSet("notified", emptySet()) ?: emptySet()
    fun setNotifiedKeys(c: Context, keys: Set<String>) = sp(c).edit().putStringSet("notified", keys).apply()

    // Last run, kept on disk so the summary survives restarts and background runs.
    private fun lastResultFile(c: Context) = File(PythonBridge.workDir(c), "last_result.json")
    private fun lastLogFile(c: Context) = File(PythonBridge.workDir(c), "last_run.log")

    fun saveLast(c: Context, result: RunResult, log: List<String>) {
        lastResultFile(c).writeText(result.raw)
        lastLogFile(c).writeText(log.joinToString("\n"))
    }

    fun loadLastResult(c: Context): RunResult? = runCatching {
        lastResultFile(c).takeIf { it.exists() }?.let { RunResult.parse(it.readText(), it.lastModified()) }
    }.getOrNull()

    fun loadLastLog(c: Context): List<String> =
        lastLogFile(c).takeIf { it.exists() }?.readLines() ?: emptyList()
}
