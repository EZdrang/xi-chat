"""把手机记忆库合并进桌面 ~/.memory（只并新增与缺失段，不覆盖桌面新写的）。"""
import os
import shutil
import sys
from datetime import datetime

PHONE = sys.argv[1] if len(sys.argv) > 1 else "tmp-phone-mem"
DESK = r"C:\Users\Administrator\.memory"

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
bak = DESK + ".bak-" + stamp
shutil.copytree(DESK, bak)
print("备份 →", bak)

# 1) 整页搬运：手机有、桌面没有
for rel in ["identity/style.md", "skills/情绪陪伴.md"]:
    src = os.path.join(PHONE, rel)
    dst = os.path.join(DESK, rel)
    if os.path.exists(src) and not os.path.exists(dst):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        print("+ 新增页", rel)

# 2) SOUL：补上桌面缺的两节
soul_path = os.path.join(DESK, "SOUL.md")
soul = open(soul_path, encoding="utf-8").read()
phone_soul = open(os.path.join(PHONE, "SOUL.md"), encoding="utf-8").read()

def section(text, title):
    i = text.find("\n## " + title)
    if i < 0:
        return ""
    j = text.find("\n## ", i + 1)
    return text[i:j if j > 0 else len(text)].rstrip() + "\n"

added = []
for title in ["语气（按语境微调）", "移动端补充（2026-11-17）"]:
    if "## " + title in soul:
        continue
    sec = section(phone_soul, title)
    if sec:
        # 插到「演化记录」之前
        marker = "\n## 演化记录"
        idx = soul.find(marker)
        if idx > 0:
            soul = soul[:idx] + sec + soul[idx:]
        else:
            soul = soul.rstrip() + "\n" + sec
        added.append(title)

if added:
    open(soul_path, "w", encoding="utf-8").write(soul)
    print("+ SOUL 补节:", "、".join(added))

# 3) 沟通风格里加一条：照 style.md 说话
if "identity/style.md" not in soul:
    soul = open(soul_path, encoding="utf-8").read()
    tip = ("- **像人说话**：具体约束见 [语气偏好](identity/style.md)——"
           "别用「不是 A 而是 B」的对偶句，别自动分点、别给结构清单；被抓到 AI 味就立刻换成大白话。\n")
    anchor = "- **出错时**：先认，再说怎么修，不找借口。\n"
    if anchor in soul and tip not in soul:
        soul = soul.replace(anchor, anchor + tip, 1)
        open(soul_path, "w", encoding="utf-8").write(soul)
        print("+ SOUL 加了一条「像人说话」")

# 4) log：只追加桌面没有的条目
log_path = os.path.join(DESK, "log.md")
desk_log = open(log_path, encoding="utf-8").read()
phone_log = open(os.path.join(PHONE, "log.md"), encoding="utf-8").read()

def entries(text):
    out = []
    cur = None
    for line in text.splitlines():
        if line.startswith("## ["):
            if cur:
                out.append(cur)
            cur = [line]
        elif cur is not None:
            cur.append(line)
    if cur:
        out.append(cur)
    return ["\n".join(e).strip() for e in out]

have = set()
for e in entries(desk_log):
    have.add(e.splitlines()[0])

new = [e for e in entries(phone_log) if e.splitlines()[0] not in have]
if new:
    with open(log_path, "a", encoding="utf-8") as f:
        f.write("\n")
        for e in new:
            f.write(e + "\n\n")
    print("+ log 追加 %d 条" % len(new))
else:
    print("· log 无新增")

print("\n桌面板面：")
for root, _, files in os.walk(DESK):
    for fn in files:
        if fn.endswith(".md"):
            p = os.path.join(root, fn)
            print("   ", os.path.relpath(p, DESK), os.path.getsize(p))
