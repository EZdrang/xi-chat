/* 表情与正文同字号；旧的 [[sticker:xx]] 不再露出来 */
const puppeteer = require('puppeteer-core');
const path = require('path');

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

  const r = await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const cur = window.__xi.cur;
    cur.messages.push({ role: 'user', content: '在吗', ts: Date.now() });
    cur.messages.push({
      role: 'assistant', ts: Date.now() + 1000,
      content: '在。刚把东西收拾完 😌\n\n[[img:smug]]\n\n[[sticker:不存在]]\n\n有事说事 😏',
    });
    window.__xi.renderChat();

    const msgs = [...document.querySelectorAll('.msg.ai')];
    const last = msgs[msgs.length - 1];
    const p = last.querySelector('.md p');
    const fs = p ? parseFloat(getComputedStyle(p).fontSize) : 0;
    return {
      text: last.querySelector('.md').textContent.slice(0, 40),
      hasStickerWord: last.textContent.includes('sticker'),
      hasImgWord: last.textContent.includes('img:'),
      hasImgNode: !!last.querySelector('img.md-img, .img-slot'),
      hasStickerCard: !!last.querySelector('.sticker'),
      pFont: fs,
    };
  });

  await new Promise((r2) => setTimeout(r2, 300));
  await page.evaluate(() => { document.getElementById('list').scrollTop = 99999; });
  await new Promise((r3) => setTimeout(r3, 200));
  await page.screenshot({ path: path.join(__dirname, '..', 'shots', 'emoji-size.png') });

  const ok = r.hasStickerWord === false && r.hasStickerCard === false &&
    r.hasImgWord === false && r.hasImgNode === false &&
    r.pFont > 14 && r.pFont < 17 && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 表情字号 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
