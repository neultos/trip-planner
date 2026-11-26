package io.github.neultos.wetrip;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.webkit.*;
import android.widget.*;

/** 위트립 웹앱을 그대로 띄우는 테스트용 껍데기. 화면은 전부 웹(GitHub Pages)에서 옴. */
public final class MainActivity extends Activity {
    static final String HOME = "https://neultos.github.io/trip-planner/";
    private static final int PICK_FILE = 41;
    private WebView web;
    private FrameLayout root;
    private View errorView;
    private ValueCallback<Uri[]> fileCallback;
    private long exitAt = -1;
    private android.window.OnBackInvokedCallback backCallback;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        root.setFitsSystemWindows(true);
        setContentView(root);
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " WeTripAndroid/0.1");
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false); // target=_blank 은 아래 route()에서 바깥 브라우저로
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return r.isForMainFrame() && route(r.getUrl().toString());
            }
            @Override public void onPageFinished(WebView v, String url) { syncTrips(); }
            @Override public void doUpdateVisitedHistory(WebView v, String url, boolean reload) { exitAt = -1; }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) showError();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try { startActivityForResult(p.createIntent(), PICK_FILE); }
                catch (ActivityNotFoundException e) { fileCallback = null; return false; }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disp, mime, len) -> openExternal(url));

        if (state == null || web.restoreState(state) == null) web.loadUrl(targetOf(getIntent()));
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::back;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    /** 위젯에서 열면 그 여행 주소, 아니면 첫 화면 */
    static String targetOf(Intent i) {
        String id = i == null ? null : i.getStringExtra("trip");
        return id != null && TripStore.ID.matcher(id).matches() ? HOME + "#t=" + id : HOME;
    }

    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        if (i.hasExtra("trip")) web.loadUrl(targetOf(i));
    }

    /** 위트립·로그인 서버·카카오 로그인 화면은 앱 안에서, 나머지 링크는 바깥 브라우저로 */
    private boolean route(String url) {
        Uri u = Uri.parse(url);
        String scheme = u.getScheme(), host = u.getHost() == null ? "" : u.getHost();
        if ("intent".equals(scheme)) { // 카카오톡 앱 로그인 대신 같은 화면의 웹 로그인으로
            try {
                String fb = Intent.parseUri(url, Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url");
                if (fb != null && fb.startsWith("https://")) web.loadUrl(fb);
            } catch (Exception ignored) {}
            return true;
        }
        if (!"https".equals(scheme)) { openExternal(url); return true; }
        if (host.equals("neultos.github.io") && u.getPath() != null && u.getPath().startsWith("/trip-planner")) return false;
        if (host.equals("wetrip-aut.neulto95.workers.dev") || host.equals("kakao.com") || host.endsWith(".kakao.com")) return false;
        if (host.equals("accounts.google.com")) { // 구글은 앱 안(웹뷰) 로그인을 막음
            Toast.makeText(this, "앱에서는 구글 로그인이 안 돼요. 카카오로 로그인해 주세요", Toast.LENGTH_LONG).show();
            return true;
        }
        if (host.endsWith(".firebaseapp.com")) return false; // 파이어베이스 로그인 중간 화면
        openExternal(url);
        return true;
    }

    private void openExternal(String url) {
        Uri u = Uri.parse(url);
        String sc = u.getScheme();
        if (!"https".equals(sc) && !"http".equals(sc) && !"tel".equals(sc) && !"mailto".equals(sc)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "열 수 있는 앱이 없어요", Toast.LENGTH_SHORT).show(); }
    }

    /** 웹이 기기에 저장한 여행 목록(localStorage 'trips')을 위젯용으로 복사 */
    private void syncTrips() {
        if (web == null || web.getUrl() == null || !web.getUrl().startsWith(HOME)) return;
        web.evaluateJavascript("(function(){try{return localStorage.getItem('trips')}catch(e){return null}})()", v -> {
            if (TripStore.saveFromJs(this, v)) TripWidget.updateAll(this);
        });
    }

    // 홈에서는 웹의 '한 번 더 누르면 나가요'를 따르고, 두 번째에 앱을 닫음
    private static final String BACK_JS = "(function(){var b=document.body,s=document.getElementById('searchView');"
        + "if(!b||!b.classList.contains('at-home')||location.hash.slice(1)||document.querySelector('dialog[open]')||(s&&s.classList.contains('on')))return 'other';"
        + "return history.state&&history.state.homeGuard?'guard':(history.state?'other':'ready')})()";

    private void back() {
        if (errorView != null) { finish(); return; }
        web.evaluateJavascript(BACK_JS, v -> {
            String st = v == null ? "" : v.replace("\"", "");
            if (st.equals("guard")) { exitAt = SystemClock.elapsedRealtime(); web.goBack(); } // 웹이 안내를 띄움
            else if (st.equals("other") && web.canGoBack()) web.goBack();
            else {
                long now = SystemClock.elapsedRealtime();
                if (exitAt >= 0 && now - exitAt < 2500) { finish(); return; }
                exitAt = now;
                Toast.makeText(this, "한 번 더 누르면 나가요", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { back(); }

    private void showError() {
        if (errorView != null) return;
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.WHITE);
        TextView t = new TextView(this);
        t.setText("인터넷 연결을 확인해 주세요");
        t.setTextSize(17);
        t.setTextColor(Color.rgb(17, 24, 39));
        t.setGravity(Gravity.CENTER);
        box.addView(t);
        Button b = new Button(this);
        b.setText("다시 연결");
        box.addView(b);
        root.addView(box, new FrameLayout.LayoutParams(-1, -1));
        errorView = box;
        b.setOnClickListener(x -> { root.removeView(box); errorView = null; web.reload(); });
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != PICK_FILE || fileCallback == null) return;
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
        fileCallback = null;
    }

    @Override protected void onSaveInstanceState(Bundle out) { web.saveState(out); super.onSaveInstanceState(out); }
    @Override protected void onPause() { syncTrips(); web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        root.removeView(web);
        web.destroy();
        super.onDestroy();
    }
}
