/* v2.0 四样：回头看一眼 / 跨天首句 / 会忘 / 口头禅 */
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

  await page.evaluateOnNewDocument(() => {
    const db = { state: {}, pages: {}, logs: [], recall: {}, prefs: {}, events: [], habits: {} };
    window.__db = db;
    window.XiNative = {
      dbAll(sql, argsJson) {
        const a = JSON.parse(argsJson || '[]');
        if (/FROM state/.test(sql)) return JSON.stringify(Object.keys(db.state).map((k) => ({ k, v: String(db.state[k]) })));
        if (/FROM recall/.test(sql)) return JSON.stringify(Object.keys(db.recall).map((p) => ({ path: p, ts: String(db.recall[p].ts), n: '1' })));
        if (/FROM prefs/.test(sql)) return '[]';
        if (/FROM events/.test(sql)) return '[]';
        if (/FROM habits/.test(sql)) {
          const rows = Object.keys(db.habits).map((k) => ({ k, n: String(db.habits[k]) }));
          if (/WHERE n>=/.test(sql) || /WHERE n >=/.test(sql)) return JSON.stringify(rows);
          const one = a.length ? rows.filter((r) => r.k === a[0]) : rows;
          return JSON.stringify(one);
        }
        if (/FROM pages_fts/.test(sql)) return '[]';
        if (/FROM pages/.test(sql)) return JSON.stringify(Object.values(db.pages));
        if (/FROM logs/.test(sql)) return '[]';
        return '[]';
      },
      dbRun(sql, argsJson) {
        const a = JSON.parse(argsJson || '[]');
        if (/INTO state/.test(sql)) { db.state[a[0]] = a[1]; return true; }
        if (/INTO recall/.test(sql)) { db.recall[a[0]] = { ts: Number(a[1]), n: Number(a[2]) }; return true; }
        if (/INTO habits/.test(sql)) { db.habits[a[0]] = Number(a[1]); return true; }
        if (/INTO pages/.test(sql)) { db.pages[a[0]] = { path: a[0], title: a[1], type: a[2], salience: a[3], summary: a[4], body: a[5], triggers: a[6] }; return true; }
        if (/INTO logs/.test(sql)) { db.logs.push(a); return true; }
        return true;
      },
      env() { return '{}'; }, pickAttachBridge() { }, pickFileBridge() { },
      saveDownload() { }, toast() { }, copyText() { }, openUrl() { },
      http(id, url, hdr, payload) {
        const body = JSON.parse(payload || '{}');
        window.__lastBody = body;
        const isReview = /回头看/.test(JSON.stringify(body));
        const content = isReview ? JSON.stringify({ revise: '……算了，刚才那句说重了。' }) : '好';
        setTimeout(() => {
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ message: { content } }] }) });
          window.__xiNet(id, { t: 'd' });
        }, 20);
      },
    };
  });

  await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));

  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const M = window.XiMind;
    const S = window.__xi.S;
    S.apiKey = 'sk-test';
    S.baseUrl = 'https://api.deepseek.com/v1';

    // 1) 口头禅：喂几句带口头禅和表情的回复
    M.observeHabits('行吧，那就这么办 😌');
    M.observeHabits('行吧，你说的算 😌');
    M.observeHabits('讲真，这次有点离谱 😌');
    const habit = M.habitLine();

    // 2) 会忘：把一页标成 40 天没想起
    const MEM = window.__xi.MEM;
    const pg = MEM.list().find((p) => p.path !== 'SOUL.md' && p.path !== 'MEMORY.md');
    window.__db.recall[pg.path] = { ts: Date.now() - 40 * 86400000, n: 2 };
    const time = M.timeLine('随便', MEM);

    // 3) 跨天首句：把「上次说话」推到 30 小时前、日期改成昨天
    window.XiState.patch({ lastChat: Date.now() - 30 * 3600000, lastDay: '2000-01-01' });
    const day = window.XiState.dayLine();

    // 4) 回头看一眼：模拟一条长回复，让她审自己
    window.__xiForceReview = true;
    const cur = window.__xi.cur;
    const msg = { role: 'assistant', content: '这是一段足够长的回复，用来触发回头看自己的逻辑。'.repeat(3), ts: Date.now() };
    cur.messages.push(msg);
    await window.__xi.selfReview(cur, msg);
    await wait(1800);

    return {
      habit, time, day,
      fuzzy: /印象有点糊/.test(time),
      revised: /刚才那句说重了/.test(msg.content),
      revision: msg.revision || [],
    };
  });

  const ok = /口头禅/.test(r.habit) && /行吧/.test(r.habit) &&
    r.fuzzy && /第一次说话/.test(r.day) && r.revised && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' v2.0 四样 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
