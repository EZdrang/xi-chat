/* 轻量 markdown 渲染器（无依赖，为聊天优化） */
(function () {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ESC[c]; }); }

  function inline(raw) {
    var s = esc(raw);
    var codes = [];
    // 行内代码先抽出来，避免被后续规则破坏
    s = s.replace(/`([^`\n]+)`/g, function (m, c) {
      codes.push(c);
      return '\u0001' + (codes.length - 1) + '\u0001';
    });
    // 链接
    s = s.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, function (m, t, u) {
      return '<a href="' + u + '" target="_blank" rel="noreferrer">' + (t || u) + '</a>';
    });
    // 裸链
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, function (m, p, u) {
      return p + '<a href="' + u + '" target="_blank" rel="noreferrer">' + u + '</a>';
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/\u0001(\d+)\u0001/g, function (m, i) {
      return '<code>' + esc(codes[+i]) + '</code>';
    });
    return s;
  }

  var RE_LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
  var RE_HEAD = /^(#{1,6})\s+(.*)$/;
  var RE_HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
  var RE_FENCE = /^\s*```(\S*)\s*$/;

  function isBlockStart(line) {
    return RE_FENCE.test(line) || RE_HEAD.test(line) || RE_LIST.test(line) ||
      /^\s*>/.test(line) || RE_HR.test(line);
  }

  function parseList(lines, i) {
    var items = [];
    while (i < lines.length) {
      var m = lines[i].match(RE_LIST);
      if (!m) break;
      var indent = m[1].replace(/\t/g, '  ').length;
      items.push({ indent: indent, ordered: /\d/.test(m[2]), text: m[3].trim() });
      i++;
      // 续行：非空且不是新的块
      while (i < lines.length && lines[i].trim() && !RE_LIST.test(lines[i]) && !isBlockStart(lines[i])) {
        items[items.length - 1].text += ' ' + lines[i].trim();
        i++;
      }
    }

    var root = {
      indent: items.length ? items[0].indent : 0,
      ordered: items.length ? items[0].ordered : false,
      items: [],
    };
    var stack = [root];
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) stack.pop();
      var top = stack[stack.length - 1];
      if (it.indent > top.indent) {
        var sub = { indent: it.indent, ordered: it.ordered, items: [] };
        var last = top.items[top.items.length - 1];
        if (last) {
          last.sub = sub;
          stack.push(sub);
          top = sub;
        }
      }
      top.items.push({ text: it.text, sub: null });
    }
    return [renderList(root), i];
  }

  function renderList(node) {
    if (!node.items.length) return '';
    var tag = node.ordered ? 'ol' : 'ul';
    var out = '<' + tag + '>';
    for (var i = 0; i < node.items.length; i++) {
      var it = node.items[i];
      out += '<li>' + inline(it.text) + (it.sub ? renderList(it.sub) : '') + '</li>';
    }
    return out + '</' + tag + '>';
  }

  function render(src) {
    if (!src) return '';
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      // 代码块
      var fm = line.match(RE_FENCE);
      if (fm) {
        var lang = fm[1] || '';
        var buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // 跳过结束 fence
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code>' +
          (lang ? '<span class="lang">' + esc(lang) + '</span>' : '') + '</pre>');
        continue;
      }

      // 标题
      var hm = line.match(RE_HEAD);
      if (hm) {
        var lv = Math.min(hm[1].length, 4);
        out.push('<h' + lv + '>' + inline(hm[2]) + '</h' + lv + '>');
        i++;
        continue;
      }

      // 分隔线
      if (RE_HR.test(line)) { out.push('<hr>'); i++; continue; }

      // 引用
      if (/^\s*>/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          q.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + render(q.join('\n')) + '</blockquote>');
        continue;
      }

      // 表格
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
        var head = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        var t = '<table><thead><tr>';
        for (var h = 0; h < head.length; h++) t += '<th>' + inline(head[h]) + '</th>';
        t += '</tr></thead><tbody>';
        for (var r = 0; r < rows.length; r++) {
          t += '<tr>';
          for (var c = 0; c < head.length; c++) t += '<td>' + inline(rows[r][c] || '') + '</td>';
          t += '</tr>';
        }
        out.push(t + '</tbody></table>');
        continue;
      }

      // 列表
      if (RE_LIST.test(line)) {
        var res = parseList(lines, i);
        out.push(res[0]);
        i = res[1];
        continue;
      }

      // 段落
      var para = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      if (para.length) out.push('<p>' + inline(para.join('\n')).replace(/\n/g, '<br>') + '</p>');
    }

    return out.join('');
  }

  function splitRow(line) {
    var s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return s.split('|').map(function (x) { return x.trim(); });
  }

  window.MD = { render: render, inline: inline, esc: esc };
})();
