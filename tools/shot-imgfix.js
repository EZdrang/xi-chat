/* 坏图不拖死会话：发之前筛掉；真被接口拒了就剥图重试一次 */
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
    let mode = 'reject';

    window.XiNative = {
      http(id, url, hdr, payload) {
        if (!/chat\/completions/.test(url)) {
          window.__xiNet(id, { t: 'c', d: '{}' });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        const b = JSON.parse(payload);
        bodies.push(b);
        if (mode === 'reject' && bodies.length === 1) {
          window.__xiNet(id, { t: 'e', code: 400, m: 'You have uploaded an unsupported image.' });
          return;
        }
        window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: '看到了' } }] }) });
        window.__xiNet(id, { t: 'c', d: '[DONE]' });
        window.__xiNet(id, { t: 'd' });
      },
      env() { return '{}'; }, pickAttachBridge() { }, pickFileBridge() { },
      saveDownload() { }, toast() { }, copyText() { }, openUrl() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'k'; S.compress = false; S.autoExtract = false;

    // 往历史里塞一张「坏格式」图（旧版本留下的典型形式）
    const cur = window.__xi.cur;
    cur.messages.push({
      role: 'user',
      content: '她好看吗',
      images: ['data:application/octet-stream;base64,AAAA'],
      ts: Date.now(),
    });
    await window.__xi.saveCur();

    document.getElementById('input').value = '继续';
    await window.__xi.send();
    await wait(800);

    const imgsIn = (b) => (b.messages || []).reduce((n, m) => {
      if (Array.isArray(m.content)) return n + m.content.filter((p) => p.type === 'image_url').length;
      return n;
    }, 0);

    return {
      turns: bodies.length,
      badImageSent: bodies.some((b) => JSON.stringify(b).includes('application/octet-stream')),
      imgsFirst: bodies[0] ? imgsIn(bodies[0]) : -1,
      imgsLast: bodies[bodies.length - 1] ? imgsIn(bodies[bodies.length - 1]) : -1,
      survived: (window.__xi.cur.messages.filter((m) => m.role === 'assistant').pop() || {}).content === '看到了',
    };
  });

  const ok = r.turns >= 2 && r.badImageSent === false && r.imgsFirst === 0 &&
    r.imgsLast === 0 && r.survived && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 坏图自救 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
