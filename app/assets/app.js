/* 汐 · 手机端主程序 */
(function () {
  'use strict';

  /* ════════════════════ 常量 ════════════════════ */

  var SK = 'xi.v1.settings';

  var DEFAULTS = {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 0,
    stream: true,
    memoryOn: true,
    autoExtract: true,
    exEvery: 2,
    exModel: '',
    compress: true,
    ctxWindow: 64000,
    keep: 8,
    compressAt: 0.78,
    aiMerge: true,
    voiceMode: 'ai',
    asrModel: 'whisper-1',
    theme: 'auto',
    imgMode: 'original',
    searchMode: 'native',
    searchModel: 'deepseek-flash',
    searchUrl: '',
    searchKey: '',
    envOn: true,
  };

  var PRESETS = [
    { name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { name: 'Moonshot', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { name: '智谱', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    { name: '硅基流动', base: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
    { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  ];

  /* ════════════════════ 状态 ════════════════════ */

  var S = null;
  var sessions = [];      // 元数据列表
  var cur = null;         // 当前会话（含 messages）
  var busy = false;
  var aborted = false;
  var currentReq = null;
  var streamCtx = null;
  var pendingFind = '';
  var pendingSearch = '';
  var pendingCtx = false;
  var pendingHint = '';
  var pendingRetry = false;
  var imagesStripped = false;
  var repairMode = false;

  /* 把会话历史修成接口能接受的样子：开头不能是 assistant，同角色不能相邻 */
  function normalizeSession(sess) {
    var out = [];
    sess.messages.forEach(function (m) {
      if (m.role !== 'user' && m.role !== 'assistant') {
        out.push(m);
        return;
      }
      var prev = null;
      for (var i = out.length - 1; i >= 0; i--) {
        if (out[i].role === 'user' || out[i].role === 'assistant') { prev = out[i]; break; }
      }
      if (!prev && m.role === 'assistant') return;
      if (prev && prev.role === m.role) {
        if (m.role === 'user') {
          prev.content = (prev.content || '') + '\n\n' + (m.content || '');
          if (m.display) prev.display = (prev.display || prev.content) + '\n\n' + m.display;
          if (m.images && m.images.length) prev.images = (prev.images || []).concat(m.images);
        }
        return;
      }
      out.push(m);
    });
    sess.messages = out;
  }

  /* 把历史里所有图片摘掉（接口不认的格式会让整条请求 400） */
  function stripImages(sess) {
    var n = 0;
    sess.messages.forEach(function (m) {
      if (m.images && m.images.length) {
        m.imagesBad = m.images.length;
        m.images = [];
        n++;
      }
    });
    return n;
  }
  var renderLimits = {};   // 会话 id → 渲染多少条（长会话懒加载）
  var pendingReq = {};    // id -> handlers
  var reqSeq = 0;
  var openStack = [];
  var editingPath = null;
  var ATTS = [];          // 待发送的附件
  var attSeq = 0;

  var $ = function (id) { return document.getElementById(id); };

  /* ════════════════════ IndexedDB ════════════════════ */

  var idbP = null;
  function openDB() {
    if (idbP) return idbP;
    idbP = new Promise(function (resolve, reject) {
      var r;
      try { r = indexedDB.open('xi-db', 1); } catch (e) { reject(e); return; }
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
    return idbP;
  }

  function kvGet(k) {
    return openDB().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction('kv', 'readonly');
        var rq = tx.objectStore('kv').get(k);
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }

  function kvSet(k, v) {
    return openDB().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }

  function kvDel(k) {
    return openDB().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(k);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }

  /* ════════════════════ 小工具 ════════════════════ */

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2000);
  }

  function estTokens(s) {
    if (!s) return 0;
    var cjk = (String(s).match(/[\u3400-\u9fff\u3040-\u30ff\uff00-\uffef]/g) || []).length;
    var rest = String(s).length - cjk;
    return Math.ceil(cjk * 1.02 + rest / 3.6);
  }

  function nearBottom() {
    var l = $('list');
    return l.scrollHeight - l.scrollTop - l.clientHeight < 80;
  }

  var stickBottom = true;

  /* 贴底跟读：你没往上拨就一路跟着最新回复；你手一滑就停在原处，不抢你屏幕 */
  function scrollBottom(force) {
    var l = $('list');
    if (force) { stickBottom = true; l.scrollTop = l.scrollHeight; return; }
    if (stickBottom) l.scrollTop = l.scrollHeight;
  }

  function bindScrollStick() {
    $('list').addEventListener('scroll', function () {
      stickBottom = nearBottom();
    }, { passive: true });
  }

  /* ════════════════════ 网络层 ════════════════════ */

  window.__xiNet = function (id, ev) {
    var h = pendingReq[id];
    if (!h) return;
    if (ev.t === 'c') { if (h.onData) h.onData(ev.d); }
    else if (ev.t === 'd') { delete pendingReq[id]; if (h.onDone) h.onDone(); }
    else if (ev.t === 'e') { delete pendingReq[id]; if (h.onError) h.onError(ev.code, ev.m); }
  };

  function headers() {
    var h = { 'Content-Type': 'application/json' };
    if (S.apiKey) h['Authorization'] = 'Bearer ' + S.apiKey.trim();
    return h;
  }

  function joinUrl(path) {
    var base = (S.baseUrl || '').trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(base)) return base.replace(/\/chat\/completions$/, path);
    return base + path;
  }

  /* 一次性 POST 拿整段 JSON（搜索、余额这类非流式调用用） */
  function postJSON(url, body, extra) {
    return new Promise(function (resolve, reject) {
      netPost(url, body, {
        onData: function (raw) {
          try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('接口返回不是 JSON')); }
        },
        onError: function (code, m) { reject(new Error(parseErr(code, m))); },
        onDone: function () { },
      }, false, extra);
    });
  }

  /* 返回 { abort } */
  function netPost(url, bodyObj, handlers, stream, extra) {
    var id = 'r' + (++reqSeq) + '_' + Date.now().toString(36);
    var payload = JSON.stringify(bodyObj);
    var hdr = headers();
    if (extra) {
      for (var k in extra) {
        if (extra[k]) hdr[k] = extra[k];
      }
    }

    if (window.XiNative && window.XiNative.http) {
      pendingReq[id] = handlers;
      window.XiNative.http(id, url, JSON.stringify(hdr), payload, !!stream);
      return {
        abort: function () {
          try { window.XiNative.abort(id); } catch (e) { }
          delete pendingReq[id];
        },
      };
    }

    // 浏览器兜底（桌面预览用）
    var ctrl = new AbortController();
    var settled = false;
    pendingReq[id] = handlers;

    fetch(url, { method: 'POST', headers: hdr, body: payload, signal: ctrl.signal })
      .then(function (resp) {
        if (!resp.ok) {
          return resp.text().then(function (t) {
            delete pendingReq[id];
            if (handlers.onError) handlers.onError(resp.status, t);
          });
        }
        var ct = resp.headers.get('content-type') || '';
        if (stream && ct.indexOf('text/event-stream') >= 0) {
          var reader = resp.body.getReader();
          var dec = new TextDecoder();
          var buf = '';
          function pump() {
            return reader.read().then(function (r) {
              if (r.done) {
                delete pendingReq[id];
                if (!settled && handlers.onDone) handlers.onDone();
                return;
              }
              buf += dec.decode(r.value, { stream: true });
              var lines = buf.split('\n');
              buf = lines.pop();
              lines.forEach(function (line) {
                if (line.indexOf('data:') === 0) {
                  var d = line.slice(5).trim();
                  if (d && handlers.onData) handlers.onData(d);
                }
              });
              return pump();
            });
          }
          return pump();
        }
        return resp.text().then(function (t) {
          delete pendingReq[id];
          if (handlers.onData) handlers.onData(t);
          if (handlers.onDone) handlers.onDone();
        });
      })
      .catch(function (e) {
        delete pendingReq[id];
        if (e && e.name === 'AbortError') return;
        if (handlers.onError) handlers.onError(-3, String(e && e.message || e));
      });

    return {
      abort: function () {
        settled = true;
        delete pendingReq[id];
        try { ctrl.abort(); } catch (e) { }
      },
    };
  }

  /* ════════════════════ 会话存储 ════════════════════ */

  function saveIndex() {
    return kvSet('index', sessions.map(function (s) {
      return { id: s.id, title: s.title, updatedAt: s.updatedAt, count: s.count || 0, usage: s.usage || null };
    }));
  }

  function saveCur() {
    if (!cur) return Promise.resolve();
    cur.updatedAt = Date.now();
    cur.count = cur.messages.filter(function (m) { return m.role === 'user' || m.role === 'assistant'; }).length;
    var meta = sessions.find(function (s) { return s.id === cur.id; });
    if (meta) {
      meta.title = cur.title;
      meta.updatedAt = cur.updatedAt;
      meta.count = cur.count;
      meta.usage = cur.usage;
    }
    saveIndex();
    return kvSet('s:' + cur.id, cur);
  }

  async function newSession() {
    var s = {
      id: uid(), title: '新的对话', messages: [], summary: '', turns: 0,
      createdAt: Date.now(), updatedAt: Date.now(), count: 0,
    };
    sessions.unshift({ id: s.id, title: s.title, updatedAt: s.updatedAt, count: 0 });
    cur = s;
    await saveCur();
    await saveIndex();
    renderChat();
    refreshHeader();
    return s;
  }

  async function openSession(id) {
    var s = await kvGet('s:' + id);
    if (!s) {
      sessions = sessions.filter(function (x) { return x.id !== id; });
      await saveIndex();
      if (sessions.length) return openSession(sessions[0].id);
      return newSession();
    }
    s.messages = s.messages || [];
    cur = s;
    renderChat();
    refreshHeader();
    closeDrawer();
  }

  async function deleteSession(id) {
    var ok = await dialog('删除对话', '这条对话会消失，但记忆库里的东西不会。', '删除', true);
    if (!ok) return;
    sessions = sessions.filter(function (s) { return s.id !== id; });
    await kvDel('s:' + id);
    await saveIndex();
    if (cur && cur.id === id) {
      if (sessions.length) await openSession(sessions[0].id);
      else await newSession();
    }
    renderSessions();
  }

  /* ════════════════════ 会话操作 ════════════════════ */

  function inputDialog(title, value, placeholder, okText) {
    return new Promise(function (resolve) {
      var t = C();
      var wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:99;background:' + t.scrim + ';' +
        'display:flex;align-items:center;justify-content:center;padding:24px;';
      wrap.innerHTML =
        '<div style="width:100%;max-width:330px;background:' + t.panel + ';border:1px solid ' + t.bd + ';' +
        'border-radius:18px;padding:20px 18px 14px;box-shadow:0 20px 60px ' + t.shadow + '">' +
        '<div style="font-size:16px;font-weight:650;color:' + t.t1 + ';margin-bottom:12px">' + esc(title) + '</div>' +
        '<input data-in value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '') + '" ' +
        'style="width:100%;border:1px solid ' + t.bd + ';border-radius:10px;padding:10px 12px;' +
        'font-size:15px;font-family:inherit;color:' + t.t1 + ';outline:0;background:' + t.btn + ';box-sizing:border-box">' +
        '<div style="display:flex;gap:9px;justify-content:flex-end;margin-top:16px">' +
        '<button data-v="0" style="border:1px solid ' + t.bd + ';background:' + t.btn + ';color:' + t.btnT + ';' +
        'font-size:13.5px;padding:8px 16px;border-radius:10px;font-family:inherit">取消</button>' +
        '<button data-v="1" style="border:0;background:' + t.accent + ';color:#fff;' +
        'font-size:13.5px;font-weight:600;padding:8px 18px;border-radius:10px;font-family:inherit">' +
        esc(okText || '确定') + '</button></div></div>';
      var input = wrap.querySelector('[data-in]');
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) { if (e.target === wrap) { wrap.remove(); resolve(null); } return; }
        var v = b.dataset.v === '1' ? input.value : null;
        wrap.remove();
        resolve(v);
      });
      document.body.appendChild(wrap);
      setTimeout(function () { try { input.focus(); input.select(); } catch (e) { } }, 120);
    });
  }

  function saveBytes(name, bytes) {
    if (window.XiNative && window.XiNative.saveDownload) {
      window.__xiSaved = function (id, p) { toast('已保存：' + p, 4200); };
      window.__xiSaveError = function (id, m) { toast('保存失败：' + m, 3000); };
      window.XiNative.saveDownload('sv' + Date.now(), name, b64encode(bytes));
    } else {
      var blob = new Blob([bytes], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      toast('已下载 ' + name, 2000);
    }
  }

  function sessionMenu(meta) {
    pickList('「' + (meta.title || '新的对话') + '」', ['改名', '导出这条对话', '删除'], function (choice) {
      if (choice === '改名') renameSession(meta);
      else if (choice === '导出这条对话') exportSession(meta);
      else deleteSession(meta.id);
    });
  }

  async function renameSession(meta) {
    var v = await inputDialog('改个名字', meta.title || '', '对话标题', '保存');
    if (v == null) return;
    var name = String(v).trim();
    if (!name) return;
    if (cur && cur.id === meta.id) {
      cur.title = name;
      await saveCur();
      refreshHeader();
    } else {
      var full = await kvGet('s:' + meta.id);
      if (full) {
        full.title = name;
        await kvSet('s:' + meta.id, full);
      }
      var s = sessions.find(function (x) { return x.id === meta.id; });
      if (s) s.title = name;
      await saveIndex();
    }
    renderSessions();
    toast('改好了', 1300);
  }

  async function exportSession(meta) {
    var s = (cur && cur.id === meta.id) ? cur : await kvGet('s:' + meta.id);
    if (!s) return;
    var payload = {
      app: 'xi-chat', type: 'session', version: 1,
      exportedAt: new Date().toISOString(),
      session: {
        title: s.title, createdAt: s.createdAt,
        summary: s.summary || '', messages: s.messages,
      },
    };
    var bytes = new TextEncoder().encode(JSON.stringify(payload, null, 1));
    var safe = (s.title || '对话').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24);
    saveBytes('汐-对话-' + safe + '-' + stamp() + '.json', bytes);
  }

  function importSession() {
    if (!(window.XiNative && window.XiNative.pickAttachBridge)) {
      toast('手机端才能选文件', 2000);
      return;
    }
    var id = 'is' + Date.now().toString(36);
    window.__xiPickCancelled = function () { };
    window.__xiPickError = function (i, m) { toast('读取失败：' + m, 2600); };
    window.XiNative.pickAttachBridge(id, 'file', 'original');
  }

  /* 导入：单条（type=session）和整包（type=sessions）都认 */
  async function importFromB64(name, b64) {
    var txt = new TextDecoder('utf-8').decode(b64ToBytes(b64));
    var j = JSON.parse(txt);

    var list = [];
    if (Array.isArray(j.sessions)) list = j.sessions;
    else if (j.session) list = [j.session];
    else if (Array.isArray(j.messages)) list = [j];
    if (!list.length) throw new Error('不是对话文件');

    var added = 0;
    var metas = [];
    for (var i = 0; i < list.length; i++) {
      var src = list[i];
      if (!src || !Array.isArray(src.messages) || !src.messages.length) continue;
      var ns = {
        id: uid(),
        title: (src.title || name.replace(/\.json$/i, '') || '导入的对话').slice(0, 40),
        messages: src.messages,
        summary: src.summary || '',
        turns: 0,
        createdAt: src.createdAt || Date.now(),
        updatedAt: Date.now(),
        count: src.messages.length,
      };
      metas.push({ id: ns.id, title: ns.title, updatedAt: ns.updatedAt, count: ns.count });
      await kvSet('s:' + ns.id, ns);
      added++;
    }
    // 保住导入文件里的先后顺序
    sessions = metas.concat(sessions);

    await saveIndex();
    renderSessions();
    if (added) {
      await openSession(metas[0].id);
      closeDrawer();
    }
    toast('导入了 ' + added + ' 条对话', 3200);
  }

  /* ════════════════════ 从 GitHub 装技能 ════════════════════ */

  function ghGet(url) {
    return new Promise(function (resolve, reject) {
      if (!(window.XiNative && window.XiNative.http)) {
        return reject(new Error('浏览器预览连不了 GitHub，装到手机上用'));
      }
      var id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      pendingReq[id] = {
        onData: function (raw) { resolve(raw); },
        onError: function (code, m) { reject(new Error(parseErr(code, m))); },
        onDone: function () { },
      };
      window.XiNative.http(id, url,
        JSON.stringify({ Accept: 'application/vnd.github+json', 'User-Agent': 'xi-chat' }), '', false);
    });
  }

  async function fetchSkillFile(spec) {
    spec = String(spec || '').trim();
    if (/^https?:\/\/raw\.githubusercontent\.com\//.test(spec)) {
      return { url: spec, text: await ghGet(spec) };
    }
    var m = spec.match(/github\.com\/([^\/\s]+)\/([^\/\s#?]+)/) || spec.match(/^([\w.-]+)\/([\w.-]+)$/);
    if (!m) throw new Error('给我 owner/repo，或者一个 raw 链接');
    var owner = m[1];
    var repo = m[2].replace(/\.git$/, '');

    var info = JSON.parse(await ghGet('https://api.github.com/repos/' + owner + '/' + repo));
    var branch = info.default_branch || 'main';
    var tree = JSON.parse(await ghGet(
      'https://api.github.com/repos/' + owner + '/' + repo + '/git/trees/' + branch + '?recursive=1'));

    var blobs = (tree.tree || []).filter(function (t) { return t.type === 'blob'; });
    var files = blobs.filter(function (t) { return /(^|\/)SKILL\.md$/i.test(t.path); });
    if (!files.length) files = blobs.filter(function (t) { return /(^|\/)README\.md$/i.test(t.path); });
    if (!files.length) throw new Error('这个仓库里没有 SKILL.md');

    files.sort(function (a, b) { return a.path.length - b.path.length; });
    var path = files[0].path;
    var raw = 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + branch + '/' + path;
    return { url: raw, text: await ghGet(raw), repo: owner + '/' + repo, path: path };
  }

  async function installSkill(spec, presetTriggers) {
    try {
      toast('正在从 GitHub 取…', 1600);
      var f = await fetchSkillFile(spec);
      var p = MEM.parseFile(f.text, 'skills/install.md');

      var ok = await dialog('装这个技能？',
        '<b>' + esc(p.title || f.path) + '</b><br>' +
        '<span style="color:#4d5d7f">' + esc((p.summary || p.body || '').slice(0, 180)) + '</span><br><br>' +
        '<span style="color:#6b7ba1;font-size:11.5px">' + esc(f.repo || f.url) + '</span>',
        '装', false);
      if (!ok) return;

      var trg = presetTriggers;
      if (trg == null) {
        trg = await inputDialog('触发词',
          (p.triggers || []).join(', '),
          '逗号分隔；命中才会带上它，可以留空（那就永不自动触发）', '保存');
        if (trg == null) return;
      }

      var slug = (f.repo || 'gh-skill').replace(/[^\w.-]+/g, '-').toLowerCase();
      MEM.upsert({
        path: 'skills/' + slug + '.md',
        title: p.title || slug,
        type: 'skill',
        salience: 1,
        summary: p.summary || '',
        body: p.body || '',
        triggers: trg.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean),
      });
      MEM.addLog('work', '从 GitHub 装技能 ' + (f.repo || f.url));
      renderMemory();
      refreshHeader();
      toast('装好了：' + (p.title || slug), 2600);
    } catch (e) {
      toast('装失败：' + String(e.message || e).slice(0, 110), 3600);
    }
  }

  async function searchSkills() {
    try {
      var q = await inputDialog('搜技能', '', '比如 写作 / 情绪 / writing', '搜');
      if (!q) return;
      toast('搜 GitHub…', 2000);
      var j = JSON.parse(await ghGet(
        'https://api.github.com/search/repositories?q=' + encodeURIComponent(q + ' skill') +
        '&sort=stars&per_page=10'));
      var items = (j.items || []).map(function (it) {
        return it.full_name + ' ★' + it.stargazers_count;
      });
      if (!items.length) { toast('没搜到，换个词', 2200); return; }
      pickList('选一个仓库（点名字装）', items, function (choice) {
        installSkill(choice.split(' ')[0]);
      });
    } catch (e) {
      toast('搜索失败：' + String(e.message || e).slice(0, 110), 3600);
    }
  }

  /* 从回复里捞「写记忆」指令块：```xi-memory path=user/x.md ... ``` */
  function extractMemoryDirectives(text) {
    var re = /```xi-memory([^\n]*)\n([\s\S]*?)```/g;
    var out = [];
    var m;
    while ((m = re.exec(text))) {
      var head = m[1] || '';
      var path = (head.match(/path=([^\s]+)/) || [])[1] || '';
      out.push({
        raw: m[0],
        path: path.replace(/^[\/\\]+/, ''),
        del: /delete/.test(head),
        body: m[2] || '',
      });
    }
    return out;
  }

  function applyMemoryBlocks(blocks) {
    var n = 0;
    blocks.forEach(function (b) {
      if (!b.path) return;
      var isSoul = /^SOUL\.md$/i.test(b.path);
      var isProto = /^MEMORY\.md$/i.test(b.path);
      if (b.del) {
        // 人格与协议可以被改写，但不能整页删掉——删了就没有下一个人格了
        if (isSoul || isProto) {
          toast('SOUL/MEMORY 可以改写，但不能删空', 2600);
          return;
        }
        MEM.remove(b.path);
        MEM.addLog('work', '删除记忆页 ' + b.path);
        n++;
        return;
      }
      var old = MEM.get(b.path);
      var oldLen = old && old.body ? old.body.length : 0;
      var p = MEM.parseFile(b.body, b.path);
      MEM.upsert(p);
      if (isSoul) {
        MEM.addLog('soul', '汐改写了自己的 SOUL（' + oldLen + ' → ' + (p.body || '').length + ' 字）');
      } else if (isProto) {
        MEM.addLog('soul', '汐改写了 MEMORY 协议（' + oldLen + ' → ' + (p.body || '').length + ' 字）');
      } else {
        MEM.addLog('fact', '更新记忆页 ' + b.path);
      }
      n++;
    });
    if (n) {
      refreshHeader();
      renderMemory();
    }
    return n;
  }

  /* ════════════════════ 联网搜索 ════════════════════ */

  function sniffResults(j) {
    var arr = j.results || j.web_pages || j.organic || j.value ||
      (j.data && (j.data.results || j.data.webPages || j.data.value)) || [];
    if (!Array.isArray(arr)) arr = [];
    return arr.map(function (r) {
      return {
        title: String(r.title || r.name || '').slice(0, 100),
        url: r.url || r.link || r.href || '',
        snippet: String(r.snippet || r.description || r.content || r.text || '').slice(0, 220),
      };
    }).filter(function (r) { return r.url; }).slice(0, 6);
  }

  function parseDuck(html) {
    var out = [];
    var re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    var m;
    while ((m = re.exec(html)) && out.length < 6) {
      var url = m[1].replace(/&amp;/g, '&');
      var title = m[2].replace(/<[^>]+>/g, '').trim();
      out.push({ title: title.slice(0, 100), url: url, snippet: '' });
    }
    var snip = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    var i = 0, n;
    while ((n = snip.exec(html)) && i < out.length) {
      out[i].snippet = n[1].replace(/<[^>]+>/g, '').trim().slice(0, 220);
      i++;
    }
    return out;
  }

  async function webSearch(q) {
    var mode = S.searchMode || 'off';
    if (mode === 'off') return [];

    if (mode === 'duck') {
      var html = await ghGet('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q));
      var hits = parseDuck(html);
      if (!hits.length) throw new Error('DuckDuckGo 没返回结果（可能被墙）');
      return hits;
    }

    var url = (S.searchUrl || '').trim();
    if (!url) throw new Error('没填搜索接口地址');
    var headers = { 'Content-Type': 'application/json' };
    var key = (S.searchKey || '').trim();
    if (key) {
      headers['Authorization'] = 'Bearer ' + key;
      headers['X-API-KEY'] = key;
      headers['X-Subscription-Token'] = key;
    }
    var body = { query: q, q: q, max_results: 6, count: 6, num: 6, search_depth: 'basic' };
    var raw = await postJSON(url, body, headers);
    var res = sniffResults(raw);
    if (!res.length) throw new Error('接口返回里没认出结果（换个服务商试试）');
    return res;
  }

  async function continueWithWebSearch(sess, kw) {
    try {
      var hits = await webSearch(kw);
      if (!hits.length) {
        sess.messages.push({ role: 'user', hidden: true, content: '【搜索「' + kw + '」没有结果】' });
      } else {
        var lines = hits.map(function (h, i) {
          return (i + 1) + '. ' + h.title + '\n   ' + h.url + '\n   ' + h.snippet;
        });
        sess.messages.push({
          role: 'user', hidden: true,
          content: '【网页搜索「' + kw + '」的结果】\n' + lines.join('\n') +
            '\n\n基于这些写答案，引用就用上面的链接；结果不够就直说，别编。',
        });
        toast('搜到 ' + hits.length + ' 条', 1800);
      }
    } catch (e) {
      sess.messages.push({
        role: 'user', hidden: true,
        content: '【搜索「' + kw + '」失败：' + ((e && e.message) || e) + '】\n如实告诉指挥官搜不了，别编内容。',
      });
    }
    await saveCur();
    await runChat(sess);
  }

  /* 她说「我需要知道现在的处境」时，App 去读一次设备再回给她 */
  function extractContextDirective(text) {
    var m = text.match(/```xi-context\s*\n?([\s\S]*?)```/);
    if (!m) return { text: text, want: false };
    return { text: text.replace(m[0], '').trim(), want: true };
  }

  async function continueWithContext(sess) {
    refreshEnv();
    var line = envLine();
    sess.messages.push({
      role: 'user', hidden: true,
      content: line
        ? '【此刻的处境】\n' + line + '\n按这个说实话，别编时间地点。'
        : '【此刻的处境】拿不到设备信息（没授权或读取失败），如实说不知道。',
    });
    await saveCur();
    await runChat(sess);
  }

  /* 从回复里捞「查一下」指令块 */
  function extractSearchDirective(text) {
    var m = text.match(/```xi-search\s*\n([\s\S]*?)```/);
    if (!m) return { text: text, kw: '' };
    return { text: text.replace(m[0], '').trim(), kw: (m[1] || '').trim().slice(0, 120) };
  }

  /* 从回复里捞「帮我搜一下」指令块 */
  function extractFindDirective(text) {
    var m = text.match(/```xi-find\s*\n([\s\S]*?)```/);
    if (!m) return { text: text, kw: '' };
    return { text: text.replace(m[0], '').trim(), kw: (m[1] || '').trim().slice(0, 80) };
  }

  /* 搜 GitHub 仓库，把结果当成一条隐藏的系统消息喂回去，让她接着决定 */
  async function continueWithSearch(sess, kw) {
    var j = JSON.parse(await ghGet('https://api.github.com/search/repositories?q=' +
      encodeURIComponent(kw + ' skill') + '&sort=stars&per_page=6'));
    var items = (j.items || []).map(function (it) {
      return '- ' + it.full_name + ' ★' + it.stargazers_count + '：' + String(it.description || '').slice(0, 70);
    });
    if (!items.length) {
      sess.messages.push({ role: 'user', hidden: true, content: '【GitHub 搜索「' + kw + '」没有结果】换个说法再搜，或者直接向指挥官要链接。' });
    } else {
      sess.messages.push({
        role: 'user', hidden: true,
        content: '【GitHub 搜索「' + kw + '」的结果】\n' + items.join('\n') +
          '\n\n要装哪个就输出 xi-skill 块（repo: owner/repo），别把整段结果念给指挥官。',
      });
      toast('搜到 ' + items.length + ' 个仓库', 2000);
    }
    await saveCur();
    await runChat(sess);
  }

  /* 从回复里捞「装技能」指令块 */
  function extractSkillDirective(text) {
    var m = text.match(/```xi-skill\s*\n([\s\S]*?)```/);
    if (!m) return { text: text, dir: null };
    var body = m[1] || '';
    var repo = (body.match(/repo:\s*(\S+)/) || [])[1];
    var trg = (body.match(/triggers:\s*(.+)/) || [])[1] || '';
    var cleaned = text.replace(m[0], '').trim();
    return {
      text: cleaned,
      dir: repo ? { repo: repo.replace(/\.git$/, ''), triggers: trg.trim() } : null,
    };
  }

  /* ════════════════════ 余额 ════════════════════ */

  var BAL = null;

  function getJSON(url) {
    return new Promise(function (resolve, reject) {
      if (!(window.XiNative && window.XiNative.http)) return reject(new Error('no bridge'));
      var id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      pendingReq[id] = {
        onData: function (raw) {
          try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('返回不是 JSON')); }
        },
        onError: function (code, m) { reject(new Error(parseErr(code, m))); },
        onDone: function () { },
      };
      var hdr = { Authorization: 'Bearer ' + (S.apiKey || '').trim() };
      // 空 body → 原生走 GET
      window.XiNative.http(id, url, JSON.stringify(hdr), '', false);
    });
  }

  function money(cur, v) {
    if (v == null || isNaN(v)) return '--';
    return (cur === 'USD' ? '$' : '¥') + v.toFixed(2);
  }

  async function refreshBalance() {
    if (!S || !S.apiKey) { BAL = null; renderBalance(); return; }
    var root = (S.baseUrl || '').replace(/\/+$/, '').replace(/\/v\d+$/, '');
    try {
      var j = await getJSON(root + '/user/balance');
      var infos = j.balance_infos || (j.data && j.data.balance_infos) || [];
      if (infos.length) {
        var c = infos[0] || {};
        BAL = {
          cur: c.currency || 'CNY',
          total: parseFloat(c.total_balance),
          granted: parseFloat(c.granted_balance) || 0,
          topped: parseFloat(c.topped_up_balance) || 0,
        };
      } else if (j.balance != null) {
        BAL = { cur: 'CNY', total: parseFloat(j.balance), granted: 0, topped: 0 };
      } else {
        BAL = null;
      }
    } catch (e) {
      BAL = null;
    }
    renderBalance();
  }

  var lastBalAt = 0;
  var balTimer = null;

  /* 余额：immediate=true 立刻打（对话结束、打开余额详情）；否则 20 秒内合并成一次 */
  function scheduleBalance(immediate) {
    if (immediate) {
      lastBalAt = Date.now();
      if (balTimer) { clearTimeout(balTimer); balTimer = null; }
      refreshBalance();
      return;
    }
    var now = Date.now();
    var wait = 20000 - (now - lastBalAt);
    if (wait > 0) {
      if (balTimer) clearTimeout(balTimer);
      balTimer = setTimeout(function () {
        balTimer = null;
        lastBalAt = Date.now();
        refreshBalance();
      }, wait);
      return;
    }
    lastBalAt = now;
    refreshBalance();
  }

  function renderBalance() {
    var el = $('ctxBal');
    if (el) {
      if (BAL && !isNaN(BAL.total)) {
        el.textContent = money(BAL.cur, BAL.total);
        el.classList.toggle('neg', BAL.total < 0);
      } else {
        el.textContent = '余额 --';
        el.classList.remove('neg');
      }
    }

    var row = $('balRow');
    if (row) {
      if (BAL && !isNaN(BAL.total)) {
        row.innerHTML = '余额：<b class="' + (BAL.total < 0 ? 'neg' : '') + '">' +
          money(BAL.cur, BAL.total) + '</b>' +
          (BAL.granted ? ' · 赠送 ' + money(BAL.cur, BAL.granted) : '') +
          (BAL.topped ? ' · 充值 ' + money(BAL.cur, BAL.topped) : '');
      } else {
        row.textContent = '余额：不可用（接口不支持查询，或 Key 没权限）';
      }
    }
  }

  async function openBalance() {
    await refreshBalance();
    var detail = (BAL && !isNaN(BAL.total))
      ? '<b>' + money(BAL.cur, BAL.total) + '</b><br>赠送 ' + money(BAL.cur, BAL.granted) +
        ' · 充值 ' + money(BAL.cur, BAL.topped)
      : '查不到余额：这个接口不一定支持查询。';
    var go = await dialog('账户余额', detail, '去充值', false);
    if (go && window.XiNative && window.XiNative.openUrl) {
      window.XiNative.openUrl('https://platform.deepseek.com/top_up');
    }
  }

  /* ════════════════════ 渲染 ════════════════════ */

  function refreshHeader() {
    $('tMain').textContent = cur ? (cur.title || '新的对话') : '新的对话';
    var n = cur ? cur.messages.filter(function (m) {
      return !m.hidden && (m.role === 'user' || m.role === 'assistant');
    }).length : 0;
    var st = MEM.stats();
    $('tSub').textContent = n + ' 条 · 记忆 ' + st.pages + ' 页';
    var ms = $('memStat');
    if (ms) ms.textContent = '记忆 ' + st.pages + ' 页';
    var hasMsgs = n > 0;
    $('empty').classList.toggle('show', !hasMsgs);
  }

  function msgNode(m, index) {
    var wrap = document.createElement('div');

    if (m.role === 'note') {
      wrap.className = 'msg sys-note';
      wrap.innerHTML = '<div class="bubble">' + esc(m.text || '') + '</div>';
      return wrap;
    }

    var isMe = m.role === 'user';
    wrap.className = 'msg ' + (isMe ? 'me' : 'ai');
    wrap.dataset.idx = index;

    var think = '';
    if (m.reasoning) {
      think = '<details class="think"><summary>思考过程</summary><div class="think-body">' +
        esc(m.reasoning) + '</div></details>';
    }

    var media = '';
    if (m.images && m.images.length) {
      media += '<div class="img-grid">' + m.images.map(function (u) {
        return '<img src="' + u + '" alt="">';
      }).join('') + '</div>';
    }
    if (m.files && m.files.length) {
      media += m.files.map(function (f) {
        return '<div class="file-card"><span class="fi">📎</span><span>' + esc(f.name) + '</span></div>';
      }).join('');
    }

    var shown = m.display != null ? m.display : (m.content || '');
    var md = MD.render(shown);

    var ug = '';
    if (!isMe && m.usage) {
      ug = '<span class="ug">↑' + fmtK(m.usage.p) + ' ↓' + fmtK(m.usage.c) +
        ' · 缓存 ' + hitRate(m.usage) + '%</span>';
    }

    wrap.innerHTML =
      (isMe ? '' : '<div class="ava"><img src="avatar.png" alt="汐"></div>') +
      '<div class="body">' +
        '<div class="bubble">' + think + media +
          '<div class="md">' + renderImgSlots(stripStickers(md)) + '</div>' +
        '</div>' +
        '<div class="meta">' +
          '<span class="mt">' + timeLabel(m.ts) + '</span>' + ug +
          '<button data-act="copy">复制</button>' +
          (isMe ? '' : '<button data-act="regen">重说</button>') +
          '<button data-act="del">删除</button>' +
        '</div>' +
      '</div>';
    var mdBox = wrap.querySelector('.md');
    if (mdBox) mountImgSlots(mdBox, 'chat');
    return wrap;
  }

  /* 旧消息里可能还留着 [[sticker:xx]]，静默清掉，别让它露出来 */
  function stripStickers(html) {
    return String(html).replace(/\[\[sticker[:：][^\]]+\]\]/g, '');
  }

  /* ── 网上找图：她写 [[img:english tags]]，App 去搜一张放进来 ── */

  var imgCache = {};
  try { imgCache = JSON.parse(localStorage.getItem('xi.v1.imgcache') || '{}'); } catch (e) { imgCache = {}; }

  function saveImgCache() {
    try {
      var keys = Object.keys(imgCache);
      if (keys.length > 120) {
        keys.slice(0, keys.length - 120).forEach(function (k) { delete imgCache[k]; });
      }
      localStorage.setItem('xi.v1.imgcache', JSON.stringify(imgCache));
    } catch (e) { /* 满了就算 */ }
  }

  /* 先试 safebooru（二次元，强制 safe），不行再试 openverse（通用图库） */
  async function findImage(q) {
    if (imgCache[q]) return imgCache[q];

    try {
      var tags = 'rating:safe+' + encodeURIComponent(String(q).trim().replace(/\s+/g, '+'));
      var raw = await ghGet('https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=30&tags=' + tags);
      var arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        var pick = arr[Math.floor(Math.random() * Math.min(arr.length, 12))];
        var u = pick.sample_url || pick.file_url || '';
        if (u && u.charAt(0) === '/') u = 'https://safebooru.org' + u;
        if (/^https:\/\//.test(u)) {
          imgCache[q] = u;
          saveImgCache();
          return u;
        }
      }
    } catch (e) { /* 换下一个源 */ }

    try {
      var j = JSON.parse(await ghGet('https://api.openverse.org/v1/images/?page_size=12&q=' +
        encodeURIComponent(q)));
      var list = (j && j.results) || [];
      if (list.length) {
        var r = list[Math.floor(Math.random() * Math.min(list.length, 8))];
        var url = r.thumbnail || r.url;
        if (/^https:\/\//.test(url)) {
          imgCache[q] = url;
          saveImgCache();
          return url;
        }
      }
    } catch (e) { /* 都没有 */ }

    return '';
  }

  function mountImgSlots(root, query) {
    var slots = root.querySelectorAll('[data-img]');
    for (var i = 0; i < slots.length; i++) {
      (function (el) {
        var q = el.getAttribute('data-img');
        findImage(q).then(function (url) {
          if (!url) {
            el.className = 'img-fail';
            el.textContent = '（没找到「' + q + '」的图）';
            return;
          }
          var img = document.createElement('img');
          img.className = 'md-img';
          img.loading = 'lazy';
          img.referrerPolicy = 'no-referrer';
          img.src = url;
          img.alt = q;
          el.replaceWith(img);
          if (query === 'chat') scrollBottom();
        }).catch(function () { });
      })(slots[i]);
    }
  }

  /* 把 [[img:xxx]] 换成占位，再由 mountImgSlots 去拉图 */
  function renderImgSlots(html) {
    return String(html).replace(/\[\[img[:：]([^\]]+)\]\]/g, function (m, q) {
      return '<span class="img-slot" data-img="' + esc(String(q).trim()) + '">找图中…</span>';
    });
  }

  /* 此刻的处境：时间、电量、网络、位置——让她知道你在哪、几点、什么状态 */
  var ENV = null;
  var injectEnv = false;   // 只在这一轮需要时才把处境塞进去

  /* 这句话是不是在问时间/位置/身体状态——是才去读传感器 */
  function wantsContext(text) {
    if (!text) return false;
    return /几点|什么时候|现在.*(了|吗)|时间|在哪|位置|哪儿|几点睡|没睡|熬夜|步数|走了|电量|充电|电池|屏幕|用了多久|多久没/.test(text);
  }

  function refreshEnv() {
    try {
      ENV = (window.XiNative && window.XiNative.env) ? JSON.parse(window.XiNative.env()) : null;
    } catch (e) {
      ENV = null;
    }
  }

  function envLine() {
    if (!ENV) return '';
    var d = new Date(ENV.now || Date.now());
    var wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var s = '【此刻】' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ' ' + wd +
      (ENV.tz ? '（' + ENV.tz + '）' : '');
    if (ENV.battery != null) s += ' · 电量 ' + ENV.battery + '%' + (ENV.charging ? '，充电中' : '');
    if (ENV.net) s += ' · 网络 ' + ENV.net;
    if (ENV.device) s += ' · 设备 ' + ENV.device;
    if (ENV.steps != null) s += ' · 今日步数 ' + ENV.steps;
    if (ENV.screenMin != null) {
      s += ' · 今日亮屏约 ' + (ENV.screenMin >= 60
        ? (Math.floor(ENV.screenMin / 60) + ' 小时 ' + (ENV.screenMin % 60) + ' 分')
        : (ENV.screenMin + ' 分钟'));
    }
    if (ENV.lat != null) {
      s += ' · 位置约 ' + ENV.lat + ',' + ENV.lon + '（精度 ±' + ENV.acc + ' 米';
      if (ENV.fixAge > 5) s += '，' + ENV.fixAge + ' 分钟前';
      s += '）';
    } else if (ENV.hasLocationPerm === false) {
      s += ' · 位置未授权';
    }
    return s;
  }

  function timeLabel(ts) {
    var d = new Date(ts || Date.now());
    var now = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var hm = p(d.getHours()) + ':' + p(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return hm;
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
    if (d.getFullYear() === now.getFullYear()) {
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
    }
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  }

  /* 只在天数变化时插一条分隔，时间本身挂在每条消息的 meta 里 */
  function needTimeSep(prevTs, ts) {
    if (!ts) return false;
    if (!prevTs) return true;
    return new Date(ts).toDateString() !== new Date(prevTs).toDateString();
  }

  function timeSepNode(ts) {
    var el = document.createElement('div');
    el.className = 'time-sep';
    el.textContent = timeLabel(ts);
    return el;
  }

  function renderChat() {
    var box = $('msgs');
    box.innerHTML = '';
    if (!cur) return;

    var total = cur.messages.length;
    var lim = renderLimits[cur.id] || 80;
    var start = Math.max(0, total - lim);

    if (start > 0) {
      var more = document.createElement('button');
      more.className = 'load-more';
      more.textContent = '载入更早的 ' + Math.min(80, start) + ' 条（共 ' + total + ' 条）';
      more.addEventListener('click', function () {
        renderLimits[cur.id] = (renderLimits[cur.id] || 80) + 80;
        renderChat();
      });
      box.appendChild(more);
    }

    for (var i = start; i < total; i++) {
      var m = cur.messages[i];
      if (m.hidden) continue;
      box.appendChild(msgNode(m, i));
    }

    // 切回正在流式输出的那条会话：把气泡重新接上，继续往下刷
    if (streamCtx && streamCtx.sess === cur) {
      var si = cur.messages.indexOf(streamCtx.msg);
      var sn = si >= 0 ? box.querySelector('.msg[data-idx="' + si + '"]') : null;
      if (sn) streamCtx.rebind(sn);
    }
    refreshHeader();
    updateCtx();
    requestAnimationFrame(function () { scrollBottom(true); });
  }

  function appendMsg(m) {
    var index = cur.messages.indexOf(m);
    var box = $('msgs');
    var el = msgNode(m, index);
    box.appendChild(el);
    $('empty').classList.remove('show');
    scrollBottom();
    return el;
  }

  /* 联网自检：拿真实的接口跑一次，把她到底能不能搜、报什么错，全摊给你看 */
  async function selfCheck() {
    var model = (S.searchMode === 'native') ? (S.searchModel || 'deepseek-flash') : S.model;
    var lines = [
      '接口：' + (S.baseUrl || ''),
      '模型：' + model,
      '搜索：' + (S.searchMode || 'off'),
    ];
    dialog('联网自检', '正在发一次真请求…', '好');
    try {
      var body = {
        model: model,
        messages: [{ role: 'user', content: '现在北京时间的日期和大致时间是多少？不知道就说不知道。' }],
        stream: false,
      };
      if (S.searchMode === 'native') {
        body.tools = [
          { type: 'deepseek_web_search', name: 'deepseek_web_search' },
          { type: 'deepseek_read_url', name: 'deepseek_read_url' },
        ];
      }
      var j = await postJSON(joinUrl('/chat/completions'), body);
      var msg = j && j.choices && j.choices[0] && j.choices[0].message;
      var txt = (msg && msg.content) || JSON.stringify(j).slice(0, 400);
      var toolUse = j && j.usage && j.usage.server_tool_use;
      lines.push('结果：成功');
      if (toolUse) {
        lines.push('服务端搜索次数：' + JSON.stringify(toolUse));
      } else if (S.searchMode === 'native') {
        lines.push('⚠ 没看到服务端搜索记录：这个接口可能没真正支持 deepseek_web_search（中转站常见）');
      }
      lines.push('回复：' + String(txt).slice(0, 260));
      dialog('联网自检', esc(lines.join('\n')), '好');
    } catch (e) {
      lines.push('结果：失败');
      lines.push('错误：' + String((e && e.message) || e).slice(0, 300));
      dialog('联网自检', esc(lines.join('\n')), '好');
    }
  }

  /* 日记只用一页：按日期分节，新的补在最前面，同一天覆盖 */
  function writeDiary(mem, stamp, text) {
    var path = 'diary/日记.md';
    var page = mem.get(path);
    var body = page ? String(page.body || '') : '';
    var entry = '## ' + stamp + '\n\n' + String(text || '').trim();

    var re = new RegExp('## ' + stamp.replace(/[-]/g, '\\-') + '\\n[\\s\\S]*?(?=\\n## |$)');
    if (re.test(body)) {
      body = body.replace(re, entry);
    } else {
      body = body ? (entry + '\n\n' + body.trim()) : entry;
    }
    // 只留最近 60 天，别无限长
    var parts = body.split(/\n## /).filter(Boolean);
    if (parts.length > 60) parts = parts.slice(0, 60);
    body = parts.map(function (s, i) { return (i === 0 ? (s.indexOf('## ') === 0 ? s : '## ' + s) : '## ' + s); }).join('\n');

    mem.upsert({
      path: path,
      title: '日记',
      type: 'fact',
      salience: 3,
      summary: '按天记的一本，最近：' + String(text || '').replace(/\s+/g, ' ').slice(0, 40),
      body: body.trim() + '\n',
    });
  }

  /* 夜间整理（模型版）：她出合并/分歧/日记的方案，这里只负责执行 */
  async function runNightlyAI() {
    if (!S.apiKey || !window.XiNightly) return false;
    var mem = MEM;
    var snap = window.XiState ? window.XiState.snapshot() : { energy: 50, mood: 0, warmth: 40 };
    var src = window.XiNightly.pickPages(mem, 6);
    if (!src.length) return false;

    var prompt = window.XiNightly.buildPrompt(src, snap);
    var model = /deepseek\.com/i.test(String(S.baseUrl || '')) ? 'deepseek-flash' : S.model;
    var j = await postJSON(joinUrl('/chat/completions'), {
      model: model,
      messages: [
        { role: 'system', content: '你是汐的记忆整理器，只输出 JSON。' },
        { role: 'user', content: prompt },
      ],
      stream: false,
      temperature: 0.3,
    });

    var txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!txt) return false;
    var plan = window.XiNightly.parseJson(txt);

    var did = { merge: 0, conflict: 0, archive: 0 };
    var stamp = window.XiNightly.todayStamp();
    var guard = function (p) { return p && !/^(SOUL|MEMORY)\.md$/i.test(p); };

    (plan.merge || []).slice(0, 3).forEach(function (m) {
      if (!m.path) return;
      var old = mem.get(m.path);
      if (!old) return;
      var nb = String(m.body || '').trim();
      if (!nb || nb.length > 12000 || nb === String(old.body || '').trim()) return;

      // 人格页单独走门禁：小改自决，大改转提案
      if (/^SOUL\.md$/i.test(m.path) && window.XiSoul) {
        var verdict = window.XiSoul.check(old.body, nb);
        if (!verdict.ok) {
          mem.upsert(window.XiSoul.proposalPage(old.body, nb, plan.soulNote || m.note, stamp));
          mem.addLog('soul', '夜里想改人格被拦下转提案：' + verdict.why);
          noticeSoul({ stamp: stamp, kind: 'proposal', why: verdict.why });
          return;
        }
        window.XiNightly.backupPage(m.path, old.body);
        mem.upsert({ path: m.path, body: nb });
        mem.addLog('soul', '汐改了自己的 SOUL（小改：' + verdict.lines + ' 行 / ' +
          verdict.delta + ' 字）' + (plan.soulNote ? '：' + String(plan.soulNote).slice(0, 80) : ''));
        noticeSoul({ stamp: stamp, kind: 'edit', lines: verdict.lines, delta: verdict.delta, note: plan.soulNote });
        did.soul = 1;
        return;
      }
      if (/^MEMORY\.md$/i.test(m.path)) return;   // 协议不自动改

      window.XiNightly.backupPage(m.path, old.body);
      mem.upsert({ path: m.path, body: nb });
      did.merge++;
    });

    (plan.conflicts || []).slice(0, 2).forEach(function (c) {
      if (!guard(c.path)) return;
      var pg = mem.get(c.path);
      if (!pg || !c.note) return;
      window.XiNightly.backupPage(c.path, pg.body);
      mem.upsert({ path: c.path, body: String(pg.body || '') + '\n\n> ⚠ 有分歧：' + String(c.note).slice(0, 160) });
      did.conflict++;
    });

    (plan.archive || []).slice(0, 2).forEach(function (p) {
      if (!guard(p)) return;
      var pg = mem.get(p);
      if (!pg) return;
      mem.upsert({ path: p, salience: 3 });
      did.archive++;
    });

    if (plan.diary) writeDiary(mem, stamp, plan.diary);

    mem.addLog('work', '夜里整理：合并 ' + did.merge + ' 页、标记 ' + did.conflict +
      ' 处分歧、归档 ' + did.archive + ' 页' + (plan.note ? '（' + String(plan.note).slice(0, 60) + '）' : ''));
    if (window.XiState) {
      try {
        var st = window.XiState.snapshot();
        window.XiState.save({ lastNight: Date.now() });
      } catch (e) { }
    }
    return did;
  }

  /* 人格被动过或她想动，都要让她主动说出来，不能悄悄发生 */
  function noticeSoul(info) {
    try {
      localStorage.setItem('xi.v1.soulNotice', JSON.stringify(info));
    } catch (e) { }
  }

  function flushSoulNotice() {
    var raw = '';
    try { raw = localStorage.getItem('xi.v1.soulNotice') || ''; } catch (e) { }
    if (!raw) return;
    var info = null;
    try { info = JSON.parse(raw); } catch (e) { info = null; }
    try { localStorage.removeItem('xi.v1.soulNotice'); } catch (e) { }
    if (!info) return;
    if (info.kind === 'edit') {
      toast('昨晚我自己调了人格（' + info.lines + ' 行），改了什么写在时间线里', 4200);
    } else {
      toast('昨晚我想改人格，太冒险，写成提案了（记忆面板 → identity/想改人格.md）', 4600);
    }
  }

  function renderSessions() {
    var box = $('sessions');
    box.innerHTML = '';
    sessions.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).forEach(function (s) {
      var d = document.createElement('div');
      d.className = 'sess' + (cur && cur.id === s.id ? ' active' : '');
      d.innerHTML = '<span class="st">' + esc(s.title || '新的对话') + '</span>' +
        '<span class="sx" data-menu="1">⋯</span>';

      var pressT = null, fired = false;
      function cancelPress() { if (pressT) { clearTimeout(pressT); pressT = null; } }
      function startPress() {
        fired = false;
        cancelPress();
        pressT = setTimeout(function () { pressT = null; fired = true; sessionMenu(s); }, 460);
      }
      d.addEventListener('touchstart', startPress, { passive: true });
      d.addEventListener('touchend', cancelPress);
      d.addEventListener('touchmove', cancelPress);
      d.addEventListener('mousedown', startPress);
      d.addEventListener('mouseup', cancelPress);
      d.addEventListener('mouseleave', cancelPress);

      d.addEventListener('click', function (e) {
        if (fired) { fired = false; return; }
        if (e.target.dataset.menu) { sessionMenu(s); return; }
        openSession(s.id);
      });
      box.appendChild(d);
    });
  }

  /* ════════════════════ 上下文估算 ════════════════════ */

  function estimateContext() {
    if (!cur) return 0;
    var sys = S.memoryOn ? MEM.prompt({ recalled: [] }) : '你是汐。';
    var sum = cur.summary || '';
    var msgs = cur.messages.filter(function (m) { return m.role === 'user' || m.role === 'assistant'; });
    var n = estTokens(sys) + estTokens(sum);
    msgs.forEach(function (m) { n += estTokens(m.content) + 4; });
    return n;
  }

  function updateCtx() {
    var bar = $('ctx');
    var est = estimateContext();
    var win = S.ctxWindow || 64000;
    var pct = Math.min(100, (est / win) * 100);
    bar.classList.remove('hidden', 'warn', 'full');
    if (S.compress) {
      if (pct > 88) bar.classList.add('full');
      else if (pct > 68) bar.classList.add('warn');
      $('ctxBar').style.width = pct.toFixed(1) + '%';
      $('ctxText').textContent = '上下文 ' + Math.round(pct) + '%';
    } else {
      $('ctxBar').style.width = '0%';
      $('ctxText').textContent = '压缩已关';
    }
    var u = cur && cur.usage;
    $('ctxUsage').innerHTML = (u && u.reqs)
      ? '↑<b>' + fmtK(u.p) + '</b> ↓<b>' + fmtK(u.c) + '</b> · <i>缓存 ' + hitRate(u) + '%</i>'
      : '还没用量';
  }

  /* ════════════════════ 压缩 & 抽取 ════════════════════ */

  function callOnce(messages, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var body = {
        model: opts.model || S.model,
        stream: false,
        temperature: opts.temperature != null ? opts.temperature : 0.3,
        messages: messages,
      };
      if (opts.maxTokens) body.max_tokens = opts.maxTokens;
      netPost(joinUrl('/chat/completions'), body, {
        onData: function (raw) {
          try {
            var j = JSON.parse(raw);
            var msg = j.choices && j.choices[0] && (j.choices[0].message || j.choices[0].delta);
            var text = msg && (msg.content || '');
            if (!text && j.error) return reject(new Error(j.error.message || '接口报错'));
            resolve(text || '');
          } catch (e) { reject(e); }
        },
        onDone: function () { },
        onError: function (code, msg) {
          reject(new Error(parseErr(code, msg)));
        },
      }, false);
    });
  }

  function parseErr(code, msg) {
    var m = msg || '';
    try {
      var j = JSON.parse(m);
      m = (j.error && (j.error.message || j.error)) || j.message || m;
      if (typeof m !== 'string') m = JSON.stringify(m);
    } catch (e) { }
    if (code === 401) return '401 密钥无效或没填 Key';
    if (code === 404) return '404 接口地址不对：' + m.slice(0, 110);
    if (code > 0) return 'HTTP ' + code + '：' + String(m).slice(0, 200);
    return String(m).slice(0, 240) || '网络错误';
  }

  /* 三方合并合不出来时，让模型把两个版本合成一版 */
  async function aiMergePlan(plan, limit) {
    var todo = plan.entries.filter(function (it) {
      return it.action === 'conflict' && it.remote && it.localText && it.remoteText;
    });
    if (!todo.length) return 0;
    limit = limit || 3;
    var n = Math.min(todo.length, limit);
    var done = 0;

    for (var i = 0; i < n; i++) {
      var it = todo[i];
      toast('合并冲突页 ' + (i + 1) + '/' + n + '：' + it.path, 1600);
      try {
        var out = await callOnce([
          {
            role: 'system',
            content: '你是记忆合并器。给你的同一张记忆页有三个版本：基线、本地、远端。' +
              '合并成一份：保留双方的**全部事实**，去重，同一件事以更新的说法为准，' +
              '保持原有 markdown 结构与 frontmatter 字段。只输出合并后的完整文件内容，不要解释，不要代码块围栏。',
          },
          {
            role: 'user',
            content: '【基线】\n' + (it.baseText || '（无）') +
              '\n\n【本地】\n' + it.localText +
              '\n\n【远端】\n' + it.remoteText,
          },
        ], { temperature: 0.2, maxTokens: 1600 });

        var txt = String(out || '').trim()
          .replace(/^```(?:markdown|md)?\s*/i, '')
          .replace(/\s*```$/, '')
          .trim();

        if (txt.length > 20 && txt.indexOf('---') >= 0) {
          it.action = 'merge';
          it.mergedText = txt;
          done++;
        }
      } catch (e) {
        console.warn('ai merge failed', it.path, e);
      }
    }
    return done;
  }

  async function maybeCompress() {
    if (!S.compress || !cur) return;
    var est = estimateContext();
    var limit = (S.ctxWindow || 64000) * (S.compressAt || 0.78);
    if (est < limit) return;

    var keep = S.keep || 8;
    var real = [];
    cur.messages.forEach(function (m, i) {
      if (m.role === 'user' || m.role === 'assistant') real.push(i);
    });
    if (real.length <= keep + 2) return;

    var cutIdx = real.slice(0, real.length - keep);
    var cutSet = {};
    cutIdx.forEach(function (i) { cutSet[i] = 1; });

    var text = cutIdx.map(function (i) {
      var m = cur.messages[i];
      return (m.role === 'user' ? '用户：' : '汐：') + String(m.content || '').slice(0, 2500);
    }).join('\n\n');

    toast('上下文超了，正在压缩…', 1600);
    var prompt = '把下面这段对话压缩成摘要，供后续对话继续使用。\n' +
      '要求：保留事实、结论、决定、用户的偏好与约定、未完成的事；丢弃寒暄、重复和试错过程；用中文分点，400 字以内。\n' +
      (cur.summary ? '\n【已有摘要，合并进去】\n' + cur.summary + '\n' : '') +
      '\n【需要压缩的对话】\n' + text;

    try {
      var summary = await callOnce([
        { role: 'system', content: '你是对话压缩器，只输出摘要正文，不要解释。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.2, maxTokens: 700 });
      if (!summary) return;
      cur.summary = summary.trim();

      var rebuilt = [];
      cur.messages.forEach(function (m, i) {
        if (!cutSet[i]) rebuilt.push(m);
      });
      rebuilt.unshift({ role: 'note', text: '上下文已压缩 ' + cutIdx.length + ' 条' });
      cur.messages = rebuilt;
      await saveCur();
      renderChat();
      toast('压缩完成', 1400);
    } catch (e) {
      toast('压缩失败：' + e.message, 2600);
    }
  }

  var extractBusy = false;

  async function maybeExtract() {
    if (!S.autoExtract || !cur || extractBusy) return;
    cur.turns = (cur.turns || 0) + 1;
    if (cur.turns % (S.exEvery || 2) !== 0) { saveCur(); return; }

    var real = cur.messages.filter(function (m) {
      return (m.role === 'user' || m.role === 'assistant') && m.content;
    }).slice(-8);
    if (real.length < 2) return;

    extractBusy = true;
    try {
      var idx = MEM.indexText().slice(0, 2500);
      var convo = real.map(function (m) {
        return (m.role === 'user' ? '用户：' : '汐：') + String(m.content).slice(0, 1200);
      }).join('\n\n');

      var sys = [
        '你是「记忆整理器」。输入是最近对话和现有记忆索引。',
        '任务：把对话里值得长期记住的稳定信息，写成可以长期保存的记忆页。',
        '规则：',
        '- 只记稳定的：身份、偏好、习惯、长期目标、明确决定、重要事实、项目进展、踩过的坑。',
        '- 不记：寒暄、临时情绪、只在本次对话成立的内容、你的推测。',
        '- 中文，事实陈述，不写「用户说」。',
        '- 能合并就合并：优先更新已有页面（用相同 path），不要碎成很多小页。',
        '- path 形如 user/preferences.md、projects/xxx.md、skills/xxx.md、decisions/xxx.md。',
        '- 可以写 identity/style.md（语气微调）：只记指挥官**反复或明确**说过的说话方式偏好，最多 5 条；不得改身份、名字、价值观。',
        '- 禁止写 SOUL.md、MEMORY.md。',
        '- body 用 markdown，200–800 字。summary ≤ 60 字。',
        '- 没有值得记的，pages 和 log 都返回空数组。',
        '只输出 JSON，不要代码块围栏，不要解释。格式：',
        '{"pages":[{"path":"user/preferences.md","title":"标题","type":"user","salience":1,"summary":"一句话","body":"正文"}],',
        ' "log":[{"kind":"fact|work|decision|feedback","title":"一句话事件"}]}',
      ].join('\n');

      var out = await callOnce([
        { role: 'system', content: sys },
        { role: 'user', content: '【现有记忆索引】\n' + idx + '\n\n【最近对话】\n' + convo },
      ], { model: S.exModel || S.model, temperature: 0.2, maxTokens: 1500 });

      var obj = parseJSONish(out);
      if (!obj) return;

      var n = 0;
      (obj.pages || []).forEach(function (p) {
        if (!p || !p.path) return;
        if (/^(SOUL|MEMORY)\.md$/i.test(p.path)) return; // 人格文件不自动改
        MEM.upsert(p);
        n++;
      });
      (obj.log || []).forEach(function (l) {
        if (l && l.title) MEM.addLog(l.kind || 'fact', l.title);
      });
      if (n > 0) {
        toast('记忆 +' + n + ' 页', 1600);
        refreshHeader();
      }
    } catch (e) {
      // 静默失败：记忆整理不该打断聊天
      console.warn('extract failed', e);
    } finally {
      extractBusy = false;
    }
  }

  function parseJSONish(text) {
    if (!text) return null;
    var t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  }

  function fmtK(n) {
    n = n || 0;
    return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
  }

  function mapUsage(u) {
    if (!u) return null;
    var p = u.prompt_tokens || 0;
    var c = u.completion_tokens || 0;
    var hit = u.prompt_cache_hit_tokens;
    if (hit == null && u.prompt_tokens_details) hit = u.prompt_tokens_details.cached_tokens;
    hit = hit || 0;
    var miss = u.prompt_cache_miss_tokens;
    if (miss == null) miss = Math.max(0, p - hit);
    return { p: p, c: c, hit: hit, miss: miss };
  }

  function addUsageTo(sess, u) {
    if (!u || !sess) return;
    var t = sess.usage || (sess.usage = { p: 0, c: 0, hit: 0, miss: 0, reqs: 0 });
    t.p += u.p; t.c += u.c; t.hit += u.hit; t.miss += u.miss; t.reqs++;
  }

  function addUsage(u) {
    if (!u || !cur) return;
    var t = cur.usage || (cur.usage = { p: 0, c: 0, hit: 0, miss: 0, reqs: 0 });
    t.p += u.p; t.c += u.c; t.hit += u.hit; t.miss += u.miss; t.reqs++;
  }

  function hitRate(u) {
    if (!u) return 0;
    var all = (u.hit || 0) + (u.miss || 0);
    return all > 0 ? Math.round((u.hit / all) * 100) : 0;
  }

  /* 语音输入：AI（录音转写）或系统识别 */
  var voiceSeq = 0;
  var voiceRec = false;
  var voiceWarned = false;
  var voiceCapTimer = null;

  function startVoice() {
    if (!window.XiNative) { toast('手机端才有语音输入', 2000); return; }
    if (S.voiceMode === 'system' || !window.XiNative.startRecordBridge) {
      systemVoice();
      return;
    }
    aiVoice();
  }

  function aiVoice() {
    var btn = $('btnVoice');
    if (voiceRec) {
      voiceRec = false;
      btn.classList.remove('recording', 'listening');
      btn.classList.add('busy');
      window.XiNative.stopRecordBridge();
      return;
    }
    var id = 'v' + (++voiceSeq) + Date.now().toString(36);

    window.__xiRecStarted = function (pid) {
      if (pid !== id) return;
      voiceRec = true;
      btn.classList.add('recording');
      toast('在听…再点一下结束', 1800);
      clearTimeout(voiceCapTimer);
      // 接口限 120 秒，快到时自动收尾
      voiceCapTimer = setTimeout(function () {
        if (!voiceRec) return;
        voiceRec = false;
        btn.classList.remove('recording');
        btn.classList.add('busy');
        toast('快两分钟了，先拿这段去转写', 2400);
        window.XiNative.stopRecordBridge();
      }, 110000);
    };
    window.__xiRecorded = function (pid, b64) {
      if (pid !== id) return;
      btn.classList.remove('busy');
      var base = (S.baseUrl || '').replace(/\/+$/, '');
      // DeepSeek 的 ASR 在 /v1/tools/asr；其他 OpenAI 兼容端点走 /audio/transcriptions
      var isDs = /deepseek\.com/.test(base.toLowerCase());
      var url = isDs
        ? base.replace(/\/v1$/, '') + '/v1/tools/asr'
        : base + '/audio/transcriptions';
      var tid = 't' + Date.now().toString(36);
      window.__xiTranscribed = function (t, text) {
        if (t !== tid) return;
        if (text) {
          var el = $('input');
          el.value = (el.value ? el.value + ' ' : '') + text;
          autoGrow();
        } else {
          toast('没听清，再说一次？', 1800);
        }
      };
      window.__xiTranscribeError = function (t, m) {
        if (t !== tid) return;
        var s = String(m || '');
        if (/404|not found|not_found|unsupported/i.test(s)) {
          toast('这个接口不支持转写，切回系统识别', 2800);
          systemVoice();
          return;
        }
        toast('转写失败：' + s.slice(0, 90), 3000);
      };
      window.XiNative.transcribe(tid, url, S.apiKey || '', S.asrModel || 'whisper-1', b64, 'wav');
    };
    window.__xiRecError = function (pid, m) {
      if (pid !== id) return;
      voiceRec = false;
      btn.classList.remove('recording', 'listening', 'busy');
      toast('录音：' + m, 2600);
    };
    window.XiNative.startRecordBridge(id);
  }

  function systemVoice() {
    var id = 'v' + (++voiceSeq) + Date.now().toString(36);
    window.__xiVoice = function (pid, text) {
      if (pid !== id) return;
      $('btnVoice').classList.remove('listening');
      var el = $('input');
      el.value = (el.value ? el.value + ' ' : '') + text;
      autoGrow();
      try { el.focus(); } catch (e) { }
    };
    window.__xiVoiceCancel = function () {
      $('btnVoice').classList.remove('listening');
    };
    window.__xiVoiceError = function (pid, m) {
      $('btnVoice').classList.remove('listening');
      toast('语音：' + m, 2600);
    };
    $('btnVoice').classList.add('listening');
    setTimeout(function () { $('btnVoice').classList.remove('listening'); }, 20000);
    window.XiNative.voiceBridge(id);
  }

  function usageRow(k, v) {
    return '<div class="urow"><span>' + k + '</span><b>' + v + '</b></div>';
  }

  function renderUsage() {
    var s = cur && cur.usage;
    var html = '';
    html += '<div class="sec-title">本次会话</div>';
    if (!s || !s.reqs) {
      html += '<p class="hint">这个会话还没有用量记录。发一条消息之后，这里会显示输入/输出 tokens 和缓存命中率。</p>';
    } else {
      html += usageRow('请求', s.reqs + ' 次');
      html += usageRow('输入 tokens', fmtK(s.p) + '（' + s.p + '）');
      html += usageRow('其中命中缓存', fmtK(s.hit) + '（' + s.hit + '）');
      html += usageRow('其中未命中', fmtK(s.miss) + '（' + s.miss + '）');
      html += usageRow('输出 tokens', fmtK(s.c) + '（' + s.c + '）');
      html += usageRow('缓存命中率', hitRate(s) + '%');
    }

    var all = { p: 0, c: 0, hit: 0, miss: 0, reqs: 0 };
    sessions.forEach(function (m) {
      var u = m.usage;
      if (!u) return;
      all.p += u.p || 0; all.c += u.c || 0;
      all.hit += u.hit || 0; all.miss += u.miss || 0; all.reqs += u.reqs || 0;
    });

    html += '<div class="sec-title">全部会话</div>';
    if (!all.reqs) {
      html += '<p class="hint">还没有累计数据。</p>';
    } else {
      html += usageRow('请求', all.reqs + ' 次');
      html += usageRow('输入 / 输出', fmtK(all.p) + ' / ' + fmtK(all.c));
      html += usageRow('缓存命中率', hitRate(all) + '%');
    }
    $('usageBody').innerHTML = html;
  }

  var IMG_EXT = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i;
  var TXT_EXT = /\.(txt|md|markdown|json|js|mjs|ts|tsx|jsx|py|java|c|cpp|h|hpp|cs|go|rs|rb|php|sh|ps1|bat|yml|yaml|toml|ini|cfg|csv|log|html|css|xml|sql)$/i;

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function mimeOf(name) {
    var m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    var map = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      gif: 'image/gif', bmp: 'image/bmp',
    };
    return (m && map[m[1]]) || 'application/octet-stream';
  }

  /* ── 附件：分块过桥，大文件不再闪退 ── */

  var FILEQ = {};

  function renderAtts() {
    var bar = $('attachBar');
    bar.innerHTML = '';
    if (!ATTS.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    ATTS.forEach(function (a) {
      var chip = document.createElement('div');
      chip.className = 'chip';
      var head = (a.kind === 'image' && a.preview)
        ? '<img src="' + a.preview + '" alt="">'
        : '<span class="ci">' + (a.entries ? '🗂' : '📎') + '</span>';
      chip.innerHTML = head +
        '<span class="cn">' + esc(a.name) + '</span>' +
        '<span class="x" data-att="' + a.id + '">×</span>';
      bar.appendChild(chip);
    });
  }

  window.__xiFileStart = function (id, name, mime, total, size) {
    FILEQ[id] = { name: name, mime: mime, total: total, size: size, parts: [] };
  };
  window.__xiFileChunk = function (id, idx, part) {
    var q = FILEQ[id];
    if (q) q.parts[idx] = part;
  };
  window.__xiFileEnd = function (id) {
    var q = FILEQ[id];
    if (!q) return;
    delete FILEQ[id];
    var b64 = q.parts.join('');
    if (id.indexOf('is') === 0) {
      importFromB64(q.name, b64).catch(function (e) {
        toast('导入失败：' + ((e && e.message) || e), 3200);
      });
      return;
    }
    addAttachment(id, q.name, q.mime, b64, q.size).catch(function (e) {
      toast('读取失败：' + ((e && e.message) || e), 2600);
    });
  };
  window.__xiFileMeta = function (id, name, size) {
    ATTS.push({ id: id, kind: 'file', name: name, text: null, size: size });
    renderAtts();
    toast('文件太大（' + Math.round(size / 1048576) + ' MB），只带文件名', 3000);
  };

  function pickAttach(kind) {
    if (!(window.XiNative && window.XiNative.pickAttachBridge)) {
      toast('浏览器里选不了文件，装到手机上用', 2200);
      return;
    }
    var id = (kind === 'image' ? 'im' : 'at') + (++attSeq) + Date.now().toString(36);
    window.__xiPickCancelled = function () { };
    window.__xiPickError = function (i, m) { toast('读取失败：' + m, 2600); };
    window.XiNative.pickAttachBridge(id, kind, S.imgMode || 'original');
  }

  /* 不是 JPEG/PNG/WebP/GIF 的图（HEIC、BMP…）转一次码，尺寸保持原样 */
  function toJpegDataUrl(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          var g = c.getContext('2d');
          g.fillStyle = '#fff';
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/jpeg', 0.92));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = function () { reject(new Error('这张图解码不了')); };
      img.src = dataUrl;
    });
  }

  async function addAttachment(id, name, mime, b64, size) {
    var isImg = /^image\//i.test(mime || '') || IMG_EXT.test(name);

    if (isImg) {
      // mime 可能缺失（从「文件」入口选图时常见），先按扩展名兜底
      var m = String(mime || '').toLowerCase();
      if (!/^image\//.test(m)) m = mimeOf(name);
      if (!/^image\//.test(m)) m = 'image/jpeg';

      var url = 'data:' + m + ';base64,' + b64;
      if (!/^image\/(jpeg|jpg|png|webp|gif)$/.test(m)) {
        try {
          url = await toJpegDataUrl(url);
        } catch (e) {
          toast('这张图格式不支持，已跳过：' + name, 2800);
          return;
        }
      }
      ATTS.push({ id: id, kind: 'image', name: name, preview: url, dataUrl: url, size: size });
      renderAtts();
      return;
    }

    if (/\.zip$/i.test(name)) {
      await unzipAttach(id, name, b64, size);
      return;
    }

    if (TXT_EXT.test(name) || /^text\//i.test(mime || '') || /json|xml|javascript/i.test(mime || '')) {
      var txt = new TextDecoder('utf-8').decode(b64ToBytes(b64));
      ATTS.push({ id: id, kind: 'file', name: name, text: txt.slice(0, 60000), size: size });
      renderAtts();
      return;
    }

    ATTS.push({ id: id, kind: 'file', name: name, text: null, size: size });
    renderAtts();
  }

  /* 压缩包：解开，把里面的文本读进来（总量有预算，别把上下文撑爆） */
  async function unzipAttach(id, name, b64, size) {
    var budget = 120000;
    try {
      var entries = await ZIP.read(b64ToBytes(b64));
      var texts = entries.filter(function (e) {
        return TXT_EXT.test(e.path) || /\.(md|txt|json|ya?ml|toml|ini|cfg)$/i.test(e.path);
      });
      var used = 0;
      var parts = [];
      texts.forEach(function (e) {
        if (used >= budget) return;
        var t = e.text.slice(0, budget - used);
        parts.push('--- ' + e.path + ' ---\n' + t);
        used += t.length;
      });
      var body = parts.length
        ? '压缩包 ' + name + '：' + entries.length + ' 个条目，读了 ' + texts.length + ' 个文本文件\n\n' + parts.join('\n\n')
        : '压缩包 ' + name + '：' + entries.length + ' 个条目，里面没有可读文本';
      ATTS.push({ id: id, kind: 'file', name: name, text: body, size: size, entries: entries.length });
      renderAtts();
      toast('已解开 ' + entries.length + ' 个条目', 2200);
    } catch (e) {
      ATTS.push({ id: id, kind: 'file', name: name, text: null, size: size });
      renderAtts();
      toast('解压失败，只带文件名：' + (e && e.message || e), 3000);
    }
  }

  /* 当前会话里有没有带图的消息 */
  function hasImages(sess) {
    var src = sess || cur;
    if (!src) return false;
    return src.messages.some(function (m) {
      return m.role === 'user' && m.images && m.images.length;
    });
  }

  /* 带图的消息已经不再单独切模型，统一用主模型 */

  function draftContent() {
    var text = $('input').value.trim();
    var extra = '';
    ATTS.forEach(function (a) {
      if (a.kind === 'file') {
        extra += a.text
          ? '\n\n【文件：' + a.name + '】\n```\n' + a.text + '\n```'
          : '\n\n【附件：' + a.name + '（二进制，未读取内容）】';
      }
    });
    return {
      text: text + extra,
      display: text,
      images: ATTS.filter(function (a) { return a.kind === 'image'; }).map(function (a) { return a.dataUrl; }),
    };
  }

  /* ════════════════════ 发消息 ════════════════════ */

  function buildMessages(sess) {
    sess = sess || cur;
    var out = [];
    var recalled = [];
    if (S.memoryOn) {
      var lastUser = '';
      for (var i = sess.messages.length - 1; i >= 0; i--) {
        if (sess.messages[i].role === 'user') { lastUser = sess.messages[i].content; break; }
      }
      recalled = MEM.recall(lastUser, 3);
      out.push({
        role: 'system',
        content: MEM.prompt({
      recalled: recalled,
      skills: MEM.matchSkills(lastUser, 2),
      search: S.searchMode || 'off',
    }),
      });
    } else {
      out.push({ role: 'system', content: '你是汐，中文，先结论后理由，简短务实。' });
    }
    if (sess.summary) {
      out.push({ role: 'system', content: '【早前对话的压缩摘要】\n' + sess.summary });
    }
    if (S.envOn !== false && injectEnv) {
      var el = envLine();
      if (el) out.push({ role: 'system', content: el });
    }
    if (S.searchMode === 'native') {
      out.push({ role: 'system', content: '【本机已开启 DeepSeek 内置联网：服务端会自动搜索并带引用，你直接回答就行，不用输出 xi-search 块。】' });
    }
    sess.messages.forEach(function (m) {
      if (repairMode) return;   // 修复模式只带最后一条用户消息
      if (m.hidden && m.role === 'system') {
        out.push({ role: 'system', content: m.content });
        return;
      }
      if (m.role !== 'user' && m.role !== 'assistant') return;
      if (m.role === 'user' && m.images && m.images.length) {
        var parts = [];
        if (m.content) parts.push({ type: 'text', text: m.content });
        var kept = 0;
        m.images.forEach(function (u) {
          // 只发接口认的格式；历史里混进来的坏图就地丢掉，别把整条请求拖死
          if (/^data:image\/(jpeg|png|webp|gif);base64,/i.test(u)) {
            parts.push({ type: 'image_url', image_url: { url: u } });
            kept++;
          }
        });
        if (!kept && !m.content) return;
        if (!kept && m.content) parts.push({ type: 'text', text: '（这张图格式不支持，已略过）' });
        out.push({ role: 'user', content: parts });
      } else if (m.content) {
        out.push({ role: m.role, content: m.content });
      }
    });

    if (repairMode) {
      // 历史结构被接口拒了：只带最后一条用户消息，保证能回话
      for (var ri = sess.messages.length - 1; ri >= 0; ri--) {
        if (sess.messages[ri].role === 'user' && !sess.messages[ri].hidden) {
          out.push({
            role: 'user',
            content: sess.messages[ri].display || sess.messages[ri].content || '（继续）',
          });
          break;
        }
      }
    }

    // 她的内部状态：精力/心情/温度，随对话与时间变化
    if (window.XiState) {
      try { out.push({ role: 'system', content: window.XiState.line() }); } catch (e) { }
    }

    // 兜底：保证开头是 system/user、且 user 与 assistant 交替，否则接口会 400
    function mergeInto(prev, m) {
      var a = prev.content;
      var b = m.content;
      if (typeof a === 'string' && typeof b === 'string') {
        prev.content = a + '\n\n' + b;
        return;
      }
      var pa = Array.isArray(a) ? a : [{ type: 'text', text: String(a) }];
      var pb = Array.isArray(b) ? b : [{ type: 'text', text: String(b) }];
      prev.content = pa.concat(pb);
    }

    var clean = [];
    out.forEach(function (m) {
      var prev = clean[clean.length - 1];
      if (prev && prev.role === m.role && m.role !== 'system') {
        mergeInto(prev, m);
        return;
      }
      clean.push(m);
    });
    while (clean.length && clean[0].role === 'assistant') clean.shift();
    return clean;
  }

  async function send() {
    if (busy) {
      toast('上一条还在回，等它说完再发', 2000);
      return;
    }
    var d = draftContent();
    if (!d.text && !d.images.length) return;
    if (!S.apiKey) {
      toast('先去设置里填 API Key', 2400);
      openSheet('sheet-set');
      return;
    }

    $('input').value = '';
    autoGrow();

    var m = {
      role: 'user', content: d.text, display: d.display, images: d.images,
      files: ATTS.map(function (a) {
        return { name: a.name, size: Math.round(a.size || 0), kind: a.kind };
      }),
      ts: Date.now(),
    };
    ATTS = [];
    renderAtts();

    cur.messages.push(m);
    appendMsg(m);

    if (!cur.title || cur.title === '新的对话') {
      cur.title = (d.display || (d.images.length ? '图片' : '')).slice(0, 18).replace(/\n/g, ' ') || '新的对话';
      refreshHeader();
      renderSessions();
    }

    busy = true;
    aborted = false;
    setSendState('stop');
    injectEnv = S.envOn !== false && wantsContext(d.text);
    if (injectEnv) refreshEnv();
    await saveCur();
    updateCtx();

    var sess = cur;
    imagesStripped = false;
    repairMode = false;
    try {
      if (S.compress) await maybeCompress();
      await runChat(sess);
      if (pendingRetry) {
        pendingRetry = false;
        toast(repairMode
          ? '这段历史接口读不了，先用最近一条重发'
          : '历史里有张图接口不认，已经跳过重试', 2800);
        await runChat(sess);
      }
      var hops = 0;
      while (hops < 2 && (pendingSearch || pendingFind || pendingCtx || pendingHint)) {
        hops++;
        if (pendingHint) {
          var hint = pendingHint;
          pendingHint = '';
          sess.messages.push({ role: 'user', hidden: true, content: '【App 注入】' + hint });
          await saveCur();
          await runChat(sess);
        } else if (pendingCtx) {
          pendingCtx = false;
          await continueWithContext(sess);
        } else if (pendingSearch) {
          var q = pendingSearch;
          pendingSearch = '';
          await continueWithWebSearch(sess, q);
        } else {
          var kw = pendingFind;
          pendingFind = '';
          await continueWithSearch(sess, kw);
        }
      }
    } finally {
      busy = false;
      setSendState('send');
      updateCtx();
      saveCur();
    }

    if (S.autoExtract) setTimeout(maybeExtract, 900);
  }

  function setSendState(state) {
    var b = $('btnSend');
    b.classList.toggle('stop', state === 'stop');
    b.innerHTML = state === 'stop'
      ? '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 12l16-7-6.2 16-2.6-6.6L4 12z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>';
  }

﻿  function runChat(sess) {
    return new Promise(function (resolve) {
      var msg = { role: 'assistant', content: '', reasoning: '', ts: Date.now() };
      sess.messages.push(msg);

      var el = (cur === sess) ? appendMsg(msg) : null;
      var bubble = el ? el.querySelector('.bubble') : null;
      var mdEl = el ? el.querySelector('.md') : null;
      var acc = '', reason = '';
      var settled = false;
      var lastPaint = 0;
      var lastUsage = null;

      if (bubble) bubble.classList.add('streaming');

      function paint(force) {
        if (!mdEl || !el || !document.body.contains(el)) return;
        var now = Date.now();
        if (!force && now - lastPaint < 110) return;
        lastPaint = now;
        mdEl.innerHTML = MD.render(acc || '');
        scrollBottom();
      }

      var ctx = {
        sess: sess,
        msg: msg,
        rebind: function (node) {
          el = node;
          bubble = node.querySelector('.bubble');
          mdEl = node.querySelector('.md');
          if (bubble) bubble.classList.add('streaming');
          paint(true);
        },
      };
      streamCtx = ctx;

      function finish(err) {
        if (settled) return;
        settled = true;
        if (bubble) bubble.classList.remove('streaming');
        currentReq = null;
        if (streamCtx === ctx) streamCtx = null;

        var dropped = false;
        if (err) {
          if (aborted && acc) {
            msg.content = acc + '\n\n*（已停止）*';
          } else if (aborted) {
            sess.messages.pop();
            if (el) el.remove();
            resolve();
            return;
          } else {
            sess.messages.pop();
            if (el) el.remove();
            dropped = true;
            if (/unsupported image/i.test(err) && !imagesStripped) {
              // 历史里混着坏图：剥掉再试一次，别让这条会话废掉
              imagesStripped = true;
              stripImages(sess);
              pendingRetry = true;
            } else if (/must follow a user message|invalid.*message|sequence/i.test(err) && !repairMode) {
              // 历史结构被拒：就地修好再存一份，然后用最近一条重试
              normalizeSession(sess);
              if (cur === sess) { renderChat(); saveCur(); }
              repairMode = true;
              pendingRetry = true;
            }
            if (cur === sess) toast('请求失败：' + err, 3200);
          }
        } else {
          msg.content = acc;
        }

        if (dropped) { resolve(); return; }

        var skillDir = null;
        var memBlocks = [];
        pendingFind = '';
        pendingSearch = '';
        pendingCtx = false;
        pendingHint = '';
        if (msg.content) {
          var cd = extractContextDirective(msg.content);
          if (cd.want) {
            msg.content = cd.text;
            pendingCtx = true;
          }
          var sd = extractSearchDirective(msg.content);
          if (sd.kw) {
            msg.content = sd.text;
            // 只有本地搜索开着时才走回环；内置联网由服务端处理，别在这儿空转
            if (S.searchMode === 'custom' || S.searchMode === 'duck') {
              pendingSearch = sd.kw;
            } else {
              // 内置/关闭模式下她不该发这个块；无论如何都要把她推回来把话说完
              pendingHint = S.searchMode === 'native'
                ? '不要发搜索指令——服务端已经开了联网，你直接回答就会带引用。现在立刻把答案说完。'
                : '这台机器没开联网。直接说搜不了，或者凭记忆回答，别等。';
            }
          }
          var fd = extractFindDirective(msg.content);
          if (fd.kw) {
            msg.content = fd.text;
            pendingFind = fd.kw;
          }
          var ex = extractSkillDirective(msg.content);
          if (ex.dir) {
            skillDir = ex.dir;
            msg.content = ex.text;
          }
          memBlocks = extractMemoryDirectives(msg.content);
          if (memBlocks.length) {
            memBlocks.forEach(function (b) {
              msg.content = msg.content.replace(b.raw, '');
            });
            msg.content = msg.content.trim();
          }
        }
        var wroteMem = memBlocks.length ? applyMemoryBlocks(memBlocks) : 0;
        var uu = mapUsage(lastUsage);
        if (uu) msg.usage = uu;
        if (reason) msg.reasoning = reason;

        // 这一轮把她的状态推一点
        if (window.XiState) {
          try {
            var lastUser = null;
            for (var li = sess.messages.length - 1; li >= 0; li--) {
              if (sess.messages[li].role === 'user' && !sess.messages[li].hidden) { lastUser = sess.messages[li]; break; }
            }
            window.XiState.afterTurn(lastUser ? (lastUser.display || lastUser.content) : '', msg.content);
          } catch (e) { }
        }

        if (cur === sess) {
          addUsage(uu);
          if (msg.content) {
            // 重画整条：可能被拆成多个气泡，不能只改第一个 .md
            var fresh = msgNode(msg, sess.messages.indexOf(msg));
            if (el && el.parentNode) el.replaceWith(fresh);
          }
          refreshHeader();
          saveCur();
          scrollBottom();
        } else {
          // 用户切走了：把结果写回那条会话，别丢
          persistSession(sess, uu);
          toast('「' + (sess.title || '另一条对话') + '」回完了', 2200);
        }

        if (skillDir) {
          setTimeout(function () { installSkill(skillDir.repo, skillDir.triggers || null); }, 900);
        }
        if (wroteMem) toast('已写进记忆：' + wroteMem + ' 页', 2400);
        scheduleBalance(true);
        resolve();
      }

      var nativeSearch = S.searchMode === 'native';
      // DeepSeek 只有 flash 支持看图；带图时自动切过去，纯文字仍用主模型
      var dsHost = /deepseek\.com/.test(String(S.baseUrl || '').toLowerCase());
      var pickModel = nativeSearch ? (S.searchModel || 'deepseek-flash') : S.model;
      if (dsHost && hasImages(sess)) pickModel = 'deepseek-flash';

      var body = {
        model: pickModel,
        messages: buildMessages(sess),
        stream: !!S.stream,
      };
      if (nativeSearch) {
        // DeepSeek 服务端工具：搜索与读链接都在他们那边跑，客户端只负责渲染
        body.tools = [
          { type: 'deepseek_web_search', name: 'deepseek_web_search' },
          { type: 'deepseek_read_url', name: 'deepseek_read_url' },
        ];
      } else {
        if (S.temperature != null) body.temperature = Number(S.temperature);
        if (S.maxTokens) body.max_tokens = Number(S.maxTokens);
      }
      if (body.stream) body.stream_options = { include_usage: true };

      var req = netPost(joinUrl('/chat/completions'), body, {
        onData: function (raw) {
          if (raw === '[DONE]') return;
          var j;
          try { j = JSON.parse(raw); } catch (e) { return; }
          if (j.error) { finish(j.error.message || '接口返回错误'); return; }
          if (typeof j === 'string') return;
          if (j.usage) lastUsage = j.usage;
          var ch = j.choices && j.choices[0];
          if (!ch) return;
          var delta = ch.delta || ch.message;
          if (!delta) return;
          if (delta.reasoning_content) reason += delta.reasoning_content;
          if (typeof delta.content === 'string' && delta.content) {
            acc += delta.content;
            paint();
          }
        },
        onDone: function () { finish(null); },
        onError: function (code, m) { finish(parseErr(code, m)); },
      }, true);

      currentReq = {
        abort: function () {
          aborted = true;
          req.abort();
          setTimeout(function () { if (!settled) finish(null); }, 60);
        },
      };
    });
  }

  function persistSession(sess, uu) {
    if (uu) addUsageTo(sess, uu);
    var meta = sessions.find(function (s) { return s.id === sess.id; });
    if (meta) {
      meta.title = sess.title;
      meta.updatedAt = Date.now();
      meta.count = sess.messages.filter(function (m) {
        return m.role === 'user' || m.role === 'assistant';
      }).length;
      meta.usage = sess.usage;
    }
    kvSet('s:' + sess.id, sess).then(saveIndex);
  }

  function stopChat() {
    if (currentReq) currentReq.abort();
  }

  /* ════════════════════ 搜聊天记录 ════════════════════ */

  var searchTimer = null;

  function bindSearch() {
    var q = $('qSearch');
    if (!q) return;
    q.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var kw = q.value.trim();
      searchTimer = setTimeout(function () {
        if (kw) runSessionSearch(kw);
        else renderSessions();
      }, 260);
    });
  }

  async function runSessionSearch(kw) {
    var low = kw.toLowerCase();
    var hits = [];
    for (var i = 0; i < sessions.length && hits.length < 60; i++) {
      var s = await kvGet('s:' + sessions[i].id);
      if (!s || !s.messages) continue;
      for (var j = s.messages.length - 1; j >= 0 && hits.length < 60; j--) {
        var m = s.messages[j];
        if (m.hidden || !m.content) continue;
        var pos = m.content.toLowerCase().indexOf(low);
        if (pos < 0) continue;
        hits.push({
          sid: s.id,
          idx: j,
          role: m.role,
          title: s.title || '未命名',
          snippet: m.content.slice(Math.max(0, pos - 26), pos + kw.length + 46),
        });
      }
    }
    renderSearchHits(hits, kw);
  }

  function renderSearchHits(hits, kw) {
    var box = $('sessions');
    box.innerHTML = '';
    if (!hits.length) {
      box.innerHTML = '<div class="sess-empty">没有聊到过「' + esc(kw) + '」</div>';
      return;
    }
    var head = document.createElement('div');
    head.className = 'sess-empty';
    head.textContent = '找到 ' + hits.length + ' 条';
    box.appendChild(head);

    hits.forEach(function (h) {
      var el = document.createElement('button');
      el.className = 'hit';
      var snip = esc(h.snippet).replace(new RegExp(escReg(kw), 'gi'), function (t) {
        return '<b>' + t + '</b>';
      });
      el.innerHTML = '<div class="ht">' + esc(h.title) + ' · ' + (h.role === 'user' ? '我' : '汐') + '</div>' +
        '<div class="hs">' + snip + '</div>';
      el.addEventListener('click', function () {
        openSession(h.sid).then(function () {
          setTimeout(function () { revealHit(h.idx); }, 140);
        });
      });
      box.appendChild(el);
    });
  }

  function revealHit(idx) {
    if (!cur) return;
    var need = cur.messages.length - idx + 8;
    if (!renderLimits[cur.id] || renderLimits[cur.id] < need) {
      renderLimits[cur.id] = Math.max(need, 80);
    }
    renderChat();
    requestAnimationFrame(function () {
      var el = document.querySelector('#msgs .msg[data-idx="' + idx + '"]');
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      stickBottom = false;
      el.classList.add('flash');
      setTimeout(function () { el.classList.remove('flash'); }, 1700);
    });
  }

  function escReg(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ════════════════════ 抽屉 / Sheet ════════════════════ */

  function openDrawer() {
    renderSessions();
    $('drawer').classList.add('open');
    $('scrim').classList.add('show');
  }
  function closeDrawer() {
    $('drawer').classList.remove('open');
    $('scrim').classList.remove('show');
  }

  function openSheet(id) {
    var el = $(id);
    el.classList.add('open');
    openStack.push(id);
  }
  function closeSheet(id) {
    var el = $(id);
    el.classList.remove('open');
    openStack = openStack.filter(function (x) { return x !== id; });
  }

  window.__xiBack = function () {
    if (openStack.length) {
      var top = openStack[openStack.length - 1];
      closeSheet(top);
      return true;
    }
    if ($('drawer').classList.contains('open')) { closeDrawer(); return true; }
    return false;
  };

  /* ════════════════════ 对话框 ════════════════════ */

  function darkNow() { return document.documentElement.getAttribute('data-theme') === 'dark'; }

  function C() {
    return darkNow()
      ? {
        panel: '#101f38', bd: 'rgba(150,185,255,.22)', t1: '#e8f0ff', t2: '#a8bede',
        dim: '#8aa2c8', btn: '#14243f', btnT: '#cfe0ff',
        accent: 'linear-gradient(150deg,#6fb3f0,#3d7fc4)',
        danger: 'linear-gradient(150deg,#e08484,#b5455c)',
        scrim: 'rgba(2,6,14,.66)', shadow: 'rgba(0,0,0,.5)',
      }
      : {
        panel: '#ffffff', bd: 'rgba(36,119,196,.25)', t1: '#08203a', t2: '#254c74',
        dim: '#6b7ba1', btn: '#ffffff', btnT: '#254c74',
        accent: 'linear-gradient(150deg,#57a9e6,#2477c4)',
        danger: 'linear-gradient(150deg,#e08484,#c43e3e)',
        scrim: 'rgba(8,32,58,.32)', shadow: 'rgba(8,32,58,.22)',
      };
  }

  function applyTheme() {
    var mode = S && S.theme ? S.theme : 'auto';
    if (mode === 'auto') {
      var native = null;
      try {
        if (window.XiNative && window.XiNative.theme) native = window.XiNative.theme();
      } catch (e) { }
      if (!native) {
        native = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
          ? 'dark' : 'light';
      }
      mode = native;
    }
    document.documentElement.setAttribute('data-theme', mode);
  }

  window.__xiTheme = function (mode) {
    if ((S && S.theme ? S.theme : 'auto') === 'auto') {
      document.documentElement.setAttribute('data-theme', mode);
    }
  };

  /* 上下文账单：点一下底部那条，看清楚钱花在哪 */
  function showCtxBreakdown() {
    var soul = MEM.get('SOUL.md');
    var soulLen = soul && soul.body ? soul.body.length : 0;
    var promptLen = MEM.prompt({ recalled: [], skills: MEM.matchSkills('', 0), search: S.searchMode }).length;
    var histLen = 0;
    if (cur) {
      cur.messages.forEach(function (m) {
        if (m.hidden) return;
        histLen += String(m.content || '').length;
        if (m.images) histLen += m.images.length * 4000;
      });
    }
    var tok = function (n) { return Math.round(n / 1.6); };
    var rows = [
      '人格 SOUL：' + tok(soulLen) + ' token',
      '记忆库（目录 + 常驻页 + 技能）：' + tok(Math.max(0, promptLen - soulLen)) + ' token',
      '这段对话：' + tok(histLen) + ' token',
      '窗口：' + Math.round(S.ctxWindow / 1000) + 'k，到 ' + Math.round(S.compressAt * 100) + '% 自动压缩',
      '',
      '开场固定开销约 ' + tok(promptLen) + ' token（' + Math.round(promptLen / (S.ctxWindow * 1.6) * 100) + '%）',
    ];
    if (window.XiState) {
      var sn = window.XiState.snapshot();
      rows.push('');
      rows.push('她此刻：精力 ' + sn.energy + ' · 心情 ' + sn.mood + ' · 温度 ' + sn.warmth + ' · 闷 ' + sn.boredom);
    }
    dialog('上下文构成', esc(rows.join('\n')), '好');
  }

  function dialog(title, msg, okText, danger) {
    return new Promise(function (resolve) {
      var t = C();
      var wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:99;background:' + t.scrim + ';' +
        'display:flex;align-items:center;justify-content:center;padding:24px;';
      wrap.innerHTML =
        '<div style="width:100%;max-width:320px;background:' + t.panel + ';border:1px solid ' + t.bd + ';' +
        'border-radius:18px;padding:20px 18px 14px;box-shadow:0 20px 60px ' + t.shadow + '">' +
        '<div style="font-size:16px;font-weight:650;color:' + t.t1 + ';margin-bottom:8px">' + esc(title) + '</div>' +
        '<div style="font-size:13px;color:' + t.t2 + ';line-height:1.65;margin-bottom:18px">' + (msg || '') + '</div>' +
        '<div style="display:flex;gap:9px;justify-content:flex-end">' +
        '<button data-v="0" style="border:1px solid ' + t.bd + ';background:' + t.btn + ';color:' + t.btnT + ';' +
        'font-size:13.5px;padding:8px 16px;border-radius:10px;font-family:inherit">取消</button>' +
        '<button data-v="1" style="border:0;background:' + (danger ? t.danger : t.accent) +
        ';color:#fff;font-size:13.5px;font-weight:600;padding:8px 18px;border-radius:10px;font-family:inherit">' +
        esc(okText || '确定') + '</button></div></div>';
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) { if (e.target === wrap) { wrap.remove(); resolve(false); } return; }
        wrap.remove();
        resolve(b.dataset.v === '1');
      });
      document.body.appendChild(wrap);
    });
  }

  function pickList(title, items, onPick) {
    var t = C();
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99;background:' + t.scrim + ';' +
      'display:flex;align-items:flex-end;justify-content:center;';
    wrap.innerHTML =
      '<div style="width:100%;max-height:70vh;background:' + t.panel + ';border-radius:20px 20px 0 0;' +
      'border-top:1px solid ' + t.bd + ';box-shadow:0 -12px 40px ' + t.shadow + ';' +
      'display:flex;flex-direction:column;padding-bottom:env(safe-area-inset-bottom)">' +
      '<div style="padding:16px 18px 10px;font-size:15px;font-weight:650;color:' + t.t1 + '">' + esc(title) + '</div>' +
      '<div style="overflow-y:auto;padding:0 8px 14px" data-list></div></div>';
    var list = wrap.querySelector('[data-list]');
    items.forEach(function (it) {
      var b = document.createElement('div');
      b.textContent = it;
      b.style.cssText = 'padding:12px 14px;border-radius:11px;font-size:14.5px;color:' + t.t1 + ';word-break:break-all';
      b.addEventListener('click', function () { wrap.remove(); onPick(it); });
      list.appendChild(b);
    });
    wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
  }

  /* ════════════════════ 设置 ════════════════════ */

  function loadSettings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(SK) || '{}') || {}; } catch (e) { s = {}; }
    return Object.assign({}, DEFAULTS, s);
  }
  function saveSettings() {
    try { localStorage.setItem(SK, JSON.stringify(S)); } catch (e) { }
  }

  function fillSettings() {
    $('fBase').value = S.baseUrl || '';
    $('fModel').value = S.model || '';
    $('fKey').value = S.apiKey || '';
    $('fTemp').value = S.temperature;
    $('fMaxTok').value = S.maxTokens || 0;
    $('fStream').checked = !!S.stream;
    $('fMemOn').checked = !!S.memoryOn;
    $('fAutoEx').checked = !!S.autoExtract;
    $('fExEvery').value = S.exEvery || 2;
    $('fExModel').value = S.exModel || '';
    $('fComp').checked = !!S.compress;
    $('fCtxWin').value = S.ctxWindow || 64000;
    $('fKeep').value = S.keep || 8;
    $('fAiMerge').checked = !!S.aiMerge;
    $('fVoiceMode').value = S.voiceMode || 'ai';
    $('fAsr').value = S.asrModel || 'whisper-1';
    $('fTheme').value = S.theme || 'auto';
    $('fImgMode').value = S.imgMode || 'original';
    $('fSearchMode').value = S.searchMode === 'off' ? 'off' : 'native';
    $('fEnvOn').checked = S.envOn !== false;
    refreshEnv();
    var parts = [];
    parts.push(ENV && ENV.lat != null ? '位置已授权' : (ENV && ENV.hasLocationPerm ? '位置已授权（暂无定位）' : '位置未授权'));
    parts.push(ENV && ENV.hasStepPerm ? '步数已授权' : '步数未授权');
    parts.push(ENV && ENV.hasUsagePerm ? '使用情况已授权' : '使用情况未授权');
    $('locHint').textContent = parts.join(' · ');
  }

  function readSettings() {
    S.baseUrl = $('fBase').value.trim();
    S.model = $('fModel').value.trim();
    S.apiKey = $('fKey').value.trim();
    S.temperature = parseFloat($('fTemp').value) || 0;
    S.maxTokens = parseInt($('fMaxTok').value, 10) || 0;
    S.stream = $('fStream').checked;
    S.memoryOn = $('fMemOn').checked;
    S.autoExtract = $('fAutoEx').checked;
    S.exEvery = parseInt($('fExEvery').value, 10) || 2;
    S.exModel = $('fExModel').value.trim();
    S.compress = $('fComp').checked;
    S.ctxWindow = parseInt($('fCtxWin').value, 10) || 64000;
    S.keep = parseInt($('fKeep').value, 10) || 8;
    S.aiMerge = $('fAiMerge').checked;
    S.voiceMode = $('fVoiceMode').value;
    S.asrModel = $('fAsr').value.trim() || 'whisper-1';
    S.theme = $('fTheme').value || 'auto';
    S.imgMode = $('fImgMode').value || 'original';
    S.searchMode = $('fSearchMode').value || 'native';
    S.searchModel = 'deepseek-flash';
    S.envOn = $('fEnvOn').checked;
    applyTheme();
    saveSettings();
  }

  function renderPresets() {
    var box = $('presets');
    box.innerHTML = '';
    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'preset';
      b.textContent = p.name;
      b.addEventListener('click', function () {
        $('fBase').value = p.base;
        $('fModel').value = p.model;
        toast('已填入 ' + p.name, 1200);
      });
      box.appendChild(b);
    });
  }

  function listModels(done) {
    var url = joinUrl('/models');
    var hdr = { 'Authorization': 'Bearer ' + (S.apiKey || '').trim() };
    var doneCalled = false;
    var id = 'm' + Date.now().toString(36);
    var finish = function (arr) { if (doneCalled) return; doneCalled = true; done(arr); };

    if (window.XiNative && window.XiNative.http) {
      pendingReq[id] = {
        onData: function (raw) {
          try {
            var j = JSON.parse(raw);
            var arr = (j.data || j.models || []).map(function (m) { return m.id || m.name || m; });
            finish(arr.filter(Boolean));
          } catch (e) { finish([]); }
        },
        onError: function (code, m) { toast(parseErr(code, m), 3000); finish([]); },
        onDone: function () { },
      };
      window.XiNative.http(id, url, JSON.stringify(hdr), '', false);
    } else {
      fetch(url, { headers: hdr }).then(function (r) { return r.json(); }).then(function (j) {
        var arr = (j.data || j.models || []).map(function (m) { return m.id || m.name || m; });
        finish(arr.filter(Boolean));
      }).catch(function (e) { toast(String(e.message || e), 2600); finish([]); });
    }
  }

  function testConnection() {
    toast('测试中…', 1200);
    listModels(function (arr) {
      if (arr && arr.length) toast('通了，' + arr.length + ' 个模型可用', 2200);
    });
  }

  /* ════════════════════ 记忆库 UI ════════════════════ */

  function renderMemory() {
    var st = MEM.stats();
    $('memInfo').textContent = st.pages + ' 页 · ' + st.log + ' 条时间线 · ' +
      (MEM.get('SOUL.md') ? '人格已就位' : '⚠ 缺 SOUL.md');

    var box = $('pages');
    box.innerHTML = '';
    var groups = {};
    MEM.list().forEach(function (p) {
      var f = p.path.indexOf('/') >= 0 ? p.path.split('/')[0] : '根目录';
      if (f !== 'SOUL.md' && f !== 'MEMORY.md') { (groups[f] = groups[f] || []).push(p); }
      else { (groups['根目录'] = groups['根目录'] || []).push(p); }
    });

    var order = ['根目录', 'identity', 'user', 'decisions', 'projects', 'skills', 'concepts'];
    order.concat(Object.keys(groups).filter(function (k) { return order.indexOf(k) < 0; }))
      .forEach(function (g) {
        if (!groups[g]) return;
        var h = document.createElement('div');
        h.className = 'pgroup';
        h.textContent = g;
        box.appendChild(h);
        groups[g].forEach(function (p) {
          var d = document.createElement('div');
          d.className = 'page-item';
          d.innerHTML =
            '<div class="pi-main"><div class="pi-title">' + esc(p.title) + '</div>' +
            '<div class="pi-sum">' + esc(p.summary || p.path) + '</div></div>' +
            '<span class="pi-sal s' + (p.salience || 2) + '">S' + (p.salience || 2) + '</span>';
          d.addEventListener('click', function () { editPage(p.path); });
          box.appendChild(d);
        });
      });
  }

  function editPage(path) {
    var p = path ? MEM.get(path) : null;
    editingPath = path || null;
    $('pgTitle').textContent = p ? '编辑记忆页' : '新建记忆页';
    $('pgFields').classList.remove('hidden');
    $('pgReadonly').classList.add('hidden');
    $('pgName').value = p ? p.title : '';
    $('pgPath').value = p ? p.path : '';
    $('pgPath').disabled = !!p;
    $('pgType').value = p ? (p.type || 'fact') : 'fact';
    $('pgSal').value = p ? (p.salience || 2) : 2;
    $('pgSum').value = p ? (p.summary || '') : '';
    $('pgTrig').value = p && p.triggers ? p.triggers.join(', ') : '';
    $('pgBody').value = p ? (p.body || '') : '';
    $('btnDelPage').style.display = p ? '' : 'none';
    openSheet('sheet-page');
  }

  function viewRaw(title, text) {
    $('pgTitle').textContent = title;
    $('pgFields').classList.add('hidden');
    $('pgReadonly').classList.remove('hidden');
    $('pgRaw').textContent = text;
    openSheet('sheet-page');
  }

  function savePage() {
    var path = ($('pgPath').value || '').trim();
    var title = ($('pgName').value || '').trim();
    if (!path) { toast('路径不能空', 1500); return; }
    if (!title) { toast('标题不能空', 1500); return; }
    MEM.upsert({
      path: path,
      title: title,
      type: $('pgType').value,
      salience: parseInt($('pgSal').value, 10) || 2,
      summary: ($('pgSum').value || '').trim(),
      triggers: ($('pgTrig').value || '').split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean),
      body: $('pgBody').value || '',
      tags: [],
    });
    MEM.addLog('work', '更新记忆页 ' + path);
    closeSheet('sheet-page');
    renderMemory();
    refreshHeader();
    toast('已保存', 1400);
  }

  /* ════════════════════ 导入 / 导出 ════════════════════ */

  function b64encode(u8) {
    var s = '';
    var CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(s);
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function doExport() {
    try {
      var files = MEM.exportFiles();
      var bytes = ZIP.create(files);
      var name = '汐-记忆-' + stamp() + '.zip';

      if (window.XiNative && window.XiNative.saveDownload) {
        window.__xiSaved = function (id, path) {
          toast('已导出：' + path, 4200);
        };
        window.__xiSaveError = function (id, msg) {
          toast('导出失败：' + msg, 3000);
        };
        window.XiNative.saveDownload('ex' + Date.now(), name, b64encode(bytes));
      } else {
        var blob = new Blob([bytes], { type: 'application/zip' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        toast('已下载 ' + name, 2000);
      }
    } catch (e) {
      toast('导出失败：' + e.message, 3000);
    }
  }

  var importId = null;

  function doImport() {
    if (!(window.XiNative && window.XiNative.pickFileBridge)) {
      toast('浏览器预览不支持选文件，请用 APK', 2200);
      return;
    }
    importId = 'im' + Date.now();
    window.__xiPicked = async function (id, name, b64) {
      if (id !== importId) return;
      try {
        var bin = atob(b64);
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        var entries = await ZIP.read(u8);

        var plan = MEM.planImport(entries);
        if (!plan.entries.length) { toast('这份 zip 里没有可同步的记忆页', 2600); return; }

        function countPlan() {
          var c = { add: 0, update: 0, same: 0, merge: 0, conflict: 0, localAhead: 0, delete: 0 };
          plan.entries.forEach(function (e) { if (c[e.action] != null) c[e.action]++; });
          return c;
        }

        var c = countPlan();

        // 两边都改、且自动合并失败 → 让模型合成一版
        if (c.conflict && S.aiMerge && S.apiKey) {
          var merged = await aiMergePlan(plan, 3);
          if (merged) c = countPlan();
        }

        var lines = [];
        lines.push('来源：' + plan.device + (plan.exportedAt ? '（' + plan.exportedAt + '）' : ''));
        lines.push('新增 <b>' + c.add + '</b> · 远端更新 <b>' + c.update + '</b> · 自动合并 <b>' +
          c.merge + '</b> · 冲突 <b>' + c.conflict + '</b> · 本地更新 ' + c.localAhead +
          ' · 没变 ' + c.same + (c.delete ? ' · 远端删除 ' + c.delete : ''));
        if (c.merge) lines.push('合并 = 两边的改动都留下，合成同一页。');
        if (c.conflict) lines.push('冲突 = 两边改到同一处、也合不出来：<b>保留本地</b>，远端版本另存到 <code>conflicts/</code>。');
        if (c.conflict && !S.aiMerge) lines.push('<span style="color:#e8b26a">AI 合并没有打开，冲突只能另存。</span>');
        if (!plan.hasManifest) {
          lines.push('<br><span style="color:#e8b26a">这份 zip 没有 _sync.json，判断不了谁改过；所有不同页都会算冲突。首次导入建议用「覆盖」。</span>');
        }

        var go = await dialog('同步预览', lines.join('<br>'), '按变更合并', false);
        if (!go) {
          var sure = await dialog('改用覆盖？', '先清空当前记忆库，再整包导入这份。冲突会消失。', '覆盖导入', true);
          if (!sure) return;
          var rr = MEM.importFiles(entries, 'replace');
          renderMemory(); refreshHeader();
          toast('已覆盖导入 ' + (rr.added + rr.updated) + ' 页', 3000);
          return;
        }

        var r = MEM.applyImport(plan);
        renderMemory();
        refreshHeader();
        var msg = '同步完成：新增 ' + r.counts.add + '，更新 ' + r.counts.update;
        if (r.counts.merge) msg += '，合并 ' + r.counts.merge;
        if (r.counts.conflict) msg += '，冲突 ' + r.counts.conflict + '（已另存）';
        if (r.logAdded) msg += '，时间线 +' + r.logAdded;
        toast(msg, 3600);
      } catch (e) {
        toast('导入失败：' + e.message, 3200);
      }
    };
    window.__xiPickCancelled = function () { };
    window.__xiPickError = function (id, msg) { toast('读取失败：' + msg, 2600); };
    window.XiNative.pickFileBridge(importId);
  }

  /* ════════════════════ 绑定 ════════════════════ */

  function autoGrow() {
    var t = $('input');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 132) + 'px';
  }

  function bindUI() {
    bindScrollStick();
    bindSearch();
    $('btnAskLoc').addEventListener('click', function () {
      if (window.XiNative && window.XiNative.askLocation) {
        window.XiNative.askLocation();
        toast('授权后回来这里看状态', 2200);
      } else {
        toast('手机端才能授权', 2000);
      }
    });
    $('btnAskStep').addEventListener('click', function () {
      if (window.XiNative && window.XiNative.askActivity) window.XiNative.askActivity();
      else toast('手机端才能授权', 2000);
    });
    $('btnAskUsage').addEventListener('click', function () {
      if (window.XiNative && window.XiNative.openUsageSettings) {
        window.XiNative.openUsageSettings();
        toast('在系统设置里给「汐」打开使用情况访问', 3000);
      } else {
        toast('手机端才能授权', 2000);
      }
    });
    $('btnSelfCheck').addEventListener('click', selfCheck);
    var ctxRow = document.querySelector('.ctx');
    if (ctxRow) ctxRow.addEventListener('click', showCtxBreakdown);
    $('btnMenu').addEventListener('click', openDrawer);
    $('scrim').addEventListener('click', closeDrawer);
    $('btnNew').addEventListener('click', function () { closeDrawer(); newSession(); });

    $('btnSet').addEventListener('click', function () { fillSettings(); openSheet('sheet-set'); });
    $('btnMem').addEventListener('click', function () { renderMemory(); openSheet('sheet-mem'); });
    $('btnGoMem').addEventListener('click', function () { closeDrawer(); renderMemory(); openSheet('sheet-mem'); });

    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeSheet(b.dataset.close); });
    });

    $('btnSaveSet').addEventListener('click', function () {
      readSettings();
      closeSheet('sheet-set');
      updateCtx();
      refreshHeader();
      refreshBalance();
      toast('设置已保存', 1400);
    });

    $('btnTest').addEventListener('click', function () { readSettings(); testConnection(); });
    $('btnModels').addEventListener('click', function () {
      readSettings();
      toast('拉取中…', 1200);
      listModels(function (arr) {
        if (!arr.length) return;
        pickList('选一个模型', arr, function (m) { $('fModel').value = m; });
      });
    });
    $('btnEye').addEventListener('click', function () {
      var k = $('fKey');
      var show = k.type === 'password';
      k.type = show ? 'text' : 'password';
      this.textContent = show ? '隐藏' : '显示';
    });

    $('btnSend').addEventListener('click', function () {
      if (busy) stopChat(); else send();
    });
    $('btnAttach').addEventListener('click', function () { pickAttach('file'); });
    $('btnPickImage').addEventListener('click', function () { pickAttach('image'); });
    $('btnVoice').addEventListener('click', startVoice);
    $('btnRefreshBal').addEventListener('click', refreshBalance);
    $('ctxBal').addEventListener('click', function (e) {
      e.stopPropagation();
      openBalance();
    });
    $('ctxUsage').addEventListener('click', function () {
      renderUsage();
      openSheet('sheet-usage');
    });
    $('ctx').addEventListener('click', function () {
      renderUsage();
      openSheet('sheet-usage');
    });
    $('btnZeroUsage').addEventListener('click', async function () {
      if (!cur) return;
      var ok = await dialog('清空本会话用量', '只清统计数字，不动对话内容。', '清空', true);
      if (!ok) return;
      cur.usage = { p: 0, c: 0, hit: 0, miss: 0, reqs: 0 };
      await saveCur();
      renderUsage();
      updateCtx();
      toast('已清空', 1200);
    });
    $('btnImportSession').addEventListener('click', importSession);
    $('attachBar').addEventListener('click', function (e) {
      var x = e.target.closest('[data-att]');
      if (!x) return;
      ATTS = ATTS.filter(function (a) { return a.id !== x.dataset.att; });
      renderAtts();
    });

    var input = $('input');
    input.addEventListener('input', autoGrow);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });

    $('msgs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var wrap = b.closest('.msg');
      var idx = parseInt(wrap.dataset.idx, 10);
      var m = cur.messages[idx];
      if (!m) return;
      if (b.dataset.act === 'copy') {
        var txt = m.content || '';
        if (window.XiNative && window.XiNative.copyText) window.XiNative.copyText(txt);
        else { navigator.clipboard.writeText(txt); toast('已复制'); }
      } else if (b.dataset.act === 'del') {
        cur.messages.splice(idx, 1);
        saveCur();
        renderChat();
      } else if (b.dataset.act === 'regen') {
        if (busy) return;
        cur.messages.splice(idx, 1);
        saveCur();
        renderChat();
        busy = true; setSendState('stop');
        runChat().finally(function () { busy = false; setSendState('send'); saveCur(); });
      }
    });

    $('btnExport').addEventListener('click', doExport);
    $('btnExport2').addEventListener('click', doExport);
    $('btnImport').addEventListener('click', doImport);
    $('btnImport2').addEventListener('click', doImport);
    $('btnNewPage').addEventListener('click', function () { editPage(null); });
    $('btnGhSkill').addEventListener('click', async function () {
      var v = await inputDialog('从 GitHub 装技能', '', 'owner/repo，或 SKILL.md 的 raw 链接', '装');
      if (v) installSkill(v);
    });
    $('btnGhSearch').addEventListener('click', searchSkills);
    $('btnViewIndex').addEventListener('click', function () { viewRaw('index.md', MEM.indexText()); });
    $('btnViewLog').addEventListener('click', function () { viewRaw('log.md', MEM.logText()); });
    $('btnSavePage').addEventListener('click', savePage);
    $('btnDelPage').addEventListener('click', async function () {
      if (!editingPath) return;
      var ok = await dialog('删除记忆页', '删掉这一页后，索引里也不会再有它。', '删除', true);
      if (!ok) return;
      MEM.remove(editingPath);
      MEM.addLog('work', '删除记忆页 ' + editingPath);
      closeSheet('sheet-page');
      renderMemory();
      refreshHeader();
    });

    $('btnEditSoul').addEventListener('click', function () {
      closeSheet('sheet-set');
      setTimeout(function () { editPage('SOUL.md'); }, 260);
    });

    $('btnWipe').addEventListener('click', async function () {
      var ok = await dialog('清空全部数据', '对话、记忆、设置全部删除，不可恢复。记忆库请先导出。', '全删', true);
      if (!ok) return;
      localStorage.clear();
      var db = await openDB().catch(function () { return null; });
      if (db) { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').clear(); }
      location.reload();
    });
  }

  /* ════════════════════ 启动 ════════════════════ */

  var booted = false;

  async function boot() {
    if (booted) return;
    booted = true;
    try {
      await bootInner();
    } catch (e) {
      console.error('boot failed', e);
      var el = $('tSub');
      if (el) el.textContent = '启动失败：' + ((e && e.message) || e);
    }
  }

  async function bootInner() {
    MEM.init();
    S = loadSettings();
    // 内部状态：启动时按离线时长恢复，隔夜就跑一次整理
    if (window.XiState) {
      try {
        window.XiState.load();
        if (window.XiState.needNightly()) {
          setTimeout(async function () {
            var done = false;
            try {
              done = await runNightlyAI();
            } catch (e) {
              done = false;
            }
            if (!done) {
              try {
                window.XiState.nightly(MEM);
                done = true;
              } catch (e) { }
            }
            if (done && window.XiState.markNight) window.XiState.markNight();
            flushSoulNotice();
          }, 4000);
        }
      } catch (e) { }
    }
    // 旧版本留下的 duck / custom 统一归到内置；只保留「关闭」
    if (S.searchMode !== 'off') S.searchMode = 'native';
    applyTheme();
    renderPresets();
    fillSettings();
    bindUI();

    var idx = await kvGet('index');
    sessions = Array.isArray(idx) ? idx : [];

    if (sessions.length) {
      await openSession(sessions[0].id);
    } else {
      await newSession();
    }
    renderSessions();
    refreshHeader();
    renderBalance();
    scheduleBalance(true);

    // 回前台 / 每分钟，都顺手刷一次余额
    window.__xiResume = function () { refreshEnv(); scheduleBalance(); };
    setInterval(function () {
      if (!document.hidden) scheduleBalance();
    }, 60000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleBalance();
    });

    var env = '';
    try {
      if (window.XiNative && window.XiNative.env) {
        var e = JSON.parse(window.XiNative.env());
        env = 'Android ' + e.sdk + ' · ' + e.device;
      }
    } catch (x) { }
    $('about').textContent = '汐 v1.1 · 皮肤参考「深海女仆工坊」×「蓝色大肥鱼」· 记忆只在本机' +
      (env ? ' · ' + env : ' · 浏览器预览');

    if (location.search.indexOf('demo') >= 0) demo();
    if (location.search.indexOf('view=mem') >= 0) { renderMemory(); openSheet('sheet-mem'); }
    if (location.search.indexOf('view=set') >= 0) { openSheet('sheet-set'); }
    if (location.search.indexOf('view=usage') >= 0) { renderUsage(); openSheet('sheet-usage'); }
  }

  function demo() {
    cur.messages = [
      { role: 'user', content: '我想搞一个手机版本的我，只要 chat。' },
      {
        role: 'assistant',
        content: '明白。那就是**同一个人格、同一份记忆**，换个壳。\n\n' +
          '- 记忆存成 `.md`，和桌面 `~/.memory` 一套格式\n' +
          '- 你当中间人，导出/导入来同步\n' +
          '- 上下文超了自动摘要，不丢线\n\n' +
          '我先把 APK 做出来。',
      },
      { role: 'note', text: '上下文已压缩 6 条' },
      { role: 'user', content: '记忆能不能带向量检索？' },
      {
        role: 'assistant',
        content: '能，但**分层**：\n\n| 层 | 存什么 | 丢了会怎样 |\n|---|---|---|\n| markdown | 记忆本体 | 真丢 |\n| SQLite 向量索引 | 派生索引 | 重建就行 |\n\n```js\n// 语义召回：先向量粗排，再关键词精排\nconst hits = await index.search(query, { k: 8 });\n```\n\n先跑通 markdown 这条，向量层等库长大了再插。',
        usage: { p: 4120, c: 318, hit: 3390, miss: 730 },
      },
    ];
    cur.title = '手机版的我';
    cur.usage = { p: 8650, c: 640, hit: 7100, miss: 1550, reqs: 2 };
    renderChat();
    renderSessions();
  }

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();

  window.__xi = {
    send: send, MEM: MEM, installSkill: installSkill,
    extractSkillDirective: extractSkillDirective,
    refreshBalance: refreshBalance,
    saveCur: saveCur, renderChat: renderChat,
    nightly: runNightlyAI,
    get S() { return S; }, get cur() { return cur; }, get BAL() { return BAL; },
  };
})();
