/* 验证：每条消息带时间 + 搜旧聊天能定位到那条 */
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

    // 给现有消息补上时间戳，最后一条用「去年」验证年月日
    const cur = window.__xi.cur;
    const now = Date.now();
    cur.messages.forEach((m, i) => { m.ts = now + i * 1000; });
    cur.messages[cur.messages.length - 1].ts = now - 400 * 86400000;
    await window.__xi.saveCur();

    window.__xi.renderChat ? window.__xi.renderChat() : null;
    document.getElementById('btnMenu').click();
    await wait(200);
    document.querySelectorAll('.sess').length && document.querySelectorAll('.sess')[0].click();
    await wait(400);

    const times = [...document.querySelectorAll('#msgs .msg .meta .mt')].map((e) => e.textContent);
    const hasYear = times.some((t) => /\d{4}年\d{1,2}月\d{1,2}日/.test(t));
    const hasClock = times.filter((t) => /^\d{2}:\d{2}$/.test(t)).length;

    // 搜聊天记录：用一个真实存在的词
    const sample = (cur.messages.find((m) => m.role === 'user') || {}).content || '汐';
    const kw = sample.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 2) || '汐';
    const q = document.getElementById('qSearch');
    q.value = kw;
    q.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(900);

    const hits = [...document.querySelectorAll('#sessions .hit')];
    const hitCount = hits.length;
    const bold = !!document.querySelector('#sessions .hit .hs b');

    let jumped = false, flashed = false;
    if (hits.length) {
      hits[0].click();
      await wait(700);
      flashed = !!document.querySelector('.msg.flash');
      jumped = Math.round(document.getElementById('list').scrollTop) > 0 || flashed;
    }

    return { times: times.slice(0, 4), hasYear, hasClock, hitCount, bold, jumped, flashed };
  });

  const ok = r.times.length >= 4 && r.hasYear && r.hasClock >= 3 &&
    r.hitCount >= 1 && r.bold && r.flashed && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 时间戳/搜索 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
