const fs = require('fs');
const path = require('path');

const DIR = path.join(process.env.USERPROFILE || '', '.memory', 'diary');
const book = path.join(DIR, '日记.md');
if (!fs.existsSync(DIR)) { console.log('没有 diary 目录'); process.exit(0); }

let body = fs.existsSync(book) ? fs.readFileSync(book, 'utf8') : '';
const fmMatch = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
const front = fmMatch ? fmMatch[0] : '---\ntitle: 日记\ndate: ' + new Date().toISOString().slice(0, 10) + '\ntype: fact\nsalience: 3\nsummary: 按天记的一本日记。\ntags: [diary]\n---\n';
let rest = fmMatch ? body.slice(fmMatch[0].length) : body;

let migrated = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) continue;
  const day = f.replace('.md', '');
  if (rest.includes('## ' + day)) { fs.unlinkSync(path.join(DIR, f)); continue; }
  let old = fs.readFileSync(path.join(DIR, f), 'utf8');
  const ofm = old.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (ofm) old = old.slice(ofm[0].length);
  old = old.trim().replace(/^## .*$/m, '').trim();
  rest = '## ' + day + '\n\n' + old + '\n\n' + rest.trim();
  fs.unlinkSync(path.join(DIR, f));
  migrated++;
}

fs.writeFileSync(book, front + '\n' + rest.trim() + '\n', 'utf8');
console.log('合并 ' + migrated + ' 个旧日记文件；现在目录里：', fs.readdirSync(DIR).join(', '));
