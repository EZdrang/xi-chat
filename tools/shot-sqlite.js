/* SQLite 兜底：手机端把记忆写进库，读回也从库里取（用假桥验证接线） */
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
    // 极简 SQLite 仿真：只认我们实际用到的几条语句
    window.__db = { pages: {}, logs: [], calls: [] };
    const db = window.__db;
    window.XiNative = {
      dbAll(sql, argsJson) {
        db.calls.push(['all', sql.slice(0, 40)]);
        const args = JSON.parse(argsJson || '[]');
        if (/FROM pages_fts/.test(sql)) {
          const q = String(args[0] || '').replace(/\*$/, '').toLowerCase();
          const hit = Object.values(db.pages).filter((p) =>
            (p.title + p.body).toLowerCase().includes(q));
          return JSON.stringify(hit.map((p) => ({ path: p.path, title: p.title, snip: p.body.slice(0, 40) })));
        }
        if (/FROM pages/.test(sql)) {
          return JSON.stringify(Object.values(db.pages));
        }
        if (/FROM logs/.test(sql)) return JSON.stringify(db.logs.slice(-2000));
        return '[]';
      },
      dbRun(sql, argsJson) {
        db.calls.push(['run', sql.slice(0, 32)]);
        const a = JSON.parse(argsJson || '[]');
        if (/INSERT OR REPLACE INTO pages/.test(sql)) {
          db.pages[a[0]] = { path: a[0], title: a[1], type: a[2], salience: a[3], summary: a[4], body: a[5], triggers: a[6] };
          return true;
        }
        if (/DELETE FROM pages WHERE path/.test(sql)) { delete db.pages[a[0]]; return true; }
        if (/INSERT INTO logs/.test(sql)) { db.logs.push({ ts: a[0], kind: a[1], title: a[2] }); return true; }
        return true;
      },
      env() { return '{}'; }, pickAttachBridge() { }, pickFileBridge() { },
      saveDownload() { }, toast() { }, copyText() { }, openUrl() { },
    };
  });

  await page.goto(BASE + '', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));

  const r = await page.evaluate(async () => {
    const before = Object.keys(window.__db.pages).length;
    const migrated = window.__db.calls.some((c) => c[1].includes('INSERT OR REPLACE INTO pages'));

    window.__xi.MEM.upsert({
      path: 'skills/测试技能.md',
      title: '测试技能',
      type: 'skill',
      salience: 2,
      summary: '一句话',
      body: '这里是一条独一无二的指纹文本：紫色鲸鱼',
      triggers: ['测试'],
    });

    const after = Object.keys(window.__db.pages).length;
    const inDb = !!window.__db.pages['skills/测试技能.md'];
    const hits = window.__xi.MEM.search('紫色鲸鱼');
    const logWritten = window.__db.logs.length > 0;

    return { before, after, migrated, inDb, hits: hits.length, logWritten };
  });

  const ok = r.migrated && r.before >= 4 && r.after === r.before + 1 && r.inDb &&
    r.hits >= 1 && r.logWritten && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' SQLite 记忆 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
