#!/usr/bin/env python3
"""Shrink a model's colour texture to the size the game ships and write it as WebP.

    python3 tools/assets/texture.py <image in> <webp out> <size> [swatches [colours]]

Called by tools/assets/build.js. Needs Pillow.
"""
import sys
from PIL import Image

src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert("RGB")
if im.size != (size, size):
    im = im.resize((size, size), Image.LANCZOS)
# A strip of plain swatches under the picture, a sixteenth of its height, for the gear the build adds
# (weapons, shields): iron, wood, leather, pale paint. tools/assets/build.js knows the order.
SWATCHES = [(112, 114, 120), (96, 66, 40), (66, 44, 30), (205, 198, 182)]
if len(sys.argv) > 5:  # a recipe's own colours for them: "r,g,b;r,g,b;r,g,b;r,g,b"
    SWATCHES = [tuple(int(v) for v in c.split(",")) for c in sys.argv[5].split(";")]
if len(sys.argv) > 4 and sys.argv[4] == "swatches":
    strip = size // 16
    out = Image.new("RGB", (size, size + strip))
    out.paste(im, (0, 0))
    w = size // len(SWATCHES)
    for k, c in enumerate(SWATCHES):
        out.paste(Image.new("RGB", (w, strip), c), (k * w, size))
    im = out
im.save(dst, "WEBP", quality=84, method=6)
