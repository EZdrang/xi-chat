/* 验证：xi-search 走真搜索接口，结果回喂后她继续作答 */
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
    const calls = [];
    let turn = 0;

    window.XiNative = {
      http(id, url, hdr, body, stream) {
        const h = JSON.parse(hdr || '{}');
        calls.push({ url, hdr: h, body: body ? JSON.parse(body) : null });
        if (/search\.example\.com/.test(url)) {
          window.__xiNet(id, { t: 'c', d: JSON.stringify({
            web_pages: [
              { title: '龙餐馆 上映时间', url: 'https://example.com/a', snippet: '2026年8月11日上映' },
              { title: '延期消息', url: 'https://example.com/b', snippet: '延期到11月13日' },
            ],
          }) });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        if (/user\/balance/.test(url)) {
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ balance_infos: [{ currency: 'CNY', total_balance: '1.00' }] }) });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        turn++;
        const text = turn === 1
          ? '我去查一下。\n```xi-search\n龙餐馆 上映时间\n```'
          : '查到两部说法：2026年8月11日上映，后来延期到11月13日。（来源：example.com/a）';
        window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: text } }] }) });
        window.__xiNet(id, { t: 'c', d: '[DONE]' });
        window.__xiNet(id, { t: 'd' });
      },
      pickAttachBridge() { }, pickFileBridge() { }, saveDownload() { },
      env() { return '{}'; }, toast() { }, copyText() { }, openUrl() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'k';
    S.compress = false;
    S.autoExtract = false;
    S.searchMode = 'custom';
    S.searchUrl = 'https://search.example.com/v1/search';
    S.searchKey = 'sk-search';

    document.getElementById('input').value = '龙餐馆什么时候上映';
    await window.__xi.send();
    await wait(1200);

    const cur = window.__xi.cur;
    const hidden = cur.messages.filter((m) => m.hidden);
    const lastAi = [...cur.messages].reverse().find((m) => m.role === 'assistant');
    const searchCall = calls.find((c) => /search\.example/.test(c.url));

    return {
      chatTurns: calls.filter((c) => /chat\/completions/.test(c.url)).length,
      searchHit: !!searchCall,
      keySent: searchCall ? (searchCall.hdr.Authorization || '') : '',
      hiddenHasSnippet: hidden.some((m) => String(m.content).includes('8月11日')),
      finalText: lastAi ? lastAi.content.slice(0, 40) : '',
      noDirective: lastAi ? !lastAi.content.includes('xi-search') : false,
    };
  });

  const ok = r.chatTurns >= 2 && r.searchHit && r.keySent === 'Bearer sk-search' &&
    r.hiddenHasSnippet && r.noDirective && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 联网搜索 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
