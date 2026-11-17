"""把手机记忆同步回桌面：她改过的页以手机为准，桌面独有页保留，索引重建。"""
import os
import re
import shutil
import sys
from datetime import datetime

PHONE = "tmp-phone2"
DESK = r"C:\Users\Administrator\.memory"

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
bak = DESK + ".bak-" + stamp
shutil.copytree(DESK, bak)
print("备份 →", bak)

# 1) 整页以手机为准（协议 MEMORY.md 与派生文件除外）
copied, added = [], []
for root, _, files in os.walk(PHONE):
    for fn in files:
        if not fn.endswith(".md"):
            continue
        src = os.path.join(root, fn)
        rel = os.path.relpath(src, PHONE).replace("\\", "/")
        if rel in ("MEMORY.md", "index.md", "log.md"):
            continue
        dst = os.path.join(DESK, rel)
        new = not os.path.exists(dst)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        (added if new else copied).append(rel)

print("覆盖/更新：", "、".join(sorted(copied)) or "（无）")
print("新增：", "、".join(sorted(added)) or "（无）")

# 2) log 取并集（按条目标题去重）
def entries(text):
    out, cur = [], None
    for line in text.splitlines():
        if line.startswith("## ["):
            if cur:
                out.append("\n".join(cur).strip())
            cur = [line]
        elif cur is not None:
            cur.append(line)
    if cur:
        out.append("\n".join(cur).strip())
    return out

desk_log_path = os.path.join(DESK, "log.md")
desk_log = open(desk_log_path, encoding="utf-8").read()
phone_log = open(os.path.join(PHONE, "log.md"), encoding="utf-8").read()
have = {e.splitlines()[0] for e in entries(desk_log)}
new_entries = [e for e in entries(phone_log) if e.splitlines()[0] not in have]
if new_entries:
    with open(desk_log_path, "a", encoding="utf-8") as f:
        f.write("\n")
        for e in new_entries:
            f.write(e + "\n\n")
print("log 新增 %d 条" % len(new_entries))

# 3) 重建 index.md（按目录分组，摘要取 frontmatter summary）
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
        summ = m.get("summary", "").strip() or m.get("title", "")
        lines.append("- [%s](%s) — %s `salience: %s`" % (m.get("title", rel), rel, summ, sal))
    lines.append("")
open(os.path.join(DESK, "index.md"), "w", encoding="utf-8").write("\n".join(lines))
print("index.md 重建：%d 页" % len(pages))
