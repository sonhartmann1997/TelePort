package com.teleport.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : Activity() {

    private lateinit var rootContainer: FrameLayout
    private lateinit var webView: WebView
    private lateinit var fullscreenContainer: FrameLayout
    private lateinit var setupOverlay: ScrollView
    private lateinit var errorOverlay: LinearLayout
    private lateinit var errorMessageText: TextView

    private var customVideoView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private var platformName: String = "Mobile"
    private var configuredServerOrigin: String? = null
    @Volatile
    private var currentWebViewOrigin: String? = null

    private var lanQrSetupServer: LanQrSetupServer? = null
    private var lastBackPressAt: Long = 0L
    private var mainFrameHadError: Boolean = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        platformName = ServerConfigStore.detectDevicePlatform(this)

        rootContainer = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#060A14"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#060A14"))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            isFocusable = true
            isFocusableInTouchMode = true
        }
        configureWebView(webView)

        fullscreenContainer = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        errorOverlay = buildErrorOverlay()
        setupOverlay = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#060A14"))
            isFillViewport = true
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        rootContainer.addView(webView)
        rootContainer.addView(fullscreenContainer)
        rootContainer.addView(errorOverlay)
        rootContainer.addView(setupOverlay)
        setContentView(rootContainer)

        // Android 15 (targetSdk 35) Edge-to-Edge Schutz: Systemleisten-Abstand über Margins (WebView ignoriert internes Padding), Vollbild-Video bleibt randlos
        ViewCompat.setOnApplyWindowInsetsListener(rootContainer) { _, insets ->
            val sysBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val wvLp = webView.layoutParams as? FrameLayout.LayoutParams
            if (wvLp != null) {
                wvLp.setMargins(sysBars.left, sysBars.top, sysBars.right, sysBars.bottom)
                webView.layoutParams = wvLp
            }
            setupOverlay.setPadding(sysBars.left, sysBars.top, sysBars.right, sysBars.bottom)
            insets
        }

        val savedUrl = ServerConfigStore.getActiveUrl(this)
        if (savedUrl != null) {
            loadTelePortUrl(savedUrl)
        } else {
            showServerSetupScreen(canCancel = false)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(wv: WebView) {
        val ws = wv.settings
        ws.javaScriptEnabled = true
        ws.domStorageEnabled = true
        ws.databaseEnabled = true
        ws.mediaPlaybackRequiresUserGesture = false
        ws.textZoom = 100
        ws.allowFileAccess = false
        ws.allowContentAccess = false
        ws.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        ws.loadWithOverviewMode = true
        ws.useWideViewPort = true
        ws.setSupportZoom(false)
        ws.builtInZoomControls = false
        ws.displayZoomControls = false
        ws.userAgentString = "${ws.userAgentString} TelePortAPK/${BuildConfig.VERSION_NAME} ($platformName)"

        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(wv, true)

        wv.addJavascriptInterface(TelePortNativeBridge(), "TelePortNative")
        wv.setDownloadListener { downloadUrl, _, _, _, _ ->
            val target = (downloadUrl ?: "").trim()
            if (target.startsWith("https://", ignoreCase = true)) {
                openSafeExternalIntent(target)
            }
        }

        wv.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                mainFrameHadError = false
                currentWebViewOrigin = ServerConfigStore.extractOrigin(url)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                currentWebViewOrigin = ServerConfigStore.extractOrigin(url)
                if (!mainFrameHadError && errorOverlay.visibility == View.VISIBLE) {
                    errorOverlay.visibility = View.GONE
                }
                CookieManager.getInstance().flush()
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                val scheme = (uri.scheme ?: "").lowercase()
                val host = (uri.host ?: "").lowercase()
                val pathLower = (uri.path ?: "").lowercase()
                val reqOrigin = ServerConfigStore.extractOrigin(uri.toString())

                // APK-Download-Links immer an den System-Browser / Paket-Installer übergeben
                if (scheme == "https" && (pathLower.endsWith(".apk") || pathLower.startsWith("/download/"))) {
                    openSafeExternalIntent(uri.toString())
                    return true
                }

                // Eigene Worker-Origin bleibt immer in der WebView
                if (scheme == "https" && configuredServerOrigin != null && reqOrigin == configuredServerOrigin) {
                    return false
                }

                // Telegram-Login-Widget / YouTube-Embed-Navigationen in Subframes nicht abwürgen
                if (request.isForMainFrame == false && scheme == "https") {
                    return false
                }

                // Externe Links (Telegram, YouTube, APK-Download etc.) sicher über Android Intent öffnen
                if (scheme == "https" || scheme == "tg") {
                    openSafeExternalIntent(uri.toString(), isTelegram = (scheme == "tg" || host == "t.me" || host.endsWith(".t.me")))
                    return true
                }
                return true
            }

            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                // Niemals unsichere Zertifikate durchwinken!
                mainFrameHadError = true
                handler?.cancel()
                showErrorOverlay("Sichere HTTPS-Verbindung konnte nicht bestätigt werden (TLS-Zertifikatsfehler). Bitte Server-URL prüfen.")
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    mainFrameHadError = true
                    val desc = error?.description?.toString() ?: "Verbindung fehlgeschlagen"
                    showErrorOverlay("TelePort konnte nicht geladen werden:\n$desc")
                }
            }
        }

        wv.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (customVideoView != null) {
                    callback?.onCustomViewHidden()
                    return
                }
                customVideoView = view
                customViewCallback = callback
                fullscreenContainer.removeAllViews()
                if (view != null) {
                    fullscreenContainer.addView(
                        view,
                        FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT,
                            FrameLayout.LayoutParams.MATCH_PARENT
                        )
                    )
                }
                fullscreenContainer.visibility = View.VISIBLE
                webView.visibility = View.GONE
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                hideSystemBarsForVideo(true)
            }

            override fun onHideCustomView() {
                exitCustomVideoFullscreen()
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                // Kamera/Mikrofon werden nicht benötigt und strikt verweigert (WebRTC DataChannel braucht keine Medienrechte)
                request?.deny()
            }
        }
    }

    private fun exitCustomVideoFullscreen() {
        if (customVideoView == null) return
        fullscreenContainer.visibility = View.GONE
        fullscreenContainer.removeAllViews()
        customVideoView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        webView.visibility = View.VISIBLE
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBarsForVideo(false)
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBarsForVideo(hide: Boolean) {
        if (hide) {
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                )
        } else {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
        }
    }

    private fun loadTelePortUrl(httpsUrl: String) {
        stopLanQrSetupServer()
        configuredServerOrigin = ServerConfigStore.extractOrigin(httpsUrl)
        setupOverlay.visibility = View.GONE
        errorOverlay.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.loadUrl(httpsUrl)
        webView.requestFocus()
    }

    private fun showErrorOverlay(message: String) {
        mainHandler.post {
            errorMessageText.text = message
            errorOverlay.visibility = View.VISIBLE
        }
    }

    private fun buildErrorOverlay(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#EE060A14"))
            setPadding(dp(28), dp(28), dp(28), dp(28))
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }
        val title = TextView(this).apply {
            text = "Verbindung unterbrochen"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 22f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        errorMessageText = TextView(this).apply {
            text = "Server konnte nicht erreicht werden."
            setTextColor(Color.parseColor("#CBD5E1"))
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(20))
        }
        val btnRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        val retryBtn = createCinemaButton("Erneut versuchen", primary = true) {
            errorOverlay.visibility = View.GONE
            webView.reload()
        }
        val changeUrlBtn = createCinemaButton("Server-URL ändern", primary = false) {
            errorOverlay.visibility = View.GONE
            showServerSetupScreen(canCancel = configuredServerOrigin != null)
        }
        val clearCacheBtn = createCinemaButton("Cache leeren", primary = false) {
            webView.clearCache(true)
            Toast.makeText(this, "WebView-Cache geleert", Toast.LENGTH_SHORT).show()
            errorOverlay.visibility = View.GONE
            webView.reload()
        }
        btnRow.addView(retryBtn)
        btnRow.addView(spaceView(dp(10)))
        btnRow.addView(changeUrlBtn)
        btnRow.addView(spaceView(dp(10)))
        btnRow.addView(clearCacheBtn)

        box.addView(title)
        box.addView(errorMessageText)
        box.addView(btnRow)
        return box
    }

    private fun showServerSetupScreen(canCancel: Boolean) {
        stopLanQrSetupServer()
        errorOverlay.visibility = View.GONE
        setupOverlay.removeAllViews()

        val outer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(28), dp(24), dp(36))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#0F172A"))
                cornerRadius = dp(18).toFloat()
                setStroke(dp(1), Color.parseColor("#38BDF8"))
            }
            setPadding(dp(22), dp(22), dp(22), dp(22))
            layoutParams = LinearLayout.LayoutParams(
                if (ServerConfigStore.isTvPlatform(platformName)) dp(700) else LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val heading = TextView(this).apply {
            text = "TelePort verbinden"
            setTextColor(Color.WHITE)
            textSize = 24f
            typeface = Typeface.DEFAULT_BOLD
        }
        val sub = TextView(this).apply {
            val devLabel = when (platformName) {
                "FireTV" -> "Amazon Fire TV"
                "AndroidTV" -> "Android TV"
                else -> "Android Smartphone"
            }
            text = "$devLabel · v${BuildConfig.VERSION_NAME} · Gib deine Cloudflare-Worker-URL ein oder sende sie per QR-Code vom Handy."
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 14f
            setPadding(0, dp(6), 0, dp(16))
        }

        val urlInput = EditText(this).apply {
            hint = "https://teleport.deinname.workers.dev"
            setText(ServerConfigStore.getActiveUrl(this@MainActivity) ?: "")
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#64748B"))
            textSize = 16f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_DONE
            setSingleLine(true)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#060A14"))
                cornerRadius = dp(10).toFloat()
                setStroke(dp(1), Color.parseColor("#475569"))
            }
        }

        val feedbackText = TextView(this).apply {
            text = ""
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 13.5f
            setPadding(0, dp(8), 0, dp(10))
        }

        lateinit var connectBtn: Button
        fun triggerConnect(rawUrl: String) {
            val normalized = ServerConfigStore.normalizeAndValidateHttpsUrl(rawUrl)
            if (normalized == null) {
                feedbackText.setTextColor(Color.parseColor("#F87171"))
                feedbackText.text = "Bitte eine gültige HTTPS-URL eingeben (z. B. https://dein-worker.workers.dev)."
                return
            }
            connectBtn.isEnabled = false
            feedbackText.setTextColor(Color.parseColor("#38BDF8"))
            feedbackText.text = "Prüfe HTTPS-Verbindung zu $normalized …"
            Thread {
                val (ok, msg) = ServerConfigStore.testServerReachability(normalized)
                mainHandler.post {
                    connectBtn.isEnabled = true
                    if (ok) {
                        ServerConfigStore.saveActiveUrl(this@MainActivity, normalized)
                        Toast.makeText(this@MainActivity, "Verbunden!", Toast.LENGTH_SHORT).show()
                        loadTelePortUrl(normalized)
                    } else {
                        feedbackText.setTextColor(Color.parseColor("#F87171"))
                        feedbackText.text = "Verbindung fehlgeschlagen: $msg"
                    }
                }
            }.start()
        }

        urlInput.setOnEditorActionListener { _, actionId, event ->
            val isImeConfirm = actionId == EditorInfo.IME_ACTION_DONE ||
                actionId == EditorInfo.IME_ACTION_GO ||
                actionId == EditorInfo.IME_ACTION_SEND
            val isEnterKey = event != null && event.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN
            if (isImeConfirm || isEnterKey) {
                triggerConnect(urlInput.text.toString())
                true
            } else {
                false
            }
        }

        connectBtn = createCinemaButton("Verbinden & Speichern", primary = true) {
            triggerConnect(urlInput.text.toString())
        }

        val actionRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.START
        }
        actionRow.addView(connectBtn)

        if (canCancel) {
            actionRow.addView(spaceView(dp(10)))
            actionRow.addView(createCinemaButton("Abbrechen", primary = false) {
                stopLanQrSetupServer()
                setupOverlay.visibility = View.GONE
                webView.requestFocus()
            })
        }

        card.addView(heading)
        card.addView(sub)
        card.addView(urlInput)
        card.addView(feedbackText)
        card.addView(actionRow)

        // Letzte Server-URLs (1-Klick-Wechsel)
        val recents = ServerConfigStore.getRecentUrls(this)
        if (recents.isNotEmpty()) {
            val recentHeader = TextView(this).apply {
                text = "Zuletzt genutzte Server:"
                setTextColor(Color.parseColor("#94A3B8"))
                textSize = 13f
                setPadding(0, dp(16), 0, dp(6))
            }
            card.addView(recentHeader)
            for (recentUrl in recents) {
                val recBtn = createCinemaButton(recentUrl, primary = false) {
                    urlInput.setText(recentUrl)
                    triggerConnect(recentUrl)
                }
                val lp = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = dp(6) }
                card.addView(recBtn, lp)
            }
        }

        // Lokaler WLAN-QR-Code zum Senden der URL vom Handy (0 Worker-Last!)
        val qrSection = buildLanQrSetupSection { receivedUrl ->
            mainHandler.post {
                urlInput.setText(receivedUrl)
                Toast.makeText(this@MainActivity, "Server-URL vom Handy empfangen!", Toast.LENGTH_SHORT).show()
                triggerConnect(receivedUrl)
            }
        }
        if (qrSection != null) {
            val qrLp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(18) }
            card.addView(qrSection, qrLp)
        }

        outer.addView(card)
        setupOverlay.addView(outer)
        setupOverlay.visibility = View.VISIBLE
        if (ServerConfigStore.isTvPlatform(platformName)) {
            connectBtn.requestFocus()
        } else {
            urlInput.requestFocus()
        }
    }

    private fun buildLanQrSetupSection(onUrlReceived: (String) -> Unit): View? {
        val server = LanQrSetupServer(onUrlReceived)
        if (!server.start()) return null
        lanQrSetupServer = server
        val localUrl = server.setupUrl ?: return null
        val pin = server.pinCode
        val qrBmp = LanQrSetupServer.generateQrBitmap(localUrl, dp(156)) ?: return null

        val box = LinearLayout(this).apply {
            orientation = if (ServerConfigStore.isTvPlatform(platformName)) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#060A14"))
                cornerRadius = dp(14).toFloat()
                setStroke(dp(1), Color.parseColor("#1E3A8A"))
            }
            setPadding(dp(14), dp(14), dp(14), dp(14))
        }

        val qrImage = ImageView(this).apply {
            setImageBitmap(qrBmp)
            setBackgroundColor(Color.WHITE)
            setPadding(dp(6), dp(6), dp(6), dp(6))
            layoutParams = LinearLayout.LayoutParams(dp(156), dp(156))
        }

        val infoCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(if (ServerConfigStore.isTvPlatform(platformName)) dp(16) else 0, dp(8), 0, 0)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        val qrTitle = TextView(this).apply {
            text = "Schnell-Einrichtung per Handy-QR (im WLAN)"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
        }
        val qrDesc = TextView(this).apply {
            text = "Scanne den QR-Code mit deiner Handy-Kamera, füge deine Worker-URL ein und bestätige mit diesem Einmal-PIN:"
            setTextColor(Color.parseColor("#CBD5E1"))
            textSize = 13f
            setPadding(0, dp(6), 0, dp(8))
        }
        val pinBadge = TextView(this).apply {
            text = "PIN: $pin"
            setTextColor(Color.parseColor("#34D399"))
            textSize = 24f
            typeface = Typeface.MONOSPACE
            setPadding(0, dp(2), 0, dp(4))
        }
        val addrHint = TextView(this).apply {
            text = "Lokal aktiv: $localUrl"
            setTextColor(Color.parseColor("#64748B"))
            textSize = 11.5f
        }

        infoCol.addView(qrTitle)
        infoCol.addView(qrDesc)
        infoCol.addView(pinBadge)
        infoCol.addView(addrHint)

        box.addView(qrImage)
        box.addView(infoCol)
        return box
    }

    private fun stopLanQrSetupServer() {
        lanQrSetupServer?.stop()
        lanQrSetupServer = null
    }

    private fun openNativeOptionsDialog() {
        val items = arrayOf(
            "Server-URL ändern / QR-Setup",
            "Seite neu laden",
            "WebView-Cache leeren",
            "App-Info (v${BuildConfig.VERSION_NAME} · $platformName)"
        )
        AlertDialog.Builder(this)
            .setTitle("TelePort App-Optionen")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> showServerSetupScreen(canCancel = configuredServerOrigin != null)
                    1 -> webView.reload()
                    2 -> {
                        webView.clearCache(true)
                        Toast.makeText(this, "Cache geleert", Toast.LENGTH_SHORT).show()
                        webView.reload()
                    }
                    3 -> Toast.makeText(
                        this,
                        "TelePort v${BuildConfig.VERSION_NAME} ($platformName)\nServer: ${configuredServerOrigin ?: "-"}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
            .setNegativeButton("Schließen", null)
            .show()
    }

    private fun openSafeExternalIntent(url: String, isTelegram: Boolean = false) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        } catch (_e: Exception) {
            val msg = if (isTelegram && ServerConfigStore.isTvPlatform(platformName)) {
                "Telegram ist auf diesem Fernseher nicht installiert. Nutze den 6-stelligen TV-Code über dein Handy."
            } else {
                "Keine passende App zum Öffnen dieses Links gefunden."
            }
            Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
        }
    }

    private fun createCinemaButton(label: String, primary: Boolean, onClick: () -> Unit): Button {
        val normalBg = GradientDrawable().apply {
            setColor(if (primary) Color.parseColor("#0284C7") else Color.parseColor("#1E293B"))
            cornerRadius = dp(10).toFloat()
            setStroke(dp(1), if (primary) Color.parseColor("#38BDF8") else Color.parseColor("#475569"))
        }
        val focusedBg = GradientDrawable().apply {
            setColor(if (primary) Color.parseColor("#0EA5E9") else Color.parseColor("#334155"))
            cornerRadius = dp(10).toFloat()
            setStroke(dp(3), Color.parseColor("#FF7A00"))
        }
        val selector = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), focusedBg)
            addState(intArrayOf(android.R.attr.state_pressed), focusedBg)
            addState(intArrayOf(), normalBg)
        }
        return Button(this).apply {
            text = label
            isAllCaps = false
            setTextColor(Color.WHITE)
            textSize = 14.5f
            typeface = Typeface.DEFAULT_BOLD
            background = selector
            setPadding(dp(16), dp(10), dp(16), dp(10))
            isFocusable = true
            setOnClickListener { onClick() }
        }
    }

    private fun spaceView(widthPx: Int): View {
        return View(this).apply {
            layoutParams = LinearLayout.LayoutParams(widthPx, 1)
        }
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            if (event.keyCode == KeyEvent.KEYCODE_MENU) {
                openNativeOptionsDialog()
                return true
            }
            if (setupOverlay.visibility != View.VISIBLE && errorOverlay.visibility != View.VISIBLE) {
                when (event.keyCode) {
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                        dispatchJsMediaKey("MediaPlayPause")
                        return true
                    }
                    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                        dispatchJsMediaKey("MediaFastForward")
                        return true
                    }
                    KeyEvent.KEYCODE_MEDIA_REWIND -> {
                        dispatchJsMediaKey("MediaRewind")
                        return true
                    }
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun dispatchJsMediaKey(keyName: String) {
        val safeKey = keyName.replace("'", "")
        webView.evaluateJavascript(
            "window.dispatchEvent(new KeyboardEvent('keydown',{key:'$safeKey',bubbles:true}));",
            null
        )
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (customVideoView != null) {
            exitCustomVideoFullscreen()
            return
        }
        if (setupOverlay.visibility == View.VISIBLE) {
            if (configuredServerOrigin != null) {
                stopLanQrSetupServer()
                setupOverlay.visibility = View.GONE
                return
            }
            super.onBackPressed()
            return
        }
        if (errorOverlay.visibility == View.VISIBLE) {
            val now = System.currentTimeMillis()
            if (now - lastBackPressAt < 2000L) {
                finish()
            } else {
                lastBackPressAt = now
                Toast.makeText(this, "Zum Beenden erneut Zurück drücken", Toast.LENGTH_SHORT).show()
            }
            return
        }
        // Zuerst geöffnete In-App-Overlays (Trailer, Detailansicht, Lightbox, Sidebar) schließen
        webView.evaluateJavascript("(typeof window.handleTelePortNativeBack==='function'?window.handleTelePortNativeBack():false)") { result ->
            if (result == "true") return@evaluateJavascript
            if (webView.canGoBack()) {
                webView.goBack()
                return@evaluateJavascript
            }
            val now = System.currentTimeMillis()
            if (now - lastBackPressAt < 2000L) {
                finish()
            } else {
                lastBackPressAt = now
                Toast.makeText(this, "Zum Beenden erneut Zurück drücken", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
        stopLanQrSetupServer()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        if (setupOverlay.visibility == View.VISIBLE && lanQrSetupServer == null) {
            showServerSetupScreen(canCancel = configuredServerOrigin != null)
        }
    }

    override fun onStop() {
        super.onStop()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        stopLanQrSetupServer()
        exitCustomVideoFullscreen()
        webView.destroy()
        super.onDestroy()
    }

    inner class TelePortNativeBridge {
        @JavascriptInterface
        fun getPlatform(): String = platformName

        @JavascriptInterface
        fun getAppVersion(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun openServerSettings() {
            if (configuredServerOrigin == null || currentWebViewOrigin != configuredServerOrigin) return
            mainHandler.post { openNativeOptionsDialog() }
        }

        @JavascriptInterface
        fun openExternalUrl(rawUrl: String?) {
            if (configuredServerOrigin == null || currentWebViewOrigin != configuredServerOrigin) return
            val target = (rawUrl ?: "").trim()
            if (!target.startsWith("https://", ignoreCase = true) && !target.startsWith("tg://", ignoreCase = true)) {
                return
            }
            mainHandler.post { openSafeExternalIntent(target) }
        }
    }
}
