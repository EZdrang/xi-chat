"""用「深海女仆工坊」的 Q 版鲸鱼娘头（托腮）做 App 图标 + 聊天头像。"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "app", "res")
ASSETS = os.path.join(ROOT, "app", "assets")

# 「深海女仆工坊」皮肤包（素材生成用）。可用 SKIN_DIR 覆盖：
#   SKIN_DIR=~/.dsh/profiles/desktop/node_modules/@smalltailqwq/dsh-client-ui-skin-maid-atelier
SKIN = os.environ.get("SKIN_DIR") or os.path.join(
    os.path.expanduser("~"), ".dsh", "profiles", "desktop", "node_modules",
    "@smalltailqwq", "dsh-client-ui-skin-maid-atelier")
SRC = os.path.join(SKIN, "assets", "icons", "delighted.ico")

SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
S = 4

HEAD = Image.open(SRC).convert("RGBA")


def trim(im):
    """按 alpha 裁掉空白"""
    bbox = im.split()[3].getbbox()
    return im.crop(bbox) if bbox else im


HEAD_T = trim(HEAD)


def render(size_px):
    n = size_px * S
    # 冰蓝宫殿底
    bg = Image.new("RGB", (n, n), (247, 251, 255))
    d = ImageDraw.Draw(bg)
    for y in range(n):
        t = y / n
        c = (int(243 - 12 * t), int(249 - 8 * t), 255)
        d.line([(0, y), (n, y)], fill=c)

    # 顶部柔光
    glow = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([n * 0.05, -n * 0.35, n * 0.95, n * 0.5],
                                 fill=(255, 255, 255, 235))
    glow = glow.filter(ImageFilter.GaussianBlur(n * 0.12))
    img = Image.alpha_composite(bg.convert("RGBA"), glow)

    # 头像主体（占 84%）
    target = int(n * 0.84)
    w, h = HEAD_T.size
    s = min(target / w, target / h)
    head = HEAD_T.resize((int(w * s), int(h * s)), Image.LANCZOS)
    img.alpha_composite(head, ((n - head.width) // 2, int(n * 0.09)))

    # 金线内框
    ring = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    pad = int(n * 0.055)
    ImageDraw.Draw(ring).rounded_rectangle(
        [pad, pad, n - pad, n - pad], radius=int(n * 0.19),
        outline=(197, 164, 104, 120), width=max(2, int(n * 0.007)))
    img = Image.alpha_composite(img, ring)

    # 外圆角
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, n - 1, n - 1], radius=int(n * 0.225), fill=255)
    img.putalpha(mask)

    return img.resize((size_px, size_px), Image.LANCZOS)


for dpi, px in SIZES.items():
    folder = os.path.join(OUT, "mipmap-" + dpi)
    os.makedirs(folder, exist_ok=True)
    render(px).save(os.path.join(folder, "ic_launcher.png"))
    print("wrote", folder)

render(512).save(os.path.join(ROOT, "icon-preview.png"))

# 聊天头像：透明底的大头
av = HEAD_T.resize((256, 256), Image.LANCZOS)
av.save(os.path.join(ASSETS, "avatar.png"))
print("avatar.png ok", av.size)
