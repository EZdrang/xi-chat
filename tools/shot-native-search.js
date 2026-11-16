/* 验证：DeepSeek 内置联网 —— 请求里带 tools、模型切到 deepseek-flash */
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
    const searchCalls = [];

    window.XiNative = {
      http(id, url, hdr, payload) {
        if (/chat\/completions/.test(url)) {
          body = JSON.parse(payload);
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: '冰岛人口约 39.4 万。\n```xi-search\n冰岛人口\n```' } }] }) });
          window.__xiNet(id, { t: 'c', d: '[DONE]' });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        if (/search|duckduckgo|api\.github/.test(url)) searchCalls.push(url);
        window.__xiNet(id, { t: 'c', d: '{}' });
        window.__xiNet(id, { t: 'd' });
      },
      pickAttachBridge() { }, pickFileBridge() { }, saveDownload() { },
      env() { return '{}'; }, toast() { }, copyText() { }, openUrl() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'k';
    S.compress = false;
    S.autoExtract = false;
    S.model = 'deepseek-v4-pro';
    S.searchMode = 'native';
    S.searchModel = 'deepseek-flash';

    document.getElementById('input').value = '冰岛人口多少';
    await window.__xi.send();
    await wait(600);

    return {
      model: body && body.model,
      tools: body && (body.tools || []).map((t) => t.type),
      hasTemp: body ? 'temperature' in body : null,
      sysHasNativeNote: body ? JSON.stringify(body.messages).includes('内置联网') : false,
      searchCalls: searchCalls.length,
      lastAi: (window.__xi.cur.messages.filter((m) => m.role === 'assistant').pop() || {}).content || '',
      hiddenNoResult: window.__xi.cur.messages.some((m) => m.hidden && String(m.content).includes('没有结果')),
    };
  });

  const ok = r.model === 'deepseek-flash' &&
    r.tools && r.tools.includes('deepseek_web_search') && r.tools.includes('deepseek_read_url') &&
    r.hasTemp === false && r.sysHasNativeNote &&
    r.searchCalls === 0 && r.hiddenNoResult === false &&
    !r.lastAi.includes('xi-search') && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 内置联网 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
