// Builds the fortress: the Deeping Wall, the Hornburg's curtain wall and gatehouse, the terraced
// inner ward with its halls and great tower, the causeway, stairs, and the wreckage of anything
// breached. It is assembled from independent pieces that are cached, so when a section falls only
// that section (and its neighbours' torn ends) is rebuilt.
//
// Stone carries MAT.ASHLAR everywhere: the shader lays coursed blocks on upright faces and
// flagstones on level ones.

import { MeshBuilder } from './mesh.js';
import { dim } from './models/figure.js';
import { MAT } from './materials.js';
import { KEEP, N_WALL, N_RING, WALL_HALF } from '../map.js';
import { WALL_H, PLATEAU_Z, RING_TOP } from '../config.js';

const STONE = [0.56, 0.55, 0.52], STONE_LT = [0.66, 0.65, 0.61], STONE_DK = [0.42, 0.41, 0.39], PAVE = [0.5, 0.48, 0.44];
const CORE = [0.31, 0.29, 0.27]; // rubble core exposed where masonry has been torn away
const WOOD = [0.36, 0.25, 0.15], DARK = [0.05, 0.05, 0.05], SLATE = [0.25, 0.27, 0.31], IRON = [0.2, 0.2, 0.22];
const LAMP = [0.95, 0.62, 0.26];  // a window with a light behind it
const DEG = Math.PI / 180, TAU = Math.PI * 2;

let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** A dark slit (or a lit one) set into a face: drawn in the current frame, looking along +x. */
function slit(m, x, y, z, w, h, lit = false) {
  m.withMat(lit ? MAT.EMIT : MAT.PLAIN, () => m.box(x, y, z, 0.06, w, h, lit ? LAMP : DARK));
}

/**
 * Battlements along the edge from p to q (z = walkway height), facing n: a course of corbels
 * carrying a breast wall that oversails the face, with merlons, sloped copings and arrow loops.
 */
function battlement(m, p, q, z, n, col = STONE_LT) {
  const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
  if (L < 0.2) return;
  m.frame([p[0], p[1], z], n, [dx / L, dy / L], () => {
    const nc = Math.max(1, Math.round(L / 1.25));
    for (let k = 0; k < nc; k++) {
      const y = ((k + 0.5) / nc) * L;
      m.box(0.21, y, -1.05, 0.42, 0.42, 0.55, STONE_DK);
      m.box(0.11, y, -1.52, 0.22, 0.42, 0.4, STONE_DK);
    }
    m.box(0.1, L / 2, -0.52, 0.72, L, 0.52, STONE);            // the course the corbels carry
    m.box(0.1, L / 2, 0.34, 0.7, L, 1.2, col);                 // breast wall
    const nm = Math.max(1, Math.round(L / 2.5)), w = Math.min(1.4, (L / nm) * 0.58);
    for (let k = 0; k < nm; k++) {
      const y = ((k + 0.5) / nm) * L;
      m.box(0.1, y, 1.47, 0.7, w, 1.06, col);
      const r = (sx, sy) => [0.1 + sx * 0.35, y + sy * w / 2, 2.0], t = (sx, sy) => [0.1 + sx * 0.12, y + sy * (w / 2 - 0.12), 2.26];
      m.prism([r(-1, -1), r(1, -1), r(1, 1), r(-1, 1)], [t(-1, -1), t(1, -1), t(1, 1), t(-1, 1)], STONE);
      if (k % 2 === 0) slit(m, 0.44, y, 1.45, 0.13, 0.7);
    }
  });
}

/** Stepped buttress against a face: standing at o, projecting along n, `w` wide, from z0 up to z1. */
function buttress(m, o, n, t, w, z0, z1, d = 2.0, col = STONE_DK) {
  const h = z1 - z0;
  m.frame([o[0], o[1], 0], n, t, () => {
    m.extrudeY([[-0.3, z0], [d, z0], [d * 0.72, z0 + h * 0.42], [d * 0.72 - 0.25, z0 + h * 0.5], [d * 0.4, z0 + h * 0.8], [d * 0.4 - 0.25, z0 + h * 0.86], [-0.3, z1]], -w / 2, w / 2, col);
  });
}

/** Slice of the ring wall between two angles and two heights. */
function arcPrism(m, a0, a1, ri, ro, z0, z1, col, caps = true) {
  const P = (a, r) => [KEEP.cx + Math.cos(a) * r, KEEP.cy + Math.sin(a) * r];
  const am = (a0 + a1) / 2, ox = Math.cos(am), oy = Math.sin(am);
  m.wall(P(a0, ro), P(a1, ro), z0, z1, ox, oy, col);
  m.wall(P(a0, ri), P(a1, ri), z0, z1, -ox, -oy, col);
  m.floor(P(a0, ri), P(a0, ro), P(a1, ro), P(a1, ri), z1, PAVE);
  if (caps) {
    m.wall(P(a0, ri), P(a0, ro), z0, z1, Math.sin(a0), -Math.cos(a0), col);
    m.wall(P(a1, ri), P(a1, ro), z0, z1, -Math.sin(a1), Math.cos(a1), col);
  }
}

/**
 * What is left of a fallen stretch of the Deeping Wall: broken stubs standing where it tore away
 * from the intact masonry, and a low jagged ridge of footings and rubble between them.
 * capA / capB: the neighbouring section on that side still stands.
 */
function brokenWall(m, a, b, s, H, BASE, capA, capB) {
  seed = 777 + s.id * 31;
  const n = 7;
  const lerp2 = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  for (let k = 0; k < n; k++) {
    const u0 = k / n, u1 = (k + 1) / n, um = (u0 + u1) / 2;
    // tall ragged stubs at the torn ends, little more than footings in the middle
    let h = 0.8 + rnd() * 1.6;
    if (capA && um < 0.3) h = Math.max(h, H * (0.75 - um * 1.8) + rnd() * 2);
    if (capB && um > 0.7) h = Math.max(h, H * (0.75 - (1 - um) * 1.8) + rnd() * 2);
    const oa = lerp2(a.o, b.o, u0), ob = lerp2(a.o, b.o, u1), ia = lerp2(a.i, b.i, u0), ib = lerp2(a.i, b.i, u1);
    // knock the outer and inner faces back by different amounts so the break looks torn, not sawn
    const io = 0.3 + rnd() * 1.2, ii = 0.3 + rnd() * 1.2;
    const sh = (p, d, sx, sy) => [p[0] - sx * d, p[1] - sy * d];
    const OA = sh(oa, io, s.nx, s.ny), OB = sh(ob, io, s.nx, s.ny), IA = sh(ia, -ii, s.nx, s.ny), IB = sh(ib, -ii, s.nx, s.ny);
    const top = h, tz = top + (rnd() - 0.5) * 0.6;
    m.wall(OA, OB, BASE, top, s.nx, s.ny, STONE);
    m.wall(IA, IB, BASE, tz, -s.nx, -s.ny, STONE);
    m.quad([IA[0], IA[1], tz], [OA[0], OA[1], top], [OB[0], OB[1], top], [IB[0], IB[1], tz], CORE);
    m.quad([IA[0], IA[1], tz], [IB[0], IB[1], tz], [OB[0], OB[1], top], [OA[0], OA[1], top], CORE);
    if (k === 0 || k === n - 1) {
      const P = k === 0 ? [OA, IA] : [OB, IB], t = k === 0 ? -1 : 1;
      m.wall(P[0], P[1], BASE, Math.min(top, tz), s.tx * t, s.ty * t, STONE_DK);
    }
  }
}

/** Fallen masonry (or splintered timber, at a gate) heaped where a section came down. */
function rubble(m, map, s) {
  seed = 1000 + s.id * 77;
  const gate = s.kind === 'gate' || s.kind === 'postern' || s.kind === 'door';
  const gz = gate ? PLATEAU_Z : map.groundZ(s.x, s.y);
  const n = gate ? 12 : 80;
  for (let k = 0; k < n; k++) {
    const u = (rnd() - 0.5) * (s.len + 4), v = (rnd() + rnd() - 1) * (gate ? 5 : 10);
    const d = Math.abs(v) / 10, sz = 0.35 + rnd() * rnd() * (gate ? 1.2 : 2.4), hgt = gate ? 0.3 : Math.max(0.25, (1 - d) * 2.8 * rnd());
    const x = s.x + s.tx * u + s.nx * v, y = s.y + s.ty * u + s.ny * v, a = rnd() * 6.28, sh = 0.7 + rnd() * 0.5;
    const wood = gate && k % 2 === 1;
    m.mat = wood ? MAT.TIMBER : MAT.ASHLAR;
    m.frameBox([x, y, gz + hgt + sz * 0.3], [Math.cos(a) * sz, Math.sin(a) * sz, (rnd() - 0.5) * sz * 0.6], [-Math.sin(a) * sz * 0.7, Math.cos(a) * sz * 0.7, (rnd() - 0.5) * sz * 0.3], [0, 0, sz * 0.5], dim(wood ? WOOD : STONE, sh));
  }
  m.mat = MAT.ASHLAR;
}

/** A round tower: battered foot, string course, a corbelled crown with merlons, and arrow loops. */
function turret(m, x, y, r, z0, z1, col = STONE, loops = true) {
  const n = 20, h = z1 - z0;
  m.lathe([[r * 1.12, 0], [r * 1.03, h * 0.3], [r, h * 0.55], [r, h * 0.55], [r + 0.18, h * 0.57], [r + 0.18, h * 0.6], [r, h * 0.62], [r, h * 0.62],
    [r, h - 1.7], [r, h - 1.7], [r + 0.5, h - 0.9], [r + 0.5, h], [r + 0.5, h], [0, h, PAVE]], n, col, 0, [x, y, z0], 'z', { capA: false });
  const nm = Math.max(8, Math.round((TAU * r) / 2.6));
  for (let k = 0; k < nm; k++) {
    const a = (k / nm) * TAU, c = Math.cos(a), s = Math.sin(a), w = Math.min(1.4, ((TAU * r) / nm) * 0.56);
    m.frame([x + c * (r + 0.5), y + s * (r + 0.5), z1], [c, s], [-s, c], () => {
      m.box(-0.3, 0, 0.5, 0.6, (TAU * (r + 0.5)) / nm + 0.06, 1.0, STONE_LT);
      m.box(-0.3, 0, 1.5, 0.6, w, 1.0, STONE_LT);
      const b = (sx, sy) => [-0.3 + sx * 0.3, sy * w / 2, 2.0], t = (sx, sy) => [-0.3 + sx * 0.1, sy * (w / 2 - 0.12), 2.24];
      m.prism([b(-1, -1), b(1, -1), b(1, 1), b(-1, 1)], [t(-1, -1), t(1, -1), t(1, 1), t(-1, 1)], STONE);
      m.box(-0.28, 0, -1.25, 0.5, 0.4, 0.5, STONE_DK);                           // corbel under the crown
      if (loops && k % 4 === 1) slit(m, -0.5 + 0.02, 0, -h * 0.34, 0.16, 1.5);
    });
  }
}

/** Raised roadway along a sampled path, with retaining walls, a coped parapet and piers. */
function ramp(m, line, half, zOf, base, rail) {
  const pts = [];
  for (let i = 0; i < line.length; i += 3) pts.push(line[i]);
  if (pts[pts.length - 1] !== line[line.length - 1]) pts.push(line[line.length - 1]);
  const edge = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    return { c: [p.x, p.y], l: [p.x + nx * half, p.y + ny * half], r: [p.x - nx * half, p.y - ny * half], nx, ny, tx: dx / l, ty: dy / l, z: zOf(p.t) };
  });
  const BAT = 0.9;
  for (let i = 0; i < edge.length - 1; i++) {
    const a = edge[i], b = edge[i + 1], cen = [(a.c[0] + b.c[0]) / 2, (a.c[1] + b.c[1]) / 2, (a.z + b.z) / 2 - 2];
    m.quadOut([a.l[0], a.l[1], a.z], [a.r[0], a.r[1], a.z], [b.r[0], b.r[1], b.z], [b.l[0], b.l[1], b.z], [cen[0], cen[1], cen[2] - 50], PAVE);
    if (Math.min(a.z, b.z) <= 0.4) continue;
    for (const sd of [1, -1]) {
      const p = sd > 0 ? a.l : a.r, q = sd > 0 ? b.l : b.r;
      const dk = dim(STONE_DK, 0.62);
      // battered retaining wall
      m.quadC([p[0] + a.nx * sd * BAT, p[1] + a.ny * sd * BAT, base], [q[0] + b.nx * sd * BAT, q[1] + b.ny * sd * BAT, base], [q[0], q[1], b.z], [p[0], p[1], a.z], cen, dk, dk, STONE_DK, STONE_DK);
      if (!rail) continue;
      const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy), ox = (-dy / L), oy = dx / L;
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], zm = (a.z + b.z) / 2, dz = (b.z - a.z) / 2;
      m.frameBox([mid[0], mid[1], zm + 0.5], [dx / 2, dy / 2, dz], [ox * 0.32, oy * 0.32, 0], [0, 0, 0.5], STONE_LT);
      m.frameBox([mid[0], mid[1], zm + 1.08], [dx / 2, dy / 2, dz], [ox * 0.42, oy * 0.42, 0], [0, 0, 0.09], STONE);   // coping
      if (i % 3 === 0) {
        // a pier: a short post on the parapet over a buttress down the retaining wall
        m.frameBox([p[0], p[1], a.z + 0.8], [a.tx * 0.55, a.ty * 0.55, 0], [a.nx * 0.55, a.ny * 0.55, 0], [0, 0, 0.8], STONE);
        m.frameBox([p[0], p[1], a.z + 1.72], [a.tx * 0.68, a.ty * 0.68, 0], [a.nx * 0.68, a.ny * 0.68, 0], [0, 0, 0.12], STONE_LT);
        if (a.z > 3) buttress(m, p, [a.nx * sd, a.ny * sd], [a.tx, a.ty], 1.8, base, a.z - 0.3, 1.9);
      }
    }
  }
}

/** One section of the Deeping Wall, or its ruin. */
function wallSection(m, map, segs, k, bound, H, BASE) {
  const s = segs[k], a = bound[k], b = bound[k + 1];
  const prevDown = k > 0 && segs[k - 1].breached, nextDown = k < N_WALL - 1 && segs[k + 1].breached;
  if (s.breached) { brokenWall(m, a, b, s, H, BASE, !segs[k - 1] || !segs[k - 1].breached, !segs[k + 1] || segs[k + 1].kind !== 'wall' || !segs[k + 1].breached); return; }
  const BAT = 1.1, cen = [s.x, s.y, 3], dk = dim(STONE, 0.6);
  // the outer face leans back from a broad foot; neighbouring sections share the foot line
  m.quadC([a.o[0] + a.nx * BAT, a.o[1] + a.ny * BAT, BASE], [b.o[0] + b.nx * BAT, b.o[1] + b.ny * BAT, BASE], [b.o[0], b.o[1], H], [a.o[0], a.o[1], H], cen, dk, dk, STONE, STONE);
  m.wall(a.i, b.i, BASE, H, -s.nx, -s.ny, STONE);
  m.floor(a.i, a.o, b.o, b.i, H, PAVE);
  if (k === 0 || prevDown) m.wall(a.i, [a.o[0] + a.nx * BAT * 0.5, a.o[1] + a.ny * BAT * 0.5], BASE, H, -a.tx, -a.ty, k ? CORE : STONE_DK);
  if (k === N_WALL - 1 || nextDown) m.wall(b.i, [b.o[0] + b.nx * BAT * 0.5, b.o[1] + b.ny * BAT * 0.5], BASE, H, b.tx, b.ty, k < N_WALL - 1 ? CORE : STONE_DK);
  battlement(m, a.o, b.o, H, [s.nx, s.ny]);
  // low kerb on the inner edge
  m.frameBox([(a.i[0] + b.i[0]) / 2 + s.nx * 0.25, (a.i[1] + b.i[1]) / 2 + s.ny * 0.25, H + 0.22], [(b.i[0] - a.i[0]) / 2, (b.i[1] - a.i[1]) / 2, 0], [s.nx * 0.25, s.ny * 0.25, 0], [0, 0, 0.22], STONE_LT);
  if (k % 4 === 2) buttress(m, [s.x + s.nx * (WALL_HALF + 0.5), s.y + s.ny * (WALL_HALF + 0.5)], [s.nx, s.ny], [s.tx, s.ty], 3.0, BASE, H - 2.2, 2.6);
  if (s.culvert) {
    // the culvert: a low barred arch where the stream runs out
    const gz = map.groundZ(s.ox, s.oy) + 0.2, x0 = WALL_HALF + 0.75;
    m.frame([s.x, s.y, gz], [s.nx, s.ny], [s.tx, s.ty], () => {
      m.withMat(MAT.PLAIN, () => { m.box(x0, 0, 1.0, 0.1, 4.0, 2.0, DARK); m.lathe([[2.0, 0], [2.0, 0.1]], 16, DARK, 0, [x0 - 0.05, 0, 2.0], 'x'); });
      for (let i = 0; i < 9; i++) {
        const t0 = (i / 9) * Math.PI, t1 = ((i + 1) / 9) * Math.PI, P = (t, r) => [-Math.cos(t) * r, 2.0 + Math.sin(t) * r];
        m.extrudeX([P(t0, 2.0), P(t1, 2.0), P(t1, 2.75), P(t0, 2.75)], x0 - 0.05, x0 + (i === 4 ? 0.4 : 0.25), i & 1 ? STONE_LT : STONE);
      }
      for (const sd of [-1, 1]) m.box(x0 + 0.1, sd * 2.38, 1.0, 0.3, 0.75, 2.0, STONE_LT);
      m.withMat(MAT.IRON, () => { for (let b2 = -3; b2 <= 3; b2++) m.box(x0 + 0.12, b2 * 0.55, 1.9, 0.09, 0.09, 3.8, IRON); for (const z of [0.9, 2.2]) m.box(x0 + 0.12, 0, z, 0.07, 4.0, 0.09, IRON); });
    });
  }
}

/** One 10-degree section of the Hornburg's curtain wall: plain wall, or a gate with its arch and leaves. */
function ringSection(m, segs, k) {
  const ringSeg = (j) => segs[N_WALL + ((j + N_RING) % N_RING)];
  const s = ringSeg(k);
  const R = KEEP.r, ri = R - KEEP.half, ro = R + KEEP.half, step = TAU / N_RING, RB = 2, top = RING_TOP;
  const P = (a, r) => [KEEP.cx + Math.cos(a) * r, KEEP.cy + Math.sin(a) * r];
  const a0 = k * step, a1 = (k + 1) * step, SUB = 4, BAT = 1.0;
  const isGate = s.kind !== 'ring';
  if (!s.valid && !isGate) return;
  if (!isGate) {
    const dk = dim(STONE, 0.6);
    for (let q = 0; q < SUB; q++) {
      const b0 = a0 + (step * q) / SUB, b1 = a0 + (step * (q + 1)) / SUB, am = (b0 + b1) / 2;
      const o0 = P(b0, ro), o1 = P(b1, ro), f0 = P(b0, ro + BAT), f1 = P(b1, ro + BAT), i0 = P(b0, ri), i1 = P(b1, ri);
      m.quadC([f0[0], f0[1], RB], [f1[0], f1[1], RB], [o1[0], o1[1], top], [o0[0], o0[1], top], [KEEP.cx, KEEP.cy, 10], dk, dk, STONE, STONE);
      m.wall(i0, i1, RB, top, -Math.cos(am), -Math.sin(am), STONE);
      m.floor(i0, o0, o1, i1, top, PAVE);
      battlement(m, o0, o1, top, [Math.cos(am), Math.sin(am)]);
      m.frameBox([(i0[0] + i1[0]) / 2 + Math.cos(am) * 0.25, (i0[1] + i1[1]) / 2 + Math.sin(am) * 0.25, top + 0.22], [(i1[0] - i0[0]) / 2, (i1[1] - i0[1]) / 2, 0], [Math.cos(am) * 0.25, Math.sin(am) * 0.25, 0], [0, 0, 0.22], STONE_LT);
    }
    if (!ringSeg(k - 1).valid) m.wall(P(a0, ri), P(a0, ro), RB, top, Math.sin(a0), -Math.cos(a0), STONE);
    if (!ringSeg(k + 1).valid) m.wall(P(a1, ri), P(a1, ro), RB, top, -Math.sin(a1), Math.cos(a1), STONE);
  } else {
    // an opening: jambs either side, masonry above, an arch through the thickness, and the leaves while they hold
    const j = s.kind === 'postern' ? 0.3 : s.kind === 'gate' ? 0.07 : 0.2, lz = s.kind === 'door' ? PLATEAU_Z + 4.6 : PLATEAU_Z + 6.6;
    arcPrism(m, a0, a0 + step * j, ri - 0.6, ro + 0.6, RB, top, STONE_DK);
    arcPrism(m, a1 - step * j, a1, ri - 0.6, ro + 0.6, RB, top, STONE_DK);
    arcPrism(m, a0 + step * j, a1 - step * j, ri, ro, lz, top, STONE, false);
    m.floor(P(a0 + step * j, ri), P(a0 + step * j, ro), P(a1 - step * j, ro), P(a1 - step * j, ri), PLATEAU_Z + 0.05, PAVE);
    const hw = s.len * (0.5 - j), th = KEEP.half + 0.62, Z = PLATEAU_Z;
    const rise = Math.min(2.4, hw * 0.5), Rr = (hw * hw + rise * rise) / (2 * rise), zc = lz - Rr;      // arch circle centre height
    m.frame([s.x, s.y, 0], [s.nx, s.ny], [s.tx, s.ty], () => {
      // the arch soffit, cut through the whole thickness of the wall
      const NS = 12, zArc = (y) => zc + Math.sqrt(Math.max(0, Rr * Rr - y * y));
      for (let i = 0; i < NS; i++) {
        const y0 = -hw + (2 * hw * i) / NS, y1 = -hw + (2 * hw * (i + 1)) / NS;
        if (lz + 0.1 - Math.min(zArc(y0), zArc(y1)) < 0.03) continue;
        m.prism([[-th, y0, zArc(y0)], [-th, y1, zArc(y1)], [-th, y1, lz + 0.1], [-th, y0, lz + 0.1]], [[th, y0, zArc(y0)], [th, y1, zArc(y1)], [th, y1, lz + 0.1], [th, y0, lz + 0.1]], STONE_DK);
      }
      // voussoirs and quoins framing the opening on both faces
      const A = Math.asin(Math.min(1, hw / Rr)), NV = s.kind === 'gate' ? 13 : 7;
      for (const fc of [1, -1]) {
        for (let i = 0; i < NV; i++) {
          const t0 = -A + (2 * A * i) / NV, t1 = -A + (2 * A * (i + 1)) / NV, key = i === (NV - 1) / 2, d = key ? 1.25 : 0.85;
          const Q = (t, r) => [Math.sin(t) * r, zc + Math.cos(t) * r];
          m.extrudeX([Q(t0, Rr), Q(t1, Rr), Q(t1, Rr + d), Q(t0, Rr + d)], fc * (th - 0.05), fc * (th + (key ? 0.5 : 0.3)), key || i % 2 ? STONE_LT : STONE);
        }
        const nq = Math.floor((lz - rise - Z) / 0.8);
        for (let q = 0; q < nq; q++) for (const sd of [-1, 1]) m.box(fc * (th + 0.12), sd * (hw + (q % 2 ? 0.35 : 0.55)), Z + 0.4 + q * 0.8, 0.3, q % 2 ? 0.7 : 1.1, 0.74, q % 2 ? STONE : STONE_LT);
      }
      if (s.kind === 'door' && !s.leaves) return; // (an open arch, unless the `door` rule hangs leaves in it)
      if (s.breached) { brokenGate(m, hw, lz); return; }
      // two leaves of upright planks, strapped and studded with iron
      const x = 3.2, H2 = lz - Z;
      m.withMat(MAT.TIMBER_V, () => { for (const sd of [-1, 1]) m.box(x, sd * hw / 2, Z + H2 / 2, 0.36, hw - 0.06, H2, WOOD); });
      m.withMat(MAT.IRON, () => {
        for (const zz of [0.16, 0.5, 0.84]) for (const sd of [-1, 1]) {
          m.box(x + 0.2, sd * hw / 2, Z + H2 * zz, 0.06, hw - 0.3, 0.22, IRON);
          const ns = Math.max(3, Math.round(hw / 0.7));
          for (let q = 0; q < ns; q++) m.box(x + 0.25, sd * ((q + 0.5) / ns) * (hw - 0.3), Z + H2 * zz, 0.08, 0.12, 0.12, dim(IRON, 1.5));
        }
        m.box(x + 0.21, 0, Z + H2 / 2, 0.05, 0.14, H2, dim(IRON, 0.7));
        for (const sd of [-1, 1]) m.lathe([[0.26, -0.05], [0.26, 0.05]], 10, dim(IRON, 1.4), 0, [x + 0.28, sd * 0.55, Z + H2 * 0.42], 'x');   // ring pulls
      });
    });
  }
  // turrets where sections meet; bigger ones flank the gate
  const gateSide = s.kind === 'gate' || ringSeg(k - 1).kind === 'gate';
  if ((k % 4 === 0 || gateSide) && (s.valid || ringSeg(k - 1).valid)) {
    const rr = gateSide ? 6.6 : 5.4;
    // the gate towers stand either side of the passage, not across it
    const at = gateSide ? a0 + (s.kind === 'gate' ? -1 : 1) * (rr - 0.4) / R : a0;
    turret(m, KEEP.cx + Math.cos(at) * (R + 1.5), KEEP.cy + Math.sin(at) * (R + 1.5), rr, RB, top + (gateSide ? 8 : 4));
  }
}

/** The gate after it has been forced (drawn in the gate's own frame: x out through the gate, y along the wall). */
function brokenGate(m, hw, lz) {
  seed = 333;
  const Z = PLATEAU_Z, H2 = lz - Z;
  m.withMat(MAT.TIMBER_V, () => {
    // one leaf torn down and flung inward, lying splintered across the passage
    m.push().translate(-5.5, 0.8, Z + 0.3).rotZ(0.35).rotY(0.08); m.box(0, 0, 0, H2 * 0.9, hw * 0.9, 0.3, dim(WOOD, 0.7)); m.pop();
    // the other still hangs from its top hinge, swung inward and twisted
    m.push().translate(1.4, hw - 0.3, Z + H2 / 2 + 0.5).rotZ(-2.25).rotX(0.12); m.box(hw * 0.5, 0, 0, hw - 0.2, 0.34, H2 - 0.8, dim(WOOD, 0.85)); m.pop();
  });
  // splinters and bent iron bands
  for (let k = 0; k < 14; k++) {
    const u = (rnd() - 0.5) * hw * 1.8, v = -1 - rnd() * 8, ang = rnd() * 6.28, L = 0.6 + rnd() * 1.8, iron = k % 3 === 0;
    m.mat = iron ? MAT.IRON : MAT.TIMBER;
    m.frameBox([v, u, Z + 0.15], [Math.cos(ang) * L, Math.sin(ang) * L, rnd() * 0.4], [-Math.sin(ang) * 0.14, Math.cos(ang) * 0.14, 0], [0, 0, 0.1], iron ? IRON : dim(WOOD, 0.9));
  }
  // scorched stone around the empty arch
  m.mat = MAT.PLAIN;
  for (const sd of [-1, 1]) m.box(5.16, sd * hw, Z + H2 / 2, 0.06, 1.0, H2, [0.12, 0.1, 0.09]);
  m.mat = MAT.ASHLAR;
}

/** Wall-walk stairs. */
function stairs(m, map) {
  for (const st of map.stairs) {
    const steps = 16, px = -st.dy, py = st.dx, run = (st.len - 2) / steps;
    for (let i = 0; i < steps; i++) {
      const a0 = i * run, zt = st.z0 + ((st.z1 - st.z0) * (i + 1)) / steps;
      const cx = st.x + st.dx * (a0 + run / 2), cy = st.y + st.dy * (a0 + run / 2);
      m.frameBox([cx, cy, (zt + st.z0 - 4) / 2], [st.dx * run / 2, st.dy * run / 2, 0], [px * st.half, py * st.half, 0], [0, 0, (zt - st.z0 + 4) / 2], i & 1 ? STONE : STONE_LT);
    }
    const cx = st.x + st.dx * (st.len - 1), cy = st.y + st.dy * (st.len - 1);
    m.frameBox([cx, cy, (st.z1 + st.z0 - 4) / 2], [st.dx, st.dy, 0], [px * st.half, py * st.half, 0], [0, 0, (st.z1 - st.z0 + 4) / 2], PAVE);
    // a stepped balustrade down each side
    for (const sd of [-1, 1]) for (let i = 0; i < steps; i += 4) {
      const a0 = (i + 2) * run, zt = st.z0 + ((st.z1 - st.z0) * (i + 4)) / steps;
      m.frameBox([st.x + st.dx * a0 + px * (st.half + 0.2) * sd, st.y + st.dy * a0 + py * (st.half + 0.2) * sd, zt + 0.4], [st.dx * run * 2, st.dy * run * 2, 0], [px * 0.22, py * 0.22, 0], [0, 0, 0.5], STONE_LT);
    }
  }
}

/** The inner ward: two terraces climbing the rock, their halls and steps, and the great tower. */
function innerWard(m, map) {
  const buried = (x, y, z) => map.terrZ(x, y) > z + 1.5; // set into the mountain: no need for parapets
  const terrace = (t, z0, n = 44) => {
    // battered retaining wall with a string course under the parapet
    m.lathe([[t.r + 1.5, z0], [t.r + 0.1, t.z - 2.1], [t.r + 0.1, t.z - 2.1], [t.r + 0.45, t.z - 1.95], [t.r + 0.45, t.z - 1.7], [t.r + 0.1, t.z - 1.55], [t.r + 0.1, t.z - 1.55], [t.r, t.z], [t.r, t.z], [0, t.z, PAVE]], n, STONE_DK, 0, [t.x, t.y, 0], 'z', { capA: false });
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * TAU, a1 = ((k + 1) / n) * TAU, am = (a0 + a1) / 2;
      const p = [t.x + Math.cos(a0) * t.r, t.y + Math.sin(a0) * t.r], q = [t.x + Math.cos(a1) * t.r, t.y + Math.sin(a1) * t.r];
      if (!buried((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, t.z)) battlement(m, p, q, t.z, [Math.cos(am), Math.sin(am)]);
      if (k % 4 === 1 && !buried(t.x + Math.cos(am) * (t.r + 2), t.y + Math.sin(am) * (t.r + 2), z0)) {
        buttress(m, [t.x + Math.cos(am) * (t.r + 0.3), t.y + Math.sin(am) * (t.r + 0.3)], [Math.cos(am), Math.sin(am)], [-Math.sin(am), Math.cos(am)], 2.4, z0, t.z - 2.3, 2.6);
      }
    }
  };
  /** A flight of steps hugging a retaining wall, climbing from z0 to z1 along the tangent at angle a. */
  const flight = (t, a, dir, z0, z1, len = 14, w = 3) => {
    const c = Math.cos(a), s2 = Math.sin(a), tx = -s2 * dir, ty = c * dir, r = t.r + 1.4 + w / 2;
    const bx = t.x + c * r, by = t.y + s2 * r, steps = 14, run = len / steps;
    for (let i = 0; i < steps; i++) {
      const zt = z0 + ((z1 - z0) * (i + 1)) / steps, u = (i + 0.5) * run - len / 2;
      m.frameBox([bx + tx * u, by + ty * u, (zt + z0 - 1) / 2], [tx * run / 2, ty * run / 2, 0], [c * w / 2, s2 * w / 2, 0], [0, 0, (zt - z0 + 1) / 2], i & 1 ? STONE : STONE_LT);
    }
    // a low wall with a coping on the open side of the flight
    m.frameBox([bx + c * (w / 2 + 0.3), by + s2 * (w / 2 + 0.3), (z0 + z1) / 2 + 0.2], [tx * len / 2, ty * len / 2, (z1 - z0) / 2], [c * 0.3, s2 * 0.3, 0], [0, 0, 0.7], STONE_LT);
    m.frameBox([bx + c * (w / 2 + 0.3), by + s2 * (w / 2 + 0.3), (z0 + z1) / 2 + 0.98], [tx * len / 2, ty * len / 2, (z1 - z0) / 2], [c * 0.4, s2 * 0.4, 0], [0, 0, 0.09], STONE);
  };
  /**
   * A stone hall with a steep slate roof; a = heading of its long axis. Plinth, quoined corners,
   * framed windows (some lit), a door, coped gables with a round light, and buttresses on tall walls.
   */
  const hall = (x, y, a, L, W, z0, h, roofH = 6) => {
    const hl = L / 2, hw = W / 2, zt = z0 + h;
    m.frame([x, y, 0], [Math.cos(a), Math.sin(a)], [-Math.sin(a), Math.cos(a)], () => {
      m.box(0, 0, (z0 - 1 + zt) / 2, L, W, zt - z0 + 1, STONE);
      m.box(0, 0, z0 + 0.45, L + 0.5, W + 0.5, 0.9, STONE_DK);                                      // plinth
      m.box(0, 0, zt - 0.2, L + 0.36, W + 0.36, 0.4, STONE_LT);                                     // eaves course
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (let q = 0; q * 0.8 < h - 1.4; q++) m.box(sx * (hl + 0.02), sy * (hw + 0.02), z0 + 1.3 + q * 0.8, q % 2 ? 0.9 : 0.5, q % 2 ? 0.5 : 0.9, 0.74, STONE_LT);
      // roof: two thick slopes oversailing the walls, a ridge, and coped gables
      const e = 0.75, t = 0.28;
      m.withMat(MAT.SLATE, () => {
        for (const sd of [-1, 1]) m.prism([[-hl - e, sd * (hw + e), zt - 0.15], [hl + e, sd * (hw + e), zt - 0.15], [hl + e, 0, zt + roofH], [-hl - e, 0, zt + roofH]], [[-hl - e, sd * (hw + e), zt - 0.15 + t], [hl + e, sd * (hw + e), zt - 0.15 + t], [hl + e, 0, zt + roofH + t], [-hl - e, 0, zt + roofH + t]], SLATE);
        m.box(0, 0, zt + roofH + t + 0.05, L + 2 * e + 0.1, 0.36, 0.26, dim(SLATE, 0.75));
      });
      for (const sd of [-1, 1]) {
        m.tri([sd * hl, -hw, zt], [sd * hl, hw, zt], [sd * hl, 0, zt + roofH - 0.3], STONE);
        m.tri([sd * hl, hw, zt], [sd * hl, -hw, zt], [sd * hl, 0, zt + roofH - 0.3], STONE);
        for (const sy of [-1, 1]) m.beam([sd * (hl + 0.2), sy * (hw + 0.5), zt + 0.1], [sd * (hl + 0.2), 0, zt + roofH + 0.45], 0.42, STONE_LT);   // gable coping
        m.push().translate(sd * (hl + 0.03), 0, zt + roofH * 0.35); if (sd < 0) m.rotZ(Math.PI);
        m.lathe([[0.95, 0], [0.95, 0.1], [0.7, 0.1], [0.7, 0.1]], 12, STONE_LT, 0, [0, 0, 0], 'x');
        m.withMat(MAT.EMIT, () => m.lathe([[0.68, 0.06], [0, 0.06]], 12, dim(LAMP, 0.8), 0, [0, 0, 0], 'x', { capA: true }));
        m.pop();
      }
      // windows down both long sides, with sills and lintels; every third one is lit
      const nw = Math.max(2, Math.round(L / 4.5)), wh = Math.min(3.2, h * 0.36), wz = z0 + h * 0.56;
      for (let k = 0; k < nw; k++) for (const sd of [-1, 1]) {
        const u = ((k + 0.5) / nw - 0.5) * L * 0.86;
        m.push().translate(u, sd * hw, wz).rotZ((sd * Math.PI) / 2);
        m.box(0.06, 0, 0, 0.12, 1.3, wh + 0.5, STONE_LT);
        slit(m, 0.12, 0, 0, 0.78, wh, (k + (sd > 0 ? 1 : 0)) % 3 === 0);
        m.box(0.14, 0, -wh / 2 - 0.22, 0.3, 1.5, 0.2, STONE_LT);
        m.withMat(MAT.IRON, () => { m.box(0.16, 0, 0, 0.05, 0.06, wh, IRON); m.box(0.16, 0, 0.1, 0.05, 0.78, 0.06, IRON); });
        m.pop();
        if (h > 9 && k < nw - 1) buttress(m, [u + (L * 0.43) / nw, sd * (hw - 0.1)], [0, sd], [1, 0], 1.3, z0, zt - 1.2, 1.5, STONE);
      }
      // the door, in the middle of one long side
      m.push().translate(0, hw, z0).rotZ(Math.PI / 2);
      m.box(0.1, 0, 1.7, 0.2, 2.6, 3.6, STONE_LT);
      m.withMat(MAT.TIMBER_V, () => m.box(0.2, 0, 1.5, 0.12, 1.9, 3.0, WOOD));
      m.withMat(MAT.IRON, () => { for (const z of [0.7, 2.2]) m.box(0.28, 0, z, 0.04, 1.7, 0.14, IRON); });
      m.pop();
    });
  };
  const t1 = KEEP.t1, t2 = KEEP.t2, tw = KEEP.tower;
  terrace(t1, PLATEAU_Z - 1);
  terrace(t2, t1.z - 1, 36);
  // steps from the outer court up to the middle ward, and on up to the citadel
  flight(t1, 206 * DEG, -1, PLATEAU_Z, t1.z, 16);
  flight(t1, 262 * DEG, 1, PLATEAU_Z, t1.z, 16);
  flight(t2, 218 * DEG, -1, t1.z, t2.z, 15, 2.8);
  // the middle ward: barracks, stores and the old hall
  hall(t1.x + Math.cos(250 * DEG) * 31, t1.y + Math.sin(250 * DEG) * 31, 340 * DEG, 18, 9, t1.z, 7);
  hall(t1.x + Math.cos(300 * DEG) * 33, t1.y + Math.sin(300 * DEG) * 33, 30 * DEG, 14, 8, t1.z, 6, 5);
  hall(t1.x + Math.cos(196 * DEG) * 32, t1.y + Math.sin(196 * DEG) * 32, 106 * DEG, 13, 8, t1.z, 6, 5);
  for (const a of [228, 322]) turret(m, t1.x + Math.cos(a * DEG) * (t1.r + 0.5), t1.y + Math.sin(a * DEG) * (t1.r + 0.5), 4.4, PLATEAU_Z - 1, t1.z + 7);
  // the citadel: the keep's great hall abutting the tower
  {
    const a = Math.atan2(t2.y - tw.y, t2.x - tw.x) + Math.PI * 0.12;
    const hx = tw.x + Math.cos(a + Math.PI) * -15, hy = tw.y + Math.sin(a + Math.PI) * -15;
    hall(hx, hy, a + Math.PI / 2, 24, 13, t2.z, 16, 8);
    for (const sd of [-1, 1]) {
      const c = Math.cos(a + Math.PI / 2), s2 = Math.sin(a + Math.PI / 2);
      turret(m, hx + c * 12.5 * sd + Math.cos(a) * 6.5, hy + s2 * 12.5 * sd + Math.sin(a) * 6.5, 3.2, t2.z, t2.z + 22);
    }
  }
  turret(m, t2.x + Math.cos(200 * DEG) * (t2.r + 0.3), t2.y + Math.sin(200 * DEG) * (t2.r + 0.3), 4, t1.z - 1, t2.z + 8);
  greatTower(m, tw.x, tw.y, tw.r, t2.z);
}

/** The great tower: battered base, a long shaft in stages, a corbelled gallery, a lantern and a slate spire. */
function greatTower(m, x, y, r, z) {
  const n = 28;
  m.lathe([[r + 2.4, -4], [r + 0.45, 8], [r + 0.45, 8], [r + 0.8, 8.25], [r + 0.8, 8.8], [r + 0.4, 9.05], [r + 0.4, 9.05],
    [r - 0.5, 30], [r - 0.5, 30], [r + 0.2, 30.3], [r + 0.2, 31.1], [r - 0.6, 31.4], [r - 0.6, 31.4],
    [r - 1.7, 51.3], [r - 1.7, 51.3], [r + 0.5, 53.6], [r + 0.5, 54.5], [r + 0.5, 54.5], [0, 54.5, PAVE]], n, STONE, 0, [x, y, z], 'z', { capA: false });
  // corbels under the gallery and its parapet
  const ng = 26;
  for (let k = 0; k < ng; k++) {
    const a = (k / ng) * TAU, c = Math.cos(a), s = Math.sin(a), w = 1.5;
    m.frame([x + c * (r + 0.5), y + s * (r + 0.5), z + 54.5], [c, s], [-s, c], () => {
      m.box(-0.6, 0, -1.6, 1.2, 0.5, 0.9, STONE_DK);
      m.box(-0.32, 0, 0.5, 0.64, (TAU * (r + 0.5)) / ng + 0.08, 1.0, STONE_LT);
      m.box(-0.32, 0, 1.5, 0.64, w, 1.0, STONE_LT);
      const b = (sx, sy) => [-0.32 + sx * 0.32, sy * w / 2, 2.0], t = (sx, sy) => [-0.32 + sx * 0.1, sy * (w / 2 - 0.14), 2.26];
      m.prism([b(-1, -1), b(1, -1), b(1, 1), b(-1, 1)], [t(-1, -1), t(1, -1), t(1, 1), t(-1, 1)], STONE);
    });
  }
  // the lantern: a narrower drum ringed with tall lights, crowned with its own battlements
  const r2 = r - 4.6;
  m.lathe([[r2 + 0.5, 54.5], [r2, 56.5], [r2, 64.6], [r2, 64.6], [r2 + 0.55, 65.5], [r2 + 0.55, 66.4], [r2 + 0.55, 66.4], [0, 66.4, PAVE]], 20, STONE, 0, [x, y, z], 'z', { capA: false });
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU + 0.2, c = Math.cos(a), s = Math.sin(a);
    m.frame([x + c * r2, y + s * r2, z + 60.4], [c, s], [-s, c], () => {
      m.box(0, 0, 0, 0.2, 1.3, 4.6, STONE_LT);
      slit(m, 0.1, 0, 0, 0.7, 3.8, k % 2 === 0);
    });
    m.frame([x + c * (r2 + 0.55), y + s * (r2 + 0.55), z + 66.4], [c, s], [-s, c], () => { m.box(-0.3, 0, 0.4, 0.6, 2.4, 0.8, STONE_LT); m.box(-0.3, 0, 1.2, 0.6, 1.2, 0.8, STONE_LT); });
  }
  // the spire: slate with a flared eave, and an iron finial
  m.withMat(MAT.SLATE, () => m.lathe([[r2 + 0.3, 66.6], [r2 - 0.5, 68], [r2 - 1.4, 71], [2.6, 78], [0.9, 85], [0, 88.5]], 16, SLATE, 0, [x, y, z], 'z', { capA: false }));
  m.withMat(MAT.IRON, () => { m.tube([x, y, z + 88], [x, y, z + 92.5], 0.12, 0.05, 6, [0.45, 0.4, 0.25]); m.sphere([x, y, z + 89.4], 0.42, [0.6, 0.5, 0.25], 0, 8, 5); });
  // buttresses up the base, and windows in every bay: narrow loops below, taller lights above
  for (let k = 0; k < 6; k++) {
    const a = 0.4 + k * 1.0472, c = Math.cos(a), s = Math.sin(a);
    buttress(m, [x + c * (r + 0.6), y + s * (r + 0.6)], [c, s], [-s, c], 2.6, z - 4, z + 27, 3.4);
    for (const zz of [14, 24, 38, 46]) {
      const rr = zz < 30 ? r + 0.4 - (zz - 8) * 0.041 : r - 0.6 - (zz - 31.4) * 0.055, b = a + 0.52;
      m.frame([x + Math.cos(b) * rr, y + Math.sin(b) * rr, z + zz], [Math.cos(b), Math.sin(b)], [-Math.sin(b), Math.cos(b)], () => {
        const tall = zz > 30;
        m.box(0, 0, 0, 0.24, tall ? 1.5 : 1.0, tall ? 4.2 : 3.0, STONE_LT);
        slit(m, 0.12, 0, 0, tall ? 0.8 : 0.4, tall ? 3.4 : 2.4, (k + zz) % 3 === 0);
        m.box(0.1, 0, tall ? -2.3 : -1.7, 0.4, tall ? 1.8 : 1.3, 0.24, STONE_LT);
      });
    }
  }
}

/**
 * Build (or refresh) the fortress mesh. `cache` carries the built pieces between calls.
 * Returns { data, count } in the 20-byte vertex layout, unindexed.
 */
export function buildStructures(map, segs, cache = new Map()) {
  const H = WALL_H, BASE = -4, pieces = [];
  const piece = (id, key, fn) => {
    let c = cache.get(id);
    if (!c || c.key !== key) { const m = new MeshBuilder(); m.mat = MAT.ASHLAR; seed = 4242; fn(m); c = { key, mesh: m.build(false) }; cache.set(id, c); }
    pieces.push(c.mesh);
  };
  const bound = [];
  for (let k = 0; k <= N_WALL; k++) {
    const p = map.wallAt(k / N_WALL);
    let nx = p.ty, ny = -p.tx; if (nx > 0) { nx = -nx; ny = -ny; }
    bound.push({ o: [p.x + nx * WALL_HALF, p.y + ny * WALL_HALF], i: [p.x - nx * WALL_HALF, p.y - ny * WALL_HALF], nx, ny, tx: p.tx, ty: p.ty });
  }
  const down = (k) => (k >= 0 && k < N_WALL && segs[k].breached ? 1 : 0);
  for (let k = 0; k < N_WALL; k++) piece('w' + k, `${down(k)}${down(k - 1)}${down(k + 1)}`, (m) => wallSection(m, map, segs, k, bound, H, BASE));
  for (let k = 0; k < N_RING; k++) piece('r' + k, (segs[N_WALL + k].breached ? '1' : '0') + (segs[N_WALL + k].leaves ? 'L' : ''), (m) => ringSection(m, segs, k));
  piece('stairs', '', (m) => stairs(m, map));
  piece('ward', '', (m) => innerWard(m, map));
  piece('ramps', '', (m) => { ramp(m, map.causeway, map.causeHalf, map.rampZ, -3, true); ramp(m, map.rear, map.rearHalf, map.rampZ, -3, true); });
  for (const s of segs) if (s.breached) piece('x' + s.id, '', (m) => rubble(m, map, s));
  let bytes = 0;
  for (const p of pieces) bytes += p.data.byteLength;
  const out = new Uint8Array(bytes);
  let o = 0;
  for (const p of pieces) { out.set(new Uint8Array(p.data), o); o += p.data.byteLength; }
  return { data: out.buffer, count: bytes / 20 };
}
