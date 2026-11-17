/* [[sticker:得意]] 会画成贴纸卡；未知名字保持原文 */
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
    cur.messages.push({ role: 'user', content: '这次改得挺准', ts: Date.now() });
    cur.messages.push({
      role: 'assistant', ts: Date.now() + 1000,
      content: '那当然，我什么时候错过 😏\n\n[[sticker:得意]]\n\n开玩笑的，下次再翻车你就笑我。\n\n[[sticker:不存在]]',
    });
    window.__xi.renderChat();
    const stickers = [...document.querySelectorAll('.md .sticker')].map((s) => ({
      name: s.querySelector('.st-name').textContent,
      emo: s.querySelector('.st-emo').textContent,
    }));
    const mdAll = [...document.querySelectorAll('.md')];
    const lastMd = mdAll[mdAll.length - 1];
    return {
      stickers,
      rawLeft: lastMd ? lastMd.textContent.includes('[[sticker:不存在]]') : false,
    };
  });

  await new Promise((r2) => setTimeout(r2, 300));
  await page.evaluate(() => { document.getElementById('list').scrollTop = 99999; });
  await new Promise((r3) => setTimeout(r3, 200));
  await page.screenshot({ path: path.join(__dirname, '..', 'shots', 'sticker.png') });

  const ok = r.stickers.length === 1 && r.stickers[0].name === '得意' &&
    r.stickers[0].emo === '😏' && r.rawLeft && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 贴纸 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
