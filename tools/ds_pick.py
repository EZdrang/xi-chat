"""按标题关键词筛出会话，并转成 App 能导入的小包。"""
import argparse
import json
import os
import zipfile
from datetime import datetime

ROLE_OK = ("user", "assistant")


def ts_of(v):
    """inserted_at 有时是 ISO 字符串，有时是毫秒数，统一成毫秒。"""
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str):
        try:
            return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:
            return 0
    return 0


def msgs_of(session):
    out = []
    for m in session.get("messages") or []:
        role = (m.get("role") or "").lower()
        if role not in ROLE_OK:
            continue
        text = []
        for f in m.get("fragments") or []:
            if f.get("type") in ("REQUEST", "RESPONSE") and f.get("content"):
                text.append(f["content"])
        body = "\n\n".join(text).strip()
        if body:
            out.append({"role": role, "content": body, "ts": m.get("inserted_at") or 0})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zip")
    ap.add_argument("--match", default="情感,拉扯", help="逗号分隔，标题包含任一即命中")
    ap.add_argument("--min", type=int, default=2)
    ap.add_argument("--merge", action="store_true", help="把命中的会话并成一条")
    ap.add_argument("--title", default="", help="合并后的标题")
    ap.add_argument("--out", default="")
    a = ap.parse_args()

    keys = [k.strip() for k in a.match.split(",") if k.strip()]
    z = zipfile.ZipFile(a.zip)
    names = [n for n in z.namelist()
             if n.startswith("chat_sessions/") and n.endswith(".json") and "_files/" not in n]

    hits = []
    for n in names:
        try:
            j = json.loads(z.read(n).decode("utf-8"))
        except Exception:
            continue
        title = (j.get("title") or "").strip()
        if not any(k in title for k in keys):
            continue
        msgs = msgs_of(j)
        if len(msgs) < a.min:
            continue
        hits.append({
            "title": title[:40] or "未命名",
            "createdAt": ts_of(j.get("inserted_at")),
            "messages": msgs,
            "_chars": sum(len(m["content"]) for m in msgs),
        })

    hits.sort(key=lambda x: x["createdAt"])

    print("命中 %d 个会话：" % len(hits))
    for h in hits:
        print("  · %s  %d 条 / %d 字  （%s）" % (
            h["title"], len(h["messages"]), h["_chars"],
            datetime.fromtimestamp((h["createdAt"] or 0) / 1000).strftime("%Y-%m-%d")))

    if not hits:
        return

    for h in hits:
        h.pop("_chars", None)

    if a.merge and hits:
        merged_msgs = []
        for h in hits:
            merged_msgs.append({
                "role": "note",
                "content": "—— %s（%s，%d 条）——" % (
                    h["title"],
                    datetime.fromtimestamp((h["createdAt"] or 0) / 1000).strftime("%Y-%m-%d"),
                    len(h["messages"])),
                "ts": h["createdAt"],
            })
            merged_msgs.extend(h["messages"])
        title = a.title or " + ".join([h["title"] for h in hits])
        hits = [{
            "title": title[:40],
            "createdAt": hits[0]["createdAt"],
            "messages": merged_msgs,
        }]
        print("\n已合并为 1 条：%s（%d 条消息）" % (title[:40], len(merged_msgs)))

    out = {
        "app": "xi-chat",
        "type": "sessions",
        "version": 1,
        "exportedAt": datetime.now().isoformat(),
        "source": "deepseek-export",
        "sessions": hits,
    }
    path = a.out or os.path.join("dist", "汐-导入-情感-%s.json" % datetime.now().strftime("%Y%m%d"))
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("\n输出 %s（%.2f MB）" % (path, os.path.getsize(path) / 1024 / 1024))


if __name__ == "__main__":
    main()
