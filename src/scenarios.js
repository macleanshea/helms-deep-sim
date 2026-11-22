// Formation layout and preset orders of battle.

import { WORLD_W, WORLD_H, T, UNITS, U, DEF, ORC, C, DEFAULT_OPTIONS } from './config.js';
import { KEEP, N_WALL, N_RING } from './map.js';

let nextId = 1;
export function makeGroup(type, count, x, y, ang = Math.PI / 2, w = 0, extra = {}) {
  return { id: nextId++, type, team: UNITS[U[type]].team, count, x, y, ang, w, delay: 0, ...extra };
}

function rnd(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Can a unit of this type stand at x,y?  onWall: true/false to require, null for either. */
export function canPlace(map, def, x, y, onWall = null) {
  if (x < 4 || y < 4 || x > WORLD_W - 4 || y > WORLD_H - 4) return false;
  const c = map.cellOf(x, y);
  if (map.type[c] === T.CLIFF) return false;
  const wall = map.seg[c] >= 0;
  if (def.team === ORC) return !wall;
  if (def.cls !== C.INF) return !wall;
  return onWall === null ? true : wall === onWall;
}

/** Positions for every unit of a group: rows of `spacing` laid along the group's line. */
export function groupPositions(map, g) {
  const def = UNITS[U[g.type]];
  const sp = def.spacing * (g.spread || 1);
  const out = [];
  const onWall = def.team === DEF && def.cls === C.INF ? map.seg[map.cellOf(g.x, g.y)] >= 0 : null;
  const ux = Math.cos(g.ang), uy = Math.sin(g.ang);
  const px = -uy, py = ux;
  const cols = g.w > 0 ? Math.max(1, Math.floor(g.w / sp) + 1) : Math.max(1, Math.ceil(Math.sqrt(g.count * 1.8)));
  const maxRows = Math.ceil(g.count / cols) * 4 + 10;
  const r = rnd(g.id * 7919 + 13);
  const jit = def.team === ORC ? 0.3 : 0.12;
  for (let ri = 0; ri < maxRows && out.length < g.count * 2; ri++) {
    const off = (ri & 1 ? 1 : -1) * Math.ceil(ri / 2);
    for (let c = 0; c < cols && out.length < g.count * 2; c++) {
      const a = (c - (cols - 1) / 2) * sp;
      const x = g.x + ux * a + px * off * sp + (r() - 0.5) * sp * jit;
      const y = g.y + uy * a + py * off * sp + (r() - 0.5) * sp * jit;
      if (canPlace(map, def, x, y, onWall)) out.push(x, y);
    }
  }
  return out;
}

export function groupBounds(g) {
  const def = UNITS[U[g.type]];
  const sp = def.spacing;
  const cols = g.w > 0 ? Math.max(1, Math.floor(g.w / sp) + 1) : Math.max(1, Math.ceil(Math.sqrt(g.count * 1.8)));
  const rows = Math.ceil(g.count / cols);
  return { hw: Math.max(sp, ((cols - 1) * sp) / 2 + sp), hd: Math.max(sp, ((rows - 1) * sp) / 2 + sp) };
}

// ---- helpers for presets -------------------------------------------------
function alongWall(map, type, count, t0, t1) {
  const out = [];
  const segs = Math.max(1, Math.round((t1 - t0) * N_WALL / 3));
  for (let k = 0; k < segs; k++) {
    const a = t0 + ((t1 - t0) * k) / segs, b = t0 + ((t1 - t0) * (k + 1)) / segs;
    const p = map.wallAt((a + b) / 2);
    const n = Math.round((count * (k + 1)) / segs) - Math.round((count * k) / segs);
    if (n > 0) out.push(makeGroup(type, n, p.x, p.y, p.ang, (b - a) * map.wallLen - 2));
  }
  return out;
}
function alongRing(type, count, a0, a1, r = KEEP.r) {
  const out = [];
  const segs = Math.max(1, Math.round(Math.abs(a1 - a0) / 16));
  for (let k = 0; k < segs; k++) {
    const a = ((a0 + ((a1 - a0) * (k + 0.5)) / segs) * Math.PI) / 180;
    const n = Math.round((count * (k + 1)) / segs) - Math.round((count * k) / segs);
    const w = ((Math.abs(a1 - a0) / segs) * Math.PI / 180) * r - 2;
    if (n > 0) out.push(makeGroup(type, n, KEEP.cx + r * Math.cos(a), KEEP.cy + r * Math.sin(a), a + Math.PI / 2, w));
  }
  return out;
}

/**
 * Lay the horde out in successive waves stretching back down the valley.
 * Each wave is a small army of its own and steps off `gap` seconds after the last.
 */
export function horde(total, mix = {}) {
  const m = { uruk: 0.7, archer: 0.2, berserker: 0.06, warg: 0.03, ...mix };
  const waves = mix.waves ?? (total > 12000 ? 4 : total > 5000 ? 3 : total > 1500 ? 2 : 1);
  const gap = mix.gap ?? 60;
  const g = [];
  const V = Math.PI / 2;
  const lanes = [205, 405, 600, 795, 995];
  const W = 132;
  const ladders = mix.ladders ?? Math.max(4, Math.round(total / 170));
  const trolls = mix.trolls ?? Math.round(total / 420);
  const rams = mix.rams ?? Math.max(1, Math.round(total / 3000));
  const sappers = mix.sappers ?? Math.max(2, Math.round(total / 900));
  const cats = mix.catapults ?? Math.round(total / 900);
  const share = (n, w) => Math.round((n * (w + 1)) / waves) - Math.round((n * w) / waves);
  let x = 0;
  for (let w = 0; w < waves; w++) {
    const delay = w * gap;
    const column = (type, cnt, ys = lanes) => {
      if (cnt <= 0) return;
      const sp = UNITS[U[type]].spacing;
      const per = Math.ceil(cnt / ys.length);
      const d = Math.ceil(per / (Math.floor(W / sp) + 1)) * sp;
      x -= d / 2 + 5;
      let left = cnt;
      for (const y of ys) { const c = Math.min(per, left); left -= c; if (c > 0) g.push(makeGroup(type, c, x, y, V, W, { delay })); }
      x -= d / 2 + 5;
    };
    column('berserker', share(Math.round(total * m.berserker), w));
    column('ladder', share(ladders, w));
    const sp = share(sappers, w), rm = share(rams, w);
    if (sp) g.push(makeGroup('sapper', sp, x - 4, 470, V, 60, { delay }));
    if (rm) g.push(makeGroup('ram', rm, x - 8, 770, V, 50, { delay }));
    if (sp || rm) x -= 16;
    const u = share(Math.round(total * m.uruk), w);
    const cols = u > 4500 ? 3 : u > 1200 ? 2 : 1;
    for (let c = 0; c < cols; c++) column('uruk', Math.round((u * (c + 1)) / cols) - Math.round((u * c) / cols));
    column('archer', share(Math.round(total * m.archer), w));
    const wg = share(Math.round(total * m.warg), w);
    if (wg) column('warg', wg, [110, 1090]);
    column('troll', share(trolls, w));
    column('catapult', share(cats, w));
    x -= 14;
  }
  // slide the whole host so its rear rank stands just inside the valley mouth
  const shift = Math.min(900, Math.max(520, 40 - x));
  for (const q of g) q.x += shift;
  return g;
}

function garrison(map, scale = 1) {
  const s = (v) => Math.max(1, Math.round(v * scale));
  const V = Math.PI / 2;
  const g = [];
  // Deeping Wall
  g.push(...alongWall(map, 'rifle', s(380), 0.03, 0.9));
  g.push(...alongWall(map, 'mg', s(24), 0.06, 0.88));
  g.push(...alongWall(map, 'grenadier', s(30), 0.1, 0.85));
  g.push(...alongWall(map, 'marksman', s(16), 0.2, 0.8));
  g.push(...alongWall(map, 'at', s(8), 0.25, 0.75));
  // Hornburg ring, gate side
  g.push(...alongRing('rifle', s(170), -235, -128));
  g.push(...alongRing('mg', s(16), -220, -135));
  g.push(...alongRing('at', s(8), -200, -160));
  g.push(...alongRing('grenadier', s(14), -215, -145));
  // tower
  g.push(makeGroup('marksman', s(12), KEEP.towerX, KEEP.towerY, 0, 0));
  g.push(makeGroup('mg', s(4), KEEP.towerX - 14, KEEP.towerY, V, 12));
  // courtyard
  g.push(makeGroup('mortar', s(8), KEEP.cx - 20, KEEP.cy - 55, 0, 42));
  g.push(makeGroup('cache', 1, KEEP.cx - 72, KEEP.cy + 22));
  g.push(makeGroup('rifle', s(60), KEEP.cx - 62, KEEP.cy, V, 60));
  // the Deep, behind the wall
  g.push(makeGroup('mortar', s(16), 1400, 420, V, 130));
  g.push(makeGroup('howitzer', s(4), 1560, 560, V, 80));
  for (const t of [0.2, 0.5, 0.8]) { const p = map.wallAt(t); g.push(makeGroup('cache', 1, p.x + 20, p.y)); }
  g.push(makeGroup('rifle', s(100), 1345, 480, V, 150));
  return g;
}

export const PRESETS = [
  {
    key: 'garrison', name: 'The Hornburg Garrison',
    blurb: 'A reinforced battalion mans the Deeping Wall against eighteen thousand Uruk-hai.',
    build: (map) => ({
      groups: [...garrison(map, 1), makeGroup('tank', 2, 1420, 500, Math.PI / 2, 40), makeGroup('ifv', 4, 1450, 640, Math.PI / 2, 60), ...horde(18000)],
      options: {},
    }),
  },
  {
    key: 'three-hundred', name: 'Three Hundred Rifles',
    blurb: 'A lone rifle company and eight thousand at the gate. Hold until dawn — air support will decide this.',
    build: (map) => ({
      groups: [
        ...alongWall(map, 'rifle', 170, 0.08, 0.88), ...alongWall(map, 'mg', 10, 0.15, 0.85), ...alongWall(map, 'marksman', 8, 0.3, 0.7),
        ...alongRing('rifle', 70, -225, -135), ...alongRing('mg', 6, -210, -150), ...alongRing('at', 6, -200, -160),
        makeGroup('mortar', 6, 1400, 430, Math.PI / 2, 60), makeGroup('cache', 1, 1335, 480), makeGroup('rifle', 24, KEEP.cx - 60, KEEP.cy, Math.PI / 2, 30),
        ...horde(8000),
      ],
      options: { support: { air: 6, gunship: 3, arty: 8, supply: 6, reinforce: 3 }, dawn: 720 },
    }),
  },
  {
    key: 'combined', name: 'Combined Arms vs. the Host',
    blurb: 'Armour forward of the wall, guns in the Deep, and thirty thousand coming.',
    build: (map) => ({
      groups: [
        ...garrison(map, 1),
        makeGroup('tank', 4, 1150, 330, Math.PI / 2, 120), makeGroup('ifv', 6, 1170, 560, Math.PI / 2, 150),
        makeGroup('tank', 2, 1420, 500, Math.PI / 2, 40), makeGroup('howitzer', 4, 1620, 600, Math.PI / 2, 80),
        makeGroup('mortar', 12, 1440, 560, Math.PI / 2, 100), makeGroup('cache', 1, 1370, 520),
        ...horde(30000),
      ],
      options: { support: { air: 6, gunship: 3, arty: 8, supply: 6, reinforce: 2 } },
    }),
  },
  {
    key: 'recon', name: 'Recon Platoon',
    blurb: 'Forty soldiers, two thousand orcs. A quick skirmish to learn the controls.',
    build: (map) => ({
      groups: [
        ...alongWall(map, 'rifle', 26, 0.35, 0.65), ...alongWall(map, 'mg', 4, 0.4, 0.6), ...alongWall(map, 'marksman', 3, 0.42, 0.58),
        ...alongRing('rifle', 8, -195, -165), makeGroup('mortar', 2, 1390, 470, Math.PI / 2, 12), makeGroup('cache', 1, 1330, 470),
        ...horde(2000, { ladders: 10, trolls: 3, rams: 1, sappers: 3, catapults: 2 }),
      ],
      options: { support: { air: 2, gunship: 1, arty: 3, supply: 3, reinforce: 1 }, dawn: 900 },
    }),
  },
  { key: 'empty', name: 'Blank Map', blurb: 'An empty field. Build both armies from scratch.', build: () => ({ groups: [], options: {} }) },
];

export function buildPreset(map, key) {
  const p = PRESETS.find((q) => q.key === key) || PRESETS[0];
  const s = p.build(map);
  return { groups: s.groups, options: { ...DEFAULT_OPTIONS, ...s.options, support: { ...DEFAULT_OPTIONS.support, ...(s.options.support || {}) } } };
}
