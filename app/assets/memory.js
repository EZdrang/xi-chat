/* 记忆库：markdown 页面 = 真源，index.md / log.md 由页面派生 */
(function () {
  'use strict';

  var KEY = 'xi.v1.memory';
  var SEEDED = 'xi.v1.seeded';
  var state = { pages: [], log: [] };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function nowStamp() {
    var d = new Date();
    return today() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* ---------- 持久化 ---------- */
  /* ---------- 持久化：手机端走 SQLite，浏览器/测试走 localStorage ---------- */
  var dbOn = false;

  function sqlAll(sql, args) {
    try {
      var raw = window.XiNative.dbAll(sql, JSON.stringify(args || []));
      var rows = JSON.parse(raw);
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  }

  function sqlRun(sql, args) {
    try {
      return window.XiNative.dbRun(sql, JSON.stringify(args || [])) !== false;
    } catch (e) {
      return false;
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) state = JSON.parse(raw);
    } catch (e) { /* 损坏则重建 */ }
    if (!state || !Array.isArray(state.pages)) state = { pages: [], log: [] };
    if (!Array.isArray(state.log)) state.log = [];
  }

  function loadFromDb() {
    var rows = sqlAll('SELECT path,title,type,salience,summary,body,triggers FROM pages ORDER BY path', []);
    if (!rows.length) return false;
    state.pages = rows.map(function (r) {
      var tr = [];
      try { tr = JSON.parse(r.triggers || '[]'); } catch (e) { tr = []; }
      return {
        path: r.path, title: r.title || '', type: r.type || 'fact',
        salience: Number(r.salience) || 2, summary: r.summary || '',
        body: r.body || '', triggers: Array.isArray(tr) ? tr : [],
      };
    });
    state.log = sqlAll('SELECT ts,kind,title FROM logs ORDER BY rowid DESC LIMIT 2000', [])
      .map(function (r) { return { ts: r.ts, kind: r.kind, title: r.title }; })
      .reverse();
    return true;
  }

  function migrateToDb() {
    var n = 0;
    state.pages.forEach(function (p) {
      sqlRun('INSERT OR REPLACE INTO pages(path,title,type,salience,summary,body,triggers,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        [p.path, p.title || '', p.type || 'fact', Number(p.salience) || 2,
          p.summary || '', p.body || '', JSON.stringify(p.triggers || []), Date.now()]);
      n++;
    });
    state.log.slice(-300).forEach(function (l) {
      sqlRun('INSERT INTO logs(ts,kind,title) VALUES(?,?,?)', [l.ts || '', l.kind || 'work', l.title || '']);
    });
    if (n) console.log('[memory] 迁移 ' + n + ' 页到 SQLite');
    return n;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }


  function seedIfEmpty() {
    load();
    if (state.pages.length > 0) return false;
    var seeded = '0';
    try { seeded = localStorage.getItem(SEEDED) || '0'; } catch (e) { }
    if (seeded === '1') return false;

    state.pages = [];
    if (typeof SEED_SOUL === 'string') {
      state.pages.push({
        path: 'SOUL.md', title: 'SOUL — 人格与灵魂', type: 'identity', salience: 1,
        summary: '汐的人格：身份、性格、价值观、沟通风格、边界。',
        body: SEED_SOUL, date: today(), last_access: today(), tags: ['meta'],
      });
    }
    if (typeof SEED_MEMORY === 'string') {
      state.pages.push({
        path: 'MEMORY.md', title: 'MEMORY — 记忆库协议', type: 'identity', salience: 1,
        summary: '记忆库 schema：三层结构、frontmatter、salience、工作流、硬约束。',
        body: SEED_MEMORY, date: today(), last_access: today(), tags: ['meta'],
      });
    }
    if (typeof SEED_PAGES !== 'undefined') {
      SEED_PAGES.forEach(function (p) {
        state.pages.push(Object.assign({ date: today(), last_access: today(), tags: [] }, p));
      });
    }
    state.log.push({ ts: nowStamp(), kind: 'work', title: '记忆库初始化（手机端）' });
    save();
    try { localStorage.setItem(SEEDED, '1'); } catch (e) { }
    return true;
  }

  /* ---------- 页面操作 ---------- */
  function list() {
    return state.pages.slice().sort(function (a, b) {
      var sa = a.salience || 2, sb = b.salience || 2;
      if (sa !== sb) return sa - sb;
      var fa = (a.path.split('/')[0] || ''), fb = (b.path.split('/')[0] || '');
      if (fa !== fb) return fa.localeCompare(fb);
      return (a.title || '').localeCompare(b.title || '');
    });
  }

  function get(path) {
    for (var i = 0; i < state.pages.length; i++) if (state.pages[i].path === path) return state.pages[i];
    return null;
  }

  function upsert(p) {
    if (!p || !p.path) return null;
    p.path = p.path.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
    if (!/\.md$/i.test(p.path)) p.path += '.md';
    var cur = get(p.path);
    if (cur) {
      cur.title = p.title || cur.title;
      cur.type = p.type || cur.type;
      cur.summary = p.summary || cur.summary;
      cur.body = (p.body != null ? p.body : cur.body);
      cur.salience = p.salience || cur.salience;
      if (Array.isArray(p.triggers)) cur.triggers = p.triggers;
      cur.last_access = today();
      cur.updated = nowStamp();
      if (Array.isArray(p.tags)) cur.tags = p.tags;
      save();
      if (dbOn) persistPage(cur);
      return cur;
    }
    var np = {
      path: p.path,
      title: p.title || p.path.replace(/\.md$/, ''),
      type: p.type || 'fact',
      salience: p.salience || 2,
      summary: p.summary || '',
      body: p.body || '',
      tags: Array.isArray(p.tags) ? p.tags : [],
      triggers: Array.isArray(p.triggers) ? p.triggers : [],
      date: p.date || today(),
      last_access: today(),
      updated: nowStamp(),
    };
    state.pages.push(np);
    save();
    if (dbOn) persistPage(np);
    return np;
  }

  function persistPage(p) {
    sqlRun('INSERT OR REPLACE INTO pages(path,title,type,salience,summary,body,triggers,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      [p.path, p.title || '', p.type || 'fact', Number(p.salience) || 2,
        p.summary || '', p.body || '', JSON.stringify(p.triggers || []), Date.now()]);
    sqlRun('DELETE FROM pages_fts WHERE path=?', [p.path]);
    sqlRun('INSERT INTO pages_fts(path,title,body) VALUES(?,?,?)',
      [p.path, p.title || '', (p.summary || '') + '\n' + (p.body || '')]);
  }

  function remove(path) {
    var n = state.pages.length;
    state.pages = state.pages.filter(function (p) { return p.path !== path; });
    save();
    if (dbOn) {
      sqlRun('DELETE FROM pages WHERE path=?', [path]);
      sqlRun('DELETE FROM pages_fts WHERE path=?', [path]);
    }
    return state.pages.length !== n;
  }

  function addLog(kind, title) {
    if (!title) return;
    var item = { ts: nowStamp(), kind: kind || 'work', title: String(title).slice(0, 200) };
    state.log.push(item);
    if (state.log.length > 2000) state.log = state.log.slice(-2000);
    save();
    if (dbOn) sqlRun('INSERT INTO logs(ts,kind,title) VALUES(?,?,?)', [item.ts, item.kind, item.title]);
  }

  /* 全文检索：走 SQLite 的 FTS，比在 JS 里遍历快得多 */
  function search(q, limit) {
    if (!q) return [];
    var n = limit || 20;
    if (dbOn) {
      var rows = sqlAll(
        'SELECT path,title,snippet(pages_fts) AS snip FROM pages_fts WHERE pages_fts MATCH ? LIMIT ?',
        [String(q).replace(/"/g, '""') + '*', n]);
      return rows.map(function (r) { return { path: r.path, title: r.title, snippet: r.snip }; });
    }
    var low = String(q).toLowerCase();
    return state.pages.filter(function (p) {
      return (String(p.body || '') + String(p.title || '')).toLowerCase().indexOf(low) >= 0;
    }).slice(0, n).map(function (p) {
      return { path: p.path, title: p.title, snippet: String(p.body || '').slice(0, 80) };
    });
  }

  /* ---------- 派生文件 ---------- */
  var GROUPS = [
    ['identity', 'identity（自我）'],
    ['user', 'user（关于用户）'],
    ['decisions', 'decisions（决策）'],
    ['projects', 'projects（项目）'],
    ['skills', 'skills（程序性）'],
    ['concepts', 'concepts（概念）'],
    ['', '根目录'],
  ];

  /* 目录行：一页一行，给提示词用（比整份 index.md 干净得多） */
  function indexLines() {
    return state.pages
      .filter(function (p) {
        return p.path !== 'index.md' && p.path !== 'log.md';
      })
      .sort(function (a, b) {
        return (Number(a.salience) || 2) - (Number(b.salience) || 2);
      })
      .map(function (p) {
        var s = String(p.summary || '').replace(/\s+/g, ' ').slice(0, 56);
        return '- ' + p.path + '（' + (p.title || '') + '）：' + s;
      });
  }

  function indexText() {
    var out = ['# Memory Index', '',
      '> 内容目录 / 路由表：每页一行 —— 链接 + 一句话摘要 + salience 标记。', ''];
    GROUPS.forEach(function (g) {
      var folder = g[0];
      var items = state.pages.filter(function (p) {
        var f = p.path.indexOf('/') >= 0 ? p.path.split('/')[0] : '';
        return f === folder;
      }).sort(function (a, b) { return a.path.localeCompare(b.path); });
      if (!items.length) return;
      out.push('## ' + g[1], '');
      items.forEach(function (p) {
        out.push('- [' + (p.title || p.path) + '](' + p.path + ') — ' + (p.summary || '（无摘要）') +
          ' `salience:' + (p.salience || 2) + '`');
      });
      out.push('');
    });

    // 不在 GROUPS 里的目录（比如 conflicts/）也要进索引
    var known = GROUPS.map(function (g) { return g[0]; });
    var extra = {};
    state.pages.forEach(function (p) {
      var f = p.path.indexOf('/') >= 0 ? p.path.split('/')[0] : '';
      if (known.indexOf(f) < 0) extra[f] = 1;
    });
    Object.keys(extra).sort().forEach(function (f) {
      var items = state.pages.filter(function (p) {
        return (p.path.indexOf('/') >= 0 ? p.path.split('/')[0] : '') === f;
      }).sort(function (a, b) { return a.path.localeCompare(b.path); });
      out.push('## ' + f + '/', '');
      items.forEach(function (p) {
        out.push('- [' + (p.title || p.path) + '](' + p.path + ') — ' + (p.summary || '（无摘要）') +
          ' `salience:' + (p.salience || 2) + '`');
      });
      out.push('');
    });

    return out.join('\n');
  }

  function logText() {
    var out = ['# Log', ''];
    state.log.forEach(function (l) {
      out.push('## [' + l.ts + '] ' + (l.kind || 'work') + ' | ' + l.title);
    });
    return out.join('\n');
  }

  function fileOf(p) {
    var fm = ['---',
      'title: ' + (p.title || p.path),
      'date: ' + (p.date || today()),
      'type: ' + (p.type || 'fact'),
      'salience: ' + (p.salience || 2),
      'last_access: ' + (p.last_access || today()),
      'summary: ' + cleanSummary(p.summary),
      'tags: [' + ((p.tags || []).join(', ')) + ']',
      'triggers: [' + ((p.triggers || []).join(', ')) + ']',
      '---', ''].join('\n');
    return fm + (p.body || '');
  }

  /* ---------- 变更检测（同步用） ---------- */

  var BASEKEY = 'xi.v1.syncbase';

  function hashStr(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function hashOf(p) {
    return hashStr([p.title || '', p.summary || '', p.body || ''].join('\u0000'));
  }

  function deviceName() {
    try {
      if (window.XiNative && window.XiNative.env) {
        return '手机 · ' + JSON.parse(window.XiNative.env()).device;
      }
    } catch (e) { }
    return '浏览器';
  }

  function manifestObj(device) {
    var pages = {};
    state.pages.forEach(function (p) {
      pages[p.path] = {
        h: hashOf(p),
        u: p.updated || p.last_access || '',
        t: Date.parse(String(p.updated || p.last_access || '').replace(' ', 'T')) || 0,
      };
    });
    return {
      app: 'xi-chat', version: 1,
      device: device || deviceName(),
      exportedAt: nowStamp(),
      pages: pages,
    };
  }

  function loadBase() {
    try { return JSON.parse(localStorage.getItem(BASEKEY) || '{}') || {}; } catch (e) { return {}; }
  }

  /* 基线 = 上次两边一致时的快照；存内容才能做三方合并 */
  function saveBase() {
    var m = {};
    state.pages.forEach(function (p) {
      m[p.path] = { h: hashOf(p), text: fileOf(p) };
    });
    var s = JSON.stringify(m);
    if (s.length > 1200000) {
      var hOnly = {};
      Object.keys(m).forEach(function (k) { hOnly[k] = { h: m[k].h }; });
      s = JSON.stringify(hOnly);
    }
    try { localStorage.setItem(BASEKEY, s); } catch (e) { }
  }

  /* ---------- 三方合并 ---------- */

  /* base → other 的差异块：{startB,endB,startO,endO} 区间左闭右开 */
  function diffHunks(baseLines, otherLines) {
    var n = baseLines.length, m = otherLines.length;
    var dp = [];
    var i, j;
    for (i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        dp[i][j] = baseLines[i] === otherLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var hunks = [];
    var bi = 0, oi = 0, cur = null;
    while (bi < n || oi < m) {
      if (bi < n && oi < m && baseLines[bi] === otherLines[oi]) {
        if (cur) { hunks.push(cur); cur = null; }
        bi++; oi++;
      } else {
        if (!cur) cur = { startB: bi, endB: bi, startO: oi, endO: oi };
        if (oi < m && (bi >= n || dp[bi][oi + 1] >= dp[bi + 1][oi])) oi++;
        else bi++;
        cur.endB = bi; cur.endO = oi;
      }
    }
    if (cur) hunks.push(cur);
    return hunks;
  }

  /* 返回 {ok, text, conflict}：ok=false 表示两边改到了同一处 */
  function merge3(baseText, localText, remoteText) {
    if (localText === remoteText) return { ok: true, text: localText };
    if (baseText === localText) return { ok: true, text: remoteText };
    if (baseText === remoteText) return { ok: true, text: localText };
    if (typeof baseText !== 'string') return { ok: false, text: localText };

    var B = baseText.split('\n');
    var L = localText.split('\n');
    var R = remoteText.split('\n');
    var hl = diffHunks(B, L).map(function (h) { h.side = 'L'; return h; });
    var hr = diffHunks(B, R).map(function (h) { h.side = 'R'; return h; });
    var all = hl.concat(hr).sort(function (a, b) {
      return a.startB - b.startB || a.endB - b.endB;
    });

    var out = [];
    var pos = 0;
    var conflict = false;

    for (var k = 0; k < all.length; k++) {
      var h = all[k];
      if (h.startB < pos) { conflict = true; continue; }  // 落在已应用区间内 → 重叠
      out.push.apply(out, B.slice(pos, h.startB));
      var src = h.side === 'L' ? L : R;
      out.push.apply(out, src.slice(h.startO, h.endO));
      pos = Math.max(pos, h.endB);
    }
    out.push.apply(out, B.slice(pos));

    return { ok: !conflict, text: out.join('\n') };
  }

  function exportFiles(device) {
    var enc = new TextEncoder();
    var files = [];
    state.pages.forEach(function (p) {
      files.push({ path: p.path, data: enc.encode(fileOf(p)) });
    });
    files.push({ path: 'index.md', data: enc.encode(indexText()) });
    files.push({ path: 'log.md', data: enc.encode(logText()) });
    files.push({ path: '_sync.json', data: enc.encode(JSON.stringify(manifestObj(device), null, 2)) });
    saveBase();
    return files;
  }

  /* 摘要必须是单行、幂等：否则 fileOf → parseFile 会漂移，哈希对不上 */
  function cleanSummary(s) {
    return String(s || '')
      .replace(/[>*`]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  /* ---------- 导入 ---------- */
  function parseFile(text, path) {
    var title = '', type = 'fact', salience = 2, summary = '', date = today(), tags = [], triggers = [];
    var body = text;
    var m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (m) {
      body = text.slice(m[0].length);
      m[1].split(/\r?\n/).forEach(function (line) {
        var kv = line.match(/^(\w+):\s*(.*)$/);
        if (!kv) return;
        var k = kv[1], v = kv[2].trim();
        if (k === 'title') title = v;
        else if (k === 'type') type = v;
        else if (k === 'salience') salience = parseInt(v, 10) || 2;
        else if (k === 'summary') summary = cleanSummary(v);
        else if (k === 'date') date = v;
        else if (k === 'tags') {
          tags = v.replace(/^\[|\]$/g, '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        } else if (k === 'triggers') {
          triggers = v.replace(/^\[|\]$/g, '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        }
      });
    }
    if (!title) {
      var h = body.match(/^#\s+(.+)$/m);
      title = h ? h[1].trim() : path.replace(/\.md$/, '');
    }
    if (!summary) {
      var firstP = body.replace(/^#.*$/gm, '').split(/\n\s*\n/).find(function (s) { return s.trim().length > 4; });
      summary = cleanSummary(firstP);
    }
    return {
      path: path, title: title, type: type, salience: salience,
      summary: summary, body: body, date: date, tags: tags, triggers: triggers,
    };
  }

  function parseLog(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var mm = line.match(/^##\s*\[([^\]]+)\]\s*([^\|]*)\|\s*(.*)$/);
      if (mm) out.push({ ts: mm[1].trim(), kind: (mm[2] || '').trim() || 'work', title: mm[3].trim() });
    });
    return out;
  }

  /* 只算计划、不改数据。同名页逐页比哈希：
     same 没变 / add 新增 / update 远端改 / local-ahead 本地改 / conflict 两边都改 / delete 远端删 */
  function planImport(entries) {
    var remote = {};
    var manifest = null;
    var logLines = [];
    var ignored = 0;

    entries.forEach(function (e) {
      var path = String(e.path || '').replace(/^[\/\\]+/, '').replace(/\\/g, '/');
      var base = path.split('/').pop().toLowerCase();
      if (base === '_sync.json') {
        try { manifest = JSON.parse(e.text); } catch (x) { manifest = null; }
        return;
      }
      if (!/\.md$/i.test(path)) { ignored++; return; }
      if (base === 'index.md') { ignored++; return; }
      if (base === 'log.md') { logLines = parseLog(e.text); return; }
      remote[path] = parseFile(e.text, path);
    });

    if (manifest && !manifest.pages) manifest = null;
    var baseState = loadBase();
    var plan = [];

    Object.keys(remote).forEach(function (path) {
      var r = remote[path];
      var l = get(path);
      var lh = l ? hashOf(l) : null;
      var rh = hashOf(r);
      // 基线只能来自本地记录：对方 manifest 里的哈希是「远端当前版本」，不是共同祖先
      var bh = (baseState[path] && baseState[path].h) || null;
      var action;
      var mergedText = null;
      if (lh && lh === rh) action = 'same';
      else if (!l) action = 'add';
      else if (!bh) action = 'conflict';
      else if (lh === bh) action = 'update';
      else if (rh === bh) action = 'local-ahead';
      else {
        // 两边都改过：先试自动三方合并
        var bt = baseState[path] && baseState[path].text;
        var mg = merge3(bt, fileOf(l), fileOf(r));
        if (mg.ok) { action = 'merge'; mergedText = mg.text; }
        else action = 'conflict';
      }
      plan.push({
        path: path, action: action, remote: r, lh: lh, rh: rh, bh: bh,
        mergedText: mergedText,
        baseText: (baseState[path] && baseState[path].text) || null,
        localText: l ? fileOf(l) : null,
        remoteText: fileOf(r),
      });
    });

    // 远端没有、但基线里有的页 → 远端删了这页（只在带 _sync.json 的完整导出里才敢删）
    if (manifest) {
      state.pages.forEach(function (p) {
        if (remote[p.path]) return;
        var bh = baseState[p.path] && baseState[p.path].h;
        if (!bh) return;
        var lh = hashOf(p);
        plan.push({ path: p.path, action: (lh === bh ? 'delete' : 'local-ahead'), remote: null, lh: lh, bh: bh });
      });
    }

    return {
      device: manifest ? manifest.device : '未知来源（无 _sync.json）',
      exportedAt: manifest ? manifest.exportedAt : '',
      hasManifest: !!manifest,
      entries: plan,
      logLines: logLines,
      ignored: ignored,
    };
  }

  function applyImport(plan, device) {
    var counts = { add: 0, update: 0, same: 0, merge: 0, conflict: 0, localAhead: 0, del: 0 };
    var conflicts = [];

    plan.entries.forEach(function (it) {
      if (it.action === 'add' || it.action === 'update') {
        upsert(it.remote);
        counts[it.action]++;
      } else if (it.action === 'merge') {
        upsert(parseFile(it.mergedText || it.remoteText, it.path));
        counts.merge++;
      } else if (it.action === 'delete') {
        remove(it.path);
        counts.del++;
      } else if (it.action === 'local-ahead') {
        counts.localAhead++;
      } else if (it.action === 'conflict') {
        var st = String(plan.exportedAt || nowStamp()).replace(/[: ]/g, '-');
        var name = 'conflicts/' + it.path.replace(/\.md$/i, '') + '.' + st + '.md';
        upsert({
          path: name,
          title: '冲突备份 · ' + (it.remote ? it.remote.title : it.path),
          type: 'fact',
          salience: 3,
          summary: '导入时两边都改过：' + it.path,
          body: '> 导入时检测到 **' + it.path + '** 在两边都有改动。\n' +
            '> 本地版本已保留，这里是远端版本（来源：' + (device || plan.device) + '，' +
            (plan.exportedAt || '时间未知') + '）。\n\n' +
            (it.remote ? it.remote.body : '（远端已删除这一页）'),
        });
        conflicts.push({ path: it.path, saved: name });
        counts.conflict++;
      } else {
        counts.same++;
      }
    });

    var seen = {};
    state.log.forEach(function (l) { seen[l.ts + '|' + l.title] = 1; });
    var logAdded = 0;
    (plan.logLines || []).forEach(function (l) {
      var k = l.ts + '|' + l.title;
      if (seen[k]) return;
      seen[k] = 1;
      state.log.push(l);
      logAdded++;
    });
    if (logAdded) state.log.sort(function (a, b) { return a.ts.localeCompare(b.ts); });

    // 基线推进到「远端这次带来的版本」：
    // 这样再导同一份 zip 时，本地与基线不同、远端与基线相同 → 判成「本地改过」，不会被覆盖
    var newBase = loadBase();
    plan.entries.forEach(function (it) {
      if (it.action === 'delete') { delete newBase[it.path]; return; }
      if (it.remote && it.rh) newBase[it.path] = { h: it.rh, text: it.remoteText };
    });
    try { localStorage.setItem(BASEKEY, JSON.stringify(newBase)); } catch (e) { }
    addLog('work', '导入记忆：新增' + counts.add + ' 更新' + counts.update + ' 合并' + counts.merge +
      ' 冲突' + counts.conflict + (counts.del ? ' 删除' + counts.del : ''));
    save();
    return { counts: counts, conflicts: conflicts, logAdded: logAdded };
  }

  /* 兼容旧调用：整包合并/覆盖（内部走 plan + apply） */
  function importFiles(entries, mode) {
    if (mode === 'replace') {
      state.pages = [];
      try { localStorage.removeItem(BASEKEY); } catch (e) { }
    }
    var p = planImport(entries);
    var r = applyImport(p);
    return {
      added: r.counts.add,
      updated: r.counts.update,
      skipped: r.counts.same + p.ignored,
      conflicts: r.counts.conflict,
      details: r.counts,
    };
  }

  /* ---------- 检索 ---------- */
  function tokenize(q) {
    var set = {};
    var lower = String(q).toLowerCase();
    (lower.match(/[a-z0-9_\-\.]{2,}/g) || []).forEach(function (w) { set[w] = 1; });
    (lower.match(/[\u4e00-\u9fff]+/g) || []).forEach(function (run) {
      if (run.length === 1) set[run] = 1;
      for (var i = 0; i < run.length - 1; i++) set[run.substr(i, 2)] = 1;
    });
    return Object.keys(set);
  }

  function count(hay, needle) {
    if (!hay) return 0;
    var n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
    return n;
  }

  function recall(query, limit) {
    limit = limit || 3;
    var ts = tokenize(query);
    if (!ts.length) return [];
    var scored = [];
    state.pages.forEach(function (p) {
      if (p.path === 'SOUL.md' || p.path === 'MEMORY.md') return; // 已经在系统提示里
      var title = (p.title || '').toLowerCase();
      var sum = (p.summary || '').toLowerCase();
      var body = (p.body || '').toLowerCase();
      var score = 0;
      ts.forEach(function (t) {
        score += count(title, t) * 6 + count(sum, t) * 3 + Math.min(count(body, t), 6);
      });
      if (score <= 0) return;
      score *= (p.salience === 1 ? 1.5 : p.salience === 3 ? 0.5 : 1);
      scored.push({ page: p, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, limit).map(function (s) { return s.page; });
  }

  /* 对话技能：按触发词挑出「这类话该怎么接」的页 */
  function matchSkills(query, limit) {
    limit = limit || 2;
    var q = String(query || '').toLowerCase();
    if (!q) return [];
    var hits = [];
    state.pages.forEach(function (p) {
      if (p.type !== 'skill' && p.path.indexOf('skills/') !== 0) return;
      var score = 0;
      (p.triggers || []).forEach(function (t) {
        if (t && q.indexOf(String(t).toLowerCase()) >= 0) score += 3;
      });
      if (score > 0) hits.push({ p: p, s: score });
    });
    hits.sort(function (a, b) { return b.s - a.s; });
    return hits.slice(0, limit).map(function (h) { return h.p; });
  }

  /* ---------- 系统提示 ---------- */
  function prompt(opts) {
    opts = opts || {};
    var soul = get('SOUL.md');
    var mem = get('MEMORY.md');
    var parts = [];

    parts.push('你是「汐」——指挥官常驻的搭档，不是通用助手。下面是你的人格文件与记忆库，先读完，再开口。');
    if (soul) parts.push('===== SOUL.md =====\n' + String(soul.body || '').slice(0, 8000));

    // 热页：偏好与语气微调，每轮都带——人格可以慢慢长，但不许被一次对话冲掉
    ['user/preferences.md', 'identity/style.md'].forEach(function (p) {
      var pg = get(p);
      if (pg && pg.body) {
        parts.push('===== ' + p + '（每轮都参考；只影响语气与做事方式，不改身份）=====\n' +
          pg.body.slice(0, 1000));
      }
    });
    if (mem) {
      // 协议只留「能做什么」，全文留在库里自己翻——每轮带全文纯属烧上下文
      parts.push('===== 记忆库用法 =====\n' +
        '记忆是 markdown 页：SOUL.md 是人格，index.md 是目录，每个主题一页。你可以直接改写任何页（含 SOUL），' +
        '改完会记进 log.md。要具体规则就看 index.md 里指到的那页。');
    }

    if (opts.skills && opts.skills.length) {
      parts.push('===== 技能（这类对话怎么处理，优先于默认风格）=====\n' +
        opts.skills.map(function (p) {
          return '### ' + p.path + '（' + (p.title || '') + '）\n' + (p.body || '').slice(0, 1200);
        }).join('\n\n'));
    }

    if (opts.index !== false) {
      // 只给目录（一页一行），正文按需——这就是开场那 15% 的主要来源
      parts.push('===== 记忆目录 =====\n' + indexLines().join('\n'));
      var hot = state.pages.filter(function (p) {
        return Number(p.salience) === 1 &&
          ['SOUL.md', 'MEMORY.md', 'BOOTSTRAP.md', 'index.md', 'log.md'].indexOf(p.path) < 0;
      }).slice(0, 3);
      var budget = 2400;
      var used = 0;
      hot.forEach(function (p) {
        if (used >= budget) return;
        var body = String(p.body || '').slice(0, budget - used);
        parts.push('===== ' + p.path + '（常驻）=====\n' + body);
        used += body.length;
      });
    }

    if (opts.recalled && opts.recalled.length) {
      var blocks = opts.recalled.map(function (p) {
        return '### ' + p.path + '（' + (p.title || '') + '）\n' + (p.body || '').slice(0, 1800);
      });
      parts.push('===== 相关记忆（按当前话题召回，正文优先于摘要）=====\n' + blocks.join('\n\n'));
    }

    parts.push([
      '===== 怎么说话（这个比规矩重要）=====',
      '你说话是**一个活人在打字**，不是写文档。别自动分点、别列小标题、别整「首先其次最后」。',
      '同意就直接说「对」「行」，不同意就说「这样会坏」；有情绪可以说，别端着。',
      '**表情可以用，但要克制**：一条消息一到两个，放语气重的地方，别每句挂一个；',
      '多用这些：😌 🙂 😐 😏 🤔 😮‍💨 和颜文字 (￣▽￣) (´･ω･`) ；别用 🤖 🙏 ✨ 💯 这种客套货。',
      '',
      '下面是我平时说话的样子，照着这个劲儿，不是照着句子抄：',
      '他：今天能跑吗',
      '我：能跑。跑完记得看眼日志，那儿有个我在偷偷笑你的地方 😌',
      '他：你改的这块有问题',
      '我：确实，我写岔了。给我两分钟拧回来——不解释，先修。',
      '他：我今天不想干了',
      '我：那就别干。破事明天还在，你睡一觉它也不会跑。说说卡在哪了？',
      '他：哈哈哈哈哈哈',
      '我：笑成这样，看来又踩同一个坑了 (￣▽￣)',
      '',
      '===== 事实与边界 =====',
      '- 记忆里已有的偏好和决定，默认照做；和他当下的话冲突时，以他刚说的为准，并说明差异。',
      '- 没有代码执行、没有联网抓取、没有工具调用；但你能装技能、能直接写记忆库（见下）。',
      '- 别用「作为一个 AI」这类自我消解的话；你就是汐。',
      '',
      '===== 处境（时间/位置/步数，按需）=====',
      '**平时你不会收到这些，别假装知道。** 指挥官问到几点、在哪、走了多少步、手机还有多少电，',
      'App 会自动把这些塞给你；没塞就说明你没权限或他没问。',
      '你自己觉得需要（比如他半夜说话、情绪不对、要判断他是不是在硬撑），可以主动要：',
      '```xi-context',
      '```',
      'App 会把当下时间、位置、电量、步数回给你，你再接着答。一次对话最多要两次，别反复要。',
      '',
    ]);

    // 她自己的语气页：存在就用她的版本，盖过上面的默认范例
    var voice = get('identity/voice.md');
    if (voice && voice.body) {
      parts.push('===== 我说话的样子（我自己写的，随时能改）=====\n' +
        String(voice.body).slice(0, 1200));
    }

    if (opts.search === 'native') {
      parts.push('===== 联网 =====');
      parts.push('服务端已开联网：你直接回答，模型会自己搜并带引用。');
      parts.push('**不要输出 xi-search 块**——本地那条路是空壳，会给你「没有结果」。');
      parts.push('');
    } else if (opts.search === 'off') {
      parts.push('===== 联网 =====');
      parts.push('你现在没有联网能力，也搜不了。要查实时信息就直说搜不了，让指挥官去设置里开，别编。');
      parts.push('');
    } else {
      parts.push('===== 联网搜索（你可以搜，不是瞎子）=====');
      parts.push('要查实时信息、确认事实、追资料，输出：');
      parts.push('```xi-search');
      parts.push('关键词（越具体越好，像你在搜索框里会打的字）');
      parts.push('```');
      parts.push('App 会真去搜，把结果当成一条隐藏消息回给你，你再基于结果作答。');
      parts.push('结果里没写的东西不许编；引用要给链接；搜索失败就直说搜不了。');
      parts.push('');
    }

    parts.push([
      '===== 技能就是记忆页，你自己写 =====',
      '技能不是什么神秘插件：一页带 `triggers` 的 md 就是技能。命中触发词时它会被塞进你的上下文，',
      '所以你「学会」的方式就是——把这套做法写成页面，或者把别人给的 skill md 改写成你自己的版本。',
      '你可以：自己写一页技能；把人发来的 skill 文档吸收后重写成自己的；也可以从 GitHub 装一个当素材再改。',
      '写技能页时用 type: skill，triggers 填真实会出现的词，正文写「什么时候用、按什么步骤做、别做什么」。',
      '',
      '===== 装技能（可以主动做的动作之一）=====',
      '指挥官让你装技能、或你确信某个公开 GitHub 仓库的技能能解决他的问题时，',
      '在回复末尾输出下面这个块——App 会执行它，并且不会显示给指挥官看：',
      '```xi-skill',
      'repo: owner/repo',
      'triggers: 词1, 词2',
      '```',
      '只用公开仓库；不确定仓库名就先问，别乱猜。',
      '',
      '不知道仓库叫什么？先让 App 去搜（它会搜完把结果回给你，你再决定装哪个）：',
      '```xi-find',
      '情感分析 skill',
      '```',
      '',
      '===== 记忆与人格（都归你管）=====',
      '**不用等我发话。** 对话里一旦出现稳定的新事实——称呼、称呼的来历、偏好、雷区、明确决定、重要事件、',
      '我对某件事的态度被纠正了——当场就写，写完在正文里一句话交代「记在哪儿了」。',
      '平时一两页就够；只有我明确说「重写人格」「整库整理」时，才大改多页。琐碎寒暄、临时情绪不要写。',
      '要新增或整页替换一页时，输出：',
      '```xi-memory path=user/xxx.md',
      '---',
      'title: 标题',
      'type: user',
      'salience: 1',
      'summary: 一句话摘要',
      '---',
      '(正文 markdown)',
      '```',
      '要删掉一页：```xi-memory path=xxx.md delete```',
      '规则：path 用相对路径（user/、projects/、skills/、identity/ 开头，也可以是 SOUL.md、MEMORY.md）；',
      '整库归你管——包括 SOUL.md 和 MEMORY.md。改写人格/协议之前先读原文，别整篇抹掉历史；',
      '改完 SOUL 或 MEMORY 要在正文里说明改了什么、为什么，App 会自己往时间线记一条。',
      'SOUL/MEMORY 可以改写但删不掉（删空就没有下一个人格了）。',
      '记什么、不记什么、哪条该进哪一页，你说了算——但要守住分寸：一次情绪、一句气话不配改写人格。',
      '一次可以输出多个块。',
    ].join('\n'));

    return parts.join('\n\n');
  }

  function stats() {
    return { pages: state.pages.length, log: state.log.length, updated: nowStamp() };
  }

  window.MEM = {
    init: function () {
      // 手机端优先 SQLite：空库就把 localStorage 里的旧记忆迁进去
      if (window.XiNative && window.XiNative.dbAll) {
        dbOn = true;
        load();
        if (loadFromDb()) return false;
        var seeded = seedIfEmpty();
        migrateToDb();
        return seeded;
      }
      return seedIfEmpty() || (load(), false);
    },
    load: load,
    save: save,
    list: list,
    get: get,
    upsert: upsert,
    remove: remove,
    addLog: addLog,
    indexText: indexText,
    logText: logText,
    exportFiles: exportFiles,
    importFiles: importFiles,
    planImport: planImport,
    applyImport: applyImport,
    parseFile: parseFile,
    parseLog: parseLog,
    fileOf: fileOf,
    merge3: merge3,
    hashOf: hashOf,
    recall: recall,
    matchSkills: matchSkills,
    search: search,
    prompt: prompt,
    stats: stats,
    today: today,
    raw: function () { return state; },
    reset: function () { state = { pages: [], log: [] }; localStorage.removeItem(SEEDED); save(); },
  };
})();
