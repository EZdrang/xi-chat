/* [[img:xxx]] 会去网上搜一张真图；搜不到显示一行小字 */
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

  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const asked = [];

    // 假网：safebooru 返回一张图，openverse 返回另一张
    window.XiNative = {
      http(id, url) {
        asked.push(url);
        setTimeout(() => {
          if (/safebooru/.test(url)) {
            window.__xiNet(id, { t: 'c', d: JSON.stringify([
              { sample_url: 'https://safebooru.org/images/aa/bb.jpg', file_url: '/images/aa/bb.jpg' },
            ]) });
          } else if (/openverse/.test(url)) {
            window.__xiNet(id, { t: 'c', d: JSON.stringify({ results: [{ thumbnail: 'https://live.staticflickr.com/x.jpg' }] }) });
          } else {
            window.__xiNet(id, { t: 'c', d: '[]' });
          }
          window.__xiNet(id, { t: 'd' });
        }, 30);
      },
      env() { return '{}'; }, pickAttachBridge() { }, pickFileBridge() { },
      saveDownload() { }, toast() { }, copyText() { }, openUrl() { },
    };

    document.documentElement.setAttribute('data-theme', 'dark');
    const cur = window.__xi.cur;
    cur.messages.push({ role: 'user', content: '来张表示你无语的图', ts: Date.now() });
    cur.messages.push({
      role: 'assistant', ts: Date.now() + 1000,
      content: '行，给你找一个。\n\n[[img:smug anime girl]]\n\n就这个表情，不用我多说。',
    });
    window.__xi.renderChat();
    await wait(500);

    const imgs = [...document.querySelectorAll('.md .md-img')].map((i) => i.getAttribute('src'));
    return { asked: asked.filter((u) => /safebooru|openverse/.test(u)).length, imgs };
  });

  await new Promise((r2) => setTimeout(r2, 300));
  await page.screenshot({ path: path.join(__dirname, '..', 'shots', 'webimg.png') });

  const ok = r.asked >= 1 && r.imgs.length === 1 &&
    r.imgs[0].indexOf('safebooru') >= 0 && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 网上找图 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
