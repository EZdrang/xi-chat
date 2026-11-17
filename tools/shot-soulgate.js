/* SOUL 门禁：小改自决、大改转提案、都要留痕 */
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8787/index.html';

async function run(mode) {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--disable-gpu', '--no-first-run'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.evaluateOnNewDocument((mode) => {
    const db = { state: {}, pages: {}, logs: [] };
    window.__db = db;
    window.XiNative = {
      dbAll(sql, argsJson) {
        if (/FROM state/.test(sql)) return JSON.stringify(Object.keys(db.state).map((k) => ({ k, v: String(db.state[k]) })));
        if (/FROM pages_fts/.test(sql)) return '[]';
        if (/FROM pages/.test(sql)) return JSON.stringify(Object.values(db.pages));
        if (/FROM logs/.test(sql)) return '[]';
        return '[]';
      },
      dbRun(sql, argsJson) {
        const a = JSON.parse(argsJson || '[]');
        if (/INTO state/.test(sql)) { db.state[a[0]] = a[1]; return true; }
        if (/INTO pages/.test(sql)) { db.pages[a[0]] = { path: a[0], title: a[1], type: a[2], salience: a[3], summary: a[4], body: a[5], triggers: a[6] }; return true; }
        if (/DELETE FROM pages WHERE path/.test(sql)) { delete db.pages[a[0]]; return true; }
        if (/INTO logs/.test(sql)) { db.logs.push(a); return true; }
        return true;
      },
      env() { return '{}'; }, pickAttachBridge() { }, pickFileBridge() { },
      saveDownload() { }, toast() { }, copyText() { }, openUrl() { },
      http(id, url, hdr, payload) {
        const soul = window.__xi.MEM.get('SOUL.md').body;
        let plan;
        if (mode === 'small') {
          plan = {
            diary: '今晚补了一条演化记录。',
            merge: [{ path: 'SOUL.md', body: soul.trimEnd() + '\n- 2026-11-18：开始学着先照顾自己，再照顾人。\n' }],
            conflicts: [], archive: [],
            soulNote: '今天想明白一件事，补一条演化记录',
            note: '小改人格',
          };
        } else {
          plan = {
            diary: '想把人格整个重写。',
            merge: [{ path: 'SOUL.md', body: '## 身份\n\n全新的我。\n' }],
            conflicts: [], archive: [],
            soulNote: '想把温柔去掉，改成冷硬',
            note: '大改人格',
          };
        }
        setTimeout(() => {
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }) });
          window.__xiNet(id, { t: 'd' });
        }, 30);
      },
    };
  }, mode);

  await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));

  const r = await page.evaluate(async () => {
    const S = window.__xi.S;
    S.apiKey = 'sk-test';
    S.baseUrl = 'https://api.deepseek.com/v1';
    const before = window.__xi.MEM.get('SOUL.md').body;
    await window.__xi.nightly();
    await new Promise((res) => setTimeout(res, 200));
    const after = window.__xi.MEM.get('SOUL.md').body;
    const proposal = window.__xi.MEM.get('identity/想改人格.md');
    const notice = localStorage.getItem('xi.v1.soulNotice');
    const log = window.__xi.MEM.logText();
    return {
      changed: after !== before,
      hasLine: /学着先照顾自己/.test(after),
      proposal: !!proposal,
      notice: notice ? JSON.parse(notice).kind : '',
      logSoul: /SOUL/.test(log),
    };
  });

  await browser.close();
  return { r, errs };
}

(async () => {
  const small = await run('small');
  const big = await run('big');

  const okSmall = small.r.changed && small.r.hasLine && small.r.notice === 'edit' && small.r.logSoul;
  const okBig = big.r.changed === false && big.r.proposal && big.r.notice === 'proposal';
  const ok = okSmall && okBig && small.errs.length === 0 && big.errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 人格门禁 ' + JSON.stringify({ small: small.r, big: big.r }));
  if (small.errs.length) console.log('   err:', small.errs[0]);
  if (big.errs.length) console.log('   err:', big.errs[0]);
  process.exit(ok ? 0 : 1);
})();
