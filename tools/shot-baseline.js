/* 量一下开场吃多少上下文：分层注入前后对比 */
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
  await page.goto(BASE + '', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));

  const r = await page.evaluate(async () => {
    let body = null;
    window.XiNative = {
      http(id, url, hdr, payload) {
        if (/chat\/completions/.test(url)) {
          body = JSON.parse(payload);
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: '嗯' } }] }) });
          window.__xiNet(id, { t: 'c', d: '[DONE]' });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        window.__xiNet(id, { t: 'c', d: '{}' });
        window.__xiNet(id, { t: 'd' });
      },
      env() { return '{}'; }, pickAttachBridge() { }, pickFileBridge() { },
      saveDownload() { }, toast() { }, copyText() { }, openUrl() { },
    };
    const S = window.__xi.S;
    S.apiKey = 'k';
    S.compress = false;
    S.autoExtract = false;

    document.getElementById('input').value = '在吗';
    await window.__xi.send();
    await new Promise((r) => setTimeout(r, 400));

    const sys = (body.messages || []).filter((m) => m.role === 'system');
    const chars = sys.reduce((n, m) => n + String(m.content).length, 0);
    const ctxPct = (document.getElementById('ctxUsage') || {}).textContent || '';

    return {
      chars,
      approxTokens: Math.round(chars / 1.6),
      blocks: sys.map((m) => String(m.content).slice(0, 18).replace(/\n/g, ' ')),
      ctxPct,
    };
  });

  const ok = r.chars < 9000 && errs.length === 0;
  console.log((ok ? '✓' : '✗') + ' 开场开销 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
