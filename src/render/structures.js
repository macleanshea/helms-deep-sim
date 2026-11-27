// Builds the fortress: the Deeping Wall, the Hornburg's ring wall with its bastions and gatehouse, the two inner
// courts stepping up to the cliff with the hall and the horn tower, the causeway, stairs, and the wreckage of
// anything breached. Where things stand is the map's business (src/map.js): nothing is drawn here that the map
// does not know about, so what looks solid is solid and what looks like a stair can be climbed. It is assembled from independent pieces that are cached, so when a section falls only
// that section (and its neighbours' torn ends) is rebuilt.
//
// Stone carries MAT.ASHLAR everywhere: the shader lays coursed blocks on upright faces and
// flagstones on level ones.

import { MeshBuilder } from './mesh.js';
import { dim } from './models/figure.js';
import { MAT } from './materials.js';
import { KEEP, N_WALL, N_RING, WALL_HALF } from '../map.js';
import { WALL_H, PLATEAU_Z, RING_TOP, WAY_STEP } from '../config.js';

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
 * Battlements along the edge from p to q (z = walkway height), facing n. Heavy and plain, as on the Hornburg: a
 * breast wall with a string course under it, and broad merlons with a weathered coping, each with one loop; between
 * them narrow embrasures with a sloped sill. No two merlons are quite alike, and here and there one is broken.
 */
function battlement(m, p, q, z, n, col = STONE_LT) {
  const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
  if (L < 0.2) return;
  // (the merlons' places are counted along the world, not along this stretch, so they keep their rhythm from one
  // stretch of wall to the next instead of starting again at every joint)
  const PITCH = 3.6, s0 = (p[0] * 0.731 + p[1] * 0.683), h01 = (k) => { const v = Math.sin(k * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  m.frame([p[0], p[1], z], n, [dx / L, dy / L], () => {
    m.box(0.16, L / 2, -0.62, 0.5, L, 0.34, STONE_DK);                    // string course under the parapet
    m.box(0.02, L / 2, 0.55, 0.78, L, 1.1, col);                          // breast wall
    const k0 = Math.floor(s0 / PITCH), off = s0 - k0 * PITCH;
    for (let k = -1; k * PITCH - off < L; k++) {
      const c0 = k * PITCH - off, a = Math.max(0, c0 + 0.5), b = Math.min(L, c0 + PITCH - 0.6);   // a merlon, less the embrasure after it
      if (b - a < 0.5) continue;
      const id = k0 + k, r = h01(id), broken = r > 0.9, h = broken ? 0.5 + h01(id + 0.5) * 0.7 : 1.45 + (r - 0.5) * 0.14, y = (a + b) / 2, w = b - a;
      m.box(0.02, y, 1.1 + h / 2, 0.78, w, h, col);
      if (!broken) {
        const e = 0.47, t = 0.2;
        m.prism([[0.02 - e, a - 0.06, 1.1 + h], [0.02 + e, a - 0.06, 1.1 + h], [0.02 + e, b + 0.06, 1.1 + h], [0.02 - e, b + 0.06, 1.1 + h]],
          [[0.02 - e + t, a + 0.08, 1.1 + h + 0.26], [0.02 + e - t, a + 0.08, 1.1 + h + 0.26], [0.02 + e - t, b - 0.08, 1.1 + h + 0.26], [0.02 - e + t, b - 0.08, 1.1 + h + 0.26]], STONE);
        if (w > 1.6) slit(m, 0.42, y, 1.1 + h * 0.5, 0.14, h * 0.62);
      } else if (w > 1.2) {
        m.box(0.02, a + w * 0.3, 1.1 + h + 0.2, 0.7, w * 0.36, 0.4, STONE_DK, 0, 0.12);   // a stump of it still standing
      }
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
    if (Math.min(a.z, b.z) <= WAY_STEP) continue; // (below this the roadway is stepped onto from the ground: no wall there)
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
    // the culvert: a low barred arch on each face of the wall, where the stream runs in from the Deep and out to the valley
    const mouth = (nx, ny, tx, ty, x0) => {
      const gz = map.groundZ(s.x + nx * (WALL_HALF + 3), s.y + ny * (WALL_HALF + 3)) + 0.2;
      m.frame([s.x, s.y, gz], [nx, ny], [tx, ty], () => {
        m.withMat(MAT.PLAIN, () => { m.box(x0, 0, 1.0, 0.1, 4.0, 2.0, DARK); m.lathe([[2.0, 0], [2.0, 0.1]], 16, DARK, 0, [x0 - 0.05, 0, 2.0], 'x'); });
        for (let i = 0; i < 9; i++) {
          const t0 = (i / 9) * Math.PI, t1 = ((i + 1) / 9) * Math.PI, P = (t, r) => [-Math.cos(t) * r, 2.0 + Math.sin(t) * r];
          m.extrudeX([P(t0, 2.0), P(t1, 2.0), P(t1, 2.75), P(t0, 2.75)], x0 - 0.05, x0 + (i === 4 ? 0.4 : 0.25), i & 1 ? STONE_LT : STONE);
        }
        for (const sd of [-1, 1]) m.box(x0 + 0.1, sd * 2.38, 1.0, 0.3, 0.75, 2.0, STONE_LT);
        m.withMat(MAT.IRON, () => { for (let b2 = -3; b2 <= 3; b2++) m.box(x0 + 0.12, b2 * 0.55, 1.9, 0.09, 0.09, 3.8, IRON); for (const z of [0.9, 2.2]) m.box(x0 + 0.12, 0, z, 0.07, 4.0, 0.09, IRON); });
      });
    };
    mouth(s.nx, s.ny, s.tx, s.ty, WALL_HALF + 0.75);      // the valley face leans back, so its arch stands a little proud
    mouth(-s.nx, -s.ny, -s.tx, -s.ty, WALL_HALF + 0.06);  // the face toward the Deep is upright
  }
}

/** Is this point on one of the platforms that stand out from the ring wall (a bastion, or a flank of the gatehouse)? */
function onPlatform(map, x, y, pad = 0) {
  for (const b of map.bastions) if (Math.hypot(x - b.x, y - b.y) < b.r - 0.3 + pad) return true;
  const g = map.segments[map.GATE], rx = x - g.x, ry = y - g.y, u = rx * g.nx + ry * g.ny, v = Math.abs(rx * g.tx + ry * g.ty), f = map.flanks[0];
  return u > f.u0 - 2 && u < f.u1 + pad && v > f.v0 - pad && v < f.v1 + pad;
}

/**
 * A platform standing out from a wall, level with its walk: `pts` is its outline (closed, either way round), and
 * `open[i]` says the edge from point i to the next stands free (it gets a battered face and battlements) or lies
 * against the wall (nothing is drawn there: the walk runs straight onto the platform).
 */
function platform(m, pts, open, z0, z1) {
  const n = pts.length, c = [0, 0];
  for (const p of pts) { c[0] += p[0] / n; c[1] += p[1] / n; }
  const dk = dim(STONE, 0.6), BAT = 1.0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    // the top, a fan about the middle (wound to face up)
    const up = (p[0] - c[0]) * (q[1] - c[1]) - (p[1] - c[1]) * (q[0] - c[0]) > 0;
    m.tri([c[0], c[1], z1], up ? [p[0], p[1], z1] : [q[0], q[1], z1], up ? [q[0], q[1], z1] : [p[0], p[1], z1], PAVE);
    if (!open[i]) continue;
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
    let nx = dy / l, ny = -dx / l;
    if (nx * ((p[0] + q[0]) / 2 - c[0]) + ny * ((p[1] + q[1]) / 2 - c[1]) < 0) { nx = -nx; ny = -ny; }
    m.quadC([p[0] + nx * BAT, p[1] + ny * BAT, z0], [q[0] + nx * BAT, q[1] + ny * BAT, z0], [q[0], q[1], z1], [p[0], p[1], z1], [c[0], c[1], (z0 + z1) / 2], dk, dk, STONE, STONE);
    battlement(m, p, q, z1, [nx, ny]);
  }
}

/** The platforms of the ring wall: its bastions, and the two that flank the gate. Their places are the map's. */
function platforms(m, map) {
  const R = KEEP.r, ro = R + KEEP.half, RB = 2;
  for (const b of map.bastions) {
    // the part of the bastion's round that stands outside the wall's face, closed along that face
    const arc = [];
    for (let k = -28; k <= 28; k++) {
      const a = b.a + (k / 28) * Math.PI * 0.98, p = [b.x + Math.cos(a) * b.r, b.y + Math.sin(a) * b.r];
      if (Math.hypot(p[0] - KEEP.cx, p[1] - KEEP.cy) > ro) arc.push(p);
    }
    if (arc.length < 3) continue;
    const ang = (p) => Math.atan2(p[1] - KEEP.cy, p[0] - KEEP.cx), a0 = ang(arc[arc.length - 1]);
    let da = ang(arc[0]) - a0; da -= Math.round(da / TAU) * TAU;
    const back = [];
    for (let k = 1; k < 6; k++) back.push([KEEP.cx + Math.cos(a0 + (da * k) / 6) * ro, KEEP.cy + Math.sin(a0 + (da * k) / 6) * ro]);
    platform(m, [...arc, ...back], [...arc.map((_, i) => i < arc.length - 1), ...back.map(() => false)], RB, RING_TOP);
  }
  const g = map.segments[map.GATE];
  for (const f of map.flanks) {
    const P = (u, v) => [g.x + g.nx * u + g.tx * v * f.sd, g.y + g.ny * u + g.ty * v * f.sd], face = (v) => Math.sqrt(ro * ro - v * v) - R;
    const pts = [P(face(f.v0), f.v0), P(f.u1, f.v0), P(f.u1, f.v1), P(face(f.v1), f.v1)], open = [true, true, true];
    for (let k = 1; k < 4; k++) { const v = f.v1 + ((f.v0 - f.v1) * k) / 4; pts.push(P(face(v), v)); }
    platform(m, pts, [...open, false, false, false, false], RB, RING_TOP);
  }
}

/** One 10-degree section of the Hornburg's curtain wall: plain wall, or a gate with its arch and leaves. */
function ringSection(m, map, segs, k) {
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
      if (!onPlatform(map, KEEP.cx + Math.cos(am) * (ro + 1), KEEP.cy + Math.sin(am) * (ro + 1))) battlement(m, o0, o1, top, [Math.cos(am), Math.sin(am)]);
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
      if (s.kind === 'door' && !s.leaves) return; // (an open arch, unless the battle has hung leaves in it)
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

/**
 * Wall-walk stairs: a flight of solid steps laid against the inner face of a wall, with one sloping parapet on
 * its open side. (Which side is the wall's is read off the map, so a flight can be laid along any wall.)
 */
function stairs(m, map) {
  for (const st of map.stairs) {
    if (st.arc) {
      // a flight curving round the drum of one of the inner courts: wedge-shaped steps, the drum on its inner side,
      // a parapet on the outer, and a landing at the head level with the court
      const run = st.len - 2, steps = Math.max(8, Math.round(run / 1.15)), da = st.a1 - st.a0, ri = st.r - st.half, ro = st.r + st.half, rise = st.z1 - st.z0;
      const P = (a, r, z) => [st.cx + Math.cos(a) * r, st.cy + Math.sin(a) * r, z], ang = (d) => st.a0 + (da * d) / st.len;
      for (let i = 0; i <= steps; i++) {
        const a0 = ang(i < steps ? (i * run) / steps : run), a1 = ang(i < steps ? ((i + 1) * run) / steps : st.len), zt = i < steps ? st.z0 + (rise * (i + 1)) / steps : st.z1, zb = st.z0 - 2;
        m.prism([P(a0, ri, zb), P(a1, ri, zb), P(a1, ro, zb), P(a0, ro, zb)], [P(a0, ri, zt), P(a1, ri, zt), P(a1, ro, zt), P(a0, ro, zt)], i === steps ? PAVE : i & 1 ? STONE : STONE_LT);
        // the parapet on the open side, stepping up with the flight
        m.prism([P(a0, ro - 0.5, zt), P(a1, ro - 0.5, zt), P(a1, ro, zt), P(a0, ro, zt)], [P(a0, ro - 0.5, zt + 1.15), P(a1, ro - 0.5, zt + 1.15), P(a1, ro, zt + 1.15), P(a0, ro, zt + 1.15)], STONE_LT);
      }
      continue;
    }
    const steps = 16, px = -st.dy, py = st.dx, run = (st.len - 2) / steps, rise = st.z1 - st.z0;
    const probe = (sd) => map.seg[map.cellOf(st.x + st.dx * st.len * 0.6 + px * (st.half + 2.5) * sd, st.y + st.dy * st.len * 0.6 + py * (st.half + 2.5) * sd)] >= 0;
    const open = probe(1) ? -1 : 1;
    for (let i = 0; i < steps; i++) {
      const a0 = i * run, zt = st.z0 + (rise * (i + 1)) / steps;
      const cx = st.x + st.dx * (a0 + run / 2), cy = st.y + st.dy * (a0 + run / 2);
      m.frameBox([cx, cy, (zt + st.z0 - 4) / 2], [st.dx * run / 2, st.dy * run / 2, 0], [px * st.half, py * st.half, 0], [0, 0, (zt - st.z0 + 4) / 2], i & 1 ? STONE : STONE_LT);
    }
    // the landing at the head, level with the walk
    const hx = st.x + st.dx * (st.len - 1), hy = st.y + st.dy * (st.len - 1);
    m.frameBox([hx, hy, (st.z1 + st.z0 - 4) / 2], [st.dx, st.dy, 0], [px * st.half, py * st.half, 0], [0, 0, (rise + 4) / 2], PAVE);
    // the parapet: a low wall climbing with the steps, a coping on it, and a block to end it at the head
    const L = st.len - 2, ox = px * (st.half - 0.26) * open, oy = py * (st.half - 0.26) * open, mx = st.x + st.dx * L / 2 + ox, my = st.y + st.dy * L / 2 + oy;
    m.frameBox([mx, my, st.z0 + rise / 2 + 0.75], [st.dx * L / 2, st.dy * L / 2, rise / 2], [px * 0.26, py * 0.26, 0], [0, 0, 0.6], STONE_LT);
    m.frameBox([mx, my, st.z0 + rise / 2 + 1.42], [st.dx * L / 2, st.dy * L / 2, rise / 2], [px * 0.36, py * 0.36, 0], [0, 0, 0.09], STONE);
    m.frameBox([hx + ox, hy + oy, st.z1 + 0.7], [st.dx, st.dy, 0], [px * 0.26, py * 0.26, 0], [0, 0, 0.7], STONE_LT);
  }
}

/**
 * The Hornburg's inner courts: the great drum of the inner court, the upper court against the cliff with the hall
 * cut into the rock behind it, and the horn tower. Their heights and the heads of their stairs are the map's.
 */
function innerWard(m, map) {
  const buried = (x, y, z) => map.terrZ(x, y) > z + 1.5; // set into the mountain: no need for parapets
  const court = (t, tier, z0, n = 72) => {
    // battered retaining wall with a string course under the parapet
    m.lathe([[t.r + 1.5, z0], [t.r + 0.1, t.z - 2.1], [t.r + 0.1, t.z - 2.1], [t.r + 0.45, t.z - 1.95], [t.r + 0.45, t.z - 1.7], [t.r + 0.1, t.z - 1.55], [t.r + 0.1, t.z - 1.55], [t.r, t.z], [t.r, t.z], [0, t.z, PAVE]], n, STONE_DK, 0, [t.x, t.y, 0], 'z', { capA: false });
    // the parapet is left open where a flight arrives, and where another court's drum or the tower stands against it
    const heads = map.stairs.filter((st) => st.arc && st.tier === tier).map((st) => st.a1 - (Math.sign(st.a1 - st.a0) * 1.3) / st.r);
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * TAU, a1 = ((k + 1) / n) * TAU, am = (a0 + a1) / 2;
      const p = [t.x + Math.cos(a0) * t.r, t.y + Math.sin(a0) * t.r], q = [t.x + Math.cos(a1) * t.r, t.y + Math.sin(a1) * t.r], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      const head = heads.some((h) => { let d = am - h; d -= Math.round(d / TAU) * TAU; return Math.abs(d) * t.r < 2.6; });
      const inner = tier === 1 && Math.hypot(mx - KEEP.t2.x, my - KEEP.t2.y) < KEEP.t2.r + 1;
      const tower = Math.hypot(mx - KEEP.tower.x, my - KEEP.tower.y) < KEEP.tower.r + 2.2;
      if (!head && !inner && !tower && !buried(mx, my, t.z)) battlement(m, p, q, t.z, [Math.cos(am), Math.sin(am)]);
      if (k % 6 === 1 && !buried(t.x + Math.cos(am) * (t.r + 2), t.y + Math.sin(am) * (t.r + 2), z0) && !map.stairs.some((st) => map.alongStair(st, t.x + Math.cos(am) * (t.r + 3), t.y + Math.sin(am) * (t.r + 3)) >= 0)) {
        buttress(m, [t.x + Math.cos(am) * (t.r + 0.3), t.y + Math.sin(am) * (t.r + 0.3)], [Math.cos(am), Math.sin(am)], [-Math.sin(am), Math.cos(am)], 2.4, z0, t.z - 2.3, 2.6);
      }
    }
  };
  const t1 = KEEP.t1, t2 = KEEP.t2, tw = KEEP.tower;
  court(t1, 1, PLATEAU_Z - 1);
  court(t2, 2, PLATEAU_Z - 1, 48);
  hornTower(m, tw.x, tw.y, tw.r, PLATEAU_Z - 1, tw.top);
  hallArcade(m, map, t2);
}

/**
 * The horn tower: a slender eight-sided shaft on a spreading foot, held by tall buttresses, tapering to an open
 * belfry of arches under a flat crown. The great horn is slung in the belfry, its mouth to the valley.
 */
function hornTower(m, x, y, r, z0, zt) {
  const n = 8, zb = zt - 11, rt = r * 0.74; // zb: the belfry floor
  m.lathe([[r + 3.2, z0 - 3], [r + 0.5, z0 + 9], [r + 0.5, z0 + 9], [r + 0.9, z0 + 9.3], [r + 0.9, z0 + 9.9], [r + 0.4, z0 + 10.2], [r + 0.4, z0 + 10.2],
    [rt, zb - 2.4], [rt, zb - 2.4], [rt + 0.9, zb - 1.2], [rt + 0.9, zb], [rt + 0.9, zb], [0, zb, PAVE]], n, STONE, Math.PI / 8, [x, y, 0], 'z', { capA: false });
  // four buttresses on the diagonals, climbing most of the way to the belfry
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    buttress(m, [x + c * (r * 0.9), y + s * (r * 0.9)], [c, s], [-s, c], 2.4, z0 - 3, zb - 14, 4.2);
  }
  // loops up each face in turn
  for (let lv = 0; lv < 9; lv++) {
    const zz = z0 + 14 + lv * ((zb - z0 - 24) / 8), u = (zz - z0 - 10.2) / (zb - 2.4 - z0 - 10.2), rr = (r + 0.4) + (rt - r - 0.4) * Math.max(0, Math.min(1, u));
    const a = (lv * 3 % 8) * (TAU / 8), c = Math.cos(a), s = Math.sin(a), ap = rr * Math.cos(Math.PI / 8);
    m.frame([x + c * (ap + 0.12), y + s * (ap + 0.12), zz], [c, s], [-s, c], () => { m.box(0, 0, 0, 0.22, 1.0, 3.2, STONE_LT); slit(m, 0.11, 0, 0, 0.42, 2.5, lv % 3 === 1); });
  }
  // the belfry: eight piers, arches between them, a ring beam and a crown of small merlons
  const rp = rt + 0.3;
  for (let k = 0; k < 8; k++) {
    const a = k * (TAU / 8) + Math.PI / 8, c = Math.cos(a), s = Math.sin(a);
    m.box(x + c * rp, y + s * rp, zb + 3.6, 1.5, 1.5, 7.2, STONE_LT, 0, a);
    // the arch's haunches: two blocks leaning in from each pier
    const am = a + TAU / 16, cm = Math.cos(am), sm = Math.sin(am), ra = rp * Math.cos(Math.PI / 8);
    m.frame([x + cm * ra, y + sm * ra, zb + 6.3], [cm, sm], [-sm, cm], () => { m.box(0, 0, 0.55, 1.2, rp * 0.78, 0.9, STONE); m.box(0, -rp * 0.26, -0.2, 1.1, 0.8, 0.9, STONE); m.box(0, rp * 0.26, -0.2, 1.1, 0.8, 0.9, STONE); });
  }
  m.lathe([[rp + 0.9, zb + 7.2], [rp + 1.3, zb + 7.6], [rp + 1.3, zb + 8.4], [rp + 1.3, zb + 8.4], [0, zb + 8.6, PAVE]], n, STONE, Math.PI / 8, [x, y, 0], 'z', { capA: false });
  for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; m.box(x + Math.cos(a) * (rp + 0.95), y + Math.sin(a) * (rp + 0.95), zb + 9.2, 0.7, 1.1, 1.3, STONE_LT, 0, a); }
  m.withMat(MAT.SLATE, () => m.lathe([[rp * 0.7, zb + 8.6], [rp * 0.35, zb + 10.4], [0, zb + 11]], 8, SLATE, Math.PI / 8, [x, y, 0], 'z', { capA: false }));
  // the horn: a long dark trumpet, its mouth toward the valley (west)
  m.withMat(MAT.IRON, () => { m.tube([x + rt * 0.5, y, zb + 2.6], [x - rt * 0.2, y, zb + 2.9], 0.22, 0.4, 8, [0.3, 0.22, 0.1]); m.tube([x - rt * 0.2, y, zb + 2.9], [x - rt - 1.4, y, zb + 3.5], 0.4, 1.25, 10, [0.34, 0.25, 0.11]); });
  m.withMat(MAT.EMIT, () => m.sphere([x, y, zb + 4.6], 0.5, dim(LAMP, 0.9), 0, 8, 5));
}

/**
 * The great hall: its front is an arcade of tall arches standing against the cliff at the back of the middle ward,
 * the hall itself cut into the rock behind. Laid along the stretch of the ward's rim that the mountain covers.
 */
function hallArcade(m, map, t) {
  // find the buried arc of the rim, and stand the front across its middle
  let best = [0, 0], run = null;
  for (let k = 0; k <= 720; k++) {
    const a = (k / 360) * Math.PI, bur = map.terrZ(t.x + Math.cos(a) * (t.r + 6), t.y + Math.sin(a) * (t.r + 6)) > t.z + 9;
    if (bur && run == null) run = k; else if (!bur && run != null) { if (k - run > best[1] - best[0]) best = [run, k]; run = null; }
  }
  if (best[1] - best[0] < 30) return;
  const am = ((best[0] + best[1]) / 720) * Math.PI, span = Math.min(1.25, ((best[1] - best[0]) / 360) * Math.PI * 0.62);
  const L = 2 * (t.r - 2) * Math.sin(span / 2), d = (t.r - 2) * Math.cos(span / 2) - 1.5, H = 13, bays = Math.max(3, Math.round(L / 6.4)), bw = L / bays;
  // a frame standing on the ward at the middle of the front: +x out of the cliff (toward the ward), +y along the front
  m.frame([t.x + Math.cos(am) * d, t.y + Math.sin(am) * d, t.z], [-Math.cos(am), -Math.sin(am)], [Math.sin(am), -Math.cos(am)], () => {
    m.box(-2.5, 0, H / 2, 5, L + 3, H, STONE);                              // the front wall, thick, running back into the rock
    m.box(0.25, 0, 0.5, 0.9, L + 3.4, 1.0, STONE_DK);                        // plinth
    m.box(0.3, 0, H - 2.6, 0.9, L + 3.2, 0.5, STONE_LT);                     // string course over the arches
    m.box(0.35, 0, H + 0.25, 1.3, L + 3.6, 0.5, STONE_LT);                   // cornice
    for (let k = 0; k < bays; k++) {
      const y = (k + 0.5 - bays / 2) * bw, w = bw * 0.62, hs = H - 6.6, arch = [], ring = [];
      // the opening: a tall doorway with a round head; behind it, the dark of the hall, here and there a fire
      for (let q = 0; q <= 8; q++) { const a = (q / 8) * Math.PI; arch.push([y + Math.cos(a) * w / 2, 1.0 + hs + Math.sin(a) * w / 2]); ring.push([y + Math.cos(a) * (w / 2 + 0.38), 1.0 + hs + Math.sin(a) * (w / 2 + 0.38)]); }
      m.extrudeX([[y + w / 2 + 0.38, 1.0], ...ring, [y - w / 2 - 0.38, 1.0]], 0, 0.32, STONE_LT);
      m.withMat(k % 3 === 1 ? MAT.EMIT : MAT.PLAIN, () => m.extrudeX([[y + w / 2, 1.0], ...arch, [y - w / 2, 1.0]], 0, 0.4, k % 3 === 1 ? dim(LAMP, 0.55) : DARK));
      // a small light over each arch, and a pier between bays
      m.box(0.14, y, H - 1.5, 0.3, 0.9, 1.5, STONE_LT); slit(m, 0.3, y, H - 1.5, 0.5, 1.1, k % 2 === 0);
      if (k > 0) m.box(0.45, y - bw / 2, (H - 2.6) / 2, 0.9, bw * 0.16, H - 2.6, STONE_LT);
    }
    for (const sd of [-1, 1]) m.box(0.5, sd * (L / 2 + 0.6), H / 2, 1.6, 1.8, H + 1.5, STONE_LT);     // end piers
    // the roof: a slate pent running back and up into the mountain
    m.withMat(MAT.SLATE, () => m.prism([[0.9, -L / 2 - 1.7, H + 0.5], [0.9, L / 2 + 1.7, H + 0.5], [-7, L / 2 + 1.7, H + 4.8], [-7, -L / 2 - 1.7, H + 4.8]], [[0.9, -L / 2 - 1.7, H + 0.8], [0.9, L / 2 + 1.7, H + 0.8], [-7, L / 2 + 1.7, H + 5.1], [-7, -L / 2 - 1.7, H + 5.1]], SLATE));
  });
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
  for (let k = 0; k < N_RING; k++) piece('r' + k, (segs[N_WALL + k].breached ? '1' : '0') + (segs[N_WALL + k].leaves ? 'L' : ''), (m) => ringSection(m, map, segs, k));
  piece('platforms', '', (m) => platforms(m, map));
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
