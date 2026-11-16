/* 附件：多选图片 / 大文件只带名 / 不再弹「已添加」 */
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
    const c = document.createElement('canvas');
    c.width = 320; c.height = 240;
    const g = c.getContext('2d');
    g.fillStyle = '#2477c4'; g.fillRect(0, 0, 320, 240);
    g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.fillText('A', 120, 140);
    const b64 = c.toDataURL('image/jpeg').split(',')[1];

    let pickId = null;
    window.XiNative = {
      pickImagesBridge(id) { pickId = id; },
      pickFileBridge(id) { pickId = id; },
      saveDownload() { }, env() { return '{}'; }, toast() { },
    };

    // 1) 多选：模拟相册返回两张
    document.getElementById('btnPickImage').click();
    await new Promise((r) => setTimeout(r, 60));
    window.__xiImagesPicked(pickId, JSON.stringify([
      { name: 'a.jpg', b64 }, { name: 'b.jpg', b64 },
    ]));
    await new Promise((r) => setTimeout(r, 200));
    const multi = document.querySelectorAll('#attachBar .chip').length;

    // 2) 大文件：只带名字
    window.__xi.S && 0;
    document.getElementById('btnAttach').click();
    await new Promise((r) => setTimeout(r, 60));
    window.__xiPickedMeta(pickId, 'big.zip', 12 * 1024 * 1024);
    await new Promise((r) => setTimeout(r, 200));
    const chips = [...document.querySelectorAll('#attachBar .chip .cn')].map((e) => e.textContent);
    const toastText = document.getElementById('toast').textContent;

    // 3) 删掉一个再选一张，确认没有「已添加」提示
    document.querySelector('#attachBar .x').click();
    await new Promise((r) => setTimeout(r, 150));
    const afterRemove = document.querySelectorAll('#attachBar .chip').length;

    document.getElementById('btnPickImage').click();
    await new Promise((r) => setTimeout(r, 60));
    window.__xiImagesPicked(pickId, JSON.stringify([{ name: 'c.jpg', b64 }]));
    await new Promise((r) => setTimeout(r, 250));
    const afterToast = document.getElementById('toast').textContent;

    return {
      multi, chips, toastText, afterToast, afterRemove,
      left: document.querySelectorAll('#attachBar .chip').length,
    };
  });

  const ok = r.multi === 2 && r.chips.includes('big.zip') &&
    !r.toastText.includes('已添加') && !r.afterToast.includes('已添加') &&
    r.afterRemove === 2 && r.left === 3 && errs.length === 0;

  console.log((ok ? '✓' : '✗') + ' 附件 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
