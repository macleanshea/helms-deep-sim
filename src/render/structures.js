// Builds the fortress as one static mesh: the Deeping Wall, the Hornburg's curtain wall,
// gatehouse and great tower, the causeway, stairs and the rubble of anything breached.
// Rebuilt whenever a section falls. The vertex "part" slot carries a material id:
// 0 dressed stone, 1 timber, 2 plain/dark, 3 roof slate.

import { MeshBuilder } from './mesh.js';
import { KEEP, N_WALL, N_RING, WALL_HALF } from '../map.js';
import { WALL_H, PLATEAU_Z, RING_TOP } from '../config.js';

const STONE = [0.56, 0.55, 0.52], STONE_LT = [0.66, 0.65, 0.61], STONE_DK = [0.42, 0.41, 0.39], PAVE = [0.5, 0.48, 0.44];
const CORE = [0.31, 0.29, 0.27]; // rubble core exposed where masonry has been torn away
const WOOD = [0.36, 0.25, 0.15], DARK = [0.05, 0.05, 0.05], SLATE = [0.25, 0.27, 0.31];
const DEG = Math.PI / 180;

let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** Crenellated parapet along the edge from p to q (z = walkway height), facing (nx, ny). */
function parapet(m, p, q, z, nx, ny, col = STONE_LT) {
  const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy), tx = dx / L, ty = dy / L;
  const mid = [(p[0] + q[0]) / 2 - nx * 0.4, (p[1] + q[1]) / 2 - ny * 0.4];
  m.frameBox([mid[0], mid[1], z + 0.4], [tx * L / 2, ty * L / 2, 0], [nx * 0.4, ny * 0.4, 0], [0, 0, 0.4], col);
  const n = Math.max(1, Math.round(L / 2.4));
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n;
    m.frameBox([p[0] + dx * u - nx * 0.4, p[1] + dy * u - ny * 0.4, z + 1.35], [tx * 0.65, ty * 0.65, 0], [nx * 0.4, ny * 0.4, 0], [0, 0, 0.55], col);
  }
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
    m.quad([IA[0], IA[1], tz], [OA[0], OA[1], top], [OB[0], OB[1], top], [IB[0], IB[1], tz], [0.5, 0.48, 0.45]);
    m.quad([IA[0], IA[1], tz], [IB[0], IB[1], tz], [OB[0], OB[1], top], [OA[0], OA[1], top], [0.5, 0.48, 0.45]);
    if (k === 0 || k === n - 1) {
      const P = k === 0 ? [OA, IA] : [OB, IB], t = k === 0 ? -1 : 1;
      m.wall(P[0], P[1], BASE, Math.min(top, tz), s.tx * t, s.ty * t, STONE_DK);
    }
  }
}

/** The gate after it has been forced: one leaf torn down and flung inward, the other hanging off its hinge. */
function brokenGate(m, s, j, lz) {
  seed = 333 + s.id;
  const half = s.len * (0.5 - j), w = half / 2, Z = PLATEAU_Z;
  const cx = s.x - s.nx * 2.5, cy = s.y - s.ny * 2.5;
  // the flattened leaf, splintered, lying across the passage
  const a = Math.atan2(s.ty, s.tx) + 0.35;
  m.frameBox([cx - s.nx * 3 + s.tx * 0.8, cy - s.ny * 3 + s.ty * 0.8, Z + 0.45], [Math.cos(a) * w, Math.sin(a) * w, 0.25], [-Math.sin(a) * (lz - Z) * 0.45, Math.cos(a) * (lz - Z) * 0.45, 0], [0, 0, 0.3], [0.24, 0.16, 0.1], 1);
  // the other leaf still hangs from its top hinge, swung inward and twisted
  const hx = s.x + s.tx * half - s.nx * 1.5, hy = s.y + s.ty * half - s.ny * 1.5;
  m.frameBox([hx - s.tx * w * 0.7 - s.nx * w * 0.6, hy - s.ty * w * 0.7 - s.ny * w * 0.6, (Z + lz) / 2 + 0.6], [-(s.tx * 0.7 + s.nx * 0.7) * w, -(s.ty * 0.7 + s.ny * 0.7) * w, 0], [s.nx * 0.3 - s.tx * 0.1, s.ny * 0.3 - s.ty * 0.1, 0], [0, 0, (lz - Z) / 2 - 0.4], [0.3, 0.2, 0.12], 1);
  // splinters, bent iron bands and scorch
  for (let k = 0; k < 10; k++) {
    const u = (rnd() - 0.5) * half * 1.8, v = -1 - rnd() * 7, ang = rnd() * 6.28, L = 0.6 + rnd() * 1.8;
    const x = s.x + s.tx * u + s.nx * v, y = s.y + s.ty * u + s.ny * v;
    m.frameBox([x, y, Z + 0.15], [Math.cos(ang) * L, Math.sin(ang) * L, rnd() * 0.4], [-Math.sin(ang) * 0.14, Math.cos(ang) * 0.14, 0], [0, 0, 0.12], k & 1 ? [0.2, 0.2, 0.22] : [0.32, 0.22, 0.13], k & 1 ? 2 : 1);
  }
  // scorched stone around the empty arch
  for (const sd of [-1, 1]) m.frameBox([s.x + s.nx * 4.62 + s.tx * half * sd, s.y + s.ny * 4.62 + s.ty * half * sd, (Z + lz) / 2], [s.tx * 0.5, s.ty * 0.5, 0], [s.nx * 0.03, s.ny * 0.03, 0], [0, 0, (lz - Z) / 2], [0.12, 0.1, 0.09], 2);
}

function turret(m, x, y, r, z0, z1, col = STONE) {
  m.cyl(x, y, z0, z1, r * 1.06, r, 12, col, 0, false);
  m.cyl(x, y, z1, z1 + 0.01, r, r, 12, PAVE, 0, true);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * 6.2832, c = Math.cos(a), s = Math.sin(a);
    m.frameBox([x + c * (r - 0.35), y + s * (r - 0.35), z1 + 0.75], [-s * 0.7, c * 0.7, 0], [c * 0.4, s * 0.4, 0], [0, 0, 0.75], STONE_LT);
  }
}

/** Raised roadway along a sampled path. */
function ramp(m, line, half, zOf, base, rail) {
  const pts = [];
  for (let i = 0; i < line.length; i += 3) pts.push(line[i]);
  if (pts[pts.length - 1] !== line[line.length - 1]) pts.push(line[line.length - 1]);
  const edge = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    return { l: [p.x + nx * half, p.y + ny * half], r: [p.x - nx * half, p.y - ny * half], nx, ny, z: zOf(p.t) };
  });
  for (let i = 0; i < edge.length - 1; i++) {
    const a = edge[i], b = edge[i + 1];
    const quad = (p0, p1, p2, p3, z0, z1) => {
      const A = [p0[0], p0[1], z0], B = [p1[0], p1[1], z0], Cc = [p2[0], p2[1], z1], D = [p3[0], p3[1], z1];
      const area = (B[0] - A[0]) * (Cc[1] - A[1]) - (B[1] - A[1]) * (Cc[0] - A[0]);
      if (area > 0) m.quad(A, B, Cc, D, PAVE); else m.quad(A, D, Cc, B, PAVE);
    };
    quad(a.l, a.r, b.r, b.l, a.z, b.z);
    const za = Math.min(a.z, b.z);
    if (za > 0.4) {
      // retaining walls
      for (const [p, q, sx, sy] of [[a.l, b.l, a.nx, a.ny], [a.r, b.r, -a.nx, -a.ny]]) {
        if ((q[1] - p[1]) * sx - (q[0] - p[0]) * sy < 0) m.quad([q[0], q[1], base], [p[0], p[1], base], [p[0], p[1], a.z], [q[0], q[1], b.z], STONE_DK);
        else m.quad([p[0], p[1], base], [q[0], q[1], base], [q[0], q[1], b.z], [p[0], p[1], a.z], STONE_DK);
      }
      if (rail) {
        for (const [p, q] of [[a.l, b.l], [a.r, b.r]]) {
          const dx = q[0] - p[0], dy = q[1] - p[1];
          m.frameBox([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (a.z + b.z) / 2 + 0.45], [dx / 2, dy / 2, (b.z - a.z) / 2], [(-dy / Math.hypot(dx, dy)) * 0.35, (dx / Math.hypot(dx, dy)) * 0.35, 0], [0, 0, 0.45], STONE_LT);
        }
      }
    }
  }
}

export function buildStructures(map, segs) {
  const m = new MeshBuilder();
  seed = 4242;
  const H = WALL_H, BASE = -4;

  // ---- Deeping Wall ----------------------------------------------------
  const bound = [];
  for (let k = 0; k <= N_WALL; k++) {
    const p = map.wallAt(k / N_WALL);
    let nx = p.ty, ny = -p.tx; if (nx > 0) { nx = -nx; ny = -ny; }
    bound.push({ o: [p.x + nx * WALL_HALF, p.y + ny * WALL_HALF], i: [p.x - nx * WALL_HALF, p.y - ny * WALL_HALF], nx, ny, tx: p.tx, ty: p.ty });
  }
  for (let k = 0; k < N_WALL; k++) {
    const s = segs[k];
    const a = bound[k], b = bound[k + 1];
    if (s.breached) { brokenWall(m, a, b, s, H, BASE, !segs[k - 1] || !segs[k - 1].breached, !segs[k + 1] || segs[k + 1].kind !== 'wall' || !segs[k + 1].breached); continue; }
    m.wall(a.o, b.o, BASE, H, s.nx, s.ny, STONE);
    m.wall(a.i, b.i, BASE, H, -s.nx, -s.ny, STONE);
    m.floor(a.i, a.o, b.o, b.i, H, PAVE);
    if (k === 0 || segs[k - 1].breached) m.wall(a.i, a.o, BASE, H, -a.tx, -a.ty, k ? CORE : STONE_DK);
    if (k === N_WALL - 1 || segs[k + 1].breached) m.wall(b.i, b.o, BASE, H, b.tx, b.ty, k < N_WALL - 1 ? CORE : STONE_DK);
    parapet(m, a.o, b.o, H, s.nx, s.ny);
    // low kerb on the inner edge
    m.frameBox([(a.i[0] + b.i[0]) / 2 + s.nx * 0.25, (a.i[1] + b.i[1]) / 2 + s.ny * 0.25, H + 0.2], [(b.i[0] - a.i[0]) / 2, (b.i[1] - a.i[1]) / 2, 0], [s.nx * 0.25, s.ny * 0.25, 0], [0, 0, 0.2], STONE_LT);
    if (k % 4 === 2) {
      // shallow buttress on the outer face
      m.frameBox([s.x + s.nx * (WALL_HALF + 0.6), s.y + s.ny * (WALL_HALF + 0.6), H / 2 - 1.5], [s.tx * 1.4, s.ty * 1.4, 0], [s.nx * 0.7, s.ny * 0.7, 0], [0, 0, H / 2 - 0.5], STONE_DK);
    }
    if (s.culvert) {
      // the culvert: a low barred arch where the stream runs out
      const gz = map.groundZ(s.ox, s.oy) + 0.2;
      m.frameBox([s.x + s.nx * (WALL_HALF + 0.08), s.y + s.ny * (WALL_HALF + 0.08), gz + 1.3], [s.tx * 2.2, s.ty * 2.2, 0], [s.nx * 0.1, s.ny * 0.1, 0], [0, 0, 1.6], DARK, 2);
      for (let b2 = -2; b2 <= 2; b2++) m.frameBox([s.x + s.nx * (WALL_HALF + 0.22) + s.tx * b2 * 0.8, s.y + s.ny * (WALL_HALF + 0.22) + s.ty * b2 * 0.8, gz + 1.3], [s.tx * 0.07, s.ty * 0.07, 0], [s.nx * 0.07, s.ny * 0.07, 0], [0, 0, 1.6], [0.25, 0.25, 0.27], 2);
    }
  }

  // ---- stairs ------------------------------------------------------------
  for (const st of map.stairs) {
    const steps = 14, px = -st.dy, py = st.dx, run = (st.len - 2) / steps;
    for (let i = 0; i < steps; i++) {
      const a0 = i * run, zt = st.z0 + ((st.z1 - st.z0) * (i + 1)) / steps;
      const cx = st.x + st.dx * (a0 + run / 2), cy = st.y + st.dy * (a0 + run / 2);
      m.frameBox([cx, cy, (zt + st.z0 - 4) / 2], [st.dx * run / 2, st.dy * run / 2, 0], [px * st.half, py * st.half, 0], [0, 0, (zt - st.z0 + 4) / 2], i & 1 ? STONE : STONE_LT);
    }
    const cx = st.x + st.dx * (st.len - 1), cy = st.y + st.dy * (st.len - 1);
    m.frameBox([cx, cy, (st.z1 + st.z0 - 4) / 2], [st.dx, st.dy, 0], [px * st.half, py * st.half, 0], [0, 0, (st.z1 - st.z0 + 4) / 2], PAVE);
  }

  // ---- Hornburg curtain wall ---------------------------------------------
  const R = KEEP.r, ri = R - KEEP.half, ro = R + KEEP.half, step = (2 * Math.PI) / N_RING, RB = 2;
  const ringSeg = (k) => segs[N_WALL + ((k + N_RING) % N_RING)];
  for (let k = 0; k < N_RING; k++) {
    const s = ringSeg(k);
    if (!s.valid && s.kind === 'ring') continue;
    const a0 = k * step, a1 = (k + 1) * step, top = RING_TOP;
    if (s.kind === 'ring') {
      arcPrism(m, a0 - 0.002, a1 + 0.002, ri, ro, RB, top, STONE, !ringSeg(k - 1).valid || !ringSeg(k + 1).valid);
    } else {
      // an opening: jambs either side, a lintel above, and the leaf itself while it holds
      const j = s.kind === 'postern' ? 0.3 : s.kind === 'gate' ? 0.07 : 0.2, lz = s.kind === 'door' ? PLATEAU_Z + 4.6 : PLATEAU_Z + 6.6;
      arcPrism(m, a0, a0 + step * j, ri - 0.6, ro + 0.6, RB, top, STONE_DK);
      arcPrism(m, a1 - step * j, a1, ri - 0.6, ro + 0.6, RB, top, STONE_DK);
      arcPrism(m, a0 + step * j, a1 - step * j, ri, ro, lz, top, STONE, false);
      const P = (a, r) => [KEEP.cx + Math.cos(a) * r, KEEP.cy + Math.sin(a) * r];
      m.floor(P(a0 + step * j, ri), P(a0 + step * j, ro), P(a1 - step * j, ro), P(a1 - step * j, ri), PLATEAU_Z + 0.05, PAVE);
      if (s.breached && s.kind !== 'door') brokenGate(m, s, j, lz);
      if (!s.breached && s.kind !== 'door') {
        m.frameBox([s.x + s.nx * 3.2, s.y + s.ny * 3.2, (PLATEAU_Z + lz) / 2], [s.tx * s.len * (0.5 - j), s.ty * s.len * (0.5 - j), 0], [s.nx * 0.35, s.ny * 0.35, 0], [0, 0, (lz - PLATEAU_Z) / 2], WOOD, 1);
        for (const zz of [0.25, 0.5, 0.75]) m.frameBox([s.x + s.nx * 3.6, s.y + s.ny * 3.6, PLATEAU_Z + (lz - PLATEAU_Z) * zz], [s.tx * s.len * (0.5 - j), s.ty * s.len * (0.5 - j), 0], [s.nx * 0.08, s.ny * 0.08, 0], [0, 0, 0.16], [0.2, 0.2, 0.22], 2);
      }
    }
    // battlements on the outer edge
    const n = 5;
    for (let q = 0; q < n; q++) {
      const b0 = a0 + (step * q) / n, b1 = a0 + (step * (q + 1)) / n;
      parapet(m, [KEEP.cx + Math.cos(b0) * ro, KEEP.cy + Math.sin(b0) * ro], [KEEP.cx + Math.cos(b1) * ro, KEEP.cy + Math.sin(b1) * ro], top, s.nx, s.ny);
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

  // ---- the inner ward: terraces climbing the rock to the great tower ---------
  const buried = (x, y, z) => map.terrZ(x, y) > z + 1.5; // set into the mountain: no need for parapets
  const terrace = (t, z0, n = 44) => {
    m.cyl(t.x, t.y, z0, t.z, t.r + 1.4, t.r, n, STONE_DK, 0, false); // battered retaining wall
    m.cyl(t.x, t.y, t.z, t.z + 0.02, t.r, t.r, n, PAVE, 0, true);
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * 2 * Math.PI, a1 = ((k + 1) / n) * 2 * Math.PI, am = (a0 + a1) / 2;
      const p = [t.x + Math.cos(a0) * t.r, t.y + Math.sin(a0) * t.r], q = [t.x + Math.cos(a1) * t.r, t.y + Math.sin(a1) * t.r];
      if (!buried((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, t.z)) parapet(m, p, q, t.z, Math.cos(am), Math.sin(am));
      // string course and buttresses give the long retaining walls some relief
      if (k % 4 === 1 && !buried(t.x + Math.cos(am) * (t.r + 2), t.y + Math.sin(am) * (t.r + 2), z0)) {
        const c = Math.cos(am), s2 = Math.sin(am);
        m.frameBox([t.x + c * (t.r + 1.1), t.y + s2 * (t.r + 1.1), (z0 + t.z) / 2 - 0.5], [-s2 * 1.1, c * 1.1, 0], [c * 1.2, s2 * 1.2, 0], [0, 0, (t.z - z0) / 2 - 0.5], STONE_DK);
      }
    }
  };
  /** A flight of steps hugging a retaining wall, climbing from z0 to z1 along the tangent at angle a. */
  const flight = (t, a, dir, z0, z1, len = 14, w = 3) => {
    const c = Math.cos(a), s2 = Math.sin(a), tx = -s2 * dir, ty = c * dir, r = t.r + 1.4 + w / 2;
    const bx = t.x + c * r, by = t.y + s2 * r, steps = 12, run = len / steps;
    for (let i = 0; i < steps; i++) {
      const zt = z0 + ((z1 - z0) * (i + 1)) / steps, u = (i + 0.5) * run - len / 2;
      m.frameBox([bx + tx * u, by + ty * u, (zt + z0 - 1) / 2], [tx * run / 2, ty * run / 2, 0], [c * w / 2, s2 * w / 2, 0], [0, 0, (zt - z0 + 1) / 2], i & 1 ? STONE : STONE_LT);
    }
    // a low wall on the open side of the flight
    m.frameBox([bx + c * (w / 2 + 0.3), by + s2 * (w / 2 + 0.3), (z0 + z1) / 2 + 0.2], [tx * len / 2, ty * len / 2, (z1 - z0) / 2], [c * 0.3, s2 * 0.3, 0], [0, 0, 0.7], STONE_LT);
  };
  /** A stone hall with a steep slate roof; a = heading of its long axis. */
  const hall = (x, y, a, L, W, z0, h, roofH = 6) => {
    const c = Math.cos(a), s2 = Math.sin(a), ux = c * L / 2, uy = s2 * L / 2, vx = -s2 * W / 2, vy = c * W / 2, zt = z0 + h;
    m.frameBox([x, y, (z0 - 1 + zt) / 2], [ux, uy, 0], [vx, vy, 0], [0, 0, (zt - z0 + 1) / 2], STONE);
    const e = 0.7, ex = c * e, ey = s2 * e, fx = -s2 * e, fy = c * e;
    const A = [x - ux - vx - ex - fx, y - uy - vy - ey - fy, zt], B = [x + ux - vx + ex - fx, y + uy - vy + ey - fy, zt];
    const Cc = [x + ux + vx + ex + fx, y + uy + vy + ey + fy, zt], D = [x - ux + vx - ex + fx, y - uy + vy - ey + fy, zt];
    const R0 = [x - ux - ex, y - uy - ey, zt + roofH], R1 = [x + ux + ex, y + uy + ey, zt + roofH];
    m.roof(A, B, R1, R0, SLATE, 3); m.roof(Cc, D, R0, R1, SLATE, 3);
    m.tri([x - ux - vx, y - uy - vy, zt], [x - ux + vx, y - uy + vy, zt], [x - ux, y - uy, zt + roofH - 0.6], STONE_DK);
    m.tri([x + ux + vx, y + uy + vy, zt], [x + ux - vx, y + uy - vy, zt], [x + ux, y + uy, zt + roofH - 0.6], STONE_DK);
    // tall narrow windows down both long sides
    const nw = Math.max(2, Math.round(L / 4.5));
    for (let k = 0; k < nw; k++) for (const sd of [-1, 1]) {
      const u = ((k + 0.5) / nw - 0.5) * L * 0.86;
      m.frameBox([x + c * u + (-s2) * (W / 2 + 0.06) * sd, y + s2 * u + c * (W / 2 + 0.06) * sd, z0 + h * 0.55], [c * 0.4, s2 * 0.4, 0], [-s2 * 0.08, c * 0.08, 0], [0, 0, h * 0.22], DARK, 2);
    }
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
  // the great tower: battered base, a long shaft in stages, a gallery and a slate spire
  {
    const x = tw.x, y = tw.y, r = tw.r, z = t2.z;
    m.cyl(x, y, z - 4, z + 8, r + 2.2, r + 0.4, 16, STONE_DK, 0, false);
    m.cyl(x, y, z + 8, z + 30, r + 0.4, r - 0.6, 16, STONE, 0, false);
    m.cyl(x, y, z + 30, z + 31.2, r + 0.4, r + 0.4, 16, STONE_LT, 0, false);
    m.cyl(x, y, z + 31.2, z + 52, r - 0.6, r - 1.8, 16, STONE, 0, false);
    m.cyl(x, y, z + 52, z + 54.5, r - 1.8, r + 0.3, 16, STONE_LT, 0, false); // corbelled gallery
    turret(m, x, y, r + 0.3, z + 54.5, z + 56, STONE_LT);
    m.cyl(x, y, z + 56, z + 66, r - 4.4, r - 5.2, 12, STONE, 0, false);
    turret(m, x, y, r - 4.6, z + 66, z + 67, STONE_LT);
    m.cyl(x, y, z + 67, z + 84, r - 4.2, 0, 12, SLATE, 3, false);
    for (let k = 0; k < 6; k++) {
      const a = 0.4 + k * 1.0472, c = Math.cos(a), s2 = Math.sin(a);
      m.beam([x + c * (r + 3.6), y + s2 * (r + 3.6), z - 4], [x + c * (r - 0.2), y + s2 * (r - 0.2), z + 26], 2.2, STONE_DK);
      for (const zz of [14, 24, 38, 46, 60]) {
        const rr = zz < 30 ? r + 0.4 - zz * 0.045 : zz < 52 ? r - 0.6 - (zz - 31) * 0.057 : r - 4.8;
        m.frameBox([x + Math.cos(a + 0.52) * (rr - 0.05), y + Math.sin(a + 0.52) * (rr - 0.05), z + zz], [-Math.sin(a + 0.52) * 0.4, Math.cos(a + 0.52) * 0.4, 0], [Math.cos(a + 0.52) * 0.12, Math.sin(a + 0.52) * 0.12, 0], [0, 0, 1.2], DARK, 2);
      }
    }
  }

  // ---- causeway and the rear stair ------------------------------------------
  ramp(m, map.causeway, map.causeHalf, map.rampZ, -3, true);
  ramp(m, map.rear, map.rearHalf, map.rampZ, -3, true);

  // ---- rubble where sections have fallen --------------------------------------
  for (const s of segs) {
    if (!s.breached) continue;
    seed = 1000 + s.id * 77;
    const gate = s.kind === 'gate' || s.kind === 'postern';
    const gz = gate ? PLATEAU_Z : map.groundZ(s.x, s.y);
    const n = gate ? 10 : 60;
    for (let k = 0; k < n; k++) {
      const u = (rnd() - 0.5) * (s.len + 4), v = (rnd() + rnd() - 1) * (gate ? 5 : 9);
      const d = Math.abs(v) / 9, sz = 0.5 + rnd() * rnd() * (gate ? 1.2 : 2.6), hgt = gate ? 0.3 : Math.max(0.3, (1 - d) * 2.6 * rnd());
      const x = s.x + s.tx * u + s.nx * v, y = s.y + s.ty * u + s.ny * v, a = rnd() * 6.28, sh = 0.7 + rnd() * 0.5;
      const col = gate && k % 2 ? [WOOD[0] * sh, WOOD[1] * sh, WOOD[2] * sh] : [STONE[0] * sh, STONE[1] * sh, STONE[2] * sh];
      m.frameBox([x, y, gz + hgt + sz * 0.3], [Math.cos(a) * sz, Math.sin(a) * sz, (rnd() - 0.5) * sz * 0.5], [-Math.sin(a) * sz * 0.7, Math.cos(a) * sz * 0.7, 0], [0, 0, sz * 0.5], col, gate && k % 2 ? 1 : 0);
    }
  }
  return m.build();
}
