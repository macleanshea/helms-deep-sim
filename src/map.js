// Battlefield geometry, modelled on the film set: the Hornburg on a rock spur against
// the southern cliff (on the right as the horde comes up the valley), a long causeway
// curling down from its gate, and the Deeping Wall bowed across the mouth of the gorge
// to the northern cliff. Inside the curtain wall the rock climbs in terraces to the keep.
//
// Produces: the nav grid (4 m cells) with walking heights and wall/stair links, the wall
// segment table, the terrain height field for rendering, and descriptors of every built
// structure so the renderer can raise it in 3D.

import { WORLD_W, WORLD_H, CELL, GW, GH, T, WALL_H, PLATEAU_Z, RING_TOP } from './config.js';
import { LAYOUT } from './layout.js';

export const MARGIN = 256;                 // rendered terrain beyond the playable world (m)
export const HM_RES = 2;                   // metres per height texel
export const HM_W = (WORLD_W + 2 * MARGIN) / HM_RES;
export const HM_H = (WORLD_H + 2 * MARGIN) / HM_RES;
export const GZ_W = WORLD_W / HM_RES;
export const GZ_H = WORLD_H / HM_RES;

// The shapes come from src/layout.js; the names below are how the rest of the code has always known them.
const L = LAYOUT;
// the inner ward climbs the rock in two terraces; the outer court is the band left between them and the curtain wall
export const KEEP = L.keep;
export const WALL_HALF = L.wall.half;
export const N_WALL = L.wall.sections;
export const N_RING = L.ring.sections;
const RING_STEP = 360 / N_RING;
const GATE_K = L.ring.gate, POSTERN_K = L.ring.postern, DOOR_K = L.ring.door;
const CULVERT_T = L.wall.culvert;
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

// the gorge narrows sharply where the Hornburg's spur juts out from the southern cliff
const RN = L.rim.north, RS = L.rim.south, RE = L.rim.east;
function yTop(x) {
  return lerp(RN.a0, RN.a1, sstep(RN.x0, RN.x1, x)) + lerp(0, RN.deep, sstep(RN.dx0, RN.dx1, x)) - (fbm(x / 80, RN.seed, 3) - 0.5) * RN.noise;
}
function yBot(x) {
  return WORLD_H - lerp(RS.a0, RS.a1, sstep(RS.x0, RS.x1, x)) - lerp(0, RS.deep, sstep(RS.dx0, RS.dx1, x)) - (fbm(x / 80, RS.seed, 3) - 0.5) * RS.noise;
}
/** Signed distance into the mountain: positive inside rock. */
function cliffDist(x, y) {
  return Math.max(yTop(x) - y, y - yBot(x), x - RE.x + (fbm(y / 50, RE.seed, 2) - 0.5) * RE.noise);
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
  const BOW = L.wall.bow;
  const Tp = { x: L.wall.endX, y: yTop(L.wall.endX) - L.wall.inset };
  const wallAt = (t) => {
    const x = lerp(J.x, Tp.x, t) - BOW * Math.sin(Math.PI * t);
    const y = lerp(J.y, Tp.y, t);
    const dx = (Tp.x - J.x) - BOW * Math.PI * Math.cos(Math.PI * t), dy = Tp.y - J.y, l = Math.hypot(dx, dy);
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
  const cause = sampleLine(smooth([[gate.x + gate.nx * 2, gate.y + gate.ny * 2], ...L.causeway.via]), 120);
  const CAUSE_HALF = L.causeway.half;
  // a stair from the Deep up to the postern at the rear of the keep
  const rear = sampleLine(smooth([[post.x + post.nx * 2, post.y + post.ny * 2], ...L.rear.via]), 60);
  const REAR_HALF = L.rear.half;
  const nearLine = (line, x, y) => {
    let best = 1e9, bt = 0;
    for (let i = 0; i < line.length; i++) { const dx = x - line[i].x, dy = y - line[i].y, d = dx * dx + dy * dy; if (d < best) { best = d; bt = line[i].t; } }
    return { d: Math.sqrt(best), t: bt };
  };
  const rampZ = (t) => PLATEAU_Z * (1 - sstep(0.02, 0.98, t));

  // ---- stairs up to the wall walks -------------------------------------
  const stairs = [];
  for (const [t, dir] of L.stairs.wall) {
    const p = wallAt(t);
    let nx = p.ty, ny = -p.tx; if (nx > 0) { nx = -nx; ny = -ny; }
    const sx = p.x - nx * (WALL_HALF + 3), sy = p.y - ny * (WALL_HALF + 3);
    stairs.push({ x: sx - p.tx * dir * 9, y: sy - p.ty * dir * 9, dx: p.tx * dir, dy: p.ty * dir, len: 18, half: 3, z0: 0, z1: WALL_H });
  }
  for (const [deg, dir] of L.stairs.court) {
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
  const ST = L.stream;
  const streamY = (x) => culv.y - ST.swing * Math.sin((x - culv.x) / ST.wave) + Math.max(0, x - culv.x) * ST.drift;
  const WS = 300, wsx = new Float32Array(WS + 1), wsy = new Float32Array(WS + 1);
  for (let i = 0; i <= WS; i++) { const p = wallAt(i / WS); wsx[i] = p.x; wsy[i] = p.y; }
  const wallNearest = (x, y) => {
    if (x < L.wall.span[0] || x > L.wall.span[1] || y < Math.min(J.y, Tp.y) - 8 || y > Math.max(J.y, Tp.y) + 8) return null;
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
      const RD = L.road;
      if (x < RD.x) { const ry = RD.y - RD.swing * Math.sin((RD.x - x) / RD.wave) * sstep(0, RD.ease, RD.x - x); dirt = Math.max(dirt, sstep(9, 3, Math.abs(y - ry)) * 0.7); }
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
  // the highest ground within ~70 m of each 16 m cell, so aircraft can climb over ridges before they reach them
  const AF = 16, AFW = Math.ceil((HM_W * HM_RES) / AF), AFH = Math.ceil((HM_H * HM_RES) / AF), AFR = 4;
  const afRaw = new Float32Array(AFW * AFH).fill(-1e9), airF = new Float32Array(AFW * AFH);
  for (let j = 0; j < HM_H; j++) for (let i = 0; i < HM_W; i++) {
    const c = (((j * HM_RES) / AF) | 0) * AFW + (((i * HM_RES) / AF) | 0), z = hm[(j * HM_W + i) * 4];
    if (z > afRaw[c]) afRaw[c] = z;
  }
  // the keep's towers stand far above the rock they are built on
  for (const [x, y, r, z] of [[KEEP.tower.x, KEEP.tower.y, KEEP.tower.r + 8, KEEP.tower.top + 25], [KEEP.cx, KEEP.cy, KEEP.r + 10, RING_TOP + 12], [KEEP.t2.x, KEEP.t2.y, KEEP.t2.r, KEEP.drumTop + 16]]) {
    for (let j = Math.floor((y - r + MARGIN) / AF); j <= (y + r + MARGIN) / AF; j++) for (let i = Math.floor((x - r + MARGIN) / AF); i <= (x + r + MARGIN) / AF; i++) {
      if (i >= 0 && j >= 0 && i < AFW && j < AFH) afRaw[j * AFW + i] = Math.max(afRaw[j * AFW + i], z);
    }
  }
  for (let j = 0; j < AFH; j++) for (let i = 0; i < AFW; i++) {
    let mz = -1e9;
    for (let dj = -AFR; dj <= AFR; dj++) for (let di = -AFR; di <= AFR; di++) {
      if (di * di + dj * dj > AFR * AFR + 1) continue;
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < AFW && jj < AFH && afRaw[jj * AFW + ii] > mz) mz = afRaw[jj * AFW + ii];
    }
    airF[j * AFW + i] = mz;
  }
  /** Ground clearance floor for aircraft: smoothly interpolated, valid well beyond the world edge. */
  const airFloor = (x, y) => {
    const gx = Math.min(AFW - 1.001, Math.max(0, (x + MARGIN) / AF - 0.5)), gy = Math.min(AFH - 1.001, Math.max(0, (y + MARGIN) / AF - 0.5));
    const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, o = j * AFW + i;
    const a = airF[o] + (airF[o + 1] - airF[o]) * fx, b = airF[o + AFW] + (airF[o + AFW + 1] - airF[o + AFW]) * fx;
    return a + (b - a) * fy;
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
  const inWard = (x, y) => Math.hypot(x - KEEP.t1.x, y - KEEP.t1.y) < KEEP.t1.r + 4.5; // with the steps that hug it
  const buried = segments.slice(N_WALL).map((g) => terrZ(g.x, g.y) > PLATEAU_Z + 1.5);
  function classify(x, y) {
    const cd = cliffDist(x, y);
    const dk = Math.hypot(x - KEEP.cx, y - KEEP.cy);
    if (dk < KEEP.r + KEEP.half) {
      if (dk >= KEEP.r - KEEP.half) {
        // a section of the ring is wall from end to end, or (where the mountain has swallowed it) rock from end to end:
        // never half of each, which left a stretch of wall walk that could be stood on and not reached
        let a = Math.atan2(y - KEEP.cy, x - KEEP.cx) / DEG; if (a < 0) a += 360;
        const id = N_WALL + Math.min(N_RING - 1, Math.floor(a / RING_STEP));
        if (buried[id - N_WALL]) return [T.CLIFF, -1];
        return id === DOOR ? [T.DOOR, -1] : [T.WALL, id];
      }
      if (cd > 4) return [T.CLIFF, -1];
      if (inWard(x, y)) return [T.CLIFF, -1]; // the terraced inner ward: solid masonry and rock
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
    if (s.kind === 'wall') {
      const c = cellOf(s.ox, s.oy), t = type[c];
      if (t !== T.GROUND && t !== T.WATER) s.valid = false;
      // (where the wall runs into the Hornburg's rock its foot is up on the shelf: nothing can be set against it from the valley floor)
      if (cz[c] > 3.3) s.valid = false;
    }
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
      const a = (195 + (kk * 130) / n) * DEG;
      if (a / DEG < 146 || a / DEG > 272) continue;
      const x = KEEP.cx + rr * Math.cos(a), y = KEEP.cy + rr * Math.sin(a);
      if (seg[cellOf(x, y)] >= 0) keepSlots.push({ x, y });
    }
  }
  for (let rr = KEEP.r - 12; rr > 8; rr -= 2.7) {
    const n = Math.floor((2 * Math.PI * rr) / 2.7);
    for (let k = 0; k < n; k++) {
      const a = Math.PI * 1.08 + ((k & 1 ? -1 : 1) * Math.ceil(k / 2) * 2 * Math.PI) / n;
      const x = KEEP.cx + rr * Math.cos(a), y = KEEP.cy + rr * Math.sin(a);
      if (type[cellOf(x, y)] === T.COURT) keepSlots.push({ x, y });
    }
  }

  return {
    type, seg, segments, hm, gz, cz, portal, wallAt, wallLen, keepSlots, stairs, causeway: cause, rear, causeHalf: CAUSE_HALF, rearHalf: REAR_HALF,
    GATE, POSTERN, DOOR, CULVERT: culvertSeg, wallTop: Tp, wallJoin: J, streamY, rampZ,
    layout: L,
    labels: [
      { x: culv.x + L.labels.wall[0], y: culv.y + L.labels.wall[1], text: 'DEEPING WALL' },
      { x: KEEP.cx + L.labels.hornburg[0], y: KEEP.cy + L.labels.hornburg[1], text: 'THE HORNBURG' },
      { x: L.labels.causeway[0], y: L.labels.causeway[1], text: 'CAUSEWAY' },
      { x: culv.x + L.labels.culvert[0], y: culv.y + L.labels.culvert[1], text: 'CULVERT' },
      { x: L.labels.deep[0], y: L.labels.deep[1], text: 'THE DEEP' },
      { x: L.labels.coomb[0], y: L.labels.coomb[1], text: 'DEEPING-COOMB' },
    ],
    cellOf, terrZ, airFloor,
    /** Walking-surface height at a point (ground level; wall walks are handled per unit). */
    groundZ(x, y) {
      const i = Math.min(GZ_W - 1, Math.max(0, (x / HM_RES) | 0)), j = Math.min(GZ_H - 1, Math.max(0, (y / HM_RES) | 0));
      return gz[j * GZ_W + i];
    },
  };
}
