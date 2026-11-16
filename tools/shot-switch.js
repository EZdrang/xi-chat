/* 切走会话/切后台，流式回复不能断 */
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
    const chunks = ['第一段', '第二段', '第三段', '第四段', '第五段'];

    window.XiNative = {
      http(id, url, hdr, body) {
        // 慢速流式：每 220ms 一段
        let i = 0;
        const tick = () => {
          if (i < chunks.length) {
            window.__xiNet(id, { t: 'c', d: JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] }) });
            i++;
            setTimeout(tick, 220);
          } else {
            window.__xiNet(id, { t: 'c', d: JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 60 } }) });
            window.__xiNet(id, { t: 'c', d: '[DONE]' });
            window.__xiNet(id, { t: 'd' });
          }
        };
        setTimeout(tick, 60);
      },
      pickAttachBridge() { }, pickFileBridge() { }, saveDownload() { },
      env() { return '{}'; }, toast() { }, copyText() { }, shareText() { },
    };

    const S = window.__xi.S;
    S.apiKey = 'k';
    S.compress = false;
    S.autoExtract = false;

    const firstId = window.__xi.cur.id;

    // 新建第二条会话
    document.getElementById('btnNew').click();
    await wait(300);
    const secondId = window.__xi.cur.id;

    // 回到第一条
    document.getElementById('btnMenu').click();
    await wait(250);
    const items = [...document.querySelectorAll('.sess')];
    const back = items.find((el) => el.textContent.indexOf('新的对话') < 0) || items[items.length - 1];
    back.click();
    await wait(350);

    // 在第一条里发消息（慢流）
    document.getElementById('input').value = '讲讲切换';
    window.__xi.send();
    await wait(300);          // 流已经开始，但没结束

    const midCount = window.__xi.cur.messages.filter((m) => m.role === 'assistant').length;

    // 切到第二条（模拟用户切走）
    document.getElementById('btnMenu').click();
    await wait(200);
    const others = [...document.querySelectorAll('.sess')];
    const target = others.find((el) => el.dataset && el.getAttribute('data-x') === null && el !== back);
    // 按标题找第二条（新建那条）
    const second = others.find((el) => el.textContent.indexOf('新的对话') >= 0 && el !== back);
    (second || others[0]).click();
    await wait(2200);         // 等流在后台跑完

    // 切回第一条看结果
    document.getElementById('btnMenu').click();
    await wait(220);
    const back2 = [...document.querySelectorAll('.sess')].find((el) => el.textContent.indexOf('讲讲切换') >= 0)
      || [...document.querySelectorAll('.sess')][0];
    back2.click();
    await wait(400);

    const cur = window.__xi.cur;
    const lastAi = [...cur.messages].reverse().find((m) => m.role === 'assistant');
    const full = chunks.join('');

    return {
      firstId, secondId, midCount,
      backToFirst: cur.id === firstId,
      content: lastAi ? lastAi.content : null,
      complete: lastAi ? lastAi.content === full : false,
      usage: lastAi ? lastAi.usage : null,
    };
  });

  const ok = r.backToFirst && r.complete && r.usage && r.usage.p === 100 && errs.length === 0;
  console.log((ok ? '✓' : '✗') + ' 切换不中断 ' + JSON.stringify(r));
  if (errs.length) console.log('   err:', errs[0]);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
