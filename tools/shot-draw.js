/* 验证画图：假接口返回 b64_json → 出图 → 发进对话 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8787/index.html';
const OUT = path.join(__dirname, '..', 'docs');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--disable-gpu', '--hide-scrollbars', '--no-first-run'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 700));

  const r = await page.evaluate(async () => {
    // 造一张 512 的图，当成接口返回
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 512, 512);
    grd.addColorStop(0, '#0f2350'); grd.addColorStop(.55, '#2477c4'); grd.addColorStop(1, '#a6d8f7');
    g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.font = 'bold 64px sans-serif';
    g.fillText('鲸鱼娘', 150, 240);
    g.font = '28px sans-serif';
    g.fillText('demo image', 190, 300);
    const b64 = c.toDataURL('image/png').split(',')[1];

    window.__calls = [];
    window.XiNative = {
      http(id, url, hdr, body, stream) {
        window.__calls.push({ url, body: JSON.parse(body || '{}') });
        setTimeout(() => {
          window.__xiNet(id, {
            t: 'c',
            d: JSON.stringify({ created: 1, data: [{ b64_json: b64 }] }),
          });
          window.__xiNet(id, { t: 'd' });
        }, 40);
      },
      saveDownload() { }, env() { return '{}'; }, toast() { },
    };

    window.__xi.S.apiKey = 'test-key';
    window.__xi.S.imageModel = 'gpt-image-1';

    document.getElementById('btnDraw').click();
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('drawPrompt').value = '深夜机房，胖鲸鱼趴在键盘上';
    document.getElementById('drawSize').value = '1024x1024';
    document.getElementById('btnDrawGo').click();
    await new Promise((r) => setTimeout(r, 900));

    const imgs = document.querySelectorAll('#drawOut img');
    const first = imgs[0] || {};
    return {
      imgs: imgs.length,
      src: String(first.src || '').slice(0, 24),
      url: window.__calls[0] && window.__calls[0].url,
      body: window.__calls[0] && window.__calls[0].body,
    };
  });

  console.log('生成：', JSON.stringify(r));
  await page.screenshot({ path: path.join(OUT, 'draw.png') });

  const toChat = await page.evaluate(async () => {
    document.getElementById('btnDrawToChat').click();
    await new Promise((r) => setTimeout(r, 600));
    const msgs = window.__xi.cur.messages;
    const last = msgs[msgs.length - 1];
    return { hasImg: !!(last.images && last.images.length), text: last.content, count: msgs.length };
  });
  console.log('发到对话：', JSON.stringify(toChat));
  await page.screenshot({ path: path.join(OUT, 'draw-chat.png') });

  const ok = r.imgs === 1 && r.src.startsWith('data:image/png') &&
    r.url.includes('/images/generations') &&
    r.body.model === 'gpt-image-1' && r.body.size === '1024x1024' &&
    toChat.hasImg && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 画图链路');
  if (errs.length) console.log('  err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
