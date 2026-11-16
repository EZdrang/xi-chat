/* 验证：贴底跟读（自己滑就不抢）+ xi-find 搜索回环 + 回复完刷余额 */
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

    const longReply = Array.from({ length: 40 }, (_, i) => '第 ' + (i + 1) + ' 行内容，用来把页面撑长。').join('\n');

    window.XiNative = {
      http(id, url, hdr, body, stream) {
        calls.push({ url, body: body ? JSON.parse(body) : null });
        if (/search\/repositories/.test(url)) {
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ items: [
            { full_name: 'someone/emotion-skill', stargazers_count: 42, description: '情感分析 skill' },
          ] }) });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        if (/user\/balance/.test(url)) {
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ balance_infos: [{ currency: 'CNY', total_balance: '9.99' }] }) });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        turn++;
        const text = turn === 1
          ? longReply + '\n```xi-find\n情感分析 skill\n```'
          : '搜到了 someone/emotion-skill，我装它。';
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

    const list = document.getElementById('list');

    // 1) 没碰屏幕：发一条，回复很长，应该自己滚到底
    document.getElementById('input').value = '帮我找个情感分析的 skill';
    await window.__xi.send();
    await wait(900);

    const followed = Math.abs(list.scrollHeight - list.scrollTop - list.clientHeight) < 90;

    // 2) 手动往上滑：再发一条，不该被拽走
    list.scrollTop = 0;
    await wait(120);
    const afterScrollTop = list.scrollTop;

    document.getElementById('input').value = '再来一条';
    await window.__xi.send();
    await wait(900);
    const stayed = Math.abs(list.scrollTop - afterScrollTop) < 90;

    const cur = window.__xi.cur;
    const hidden = cur.messages.filter((m) => m.hidden);

    return {
      followed,
      stayed,
      hiddenCount: hidden.length,
      hiddenHasResult: hidden.some((m) => String(m.content).includes('emotion-skill')),
      chatTurns: calls.filter((c) => /chat\/completions/.test(c.url)).length,
      searchCalls: calls.filter((c) => /search\/repositories/.test(c.url)).length,
      balCalls: calls.filter((c) => /user\/balance/.test(c.url)).length,
      ctxBal: document.getElementById('ctxBal').textContent,
    };
  });

  const ok = r.followed && r.stayed && r.hiddenCount >= 1 && r.hiddenHasResult &&
    r.searchCalls >= 1 && r.chatTurns >= 3 && r.balCalls >= 1 && r.ctxBal === '¥9.99' && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 跟读/搜索/余额 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
