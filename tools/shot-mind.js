/* 心智三件套：时间感、偏好、事件簿 */
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
    const db = { state: {}, pages: {}, logs: [], recall: {}, prefs: {}, events: [] };
    window.__db = db;
    window.XiNative = {
      dbAll(sql, argsJson) {
        const a = JSON.parse(argsJson || '[]');
        if (/FROM state/.test(sql)) return JSON.stringify(Object.keys(db.state).map((k) => ({ k, v: String(db.state[k]) })));
        if (/FROM recall/.test(sql)) {
          if (a.length) {
            const r = db.recall[a[0]];
            return JSON.stringify(r ? [{ path: a[0], ts: String(r.ts), n: String(r.n) }] : []);
          }
          return JSON.stringify(Object.keys(db.recall).map((p) => ({ path: p, ts: String(db.recall[p].ts), n: String(db.recall[p].n) })));
        }
        if (/FROM prefs/.test(sql)) {
          const rows = Object.keys(db.prefs).map((t) => ({ tag: t, score: String(db.prefs[t]) }));
          const one = /WHERE tag=/.test(sql) ? rows.filter((r) => r.tag === a[0]) : rows;
          return JSON.stringify(one.sort((x, y) => Number(y.score) - Number(x.score)));
        }
        if (/FROM events/.test(sql)) return JSON.stringify(db.events.slice(-40).reverse());
        if (/FROM pages_fts/.test(sql)) return '[]';
        if (/FROM pages/.test(sql)) return JSON.stringify(Object.values(db.pages));
        if (/FROM logs/.test(sql)) return '[]';
        return '[]';
      },
      dbRun(sql, argsJson) {
        const a = JSON.parse(argsJson || '[]');
        if (/INTO state/.test(sql)) { db.state[a[0]] = a[1]; return true; }
        if (/INTO recall/.test(sql)) { db.recall[a[0]] = { ts: Number(a[1]), n: Number(a[2]) }; return true; }
        if (/INTO prefs/.test(sql)) { db.prefs[a[0]] = Number(a[1]); return true; }
        if (/INTO events/.test(sql)) { db.events.push({ ts: a[0], what: a[1], why: a[2], how: a[3], tags: a[4] }); return true; }
        if (/INTO pages/.test(sql)) { db.pages[a[0]] = { path: a[0], title: a[1], type: a[2], salience: a[3], summary: a[4], body: a[5], triggers: a[6] }; return true; }
        if (/INTO logs/.test(sql)) { db.logs.push(a); return true; }
        return true;
      },
      env() { return '{}'; }, pickAttachBridge() { }, pickFileBridge() { },
      saveDownload() { }, toast() { }, copyText() { }, openUrl() { },
    };
  });

  await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));

  const r = await page.evaluate(async () => {
    const M = window.XiMind;
    const MEM = window.__xi.MEM;

    // 1) 偏好：聊技术她回得长又有表情，聊八卦她敷衍
    M.observe('这个 sqlite 接口老报错', '那就把插入拆成事务，先建表再灌数据 😌 我记得你上次也卡在这。');
    M.observe('看看这个插件怎么调', '看一下 manifest，再对齐 dsh 的版本 😏');
    M.observe('今天有啥八卦', '嗯。');
    M.observe('那个热搜瓜呢', '不知道。');
    const pref = M.prefLine();

    // 2) 事件簿：强信号当场抓
    M.captureEvent('对不起，是我崩了，昨晚不该那样说你', '没事，你先睡一觉。');
    M.captureEvent('我们和好了，今天聊开了', '那就好，别急着定论。');
    const event = M.eventLine('今天又和她吵架了，我是不是又崩了');

    // 3) 时间感：把一页标记成 9 天前想起，看它会不会被翻出来
    const page = MEM.list().find((p) => p.path !== 'SOUL.md' && p.path !== 'MEMORY.md');
    window.__db.recall[page.path] = { ts: Date.now() - 9 * 86400000, n: 3 };
    const time = M.timeLine('随便聊点什么', MEM);
    const stamped = !!window.__db.recall[page.path] && window.__db.recall[page.path].ts > Date.now() - 60000;

    return { pref, event, time, stamped, pagePath: page.path };
  });

  const ok = /有劲儿/.test(r.pref) && /敷衍/.test(r.pref) &&
    /翻到旧事/.test(r.event) && /忽然想起/.test(r.time) && r.stamped &&
    r.time.indexOf(r.pagePath) >= 0 && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 心智三件套 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
