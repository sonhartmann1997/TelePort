package com.teleport.app

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.io.BufferedInputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Temporärer, rein lokaler WLAN-Setup-Server für die Ersteinrichtung am TV.
 * Läuft ausschließlich solange der Setup-Dialog geöffnet ist, generiert eine
 * zufällige 4-stellige Einmal-PIN (max. 5 Fehlversuche), akzeptiert nur gültige
 * https://-Worker-URLs und schließt den Socket sofort nach Empfang oder Schließen.
 * Belastet den Cloudflare-Worker mit exakt 0 Anfragen.
 */
class LanQrSetupServer(
    private val onValidUrlReceived: (String) -> Unit
) {
    private val running = AtomicBoolean(false)
    private val failedAttempts = AtomicInteger(0)
    private val random = SecureRandom()

    private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null

    var setupUrl: String? = null
        private set
    var pinCode: String = ""
        private set
    private var sessionToken: String = ""

    fun start(): Boolean {
        stop()
        val lanIp = findLocalLanIpv4() ?: return false
        return try {
            val socket = ServerSocket(0)
            socket.reuseAddress = true
            serverSocket = socket
            pinCode = (1000 + random.nextInt(9000)).toString()
            sessionToken = generateHexToken(12)
            failedAttempts.set(0)
            setupUrl = "http://$lanIp:${socket.localPort}/?t=$sessionToken"
            running.set(true)

            acceptThread = Thread({
                while (running.get()) {
                    val client = try {
                        socket.accept()
                    } catch (_e: Exception) {
                        break
                    }
                    Thread({ handleClient(client) }, "LanQrSetupClient").start()
                }
            }, "LanQrSetupAccept").apply {
                isDaemon = true
                start()
            }
            true
        } catch (_e: Exception) {
            stop()
            false
        }
    }

    fun stop() {
        running.set(false)
        try { serverSocket?.close() } catch (_e: Exception) {}
        serverSocket = null
        acceptThread = null
    }

    private fun handleClient(client: Socket) {
        client.use { sock ->
            try {
                sock.soTimeout = 5000
                val input = BufferedInputStream(sock.getInputStream())
                val rawBuf = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(2048)
                var headerEndIdx = -1
                var contentLength = 0
                while (rawBuf.size() < 12288) {
                    val n = input.read(chunk)
                    if (n <= 0) break
                    rawBuf.write(chunk, 0, n)
                    val cur = rawBuf.toString("UTF-8")
                    if (headerEndIdx < 0) {
                        headerEndIdx = cur.indexOf("\r\n\r\n")
                        if (headerEndIdx >= 0) {
                            val hdrs = cur.substring(0, headerEndIdx)
                            val clLine = hdrs.lineSequence().firstOrNull { it.startsWith("Content-Length:", ignoreCase = true) }
                            contentLength = clLine?.substringAfter(":")?.trim()?.toIntOrNull()?.coerceIn(0, 4096) ?: 0
                        }
                    }
                    if (headerEndIdx >= 0) {
                        val bodyBytesSoFar = rawBuf.size() - (headerEndIdx + 4)
                        if (bodyBytesSoFar >= contentLength) break
                    }
                }
                if (rawBuf.size() <= 0) return

                val rawReq = rawBuf.toString("UTF-8")
                val headerPart = if (headerEndIdx >= 0) rawReq.substring(0, headerEndIdx) else rawReq
                val bodyPart = if (headerEndIdx >= 0) rawReq.substring(headerEndIdx + 4) else ""

                val firstLine = headerPart.lineSequence().firstOrNull() ?: return
                val parts = firstLine.split(" ")
                if (parts.size < 2) return
                val method = parts[0].uppercase()
                val fullTarget = parts[1]
                val path = fullTarget.substringBefore("?")
                val query = fullTarget.substringAfter("?", "")

                if (failedAttempts.get() >= 5) {
                    sendHtml(sock.getOutputStream(), 429, buildFeedbackPage(false, "Zu viele falsche PIN-Versuche. Bitte Setup am Fernseher neu öffnen."))
                    return
                }

                if (method == "GET" && path == "/") {
                    val tokenParam = parseFormOrQuery(query)["t"] ?: ""
                    if (!constantTimeEquals(tokenParam, sessionToken)) {
                        sendHtml(sock.getOutputStream(), 403, buildFeedbackPage(false, "Ungültiger oder abgelaufener QR-Link. Bitte QR-Code am Fernseher erneut scannen."))
                        return
                    }
                    sendHtml(sock.getOutputStream(), 200, buildFormPage(sessionToken))
                    return
                }

                if (method == "POST" && path == "/submit") {
                    if (bodyPart.length > 4096) {
                        sendHtml(sock.getOutputStream(), 413, buildFeedbackPage(false, "Eingabe zu groß."))
                        return
                    }
                    val fields = parseFormOrQuery(bodyPart)
                    val tokenVal = fields["t"] ?: ""
                    val pinVal = (fields["pin"] ?: "").trim()
                    val rawWorkerUrl = (fields["url"] ?: "").trim()

                    if (!constantTimeEquals(tokenVal, sessionToken)) {
                        sendHtml(sock.getOutputStream(), 403, buildFeedbackPage(false, "Sitzung abgelaufen. Bitte QR-Code am TV erneut scannen."))
                        return
                    }
                    if (!constantTimeEquals(pinVal, pinCode)) {
                        val tries = failedAttempts.incrementAndGet()
                        val remaining = (5 - tries).coerceAtLeast(0)
                        sendHtml(sock.getOutputStream(), 403, buildFeedbackPage(false, "Falscher 4-stelliger PIN. Noch $remaining Versuch(e) übrig."))
                        return
                    }
                    val validHttpsUrl = ServerConfigStore.normalizeAndValidateHttpsUrl(rawWorkerUrl)
                    if (validHttpsUrl == null) {
                        sendHtml(sock.getOutputStream(), 400, buildFeedbackPage(false, "Bitte eine gültige HTTPS-Worker-URL eingeben (z. B. https://dein-worker.workers.dev)."))
                        return
                    }

                    sendHtml(sock.getOutputStream(), 200, buildFeedbackPage(true, "Adresse wurde an den Fernseher übertragen! Der TV prüft die Verbindung – bei einem Tippfehler kannst du einfach zurückgehen und erneut senden."))
                    onValidUrlReceived(validHttpsUrl)
                    return
                }

                sendHtml(sock.getOutputStream(), 404, buildFeedbackPage(false, "Seite nicht gefunden."))
            } catch (_e: Exception) {
            }
        }
    }

    private fun parseFormOrQuery(raw: String): Map<String, String> {
        val map = mutableMapOf<String, String>()
        if (raw.isBlank()) return map
        for (pair in raw.split("&")) {
            val eq = pair.indexOf("=")
            if (eq <= 0) continue
            try {
                val k = URLDecoder.decode(pair.substring(0, eq), "UTF-8")
                val v = URLDecoder.decode(pair.substring(eq + 1), "UTF-8")
                map[k] = v
            } catch (_e: Exception) {}
        }
        return map
    }

    private fun sendHtml(out: OutputStream, statusCode: Int, html: String) {
        val bytes = html.toByteArray(Charsets.UTF_8)
        val statusText = when (statusCode) {
            200 -> "OK"
            400 -> "Bad Request"
            403 -> "Forbidden"
            413 -> "Payload Too Large"
            429 -> "Too Many Requests"
            else -> "Not Found"
        }
        val headers = buildString {
            append("HTTP/1.1 $statusCode $statusText\r\n")
            append("Content-Type: text/html; charset=utf-8\r\n")
            append("Content-Length: ${bytes.size}\r\n")
            append("Cache-Control: no-store\r\n")
            append("Connection: close\r\n\r\n")
        }
        out.write(headers.toByteArray(Charsets.UTF_8))
        out.write(bytes)
        out.flush()
    }

    private fun buildFormPage(token: String): String {
        val safeToken = escapeHtml(token)
        return """<!doctype html>
<html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TelePort TV Einrichtung</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;background:#060a14;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:20px}
.card{width:100%;max-width:440px;background:#0f172a;border:1px solid rgba(56,189,248,.35);border-radius:18px;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,.55)}
h1{margin:0 0 6px;font-size:21px}p{margin:0 0 18px;font-size:13.5px;color:#94a3b8;line-height:1.5}
label{display:block;font-size:12.5px;font-weight:700;color:#cbd5e1;margin:12px 0 6px}
input{width:100%;padding:13px 14px;border-radius:11px;border:1px solid rgba(148,163,184,.35);background:#060a14;color:#fff;font-size:15px}
input:focus{outline:none;border-color:#38bdf8}
button{width:100%;margin-top:18px;padding:14px;border-radius:12px;border:0;background:linear-gradient(135deg,#0284c7,#2563eb);color:#fff;font-size:16px;font-weight:800;cursor:pointer}
</style></head><body><main class="card">
<h1>TelePort TV einrichten</h1>
<p>Sende deine Cloudflare-Worker-Adresse direkt im lokalen WLAN an deinen Fernseher — ohne Tippen mit der Fernbedienung.</p>
<form method="POST" action="/submit">
<input type="hidden" name="t" value="$safeToken"/>
<label for="url">Cloudflare Worker URL (z. B. https://teleport.deinname.workers.dev)</label>
<input id="url" name="url" type="text" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" required placeholder="teleport.deinname.workers.dev" autocomplete="url"/>
<label for="pin">4-stelliger PIN vom Fernseher</label>
<input id="pin" name="pin" type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required placeholder="z. B. 4829" style="letter-spacing:6px;text-align:center;font-weight:800;font-size:20px"/>
<button type="submit">An Fernseher senden</button>
</form></main></body></html>"""
    }

    private fun buildFeedbackPage(ok: Boolean, msg: String): String {
        val color = if (ok) "#34d399" else "#f87171"
        val title = if (ok) "Erfolgreich gesendet" else "Hinweis"
        val backHtml = if (ok) "" else """<p style="margin-top:16px"><a href="javascript:history.back()" style="color:#38bdf8;font-weight:700">Zurück zum Formular</a></p>"""
        return """<!doctype html>
<html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>$title</title>
<style>body{margin:0;min-height:100dvh;background:#060a14;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:20px}
.card{width:100%;max-width:420px;background:#0f172a;border:1px solid $color;border-radius:18px;padding:24px;text-align:center}
h1{margin:0 0 10px;color:$color;font-size:21px}p{margin:0;color:#cbd5e1;font-size:14px;line-height:1.5}</style>
</head><body><main class="card"><h1>$title</h1><p>${escapeHtml(msg)}</p>$backHtml</main></body></html>"""
    }

    private fun escapeHtml(input: String): String {
        return input
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&#39;")
    }

    private fun constantTimeEquals(a: String, b: String): Boolean {
        return MessageDigest.isEqual(a.toByteArray(Charsets.UTF_8), b.toByteArray(Charsets.UTF_8))
    }

    private fun generateHexToken(byteCount: Int): String {
        val bytes = ByteArray(byteCount)
        random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun findLocalLanIpv4(): String? {
        return try {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
            var fallback: String? = null
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (!iface.isUp || iface.isLoopback || iface.isVirtual) continue
                val addrs = iface.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val ip = addr.hostAddress ?: continue
                        if (ip.startsWith("192.168.") || ip.startsWith("10.") || ip.matches(Regex("^172\\.(1[6-9]|2\\d|3[0-1])\\..*"))) {
                            return ip
                        }
                        if (fallback == null) fallback = ip
                    }
                }
            }
            fallback
        } catch (_e: Exception) {
            null
        }
    }

    companion object {
        fun generateQrBitmap(content: String, sizePx: Int = 360): Bitmap? {
            return try {
                val hints = mapOf(
                    EncodeHintType.MARGIN to 1,
                    EncodeHintType.CHARACTER_SET to "UTF-8"
                )
                val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, sizePx, sizePx, hints)
                val bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.RGB_565)
                for (y in 0 until sizePx) {
                    for (x in 0 until sizePx) {
                        bmp.setPixel(x, y, if (matrix.get(x, y)) Color.BLACK else Color.WHITE)
                    }
                }
                bmp
            } catch (_e: Exception) {
                null
            }
        }
    }
}
