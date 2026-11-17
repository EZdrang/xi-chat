/* 状态会随对话变化、随时间衰减；隔夜整理会写日记 */
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

  // 假桥：state 用内存表，pages 也认
  await page.evaluateOnNewDocument(() => {
    const db = { state: {}, pages: {}, logs: [] };
    window.__db = db;
    window.XiNative = {
      dbAll(sql, argsJson) {
        const a = JSON.parse(argsJson || '[]');
        if (/FROM state/.test(sql)) {
          return JSON.stringify(Object.keys(db.state).map((k) => ({ k, v: String(db.state[k]) })));
        }
        if (/FROM pages_fts/.test(sql)) return '[]';
        if (/FROM pages/.test(sql)) return JSON.stringify(Object.values(db.pages));
        if (/FROM logs/.test(sql)) return '[]';
        return '[]';
      },
      dbRun(sql, argsJson) {
        const a = JSON.parse(argsJson || '[]');
        if (/INTO state/.test(sql)) { db.state[a[0]] = a[1]; return true; }
        if (/INTO pages/.test(sql)) {
          db.pages[a[0]] = { path: a[0], title: a[1], type: a[2], salience: a[3], summary: a[4], body: a[5], triggers: a[6] };
          return true;
        }
        if (/INTO logs/.test(sql)) { db.logs.push(a); return true; }
        return true;
      },
      env() { return '{}'; }, pickAttachBridge() { }, pickFileBridge() { },
      saveDownload() { }, toast() { }, copyText() { }, openUrl() { },
    };
  });

  await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));

  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const before = window.XiState.snapshot();
    window.XiState.afterTurn('今天累死了，撑不住', '那就先别撑，去睡。');
    const afterNeg = window.XiState.snapshot();
    window.XiState.afterTurn('谢谢你，真靠谱', '客气什么。');
    const afterPraise = window.XiState.snapshot();
    const line = window.XiState.line();

    // 强制跑一次夜间整理
    window.__db.state.lastNight = 0;
    const res = window.XiState.nightly(window.__xi.MEM);
    await wait(200);
    const diary = Object.keys(window.__db.pages).filter((p) => p.indexOf('diary/') === 0);
    return {
      before, afterNeg, afterPraise, line,
      moodDropped: afterNeg.mood < before.mood,
      moodRose: afterPraise.mood > afterNeg.mood,
      energyDropped: afterPraise.energy < before.energy,
      lineMentions: /状态/.test(line),
      nightly: res,
      diary: diary.length,
    };
  });

  const ok = r.moodDropped && r.moodRose && r.energyDropped && r.lineMentions &&
    r.nightly.pages >= 0 && r.diary === 1 && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 状态与夜间整理 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
