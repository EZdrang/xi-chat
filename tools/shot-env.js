/* 验证：此刻的处境（时间/电量/网络/位置）进到提示里 */
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
    const now = Date.now();

    window.XiNative = {
      http(id, url, hdr, payload) {
        if (/chat\/completions/.test(url)) {
          body = JSON.parse(payload);
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: '现在早上六点多。' } }] }) });
          window.__xiNet(id, { t: 'c', d: '[DONE]' });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        window.__xiNet(id, { t: 'c', d: '{}' });
        window.__xiNet(id, { t: 'd' });
      },
      env() {
        return JSON.stringify({
          sdk: 34, device: 'Xiaomi 2211133C', now, tz: 'Asia/Shanghai',
          battery: 84, charging: true, net: 'cellular',
          lat: 31.23, lon: 121.47, acc: 45, fixAge: 2, hasLocationPerm: true,
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

    document.getElementById('input').value = '现在几点了';
    await window.__xi.send();
    await wait(500);

    const sys = (body.messages || []).filter((m) => m.role === 'system').map((m) => String(m.content));
    const envMsg = sys.find((c) => c.includes('此刻')) || '';

    return {
      hasEnv: !!envMsg,
      hasTime: /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(envMsg),
      hasWeek: /周[日一二三四五六]/.test(envMsg),
      hasBattery: envMsg.includes('电量 84%'),
      hasCharging: envMsg.includes('充电中'),
      hasNet: envMsg.includes('cellular'),
      hasLoc: envMsg.includes('31.23') && envMsg.includes('±45'),
      text: envMsg.slice(0, 120),
    };
  });

  const ok = r.hasEnv && r.hasTime && r.hasWeek && r.hasBattery && r.hasCharging &&
    r.hasNet && r.hasLoc && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 处境 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
