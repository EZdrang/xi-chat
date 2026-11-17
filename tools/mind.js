#!/usr/bin/env node
/**
 * 桌面汐的心智自检：跨天首句、会忘、忽然想起、口头禅。
 * 记忆的「读没读过」记在 ~/.memory/.mind.json。
 *
 *   node tools/mind.js brief
 *   node tools/mind.js touch user/profile.md
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const MEM = process.env.XI_MEMORY || path.join(os.homedir(), '.memory');
const MIND = path.join(MEM, '.mind.json');

const TICS = ['行吧', '得了', '讲真', '说实话', '说白了', '算了', '其实', '怎么说呢',
  '你猜', '废话', '啧', '哎', '嗯嗯', '好家伙', '离谱', '别急', '至于吗', '讲道理'];

function load() {
  try { return JSON.parse(fs.readFileSync(MIND, 'utf8')); } catch (e) { return { seen: {}, firstAt: 0, lastAt: 0 }; }
}

function save(m) {
  fs.writeFileSync(MIND, JSON.stringify(m, null, 2), 'utf8');
}

function pages() {
  const out = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        if (f !== 'raw' && !f.startsWith('.')) walk(full);
      } else if (f.endsWith('.md') && !['index.md', 'log.md'].includes(f)) {
        out.push({ rel: path.relative(MEM, full).replace(/\\/g, '/'), full, mtime: st.mtimeMs });
      }
    }
  })(MEM);
  return out;
}

function days(ms) { return Math.max(0, (Date.now() - (ms || 0)) / 86400000); }

function firstLine(m) {
  const h = new Date().getHours();
  const gapH = m.lastAt ? (Date.now() - m.lastAt) / 3600000 : 0;
  if (!m.lastAt) return '（第一次记录，还没有上一回）';
  const sameDay = new Date(m.lastAt).toDateString() === new Date().toDateString();
  if (sameDay) return '';
  const gap = gapH < 24 ? Math.round(gapH) + ' 小时' : Math.round(gapH / 24) + ' 天';
  return '【今天第一句话】距上次 ' + gap + '（现在 ' + h + ' 点）。开场别像重新开机。';
}

function fuzzyLine(m) {
  const rows = pages().map((p) => {
    const seen = m.seen[p.rel] || p.mtime;
    return { rel: p.rel, d: days(seen) };
  }).filter((r) => r.d > 30).sort((a, b) => b.d - a.d).slice(0, 3);
  if (!rows.length) return '';
  return '【有点糊了】' + rows.map((r) => r.rel + '（' + Math.round(r.d) + ' 天没翻）').join('、') +
    '——提起来的时候别说得太肯定，先说「我记得好像是」。';
}

function recallLine(m) {
  const skip = ['SOUL.md', 'MEMORY.md', 'BOOTSTRAP.md', 'index.md', 'log.md'];
  const rows = pages().filter((p) => !skip.includes(p.rel)).map((p) => {
    const seen = m.seen[p.rel] || p.mtime;
    const d = days(seen);
    return { rel: p.rel, d, score: Math.log(d + 1) * 2 + Math.random() * 1.5 };
  }).sort((a, b) => b.score - a.score).slice(0, 2);
  if (!rows.length) return '';
  return '【忽然想起】' + rows.map((r) =>
    r.rel + '（上次翻：' + (r.d < 1 ? Math.round(r.d * 24) + ' 小时前' : Math.round(r.d) + ' 天前') + '）').join('；');
}

function ticLine() {
  const files = [path.join(MEM, 'log.md'), path.join(MEM, 'diary', '日记.md')].filter((f) => fs.existsSync(f));
  let text = '';
  files.forEach((f) => { text += fs.readFileSync(f, 'utf8').slice(-20000); });
  const counts = {};
  TICS.forEach((w) => {
    const n = (text.match(new RegExp(w, 'g')) || []).length;
    if (n >= 3) counts[w] = n;
  });
  const emo = text.match(/[\u{1F300}-\u{1FAFF}]/gu) || [];
  const emoCount = {};
  emo.forEach((e) => { emoCount[e] = (emoCount[e] || 0) + 1; });
  const topEmo = Object.keys(emoCount).sort((a, b) => emoCount[b] - emoCount[a])[0];

  const bits = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 3)
    .map((w) => '「' + w + '」' + counts[w]);
  if (topEmo && emoCount[topEmo] >= 3) bits.push(topEmo + ' ' + emoCount[topEmo] + ' 次');
  if (!bits.length) return '';
  return '【我的口头禅】' + bits.join('、') + '。这是我自己用出来的，接着用。';
}

const [cmd, ...rest] = process.argv.slice(2);
const m = load();

if (cmd === 'brief') {
  const blocks = [firstLine(m), fuzzyLine(m), recallLine(m), ticLine()].filter(Boolean);
  console.log(blocks.length ? blocks.join('\n\n') : '（今天没有什么特别要提醒自己的）');
  m.lastAt = Date.now();
  if (!m.firstAt) m.firstAt = Date.now();
  save(m);
} else if (cmd === 'touch') {
  rest.forEach((p) => { m.seen[p] = Date.now(); });
  save(m);
  console.log('已记下翻过：' + (rest.join('、') || '（没给路径）'));
} else {
  console.log('用法：node tools/mind.js brief | touch <page...>');
}
