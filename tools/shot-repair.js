/* 历史结构被接口拒时，自动用最近一条用户消息重发 */
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
    const bodies = [];

    window.XiNative = {
      http(id, url, hdr, payload) {
        if (!/chat\/completions/.test(url)) {
          window.__xiNet(id, { t: 'c', d: '{}' });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        bodies.push(JSON.parse(payload));
        if (bodies.length === 1) {
          window.__xiNet(id, { t: 'e', code: 400, m: 'an assistant message must follow a user message' });
          return;
        }
        window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: '在的' } }] }) });
        window.__xiNet(id, { t: 'c', d: '[DONE]' });
        window.__xiNet(id, { t: 'd' });
      },
      env() { return '{}'; }, pickAttachBridge() { }, pickFileBridge() { },
      saveDownload() { }, toast() { }, copyText() { }, openUrl() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'k'; S.compress = false; S.autoExtract = false;

    // 弄脏历史：开头塞一条 assistant，中间来两条相邻 assistant
    const cur = window.__xi.cur;
    cur.messages.unshift({ role: 'assistant', content: '我是开场白', ts: Date.now() });
    cur.messages.push({ role: 'assistant', content: '孤立的回复', ts: Date.now() + 1 });
    cur.messages.push({ role: 'assistant', content: '又一条', ts: Date.now() + 2 });
    await window.__xi.saveCur();

    document.getElementById('input').value = '在吗';
    await window.__xi.send();
    await wait(900);

    const last = bodies[bodies.length - 1] || { messages: [] };
    const ms = last.messages || [];

    return {
      turns: bodies.length,
      firstRole: ms.length ? ms[0].role : '',
      lastRole: ms.length ? ms[ms.length - 1].role : '',
      repairShort: ms.filter((m) => m.role === 'user' || m.role === 'assistant').length <= 1,
      answered: (window.__xi.cur.messages.filter((m) => m.role === 'assistant').pop() || {}).content === '在的',
    };
  });

  const ok = r.turns >= 2 && r.firstRole === 'system' && r.lastRole === 'user' &&
    r.repairShort && r.answered && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 结构自救 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
