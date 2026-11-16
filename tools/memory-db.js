#!/usr/bin/env node
/**
 * 桌面端记忆索引：把 ~/.memory 里的 markdown 收进 SQLite（含全文索引）。
 * 记忆本体仍是 md 文件——这里只是索引，删了能重建。
 *
 *   node tools/memory-db.js index
 *   node tools/memory-db.js search "关键词"
 *   node tools/memory-db.js stats
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const HOME = os.homedir();
const DIR = process.env.XI_MEMORY || path.join(HOME, '.memory');
const DB = path.join(DIR, 'memory.db');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'raw' || name.startsWith('.')) continue;
      walk(full, out);
    } else if (name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(m[0].length) };
}

function open() {
  const db = new DatabaseSync(DB);
  db.exec(`CREATE TABLE IF NOT EXISTS pages(
    path TEXT PRIMARY KEY, title TEXT, type TEXT, salience INTEGER,
    summary TEXT, body TEXT, updated_at INTEGER)`);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(path, title, body, tokenize='unicode61')`);
  db.exec(`CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)`);
  return db;
}

function cmdIndex() {
  if (!fs.existsSync(DIR)) {
    console.error('没有记忆库：' + DIR);
    process.exit(1);
  }
  const db = open();
  const files = walk(DIR);
  const ins = db.prepare(`INSERT OR REPLACE INTO pages(path,title,type,salience,summary,body,updated_at)
                          VALUES (?,?,?,?,?,?,?)`);
  const delFts = db.prepare('DELETE FROM pages_fts WHERE path = ?');
  const insFts = db.prepare('INSERT INTO pages_fts(path,title,body) VALUES (?,?,?)');
  db.exec('BEGIN');
  try {
    for (const f of files) {
      const rel = path.relative(DIR, f).replace(/\\/g, '/');
      const text = fs.readFileSync(f, 'utf8');
      const { meta, body } = frontmatter(text);
      const title = meta.title || path.basename(f, '.md');
      const summary = meta.summary || '';
      ins.run(rel, title, meta.type || 'fact', Number(meta.salience) || 2,
        summary, body, Date.now());
      delFts.run(rel);
      insFts.run(rel, title, summary + '\n' + body);
    }
    db.prepare('INSERT OR REPLACE INTO meta(k,v) VALUES (?,?)').run('indexed_at', new Date().toISOString());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const n = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
  console.log(`索引完成：${n} 页 → ${DB}`);
  db.close();
}

function cmdSearch(q) {
  if (!q) {
    console.error('用法：node tools/memory-db.js search "关键词"');
    process.exit(1);
  }
  const db = open();
  const rows = db.prepare(`
    SELECT p.path, p.title, p.salience, snippet(pages_fts, 2, '[', ']', '…', 12) AS snip
    FROM pages_fts f JOIN pages p ON p.path = f.path
    WHERE pages_fts MATCH ?
    ORDER BY rank LIMIT 10`).all(q.replace(/"/g, '""') + '*');
  if (!rows.length) {
    console.log('没有命中：' + q);
  } else {
    for (const r of rows) {
      console.log(`\n[${r.salience}] ${r.path} — ${r.title}`);
      console.log('    ' + String(r.snip || '').replace(/\s+/g, ' ').slice(0, 200));
    }
  }
  db.close();
}

function cmdStats() {
  const db = open();
  const n = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
  const at = db.prepare("SELECT v FROM meta WHERE k='indexed_at'").get();
  const size = fs.existsSync(DB) ? (fs.statSync(DB).size / 1024).toFixed(0) + ' KB' : '-';
  console.log(`页数 ${n} · 库 ${size} · 上次索引 ${at ? at.v : '从未'}`);
  const rows = db.prepare('SELECT salience, COUNT(*) AS n FROM pages GROUP BY salience').all();
  console.log('分级：' + rows.map((r) => `salience ${r.salience}: ${r.n}`).join(' · '));
  db.close();
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'index') cmdIndex();
else if (cmd === 'search') cmdSearch(rest.join(' '));
else if (cmd === 'stats') cmdStats();
else console.log('用法：node tools/memory-db.js index|search <词>|stats');
