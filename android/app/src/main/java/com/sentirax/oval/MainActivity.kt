package com.sentirax.oval

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewConfiguration
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.view.isVisible
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.button.MaterialButton
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.google.android.material.snackbar.Snackbar

class MainActivity : AppCompatActivity() {

  companion object {
    private const val startUrl = "https://oval-nine.vercel.app/"
    private const val stateMainWebView = "state.mainWebView"
    private const val refreshTopZoneDp = 112f
    private const val refreshTriggerDistanceDp = 136
    private val internalHosts = setOf("oval-nine.vercel.app")
    private val popupTrustedHostSuffixes = listOf(
      "google.com",
      "googleusercontent.com",
      "gstatic.com",
      "firebaseapp.com",
      "web.app",
      "vercel.app",
    )
  }

  private lateinit var root: View
  private lateinit var swipeRefresh: SwipeRefreshLayout
  private lateinit var progressBar: LinearProgressIndicator
  private lateinit var mainWebView: WebView
  private lateinit var offlineContainer: View
  private lateinit var offlineMessage: TextView
  private lateinit var retryButton: MaterialButton
  private lateinit var popupContainer: View
  private lateinit var popupContent: FrameLayout
  private lateinit var popupCloseButton: ImageButton

  private var popupWebView: WebView? = null
  private var pendingFileChooser: ValueCallback<Array<Uri>>? = null
  private var refreshTouchEligible = false
  private var refreshStartX = 0f
  private var refreshStartY = 0f
  private var refreshTopZonePx = 0
  private var touchSlopPx = 0

  private val fileChooserLauncher = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult(),
  ) { result ->
    val callback = pendingFileChooser
    pendingFileChooser = null
    if (callback == null) {
      return@registerForActivityResult
    }

    val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
    callback.onReceiveValue(if (result.resultCode == Activity.RESULT_OK) uris else null)
  }

  private val backCallback = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      when {
        popupWebView?.canGoBack() == true -> popupWebView?.goBack()
        popupWebView != null -> closePopupWebView()
        mainWebView.canGoBack() -> mainWebView.goBack()
        !moveTaskToBack(true) -> finish()
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_main)
    onBackPressedDispatcher.addCallback(this, backCallback)

    root = findViewById(R.id.root)
    swipeRefresh = findViewById(R.id.swipeRefresh)
    progressBar = findViewById(R.id.progressBar)
    mainWebView = findViewById(R.id.webView)
    offlineContainer = findViewById(R.id.offlineContainer)
    offlineMessage = findViewById(R.id.offlineMessage)
    retryButton = findViewById(R.id.retryButton)
    popupContainer = findViewById(R.id.popupContainer)
    popupContent = findViewById(R.id.popupContent)
    popupCloseButton = findViewById(R.id.popupCloseButton)
    touchSlopPx = ViewConfiguration.get(this).scaledTouchSlop
    refreshTopZonePx = dpToPx(refreshTopZoneDp)

    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    configureWebView(mainWebView, isPopup = false)

    swipeRefresh.setColorSchemeResources(
      R.color.oval_accent,
      R.color.oval_accent_alt,
    )
    swipeRefresh.isEnabled = false
    swipeRefresh.setDistanceToTriggerSync(dpToPx(refreshTriggerDistanceDp.toFloat()))
    swipeRefresh.setOnChildScrollUpCallback { _, _ ->
      !refreshTouchEligible || !canUseTopRefresh()
    }
    swipeRefresh.setOnRefreshListener {
      refreshTouchEligible = false
      swipeRefresh.isEnabled = false
      currentWebView()?.reload()
    }
    swipeRefresh.setOnTouchListener { _, event ->
      handleRefreshTouch(event)
      false
    }

    retryButton.setOnClickListener {
      hideOfflineState()
      currentWebView()?.loadUrl(currentWebView()?.url ?: resolveLaunchUrl(intent))
    }
    popupCloseButton.setOnClickListener {
      closePopupWebView()
    }

    val restoredState = savedInstanceState?.getBundle(stateMainWebView)
    if (restoredState != null) {
      mainWebView.restoreState(restoredState)
    }
    if (mainWebView.url.isNullOrBlank()) {
      mainWebView.loadUrl(resolveLaunchUrl(intent))
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    val targetUrl = resolveLaunchUrl(intent)
    if (targetUrl != mainWebView.url) {
      closePopupWebView()
      mainWebView.loadUrl(targetUrl)
    }
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    val webViewState = Bundle()
    mainWebView.saveState(webViewState)
    outState.putBundle(stateMainWebView, webViewState)
  }

  override fun onDestroy() {
    pendingFileChooser?.onReceiveValue(null)
    pendingFileChooser = null
    closePopupWebView()
    destroyWebView(mainWebView)
    super.onDestroy()
  }

  private fun currentWebView(): WebView? = popupWebView ?: mainWebView

  private fun dpToPx(value: Float): Int {
    return (value * resources.displayMetrics.density).toInt()
  }

  private fun resolveLaunchUrl(intent: Intent?): String {
    val data = intent?.data ?: return startUrl
    return if (isInternalUrl(data)) data.toString() else startUrl
  }

  private fun isInternalUrl(uri: Uri): Boolean {
    return uri.scheme.equals("https", ignoreCase = true)
      && internalHosts.contains(uri.host?.lowercase())
  }

  private fun isPopupTrustedUrl(uri: Uri): Boolean {
    if (isInternalUrl(uri)) {
      return true
    }
    val host = uri.host?.lowercase() ?: return false
    return popupTrustedHostSuffixes.any { suffix ->
      host == suffix || host.endsWith(".$suffix")
    }
  }

  private fun isFeedUrl(url: String?): Boolean {
    if (url.isNullOrBlank()) {
      return false
    }
    return try {
      val uri = Uri.parse(url)
      isInternalUrl(uri) && (
        uri.path.equals("/feed.html", ignoreCase = true)
          || uri.path.equals("/", ignoreCase = true)
      )
    } catch (_: Exception) {
      false
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun configureWebView(webView: WebView, isPopup: Boolean) {
    CookieManager.getInstance().apply {
      setAcceptCookie(true)
      setAcceptThirdPartyCookies(webView, true)
    }

    webView.setBackgroundColor(getColor(R.color.oval_background))
    webView.isVerticalScrollBarEnabled = false
    webView.isHorizontalScrollBarEnabled = false
    webView.overScrollMode = View.OVER_SCROLL_NEVER
    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      cacheMode = WebSettings.LOAD_DEFAULT
      mediaPlaybackRequiresUserGesture = false
      javaScriptCanOpenWindowsAutomatically = true
      setSupportMultipleWindows(true)
      allowContentAccess = true
      allowFileAccess = true
      builtInZoomControls = false
      displayZoomControls = false
      loadWithOverviewMode = true
      useWideViewPort = true
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      userAgentString = "${userAgentString} OvalAndroid/1.0"
    }

    webView.webViewClient = OvalWebViewClient(isPopup)
    webView.webChromeClient = OvalWebChromeClient(isPopup)
    webView.setDownloadListener { url, _, _, _, _ ->
      openExternalUrl(Uri.parse(url))
    }
  }

  private fun destroyWebView(webView: WebView?) {
    if (webView == null) {
      return
    }
    webView.stopLoading()
    webView.loadUrl("about:blank")
    webView.removeAllViews()
    webView.destroy()
  }

  private fun showOfflineState(message: String) {
    offlineMessage.text = message
    offlineContainer.isVisible = true
    swipeRefresh.isRefreshing = false
    resetRefreshGesture()
    progressBar.hide()
  }

  private fun hideOfflineState() {
    offlineContainer.isVisible = false
  }

  private fun showPopupWebView(): WebView {
    closePopupWebView()

    val popup = WebView(this)
    popup.layoutParams = FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    )
    configureWebView(popup, isPopup = true)
    popupContent.addView(popup)
    popupContainer.isVisible = true
    resetRefreshGesture()
    popupWebView = popup
    return popup
  }

  private fun closePopupWebView() {
    val popup = popupWebView ?: return
    popupContent.removeView(popup)
    destroyWebView(popup)
    popupWebView = null
    popupContainer.isVisible = false
    resetRefreshGesture()
  }

  private fun canUseTopRefresh(): Boolean {
    if (popupWebView != null) {
      return false
    }
    val webView = currentWebView() ?: return false
    return webView.scrollY <= 0 && isFeedUrl(webView.url)
  }

  private fun resetRefreshGesture() {
    refreshTouchEligible = false
    if (!swipeRefresh.isRefreshing && popupWebView == null) {
      swipeRefresh.isEnabled = false
    }
  }

  private fun handleRefreshTouch(event: MotionEvent) {
    if (popupWebView != null || swipeRefresh.isRefreshing) {
      return
    }

    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        refreshStartX = event.x
        refreshStartY = event.y
        refreshTouchEligible = canUseTopRefresh() && event.y <= refreshTopZonePx
        swipeRefresh.isEnabled = refreshTouchEligible
      }

      MotionEvent.ACTION_MOVE -> {
        if (!refreshTouchEligible) {
          return
        }
        val deltaX = kotlin.math.abs(event.x - refreshStartX)
        val deltaY = event.y - refreshStartY
        if (deltaX > touchSlopPx || deltaY < -touchSlopPx || !canUseTopRefresh()) {
          resetRefreshGesture()
        }
      }

      MotionEvent.ACTION_UP,
      MotionEvent.ACTION_CANCEL,
      MotionEvent.ACTION_POINTER_DOWN -> {
        if (!swipeRefresh.isRefreshing) {
          resetRefreshGesture()
        }
      }
    }
  }

  private fun openExternalUrl(uri: Uri) {
    try {
      if (uri.scheme.equals("http", ignoreCase = true) || uri.scheme.equals("https", ignoreCase = true)) {
        CustomTabsIntent.Builder()
          .setShowTitle(true)
          .build()
          .launchUrl(this, uri)
      } else {
        startActivity(Intent(Intent.ACTION_VIEW, uri))
      }
    } catch (_: ActivityNotFoundException) {
      Snackbar.make(root, R.string.external_open_failed, Snackbar.LENGTH_SHORT).show()
    }
  }

  private fun handleSpecialScheme(uri: Uri): Boolean {
    val scheme = uri.scheme?.lowercase() ?: return false
    if (scheme == "http" || scheme == "https") {
      return false
    }

    return try {
      if (scheme == "intent") {
        val intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).apply {
          addCategory(Intent.CATEGORY_BROWSABLE)
          component = null
          selector = null
        }
        val fallbackUrl = intent.getStringExtra("browser_fallback_url")
        if (intent.resolveActivity(packageManager) != null) {
          startActivity(intent)
        } else if (!fallbackUrl.isNullOrBlank()) {
          openExternalUrl(Uri.parse(fallbackUrl))
        }
        true
      } else {
        startActivity(Intent(Intent.ACTION_VIEW, uri))
        true
      }
    } catch (_: Exception) {
      Snackbar.make(root, R.string.external_open_failed, Snackbar.LENGTH_SHORT).show()
      true
    }
  }

  private inner class OvalWebViewClient(
    private val isPopup: Boolean,
  ) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
      if (!request.isForMainFrame) {
        return false
      }

      val uri = request.url ?: return false
      if (handleSpecialScheme(uri)) {
        return true
      }

      return when {
        isInternalUrl(uri) -> false
        isPopup && isPopupTrustedUrl(uri) -> false
        else -> {
          openExternalUrl(uri)
          if (isPopup) {
            closePopupWebView()
          }
          true
        }
      }
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
      if (!isPopup) {
        hideOfflineState()
        progressBar.show()
      }
      super.onPageStarted(view, url, favicon)
    }

    override fun onPageFinished(view: WebView, url: String?) {
      if (!isPopup) {
        swipeRefresh.isRefreshing = false
        resetRefreshGesture()
        if (progressBar.progress >= 100) {
          progressBar.hide()
        }
      }

      if (isPopup && !url.isNullOrBlank()) {
        val uri = Uri.parse(url)
        if (!isPopupTrustedUrl(uri)) {
          openExternalUrl(uri)
          closePopupWebView()
          return
        }
      }

      super.onPageFinished(view, url)
    }

    override fun onReceivedError(
      view: WebView,
      request: WebResourceRequest,
      error: WebResourceError,
    ) {
      if (!request.isForMainFrame) {
        return
      }

      if (!isPopup) {
        showOfflineState(
          error.description?.toString()?.takeIf { it.isNotBlank() }
            ?: getString(R.string.offline_message),
        )
      }
      super.onReceivedError(view, request, error)
    }
  }

  private inner class OvalWebChromeClient(
    private val isPopup: Boolean,
  ) : WebChromeClient() {

    override fun onProgressChanged(view: WebView, newProgress: Int) {
      if (!isPopup) {
        progressBar.progress = newProgress
        if (newProgress >= 100) {
          progressBar.hide()
          swipeRefresh.isRefreshing = false
          resetRefreshGesture()
        } else {
          progressBar.show()
        }
      }
      super.onProgressChanged(view, newProgress)
    }

    override fun onCreateWindow(
      view: WebView,
      isDialog: Boolean,
      isUserGesture: Boolean,
      resultMsg: Message,
    ): Boolean {
      val popup = showPopupWebView()
      val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
      transport.webView = popup
      resultMsg.sendToTarget()
      return true
    }

    override fun onCloseWindow(window: WebView) {
      if (window == popupWebView) {
        closePopupWebView()
      } else {
        super.onCloseWindow(window)
      }
    }

    override fun onShowFileChooser(
      webView: WebView,
      filePathCallback: ValueCallback<Array<Uri>>,
      fileChooserParams: FileChooserParams,
    ): Boolean {
      pendingFileChooser?.onReceiveValue(null)
      pendingFileChooser = filePathCallback

      return try {
        val chooserIntent = fileChooserParams.createIntent()
        fileChooserLauncher.launch(chooserIntent)
        true
      } catch (_: ActivityNotFoundException) {
        pendingFileChooser = null
        Snackbar.make(root, R.string.file_picker_unavailable, Snackbar.LENGTH_SHORT).show()
        false
      }
    }
  }
}
