package com.teleport.app

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import java.net.URL
import javax.net.ssl.HttpsURLConnection

object ServerConfigStore {
    private const val PREFS_NAME = "teleport_native_prefs"
    private const val KEY_ACTIVE_URL = "active_server_url"
    private const val KEY_RECENT_URLS = "recent_server_urls"
    private const val MAX_RECENT = 5

    fun detectDevicePlatform(context: Context): String {
        val manufacturer = (Build.MANUFACTURER ?: "").lowercase()
        val model = (Build.MODEL ?: "").lowercase()
        if (manufacturer.contains("amazon") && (model.startsWith("aft") || model.contains("fire"))) {
            return "FireTV"
        }
        val uiModeManager = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        val isTvUiMode = uiModeManager?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
        val hasLeanback = context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        val hasTouch = context.packageManager.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN)
        if (isTvUiMode || (hasLeanback && !hasTouch)) {
            return "AndroidTV"
        }
        return "Mobile"
    }

    fun isTvPlatform(platform: String): Boolean {
        return platform == "FireTV" || platform == "AndroidTV"
    }

    fun normalizeAndValidateHttpsUrl(rawInput: String?): String? {
        val trimmed = (rawInput ?: "").trim()
        if (trimmed.isEmpty() || trimmed.length > 512) return null
        if (trimmed.any { it.isWhitespace() || it.code < 32 }) return null

        val withScheme = when {
            trimmed.startsWith("https://", ignoreCase = true) -> trimmed
            trimmed.contains("://") -> return null // Reject http://, file://, javascript:, data:, etc.
            else -> "https://$trimmed"
        }

        return try {
            val uri = Uri.parse(withScheme)
            val scheme = uri.scheme?.lowercase() ?: return null
            if (scheme != "https") return null
            if (!uri.userInfo.isNullOrEmpty()) return null
            val host = uri.host?.lowercase()?.trim() ?: return null
            if (host.isEmpty() || !host.contains(".") || host.endsWith(".")) return null
            if (host == "localhost" || host.startsWith("127.") || host.startsWith("0.")) return null

            val portPart = if (uri.port in 1..65535 && uri.port != 443) ":${uri.port}" else ""
            val cleanPath = (uri.encodedPath ?: "").trimEnd('/')
            val queryPart = if (!uri.encodedQuery.isNullOrEmpty()) "?${uri.encodedQuery}" else ""
            "https://$host$portPart$cleanPath$queryPart"
        } catch (_e: Exception) {
            null
        }
    }

    fun extractOrigin(httpsUrl: String?): String? {
        if (httpsUrl.isNullOrBlank()) return null
        return try {
            val uri = Uri.parse(httpsUrl)
            val scheme = uri.scheme?.lowercase() ?: return null
            val host = uri.host?.lowercase() ?: return null
            if (scheme != "https" || host.isEmpty()) return null
            val portPart = if (uri.port in 1..65535 && uri.port != 443) ":${uri.port}" else ""
            "https://$host$portPart"
        } catch (_e: Exception) {
            null
        }
    }

    fun getActiveUrl(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val saved = prefs.getString(KEY_ACTIVE_URL, null)
        return normalizeAndValidateHttpsUrl(saved)
    }

    fun saveActiveUrl(context: Context, rawUrl: String): String? {
        val valid = normalizeAndValidateHttpsUrl(rawUrl) ?: return null
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val recents = getRecentUrls(context).toMutableList()
        recents.removeAll { it.equals(valid, ignoreCase = true) }
        recents.add(0, valid)
        val trimmedRecents = recents.take(MAX_RECENT)
        prefs.edit()
            .putString(KEY_ACTIVE_URL, valid)
            .putString(KEY_RECENT_URLS, trimmedRecents.joinToString("\n"))
            .apply()
        return valid
    }

    fun getRecentUrls(context: Context): List<String> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_RECENT_URLS, "") ?: ""
        return raw.split("\n")
            .mapNotNull { normalizeAndValidateHttpsUrl(it) }
            .distinct()
            .take(MAX_RECENT)
    }

    fun testServerReachability(httpsUrl: String): Pair<Boolean, String> {
        val origin = extractOrigin(httpsUrl) ?: return Pair(false, "Ungültige HTTPS-Adresse.")
        val testEndpoints = listOf("$origin/manifest.json", "$origin/api/apk/version", httpsUrl)
        var lastErr = "Server nicht erreichbar."
        for (endpoint in testEndpoints) {
            var conn: HttpsURLConnection? = null
            try {
                conn = (URL(endpoint).openConnection() as? HttpsURLConnection) ?: continue
                conn.requestMethod = "GET"
                conn.connectTimeout = 6000
                conn.readTimeout = 6000
                conn.instanceFollowRedirects = true
                conn.setRequestProperty("Accept", "application/json, text/html")
                val code = conn.responseCode
                if (code in 200..399) {
                    return Pair(true, "Verbindung erfolgreich (HTTP $code)")
                }
                lastErr = "Server antwortete mit HTTP $code."
            } catch (e: Exception) {
                lastErr = e.localizedMessage ?: "TLS- oder Verbindungsfehler."
            } finally {
                try { conn?.disconnect() } catch (_e: Exception) {}
            }
        }
        return Pair(false, lastErr)
    }
}
