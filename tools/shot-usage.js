/* 用量页 + 语音按钮 的视觉检查 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8787/index.html';
const OUT = path.join(__dirname, '..', 'shots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--disable-gpu', '--hide-scrollbars', '--no-first-run'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });

  let bad = 0;
  const report = (ok, name, extra) => {
    if (!ok) bad++;
    console.log((ok ? '✓' : '✗') + ' ' + name.padEnd(8) + JSON.stringify(extra));
  };

  // 用量页
  {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE + '?demo&view=usage', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: path.join(OUT, 'usage.png') });
    const st = await page.evaluate(() => ({
      rows: document.querySelectorAll('#usageBody .urow').length,
      hasRate: document.getElementById('usageBody').innerText.includes('缓存命中率'),
      headHasRate: document.getElementById('ctxUsage').textContent.includes('缓存'),
    }));
    report(st.rows >= 6 && st.hasRate && st.headHasRate && !errs.length, 'usage', st);
    if (errs.length) console.log('   ', errs[0]);
    await page.close();
  }

  // 消息里的用量标记 + 语音按钮
  {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: path.join(OUT, 'chat.png') });
    const st = await page.evaluate(() => ({
      ug: document.querySelectorAll('.ug').length,
      ugText: (document.querySelector('.ug') || {}).textContent,
      mic: !!document.getElementById('btnVoice'),
    }));
    report(st.ug === 1 && st.mic && !errs.length, 'chat', st);
    if (errs.length) console.log('   ', errs[0]);

    // 语音：伪造原生桥，点麦克风应进入 listening
    const v = await page.evaluate(async () => {
      window.XiNative = { voiceBridge(id) { window.__vid = id; }, toast() { } };
      document.getElementById('btnVoice').click();
      const listening = document.getElementById('btnVoice').classList.contains('listening');
      window.__xiVoice(window.__vid, '帮我看下今天的记忆');
      await new Promise((r) => setTimeout(r, 200));
      return { listening, value: document.getElementById('input').value };
    });
    report(v.listening && v.value.includes('记忆'), 'voice', v);
    await page.close();
  }

  await browser.close();
  console.log(bad ? '\n有 ' + bad + ' 项失败' : '\n通过');
  process.exit(bad ? 1 : 0);
})();
