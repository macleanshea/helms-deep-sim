// Procedural mesh construction.
// Local space: +x forward, +y left, +z up, origin at the feet. Every vertex carries a position,
// a normal, a color, an animation "part" id (see PART; animated in the vertex shader) and a
// material id (see materials.js) that selects the surface texture.
//
// Besides flat-shaded boxes and beams there are smooth primitives built on loft(): tubes, limbs,
// spheres and lathed profiles, plus chamfered boxes and extruded outlines for hard surfaces. A small
// transform stack lets a part be modeled once and then placed, turned or mirrored.

export const PART = { NONE: 0, LEG_L: 1, LEG_R: 2, ARM: 3, ARM_FREE: 4, BANNER: 5, ROTOR: 6, SHIN_L: 7, SHIN_R: 8, TAIL_ROTOR: 9, FOREARM: 10 };

const V = 11; // floats per vertex while building: pos3 normal3 color3 part material
const TAU = Math.PI * 2;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Ring lying flat (for upright bodies): center and radii along x and y. */
export const ringZ = (x, y, z, rx, ry = rx, col) => ({ c: [x, y, z], u: [rx, 0, 0], v: [0, ry, 0], col });
/** Ring facing along x (for bodies that run fore and aft): radii along y and z. */
export const ringX = (x, y, z, ry, rz = ry, col) => ({ c: [x, y, z], u: [0, ry, 0], v: [0, 0, rz], col });
/** Ring facing along y: radii along x and z. */
export const ringY = (x, y, z, rx, rz = rx, col) => ({ c: [x, y, z], u: [rx, 0, 0], v: [0, 0, rz], col });

export class MeshBuilder {
  constructor() { this.v = []; this.mat = 0; this.M = null; this.flip = false; this.stack = []; }

  // ------------------------------------------------------------ transforms
  push() { this.stack.push([this.M, this.flip]); return this; }
  pop() { [this.M, this.flip] = this.stack.pop(); return this; }
  /** Post-multiply the current transform by a 3x4 row-major matrix (it applies first). */
  _mul(B) {
    const A = this.M;
    if (!A) { this.M = B; }
    else {
      const R = new Array(12);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) R[r * 4 + c] = A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c];
        R[r * 4 + 3] = A[r * 4] * B[3] + A[r * 4 + 1] * B[7] + A[r * 4 + 2] * B[11] + A[r * 4 + 3];
      }
      this.M = R;
    }
    return this;
  }
  translate(x, y, z) { return this._mul([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]); }
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return this._mul([c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]); }
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return this._mul([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]); }
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return this._mul([1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]); }
  scale(sx, sy = sx, sz = sx) { if (sx * sy * sz < 0) this.flip = !this.flip; return this._mul([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0]); }
  /** Run fn with the origin moved to (x, y, z) and turned by yaw. */
  at(x, y, z, yaw, fn) { this.push().translate(x, y, z); if (yaw) this.rotZ(yaw); fn(this); return this.pop(); }
  /** Run fn in a frame standing at `o` whose x and y axes are the given horizontal directions (z stays up). */
  frame(o, ax, ay, fn) {
    this.push()._mul([ax[0], ay[0], 0, o[0], ax[1], ay[1], 0, o[1], 0, 0, 1, o[2] || 0]);
    if (ax[0] * ay[1] - ax[1] * ay[0] < 0) this.flip = !this.flip;
    fn(this); return this.pop();
  }
  /** Run fn(side) twice: as written (side = 1) and mirrored across the x-z plane (side = -1). */
  mirror(fn) { fn(1); this.push().scale(1, -1, 1); fn(-1); return this.pop(); }
  /** Run fn with a different material, then restore the old one. */
  withMat(mat, fn) { const o = this.mat; this.mat = mat; fn(this); this.mat = o; return this; }
  _p(p) { const M = this.M; return M ? [M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3], M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7], M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11]] : p; }
  _n(n) { const M = this.M; return M ? unit([M[0] * n[0] + M[1] * n[1] + M[2] * n[2], M[4] * n[0] + M[5] * n[1] + M[6] * n[2], M[8] * n[0] + M[9] * n[1] + M[10] * n[2]]) : n; }

  // --------------------------------------------------------------- emitters
  /** One triangle. Normals may be null (flat shaded); colors are per vertex. */
  _tri(a, b, c, na, nb, nc, ca, cb, cc, part) {
    if (this.M) { a = this._p(a); b = this._p(b); c = this._p(c); if (na) { na = this._n(na); nb = this._n(nb); nc = this._n(nc); } }
    if (this.flip) { let t = b; b = c; c = t; t = nb; nb = nc; nc = t; t = cb; cb = cc; cc = t; }
    if (!na) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) return;
      na = nb = nc = [nx / l, ny / l, nz / l];
    }
    const v = this.v, m = this.mat;
    v.push(a[0], a[1], a[2], na[0], na[1], na[2], ca[0], ca[1], ca[2], part, m,
      b[0], b[1], b[2], nb[0], nb[1], nb[2], cb[0], cb[1], cb[2], part, m,
      c[0], c[1], c[2], nc[0], nc[1], nc[2], cc[0], cc[1], cc[2], part, m);
  }
  tri(a, b, c, col, part = 0) { this._tri(a, b, c, null, null, null, col, col, col, part); }
  quad(a, b, c, d, col, part = 0) { this.tri(a, b, c, col, part); this.tri(a, c, d, col, part); }
  /** Flat quad wound so that its face points away from `from`. */
  quadOut(a, b, c, d, from, col, part = 0) {
    const n = cross(sub(b, a), sub(c, a));
    if (dot(n, sub(a, from)) >= 0) this.quad(a, b, c, d, col, part); else this.quad(a, d, c, b, col, part);
  }
  /** Flat quad with a color at each corner, wound to face away from `from`. */
  quadC(a, b, c, d, from, ca, cb, cc, cd, part = 0) {
    if (dot(cross(sub(b, a), sub(c, a)), sub(a, from)) >= 0) { this._tri(a, b, c, null, null, null, ca, cb, cc, part); this._tri(a, c, d, null, null, null, ca, cc, cd, part); }
    else { this._tri(a, d, c, null, null, null, ca, cd, cc, part); this._tri(a, c, b, null, null, null, ca, cc, cb, part); }
  }
  /** Sloped quad wound so that it faces upward (roofs). */
  roof(a, b, c, d, col, part = 0) {
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (nz > 0) this.quad(a, b, c, d, col, part); else this.quad(a, d, c, b, col, part);
  }
  /**
   * Vertical (or battered) wall face from p to q between heights z0 and z1, oriented to face (fx, fy);
   * darker at its foot. `batter` pushes the foot outward by that many meters.
   */
  wall(p, q, z0, z1, fx, fy, col, part = 0, foot = 0.62, batter = 0) {
    if ((q[1] - p[1]) * fx - (q[0] - p[0]) * fy < 0) { const t = p; p = q; q = t; }
    const dk = [col[0] * foot, col[1] * foot, col[2] * foot];
    const ux = q[0] - p[0], uy = q[1] - p[1], l = Math.hypot(ux, uy) || 1, nx = uy / l, ny = -ux / l;
    const a = [p[0] + nx * batter, p[1] + ny * batter, z0], b = [q[0] + nx * batter, q[1] + ny * batter, z0], c = [q[0], q[1], z1], d = [p[0], p[1], z1];
    const n = batter ? unit([nx * (z1 - z0), ny * (z1 - z0), batter]) : [nx, ny, 0];
    this._tri(a, b, c, n, n, n, dk, dk, col, part); this._tri(a, c, d, n, n, n, dk, col, col, part);
  }
  /** Horizontal face through four points at height z, wound to face up. */
  floor(a, b, c, d, z, col, part = 0) {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const P = (p) => [p[0], p[1], z];
    if (area > 0) this.quad(P(a), P(b), P(c), P(d), col, part); else this.quad(P(a), P(d), P(c), P(b), col, part);
  }

  // ------------------------------------------------------------ hard shapes
  /** Box from a center, a frame of three half-axes and a color. `shade` darkens the underside. */
  frameBox(c, ax, ay, az, col, part = 0, shade = 0) {
    // a mirrored frame would turn the faces inside out; a box is symmetric, so just flip one axis back
    if (ax[0] * (ay[1] * az[2] - ay[2] * az[1]) - ax[1] * (ay[0] * az[2] - ay[2] * az[0]) + ax[2] * (ay[0] * az[1] - ay[1] * az[0]) < 0) az = [-az[0], -az[1], -az[2]];
    const P = (sx, sy, sz) => [c[0] + ax[0] * sx + ay[0] * sy + az[0] * sz, c[1] + ax[1] * sx + ay[1] * sy + az[1] * sz, c[2] + ax[2] * sx + ay[2] * sy + az[2] * sz];
    const p = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
    const dk = shade ? [col[0] * (1 - shade), col[1] * (1 - shade), col[2] * (1 - shade)] : col;
    this.quad(p[4], p[5], p[6], p[7], col, part);  // top
    this.quad(p[3], p[2], p[1], p[0], dk, part);   // bottom
    this.quad(p[0], p[1], p[5], p[4], col, part);
    this.quad(p[1], p[2], p[6], p[5], col, part);
    this.quad(p[2], p[3], p[7], p[6], col, part);
    this.quad(p[3], p[0], p[4], p[7], col, part);
  }
  /** Axis-aligned box (optionally yawed): center and full sizes. */
  box(cx, cy, cz, sx, sy, sz, col, part = 0, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.frameBox([cx, cy, cz], [c * sx / 2, s * sx / 2, 0], [-s * sy / 2, c * sy / 2, 0], [0, 0, sz / 2], col, part);
  }
  /**
   * Box with chamfered edges, shaded across the chamfers so the edges read as rounded and catch the
   * light: center, full sizes and chamfer width.
   */
  cbox(cx, cy, cz, sx, sy, sz, ch, col, part = 0) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    ch = Math.min(ch, hx * 0.9, hy * 0.9, hz * 0.9);
    // each corner splits into three points, one on each of the faces that meet there
    const P = (ix, iy, iz, f) => [cx + ix * (hx - (f === 0 ? 0 : ch)), cy + iy * (hy - (f === 1 ? 0 : ch)), cz + iz * (hz - (f === 2 ? 0 : ch))];
    const N = (ix, iy, iz, f) => (f === 0 ? [ix, 0, 0] : f === 1 ? [0, iy, 0] : [0, 0, iz]);
    const cen = [cx, cy, cz];
    const q = (pts) => {
      const [a, b, c, d] = pts.map((p) => P(...p)), [na, nb, nc, nd] = pts.map((p) => N(...p));
      const out = dot(cross(sub(b, a), sub(c, a)), sub(add(a, c), mul(cen, 2))) >= 0;
      if (out) { this._tri(a, b, c, na, nb, nc, col, col, col, part); this._tri(a, c, d, na, nc, nd, col, col, col, part); }
      else { this._tri(a, d, c, na, nd, nc, col, col, col, part); this._tri(a, c, b, na, nc, nb, col, col, col, part); }
    };
    for (const s of [-1, 1]) {
      q([[s, -1, -1, 0], [s, 1, -1, 0], [s, 1, 1, 0], [s, -1, 1, 0]]);
      q([[-1, s, -1, 1], [1, s, -1, 1], [1, s, 1, 1], [-1, s, 1, 1]]);
      q([[-1, -1, s, 2], [1, -1, s, 2], [1, 1, s, 2], [-1, 1, s, 2]]);
      for (const t of [-1, 1]) {
        q([[s, t, -1, 0], [s, t, 1, 0], [s, t, 1, 1], [s, t, -1, 1]]);   // edges along z
        q([[s, -1, t, 0], [s, 1, t, 0], [s, 1, t, 2], [s, -1, t, 2]]);   // edges along y
        q([[-1, s, t, 1], [1, s, t, 1], [1, s, t, 2], [-1, s, t, 2]]);   // edges along x
        for (const w of [-1, 1]) {
          const a = P(s, t, w, 0), b = P(s, t, w, 1), c = P(s, t, w, 2);
          const na = N(s, t, w, 0), nb = N(s, t, w, 1), nc = N(s, t, w, 2);
          if (dot(cross(sub(b, a), sub(c, a)), sub(a, cen)) >= 0) this._tri(a, b, c, na, nb, nc, col, col, col, part);
          else this._tri(a, c, b, na, nc, nb, col, col, col, part);
        }
      }
    }
  }
  /** Square-section beam between two points. */
  beam(a, b, t, col, part = 0, t2 = t) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1;
    const ax = [dx / 2, dy / 2, dz / 2];
    let ux = -dy, uy = dx; let ul = Math.hypot(ux, uy);
    if (ul < 1e-4) { ux = 1; uy = 0; ul = 1; }
    ux /= ul; uy /= ul;
    const wx = (dy / L) * 0 - (dz / L) * uy, wy = (dz / L) * ux - (dx / L) * 0, wz = (dx / L) * uy - (dy / L) * ux;
    this.frameBox([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], ax, [ux * t / 2, uy * t / 2, 0], [wx * t2 / 2, wy * t2 / 2, wz * t2 / 2], col, part);
  }
  /**
   * Solid between two outlines with the same number of points (bottom and top), flat shaded.
   * Caps are fanned from their centroids, so outlines should be convex or nearly so.
   */
  prism(bot, top, col, part = 0, capCol = col) {
    const n = bot.length, cen = [0, 0, 0];
    for (const p of bot.concat(top)) { cen[0] += p[0] / (2 * n); cen[1] += p[1] / (2 * n); cen[2] += p[2] / (2 * n); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quadOut(bot[i], bot[j], top[j], top[i], cen, col, part); }
    for (const ring of [bot, top]) {
      const c = [0, 0, 0];
      for (const p of ring) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; }
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        if (dot(cross(sub(a, c), sub(b, c)), sub(c, cen)) >= 0) this.tri(c, a, b, capCol, part); else this.tri(c, b, a, capCol, part);
      }
    }
  }
  /** Side outline [[x, z], ...] pushed across the width from y0 to y1 (hulls, wedges, fins). */
  extrudeY(pts, y0, y1, col, part = 0, capCol = col) { this.prism(pts.map((p) => [p[0], y0, p[1]]), pts.map((p) => [p[0], y1, p[1]]), col, part, capCol); }
  /** Plan outline [[x, y], ...] raised from z0 to z1; the top can be shrunk (`taper`) and shifted. */
  extrudeZ(pts, z0, z1, col, part = 0, taper = 1, dx = 0, dy = 0, capCol = col) {
    let cx = 0, cy = 0; for (const p of pts) { cx += p[0] / pts.length; cy += p[1] / pts.length; }
    this.prism(pts.map((p) => [p[0], p[1], z0]), pts.map((p) => [cx + (p[0] - cx) * taper + dx, cy + (p[1] - cy) * taper + dy, z1]), col, part, capCol);
  }
  /** Cross-section [[y, z], ...] pushed along x from x0 to x1. */
  extrudeX(pts, x0, x1, col, part = 0, capCol = col) { this.prism(pts.map((p) => [x0, p[0], p[1]]), pts.map((p) => [x1, p[0], p[1]]), col, part, capCol); }

  // ---------------------------------------------------------- smooth shapes
  /**
   * Skin a row of rings with smooth normals. A ring is { c, u, v, col? }: its points are
   * c + u cos t + v sin t. Repeat a ring to put a hard crease there; a ring of zero radius closes
   * the surface to a point. Options: capA / capB (default true), flat, n0 / n1 to skin only part
   * of the way round (an open shell, lit on both sides).
   */
  loft(rings, n, col, part = 0, o = {}) {
    const m = rings.length, a0 = o.a0 || 0, a1 = o.a1 == null ? TAU : o.a1, closed = Math.abs(a1 - a0 - TAU) < 1e-6;
    const cols = closed ? n : n + 1;
    const P = rings.map((r) => { const row = []; for (let k = 0; k < cols; k++) { const t = a0 + ((a1 - a0) * k) / n, c = Math.cos(t), s = Math.sin(t); row.push([r.c[0] + r.u[0] * c + r.v[0] * s, r.c[1] + r.u[1] * c + r.v[1] * s, r.c[2] + r.u[2] * c + r.v[2] * s]); } return row; });
    const nb = (k, d) => (closed ? (k + d + cols) % cols : Math.max(0, Math.min(cols - 1, k + d)));
    // raw normals from the surface tangents. They are consistent along the surface, so one sign fixes
    // them all: where the profile starts, the surface faces away from the axis (or, on a flat end, backward)
    const Nn = [];
    /** Unit vector along the row of rings at ring i, pointing toward ring 0. */
    const back = (i) => { for (let d = 1; d < m; d++) { for (const j of [i + d, i - d]) if (j >= 0 && j < m) { const a = sub(rings[i].c, rings[j].c); if (len(a) > 1e-6) return unit(j > i ? a : mul(a, -1)); } } return unit(cross(rings[i].u, rings[i].v)); };
    let sgn = 0;
    for (let i = 0; i < m; i++) {
      const row = [];
      for (let k = 0; k < cols; k++) {
        const around = sub(P[i][nb(k, 1)], P[i][nb(k, -1)]), along = sub(P[Math.min(m - 1, i + 1)][k], P[Math.max(0, i - 1)][k]);
        const nrm = cross(around, along), l = len(nrm);
        if (l < 1e-9) { row.push(null); continue; }
        const q = mul(nrm, 1 / l);
        if (!sgn) { const rad = sub(P[i][k], rings[i].c), s = dot(q, rad); sgn = Math.abs(s) > 1e-4 * len(rad) ? Math.sign(s) : Math.sign(dot(q, back(i))) || 1; }
        row.push(q);
      }
      Nn.push(row);
    }
    if (!sgn) sgn = 1;
    for (let i = 0; i < m; i++) for (let k = 0; k < cols; k++) {
      if (Nn[i][k]) { if (sgn < 0) Nn[i][k] = mul(Nn[i][k], -1); continue; }
      // a pinched ring: take the direction its nearest full neighbor faces, on average
      let av = null;
      for (let d = 1; d < m && !av; d++) for (const j of [i - d, i + d]) {
        if (j < 0 || j >= m || av) continue;
        const sum = [0, 0, 0]; let cnt = 0;
        for (const q of Nn[j]) if (q) { sum[0] += q[0] * (sgn < 0 && j > i ? -1 : 1); sum[1] += q[1] * (sgn < 0 && j > i ? -1 : 1); sum[2] += q[2] * (sgn < 0 && j > i ? -1 : 1); cnt++; }
        if (cnt && len(sum) > 1e-6) av = unit(sum);
      }
      Nn[i][k] = av || (i === m - 1 ? mul(back(i), -1) : back(i));
    }
    const cOf = (i) => rings[i].col || col;
    for (let i = 0; i < m - 1; i++) {
      const c0 = cOf(i), c1 = cOf(i + 1);
      for (let k = 0; k < n; k++) {
        const k1 = closed ? (k + 1) % n : k + 1;
        const a = P[i][k], b = P[i][k1], c = P[i + 1][k1], d = P[i + 1][k];
        const na = o.flat ? null : Nn[i][k], nbb = o.flat ? null : Nn[i][k1], nc = o.flat ? null : Nn[i + 1][k1], nd = o.flat ? null : Nn[i + 1][k];
        const t1 = len(cross(sub(b, a), sub(c, a))) > 1e-10, t2 = len(cross(sub(c, a), sub(d, a))) > 1e-10;
        if (sgn > 0) { if (t1) this._tri(a, b, c, na, nbb, nc, c0, c0, c1, part); if (t2) this._tri(a, c, d, na, nc, nd, c0, c1, c1, part); }
        else { if (t2) this._tri(a, d, c, na, nd, nc, c0, c1, c1, part); if (t1) this._tri(a, c, b, na, nc, nbb, c0, c1, c0, part); }
      }
    }
    if (!closed) return;
    for (const [i, on] of [[0, o.capA !== false], [m - 1, o.capB !== false]]) {
      if (!on || len(rings[i].u) < 1e-6) continue;
      const cn = i === 0 ? back(0) : mul(back(i), -1), c = rings[i].c, cc = cOf(i);
      for (let k = 0; k < n; k++) {
        const a = P[i][k], b = P[i][(k + 1) % n];
        if (dot(cross(sub(a, c), sub(b, c)), cn) >= 0) this._tri(c, a, b, cn, cn, cn, cc, cc, cc, part); else this._tri(c, b, a, cn, cn, cn, cc, cc, cc, part);
      }
    }
  }
  /** Round bar through a list of points with a radius at each (limbs, barrels, ropes). */
  path(pts, radii, n, col, part = 0, o = {}) {
    const rings = []; let u = null;
    for (let i = 0; i < pts.length; i++) {
      const d = unit(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
      if (!u) { u = cross(Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1], d); }
      u = unit(sub(u, mul(d, dot(u, d))));
      const v = cross(d, u), r = typeof radii === 'number' ? radii : radii[i], r2 = o.flatten ? r * o.flatten : r;
      rings.push({ c: pts[i], u: mul(u, r), v: mul(v, r2), col: o.cols ? o.cols[i] : undefined });
    }
    this.loft(rings, n, col, part, o);
  }
  tube(a, b, r0, r1, n, col, part = 0, o = {}) { this.path([a, b], [r0, r1], n, col, part, o); }
  /**
   * Ellipsoid (r may be [rx, ry, rz]). `from` / `to` (0..1, south pole to north) cut it down to a
   * dome or a band; cut ends are capped.
   */
  sphere(c, r, col, part = 0, n = 8, m = 5, from = 0, to = 1) {
    const R = typeof r === 'number' ? [r, r, r] : r, rings = [];
    for (let i = 0; i <= m; i++) {
      const ph = Math.PI * (from + ((to - from) * i) / m), s = Math.sin(ph);
      rings.push(ringZ(c[0], c[1], c[2] - Math.cos(ph) * R[2], Math.abs(s) < 1e-6 ? 0 : s * R[0], Math.abs(s) < 1e-6 ? 0 : s * R[1]));
    }
    this.loft(rings, n, col, part);
  }
  /**
   * Turned profile [[r, h, col?], ...] spun about an axis ('z' default, 'x' or 'y') through `at`.
   * Repeat a profile point for a hard edge.
   */
  lathe(profile, n, col, part = 0, at = [0, 0, 0], axis = 'z', o = {}) {
    const rings = profile.map(([r, h, c]) => (axis === 'z' ? ringZ(at[0], at[1], at[2] + h, r, r, c) : axis === 'x' ? ringX(at[0] + h, at[1], at[2], r, r, c) : ringY(at[0], at[1] + h, at[2], r, r, c)));
    this.loft(rings, n, col, part, o);
  }

  // ------------------------------------------------ older helpers, kept working
  /** Vertical cylinder / cone frustum, smooth shaded. */
  cyl(cx, cy, z0, z1, r0, r1, n, col, part = 0, cap = true) {
    this.loft([ringZ(cx, cy, z0, r0), ringZ(cx, cy, z1, r1)], n, col, part, { capA: false, capB: cap && r1 > 0.01 });
  }
  /** Cylinder lying along local y (wheels, logs). */
  wheel(cx, cy, cz, r, w, col, part = 0, n = 8) {
    this.lathe([[r, -w / 2], [r, w / 2]], n, col, part, [cx, cy, cz], 'y');
  }
  /** Squat blob: cheap stand-in for a sphere. */
  ball(cx, cy, cz, r, col, part = 0) { this.sphere([cx, cy, cz], r, col, part, 6, 3); }

  /**
   * Pack into the GPU layout — f32 pos[3], i8 normal[3], u8 part, u8 rgb, u8 material (20 bytes) —
   * and, unless `indexed` is false, merge identical vertices into an index buffer.
   */
  build(indexed = true) {
    const n = this.v.length / V, buf = new ArrayBuffer(n * 20), f = new Float32Array(buf), i8 = new Int8Array(buf), u8 = new Uint8Array(buf);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z1 = -1e9, cr = 0, cg = 0, cb = 0;
    const v = this.v;
    for (let k = 0; k < n; k++) {
      const o = k * V, b = k * 20;
      f[k * 5] = v[o]; f[k * 5 + 1] = v[o + 1]; f[k * 5 + 2] = v[o + 2];
      i8[b + 12] = Math.round(v[o + 3] * 127); i8[b + 13] = Math.round(v[o + 4] * 127); i8[b + 14] = Math.round(v[o + 5] * 127); u8[b + 15] = v[o + 9];
      u8[b + 16] = Math.max(0, Math.min(255, v[o + 6] * 255)); u8[b + 17] = Math.max(0, Math.min(255, v[o + 7] * 255)); u8[b + 18] = Math.max(0, Math.min(255, v[o + 8] * 255)); u8[b + 19] = v[o + 10];
      if (v[o] < x0) x0 = v[o]; if (v[o] > x1) x1 = v[o]; if (v[o + 1] < y0) y0 = v[o + 1]; if (v[o + 1] > y1) y1 = v[o + 1]; if (v[o + 2] > z1) z1 = v[o + 2];
      cr += v[o + 6]; cg += v[o + 7]; cb += v[o + 8];
    }
    const out = { data: buf, count: n, nverts: n, tris: n / 3, index: null, bbox: [x0, x1, y0, y1, z1], avg: n ? [cr / n, cg / n, cb / n] : [0.5, 0.5, 0.5] };
    if (!indexed || n === 0) return out;
    // weld: hash the five 32-bit words of each vertex into an open-addressed table
    const w = new Uint32Array(buf), cap = 1 << Math.ceil(Math.log2(n * 2 + 1)), table = new Int32Array(cap).fill(-1);
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n), keep = new Uint32Array(n);
    let uniq = 0;
    for (let k = 0; k < n; k++) {
      const o = k * 5;
      let h = (Math.imul(w[o], 0x9e3779b1) ^ Math.imul(w[o + 1], 0x85ebca6b) ^ Math.imul(w[o + 2], 0xc2b2ae35) ^ Math.imul(w[o + 3], 0x27d4eb2f) ^ Math.imul(w[o + 4], 0x165667b1)) >>> 0;
      h = (h ^ (h >>> 15)) & (cap - 1);
      for (;;) {
        const t = table[h];
        if (t < 0) { table[h] = uniq; keep[uniq] = k; idx[k] = uniq++; break; }
        const p = keep[t] * 5;
        if (w[p] === w[o] && w[p + 1] === w[o + 1] && w[p + 2] === w[o + 2] && w[p + 3] === w[o + 3] && w[p + 4] === w[o + 4]) { idx[k] = t; break; }
        h = (h + 1) & (cap - 1);
      }
    }
    const packed = new ArrayBuffer(uniq * 20), pw = new Uint32Array(packed);
    for (let k = 0; k < uniq; k++) { const s = keep[k] * 5, d = k * 5; pw[d] = w[s]; pw[d + 1] = w[s + 1]; pw[d + 2] = w[s + 2]; pw[d + 3] = w[s + 3]; pw[d + 4] = w[s + 4]; }
    out.data = packed; out.nverts = uniq; out.index = uniq > 65535 ? idx : new Uint16Array(idx);
    return out;
  }
}
