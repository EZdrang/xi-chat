/* 联网自检：把接口、模型、搜索模式和服务端工具用量摊出来 */
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
          window.__xiNet(id, { t: 'c', d: JSON.stringify({
            choices: [{ message: { role: 'assistant', content: '现在是 2026 年 11 月 17 日早上六点多。' } }],
            usage: { server_tool_use: { web_search_requests: 1, tool_search: 1 } },
          }) });
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
    S.apiKey = 'k';
    S.searchMode = 'native';
    S.searchModel = 'deepseek-flash';
    S.baseUrl = 'https://api.deepseek.com/v1';

    document.getElementById('btnSelfCheck').click();
    await wait(900);

    const dlg = document.querySelector('.dialog, .modal, #dlg');
    return {
      hasBody: !!body,
      model: body && body.model,
      tools: body && (body.tools || []).map((t) => t.type),
      dlgText: dlg ? dlg.textContent.slice(0, 200) : document.body.textContent.slice(-300),
    };
  });

  const ok = r.hasBody && r.model === 'deepseek-flash' &&
    r.tools.includes('deepseek_web_search') &&
    /结果：成功/.test(r.dlgText) && /web_search_requests/.test(r.dlgText) &&
    errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 自检 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
