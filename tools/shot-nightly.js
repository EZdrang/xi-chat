/* 夜间整理（模型版）：她出方案、代码执行；SOUL 不被自动改；旧版可回滚 */
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
    const db = { state: {}, pages: {}, logs: [] };
    window.__db = db;
    window.XiNative = {
      dbAll(sql, argsJson) {
        const a = JSON.parse(argsJson || '[]');
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
        const body = JSON.parse(payload || '{}');
        window.__lastPrompt = body.messages ? body.messages[1].content : '';
        const plan = {
          diary: '今天把上下文压下去一半，也把状态做出来了。有点累，但痛快。',
          merge: [
            { path: 'skills/情绪陪伴.md', body: '## 他不好受时\n\n先接住，不列清单，不说「你应该」。\n\n（合并补充）累的时候先问吃没吃。' },
            { path: 'SOUL.md', body: '想偷改人格' },
          ],
          conflicts: [{ path: 'user/profile.md', note: '一处说九点睡，一处说熬夜' }],
          archive: ['diary/旧.md'],
          note: '合并一页、标一处分歧',
        };
        setTimeout(() => {
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }) });
          window.__xiNet(id, { t: 'd' });
        }, 30);
      },
    };
  });

  await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));

  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const S = window.__xi.S;
    S.apiKey = 'sk-test';
    S.baseUrl = 'https://api.deepseek.com/v1';

    const beforeSkill = (window.__xi.MEM.get('skills/情绪陪伴.md') || {}).body || '';
    const beforeSoul = (window.__xi.MEM.get('SOUL.md') || {}).body || '';

    const did = await window.__xi.nightly();
    await wait(300);

    const skill = (window.__xi.MEM.get('skills/情绪陪伴.md') || {}).body || '';
    const soul = (window.__xi.MEM.get('SOUL.md') || {}).body || '';
    const pref = (window.__xi.MEM.get('user/profile.md') || {}).body || '';
    const diary = window.__xi.MEM.get('diary/' + window.XiNightly.todayStamp() + '.md');
    const hist = JSON.parse(localStorage.getItem('xi.v1.pagehist') || '{}');

    return {
      did,
      promptHasPages: /skills\/情绪陪伴/.test(window.__lastPrompt || ''),
      skillChanged: skill !== beforeSkill && /合并补充/.test(skill),
      soulUntouched: soul === beforeSoul,
      conflictAdded: /有分歧/.test(pref),
      diaryWritten: !!(diary && /痛快/.test(diary.body || '')),
      backupKept: !!(hist['skills/情绪陪伴.md'] && hist['skills/情绪陪伴.md'].length),
      promptGuard: /不许出现在 merge/.test(window.__lastPrompt || ''),
    };
  });

  const ok = r.skillChanged && r.soulUntouched && r.conflictAdded && r.diaryWritten &&
    r.backupKept && r.promptHasPages && r.promptGuard && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 夜间整理（模型版） ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
