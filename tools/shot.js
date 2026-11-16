/* 真浏览器验收：截图 + 附件 + 改名 + 记忆同步全链路 */
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
  async function open(q) {
    const page = await browser.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await page.goto(BASE + q, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 600));
    return { page, errs };
  }
  const shoot = (page, n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const report = (ok, name, extra, errs) => {
    if (!ok) bad++;
    console.log((ok ? '✓' : '✗') + ' ' + name.padEnd(9) + JSON.stringify(extra));
    if (errs && errs.length) errs.slice(0, 5).forEach((e) => console.log('    ' + e));
  };

  // 1) 聊天
  {
    const { page, errs } = await open('?demo');
    await shoot(page, 'chat');
    const st = await page.evaluate(() => ({
      msgs: document.querySelectorAll('#msgs .msg').length,
      ava: !!document.querySelector('.msg.ai .ava img'),
      tsub: document.getElementById('tSub').textContent,
    }));
    report(st.msgs === 5 && st.ava && !errs.length, 'chat', st, errs);
    await page.close();
  }

  // 2) 记忆库
  {
    const { page, errs } = await open('?demo&view=mem');
    await shoot(page, 'memory');
    const st = await page.evaluate(() => ({
      pages: document.querySelectorAll('#pages .page-item').length,
      importBtn: !!document.getElementById('btnImport'),
    }));
    report(st.pages >= 4 && st.importBtn && !errs.length, 'memory', st, errs);
    await page.close();
  }

  // 3) 设置
  {
    const { page, errs } = await open('?view=set');
    await shoot(page, 'settings');
    const st = await page.evaluate(() => ({
      base: document.getElementById('fBase').value,
      aiMerge: document.getElementById('fAiMerge').checked,
    }));
    report(!!st.base && !errs.length, 'settings', st, errs);
    await page.close();
  }

  // 4) 发图片：选图 → 缩图 → chip
  {
    const { page, errs } = await open('');
    const r = await page.evaluate(async () => {
      window.XiNative = {
        pickFileBridge(id) { window.__p = id; },
        env() { return JSON.stringify({ sdk: 34, device: 'Pixel-Test' }); },
        toast() { },
      };
      document.getElementById('btnAttach').click();
      const id = window.__p;
      const c = document.createElement('canvas');
      c.width = 900; c.height = 600;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 900, 600);
      grd.addColorStop(0, '#2477c4');
      grd.addColorStop(1, '#a6d8f7');
      g.fillStyle = grd; g.fillRect(0, 0, 900, 600);
      g.fillStyle = '#fff'; g.font = 'bold 96px sans-serif';
      g.fillText('肥鱼', 300, 340);
      const b64 = c.toDataURL('image/png').split(',')[1];
      await window.__xiPicked(id, '测试图.png', b64);
      await new Promise((r) => setTimeout(r, 700));
      const img = document.querySelector('#attachBar .chip img');
      return {
        chips: document.querySelectorAll('#attachBar .chip').length,
        hasPreview: !!img,
        previewKind: img ? img.src.slice(0, 22) : '',
      };
    });
    await shoot(page, 'attach');
    report(r.chips === 1 && r.hasPreview && r.previewKind.startsWith('data:image/jpeg'), 'attach', r, errs);
    await page.close();
  }

  // 5) 会话改名
  {
    const { page, errs } = await open('?demo');
    await page.evaluate(async () => {
      document.getElementById('btnMenu').click();
      await new Promise((r) => setTimeout(r, 320));
      document.querySelector('.sess .sx').click();
      await new Promise((r) => setTimeout(r, 320));
    });
    await shoot(page, 'session-menu');
    const r = await page.evaluate(async () => {
      const items = [...document.querySelectorAll('[data-list] > div')];
      const rename = items.find((x) => x.textContent === '改名');
      if (!rename) return { err: 'no 改名' };
      rename.click();
      await new Promise((r) => setTimeout(r, 320));
      const inp = document.querySelector('[data-in]');
      if (!inp) return { err: 'no input' };
      inp.value = '手机版的我 v2';
      [...document.querySelectorAll('button[data-v]')].find((b) => b.dataset.v === '1').click();
      await new Promise((r) => setTimeout(r, 600));
      return {
        title: document.getElementById('tMain').textContent,
        listTitle: (document.querySelector('.sess .st') || {}).textContent,
      };
    });
    await shoot(page, 'renamed');
    report(r.title === '手机版的我 v2' && r.listTitle === '手机版的我 v2', 'rename', r, errs);
    await page.close();
  }

  // 6) 记忆同步：导入 → 差异预览 → 应用
  {
    const { page, errs } = await open('');
    const r = await page.evaluate(async () => {
      window.XiNative = {
        pickFileBridge(id) { window.__pick = id; },
        env() { return JSON.stringify({ sdk: 34, device: 'Pixel-Test' }); },
        toast() { },
      };
      document.getElementById('btnMem').click();
      await new Promise((r) => setTimeout(r, 220));
      document.getElementById('btnImport').click();
      await new Promise((r) => setTimeout(r, 120));
      const id = window.__pick;

      const dec = new TextDecoder();
      const snap = MEM.exportFiles('电脑').map((f) => ({ path: f.path, text: dec.decode(f.data) }));
      snap.find((e) => e.path === 'user/profile.md').text += '\n- 电脑上新增：喜欢深夜写东西';
      snap.push({
        path: 'projects/xi-chat.md',
        text: '---\ntitle: 汐聊天 App\ntype: project\nsalience: 1\nsummary: 手机版汐的施工进度\n---\n\n### 进展\n- APK 已能构建\n- 记忆可导出为 zip',
      });
      const bytes = ZIP.create(snap.map((e) => ({ path: e.path, data: new TextEncoder().encode(e.text) })));
      let s = '';
      for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      window.__xiPicked(id, '汐-记忆.zip', btoa(s));
      await new Promise((r) => setTimeout(r, 700));
      const dlg = [...document.querySelectorAll('body > div')].find((d) => d.style.zIndex === '99');
      return { text: dlg ? dlg.innerText.replace(/\s+/g, ' ').slice(0, 160) : '' };
    });
    await shoot(page, 'sync');
    const applied = await page.evaluate(async () => {
      const btn = document.querySelector('button[data-v="1"]');
      if (!btn) return { ok: false };
      btn.click();
      await new Promise((res) => setTimeout(res, 800));
      return {
        ok: true,
        pages: window.MEM.stats().pages,
        newPage: !!window.MEM.get('projects/xi-chat.md'),
        profileMerged: window.MEM.get('user/profile.md').body.includes('深夜写东西'),
      };
    });
    report(applied.ok && applied.newPage && applied.profileMerged && !errs.length, 'sync', applied, errs);
    await page.close();
  }

  await browser.close();
  console.log(bad ? '\n有 ' + bad + ' 项失败' : '\n全部通过');
  process.exit(bad ? 1 : 0);
})();
