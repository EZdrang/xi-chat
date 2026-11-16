/* 附件：分块过桥 / 多选图片 / zip 解包 / 大文件只带名 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8787/index.html';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--disable-gpu', '--hide-scrollbars', '--no-first-run'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 700));

  const r = await page.evaluate(async () => {
    // 造一张图
    const c = document.createElement('canvas');
    c.width = 400; c.height = 800;   // 长截图比例
    const g = c.getContext('2d');
    g.fillStyle = '#246'; g.fillRect(0, 0, 400, 800);
    g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.fillText('LONG', 140, 400);
    const imgB64 = c.toDataURL('image/png').split(',')[1];

    // 造一个 zip
    const enc = new TextEncoder();
    const zipBytes = ZIP.create([
      { path: 'notes.md', data: enc.encode('# 笔记\n这是压缩包里的文本') },
      { path: 'a/b.py', data: enc.encode('print("hello")') },
    ]);
    let zs = '';
    for (let i = 0; i < zipBytes.length; i += 8192) zs += String.fromCharCode.apply(null, zipBytes.subarray(i, i + 8192));
    const zipB64 = btoa(zs);

    // 分块投递，模拟原生桥
    function deliver(id, name, mime, b64) {
      const CH = 700;
      const parts = [];
      for (let i = 0; i < b64.length; i += CH) parts.push(b64.slice(i, i + CH));
      window.__xiFileStart(id, name, mime, parts.length, b64.length);
      parts.forEach((p, i) => window.__xiFileChunk(id, i, p));
      window.__xiFileEnd(id);
    }

    let pick = null;
    window.XiNative = {
      pickAttachBridge(id) { pick = id; },
      pickFileBridge(id) { pick = id; },
      saveDownload() { }, env() { return '{}'; }, toast() { },
    };

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // 1) 多选两张图
    document.getElementById('btnPickImage').click();
    await wait(50);
    deliver(pick + '#0', 'shot1.png', 'image/png', imgB64);
    deliver(pick + '#1', 'shot2.png', 'image/png', imgB64);
    await wait(300);
    const multi = document.querySelectorAll('#attachBar .chip').length;

    // 2) zip
    document.getElementById('btnAttach').click();
    await wait(50);
    deliver(pick, 'pack.zip', 'application/zip', zipB64);
    await wait(400);
    const zipAtt = window.__xi.cur && null;
    const chips = [...document.querySelectorAll('#attachBar .chip .cn')].map((e) => e.textContent);

    // 3) 大文件只带名
    document.getElementById('btnAttach').click();
    await wait(50);
    window.__xiFileMeta(pick, 'huge.zip', 24 * 1024 * 1024);
    await wait(200);

    // 4) 发出去，看请求里有没有 zip 里的文本
    const calls = [];
    window.XiNative.http = function (id, url, hdr, body) {
      calls.push(JSON.parse(body || '{}'));
      setTimeout(() => {
        window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) });
        window.__xiNet(id, { t: 'c', d: '[DONE]' });
        window.__xiNet(id, { t: 'd' });
      }, 20);
    };
    window.__xi.S.apiKey = 'k';
    document.getElementById('input').value = '看看这些';
    await window.__xi.send();
    await wait(200);

    const body = calls[0] || {};
    const lastUser = (body.messages || []).filter((m) => m.role === 'user').pop() || {};
    const text = Array.isArray(lastUser.content)
      ? (lastUser.content.find((p) => p.type === 'text') || {}).text || ''
      : String(lastUser.content || '');
    const imgParts = Array.isArray(lastUser.content)
      ? lastUser.content.filter((p) => p.type === 'image_url').length : 0;

    return {
      multi, chips,
      zipInlined: text.includes('print("hello")') || text.includes('这是压缩包里的文本'),
      bigOnlyName: text.includes('huge.zip'),
      imgParts,
      errs: 0,
    };
  });

  const ok = r.multi === 2 && r.chips.includes('pack.zip') && r.zipInlined &&
    r.bigOnlyName && r.imgParts === 2 && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 附件 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
