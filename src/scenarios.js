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

// How the horde's strength is shared out between its waves. Each wave has a character: the
// vanguard is light and fast, the escalade brings ladders and berserkers, the siege train
// brings the engines, and the final assault brings everything that is left. Numbers are
// relative weights per unit type.
export const WAVE_KINDS = {
  probe:    { name: 'Vanguard',      w: { uruk: 0.6, archer: 0.6, berserker: 0.3, warg: 1.5, ladder: 0.3, tower: 0,   troll: 0,   ram: 0,   sapper: 0,   catapult: 0,   chief: 0 } },
  escalade: { name: 'Escalade',      w: { uruk: 1.0, archer: 1.0, berserker: 1.4, warg: 0.5, ladder: 1.6, tower: 1.0, troll: 0.4, ram: 0.3, sapper: 0.5, catapult: 0.5, chief: 1.0 } },
  siege:    { name: 'Siege train',   w: { uruk: 1.0, archer: 1.0, berserker: 0.5, warg: 0.3, ladder: 0.5, tower: 1.0, troll: 1.6, ram: 1.5, sapper: 1.5, catapult: 1.5, chief: 1.0 } },
  assault:  { name: 'Main assault',  w: { uruk: 1.0, archer: 1.0, berserker: 1.0, warg: 0.4, ladder: 1.1, tower: 1.0, troll: 1.0, ram: 0.9, sapper: 1.0, catapult: 1.0, chief: 1.0 } },
  final:    { name: 'Final assault', w: { uruk: 1.4, archer: 1.4, berserker: 1.2, warg: 1.2, ladder: 1.0, tower: 0.6, troll: 1.0, ram: 0.6, sapper: 0.8, catapult: 0.8, chief: 1.2 } },
};
function waveKinds(W) {
  if (W <= 1) return ['final'];
  if (W === 2) return ['assault', 'final'];
  if (W === 3) return ['probe', 'assault', 'final'];
  const out = ['probe'];
  for (let k = 1; k < W - 1; k++) out.push(k & 1 ? 'escalade' : 'siege');
  out.push('final');
  return out;
}

/**
 * Build the horde as a series of waves. Wave 0 is laid out on the field; the others are
 * tagged with their `phase` and held off-map (their x is the distance behind the wave's front
 * rank, so it is negative) until the assault director brings them on.
 *   mix: unit shares and counts, `waves` (how many), `sizes` (relative infantry weight per wave).
 */
export function horde(total, mix = {}) {
  const m = { uruk: 0.7, archer: 0.2, berserker: 0.06, warg: 0.03, ...mix };
  const W = mix.waves ?? (total > 12000 ? 6 : total > 5000 ? 5 : total > 1500 ? 4 : 3);
  const kinds = waveKinds(W);
  const g = [];
  const V = Math.PI / 2;
  const lanes = [140, 276, 412, 548, 684, 820];
  const Wd = 116;
  const n = {
    uruk: Math.round(total * m.uruk), archer: Math.round(total * m.archer), berserker: Math.round(total * m.berserker), warg: Math.round(total * m.warg),
    ladder: mix.ladders ?? Math.max(4, Math.round(total / 170)), troll: mix.trolls ?? Math.round(total / 420), ram: mix.rams ?? Math.max(1, Math.round(total / 3000)),
    sapper: mix.sappers ?? Math.max(2, Math.round(total / 900)), catapult: mix.catapults ?? Math.round(total / 900), chief: mix.chiefs ?? Math.max(1, Math.round(total / 1500)),
    tower: mix.towers ?? Math.round(total / 3600),
  };
  // share each type out over the waves by weight, keeping the totals exact
  const share = {};
  for (const type in n) {
    const w = kinds.map((k, i) => WAVE_KINDS[k].w[type] * ((type === 'uruk' || type === 'archer') && mix.sizes ? mix.sizes[i] / WAVE_KINDS[k].w.uruk : 1));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    let acc = 0, done = 0;
    share[type] = w.map((v) => { acc += (n[type] * v) / sum; const c = Math.round(acc) - done; done += c; return c; });
  }
  const gaps = lanes.slice(0, -1).map((y, k) => (y + lanes[k + 1]) / 2);
  for (let w = 0; w < W; w++) {
    let x = 0;
    const first = g.length;
    // one rank of a wave: `cnt` units of a type spread over the given lanes, all at the same depth
    const column = (type, ys = lanes, wd = Wd) => {
      const cnt = share[type][w];
      if (cnt <= 0) return 0;
      const sp = UNITS[U[type]].spacing;
      const per = Math.ceil(cnt / ys.length);
      const d = Math.ceil(per / (Math.floor(wd / sp) + 1)) * sp;
      let left = cnt;
      for (const y of ys) { const c = Math.min(per, left); left -= c; if (c > 0) g.push(makeGroup(type, c, x - d / 2, y, V, wd, { phase: w, kind: kinds[w], hd: d / 2 })); }
      return d;
    };
    const next = (d) => { if (d > 0) x -= d + 6; };
    next(column('berserker'));
    next(column('ladder'));
    next(column('tower', [lanes[2], lanes[1], lanes[3]], 40));
    next(column('uruk'));
    next(column('archer'));
    // the siege train follows the infantry; the captains drive each wave on from its rear
    next(Math.max(column('troll', [lanes[0], lanes[2], lanes[3], lanes[5]], 60), column('sapper', [443], 36), column('ram', [gaps[3] - 4], 30)));
    next(Math.max(column('catapult', [lanes[0], lanes[2], lanes[3], lanes[5]], 60), column('warg', [lanes[1], lanes[4]], 70), column('chief', [gaps[0], gaps[2], gaps[4]], 20)));
    if (w === 0) {
      // the vanguard stands on the field with its rear rank just inside the valley mouth
      const shift = Math.min(600, Math.max(380, 24 - x));
      for (let k = first; k < g.length; k++) g[k].x += shift;
    }
  }
  return g;
}

const NOTABLE = [['tower', 'siege tower'], ['ram', 'ram'], ['troll', 'troll'], ['catapult', 'catapult'], ['sapper', 'sapper'], ['ladder', 'ladder crew'], ['warg', 'warg rider'], ['berserker', 'berserker']];
/** Per-wave strength and what to expect from it, read off the wave tags on attacker groups. */
export function waveSummary(groups) {
  const waves = [];
  for (const g of groups) {
    if (g.team !== ORC || g.phase == null) continue;
    const w = waves[g.phase] || (waves[g.phase] = { k: g.phase, kind: g.kind, name: (WAVE_KINDS[g.kind] || WAVE_KINDS.assault).name, size: 0, by: {} });
    w.size += g.count * (1 + (UNITS[U[g.type]].carry || 0));
    w.by[g.type] = (w.by[g.type] || 0) + g.count;
  }
  for (let k = 0; k < waves.length; k++) {
    const w = waves[k] || (waves[k] = { k, kind: 'assault', name: WAVE_KINDS.assault.name, size: 0, by: {} });
    w.note = NOTABLE.filter(([t]) => w.by[t]).slice(0, 4).map(([t, nm]) => `${w.by[t]} ${nm}${w.by[t] > 1 ? 's' : ''}`).join(', ');
  }
  return waves;
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
  g.push(...alongRing('rifle', s(150), 152, 268));
  g.push(...alongRing('mg', s(18), 160, 262));
  g.push(...alongRing('at', s(8), 165, 230));
  g.push(...alongRing('grenadier', s(14), 170, 260));
  g.push(...alongRing('marksman', s(8), 160, 240));
  g.push(makeGroup('cmd', 1, KEEP.cx - KEEP.r + 1, KEEP.cy - 6));
  // courtyard
  g.push(makeGroup('mortar', s(8), KEEP.cx - 24, KEEP.cy - 40, 0, 40));
  g.push(makeGroup('cache', 1, KEEP.cx - 44, KEEP.cy - 22));
  g.push(makeGroup('rifle', s(60), KEEP.cx - 46, KEEP.cy - 10, V, 40));
  // the Deep, behind the wall
  g.push(makeGroup('mortar', s(16), 1090, 480, V, 110));
  g.push(makeGroup('howitzer', s(4), 1220, 490, V, 70));
  for (const t of [0.22, 0.5, 0.78]) { const p = map.wallAt(t); g.push(makeGroup('cache', 1, p.x + 26, p.y)); }
  g.push(makeGroup('rifle', s(90), 1030, 460, V, 130));
  return g;
}

export const PRESETS = [
  {
    key: 'garrison', name: 'The Hornburg Garrison',
    blurb: 'A reinforced battalion behind wire and mines, against twenty thousand Uruk-hai in five waves.',
    build: (map, sb) => ({
      groups: [...garrison(map, 1), makeGroup('tank', 2, 1080, 540, Math.PI / 2, 30), makeGroup('ifv', 4, 1100, 400, Math.PI / 2, 50), ...fieldWorks(map), ...horde(20000, { waves: sb ? 1 : 5 })],
      options: { dawn: 1200, cpRate: 0.035 },
    }),
  },
  {
    key: 'three-hundred', name: 'Three Hundred Rifles',
    blurb: 'A lone rifle company and eight thousand at the gate. Hold until dawn — how you spend your support will decide this.',
    build: (map, sb) => ({
      groups: [
        ...alongWall(map, 'rifle', 170, 0.08, 0.88), ...alongWall(map, 'mg', 10, 0.15, 0.85), ...alongWall(map, 'marksman', 8, 0.3, 0.7),
        ...alongRing('rifle', 70, 160, 260), ...alongRing('mg', 6, 170, 250), ...alongRing('at', 6, 170, 220),
        makeGroup('mortar', 6, 1080, 490, Math.PI / 2, 50), makeGroup('cache', 1, map.wallAt(0.5).x + 26, map.wallAt(0.5).y), makeGroup('rifle', 24, KEEP.cx - 46, KEEP.cy - 12, Math.PI / 2, 24),
        makeGroup('cmd', 1, map.wallAt(0.45).x, map.wallAt(0.45).y),
        ...fieldWorks(map, 0.6), ...horde(8000, { waves: sb ? 1 : 4 }),
      ],
      options: { support: { air: 6, gunship: 3, arty: 8, supply: 6, reinforce: 3 }, dawn: 900, cpStart: 8, cpRate: 0.035 },
    }),
  },
  {
    key: 'combined', name: 'Combined Arms vs. the Host',
    blurb: 'Armour forward of the wall, guns in the Deep, and thirty thousand coming in six waves.',
    build: (map, sb) => ({
      groups: [
        ...garrison(map, 1.14),
        makeGroup('tank', 4, 850, 400, Math.PI / 2, 110), makeGroup('ifv', 6, 870, 270, Math.PI / 2, 90),
        makeGroup('tank', 2, 1080, 540, Math.PI / 2, 30), makeGroup('howitzer', 4, 1270, 490, Math.PI / 2, 60),
        makeGroup('mortar', 12, 1130, 440, Math.PI / 2, 90), makeGroup('cache', 1, 1060, 440),
        ...fieldWorks(map, 1.3), ...horde(30000, { waves: sb ? 1 : 6 }),
      ],
      options: { support: { air: 6, gunship: 3, arty: 8, supply: 6, reinforce: 2 }, dawn: 1200, cpStart: 10, cpRate: 0.045 },
    }),
  },
  {
    key: 'recon', name: 'Recon Platoon',
    blurb: 'Forty-odd soldiers and twenty-two hundred orcs in three waves. A short night to learn the controls.',
    build: (map, sb) => ({
      groups: [
        ...alongWall(map, 'rifle', 26, 0.35, 0.65), ...alongWall(map, 'mg', 4, 0.4, 0.6), ...alongWall(map, 'marksman', 3, 0.42, 0.58),
        ...alongRing('rifle', 8, 180, 210), ...alongRing('at', 2, 175, 200), makeGroup('mortar', 2, 1070, 460, Math.PI / 2, 12), makeGroup('cache', 1, map.wallAt(0.5).x + 26, map.wallAt(0.5).y),
        makeGroup('cmd', 1, map.wallAt(0.5).x, map.wallAt(0.5).y),
        ...alongWall(map, 'wire', 40, 0.3, 0.7, 50), ...alongWall(map, 'claymore', 6, 0.4, 0.6, 26),
        ...horde(2200, { waves: sb ? 1 : 3, ladders: 10, trolls: 3, rams: 1, sappers: 2, catapults: 2, chiefs: 2, towers: 1 }),
      ],
      options: { support: { air: 2, gunship: 1, arty: 3, supply: 3, reinforce: 1 }, dawn: 600, cpStart: 10, cpRate: 0.045 },
    }),
  },
  { key: 'empty', name: 'Blank Map', blurb: 'An empty field. Build both armies from scratch.', build: () => ({ groups: [], options: {} }) },
];

/** Requisition cost of the defending side of a setup. */
export function forceCost(groups) {
  let c = 0;
  for (const g of groups) if (g.team === DEF) c += (UNITS[U[g.type]].cost || 0) * g.count;
  return c;
}

/**
 * A preset as a setup: { groups, options, budget }. In a challenge the budget is exactly the cost
 * of the garrison as issued: the stock layout spends all of it, and anything trimmed is saved.
 * In the sandbox (`sandbox`, or a blank map) the whole horde stands on the field from the start,
 * and the win conditions start at SANDBOX_OPTIONS (no relief; the horde gives up when only a
 * remnant is left) for the player to change.
 */
export function buildPreset(map, key, sandbox = false) {
  const p = PRESETS.find((q) => q.key === key) || PRESETS[0];
  nextId = 1; // formation jitter is seeded by group id: a preset must lay out the same way every time it is loaded
  const s = p.build(map, sandbox);
  const options = { ...DEFAULT_OPTIONS, ...s.options, support: { ...DEFAULT_OPTIONS.support, ...(s.options.support || {}) } };
  if (sandbox || !s.groups.length) Object.assign(options, SANDBOX_OPTIONS);
  return { groups: s.groups, options, budget: forceCost(s.groups) };
}

/** Where a sandbox's win conditions start: no relief column, and the horde gives up at 1% of its strength. */
export const SANDBOX_OPTIONS = { sandbox: true, dawn: 0, rout: 0.01 };
