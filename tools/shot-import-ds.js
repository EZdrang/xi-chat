/* 用真实的「情感」导入包验证：分块导入 + 长会话懒加载 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8787/index.html';
const FILE = path.join(__dirname, '..', 'dist', '汐-导入-情感合并-20261117.json');

(async () => {
  if (!fs.existsSync(FILE)) { console.log('缺导入包:', FILE); process.exit(1); }
  const b64 = fs.readFileSync(FILE).toString('base64');
  console.log('包大小:', (fs.statSync(FILE).size / 1024 / 1024).toFixed(2), 'MB');

  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--disable-gpu', '--no-first-run'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 700));

  const before = await page.evaluate(() => document.querySelectorAll('.sess').length);

  await page.evaluate(async (data) => {
    window.XiNative = {
      pickAttachBridge(id) { window.__pid = id; },
      pickFileBridge(id) { window.__pid = id; },
      saveDownload() { }, env() { return '{}'; }, toast() { }, copyText() { },
    };
    document.getElementById('btnImportSession').click();
    await new Promise((r) => setTimeout(r, 60));
    const id = window.__pid;
    window.__xiFileStart(id, '汐-导入-情感.json', 'application/json', 1, data.length);
    window.__xiFileChunk(id, 0, data);
    window.__xiFileEnd(id);
  }, b64);

  // 等导入（3.9MB / 4000+ 条要写库）
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const done = await page.evaluate(() => document.querySelectorAll('.sess').length);
    if (done > before + 1) break;
  }
  await new Promise((r) => setTimeout(r, 1500));

  const st = await page.evaluate(() => ({
    sessions: document.querySelectorAll('.sess').length,
    rendered: document.querySelectorAll('#msgs .msg').length,
    more: !!document.querySelector('.load-more'),
    moreText: (document.querySelector('.load-more') || {}).textContent || '',
    title: document.getElementById('tMain').textContent,
    total: window.__xi.cur ? window.__xi.cur.messages.length : 0,
  }));

  const ok = st.sessions === before + 1 && st.total > 4000 &&
    st.more === true && st.rendered <= 82 && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 导入 ' + JSON.stringify(st));
  if (errs.length) console.log('   err:', errs[0]);
  await page.screenshot({ path: path.join(__dirname, '..', 'shots', 'import-ds.png') });
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
