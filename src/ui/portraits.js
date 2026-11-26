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

/**
 * Start loading the atlas. Resolves to { unit key: { img, x, y, size } }, or to {} if it has not arrived within
 * `timeout` ms or cannot be loaded, in which case the menus fall back to portraits rendered from the 3D models.
 */
export function loadPortraits(timeout = 5000) {
  return new Promise((resolve) => {
    const img = new Image(), giveUp = setTimeout(() => resolve({}), timeout);
    const settle = (out) => { clearTimeout(giveUp); resolve(out); };
    img.onload = () => settle(Object.fromEntries(PORTRAIT_KEYS.map((k, i) => [k, { img, x: (i % COLS) * TILE, y: Math.floor(i / COLS) * TILE, size: TILE }])));
    img.onerror = () => settle({});
    img.src = 'assets/units/atlas.webp';
  });
}
