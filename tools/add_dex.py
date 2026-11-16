#!/usr/bin/env python3
"""把 d8 产出的 classes.dex 塞进 aapt2 生成的基础 APK。"""
import os
import sys
import zipfile

base_apk, dex_dir, out_apk = sys.argv[1], sys.argv[2], sys.argv[3]

dexes = sorted(f for f in os.listdir(dex_dir) if f.endswith(".dex"))
if not dexes:
    sys.exit("no .dex in " + dex_dir)

with zipfile.ZipFile(base_apk, "r") as src, zipfile.ZipFile(out_apk, "w", zipfile.ZIP_DEFLATED) as dst:
    for item in src.infolist():
        if item.filename == "classes.dex":
            continue
        data = src.read(item.filename)
        if item.filename == "resources.arsc":
            # 必须不压缩且 4 字节对齐（zipalign 会处理对齐）
            dst.writestr(zipfile.ZipInfo(item.filename), data, compress_type=zipfile.ZIP_STORED)
        else:
            dst.writestr(item.filename, data, compress_type=zipfile.ZIP_DEFLATED)
    for name in dexes:
        with open(os.path.join(dex_dir, name), "rb") as f:
            dst.writestr(name, f.read(), compress_type=zipfile.ZIP_DEFLATED)

print("packed ->", out_apk, "dexs:", len(dexes))
