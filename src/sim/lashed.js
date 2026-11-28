// Lashed ladders: the horde's way up the Hornburg's ring wall. Mixed into Sim.prototype.
//
// The ring wall stands on the Hornburg's rock: its walk is 21 m up, and between the wall's foot and the valley floor
// lies a band of steep rock 7-14 m wide. No scaling ladder reaches that. Two lashed end to end do, about 24 m of
// timber standing on the valley floor and leaning on the parapet: heavy, slow to raise, flexing under every man on it,
// and easily heaved off. The horde turns to them only when the garrison has given up the Deeping Wall for the
// Hornburg (the warlord's `abandoned`), so that shutting oneself in the keep is not a free win.
//
// A ladder crew sent for the ring (one of the force sent up the valley side of the ring, or at the gate) takes a
// stretch of the ring and calls a second ladder crew to the same foot of the rock; there the two are lashed together
// (the second's timber goes into the first, its carriers back to the fight) and heaved up. Men climb it one at a
// time; with four or more on it the lashing may give way; heaved off, it breaks apart.
//
// This module holds the geometry (where on the valley floor each stretch of the ring can be laddered from, and where on
// its walk a ladder's head lands), the pairing and carrying, and the links that let the horde's path fields lead from a
// ladder's foot to the wall walk it leans on (src/sim/flow.js `jump`). Raising, climbing and throwing down share the
// ladder code in sim.js and engines.js.

import { GW, GH, T, OB } from '../config.js';
import { S_DONE, S_ACT } from './sim.js';

const FOOT_MIN = 6, FOOT_MAX = 20;  // how far out from the wall's center line, beyond its half-thickness, a foot may stand (m)
const FLOOR_Z = 4;                  // the foot stands on the valley floor: ground no higher than this (m)
const MAXJ = 64;                    // most lashed ladders standing at once
const MATE_WAIT = 45;               // seconds a ladder at its foot waits for a mate that is not closing before it looks for another

export const lashedMethods = {
  _initLashed() {
    const NC = GW * GH;
    this.footAt = new Int32Array(NC).fill(-1);  // the lashed ladder standing with its foot in this cell, or -1
    this.jump = { head: new Int32Array(NC).fill(-1), from: new Int32Array(MAXJ), cost: new Int32Array(MAXJ), dir: new Uint8Array(MAXJ), next: new Int32Array(MAXJ), count: 0 };
    this.jumpHeads = [];                         // head cells with links, so a rebuild clears only those
    this.navOrc.jump = this.jump;
    this.lashed = [];                            // standing lashed ladders (unit indices)
    const N = this.alive.length;
    this.isLashed = new Uint8Array(N);           // a ladder that is two lashed together (set when it is raised against the ring)
    this.climbLong = new Uint8Array(N);          // a climber on a lashed ladder (kept if the ladder goes, for the height he falls from)
    this.lashMate = new Int32Array(N).fill(-1);  // the other ladder of a pair to be lashed together
    this.lashGen = new Uint16Array(N);           // ... and its generation, so a slot reused by some other unit is not taken for it
    this.lashT = new Float32Array(N);            // when a ladder last looked for a mate
    this.jumpDirty = false;
    this.footField = [];                         // per stretch of the ring: the path to its own foot (solved when first wanted)
    // where each stretch of the ring can be laddered from: the first stretch of valley floor straight out from it
    this.ringFoot = this.segs.map((s, k) => {
      if (s.group !== 1 || s.kind !== 'ring') return null;
      const head = this._ringHeadAt(k);
      if (!head) return null;
      for (let d = s.half + FOOT_MIN; d <= s.half + FOOT_MAX; d += 0.5) {
        const x = s.x + s.nx * d, y = s.y + s.ny * d, c = this.map.cellOf(x, y), t = this.mtype[c];
        if (t === T.CLIFF || t === T.WALL || t === T.STAIR || t === T.DOOR || this.mseg[c] >= 0 || this.tier[c]) continue;
        if (this.map.groundZ(x, y) > FLOOR_Z) continue;
        // a pace further out, so the whole foot stands clear of the rock
        const fx = x + s.nx * 1.5, fy = y + s.ny * 1.5, fc = this.map.cellOf(fx, fy);
        if (this.mtype[fc] === T.CLIFF) continue;
        // (behind the Deeping Wall, in the Deep: reached only through a breach, or over the wall)
        const J = this.map.wallJoin, Tp = this.map.wallTop, wx = fy >= J.y ? J.x : this.map.wallAt(Math.max(0, Math.min(1, (fy - J.y) / (Tp.y - J.y)))).x;
        return { x: fx, y: fy, c: fc, d: d + 1.5, deep: fx > wx, hx: head.x, hy: head.y };
      }
      return null;
    });
  },

  /**
   * Where on the ring's walk a ladder against stretch k lands its men: a pace inside the parapet, stepped inward until
   * it stands squarely on the walk (the ring is 9 m thick on a 4 m grid, and a point on its center line can fall in a
   * cell of the rock beside it). Null if there is no such point.
   */
  _ringHeadAt(k) {
    const s = this.segs[k];
    const on = (x, y) => { const c = this.map.cellOf(x, y); return this.mseg[c] === k && this.map.seg[c] === k; };
    for (let o = s.half - 1.6; o > -s.half + 0.6; o -= 0.25) {
      const x = s.x + s.nx * o, y = s.y + s.ny * o;
      if (on(x, y) && on(x + 0.6, y) && on(x - 0.6, y) && on(x, y + 0.6) && on(x, y - 0.6)) return { x, y };
    }
    return null;
  },

  /** A unit slot is being given to a new unit: none of a lashed ladder's state may carry over to it. */
  _lashReset(i) { this.isLashed[i] = 0; this.climbLong[i] = 0; this.lashMate[i] = -1; this.lashT[i] = 0; },

  /** Is j still the ladder that i was paired with (alive, a ladder, the same unit and not a later one in its slot)? */
  _mateOk(i, j) { return j >= 0 && this.alive[j] && this.type[j] === this.type[i] && this.gen[j] === this.lashGen[i] && this.lashMate[j] === i; },

  /** Undo a pairing (from i's side, and the other's if it still points back). */
  _unpair(i) {
    const j = this.lashMate[i];
    if (j >= 0 && this.lashMate[j] === i) this.lashMate[j] = -1;
    this.lashMate[i] = -1;
  },

  /**
   * A stretch of the ring for a ladder crew of company g to make for: one with a foot on the valley floor that a ladder
   * can be carried to (not in the Deep while the Deeping Wall stands), not already taken, as near as can be to where
   * its force is bound, so that the companies gathering there escort it, lend it hands and cover it. Some spread, so the
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

  /** Ladder L, bound for a stretch of the ring, looks for a second ladder with hands to carry it, to be lashed to it. */
  _findMate(L) {
    this.lashT[L] = this.time;
    let best = -1, bd = 250 * 250;
    const min = 2; // (hands enough to carry it: a ladder crew's least)
    for (const e of this.engines) {
      if (e === L || this.type[e] !== this.type[L] || !this.alive[e] || this.lashMate[e] >= 0 || this.isLashed[e]) continue;
      const st = this.state[e];
      if (st !== 1 && st !== 5) continue;               // (on the move or waiting: one raised or being raised stays where it is)
      if (this.crewHave[e] < min) continue;             // (one lying with nobody to carry it is no use)
      const k = this.aux2[e];
      // one still bound for the Deeping Wall is taken only if it is a long way from it; one bound for the ring with no
      // mate of its own, and still on its way, gives up its stretch and becomes this one's mate
      if (k >= 0 && (this.segs[k].group === 0 ? Math.hypot(this.segs[k].ox - this.x[e], this.segs[k].oy - this.y[e]) < 100 : Math.hypot(this.ringFoot[k].x - this.x[e], this.ringFoot[k].y - this.y[e]) < 4)) continue;
      let d2 = (this.x[e] - this.x[L]) ** 2 + (this.y[e] - this.y[L]) ** 2;
      if (this.gForce[this.grp[e]] !== this.gForce[this.grp[L]]) d2 *= 2; // (a ladder of its own force first)
      if (d2 < bd) { bd = d2; best = e; }
    }
    if (best < 0) return -1;
    const k = this.aux2[best];
    if (k >= 0) { this.segs[k].claimed--; this.aux2[best] = -1; }
    this.lashMate[best] = L; this.lashGen[best] = this.gen[L];
    this.lashMate[L] = best; this.lashGen[L] = this.gen[best]; this.lashT[best] = this.time;
    return best;
  },

  /**
   * The second ladder of a pair: carried to the foot of the rock where the first is bound, and set down beside it.
   * Returns false if the pair has come apart or the Hornburg's ring is no longer the plan (it then goes about its
   * business as an ordinary ladder).
   */
  _mateStep(i, d, speed) {
    const L = this.lashMate[i];
    if (!this._mateOk(i, L) || this.aux2[L] < 0 || !this.wl.abandoned) { this._unpair(i); return false; }
    const k = this.aux2[L], f = this.ringFoot[k];
    if (!f) { this._unpair(i); return false; }
    const x = this.x[i], y = this.y[i], dx = f.x - x, dy = f.y - y, l = Math.sqrt(dx * dx + dy * dy);
    if (l < 6 || speed <= 0) { this.vx[i] *= 0.4; this.vy[i] *= 0.4; return true; }
    this._carryTo(i, d, k, f, dx, dy, l, speed);
    return true;
  },

  /** Carry ladder i toward the foot f of stretch k: by that foot's own path, the last few meters straight. */
  _carryTo(i, d, k, f, dx, dy, l, speed) {
    let mx = dx / l, my = dy / l;
    if (l > 5) { const fl = this._footPath(k); if (fl && this._flow(this.x[i], this.y[i], fl)) { mx = this.fdx; my = this.fdy; } }
    this._move(i, mx, my, speed, d.sz, 0);
  },

  /**
   * A ladder bound for a stretch of the ring (k): carried to the foot of the rock below it, where it waits for its mate;
   * the two are lashed together there and heaved up (see the S_ACT branch of the ladder case in Sim._orc).
   */
  _ringLadder(i, d, k, speed, crewed) {
    const f = this.ringFoot[k], x = this.x[i], y = this.y[i];
    // the garrison is back on the Deeping Wall: the ring is not the plan any more
    if (!this.wl.abandoned) { this.segs[k].claimed--; this.aux2[i] = -1; this._unpair(i); return; }
    const dx = f.x - x, dy = f.y - y, l = Math.sqrt(dx * dx + dy * dy);
    if (l < 130 && !this.ammo2[i]) { this.ammo2[i] = 1; this._alert('lashIn', 40, 'Ladder crews approaching · Hornburg', 'warn', x, y); }
    let m = this.lashMate[i];
    if (m >= 0 && !this._mateOk(i, m)) { this._unpair(i); m = -1; }
    if (m < 0 && this.time - this.lashT[i] > 5) m = this._findMate(i);
    if (l < 3) {
      this.vx[i] = this.vy[i] = 0;
      const near = m >= 0 && Math.hypot(this.x[m] - f.x, this.y[m] - f.y) <= 8;
      // a mate that is not closing (its carriers cut down on the way) is given up for another
      if (m >= 0 && !near && this.time - this.lashT[i] > MATE_WAIT) { this._unpair(i); this._findMate(i); return; }
      // both ladders at the foot and hands to work them: lash them together and heave the long ladder up
      if (!near || (crewed && (speed <= 0 || this.crewPts[i] < LASHED_HANDS))) return;
      this.fx.dust(this.x[m], this.y[m], this.map.groundZ(this.x[m], this.y[m]), 2);
      this._unpair(i); this.kill(m, null, true); // (its timber is now part of this one; its carriers go back to the fight)
      this.state[i] = S_ACT; this.aux[i] = this.time + LASHED_RAISE; this.rot[i] = Math.atan2(-this.segs[k].ny, -this.segs[k].nx);
      return;
    }
    if (crewed && speed <= 0) { this.vx[i] *= 0.4; this.vy[i] *= 0.4; return; }
    this._carryTo(i, d, k, f, dx, dy, l, speed);
  },

  /** Lashed ladder L is up against stretch k of the ring: it stands on the valley floor and leans on the parapet. */
  _raiseLashed(L, k) {
    const s = this.segs[k], f = this.ringFoot[k];
    this.isLashed[L] = 1;
    this.x[L] = this.px[L] = f.x; this.y[L] = this.py[L] = f.y;
    this.tx[L] = f.hx; this.ty[L] = f.hy;
    this.rot[L] = Math.atan2(-s.ny, -s.nx);
    const cw = this.map.cellOf(this.tx[L], this.ty[L]);
    this.ladderAt[cw] = L; this.lad[cw] = 1;
    this.lashed.push(L); this._rebuildJumps();
    this.stats.lashedUp = (this.stats.lashedUp || 0) + 1;
    this.fx.dust(f.x, f.y, this.map.groundZ(f.x, f.y), 4); this.fx.sound('ladder', f.x, f.y, 0.8);
    if (this.stats.lashedUp === 1) this._alert(null, 0, 'Ladders lashed · Hornburg', 'bad', f.x, f.y, true);
    else this._alert('lashUp', 25, 'Ladders lashed · Hornburg', 'bad', f.x, f.y);
  },

  /** Where a force sent up the ring by lashed ladders is bound: the valley-side foot nearest the middle of them all. */
  _ringMid() {
    if (this._ringMidP) return this._ringMidP;
    let sx = 0, sy = 0, n = 0;
    for (const f of this.ringFoot) if (f && !f.deep) { sx += f.x; sy += f.y; n++; }
    if (!n) return (this._ringMidP = this.segs[this.map.GATE]);
    sx /= n; sy /= n;
    let best = null, bd = 1e12;
    for (const f of this.ringFoot) if (f && !f.deep) { const d2 = (f.x - sx) ** 2 + (f.y - sy) ** 2; if (d2 < bd) { bd = d2; best = f; } }
    return (this._ringMidP = best);
  },

  /** A foot of the rock on the valley side of the ring for company g to make for (the companies of a force spread over them). */
  _ringAim(g) {
    const list = this._valleyFeet || (this._valleyFeet = this.ringFoot.filter((f) => f && !f.deep));
    return list.length ? list[(g * 7) % list.length] : null;
  },

  /**
   * The path to the foot below stretch k, for the ladders carried there (they cannot climb: solved without ladders),
   * solved when first wanted and again when the works change.
   */
  _footPath(k) {
    let ff = this.footField[k];
    if (ff && ff.ver === this.structVersion && this.time - ff.t < 30) return ff.dir;
    if (!ff) ff = this.footField[k] = { dir: new Uint8Array(GW * GH), ver: -1, t: -100 };
    const NC = GW * GH, cost = this.fCost || (this.fCost = new Uint16Array(NC)), mt = this.mtype, ob = this.ob, elev = this.elev;
    for (let c = 0; c < NC; c++) {
      const t = mt[c];
      if (t === T.CLIFF || this.orcBlock[c]) { cost[c] = 0; continue; }
      let v = t === T.GROUND ? 10 : t === T.WATER ? 13 : t === T.STAIR ? 14 : t === T.WALL ? (elev[c] ? 12 : 22) : 10;
      const o = ob[c];
      if (o) v += (o & OB.WIRE ? 70 : 0) + (o & OB.AV ? 6 : 0);
      cost[c] = v;
    }
    this.srcBuf[0] = this.ringFoot[k].c;
    this.solver.solve(cost, this.srcBuf, 1, ff.dir, this.navGround || (this.navGround = { ...this.navOrc, ladder: null, jump: null }));
    ff.ver = this.structVersion; ff.t = this.time;
    return ff.dir;
  },

  /** A man standing at the foot of a lashed ladder, held up by the rock, starts up it. */
  _footClimb(i, c) {
    const L = this.footAt[c];
    if (L < 0 || !this.alive[L] || this.state[L] !== S_DONE || !this.isLashed[L]) return false;
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
    for (const h of this.jumpHeads) J.head[h] = -1;
    for (let k = 0; k < J.count; k++) this.footAt[J.from[k]] = -1;
    this.jumpHeads.length = 0;
    J.count = 0;
    this.lashed = this.lashed.filter((L) => this.alive[L] && this.state[L] === S_DONE && this.isLashed[L]);
    for (const L of this.lashed) {
      if (J.count >= J.from.length) break;
      const f = this.map.cellOf(this.x[L], this.y[L]), h = this.map.cellOf(this.tx[L], this.ty[L]);
      // the way a man at the foot sets off: straight at the wall, to the nearest of the eight directions
      const a = Math.atan2(this.ty[L] - this.y[L], this.tx[L] - this.x[L]);
      const k = J.count++;
      J.from[k] = f; J.cost[k] = LASHED_COST; J.dir[k] = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
      if (J.head[h] < 0) this.jumpHeads.push(h);
      J.next[k] = J.head[h]; J.head[h] = k;
      this.footAt[f] = L;
    }
    this.navDirty = true;
    // the objective paths that can climb are solved again with the new way in (not those for men who cannot climb)
    for (let k = 0; k < this.fields.length; k++) if (k !== F_POSTG) this.fields[k].ver = -1;
  },
};

/** The warlord's path field to the feet of the rock below the ring, and its ground path to the back doors (see warlord.js `fields`). */
export const F_RING = 7, F_POSTG = 6;

/** Hands needed to heave a lashed ladder up (a ladder's crew is six), and how long it takes (a ladder takes 4 s). */
export const LASHED_HANDS = 5, LASHED_RAISE = 14;

/** Seconds between one man starting up a lashed ladder and the next: one at a time, or the lashing works loose. */
export const LASHED_GAP = 2;

/** What the climb adds to a path, over and above the cells walked: a lashed ladder is a slow, exposed way in. */
export const LASHED_COST = 160;
