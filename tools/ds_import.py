"""把 DeepSeek 官方导出的 chat_sessions 转成「汐」能导入的对话包。

用法：
  python tools/ds_import.py <导出的 zip> [--out dist/xxx.json] [--min 2]

产出 {app:'xi-chat', type:'sessions', sessions:[{title, createdAt, messages:[{role,content,ts}]}]}
- 只取 REQUEST / RESPONSE 的正文；搜索过程、思考片段丢掉
- 空会话、消息数少于 --min 的跳过
"""
import argparse
import json
import os
import sys
import zipfile
from datetime import datetime


def ts_of(v):
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str):
        try:
            return int(datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:
            return 0
    return 0


def load_sessions(zip_path):
    z = zipfile.ZipFile(zip_path)
    names = [n for n in z.namelist()
             if n.startswith("chat_sessions/") and n.endswith(".json") and "_files/" not in n]
    out = []
    for n in names:
        try:
            j = json.loads(z.read(n).decode("utf-8"))
        except Exception:
            continue
        out.append(j)
    return out


def to_msgs(session):
    msgs = []
    for m in session.get("messages") or []:
        role = (m.get("role") or "").lower()
        if role not in ("user", "assistant"):
            continue
        text = []
        for f in m.get("fragments") or []:
            t = f.get("type")
            if t in ("REQUEST", "RESPONSE") and f.get("content"):
                text.append(f["content"])
        body = "\n\n".join(text).strip()
        if not body:
            continue
        msgs.append({
            "role": role,
            "content": body,
            "ts": m.get("inserted_at") or 0,
        })
    return msgs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zip")
    ap.add_argument("--out", default="")
    ap.add_argument("--min", type=int, default=2, help="少于这么多条消息的会话跳过")
    a = ap.parse_args()

    if not os.path.exists(a.zip):
        sys.exit("找不到文件：" + a.zip)

    raw = load_sessions(a.zip)
    sessions = []
    total_msgs = 0
    for s in raw:
        msgs = to_msgs(s)
        if len(msgs) < a.min:
            continue
        ts = ts_of(s.get("inserted_at"))
        sessions.append({
            "title": (s.get("title") or "未命名").strip()[:40],
            "createdAt": ts,
            "messages": msgs,
        })
        total_msgs += len(msgs)

    sessions.sort(key=lambda x: x.get("createdAt") or 0, reverse=True)

    out = {
        "app": "xi-chat",
        "type": "sessions",
        "version": 1,
        "exportedAt": datetime.now().isoformat(),
        "source": "deepseek-export",
        "sessions": sessions,
    }

    path = a.out or os.path.join("dist", "汐-导入-DeepSeek-%s.json" % datetime.now().strftime("%Y%m%d"))
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    mb = os.path.getsize(path) / 1024 / 1024
    print("原始会话 %d 个 → 保留 %d 个（≥%d 条）" % (len(raw), len(sessions), a.min))
    print("消息 %d 条" % total_msgs)
    print("输出 %s（%.1f MB）" % (path, mb))


if __name__ == "__main__":
    main()
