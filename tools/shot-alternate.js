/* 历史里连着的同角色消息必须合并，否则接口 400（图片数组也要合并） */
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
    let body = null;

    window.XiNative = {
      http(id, url, hdr, payload) {
        if (/chat\/completions/.test(url)) {
          body = JSON.parse(payload);
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: '好' } }] }) });
          window.__xiNet(id, { t: 'c', d: '[DONE]' });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        window.__xiNet(id, { t: 'c', d: '{}' });
        window.__xiNet(id, { t: 'd' });
      },
      env() { return '{}'; }, pickAttachBridge() { }, pickFileBridge() { },
      saveDownload() { }, toast() { }, copyText() { }, openUrl() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'k'; S.compress = false; S.autoExtract = false;

    // 造出「两条 user 黏在一起」和「带图 user 后面又来一条 user」
    const cur = window.__xi.cur;
    cur.messages.push({ role: 'user', content: '你现在可以联网了吗', ts: Date.now() });
    cur.messages.push({ role: 'user', content: '什么意思啊', ts: Date.now() + 1 });
    cur.messages.push({
      role: 'user', content: '看看这张',
      images: ['data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA=='],
      ts: Date.now() + 2,
    });
    await window.__xi.saveCur();

    document.getElementById('input').value = '在吗';
    await window.__xi.send();
    await wait(500);

    const ms = (body && body.messages) || [];
    let altOk = true;
    ms.forEach((m, i) => {
      if (m.role === 'assistant' && ms[i + 1] && ms[i + 1].role !== 'user') altOk = false;
      if (m.role === 'user' && ms[i + 1] && ms[i + 1].role === 'user') altOk = false;
    });

    return {
      turns: ms.length,
      altOk,
      lastRole: ms.length ? ms[ms.length - 1].role : '',
      hasAllText: JSON.stringify(ms).includes('什么意思啊') &&
        JSON.stringify(ms).includes('在吗') &&
        JSON.stringify(ms).includes('看看这张'),
      keepsImage: JSON.stringify(ms).includes('data:image/jpeg'),
    };
  });

  const ok = r.altOk && r.lastRole === 'user' && r.hasAllText && r.keepsImage && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 角色交替 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
