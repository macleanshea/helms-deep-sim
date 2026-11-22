// Battlefield geometry, modelled on the film set: the Hornburg on a rock spur against
// the northern cliff, a long causeway curling down from its gate, and the Deeping Wall
// bowed across the mouth of the gorge to the southern cliff.
//
// Produces: the nav grid (4 m cells) with walking heights and wall/stair links, the wall
// segment table, the terrain height field for rendering, and descriptors of every built
// structure so the renderer can raise it in 3D.

import { WORLD_W, WORLD_H, CELL, GW, GH, T, WALL_H, PLATEAU_Z, RING_TOP } from './config.js';

export const MARGIN = 256;                 // rendered terrain beyond the playable world (m)
export const HM_RES = 2;                   // metres per height texel
export const HM_W = (WORLD_W + 2 * MARGIN) / HM_RES;
export const HM_H = (WORLD_H + 2 * MARGIN) / HM_RES;
export const GZ_W = WORLD_W / HM_RES;
export const GZ_H = WORLD_H / HM_RES;

export const KEEP = { cx: 960, cy: 250, r: 72, half: 4.5, towerX: 967, towerY: 221, towerR: 13, hallX: 936, hallY: 222, hallW: 30, hallD: 18 };
export const WALL_HALF = 5;
export const N_WALL = 38;
export const N_RING = 36;
const RING_STEP = 360 / N_RING;
const GATE_K = 16, POSTERN_K = 1, DOOR_K = 7;
const CULVERT_T = 0.5;
const DEG = Math.PI / 180;

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
  return lerp(64, 205, sstep(520, 900, x)) + lerp(0, 190, sstep(1000, 1400, x)) + (fbm(x / 80, 3.7, 3) - 0.5) * 44;
}
function yBot(x) {
  return WORLD_H - lerp(64, 260, sstep(520, 960, x)) - lerp(0, 150, sstep(1000, 1400, x)) + (fbm(x / 80, 9.1, 3) - 0.5) * 44;
}
/** Signed distance into the mountain: positive inside rock. */
function cliffDist(x, y) {
  return Math.max(yTop(x) - y, y - yBot(x), x - 1394 + (fbm(y / 50, 1.3, 2) - 0.5) * 26);
}

/** Resample a polyline into evenly spaced points carrying arclength fraction `t`. */
function sampleLine(pts, n) {
  const seg = []; let L = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); L += l; }
  const out = [];
  for (let k = 0; k <= n; k++) {
    let d = (k / n) * L, i = 0;
    while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
    const u = d / seg[i];
    out.push({ x: lerp(pts[i][0], pts[i + 1][0], u), y: lerp(pts[i][1], pts[i + 1][1], u), t: k / n });
  }
  out.len = L;
  return out;
}
/** Chaikin smoothing so ramps curve instead of kinking. */
function smooth(pts, rounds = 3) {
  for (let r = 0; r < rounds; r++) {
    const o = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    o.push(pts[pts.length - 1]);
    pts = o;
  }
  return pts;
}

export function buildMap() {
  const type = new Uint8Array(GW * GH);
  const seg = new Int16Array(GW * GH).fill(-1);
  const segments = [];
  const ringPt = (deg, r = KEEP.r) => ({ x: KEEP.cx + r * Math.cos(deg * DEG), y: KEEP.cy + r * Math.sin(deg * DEG) });

  // ---- Deeping Wall --------------------------------------------------
  const J = ringPt(DOOR_K * RING_STEP + RING_STEP / 2, KEEP.r + KEEP.half);
  const Tp = { x: 992, y: yBot(992) + 12 };
  const wallAt = (t) => {
    const x = lerp(J.x, Tp.x, t) - 26 * Math.sin(Math.PI * t);
    const y = lerp(J.y, Tp.y, t);
    const dx = (Tp.x - J.x) - 26 * Math.PI * Math.cos(Math.PI * t), dy = Tp.y - J.y, l = Math.hypot(dx, dy);
    return { x, y, tx: dx / l, ty: dy / l, ang: Math.atan2(dy, dx) };
  };
  let wallLen = 0;
  { let p = wallAt(0); for (let i = 1; i <= 200; i++) { const q = wallAt(i / 200); wallLen += Math.hypot(q.x - p.x, q.y - p.y); p = q; } }
  const culvertSeg = Math.floor(CULVERT_T * N_WALL);
  const culv = wallAt((culvertSeg + 0.5) / N_WALL);
  for (let k = 0; k < N_WALL; k++) {
    const p = wallAt((k + 0.5) / N_WALL);
    let nx = p.ty, ny = -p.tx;
    if (nx > 0) { nx = -nx; ny = -ny; } // outward = west, toward the attackers
    segments.push({
      id: k, kind: 'wall', group: 0, x: p.x, y: p.y, tx: p.tx, ty: p.ty, nx, ny, ang: p.ang, len: wallLen / N_WALL, half: WALL_HALF,
      top: WALL_H, maxHp: 9000, culvert: k === culvertSeg, virt: 600, ox: p.x + nx * (WALL_HALF + 3), oy: p.y + ny * (WALL_HALF + 3), valid: true,
    });
  }
  // ---- Hornburg curtain wall ----------------------------------------
  const GATE = N_WALL + GATE_K, POSTERN = N_WALL + POSTERN_K, DOOR = N_WALL + DOOR_K;
  for (let k = 0; k < N_RING; k++) {
    const a = (k + 0.5) * RING_STEP * DEG, nx = Math.cos(a), ny = Math.sin(a), id = N_WALL + k;
    const kind = id === GATE ? 'gate' : id === POSTERN ? 'postern' : id === DOOR ? 'door' : 'ring';
    segments.push({
      id, kind, group: 1, x: KEEP.cx + KEEP.r * nx, y: KEEP.cy + KEEP.r * ny, tx: -ny, ty: nx, nx, ny, a, ang: a + Math.PI / 2,
      len: (2 * Math.PI * KEEP.r) / N_RING, half: KEEP.half, top: RING_TOP, maxHp: kind === 'gate' ? 5200 : kind === 'postern' ? 2600 : 1e9,
      virt: kind === 'gate' || kind === 'postern' ? 600 : 4000, ox: KEEP.cx + (KEEP.r + KEEP.half + 3) * nx, oy: KEEP.cy + (KEEP.r + KEEP.half + 3) * ny, valid: true,
    });
  }
  const gate = segments[GATE], post = segments[POSTERN];

  // ---- ramps ----------------------------------------------------------
  // the causeway curls down from the gate to the valley floor
  const cause = sampleLine(smooth([[gate.x + gate.nx * 2, gate.y + gate.ny * 2], [852, 281], [806, 306], [762, 338], [724, 376], [702, 414]]), 120);
  const CAUSE_HALF = 7;
  // a stair from the Deep up to the postern at the rear of the keep
  const rear = sampleLine(smooth([[post.x + post.nx * 2, post.y + post.ny * 2], [1052, 296], [1066, 326], [1074, 358]]), 60);
  const REAR_HALF = 4.5;
  const nearLine = (line, x, y) => {
    let best = 1e9, bt = 0;
    for (let i = 0; i < line.length; i++) { const dx = x - line[i].x, dy = y - line[i].y, d = dx * dx + dy * dy; if (d < best) { best = d; bt = line[i].t; } }
    return { d: Math.sqrt(best), t: bt };
  };
  const rampZ = (t) => PLATEAU_Z * (1 - sstep(0.02, 0.98, t));

  // ---- stairs up to the wall walks -------------------------------------
  const stairs = [];
  for (const [t, dir] of [[0.2, 1], [0.44, -1], [0.62, 1], [0.84, -1]]) {
    const p = wallAt(t);
    let nx = p.ty, ny = -p.tx; if (nx > 0) { nx = -nx; ny = -ny; }
    const sx = p.x - nx * (WALL_HALF + 3), sy = p.y - ny * (WALL_HALF + 3);
    stairs.push({ x: sx - p.tx * dir * 9, y: sy - p.ty * dir * 9, dx: p.tx * dir, dy: p.ty * dir, len: 18, half: 3, z0: 0, z1: WALL_H });
  }
  for (const [deg, dir] of [[112, 1], [200, -1]]) {
    const a = deg * DEG, r = KEEP.r - KEEP.half - 3;
    const tx = -Math.sin(a) * dir, ty = Math.cos(a) * dir;
    stairs.push({ x: KEEP.cx + r * Math.cos(a) - tx * 7, y: KEEP.cy + r * Math.sin(a) - ty * 7, dx: tx, dy: ty, len: 14, half: 3, z0: PLATEAU_Z, z1: RING_TOP });
  }
  const stairAt = (x, y) => {
    for (const s of stairs) {
      const rx = x - s.x, ry = y - s.y, a = rx * s.dx + ry * s.dy, p = -rx * s.dy + ry * s.dx;
      if (a >= 0 && a <= s.len && Math.abs(p) <= s.half) return s.z0 + (s.z1 - s.z0) * Math.min(1, a / (s.len - 2));
    }
    return -1;
  };

  // ---- terrain ----------------------------------------------------------
  const streamY = (x) => culv.y + 26 * Math.sin((x - culv.x) / 120) - Math.max(0, x - culv.x) * 0.1;
  const WS = 300, wsx = new Float32Array(WS + 1), wsy = new Float32Array(WS + 1);
  for (let i = 0; i <= WS; i++) { const p = wallAt(i / WS); wsx[i] = p.x; wsy[i] = p.y; }
  const wallNearest = (x, y) => {
    if (x < 930 || x > 1010 || y < J.y - 8 || y > Tp.y + 8) return null;
    let best = 1e9, bi = 0;
    for (let i = 0; i <= WS; i++) { const dx = x - wsx[i], dy = y - wsy[i], d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; } }
    return { d: Math.sqrt(best), t: bi / WS };
  };
  /** Natural ground: height plus material masks. */
  function terrain(x, y) {
    const cd = cliffDist(x, y);
    let z = (fbm(x / 160, y / 160, 4) - 0.5) * 5 + (fbm(x / 26, y / 26, 3) - 0.5) * 0.9;
    const ch = sstep(-6, 70, cd);
    // the mountain: a sheer first wall, then broken ground climbing away to ridges
    z += ch * 70 + sstep(-3, 5, cd) * 11 + ch * (fbm(x / 36, y / 36, 4) - 0.5) * 34 + Math.max(0, cd - 20) * 0.34 + ch * Math.max(0, fbm(x / 150 + 7, y / 150, 4) - 0.35) * 150;
    let rock = sstep(-10, 3, cd + (fbm(x / 16, y / 16, 3) - 0.5) * 12), dirt = 0, water = 0;
    const dk = Math.hypot(x - KEEP.cx, y - KEEP.cy);
    if (dk < KEEP.r + KEEP.half + 0.5 && cd < 6) { z = PLATEAU_Z; rock = 0.1; dirt = 1; }
    else if (dk >= KEEP.r + KEEP.half + 0.5) {
      const p = sstep(KEEP.r + KEEP.half + 10.5, KEEP.r + KEEP.half + 0.5, dk);
      if (p > 0) { const pz = PLATEAU_Z * p; if (pz > z) { z = pz + (fbm(x / 7, y / 7, 2) - 0.5) * 1.2 * (1 - p); rock = Math.max(rock, sstep(0, 0.25, p)); } }
    }
    if (cd < 0 && dk > KEEP.r + 18) {
      const sd = Math.abs(y - streamY(x));
      water = sstep(5.5, 1.2, sd);
      z -= sstep(9, 2, sd) * 1.4;
      dirt = Math.max(dirt, sstep(9, 4, sd) * 0.5 * (1 - water));
      const wn = wallNearest(x, y);
      if (wn) dirt = Math.max(dirt, sstep(30, 9, wn.d) * 0.65);
      const cn = nearLine(cause, x, y);
      dirt = Math.max(dirt, sstep(16, 6, cn.d) * 0.7);
      if (x < 702) { const ry = 414 + 46 * Math.sin((702 - x) / 210) * sstep(0, 160, 702 - x); dirt = Math.max(dirt, sstep(9, 3, Math.abs(y - ry)) * 0.7); }
    }
    return { z, rock, dirt, water, cd };
  }

  // rendered height field (extends past the world edge so the camera never sees a void)
  const hm = new Float32Array(HM_W * HM_H * 4);
  for (let j = 0; j < HM_H; j++) for (let i = 0; i < HM_W; i++) {
    const t = terrain((i + 0.5) * HM_RES - MARGIN, (j + 0.5) * HM_RES - MARGIN), o = (j * HM_W + i) * 4;
    hm[o] = t.z; hm[o + 1] = t.rock; hm[o + 2] = t.dirt; hm[o + 3] = t.water;
  }
  const terrZ = (x, y) => {
    const i = Math.min(HM_W - 1, Math.max(0, ((x + MARGIN) / HM_RES) | 0)), j = Math.min(HM_H - 1, Math.max(0, ((y + MARGIN) / HM_RES) | 0));
    return hm[(j * HM_W + i) * 4];
  };
  // walking surface: terrain plus ramps and stairs
  const gz = new Float32Array(GZ_W * GZ_H);
  const walkZ = (x, y) => {
    let z = terrZ(x, y);
    const st = stairAt(x, y); if (st >= 0) return st;
    const c = nearLine(cause, x, y); if (c.d < CAUSE_HALF) z = Math.max(z, rampZ(c.t));
    const r = nearLine(rear, x, y); if (r.d < REAR_HALF) z = Math.max(z, rampZ(r.t));
    return z;
  };
  for (let j = 0; j < GZ_H; j++) for (let i = 0; i < GZ_W; i++) gz[j * GZ_W + i] = walkZ((i + 0.5) * HM_RES, (j + 0.5) * HM_RES);

  // ---- nav classification ------------------------------------------------
  const cz = new Float32Array(GW * GH);
  const segCells = segments.map(() => 0);
  const inHall = (x, y) => Math.abs(x - KEEP.hallX) < KEEP.hallW / 2 && Math.abs(y - KEEP.hallY) < KEEP.hallD / 2;
  function classify(x, y) {
    const cd = cliffDist(x, y);
    const dk = Math.hypot(x - KEEP.cx, y - KEEP.cy);
    if (Math.hypot(x - KEEP.towerX, y - KEEP.towerY) < KEEP.towerR || inHall(x, y)) return [T.CLIFF, -1];
    if (dk < KEEP.r + KEEP.half) {
      if (cd > 4) return [T.CLIFF, -1];
      if (dk >= KEEP.r - KEEP.half) {
        let a = Math.atan2(y - KEEP.cy, x - KEEP.cx) / DEG; if (a < 0) a += 360;
        const id = N_WALL + Math.min(N_RING - 1, Math.floor(a / RING_STEP));
        return id === DOOR ? [T.DOOR, -1] : [T.WALL, id];
      }
      return [stairAt(x, y) >= 0 ? T.STAIR : T.COURT, -1];
    }
    if (stairAt(x, y) >= 0) return [T.STAIR, -1];
    if (nearLine(cause, x, y).d < CAUSE_HALF || nearLine(rear, x, y).d < REAR_HALF) return [T.ROAD, -1];
    const wn = wallNearest(x, y);
    if (wn && wn.d < WALL_HALF && cd < 3) return [T.WALL, Math.min(N_WALL - 1, Math.floor(wn.t * N_WALL))];
    const e = 3, slope = Math.hypot(terrZ(x + e, y) - terrZ(x - e, y), terrZ(x, y + e) - terrZ(x, y - e)) / (2 * e);
    if (cd > 0 || slope > 0.75) return [T.CLIFF, -1];
    return [Math.abs(y - streamY(x)) < 3.5 ? T.WATER : T.GROUND, -1];
  }
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2, c = gy * GW + gx;
    const [t, s] = classify(x, y);
    type[c] = t; seg[c] = s; cz[c] = walkZ(x, y);
    if (s >= 0) segCells[s]++;
  }
  const cellOf = (x, y) => Math.min(GH - 1, Math.max(0, (y / CELL) | 0)) * GW + Math.min(GW - 1, Math.max(0, (x / CELL) | 0));
  segments.forEach((s, i) => {
    if (segCells[i] < 2) s.valid = false;
    if (s.kind === 'wall') { const t = type[cellOf(s.ox, s.oy)]; if (t !== T.GROUND && t !== T.WATER) s.valid = false; }
  });

  // links between a wall walk and the stair head or door beside it (bit k = neighbour direction k)
  const DXk = [1, 1, 0, -1, -1, -1, 0, 1], DYk = [0, 1, 1, 1, 0, -1, -1, -1];
  const portal = new Uint8Array(GW * GH);
  for (let gy = 1; gy < GH - 1; gy++) for (let gx = 1; gx < GW - 1; gx++) {
    const c = gy * GW + gx, s = seg[c];
    if (s < 0) continue;
    for (let k = 0; k < 8; k++) {
      const n = (gy + DYk[k]) * GW + gx + DXk[k];
      if ((type[n] === T.STAIR || type[n] === T.DOOR) && Math.abs(cz[n] - segments[s].top) <= 1.9) { portal[c] |= 1 << k; portal[n] |= 1 << ((k + 4) & 7); }
    }
  }

  // ---- fall-back positions inside the Hornburg ----------------------------
  const keepSlots = [];
  for (const rr of [KEEP.r + 1.6, KEEP.r - 1.4]) {
    const n = Math.floor((130 * DEG * rr) / 2.1);
    for (let k = 0; k < n; k++) {
      const kk = (k & 1 ? -1 : 1) * Math.ceil(k / 2);
      const a = (165 + (kk * 130) / n) * DEG;
      if (a / DEG < 88 || a / DEG > 214) continue;
      const x = KEEP.cx + rr * Math.cos(a), y = KEEP.cy + rr * Math.sin(a);
      if (seg[cellOf(x, y)] >= 0) keepSlots.push({ x, y });
    }
  }
  for (let rr = KEEP.r - 12; rr > 8; rr -= 2.7) {
    const n = Math.floor((2 * Math.PI * rr) / 2.7);
    for (let k = 0; k < n; k++) {
      const a = Math.PI * 0.92 + ((k & 1 ? -1 : 1) * Math.ceil(k / 2) * 2 * Math.PI) / n;
      const x = KEEP.cx + rr * Math.cos(a), y = KEEP.cy + rr * Math.sin(a);
      if (type[cellOf(x, y)] === T.COURT) keepSlots.push({ x, y });
    }
  }

  return {
    type, seg, segments, hm, gz, cz, portal, wallAt, wallLen, keepSlots, stairs, causeway: cause, rear, causeHalf: CAUSE_HALF, rearHalf: REAR_HALF,
    GATE, POSTERN, DOOR, CULVERT: culvertSeg, wallTop: Tp, wallJoin: J, streamY, rampZ,
    labels: [
      { x: culv.x + 46, y: culv.y - 90, text: 'DEEPING WALL' },
      { x: KEEP.cx + 10, y: KEEP.cy + 22, text: 'THE HORNBURG' },
      { x: 770, y: 318, text: 'CAUSEWAY' },
      { x: culv.x - 40, y: culv.y + 12, text: 'CULVERT' },
      { x: 1180, y: 470, text: 'THE DEEP' },
      { x: 380, y: 480, text: 'DEEPING-COOMB' },
    ],
    cellOf,
    /** Walking-surface height at a point (ground level; wall walks are handled per unit). */
    groundZ(x, y) {
      const i = Math.min(GZ_W - 1, Math.max(0, (x / HM_RES) | 0)), j = Math.min(GZ_H - 1, Math.max(0, (y / HM_RES) | 0));
      return gz[j * GZ_W + i];
    },
  };
}
