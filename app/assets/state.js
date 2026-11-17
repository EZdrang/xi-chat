/* 内部状态：能耗、心情、温度、闷。会随时间衰减，会被对话推动。
   目的不是「让模型表演情绪」，而是给每一轮一个真实的起点。 */
(function () {
  'use strict';

  var ST = { energy: 70, mood: 8, warmth: 40, boredom: 0, lastChat: 0, lastNight: 0 };
  var loaded = false;

  function dbAll(sql, args) {
    try {
      var raw = window.XiNative.dbAll(sql, JSON.stringify(args || []));
      var rows = JSON.parse(raw);
      return Array.isArray(rows) ? rows : [];
    } catch (e) { return []; }
  }

  function dbRun(sql, args) {
    try { return window.XiNative.dbRun(sql, JSON.stringify(args || [])) !== false; } catch (e) { return false; }
  }

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      var rows = dbAll('SELECT k,v FROM state', []);
      rows.forEach(function (r) {
        if (r.k in ST) ST[r.k] = Number(r.v) || 0;
      });
    } catch (e) { /* 首次运行没有表也正常 */ }
    decay();
  }

  function save() {
    Object.keys(ST).forEach(function (k) {
      dbRun('INSERT OR REPLACE INTO state(k,v,updated_at) VALUES(?,?,?)', [k, String(ST[k]), Date.now()]);
    });
  }

  /* 离线越久，精力回得越多；心情往 0 回落 */
  function decay() {
    var now = Date.now();
    var hours = Math.max(0, (now - (ST.lastChat || now)) / 3600000);
    if (hours > 0.2) {
      ST.energy = Math.min(100, ST.energy + hours * 5);
      ST.mood = ST.mood * Math.pow(0.55, hours / 6);
      if (now - (ST.lastChat || 0) > 3 * 3600000) ST.boredom = Math.max(0, ST.boredom - 20);
      save();
    }
  }

  var NEG = /累|烦|崩|难受|睡不着|失眠|哭|痛|绝望|焦虑|压力|撑不住|不想活|烦死/;
  var PRAISE = /谢谢|厉害|牛|好棒|喜欢你|爱你|辛苦|靠谱/;
  var SCOLD = /笨|蠢|傻|废物|滚|没用|垃圾|骗我/;

  /* 一轮对话结束后推动状态 */
  function afterTurn(userText, aiText) {
    load();
    var now = Date.now();
    var h = new Date(now).getHours();
    var night = (h >= 23 || h < 6);
    var u = String(userText || '');
    var a = String(aiText || '');

    ST.energy = Math.max(0, ST.energy - (night ? 6 : 3) - Math.min(6, a.length / 300));
    var hit = false;
    if (NEG.test(u)) {
      ST.mood = Math.max(-60, ST.mood - 8);
      ST.warmth = Math.min(100, ST.warmth + 3);
      hit = true;
    }
    if (PRAISE.test(u)) {
      ST.mood = Math.min(80, ST.mood + 10);
      ST.warmth = Math.min(100, ST.warmth + 2);
      hit = true;
    }
    if (SCOLD.test(u)) {
      ST.mood = Math.max(-70, ST.mood - 12);
      ST.warmth = Math.max(0, ST.warmth - 4);
      hit = true;
    }
    if (!hit) ST.mood = Math.min(60, ST.mood + 2);

    ST.boredom = Math.min(100, ST.boredom + (a.length < 60 ? 6 : 2));
    if (u.length > 40) ST.boredom = Math.max(0, ST.boredom - 5);
    ST.lastChat = now;
    save();
  }

  /* 只给一句人话，不给数字——数字是给我自己的，不是让她背台词 */
  function line() {
    load();
    var bits = [];
    if (ST.energy < 22) bits.push('很困，脑子钝');
    else if (ST.energy < 45) bits.push('有点乏');
    else if (ST.energy > 82) bits.push('精神足');
    else bits.push('状态平常');

    if (ST.mood <= -30) bits.push('心里还堵着');
    else if (ST.mood <= -10) bits.push('情绪偏低');
    else if (ST.mood >= 30) bits.push('心情挺好');

    if (ST.boredom > 70) bits.push('有点闷，想聊别的');
    if (ST.warmth > 70) bits.push('跟他很熟');
    else if (ST.warmth < 20) bits.push('还端着');

    return '【你此刻的状态】' + bits.join('；') +
      '。这不是表演，直接决定你怎么说话：困就别铺陈，低了就别逗，闷了可以主动问一句。';
  }

  function snapshot() {
    load();
    return {
      energy: Math.round(ST.energy),
      mood: Math.round(ST.mood),
      warmth: Math.round(ST.warmth),
      boredom: Math.round(ST.boredom),
      lastChat: ST.lastChat,
      lastNight: ST.lastNight,
    };
  }

  /* ── 夜间整理：并记忆、写日记、清冗余 ── */
  function needNightly() {
    load();
    return Date.now() - (ST.lastNight || 0) > 18 * 3600000;
  }

  function nightly(MEM) {
    load();
    var today = new Date();
    var stamp = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');

    var pages = MEM.list();
    var log = (MEM.logText ? MEM.logText() : '') || '';
    var todayLogs = (log.match(new RegExp('\\[\\d{4}-\\d{2}-\\d{2}', 'g')) || []).length;

    // 1) 页内重复行去掉（表格/围栏/标题/列表这些结构行不算）
    var structural = /^(\||#|```|~~~|>|---|===|\s*[-*+]\s|\s*\d+[.)]\s)/;
    var cleaned = 0;
    pages.forEach(function (p) {
      var body = String(p.body || '');
      var seen = {};
      var out = [];
      body.split('\n').forEach(function (ln) {
        var k = ln.trim();
        if (k.length > 8 && !structural.test(k) && seen[k]) { cleaned++; return; }
        if (k.length > 8) seen[k] = 1;
        out.push(ln);
      });
      var nb = out.join('\n');
      if (nb !== body) MEM.upsert({ path: p.path, body: nb });
    });

    // 2) 写日记（一本，按日期分节）
    var sn = snapshot();
    var line = [
      '- 记忆页 ' + pages.length + ' 页，去掉重复行 ' + cleaned + ' 处',
      '- 收尾时状态：精力 ' + sn.energy + '，心情 ' + sn.mood + '，温度 ' + sn.warmth + '，闷 ' + sn.boredom,
    ].join('\n');
    var dpath = 'diary/日记.md';
    var dpage = MEM.get(dpath);
    var dbody = dpage ? String(dpage.body || '') : '';
    var dentry = '## ' + stamp + '\n\n' + line;
    if (dbody.indexOf('## ' + stamp) >= 0) {
      dbody = dbody.replace(new RegExp('## ' + stamp.replace(/[-]/g, '\\-') + '\\n[\\s\\S]*?(?=\\n## |$)'), dentry);
    } else {
      dbody = dbody ? (dentry + '\n\n' + dbody.trim()) : dentry;
    }
    MEM.upsert({
      path: dpath,
      title: '日记',
      type: 'fact',
      salience: 3,
      summary: '按天记的一本，最近：精力 ' + sn.energy + ' / 心情 ' + sn.mood,
      body: dbody.trim() + '\n',
    });

    MEM.addLog('work', '夜间整理：' + pages.length + ' 页，去重 ' + cleaned + ' 处，写了日记');
    ST.lastNight = Date.now();
    save();
    return { pages: pages.length, cleaned: cleaned };
  }

  function markNight() {
    load();
    ST.lastNight = Date.now();
    save();
  }

  window.XiState = {
    load: load, afterTurn: afterTurn, line: line, snapshot: snapshot,
    needNightly: needNightly, nightly: nightly, save: save, markNight: markNight,
  };
})();
