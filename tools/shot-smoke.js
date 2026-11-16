/* 冒烟：JS 派发点击，把全部界面走一遍，只关心「有没有运行时异常」 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8787/index.html';
const OUT = path.join(__dirname, '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let bad = 0;
function report(ok, name, extra) {
  if (!ok) bad++;
  console.log((ok ? '✓' : '✗') + ' ' + name.padEnd(14) + JSON.stringify(extra || {}));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--disable-gpu', '--hide-scrollbars', '--no-first-run'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });

  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });

  await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
  await sleep(700);

  const tap = (sel, idx) => page.evaluate((s, i) => {
    const els = document.querySelectorAll(s);
    const el = els[i || 0];
    if (!el) return 'miss:' + s;
    el.click();
    return 'ok';
  }, sel, idx || 0);

  const steps = [
    ['抽屉', '#btnMenu'],
    ['会话菜单', '.sess .sx'],
    ['菜单项-改名', '[data-list] > div', 0],
    ['改名-取消', 'button[data-v="0"]'],
    ['关抽屉', '#scrim'],
    ['记忆库', '#btnMem'],
    ['看 index', '#btnViewIndex'],
    ['退 index', '[data-close="sheet-page"]'],
    ['看 log', '#btnViewLog'],
    ['退 log', '[data-close="sheet-page"]'],
    ['新建页', '#btnNewPage'],
    ['空保存', '#btnSavePage'],
    ['退页', '[data-close="sheet-page"]'],
    ['退记忆库', '[data-close="sheet-mem"]'],
    ['设置', '#btnSet'],
    ['显隐 Key', '#btnEye'],
    ['保存设置', '#btnSaveSet'],
    ['用量', '#ctx'],
    ['清用量', '#btnZeroUsage'],
    ['清用量-取消', 'button[data-v="0"]'],
    ['退用量', '[data-close="sheet-usage"]'],
    ['复制', '#msgs .meta button[data-act="copy"]'],
    ['删除消息', '#msgs .meta button[data-act="del"]'],
    ['新对话', '#btnMenu'],
    ['点新对话', '#btnNew'],
    ['发空消息', '#btnSend'],
    ['退设置', '[data-close="sheet-set"]'],
    ['拖到记忆库导入', '#btnMem'],
    ['导入(无桥)', '#btnImport'],
  ];

  const missed = [];
  for (const [name, sel, idx] of steps) {
    const r = await tap(sel, idx);
    if (r !== 'ok') missed.push(name + '→' + r);
    await sleep(220);
  }

  const st = await page.evaluate(() => ({
    sessions: document.querySelectorAll('.sess').length,
    notes: document.querySelectorAll('.msg.sys-note').length,
    errBubbles: document.querySelectorAll('.msg.err').length,
    openSheets: [...document.querySelectorAll('.sheet.open')].map((s) => s.id),
  }));

  report(errs.length === 0, '无运行时异常', { errs: errs.slice(0, 5) });
  report(missed.length === 0, '按钮都点到了', { missed });
  report(st.errBubbles === 0, '没有报错气泡', st);
  await page.screenshot({ path: path.join(OUT, 'smoke.png') });
  await page.close();

  // ── 深色 ──
  {
    const p2 = await browser.newPage();
    const e2 = [];
    p2.on('pageerror', (e) => e2.push(e.message));
    await p2.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await p2.goto(BASE + '', { waitUntil: 'networkidle0' });
    await sleep(800);
    const dark = await p2.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    report(dark.attr === 'dark', '跟随系统→深色', dark);
    await p2.screenshot({ path: path.join(OUT, 'dark-chat.png') });

    await p2.evaluate(() => document.getElementById('btnSet').click());
    await sleep(500);
    await p2.screenshot({ path: path.join(OUT, 'dark-settings.png') });
    await p2.evaluate(() => document.querySelector('[data-close="sheet-set"]').click());
    await sleep(400);
    await p2.evaluate(() => document.getElementById('btnMem').click());
    await sleep(500);
    await p2.screenshot({ path: path.join(OUT, 'dark-memory.png') });
    report(e2.length === 0, '深色无异常', { errs: e2.slice(0, 3) });
    await p2.close();
  }

  await browser.close();
  console.log(bad ? '\n有 ' + bad + ' 项失败' : '\n全部通过');
  process.exit(bad ? 1 : 0);
})();
