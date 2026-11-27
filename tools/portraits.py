#!/usr/bin/env python3
"""Pack the unit paintings (assets/units/<key>.webp) into the small sheet the menus load (assets/units/atlas.webp).

Tile order, tile size and column count come from src/ui/portraits.js. Needs Pillow:  python3 tools/portraits.py
"""
import re
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
js = (root / "src/ui/portraits.js").read_text()
keys = re.findall(r"'([a-z0-9_]+)'", re.search(r"PORTRAIT_KEYS = \[(.*?)\];", js, re.S).group(1))
tile, cols = (int(re.search(rf"{name} = (\d+)", js).group(1)) for name in ("TILE", "COLS"))

sheet = Image.new("RGB", (cols * tile, -(-len(keys) // cols) * tile))
for i, key in enumerate(keys):
    art = Image.open(root / "assets/units" / f"{key}.webp").convert("RGB")
    sheet.paste(art.resize((tile, tile), Image.LANCZOS), ((i % cols) * tile, (i // cols) * tile))
out = root / "assets/units/atlas.webp"
sheet.save(out, "WEBP", quality=90, method=6)
print(f"{out.relative_to(root)}: {len(keys)} tiles, {sheet.width}x{sheet.height}, {out.stat().st_size // 1024} KB")
