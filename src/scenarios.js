// Formation layout and preset orders of battle.

import { WORLD_W, WORLD_H, T, UNITS, U, DEF, ORC, C, DEFAULT_OPTIONS } from './config.js';
import { KEEP, N_WALL } from './map.js';

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
  const c = map.cellOf(x, y), t = map.type[c];
  if (t === T.CLIFF || t === T.STAIR || t === T.DOOR) return false;
  const wall = map.seg[c] >= 0;
  if (def.team === ORC) return !wall && t !== T.COURT;
  if (def.cls === C.OBST) return !wall && t !== T.COURT;
  if (def.cls !== C.INF) return !wall;
  return onWall === null ? true : wall === onWall;
}

const colsFor = (g, sp) => (g.w > 0 ? Math.max(1, Math.floor(g.w / sp) + 1) : Math.max(1, Math.ceil(Math.sqrt(g.count * 1.8))));

/** Positions for every unit of a group: rows of `spacing` laid along the group's line. */
export function groupPositions(map, g) {
  const def = UNITS[U[g.type]];
  const sp = def.spacing * (g.spread || 1);
  const out = [];
  const onWall = def.team === DEF && def.cls === C.INF ? map.seg[map.cellOf(g.x, g.y)] >= 0 : null;
  const ux = Math.cos(g.ang), uy = Math.sin(g.ang);
  const px = -uy, py = ux;
  const cols = colsFor(g, sp);
  const maxRows = Math.ceil(g.count / cols) * 4 + 10;
  const r = rnd(g.id * 7919 + 13);
  const jit = def.cls === C.OBST ? (def.ob === 'mine' ? 0.8 : 0) : def.team === ORC ? 0.3 : 0.12;
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
  const sp = UNITS[U[g.type]].spacing;
  const cols = colsFor(g, sp), rows = Math.ceil(g.count / cols);
  return { hw: Math.max(sp, ((cols - 1) * sp) / 2 + sp), hd: Math.max(sp, ((rows - 1) * sp) / 2 + sp) };
}

// ---- helpers for presets -------------------------------------------------
function alongWall(map, type, count, t0, t1, off = 0) {
  const out = [];
  const segs = Math.max(1, Math.round((t1 - t0) * N_WALL / 3));
  for (let k = 0; k < segs; k++) {
    const a = t0 + ((t1 - t0) * k) / segs, b = t0 + ((t1 - t0) * (k + 1)) / segs;
    const p = map.wallAt((a + b) / 2);
    const n = Math.round((count * (k + 1)) / segs) - Math.round((count * k) / segs);
    // `off` shifts the line west of the wall (toward the attackers)
    let nx = p.ty, ny = -p.tx; if (nx > 0) { nx = -nx; ny = -ny; }
    if (n > 0) out.push(makeGroup(type, n, p.x + nx * off, p.y + ny * off, p.ang, (b - a) * map.wallLen - 2));
  }
  return out;
}
function alongRing(type, count, a0, a1, r = KEEP.r) {
  const out = [];
  const segs = Math.max(1, Math.round(Math.abs(a1 - a0) / 14));
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
  const lanes = [140, 276, 412, 548, 684, 820];
  const Wd = 116;
  const ladders = mix.ladders ?? Math.max(4, Math.round(total / 170));
  const trolls = mix.trolls ?? Math.round(total / 420);
  const rams = mix.rams ?? Math.max(1, Math.round(total / 3000));
  const sappers = mix.sappers ?? Math.max(2, Math.round(total / 900));
  const cats = mix.catapults ?? Math.round(total / 900);
  const chiefs = mix.chiefs ?? Math.max(1, Math.round(total / 1500));
  const towers = mix.towers ?? Math.round(total / 3600);
  const share = (n, w) => Math.round((n * (w + 1)) / waves) - Math.round((n * w) / waves);
  let x = 0;
  const gaps = lanes.slice(0, -1).map((y, k) => (y + lanes[k + 1]) / 2);
  for (let w = 0; w < waves; w++) {
    const delay = w * gap;
    // one rank of a wave: `cnt` units of a type spread over the given lanes, all at the same depth
    const column = (type, cnt, ys = lanes, wd = Wd) => {
      if (cnt <= 0) return 0;
      const sp = UNITS[U[type]].spacing;
      const per = Math.ceil(cnt / ys.length);
      const d = Math.ceil(per / (Math.floor(wd / sp) + 1)) * sp;
      let left = cnt;
      for (const y of ys) { const c = Math.min(per, left); left -= c; if (c > 0) g.push(makeGroup(type, c, x - d / 2, y, V, wd, { delay })); }
      return d;
    };
    const next = (d) => { if (d > 0) x -= d + 6; };
    next(column('berserker', share(Math.round(total * m.berserker), w)));
    next(column('ladder', share(ladders, w)));
    next(column('tower', share(towers, w), [lanes[3], lanes[4], lanes[2]], 40));
    next(column('uruk', share(Math.round(total * m.uruk), w)));
    next(column('archer', share(Math.round(total * m.archer), w)));
    // the siege train and the captains bring up the rear of each wave
    const sp = share(sappers, w), rm = share(rams, w);
    const d1 = Math.max(
      column('troll', share(trolls, w), [lanes[0], lanes[2], lanes[3], lanes[5]], 60),
      column('chief', share(chiefs, w), [gaps[0], gaps[2], gaps[4]], 20),
      sp ? column('sapper', sp, [517], 36) : 0,
      rm ? column('ram', rm, [gaps[1] + 4], 30) : 0);
    next(d1);
    next(Math.max(column('catapult', share(cats, w), [lanes[0], lanes[2], lanes[3], lanes[5]], 60), column('warg', share(Math.round(total * m.warg), w), [lanes[1], lanes[4]], 70)));
    x -= 22;
  }
  // slide the whole host so its rear rank stands just inside the valley mouth
  const shift = Math.min(600, Math.max(380, 24 - x));
  for (const q of g) q.x += shift;
  return g;
}

/** A belt of field works in front of the Deeping Wall. */
function fieldWorks(map, scale = 1) {
  const g = [];
  g.push(...alongWall(map, 'wire', Math.round(110 * scale), 0.12, 0.9, 62));
  g.push(...alongWall(map, 'mine', Math.round(90 * scale), 0.25, 0.8, 92));
  g.push(...alongWall(map, 'claymore', Math.round(10 * scale), 0.38, 0.62, 30));
  g.push(...alongWall(map, 'hedgehog', Math.round(34 * scale), 0.62, 0.9, 40));
  return g;
}

function garrison(map, scale = 1) {
  const s = (v) => Math.max(1, Math.round(v * scale));
  const V = Math.PI / 2;
  const g = [];
  // Deeping Wall
  g.push(...alongWall(map, 'rifle', s(370), 0.04, 0.9));
  g.push(...alongWall(map, 'mg', s(24), 0.06, 0.88));
  g.push(...alongWall(map, 'grenadier', s(30), 0.1, 0.85));
  g.push(...alongWall(map, 'marksman', s(12), 0.2, 0.8));
  g.push(...alongWall(map, 'at', s(8), 0.25, 0.75));
  const mid = map.wallAt(0.47);
  g.push(makeGroup('cmd', 1, mid.x + 1, mid.y));
  // Hornburg curtain wall, valley side: it enfilades the foot of the Deeping Wall
  g.push(...alongRing('rifle', s(150), 92, 208));
  g.push(...alongRing('mg', s(18), 98, 200));
  g.push(...alongRing('at', s(8), 130, 195));
  g.push(...alongRing('grenadier', s(14), 100, 190));
  g.push(...alongRing('marksman', s(8), 120, 200));
  g.push(makeGroup('cmd', 1, KEEP.cx - KEEP.r + 1, KEEP.cy + 6));
  // courtyard
  g.push(makeGroup('mortar', s(8), KEEP.cx - 22, KEEP.cy + 40, 0, 44));
  g.push(makeGroup('cache', 1, KEEP.cx - 44, KEEP.cy + 22));
  g.push(makeGroup('rifle', s(60), KEEP.cx - 40, KEEP.cy + 4, V, 44));
  // the Deep, behind the wall
  g.push(makeGroup('mortar', s(16), 1090, 480, V, 110));
  g.push(makeGroup('howitzer', s(4), 1220, 470, V, 70));
  for (const t of [0.22, 0.5, 0.78]) { const p = map.wallAt(t); g.push(makeGroup('cache', 1, p.x + 26, p.y)); }
  g.push(makeGroup('rifle', s(90), 1030, 500, V, 130));
  return g;
}

export const PRESETS = [
  {
    key: 'garrison', name: 'The Hornburg Garrison',
    blurb: 'A reinforced battalion behind wire and mines, against eighteen thousand Uruk-hai.',
    build: (map) => ({
      groups: [...garrison(map, 1), makeGroup('tank', 2, 1080, 420, Math.PI / 2, 30), makeGroup('ifv', 4, 1100, 560, Math.PI / 2, 50), ...fieldWorks(map), ...horde(18000)],
      options: {},
    }),
  },
  {
    key: 'three-hundred', name: 'Three Hundred Rifles',
    blurb: 'A lone rifle company and eight thousand at the gate. Hold until dawn — air support will decide this.',
    build: (map) => ({
      groups: [
        ...alongWall(map, 'rifle', 170, 0.08, 0.88), ...alongWall(map, 'mg', 10, 0.15, 0.85), ...alongWall(map, 'marksman', 8, 0.3, 0.7),
        ...alongRing('rifle', 70, 100, 200), ...alongRing('mg', 6, 110, 190), ...alongRing('at', 6, 140, 190),
        makeGroup('mortar', 6, 1080, 470, Math.PI / 2, 50), makeGroup('cache', 1, map.wallAt(0.5).x + 26, map.wallAt(0.5).y), makeGroup('rifle', 24, KEEP.cx - 40, KEEP.cy + 10, Math.PI / 2, 24),
        makeGroup('cmd', 1, map.wallAt(0.45).x, map.wallAt(0.45).y),
        ...fieldWorks(map, 0.6), ...horde(8000),
      ],
      options: { support: { air: 6, gunship: 3, arty: 8, supply: 6, reinforce: 3 }, dawn: 720 },
    }),
  },
  {
    key: 'combined', name: 'Combined Arms vs. the Host',
    blurb: 'Armour forward of the wall, guns in the Deep, and thirty thousand coming.',
    build: (map) => ({
      groups: [
        ...garrison(map, 1.14),
        makeGroup('tank', 4, 850, 560, Math.PI / 2, 110), makeGroup('ifv', 6, 870, 690, Math.PI / 2, 90),
        makeGroup('tank', 2, 1080, 420, Math.PI / 2, 30), makeGroup('howitzer', 4, 1270, 470, Math.PI / 2, 60),
        makeGroup('mortar', 12, 1130, 520, Math.PI / 2, 90), makeGroup('cache', 1, 1060, 520),
        ...fieldWorks(map, 1.3), ...horde(30000),
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
        ...alongRing('rifle', 8, 150, 180), makeGroup('mortar', 2, 1070, 500, Math.PI / 2, 12), makeGroup('cache', 1, map.wallAt(0.5).x + 26, map.wallAt(0.5).y),
        makeGroup('cmd', 1, map.wallAt(0.5).x, map.wallAt(0.5).y),
        ...alongWall(map, 'wire', 40, 0.3, 0.7, 50), ...alongWall(map, 'claymore', 6, 0.4, 0.6, 26),
        ...horde(2000, { ladders: 10, trolls: 3, rams: 1, sappers: 3, catapults: 2, chiefs: 2, towers: 1 }),
      ],
      options: { support: { air: 2, gunship: 1, arty: 3, supply: 3, reinforce: 1 }, dawn: 900 },
    }),
  },
  { key: 'empty', name: 'Blank Map', blurb: 'An empty field. Build both armies from scratch.', build: () => ({ groups: [], options: {} }) },
];

export function buildPreset(map, key) {
  const p = PRESETS.find((q) => q.key === key) || PRESETS[0];
  nextId = 1; // formation jitter is seeded by group id: a preset must lay out the same way every time it is loaded
  const s = p.build(map);
  return { groups: s.groups, options: { ...DEFAULT_OPTIONS, ...s.options, support: { ...DEFAULT_OPTIONS.support, ...(s.options.support || {}) } } };
}
