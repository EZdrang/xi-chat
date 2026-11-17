/* 单独一行的 emoji 会放大成表情；普通句子里的不放大 */
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
    cur.messages.push({ role: 'user', content: '跑通了吗', ts: Date.now() });
    cur.messages.push({
      role: 'assistant', ts: Date.now() + 1000,
      content: [
        '跑通了。日志我看了三遍，没报错 😌',
        '',
        '😌',
        '',
        '(￣▽￣)',
        '',
        '这行有字还有 😐 表情，不该放大。',
      ].join('\n'),
    });
    window.__xi.renderChat();
    const xl = [...document.querySelectorAll('.md p.emoji-xl')].map((p) => p.textContent);
    const all = [...document.querySelectorAll('.md p')].map((p) => ({
      t: p.textContent.slice(0, 12),
      big: p.classList.contains('emoji-xl'),
    }));
    return { xl, all };
  });

  await new Promise((r2) => setTimeout(r2, 300));
  await page.evaluate(() => { document.getElementById('list').scrollTop = 99999; });
  await new Promise((r3) => setTimeout(r3, 200));
  await page.screenshot({ path: path.join(__dirname, '..', 'shots', 'emoji.png') });

  const ok = r.xl.length === 1 &&
    r.xl[0].includes('😌') &&
    r.all.filter((p) => p.big).length === 1 &&
    errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 表情放大 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
