// Painted unit portraits for the menus. The full-size paintings are assets/units/<key>.webp; the game loads only
// assets/units/atlas.webp, a sheet of small tiles that tools/portraits.py packs from them in the order below.

/** Tile order in the atlas, row by row. Add a unit here, add its painting, then re-run tools/portraits.py. */
export const PORTRAIT_KEYS = [
  'rifle', 'mg', 'marksman', 'grenadier', 'at', 'mortar',
  'howitzer', 'ifv', 'tank', 'cache', 'cmd', 'wire',
  'hedgehog', 'mine', 'claymore', 'uruk', 'archer', 'berserker',
  'warg', 'chief', 'troll', 'ladder', 'ram', 'sapper',
  'catapult', 'tower',
];
const TILE = 128, COLS = 6;

/** Load the atlas. Resolves to { unit key: { img, x, y, size } }, or to {} if it cannot be loaded. */
export function loadPortraits() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(Object.fromEntries(PORTRAIT_KEYS.map((k, i) => [k, { img, x: (i % COLS) * TILE, y: Math.floor(i / COLS) * TILE, size: TILE }])));
    img.onerror = () => resolve({});
    img.src = 'assets/units/atlas.webp';
  });
}
