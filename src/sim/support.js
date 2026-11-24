// Logistics and player-called support: resupply, air strikes, gunships, artillery,
// air assault. Mixed into Sim.prototype.

import { WORLD_W, WORLD_H, DT, DEF, ORC, UNITS, U, WEAPONS, TR, C } from '../config.js';
import { canPlace } from '../scenarios.js';

const W = WEAPONS;
const DCS = 8, DW = WORLD_W / DCS, DH = WORLD_H / DCS;
export const SUPPLY_R = 60; // re-arm radius of caches and supply drops (m)

// cruising height of each kind of aircraft over open ground, and how far it keeps above the hills
const ALT = { jet: [125, 45], cargo: [105, 40], helo: [52, 28], transport: [48, 22] };

export const supportMethods = {
  /** Height an aircraft wants at x,y: its cruising height, or higher where the mountains demand it. */
  _altAt(kind, x, y, vx = 0, vy = 0) {
    const [base, clear] = ALT[kind];
    let f = this.map.airFloor(x, y);
    // fast movers look ahead so they are already climbing when the ridge arrives
    for (const t of [1.2, 2.5, 4]) { if (!vx && !vy) break; f = Math.max(f, this.map.airFloor(x + vx * t, y + vy * t)); }
    return Math.max(base, f + clear);
  },

  _supply() {
    for (const ci of this.caches) {
      if (!this.alive[ci] || this.ammo[ci] <= 0) continue;
      const x = this.x[ci], y = this.y[ci], R2 = SUPPLY_R * SUPPLY_R;
      const x0 = Math.max(0, ((x - SUPPLY_R) / DCS) | 0), x1 = Math.min(DW - 1, ((x + SUPPLY_R) / DCS) | 0);
      const y0 = Math.max(0, ((y - SUPPLY_R) / DCS) | 0), y1 = Math.min(DH - 1, ((y + SUPPLY_R) / DCS) | 0);
      let given = 0;
      for (let yy = y0; yy <= y1 && this.ammo[ci] > 0; yy++) for (let xx = x0; xx <= x1 && this.ammo[ci] > 0; xx++) {
        for (let j = this.dcHead[yy * DW + xx]; j >= 0; j = this.cnext[j]) {
          if (!this.alive[j]) continue;
          const d = UNITS[this.type[j]];
          if (!d.ammo) continue;
          const mx = this.maxAmmo(j);
          if (this.ammo[j] > mx * 0.4) continue;
          const dx = this.x[j] - x, dy = this.y[j] - y;
          if (dx * dx + dy * dy > R2) continue;
          this.ammo[j] = mx; if (d.ammo2) this.ammo2[j] = d.ammo2 * Math.min(this.opt.ammoMult, 50);
          this.ammo[ci] -= d.supply || 1; given++;
          if (given < 6) this.fx.pickup(this.x[j], this.y[j], this.unitZ(j));
          if (this.ammo[ci] <= 0) break;
        }
      }
      if (this.ammo[ci] <= 0) {
        this.kill(ci, null, true);
        this._alert('cacheDry', 25, 'An ammo point has run dry — call a resupply drop', 'warn', x, y);
      }
    }
  },

  /** Warn when the men holding a sector have mostly run out of ammunition. */
  _ammoWatch() {
    const armed = [0, 0, 0, 0], dry = [0, 0, 0, 0], sx = [0, 0, 0, 0], sy = [0, 0, 0, 0];
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.team[i] !== DEF) continue;
      const d = UNITS[this.type[i]];
      if (d.cls !== C.INF || !d.ammo) continue;
      const k = this.sectorAt(this.x[i], this.y[i]);
      armed[k]++;
      if (this.ammo[i] < 1) { dry[k]++; sx[k] += this.x[i]; sy[k] += this.y[i]; }
    }
    for (let k = 0; k < 4; k++) {
      if (armed[k] >= 4 && dry[k] * 2 >= armed[k]) this._alert('dry' + k, 90, `${this.sectors[k].name.replace(/^t/, 'T')} is out of ammunition`, 'bad', sx[k] / dry[k], sy[k] / dry[k]);
    }
  },

  ammoLevel() {
    let a = 0, m = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.team[i] !== DEF) continue;
      const d = UNITS[this.type[i]];
      if (!d.ammo) continue;
      const mx = this.maxAmmo(i);
      a += Math.min(1, this.ammo[i] / mx) ; m += 1;
    }
    return m ? a / m : 0;
  },

  // ------------------------------------------------------ player orders
  /** Can this kind of support be paid for (Command Points, or uses left in the sandbox)? */
  affordSupport(kind) { const s = this.support[kind]; return !!s && (this.opt.sandbox ? s.left > 0 : this.cp >= s.cost); },
  canSupport(kind) { const s = this.support[kind]; return !!s && this.affordSupport(kind) && this.time >= s.ready && !this.result; },

  callSupport(kind, x, y, x2 = x, y2 = y) {
    if (!this.canSupport(kind)) return false;
    const s = this.support[kind];
    if (this.opt.sandbox) s.left--; else { this.cp -= s.cost; this.cpStats.spent += s.cost; }
    this.cpStats.calls++;
    s.ready = this.time + s.cd;
    const rnd = this.rand;
    if (kind === 'air') {
      let dx = x2 - x, dy = y2 - y, L = Math.hypot(dx, dy), cx = x, cy = y;
      if (L < 20) { dx = 0; dy = -1; L = 230; } else { cx = (x + x2) / 2; cy = (y + y2) / 2; dx /= L; dy /= L; L = Math.max(170, L); }
      const speed = 230, sd = 1250, N = Math.max(8, Math.min(18, Math.round(L / 20)));
      const rot = Math.atan2(dy, dx);
      for (let j = 0; j < 2; j++) {
        const off = j ? 14 : -14, back = j * 70;
        const sx = cx - dx * (sd + back) - dy * off, sy = cy - dy * (sd + back) + dx * off;
        this.aircraft.push({ kind: 'jet', x: sx, y: sy, px: sx, py: sy, vx: dx * speed, vy: dy * speed, rot, t: 0, life: (2 * sd + 200) / speed });
      }
      for (let k = 0; k < N; k++) {
        const al = (k / (N - 1) - 0.5) * L, side = (k & 1 ? 1 : -1) * 11, j = k & 1;
        const bx = cx + dx * al - dy * side, by = cy + dy * al + dx * side;
        const ti = this.time + (sd + j * 70 + al) / speed;
        const rx = bx - dx * speed * 0.7, ry = by - dy * speed * 0.7;
        this.timed.push({ t: ti - 0.8, f: () => this._launch(rx, ry, this._altAt('jet', rx, ry, dx * speed, dy * speed) - 5, bx, by, this.map.groundZ(bx, by), W.bomb, DEF, 4, 0.8) });
      }
      this.timed.push({ t: this.time + (sd - 500) / speed, f: () => this.fx.sound('jet', cx, cy, 1) });
      this.events.push({ type: 'log', text: 'Fast air inbound — bombs in 5 seconds', cls: 'good', x: cx, y: cy });
    } else if (kind === 'arty') {
      for (let k = 0; k < 20; k++) {
        const a = rnd() * 6.2832, rr = 45 * Math.sqrt(rnd());
        const tx = x + Math.cos(a) * rr, ty = y + Math.sin(a) * rr;
        this.timed.push({ t: this.time + 4.5 + k * 0.45 + rnd() * 0.3, f: () => { this._launch(tx - 70, ty + 30, 300, tx, ty, this.map.groundZ(tx, ty), W.arty, DEF, 0, 0.6); this.fx.sound('incoming', tx, ty, 0.6); } });
      }
      this.events.push({ type: 'log', text: 'Fire mission — shot, over', cls: 'good', x, y });
    } else if (kind === 'gunship') {
      for (let j = 0; j < 2; j++) {
        const sx = WORLD_W + 150 + j * 90, sy = y - 120 + j * 240;
        this.aircraft.push({ kind: 'helo', x: sx, y: sy, px: sx, py: sy, cx: x, cy: y, phase: j * Math.PI, rot: Math.PI, t: 0, st: 0, until: 0, gcd: 0, rcd: 1 + j });
      }
      this.fx.sound('helo', x, y, 1);
      this.events.push({ type: 'log', text: 'Gunships on station in moments', cls: 'good', x, y });
    } else if (kind === 'supply') {
      const sp = 115, sd = 650;
      this.aircraft.push({ kind: 'cargo', x: x + sd, y: y, px: x + sd, py: y, vx: -sp, vy: 0, rot: Math.PI, t: 0, life: (sd + x + 300) / sp });
      this.timed.push({ t: this.time + sd / sp, f: () => { for (let k = 0; k < 2; k++) this.drops.push({ x: x + (k ? 9 : -9), y: y + (rnd() - 0.5) * 14, t: 0, T: 5.5 }); } });
      this.fx.sound('cargo', x, y, 1);
      this.events.push({ type: 'log', text: 'Resupply bird inbound', cls: 'good', x, y });
    } else if (kind === 'reinforce') {
      const sx = WORLD_W + 200, sy = y + 50;
      this.aircraft.push({ kind: 'transport', x: sx, y: sy, px: sx, py: sy, cx: x, cy: y, rot: Math.PI, t: 0, st: 0, until: 0, dropped: 0, grp: this.newGroup(DEF) });
      this.fx.sound('helo', x, y, 1);
      this.events.push({ type: 'log', text: 'Air assault platoon inbound', cls: 'good', x, y });
    }
    return true;
  },

  _aircraft() {
    const list = this.aircraft;
    let k = 0;
    for (let n = 0; n < list.length; n++) {
      const a = list[n];
      a.t += DT; a.px = a.x; a.py = a.y;
      let keep = true;
      if (a.kind === 'jet' || a.kind === 'cargo') {
        a.x += a.vx * DT; a.y += a.vy * DT;
        keep = a.t < a.life;
      } else {
        const speed = a.kind === 'helo' ? 62 : 55;
        const fly = (tx, ty) => {
          const dx = tx - a.x, dy = ty - a.y, l = Math.hypot(dx, dy);
          if (l < speed * DT) { a.x = tx; a.y = ty; return true; }
          a.x += (dx / l) * speed * DT; a.y += (dy / l) * speed * DT;
          let da = Math.atan2(dy, dx) - a.rot; if (da > Math.PI) da -= 6.2832; else if (da < -Math.PI) da += 6.2832;
          a.rot += da * 0.25;
          return false;
        };
        if (a.st === 0) {
          const R0 = a.kind === 'helo' ? 85 : 0;
          if (fly(a.cx + Math.cos(a.phase || 0) * R0, a.cy + Math.sin(a.phase || 0) * R0)) { a.st = 1; a.until = this.time + (a.kind === 'helo' ? 40 : 5); }
        } else if (a.st === 1) {
          if (a.kind === 'helo') {
            a.phase += 0.32 * DT;
            a.x = a.cx + Math.cos(a.phase) * 85; a.y = a.cy + Math.sin(a.phase) * 85;
            let da = a.phase + Math.PI - a.rot; da = ((da + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI;
            a.rot += da * 0.2;
            if ((a.gcd -= DT) <= 0) {
              a.gcd = 0.2;
              const t = this._randOrcNear(a.cx, a.cy, 150);
              if (t >= 0) {
                const tx = this.x[t] + (this.rand() - 0.5) * 4, ty = this.y[t] + (this.rand() - 0.5) * 4;
                this.fx.tracer(a.x, a.y, a.z + 2, tx, ty, this.map.groundZ(tx, ty) + 0.5, TR.CANNON); this.fx.sound('autocannon', a.x, a.y, 0.7);
                this.explode(tx, ty, W.heli_gun.aoe, W.heli_gun.dmg, W.heli_gun, DEF, false);
              }
            }
            if ((a.rcd -= DT) <= 0) {
              a.rcd = 2.2;
              const t = this._randOrcNear(a.cx, a.cy, 150);
              if (t >= 0) { this._launch(a.x, a.y, a.z + 2, this.x[t], this.y[t], this.unitZ(t), W.heli_rkt, DEF, 1, 0.9); this.fx.sound('rocket', a.x, a.y, 0.8); }
            }
          } else if (a.dropped < 30 && this.tick % 2 === 0) {
            // the whole platoon gets off: a spot that cannot be stood on is skipped, not counted
            const mix = ['rifle', 'rifle', 'rifle', 'rifle', 'rifle', 'mg', 'rifle', 'rifle', 'rifle', 'marksman', 'rifle', 'rifle', 'at', 'rifle', 'rifle'];
            const ti = U[mix[a.dropped % mix.length]], d = UNITS[ti];
            const n = a.tries = (a.tries || 0) + 1;
            const ang = n * 2.4, rr = 3 + Math.sqrt(n) * 2.4;
            const ux = a.cx + Math.cos(ang) * rr, uy = a.cy + Math.sin(ang) * rr;
            if (canPlace(this.map, d, ux, uy, null)) { const j = this.spawn(ti, ux, uy, Math.PI, a.grp); if (j >= 0) { this.fx.dust(ux, uy, this.unitZ(j), 1.5); a.dropped++; this.stats.reinforced = (this.stats.reinforced || 0) + 1; } }
          }
          if (a.kind === 'helo' ? this.time >= a.until : a.dropped >= 30 || a.tries >= 90) a.st = 2;
        } else {
          fly(WORLD_W + 400, a.cy - 100);
          keep = a.x < WORLD_W + 300;
        }
      }
      // altitude: follow the ground over the mountains, climbing hard and letting down gently
      const want = a.kind === 'transport' && a.st === 1 ? Math.max(26, this.map.terrZ(a.x, a.y) + 14) : this._altAt(a.kind, a.x, a.y, a.vx || (a.x - a.px) / DT, a.vy || (a.y - a.py) / DT);
      a.pz = a.z ?? want;
      if (a.z == null) a.z = want;
      else a.z += Math.max(-9 * DT, Math.min((a.kind === 'jet' ? 70 : 30) * DT, (want - a.z) * 0.5));
      if (keep) list[k++] = a;
    }
    list.length = k;
  },

  _drops() {
    let k = 0;
    for (const dr of this.drops) {
      dr.t += DT;
      if (dr.t >= dr.T) {
        let { x, y } = dr;
        for (let a = 0; a < 12 && !canPlace(this.map, UNITS[U.crate], x, y); a++) { x = dr.x + Math.cos(a) * (6 + a * 2); y = dr.y + Math.sin(a) * (6 + a * 2); }
        this.spawn(U.crate, x, y, this.rand() * 6.28, this.miscGroup[DEF]);
        this.fx.dust(x, y, this.map.groundZ(x, y), 3);
      } else this.drops[k++] = dr;
    }
    this.drops.length = k;
  },

};
