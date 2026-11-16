/* Node 测试：把浏览器用到的 IIFE 塞进一个共享 context，验证记忆库 / zip / markdown */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const A = path.join(__dirname, '..', 'app', 'assets');
const read = (f) => fs.readFileSync(path.join(A, f), 'utf8');

// 最小 window / localStorage 垫片
class LS {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const sandbox = {
  window: {},
  localStorage: new LS(),
  console,
  TextEncoder,
  TextDecoder,
  Uint8Array, DataView, JSON, Math, Date, Blob, Response, Array, Object, String, Number,
  setTimeout, clearTimeout, Promise, parseInt, parseFloat, Error,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
const ctx = vm.createContext(sandbox);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
}

function load() {
  for (const f of ['seed.js', 'md.js', 'zip.js', 'memory.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
}

console.log('\n[1] 加载');
load();
ok('seed.js 定义 SEED_SOUL', vm.runInContext('typeof SEED_SOUL === "string" && SEED_SOUL.length > 500', ctx));
ok('暴露 window.MEM', vm.runInContext('typeof window.MEM', ctx) === 'object');
ok('暴露 window.ZIP', vm.runInContext('typeof window.ZIP', ctx) === 'object');
ok('暴露 window.MD', vm.runInContext('typeof window.MD', ctx) === 'object');

console.log('\n[2] 首次启动即带人格');
vm.runInContext('window.MEM.init()', ctx);
const stats = vm.runInContext('JSON.stringify(window.MEM.stats())', ctx);
ok('记忆页 >= 4', JSON.parse(stats).pages >= 4, stats);
ok('SOUL.md 就位', vm.runInContext('!!window.MEM.get("SOUL.md")', ctx));
ok('SOUL 含「汐」', vm.runInContext('window.MEM.get("SOUL.md").body.includes("汐")', ctx));

console.log('\n[3] 系统提示');
const prompt = vm.runInContext('window.MEM.prompt({recalled: []})', ctx);
ok('提示里有 SOUL', prompt.includes('SOUL.md'));
ok('提示里有记忆索引', prompt.includes('记忆索引'));
ok('提示里有工作方式', prompt.includes('没有代码执行'));
ok('提示里有写记忆通道', prompt.includes('xi-memory'));
ok('提示长度合理', prompt.length > 800 && prompt.length < 20000, prompt.length);

console.log('\n[4] 召回');
vm.runInContext('window.MEM.upsert({path:"skills/flutter.md",title:"Flutter 构建坑",type:"skill",salience:2,summary:"Gradle 下载慢、aapt2 版本不匹配",body:"### 坑\\n- gradle 需要代理\\n- aapt2 版本要和 build-tools 对齐"})', ctx);
const hits = vm.runInContext('JSON.stringify(window.MEM.recall("gradle 下载太慢怎么办", 3).map(p=>p.path))', ctx);
ok('关键词召回命中 flutter', JSON.parse(hits).includes('skills/flutter.md'), hits);
const hits2 = vm.runInContext('JSON.stringify(window.MEM.recall("完全无关的词组 zzzz", 3))', ctx);
ok('无关查询不瞎召回', JSON.parse(hits2).length === 0, hits2);

console.log('\n[5] index / log 派生');
const idx = vm.runInContext('window.MEM.indexText()', ctx);
ok('index 有标题', idx.startsWith('# Memory Index'));
ok('index 收录新页', idx.includes('skills/flutter.md'));
ok('index 带 salience 标记', idx.includes('`salience:2`'));
vm.runInContext('window.MEM.addLog("fact","测试一条")', ctx);
ok('log 追加成功', vm.runInContext('window.MEM.logText()', ctx).includes('测试一条'));

console.log('\n[6] zip 往返');
const zipBytes = vm.runInContext('window.ZIP.create(window.MEM.exportFiles())', ctx);
ok('zip 有 #PK 头', zipBytes[0] === 0x50 && zipBytes[1] === 0x4b, zipBytes.length + ' bytes');
ok('zip 体积合理', zipBytes.length > 1000, zipBytes.length);
vm.runInContext('globalThis.__zip = window.ZIP.create(window.MEM.exportFiles())', ctx);

console.log('\n[7] markdown 渲染');
const md = vm.runInContext('window.MD.render("# 标题\\n\\n**粗** 和 `code`\\n\\n- a\\n  - b\\n\\n```js\\nx()\\n```\\n\\n| a | b |\\n|---|---|\\n| 1 | 2 |")', ctx);
ok('h1', md.includes('<h1>标题</h1>'));
ok('strong', md.includes('<strong>粗</strong>'));
ok('inline code', md.includes('<code>code</code>'));
ok('嵌套列表', md.includes('<ul><li>a<ul><li>b</li></ul></li></ul>'), md.slice(0, 300));
ok('代码块 + 语言', md.includes('<pre><code>x()</code><span class="lang">js</span></pre>'));
ok('表格', md.includes('<table>') && md.includes('<td>1</td>'));
ok('XSS 转义', vm.runInContext('window.MD.render("<img src=x onerror=alert(1)>")', ctx).includes('&lt;img'));

console.log('\n[8] 导入解析（frontmatter）');
vm.runInContext(`
  globalThis.__imp = window.MEM.importFiles([
    {path:'user/preferences.md', text:'---\\ntitle: 偏好\\ntype: user\\nsalience: 1\\nsummary: 短句\\n---\\n\\n### 正文\\n- 直说'},
    {path:'index.md', text:'# 忽略我'}
  ], 'merge');
`, ctx);
const imp = JSON.parse(vm.runInContext('JSON.stringify(globalThis.__imp)', ctx));
ok('导入 1 页', imp.added + imp.updated === 1, JSON.stringify(imp));
ok('index.md 被跳过', imp.skipped === 1, JSON.stringify(imp));
ok('frontmatter 生效', vm.runInContext('window.MEM.get("user/preferences.md").salience === 1', ctx));
ok('正文剥离正确', vm.runInContext('!window.MEM.get("user/preferences.md").body.includes("---")', ctx));

console.log('\n[9] 导出文件清单');
const files = JSON.parse(vm.runInContext('JSON.stringify(window.MEM.exportFiles().map(f=>f.path))', ctx));
ok('含 SOUL.md', files.includes('SOUL.md'));
ok('含 index.md', files.includes('index.md'));
ok('含 log.md', files.includes('log.md'));
ok('含页面', files.includes('skills/flutter.md'));

console.log('\n[10] 同步：三方合并');

/*
  场景（模拟：手机 = 本地，电脑 = 远端）：
  proj/a.md  两端改不同行   → 自动合并，两边改动都保留
  proj/b.md  两端改同一行   → 冲突，本地保留 + 远端另存
  proj/c.md  只有远端新增   → 新增
  identity/self.md 远端删除 → 删除
  SOUL.md    都没动         → 跳过
*/
vm.runInContext(`
globalThis.__syncRun = function () {
  var M = window.MEM, dec = new TextDecoder();
  function snap() {
    return M.exportFiles('电脑').map(function (f) { return { path: f.path, text: dec.decode(f.data) }; });
  }
  function find(a, p) { for (var i = 0; i < a.length; i++) if (a[i].path === p) return a[i]; return null; }

  M.reset();
  M.init();
  M.upsert({ path: 'proj/a.md', title: 'A', type: 'project', salience: 1, summary: 'A页', body: 'line1\\nline2\\nline3\\nline4\\nline5' });
  M.upsert({ path: 'proj/b.md', title: 'B', type: 'project', salience: 1, summary: 'B页', body: 'b1\\nb2\\nb3' });

  var remote = snap();   // 同时写入基线

  // 本地改
  M.upsert({ path: 'proj/a.md', title: 'A', type: 'project', salience: 1, summary: 'A页', body: 'line1\\n本地改2\\nline3\\nline4\\nline5' });
  M.upsert({ path: 'proj/b.md', title: 'B', type: 'project', salience: 1, summary: 'B页', body: 'b1\\n本地改2\\nb3' });

  // 远端改
  find(remote, 'proj/a.md').text = find(remote, 'proj/a.md').text.replace('line5', '远端改5');
  find(remote, 'proj/b.md').text = find(remote, 'proj/b.md').text.replace('b2', '远端改2');
  remote.push({ path: 'proj/c.md', text: '---\\ntitle: C\\ntype: fact\\nsalience: 2\\nsummary: C页\\n---\\n\\nc1' });
  remote = remote.filter(function (e) { return e.path !== 'identity/self.md'; });

  var plan = M.planImport(remote);
  var acts = {};
  plan.entries.forEach(function (it) { acts[it.path] = it.action; });
  var res = M.applyImport(plan);

  // 第二轮：同一份 zip 再进来，冲突页不能被远端覆盖
  var plan2 = M.planImport(remote);
  var acts2 = {};
  plan2.entries.forEach(function (it) { acts2[it.path] = it.action; });

  globalThis.__sync = JSON.stringify({
    hasManifest: plan.hasManifest,
    device: plan.device,
    acts: acts,
    counts: res.counts,
    aBody: M.get('proj/a.md').body,
    bBody: M.get('proj/b.md').body,
    hasC: !!M.get('proj/c.md'),
    selfGone: !M.get('identity/self.md'),
    conflicts: M.list().filter(function (p) { return p.path.indexOf('conflicts/') === 0; }).length,
    acts2: acts2,
  });
};
`, ctx);

vm.runInContext('globalThis.__syncRun()', ctx);
const sync = JSON.parse(vm.runInContext('globalThis.__sync', ctx));

ok('带 manifest 的导出被识别', sync.hasManifest === true, sync.device);
ok('a.md 自动合并', sync.acts['proj/a.md'] === 'merge', sync.acts['proj/a.md']);
ok('合并结果含本地改动', sync.aBody.includes('本地改2'));
ok('合并结果含远端改动', sync.aBody.includes('远端改5'));
ok('合并结果没丢原文', sync.aBody.includes('line3'));
ok('b.md 判为冲突', sync.acts['proj/b.md'] === 'conflict', sync.acts['proj/b.md']);
ok('冲突时本地版本保留', sync.bBody.includes('本地改2') && !sync.bBody.includes('远端改2'));
ok('冲突另存一份到 conflicts/', sync.conflicts === 1, String(sync.conflicts));
ok('远端新增页被吸收', sync.hasC === true);
ok('远端删除的页被删掉', sync.selfGone === true);
ok('没动的页跳过', sync.acts['SOUL.md'] === 'same', sync.acts['SOUL.md']);
ok('计数正确', sync.counts.merge === 1 && sync.counts.conflict === 1 &&
  sync.counts.add === 1 && sync.counts.del === 1, JSON.stringify(sync.counts));
ok('基线正确推进（b 不再被覆盖）', sync.acts2['proj/b.md'] === 'local-ahead', sync.acts2['proj/b.md']);
ok('合并结果不会被旧 zip 冲掉', sync.acts2['proj/a.md'] === 'local-ahead', sync.acts2['proj/a.md']);

console.log('\n[11] 样式完整性');
{
  const css = fs.readFileSync(path.join(A, 'style.css'), 'utf8');
  const darkCount = (css.match(/\[data-theme="dark"\]/g) || []).length;
  ok('深色主题规则在（>20 条）', darkCount > 20, '实际 ' + darkCount);
  ok('toast 样式在', css.includes('.toast {'));
  ok('注释成对', (css.split('/*').length - 1) === (css.split('*/').length - 1),
    '开 ' + (css.split('/*').length - 1) + ' / 闭 ' + (css.split('*/').length - 1));
  ok('没有被吞掉的收尾', css.trim().length > 20000, css.trim().length + ' 字节');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
