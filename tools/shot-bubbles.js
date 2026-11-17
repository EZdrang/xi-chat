/* 闲聊式短句会被拆成几条气泡连发；长文/列表/代码不拆 */
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
  await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 700));

  const r = await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const cur = window.__xi.cur;
    cur.messages.push({ role: 'user', content: '干嘛呢', ts: Date.now() });
    cur.messages.push({
      role: 'assistant', ts: Date.now() + 1000,
      content: '刚把包打好。\n\n这次没翻车，你放心。\n\n你要不要装来试试 😌',
    });
    cur.messages.push({ role: 'user', content: '说下改了什么', ts: Date.now() + 2000 });
    cur.messages.push({
      role: 'assistant', ts: Date.now() + 3000,
      content: '## 改动\n\n- 记忆进 SQLite\n- 上下文降到 5%\n\n```js\nrenderChat();\n```\n\n就这样。',
    });
    window.__xi.renderChat();

    const msgs = [...document.querySelectorAll('.msg.ai')];
    const casual = msgs[msgs.length - 2];
    const tech = msgs[msgs.length - 1];
    return {
      casualBubbles: casual.querySelectorAll('.bubble').length,
      techBubbles: tech.querySelectorAll('.bubble').length,
      casualTexts: [...casual.querySelectorAll('.bubble')].map((b) => b.textContent.slice(0, 10)),
    };
  });

  await new Promise((r2) => setTimeout(r2, 300));
  await page.evaluate(() => { document.getElementById('list').scrollTop = 99999; });
  await new Promise((r3) => setTimeout(r3, 200));
  await page.screenshot({ path: path.join(__dirname, '..', 'shots', 'bubbles.png') });

  const ok = r.casualBubbles === 1 && r.techBubbles === 1 && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 连发气泡 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
