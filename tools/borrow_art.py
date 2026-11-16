"""从「深海女仆工坊」皮肤里借素材：立绘降采样成 App 背景，鲸鱼徽章留用。"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIN = os.environ.get("SKIN_DIR") or os.path.join(
    os.path.expanduser("~"), ".dsh", "profiles", "desktop", "node_modules",
    "@smalltailqwq", "dsh-client-ui-skin-maid-atelier")
SRC = os.path.join(SKIN, "assets", "runtime")
OUT = os.path.join(ROOT, "app", "assets")

# 立绘：认真（拿笔记本的那位），1394x2649
MAID = os.path.join(SRC, "98cf9484ee96018b1ddc6d61f30945ce973158002fe31a2be0790e44c6718515.webp")

im = Image.open(MAID).convert("RGBA")
w, h = im.size
new_w = 620
im = im.resize((new_w, round(h * new_w / w)), Image.LANCZOS)
im.save(os.path.join(OUT, "maid.webp"), "WEBP", quality=86, method=6)
print("maid.webp", im.size, round(os.path.getsize(os.path.join(OUT, "maid.webp")) / 1024), "KB")

# 鲸鱼徽章（正方形小图，用于空态）
emblem = None
for f in os.listdir(SRC):
    if not f.endswith((".png", ".webp")):
        continue
    p = os.path.join(SRC, f)
    try:
        im2 = Image.open(p)
    except Exception:
        continue
    if im2.size == (512, 512):
        emblem = p
        break
if emblem:
    e = Image.open(emblem).convert("RGBA")
    e = e.resize((192, 192), Image.LANCZOS)
    e.save(os.path.join(OUT, "emblem.webp"), "WEBP", quality=90, method=6)
    print("emblem.webp from", os.path.basename(emblem)[:12], round(os.path.getsize(os.path.join(OUT, "emblem.webp")) / 1024), "KB")
else:
    print("emblem: 没找到 512x512")
