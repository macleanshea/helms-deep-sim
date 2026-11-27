#!/usr/bin/env python3
"""Shrink a model's colour texture to the size the game ships and write it as WebP.

    python3 tools/assets/texture.py <image in> <webp out> <size> [swatches [colours]]

Called by tools/assets/build.js. Needs Pillow.
"""
import sys
from PIL import Image

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
