/* 验证：内置联网时 —— 不空转本地搜索、不吞掉她的「稍等」、消息角色必须交替 */
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
    const searchCalls = [];
    let turn = 0;

    window.XiNative = {
      http(id, url, hdr, payload) {
        if (/chat\/completions/.test(url)) {
          bodies.push(JSON.parse(payload));
          turn++;
          const text = turn === 1
            ? '冰岛人口大约 39.4 万，数据来自统计局 2026 年初的估算。'
            : (turn === 2
              ? '我去搜一下，稍等。\n```xi-search\n冰岛人口\n```'
              : '能，服务端在搜，直接问我哪种就行。');
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: text } }] }) });
          window.__xiNet(id, { t: 'c', d: '[DONE]' });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        if (/search|duckduckgo|api\.github/.test(url)) searchCalls.push(url);
        window.__xiNet(id, { t: 'c', d: '{}' });
        window.__xiNet(id, { t: 'd' });
      },
      env() { return JSON.stringify({ sdk: 34, device: 'Xiaomi', now: Date.now(), tz: 'Asia/Shanghai' }); },
      pickAttachBridge() { }, pickFileBridge() { }, saveDownload() { },
      toast() { }, copyText() { }, openUrl() { }, askLocation() { }, askActivity() { },
      openUsageSettings() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'k';
    S.compress = false;
    S.autoExtract = false;
    S.model = 'deepseek-v4-pro';
    S.searchMode = 'native';
    S.searchModel = 'deepseek-flash';

    // 第一轮：她多说了句结论，直接结束
    document.getElementById('input').value = '冰岛人口多少';
    await window.__xi.send();
    await wait(600);
    const first = bodies[0] || { messages: [] };

    // 第二轮：她只说「稍等」，App 得把她推回来继续答
    bodies.length = 0;
    document.getElementById('input').value = '现在能不能搜索';
    await window.__xi.send();
    await wait(800);

    const second = bodies[bodies.length - 1] || { messages: [] };
    const secondLast = second.messages[second.messages.length - 1] || {};

    let altOk = true;
    bodies.concat(first.messages ? [first] : []).forEach((b) => {
      const ms = b.messages || [];
      ms.forEach((m, i) => {
        if (m.role === 'assistant' && ms[i + 1] && ms[i + 1].role !== 'user') altOk = false;
      });
    });

    const lastAi = (window.__xi.cur.messages.filter((m) => !m.hidden && m.role === 'assistant').pop() || {});

    return {
      model: first.model,
      tools: (first.tools || []).map((t) => t.type),
      hasTemp: first ? 'temperature' in first : null,
      sysHasNativeNote: JSON.stringify(first.messages || []).includes('内置联网'),
      searchCalls: searchCalls.length,
      altOk,
      secondTurns: bodies.length,
      secondLastRole: secondLast.role || '',
      pushedBack: String(secondLast.content || '').includes('App 注入'),
      finalAi: String(lastAi.content || '').slice(0, 30),
      noDirectiveLeft: !String(lastAi.content || '').includes('xi-search'),
    };
  });

  const ok = r.model === 'deepseek-flash' &&
    r.tools.includes('deepseek_web_search') && r.tools.includes('deepseek_read_url') &&
    r.hasTemp === false && r.sysHasNativeNote && r.searchCalls === 0 && r.altOk &&
    r.secondTurns >= 2 && r.secondLastRole === 'user' && r.pushedBack &&
    r.noDirectiveLeft && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 内置联网 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
