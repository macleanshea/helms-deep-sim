#!/usr/bin/env python3
"""Make a painted picture into a seamless stone-patina layer for the fortress shader.

    python3 tools/assets/patina.py <image in> <webp out> [size]
    python3 tools/assets/patina.py <image in> install [size]     into assets/game/, named by its contents, and the manifest

The picture is shrunk, made to tile (each edge cross-faded into the far side over a tenth of the width), and
levelled so that its average is mid grey in every channel and its darkest and lightest parts keep within a modest
range: the shader multiplies the built stone by twice its value, so mid grey leaves the stone as it is.
Needs Pillow.
"""
import sys
from PIL import Image, ImageChops, ImageStat

src, dst = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 512
im = Image.open(src).convert("RGB").resize((size, size), Image.LANCZOS)
band = size // 10
# tile: blend a copy shifted by half the size over the seams
def tile(img, horizontal):
    shifted = ImageChops.offset(img, size // 2 if horizontal else 0, 0 if horizontal else size // 2)
    mask = Image.new("L", (size, size), 0)
    px = mask.load()
    for a in range(size):
        d = min(a, size - 1 - a)                      # distance from the seam of the unshifted picture
        v = int(255 * max(0.0, 1 - d / band))
        for b in range(size):
            if horizontal: px[a, b] = v
            else: px[b, a] = v
    return Image.composite(shifted, img, mask)
im = tile(tile(im, True), False)
# level: mean to 128, contrast held to about +-45 round it
mean = ImageStat.Stat(im).mean
bands = []
for k, ch in enumerate(im.split()):
    lo, hi = ch.getextrema()
    spread = max(mean[k] - lo, hi - mean[k], 1)
    gain = min(1.4, 58 / spread)
    bands.append(ch.point(lambda v, m=mean[k], g=gain: max(0, min(255, int(128 + (v - m) * g)))))
im = Image.merge("RGB", bands)
if dst == "install":
    import hashlib, io, json, os, glob
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "game")
    buf = io.BytesIO(); im.save(buf, "WEBP", quality=86, method=6); data = buf.getvalue()
    name = "patina." + hashlib.sha256(data).hexdigest()[:10] + ".webp"
    for old in glob.glob(os.path.join(out, "patina.*.webp")): os.remove(old)
    open(os.path.join(out, name), "wb").write(data)
    mf = os.path.join(out, "manifest.json"); man = json.load(open(mf))
    man.setdefault("textures", {})["patina"] = {"file": name, "bytes": len(data)}
    open(mf, "w").write(json.dumps(man, indent=2) + "\n")
    dst = name
else:
    im.save(dst, "WEBP", quality=86, method=6)
print(dst, im.size, [round(v) for v in ImageStat.Stat(im).mean])
