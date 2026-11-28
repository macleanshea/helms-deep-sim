// Lashed ladders: the horde's way up the Hornburg's ring wall. Mixed into Sim.prototype.
//
// The ring wall stands on the Hornburg's rock: its walk is 21 m up, and between the wall's foot and the valley floor
// lies a band of steep rock 7-14 m wide. No scaling ladder reaches that. Two lashed end to end do, about 24 m of
// timber standing on the valley floor and leaning on the parapet: heavy, slow to raise, flexing under every man on it,
// and easily heaved off. The horde turns to them only when the garrison has given up the Deeping Wall for the
// Hornburg (the warlord's `abandoned`), so that shutting oneself in the keep is not a free win.
//
// This module holds the geometry (where on the valley floor each stretch of the ring can be laddered from) and the
// links that let the horde's path fields lead from a ladder's foot to the wall walk it leans on (src/sim/flow.js
// `jump`). The ladder's life (pairing, raising, climbing, falling, throwing down) is in sim.js and engines.js.

import { GW, GH, CELL, T } from '../config.js';
import { S_DONE, S_ACT, LASHED_TIME } from './sim.js';

const FOOT_MIN = 6, FOOT_MAX = 20;  // how far out from the wall's center line, beyond its half-thickness, a foot may stand (m)
const FLOOR_Z = 4;                  // the foot stands on the valley floor: ground no higher than this (m)
const MAXJ = 64;                    // most lashed ladders standing at once

export const lashedMethods = {
  _initLashed() {
    const NC = GW * GH;
    this.footAt = new Int32Array(NC).fill(-1);  // the lashed ladder standing with its foot in this cell, or -1
    this.jump = { head: new Int32Array(NC).fill(-1), from: new Int32Array(MAXJ), cost: new Int32Array(MAXJ), dir: new Uint8Array(MAXJ), next: new Int32Array(MAXJ), count: 0 };
    this.navOrc.jump = this.jump;
    this.lashed = [];                            // standing lashed ladders (unit indices)
    const N = this.alive.length;
    this.isLashed = new Uint8Array(N);           // a ladder that is two lashed together (set when it is raised against the ring)
    this.climbLong = new Uint8Array(N);          // a climber on a lashed ladder (kept if the ladder goes, for the height he falls from)
    this.lashMate = new Int32Array(N).fill(-1);  // the other ladder of a pair to be lashed together (the one carrying it to the foot of the rock follows the one that chose where)
    this.lashT = new Float32Array(N);            // when a ladder last looked for a mate
    this.jumpDirty = false;
    // where each stretch of the ring can be laddered from: the first stretch of valley floor straight out from it
    this.ringFoot = this.segs.map((s) => {
      if (s.group !== 1 || s.kind !== 'ring') return null;
      for (let d = s.half + FOOT_MIN; d <= s.half + FOOT_MAX; d += 0.5) {
        const x = s.x + s.nx * d, y = s.y + s.ny * d, c = this.map.cellOf(x, y), t = this.mtype[c];
        if (t === T.CLIFF || t === T.WALL || t === T.STAIR || t === T.DOOR || this.mseg[c] >= 0 || this.tier[c]) continue;
        if (this.map.groundZ(x, y) > FLOOR_Z) continue;
        // a pace further out, so the whole foot stands clear of the rock
        const fx = x + s.nx * 1.5, fy = y + s.ny * 1.5, fc = this.map.cellOf(fx, fy);
        if (this.mtype[fc] === T.CLIFF) continue;
        // (behind the Deeping Wall, in the Deep: reached only through a breach, or over the wall)
        const J = this.map.wallJoin, Tp = this.map.wallTop, wx = fy >= J.y ? J.x : this.map.wallAt(Math.max(0, Math.min(1, (fy - J.y) / (Tp.y - J.y)))).x;
        return { x: fx, y: fy, c: fc, d: d + 1.5, deep: fx > wx };
      }
      return null;
    });
  },

  /**
   * A stretch of the ring for a ladder crew of company g to make for: one with a foot on the valley floor, not already
   * taken, as near as can be to where its force is bound (the postern, the gate), so that the companies gathering
   * there escort it, lend it hands and cover it; failing an objective, the nearest to the crew. Some spread, so the
   * crews of one force do not all choose the same few.
   */
  _pickRingSeg(x, y, g) {
    const o = g >= 0 ? this._objOf(g) : null, ox = o ? o.x : x, oy = o ? o.y : y;
    let best = -1, bs = 1e12;
    for (let k = 0; k < this.segs.length; k++) {
      const f = this.ringFoot[k], s = this.segs[k];
      if (!f || s.breached || s.ladders + s.claimed >= 1 || (f.deep && !this.wl.open)) continue;
      const sc = Math.hypot(f.x - ox, f.y - oy) + this.rand() * 40;
      if (sc < bs) { bs = sc; best = k; }
    }
    return best;
  },

  /** Ladder L, bound for a stretch of the ring, looks for a second ladder close by to be lashed to it. */
  _findMate(L) {
    this.lashT[L] = this.time;
    let best = -1, bd = 250 * 250;
    for (const e of this.engines) {
      if (e === L || this.type[e] !== this.type[L] || !this.alive[e] || this.lashMate[e] >= 0 || this.isLashed[e]) continue;
      const st = this.state[e];
      if (st !== 1 && st !== 5) continue; // (on the move or waiting: one raised or being raised stays where it is)
      const k = this.aux2[e];
      // one still bound for the Deeping Wall is taken only if it is a long way from it; one bound for the ring with no
      // mate of its own gives up its stretch and becomes this one's mate
      if (k >= 0 && (this.segs[k].group === 0 ? Math.hypot(this.segs[k].ox - this.x[e], this.segs[k].oy - this.y[e]) < 100 : this.state[e] !== 1)) continue;
      let d2 = (this.x[e] - this.x[L]) ** 2 + (this.y[e] - this.y[L]) ** 2;
      if (this.gForce[this.grp[e]] !== this.gForce[this.grp[L]]) d2 *= 2; // (a ladder of its own force first)
      if (d2 < bd) { bd = d2; best = e; }
    }
    if (best < 0) return -1;
    const k = this.aux2[best];
    if (k >= 0) { this.segs[k].claimed--; this.aux2[best] = -1; }
    this.lashMate[best] = L; this.lashMate[L] = best;
    return best;
  },

  /**
   * The second ladder of a pair: carried to the foot of the rock where the first is bound, and set down beside it.
   * Returns false if the pair has come apart (it then goes about its business as an ordinary ladder).
   */
  _mateStep(i, d, speed) {
    const L = this.lashMate[i];
    if (L < 0 || !this.alive[L] || this.lashMate[L] !== i || this.aux2[L] < 0) { this.lashMate[i] = -1; return false; }
    const f = this.ringFoot[this.aux2[L]], x = this.x[i], y = this.y[i];
    const dx = f.x - x, dy = f.y - y, l = Math.sqrt(dx * dx + dy * dy);
    if (l < 7 || speed <= 0) { this.vx[i] *= 0.4; this.vy[i] *= 0.4; return true; }
    let mx = dx / l, my = dy / l;
    // (by the path all the way in: the feet lie among the causeway's walled sides and the rock)
    if (l > 12) { const fl = this._ringField(this.map.cellOf(x, y)); if (fl && this._flow(x, y, fl)) { mx = this.fdx; my = this.fdy; } } // (the field leads to the nearest foot: the last few meters straight to its own)
    this._move(i, mx, my, speed, d.sz, 0);
    return true;
  },

  /**
   * A ladder bound for a stretch of the ring (k): carried to the foot of the rock below it, where it waits for its mate;
   * the two are lashed together there and heaved up (see the S_ACT branch of the ladder case in Sim._orc).
   */
  _ringLadder(i, d, k, speed, crewed, g) {
    const f = this.ringFoot[k], x = this.x[i], y = this.y[i];
    const dx = f.x - x, dy = f.y - y, l = Math.sqrt(dx * dx + dy * dy);
    if (l < 130 && !this.ammo2[i]) { this.ammo2[i] = 1; this._alert('lashIn', 40, 'Ladder crews approaching · Hornburg', 'warn', x, y); }
    let m = this.lashMate[i];
    if (m >= 0 && (!this.alive[m] || this.lashMate[m] !== i)) { this.lashMate[i] = m = -1; }
    if (m < 0 && this.time - this.lashT[i] > 5) m = this._findMate(i);
    if (l < 3) {
      this.vx[i] = this.vy[i] = 0;
      // both ladders at the foot and hands to work them: lash them together and heave the long ladder up
      if (m < 0 || Math.hypot(this.x[m] - f.x, this.y[m] - f.y) > 8 || (crewed && (speed <= 0 || this.crewPts[i] < LASHED_HANDS))) return;
      this.fx.dust(this.x[m], this.y[m], this.map.groundZ(this.x[m], this.y[m]), 2);
      this.lashMate[i] = -1; this.lashMate[m] = -1; this.kill(m, null, true); // (its timber is now part of this one; its carriers go back to the fight)
      this.state[i] = S_ACT; this.aux[i] = this.time + LASHED_RAISE; this.rot[i] = Math.atan2(-this.segs[k].ny, -this.segs[k].nx);
      return;
    }
    if (crewed && speed <= 0) { this.vx[i] *= 0.4; this.vy[i] *= 0.4; return; }
    let mx = dx / l, my = dy / l;
    if (l > 12) { const fl = this._ringField(this.map.cellOf(x, y)); if (fl && this._flow(x, y, fl)) { mx = this.fdx; my = this.fdy; } } // (the field leads to the nearest foot: the last few meters straight to its own)
    this._move(i, mx, my, speed, d.sz, 0);
    void g;
  },

  /** Lashed ladder L is up against stretch k of the ring: it stands on the valley floor and leans on the parapet. */
  _raiseLashed(L, k) {
    const s = this.segs[k], f = this.ringFoot[k];
    this.isLashed[L] = 1;
    this.x[L] = this.px[L] = f.x; this.y[L] = this.py[L] = f.y;
    this.tx[L] = s.x + s.nx * (s.half - 1.6); this.ty[L] = s.y + s.ny * (s.half - 1.6);
    this.rot[L] = Math.atan2(-s.ny, -s.nx);
    const cw = this.map.cellOf(this.tx[L], this.ty[L]);
    this.ladderAt[cw] = L; this.lad[cw] = 1;
    this.lashed.push(L); this._rebuildJumps();
    this.stats.lashedUp = (this.stats.lashedUp || 0) + 1;
    this.fx.dust(f.x, f.y, this.map.groundZ(f.x, f.y), 4); this.fx.sound('ladder', f.x, f.y, 0.8);
    if (this.stats.lashedUp === 1) this._alert(null, 0, 'Ladders lashed · Hornburg', 'bad', f.x, f.y, true);
    else this._alert('lashUp', 25, 'Ladders lashed · Hornburg', 'bad', f.x, f.y);
  },

  /** The middle of the valley side of the ring's feet: where a force sent up the ring by lashed ladders is bound. */
  _ringMid() {
    if (this._ringMidP) return this._ringMidP;
    let sx = 0, sy = 0, n = 0;
    for (const f of this.ringFoot) if (f && !f.deep) { sx += f.x; sy += f.y; n++; }
    return (this._ringMidP = n ? { x: sx / n, y: sy / n } : this.segs[this.map.GATE]);
  },

  /** A foot of the rock on the valley side of the ring for company g to make for (the companies of a force spread over them). */
  _ringAim(g) {
    const list = this._valleyFeet || (this._valleyFeet = this.ringFoot.filter((f) => f && !f.deep));
    return list.length ? list[(g * 7) % list.length] : null;
  },

  /** The path to the foot of the rock below the ring (null if not solved yet). */
  _ringField(c) { const fl = this.fields[F_RING]; fl.want = this.time; return fl.ready && !fl.close[c] ? fl.dir : null; },

  /** Can this stretch of the ring be laddered from the valley floor? */
  _ringOk(k) { const s = this.segs[k]; return !!this.ringFoot[k] && !s.breached; },

  /** A man standing at the foot of a lashed ladder, held up by the rock, starts up it. */
  _footClimb(i, c) {
    const L = this.footAt[c];
    if (L < 0 || !this.alive[L] || this.state[L] !== S_DONE) return false;
    return this._startClimb(i, this.map.cellOf(this.tx[L], this.ty[L]));
  },

  /**
   * Another man has started up lashed ladder L. Long timber lashed in the middle flexes under every man on it: with
   * four or more on it at once there is a chance, with each that steps on, that the lashing gives way.
   */
  _lashedLoad(L) {
    let on = 0;
    for (let i = 0; i < this.n; i++) if (this.alive[i] && this.target2[i] === L && this.state[i] === 6 /* S_CLIMB */) on++;
    if (on >= 4 && this.rand() < 0.08 * (on - 3)) {
      const k = this.aux2[L], x = this.x[L], y = this.y[L];
      this._alert('lashBreak', 20, 'Lashed ladder gave way · Hornburg', 'good', x, y);
      this.fx.dust(x, y, this.map.groundZ(x, y), 4); this.fx.sound('ladder', x, y, 0.8);
      if (k >= 0) { this.segs[k].ladders--; this.aux2[L] = -1; }
      this._unlink(L); this.kill(L, null, true); this.stats.lashBroke = (this.stats.lashBroke || 0) + 1;
      return true;
    }
    return false;
  },

  /** Rebuild the path links of every standing lashed ladder: foot cell to the wall-walk cell at its head. */
  _rebuildJumps() {
    const J = this.jump;
    for (let c = 0; c < J.head.length; c++) J.head[c] = -1; // (64k cells: cheap, and a ladder goes up or comes down rarely)
    this.footAt.fill(-1);
    J.count = 0;
    this.lashed = this.lashed.filter((L) => this.alive[L] && this.state[L] === S_DONE && this.isLashed[L]);
    for (const L of this.lashed) {
      if (J.count >= J.from.length) break;
      const f = this.map.cellOf(this.x[L], this.y[L]), h = this.map.cellOf(this.tx[L], this.ty[L]);
      // the way a man at the foot sets off: straight at the wall, to the nearest of the eight directions
      const a = Math.atan2(this.ty[L] - this.y[L], this.tx[L] - this.x[L]);
      const k = J.count++;
      J.from[k] = f; J.cost[k] = LASHED_COST; J.dir[k] = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
      J.next[k] = J.head[h]; J.head[h] = k;
      this.footAt[f] = L;
    }
    this.navDirty = true;
    for (const fl of this.fields) fl.ver = -1; // (the warlord's objective paths are solved again with the new way in)
  },
};

/** The warlord's path field to the feet of the rock below the ring (see warlord.js `fields`). */
export const F_RING = 7;

/** Hands needed to heave a lashed ladder up (a ladder's crew is six), and how long it takes (a ladder takes 4 s). */
export const LASHED_HANDS = 5, LASHED_RAISE = 14;

/** Seconds between one man starting up a lashed ladder and the next: one at a time, or the lashing works loose. */
export const LASHED_GAP = 2;

/** What the climb adds to a path, over and above the cells walked: a lashed ladder is a slow, exposed way in. */
export const LASHED_COST = 160;
void CELL;
