/* 心智三件套：
   1) 时间感——哪页多久没想起，越久越容易冒出来
   2) 偏好——不是设定，是聊出来的分数
   3) 事件簿——具体的某天发生过什么，而不是抽象标签 */
(function () {
  'use strict';

  var TOPICS = [
    ['技术', /代码|报错|bug|插件|部署|编译|接口|sqlite|apk|架构/i],
    ['游戏', /LOL|英雄联盟|海斗|上分|排位|游戏|开黑/i],
    ['情感', /喜欢|分手|表白|感情|想她|想他|吵架|拉扯|小徒弟/],
    ['身体', /睡|累|熬夜|头疼|胃|吃|步数|锻炼|失眠/],
    ['工作', /上班|加班|老板|项目|工资|面试|会议/],
    ['八卦', /明星|热搜|瓜|八卦/],
  ];

  var EVENT_HINT = /对不起|我错了|分手|答应|决定|吵|崩|哭|拒绝了|和好了|辞职|表白|约定/;

  function dbAll(sql, args) {
    try {
      var rows = JSON.parse(window.XiNative.dbAll(sql, JSON.stringify(args || [])));
      return Array.isArray(rows) ? rows : [];
    } catch (e) { return []; }
  }

  function dbRun(sql, args) {
    try { return window.XiNative.dbRun(sql, JSON.stringify(args || [])) !== false; } catch (e) { return false; }
  }

  function tagsOf(text) {
    var out = [];
    TOPICS.forEach(function (t) {
      if (t[1].test(String(text || ''))) out.push(t[0]);
    });
    return out;
  }

  function days(n) {
    return Math.max(0, (Date.now() - (n || 0)) / 86400000);
  }

  /* ── 1. 时间感 ── */

  function recallMap() {
    var m = {};
    dbAll('SELECT path,ts,n FROM recall', []).forEach(function (r) {
      m[r.path] = { ts: Number(r.ts) || 0, n: Number(r.n) || 0 };
    });
    return m;
  }

  function markRecall(path) {
    var old = dbAll('SELECT ts,n FROM recall WHERE path=?', [path])[0] || { n: 0 };
    dbRun('INSERT OR REPLACE INTO recall(path,ts,n) VALUES(?,?,?)',
      [path, Date.now(), (Number(old.n) || 0) + 1]);
  }

  /* 挑几页「忽然想起」，返回一句话 */
  function timeLine(userText, MEM) {
    if (!MEM) return '';
    var rec = recallMap();
    var pages = MEM.list().filter(function (p) {
      return p.path !== 'index.md' && p.path !== 'log.md' && p.path !== 'SOUL.md' && p.path !== 'MEMORY.md';
    });

    var scored = pages.map(function (p) {
      var sal = Number(p.salience) || 2;
      // 没有记录过的页，当成「一阵子没想起」而不是从宇宙起源开始算
      var since = rec[p.path] ? days(rec[p.path].ts) : 7;
      var score = (3 - sal) * 1.5 + Math.log(since + 1) * 2.2 + Math.random() * 1.6;
      if (since < 0.2) score -= 4;          // 刚想起过的，先沉下去
      return { p: p, score: score, since: since };
    }).sort(function (a, b) { return b.score - a.score; }).slice(0, 2);

    if (!scored.length) return '';
    return scored.map(function (s) {
      markRecall(s.p.path);
      var when = s.since < 0.1 ? '刚翻过' :
        s.since < 1 ? Math.round(s.since * 24) + ' 小时前' :
          Math.round(s.since) + ' 天前';
      // 久不碰的记忆会发糊，别说得那么肯定
      var fuzzy = s.since > 30 ? '（太久没翻，印象有点糊，别说得太肯定）' : '';
      return '【忽然想起】' + s.p.path + '（上次想起：' + when + '）' + fuzzy + '——' +
        String(s.p.summary || s.p.title || '').slice(0, 60);
    }).join('\n');
  }

  /* ── 2. 偏好 ── */

  function bump(tag, delta) {
    var row = dbAll('SELECT score FROM prefs WHERE tag=?', [tag])[0];
    var score = (row ? Number(row.score) : 0) + delta;
    score = Math.max(-10, Math.min(20, score));
    dbRun('INSERT OR REPLACE INTO prefs(tag,score,last_ts) VALUES(?,?,?)', [tag, score, Date.now()]);
  }

  function observe(userText, aiText) {
    var u = String(userText || '');
    var a = String(aiText || '');
    var tags = tagsOf(u);
    if (!tags.length) return;

    var engaged = a.length > 120 || /[\u{1F600}-\u{1F64F}\u{1F910}-\u{1F92F}]/u.test(a);
    var bored = a.length < 40;
    tags.forEach(function (t) {
      if (engaged) bump(t, 1);
      else if (bored) bump(t, -0.8);
    });
  }

  function prefLine() {
    var rows = dbAll('SELECT tag,score FROM prefs ORDER BY score DESC', []);
    if (rows.length < 2) return '';
    var good = rows.filter(function (r) { return Number(r.score) >= 2; }).slice(0, 2);
    var bad = rows.filter(function (r) { return Number(r.score) <= -1.5; }).slice(-1);
    var bits = [];
    if (good.length) bits.push('最近对「' + good.map(function (r) { return r.tag; }).join('」「') + '」有劲儿');
    if (bad.length) bits.push('对「' + bad[0].tag + '」有点敷衍');
    if (!bits.length) return '';
    return '【你自己的偏好】' + bits.join('，') + '。这是聊出来的，不是设定，允许你表现出来。';
  }

  /* ── 3. 事件簿 ── */

  function captureEvent(userText, aiText) {
    var u = String(userText || '');
    if (!EVENT_HINT.test(u) && u.length < 40) return false;
    if (!EVENT_HINT.test(u)) return false;
    var what = u.replace(/\s+/g, ' ').slice(0, 120);
    var last = dbAll('SELECT what FROM events ORDER BY ts DESC LIMIT 1', [])[0];
    if (last && last.what === what) return false;
    var tags = tagsOf(u + ' ' + String(aiText || ''));
    if (!tags.length) tags = ['情感'];
    dbRun('INSERT INTO events(ts,what,why,how,tags) VALUES(?,?,?,?,?)',
      [Date.now(), what, '', String(aiText || '').replace(/\s+/g, ' ').slice(0, 120), tags.join(',')]);
    return true;
  }

  function addEvents(list) {
    (list || []).slice(0, 5).forEach(function (e) {
      if (!e || !e.what) return;
      dbRun('INSERT INTO events(ts,what,why,how,tags) VALUES(?,?,?,?,?)',
        [Date.now(), String(e.what).slice(0, 160), String(e.why || '').slice(0, 160),
          String(e.how || '').slice(0, 160), String(e.tags || tagsOf(e.what).join(','))]);
    });
  }

  /* 说到类似的事，把旧事翻出来 */
  function eventLine(userText) {
    var tags = tagsOf(userText);
    if (!tags.length) return '';
    var rows = dbAll('SELECT ts,what,how,tags FROM events ORDER BY ts DESC LIMIT 40', []);
    var hit = rows.filter(function (r) {
      return String(r.tags || '').split(',').some(function (t) { return tags.indexOf(t) >= 0; });
    }).slice(0, 2);
    if (!hit.length) return '';
    return hit.map(function (r) {
      var d = days(Number(r.ts));
      var when = d < 1 ? '今天早些时候' : d < 2 ? '昨天' : Math.round(d) + ' 天前';
      return '【翻到旧事】' + when + '：他「' + String(r.what).slice(0, 60) + '」，我「' +
        String(r.how || '（没留下回应）').slice(0, 50) + '」';
    }).join('\n');
  }

  /* ── 4. 口头禅：从她自己的回复里长出来 ── */

  var TICS = ['行吧', '得了', '讲真', '说实话', '说白了', '算了', '其实', '怎么说呢',
    '你猜', '废话', '啧', '哎', '嗯嗯', '好家伙', '离谱', '别急', '至于吗', '讲道理'];

  function observeHabits(aiText) {
    var a = String(aiText || '');
    if (a.length < 10) return;
    var hits = [];
    TICS.forEach(function (w) { if (a.indexOf(w) >= 0) hits.push(w); });
    if (/——/.test(a)) hits.push('破折号');
    if (/……/.test(a)) hits.push('省略号');
    var emo = (a.match(/[\u{1F300}-\u{1FAFF}]/gu) || []);
    emo.forEach(function (e) { hits.push(e); });

    hits.forEach(function (k) {
      var row = dbAll('SELECT n FROM habits WHERE k=?', [k])[0];
      var n = (Number(row && row.n) || 0) + 1;
      dbRun('INSERT OR REPLACE INTO habits(k,n,last_ts) VALUES(?,?,?)', [k, n, Date.now()]);
    });
  }

  function habitLine() {
    var rows = dbAll('SELECT k,n FROM habits WHERE n >= 3 ORDER BY n DESC LIMIT 4', []);
    if (!rows.length) return '';
    var words = rows.map(function (r) { return '「' + r.k + '」' + r.n + ' 次'; });
    return '【你自己的口头禅】' + words.join('、') +
      '。这些是你自己用出来的，接着用就行，别刻意换。';
  }

  window.XiMind = {
    tagsOf: tagsOf, observe: observe, captureEvent: captureEvent, addEvents: addEvents,
    timeLine: timeLine, prefLine: prefLine, eventLine: eventLine,
    observeHabits: observeHabits, habitLine: habitLine,
    recallMap: recallMap, markRecall: markRecall, days: days,
  };
})();
