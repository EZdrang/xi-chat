#!/usr/bin/env node
/**
 * 当 git push 连不上 GitHub 时，用 Git Data API 把当前工作树提交上去。
 *   GH_TOKEN=xxx node tools/push-api.js "commit message"
 * 依赖：git（取 tracked 文件列表）、api.github.com 可达
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function readToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  for (const f of [path.join(__dirname, '..', '.gh-token'), path.join(os.homedir(), '.gh-token')]) {
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  }
  return '';
}

const TOKEN = readToken();
if (!TOKEN) { console.error('缺 token'); process.exit(1); }

const REPO = process.env.REPO || 'EZdrang/xi-chat';
const BRANCH = process.env.BRANCH || 'main';
const MSG = process.argv[2] || 'chore: sync from local';
const API = 'https://api.github.com';
const H = {
  Authorization: `Bearer ${TOKEN}`,
  'User-Agent': 'xi-chat-push',
  Accept: 'application/vnd.github+json',
};

async function call(method, url, body) {
  const opt = { method, headers: { ...H } };
  if (body !== undefined) {
    opt.body = JSON.stringify(body);
    opt.headers['Content-Type'] = 'application/json; charset=utf-8';
  }
  const r = await fetch(url, opt);
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}

(async () => {
  const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

  console.log('== 1/4 取当前远端头 ==');
  const ref = await call('GET', `${API}/repos/${REPO}/git/ref/heads/${BRANCH}`);
  const baseSha = ref.object.sha;
  const baseCommit = await call('GET', `${API}/repos/${REPO}/git/commits/${baseSha}`);
  console.log('  base: ' + baseSha.slice(0, 7));

  console.log('== 2/4 上传文件 blob ==');
  const files = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  console.log('  文件数：' + files.length);

  const tree = [];
  let done = 0;
  for (const rel of files) {
    const full = path.join(root, rel);
    const buf = fs.readFileSync(full);
    const blob = await call('POST', `${API}/repos/${REPO}/git/blobs`, {
      content: buf.toString('base64'),
      encoding: 'base64',
    });
    tree.push({ path: rel.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: blob.sha });
    done++;
    if (done % 10 === 0) console.log(`    ${done}/${files.length}`);
  }

  console.log('== 3/4 建树 ==');
  const newTree = await call('POST', `${API}/repos/${REPO}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree,
  });

  console.log('== 4/4 提交并移动分支 ==');
  const commit = await call('POST', `${API}/repos/${REPO}/git/commits`, {
    message: MSG,
    tree: newTree.sha,
    parents: [baseSha],
  });
  await call('PATCH', `${API}/repos/${REPO}/git/refs/heads/${BRANCH}`, {
    sha: commit.sha,
    force: false,
  });

  console.log(`\nOK: https://github.com/${REPO}/commit/${commit.sha}`);
})().catch((e) => { console.error('失败：' + e.message); process.exit(1); });
