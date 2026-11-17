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
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
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
    private static final int REQ_PICK_IMAGES = 4204;
    private static final int REQ_PICK_ATTACH = 4205;

    /** 超过这个大小就不把内容过桥，只带文件名（否则 base64 会把 WebView 撑爆） */
    private static final int MAX_BRIDGE_BYTES = 3 * 1024 * 1024;
    private static final int MAX_ATTACH_BYTES = 25 * 1024 * 1024;
    private static final int CHUNK = 192 * 1024;
    private static final int MAX_IMG_SIDE = 1280;
    private static final int MAX_PICK_IMAGES = 20;
    private WebView web;
    private Bridge bridge;
    private String pickId;
    private String voiceId;
    private android.media.AudioRecord audioRec;
    private Thread recThread;
    private volatile boolean recording;
    private File recFile;
    private String recId;
    private String pendingRecId;
    private String pickMode;

    private long stepBase = -1;
    private long stepNow = -1;
    private String stepDay = "";
    private Db dbHelper;
    private android.database.sqlite.SQLiteDatabase dbCache;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        initSteps();

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
        if (web != null) {
            web.onResume();
            emit("window.__xiResume && window.__xiResume();");
        }
    }

    @Override
    protected void onPause() {
        // 不要调用 web.onPause()：那会暂停 WebView 的 JS 定时器，
        // 切到后台时正在流式回复的消息会直接卡死。
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
            final File out = new File(dir, "v" + System.currentTimeMillis() + ".wav");
            recFile = out;

            final int rate = 16000;
            int minBuf = android.media.AudioRecord.getMinBufferSize(rate,
                    android.media.AudioFormat.CHANNEL_IN_MONO,
                    android.media.AudioFormat.ENCODING_PCM_16BIT);
            audioRec = new android.media.AudioRecord(android.media.MediaRecorder.AudioSource.MIC,
                    rate, android.media.AudioFormat.CHANNEL_IN_MONO,
                    android.media.AudioFormat.ENCODING_PCM_16BIT, Math.max(minBuf, 8192));
            audioRec.startRecording();
            recording = true;
            recId = id;

            recThread = new Thread(() -> {
                byte[] buf = new byte[4096];
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                while (recording) {
                    int n = audioRec == null ? -1 : audioRec.read(buf, 0, buf.length);
                    if (n > 0) bos.write(buf, 0, n);
                }
                try {
                    writeWav(out, bos.toByteArray(), rate, 1, 16);
                } catch (Exception ignored) {
                }
            });
            recThread.start();
            emit("window.__xiRecStarted(" + JSONObject.quote(id) + ");");
        } catch (Exception e) {
            stopRecordInternal(false);
            emit("window.__xiRecError(" + JSONObject.quote(id) + ","
                    + JSONObject.quote(String.valueOf(e.getMessage())) + ");");
        }
    }

    /** 写一个标准的 16 位 PCM WAV，DeepSeek 的 ASR 只吃这个格式 */
    private static void writeWav(File f, byte[] pcm, int rate, int channels, int bits) throws Exception {
        int dataLen = pcm.length;
        int byteRate = rate * channels * bits / 8;
        int blockAlign = channels * bits / 8;
        ByteArrayOutputStream h = new ByteArrayOutputStream();
        h.write("RIFF".getBytes("US-ASCII"));
        h.write(intLE(36 + dataLen));
        h.write("WAVE".getBytes("US-ASCII"));
        h.write("fmt ".getBytes("US-ASCII"));
        h.write(intLE(16));
        h.write(shortLE((short) 1));
        h.write(shortLE((short) channels));
        h.write(intLE(rate));
        h.write(intLE(byteRate));
        h.write(shortLE((short) blockAlign));
        h.write(shortLE((short) bits));
        h.write("data".getBytes("US-ASCII"));
        h.write(intLE(dataLen));
        FileOutputStream fo = new FileOutputStream(f);
        fo.write(h.toByteArray());
        fo.write(pcm);
        fo.close();
    }

    private static byte[] intLE(int v) {
        return new byte[]{(byte) (v & 0xff), (byte) ((v >> 8) & 0xff),
                (byte) ((v >> 16) & 0xff), (byte) ((v >> 24) & 0xff)};
    }

    private static byte[] shortLE(short v) {
        return new byte[]{(byte) (v & 0xff), (byte) ((v >> 8) & 0xff)};
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
        recording = false;
        boolean ok = false;
        if (audioRec != null) {
            try {
                audioRec.stop();
                ok = true;
            } catch (Exception ignored) {
            }
            try {
                audioRec.release();
            } catch (Exception ignored) {
            }
            audioRec = null;
        }
        if (recThread != null) {
            try {
                recThread.join(1500);
            } catch (Exception ignored) {
            }
            recThread = null;
        }
        if (recId != null && recFile != null && normal) ok = true;
        recId = null;
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
    private String imageB64(Uri uri) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        java.io.InputStream in0 = getContentResolver().openInputStream(uri);
        BitmapFactory.decodeStream(in0, null, bounds);
        if (in0 != null) in0.close();
        int w = bounds.outWidth, h = bounds.outHeight;
        if (w <= 0 || h <= 0) throw new java.io.IOException("不是有效图片");

        int sample = 1;
        while (Math.max(w, h) / sample > MAX_IMG_SIDE * 2) sample *= 2;

        BitmapFactory.Options opt = new BitmapFactory.Options();
        opt.inSampleSize = sample;
        java.io.InputStream in1 = getContentResolver().openInputStream(uri);
        Bitmap bmp = BitmapFactory.decodeStream(in1, null, opt);
        if (in1 != null) in1.close();
        if (bmp == null) throw new java.io.IOException("解码失败");

        int mw = bmp.getWidth(), mh = bmp.getHeight();
        float s = Math.min(1f, MAX_IMG_SIDE / (float) Math.max(mw, mh));
        if (s < 1f) {
            Bitmap scaled = Bitmap.createScaledBitmap(bmp, Math.round(mw * s), Math.round(mh * s), true);
            if (scaled != bmp) bmp.recycle();
            bmp = scaled;
        }
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, 82, bo);
        bmp.recycle();
        return Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
    }

    /** 分块过桥：一次性把大文件塞进 evaluateJavascript 会把 WebView 撑爆 */
    private void emitFileChunkedB64(String id, String name, String mime, String b64, int size) {
        int total = (b64.length() + CHUNK - 1) / CHUNK;
        if (total <= 0) total = 1;
        emit("window.__xiFileStart(" + JSONObject.quote(id) + "," + JSONObject.quote(name) + ","
                + JSONObject.quote(mime) + "," + total + "," + size + ");");
        for (int i = 0; i < total; i++) {
            int s = i * CHUNK;
            int e = Math.min(b64.length(), s + CHUNK);
            emit("window.__xiFileChunk(" + JSONObject.quote(id) + "," + i + ","
                    + JSONObject.quote(b64.substring(s, e)) + ");");
        }
        emit("window.__xiFileEnd(" + JSONObject.quote(id) + ");");
    }

    private void emitFileChunked(String id, String name, String mime, byte[] bytes) {
        emitFileChunkedB64(id, name, mime, Base64.encodeToString(bytes, Base64.NO_WRAP), bytes.length);
    }

    private void emitFileMeta(String id, String name, long size) {
        emit("window.__xiFileMeta(" + JSONObject.quote(id) + "," + JSONObject.quote(name)
                + "," + size + ");");
    }

    /** 聊天附件：图片可多选，文件单个；mode=original 时图片不压缩 */
    void pickAttach(String id, String kind, String mode) {
        pickId = id;
        pickMode = mode;
        Intent i;
        if ("image".equals(kind)) {
            if (Build.VERSION.SDK_INT >= 33) {
                i = new Intent(android.provider.MediaStore.ACTION_PICK_IMAGES);
                i.setType("image/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                i.putExtra(android.provider.MediaStore.EXTRA_PICK_IMAGES_MAX, MAX_PICK_IMAGES);
            } else {
                i = new Intent(Intent.ACTION_GET_CONTENT);
                i.setType("image/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            try {
                startActivityForResult(i, REQ_PICK_IMAGES);
            } catch (Exception e) {
                emit("window.__xiPickCancelled(" + JSONObject.quote(id) + ")");
            }
            return;
        }
        i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        try {
            startActivityForResult(i, REQ_PICK_ATTACH);
        } catch (Exception e) {
            emit("window.__xiPickCancelled(" + JSONObject.quote(id) + ")");
        }
    }

    private void handleImagesResult(String iid, int res, Intent data) {
        if (res != RESULT_OK || data == null) {
            emit("window.__xiPickCancelled(" + JSONObject.quote(iid) + ")");
            return;
        }
        final ArrayList<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            int n = Math.min(data.getClipData().getItemCount(), MAX_PICK_IMAGES);
            for (int k = 0; k < n; k++) uris.add(data.getClipData().getItemAt(k).getUri());
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        if (uris.isEmpty()) {
            emit("window.__xiPickCancelled(" + JSONObject.quote(iid) + ")");
            return;
        }
        final boolean compact = "compact".equals(pickMode);
        new Thread(() -> {
            for (int i = 0; i < uris.size(); i++) {
                Uri u = uris.get(i);
                String subId = iid + "#" + i;
                String nm = withExt(queryName(u), getContentResolver().getType(u));
                try {
                    if (compact) {
                        String b64 = imageB64(u);
                        emitFileChunkedB64(subId, nm, "image/jpeg", b64, b64.length());
                    } else {
                        byte[] bytes = readBytes(getContentResolver().openInputStream(u));
                        if (bytes.length > MAX_ATTACH_BYTES) {
                            emitFileMeta(subId, nm, bytes.length);
                        } else {
                            String mime = getContentResolver().getType(u);
                            emitFileChunked(subId, nm,
                                    mime == null ? "image/jpeg" : mime, bytes);
                        }
                    }
                } catch (Exception e) {
                    emit("window.__xiPickError(" + JSONObject.quote(subId) + ","
                            + JSONObject.quote(String.valueOf(e.getMessage())) + ");");
                }
            }
        }).start();
    }

    private void handleAttachResult(String aid, int res, Intent data) {
        if (res != RESULT_OK || data == null || data.getData() == null) {
            emit("window.__xiPickCancelled(" + JSONObject.quote(aid) + ")");
            return;
        }
        final Uri u = data.getData();
        final String nm = withExt(queryName(u), getContentResolver().getType(u));
        new Thread(() -> {
            try {
                byte[] bytes = readBytes(getContentResolver().openInputStream(u));
                if (bytes.length > MAX_ATTACH_BYTES) {
                    emitFileMeta(aid, nm, bytes.length);
                    return;
                }
                String mime = getContentResolver().getType(u);
                emitFileChunked(aid, nm, mime == null ? "application/octet-stream" : mime, bytes);
            } catch (Exception e) {
                emit("window.__xiPickError(" + JSONObject.quote(aid) + ","
                        + JSONObject.quote(String.valueOf(e.getMessage())) + ");");
            }
        }).start();
    }

    /** 步数传感器计的是开机以来的总数，自己维护一个当日基线 */
    private void initSteps() {
        try {
            SensorManager sm = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
            Sensor st = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
            if (st == null) return;
            sm.registerListener(new SensorEventListener() {
                @Override
                public void onSensorChanged(SensorEvent e) {
                    long v = (long) e.values[0];
                    String today = new java.text.SimpleDateFormat("yyyyMMdd", java.util.Locale.US)
                            .format(new java.util.Date());
                    android.content.SharedPreferences sp = getSharedPreferences("xi", MODE_PRIVATE);
                    long base = sp.getLong("stepBase", -1);
                    String day = sp.getString("stepDay", "");
                    if (base < 0 || !today.equals(day) || v < base) {
                        base = v;
                        sp.edit().putLong("stepBase", base).putString("stepDay", today).apply();
                    }
                    stepBase = base;
                    stepNow = v;
                    stepDay = today;
                }

                @Override
                public void onAccuracyChanged(Sensor s, int a) { }
            }, st, SensorManager.SENSOR_DELAY_NORMAL);
        } catch (Exception ignored) {
        }
    }

    /** 今天屏幕亮了多久（分钟）。没有使用情况访问权限时会返回 -2 */
    private long screenMinutesToday() {
        try {
            android.app.usage.UsageStatsManager usm = (android.app.usage.UsageStatsManager)
                    getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return -1;
            java.util.Calendar c = java.util.Calendar.getInstance();
            c.set(java.util.Calendar.HOUR_OF_DAY, 0);
            c.set(java.util.Calendar.MINUTE, 0);
            c.set(java.util.Calendar.SECOND, 0);
            c.set(java.util.Calendar.MILLISECOND, 0);
            java.util.List<android.app.usage.UsageStats> list = usm.queryUsageStats(
                    android.app.usage.UsageStatsManager.INTERVAL_DAILY,
                    c.getTimeInMillis(), System.currentTimeMillis());
            if (list == null || list.isEmpty()) return -2;
            long total = 0;
            for (android.app.usage.UsageStats u : list) total += u.getTotalTimeInForeground();
            return total / 60000;
        } catch (Exception e) {
            return -1;
        }
    }

    /** 记忆库的 SQLite：页面 + 时间线 + 全文索引 */
    private android.database.sqlite.SQLiteDatabase db() {
        if (dbCache != null && dbCache.isOpen()) return dbCache;
        if (dbHelper == null) dbHelper = new Db(this);
        dbCache = dbHelper.getWritableDatabase();
        return dbCache;
    }

    private static String[] strArgs(org.json.JSONArray arr) {
        String[] out = new String[arr == null ? 0 : arr.length()];
        for (int i = 0; i < out.length; i++) out[i] = arr.optString(i, "");
        return out;
    }

    private static class Db extends android.database.sqlite.SQLiteOpenHelper {
        Db(Context c) { super(c, "xi.db", null, 1); }

        @Override
        public void onCreate(android.database.sqlite.SQLiteDatabase d) {
            d.execSQL("CREATE TABLE pages(path TEXT PRIMARY KEY, title TEXT, type TEXT, " +
                    "salience INTEGER, summary TEXT, body TEXT, triggers TEXT, updated_at INTEGER)");
            d.execSQL("CREATE TABLE logs(ts TEXT, kind TEXT, title TEXT)");
            d.execSQL("CREATE TABLE sessions(id TEXT PRIMARY KEY, title TEXT, created_at INTEGER, " +
                    "updated_at INTEGER, count INTEGER, data TEXT)");
            d.execSQL("CREATE VIRTUAL TABLE pages_fts USING fts4(path, title, body)");
            d.execSQL("CREATE TABLE IF NOT EXISTS state(k TEXT PRIMARY KEY, v TEXT, updated_at INTEGER)");
            d.execSQL("CREATE TABLE IF NOT EXISTS recall(path TEXT PRIMARY KEY, ts INTEGER, n INTEGER)");
            d.execSQL("CREATE TABLE IF NOT EXISTS prefs(tag TEXT PRIMARY KEY, score REAL, last_ts INTEGER)");
            d.execSQL("CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, what TEXT, why TEXT, how TEXT, tags TEXT)");
            d.execSQL("CREATE TABLE IF NOT EXISTS habits(k TEXT PRIMARY KEY, n INTEGER, last_ts INTEGER)");
        }

        @Override
        public void onUpgrade(android.database.sqlite.SQLiteDatabase d, int o, int n) { }
    }

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
        if (req == REQ_PICK_IMAGES) {
            String iid = pickId;
            pickId = null;
            handleImagesResult(iid, res, data);
            return;
        }
        if (req == REQ_PICK_ATTACH) {
            String aid = pickId;
            pickId = null;
            handleAttachResult(aid, res, data);
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
                if (bytes.length > MAX_BRIDGE_BYTES) {
                    // 太大就不过桥，只告诉前端文件名和大小，避免 WebView 被 base64 撑爆
                    emit("window.__xiPickedMeta(" + JSONObject.quote(id) + "," + JSONObject.quote(name)
                            + "," + bytes.length + ");");
                    return;
                }
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
                o.put("now", System.currentTimeMillis());
                o.put("tz", java.util.TimeZone.getDefault().getID());

                android.os.BatteryManager bm = (android.os.BatteryManager)
                        getSystemService(android.content.Context.BATTERY_SERVICE);
                if (bm != null) {
                    int pct = bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY);
                    if (pct >= 0) o.put("battery", pct);
                    int st = bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_STATUS);
                    o.put("charging", st == android.os.BatteryManager.BATTERY_STATUS_CHARGING
                            || st == android.os.BatteryManager.BATTERY_STATUS_FULL);
                }

                android.net.ConnectivityManager cm = (android.net.ConnectivityManager)
                        getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
                android.net.NetworkInfo ni = cm == null ? null : cm.getActiveNetworkInfo();
                if (ni != null && ni.isConnected()) {
                    o.put("net", ni.getType() == android.net.ConnectivityManager.TYPE_WIFI ? "wifi" : "cellular");
                } else {
                    o.put("net", "offline");
                }

                // 位置：只在授权后读，拿粗定位够用
                if (checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                        == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    android.location.LocationManager lm = (android.location.LocationManager)
                            getSystemService(android.content.Context.LOCATION_SERVICE);
                    android.location.Location last = null;
                    try {
                        last = lm.getLastKnownLocation(android.location.LocationManager.NETWORK_PROVIDER);
                    } catch (Exception ignored) {
                    }
                    if (last == null) {
                        try {
                            last = lm.getLastKnownLocation(android.location.LocationManager.GPS_PROVIDER);
                        } catch (Exception ignored) {
                        }
                    }
                    if (last != null) {
                        o.put("lat", Math.round(last.getLatitude() * 1000) / 1000.0);
                        o.put("lon", Math.round(last.getLongitude() * 1000) / 1000.0);
                        o.put("acc", Math.round(last.getAccuracy()));
                        o.put("fixAge", (System.currentTimeMillis() - last.getTime()) / 60000);
                    }
                }
                o.put("hasLocationPerm",
                        checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                                == android.content.pm.PackageManager.PERMISSION_GRANTED);

                // 步数（当天）
                boolean stepOk = Build.VERSION.SDK_INT < 29
                        || checkSelfPermission("android.permission.ACTIVITY_RECOGNITION")
                        == android.content.pm.PackageManager.PERMISSION_GRANTED;
                o.put("hasStepPerm", stepOk);
                if (stepNow >= 0 && stepBase >= 0 && stepOk) {
                    o.put("steps", Math.max(0, stepNow - stepBase));
                }

                // 屏幕使用时长
                long sm = screenMinutesToday();
                o.put("hasUsagePerm", sm != -2);
                if (sm >= 0) o.put("screenMin", sm);
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        @JavascriptInterface
        public void askLocation() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 23) {
                    requestPermissions(new String[]{
                            android.Manifest.permission.ACCESS_COARSE_LOCATION}, 4301);
                }
            });
        }

        @JavascriptInterface
        public void askActivity() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 29) {
                    requestPermissions(new String[]{"android.permission.ACTIVITY_RECOGNITION"}, 4302);
                } else {
                    Toast.makeText(MainActivity.this, "这个系统不需要额外授权", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void openUsageSettings() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "打不开设置，手动去使用情况访问里给权限",
                            Toast.LENGTH_LONG).show();
                }
            });
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
        public String dbAll(String sql, String argsJson) {
            try {
                org.json.JSONArray args = new org.json.JSONArray(argsJson == null ? "[]" : argsJson);
                android.database.Cursor c = db().rawQuery(sql, strArgs(args));
                org.json.JSONArray rows = new org.json.JSONArray();
                while (c.moveToNext()) {
                    org.json.JSONObject o = new org.json.JSONObject();
                    for (int i = 0; i < c.getColumnCount(); i++) {
                        String col = c.getColumnName(i);
                        o.put(col, c.isNull(i) ? "" : c.getString(i));
                    }
                    rows.put(o);
                }
                c.close();
                return rows.toString();
            } catch (Exception e) {
                return "[]";
            }
        }

        @JavascriptInterface
        public boolean dbRun(String sql, String argsJson) {
            try {
                org.json.JSONArray args = new org.json.JSONArray(argsJson == null ? "[]" : argsJson);
                db().execSQL(sql, strArgs(args));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String dbStats() {
            try {
                org.json.JSONObject o = new org.json.JSONObject();
                android.database.Cursor c = db().rawQuery(
                        "SELECT (SELECT COUNT(*) FROM pages), (SELECT COUNT(*) FROM logs)", null);
                if (c.moveToNext()) {
                    o.put("pages", c.getInt(0));
                    o.put("logs", c.getInt(1));
                }
                c.close();
                o.put("size", getDatabasePath("xi.db").length());
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void pickFileBridge(String id, String mime) {
            MainActivity.this.pickFile(id, mime);
        }

        @JavascriptInterface
        public void pickAttachBridge(String id, String kind, String mode) {
            MainActivity.this.pickAttach(id, kind, mode);
        }

        @JavascriptInterface
        public void openUrl(String url) {
            if (url == null) return;
            final String u = url;
            ui.post(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
                } catch (Exception ignored) {
                }
            });
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
                boolean deepseek = url != null && url.contains("/tools/asr");
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                String head = "--" + boundary + "\r\n"
                        + (deepseek ? "" : "Content-Disposition: form-data; name=\"model\"\r\n\r\n" + model + "\r\n"
                        + "--" + boundary + "\r\n")
                        + "Content-Disposition: form-data; name=\"file\"; filename=\"v." + ext + "\"\r\n"
                        + "Content-Type: " + ("wav".equals(ext) ? "audio/wav"
                        : ("m4a".equals(ext) ? "audio/mp4" : "audio/" + ext)) + "\r\n\r\n";
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
