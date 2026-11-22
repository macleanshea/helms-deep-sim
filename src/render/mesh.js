// Procedural low-poly meshes for every unit, vehicle, aircraft and prop.
// Local space: +x forward, +y left, +z up, origin at the feet. Each vertex carries a
// "part" id that the vertex shader animates (1/2 legs, 3 weapon arm, 5 banner, 6 rotor).

const V = 10; // floats per vertex while building: pos3 normal3 color3 part

export class MeshBuilder {
  constructor() { this.v = []; }

  tri(a, b, c, col, part = 0) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) this.v.push(p[0], p[1], p[2], nx, ny, nz, col[0], col[1], col[2], part);
  }
  quad(a, b, c, d, col, part = 0) { this.tri(a, b, c, col, part); this.tri(a, c, d, col, part); }
  /** Sloped quad wound so that it faces upward (roofs). */
  roof(a, b, c, d, col, part = 0) {
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (nz > 0) this.quad(a, b, c, d, col, part); else this.quad(a, d, c, b, col, part);
  }
  /** Vertical wall face from p to q between heights z0 and z1, oriented to face (fx, fy); darker at its foot. */
  wall(p, q, z0, z1, fx, fy, col, part = 0, foot = 0.62) {
    if ((q[1] - p[1]) * fx - (q[0] - p[0]) * fy < 0) { const t = p; p = q; q = t; }
    const dk = [col[0] * foot, col[1] * foot, col[2] * foot];
    const a = [p[0], p[1], z0], b = [q[0], q[1], z0], c = [q[0], q[1], z1], d = [p[0], p[1], z1];
    const ux = b[0] - a[0], uy = b[1] - a[1], l = Math.hypot(ux, uy) || 1, nx = uy / l, ny = -ux / l;
    const put = (v, cl) => this.v.push(v[0], v[1], v[2], nx, ny, 0, cl[0], cl[1], cl[2], part);
    put(a, dk); put(b, dk); put(c, col); put(a, dk); put(c, col); put(d, col);
  }
  /** Horizontal face through four points at height z, wound to face up. */
  floor(a, b, c, d, z, col, part = 0) {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const P = (p) => [p[0], p[1], z];
    if (area > 0) this.quad(P(a), P(b), P(c), P(d), col, part); else this.quad(P(a), P(d), P(c), P(b), col, part);
  }

  /** Box from 8 corners given as a centre, an orthonormal-ish frame and half sizes. */
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
  /** Axis-aligned box (optionally yawed): centre and full sizes. */
  box(cx, cy, cz, sx, sy, sz, col, part = 0, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.frameBox([cx, cy, cz], [c * sx / 2, s * sx / 2, 0], [-s * sy / 2, c * sy / 2, 0], [0, 0, sz / 2], col, part);
  }
  /** Square-section beam between two points. */
  beam(a, b, t, col, part = 0) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1;
    const ax = [dx / 2, dy / 2, dz / 2];
    let ux = -dy, uy = dx, uz = 0; let ul = Math.hypot(ux, uy);
    if (ul < 1e-4) { ux = 1; uy = 0; ul = 1; }
    ux /= ul; uy /= ul;
    const wx = (dy / L) * uz - (dz / L) * uy, wy = (dz / L) * ux - (dx / L) * uz, wz = (dx / L) * uy - (dy / L) * ux;
    this.frameBox([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], ax, [ux * t / 2, uy * t / 2, 0], [wx * t / 2, wy * t / 2, wz * t / 2], col, part);
  }
  /** Vertical cylinder / cone frustum. */
  cyl(cx, cy, z0, z1, r0, r1, n, col, part = 0, cap = true) {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * 6.2832, a1 = ((k + 1) / n) * 6.2832, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const sh = 0.82 + 0.18 * Math.cos(a0 + 0.6), cc = [col[0] * sh, col[1] * sh, col[2] * sh];
      this.quad([cx + c0 * r0, cy + s0 * r0, z0], [cx + c1 * r0, cy + s1 * r0, z0], [cx + c1 * r1, cy + s1 * r1, z1], [cx + c0 * r1, cy + s0 * r1, z1], cc, part);
      if (cap && r1 > 0.01) this.tri([cx, cy, z1], [cx + c0 * r1, cy + s0 * r1, z1], [cx + c1 * r1, cy + s1 * r1, z1], col, part);
    }
  }
  /** Cylinder lying along local y (wheels, logs). */
  wheel(cx, cy, cz, r, w, col, part = 0, n = 8) {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * 6.2832, a1 = ((k + 1) / n) * 6.2832;
      const p0 = [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r];
      this.quad([p0[0], cy - w / 2, p0[1]], [p0[0], cy + w / 2, p0[1]], [p1[0], cy + w / 2, p1[1]], [p1[0], cy - w / 2, p1[1]], col, part);
      this.tri([cx, cy + w / 2, cz], [p1[0], cy + w / 2, p1[1]], [p0[0], cy + w / 2, p0[1]], col, part);
      this.tri([cx, cy - w / 2, cz], [p0[0], cy - w / 2, p0[1]], [p1[0], cy - w / 2, p1[1]], col, part);
    }
  }
  /** Squat octahedral blob: cheap stand-in for a sphere. */
  ball(cx, cy, cz, r, col, part = 0) {
    this.cyl(cx, cy, cz - r, cz - r * 0.35, r * 0.55, r, 6, col, part, false);
    this.cyl(cx, cy, cz - r * 0.35, cz + r * 0.4, r, r * 0.92, 6, col, part, false);
    this.cyl(cx, cy, cz + r * 0.4, cz + r, r * 0.92, r * 0.4, 6, col, part, true);
  }

  /** Pack into the GPU layout: f32 pos[3], i8 normal[3], u8 part, u8 rgba  (20 bytes). */
  build() {
    const n = this.v.length / V, buf = new ArrayBuffer(n * 20), f = new Float32Array(buf), i8 = new Int8Array(buf), u8 = new Uint8Array(buf);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z1 = -1e9, cr = 0, cg = 0, cb = 0;
    for (let k = 0; k < n; k++) {
      const o = k * V, b = k * 20, v = this.v;
      f[k * 5] = v[o]; f[k * 5 + 1] = v[o + 1]; f[k * 5 + 2] = v[o + 2];
      i8[b + 12] = v[o + 3] * 127; i8[b + 13] = v[o + 4] * 127; i8[b + 14] = v[o + 5] * 127; u8[b + 15] = v[o + 9];
      u8[b + 16] = Math.min(255, v[o + 6] * 255); u8[b + 17] = Math.min(255, v[o + 7] * 255); u8[b + 18] = Math.min(255, v[o + 8] * 255); u8[b + 19] = 255;
      x0 = Math.min(x0, v[o]); x1 = Math.max(x1, v[o]); y0 = Math.min(y0, v[o + 1]); y1 = Math.max(y1, v[o + 1]); z1 = Math.max(z1, v[o + 2]);
      cr += v[o + 6]; cg += v[o + 7]; cb += v[o + 8];
    }
    return { data: buf, count: n, bbox: [x0, x1, y0, y1, z1], avg: [cr / n, cg / n, cb / n] };
  }
}

// ------------------------------------------------------------------ palette
const C = {
  uni: [0.42, 0.44, 0.28], uniDk: [0.27, 0.29, 0.19], vest: [0.24, 0.26, 0.18], helm: [0.33, 0.36, 0.22], skin: [0.72, 0.56, 0.44], gun: [0.09, 0.09, 0.09],
  ghil: [0.3, 0.37, 0.2], veh: [0.34, 0.37, 0.23], vehDk: [0.22, 0.24, 0.16], track: [0.1, 0.1, 0.09], steel: [0.3, 0.31, 0.33], crate: [0.44, 0.42, 0.27],
  iron: [0.2, 0.19, 0.2], ironLt: [0.36, 0.36, 0.39], rust: [0.42, 0.14, 0.1], hide: [0.3, 0.2, 0.14], pale: [0.58, 0.5, 0.42], white: [0.9, 0.88, 0.82], blade: [0.66, 0.68, 0.7],
  wood: [0.42, 0.29, 0.17], woodDk: [0.27, 0.18, 0.1], fur: [0.3, 0.25, 0.2], troll: [0.4, 0.42, 0.36], trollDk: [0.27, 0.28, 0.25], stone: [0.5, 0.49, 0.46],
  jet: [0.48, 0.52, 0.55], glass: [0.12, 0.2, 0.24], chute: [0.8, 0.8, 0.72], olive: [0.45, 0.5, 0.33], water: [0.08, 0.13, 0.16], earth: [0.3, 0.24, 0.17], red: [0.7, 0.16, 0.1], amber: [0.95, 0.7, 0.2],
};

function soldier(m, o = {}) {
  const uni = o.uni || C.uni, helm = o.helm || C.helm;
  m.box(0, 0.13, 0.42, 0.2, 0.19, 0.84, C.uniDk, 1); m.box(0, -0.13, 0.42, 0.2, 0.19, 0.84, C.uniDk, 2);
  m.box(0, 0, 1.14, 0.3, 0.48, 0.62, uni);
  m.box(0.02, 0, 1.2, 0.36, 0.42, 0.42, C.vest);
  m.box(-0.24, 0, 1.2, 0.2, 0.36, 0.46, C.uniDk);
  m.ball(0.03, 0, 1.6, 0.14, C.skin);
  m.ball(0.02, 0, 1.68, 0.17, helm);
  m.box(0.24, 0.2, 1.26, 0.4, 0.11, 0.11, uni, 3); m.box(0.2, -0.2, 1.26, 0.34, 0.11, 0.11, uni, 3);
}
function orcBody(m, o = {}) {
  const arm = o.armor || C.iron, cloth = o.cloth || C.rust;
  m.box(0, 0.15, 0.42, 0.24, 0.22, 0.84, C.iron, 1); m.box(0, -0.15, 0.42, 0.24, 0.22, 0.84, C.iron, 2);
  m.box(0, 0, 0.92, 0.3, 0.5, 0.3, cloth);
  m.box(0, 0, 1.24, 0.38, 0.6, 0.6, o.bare ? C.pale : arm);
  if (!o.bare) { m.box(0, 0.34, 1.5, 0.3, 0.2, 0.16, C.ironLt); m.box(0, -0.34, 1.5, 0.3, 0.2, 0.16, C.ironLt); }
  m.ball(0.04, 0, 1.7, 0.16, o.bare ? C.pale : C.ironLt);
  if (!o.bare) m.box(0.1, 0, 1.76, 0.1, 0.12, 0.14, C.white); // the White Hand
  m.box(0.22, 0.26, 1.3, 0.4, 0.13, 0.13, o.bare ? C.pale : arm, 3);
}

const defs = {
  rifle: (m) => { soldier(m); m.box(0.5, 0.1, 1.3, 0.9, 0.06, 0.1, C.gun, 3); },
  mg: (m) => { soldier(m); m.box(0.6, 0.1, 1.24, 1.2, 0.09, 0.13, C.gun, 3); m.box(0.25, 0.22, 1.16, 0.22, 0.18, 0.2, C.vehDk, 3); m.beam([1.05, 0.1, 1.2], [1.2, 0.3, 0.85], 0.04, C.gun, 3); m.beam([1.05, 0.1, 1.2], [1.2, -0.1, 0.85], 0.04, C.gun, 3); },
  marksman: (m) => { soldier(m, { uni: C.ghil, helm: C.ghil }); m.box(0.62, 0.1, 1.32, 1.25, 0.05, 0.08, C.gun, 3); m.box(0.4, 0.1, 1.42, 0.3, 0.06, 0.07, C.gun, 3); },
  grenadier: (m) => { soldier(m); m.box(0.45, 0.1, 1.3, 0.75, 0.06, 0.1, C.gun, 3); m.box(0.5, 0.1, 1.2, 0.4, 0.11, 0.12, C.steel, 3); },
  at: (m) => { soldier(m); m.box(0.15, 0.24, 1.62, 1.3, 0.16, 0.16, C.vehDk, 3); m.box(0.82, 0.24, 1.62, 0.12, 0.2, 0.2, C.gun, 3); },
  cmd: (m) => { soldier(m, { helm: [0.25, 0.3, 0.2] }); m.box(0.45, 0.1, 1.3, 0.7, 0.06, 0.1, C.gun, 3); m.box(-0.26, 0, 1.3, 0.24, 0.4, 0.56, C.vehDk); m.beam([-0.3, 0.12, 1.5], [-0.42, 0.12, 3.3], 0.035, C.gun); m.box(-0.62, 0.12, 3.05, 0.42, 0.03, 0.3, [0.35, 0.7, 0.9], 5); },
  mortar: (m) => {
    m.cyl(0.5, 0, 0, 0.08, 0.45, 0.45, 8, C.vehDk);
    m.beam([0.5, 0, 0.05], [1.05, 0, 1.25], 0.16, C.steel, 3); m.beam([1.0, 0, 1.1], [1.25, 0.4, 0], 0.05, C.gun); m.beam([1.0, 0, 1.1], [1.25, -0.4, 0], 0.05, C.gun);
    m.box(-0.35, 0.5, 0.3, 0.5, 0.3, 0.3, C.crate);
    // one kneeling crewman
    m.box(-0.5, -0.3, 0.3, 0.5, 0.4, 0.5, C.uniDk); m.box(-0.45, -0.3, 0.78, 0.3, 0.46, 0.5, C.uni); m.ball(-0.4, -0.3, 1.15, 0.14, C.skin); m.ball(-0.41, -0.3, 1.23, 0.17, C.helm);
  },
  howitzer: (m) => {
    m.wheel(0, 1.0, 0.6, 0.6, 0.3, C.track); m.wheel(0, -1.0, 0.6, 0.6, 0.3, C.track);
    m.beam([-0.2, 0.5, 0.6], [-4.2, 1.5, 0.15], 0.24, C.veh); m.beam([-0.2, -0.5, 0.6], [-4.2, -1.5, 0.15], 0.24, C.veh);
    m.box(0.1, 0, 1.25, 0.2, 2.0, 1.2, C.veh); m.box(-0.3, 0, 1.0, 1.3, 0.7, 0.6, C.vehDk);
    m.beam([-0.6, 0, 1.25], [4.6, 0, 2.5], 0.26, C.veh, 3); m.beam([4.2, 0, 2.4], [4.8, 0, 2.55], 0.36, C.vehDk, 3);
  },
  ifv: (m) => {
    m.box(0, 0, 1.25, 6.6, 2.9, 1.3, C.veh); m.box(2.9, 0, 1.0, 1.4, 2.7, 0.8, C.veh); m.box(-1.2, 0, 1.95, 2.6, 2.4, 0.12, C.vehDk);
    for (const x of [-2.4, -0.8, 0.8, 2.4]) { m.wheel(x, 1.45, 0.55, 0.55, 0.4, C.track); m.wheel(x, -1.45, 0.55, 0.55, 0.4, C.track); }
  },
  ifvTurret: (m) => { m.box(0, 0, 2.3, 1.9, 1.7, 0.6, C.veh); m.box(1.9, 0, 2.32, 2.6, 0.13, 0.13, C.gun, 3); m.box(-0.3, 0.5, 2.68, 0.5, 0.4, 0.2, C.vehDk); },
  tank: (m) => {
    m.box(0, 0, 1.15, 7.4, 2.4, 1.0, C.veh); m.box(3.2, 0, 0.95, 1.4, 2.4, 0.6, C.vehDk);
    m.box(0, 1.55, 0.6, 7.8, 0.75, 1.1, C.track); m.box(0, -1.55, 0.6, 7.8, 0.75, 1.1, C.track);
    m.box(0, 1.55, 1.2, 7.6, 0.85, 0.12, C.vehDk); m.box(0, -1.55, 1.2, 7.6, 0.85, 0.12, C.vehDk);
    m.box(-2.6, 0, 1.72, 2.0, 2.2, 0.16, C.vehDk);
  },
  tankTurret: (m) => { m.box(0.2, 0, 2.05, 3.4, 2.5, 0.8, C.veh); m.box(-1.4, 0, 2.0, 1.0, 2.0, 0.6, C.vehDk); m.box(3.9, 0, 2.08, 4.6, 0.2, 0.2, C.gun, 3); m.box(2.2, 0, 2.08, 0.9, 0.5, 0.5, C.vehDk, 3); m.cyl(-0.2, 0.6, 2.45, 2.75, 0.34, 0.3, 6, C.vehDk); },
  cache: (m) => { m.box(-0.8, 0.5, 0.45, 1.5, 1.1, 0.9, C.crate); m.box(0.8, 0.4, 0.4, 1.4, 1.2, 0.8, [0.38, 0.4, 0.26]); m.box(-0.5, -0.8, 0.4, 1.6, 1.0, 0.8, [0.4, 0.38, 0.24]); m.box(0.9, -0.8, 0.35, 1.2, 1.0, 0.7, C.crate); m.box(0, 0, 1.2, 1.5, 1.2, 0.7, [0.47, 0.45, 0.28]); m.box(0, 0, 1.58, 3.6, 3.2, 0.06, [0.24, 0.3, 0.17]); m.box(0.3, 0.2, 1.3, 0.5, 0.04, 0.3, C.amber); },
  crate: (m) => { m.box(0, 0, 0.6, 1.8, 1.4, 1.2, C.crate); m.box(0, 0, 0.6, 1.84, 0.2, 1.24, C.vehDk); m.box(0, 0, 1.22, 0.6, 0.5, 0.04, C.amber); },
  // ---- attackers
  uruk: (m) => { orcBody(m); m.box(0.12, -0.38, 1.15, 0.08, 0.5, 0.66, C.rust); m.box(0.17, -0.38, 1.18, 0.03, 0.2, 0.26, C.white); m.beam([0.42, 0.28, 1.28], [0.95, 0.28, 2.0], 0.07, C.blade, 3); },
  archer: (m) => { orcBody(m, { cloth: [0.3, 0.2, 0.12] }); m.box(0.7, 0.18, 1.3, 0.8, 0.07, 0.07, C.woodDk, 3); m.box(0.95, 0.18, 1.3, 0.07, 0.8, 0.05, C.ironLt, 3); },
  berserker: (m) => { orcBody(m, { bare: true }); m.box(0.08, 0, 1.78, 0.2, 0.06, 0.1, C.red); m.beam([0.42, 0.28, 1.2], [1.25, 0.28, 2.4], 0.1, C.blade, 3); m.box(0.42, 0.28, 1.22, 0.1, 0.4, 0.06, C.iron, 3); },
  sapper: (m) => { orcBody(m, { bare: true, cloth: [0.25, 0.2, 0.16] }); m.ball(0.55, 0, 1.2, 0.36, [0.13, 0.13, 0.14]); for (let k = 0; k < 6; k++) { const a = k * 1.047; m.beam([0.55, 0, 1.2], [0.55 + Math.cos(a) * 0.5, Math.sin(a) * 0.5, 1.2 + (k & 1 ? 0.25 : -0.2)], 0.05, C.ironLt); } m.box(0.55, 0, 1.62, 0.06, 0.06, 0.2, C.amber); },
  chief: (m) => {
    orcBody(m, { armor: [0.26, 0.24, 0.26] }); m.box(-0.24, 0, 1.1, 0.06, 0.6, 1.0, C.red);
    m.box(0.04, 0, 1.92, 0.3, 0.06, 0.24, C.red);
    m.beam([0.44, 0.28, 1.2], [1.2, 0.28, 2.3], 0.1, C.blade, 3);
    m.beam([-0.22, -0.2, 1.2], [-0.3, -0.2, 3.9], 0.06, C.woodDk); m.box(-0.75, -0.2, 3.4, 0.86, 0.03, 0.9, C.red, 5); m.box(-0.72, -0.2, 3.42, 0.4, 0.045, 0.44, C.white, 5);
  },
  warg: (m) => {
    m.box(0, 0, 0.82, 1.7, 0.56, 0.6, C.fur); m.box(0.95, 0, 0.98, 0.56, 0.42, 0.42, [0.26, 0.21, 0.17]); m.box(1.3, 0, 0.9, 0.36, 0.24, 0.22, [0.2, 0.16, 0.13]);
    m.box(-0.95, 0, 0.9, 0.5, 0.12, 0.12, C.fur);
    m.box(0.6, 0.2, 0.3, 0.18, 0.16, 0.6, C.fur, 1); m.box(0.6, -0.2, 0.3, 0.18, 0.16, 0.6, C.fur, 2); m.box(-0.6, 0.2, 0.3, 0.18, 0.16, 0.6, C.fur, 2); m.box(-0.6, -0.2, 0.3, 0.18, 0.16, 0.6, C.fur, 1);
    m.box(-0.1, 0, 1.4, 0.34, 0.5, 0.56, C.iron); m.ball(-0.06, 0, 1.82, 0.15, C.ironLt); m.beam([0.1, 0.3, 1.4], [0.7, 0.3, 2.0], 0.06, C.blade, 3);
  },
  troll: (m) => {
    m.box(0, 0.5, 0.75, 0.6, 0.6, 1.5, C.trollDk, 1); m.box(0, -0.5, 0.75, 0.6, 0.6, 1.5, C.trollDk, 2);
    m.box(0, 0, 2.2, 1.0, 1.6, 1.5, C.troll); m.box(0.05, 0, 2.0, 1.06, 1.2, 0.9, [0.2, 0.19, 0.18]);
    m.ball(0.25, 0, 3.2, 0.42, C.troll);
    m.box(0.3, 1.0, 2.1, 0.5, 0.45, 1.5, C.troll, 3); m.box(0.3, -1.0, 2.1, 0.5, 0.45, 1.5, C.troll);
    m.beam([0.5, 1.0, 1.5], [1.6, 1.0, 3.3], 0.3, C.woodDk, 3); m.ball(1.65, 1.0, 3.4, 0.42, C.iron, 3);
  },
  ladder: (m) => {
    m.box(0, 0.35, 1.45, 12, 0.12, 0.12, C.wood); m.box(0, -0.35, 1.45, 12, 0.12, 0.12, C.wood);
    for (let x = -5.5; x <= 5.5; x += 1) m.box(x, 0, 1.45, 0.08, 0.7, 0.08, C.woodDk);
    for (const [x, y] of [[-4, 0.6], [-4, -0.6], [0, 0.6], [0, -0.6], [4, 0.6], [4, -0.6]]) { m.box(x, y, 0.42, 0.22, 0.2, 0.84, C.iron, y > 0 ? 1 : 2); m.box(x, y, 1.1, 0.34, 0.4, 0.55, C.iron); m.ball(x + 0.03, y, 1.52, 0.15, C.ironLt); }
  },
  ladderUp: (m) => {
    const top = [3.3, 0, 12.6];
    for (const y of [0.4, -0.4]) m.beam([0, y, 0], [top[0], y, top[2]], 0.16, C.wood);
    for (let k = 1; k < 24; k++) { const u = k / 24; m.beam([top[0] * u, 0.4, top[2] * u], [top[0] * u, -0.4, top[2] * u], 0.09, C.woodDk); }
    m.beam([3.3, 0.4, 12.6], [3.9, 0.4, 12.2], 0.1, C.steel); m.beam([3.3, -0.4, 12.6], [3.9, -0.4, 12.2], 0.1, C.steel);
  },
  ram: (m) => {
    for (const x of [-1.8, 1.4]) { m.wheel(x, 1.2, 0.5, 0.5, 0.3, C.woodDk); m.wheel(x, -1.2, 0.5, 0.5, 0.3, C.woodDk); }
    m.box(-0.2, 0, 0.75, 4.8, 2.2, 0.2, C.woodDk);
    for (const [x, y] of [[-2.4, 1.0], [-2.4, -1.0], [2.0, 1.0], [2.0, -1.0]]) m.beam([x, y, 0.8], [x, y * 0.3, 2.9], 0.2, C.wood);
    m.frameBox([-0.2, 0.62, 2.35], [2.5, 0, 0], [0, 0.6, -0.55], [0, 0.03, 0.03], C.hide); m.frameBox([-0.2, -0.62, 2.35], [2.5, 0, 0], [0, 0.6, 0.55], [0, -0.03, 0.03], C.hide);
    m.box(0.4, 0, 1.5, 6.4, 0.5, 0.5, C.wood, 3); m.box(3.75, 0, 1.5, 0.6, 0.62, 0.62, C.ironLt, 3);
    for (const [x, y] of [[-1.5, 0.75], [-1.5, -0.75], [0.5, 0.75], [0.5, -0.75]]) { m.box(x, y, 1.15, 0.3, 0.4, 0.55, C.iron); m.ball(x, y, 1.55, 0.15, C.ironLt); }
  },
  catapult: (m) => {
    for (const x of [-1.8, 1.8]) { m.wheel(x, 1.5, 0.6, 0.6, 0.3, C.woodDk); m.wheel(x, -1.5, 0.6, 0.6, 0.3, C.woodDk); }
    m.box(0, 1.2, 0.8, 5, 0.3, 0.3, C.wood); m.box(0, -1.2, 0.8, 5, 0.3, 0.3, C.wood); m.box(-2.3, 0, 0.8, 0.3, 2.6, 0.3, C.wood); m.box(2.3, 0, 0.8, 0.3, 2.6, 0.3, C.wood);
    m.beam([0.8, 1.2, 0.9], [0.8, 1.2, 3.2], 0.3, C.wood); m.beam([0.8, -1.2, 0.9], [0.8, -1.2, 3.2], 0.3, C.wood); m.box(0.8, 0, 3.1, 0.3, 2.7, 0.3, C.woodDk);
    m.beam([0.8, 0, 1.4], [-3.2, 0, 2.4], 0.26, C.wood, 3); m.box(-3.3, 0, 2.5, 0.8, 0.8, 0.3, C.woodDk, 3);
    m.box(1.6, 0, 1.2, 0.9, 1.2, 0.9, C.iron);
  },
  tower: (m) => {
    const H = 14.6, w = 2.6;
    for (const [x, y] of [[-2.2, 1.9], [-2.2, -1.9], [2.2, 1.9], [2.2, -1.9]]) m.wheel(x, y > 0 ? y + 0.9 : y - 0.9, 0.9, 0.9, 0.5, C.woodDk, 0, 10);
    for (const [x, y] of [[-w, w], [-w, -w], [w, w], [w, -w]]) m.beam([x, y, 0.6], [x * 0.9, y * 0.9, H], 0.4, C.woodDk);
    m.box(0, 0, 0.9, 5.6, 5.6, 0.4, C.woodDk);
    for (const z of [4.6, 8.4, 12.2]) m.box(0, 0, z, 4.9, 4.9, 0.24, C.wood);
    m.frameBox([w * 0.97, 0, 6.6], [0.08, 0, 0], [0, w, 0], [-0.14, 0, 5.6], C.hide);          // hide-covered front
    m.frameBox([0, w * 0.96, 6.9], [w, 0, 0], [0, 0.07, 0], [0, -0.14, 5.4], [0.34, 0.24, 0.17]);
    m.frameBox([0, -w * 0.96, 6.9], [w, 0, 0], [0, 0.07, 0], [0, 0.14, 5.4], [0.34, 0.24, 0.17]);
    m.box(0, 2.3, 13.2, 4.6, 0.2, 1.8, C.wood); m.box(0, -2.3, 13.2, 4.6, 0.2, 1.8, C.wood); m.box(-2.3, 0, 13.2, 0.2, 4.6, 1.8, C.wood);
    m.box(2.5, 0, 14.4, 0.24, 3.6, 4.2, C.woodDk, 3);   // drawbridge, raised until the tower docks
    m.beam([-2.6, 0, 1], [-4.4, 0, 0.2], 0.3, C.woodDk); // ramp at the rear
  },
  // ---- aircraft
  jet: (m) => {
    m.box(0, 0, 0, 11, 1.3, 1.2, C.jet); m.beam([5.5, 0, 0], [8.5, 0, -0.1], 0.7, C.jet); m.box(2.6, 0, 0.6, 2.2, 0.8, 0.5, C.glass);
    m.frameBox([-1.2, 3.4, -0.1], [2.2, -0.9, 0], [-1.0, 2.6, 0], [0, 0, 0.1], C.jet); m.frameBox([-1.2, -3.4, -0.1], [2.2, 0.9, 0], [1.0, 2.6, 0], [0, 0, 0.1], C.jet);
    m.frameBox([-4.8, 0, 1.5], [0.9, 0, -0.3], [0, 0.08, 0], [-0.5, 0, 1.2], C.jet);
    m.box(-4.9, 1.6, 0, 1.6, 2.0, 0.1, C.jet); m.box(-4.9, -1.6, 0, 1.6, 2.0, 0.1, C.jet);
    for (const y of [2.6, -2.6, 4.2, -4.2]) m.box(-0.6, y, -0.5, 2.4, 0.3, 0.3, C.vehDk);
  },
  helo: (m) => {
    m.box(0.6, 0, 0, 6.2, 1.5, 1.9, C.veh); m.box(3.2, 0, 0.3, 1.6, 1.1, 1.0, C.glass); m.box(1.9, 0, 0.75, 1.6, 1.0, 0.7, C.glass);
    m.beam([-2.4, 0, 0.3], [-7.6, 0, 0.7], 0.5, C.veh); m.frameBox([-7.6, 0, 1.4], [0.5, 0, 0], [0, 0.06, 0], [-0.3, 0, 1.0], C.veh);
    m.box(0.4, 0, -0.2, 1.2, 4.4, 0.16, C.vehDk); for (const y of [1.9, -1.9]) m.box(0.5, y, -0.5, 2.2, 0.36, 0.36, C.gun);
    m.box(4.1, 0, -0.7, 1.4, 0.2, 0.2, C.gun);
    m.cyl(0.4, 0, 0.95, 1.3, 0.25, 0.2, 6, C.gun);
    m.box(0.4, 0, 1.36, 14.4, 0.36, 0.06, C.gun, 6); m.box(0.4, 0, 1.36, 0.36, 14.4, 0.06, C.gun, 6);
  },
  transport: (m) => {
    m.box(0.5, 0, 0, 9, 2.6, 2.6, C.veh); m.box(5.2, 0, 0.3, 1.6, 2.0, 1.4, C.glass);
    m.beam([-4, 0, 0.6], [-9.5, 0, 1.2], 0.7, C.veh); m.frameBox([-9.6, 0, 2.1], [0.6, 0, 0], [0, 0.07, 0], [-0.4, 0, 1.2], C.veh);
    m.box(0, 0, 1.5, 3.4, 1.6, 0.5, C.vehDk); m.cyl(0.2, 0, 1.7, 2.1, 0.3, 0.24, 6, C.gun);
    m.box(0.2, 0, 2.16, 18.6, 0.5, 0.07, C.gun, 6); m.box(0.2, 0, 2.16, 0.5, 18.6, 0.07, C.gun, 6);
    for (const y of [1.2, -1.2]) m.box(0.8, y, -1.5, 3.2, 0.2, 0.2, C.gun);
  },
  cargo: (m) => {
    m.box(0, 0, 0, 27, 4.0, 4.0, C.jet); m.beam([13.5, 0, -0.3], [16.5, 0, -0.9], 2.4, C.jet); m.box(13.5, 0, 0.9, 2.4, 2.6, 1.2, C.glass);
    m.box(1.5, 0, 1.9, 5.0, 38, 0.5, C.jet);
    for (const y of [5.5, 11, -5.5, -11]) { m.box(3.4, y, 1.3, 3.8, 1.2, 1.2, C.vehDk); m.box(5.4, y, 1.3, 0.1, 4.2, 0.3, C.gun, 6); }
    m.beam([-13, 0, 0.6], [-17.5, 0, 2.2], 2.4, C.jet); m.frameBox([-16.6, 0, 5], [1.6, 0, 0], [0, 0.14, 0], [-0.9, 0, 3.0], C.jet); m.box(-16.6, 0, 2.6, 3.2, 12, 0.3, C.jet);
  },
  chute: (m) => {
    for (let k = 0; k < 10; k++) {
      const a0 = (k / 10) * 6.2832, a1 = ((k + 1) / 10) * 6.2832, col = k & 1 ? C.chute : C.olive;
      const r = 4.4, zr = 9.2, zt = 11.4;
      m.tri([0, 0, zt], [Math.cos(a0) * r, Math.sin(a0) * r, zr], [Math.cos(a1) * r, Math.sin(a1) * r, zr], col);
      m.tri([0, 0, zt], [Math.cos(a1) * r, Math.sin(a1) * r, zr], [Math.cos(a0) * r, Math.sin(a0) * r, zr], [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7]);
      if (!(k & 1)) m.beam([Math.cos(a0) * r, Math.sin(a0) * r, zr], [0, 0, 1.3], 0.05, C.gun);
    }
    m.box(0, 0, 0.6, 1.8, 1.4, 1.2, C.crate); m.box(0, 0, 0.6, 1.84, 0.2, 1.24, C.vehDk);
  },
  // ---- ordnance (drawn along +x)
  shell: (m) => { m.box(0, 0, 0, 1.3, 0.34, 0.34, [0.95, 0.85, 0.6]); },
  round: (m) => { m.box(0, 0, 0, 1.4, 0.16, 0.16, [1, 0.78, 0.4]); },
  rocket: (m) => { m.box(0, 0, 0, 1.9, 0.28, 0.28, [0.82, 0.83, 0.8]); m.box(-0.85, 0, 0, 0.3, 0.7, 0.06, C.steel); m.box(-0.85, 0, 0, 0.3, 0.06, 0.7, C.steel); },
  bombm: (m) => { m.box(0, 0, 0, 2.6, 0.7, 0.7, [0.24, 0.27, 0.22]); m.box(-1.3, 0, 0, 0.5, 1.3, 0.08, C.gun); m.box(-1.3, 0, 0, 0.5, 0.08, 1.3, C.gun); },
  rockm: (m) => { m.ball(0, 0, 0, 0.95, C.stone); },
  bolt: (m) => { m.box(0, 0, 0, 1.5, 0.07, 0.07, [0.16, 0.13, 0.1]); },
  // ---- field works and debris
  wire: (m) => {
    for (const x of [-1.4, 1.4]) { m.beam([x, -0.5, 0], [x, 0.5, 1.1], 0.08, C.woodDk); m.beam([x, 0.5, 0], [x, -0.5, 1.1], 0.08, C.woodDk); }
    const wc = [0.55, 0.56, 0.58];
    for (let k = 0; k < 6; k++) { const x = -1.5 + k * 0.6; m.beam([x, -0.5, 0.15], [x + 0.3, 0, 1.0], 0.035, wc); m.beam([x + 0.3, 0, 1.0], [x + 0.6, 0.5, 0.15], 0.035, wc); m.beam([x, 0.5, 0.15], [x + 0.6, -0.5, 0.15], 0.035, wc); }
    m.beam([-1.5, 0, 0.6], [1.5, 0, 0.6], 0.035, wc);
  },
  hedgehog: (m) => { const s = [0.22, 0.2, 0.19]; m.beam([-0.9, -0.9, 0], [0.9, 0.9, 1.5], 0.2, s); m.beam([0.9, -0.9, 0], [-0.9, 0.9, 1.5], 0.2, s); m.beam([0, 0, 0.75 - 1.0], [0, 0, 0.75 + 1.0], 0.2, s); m.beam([-1.0, 0.3, 0.2], [1.0, -0.3, 1.2], 0.2, s); },
  moat: (m) => { m.box(0, 0, 0.1, 4.3, 4.3, 0.1, C.water); m.box(0, 2.0, 0.22, 4.3, 0.5, 0.36, C.earth); m.box(0, -2.0, 0.22, 4.3, 0.5, 0.36, C.earth); m.box(2.0, 0, 0.2, 0.5, 4.3, 0.32, C.earth); m.box(-2.0, 0, 0.2, 0.5, 4.3, 0.32, C.earth); },
  mine: (m) => { m.cyl(0, 0, 0, 0.1, 0.3, 0.28, 8, [0.2, 0.22, 0.15]); m.cyl(0, 0, 0.1, 0.16, 0.1, 0.08, 6, C.gun); },
  claymore: (m) => { m.box(0, 0, 0.3, 0.07, 0.42, 0.2, [0.3, 0.36, 0.2]); m.beam([0, 0.14, 0.2], [-0.12, 0.18, 0], 0.03, C.gun); m.beam([0, -0.14, 0.2], [-0.12, -0.18, 0], 0.03, C.gun); },
  cube: (m) => { m.box(0, 0, 0, 1, 1, 1, [1, 1, 1]); },
  plank: (m) => { m.box(0, 0, 0, 2.2, 0.3, 0.12, C.wood); },
};

/** Animation constants per mesh: hip height, shoulder pivot [x,z], swing (rad) and recoil (m) of part 3. */
const ANIM = {
  default: [0.84, 0.2, 1.3, 0.25, 0.12],
  uruk: [0.84, 0.2, 1.3, 1.5, 0], archer: [0.84, 0.2, 1.3, 0.2, 0.1], berserker: [0.84, 0.2, 1.3, 1.7, 0], chief: [0.84, 0.2, 1.3, 1.6, 0], sapper: [0.84, 0.2, 1.3, 0, 0],
  warg: [0.6, 0.1, 1.4, 1.2, 0], troll: [1.5, 0.3, 2.8, 1.5, 0], ladder: [0.84, 0, 0, 0, 0], ram: [0, 0, 0, 0, -1.3], catapult: [0, 0.8, 1.4, -1.5, 0],
  tower: [0, 2.5, 12.3, -1.5708, 0], tankTurret: [0, 0, 0, 0, 0.5], ifvTurret: [0, 0, 0, 0, 0.18], howitzer: [0, 0, 0, 0, 0.6], mortar: [0, 0, 0, 0, 0.12],
};

/** Build every mesh. Returns { name: {data, count, bbox, avg, anim, lod:{data,count}} }. */
export function buildMeshes() {
  const out = {};
  for (const name in defs) {
    const m = new MeshBuilder();
    defs[name](m);
    const mesh = m.build();
    mesh.anim = ANIM[name] || ANIM.default;
    // far-view stand-in: one box the size and average colour of the mesh
    const b = mesh.bbox, lm = new MeshBuilder(), a = mesh.avg, k = 1.25;
    const bw = Math.min(0.8, Math.max(0.45, (b[3] - b[2]) * 0.7)), tall = b[4] > 1.2 && b[4] < 3.2 && b[1] - b[0] < 3;
    if (tall) { lm.box(0, 0, b[4] * 0.42, bw * 0.7, bw, b[4] * 0.84, [a[0] * k, a[1] * k, a[2] * k]); lm.box(0.02, 0, b[4] * 0.9, bw * 0.55, bw * 0.55, b[4] * 0.2, [a[0] * k * 1.3, a[1] * k * 1.3, a[2] * k * 1.3]); }
    else lm.box((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, b[4] / 2, Math.max(0.5, (b[1] - b[0]) * 0.8), Math.max(0.5, (b[3] - b[2]) * 0.8), Math.max(0.6, b[4]), [a[0] * k, a[1] * k, a[2] * k]);
    mesh.lod = lm.build();
    out[name] = mesh;
  }
  return out;
}
