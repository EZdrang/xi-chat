#!/usr/bin/env node
/*
 * 把手机端导出的「单条对话 JSON」收进桌面记忆库的源材料区：
 *   node desk-convo.js import <file.json> [--dir <记忆库>]
 *   node desk-convo.js import <目录> --all
 *
 * 落点：<记忆库>/raw/chats/YYYY-MM-DD-<标题>.md（raw/ 只读，不参与 index 路由）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DIR = path.join(os.homedir(), '.memory');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[k] = next; i++; }
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function slug(s) {
  return String(s || '对话').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
}

function toMarkdown(j, srcName) {
  const s = j.session || j;
  const msgs = s.messages || [];
  const when = s.createdAt ? new Date(s.createdAt) : new Date();
  const lines = [];
  lines.push(`# ${s.title || '手机对话'}`);
  lines.push('');
  lines.push(`- 来源：手机 xi-chat（${srcName}）`);
  lines.push(`- 导出：${j.exportedAt || '未知'}`);
  lines.push(`- 开始：${when.toISOString()}`);
  lines.push(`- 消息：${msgs.length} 条`);
  lines.push('');
  lines.push('---');
  lines.push('');
  for (const m of msgs) {
    if (m.role === 'note') { lines.push(`> ${m.text || ''}`); lines.push(''); continue; }
    const who = m.role === 'user' ? '指挥官' : '汐';
    lines.push(`**${who}**：`);
    lines.push('');
    const body = (m.display != null ? m.display : m.content) || '';
    lines.push(body.trim() || '（空）');
    if (m.images && m.images.length) lines.push(`\n_（附图 ${m.images.length} 张）_`);
    if (m.files && m.files.length) lines.push(`\n_（附件：${m.files.map((f) => f.name).join('、')}）_`);
    lines.push('');
  }
  return lines.join('\n');
}

function importOne(file, dir) {
  let raw = fs.readFileSync(file, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const j = JSON.parse(raw);
  if (j.type && j.type !== 'session') throw new Error('不是对话文件：' + j.type);
  const s = j.session || j;
  if (!Array.isArray(s.messages)) throw new Error('没有 messages');

  const outDir = path.join(dir, 'raw', 'chats');
  fs.mkdirSync(outDir, { recursive: true });

  const when = s.createdAt ? new Date(s.createdAt) : new Date();
  let name = `${stamp(when)}-${slug(s.title)}.md`;
  let n = 2;
  while (fs.existsSync(path.join(outDir, name))) {
    name = `${stamp(when)}-${slug(s.title)}-${n++}.md`;
  }
  const target = path.join(outDir, name);
  fs.writeFileSync(target, toMarkdown(j, path.basename(file)), 'utf8');
  return { target, count: s.messages.length, title: s.title };
}

const args = parseArgs(process.argv.slice(2));
const dir = path.resolve(args.dir || DEFAULT_DIR);
const target = args._[1];

if (!target) {
  console.log('用法：\n  node desk-convo.js import <file.json> [--dir D]\n  node desk-convo.js import <dir> --all');
  process.exit(1);
}

try {
  const stat = fs.statSync(target);
  const files = stat.isDirectory()
    ? fs.readdirSync(target).filter((f) => f.toLowerCase().endsWith('.json')).map((f) => path.join(target, f))
    : [target];
  if (!files.length) { console.log('没找到 .json'); process.exit(0); }
  let ok = 0;
  for (const f of files) {
    try {
      const r = importOne(f, dir);
      ok++;
      console.log(`✓ ${r.count} 条 · ${r.title} → ${path.relative(dir, r.target)}`);
    } catch (e) {
      console.log(`✗ ${path.basename(f)}：${e.message}`);
    }
  }
  console.log(`\n收进 ${ok} 条对话 → ${path.join(dir, 'raw', 'chats')}`);
} catch (e) {
  console.error('失败：', e.message);
  process.exit(1);
}
