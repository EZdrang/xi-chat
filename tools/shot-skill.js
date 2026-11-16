/* 验证：聊天里下发的「装技能」指令能被解析出来，并且从正文里剥掉 */
const puppeteer = require('puppeteer-core');
const path = require('path');

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

  const r = await page.evaluate(() => {
    const text = '好，我给你装一个。\n\n```xi-skill\nrepo: foo/bar-skill\ntriggers: 写作, 文案\n```';
    const a = window.__xi.extractSkillDirective(text);
    const b = window.__xi.extractSkillDirective('普通回复，没有指令');
    return {
      repo: a.dir && a.dir.repo,
      triggers: a.dir && a.dir.triggers,
      cleaned: a.text,
      noDir: b.dir === null && b.text === '普通回复，没有指令',
      usageText: document.getElementById('ctxUsage').textContent,
    };
  });

  const ok = r.repo === 'foo/bar-skill' && r.triggers === '写作, 文案' &&
    !r.cleaned.includes('xi-skill') && r.noDir && r.usageText.includes('缓存') && !errs.length;
  console.log((ok ? '✓' : '✗') + ' skill-directive ' + JSON.stringify(r));
  if (errs.length) console.log('   ', errs[0]);

  await page.screenshot({ path: path.join(__dirname, '..', 'shots', 'chat.png') });
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
