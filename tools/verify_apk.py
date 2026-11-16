import zipfile
import sys

apk = sys.argv[1]
z = zipfile.ZipFile(apk)
names = z.namelist()
app = z.read("assets/app.js").decode("utf-8")
mem = z.read("assets/memory.js").decode("utf-8")
html = z.read("assets/index.html").decode("utf-8")

checks = {
    "流式 md 节点常驻": ("(shown ? '<div class=\"md\">'" not in app)
                         and ("'<div class=\"md\">' + md" in app),
    "聊天内装技能": "xi-skill" in app and "xi-skill" in mem,
    "附件/图片": "image_url" in app and "img-grid" in app,
    "AI 语音": "audio/transcriptions" in app,
    "用量/命中率": "prompt_cache_hit_tokens" in app and "ctxUsage" in html,
    "三方合并": "merge3" in mem,
    "压缩": "maybeCompress" in app,
    "classes.dex": "classes.dex" in names,
}
for k, v in checks.items():
    print(("✓ " if v else "✗ ") + k)
print("\nassets:", [n for n in names if n.startswith("assets/")])
