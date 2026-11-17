#!/usr/bin/env node
/**
 * 桌面汐的心智自检与状态更新（跟手机上那套同一逻辑）。
 *
 *   node tools/mind.js brief [他刚说的那句话]
 *   node tools/mind.js turn "<他说的>" "<我说的>"
 *   node tools/mind.js touch user/profile.md
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const MEM = process.env.XI_MEMORY || path.join(os.homedir(), '.memory');
const MIND = path.join(MEM, '.mind.json');

const TICS = ['行吧', '得了', '讲真', '说实话', '说白了', '算了', '其实', '怎么说呢',
  '你猜', '废话', '啧', '哎', '嗯嗯', '好家伙', '离谱', '别急', '至于吗', '讲道理'];

const TOPICS = [
  ['技术', /代码|报错|bug|插件|部署|编译|接口|sqlite|apk|架构/i],
  ['游戏', /LOL|英雄联盟|海斗|上分|排位|游戏|开黑/i],
  ['情感', /喜欢|分手|表白|感情|想她|想他|吵架|拉扯|小徒弟/],
  ['身体', /睡|累|熬夜|头疼|胃|吃|步数|锻炼|失眠/],
  ['工作', /上班|加班|老板|项目|工资|面试|会议/],
  ['八卦', /明星|热搜|瓜|八卦/],
];
const EVENT_HINT = /对不起|我错了|分手|答应|决定|吵|崩|哭|拒绝了|和好了|辞职|表白|约定/;

function load() {
  let m = {};
  try { m = JSON.parse(fs.readFileSync(MIND, 'utf8')); } catch (e) { m = {}; }
  m.seen = m.seen || {};
  m.prefs = m.prefs || {};
  m.events = m.events || [];
  m.habits = m.habits || {};
  m.firstAt = m.firstAt || 0;
  m.lastAt = m.lastAt || 0;
  m.lastDay = m.lastDay || '';
  return m;
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

const days = (ms) => Math.max(0, (Date.now() - (ms || 0)) / 86400000);
const todayKey = () => new Date().toISOString().slice(0, 10);
const tagsOf = (t) => TOPICS.filter((x) => x[1].test(String(t || ''))).map((x) => x[0]);

function firstLine(m) {
  if (!m.lastAt) return '（第一次记录，还没有上一回）';
  if (m.lastDay === todayKey()) return '';
  const gapH = (Date.now() - m.lastAt) / 3600000;
  const gap = gapH < 24 ? Math.round(gapH) + ' 小时' : Math.round(gapH / 24) + ' 天';
  return '【今天第一句话】距上次 ' + gap + '（现在 ' + new Date().getHours() + ' 点）。开场别像重新开机。';
}

function fuzzyLine(m) {
  const rows = pages().map((p) => ({ rel: p.rel, d: days(m.seen[p.rel] || p.mtime) }))
    .filter((r) => r.d > 30).sort((a, b) => b.d - a.d).slice(0, 3);
  if (!rows.length) return '';
  return '【有点糊了】' + rows.map((r) => r.rel + '（' + Math.round(r.d) + ' 天没翻）').join('、') +
    '——提起来别一口咬定，先说「我记得好像是」。';
}

function recallLine(m) {
  const skip = ['SOUL.md', 'MEMORY.md', 'BOOTSTRAP.md', 'index.md', 'log.md'];
  const rows = pages().filter((p) => !skip.includes(p.rel)).map((p) => {
    const d = days(m.seen[p.rel] || p.mtime);
    return { rel: p.rel, d, score: Math.log(d + 1) * 2 + Math.random() * 1.5 };
  }).sort((a, b) => b.score - a.score).slice(0, 2);
  if (!rows.length) return '';
  return '【忽然想起】' + rows.map((r) =>
    r.rel + '（上次翻：' + (r.d < 1 ? Math.round(r.d * 24) + ' 小时前' : Math.round(r.d) + ' 天前') + '）').join('；');
}

function prefLine(m) {
  const rows = Object.keys(m.prefs).map((k) => ({ k, v: m.prefs[k] })).sort((a, b) => b.v - a.v);
  if (rows.length < 2) return '';
  const good = rows.filter((r) => r.v >= 2).slice(0, 2).map((r) => r.k);
  const bad = rows.filter((r) => r.v <= -1.5).slice(-1).map((r) => r.k);
  const bits = [];
  if (good.length) bits.push('最近对「' + good.join('」「') + '」有劲儿');
  if (bad.length) bits.push('对「' + bad[0] + '」有点敷衍');
  return bits.length ? '【我自己的偏好】' + bits.join('，') + '。这是聊出来的，可以表现出来。' : '';
}

function eventLine(m, text) {
  const tags = tagsOf(text);
  if (!tags.length) return '';
  const hit = m.events.filter((e) =>
    String(e.tags || '').split(',').some((t) => tags.includes(t))).slice(-2).reverse();
  if (!hit.length) return '';
  return hit.map((e) => {
    const d = days(e.ts);
    const when = d < 1 ? '今天早些时候' : d < 2 ? '昨天' : Math.round(d) + ' 天前';
    return '【翻到旧事】' + when + '：他「' + String(e.what).slice(0, 60) + '」，我「' +
      String(e.how || '（没留下回应）').slice(0, 50) + '」';
  }).join('\n');
}

function ticLine(m) {
  const rows = Object.keys(m.habits).map((k) => ({ k, n: m.habits[k] }))
    .filter((r) => r.n >= 3).sort((a, b) => b.n - a.n).slice(0, 4);
  if (!rows.length) return '';
  return '【我的口头禅】' + rows.map((r) => '「' + r.k + '」' + r.n).join('、') + '。接着用就行。';
}

function turn(m, user, ai) {
  const tags = tagsOf(user);
  const engaged = String(ai || '').length > 120 || /[\u{1F300}-\u{1FAFF}]/u.test(String(ai || ''));
  const bored = String(ai || '').length < 40;
  tags.forEach((t) => {
    const cur = m.prefs[t] || 0;
    m.prefs[t] = Math.max(-10, Math.min(20, cur + (engaged ? 1 : bored ? -0.8 : 0)));
  });

  if (EVENT_HINT.test(String(user || ''))) {
    const what = String(user).replace(/\s+/g, ' ').slice(0, 120);
    const last = m.events[m.events.length - 1];
    if (!last || last.what !== what) {
      m.events.push({
        ts: Date.now(), what,
        how: String(ai || '').replace(/\s+/g, ' ').slice(0, 120),
        tags: (tags.length ? tags : ['情感']).join(','),
      });
      if (m.events.length > 300) m.events = m.events.slice(-300);
    }
  }

  const a = String(ai || '');
  TICS.forEach((w) => { if (a.includes(w)) m.habits[w] = (m.habits[w] || 0) + 1; });
  const emo = a.match(/[\u{1F300}-\u{1FAFF}]/gu) || [];
  emo.forEach((e) => { m.habits[e] = (m.habits[e] || 0) + 1; });
  if (a.includes('——')) m.habits['破折号'] = (m.habits['破折号'] || 0) + 1;

  m.lastAt = Date.now();
  m.lastDay = todayKey();
  return m;
}

const [cmd, ...rest] = process.argv.slice(2);
const m = load();

if (cmd === 'brief') {
  const text = rest.join(' ');
  const blocks = [firstLine(m), prefLine(m), eventLine(m, text), fuzzyLine(m), recallLine(m), ticLine(m)]
    .filter(Boolean);
  console.log(blocks.length ? blocks.join('\n\n') : '（今天没有什么特别要提醒自己的）');
  m.lastAt = Date.now();
  if (!m.firstAt) m.firstAt = Date.now();
  save(m);
} else if (cmd === 'turn') {
  turn(m, rest[0] || '', rest[1] || '');
  save(m);
  console.log('状态已更新：' + (prefLine(m) || '（偏好还不够形成倾向）'));
} else if (cmd === 'touch') {
  rest.forEach((p) => { m.seen[p] = Date.now(); });
  save(m);
  console.log('已记下翻过：' + (rest.join('、') || '（没给路径）'));
} else {
  console.log('用法：node tools/mind.js brief [他的话] | turn "<他>" "<我>" | touch <page...>');
}
