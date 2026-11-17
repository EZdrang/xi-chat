/* 语音转写：DeepSeek 走 /v1/tools/asr（WAV），其他端点走 /audio/transcriptions */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8787/index.html';

async function run(baseUrl) {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--disable-gpu', '--no-first-run'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 700));

  const r = await page.evaluate(async (base) => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    let sent = null;

    window.XiNative = {
      startRecordBridge(id) {
        window.__rid = id;
        setTimeout(() => window.__xiRecStarted(id), 10);
      },
      stopRecordBridge() {
        window.__xiRecorded(window.__rid, 'UklGRg==');
      },
      transcribe(id, url, key, model, b64, ext) {
        sent = { url, key, model, ext };
        setTimeout(() => window.__xiTranscribed(id, '你好啊'), 20);
      },
      env() { return '{}'; }, pickAttachBridge() { }, pickFileBridge() { },
      saveDownload() { }, toast() { }, copyText() { }, openUrl() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'sk-test';
    S.baseUrl = base;
    S.voiceMode = 'ai';

    document.getElementById('btnVoice').click();
    await wait(80);
    document.getElementById('btnVoice').click();
    await wait(300);

    return { sent, input: document.getElementById('input').value, base };
  }, baseUrl);

  await browser.close();
  return { r, errs };
}

(async () => {
  const a = await run('https://api.deepseek.com/v1');
  const b = await run('https://api.openai.com/v1');

  const okDeep = a.r.sent && a.r.sent.url === 'https://api.deepseek.com/v1/tools/asr' &&
    a.r.sent.ext === 'wav' && a.r.input.includes('你好');
  const okOth = b.r.sent && b.r.sent.url === 'https://api.openai.com/v1/audio/transcriptions' &&
    b.r.sent.ext === 'wav';

  const ok = okDeep && okOth && a.errs.length === 0 && b.errs.length === 0;
  console.log((ok ? '✓' : '✗') + ' 语音转写 ' + JSON.stringify({ deep: a.r.sent, other: b.r.sent }));
  process.exit(ok ? 0 : 1);
})();
