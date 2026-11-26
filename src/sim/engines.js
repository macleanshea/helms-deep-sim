// Crewed siege engines. Mixed into Sim.prototype.
//
// With the `crews` rule on, a ladder, ram, siege tower or catapult is timber: small arms cannot
// hurt it and it cannot move itself. Uruk-hai (and trolls, for the heavy engines) nearby are
// drafted into its crew, take a place beside it and walk it forward. Its pace follows how much
// of a crew it has; with too few it is set down where it stands until more hands arrive, which
// may be a later wave. Carriers are ordinary soldiers: they can be shot, pinned and routed, and
// marksmen pick them out.
//
// Also here: defenders throwing a raised ladder back off the wall.

import { WORLD_W, WORLD_H, DT, ORC, UNITS, U, R, C, T } from '../config.js';
import { S_MOVE, S_WAIT, S_DONE, S_FLEE, LADDER_TIME, LOSS_CELL as OCS, LOSS_W as OW, LOSS_H as OH, FINE_CELL as FINE, FINE_W as FW, FINE_H as FH } from './sim.js';

const DCS = 8, DW = WORLD_W / DCS, DH = WORLD_H / DCS; // the defender grid (must match sim.js)
const DRAFT_R2 = 45 * 45;

export const engineMethods = {
  /** Start of a tick: last tick's roll-call becomes each engine's crew strength. */
  _crewTick() {
    const { crewAcc, crewPts, haveAcc, crewHave, slotAcc, slotMask } = this;
    for (const e of this.engines) { crewPts[e] = crewAcc[e]; crewAcc[e] = 0; crewHave[e] = haveAcc[e]; haveAcc[e] = 0; slotMask[e] = slotAcc[e]; slotAcc[e] = 0; }
  },

  /**
   * How fast engine i can move this tick (0: set down). Also keeps its crew topped up.
   * eEver bits: 1 has had a working crew, 2 counted as dropped, 4 has had a full crew.
   */
  _engineSpeed(i, d, speed) {
    const st = this.state[i];
    if (st === S_DONE || st === S_FLEE) return 0;
    const cr = d.crew, pts = this.crewPts[i];
    if ((this.tick + i) % 10 === 0 && this.crewHave[i] < cr.need) this._draft(i, d);
    if (pts < cr.min) {
      if (this.eIdle[i] === 0) this.eIdle[i] = this.time;
      else if ((this.eEver[i] & 3) === 1 && this.time - this.eIdle[i] > 5) { this.eEver[i] |= 2; this.stats.dropped++; }
      return 0;
    }
    if (this.eEver[i] & 2) { this.eEver[i] &= ~2; this.stats.recovered++; }
    this.eEver[i] |= pts >= cr.need ? 5 : 1; this.eIdle[i] = 0;
    if (this.time < this.eHalt[i]) return 0;
    let v = speed * Math.min(1, pts / cr.need);
    // carried among locked shields, it keeps to their pace
    if (this.stuck[i]) { this.stuck[i]--; if (v > 3.36) v = 3.36; }
    return v;
  },

  /** Find hands for engine e among the troops standing or marching close by. */
  _draft(e, d) {
    const cr = d.crew, x = this.x[e], y = this.y[e];
    const cx = (x / OCS) | 0, cy = (y / OCS) | 0;
    const uruk = U.uruk, troll = U.troll;
    let b1 = -1, s1 = 1e12, b2 = -1, s2 = 1e12, avail = 0;
    for (let yy = Math.max(0, cy - 1); yy <= Math.min(OH - 1, cy + 1); yy++) for (let xx = Math.max(0, cx - 1); xx <= Math.min(OW - 1, cx + 1); xx++) {
      for (let j = this.ocHead[yy * OW + xx]; j >= 0; j = this.cnext[j]) {
        const ty = this.type[j];
        if (ty !== uruk && !(cr.troll && ty === troll)) continue;
        if (this.crewOf[j] >= 0 || this.el[j] || !this.alive[j]) continue;
        const sj = this.state[j];
        if (sj !== S_MOVE && sj !== S_WAIT) continue;
        const gj = this.grp[j];
        if (this.gState[gj] >= 2 || this.gOrder[gj] === 2) continue;
        const dx = this.x[j] - x, dy = this.y[j] - y, d2 = dx * dx + dy * dy;
        if (d2 > DRAFT_R2) continue;
        const sc = ty === troll ? d2 * 0.15 : d2; // a troll is worth several pairs of hands
        avail += ty === troll ? cr.troll : 1;
        if (sc < s1) { b2 = b1; s2 = s1; b1 = j; s1 = sc; } else if (sc < s2) { b2 = j; s2 = sc; }
      }
    }
    // nobody is called over unless there are hands enough in reach to shift it
    if (this.crewHave[e] + avail < cr.min) return;
    let need = cr.need - this.crewHave[e];
    const ns = cr.slots.length;
    for (const j of [b1, b2]) {
      if (j < 0 || need <= 0) break;
      const taken = this.slotMask[e] | this.slotAcc[e];
      let k = 0;
      while (k < ns && (taken >> k) & 1) k++;
      if (k >= ns) k = (this.tick + j) % ns;
      const pts = this.type[j] === troll ? cr.troll : 1;
      this.crewOf[j] = e; this.crewGen[j] = this.gen[e]; this.slot[j] = k;
      this.slotAcc[e] |= 1 << k; this.haveAcc[e] += pts; this.crewHave[e] += pts; need -= pts;
      if (this.eIdle[e] > 0) this.eIdle[e] = this.time; // a fresh party gets its chance to take hold
      if (this.state[j] === S_WAIT) { this.state[j] = S_MOVE; this.linkT[j] = this.time; }
      // a replacement has to run in and take hold: the engine waits for him
      if (this.eEver[e] & 4) this.eHalt[e] = Math.max(this.eHalt[e], this.time + 2.5);
    }
  },

  /** A soldier on an engine's crew. Returns false once he has left it (and should act for himself again). */
  _crewStep(i, d) {
    const e = this.crewOf[i], g = this.grp[i];
    if (!this.alive[e] || this.gen[e] !== this.crewGen[i] || this.state[e] === S_DONE || this.state[e] === S_FLEE || this.state[i] === S_FLEE || this.gState[g] >= 2 || this.gOrder[g] === 2) {
      this.crewOf[i] = -1;
      return false;
    }
    const cr = UNITS[this.type[e]].crew;
    // too few hands for too long: he gives it up and goes back to the fight
    if (this.eIdle[e] > 0 && this.time - this.eIdle[e] > 20 && this.crewPts[e] < cr.min) { this.crewOf[i] = -1; return false; }
    const pts = d.role === R.TROLL ? cr.troll : 1;
    const k = this.slot[i];
    this.haveAcc[e] += pts; this.slotAcc[e] |= 1 << k;
    const sl = cr.slots[k % cr.slots.length];
    const r = this.rot[e], c = Math.cos(r), s = Math.sin(r);
    const sx = this.x[e] + c * sl[0] - s * sl[1], sy = this.y[e] + s * sl[0] + c * sl[1];
    const x = this.x[i], y = this.y[i], dx = sx - x, dy = sy - y, d2 = dx * dx + dy * dy;
    this.el[i] = 0;
    if (this.cd[i] > 0) this.cd[i] -= DT;
    if (d2 < 12) {
      // in his place: he goes where the engine goes
      this.crewAcc[e] += pts;
      if (this.gShield[g]) this.stuck[e] = 3;
      const f = d2 > 0.04 ? 0.35 : 1;
      this.x[i] = x + dx * f; this.y[i] = y + dy * f;
      this.vx[i] = this.vx[e]; this.vy[i] = this.vy[e]; this.rot[i] = r;
      return true;
    }
    if (d2 > 6400) { this.crewOf[i] = -1; return false; } // left far behind
    const l = Math.sqrt(d2);
    this._move(i, dx / l, dy / l, d.speed * 1.25, d.sz, 0, 1);
    return true;
  },

  /** The company inside a siege tower climbs down where it stands; the empty tower stays. */
  _towerSpill(i) {
    const aboard = this.ammo[i] | 0;
    if (!aboard) return;
    this.ammo[i] = 0; this.count[ORC] -= aboard; // spawn() counts each of them again
    if (this.target[i] < 0) { this.target[i] = this.newGroup(ORC); this.gType[this.target[i]] = U.uruk; }
    const x = this.x[i], y = this.y[i];
    for (let k = 0; k < aboard; k++) {
      const a = this.rand() * 6.28, rr = 4 + this.rand() * 6;
      let sx = x + Math.cos(a) * rr, sy = y + Math.sin(a) * rr;
      const sc = this.map.cellOf(sx, sy);
      if (this.mtype[sc] === T.CLIFF || this.elev[sc]) { sx = x; sy = y; }
      const j = this.spawn(U.uruk, sx, sy, a, this.target[i]);
      if (j >= 0) this.state[j] = S_MOVE;
    }
  },

  /** Distance from a point to the foot of the nearest stretch of wall, standing or not. */
  _fortDist(x, y) {
    let bd = 1e12;
    for (const s of this.segs) { const dx = s.ox - x, dy = s.oy - y, d2 = dx * dx + dy * dy; if (d2 < bd) bd = d2; }
    return Math.sqrt(bd);
  },

  /**
   * A raised ladder L: defenders standing at its head, with no attacker yet on the wall beside
   * them, heave it back off. A ladder with men on it is harder to shift. With crews on it falls
   * to the foot of the wall and can be raised again; otherwise it is lost.
   */
  _throwCheck(L) {
    if ((this.tick + L) % 5) return;
    const hx = this.tx[L], hy = this.ty[L];
    const cx = (hx / DCS) | 0, cy = (hy / DCS) | 0;
    let def = 0;
    for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) {
      if (xx < 0 || yy < 0 || xx >= DW || yy >= DH) continue;
      for (let j = this.dcHead[yy * DW + xx]; j >= 0; j = this.cnext[j]) {
        if (!this.alive[j] || !this.el[j] || UNITS[this.type[j]].cls !== C.INF || this.gPin[this.grp[j]] === 2) continue;
        const dx = this.x[j] - hx, dy = this.y[j] - hy;
        if (dx * dx + dy * dy < 14) def++;
      }
    }
    if (!def) { if (this.cd2[L] > 0) this.cd2[L] = Math.max(0, this.cd2[L] - 0.25); return; }
    const fx = (hx / FINE) | 0, fy = (hy / FINE) | 0;
    for (let yy = Math.max(0, fy - 3); yy <= Math.min(FH - 1, fy + 3); yy++) for (let xx = Math.max(0, fx - 3); xx <= Math.min(FW - 1, fx + 3); xx++) {
      for (let j = this.head[yy * FW + xx]; j >= 0; j = this.next[j]) {
        if (this.team[j] !== ORC || !this.el[j] || !this.alive[j]) continue;
        const dx = this.x[j] - hx, dy = this.y[j] - hy;
        if (dx * dx + dy * dy < 36) { this.cd2[L] = 0; return; } // the head is held
      }
    }
    const loaded = this.time < this.linkT[L] - 0.75 + LADDER_TIME;
    this.cd2[L] += 0.085 * Math.min(def, 3) * (loaded ? 0.35 : 1); // three men, six seconds; far longer with climbers' weight on it
    if (this.cd2[L] < 3) return;
    const k = this.aux2[L], s = this.segs[k], x = this.x[L], y = this.y[L];
    this.stats.thrown++;
    this.fx.dust(x, y, this.map.groundZ(x, y), 3); this.fx.sound('ladder', x, y, 0.7);
    this._alert('ladDown' + this.segSector(k), 20, `A ladder is thrown down from ${this.sectors[this.segSector(k)].name}`, 'good', x, y);
    if (this.ff.crews) {
      s.ladders--; s.claimed++; this._unlink(L);
      this.state[L] = S_MOVE; this.eHalt[L] = this.time + 6; this.cd2[L] = 0; this.eEver[L] = 0; this.eIdle[L] = this.time;
      this.x[L] = this.px[L] = s.ox; this.y[L] = this.py[L] = s.oy;
    } else this.kill(L, null);
  },
};
