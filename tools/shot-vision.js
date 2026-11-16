/* 带图消息的请求体：必须是 multimodal，且能切到视觉模型 */
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
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#e33'; g.fillRect(0, 0, 200, 200);
    const b64 = c.toDataURL('image/jpeg').split(',')[1];

    const calls = [];
    let pickId = null;
    window.XiNative = {
      http(id, url, hdr, body, stream) {
        calls.push(JSON.parse(body || '{}'));
        setTimeout(() => {
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: '看到了' } }] }) });
          window.__xiNet(id, { t: 'c', d: '[DONE]' });
          window.__xiNet(id, { t: 'd' });
        }, 20);
      },
      pickAttachBridge(id) { pickId = id; },
      pickFileBridge(id) { pickId = id; },
      saveDownload() { }, env() { return '{}'; }, toast() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'k';
    S.model = 'deepseek-chat';
    S.visionModel = 'gpt-4o-mini';

    // 选一张图（分块投递）
    document.getElementById('btnPickImage').click();
    await new Promise((r) => setTimeout(r, 60));
    window.__xiFileStart(pickId, 'shot.jpg', 'image/jpeg', 1, b64.length);
    window.__xiFileChunk(pickId, 0, b64);
    window.__xiFileEnd(pickId);
    await new Promise((r) => setTimeout(r, 300));

    // 发出去
    document.getElementById('input').value = '这张图什么内容';
    await window.__xi.send();
    await new Promise((r) => setTimeout(r, 200));

    const body = calls[0] || {};
    const userMsg = (body.messages || []).filter((m) => m.role === 'user').pop();
    return {
      model: body.model,
      contentType: Array.isArray(userMsg && userMsg.content) ? 'array' : typeof (userMsg && userMsg.content),
      parts: Array.isArray(userMsg && userMsg.content)
        ? userMsg.content.map((p) => p.type)
        : [],
      imgPrefix: Array.isArray(userMsg && userMsg.content)
        ? String((userMsg.content.find((p) => p.type === 'image_url') || {}).image_url && 'ok') +
          ':' + String(((userMsg.content.find((p) => p.type === 'image_url') || {}).image_url || {}).url || '').slice(0, 22)
        : '',
      lastMsgHasImages: !!(window.__xi.cur.messages[window.__xi.cur.messages.length - 2] || {}).images,
    };
  });

  const ok = r.model === 'gpt-4o-mini' && r.contentType === 'array' &&
    r.parts.includes('text') && r.parts.includes('image_url') &&
    r.imgPrefix.startsWith('ok:data:image/jpeg') && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 视觉消息 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
