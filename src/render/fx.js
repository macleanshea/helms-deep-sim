// Visual effects: a pooled particle system, a queue of permanent ground decals,
// lingering smoke emitters and camera shake. The simulation talks to this through
// the small "fx interface" (tracer, muzzle, explosion, death ...).

import { UNITS, DEF, ORC, R, C, TR, WORLD_W, WORLD_H } from '../config.js';
import { SPR } from './atlas.js';

const MAXP = 24000;

export class Fx {
  constructor(audio) {
    this.audio = audio;
    const n = MAXP;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.vx = new Float32Array(n); this.vy = new Float32Array(n);
    this.w = new Float32Array(n); this.h = new Float32Array(n); this.gw = new Float32Array(n); this.gh = new Float32Array(n);
    this.rot = new Float32Array(n); this.vr = new Float32Array(n); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.drag = new Float32Array(n); this.spr = new Uint8Array(n); this.add = new Uint8Array(n); this.fade = new Uint8Array(n);
    this.r = new Uint8Array(n); this.g = new Uint8Array(n); this.b = new Uint8Array(n); this.a = new Float32Array(n);
    this.cursor = 0; this.live = 0;
    this.decals = new Float32Array(7 * 16384); this.decalCount = 0;
    this.emitters = [];
    this.shake = 0;
    this.view = { x: 0, y: 0, hw: 1000, hh: 600, zoom: 1 };
    this.budget = 0; this.expBudget = 0;
    this.quality = 1;
    this.rs = 12345;
  }

  rnd() { this.rs = (this.rs * 16807) % 2147483647; return this.rs / 2147483647; }
  reset() { this.life.fill(0); this.emitters.length = 0; this.decalCount = 0; this.shake = 0; }
  frame(speed) { this.budget = 420 / Math.max(1, speed * 0.6); this.expBudget = 36; }
  inView(x, y, m = 20) { const v = this.view; return x > v.x - v.hw - m && x < v.x + v.hw + m && y > v.y - v.hh - m && y < v.y + v.hh + m; }

  p(spr, x, y, vx, vy, w, h, rot, life, r, g, b, a, add, gw = 0, gh = 0, drag = 0, vr = 0, fade = 0) {
    let i = this.cursor;
    // look briefly for a free slot, otherwise recycle
    for (let k = 0; k < 6 && this.life[i] > 0; k++) i = (i + 1) % MAXP;
    this.cursor = (i + 1) % MAXP;
    this.spr[i] = spr; this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.w[i] = w; this.h[i] = h;
    this.rot[i] = rot; this.life[i] = life; this.max[i] = life; this.r[i] = r; this.g[i] = g; this.b[i] = b; this.a[i] = a;
    this.add[i] = add; this.gw[i] = gw; this.gh[i] = gh; this.drag[i] = drag; this.vr[i] = vr; this.fade[i] = fade;
  }

  decal(spr, x, y, size, rot, r, g, b, a) {
    if (this.decalCount >= 16384) return;
    const o = this.decalCount++ * 7, d = this.decals;
    d[o] = x; d[o + 1] = y; d[o + 2] = size; d[o + 3] = rot; d[o + 4] = spr; d[o + 5] = r | (g << 8) | (b << 16); d[o + 6] = a;
  }

  update(dt) {
    const { px, py, vx, vy, w, h, gw, gh, rot, vr, life, drag } = this;
    let live = 0;
    for (let i = 0; i < MAXP; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt; live++;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt;
      const dg = drag[i];
      if (dg) { const f = Math.max(0, 1 - dg * dt); vx[i] *= f; vy[i] *= f; }
      w[i] += gw[i] * dt; h[i] += gh[i] * dt; rot[i] += vr[i] * dt;
    }
    this.live = live;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * (2.5 + this.shake * 3));
    for (let k = this.emitters.length - 1; k >= 0; k--) {
      const e = this.emitters[k];
      e.t -= dt;
      if (e.t <= 0) { this.emitters.splice(k, 1); continue; }
      e.acc += dt * e.rate;
      while (e.acc > 1) {
        e.acc -= 1;
        if (!this.inView(e.x, e.y, 60)) continue;
        const s = e.size, v = 60 + this.rnd() * 40;
        this.p(SPR.smoke, e.x + (this.rnd() - 0.5) * s, e.y + (this.rnd() - 0.5) * s, -1.5 - this.rnd() * 2, -3 - this.rnd() * 3, s * 1.2, s * 1.2, this.rnd() * 6, 2.5 + this.rnd() * 2, v, v, v, 0.5, 0, s * 0.9, s * 0.9, 0.2, 0.3, 1);
        if (e.fire && this.rnd() < 0.6) this.p(SPR.glow, e.x + (this.rnd() - 0.5) * s, e.y + (this.rnd() - 0.5) * s, 0, -2, s * 1.4, s * 1.4, 0, 0.35, 255, 140 + this.rnd() * 60, 40, 0.7, 1, s, s);
      }
    }
  }

  /** Write live particles into the instance buffer: alpha-blended first, additive on top. */
  fill(F, U, max) {
    let k = 0;
    const v = this.view, x0 = v.x - v.hw - 40, x1 = v.x + v.hw + 40, y0 = v.y - v.hh - 40, y1 = v.y + v.hh + 40;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < MAXP && k < max; i++) {
        if (this.life[i] <= 0 || this.add[i] !== pass) continue;
        const x = this.px[i], y = this.py[i];
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const t = 1 - this.life[i] / this.max[i];
        let a = this.a[i];
        const fd = this.fade[i];
        if (fd === 0) a *= 1 - t; else if (fd === 1) a *= Math.min(1, t * 7) * (1 - t) * (1 - t); else if (fd === 2) a *= t < 0.8 ? 1 : (1 - t) * 5;
        const o = k * 8;
        F[o] = x; F[o + 1] = y; F[o + 2] = this.w[i]; F[o + 3] = this.h[i]; F[o + 4] = this.rot[i]; F[o + 5] = this.spr[i];
        U[o + 6] = (((a > 1 ? 1 : a) * 255) << 24 | (this.b[i] << 16) | (this.g[i] << 8) | this.r[i]) >>> 0;
        F[o + 7] = pass;
        k++;
      }
    }
    return k;
  }

  // ----------------------------------------------------- sim-facing API
  tracer(x1, y1, x2, y2, kind) {
    if (this.budget <= 0 || !(this.inView(x1, y1, 60) || this.inView(x2, y2, 60))) return;
    this.budget--;
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1, ang = Math.atan2(dy, dx);
    if (kind === TR.ARROW) {
      const sp = 85, life = Math.min(1.6, d / sp);
      this.p(SPR.streak, x1, y1, (dx / d) * sp, (dy / d) * sp, 3.2, 0.32, ang, life, 28, 24, 20, 0.95, 0, 0, 0, 0, 0, 2);
      return;
    }
    const sp = kind === TR.CANNON ? 520 : 680;
    const len = kind === TR.SNIPER ? 22 : kind === TR.CANNON ? 16 : 11 + this.rnd() * 6;
    const life = Math.max(0.05, (d - len * 0.5) / sp);
    const wd = kind === TR.CANNON ? 0.7 : kind === TR.MG ? 0.42 : 0.34;
    let r = 255, g = 210, b = 120;
    if (kind === TR.MG) { g = 150; b = 70; } else if (kind === TR.SNIPER) { g = 245; b = 215; } else if (kind === TR.CANNON) { g = 170; b = 60; }
    this.p(SPR.streak, x1 + (dx / d) * len * 0.5, y1 + (dy / d) * len * 0.5, (dx / d) * sp, (dy / d) * sp, len, wd, ang, life, r, g, b, 0.95, 1, 0, 0, 0, 0, 2);
  }

  muzzle(x, y, ang, size) {
    if (this.budget <= 0 || !this.inView(x, y)) return;
    this.budget -= 0.5;
    const s = size;
    this.p(SPR.flash, x + Math.cos(ang) * s * 0.8, y + Math.sin(ang) * s * 0.8, 0, 0, 2.6 * s, 1.5 * s, ang, 0.07, 255, 225, 150, 1, 1);
    this.p(SPR.glow, x, y, 0, 0, 4.5 * s, 4.5 * s, 0, 0.09, 255, 190, 110, 0.55, 1);
    if (size > 1.5) {
      for (let k = 0; k < (size > 3 ? 4 : 2); k++) { const v = 150 + this.rnd() * 50; this.p(SPR.smoke, x + Math.cos(ang) * s, y + Math.sin(ang) * s, Math.cos(ang) * (6 + this.rnd() * 8), Math.sin(ang) * (6 + this.rnd() * 8), s * 1.2, s * 1.2, this.rnd() * 6, 0.9 + this.rnd(), v, v, v, 0.4, 0, s * 1.5, s * 1.5, 2, 0, 1); }
    }
  }

  explosion(x, y, r, kind) {
    const big = kind === 1 || kind === 2;
    const sndName = kind === 2 ? 'breach' : kind === 4 ? 'thud' : kind === 3 ? 'pop' : big ? 'boom' : 'blast';
    this.sound(sndName, x, y, big ? 1 : 0.8);
    if (kind !== 3 && kind !== 4) this.addShake(x, y, r * (kind === 2 ? 0.12 : 0.045));
    // permanent marks
    if (kind === 4) this.decal(SPR.scorch, x, y, r * 1.1, this.rnd() * 6, 60, 50, 40, 90);
    else if (kind === 3) { if (this.rnd() < 0.5) this.decal(SPR.scorch, x, y, r * 2.2, this.rnd() * 6, 255, 255, 255, 110); }
    else { this.decal(SPR.scorch, x, y, r * 2.3, this.rnd() * 6, 255, 255, 255, 120); if (big) this.decal(SPR.crater, x, y, r * 0.6, this.rnd() * 6, 255, 255, 255, 170); }
    if (!this.inView(x, y, r * 4)) return;
    if (this.expBudget <= 0) { this.p(SPR.glow, x, y, 0, 0, r * 3, r * 3, 0, 0.15, 255, 200, 120, 0.9, 1); return; }
    this.expBudget -= kind === 3 ? 0.35 : 1;
    const rn = () => this.rnd();
    if (kind === 4) {
      for (let k = 0; k < 6; k++) { const a = rn() * 6.28, v = 100 + rn() * 40; this.p(SPR.smoke, x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, Math.cos(a) * 5, Math.sin(a) * 5 - 2, r * 0.9, r * 0.9, rn() * 6, 1.4 + rn(), v, v * 0.92, v * 0.8, 0.5, 0, r * 0.9, r * 0.9, 1.5, 0.3, 1); }
      for (let k = 0; k < 6; k++) { const a = rn() * 6.28, sp = 8 + rn() * 16; this.p(SPR.debris, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.7 + rn(), 0.6 + rn() * 0.6, rn() * 6, 0.7 + rn() * 0.5, 120, 118, 112, 1, 0, 0, 0, 2.5, 8, 2); }
      return;
    }
    // flash + ground light
    this.p(SPR.glow, x, y, 0, 0, r * 3.4, r * 3.4, 0, 0.14, 255, 240, 200, 1, 1);
    this.p(SPR.glow, x, y, 0, 0, r * 8, r * 8, 0, 0.4, 255, 150, 60, kind === 3 ? 0.12 : 0.3, 1);
    if (kind === 3) {
      this.p(SPR.glow, x, y, 0, 0, r * 1.6, r * 1.6, 0, 0.22, 255, 170, 70, 0.9, 1, r * 3, r * 3);
      const v = 70 + rn() * 40; this.p(SPR.smoke, x, y, -1, -2, r * 1.3, r * 1.3, rn() * 6, 1.2 + rn(), v, v, v, 0.5, 0, r, r, 0.5, 0.4, 1);
      for (let k = 0; k < 3; k++) { const a = rn() * 6.28, sp = 14 + rn() * 22; this.p(SPR.streak, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 1.4, 0.2, a, 0.25 + rn() * 0.2, 255, 200, 110, 1, 1, 0, 0, 3); }
      return;
    }
    const nf = Math.min(14, 4 + (r / 2.2) | 0);
    for (let k = 0; k < nf; k++) {
      const a = rn() * 6.28, d = rn() * r * 0.42, s = r * (0.55 + rn() * 0.55);
      this.p(SPR.glow, x + Math.cos(a) * d, y + Math.sin(a) * d, Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6 - 2, s, s, 0, 0.28 + rn() * 0.3, 255, 130 + rn() * 90, 30 + rn() * 50, 0.95, 1, s * 1.6, s * 1.6, 2);
    }
    const ns = Math.min(12, 3 + (r / 2.5) | 0);
    for (let k = 0; k < ns; k++) {
      const a = rn() * 6.28, d = rn() * r * 0.5, s = r * (0.7 + rn() * 0.6), v = 78 + rn() * 60;
      this.p(SPR.smoke, x + Math.cos(a) * d, y + Math.sin(a) * d, Math.cos(a) * r * 0.25 - 1.5, Math.sin(a) * r * 0.25 - 2.5, s, s, rn() * 6, 2.2 + rn() * 2.6, v, v * 0.96, v * 0.9, 0.42, 0, s * 0.5, s * 0.5, 0.5, (rn() - 0.5) * 0.6, 1);
    }
    const nk = Math.min(22, (r * 1.2) | 0);
    for (let k = 0; k < nk; k++) { const a = rn() * 6.28, sp = r * (2 + rn() * 5); this.p(SPR.streak, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 1.8 + r * 0.08, 0.22, a, 0.3 + rn() * 0.4, 255, 190 + rn() * 50, 90, 1, 1, 0, 0, 3.2); }
    for (let k = 0; k < Math.min(10, r * 0.6); k++) { const a = rn() * 6.28, sp = r * (0.8 + rn() * 2.2); this.p(SPR.debris, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + rn() * 0.8, 0.4 + rn() * 0.6, rn() * 6, 0.7 + rn() * 0.7, 46, 40, 32, 1, 0, 0, 0, 2.2, (rn() - 0.5) * 16, 2); }
    this.p(SPR.ring, x, y, 0, 0, r * 0.8, r * 0.8, 0, 0.32, 255, 240, 220, 0.5, 1, r * 7, r * 7);
    if (kind === 2) {
      for (let k = 0; k < 46; k++) { const a = rn() * 6.28, sp = 10 + rn() * 55; const v = 100 + rn() * 70; const sz = 0.4 + rn() * rn() * 1.5; this.p(SPR.debris, x, y, Math.cos(a) * sp, Math.sin(a) * sp, sz, sz * 0.8, rn() * 6, 1.4 + rn() * 1.4, v, v - 4, v - 12, 1, 0, 0, 0, 1.6, (rn() - 0.5) * 12, 2); }
      for (let k = 0; k < 16; k++) { const a = rn() * 6.28, d = rn() * r, v = 110 + rn() * 50; this.p(SPR.smoke, x + Math.cos(a) * d, y + Math.sin(a) * d, Math.cos(a) * 6, Math.sin(a) * 6 - 2, r * 0.9, r * 0.9, rn() * 6, 4 + rn() * 4, v, v * 0.95, v * 0.86, 0.6, 0, r * 0.5, r * 0.5, 0.6, 0.2, 1); }
      this.emitters.push({ x, y, t: 30, rate: 5, acc: 0, size: 6, fire: true });
    } else if (big && this.rnd() < 0.5) this.emitters.push({ x, y, t: 5 + this.rnd() * 6, rate: 3, acc: 0, size: r * 0.35, fire: false });
  }

  melee(x, y) {
    if (this.budget <= 0 || this.rnd() > 0.45 || !this.inView(x, y)) return;
    this.budget -= 0.3;
    this.p(SPR.spark, x + (this.rnd() - 0.5), y + (this.rnd() - 0.5), 0, 0, 1.1, 1.1, this.rnd() * 6, 0.09, 255, 240, 220, 0.9, 1);
    this.sound('clash', x, y, 0.4);
  }

  death(type, x, y, rot) {
    const d = UNITS[type];
    const a = rot + (this.rnd() - 0.5) * 2.5;
    if (d.team === ORC) {
      if (d.role === R.TROLL) { this.decal(SPR.blood, x, y, 9, a, 30, 8, 8, 170); this.decal(SPR.corpseTroll, x, y, 8, a, 255, 255, 255, 255); this.dust(x, y, 5); this.addShake(x, y, 0.2); this.sound('thud', x, y, 0.9); }
      else if (d.role === R.LADDER || d.role === R.RAM || d.role === R.CATAPULT) {
        for (let k = 0; k < 5; k++) this.decal(SPR.splinter, x + (this.rnd() - 0.5) * d.size * 0.6, y + (this.rnd() - 0.5) * d.size * 0.5, 2 + this.rnd() * 3, this.rnd() * 6, 255, 255, 255, 255);
        if (this.inView(x, y)) for (let k = 0; k < 8; k++) { const an = this.rnd() * 6.28, sp = 6 + this.rnd() * 14; this.p(SPR.splinter, x, y, Math.cos(an) * sp, Math.sin(an) * sp, 2.2, 0.5, this.rnd() * 6, 0.8, 255, 255, 255, 1, 0, 0, 0, 2.5, (this.rnd() - 0.5) * 14, 2); }
        this.dust(x, y, d.size * 0.4); this.sound('crack', x, y, 0.7);
      } else {
        if (this.rnd() < 0.45) this.decal(SPR.blood, x, y, 2.2 + this.rnd() * 2, a, 26, 8, 8, 150);
        const v = 150 + (this.rnd() * 70) | 0;
        this.decal(SPR.corpseOrc, x, y, d.size * 0.95, a, v, v, v, 255);
        if (this.budget > 0 && this.inView(x, y)) { this.budget -= 0.4; this.p(SPR.blood, x, y, 0, 0, 1.2, 1.2, a, 0.3, 60, 8, 8, 0.8, 0, 5, 5); }
      }
    } else if (d.cls === C.VEH || d.cls === C.GUN) {
      this.explosion(x, y, 7, 0);
      this.decal(SPR.wreck, x, y, d.size, rot, 255, 255, 255, 255);
      this.emitters.push({ x, y, t: 50, rate: 5, acc: 0, size: 3, fire: true });
    } else if (d.cls === C.CACHE) {
      this.dust(x, y, 3);
      for (let k = 0; k < 3; k++) this.decal(SPR.splinter, x + (this.rnd() - 0.5) * 3, y + (this.rnd() - 0.5) * 3, 2.5, this.rnd() * 6, 255, 255, 255, 255);
    } else {
      if (this.rnd() < 0.5) this.decal(SPR.blood, x, y, 2 + this.rnd() * 2, a, 110, 14, 12, 150);
      this.decal(SPR.corpseMan, x, y, d.size * 0.95, a, 235, 235, 235, 255);
    }
  }

  dust(x, y, size) {
    if (!this.inView(x, y)) return;
    for (let k = 0; k < 3; k++) { const a = this.rnd() * 6.28, v = 120 + this.rnd() * 40; this.p(SPR.smoke, x + Math.cos(a) * size * 0.3, y + Math.sin(a) * size * 0.3, Math.cos(a) * 2, Math.sin(a) * 2 - 1, size, size, this.rnd() * 6, 1 + this.rnd(), v, v * 0.93, v * 0.8, 0.4, 0, size * 0.9, size * 0.9, 1, 0.3, 1); }
  }

  breach(x, y, kind, quiet) {
    this.addShake(x, y, 1.2);
    this.sound(kind ? 'gatebreak' : 'collapse', x, y, 1);
    if (quiet) return;
    const rn = () => this.rnd();
    for (let k = 0; k < 30; k++) { const a = rn() * 6.28, sp = 6 + rn() * 30; const v = 100 + rn() * 70; this.p(kind ? SPR.splinter : SPR.debris, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 1 + rn() * 2, 0.6 + rn() * 1.2, rn() * 6, 1.2 + rn(), kind ? 255 : v, kind ? 255 : v - 4, kind ? 255 : v - 12, 1, 0, 0, 0, 1.8, (rn() - 0.5) * 12, 2); }
    for (let k = 0; k < 12; k++) { const a = rn() * 6.28, d = rn() * 10, v = 125 + rn() * 40; this.p(SPR.smoke, x + Math.cos(a) * d, y + Math.sin(a) * d, Math.cos(a) * 5, Math.sin(a) * 5 - 2, 10, 10, rn() * 6, 3 + rn() * 3, v, v * 0.95, v * 0.85, 0.6, 0, 6, 6, 0.6, 0.2, 1); }
  }

  spark(x, y) {
    if (!this.inView(x, y)) return;
    const a = this.rnd() * 6.28, sp = 3 + this.rnd() * 6;
    this.p(SPR.spark, x + Math.cos(a), y + Math.sin(a), Math.cos(a) * sp, Math.sin(a) * sp, 1.3, 1.3, this.rnd() * 6, 0.25, 255, 220, 120, 1, 1);
    this.p(SPR.glow, x, y, 0, 0, 5, 5, 0, 0.2, 255, 160, 60, 0.5, 1);
  }

  pickup(x, y) {
    if (!this.inView(x, y)) return;
    this.p(SPR.ring, x, y, 0, 0, 1.5, 1.5, 0, 0.7, 110, 230, 160, 0.9, 1, 9, 9);
  }

  trail(x, y) {
    if (!this.inView(x, y)) return;
    const v = 190 + this.rnd() * 40;
    this.p(SPR.smoke, x, y, (this.rnd() - 0.5) * 2, (this.rnd() - 0.5) * 2, 1.6, 1.6, this.rnd() * 6, 0.9, v, v, v, 0.45, 0, 2.5, 2.5, 0, 0, 1);
    this.p(SPR.glow, x, y, 0, 0, 3, 3, 0, 0.12, 255, 190, 110, 0.8, 1);
  }

  addShake(x, y, amt) {
    const v = this.view;
    if (!this.inView(x, y, 150)) return;
    const k = Math.min(1, v.zoom / 3.5);
    this.shake = Math.min(1.6, this.shake + amt * (0.35 + 0.65 * k));
  }

  sound(name, x, y, vol = 1) {
    if (!this.audio) return;
    const v = this.view;
    let g = vol * Math.min(1, 0.3 + v.zoom / 7);
    if (!this.inView(x, y, 30)) g *= 0.22;
    const pan = Math.max(-1, Math.min(1, (x - v.x) / (v.hw + 1)));
    this.audio.play(name, g, pan);
  }
}
