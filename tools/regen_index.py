import os
import re

DESK = r"C:\Users\Administrator\.memory"
FALLBACK = {
    "BOOTSTRAP.md": "铸魂清单（已 complete：人格由我起草，元首可否决）。",
    "MEMORY.md": "记忆库 schema 与维护协议：目录、分级、衰减、迁移、工作流。",
}
GROUPS = [("", "元记忆"), ("identity", "identity（自我）"), ("user", "user（关于用户）"),
          ("decisions", "decisions（决策）"), ("projects", "projects（项目）"),
          ("skills", "skills（程序性记忆）"), ("concepts", "concepts（概念）")]


def meta(path):
    text = open(path, encoding="utf-8").read()
    m = re.match(r"^---\r?\n([\s\S]*?)\r?\n---", text)
    d = {}
    if m:
        for line in m.group(1).splitlines():
            kv = re.match(r"^(\w+):\s*(.*)$", line)
            if kv:
                d[kv.group(1)] = kv.group(2).strip()
    return d


pages = []
for root, _, files in os.walk(DESK):
    for fn in files:
        if not fn.endswith(".md"):
            continue
        full = os.path.join(root, fn)
        rel = os.path.relpath(full, DESK).replace("\\", "/")
        if rel in ("index.md", "log.md"):
            continue
        pages.append((rel, meta(full)))

lines = ["# Memory Index", "",
         "> 每页一行：链接 + 一句话摘要 + salience。摘要取自页面 frontmatter 的 summary。", ""]
for folder, title in GROUPS:
    items = [(r, m) for r, m in pages if (r.split("/")[0] if "/" in r else "") == folder]
    if not items:
        continue
    lines.append("## " + title)
    lines.append("")
    for rel, m in sorted(items):
        sal = m.get("salience", "2")
        summ = (m.get("summary") or "").strip() or FALLBACK.get(rel, "") or m.get("title", rel)
        summ = summ.replace("\n", " ")[:90]
        lines.append("- [%s](%s) — %s `salience: %s`" % (m.get("title", rel), rel, summ, sal))
    lines.append("")

open(os.path.join(DESK, "index.md"), "w", encoding="utf-8").write("\n".join(lines))
print("index.md 重建：%d 页" % len(pages))
