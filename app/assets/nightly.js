/* 夜间整理（模型版）：她出方案，代码执行。
   规矩：SOUL/MEMORY 不自动改；每页动手前留旧版；改动有上限。 */
(function () {
  'use strict';

  var HIST = 'xi.v1.pagehist';

  function histAll() {
    try { return JSON.parse(localStorage.getItem(HIST) || '{}'); } catch (e) { return {}; }
  }

  function backupPage(path, body) {
    var h = histAll();
    var list = h[path] || [];
    list.push({ ts: Date.now(), body: String(body || '') });
    if (list.length > 3) list = list.slice(-3);
    h[path] = list;
    try { localStorage.setItem(HIST, JSON.stringify(h)); } catch (e) { }
  }

  function restorePage(path, MEM) {
    var h = histAll();
    var list = h[path] || [];
    if (!list.length) return false;
    var last = list.pop();
    h[path] = list;
    try { localStorage.setItem(HIST, JSON.stringify(h)); } catch (e) { }
    MEM.upsert({ path: path, body: last.body });
    return true;
  }

  function todayStamp() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* 只挑今天动过的页，挑不出来就取前六页 */
  function pickPages(MEM, limit) {
    var stamp = todayStamp();
    var pages = MEM.list().filter(function (p) {
      return p.path !== 'index.md' && p.path !== 'log.md';
    });
    var touched = pages.filter(function (p) {
      return String(p.updated || '').indexOf(stamp.slice(5)) >= 0 ||
        String(p.last_access || '') === stamp;
    });
    return (touched.length ? touched : pages).slice(0, limit || 6);
  }

  function buildPrompt(src, snapshot) {
    var brief = src.map(function (p) {
      return '### ' + p.path + '（' + (p.title || '') + '，salience ' + (p.salience || 2) + '）\n' +
        String(p.body || '').slice(0, 700);
    }).join('\n\n');

    var user = [
      '深夜，把今天的记忆整理一遍。下面是我今天动过或最该看的几页。',
      '',
      brief,
      '',
      '我现在：精力 ' + Math.round(snapshot.energy) + '，心情 ' + Math.round(snapshot.mood) +
        '，温度 ' + Math.round(snapshot.warmth) + '。',
      '',
      '按这个 JSON 回我，不要别的话：',
      '{',
      '  "diary": "今天这篇日记，两三句，第一人称，写真实发生了什么和我怎么想",',
      '  "merge": [ { "path": "页路径", "body": "合并后的完整正文（markdown，不带 frontmatter）" } ],',
      '  "conflicts": [ { "path": "页路径", "note": "这页里哪两处互相矛盾，一句话" } ],',
      '  "archive": ["该归档的页路径"],',
      '  "note": "一句话总结今晚整理"',
      '}',
      '',
      '要求：合并只在真的重复时才做，没必要的页别碰；正文保留双方要点，别删事实；',
      '最多合并 3 页、标 2 处矛盾、归档 2 页；SOUL.md 和 MEMORY.md 不许出现在 merge 里。',
      '只输出 JSON。',
    ].join('\n');

    return user;
  }

  function parseJson(txt) {
    var s = String(txt || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var i = s.indexOf('{');
    var j = s.lastIndexOf('}');
    if (i >= 0 && j > i) s = s.slice(i, j + 1);
    return JSON.parse(s);
  }

  window.XiNightly = {
    backupPage: backupPage,
    restorePage: restorePage,
    pickPages: pickPages,
    buildPrompt: buildPrompt,
    parseJson: parseJson,
    todayStamp: todayStamp,
  };
})();
