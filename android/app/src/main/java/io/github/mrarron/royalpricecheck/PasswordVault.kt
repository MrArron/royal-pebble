package io.github.mrarron.royalpricecheck

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Royal Caribbean passwords, kept in two places:
 *  - memory, until the app process ends (so Run now works without saving anything), and
 *  - only while background checks are on: encrypted with an Android Keystore key
 *    (AES-256-GCM, key never leaves the Keystore) in the app's private preferences.
 * Turning background checks off deletes the saved copy and the key.
 */
object PasswordVault {
    private const val ALIAS = "royal_pebble_password_vault"
    private const val PREF = "vault"
    private const val KEY_BLOB = "blob"
    private const val KEY_PEBBLE = "pebble_blob"

    private val session = HashMap<Int, String>()
    private val lock = Any()

    private fun sp(c: Context) = c.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    private fun key(create: Boolean): SecretKey? {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        if (!create) return null
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(true))
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)
    }

    private fun decrypt(blob: String): String? = runCatching {
        val (iv, ct) = blob.split(":", limit = 2)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        String(cipher.doFinal(Base64.decode(ct, Base64.NO_WRAP)), Charsets.UTF_8)
    }.getOrNull()

    private fun loadSaved(c: Context): Map<Int, String> {
        val blob = sp(c).getString(KEY_BLOB, null) ?: return emptyMap()
        val json = decrypt(blob) ?: return emptyMap() // key lost (e.g. restored backup): treat as not saved
        val o = JSONObject(json)
        return o.keys().asSequence().associate { it.toInt() to o.getString(it) }
    }

    fun hasSaved(c: Context) = sp(c).contains(KEY_BLOB)

    /** Everything usable right now: the saved copy, overlaid with what was typed this session. */
    fun all(c: Context): Map<Int, String> = synchronized(lock) { loadSaved(c) + session }

    /** Remember passwords for this session (memory only). */
    fun remember(passwords: Map<Int, String>) = synchronized(lock) { session.putAll(passwords) }

    /** Drop passwords for placeholders that are no longer in the config. */
    fun retain(c: Context, indices: Set<Int>) = synchronized(lock) {
        session.keys.retainAll(indices)
        if (hasSaved(c)) saveEncrypted(c, loadSaved(c).filterKeys { it in indices })
    }

    private fun saveEncrypted(c: Context, passwords: Map<Int, String>) {
        val o = JSONObject()
        passwords.forEach { (i, p) -> o.put(i.toString(), p) }
        sp(c).edit().putString(KEY_BLOB, encrypt(o.toString())).apply()
    }

    /** Write the passwords to encrypted storage. Call only while background checks are on. */
    fun saveEncrypted(c: Context) = synchronized(lock) { saveEncrypted(c, all(c)) }

    /** Delete the saved copy and the Keystore key. The in-memory copy stays until the app closes. */
    fun deleteSaved(c: Context) = synchronized(lock) {
        sp(c).edit().remove(KEY_BLOB).apply()
        // The Royal Pebble login (below) shares the key: keep it while that copy is saved.
        if (!hasPebbleLogin(c)) deleteKey()
    }

    private fun deleteKey() {
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS) }
    }

    // ---- The Royal Pebble login (the Cruise screens' "Download with login") ----
    // One email and password, separate from the price checker's accounts. In memory for this session
    // after a download; saved encrypted only when the owner ticks "Remember on this phone".

    private var pebbleSession: Pair<String, String>? = null

    /** The email and password to offer: this session's, else the saved copy. */
    fun pebbleLogin(c: Context): Pair<String, String>? = synchronized(lock) {
        pebbleSession ?: runCatching {
            val blob = sp(c).getString(KEY_PEBBLE, null) ?: return@runCatching null
            val o = JSONObject(decrypt(blob) ?: return@runCatching null)
            o.getString("email") to o.getString("password")
        }.getOrNull()
    }

    fun hasPebbleLogin(c: Context): Boolean = sp(c).contains(KEY_PEBBLE)

    /** Keeps the login for this session; with [persist] also encrypted on the phone. */
    fun rememberPebbleLogin(c: Context, email: String, password: String, persist: Boolean) = synchronized(lock) {
        pebbleSession = email to password
        if (persist) {
            val o = JSONObject().put("email", email).put("password", password)
            sp(c).edit().putString(KEY_PEBBLE, encrypt(o.toString())).apply()
        }
    }

    /** Forgets the login everywhere; the Keystore key goes too unless the price checker still uses it. */
    fun forgetPebbleLogin(c: Context) = synchronized(lock) {
        pebbleSession = null
        sp(c).edit().remove(KEY_PEBBLE).apply()
        if (!hasSaved(c)) deleteKey()
    }
}
