/* 处境按需：不问就不读、不塞；问了她也能自己要是 */
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
    let envCalls = 0;
    let turn = 0;

    window.XiNative = {
      http(id, url, hdr, payload) {
        if (/chat\/completions/.test(url)) {
          const body = JSON.parse(payload);
          bodies.push(body);
          turn++;
          const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === 'user') || {};
          const gotCtx = JSON.stringify(body.messages).includes('此刻的处境');
          const text = (!gotCtx && String(lastUser.content || '').indexOf('你感觉') >= 0)
            ? '好，我看看。\n```xi-context\n```'
            : '嗯，我在。';
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: text } }] }) });
          window.__xiNet(id, { t: 'c', d: '[DONE]' });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        window.__xiNet(id, { t: 'c', d: '{}' });
        window.__xiNet(id, { t: 'd' });
      },
      env() {
        envCalls++;
        return JSON.stringify({
          sdk: 34, device: 'Xiaomi 2211133C', now: Date.now(), tz: 'Asia/Shanghai',
          battery: 40, charging: false, net: 'wifi', steps: 120, screenMin: 30,
        });
      },
      pickAttachBridge() { }, pickFileBridge() { }, saveDownload() { },
      toast() { }, copyText() { }, openUrl() { }, askLocation() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'k';
    S.compress = false;
    S.autoExtract = false;
    S.envOn = true;

    // 1) 普通寒暄：不该读设备、不该塞处境
    document.getElementById('input').value = '我今天有点累';
    await window.__xi.send();
    await wait(400);
    const plainEnvMsg = JSON.stringify(bodies[0].messages).includes('此刻');
    const callsAfterPlain = envCalls;

    // 2) 问时间：应该注入
    document.getElementById('input').value = '现在几点了';
    await window.__xi.send();
    await wait(400);
    const timeEnvMsg = JSON.stringify(bodies[1].messages).includes('此刻');
    const callsAfterAsk = envCalls;

    // 3) 她自己要：xi-context 回环
    document.getElementById('input').value = '你感觉我在干嘛';
    await window.__xi.send();
    await wait(900);
    const hidden = window.__xi.cur.messages.filter((m) => m.hidden);
    const ctxMsg = hidden.filter((m) => String(m.content).includes('此刻的处境'));

    return {
      plainEnvMsg,
      callsAfterPlain,
      timeEnvMsg,
      callsAfterAsk,
      turns: bodies.length,
      ctxHidden: ctxMsg.length,
      ctxHasSteps: ctxMsg.some((m) => String(m.content).includes('今日步数 120')),
      lastHasCtxNote: JSON.stringify(bodies[bodies.length - 1].messages).includes('此刻的处境'),
    };
  });

  const ok = r.plainEnvMsg === false && r.callsAfterPlain === 0 &&
    r.timeEnvMsg === true && r.callsAfterAsk === 1 &&
    r.ctxHidden === 1 && r.ctxHasSteps && r.lastHasCtxNote && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 按需处境 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
