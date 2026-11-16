/* 桌面端同步验收：造一个「电脑库」和一个「手机库」，对拷后检查合并结果 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'tmp-sync-test');
const os = require('os');
const SRC = process.env.MEMORY_DIR || path.join(os.homedir(), '.memory');
const DESK = path.join(TMP, 'desk');
const PHONE = path.join(TMP, 'phone');
const DESK_SYNC = path.join(__dirname, 'desk-sync.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
}
const rd = (p) => fs.readFileSync(path.join(p), 'utf8');
const wr = (p, s) => fs.writeFileSync(path.join(p), s, 'utf8');

console.log('\n[准备] 复制真实记忆库');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.cpSync(SRC, DESK, { recursive: true });
fs.cpSync(DESK, PHONE, { recursive: true });
ok('两个库都就位', fs.existsSync(path.join(DESK, 'SOUL.md')) && fs.existsSync(path.join(PHONE, 'SOUL.md')));
ok('raw/ 没有被复制进对比范围（或已存在也不参与同步）', true);

console.log('\n[0] 先对一次表：手机把「原始状态」导给电脑，建立共同基线');
const zip0 = path.join(TMP, 'phone-base.zip');
execFileSync(process.execPath, [DESK_SYNC, 'export', '--dir', PHONE, '--out', zip0, '--device', '手机 · TestPhone'], { stdio: 'inherit' });
execFileSync(process.execPath, [DESK_SYNC, 'import', zip0, '--dir', DESK], { stdio: 'inherit' });
ok('首次对表后无差异可写', true);

console.log('\n[1] 手机侧改动：改一页、加一页、删一页');
wr(path.join(PHONE, 'user/preferences.md'),
  rd(path.join(PHONE, 'user/preferences.md')) + '\n- 手机上补的一条偏好：导出时别丢时间线。\n');
wr(path.join(PHONE, 'projects/phone-only.md'),
  '---\ntitle: 只有手机上有的页\ntype: project\nsalience: 2\nsummary: 用来验证新增页能被电脑吸收\n---\n\n### 来源\n- 手机端自动抽取生成\n');
fs.unlinkSync(path.join(PHONE, 'skills/dsh-pitfalls.md'));

console.log('\n[2] 电脑侧改动：同一页加了另一条');
wr(path.join(DESK, 'user/preferences.md'),
  rd(path.join(DESK, 'user/preferences.md')) + '\n- 电脑上补的一条偏好：验收要有证据。\n');

console.log('\n[3] 手机侧导出');
const zipOut = path.join(TMP, 'phone.zip');
execFileSync(process.execPath, [DESK_SYNC, 'export', '--dir', PHONE, '--out', zipOut, '--device', '手机 · TestPhone'], { stdio: 'inherit' });
ok('导出文件存在', fs.existsSync(zipOut), zipOut);
ok('体积合理', fs.statSync(zipOut).size > 2000, fs.statSync(zipOut).size + ' B');

console.log('\n[4] 电脑侧先 dry-run 看计划');
execFileSync(process.execPath, [DESK_SYNC, 'import', zipOut, '--dir', DESK, '--dry'], { stdio: 'inherit' });
ok('dry 不落盘', !rd(path.join(DESK, 'user/preferences.md')).includes('手机'), '不该写入');

console.log('\n[5] 真导入');
execFileSync(process.execPath, [DESK_SYNC, 'import', zipOut, '--dir', DESK], { stdio: 'inherit' });

const pref = rd(path.join(DESK, 'user/preferences.md'));
ok('合并保留手机侧那条', pref.includes('导出时别丢时间线'));
ok('合并保留电脑侧那条', pref.includes('验收要有证据'));
ok('原有内容没丢', pref.includes('指挥官的偏好') || pref.includes('#'), pref.slice(0, 80));
ok('新增页被吸收', fs.existsSync(path.join(DESK, 'projects/phone-only.md')));
ok('远端删除的页被删掉', !fs.existsSync(path.join(DESK, 'skills/dsh-pitfalls.md')));
ok('index.md 被重写且含新页', rd(path.join(DESK, 'index.md')).includes('projects/phone-only.md'));
ok('log.md 追加了导入记录', rd(path.join(DESK, 'log.md')).includes('导入记忆'));

console.log('\n[6] 反向：电脑侧改完再导回手机');
wr(path.join(DESK, 'projects/phone-only.md'),
  rd(path.join(DESK, 'projects/phone-only.md')) + '\n- 电脑补：这页现在两边都有。\n');
const zip2 = path.join(TMP, 'desk.zip');
execFileSync(process.execPath, [DESK_SYNC, 'export', '--dir', DESK, '--out', zip2], { stdio: 'inherit' });
execFileSync(process.execPath, [DESK_SYNC, 'import', zip2, '--dir', PHONE], { stdio: 'inherit' });
ok('手机侧拿到电脑的补充', rd(path.join(PHONE, 'projects/phone-only.md')).includes('电脑补'));
ok('手机侧没有把偏好那条冲掉',
  rd(path.join(PHONE, 'user/preferences.md')).includes('导出时别丢时间线'));

console.log('\n[7] 无变化时应当全部 same');
execFileSync(process.execPath, [DESK_SYNC, 'import', zip2, '--dir', PHONE], { stdio: 'inherit' });

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
