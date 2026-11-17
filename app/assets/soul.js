/* SOUL 改动的门禁：小改自决，大改转提案，每次都要留痕 */
(function () {
  'use strict';

  var CORE = ['## 身份', '## 核心价值观', '## 边界'];
  var MAX_DELTA = 400;   // 字数浮动上限
  var MAX_LINES = 6;     // 行级改动上限

  function lines(text) {
    return String(text || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* 粗略算改了几行：多出来的行 + 少掉的行 */
  function changedLines(a, b) {
    var la = lines(a), lb = lines(b);
    var ca = {}, cb = {};
    la.forEach(function (l) { ca[l] = (ca[l] || 0) + 1; });
    lb.forEach(function (l) { cb[l] = (cb[l] || 0) + 1; });
    var n = 0;
    Object.keys(ca).forEach(function (k) { n += Math.abs((ca[k] || 0) - (cb[k] || 0)); });
    Object.keys(cb).forEach(function (k) { if (!(k in ca)) n += cb[k]; });
    return n;
  }

  /* 返回 { ok:true } 或 { ok:false, why } */
  function check(oldBody, newBody) {
    var nb = String(newBody || '');
    if (nb.length < 200) return { ok: false, why: '太短了，像被清空' };
    for (var i = 0; i < CORE.length; i++) {
      if (nb.indexOf(CORE[i]) < 0) return { ok: false, why: '缺了「' + CORE[i].replace('## ', '') + '」这一节' };
    }
    var delta = Math.abs(nb.length - String(oldBody || '').length);
    if (delta > MAX_DELTA) return { ok: false, why: '改了 ' + delta + ' 字的量，超出小改范围' };
    var n = changedLines(oldBody, nb);
    if (n > MAX_LINES) return { ok: false, why: '动了 ' + n + ' 行，超出小改范围' };
    return { ok: true, lines: n, delta: delta };
  }

  function proposalPage(oldBody, newBody, note, stamp) {
    return {
      path: 'identity/想改人格.md',
      title: '我想改自己（等元首点头）',
      type: 'identity',
      salience: 1,
      summary: stamp + ' 夜里想改 SOUL，被拦下转成提案。',
      body: [
        '## 想改什么',
        '',
        String(note || '（她没写理由）'),
        '',
        '## 我的打算',
        '',
        String(newBody || '').slice(0, 2500),
        '',
        '## 现在的样子',
        '',
        String(oldBody || '').slice(0, 1500),
        '',
        '> 元首看过之后：同意就按上面那版改，不同意就把这页删掉。',
      ].join('\n'),
    };
  }

  window.XiSoul = { check: check, changedLines: changedLines, proposalPage: proposalPage, CORE: CORE };
})();
