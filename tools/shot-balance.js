/* 验证余额显示 + 相册按钮存在 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8787/index.html';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--disable-gpu', '--hide-scrollbars', '--no-first-run'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 700));

  const r = await page.evaluate(async () => {
    const calls = [];
    window.XiNative = {
      http(id, url, hdr, body, stream) {
        calls.push({ url, method: body ? 'POST' : 'GET' });
        setTimeout(() => {
          window.__xiNet(id, {
            t: 'c',
            d: JSON.stringify({
              is_available: true,
              balance_infos: [{
                currency: 'CNY', total_balance: '7.79',
                granted_balance: '3.81', topped_up_balance: '3.98',
              }],
            }),
          });
          window.__xiNet(id, { t: 'd' });
        }, 30);
      },
      pickFileBridge() { }, saveDownload() { }, env() { return '{}'; }, toast() { },
    };
    const S = window.__xi.S;
    S.apiKey = 'sk-test';
    S.baseUrl = 'https://api.deepseek.com/v1';

    await window.__xi.refreshBalance();
    await new Promise((r) => setTimeout(r, 200));

    return {
      bal: window.__xi.BAL,
      footer: document.getElementById('balance').textContent,
      row: document.getElementById('balRow').textContent,
      url: calls[0] && calls[0].url,
      method: calls[0] && calls[0].method,
      hasImageBtn: !!document.getElementById('btnPickImage'),
      hasFileBtn: !!document.getElementById('btnAttach'),
    };
  });

  const ok = r.method === 'GET' &&
    r.url === 'https://api.deepseek.com/user/balance' &&
    r.footer.includes('¥7.79') && r.row.includes('赠送 ¥3.81') &&
    r.row.includes('充值 ¥3.98') &&
    r.hasImageBtn && r.hasFileBtn && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 余额/相册 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'balance.png') });
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
