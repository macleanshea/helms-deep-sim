// Visual effects in 3D: a pooled particle system (billboards, velocity-stretched streaks,
// ground rings), flying debris and bodies with simple ballistics, short-lived point lights,
// permanent ground decals, smoke emitters and camera shake. The simulation drives all of it
// through a small interface (tracer, muzzle, explosion, death, breach ...).

import { UNITS, DEF, ORC, R, C, TR } from '../config.js';
import { SPR } from './atlas.js';

const MAXP = 30000;
const FALLEN_MAX = 2500; // bodies kept as models; older ones become marks on the ground
const G = 26; // gravity for debris, m/s^2

export class Fx {
  constructor(audio) {
    this.audio = audio;
    this.fallen = []; this.now = 0; this.model3d = null; // the dead who lie as models (kinds that have one: set by the renderer), and the battle's clock
    const n = MAXP, F = () => new Float32Array(n), B = () => new Uint8Array(n);
    this.px = F(); this.py = F(); this.pz = F(); this.vx = F(); this.vy = F(); this.vz = F(); this.grav = F();
    this.w = F(); this.h = F(); this.gw = F(); this.gh = F(); this.rot = F(); this.vr = F(); this.life = F(); this.max = F(); this.del = F();
    this.drag = F(); this.ax = F(); this.ay = F(); this.az = F(); this.str = F(); this.a = F();
    this.spr = B(); this.add = B(); this.fade = B(); this.mode = B(); this.r = B(); this.g = B(); this.b = B();
    this.cursor = 0; this.live = 0;
    this.decals = new Float32Array(7 * 16384); this.decalCount = 0;
    this.emitters = []; this.lights = []; this.chunks = [];
    this.shake = 0;
    this.view = { x: 0, y: 0, rad: 1000, zoom: 1 };
    this.budget = 0; this.expBudget = 0;
    this.groundFn = () => 0;
    this.rs = 12345;
  }

  rnd() { this.rs = (this.rs * 16807) % 2147483647; return this.rs / 2147483647; }
  reset() { this.life.fill(0); this.emitters.length = 0; this.lights.length = 0; this.chunks.length = 0; this.decalCount = 0; this.shake = 0; this.fallen.length = 0; }
  frame(speed) { this.budget = 900 / Math.max(1, speed * 0.5); this.expBudget = 40; }
  inView(x, y, m = 20) { const v = this.view, dx = x - v.x, dy = y - v.y, r = v.rad + m; return dx * dx + dy * dy < r * r; }

  /** Spawn a particle and return its index so the caller can set the rarer fields. */
  p(spr, x, y, z, vx, vy, vz, w, h, life, r, g, b, a, add, fade = 0) {
    let i = this.cursor;
    for (let k = 0; k < 8 && this.life[i] > 0; k++) i = (i + 1) % MAXP;
    this.cursor = (i + 1) % MAXP;
    this.spr[i] = spr; this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.w[i] = w; this.h[i] = h; this.life[i] = life; this.max[i] = life; this.r[i] = r; this.g[i] = g; this.b[i] = b; this.a[i] = a; this.add[i] = add; this.fade[i] = fade;
    this.grav[i] = 0; this.gw[i] = 0; this.gh[i] = 0; this.rot[i] = 0; this.vr[i] = 0; this.del[i] = 0; this.drag[i] = 0; this.mode[i] = 0; this.str[i] = 0;
    this.ax[i] = 0; this.ay[i] = 0; this.az[i] = 0;
    return i;
  }

  decal(spr, x, y, size, rot, r, g, b, a) {
    if (this.decalCount >= 16384) return;
    const o = this.decalCount++ * 7, d = this.decals;
    d[o] = x; d[o + 1] = y; d[o + 2] = size; d[o + 3] = rot; d[o + 4] = spr; d[o + 5] = r | (g << 8) | (b << 16); d[o + 6] = a;
  }

  light(x, y, z, r, g, b, rad, life) {
    if (!this.inView(x, y, rad)) return;
    if (this.lights.length > 24) this.lights.shift();
    this.lights.push({ x, y, z, r, g, b, rad, life, max: life });
  }

  chunk(mesh, x, y, z, vx, vy, vz, scale, r, g, b, rest, extra) {
    if (this.chunks.length > 520) return null;
    const c = { mesh, x, y, z, vx, vy, vz, yaw: this.rnd() * 6.28, vyaw: (this.rnd() - 0.5) * 8, tilt: 0, vtilt: (this.rnd() - 0.5) * 14, scale, r, g, b, rest, bounced: 0, ...extra };
    this.chunks.push(c);
    return c;
  }

  update(dt) {
    if (dt <= 0) return;
    const { px, py, pz, vx, vy, vz, grav, w, h, gw, gh, rot, vr, life, drag, del } = this;
    let live = 0;
    for (let i = 0; i < MAXP; i++) {
      if (life[i] <= 0) continue;
      live++;
      if (del[i] > 0) { del[i] -= dt; continue; }
      life[i] -= dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      if (grav[i]) vz[i] -= grav[i] * dt;
      const dg = drag[i];
      if (dg) { const f = Math.max(0, 1 - dg * dt); vx[i] *= f; vy[i] *= f; vz[i] *= f; }
      w[i] += gw[i] * dt; h[i] += gh[i] * dt; rot[i] += vr[i] * dt;
    }
    this.live = live;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * (2.5 + this.shake * 3));
    for (let k = this.lights.length - 1; k >= 0; k--) { if ((this.lights[k].life -= dt) <= 0) this.lights.splice(k, 1); }
    // debris and bodies in flight
    for (let k = this.chunks.length - 1; k >= 0; k--) {
      const c = this.chunks[k];
      if (c.resting) { if ((c.rest -= dt) <= 0) this.chunks.splice(k, 1); continue; }
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.vz -= G * dt;
      c.yaw += c.vyaw * dt; c.tilt += c.vtilt * dt;
      const gnd = this.groundFn(c.x, c.y) + (c.lift || 0);
      if (c.z <= gnd && c.vz < 0) {
        c.z = gnd;
        if (!c.bounced && c.vz < -6 && !c.body) { c.bounced = 1; c.vz = -c.vz * 0.3; c.vx *= 0.45; c.vy *= 0.45; c.vtilt *= 0.5; continue; }
        if (c.body) {
          // a thrown body comes to rest as a corpse on the ground
          this.decal(c.body === ORC ? SPR.corpseOrc : SPR.corpseMan, c.x, c.y, 3, c.yaw, c.body === ORC ? 170 : 235, c.body === ORC ? 170 : 235, c.body === ORC ? 170 : 235, 255);
          this.chunks.splice(k, 1);
        } else { c.resting = 1; c.vx = c.vy = c.vz = 0; c.tilt = c.flat ? 0 : c.tilt; if (c.rest <= 0) this.chunks.splice(k, 1); }
      }
    }
    for (let k = this.emitters.length - 1; k >= 0; k--) {
      const e = this.emitters[k];
      e.t -= dt;
      if (e.t <= 0) { this.emitters.splice(k, 1); continue; }
      e.acc += dt * e.rate;
      while (e.acc > 1) {
        e.acc -= 1;
        if (!this.inView(e.x, e.y, 60)) continue;
        const s = e.size, v = 55 + this.rnd() * 45;
        const i = this.p(SPR.smoke, e.x + (this.rnd() - 0.5) * s, e.y + (this.rnd() - 0.5) * s, e.z + s * 0.5, -1.2 - this.rnd() * 1.5, 0.6, 3.5 + this.rnd() * 3, s * 1.3, s * 1.3, 3.5 + this.rnd() * 3, v, v, v, 0.5, 0, 1);
        this.gw[i] = this.gh[i] = s * 0.8; this.vr[i] = 0.3; this.rot[i] = this.rnd() * 6;
        if (e.fire && this.rnd() < 0.7) { const j = this.p(SPR.glow, e.x + (this.rnd() - 0.5) * s, e.y + (this.rnd() - 0.5) * s, e.z + s * 0.4, 0, 0, 2.5, s * 1.5, s * 1.5, 0.4, 255, 140 + this.rnd() * 60, 40, 0.75, 1); this.gw[j] = this.gh[j] = s; }
      }
      if (e.fire && this.rnd() < dt * 6) this.light(e.x, e.y, e.z + 2, 1.1, 0.55, 0.2, 22 + this.rnd() * 8, 0.25);
    }
  }

  /** Write live particles into the instance buffer: alpha-blended first, additive on top. */
  fill(F, U, max) {
    // one sweep of the pool: alpha-blended particles are written as found, additive ones are
    // listed and written after them (same order as two separate passes, half the scanning)
    let k = 0, na = 0;
    const v = this.view, R2 = (v.rad + 60) * (v.rad + 60), life = this.life, del = this.del, add = this.add, px = this.px, py = this.py;
    const later = this._addIdx || (this._addIdx = new Int32Array(MAXP));
    for (let i = 0; i < MAXP; i++) {
      if (life[i] <= 0 || del[i] > 0) continue;
      const ad = add[i];
      if (ad !== 0 && ad !== 1) continue;
      const dx = px[i] - v.x, dy = py[i] - v.y;
      if (dx * dx + dy * dy > R2) continue;
      if (ad === 1) later[na++] = i; else if (k < max) k = this._write(F, U, k, i, 0);
    }
    for (let j = 0; j < na && k < max; j++) k = this._write(F, U, k, later[j], 1);
    return k;
  }

  /** One particle into instance slot k; returns the next slot. */
  _write(F, U, k, i, pass) {
    const t = 1 - this.life[i] / this.max[i];
    let a = this.a[i];
    const fd = this.fade[i];
    if (fd === 0) a *= 1 - t; else if (fd === 1) a *= Math.min(1, t * 7) * (1 - t) * (1 - t); else if (fd === 2) a *= t < 0.8 ? 1 : (1 - t) * 5;
    const o = k * 13, md = this.mode[i];
    F[o] = this.px[i]; F[o + 1] = this.py[i]; F[o + 2] = this.pz[i]; F[o + 3] = this.w[i]; F[o + 4] = this.h[i]; F[o + 5] = this.rot[i]; F[o + 6] = this.spr[i];
    U[o + 7] = (((a > 1 ? 1 : a) * 255) << 24 | (this.b[i] << 16) | (this.g[i] << 8) | this.r[i]) >>> 0;
    F[o + 8] = pass; F[o + 9] = md;
    if (md === 1) {
      const s = this.str[i];
      if (s) { F[o + 10] = this.vx[i] * s; F[o + 11] = this.vy[i] * s; F[o + 12] = this.vz[i] * s; }
      else { F[o + 10] = this.ax[i]; F[o + 11] = this.ay[i]; F[o + 12] = this.az[i]; }
    } else { F[o + 10] = 0; F[o + 11] = 0; F[o + 12] = 0; }
    return k + 1;
  }

  // ----------------------------------------------------- sim-facing API
  tracer(x1, y1, z1, x2, y2, z2, kind, hit) {
    if (this.budget <= 0 || !(this.inView(x1, y1, 80) || this.inView(x2, y2, 80))) return;
    this.budget--;
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1, d = Math.hypot(dx, dy, dz) || 1;
    if (kind === TR.ARROW) {
      // a bolt lofted on a shallow arc
      const T = Math.max(0.25, d / 75), g = 14;
      const i = this.p(SPR.streak, x1, y1, z1, dx / T, dy / T, dz / T + 0.5 * g * T, 2, 0.2, T, 34, 28, 22, 1, 0, 2);
      this.mode[i] = 1; this.str[i] = 0.035; this.grav[i] = g;
      return;
    }
    const sp = kind === TR.CANNON ? 380 : kind === TR.SNIPER ? 620 : 450;
    const len = kind === TR.SNIPER ? 20 : kind === TR.CANNON ? 15 : 9 + this.rnd() * 5;
    const life = Math.max(0.04, (d - len) / sp);
    const wd = kind === TR.CANNON ? 0.8 : kind === TR.MG ? 0.5 : 0.42;
    let r = 255, g = 214, b = 130;
    if (kind === TR.MG) { g = 150; b = 70; } else if (kind === TR.SNIPER) { g = 246; b = 220; } else if (kind === TR.CANNON) { g = 175; b = 70; }
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const i = this.p(SPR.streak, x1 + ux * len * 0.5, y1 + uy * len * 0.5, z1 + uz * len * 0.5, ux * sp, uy * sp, uz * sp, len, wd, life, r, g, b, 1, 1, 2);
    this.mode[i] = 1; this.ax[i] = ux * len; this.ay[i] = uy * len; this.az[i] = uz * len;
    // where it lands: a kick of dirt for a miss, a dark spray for a hit
    if (this.budget > 200) {
      this.budget -= 0.5;
      if (hit) { const j = this.p(SPR.blood, x2, y2, z2, ux * 2, uy * 2, 1.5, 0.7, 0.7, 0.28, 46, 10, 10, 0.9, 0); this.del[j] = life; this.gw[j] = this.gh[j] = 3.5; }
      else { const v = 120 + this.rnd() * 40; const j = this.p(SPR.smoke, x2, y2, z2 + 0.2, 0, 0, 2.2, 0.8, 0.8, 0.5, v, v * 0.92, v * 0.78, 0.5, 0, 1); this.del[j] = life; this.gw[j] = this.gh[j] = 2.4; const s = this.p(SPR.spark, x2, y2, z2 + 0.2, 0, 0, 0, 0.9, 0.9, 0.07, 255, 230, 170, 0.9, 1); this.del[s] = life; }
    }
  }

  muzzle(x, y, z, ang, size, up) {
    if (this.budget <= 0 || !this.inView(x, y)) return;
    this.budget -= 0.5;
    const s = size, ca = Math.cos(ang), sa = Math.sin(ang);
    const i = this.p(SPR.flash, x + ca * s * 0.5, y + sa * s * 0.5, z + (up ? s * 0.4 : 0), 0, 0, 0, 2.4 * s, 1.2 * s, 0.06, 255, 226, 150, 1, 1);
    this.mode[i] = 1; this.ax[i] = ca * 2.4 * s * (up ? 0.5 : 1); this.ay[i] = sa * 2.4 * s * (up ? 0.5 : 1); this.az[i] = up ? 2.2 * s : 0;
    this.p(SPR.glow, x, y, z, 0, 0, 0, 3.6 * s, 3.6 * s, 0.08, 255, 190, 110, 0.6, 1);
    if (size > 1.5) {
      for (let k = 0; k < (size > 3 ? 5 : 2); k++) { const v = 150 + this.rnd() * 50; const j = this.p(SPR.smoke, x + ca * s, y + sa * s, z, ca * (5 + this.rnd() * 8), sa * (5 + this.rnd() * 8), 1 + this.rnd() * 2, s * 1.1, s * 1.1, 1 + this.rnd(), v, v, v, 0.4, 0, 1); this.gw[j] = this.gh[j] = s * 1.4; this.drag[j] = 2; this.rot[j] = this.rnd() * 6; }
      if (size > 3) { this.light(x, y, z + 1, 1.5, 1.1, 0.6, 30 + size * 4, 0.12); this.addShake(x, y, 0.08); }
    }
  }

  explosion(x, y, z, r, kind) {
    const big = kind === 1 || kind === 2;
    this.sound(kind === 2 ? 'breach' : kind === 4 ? 'thud' : kind === 3 ? 'pop' : big ? 'boom' : 'blast', x, y, big ? 1 : 0.8);
    if (kind !== 3 && kind !== 4) this.addShake(x, y, r * (kind === 2 ? 0.1 : 0.045));
    // marks left on the ground
    if (kind === 4) this.decal(SPR.scorch, x, y, r * 1.1, this.rnd() * 6, 60, 50, 40, 90);
    else if (kind === 3) { if (this.rnd() < 0.5) this.decal(SPR.scorch, x, y, r * 2.4, this.rnd() * 6, 255, 255, 255, 120); }
    else { this.decal(SPR.scorch, x, y, r * 2.6, this.rnd() * 6, 255, 255, 255, 150); this.decal(SPR.crater, x, y, r * (big ? 0.8 : 0.6), this.rnd() * 6, 255, 255, 255, big ? 210 : 150); }
    if (!this.inView(x, y, r * 5)) return;
    if (kind !== 4) this.light(x, y, z + r * 0.4, 2.2, 1.5, 0.8, r * (kind === 3 ? 6 : 9) + 14, kind === 3 ? 0.14 : 0.4);
    if (this.expBudget <= 0) { this.p(SPR.glow, x, y, z + 1, 0, 0, 0, r * 3, r * 3, 0.15, 255, 200, 120, 0.9, 1); return; }
    this.expBudget -= kind === 3 ? 0.3 : 1;
    const rn = () => this.rnd();
    if (kind === 4) {
      for (let k = 0; k < 7; k++) { const a = rn() * 6.28, v = 105 + rn() * 40; const i = this.p(SPR.smoke, x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, z + 0.5, Math.cos(a) * 5, Math.sin(a) * 5, 3 + rn() * 3, r * 0.9, r * 0.9, 1.4 + rn(), v, v * 0.92, v * 0.8, 0.5, 0, 1); this.gw[i] = this.gh[i] = r * 0.9; this.drag[i] = 1.5; this.rot[i] = rn() * 6; }
      for (let k = 0; k < 8; k++) { const a = rn() * 6.28, sp = 5 + rn() * 12; this.chunk('cube', x, y, z + 0.4, Math.cos(a) * sp, Math.sin(a) * sp, 6 + rn() * 9, 0.25 + rn() * 0.4, 120, 118, 112, 1.5); }
      return;
    }
    // flash
    this.p(SPR.glow, x, y, z + r * 0.25, 0, 0, 0, r * 4.4, r * 4.4, 0.16, 255, 240, 200, 1, 1);
    if (kind !== 3) { const gq = this.p(SPR.glow, x, y, z + 0.3, 0, 0, 0, r * 7, r * 7, 0.5, 255, 150, 70, 0.5, 1); this.mode[gq] = 2; }
    if (kind === 3) {
      const i = this.p(SPR.glow, x, y, z + 0.6, 0, 0, 2, r * 1.6, r * 1.6, 0.22, 255, 170, 70, 0.9, 1); this.gw[i] = this.gh[i] = r * 3;
      const v = 80 + rn() * 40; const j = this.p(SPR.smoke, x, y, z + 0.8, -0.6, 0.3, 2.6, r * 1.3, r * 1.3, 1.3 + rn(), v, v, v, 0.5, 0, 1); this.gw[j] = this.gh[j] = r; this.rot[j] = rn() * 6;
      for (let k = 0; k < 4; k++) { const a = rn() * 6.28, sp = 8 + rn() * 14; const s = this.p(SPR.streak, x, y, z + 0.3, Math.cos(a) * sp, Math.sin(a) * sp, 8 + rn() * 12, 1, 0.16, 0.4 + rn() * 0.3, 255, 200, 110, 1, 1); this.mode[s] = 1; this.str[s] = 0.05; this.grav[s] = G; }
      return;
    }
    // fireball rolling upward
    const nf = Math.min(16, 5 + (r / 2) | 0);
    for (let k = 0; k < nf; k++) {
      const a = rn() * 6.28, d = rn() * r * 0.4, s = r * (0.5 + rn() * 0.55);
      const i = this.p(SPR.glow, x + Math.cos(a) * d, y + Math.sin(a) * d, z + rn() * r * 0.3, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * (0.5 + rn()), s * 1.2, s * 1.2, 0.4 + rn() * 0.5, 255, 130 + rn() * 90, 30 + rn() * 50, 0.95, 1);
      this.gw[i] = this.gh[i] = s * 1.7; this.drag[i] = 2;
    }
    // smoke column
    const ns = Math.min(14, 4 + (r / 2.2) | 0);
    for (let k = 0; k < ns; k++) {
      const a = rn() * 6.28, d = rn() * r * 0.5, s = r * (0.7 + rn() * 0.6), v = 62 + rn() * 60;
      const i = this.p(SPR.smoke, x + Math.cos(a) * d, y + Math.sin(a) * d, z + rn() * r * 0.4, Math.cos(a) * r * 0.2 - 1.2, Math.sin(a) * r * 0.2 + 0.5, r * (0.25 + rn() * 0.5) + 2, s, s, 2.6 + rn() * 3, v, v * 0.96, v * 0.9, 0.5, 0, 1);
      this.gw[i] = this.gh[i] = s * 0.5; this.drag[i] = 0.5; this.vr[i] = (rn() - 0.5) * 0.6; this.rot[i] = rn() * 6;
    }
    // earth thrown up, and burning fragments arcing out
    for (let k = 0; k < Math.min(18, r * 1.3); k++) {
      const a = rn() * 6.28, sp = r * (0.3 + rn() * 0.9), v = 50 + rn() * 30;
      const i = this.p(SPR.smoke, x, y, z + 0.3, Math.cos(a) * sp, Math.sin(a) * sp, r * (1.2 + rn() * 1.6) + 4, r * 0.3, r * 0.3, 0.9 + rn() * 0.6, v, v * 0.85, v * 0.65, 0.85, 0, 2);
      this.grav[i] = G; this.gw[i] = this.gh[i] = r * 0.25;
    }
    for (let k = 0; k < Math.min(22, r * 1.4); k++) {
      const a = rn() * 6.28, sp = r * (1.2 + rn() * 3.2);
      const s = this.p(SPR.streak, x, y, z + 0.5, Math.cos(a) * sp, Math.sin(a) * sp, r * (0.8 + rn() * 1.8) + 5, 1, 0.2, 0.5 + rn() * 0.6, 255, 190 + rn() * 50, 90, 1, 1);
      this.mode[s] = 1; this.str[s] = 0.06; this.grav[s] = G;
    }
    for (let k = 0; k < Math.min(7, r * 0.5); k++) { const a = rn() * 6.28, sp = r * (0.5 + rn() * 1.2); this.chunk('cube', x, y, z + 0.5, Math.cos(a) * sp, Math.sin(a) * sp, r * 0.8 + rn() * 10, 0.2 + rn() * 0.35, 60, 52, 42, 2 + rn() * 3); }
    // shock ring racing over the ground
    const g2 = this.p(SPR.ring, x, y, z + 0.25, 0, 0, 0, r * 0.8, r * 0.8, 0.34, 255, 240, 220, 0.5, 1); this.mode[g2] = 2; this.gw[g2] = this.gh[g2] = r * 7;
    if (kind === 2) {
      for (let k = 0; k < 18; k++) { const a = rn() * 6.28, d = rn() * r, v = 110 + rn() * 50; const i = this.p(SPR.smoke, x + Math.cos(a) * d, y + Math.sin(a) * d, z + rn() * 8, Math.cos(a) * 6, Math.sin(a) * 6, 2 + rn() * 4, r * 0.9, r * 0.9, 4 + rn() * 4, v, v * 0.95, v * 0.86, 0.6, 0, 1); this.gw[i] = this.gh[i] = r * 0.5; this.drag[i] = 0.6; this.rot[i] = rn() * 6; }
      this.light(x, y, z + 6, 3, 2, 1, 150, 0.9);
      this.emitters.push({ x, y, z, t: 40, rate: 5, acc: 0, size: 6, fire: true });
    } else if (big && this.rnd() < 0.5) this.emitters.push({ x, y, z, t: 5 + this.rnd() * 6, rate: 3, acc: 0, size: r * 0.35, fire: false });
  }

  melee(x, y, z) {
    if (this.budget <= 0 || this.rnd() > 0.5 || !this.inView(x, y)) return;
    this.budget -= 0.3;
    const i = this.p(SPR.spark, x + (this.rnd() - 0.5), y + (this.rnd() - 0.5), z, 0, 0, 0, 1.2, 1.2, 0.09, 255, 240, 220, 0.9, 1); this.rot[i] = this.rnd() * 6;
    this.sound('clash', x, y, 0.4);
  }

  death(type, x, y, z, rot, bx, by, bp) {
    const d = UNITS[type];
    const a = rot + (this.rnd() - 0.5) * 2.5;
    const blast = bx === bx; // not NaN
    if (d.team === ORC && d.sz === 0 || d.team === DEF && d.cls === C.INF) {
      const orc = d.team === ORC;
      if (blast && this.chunks.length < 260 && this.inView(x, y)) {
        // thrown by the blast
        const dx = x - bx, dy = y - by, l = Math.hypot(dx, dy) || 1, sp = (5 + this.rnd() * 9) * Math.min(1.6, 0.6 + bp / 14);
        this.chunk(d.key, x, y, z + 0.3, (dx / l) * sp, (dy / l) * sp, 6 + this.rnd() * 9 + bp * 0.3, 1.3, 215, 215, 215, 0, { body: d.team, tilt: 0.4, vtilt: 5 + this.rnd() * 8, yaw: rot });
        return;
      }
      if (this.rnd() < 0.45) this.decal(SPR.blood, x, y, 2.2 + this.rnd() * 2, a, orc ? 26 : 110, orc ? 8 : 14, orc ? 8 : 12, 150);
      const v = orc ? 150 + (this.rnd() * 70) | 0 : 235;
      if (this.model3d && this.model3d[type] && this.model3d[type].clip.die) {
        // a kind with a model that can fall: he drops where he stood and lies there. The oldest of the fallen become marks on the ground
        this.fallen.push({ type, x, y, z, rot, t: this.now, v, s: 0.96 + this.rnd() * 0.08 });
        if (this.fallen.length > FALLEN_MAX) { const c = this.fallen.shift(), cd = UNITS[c.type]; this.decal(cd.team === ORC ? SPR.corpseOrc : SPR.corpseMan, c.x, c.y, cd.size * 0.9, c.rot, c.v, c.v, c.v, 255); }
      } else
      this.decal(orc ? SPR.corpseOrc : SPR.corpseMan, x, y, d.size * 0.9, a, v, v, v, 255);
      if (this.budget > 0 && this.inView(x, y)) { this.budget -= 0.4; const i = this.p(SPR.blood, x, y, z + 1, 0, 0, 1, 1.2, 1.2, 0.3, orc ? 50 : 120, 10, 10, 0.8, 0); this.gw[i] = this.gh[i] = 5; }
      return;
    }
    if (d.team === ORC) {
      if (d.role === R.TROLL || d.key === 'warg') {
        this.decal(SPR.blood, x, y, d.size, a, 30, 8, 8, 170);
        // (a beast with a model that can fall lies where it dropped, like the soldiers; otherwise its mark on the ground)
        if (this.model3d && this.model3d[type] && this.model3d[type].clip.die) this.fallen.push({ type, x, y, z, rot, t: this.now, v: 200, s: 1 });
        else this.decal(d.role === R.TROLL ? SPR.corpseTroll : SPR.corpseOrc, x, y, d.size * (d.role === R.TROLL ? 0.95 : 0.8), a, 255, 255, 255, 255);
        this.dust(x, y, z, 5); if (d.role === R.TROLL) { this.addShake(x, y, 0.2); this.sound('thud', x, y, 0.9); } return; }
      // siege engines come apart
      const n = d.role === R.TOWER ? 34 : d.role === R.LADDER ? 8 : 14, hgt = d.role === R.TOWER ? 13 : 2;
      for (let k = 0; k < n; k++) { const an = this.rnd() * 6.28, sp = 2 + this.rnd() * (blast ? 11 : 5); this.chunk('plank', x + (this.rnd() - 0.5) * 3, y + (this.rnd() - 0.5) * 3, z + this.rnd() * hgt, Math.cos(an) * sp, Math.sin(an) * sp, 2 + this.rnd() * 7, 0.8 + this.rnd() * 0.9, 200, 200, 200, 8 + this.rnd() * 20, { flat: 1 }); }
      for (let k = 0; k < 5; k++) this.decal(SPR.splinter, x + (this.rnd() - 0.5) * d.size * 0.6, y + (this.rnd() - 0.5) * d.size * 0.5, 2 + this.rnd() * 3, this.rnd() * 6, 255, 255, 255, 255);
      this.dust(x, y, z + hgt * 0.3, d.size * 0.5); this.sound('crack', x, y, d.role === R.TOWER ? 1 : 0.7);
      if (d.role === R.TOWER) { this.addShake(x, y, 0.5); this.emitters.push({ x, y, z, t: 30, rate: 4, acc: 0, size: 4, fire: true }); }
      return;
    }
    if (d.cls === C.VEH || d.cls === C.GUN) {
      this.explosion(x, y, z, 7, 0);
      // the burnt-out hull stays where it died
      this.chunk(d.key, x, y, z, 0, 0, 0, d.cls === C.GUN ? 1.15 : 1, 38, 34, 30, 1e9, { resting: 1, yaw: rot, vyaw: 0, vtilt: 0, tilt: d.cls === C.GUN ? 0.25 : 0.04 });
      this.emitters.push({ x, y, z: z + 1, t: 60, rate: 5, acc: 0, size: 3, fire: true });
      this.decal(SPR.scorch, x, y, 14, 0, 255, 255, 255, 180);
      return;
    }
    this.dust(x, y, z, 3);
    for (let k = 0; k < 4; k++) { const an = this.rnd() * 6.28; this.chunk('plank', x, y, z + 0.5, Math.cos(an) * 4, Math.sin(an) * 4, 5, 0.7, 200, 200, 200, 10, { flat: 1 }); }
  }

  dust(x, y, z, size) {
    if (!this.inView(x, y)) return;
    for (let k = 0; k < 3; k++) { const a = this.rnd() * 6.28, v = 120 + this.rnd() * 40; const i = this.p(SPR.smoke, x + Math.cos(a) * size * 0.3, y + Math.sin(a) * size * 0.3, z + 0.4, Math.cos(a) * 2, Math.sin(a) * 2, 1.5, size, size, 1 + this.rnd(), v, v * 0.93, v * 0.8, 0.4, 0, 1); this.gw[i] = this.gh[i] = size * 0.9; this.drag[i] = 1; this.rot[i] = this.rnd() * 6; }
  }

  /** A wall section or gate gives way: masonry bursts outward and a pall of dust hangs over the gap. */
  breach(s, quiet) {
    const gate = s.kind === 'gate' || s.kind === 'postern' || s.kind === 'door';
    this.addShake(s.x, s.y, quiet ? 0.5 : 1.3);
    this.sound(gate ? 'gatebreak' : 'collapse', s.x, s.y, 1);
    const rn = () => this.rnd(), top = s.top, base = gate ? 12 : 0;
    const n = quiet ? 16 : gate ? 26 : 60;
    for (let k = 0; k < n; k++) {
      const u = (rn() - 0.5) * s.len, side = rn() < 0.5 ? -1 : 1, out = rn() * 5;
      const x = s.x + s.tx * u + s.nx * side * out, y = s.y + s.ty * u + s.ny * side * out, z = base + rn() * (top - base);
      const sp = 3 + rn() * (quiet ? 8 : 20), a = Math.atan2(s.ny * side, s.nx * side) + (rn() - 0.5) * 1.8;
      const v = 105 + rn() * 70;
      if (gate) this.chunk('plank', x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, 3 + rn() * 9, 0.9 + rn() * 1.2, 190, 180, 170, 12 + rn() * 20, { flat: 1 });
      else this.chunk('cube', x, y, z, Math.cos(a) * sp, Math.sin(a) * sp, 2 + rn() * 14, 0.5 + rn() * rn() * 2.2, v, v - 4, v - 10, 10 + rn() * 30);
    }
    if (!this.inView(s.x, s.y, 80)) return;
    for (let k = 0; k < (quiet ? 8 : 22); k++) {
      const a = rn() * 6.28, d = rn() * 9, v = 125 + rn() * 40;
      const i = this.p(SPR.smoke, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, base + rn() * (top - base), Math.cos(a) * 5, Math.sin(a) * 5, 1 + rn() * 3, 9, 9, 3.5 + rn() * 3.5, v, v * 0.95, v * 0.85, 0.6, 0, 1);
      this.gw[i] = this.gh[i] = 6; this.drag[i] = 0.6; this.rot[i] = rn() * 6; this.vr[i] = 0.2;
    }
  }

  spark(x, y, z) {
    if (!this.inView(x, y)) return;
    const a = this.rnd() * 6.28, sp = 3 + this.rnd() * 6;
    const i = this.p(SPR.spark, x + Math.cos(a) * 0.5, y + Math.sin(a) * 0.5, z, Math.cos(a) * sp, Math.sin(a) * sp, 3 + this.rnd() * 4, 1.2, 1.2, 0.3, 255, 220, 120, 1, 1); this.grav[i] = G;
    this.p(SPR.glow, x, y, z, 0, 0, 0, 4.5, 4.5, 0.2, 255, 160, 60, 0.5, 1);
    if (this.rnd() < 0.3) this.light(x, y, z + 1, 1, 0.6, 0.25, 16, 0.2);
  }

  pickup(x, y, z) {
    if (!this.inView(x, y)) return;
    const i = this.p(SPR.ring, x, y, z + 0.2, 0, 0, 0, 1, 1, 0.45, 110, 230, 160, 0.6, 1); this.mode[i] = 2; this.gw[i] = this.gh[i] = 5;
  }

  trail(x, y, z, vis) {
    if (!this.inView(x, y)) return;
    const v = vis === 1 ? 200 + this.rnd() * 40 : 150;
    const i = this.p(SPR.smoke, x, y, z, (this.rnd() - 0.5) * 2, (this.rnd() - 0.5) * 2, 0.5, vis === 1 ? 1.6 : 0.9, vis === 1 ? 1.6 : 0.9, vis === 1 ? 1.1 : 0.7, v, v, v, vis === 1 ? 0.5 : 0.28, 0, 1);
    this.gw[i] = this.gh[i] = vis === 1 ? 2.6 : 1.2; this.rot[i] = this.rnd() * 6;
    if (vis === 1) this.p(SPR.glow, x, y, z, 0, 0, 0, 3.2, 3.2, 0.12, 255, 190, 110, 0.85, 1);
  }

  /** Directional blast of a claymore: a fan of fragments. */
  claymore(x, y, z, dx, dy) {
    this.sound('blast', x, y, 0.9); this.addShake(x, y, 0.25);
    this.decal(SPR.scorch, x + dx * 4, y + dy * 4, 9, Math.atan2(dy, dx), 255, 255, 255, 120);
    if (!this.inView(x, y, 60)) return;
    this.light(x, y, z + 1, 2, 1.5, 0.8, 40, 0.2);
    this.p(SPR.glow, x, y, z + 0.5, 0, 0, 0, 7, 7, 0.12, 255, 230, 180, 1, 1);
    const base = Math.atan2(dy, dx);
    for (let k = 0; k < 46; k++) {
      const a = base + (this.rnd() - 0.5) * 1.15, sp = 90 + this.rnd() * 90;
      const s = this.p(SPR.streak, x, y, z + 0.3, Math.cos(a) * sp, Math.sin(a) * sp, 2 + this.rnd() * 6, 1, 0.16, 0.22 + this.rnd() * 0.16, 255, 215, 140, 0.9, 1); this.mode[s] = 1; this.str[s] = 0.04; this.drag[s] = 1.5;
    }
    for (let k = 0; k < 8; k++) { const a = base + (this.rnd() - 0.5), v = 120 + this.rnd() * 40; const i = this.p(SPR.smoke, x, y, z + 0.5, Math.cos(a) * (6 + this.rnd() * 12), Math.sin(a) * (6 + this.rnd() * 12), 1.5, 2.5, 2.5, 1.6 + this.rnd(), v, v * 0.94, v * 0.82, 0.5, 0, 1); this.gw[i] = this.gh[i] = 3.5; this.drag[i] = 1.8; this.rot[i] = this.rnd() * 6; }
  }

  addShake(x, y, amt) {
    if (!this.inView(x, y, 150)) return;
    const k = Math.min(1, this.view.zoom / 3.5);
    this.shake = Math.min(1.6, this.shake + amt * (0.35 + 0.65 * k));
  }

  sound(name, x, y, vol = 1) {
    if (!this.audio) return;
    const v = this.view;
    let g = vol * Math.min(1, 0.3 + v.zoom / 7);
    if (!this.inView(x, y, 30)) g *= 0.22;
    this.audio.play(name, g, Math.max(-1, Math.min(1, ((x - v.x) * v.cy + (y - v.y) * v.sy) / (v.rad + 1) || 0)));
  }
}
