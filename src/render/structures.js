// Builds the fortress as one static mesh: the Deeping Wall, the Hornburg's curtain wall,
// gatehouse and great tower, the causeway, stairs and the rubble of anything breached.
// Rebuilt whenever a section falls. The vertex "part" slot carries a material id:
// 0 dressed stone, 1 timber, 2 plain/dark, 3 roof slate.

import { MeshBuilder } from './mesh.js';
import { KEEP, N_WALL, N_RING, WALL_HALF } from '../map.js';
import { WALL_H, PLATEAU_Z, RING_TOP } from '../config.js';

const STONE = [0.56, 0.55, 0.52], STONE_LT = [0.66, 0.65, 0.61], STONE_DK = [0.42, 0.41, 0.39], PAVE = [0.5, 0.48, 0.44];
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
    if (s.breached) continue;
    const a = bound[k], b = bound[k + 1];
    m.wall(a.o, b.o, BASE, H, s.nx, s.ny, STONE);
    m.wall(a.i, b.i, BASE, H, -s.nx, -s.ny, STONE);
    m.floor(a.i, a.o, b.o, b.i, H, PAVE);
    if (k === 0 || segs[k - 1].breached) m.wall(a.i, a.o, BASE, H, -a.tx, -a.ty, STONE_DK);
    if (k === N_WALL - 1 || segs[k + 1].breached) m.wall(b.i, b.o, BASE, H, b.tx, b.ty, STONE_DK);
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
      const j = s.kind === 'postern' ? 0.3 : 0.2, lz = s.kind === 'door' ? PLATEAU_Z + 4.6 : PLATEAU_Z + 6.6;
      arcPrism(m, a0, a0 + step * j, ri - 0.6, ro + 0.6, RB, top, STONE_DK);
      arcPrism(m, a1 - step * j, a1, ri - 0.6, ro + 0.6, RB, top, STONE_DK);
      arcPrism(m, a0 + step * j, a1 - step * j, ri, ro, lz, top, STONE, false);
      const P = (a, r) => [KEEP.cx + Math.cos(a) * r, KEEP.cy + Math.sin(a) * r];
      m.floor(P(a0 + step * j, ri), P(a0 + step * j, ro), P(a1 - step * j, ro), P(a1 - step * j, ri), PLATEAU_Z + 0.05, PAVE);
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
      turret(m, KEEP.cx + Math.cos(a0) * (R + 1.5), KEEP.cy + Math.sin(a0) * (R + 1.5), rr, RB, top + (gateSide ? 6 : 4));
    }
  }

  // ---- the great tower and the hall against the cliff ----------------------
  const tx = KEEP.towerX, ty = KEEP.towerY, tr = KEEP.towerR;
  m.cyl(tx, ty, PLATEAU_Z - 2, PLATEAU_Z + 9, tr + 1.6, tr, 10, STONE_DK, 0, false);
  m.cyl(tx, ty, PLATEAU_Z + 9, PLATEAU_Z + 38, tr, tr - 1.6, 10, STONE, 0, false);
  m.cyl(tx, ty, PLATEAU_Z + 38, PLATEAU_Z + 40.5, tr - 1.6, tr + 0.2, 10, STONE_LT, 0, false);
  turret(m, tx, ty, tr + 0.2, PLATEAU_Z + 40.5, PLATEAU_Z + 42, STONE_LT);
  m.cyl(tx, ty, PLATEAU_Z + 42, PLATEAU_Z + 62, tr - 4.2, tr - 5.2, 10, STONE, 0, false);
  m.cyl(tx, ty, PLATEAU_Z + 62, PLATEAU_Z + 64, tr - 5.2, tr - 3.8, 10, STONE_LT, 0, false);
  turret(m, tx, ty, tr - 3.8, PLATEAU_Z + 64, PLATEAU_Z + 65.2, STONE_LT);
  m.cyl(tx, ty, PLATEAU_Z + 65.2, PLATEAU_Z + 71, 3.6, 3.2, 8, STONE, 0, false);
  m.cyl(tx, ty, PLATEAU_Z + 71, PLATEAU_Z + 80, 4.2, 0, 8, SLATE, 3, false);
  for (let k = 0; k < 5; k++) {
    const a = 0.6 + k * 1.2566, c = Math.cos(a), s = Math.sin(a);
    m.beam([tx + c * (tr + 3.4), ty + s * (tr + 3.4), PLATEAU_Z - 2], [tx + c * (tr - 0.6), ty + s * (tr - 0.6), PLATEAU_Z + 34], 2.4, STONE_DK);
    for (const zz of [16, 26, 36]) m.frameBox([tx + c * (tr - 1.0 - zz * 0.04), ty + s * (tr - 1.0 - zz * 0.04), PLATEAU_Z + zz], [-s * 0.45, c * 0.45, 0], [c * 0.12, s * 0.12, 0], [0, 0, 1.1], DARK, 2);
  }
  const hx = KEEP.hallX, hy = KEEP.hallY, hw = KEEP.hallW / 2, hd = KEEP.hallD / 2, hz = PLATEAU_Z + 9;
  m.box(hx, hy, (PLATEAU_Z - 2 + hz) / 2, hw * 2, hd * 2, hz - PLATEAU_Z + 2, STONE);
  m.roof([hx - hw - 0.6, hy + hd + 0.6, hz], [hx + hw + 0.6, hy + hd + 0.6, hz], [hx + hw + 0.6, hy, hz + 6], [hx - hw - 0.6, hy, hz + 6], SLATE, 3);
  m.roof([hx + hw + 0.6, hy - hd - 0.6, hz], [hx - hw - 0.6, hy - hd - 0.6, hz], [hx - hw - 0.6, hy, hz + 6], [hx + hw + 0.6, hy, hz + 6], SLATE, 3);
  m.tri([hx - hw, hy + hd, hz], [hx - hw, hy, hz + 6], [hx - hw, hy - hd, hz], STONE_DK); m.tri([hx + hw, hy - hd, hz], [hx + hw, hy, hz + 6], [hx + hw, hy + hd, hz], STONE_DK);
  m.frameBox([hx, hy + hd + 0.1, PLATEAU_Z + 2.4], [2, 0, 0], [0, 0.12, 0], [0, 0, 2.4], WOOD, 1);

  // ---- causeway and the rear stair ------------------------------------------
  ramp(m, map.causeway, map.causeHalf, map.rampZ, -3, true);
  ramp(m, map.rear, map.rearHalf, map.rampZ, -3, true);

  // ---- rubble where sections have fallen --------------------------------------
  for (const s of segs) {
    if (!s.breached) continue;
    seed = 1000 + s.id * 77;
    const gate = s.kind === 'gate' || s.kind === 'postern';
    const gz = gate ? PLATEAU_Z : map.groundZ(s.x, s.y);
    const n = gate ? 14 : 46;
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
