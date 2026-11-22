// Battlefield geometry: the Deeping-coomb valley, the Deeping Wall and the Hornburg.
// Produces a nav grid (4 m cells), wall segment table and a height/material field
// that the renderer bakes into terrain.

import { WORLD_W, WORLD_H, CELL, GW, GH, T } from './config.js';

export const HM_RES = 2; // metres per heightmap texel
export const HM_W = WORLD_W / HM_RES;
export const HM_H = WORLD_H / HM_RES;

export const KEEP = { cx: 1350, cy: 812, r: 100, towerX: 1362, towerY: 820, towerR: 26 };
const WALL_HALF = 6;
const RING_HALF = 5;
export const N_WALL = 40;
export const N_RING = 40;
const CULVERT_Y = 470;

function hash(ix, iy) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, o = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < o; i++) { s += a * vnoise(x, y); n += a; x *= 2.03; y *= 2.03; a *= 0.5; }
  return s / n;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function yTop(x) {
  const a = lerp(60, 232, sstep(700, 1300, x));
  const b = lerp(0, 250, sstep(1300, 1900, x));
  return a + b + (fbm(x / 90, 3.7, 3) - 0.5) * 56;
}
function yBot(x) {
  const a = lerp(70, 300, sstep(700, 1250, x));
  const b = lerp(0, 180, sstep(1300, 1900, x));
  return WORLD_H - a - b + (fbm(x / 90, 9.1, 3) - 0.5) * 56;
}
// positive inside rock
function cliffDist(x, y) {
  return Math.max(yTop(x) - y, y - yBot(x), x - 1876 + (fbm(y / 60, 1.3, 2) - 0.5) * 30);
}
function streamY(x) {
  return CULVERT_Y + 40 * Math.sin((x - 1262) / 150) + Math.max(0, x - 1262) * 0.2;
}

export function buildMap() {
  const type = new Uint8Array(GW * GH);
  const seg = new Int16Array(GW * GH).fill(-1);
  const segments = [];

  // ---- Deeping Wall polyline ----------------------------------------
  const J = { x: KEEP.cx + KEEP.r * Math.cos(-2 * Math.PI / 3), y: KEEP.cy + KEEP.r * Math.sin(-2 * Math.PI / 3) };
  const Tp = { x: 1292, y: yTop(1292) - 14 };
  const wallAt = (t) => {
    const x = lerp(J.x, Tp.x, t) - 34 * Math.sin(Math.PI * t);
    const y = lerp(J.y, Tp.y, t);
    const dx = (Tp.x - J.x) - 34 * Math.PI * Math.cos(Math.PI * t);
    const dy = Tp.y - J.y;
    const l = Math.hypot(dx, dy);
    return { x, y, tx: dx / l, ty: dy / l, ang: Math.atan2(dy, dx) };
  };
  let wallLen = 0;
  { let p = wallAt(0); for (let i = 1; i <= 200; i++) { const q = wallAt(i / 200); wallLen += Math.hypot(q.x - p.x, q.y - p.y); p = q; } }
  const culvertT = (J.y - CULVERT_Y) / (J.y - Tp.y);
  const culvertSeg = Math.floor(culvertT * N_WALL);

  for (let k = 0; k < N_WALL; k++) {
    const p = wallAt((k + 0.5) / N_WALL);
    // outward normal points west (toward the attackers)
    let nx = p.ty, ny = -p.tx;
    if (nx > 0) { nx = -nx; ny = -ny; }
    segments.push({
      id: k, kind: 'wall', group: 0, x: p.x, y: p.y, tx: p.tx, ty: p.ty, nx, ny, ang: p.ang,
      len: wallLen / N_WALL, half: WALL_HALF, maxHp: 9000, culvert: k === culvertSeg,
      ox: p.x + nx * (WALL_HALF + 3), oy: p.y + ny * (WALL_HALF + 3), valid: true,
    });
  }
  // ---- Hornburg ring ------------------------------------------------
  const GATE = N_WALL, POSTERN = N_WALL + 17;
  for (let k = 0; k < N_RING; k++) {
    const a = Math.PI + (k * 2 * Math.PI) / N_RING;
    const nx = Math.cos(a), ny = Math.sin(a);
    const id = N_WALL + k;
    const kind = id === GATE ? 'gate' : id === POSTERN ? 'postern' : 'ring';
    segments.push({
      id, kind, group: 1, x: KEEP.cx + KEEP.r * nx, y: KEEP.cy + KEEP.r * ny, tx: -ny, ty: nx, nx, ny, ang: a + Math.PI / 2, a,
      len: (2 * Math.PI * KEEP.r) / N_RING, half: RING_HALF, maxHp: kind === 'gate' ? 5200 : kind === 'postern' ? 2600 : 9000,
      ox: KEEP.cx + (KEEP.r + RING_HALF + 3) * nx, oy: KEEP.cy + (KEEP.r + RING_HALF + 3) * ny, valid: true,
    });
  }
  const TOWER = segments.length;
  segments.push({ id: TOWER, kind: 'tower', group: 2, x: KEEP.towerX, y: KEEP.towerY, tx: 1, ty: 0, nx: 0, ny: 0, ang: 0, len: 0, half: KEEP.towerR, maxHp: 1e9, stairs: true, ox: KEEP.towerX, oy: KEEP.towerY, valid: true });

  // sample the wall densely for nearest-point queries
  const WS = 400;
  const wsx = new Float32Array(WS + 1), wsy = new Float32Array(WS + 1);
  for (let i = 0; i <= WS; i++) { const p = wallAt(i / WS); wsx[i] = p.x; wsy[i] = p.y; }
  function wallNearest(x, y) {
    if (x < 1230 || x > 1320 || y < Tp.y - 10 || y > J.y + 10) return null;
    let best = 1e9, bi = 0;
    for (let i = 0; i <= WS; i++) { const dx = x - wsx[i], dy = y - wsy[i]; const d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; } }
    return { d: Math.sqrt(best), t: bi / WS };
  }

  // sector tests for the rock skirt around the Hornburg (degrees, y down)
  function keepAngle(x, y) { return (Math.atan2(y - KEEP.cy, x - KEEP.cx) * 180) / Math.PI; }
  function skirtSector(a) { return a < -124 || a > 58; } // west / south-west faces: sheer rock
  const CAUSE_HALF = 9;
  const causeX0 = KEEP.cx - KEEP.r - 150, causeX1 = KEEP.cx - KEEP.r;

  function classify(x, y) {
    const dk = Math.hypot(x - KEEP.cx, y - KEEP.cy);
    const dt = Math.hypot(x - KEEP.towerX, y - KEEP.towerY);
    if (dt < KEEP.towerR) return { t: T.WALL, s: TOWER };
    if (dk < KEEP.r - RING_HALF) return { t: T.COURT, s: -1 };
    if (dk < KEEP.r + RING_HALF) {
      const a = Math.atan2(y - KEEP.cy, x - KEEP.cx);
      let u = (a - Math.PI) / (2 * Math.PI / N_RING) + 0.5;
      u = ((u % N_RING) + N_RING) % N_RING;
      return { t: T.WALL, s: N_WALL + Math.floor(u) };
    }
    const cd = cliffDist(x, y);
    const onCause = Math.abs(y - KEEP.cy) < CAUSE_HALF && x > causeX0 && x < causeX1;
    if (onCause) return { t: T.ROAD, s: -1 };
    const a = keepAngle(x, y);
    if (dk < KEEP.r + 30 && skirtSector(a)) return { t: T.CLIFF, s: -1 };
    if (Math.abs(y - KEEP.cy) < CAUSE_HALF + 6 && x > causeX1 - 122 && x < causeX1 - 26) return { t: T.CLIFF, s: -1 };
    if (cd > 0) return { t: T.CLIFF, s: -1 };
    const wn = wallNearest(x, y);
    if (wn && wn.d < WALL_HALF) return { t: T.WALL, s: Math.min(N_WALL - 1, Math.floor(wn.t * N_WALL)) };
    if (Math.abs(y - streamY(x)) < 3.5) return { t: T.WATER, s: -1 };
    return { t: T.GROUND, s: -1 };
  }

  const segCells = segments.map(() => 0);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const c = classify(gx * CELL + CELL / 2, gy * CELL + CELL / 2);
      type[gy * GW + gx] = c.t;
      seg[gy * GW + gx] = c.s;
      if (c.s >= 0) segCells[c.s]++;
    }
  }
  const cellAt = (x, y) => Math.min(GH - 1, Math.max(0, (y / CELL) | 0)) * GW + Math.min(GW - 1, Math.max(0, (x / CELL) | 0));
  segments.forEach((s, i) => {
    if (segCells[i] < 3) s.valid = false;
    if (s.kind === 'wall' && (cliffDist(s.ox, s.oy) > -6 || type[cellAt(s.ox, s.oy)] !== T.GROUND && type[cellAt(s.ox, s.oy)] !== T.WATER)) s.valid = false;
  });

  // ---- height / material field for the renderer ----------------------
  const hm = new Float32Array(HM_W * HM_H * 4);
  for (let j = 0; j < HM_H; j++) {
    for (let i = 0; i < HM_W; i++) {
      const x = (i + 0.5) * HM_RES, y = (j + 0.5) * HM_RES;
      const cd = cliffDist(x, y);
      let h = (fbm(x / 140, y / 140, 4) - 0.5) * 7 + (fbm(x / 23, y / 23, 3) - 0.5) * 1.2;
      const ch = sstep(-10, 60, cd);
      h += ch * 78 + sstep(-4, 6, cd) * 9 + ch * (fbm(x / 30, y / 30, 4) - 0.5) * 30;
      let rock = sstep(-12, 3, cd + (fbm(x / 18, y / 18, 3) - 0.5) * 14);
      let dirt = 0, water = 0;
      const dk = Math.hypot(x - KEEP.cx, y - KEEP.cy);
      const a = keepAngle(x, y);
      const sect = Math.min(sstep(-116, -128, a) + sstep(50, 62, a), 1);
      const plateau = sstep(KEEP.r + 36, KEEP.r + 8, dk) * Math.max(sect, sstep(KEEP.r + 6, KEEP.r - 2, dk));
      h = Math.max(h, plateau * 14 + (1 - plateau) * h);
      rock = Math.max(rock, plateau * sstep(KEEP.r - 6, KEEP.r + 4, dk));
      if (dk < KEEP.r) { dirt = 1; rock = Math.min(rock, 0.15); }
      // causeway ramp
      const cy = Math.abs(y - KEEP.cy);
      if (x > causeX0 - 30 && x < causeX1 + 2) {
        const side = sstep(CAUSE_HALF + 7, CAUSE_HALF, cy);
        const rampH = 14 * sstep(causeX0, causeX1 - 24, x);
        h = Math.max(h, lerp(h, rampH, side));
        dirt = Math.max(dirt, sstep(CAUSE_HALF + 1, CAUSE_HALF - 2, cy) * sstep(causeX0 - 30, causeX0 + 10, x));
        rock = Math.max(rock, side * (1 - sstep(CAUSE_HALF + 1, CAUSE_HALF - 2, cy)) * sstep(causeX0, causeX0 + 40, x));
      }
      // worn road leading west from the causeway
      if (x <= causeX0) {
        const ry = KEEP.cy + 60 * Math.sin((causeX0 - x) / 260) * sstep(0, 200, causeX0 - x);
        dirt = Math.max(dirt, sstep(9, 3, Math.abs(y - ry)) * 0.75);
      }
      // trampled ground along the wall foot and in the Deep
      const wn = (x > 1200 && x < 1330) ? wallNearest(x, y) : null;
      if (wn) dirt = Math.max(dirt, sstep(26, 8, wn.d) * 0.6);
      const sd = Math.abs(y - streamY(x));
      if (cd < 0 && dk > KEEP.r + 8) {
        water = sstep(6.5, 1.5, sd);
        h -= sstep(9, 2, sd) * 1.6;
        dirt = Math.max(dirt, sstep(9, 4, sd) * 0.5 * (1 - water));
      }
      const o = (j * HM_W + i) * 4;
      hm[o] = h; hm[o + 1] = rock; hm[o + 2] = dirt; hm[o + 3] = water;
    }
  }

  // ---- defender fallback positions inside the Hornburg ----------------
  const keepSlots = [];
  for (const rr of [KEEP.r + 1.5, KEEP.r - 1.5, KEEP.r - 3.6]) {
    const n = Math.floor((2 * Math.PI * rr) / 2.1);
    for (let k = 0; k < n; k++) {
      // alternate outwards from the gate so the gate side fills first
      const kk = (k & 1 ? -1 : 1) * Math.ceil(k / 2);
      const a = Math.PI + (kk * 2 * Math.PI) / n;
      keepSlots.push({ x: KEEP.cx + rr * Math.cos(a), y: KEEP.cy + rr * Math.sin(a) });
    }
  }
  for (let rr = 3; rr < KEEP.towerR - 2; rr += 2.4) {
    const n = Math.floor((2 * Math.PI * rr) / 2.4);
    for (let k = 0; k < n; k++) keepSlots.push({ x: KEEP.towerX + rr * Math.cos((k * 2 * Math.PI) / n), y: KEEP.towerY + rr * Math.sin((k * 2 * Math.PI) / n) });
  }
  for (let rr = KEEP.r - 9; rr > KEEP.towerR + 8; rr -= 2.6) {
    const n = Math.floor((2 * Math.PI * rr) / 2.6);
    for (let k = 0; k < n; k++) {
      const x = KEEP.cx + rr * Math.cos(Math.PI + (k * 2 * Math.PI) / n), y = KEEP.cy + rr * Math.sin(Math.PI + (k * 2 * Math.PI) / n);
      if (Math.hypot(x - KEEP.towerX, y - KEEP.towerY) > KEEP.towerR + 3) keepSlots.push({ x, y });
    }
  }

  const culv = segments[culvertSeg];
  return {
    type, seg, segments, hm, wallAt, wallLen, keepSlots,
    GATE, POSTERN, TOWER, CULVERT: culvertSeg,
    wallTop: Tp, wallJoin: J,
    labels: [
      { x: culv.x + 38, y: 330, text: 'DEEPING WALL', rot: -Math.PI / 2 },
      { x: KEEP.cx, y: KEEP.cy - 46, text: 'THE HORNBURG' },
      { x: KEEP.cx - KEEP.r - 80, y: KEEP.cy - 20, text: 'CAUSEWAY' },
      { x: culv.x - 46, y: culv.y + 16, text: 'CULVERT' },
      { x: 1640, y: 560, text: 'THE DEEP' },
      { x: 520, y: 600, text: 'DEEPING-COOMB' },
    ],
    cellOf(x, y) {
      let gx = (x / CELL) | 0, gy = (y / CELL) | 0;
      if (gx < 0) gx = 0; else if (gx >= GW) gx = GW - 1;
      if (gy < 0) gy = 0; else if (gy >= GH) gy = GH - 1;
      return gy * GW + gx;
    },
  };
}
