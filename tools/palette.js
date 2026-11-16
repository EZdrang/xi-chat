/* 从皮肤包里扒配色（开发用，需要本地装了 maid-atelier 皮肤） */
const fs = require('fs');
const os = require('os');
const path = require('path');
const SKIN = process.env.SKIN_DIR || path.join(os.homedir(), '.dsh', 'profiles', 'desktop',
  'node_modules', '@smalltailqwq', 'dsh-client-ui-skin-maid-atelier');
const P = path.join(SKIN, 'lib', 'client.js');
const s = fs.readFileSync(P, 'utf8');

const hex = (s.match(/#[0-9a-fA-F]{6}\b/g) || []).map((h) => h.toLowerCase());
const cnt = {};
hex.forEach((h) => { cnt[h] = (cnt[h] || 0) + 1; });
console.log('最常见颜色：');
Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 30)
  .forEach(([h, c]) => console.log('  ' + h + '  ×' + c));

const vars = new Set();
const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;"'`}]{1,70})/g;
let m;
while ((m = re.exec(s))) vars.add(m[1] + ' = ' + m[2].trim());
console.log('\nCSS 变量：');
[...vars].slice(0, 40).forEach((v) => console.log('  ' + v));

const rgba = (s.match(/rgba?\([^)]{5,40}\)/g) || []);
const rc = {};
rgba.forEach((r) => { rc[r] = (rc[r] || 0) + 1; });
console.log('\n常见 rgba：');
Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([r, c]) => console.log('  ' + r + '  ×' + c));
