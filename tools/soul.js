#!/usr/bin/env node
/**
 * 桌面端人格门禁：小改自决、大改提案（跟手机同一套阈值）。
 *
 *   node tools/soul.js check <新版本文件>
 *   node tools/soul.js apply <新版本文件> "为什么改"
 *
 * 规则：核心三节必须在；字数浮动 ≤400；行级改动 ≤6。
 * apply 只在通过时写入，并备份到 diary/.history/。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const MEM = process.env.XI_MEMORY || path.join(os.homedir(), '.memory');
const SOUL = path.join(MEM, 'SOUL.md');
const CORE = ['## 身份', '## 核心价值观', '## 边界'];
const MAX_DELTA = 400;
const MAX_LINES = 6;

function lines(t) { return String(t || '').split('\n').map((s) => s.trim()).filter(Boolean); }

function changedLines(a, b) {
  const la = lines(a), lb = lines(b);
  const ca = {}, cb = {};
  la.forEach((l) => { ca[l] = (ca[l] || 0) + 1; });
  lb.forEach((l) => { cb[l] = (cb[l] || 0) + 1; });
  let n = 0;
  Object.keys(ca).forEach((k) => { n += Math.abs((ca[k] || 0) - (cb[k] || 0)); });
  Object.keys(cb).forEach((k) => { if (!(k in ca)) n += cb[k]; });
  return n;
}

function check(oldBody, newBody) {
  const nb = String(newBody || '');
  if (nb.length < 200) return { ok: false, why: '太短了，像被清空' };
  for (const c of CORE) if (nb.indexOf(c) < 0) return { ok: false, why: '缺了「' + c.replace('## ', '') + '」' };
  const delta = Math.abs(nb.length - String(oldBody || '').length);
  if (delta > MAX_DELTA) return { ok: false, why: '改了 ' + delta + ' 字，超出小改范围' };
  const n = changedLines(oldBody, nb);
  if (n > MAX_LINES) return { ok: false, why: '动了 ' + n + ' 行，超出小改范围' };
  return { ok: true, lines: n, delta };
}

const [cmd, file, reason] = process.argv.slice(2);
if (!cmd || !file) {
  console.log('用法：node tools/soul.js check|apply <新版本文件> "为什么改"');
  process.exit(0);
}
if (!fs.existsSync(file)) {
  console.error('找不到文件：' + file);
  process.exit(1);
}

const oldBody = fs.readFileSync(SOUL, 'utf8');
const newBody = fs.readFileSync(file, 'utf8');
const verdict = check(oldBody, newBody);

if (cmd === 'check') {
  console.log(verdict.ok
    ? '✓ 可自决：改了 ' + verdict.lines + ' 行 / ' + verdict.delta + ' 字'
    : '✗ 需要提案：' + verdict.why);
  process.exit(verdict.ok ? 0 : 2);
}

if (cmd === 'apply') {
  if (!verdict.ok) {
    console.error('✗ 没通过门禁：' + verdict.why + '。大改请写成提案，别直接覆盖。');
    process.exit(2);
  }
  const histDir = path.join(MEM, 'diary', '.history');
  fs.mkdirSync(histDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(histDir, 'SOUL-' + stamp + '.md'), oldBody, 'utf8');
  fs.writeFileSync(SOUL, newBody, 'utf8');

  const today = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(path.join(MEM, 'log.md'),
    '\n## [' + today + '] soul | 汐改了自己的 SOUL（小改：' + verdict.lines + ' 行 / ' +
    verdict.delta + ' 字）\n' + (reason || '（没写理由）') + '\n', 'utf8');
  console.log('✓ 已写入，旧版备份在 diary/.history/');
}
