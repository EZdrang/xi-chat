/* 端到端验证「自动上下文压缩」：造长对话 + 假接口，看它是否真的摘要并替换 */
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
  await new Promise((r) => setTimeout(r, 600));

  const r = await page.evaluate(async () => {
    const calls = [];
    window.XiNative = {
      http(id, url, hdr, body, stream) {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch (e) { }
        calls.push({ stream: !!stream, body: b });
        if (stream) {
          setTimeout(() => {
            window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: '收到，压缩过了。' } }] }) });
            window.__xiNet(id, { t: 'c', d: '[DONE]' });
            window.__xiNet(id, { t: 'd' });
          }, 20);
        } else {
          setTimeout(() => {
            window.__xiNet(id, {
              t: 'c',
              d: JSON.stringify({
                choices: [{ message: { content: '【摘要】前文：手机版汐的构建、皮肤与记忆同步方案。' } }],
                usage: { prompt_tokens: 900, completion_tokens: 40, prompt_cache_hit_tokens: 600 },
              }),
            });
            window.__xiNet(id, { t: 'd' });
          }, 20);
        }
      },
      saveDownload() { }, env() { return '{}'; }, toast() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'test-key';
    S.compress = true;
    S.ctxWindow = 1000;      // 故意压到很小
    S.keep = 1;              // 只留最近 1 条

    const cur = window.__xi.cur;
    // 塞几条长消息，保证超阈值
    for (let i = 0; i < 4; i++) {
      cur.messages.push({ role: 'user', content: '第' + i + '段：' + '很长的上下文内容'.repeat(40) });
      cur.messages.push({ role: 'assistant', content: '回应' + i + '：' + '也写得很长'.repeat(40) });
    }
    const before = cur.messages.length;

    document.getElementById('input').value = '再聊聊压缩';
    const t0 = Date.now();
    await window.__xi.send();
    const ms = Date.now() - t0;

    return {
      before,
      after: cur.messages.length,
      summary: cur.summary || '',
      notes: cur.messages.filter((m) => m.role === 'note').map((m) => m.text),
      compressCalls: calls.filter((c) => !c.stream).length,
      chatCalls: calls.filter((c) => c.stream).length,
      chatHasSummary: calls.filter((c) => c.stream).some((c) =>
        JSON.stringify(c.body).includes('早前对话的压缩摘要')),
      chatHasConvSummary: calls.filter((c) => c.stream).some((c) =>
        JSON.stringify(c.body).includes('前文：手机版汐')),
      ctxText: document.getElementById('ctxUsage').textContent,
      lastNote: (cur.messages.find((m) => m.role === 'note') || {}).text,
      ms,
    };
  });

  const ok = r.compressCalls === 1 && r.chatCalls === 1 &&
    r.summary.includes('摘要') &&
    r.notes.some((n) => n.indexOf('已压缩') >= 0) &&
    r.after < r.before && r.chatHasSummary && r.chatHasConvSummary && !errs.length;

  console.log((ok ? '✓' : '✗') + ' 压缩 ' + JSON.stringify(r, null, 0));
  if (errs.length) console.log('   err:', errs[0]);
  await page.screenshot({ path: 'shots/compressed.png' });
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
