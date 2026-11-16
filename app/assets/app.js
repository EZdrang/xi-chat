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
    return l.scrollHeight - l.scrollTop - l.clientHeight < 120;
  }
  function scrollBottom(force) {
    var l = $('list');
    if (force || nearBottom()) l.scrollTop = l.scrollHeight;
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

  /* 返回 { abort } */
  function netPost(url, bodyObj, handlers, stream) {
    var id = 'r' + (++reqSeq) + '_' + Date.now().toString(36);
    var payload = JSON.stringify(bodyObj);
    var hdr = headers();

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
    if (!(window.XiNative && window.XiNative.pickFileBridge)) {
      toast('手机端才能选文件', 2000);
      return;
    }
    var id = 'is' + Date.now();
    window.__xiPicked = function (pid, name, b64) {
      if (pid !== id) return;
      try {
        var txt = new TextDecoder('utf-8').decode(b64ToBytes(b64));
        var j = JSON.parse(txt);
        var src = j.session || j;
        if (!src || !Array.isArray(src.messages)) throw new Error('不是对话文件');
        var ns = {
          id: uid(),
          title: (src.title || name.replace(/\.json$/i, '')) + '（导入）',
          messages: src.messages, summary: src.summary || '', turns: 0,
          createdAt: src.createdAt || Date.now(), updatedAt: Date.now(),
          count: src.messages.length,
        };
        sessions.unshift({ id: ns.id, title: ns.title, updatedAt: ns.updatedAt, count: ns.count });
        kvSet('s:' + ns.id, ns).then(function () {
          saveIndex();
          renderSessions();
          openSession(ns.id);
          closeDrawer();
        });
        toast('已导入「' + ns.title + '」', 2200);
      } catch (e) {
        toast('导入失败：' + e.message, 2800);
      }
    };
    window.__xiPickCancelled = function () { };
    window.__xiPickError = function (i, m) { toast('读取失败：' + m, 2600); };
    window.XiNative.pickFileBridge(id);
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

  /* ════════════════════ 渲染 ════════════════════ */

  function refreshHeader() {
    $('tMain').textContent = cur ? (cur.title || '新的对话') : '新的对话';
    var n = cur ? cur.messages.filter(function (m) { return m.role === 'user' || m.role === 'assistant'; }).length : 0;
    var st = MEM.stats();
    $('tSub').textContent = n + ' 条 · 记忆 ' + st.pages + ' 页';
    $('memStat').textContent = '记忆 ' + st.pages + ' 页';
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
          '<div class="md">' + md + '</div>' +
        '</div>' +
        '<div class="meta">' + ug +
          '<button data-act="copy">复制</button>' +
          (isMe ? '' : '<button data-act="regen">重说</button>') +
          '<button data-act="del">删除</button>' +
        '</div>' +
      '</div>';
    return wrap;
  }

  function renderChat() {
    var box = $('msgs');
    box.innerHTML = '';
    if (!cur) return;
    cur.messages.forEach(function (m, i) { box.appendChild(msgNode(m, i)); });
    refreshHeader();
    updateCtx();
    requestAnimationFrame(function () { scrollBottom(true); });
  }

  function appendMsg(m) {
    var index = cur.messages.indexOf(m);
    var el = msgNode(m, index);
    $('msgs').appendChild(el);
    $('empty').classList.remove('show');
    scrollBottom();
    return el;
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
    if (!S || !S.compress) { bar.classList.add('hidden'); return; }
    var est = estimateContext();
    var win = S.ctxWindow || 64000;
    var pct = Math.min(100, (est / win) * 100);
    bar.classList.remove('hidden', 'warn', 'full');
    if (pct > 88) bar.classList.add('full');
    else if (pct > 68) bar.classList.add('warn');
    $('ctxBar').style.width = pct.toFixed(1) + '%';
    $('ctxText').textContent = '上下文 ' + Math.round(pct) + '%';
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

  function startVoice() {
    if (!window.XiNative) { toast('手机端才有语音输入', 2000); return; }
    if (S.voiceMode !== 'system' && window.XiNative.startRecordBridge) { aiVoice(); return; }
    systemVoice();
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
    };
    window.__xiRecorded = function (pid, b64) {
      if (pid !== id) return;
      btn.classList.remove('busy');
      var url = (S.baseUrl || '').replace(/\/+$/, '') + '/audio/transcriptions';
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
        toast('转写失败：' + String(m).slice(0, 90), 3000);
      };
      window.XiNative.transcribe(tid, url, S.apiKey || '', S.asrModel || 'whisper-1', b64, 'm4a');
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

  function shrinkImage(dataUrl, max, q) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.width, h = img.height;
          var s = Math.min(1, max / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.round(w * s);
          c.height = Math.round(h * s);
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', q));
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  function renderAtts() {
    var bar = $('attachBar');
    bar.innerHTML = '';
    if (!ATTS.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    ATTS.forEach(function (a) {
      var chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = (a.kind === 'image' && a.preview
          ? '<img src="' + a.preview + '" alt="">'
          : '<span class="ci">📎</span>') +
        '<span class="cn">' + esc(a.name) + '</span>' +
        '<span class="x" data-att="' + a.id + '">×</span>';
      bar.appendChild(chip);
    });
  }

  function pickAttach() {
    if (!(window.XiNative && window.XiNative.pickFileBridge)) {
      toast('浏览器里选不了文件，装到手机上用', 2200);
      return;
    }
    var id = 'at' + (++attSeq) + Date.now().toString(36);
    window.__xiPicked = async function (pid, name, b64) {
      if (pid !== id) return;
      try {
        if (IMG_EXT.test(name)) {
          var raw = 'data:' + mimeOf(name) + ';base64,' + b64;
          var shrunk = await shrinkImage(raw, 1280, 0.82);
          ATTS.push({ id: id + '-' + ATTS.length, kind: 'image', name: name, preview: shrunk, dataUrl: shrunk, size: shrunk.length });
        } else if (TXT_EXT.test(name)) {
          var txt = new TextDecoder('utf-8').decode(b64ToBytes(b64));
          ATTS.push({ id: id + '-' + ATTS.length, kind: 'file', name: name, text: txt.slice(0, 30000), size: txt.length });
        } else {
          ATTS.push({ id: id + '-' + ATTS.length, kind: 'file', name: name, text: null, size: Math.round(b64.length * 0.75) });
        }
        renderAtts();
        toast('已添加 ' + name, 1300);
      } catch (e) {
        toast('读取失败：' + e.message, 2600);
      }
    };
    window.__xiPickCancelled = function () { };
    window.__xiPickError = function (i, m) { toast('读取失败：' + m, 2600); };
    window.XiNative.pickFileBridge(id);
  }

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

  function buildMessages() {
    var out = [];
    var recalled = [];
    if (S.memoryOn) {
      var lastUser = '';
      for (var i = cur.messages.length - 1; i >= 0; i--) {
        if (cur.messages[i].role === 'user') { lastUser = cur.messages[i].content; break; }
      }
      recalled = MEM.recall(lastUser, 3);
      out.push({
        role: 'system',
        content: MEM.prompt({ recalled: recalled, skills: MEM.matchSkills(lastUser, 2) }),
      });
    } else {
      out.push({ role: 'system', content: '你是汐，中文，先结论后理由，简短务实。' });
    }
    if (cur.summary) {
      out.push({ role: 'system', content: '【早前对话的压缩摘要】\n' + cur.summary });
    }
    cur.messages.forEach(function (m) {
      if (m.role !== 'user' && m.role !== 'assistant') return;
      if (m.role === 'user' && m.images && m.images.length) {
        var parts = [];
        if (m.content) parts.push({ type: 'text', text: m.content });
        m.images.forEach(function (u) {
          parts.push({ type: 'image_url', image_url: { url: u } });
        });
        out.push({ role: 'user', content: parts });
      } else if (m.content) {
        out.push({ role: m.role, content: m.content });
      }
    });
    return out;
  }

  async function send() {
    if (busy) return;
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
    await saveCur();
    updateCtx();

    try {
      if (S.compress) await maybeCompress();
      await runChat();
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

  function runChat() {
    return new Promise(function (resolve) {
      var msg = { role: 'assistant', content: '', reasoning: '', ts: Date.now() };
      cur.messages.push(msg);
      var el = appendMsg(msg);
      var mdEl = el.querySelector('.md');
      var bubble = el.querySelector('.bubble');
      var acc = '', reason = '';
      var settled = false;
      var lastPaint = 0;
      var lastUsage = null;

      bubble.classList.add('streaming');

      function paint(force) {
        var now = Date.now();
        if (!force && now - lastPaint < 110) return;
        lastPaint = now;
        mdEl.innerHTML = MD.render(acc || '');
        scrollBottom();
      }

      function finish(err) {
        if (settled) return;
        settled = true;
        bubble.classList.remove('streaming');
        currentReq = null;

        if (err) {
          if (aborted && acc) {
            msg.content = acc + '\n\n*（已停止）*';
          } else if (aborted) {
            cur.messages.pop();
            el.remove();
            resolve();
            return;
          } else {
            el.classList.add('err');
            bubble.innerHTML = '<b>请求失败</b><br>' + esc(err);
            cur.messages.pop();
            setTimeout(function () { el.remove(); }, 1);
            el.remove();
          }
        } else {
          msg.content = acc;
        }
        var skillDir = null;
        if (msg.content) {
          var ex = extractSkillDirective(msg.content);
          if (ex.dir) {
            skillDir = ex.dir;
            msg.content = ex.text;
          }
        }
        var uu = mapUsage(lastUsage);
        if (uu) {
          msg.usage = uu;
          addUsage(uu);
        }
        if (reason) msg.reasoning = reason;

        if (msg.content) {
          mdEl.innerHTML = MD.render(msg.content);
          if (msg.reasoning) {
            var d = document.createElement('details');
            d.className = 'think';
            d.innerHTML = '<summary>思考过程</summary><div class="think-body">' + esc(reason) + '</div>';
            bubble.insertBefore(d, bubble.firstChild);
          }
        }
        refreshHeader();
        saveCur();
        scrollBottom();
        if (skillDir) {
          setTimeout(function () { installSkill(skillDir.repo, skillDir.triggers || null); }, 900);
        }
        resolve();
      }

      var body = {
        model: S.model,
        messages: buildMessages(),
        stream: !!S.stream,
      };
      if (S.temperature != null) body.temperature = Number(S.temperature);
      if (S.maxTokens) body.max_tokens = Number(S.maxTokens);
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
          if (delta.reasoning_content) { reason += delta.reasoning_content; }
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

  function stopChat() {
    if (currentReq) currentReq.abort();
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
    $('btnAttach').addEventListener('click', pickAttach);
    $('btnVoice').addEventListener('click', startVoice);
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
    get S() { return S; }, get cur() { return cur; },
  };
})();
