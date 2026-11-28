// The warlord: the horde's battle plan. Mixed into Sim.prototype.
//
// The director (director.js) decides WHEN each wave comes on. The warlord decides what the
// troops on the field are trying to do. It groups the attacker formations of each wave into
// task forces by lane, gives each an objective (a third of the Deeping Wall, or the gate),
// holds each formation back just long enough that the force reaches the wall together, keeps
// the cavalry in reserve for a breach, swings forces toward a foothold or a sector that has
// fallen silent, pulls a spent force back to regroup, and throws everything in before dawn.
//
// It works without the director too: in a sandbox the whole horde is one wave on the field.
//

import { CELL, GW, GH, DEF, ORC, T, OB, UNITS, U, C } from '../config.js';
import { KEEP } from '../map.js';
import { S_WAIT, S_DONE } from './sim.js';
import { LAYOUT } from '../layout.js';

const HOLD = 1, BACK = 2;        // company orders
const AP = LAYOUT.approach;
const RES_X = AP.reserve;         // where the reserve waits (m from the west edge): beyond every gun but the howitzers
const RALLY_X = AP.rally;         // where a force that has pulled back regroups
const ALLIN = 240;               // the final effort begins this long before dawn (s)
const NATURAL = [2, 1, 0];       // the sector each lane faces: low y is the cliff end
const OBSERVE = 450;             // how far off the horde can count heads on a wall (m)
const F_CULVERT = 3, F_HUNT = 4, F_GATE = 9; // field slots (0-2 are the three sectors); F_GATE is the ram's own field
const F_POST = 5, F_POSTG = 6; // to the back doors: for those who can climb a ladder, and for those who cannot
const F_RING = 7;              // to the feet of the rock below the ring, for ladders to be lashed (lashed.js)
const SEC_RING = 5;            // a force's objective: the valley side of the Hornburg's ring, by lashed ladders
const FORM_OFF = 470;            // the forming-up line lies this far short of the works (m): beyond the machine guns' reach
const FORM_X = LAYOUT.wall.span[0] + 20 - FORM_OFF;
const SHIELD_FAR = 430;          // shields are locked this far out to begin with (m from the works)

/** Seconds for a formation of this type to cover `dist` meters, allowing for the shield wall's pace. */
function travel(type, dist) {
  const d = UNITS[U[type]];
  let v = d.speed || 1;
  if (type === 'uruk' || type === 'ladder') { // the last stretch behind locked shields
    const band = Math.min(dist, 385), vb = Math.min(v, 3.36); // 0.7 of an Uruk's pace
    return (dist - band) / v + band / vb;
  }
  return dist / v;
}

export const warlordMethods = {
  _initWarlord() {
    const NC = GW * GH;
    this.wl = {
      forces: [], byKey: new Map(), plans: [], gdef: [],
      main: -1, mainY: -1, breachSeg: -1,
      allIn: false, resOut: 0, huntT: -100, open: false,
      foot: [0, 0, 0, 0], footN: 0, footSec: -1, swungT: -100,
      near: [0, 0, 0], atFoot: [0, 0, 0], quiet: [0, 0, 0], wallTop: [0, 0, 0], seen: [-1, -1, -1], heat: new Float32Array(4), peak: new Float32Array(4),
      exposed: 0, exCells: [], exAll: [], abandoned: false, emptyT: -1, notedRes: false, shieldNoteT: -100, backNoteT: -100,
      // the forming-up line: where a wave halts, out of reach of small arms, until it is all up; and when each wave stepped off from it
      formX: FORM_X, waveGo: [], waveLineT: [],
      // what has been hurting the horde beyond rifle range (bullets, blast), and how close in it now locks shields
      lossFar: [0, 0], shieldAt: SHIELD_FAR, openNoted: false, wireSeen: [0, 0, 0], backT: -1, ringOn: 0, ringOnN: 0,
    };
    this.catWary = false;
    this.fields = [];
    for (let k = 0; k < 8; k++) this.fields.push({ dir: new Uint8Array(NC).fill(255), close: new Uint8Array(NC), ready: false, t: -100, ver: -1, want: -100, queued: false });
    this.fieldQ = []; this.fCost = null;
  },

  // ------------------------------------------------------------ task forces
  /** A new attacker formation has come onto the field: put it in its lane's force. */
  _wlAdd(gid, g) {
    const wl = this.wl, wave = g.phase || 0;
    const reserve = g.type === 'warg';
    const lane = g.y < AP.split[0] ? 0 : g.y < AP.split[1] ? 1 : 2;
    const key = wave * 8 + (reserve ? 3 : lane);
    wl.gdef[gid] = { type: g.type, x: this.gCx[gid] || g.x, y: g.y, delay: g.delay || 0 };
    let f = wl.byKey.get(key);
    if (!f) {
      f = { id: wl.forces.length, wave, lane, reserve, sector: -1, groups: [], n0: 0, n: 0, cx: 0, cy: 0, far: 1e9, state: 0, t0: this.time, wheel: false, swung: false, chiefT: -1, hadChief: false, chiefs: 0, pend: null };
      if (wl.waveGo[wave] === undefined) { wl.waveGo[wave] = wl.allIn ? this.time : -1; wl.waveLineT[wave] = -1; }
      wl.forces.push(f); wl.byKey.set(key, f);
      if (wl.plans[wave]) this._wlAim(f);
    }
    f.groups.push(gid); this.gForce[gid] = f.id;
    if (g.type === 'chief') f.hadChief = true;
    if (f.sector >= 0) this._wlField(gid, f);
    if (reserve && !wl.allIn && wl.resOut !== 1) { this.gOrder[gid] = HOLD; this.gHoldX[gid] = RES_X; }
  },

  /** Point a force at its objective under its wave's plan. */
  _wlAim(f) {
    const plan = this.wl.plans[f.wave];
    f.sector = f.reserve ? -1 : plan.sec[f.lane];
    for (const gid of f.groups) this._wlField(gid, f);
  },

  _wlField(gid, f) { this.aimDirty = true; this.gField[gid] = f.reserve || f.sector < 0 ? 0 : f.sector < 3 ? f.sector + 1 : f.sector === 4 ? F_POST + 1 : f.sector === SEC_RING ? F_RING + 1 : F_GATE; },

  /**
   * Send a force on the field a new objective. It is not obeyed at once: a horn call and a captain's shouting take a
   * few seconds to turn a force, and one with no captain left hears of it late, by word of mouth.
   */
  _wlSend(f, sector) {
    if (f.sector === sector && !f.pend) return;
    f.pend = { t: this.time + (f.chiefs > 0 ? 6 + this.rand2() * 8 : 45 + this.rand2() * 30), sector };
  },
  /** The objective a force has, or has been sent and not yet taken up. */
  _wlSec(f) { return f.pend ? f.pend.sector : f.sector; },

  /** Where a force is going. */
  _wlObj(f) {
    if (f.sector === 3) { const g = this.segs[this.map.GATE]; return g; }
    if (f.sector === 4) return this._postFoot();
    if (f.sector === SEC_RING) return this._ringMid();
    return this.sectors[f.sector >= 0 ? f.sector : 1];
  },

  /**
   * Decide a wave's plan: which sector is the main effort, and where each lane's force goes.
   * Two of the three forces go in against the main sector; the third makes a supporting attack
   * on its own stretch of wall, or covers the ram if the wave has one. The vanguard probes all three.
   */
  _wlPlan(wave, kind, hasRam) {
    const wl = this.wl;
    const sec = NATURAL.slice();
    let main = -1;
    if (kind !== 'probe') {
      main = this._weakSector();
      const own = 2 - main;
      sec[own === 1 ? (this.rand2() < 0.5 ? 0 : 2) : 1] = main;
      if (hasRam && !this.segs[this.map.GATE].breached && main !== 0) sec[2] = 3;
    }
    if (wl.abandoned) { const ks = this._keepSecs(); sec[0] = ks[0]; sec[1] = ks[1]; sec[2] = ks[2]; main = -1; } // nobody on the wall: everything goes for the keep
    this._wlPosture();
    wl.plans[wave] = { main, sec, kind };
    if (main >= 0) this._wlMain(main);
    return wl.plans[wave];
  },

  /**
   * Objectives by lane when the Deeping Wall has been given up: the two northern forces come round through
   * the Deep to the back doors while the southern one (with the ram) keeps the gate busy; once one door is
   * down, everyone makes for it.
   */
  _keepSecs() {
    const P = this.segs[this.map.POSTERN], G = this.segs[this.map.GATE];
    if (G.breached) return [3, 3, 3];
    if (P.breached) return [4, 4, 4];
    // the northern force over the empty Deeping Wall and through the Deep for the back doors, the middle one up the
    // valley side of the ring with lashed ladders, the southern one (with the ram) at the gate: three ways in at once
    return [4, SEC_RING, 3];
  },

  /** Make `main` the sector the catapults pin and the trolls batter. */
  _wlMain(main) {
    const wl = this.wl;
    wl.main = main; wl.mainY = this.sectors[main].y;
    // the stretch of wall to break: the most battered sound segment of that sector, else its middle
    let best = -1, bs = -1;
    for (let k = 0; k < this.segs.length; k++) {
      const s = this.segs[k];
      if (s.kind !== 'wall' || !s.valid || s.breached || s.culvert || this.segSector(k) !== main) continue;
      const sc = (1 - s.hp / s.maxHp) * 4 + 1 - Math.abs(s.y - wl.mainY) / 80;
      if (sc > bs) { bs = sc; best = k; }
    }
    wl.breachSeg = best;
  },

  /** Where company g's force is bound (a point with x and y), or null. */
  _objOf(g) {
    const f = this.wl.forces[this.gForce[g]];
    return f && f.sector >= 0 ? this._wlObj(f) : null;
  },

  /** The y a ladder crew of company g should make for, or -1 to leave it to the crew. */
  _forceAimY(g) {
    const f = this.wl.forces[this.gForce[g]];
    if (!f || f.sector < 0) return -1;
    return this.sectors[f.sector >= 3 ? 0 : f.sector].y;
  },

  /** The wall segment a troll of company g should batter, or -1. */
  _trollSeg(g) {
    const wl = this.wl, k = wl.breachSeg;
    if (wl.abandoned) return -1; // (nobody on the Deeping Wall: the trolls go with their forces for the Hornburg's doors)
    if (k < 0 || this.segs[k].breached) return -1;
    const f = wl.forces[this.gForce[g]];
    return f && f.sector === wl.main ? k : -1;
  },

  /**
   * A wave about to come on: slow engines that the trolls of their lane cannot move are given hands
   * of their own, a party of Uruk-hai told off from the lane's largest company to come on with them.
   * Returns a new list of formations; the head-count is unchanged.
   */
  _wlEscorts(groups) {
    const lane = (g) => (g.y < AP.split[0] ? 0 : g.y < AP.split[1] ? 1 : 2);
    const out = groups.map((g) => ({ ...g }));
    for (let l = 0; l < 3; l++) {
      let trollPts = 0; // (only the towers are a troll's work: rams and catapults are crewed by Uruk-hai)
      for (const g of out) if (g.type === 'troll' && lane(g) === l) trollPts += g.count * UNITS[U.tower].crew.troll;
      for (const g of out.slice()) {
        if (lane(g) !== l || g.count <= 0 || (g.type !== 'tower' && g.type !== 'ram' && g.type !== 'catapult')) continue;
        const cr = UNITS[U[g.type]].crew;
        let hands = g.count * cr.need;
        if (cr.troll) { const use = Math.min(trollPts, hands); trollPts -= use; hands -= use; }
        if (hands <= 0) continue;
        let big = null;
        for (const q of out) if (q.type === 'uruk' && !q.esc && lane(q) === l && (!big || q.count > big.count)) big = q;
        if (!big || big.count < hands + 30) continue;
        big.count -= hands;
        out.push({ ...big, count: hands, x: g.x - 9, y: g.y, w: Math.max(12, g.w || 0), hd: g.hd, esc: true });
      }
    }
    return out;
  },

  /** The battle opens: plan for the troops on the field and set their step-off times. */
  _wlStart(groups) {
    const wl = this.wl;
    if (!wl.forces.length) return;
    this._morale(true); // company centers
    let kind = 'assault', hasRam = false;
    for (const g of groups) if (g.team === ORC && !(g.phase > 0)) { if (g.kind) kind = g.kind; if (g.type === 'ram') hasRam = true; }
    this._wlPlan(0, kind, hasRam);
    const gids = [];
    for (const f of wl.forces) {
      if (f.wave !== 0) continue;
      this._wlAim(f);
      for (const gid of f.groups) gids.push(gid);
    }
    // (a wave closes up at its forming-up line and steps off together from there: see _wlForm. Formations put down by
    // hand keep their own "advance after" delay.)
    const wait = new Float32Array(this.ng);
    gids.forEach((gid) => { wait[gid] = wl.gdef[gid].delay; if (wait[gid] > 0.5) this.gWaitT[gid] = this.time + wait[gid]; });
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.team[i] !== ORC) continue;
      const w = wait[this.grp[i]];
      if (w > 0.5) { this.state[i] = S_WAIT; this.aux[i] = this.time + w; }
    }
  },

  // ------------------------------------------------------------- the plan in play
  _warlord() {
    const wl = this.wl;
    if (this.result) return;
    this._fieldWatch();
    this._wlSurvey();
    this._wlShields();
    if (this.routing) return;
    // orders on their way arrive
    for (const f of wl.forces) if (f.pend && this.time >= f.pend.t) { f.sector = f.pend.sector; f.pend = null; for (const gid of f.groups) this._wlField(gid, f); }

    // --- strength and position of each force
    for (const f of wl.forces) {
      let n = 0, sx = 0, sy = 0, m = 0, chief = 0;
      for (const gid of f.groups) {
        const a = this.gAlive[gid];
        if (!a) continue;
        n += a;
        if (UNITS[this.gType[gid]].cmd) chief += a;
        if (!this.gExempt[gid]) { sx += this.gCx[gid] * a; sy += this.gCy[gid] * a; m += a; }
      }
      if (n > f.n0) f.n0 = n;
      f.n = n; f.chiefs = chief;
      if (m) { f.cx = sx / m; f.cy = sy / m; }
      if (!f.reserve && f.sector >= 0) { const o = this._wlObj(f); f.far = m ? Math.hypot(o.x - f.cx, o.y - f.cy) : 1e9; }
      if (f.hadChief && !chief && f.chiefT < 0) f.chiefT = this.time;
    }

    // --- crossbows and berserkers keep behind the shields of the leading companies until the wall is close
    {
      for (const f of wl.forces) {
        if (f.reserve) continue;
        let lead = -1e9;
        for (const gid of f.groups) if (this.gType[gid] === U.uruk && this.gAlive[gid] >= 12 && this.gState[gid] < 2 && this.gCx[gid] > lead) lead = this.gCx[gid];
        const cap = lead > -1e8 && f.far > 120 && !wl.allIn ? lead - 6 : 1e9;
        for (const gid of f.groups) { const t = this.gType[gid]; this.gCapX[gid] = t === U.archer || t === U.berserker ? cap : 1e9; }
      }
    }

    // --- the final effort
    const dawn = this.opt.dawn;
    if (!wl.allIn) {
      let line = 0, line0 = 0, res = 0;
      for (const f of wl.forces) { if (f.reserve) res += f.n; else { line += f.n; line0 += f.n0; } }
      const waiting = this.dir ? this.dir.reserveN : 0;
      if ((dawn > 0 && this.time >= dawn - ALLIN) || (!waiting && res > 0 && line0 > 0 && line < 0.25 * line0)) {
        wl.allIn = true;
        for (let g = 0; g < this.ng; g++) if (this.gTeam[g] === ORC) { this.gOrder[g] = 0; if (this.gWaitT[g] > this.time + 3) this.gWaitT[g] = this.time + 3; }
        for (const f of wl.forces) { f.state = 0; if (f.pend) f.pend.t = this.time; }
        for (let w = 0; w < wl.waveGo.length; w++) if (wl.waveGo[w] < 0) wl.waveGo[w] = this.time;
        for (let i = 0; i < this.n; i++) if (this.alive[i] && this.team[i] === ORC && this.state[i] === S_WAIT) this.aux[i] = Math.min(this.aux[i], this.time + (i % 7));
        this._alert(null, 0, 'The whole horde is attacking', 'bad', AP.alertX, AP.centre, true, true);
      }
    }

    this._wlForm();

    // --- the reserve: held for a breach, a fallen gate, or troops caught outside the walls
    if (!wl.allIn) {
      if (wl.open && wl.resOut !== 1) {
        wl.resOut = 1;
        let any = false;
        for (const f of wl.forces) if (f.reserve) for (const gid of f.groups) { this.gOrder[gid] = 0; this.gField[gid] = 0; if (this.gAlive[gid]) any = true; }
        if (any) this._alert(null, 0, 'Warg riders attacking', 'bad', RES_X, AP.centre, true);
      } else if (wl.resOut !== 1) {
        const hunt = wl.exposed >= 6;
        if (hunt) wl.huntT = this.time;
        if (hunt && wl.resOut === 0) {
          wl.resOut = 2;
          let any = false;
          for (const f of wl.forces) if (f.reserve) for (const gid of f.groups) { this.gOrder[gid] = 0; this.gField[gid] = F_HUNT + 1; if (this.gAlive[gid]) any = true; }
          if (any) this._alert('wargHunt', 60, 'Warg riders hunting troops outside the walls', 'bad', wl.exX, wl.exY, true);
        } else if (wl.resOut === 2 && this.time - wl.huntT > 12) {
          wl.resOut = 0;
          for (const f of wl.forces) if (f.reserve) for (const gid of f.groups) { this.gOrder[gid] = HOLD; this.gHoldX[gid] = RES_X; this.gField[gid] = 0; }
        }
        if (!wl.notedRes && this.time > 25) {
          wl.notedRes = true;
          const f = wl.forces.find((q) => q.reserve && q.n > 0);
          if (f) this._alert(null, 0, 'Warg riders waiting for a breach', 'warn', f.cx || RES_X, f.cy || AP.centre);
        }
      }
    }

    // --- a foothold on the wall draws in whoever has not yet closed
    if (wl.footSec >= 0 && this.time - wl.swungT > 90) {
      let any = false;
      for (const f of wl.forces) {
        if (wl.abandoned || f.reserve || f.state || f.swung || this._wlSec(f) === wl.footSec || this._wlSec(f) > 2 || f.far < 200 || f.n < 10) continue;
        this._wlSend(f, wl.footSec); f.swung = true; any = true;
      }
      wl.swungT = this.time;
      if (any) { this._wlMain(wl.footSec); this._alert(null, 0, `Horde reinforcing its foothold · ${this.sectors[wl.footSec].short}`, 'bad', this.sectors[wl.footSec].x, this.sectors[wl.footSec].y, true); }
    }

    // --- pull back a force that is spent before it has closed; send it in again with the next
    if (!wl.allIn) {
      const more = (this.dir && this.dir.reserveN > 0) || wl.forces.some((f) => f.reserve && f.n > 0 && wl.resOut !== 1);
      for (const f of wl.forces) {
        if (f.reserve) continue;
        if (f.state === 0) {
          // (once only: a force that has already fallen back and come on again sees it through)
          if (more && !f.backs && f.n0 >= 40 && f.n >= 8 && f.n < 0.3 * f.n0 && f.far > 280 && f.far < 1e8 && this.time - f.t0 > 30) {
            f.state = BACK; f.backT = this.time; f.backs = 1;
            for (const gid of f.groups) if (!this.gExempt[gid]) { this.gOrder[gid] = BACK; this.gHoldX[gid] = RALLY_X; }
            if (this.time - wl.backNoteT > 150) { wl.backNoteT = this.time; this._alert(null, 0, 'Horde pulling back to regroup', 'good', f.cx, f.cy); }
          }
        } else if (f.state === BACK) {
          // rejoin when fresh troops come up level in the same lane, or after a long enough breather
          let j = null;
          for (const q of wl.forces) if (q !== f && !q.reserve && q.state === 0 && q.wave > f.wave && q.n > 30 && q.cx > RALLY_X - 60) { if (!j || Math.abs(q.cy - f.cy) < Math.abs(j.cy - f.cy)) j = q; }
          if (j || this.time - f.backT > 240) {
            f.state = 0; f.n0 = f.n; f.t0 = this.time;
            if (j) f.sector = j.sector;
            for (const gid of f.groups) { this.gOrder[gid] = 0; this._wlField(gid, f); }
          }
        }
      }
    }

    // --- captains are shared out among the forces: one that has lost its only captain gets another after a
    // pause, and a force with captains to spare lends one to a force with fewer
    {
      const cnt = new Map();
      for (const ci of this.cmds[ORC]) { if (!this.alive[ci]) continue; const q = wl.forces[this.gForce[this.grp[ci]]]; if (q) cnt.set(q.id, (cnt.get(q.id) || 0) + 1); }
      let lo = null, lc = 1e9, hi = null, hc = -1;
      for (const f of wl.forces) {
        if (f.reserve) continue;
        const c = cnt.get(f.id) || 0;
        if (c > hc) { hc = c; hi = f; }
        if (f.n < 30 || f.state) continue;
        if (c === 0 && f.chiefT >= 0 && this.time - f.chiefT < 30) continue; // newly leaderless: nobody steps in at once
        if (c < lc) { lc = c; lo = f; }
      }
      if (lo && hi && lo !== hi && hc - lc >= 2) {
        let best = -1, bd = 1e12;
        for (const ci of this.cmds[ORC]) {
          if (!this.alive[ci] || this.gForce[this.grp[ci]] !== hi.id) continue;
          const d = Math.hypot(this.x[ci] - lo.cx, this.y[ci] - lo.cy);
          if (d < bd) { bd = d; best = ci; }
        }
        if (best >= 0) {
          const gid = this.grp[best];
          hi.groups = hi.groups.filter((h) => h !== gid);
          lo.groups.push(gid); this.gForce[gid] = lo.id; this._wlField(gid, lo);
          if (lc === 0 && lo.chiefT >= 0) this._alert('capOver', 60, 'Uruk captain rallying leaderless companies', 'warn', lo.cx, lo.cy);
          lo.chiefT = -1; lo.hadChief = true;
        }
      }
    }

    this._wlTier2();
  },

  /** One pass over the field: footholds, troops caught in the open, what can be seen of each sector. */
  _wlSurvey() {
    const wl = this.wl, foot = wl.foot, near = wl.near, top = wl.wallTop;
    const atFoot = wl.atFoot;
    foot[0] = foot[1] = foot[2] = foot[3] = 0; near[0] = near[1] = near[2] = 0; top[0] = top[1] = top[2] = 0; atFoot[0] = atFoot[1] = atFoot[2] = 0;
    let ex = 0, exX = 0, exY = 0, allDef = 0, inKeep = 0;
    const exCells = wl.exCells, exAll = wl.exAll; exCells.length = 0; exAll.length = 0;
    const S = this.sectors, obs2 = OBSERVE * OBSERVE, kr2 = (KEEP.r + 14) * (KEEP.r + 14);
    for (let i = 0, n = this.n; i < n; i++) {
      if (!this.alive[i]) continue;
      const x = this.x[i], y = this.y[i];
      if (this.team[i] === ORC) {
        if (this.el[i]) { const s = this.mseg[((y / CELL) | 0) * GW + ((x / CELL) | 0)]; if (s >= 0 && this.state[i] !== S_DONE) foot[this.segSector(s)]++; continue; }
        if (x < AP.far) continue;
        // (at the foot: within 80 m of that sector's wall, where its rifles would be firing if they could)
        for (let k = 0; k < 3; k++) { const dx = S[k].x - x, dy = S[k].y - y, d2 = dx * dx + dy * dy; if (d2 < obs2) { near[k]++; if (dx < 80 && dy < 64 && dy > -64) atFoot[k]++; } }
      } else {
        const d = UNITS[this.type[i]];
        if (d.cls === C.CACHE) continue;
        if (d.cls === C.INF) { allDef++; const kx = x - KEEP.cx, ky = y - KEEP.cy; if (kx * kx + ky * ky < kr2) inKeep++; }
        if (this.el[i]) { if (d.cls === C.INF) { const k = this.sectorAt(x, y); if (k < 3) top[k] += 1; } continue; }
        // on the ground west of the wall and outside the Hornburg: in the open. Anything there is made for;
        // infantry there is also what the warg riders are loosed at.
        if (x < AP.front) {
          const dx = x - KEEP.cx, dy = y - KEEP.cy;
          if (dx * dx + dy * dy > kr2) {
            const c = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
            if (exAll.length < 96) exAll.push(c);
            if (d.cls === C.INF) { ex++; exX += x; exY += y; if (exCells.length < 64) exCells.push(c); }
          }
        }
      }
    }
    wl.exposed = ex; if (ex) { wl.exX = exX / ex; wl.exY = exY / ex; }
    // the forming-up line keeps its distance from troops seen standing out in front of the works, too
    { let fx = FORM_X; for (const c of exAll) { const q = (c % GW) * CELL - FORM_OFF; if (q < fx) fx = q; } wl.formX = fx; }
    // wire the horde has come close enough to see, by the sector it lies in front of
    if (this.tick % 50 === 6) {
      const cnt = [0, 0, 0];
      for (const p of this.props) if (p.alive && p.kind === 'wire') cnt[Math.min(2, this.sectorAt(AP.abreast, p.y))]++;
      for (let k = 0; k < 3; k++) if (near[k] >= 5) wl.wireSeen[k] = cnt[k];
    }
    // The Deeping Wall given up: next to nobody on it and most of the garrison shut in the Hornburg, for ten
    // seconds running. Then there is nothing to be had by scaling an empty wall, and the host turns on the keep.
    const empty = allDef > 0 && top[0] + top[1] + top[2] < 0.1 * allDef && inKeep > 0.6 * allDef;
    if (!empty) wl.emptyT = -1; else if (wl.emptyT < 0) wl.emptyT = this.time;
    // ... and, once given up, taken back only when a quarter of the garrison's infantry has stood on it for 30 s: a token
    // party sent back onto the wall does not call off the assault on the Hornburg
    let gone;
    if (!wl.abandoned) gone = empty && this.time - wl.emptyT >= 10;
    else {
      const back = allDef > 0 && top[0] + top[1] + top[2] > 0.25 * allDef;
      if (!back) wl.backT = -1; else if (wl.backT < 0) wl.backT = this.time;
      gone = !(back && this.time - wl.backT >= 30);
    }
    if (gone !== wl.abandoned) {
      wl.abandoned = gone;
      if (gone) {
        // ladder crews still a long way from the Deeping Wall turn for the Hornburg: they will lash their ladders in pairs
        for (const e of this.engines) {
          if (this.type[e] !== U.ladder || !this.alive[e] || (this.state[e] !== 1 && this.state[e] !== 5)) continue;
          const k = this.aux2[e];
          if (k >= 0 && this.segs[k].group === 0 && Math.hypot(this.segs[k].ox - this.x[e], this.segs[k].oy - this.y[e]) > 100) { this.segs[k].claimed--; this.aux2[e] = -1; }
        }
        let any = false;
        const ks = this._keepSecs();
        for (const f of wl.forces) { if (f.reserve || f.sector < 0 || this._wlSec(f) >= 3) continue; this._wlSend(f, ks[f.lane]); any = true; }
        const round = ks[0] === 4, at = round ? this._postFoot() : { x: this.segs[this.map.GATE].ox, y: this.segs[this.map.GATE].oy };
        if (any && !this.segs[this.map.GATE].breached) this._alert(null, 0, round ? 'Horde heading for the postern' : 'Horde turning on the Hornburg', 'bad', at.x, at.y, true);
      } else {
        // men back on the wall: those coming round for the postern turn on the wall in front of them again
        for (const f of wl.forces) { const q = this._wlSec(f); if (q !== 4 && q !== SEC_RING) continue; this._wlSend(f, NATURAL[f.lane]); }
      }
    }
    // what the horde has seen of each sector's wall: a head-count whenever enough of it is close enough to look
    for (let k = 0; k < 3; k++) if (near[k] >= 5) wl.seen[k] = top[k];
    // a foothold: a dozen on the wall walk of one sector, two looks running
    let fs = -1, fn = 11;
    for (let k = 0; k < 3; k++) if (foot[k] > fn) { fn = foot[k]; fs = k; }
    if (fs >= 0 && wl.footN > 11) { wl.footSec = fs; if (this.stats.footholdT < 0) this.stats.footholdT = this.time; } else if (fs < 0) wl.footSec = -1;
    // a lodgement on the Hornburg's ring walk (off lashed ladders, or through a door): half a dozen, two looks running
    if (foot[3] >= 6 && wl.ringOn >= 6) { if (!wl.ringOnN++) { this.stats.ringLodged++; this._alert('ringOn', 30, 'Attackers on the wall · Hornburg', 'bad', KEEP.cx, KEEP.cy, this.stats.ringLodged === 1); } }
    else if (foot[3] < 3) wl.ringOnN = 0;
    wl.ringOn = foot[3];
    wl.footN = fs >= 0 ? fn : 0;
    // a way in: any breach in the Deeping Wall, or the gate or postern down
    if (!wl.open) for (const s of this.segs) if (s.breached && (s.kind === 'wall' || s.kind === 'gate' || s.kind === 'postern' || s.kind === 'door')) { wl.open = true; break; }
    // the garrison's fire by sector, for the horde's ears
    const heat = wl.heat, peak = wl.peak;
    for (let k = 0; k < 4; k++) { heat[k] *= 0.9; peak[k] = Math.max(peak[k] * 0.997, heat[k]); }
  },

  /**
   * Posture of the companies on foot. Beyond the reach of the garrison's small arms they come on fast
   * in open order, which is the best answer to shellfire. Once the machine guns can reach them the
   * Uruk-hai close up and lock shields, and stay locked until they reach the wall.
   */
  _wlShields() {
    const wl = this.wl, uruk = U.uruk;
    for (let g = 0; g < this.ng; g++) {
      if (this.gTeam[g] !== ORC || this.gExempt[g] || !this.gAlive[g]) { this.gShield[g] = 0; this.gOpen[g] = 0; continue; }
      const d = this._fortDist(this.gCx[g], this.gCy[g]), outside = this.gCx[g] < this.map.wallJoin.x + 12;
      // (inside the reach of small arms: of the walls, or of troops it can see standing in the open)
      const seen = this.time - this.gSeenT[g] < 2 ? this.gSeenD[g] : 1e9;
      const at = wl.shieldAt;
      let on = this.gType[g] === uruk && outside && this.gState[g] < 2 && this.gOrder[g] !== BACK && ((d > 45 && d < at) || (seen > 30 && seen < at - 30));
      this.gOpen[g] = outside && d >= at && seen >= at - 30 ? 1 : 0;
      if (on && (this.ob[((this.gCy[g] / CELL) | 0) * GW + ((this.gCx[g] / CELL) | 0)] & OB.WIRE)) on = false;
      if (on && !this.gShield[g]) {
        this.gShield[g] = 1;
        if (this.time - wl.shieldNoteT > 90 && this.gAlive[g] >= 20) { wl.shieldNoteT = this.time; this._alert(null, 0, `Shield wall forming · ${this.sectors[Math.min(2, this.sectorAt(AP.abreast, this.gCy[g]))].short}`, 'warn', this.gCx[g], this.gCy[g]); }
      } else if (!on && this.gShield[g]) { this.gShield[g] = 0; this.gShieldT[g] = this.time + 2; }
    }
  },

  /** Second-tier cleverness: confirm the target late, and surge at a sector that has gone quiet. */
  _wlTier2() {
    const wl = this.wl;
    // late wheel: the main effort looks again once it can count heads on the wall
    for (const f of wl.forces) {
      if (f.reserve || f.state || f.wheel || f.sector < 0 || f.sector > 2 || f.far > 470 || f.far < 330) continue;
      const plan = wl.plans[f.wave];
      for (const q of wl.forces) if (q.wave === f.wave) q.wheel = true;
      if (!plan || plan.main < 0 || f.sector !== plan.main) continue;
      const ws = this._weakSector();
      if (ws === plan.main) continue;
      const old = plan.main;
      plan.main = ws;
      for (const q of wl.forces) if (q.wave === f.wave && !q.reserve && q.sector === old && !q.swung) this._wlSend(q, ws);
      this._wlMain(ws);
      this._alert(null, 0, `Horde shifting · ${this.sectors[ws].short}`, 'bad', f.cx, f.cy, true);
    }
    // exploit silence: a sector the horde is close to, whose fire has died away, has run dry
    if (this.time - wl.swungT > 90) {
      for (let k = 0; k < 3; k++) {
        // (troops at the foot of that wall, and next to nothing coming down at them, two looks running)
        if (wl.atFoot[k] < 25 || wl.peak[k] < 40 || wl.heat[k] > 0.08 * wl.peak[k] || k === wl.footSec) { wl.quiet[k] = 0; continue; }
        if (++wl.quiet[k] < 7) continue;
        let any = false;
        for (const f of wl.forces) {
          if (f.reserve || f.state || this._wlSec(f) === k || this._wlSec(f) > 2 || f.far < 120 || f.n < 10) continue;
          this._wlSend(f, k); any = true;
        }
        wl.swungT = this.time; wl.peak[k] *= 0.5;
        if (any) { this._wlMain(k); this._alert(null, 0, `Horde surging · ${this.sectors[k].short}`, 'bad', this.sectors[k].x, this.sectors[k].y, true); }
        break;
      }
    }
  },

  /**
   * Adaptive next wave: change the formations still waiting toward what has worked.
   * Returns a few words for the forming-up alert, or ''.
   */
  _wlAdapt(w) {
    if (!this.dir) return '';
    const st = this.stats, d = this.dir;
    let note = '';
    // towers that never reach the wall are sent as ladders and the company they would have carried
    const tw = w.groups.filter((g) => g.type === 'tower' && g.count > 0);
    if (tw.length && (st.lostOrc.tower || 0) >= 2 && !st.towersUp) {
      const tp = this._per(UNITS[U.tower]), lp = this._per(UNITS[U.ladder]);
      for (const g of tw) {
        const c = g.count, k = w.groups.indexOf(g);
        st.startOrc.tower -= c; st.startOrc.ladder = (st.startOrc.ladder || 0) + c * 5; st.startOrc.uruk = (st.startOrc.uruk || 0) + c * (tp - 5 * lp);
        w.groups.splice(k, 1, { ...g, type: 'ladder', count: c * 5, w: 60 }, { ...g, type: 'uruk', count: c * (tp - 5 * lp), x: g.x - 14, w: 60 });
      }
      note = ' · no towers';
    }
    // once there is a way in, the cavalry of every later wave comes up with this one
    if (this.wl.open) {
      let moved = 0;
      for (let k = w.k + 1; k < d.waves.length; k++) {
        const q = d.waves[k], keep = [];
        for (const g of q.groups) {
          if (g.type !== 'warg') { keep.push(g); continue; }
          w.groups.push({ ...g, phase: w.k }); moved += g.count; q.left -= g.count; w.left += g.count;
        }
        q.groups = keep;
      }
      if (moved) note += ' · with warg riders';
    }
    return note;
  },

  /**
   * How far out to lock shields, from what has been hurting the horde beyond rifle range. Locked shields stop
   * bullets but pack men together under shellfire: where shells have done most of it, the next wave comes on in
   * open order, fast, and locks shields only when it is close.
   */
  _wlPosture() {
    const wl = this.wl, bu = wl.lossFar[0], he = wl.lossFar[1];
    if (bu + he >= 60) {
      const share = he / (bu + he), at = share > 0.6 ? 200 : share > 0.42 ? 310 : SHIELD_FAR;
      if (at < wl.shieldAt && !wl.openNoted) { wl.openNoted = true; this._alert(null, 0, 'Horde spreading out under shellfire', 'warn', AP.mid, AP.centre); }
      wl.shieldAt = at;
      wl.lossFar[0] *= 0.4; wl.lossFar[1] *= 0.4;
    }
  },

  /**
   * Forming up. A wave does not walk into the garrison's fire a company at a time: it halts at the forming-up
   * line, out of the machine guns' reach, until most of it is up (and its towers and rams, which do not halt,
   * are far enough ahead to reach the wall with it), and steps off together.
   */
  _wlForm() {
    const wl = this.wl;
    for (let w = 0; w < wl.waveGo.length; w++) {
      if (wl.waveGo[w] === undefined || wl.waveGo[w] >= 0) continue;
      let all = 0, at = 0, slow = 0, any = false;
      const run = Math.max(60, this.map.wallJoin.x - 30 - wl.formX), body = run / 3.7; // seconds for the body to go in from the line
      for (const f of wl.forces) {
        if (f.wave !== w || f.reserve) continue;
        for (const g of f.groups) {
          const a = this.gAlive[g];
          if (!a) continue;
          any = true;
          const t = this.gType[g];
          if (this.gForm[g] && a >= 6 && this.gState[g] < 2) { all++; if (this.gAx[g] >= wl.formX - 6) at++; }
          else if ((t === U.tower || t === U.ram) && this.gCx[g] < wl.formX + run) {
            const sp = UNITS[t].speed, left = run - (this.gCx[g] - wl.formX);
            if (left / sp > slow) slow = left / sp;
          }
        }
      }
      if (!any) continue;
      if (at > 0 && wl.waveLineT[w] < 0) wl.waveLineT[w] = this.time;
      const since = wl.waveLineT[w] < 0 ? 0 : this.time - wl.waveLineT[w];
      // (a wave waits for its stragglers a minute at most, and for slow engines under a minute: they come up behind it)
      const up = !all || at >= 0.8 * all || since > 50;
      const engines = slow <= body + 8 || since > 45;
      if (up && engines) {
        wl.waveGo[w] = this.time;
        const plan = wl.plans[w], k = plan && plan.main >= 0 ? plan.main : -1;
        if (all >= 3) this._alert(null, 0, k >= 0 ? `Horde advancing · ${this.sectors[k].short}` : 'Horde advancing', 'warn', wl.formX, k >= 0 ? this.sectors[k].y : AP.centre);
      }
    }
  },

  /** Is company g's wave still closing up at the forming-up line? */
  _forming(g) { const t = this.wl.waveGo[this.gWave[g]]; return t !== undefined && t < 0; },

  // ---------------------------------------------------------------- captains
  /**
   * A captain stays behind the leading companies of his force, clear of the other captains,
   * and comes forward as they do. Returns false when an enemy is on him and he must fight.
   */
  _captain(i, d, g, x, y, speed) {
    if (((this.tick + i) & 3) === 0) { const b = this.defBox; this.target[i] = x > b[0] - 20 && x < b[2] + 20 && y > b[1] - 20 && y < b[3] + 20 ? this._nearDef(i, x, y, 0) : -1; }
    const t = this.target[i];
    if (t >= 0 && this.alive[t] && this.team[t] === DEF && !this.el[t]) { const dx = this.x[t] - x, dy = this.y[t] - y; if (dx * dx + dy * dy < 100) return false; }
    if ((this.tick + i) % 10 === 0 || this.tx[i] === 0) {
      // the leading half of his companies
      const f = this.wl.forces[this.gForce[g]];
      let n = 0, sx = 0, sy = 0, lead = -1e9, tot = 0;
      const scan = (h) => {
        const a = this.gAlive[h];
        if (a < 5 || this.gExempt[h] || this.gState[h] >= 2 || this.gTeam[h] !== ORC) return;
        tot += a;
        if (this.gCx[h] > lead) lead = this.gCx[h];
      };
      const use = (h) => {
        const a = this.gAlive[h];
        if (a < 5 || this.gExempt[h] || this.gState[h] >= 2 || this.gTeam[h] !== ORC) return;
        if (this.gCx[h] < lead - 90) return;
        n += a; sx += this.gCx[h] * a; sy += this.gCy[h] * a;
      };
      if (f) { for (const h of f.groups) scan(h); for (const h of f.groups) use(h); }
      else {
        for (let h = 0; h < this.ng; h++) { const dx = this.gCx[h] - x, dy = this.gCy[h] - y; if (dx * dx + dy * dy < 62500) scan(h); }
        for (let h = 0; h < this.ng; h++) { const dx = this.gCx[h] - x, dy = this.gCy[h] - y; if (dx * dx + dy * dy < 62500) use(h); }
      }
      let tx = x, ty = y;
      if (n) { tx = sx / n - 80; ty = sy / n; }
      // the captains of one force space themselves along its front, forty meters or more apart
      let rank = 0, mates = 1;
      for (const ci of this.cmds[ORC]) {
        if (ci === i || !this.alive[ci]) continue;
        if (f ? this.gForce[this.grp[ci]] !== f.id : Math.abs(this.x[ci] - x) + Math.abs(this.y[ci] - y) > 200) continue;
        mates++; if (ci < i) rank++;
      }
      if (mates > 1) ty += (rank - (mates - 1) / 2) * 44;
      this.tx[i] = tx; this.ty[i] = Math.max(AP.captainY[0], Math.min(AP.captainY[1], ty));
    }
    const dx = this.tx[i] - x, dy = this.ty[i] - y, l = Math.sqrt(dx * dx + dy * dy);
    if (l < 6) { this.vx[i] *= 0.5; this.vy[i] *= 0.5; return true; }
    if (dx > 10 && this._flow(x, y, this.gField[g] ? this._fieldFor(g, ((y / CELL) | 0) * GW + ((x / CELL) | 0)) : this.orcDir)) {
      // going forward: follow the path his companies took, leaning toward his place
      const mx = this.fdx * 0.5 + (dx / l) * 0.5, my = this.fdy * 0.5 + (dy / l) * 0.5, ml = Math.sqrt(mx * mx + my * my) || 1;
      this._move(i, mx / ml, my / ml, l > 30 ? speed * 1.2 : speed, d.sz, 0, 1); // he hurries when he has fallen behind
    } else this._move(i, dx / l, dy / l, Math.min(speed, l * 2), d.sz, 0, 1);
    return true;
  },

  // ---------------------------------------------------------- objective paths
  /** The path field of company g, or the horde's own once it is close to the works. */
  _fieldFor(g, c, heavy = false) {
    const k = this.gField[g];
    if (k === F_GATE) {
      const gs = this.segs[this.map.GATE];
      if (gs.breached || this.gateDir[c] === 255) return this.orcDir;
      const dx = (c % GW) * CELL + 2 - gs.ox, dy = ((c / GW) | 0) * CELL + 2 - gs.oy;
      // within 180 m the fight itself leads: the ram's own path does not suit men on foot round the causeway. But with the
      // garrison shut in the Hornburg the fight leads away from the gate (to whoever is left on the walls), and the
      // force sent for it would hang back: it keeps to the gate's path until 40 m out
      return dx * dx + dy * dy < (this.wl.abandoned ? 1600 : 32400) ? this.orcDir : this.gateDir;
    }
    if (k === F_POST + 1) return this._posternField(c, heavy) || this.orcDir;
    const fl = this.fields[k - 1];
    fl.want = this.time;
    return fl.ready && !fl.close[c] ? fl.dir : this.orcDir;
  },

  /** Where the ramp up from the Deep meets the postern (straight out from the door is the rock face: the ramp comes in at an angle). */
  _postFoot() { return this.map.rear[2]; },

  /** Is company g coming round through the Deep to the postern? */
  _viaDeep(g) { return this.gField[g] === F_POST + 1; },

  /** The path to the postern (null once it is down, close by, or not yet solved). `ground`: for those who cannot climb a ladder. */
  _posternField(c, ground = true) {
    if (this.segs[this.map.POSTERN].breached || (this.segs[this.map.DOOR].breached)) return null; // a back door is open: the fight leads in
    const fl = this.fields[ground ? F_POSTG : F_POST];
    fl.want = this.time;
    return fl.ready && !fl.close[c] ? fl.dir : null;
  },

  /** The path field to a sector's wall (null when close, or not yet solved). */
  _sectorField(sec, c) {
    if (sec > 2) return null;
    const fl = this.fields[sec];
    fl.want = this.time;
    return fl.ready && !fl.close[c] ? fl.dir : null;
  },

  _culvertField() { const fl = this.fields[F_CULVERT]; fl.want = this.time; return fl.ready ? fl.dir : null; },

  /** Queue the fields somebody is using that are stale: after a breach, or as wire is trampled. */
  _fieldWatch() {
    for (let k = 0; k < this.fields.length; k++) {
      const fl = this.fields[k];
      if (fl.queued || this.time - fl.want > 6) continue;
      const hunt = k === F_HUNT;
      if (!fl.ready || fl.ver !== this.structVersion || this.time - fl.t > (hunt ? 4 : 15)) { fl.queued = true; this.fieldQ.push(k); }
    }
  },

  /** Solve one queued field. */
  _fieldSolve() {
    const k = this.fieldQ.shift(), fl = this.fields[k];
    fl.queued = false;
    const NC = GW * GH, cost = this.fCost || (this.fCost = new Uint16Array(NC)), mt = this.mtype, ob = this.ob, elev = this.elev;
    for (let c = 0; c < NC; c++) {
      const t = mt[c];
      if (t === T.CLIFF || this.orcBlock[c]) { cost[c] = this.orcBlock[c] && t === T.DOOR ? 310 : 0; continue; } // (as in _nav)
      let v = t === T.GROUND ? 10 : t === T.WATER ? 13 : t === T.STAIR ? 14 : t === T.WALL ? (elev[c] ? 12 : 22) : 10;
      const o = ob[c];
      if (o) v += (o & OB.WIRE ? 70 : 0) + (o & OB.AV ? 6 : 0);
      cost[c] = v;
    }
    const src = this.srcBuf;
    let ns = 0;
    if (k < 3) {
      for (let q = 0; q < this.segs.length; q++) {
        const s = this.segs[q];
        if (s.kind !== 'wall' || !s.valid || this.segSector(q) !== k) continue;
        src[ns++] = s.breached ? this.map.cellOf(s.x, s.y) : this.map.cellOf(s.ox, s.oy);
      }
      // whatever the garrison has standing in front of that stretch of wall is made for as well
      const sy = this.sectors[k].y;
      for (const c of this.wl.exAll) { const y = ((c / GW) | 0) * CELL; if (y > sy - 110 && y < sy + 110 && ns < src.length) src[ns++] = c; }
    } else if (k === F_CULVERT) {
      const s = this.segs[this.map.CULVERT];
      src[ns++] = s.breached ? this.map.cellOf(s.x, s.y) : this.map.cellOf(s.ox, s.oy);
    } else if (k === F_POST || k === F_POSTG) {
      const q = this._postFoot();
      src[ns++] = this.map.cellOf(q.x, q.y);
      // for those on the wall, the door from its walk into the court is the other back door
      const ds = this.segs[this.map.DOOR];
      if (k === F_POST && !ds.breached) src[ns++] = this.map.cellOf(ds.x, ds.y);
      // and for those who can climb, every lashed ladder standing against the ring is a way in as good as a door
      if (k === F_POST) for (const L of this.lashed) if (this.alive[L] && ns < src.length) src[ns++] = this.map.cellOf(this.tx[L], this.ty[L]);
    } else if (k === F_RING) {
      // for the force sent up the ring: the heads of the lashed ladders standing against it, by their links from the
      // foot; while none stands, the feet of the rock below it (those in the Deep only once the Deeping Wall has been
      // breached: a ladder cannot be carried over it), where the ladders are being carried
      if (this.lashed.length) { for (const L of this.lashed) if (this.alive[L] && ns < src.length) src[ns++] = this.map.cellOf(this.tx[L], this.ty[L]); }
      else {
        for (let q = 0; q < this.ringFoot.length; q++) { const f = this.ringFoot[q]; if (f && (!f.deep || this.wl.open) && this.segs[q].claimed + this.segs[q].ladders > 0 && ns < src.length) src[ns++] = f.c; }
        if (!ns) for (const f of this.ringFoot) if (f && (!f.deep || this.wl.open) && ns < src.length) src[ns++] = f.c;
      }
    } else for (const c of this.wl.exCells) src[ns++] = c;
    let ok = 0;
    for (let q = 0; q < ns; q++) if (cost[src[q]]) src[ok++] = src[q];
    if (!ok) { fl.ready = false; fl.t = this.time; return; }
    // (the ground path to the postern knows no ladders: it goes through a breach, the culvert first of all)
    const ground = k === F_POSTG || (k === F_RING && !this.lashed.length);
    this.solver.solve(cost, src, ok, fl.dir, ground ? (this.navGround || (this.navGround = { ...this.navOrc, ladder: null, jump: null })) : this.navOrc);
    // close to the postern the fight itself leads, straight in at the door
    const dist = this.solver.dist, close = fl.close, lim = k === F_HUNT ? 0 : k >= F_POST ? 40 : 150;
    for (let c = 0; c < NC; c++) close[c] = dist[c] < lim ? 1 : 0;
    fl.ready = true; fl.t = this.time; fl.ver = this.structVersion;
  },
};
