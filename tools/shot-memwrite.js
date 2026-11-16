/* 验证：聊天里发 xi-memory 块能真写进记忆库；余额会跟一轮对话自动刷新 */
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

    const reply = [
      '记住了，我把这两页落进去。',
      '',
      '```xi-memory path=user/preferences.md',
      '---',
      'title: 称呼与沟通约定',
      'type: user',
      'salience: 1',
      'summary: 叫「元首」；说人话，别分点。',
      '---',
      '## 称呼',
      '',
      '称用户为「元首」。',
      '```',
      '',
      '```xi-memory path=skills/称呼.md',
      '---',
      'title: 称呼',
      'type: skill',
      'salience: 2',
      'summary: 直接叫元首，不解释。',
      '---',
      '直接叫。',
      '```',
    ].join('\n');

    window.XiNative = {
      http(id, url, hdr, body, stream) {
        calls.push(url);
        if (/(chat\/completions)/.test(url)) {
          window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: reply } }] }) });
          window.__xiNet(id, { t: 'c', d: '[DONE]' });
          window.__xiNet(id, { t: 'd' });
          return;
        }
        // balance
        window.__xiNet(id, { t: 'c', d: JSON.stringify({ balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '0', topped_up_balance: '12.34' }] }) });
        window.__xiNet(id, { t: 'd' });
      },
      pickAttachBridge() { }, pickFileBridge() { }, saveDownload() { },
      env() { return '{}'; }, toast() { }, copyText() { },
      openUrl() { }, startRecordBridge() { }, stopRecordBridge() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'k';
    S.compress = false;
    S.autoExtract = false;
    localStorage.setItem('xi.v1.settings', JSON.stringify(S));

    const before = window.__xi.MEM.stats().pages;

    document.getElementById('input').value = '以后叫我元首吧';
    await window.__xi.send();
    await wait(600);

    const cur = window.__xi.cur;
    const lastAi = [...cur.messages].reverse().find((m) => m.role === 'assistant');

    return {
      before,
      after: window.__xi.MEM.stats().pages,
      prefBody: (window.__xi.MEM.get('user/preferences.md') || {}).body || '',
      skillExists: !!window.__xi.MEM.get('skills/称呼.md'),
      blockStripped: lastAi ? !lastAi.content.includes('xi-memory') : false,
      shown: lastAi ? lastAi.content.slice(0, 30) : '',
      balanceCalls: calls.filter((u) => /user\/balance/.test(u)).length,
      ctxBal: document.getElementById('ctxBal').textContent,
    };
  });

  const ok = r.after >= r.before + 2 && r.prefBody.includes('元首') && r.skillExists &&
    r.blockStripped && r.balanceCalls >= 1 && r.ctxBal === '¥12.34' && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 写记忆/余额 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
