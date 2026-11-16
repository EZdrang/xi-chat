/* 验证：mime 缺失的图也按图片处理，且用合法 mime 组装 data URL */
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
    const c = document.createElement('canvas');
    c.width = 120; c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = '#08c'; g.fillRect(0, 0, 120, 120);
    const pngB64 = c.toDataURL('image/png').split(',')[1];

    let pid = null;
    window.XiNative = {
      pickAttachBridge(id) { pid = id; },
      pickFileBridge(id) { pid = id; },
      saveDownload() { }, env() { return '{}'; }, toast() { }, copyText() { }, openUrl() { },
    };

    const deliver = (id, name, mime, b64) => {
      window.__xiFileStart(id, name, mime, 1, b64.length);
      window.__xiFileChunk(id, 0, b64);
      window.__xiFileEnd(id);
    };

    // 从「文件」入口选图：mime 缺失
    document.getElementById('btnAttach').click();
    await wait(50);
    deliver(pid, 'photo.jpg', 'application/octet-stream', pngB64);
    await wait(400);

    const chip = document.querySelector('#attachBar .chip');
    const img = document.querySelector('#attachBar .chip img');
    const atts = window.__xi.S ? null : null;

    // 再发出去，看请求里的 data URL 前缀
    let sentUrl = '';
    window.XiNative.http = function (id, url, hdr, body) {
      if (/chat\/completions/.test(url)) {
        const b = JSON.parse(body);
        const u = (b.messages || []).filter((m) => m.role === 'user').pop();
        if (Array.isArray(u.content)) {
          const p = u.content.find((x) => x.type === 'image_url');
          sentUrl = p ? p.image_url.url.slice(0, 30) : '';
        }
        window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: '收到' } }] }) });
        window.__xiNet(id, { t: 'c', d: '[DONE]' });
        window.__xiNet(id, { t: 'd' });
        return;
      }
      window.__xiNet(id, { t: 'c', d: '{}' });
      window.__xiNet(id, { t: 'd' });
    };
    window.__xi.S.apiKey = 'k';
    window.__xi.S.compress = false;
    window.__xi.S.autoExtract = false;
    document.getElementById('input').value = '看看这张';
    await window.__xi.send();
    await wait(500);

    return {
      hasChip: !!chip,
      chipName: chip ? chip.textContent.trim() : '',
      hasPreview: !!img,
      previewPrefix: img ? img.src.slice(0, 22) : '',
      sentPrefix: sentUrl,
    };
  });

  const ok = r.hasChip && r.hasPreview &&
    /^data:image\/(jpeg|png)/.test(r.previewPrefix) &&
    /^data:image\//.test(r.sentPrefix) &&
    errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 图片 mime ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
