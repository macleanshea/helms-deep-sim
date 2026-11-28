#!/usr/bin/env python3
"""Shrink a model's colour texture to the size the game ships and write it as WebP.

    python3 tools/assets/texture.py <image in> <webp out> <size> [swatches [colours]]

Called by tools/assets/build.js. Needs Pillow.
"""
import sys
from PIL import Image

# Two more ways to call it, for the levels of detail that are painted afresh (tools/assets/rebake.js):
#   texture.py raw <image in> <rgb out>                      the source picture as bare RGB bytes; prints "width height"
#   texture.py pack <rgb in> <w> <h> <webp out> <x,y,w,h> [colours]   bare RGB bytes to WebP, the swatches set 2 x 2 in that rectangle
if sys.argv[1] == "raw":
    parts = [Image.open(p).convert("RGB") for p in sys.argv[2].split("+")]
    side = min(2048, max(max(one.size) for one in parts))
    parts = [one if one.size == (side, side) else one.resize((side, side), Image.LANCZOS) for one in parts]
    im = Image.new("RGB", (side * len(parts), side))
    for k, one in enumerate(parts):
        im.paste(one, (k * side, 0))
    open(sys.argv[3], "wb").write(im.tobytes())
    print(im.width, im.height)
    sys.exit(0)
if sys.argv[1] == "pack":
    w, h = int(sys.argv[3]), int(sys.argv[4])
    im = Image.frombytes("RGB", (w, h), open(sys.argv[2], "rb").read())
    x, y, rw, rh = (int(v) for v in sys.argv[6].split(","))
    cols = [(112, 114, 120), (96, 66, 40), (66, 44, 30), (205, 198, 182)]
    if len(sys.argv) > 7:
        cols = [tuple(int(v) for v in c.split(",")) for c in sys.argv[7].split(";")]
    for k, c in enumerate(cols):
        im.paste(Image.new("RGB", (rw // 2, rh // 2), c), (x + (k % 2) * (rw // 2), y + (k // 2) * (rh // 2)))
    im.save(sys.argv[5], "WEBP", quality=86, method=6)
    sys.exit(0)

src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
# (several pictures joined by "+" are set side by side, each at the full size: a beast and its rider)
parts = []
for p in src.split("+"):
    one = Image.open(p).convert("RGB")
    parts.append(one if one.size == (size, size) else one.resize((size, size), Image.LANCZOS))
im = parts[0]
if len(parts) > 1:
    im = Image.new("RGB", (size * len(parts), size))
    for k, one in enumerate(parts):
        im.paste(one, (k * size, 0))
# A strip of plain swatches under the picture, a sixteenth of its height, for the gear the build adds
# (weapons, shields): iron, wood, leather, pale paint. tools/assets/build.js knows the order.
SWATCHES = [(112, 114, 120), (96, 66, 40), (66, 44, 30), (205, 198, 182)]
if len(sys.argv) > 5:  # a recipe's own colours for them: "r,g,b;r,g,b;r,g,b;r,g,b"
    SWATCHES = [tuple(int(v) for v in c.split(",")) for c in sys.argv[5].split(";")]
if len(sys.argv) > 4 and sys.argv[4] == "swatches":
    strip = size // 16
    out = Image.new("RGB", (size, size + strip))
    out.paste(im, (0, 0))
    out = Image.new("RGB", (im.width, size + strip))
    out.paste(im, (0, 0))
    w = im.width // len(SWATCHES)
    for k, c in enumerate(SWATCHES):
        out.paste(Image.new("RGB", (w, strip), c), (k * w, size))
    im = out
im.save(dst, "WEBP", quality=84, method=6)
