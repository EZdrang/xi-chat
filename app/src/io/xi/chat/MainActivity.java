package io.xi.chat;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends Activity {

    private static final int REQ_PICK = 4201;
    private static final int REQ_VOICE = 4202;
    private static final int REQ_REC_PERM = 4203;
    private WebView web;
    private Bridge bridge;
    private String pickId;
    private String voiceId;
    private MediaRecorder recorder;
    private File recFile;
    private String recId;
    private String pendingRecId;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF061320);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        web = new WebView(this);
        web.setBackgroundColor(0xFF061320);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) {
                    }
                    return true;
                }
                return false;
            }
        });

        bridge = new Bridge();
        web.addJavascriptInterface(bridge, "XiNative");
        web.loadUrl("file:///android_asset/index.html");

        root.addView(web);
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    public void onConfigurationChanged(Configuration cfg) {
        super.onConfigurationChanged(cfg);
        boolean dark = (cfg.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        emit("window.__xiTheme && window.__xiTheme(" + JSONObject.quote(dark ? "dark" : "light") + ");");
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
                "(function(){try{return window.__xiBack?window.__xiBack()===true:false}catch(e){return false}})()",
                value -> {
                    if (!"true".equals(value)) finish();
                });
    }

    // ------------------------------------------------------------------
    // 语音输入
    // ------------------------------------------------------------------
    void startVoice(String id) {
        voiceId = id;
        final Intent i = new Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
        i.putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, "说点什么…");
        i.putExtra(android.speech.RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            startActivityForResult(i, REQ_VOICE);
        } catch (Exception e) {
            voiceId = null;
            emit("window.__xiVoiceError(" + JSONObject.quote(id) + ","
                    + JSONObject.quote("这台设备没有语音识别服务") + ");");
        }
    }

    // ------------------------------------------------------------------
    // AI 语音：录音 → 交给转写接口
    // ------------------------------------------------------------------
    void startRecord(String id) {
        if (Build.VERSION.SDK_INT >= 23
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingRecId = id;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_REC_PERM);
            return;
        }
        doStartRecord(id);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req == REQ_REC_PERM) {
            String id = pendingRecId;
            pendingRecId = null;
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) {
                doStartRecord(id);
            } else {
                emit("window.__xiRecError(" + JSONObject.quote(id) + ","
                        + JSONObject.quote("没给录音权限") + ");");
            }
            return;
        }
        super.onRequestPermissionsResult(req, perms, res);
    }

    private void doStartRecord(String id) {
        stopRecordInternal(false);
        try {
            File dir = new File(getCacheDir(), "voice");
            if (!dir.exists()) dir.mkdirs();
            recFile = new File(dir, "v" + System.currentTimeMillis() + ".m4a");
            recorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioSamplingRate(16000);
            recorder.setAudioChannels(1);
            recorder.setAudioEncodingBitRate(32000);
            recorder.setOutputFile(recFile.getAbsolutePath());
            recorder.prepare();
            recorder.start();
            recId = id;
            emit("window.__xiRecStarted(" + JSONObject.quote(id) + ");");
        } catch (Exception e) {
            stopRecordInternal(false);
            emit("window.__xiRecError(" + JSONObject.quote(id) + ","
                    + JSONObject.quote(String.valueOf(e.getMessage())) + ");");
        }
    }

    void stopRecord() {
        String id = recId;
        File f = recFile;
        boolean ok = stopRecordInternal(true);
        if (f == null) {
            emit("window.__xiRecError(" + JSONObject.quote(id) + ","
                    + JSONObject.quote("没有录音") + ");");
            return;
        }
        if (!ok) {
            emit("window.__xiRecError(" + JSONObject.quote(id) + ","
                    + JSONObject.quote("录得太短了") + ");");
            return;
        }
        final File file = f;
        new Thread(() -> {
            try {
                byte[] b = readBytes(new FileInputStream(file));
                if (b.length < 2000) {
                    emit("window.__xiRecError(" + JSONObject.quote(id) + ","
                            + JSONObject.quote("录得太短了") + ");");
                } else {
                    emit("window.__xiRecorded(" + JSONObject.quote(id) + ","
                            + JSONObject.quote(Base64.encodeToString(b, Base64.NO_WRAP)) + ");");
                }
            } catch (Exception e) {
                emit("window.__xiRecError(" + JSONObject.quote(id) + ","
                        + JSONObject.quote(String.valueOf(e.getMessage())) + ");");
            } finally {
                file.delete();
            }
        }).start();
    }

    private boolean stopRecordInternal(boolean normal) {
        boolean ok = false;
        if (recorder != null) {
            try {
                recorder.stop();
                ok = true;
            } catch (Exception ignored) {
            }
            try {
                recorder.release();
            } catch (Exception ignored) {
            }
            recorder = null;
        }
        recId = null;
        recFile = null;
        return ok;
    }

    private void emit(final String js) {
        ui.post(() -> {
            if (web != null) web.evaluateJavascript(js, null);
        });
    }

    // ------------------------------------------------------------------
    // File picking
    // ------------------------------------------------------------------
    void pickFile(String id, String mime) {
        pickId = id;
        boolean img = mime != null && mime.startsWith("image/");
        Intent i;
        if (img) {
            // 走系统相册 / 照片选择器，而不是「文件」应用
            if (Build.VERSION.SDK_INT >= 33) {
                i = new Intent(android.provider.MediaStore.ACTION_PICK_IMAGES);
                i.setType("image/*");
            } else {
                i = new Intent(Intent.ACTION_PICK,
                        android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
                i.setType("image/*");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
        } else {
            i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(mime == null || mime.isEmpty() ? "*/*" : mime);
        }
        try {
            startActivityForResult(i, REQ_PICK);
        } catch (Exception e) {
            emit("window.__xiPickCancelled(" + JSONObject.quote(id) + ")");
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_VOICE) {
            final String id = voiceId;
            voiceId = null;
            if (res == RESULT_OK && data != null) {
                ArrayList<String> list = data.getStringArrayListExtra(
                        android.speech.RecognizerIntent.EXTRA_RESULTS);
                if (list != null && !list.isEmpty()) {
                    emit("window.__xiVoice(" + JSONObject.quote(id) + ","
                            + JSONObject.quote(list.get(0)) + ");");
                    return;
                }
            }
            emit("window.__xiVoiceCancel(" + JSONObject.quote(id) + ");");
            return;
        }
        if (req != REQ_PICK) {
            super.onActivityResult(req, res, data);
            return;
        }
        final String id = pickId;
        pickId = null;
        if (res != RESULT_OK || data == null) {
            emit("window.__xiPickCancelled(" + JSONObject.quote(id) + ")");
            return;
        }
        final Uri uri = data.getData() != null
                ? data.getData()
                : (data.getClipData() != null && data.getClipData().getItemCount() > 0
                    ? data.getClipData().getItemAt(0).getUri() : null);
        if (uri == null) {
            emit("window.__xiPickCancelled(" + JSONObject.quote(id) + ")");
            return;
        }
        final String name = withExt(queryName(uri), getContentResolver().getType(uri));
        new Thread(() -> {
            try {
                byte[] bytes = readBytes(getContentResolver().openInputStream(uri));
                String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                emit("window.__xiPicked(" + JSONObject.quote(id) + "," + JSONObject.quote(name)
                        + "," + JSONObject.quote(b64) + ");");
            } catch (Exception e) {
                emit("window.__xiPickError(" + JSONObject.quote(id) + ","
                        + JSONObject.quote(String.valueOf(e.getMessage())) + ");");
            }
        }).start();
    }

    private static String extOf(String mime) {
        if (mime == null) return "";
        if (mime.startsWith("image/")) {
            String s = mime.substring(6).toLowerCase();
            if (s.equals("jpeg")) return "jpg";
            if (s.equals("svg+xml")) return "svg";
            return s;
        }
        if ("application/pdf".equals(mime)) return "pdf";
        if (mime.startsWith("text/")) return "txt";
        return "";
    }

    /** 相册返回的名字经常没有扩展名，补一个，否则前端会当二进制附件 */
    private static String withExt(String name, String mime) {
        if (name == null) name = "file";
        if (name.indexOf('.') >= 0) return name;
        String ext = extOf(mime);
        return ext.isEmpty() ? name : name + "." + ext;
    }

    private String queryName(Uri uri) {
        String name = uri.getLastPathSegment();
        try (android.database.Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) name = c.getString(idx);
            }
        } catch (Exception ignored) {
        }
        return name == null ? "file" : name;
    }

    private static byte[] readBytes(InputStream in) throws IOException {
        if (in == null) return new byte[0];
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return bo.toByteArray();
    }

    // ------------------------------------------------------------------
    // JS bridge
    // ------------------------------------------------------------------
    class Bridge {
        private final ConcurrentHashMap<String, HttpURLConnection> conns = new ConcurrentHashMap<>();

        @JavascriptInterface
        public String env() {
            JSONObject o = new JSONObject();
            try {
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("pkg", getPackageName());
                o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        @JavascriptInterface
        public String theme() {
            int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            return mode == Configuration.UI_MODE_NIGHT_YES ? "dark" : "light";
        }

        @JavascriptInterface
        public void http(final String id, final String url, final String headersJson,
                         final String body, final boolean stream) {
            if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
                emitErr(id, -1, "URL 必须是 http(s) 开头：" + url);
                return;
            }
            new Thread(() -> doHttp(id, url, headersJson, body, stream)).start();
        }

        private void doHttp(String id, String url, String headersJson, String body, boolean stream) {
            HttpURLConnection c = null;
            try {
                URL u = new URL(url);
                c = (HttpURLConnection) u.openConnection();
                c.setConnectTimeout(30000);
                c.setReadTimeout(300000);
                c.setRequestProperty("Accept-Encoding", "identity");
                if (headersJson != null && headersJson.length() > 2) {
                    JSONObject h = new JSONObject(headersJson);
                    Iterator<String> it = h.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        String v = h.optString(k, "");
                        if (v != null && v.length() > 0) c.setRequestProperty(k, v);
                    }
                }
                if (body == null || body.isEmpty()) {
                    c.setRequestMethod("GET");
                } else {
                    c.setRequestMethod("POST");
                    c.setDoOutput(true);
                    byte[] b = body.getBytes(StandardCharsets.UTF_8);
                    c.setFixedLengthStreamingMode(b.length);
                    OutputStream os = c.getOutputStream();
                    os.write(b);
                    os.flush();
                    os.close();
                }
                conns.put(id, c);
                int code = c.getResponseCode();
                if (code >= 400) {
                    String err = readText(c.getErrorStream());
                    emitErr(id, code, err);
                    return;
                }
                String ct = c.getContentType();
                boolean sse = ct != null && ct.toLowerCase().contains("text/event-stream");
                if (stream && sse) {
                    BufferedReader br = new BufferedReader(
                            new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
                    String line;
                    while ((line = br.readLine()) != null) {
                        if (!conns.containsKey(id)) break; // aborted
                        if (line.startsWith("data:")) {
                            String d = line.substring(5).trim();
                            if (!d.isEmpty()) emitChunk(id, d);
                        }
                    }
                    br.close();
                    emitDone(id);
                } else {
                    String all = readText(c.getInputStream());
                    emitChunk(id, all);
                    emitDone(id);
                }
            } catch (Exception e) {
                if (conns.containsKey(id)) {
                    emitErr(id, -2, String.valueOf(e.getMessage()));
                }
            } finally {
                conns.remove(id);
                if (c != null) {
                    try {
                        c.disconnect();
                    } catch (Exception ignored) {
                    }
                }
            }
        }

        @JavascriptInterface
        public void abort(String id) {
            HttpURLConnection c = conns.remove(id);
            if (c != null) {
                try {
                    c.disconnect();
                } catch (Exception ignored) {
                }
            }
            emit("window.__xiNet(" + JSONObject.quote(id) + ",{\"t\":\"a\"});");
        }

        private void emitChunk(String id, String d) {
            JSONObject o = new JSONObject();
            try {
                o.put("t", "c");
                o.put("d", d);
            } catch (Exception ignored) {
            }
            emit("window.__xiNet(" + JSONObject.quote(id) + "," + o + ");");
        }

        private void emitDone(String id) {
            emit("window.__xiNet(" + JSONObject.quote(id) + ",{\"t\":\"d\"});");
        }

        private void emitErr(String id, int code, String msg) {
            JSONObject o = new JSONObject();
            try {
                o.put("t", "e");
                o.put("code", code);
                o.put("m", msg == null ? "" : msg);
            } catch (Exception ignored) {
            }
            emit("window.__xiNet(" + JSONObject.quote(id) + "," + o + ");");
        }

        @JavascriptInterface
        public void saveDownload(String id, String name, String b64) {
            new Thread(() -> {
                try {
                    String path = writeDownload(name, b64);
                    emit("window.__xiSaved(" + JSONObject.quote(id) + ","
                            + JSONObject.quote(path) + ");");
                } catch (Exception e) {
                    emit("window.__xiSaveError(" + JSONObject.quote(id) + ","
                            + JSONObject.quote(String.valueOf(e.getMessage())) + ");");
                }
            }).start();
        }

        @JavascriptInterface
        public void pickFileBridge(String id, String mime) {
            MainActivity.this.pickFile(id, mime);
        }

        @JavascriptInterface
        public void voiceBridge(String id) {
            ui.post(() -> MainActivity.this.startVoice(id));
        }

        @JavascriptInterface
        public void startRecordBridge(String id) {
            ui.post(() -> MainActivity.this.startRecord(id));
        }

        @JavascriptInterface
        public void stopRecordBridge() {
            ui.post(() -> MainActivity.this.stopRecord());
        }

        @JavascriptInterface
        public void transcribe(String id, String url, String apiKey, String model,
                               String b64, String ext) {
            new Thread(() -> doTranscribe(id, url, apiKey, model, b64, ext)).start();
        }

        /** 抓二进制（图片）并以 base64 回给 JS —— 文本桥会把字节弄坏 */
        @JavascriptInterface
        public void fetchBase64(String id, String url, String headersJson) {
            new Thread(() -> {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(30000);
                    c.setReadTimeout(180000);
                    c.setRequestProperty("Accept-Encoding", "identity");
                    if (headersJson != null && headersJson.length() > 2) {
                        JSONObject h = new JSONObject(headersJson);
                        Iterator<String> it = h.keys();
                        while (it.hasNext()) {
                            String k = it.next();
                            String v = h.optString(k, "");
                            if (v != null && v.length() > 0) c.setRequestProperty(k, v);
                        }
                    }
                    int code = c.getResponseCode();
                    if (code >= 400) {
                        emit("window.__xiFetchError(" + JSONObject.quote(id) + ","
                                + JSONObject.quote("HTTP " + code) + ");");
                        return;
                    }
                    byte[] b = readBytes(c.getInputStream());
                    emit("window.__xiFetched(" + JSONObject.quote(id) + ","
                            + JSONObject.quote(Base64.encodeToString(b, Base64.NO_WRAP)) + ");");
                } catch (Exception e) {
                    emit("window.__xiFetchError(" + JSONObject.quote(id) + ","
                            + JSONObject.quote(String.valueOf(e.getMessage())) + ");");
                } finally {
                    if (c != null) {
                        try {
                            c.disconnect();
                        } catch (Exception ignored) {
                        }
                    }
                }
            }).start();
        }

        private void doTranscribe(String id, String url, String apiKey, String model,
                                  String b64, String ext) {
            HttpURLConnection c = null;
            try {
                byte[] audio = Base64.decode(b64, Base64.NO_WRAP);
                String boundary = "xi" + System.currentTimeMillis();
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                String head = "--" + boundary + "\r\n"
                        + "Content-Disposition: form-data; name=\"model\"\r\n\r\n" + model + "\r\n"
                        + "--" + boundary + "\r\n"
                        + "Content-Disposition: form-data; name=\"file\"; filename=\"v." + ext + "\"\r\n"
                        + "Content-Type: audio/" + ("m4a".equals(ext) ? "mp4" : ext) + "\r\n\r\n";
                bo.write(head.getBytes(StandardCharsets.UTF_8));
                bo.write(audio);
                bo.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
                byte[] payload = bo.toByteArray();

                c = (HttpURLConnection) new URL(url).openConnection();
                c.setDoOutput(true);
                c.setRequestMethod("POST");
                c.setConnectTimeout(20000);
                c.setReadTimeout(180000);
                c.setFixedLengthStreamingMode(payload.length);
                c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                if (apiKey != null && apiKey.length() > 0) {
                    c.setRequestProperty("Authorization", "Bearer " + apiKey);
                }
                OutputStream os = c.getOutputStream();
                os.write(payload);
                os.flush();
                os.close();

                int code = c.getResponseCode();
                String all = readText(code >= 400 ? c.getErrorStream() : c.getInputStream());
                if (code >= 400) {
                    String brief = all == null ? "" : (all.length() > 300 ? all.substring(0, 300) : all);
                    emit("window.__xiTranscribeError(" + JSONObject.quote(id) + ","
                            + JSONObject.quote(brief) + ");");
                    return;
                }
                String text = "";
                try {
                    text = new JSONObject(all).optString("text", "");
                } catch (Exception ignored) {
                }
                emit("window.__xiTranscribed(" + JSONObject.quote(id) + ","
                        + JSONObject.quote(text) + ");");
            } catch (Exception e) {
                emit("window.__xiTranscribeError(" + JSONObject.quote(id) + ","
                        + JSONObject.quote(String.valueOf(e.getMessage())) + ");");
            } finally {
                if (c != null) {
                    try {
                        c.disconnect();
                    } catch (Exception ignored) {
                    }
                }
            }
        }

        @JavascriptInterface
        public void toast(String s) {
            ui.post(() -> Toast.makeText(MainActivity.this, s, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void copyText(String s) {
            ui.post(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("汐", s));
                Toast.makeText(MainActivity.this, "已复制", Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void shareText(String s) {
            ui.post(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, s);
                startActivity(Intent.createChooser(i, "分享"));
            });
        }

        @JavascriptInterface
        public void setBackHandler(boolean on) {
            // reserved
        }
    }

    private String writeDownload(String name, String b64) throws IOException {
        byte[] data = Base64.decode(b64, Base64.NO_WRAP);
        String mime = "application/octet-stream";
        String lower = name.toLowerCase();
        if (lower.endsWith(".zip")) mime = "application/zip";
        else if (lower.endsWith(".json")) mime = "application/json";
        else if (lower.endsWith(".md")) mime = "text/markdown";
        else if (lower.endsWith(".txt")) mime = "text/plain";

        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, name);
            v.put(MediaStore.Downloads.MIME_TYPE, mime);
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/汐");
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("无法创建文件");
            OutputStream os = getContentResolver().openOutputStream(uri);
            if (os == null) throw new IOException("无法写入文件");
            os.write(data);
            os.close();
            return "Download/汐/" + name;
        } else {
            File dir = new File(getExternalFilesDir(null), "export");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建目录");
            File f = new File(dir, name);
            FileOutputStream fo = new FileOutputStream(f);
            fo.write(data);
            fo.close();
            return f.getAbsolutePath();
        }
    }

    private static String readText(InputStream in) throws IOException {
        if (in == null) return "";
        BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        char[] buf = new char[8192];
        int n;
        while ((n = br.read(buf)) > 0) sb.append(buf, 0, n);
        br.close();
        return sb.toString();
    }
}
