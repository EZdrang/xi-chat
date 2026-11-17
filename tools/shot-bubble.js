/* 看一眼她的气泡长什么样：浅色 + 深色 */
const puppeteer = require('puppeteer-core');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8787/index.html';

async function shot(theme, file) {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--disable-gpu', '--hide-scrollbars', '--no-first-run'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 700));

  await page.evaluate((th) => {
    const S = window.__xi.S;
    S.theme = th;
    document.documentElement.setAttribute('data-theme', th === 'dark' ? 'dark' : 'light');

    const cur = window.__xi.cur;
    cur.messages.push({ role: 'user', content: '今天能跑了吗', ts: Date.now() });
    cur.messages.push({
      role: 'assistant',
      ts: Date.now() + 1000,
      content: [
        '## 跑起来了',
        '',
        '包我**重新打了一遍**，这次重点修的是 *上下文* 那块——之前是每轮都塞，现在改成按需。',
        '',
        '> 顺手记一句：坏消息先给事实，再谈感受。',
        '',
        '- 上下文从 15% 降到 5%',
        '- 搜索走服务端，带引用',
        '- 图片不再被接口拒',
        '',
        '关键那行是 `renderChat()`，改完刷新就生效：',
        '',
        '```js',
        'if (stickBottom) list.scrollTop = list.scrollHeight;',
        '```',
        '',
        '你要是觉得哪里别扭，[告诉我](https://example.com) 就行。',
      ].join('\n'),
    });
    window.__xi.renderChat();
  }, theme);

  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => { document.getElementById('list').scrollTop = 99999; });
  await new Promise((r) => setTimeout(r, 200));
  const out = path.join(__dirname, '..', 'shots', file);
  await page.screenshot({ path: out });
  await browser.close();
  return { out, errs };
}

(async () => {
  const a = await shot('light', 'ai-light.png');
  const b = await shot('dark', 'ai-dark.png');
  console.log('light', a.out, a.errs.length ? a.errs[0] : '');
  console.log('dark', b.out, b.errs.length ? b.errs[0] : '');
})();
