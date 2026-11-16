#!/usr/bin/env node
/**
 * 收拾 GitHub 仓库：描述、topics、Release、附件
 *   GH_TOKEN=xxx node tools/publish.js
 * 可选：REPO=owner/name TAG=v1.4.0 APK=dist/xxx.apk NOTES=docs/release-notes.md
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function readToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  // 没有环境变量就找文件：仓库根 .gh-token，或用户目录 .gh-token
  const candidates = [
    path.join(__dirname, '..', '.gh-token'),
    path.join(os.homedir(), '.gh-token'),
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  }
  return '';
}

const TOKEN = readToken();
if (!TOKEN) {
  console.error('缺 token：设 GH_TOKEN，或把 PAT 存到 ~/.gh-token');
  process.exit(1);
}

const REPO = process.env.REPO || 'EZdrang/xi-chat';
const TAG = process.env.TAG || 'v1.4.0';
const TITLE = process.env.TITLE || '汐 · 手机版 v1.4';
const APK = process.env.APK || 'dist/xi-chat-v1.4.apk';
const NOTES = process.env.NOTES || 'docs/release-notes.md';
const API = 'https://api.github.com';

const H = {
  Authorization: `Bearer ${TOKEN}`,
  'User-Agent': 'xi-chat-publish',
  Accept: 'application/vnd.github+json',
};

async function call(method, url, body, contentType) {
  const opt = { method, headers: { ...H } };
  if (body !== undefined) {
    // 二进制必须原样发，不能 JSON 化（否则 Buffer 会变成 {"type":"Buffer","data":[...]}）
    const isBinary = Buffer.isBuffer(body) || body instanceof Uint8Array;
    opt.body = isBinary || typeof body === 'string' ? body : JSON.stringify(body);
    opt.headers['Content-Type'] = contentType || 'application/json; charset=utf-8';
  }
  const r = await fetch(url, opt);
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

(async () => {
  console.log('== 1/4 校验身份 ==');
  const me = await call('GET', `${API}/user`);
  console.log('  登录：' + me.login);

  console.log('== 2/4 仓库描述与 topics ==');
  const desc = '带长线记忆的安卓聊天 App：记忆是 markdown，可与桌面 DSH 记忆库三方合并互通';
  await call('PATCH', `${API}/repos/${REPO}`, { description: desc, has_issues: true });
  await call('PUT', `${API}/repos/${REPO}/topics`, {
    names: ['android', 'llm', 'chat', 'memory', 'markdown', 'apk', 'deepseek', 'long-term-memory'],
  });
  console.log('  ✓ ' + desc);

  console.log('== 3/4 创建 Release ' + TAG + ' ==');
  const notes = fs.existsSync(NOTES) ? fs.readFileSync(NOTES, 'utf8') : '';
  let rel;
  try {
    rel = await call('POST', `${API}/repos/${REPO}/releases`, {
      tag_name: TAG, target_commitish: 'main', name: TITLE, body: notes,
      draft: false, prerelease: false,
    });
    console.log('  ✓ ' + rel.html_url);
  } catch (e) {
    if (String(e.message).includes('already_exists')) {
      rel = await call('GET', `${API}/repos/${REPO}/releases/tags/${TAG}`);
      console.log('  · Release 已存在，复用：' + rel.html_url);
    } else throw e;
  }

  console.log('== 4/4 上传 APK ==');
  if (fs.existsSync(APK)) {
    const buf = fs.readFileSync(APK);
    const name = path.basename(APK);

    // 同名旧附件先删掉，避免重复/覆盖成垃圾
    const relFull = await call('GET', `${API}/repos/${REPO}/releases/${rel.id}`);
    for (const a of relFull.assets || []) {
      if (a.name === name) {
        await call('DELETE', `${API}/repos/${REPO}/releases/assets/${a.id}`);
        console.log('  · 删掉旧附件 ' + a.name);
      }
    }

    const up = await call(
      'POST',
      `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`,
      buf,
      'application/vnd.android.package-archive'
    );
    const localKb = buf.length / 1024;
    const okSize = Math.abs(up.size - buf.length) < 1024;
    console.log(`  ${okSize ? '✓' : '✗'} ${up.name} 上传 ${(up.size / 1024).toFixed(1)} KB / 本地 ${localKb.toFixed(1)} KB`);
    if (!okSize) throw new Error('上传体积和本地不一致，说明又被编码搞了');
  } else {
    console.log('  ! 找不到 ' + APK);
  }

  console.log(`\n完成：https://github.com/${REPO}/releases/tag/${TAG}`);
})().catch((e) => { console.error('失败：' + e.message); process.exit(1); });
