#!/usr/bin/env node
/*
 * 桌面端记忆同步：和手机端共用同一份 memory.js（跑在 vm 里，localStorage 换成文件）
 *
 *   node desk-sync.js export [--dir <记忆库>] [--out <zip>]
 *   node desk-sync.js import <zip> [--dir <记忆库>] [--dry] [--override <冲突页>=local|remote]
 *
 * 默认记忆库：~/.memory（可用 --dir 指定）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');

const ASSETS = path.join(__dirname, '..', 'app', 'assets');
const DEFAULT_DIR = path.join(os.homedir(), '.memory');

/* ---------------- 参数 ---------------- */
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

/* ---------------- 文件系统版 localStorage ---------------- */
function makeStore(stateFile) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {}; } catch (e) { data = {}; }
  // 页面本体以磁盘为准，状态文件只留基线，别缓存页面（否则删掉的页会被复活）
  delete data['xi.v1.memory'];
  return {
    data,
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) {
      if (k === 'xi.v1.memory') return;
      data[k] = String(v);
      flush();
    },
    removeItem(k) { delete data[k]; flush(); },
    flush() { flush(); },
  };
  function flush() {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(data, null, 1), 'utf8');
  }
}

/* ---------------- 载入共用内核 ---------------- */
function loadCore(dir) {
  const ctx = vm.createContext({
    window: {}, console,
    TextEncoder, TextDecoder, Uint8Array, DataView,
    JSON, Math, Date, Blob, Response, Array, Object, String, Number,
    Promise, setTimeout, clearTimeout, parseInt, parseFloat, Error, RegExp,
  });
  ctx.globalThis = ctx;
  const store = makeStore(path.join(dir, '.xi-sync', 'state.json'));
  ctx.localStorage = store;

  for (const f of ['zip.js', 'memory.js']) {
    vm.runInContext(fs.readFileSync(path.join(ASSETS, f), 'utf8'), ctx, { filename: f });
  }
  ctx.window.localStorage = store;
  const MEM = ctx.window.MEM;
  const ZIP = ctx.window.ZIP;
  MEM.load();           // 不 seed：桌面的记忆来自磁盘
  return { MEM, ZIP, store, ctx };
}

/* ---------------- 磁盘 ↔ 记忆库 ---------------- */
const SKIP_DIRS = new Set(['raw', '.xi-sync', 'node_modules', '.git']);

function walkMd(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkMd(full, base, out);
    else if (name.toLowerCase().endsWith('.md')) {
      const rel = path.relative(base, full).replace(/\\/g, '/');
      if (rel === 'index.md' || rel === 'log.md') continue;
      out.push({ rel, full });
    }
  }
  return out;
}

function loadFromDisk(MEM, dir) {
  const files = walkMd(dir);
  let loaded = 0;
  for (const f of files) {
    const text = fs.readFileSync(f.full, 'utf8');
    try {
      MEM.upsert(MEM.parseFile(text, f.rel));
      loaded++;
    } catch (e) {
      console.warn('跳过（解析失败）', f.rel, e.message);
    }
  }
  const logPath = path.join(dir, 'log.md');
  if (fs.existsSync(logPath)) {
    MEM.raw().log = MEM.parseLog(fs.readFileSync(logPath, 'utf8'));
  }
  return { files: files.map((f) => f.rel), loaded };
}

function writeToDisk(MEM, dir, before) {
  const files = MEM.exportFiles('电脑');
  const wrote = new Set();
  for (const f of files) {
    if (f.path === '_sync.json') continue;
    const full = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.from(f.data));
    wrote.add(f.path);
  }
  // 删掉「原本是记忆页、现在没了」的文件
  let removed = 0;
  for (const rel of before) {
    if (!wrote.has(rel) && fs.existsSync(path.join(dir, rel))) {
      fs.unlinkSync(path.join(dir, rel));
      removed++;
    }
  }
  return { wrote: wrote.size, removed };
}

/* ---------------- 命令 ---------------- */
function cmdExport(args) {
  const dir = path.resolve(args.dir || DEFAULT_DIR);
  const { MEM, ZIP, store } = loadCore(dir);
  const { files, loaded } = loadFromDisk(MEM, dir);

  const entries = MEM.exportFiles(args.device || '电脑');
  const bytes = ZIP.create(entries);
  const stamp = (() => {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  })();
  const out = path.resolve(args.out || path.join(path.dirname(dir), `汐-记忆-${stamp}.zip`));
  fs.writeFileSync(out, Buffer.from(bytes));
  store.flush();

  console.log(`导出 ${loaded} 页 → ${out}（${(bytes.length / 1024).toFixed(1)} KB）`);
  console.log(`含 index.md / log.md / _sync.json；共 ${entries.length} 个文件`);
}

function cmdImport(args) {
  const dir = path.resolve(args.dir || DEFAULT_DIR);
  const zipPath = args._[1];
  if (!zipPath || !fs.existsSync(zipPath)) {
    console.error('用法：node desk-sync.js import <zip> [--dir <记忆库>] [--dry]');
    process.exit(2);
  }

  const { MEM, ZIP, store } = loadCore(dir);
  const { files: before } = loadFromDisk(MEM, dir);

  return ZIP.read(new Uint8Array(fs.readFileSync(zipPath))).then((entries) => {
    const plan = MEM.planImport(entries);
    const c = { add: 0, update: 0, same: 0, merge: 0, conflict: 0, localAhead: 0, delete: 0 };
    plan.entries.forEach((e) => { if (c[e.action] != null) c[e.action]++; });

    console.log(`来源：${plan.device}${plan.exportedAt ? '（' + plan.exportedAt + '）' : ''}`);
    console.log(`新增 ${c.add} · 远端更新 ${c.update} · 自动合并 ${c.merge} · 冲突 ${c.conflict}` +
      ` · 本地领先 ${c.localAhead} · 没变 ${c.same}` + (c.delete ? ` · 远端删除 ${c.delete}` : ''));

    const shown = plan.entries.filter((e) => e.action !== 'same');
    if (shown.length) {
      console.log('\n明细：');
      for (const e of shown) console.log(`  ${e.action.padEnd(12)} ${e.path}`);
    }

    if (args.dry) { console.log('\n--dry：未写入'); return; }

    const r = MEM.applyImport(plan);
    const w = writeToDisk(MEM, dir, before);
    store.flush();

    console.log(`\n已写入 ${w.wrote} 个文件` + (w.removed ? `，删除 ${w.removed} 个` : '') +
      (r.conflicts.length ? `，冲突另存 ${r.conflicts.length} 份` : ''));
    r.conflicts.forEach((x) => console.log(`  冲突：${x.path} → ${x.saved}`));
  });
}

/* ---------------- 入口 ---------------- */
const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (cmd === 'export') cmdExport(args);
else if (cmd === 'import') {
  cmdImport(args).catch((e) => { console.error('导入失败：', e.message); process.exit(1); });
} else {
  console.log('用法：\n  node desk-sync.js export [--dir D] [--out F.zip]\n  node desk-sync.js import <zip> [--dir D] [--dry]');
  process.exit(1);
}
