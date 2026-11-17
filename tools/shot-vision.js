/* 带图的消息现在统一走主模型，不再单独切视觉模型 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8787/index.html';

(async () => {
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

  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const calls = [];
    let pickId = null;

    window.XiNative = {
      http(id, url, hdr, body) {
        calls.push(JSON.parse(body || '{}'));
        setTimeout(() => {
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: '看到了' } }] }) });
          window.__xiNet(id, { t: 'c', d: '[DONE]' });
          window.__xiNet(id, { t: 'd' });
        }, 20);
      },
      pickAttachBridge(id) { pickId = id; },
      pickFileBridge(id) { pickId = id; },
      saveDownload() { }, env() { return '{}'; }, toast() { }, copyText() { }, openUrl() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'k';
    S.model = 'deepseek-v4-pro';
    S.searchMode = 'off';

    const c = document.createElement('canvas');
    c.width = 80; c.height = 80;
    c.getContext('2d').fillRect(0, 0, 80, 80);
    const b64 = c.toDataURL('image/png').split(',')[1];

    document.getElementById('btnPickImage').click();
    await wait(60);
    window.__xiFileStart(pickId, 'a.png', 'image/png', 1, b64.length);
    window.__xiFileChunk(pickId, 0, b64);
    window.__xiFileEnd(pickId);
    await wait(250);

    document.getElementById('input').value = '看看这张';
    await window.__xi.send();
    await wait(300);

    const body = calls[0] || {};
    const user = (body.messages || []).filter((m) => m.role === 'user').pop();

    return {
      model: body.model,
      parts: Array.isArray(user && user.content) ? user.content.map((p) => p.type) : [],
      hasVisionField: !!document.getElementById('fVisionModel'),
    };
  });

  const ok = r.model === 'deepseek-flash' &&
    r.parts.includes('image_url') && r.hasVisionField === false && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 主模型带图 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
