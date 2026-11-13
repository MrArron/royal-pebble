package io.github.mrarron.royalpricecheck

import android.content.Context
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
            appendLine("# Created by Royal Pebble for Android. Your password is kept out of this file. Full options:")
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
