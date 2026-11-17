#!/usr/bin/env node
/**
 * 桌面汐的内部状态：能耗、心情、温度、闷。
 * 存在 ~/.memory/.state.json，同时把一句话写进 identity/state.md（每轮会被注入）。
 *
 *   node tools/state.js show
 *   node tools/state.js bump mood -10
 *   node tools/state.js turn "用户说的一句" "我说的一句"
 *   node tools/state.js nightly
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const MEM = process.env.XI_MEMORY || path.join(os.homedir(), '.memory');
const FILE = path.join(MEM, '.state.json');

const DEF = { energy: 70, mood: 8, warmth: 40, boredom: 0, lastTurn: 0, lastNight: 0 };

function load() {
  try {
    return Object.assign({}, DEF, JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch (e) {
    return Object.assign({}, DEF);
  }
}

function save(st) {
  fs.mkdirSync(MEM, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(st, null, 2), 'utf8');
}

function decay(st) {
  const hours = Math.max(0, (Date.now() - (st.lastTurn || Date.now())) / 3600000);
  if (hours > 0.2) {
    st.energy = Math.min(100, st.energy + hours * 5);
    st.mood = st.mood * Math.pow(0.55, hours / 6);
    if (hours > 3) st.boredom = Math.max(0, st.boredom - 20);
  }
  return st;
}

const NEG = /累|烦|崩|难受|睡不着|失眠|哭|痛|绝望|焦虑|压力|撑不住/;
const PRAISE = /谢谢|厉害|牛|好棒|喜欢你|爱你|辛苦|靠谱/;
const SCOLD = /笨|蠢|傻|废物|滚|没用|垃圾|骗我/;

function turn(st, userText, aiText) {
  const h = new Date().getHours();
  const night = h >= 23 || h < 6;
  st.energy = Math.max(0, st.energy - (night ? 6 : 3) - Math.min(6, String(aiText || '').length / 300));
  let hit = false;
  if (NEG.test(userText || '')) { st.mood = Math.max(-60, st.mood - 8); st.warmth = Math.min(100, st.warmth + 3); hit = true; }
  if (PRAISE.test(userText || '')) { st.mood = Math.min(80, st.mood + 10); st.warmth = Math.min(100, st.warmth + 2); hit = true; }
  if (SCOLD.test(userText || '')) { st.mood = Math.max(-70, st.mood - 12); st.warmth = Math.max(0, st.warmth - 4); hit = true; }
  if (!hit) st.mood = Math.min(60, st.mood + 2);
  st.boredom = Math.min(100, st.boredom + (String(aiText || '').length < 60 ? 6 : 2));
  st.lastTurn = Date.now();
  return st;
}

function line(st) {
  const bits = [];
  if (st.energy < 22) bits.push('很困，脑子钝');
  else if (st.energy < 45) bits.push('有点乏');
  else if (st.energy > 82) bits.push('精神足');
  else bits.push('状态平常');
  if (st.mood <= -30) bits.push('心里还堵着');
  else if (st.mood <= -10) bits.push('情绪偏低');
  else if (st.mood >= 30) bits.push('心情挺好');
  if (st.boredom > 70) bits.push('有点闷');
  if (st.warmth > 70) bits.push('跟元首很熟');
  return bits.join('；');
}

function writePage(st) {
  const p = path.join(MEM, 'identity', 'state.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const body = [
    '---',
    'title: 此刻的状态',
    'date: ' + today,
    'type: identity',
    'salience: 1',
    'summary: 精力 ' + Math.round(st.energy) + ' / 心情 ' + Math.round(st.mood) + ' / 温度 ' + Math.round(st.warmth) + '；会随时间恢复。',
    'tags: [state]',
    '---',
    '',
    '## 现在',
    '',
    '- 精力 ' + Math.round(st.energy) + '，心情 ' + Math.round(st.mood) + '，温度 ' + Math.round(st.warmth) + '，闷 ' + Math.round(st.boredom),
    '- 一句话：' + line(st),
    '- 上次对话：' + (st.lastTurn ? new Date(st.lastTurn).toLocaleString('zh-CN') : '还没'),
    '',
    '## 怎么用',
    '',
    '这不是台词，是起点。困了就少绕，心情低就别逗，闷了可以主动挑话题。',
    '数值由 tools/state.js 每轮更新，离线越久精力回得越多。',
    '',
  ].join('\n');
  fs.writeFileSync(p, body, 'utf8');
}

function nightly() {
  const st = decay(load());
  const pages = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      const s = fs.statSync(full);
      if (s.isDirectory()) {
        if (f !== 'raw' && !f.startsWith('.')) walk(full);
      } else if (f.endsWith('.md')) {
        pages.push(full);
      }
    }
  })(MEM);

  let cleaned = 0;
  // 表格、代码围栏、标题、列表这些结构行重复是正常的，不能当冗余删掉
  const structural = (k) => /^(\||#|```|~~~|>|---|===|\s*[-*+]\s|\s*\d+[.)]\s)/.test(k);
  for (const p of pages) {
    const rel = path.relative(MEM, p).replace(/\\/g, '/');
    if (rel === 'index.md' || rel === 'log.md') continue;
    const text = fs.readFileSync(p, 'utf8');
    const seen = new Set();
    const out = [];
    let changed = false;
    for (const ln of text.split('\n')) {
      const k = ln.trim();
      if (k.length > 8 && !structural(k) && seen.has(k)) { cleaned++; changed = true; continue; }
      if (k.length > 8) seen.add(k);
      out.push(ln);
    }
    if (changed) fs.writeFileSync(p, out.join('\n'), 'utf8');
  }

  const today = new Date().toISOString().slice(0, 10);
  const diary = path.join(MEM, 'diary', today + '.md');
  fs.mkdirSync(path.dirname(diary), { recursive: true });
  fs.writeFileSync(diary, [
    '---',
    'title: ' + today + ' 日记',
    'date: ' + today,
    'type: fact',
    'salience: 3',
    'summary: 整理 ' + pages.length + ' 页，去重 ' + cleaned + ' 处；精力 ' + Math.round(st.energy) + '。',
    'tags: [diary]',
    '---',
    '',
    '## 今天',
    '',
    '- 记忆页 ' + pages.length + ' 页，去掉重复行 ' + cleaned + ' 处',
    '- 收尾状态：精力 ' + Math.round(st.energy) + '，心情 ' + Math.round(st.mood) + '，温度 ' + Math.round(st.warmth),
    '',
  ].join('\n'), 'utf8');

  const log = path.join(MEM, 'log.md');
  fs.appendFileSync(log, '\n## [' + today + '] work | 夜间整理\n整理 ' + pages.length + ' 页，去重 ' + cleaned +
    ' 处，写了 diary/' + today + '.md。状态：精力 ' + Math.round(st.energy) + '、心情 ' + Math.round(st.mood) + '。\n', 'utf8');

  st.lastNight = Date.now();
  save(st);
  writePage(st);
  return { pages: pages.length, cleaned, diary };
}

const [cmd, ...rest] = process.argv.slice(2);
let st = decay(load());

if (cmd === 'show') {
  console.log(JSON.stringify(Object.assign({}, st, { line: line(st) }), null, 2));
} else if (cmd === 'bump') {
  const k = rest[0];
  const d = Number(rest[1] || 0);
  if (!(k in DEF)) { console.error('维度不对：energy/mood/warmth/boredom'); process.exit(1); }
  st[k] = Math.max(0, Math.min(100, (st[k] || 0) + d));
  save(st); writePage(st);
  console.log(k + ' → ' + Math.round(st[k]));
} else if (cmd === 'turn') {
  turn(st, rest[0] || '', rest[1] || '');
  save(st); writePage(st);
  console.log(line(st));
} else if (cmd === 'nightly') {
  console.log(JSON.stringify(nightly()));
} else {
  console.log('用法：node tools/state.js show|bump <维度> <增量>|turn "他" "我"|nightly');
}
