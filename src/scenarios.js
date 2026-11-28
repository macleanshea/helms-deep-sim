// Formation layout and preset orders of battle.

import { WORLD_W, WORLD_H, T, UNITS, U, DEF, ORC, C, DEFAULT_OPTIONS, WAY_STEP } from './config.js';
import { KEEP, N_WALL, WALL_HALF } from './map.js';
import { LAYOUT } from './layout.js';
import { mulberry } from './rng.js';

// where things stand on this map: the horde's lanes and lines, and the garrison's posts (see src/layout.js)
const AP = LAYOUT.approach, PO = LAYOUT.posts;

let nextId = 1;
export function makeGroup(type, count, x, y, ang = Math.PI / 2, w = 0, extra = {}) {
  return { id: nextId++, type, team: UNITS[U[type]].team, count, x, y, ang, w, delay: 0, ...extra };
}

/** Can a unit of this type stand at x,y?  onWall: true/false to require, null for either. */
export function canPlace(map, def, x, y, onWall = null) {
  if (x < 4 || y < 4 || x > WORLD_W - 4 || y > WORLD_H - 4) return false;
  const c = map.cellOf(x, y), t = map.type[c];
  if (t === T.CLIFF || t === T.STAIR || t === T.DOOR) return false;
  const wall = map.seg[c] >= 0;
  if (def.team === ORC) return !wall && t !== T.COURT;
  if (def.cls === C.OBST) return !wall && t !== T.COURT;
  // (nothing on wheels or tracks climbs the stairs to the inner courts; an ammunition cache is carried up and can stand there)
  if (def.cls !== C.INF) return !wall && (!map.tier[c] || def.key === 'cache');
  return onWall === null ? true : wall === onWall;
}

/**
 * Ground a soldier on foot can walk out of: everything connected to the middle of the valley by
 * steps no steeper than he can take. Shelves high on the valley sides fail it. Cached on the map.
 */
function walkable(map) {
  if (map._walkable) return map._walkable;
  const gw = WORLD_W / 4, gh = WORLD_H / 4, ok = new Uint8Array(gw * gh), q = new Int32Array(gw * gh);
  let h = 0, t = 0;
  const start = map.cellOf(AP.open[0], AP.open[1]);
  ok[start] = 1; q[t++] = start;
  while (h < t) {
    const c = q[h++], cx = c % gw, cy = (c / gw) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if ((!dx && !dy) || x < 0 || y < 0 || x >= gw || y >= gh) continue;
      const n = y * gw + x;
      const dz = Math.abs(map.cz[n] - map.cz[c]);
      if (ok[n] || map.type[n] === T.CLIFF || map.seg[n] >= 0 || dz > 3.3 || ((map.type[n] === T.ROAD) !== (map.type[c] === T.ROAD) && dz > WAY_STEP)) continue;
      ok[n] = 1; q[t++] = n;
    }
  }
  return (map._walkable = ok);
}

/**
 * A point on the middle line of a wall walk: `wall` 0 is the Deeping Wall and `u` runs 0..1 along it; `wall` 1 is the
 * Hornburg's ring and `u` is a bearing in degrees. Returns { x, y, nx, ny } with (nx, ny) pointing outward.
 */
export function wallPoint(map, wall, u) {
  if (wall === 1) { const a = (u * Math.PI) / 180, nx = Math.cos(a), ny = Math.sin(a); return { x: KEEP.cx + KEEP.r * nx, y: KEEP.cy + KEEP.r * ny, nx, ny }; }
  const p = map.wallAt(Math.max(0, Math.min(1, u)));
  let nx = p.ty, ny = -p.tx; if (nx > 0) { nx = -nx; ny = -ny; }
  return { x: p.x, y: p.y, nx, ny };
}
/** How long a stretch of wall walk is, in metres, between two values of `u` (see wallPoint). */
export const wallRunLength = (map, wall, a, b) => (wall === 1 ? (Math.abs(b - a) * Math.PI / 180) * KEEP.r : Math.abs(b - a) * map.wallLen);

/**
 * Where the front rank stands, measured out from a wall walk's centre line at (x, y) along its outward normal: a pace
 * inside the parapet, and where a bastion swells out from the Hornburg's wall there, a pace inside the bastion's own
 * parapet. Men line the battlements as built, not the line the wall would take without its bastions.
 */
export function parapetAt(map, wall, x, y, nx, ny, half) {
  let o = half - 1.0;
  if (wall === 1) for (const b of map.bastions) {
    // the far crossing of the line (x, y) + o n with the bastion's circle
    const dx = x - b.x, dy = y - b.y, r = b.r - 1.1, B = dx * nx + dy * ny, C = dx * dx + dy * dy - r * r, D = B * B - C;
    if (D > 0) { const far = -B + Math.sqrt(D); if (far > o) o = far; }
  }
  return o;
}

/**
 * Places along a stretch of wall walk (`g.run = { wall, a, b }`), following its curve: the front rank at the parapet,
 * spread over the whole stretch, then the ranks behind it as far as the walk is wide.
 */
function runPositions(map, def, g) {
  const { wall, a, b } = g.run, half = wall === 1 ? KEEP.half : WALL_HALF, len = wallRunLength(map, wall, a, b), out = [];
  const st = Math.min(def.spacing * (g.spread || 1), 1.5), cap = Math.max(1, Math.floor(len / st) + 1);
  let left = g.count;
  for (let rank = 0; rank < 14 && left > 0; rank++) {
    const n = Math.min(left, cap);
    let any = false;
    for (let k = 0; k < n; k++) {
      // (a rank that is not full is spread over the whole stretch, not bunched at one end)
      const f = n > 1 ? k / (n - 1) : 0.5, p = wallPoint(map, wall, a + (b - a) * f), o = parapetAt(map, wall, p.x, p.y, p.nx, p.ny, half) - rank * 1.6;
      if (o <= -half + 0.8) continue;
      const x = p.x + p.nx * o, y = p.y + p.ny * o;
      if (canPlace(map, def, x, y, true)) { out.push(x, y); left--; any = true; }
    }
    if (!any) break;
  }
  return out;
}

const colsFor = (g, sp) => (g.w > 0 ? Math.max(1, Math.floor(g.w / sp) + 1) : Math.max(1, Math.ceil(Math.sqrt(g.count * 1.8))));

/**
 * Positions for every unit of a group: rows of `spacing` laid along the group's line.
 * `strict`: attackers are not stood on ground they could never walk off.
 */
/**
 * A belt of wire, or a row of anti-vehicle obstacles: one piece in every 4 m cell the drawn line passes through, and where
 * the line steps across a corner between two cells, one in a cell beside the corner too. Nothing on foot or on wheels
 * can slip between two pieces. (With a width it fills the whole width; without, `count` pieces in a row.)
 */
function obstacleRow(map, def, g) {
  const ux = Math.cos(g.ang), uy = Math.sin(g.ang), L = g.w > 0 ? g.w : Math.max(0, (g.count - 1) * 4);
  const ax = g.x - (ux * L) / 2, ay = g.y - (uy * L) / 2, out = [], seen = new Set();
  const off = (gx, gy) => Math.abs((gx * 4 + 2 - ax) * uy - (gy * 4 + 2 - ay) * ux);
  const put = (gx, gy) => {
    const k = gy * 4096 + gx; if (seen.has(k) || out.length >= g.count * 2) return; seen.add(k);
    // the piece lies on the drawn line where the line crosses its cell, or as near the line as its cell allows
    const cx = gx * 4 + 2, cy = gy * 4 + 2, t = Math.max(0, Math.min(L, (cx - ax) * ux + (cy - ay) * uy));
    const x = Math.max(cx - 1.7, Math.min(cx + 1.7, ax + ux * t)), y = Math.max(cy - 1.7, Math.min(cy + 1.7, ay + uy * t));
    if (canPlace(map, def, x, y, false)) out.push(x, y);
  };
  let pgx = null, pgy = null;
  for (let t = 0; t <= L + 1e-6; t += 0.5) {
    const gx = Math.floor((ax + ux * t) / 4), gy = Math.floor((ay + uy * t) / 4);
    if (pgx !== null && gx !== pgx && gy !== pgy) { if (off(pgx, gy) < off(gx, pgy)) put(pgx, gy); else put(gx, pgy); }
    put(gx, gy); pgx = gx; pgy = gy;
  }
  return out;
}

export function groupPositions(map, g, strict = false) {
  const def = UNITS[U[g.type]];
  if (def.cls === C.OBST && (def.ob === 'wire' || def.ob === 'av')) return obstacleRow(map, def, g);
  if (g.run && def.team === DEF && def.cls === C.INF) return runPositions(map, def, g);
  const sp = def.spacing * (g.spread || 1);
  const out = [];
  // (`g.lv`, when the player has put the group down by hand: the level that was pointed at, { wall, tier })
  const onWall = def.team === DEF && def.cls === C.INF ? (g.lv ? !!g.lv.wall : map.seg[map.cellOf(g.x, g.y)] >= 0) : null;
  // a group stands in one court of the Hornburg: the one it was put in (it does not spill up or down a tier)
  const tier = g.lv ? g.lv.tier : map.tier[map.cellOf(g.x, g.y)], inTier = (x, y) => def.team !== DEF || map.seg[map.cellOf(x, y)] >= 0 || map.tier[map.cellOf(x, y)] === tier;
  const ux = Math.cos(g.ang), uy = Math.sin(g.ang);
  const px = -uy, py = ux;
  const cols = colsFor(g, sp);
  const maxRows = Math.ceil(g.count / cols) * 4 + 10;
  const r = mulberry(g.id * 7919 + 13);
  const jit = def.cls === C.OBST ? (def.ob === 'mine' ? 0.8 : 0) : def.team === ORC ? 0.3 : 0.12;
  const open = strict && def.team === ORC ? walkable(map) : null;
  if (g.parapet && onWall) {
    // along a wall walk, front to back: the first rank kneels at the parapet, the second stands behind it
    const { s, half } = g.parapet, st = Math.min(sp, 1.5), nc = g.w > 0 ? Math.max(1, Math.floor(g.w / st) + 1) : g.count;
    const ring = Math.abs(Math.hypot(g.x - KEEP.cx, g.y - KEEP.cy) - KEEP.r) < KEEP.half + 1 ? 1 : 0;
    for (let rk = 0; rk < 14 && out.length < g.count * 2; rk++) {
      let any = false;
      for (let c = 0; c < nc && out.length < g.count * 2; c++) {
        const a = (c - (nc - 1) / 2) * st + (r() - 0.5) * 0.2, bx = g.x + ux * a, by = g.y + uy * a;
        const o = parapetAt(map, ring, bx, by, px * s, py * s, half) - rk * 1.6;
        if (o <= -half + 0.8) continue;
        const x = bx + px * o * s, y = by + py * o * s;
        if (canPlace(map, def, x, y, true)) { out.push(x, y); any = true; }
      }
      if (!any) break;
    }
    if (out.length >= g.count * 2) return out;
  }
  for (let ri = 0; ri < maxRows && out.length < g.count * 2; ri++) {
    const off = (ri & 1 ? 1 : -1) * Math.ceil(ri / 2);
    for (let c = 0; c < cols && out.length < g.count * 2; c++) {
      const a = (c - (cols - 1) / 2) * sp;
      const x = g.x + ux * a + px * off * sp + (r() - 0.5) * sp * jit;
      const y = g.y + uy * a + py * off * sp + (r() - 0.5) * sp * jit;
      if (canPlace(map, def, x, y, onWall) && inTier(x, y) && !(open && !open[map.cellOf(x, y)])) out.push(x, y);
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
// In the challenges the wall garrisons stand two deep at the parapet
// rather than three deep across the walk. Set by buildPreset; the hidden benchmark does not use it.
let twoDeep = false;

function alongWall(map, type, count, t0, t1, off = 0) {
  const out = [];
  const segs = Math.max(1, Math.round((t1 - t0) * N_WALL / 3));
  for (let k = 0; k < segs; k++) {
    const a = t0 + ((t1 - t0) * k) / segs, b = t0 + ((t1 - t0) * (k + 1)) / segs;
    const p = map.wallAt((a + b) / 2);
    const n = Math.round((count * (k + 1)) / segs) - Math.round((count * k) / segs);
    // `off` shifts the line west of the wall (toward the attackers)
    let nx = p.ty, ny = -p.tx; if (nx > 0) { nx = -nx; ny = -ny; }
    const deep = twoDeep && !off && UNITS[U[type]].cls === C.INF ? { parapet: { s: -Math.sin(p.ang) * nx + Math.cos(p.ang) * ny > 0 ? 1 : -1, half: WALL_HALF } } : {};
    if (n > 0) out.push(makeGroup(type, n, p.x + nx * off, p.y + ny * off, p.ang, (b - a) * map.wallLen - 2, deep));
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
    // (the perpendicular of a group turned a quarter round from its bearing points into the keep: outward is the other way)
    if (n > 0) out.push(makeGroup(type, n, KEEP.cx + r * Math.cos(a), KEEP.cy + r * Math.sin(a), a + Math.PI / 2, w, twoDeep && r === KEEP.r ? { parapet: { s: -1, half: KEEP.half } } : {}));
  }
  return out;
}

// How the horde's strength is shared out between its waves. Each wave has a character: the
// vanguard is light and fast, the escalade brings ladders and berserkers, the siege train
// brings the engines, and the final assault brings everything that is left. Numbers are
// relative weights per unit type.
export const WAVE_KINDS = {
  probe:    { name: 'Vanguard',      w: { uruk: 0.6, archer: 0.6, berserker: 0.3, warg: 1.5, ladder: 0.3, tower: 0,   troll: 0,   ram: 0,   sapper: 0,   catapult: 0,   chief: 0 } },
  escalade: { name: 'Ladder assault', w: { uruk: 1.0, archer: 1.0, berserker: 1.4, warg: 0.5, ladder: 1.6, tower: 1.0, troll: 0.4, ram: 0.3, sapper: 0.5, catapult: 0.5, chief: 1.0 } },
  siege:    { name: 'Siege assault',  w: { uruk: 1.0, archer: 1.0, berserker: 0.5, warg: 0.3, ladder: 0.5, tower: 1.0, troll: 1.6, ram: 1.5, sapper: 1.5, catapult: 1.5, chief: 1.0 } },
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
 *   mix: unit shares and counts, `waves` (how many), `kinds` (the character of each wave, instead of the
 *        usual probe-then-assaults), `sizes` (relative infantry weight per wave). Each wave is drawn
 *        up by task force.
 */
export function horde(total, mix = {}) {
  const m = { uruk: 0.7, archer: 0.2, berserker: 0.06, warg: 0.03, ...mix };
  const W = mix.waves ?? (total > 12000 ? 6 : total > 5000 ? 5 : total > 1500 ? 4 : 3);
  const kinds = mix.kinds && mix.kinds.length === W ? mix.kinds : waveKinds(W);
  const g = [];
  const V = Math.PI / 2;
  const lanes = AP.lanes;
  const Wd = AP.laneWidth;
  const n = {
    uruk: Math.round(total * m.uruk), archer: Math.round(total * m.archer), berserker: Math.round(total * m.berserker), warg: Math.round(total * m.warg),
    ladder: mix.ladders ?? Math.max(4, Math.round(total / 170)), troll: mix.trolls ?? Math.round(total / 420), ram: mix.rams ?? Math.max(1, Math.round(total / 3000)),
    sapper: mix.sappers ?? Math.max(2, Math.round(total / 900)), catapult: mix.catapults ?? Math.round(total / 900),
    // drawn up by task force there is a captain to every lane of every wave that has any
    chief: mix.chiefs ?? Math.max(1, Math.round(total / 800)),
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
    const column = (type, ys = lanes, wd = Wd, part = 0) => {
      // part: 0 the whole of this wave's share, >0 the first `part` of it, <0 what the first part left
      const all = share[type][w], head = Math.round(all * Math.abs(part));
      const cnt = part > 0 ? head : part < 0 ? all - head : all;
      if (cnt <= 0) return 0;
      const sp = UNITS[U[type]].spacing;
      const per = Math.ceil(cnt / ys.length);
      const d = Math.ceil(per / (Math.floor(wd / sp) + 1)) * sp;
      let left = cnt;
      for (const y of ys) { const c = Math.min(per, left); left -= c; if (c > 0) g.push(makeGroup(type, c, x - d / 2, y, V, wd, { phase: w, kind: kinds[w], hd: d / 2 })); }
      return d;
    };
    const next = (d) => { if (d > 0) x -= d + 6; };
    // single figures placed one by one: `at(k)` gives the k-th one's [y, how far behind the rank's front]
    const singles = (type, at) => {
      const cnt = share[type][w];
      let deep = 0;
      for (let k = 0; k < cnt; k++) { const [y, back] = at(k); g.push(makeGroup(type, 1, x - back, y, V, 0, { phase: w, kind: kinds[w], hd: 4 })); if (back + 8 > deep) deep = back + 8; }
      return deep;
    };
    {
      // By task force. The slow engines stand in front, for they step off first, with the trolls that
      // push them close behind; the ladders are carried inside the body of Uruk-hai; the captains are
      // spread across the whole front behind their own companies; sappers stand well apart; and the
      // warg riders wait on the rear flanks for a way in.
      const mid = [lanes[1], lanes[2], lanes[3], lanes[4]];
      next(Math.max(column('tower', [lanes[2], lanes[1], lanes[3]], 40), column('ram', [gaps[3] - 4], 30)));
      next(column('troll', mid, 60));
      next(column('uruk', lanes, Wd, 0.4));
      next(column('ladder'));
      next(column('uruk', lanes, Wd, -0.4));
      const order = [2, 3, 1, 4, 0, 5];
      next(Math.max(column('catapult', mid, 60), singles('chief', (k) => [lanes[order[k % 6]] + ((k / 6) | 0) * 38 - 19 * ((k / 6) | 0 ? 1 : 0), 6 + (k % 3) * 16])));
      next(Math.max(column('archer'), 0));
      next(Math.max(column('berserker'), singles('sapper', (k) => [AP.sapper + (k & 1 ? -1 : 1) * 46 * Math.ceil(k / 2), 6 + (k % 2) * 12])));
      next(column('warg', [lanes[0], lanes[5]], 90));
    }
    if (w === 0) {
      // the vanguard stands on the field with its rear rank just inside the valley mouth
      // (drawn up by task force, the front rank stands back out of reach of the mortars in the Deep)
      const shift = Math.min(AP.vanguard[1], Math.max(AP.vanguard[0], 24 - x));
      for (let k = first; k < g.length; k++) g[k].x += shift;
    }
  }
  return g;
}

const NOTABLE = [['tower', 'siege tower'], ['ram', 'ram'], ['troll', 'troll'], ['catapult', 'catapult'], ['sapper', 'sapper'], ['ladder', 'ladder crew'], ['warg', 'warg rider'], ['berserker', 'berserker']];
/** Per-wave strength and what to expect from it, read off the wave tags on attacker groups. `crews`: count engines as timber, not troops (as the battle does for its head-counts; the director's pacing counts them). */
export function waveSummary(groups, crews = false) {
  const waves = [];
  for (const g of groups) {
    if (g.team !== ORC || g.phase == null) continue;
    const w = waves[g.phase] || (waves[g.phase] = { k: g.phase, kind: g.kind, name: (WAVE_KINDS[g.kind] || WAVE_KINDS.assault).name, size: 0, by: {} });
    w.size += g.count * ((crews && UNITS[U[g.type]].crew ? 0 : 1) + (UNITS[U[g.type]].carry || 0)); // (crews: an engine is timber, not troops)
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
  // (a belt of wire fills whatever stretch it is given, so a thinner garrison's belt is a shorter one: the middle of the wall, its ends open)
  const span = Math.min(0.39, 0.39 * scale);
  g.push(...alongWall(map, 'wire', Math.round(110 * scale), 0.51 - span, 0.51 + span, 62));
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
  g.push(makeGroup('cmd', 1, PO.captain[0], PO.captain[1]));
  // courtyard
  g.push(makeGroup('mortar', s(8), PO.courtMortars[0], PO.courtMortars[1], 0, 40));
  g.push(makeGroup('cache', 1, PO.courtCache[0], PO.courtCache[1]));
  g.push(makeGroup('rifle', s(60), PO.courtRifles[0], PO.courtRifles[1], V, 40));
  // the Deep, behind the wall
  g.push(makeGroup('mortar', s(16), PO.deepMortars[0], PO.deepMortars[1], V, 110));
  g.push(makeGroup('howitzer', s(4), PO.deepHowitzers[0], PO.deepHowitzers[1], V, 70));
  for (const t of [0.22, 0.5, 0.78]) { const p = map.wallAt(t); g.push(makeGroup('cache', 1, p.x + 26, p.y)); }
  g.push(makeGroup('rifle', s(90), PO.deepRifles[0], PO.deepRifles[1], V, 130));
  return g;
}

// The challenges, one to a difficulty. Each is built round the siege rules: a wave big enough to reach the
// wall, a garrison with an answer to every engine if it is used well, and a reserve below the wall that the
// horde cannot see. `level` is how hard it is for a commander who only calls support and never moves a man:
//   easy    he wins nearly every night with more than half the garrison left
//   medium  he wins most nights, with about a third left
//   hard    he wins less than half the time: the player has to do better than that
// (measured with `npm run matrix`; see the README).
export const PRESETS = [
  {
    key: 'first-night', name: 'First Night', level: 'Easy',
    blurb: 'A short night to learn the siege: 3,200 attackers in 3 waves, with ladders, a ram and sappers',
    build: (map, sb) => ({
      groups: [
        ...alongWall(map, 'rifle', 44, 0.3, 0.7), ...alongWall(map, 'mg', 4, 0.36, 0.64), ...alongWall(map, 'marksman', 4, 0.4, 0.6), ...alongWall(map, 'grenadier', 6, 0.34, 0.66),
        ...alongRing('rifle', 10, 175, 215), ...alongRing('at', 3, 175, 205),
        makeGroup('mortar', 3, PO.mortarsEasy[0], PO.mortarsEasy[1], Math.PI / 2, 16), makeGroup('cache', 1, map.wallAt(0.5).x + 26, map.wallAt(0.5).y),
        makeGroup('cmd', 1, map.wallAt(0.5).x, map.wallAt(0.5).y),
        // a platoon kept below the wall: the enemy cannot count it, and it can be sent up wherever the ladders land
        makeGroup('rifle', 16, PO.reserve[0], PO.reserve[1], Math.PI / 2, 30),
        ...alongWall(map, 'wire', 44, 0.28, 0.72, 50), ...alongWall(map, 'claymore', 6, 0.4, 0.6, 26),
        ...horde(3200, { waves: sb ? 1 : 3, kinds: ['escalade', 'assault', 'final'], sizes: sb ? null : [0.8, 1, 1.2], ladders: 12, trolls: 2, rams: 1, sappers: 2, catapults: 1, chiefs: 3, towers: 0 }),
      ],
      options: { dawn: 600, cpStart: 10, cpRate: 3 / 60 },
    }),
  },
  {
    key: 'garrison', name: 'The Hornburg Garrison', level: 'Medium',
    blurb: '500 defenders behind wire and mines against 18,000 in 4 waves, with siege towers, trolls and catapults',
    build: (map, sb) => ({
      groups: [...garrison(map, 0.6), makeGroup('tank', 1, PO.tankDeep[0], PO.tankDeep[1], Math.PI / 2, 30), makeGroup('ifv', 2, PO.ifvDeep[0], PO.ifvDeep[1], Math.PI / 2, 50), ...fieldWorks(map),
        ...horde(18000, { waves: sb ? 1 : 4, kinds: ['escalade', 'siege', 'assault', 'final'], sizes: sb ? null : [0.8, 1, 1, 1.2], catapults: 12, towers: 4 })],
      options: { dawn: 1200, cpRate: 2 / 60 },
    }),
  },
  {
    key: 'three-hundred', name: 'Three Hundred Rifles', level: 'Hard',
    blurb: '300 riflemen with few heavy weapons against 10,000 attackers',
    build: (map, sb) => ({
      groups: [
        ...alongWall(map, 'rifle', 160, 0.08, 0.88), ...alongWall(map, 'mg', 10, 0.15, 0.85), ...alongWall(map, 'marksman', 8, 0.3, 0.7), ...alongWall(map, 'grenadier', 8, 0.2, 0.8),
        ...alongRing('rifle', 60, 160, 260), ...alongRing('mg', 6, 170, 250), ...alongRing('at', 6, 170, 220),
        makeGroup('mortar', 6, PO.mortarsHard[0], PO.mortarsHard[1], Math.PI / 2, 50), makeGroup('cache', 1, map.wallAt(0.5).x + 26, map.wallAt(0.5).y),
        makeGroup('rifle', 20, PO.courtPlatoon[0], PO.courtPlatoon[1], Math.PI / 2, 24), makeGroup('rifle', 24, PO.reserve[0], PO.reserve[1], Math.PI / 2, 40),
        makeGroup('cmd', 1, map.wallAt(0.45).x, map.wallAt(0.45).y),
        ...fieldWorks(map, 0.6), ...horde(10000, { waves: sb ? 1 : 3, kinds: ['escalade', 'siege', 'final'] }),
      ],
      options: { dawn: 900, cpStart: 8, cpRate: 2 / 60 },
    }),
  },
  // Not offered in the game: the heaviest load there is, for the ?bench run (see render/perf.js).
  {
    key: 'benchmark', name: 'Benchmark: Combined Arms vs. the Host', hidden: true,
    blurb: 'Armour in front of the wall, guns in the Deep, and 30,000 attackers in 6 waves',
    build: (map, sb) => ({
      groups: [
        ...garrison(map, 1.14),
        makeGroup('tank', 4, PO.tanksForward[0], PO.tanksForward[1], Math.PI / 2, 110), makeGroup('ifv', 6, PO.ifvsForward[0], PO.ifvsForward[1], Math.PI / 2, 90),
        makeGroup('tank', 2, PO.tankDeep[0], PO.tankDeep[1], Math.PI / 2, 30), makeGroup('howitzer', 4, PO.howitzersBench[0], PO.howitzersBench[1], Math.PI / 2, 60),
        makeGroup('mortar', 12, PO.mortarsBench[0], PO.mortarsBench[1], Math.PI / 2, 90), makeGroup('cache', 1, PO.cacheBench[0], PO.cacheBench[1]),
        ...fieldWorks(map, 1.3), ...horde(30000, { waves: sb ? 1 : 6 }),
      ],
      options: { dawn: 1200, cpStart: 10, cpRate: 3 / 60 },
    }),
  },
  { key: 'empty', name: 'Blank Map', blurb: 'An empty map', build: () => ({ groups: [], options: {} }) },
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
  twoDeep = !p.hidden;
  const s = p.build(map, sandbox);
  twoDeep = false;
  // (a belt of wire or a row of obstacles is as many pieces as the cells its line crosses: counted here, so it is paid for as laid)
  for (const g of s.groups) { const d = UNITS[U[g.type]]; if (d.cls === C.OBST && (d.ob === 'wire' || d.ob === 'av') && g.w > 0) { g.count = 1e4; g.count = groupPositions(map, g).length / 2; } }
  const options = { ...DEFAULT_OPTIONS, ...s.options, support: { ...DEFAULT_OPTIONS.support, ...(s.options.support || {}) } };
  if (sandbox || !s.groups.length) Object.assign(options, SANDBOX_OPTIONS);
  return { groups: s.groups, options, budget: forceCost(s.groups) };
}

/** Where a sandbox's win conditions start: no relief column, and the horde gives up at 1% of its strength. */
export const SANDBOX_OPTIONS = { sandbox: true, dawn: 0, rout: 0.01 };
