// The assault director. Mixed into Sim.prototype.
//
// A horde built by scenarios.horde() comes on in waves. Only the first is on the field when
// the battle opens; the rest wait beyond the valley mouth and march on when their time comes.
// Releases are spread over the hours of darkness so that the last and heaviest assault lands
// shortly before dawn. A wave that is cut to pieces quickly earns the garrison a lull, though
// the next wave may step off a little early to keep the pressure on.
//
// Attacker formations placed by hand carry no wave tag and are left alone: they follow their
// own "advance after" delay exactly as before.

import { ORC, UNITS, U } from '../config.js';
import { groupBounds, waveSummary } from '../scenarios.js';
import { G_ROUT } from './morale.js';

const TAIL = 330;        // the final wave steps off this long before dawn (s)
const MARCH = 3.2;       // pace at which a wave's ranks come over the map edge (m/s)
const EDGE = 8;          // where they appear (m from the west edge)
const WARN = 35;         // notice given before a wave steps off (s)
const MIN_GAP = 90;      // least time between two releases (s)
const EARLY = 60;        // how far ahead of schedule a wave may be sent in when the last is spent (s)
const SPENT = 0.25;      // a wave is spent when this fraction of it is still in the fight
const APPROACH = 4.6;    // typical pace up the valley, for contact estimates (m/s)

// wave states
const PENDING = 0, FORMING = 1, ARRIVING = 2, COMMITTED = 3;

export const directorMethods = {
  /** `reserve`: the wave-tagged attacker groups that are not on the field at the start. */
  _initDirector(groups, reserve) {
    this.dir = null;
    if (!reserve.length) return;
    const sum = waveSummary(groups);
    const W = sum.length;
    const dawnEff = this.opt.dawn > 0 ? this.opt.dawn : 1200;
    const span = Math.max(0, dawnEff - TAIL);
    const waves = sum.map((s, k) => ({ ...s, rel: W > 1 ? (k / (W - 1)) * span : 0, relT: 0, state: k === 0 ? COMMITTED : PENDING, groups: [], pend: [], contactT: 0, left: 0 }));
    let reserveN = 0, cmdReserve = 0;
    for (const g of reserve) {
      const d = UNITS[U[g.type]], n = g.count * (1 + (d.carry || 0));
      waves[g.phase].groups.push(g);
      waves[g.phase].left += n;
      reserveN += n;
      if (d.cmd) cmdReserve += g.count;
      this.count[ORC] += n;
      this.stats.startOrc[g.type] = (this.stats.startOrc[g.type] || 0) + g.count;
    }
    // the vanguard starts on the field: estimate when it reaches the defences
    let front = 0;
    for (const g of groups) if (g.team === ORC && g.phase === 0 && g.x > front) front = g.x;
    waves[0].contactT = Math.max(0, (this.map.wallJoin.x - 250 - front) / APPROACH);
    this.dir = { W, waves, cur: 0, reserveN, cmdReserve, lull: false, lullS: 0, contact: false };
  },

  _director() {
    const d = this.dir;
    if (!d || this.routing) return;
    const last = d.waves[d.cur];
    // ranks of the wave now coming on
    if (last.state === ARRIVING) {
      const p = last.pend;
      while (p.length && p[p.length - 1].t <= this.time) this._arrive(last, p.pop().g);
      if (!p.length) last.state = COMMITTED;
    }
    // how much of what is on the field is still fighting
    let routed = 0;
    for (let g = 0; g < this.ng; g++) if (this.gTeam[g] === ORC && this.gState[g] >= G_ROUT) routed += this.gAlive[g];
    const engaged = this.count[ORC] - d.reserveN - routed;
    const spent = last.state === COMMITTED && engaged < SPENT * last.size;
    d.contact = this.orcMaxX > this.defBox[0] - 250;
    const next = d.waves[d.cur + 1];
    d.lull = spent && !!next;
    if (d.lull) d.lullS += 0.5;
    if (!next) return;
    if (next.state === PENDING) {
      const early = spent && this.time >= Math.max(last.relT + MIN_GAP, next.rel - EARLY);
      if (early || this.time >= next.rel - WARN) {
        next.state = FORMING;
        next.relT = early ? this.time + WARN * 0.6 : next.rel;
        this._alert(null, 0, `Horns down the valley — the ${next.name.toLowerCase()} is forming up${next.note ? ': ' + next.note : ''}`, 'warn', 40, 480, true);
      }
    } else if (next.state === FORMING && this.time >= next.relT) {
      next.state = ARRIVING; next.relT = this.time; d.cur++;
      // each rank comes over the edge when it would have marched that far
      next.pend = next.groups.map((g) => ({ g, t: this.time + Math.max(0, -(g.x + (g.hd || 0))) / MARCH })).sort((a, b) => b.t - a.t);
      next.contactT = this.time + Math.max(20, (this.defBox[0] - 240 - EDGE) / APPROACH);
      this._alert(null, 0, `${next.name} sighted at the valley mouth — wave ${next.k + 1} of ${d.W}`, 'bad', 40, 480, true);
    }
  },

  /** Bring one reserve formation onto the field at the valley mouth. */
  _arrive(w, g) {
    const d = this.dir, def = UNITS[U[g.type]], per = 1 + (def.carry || 0);
    const hd = g.hd || groupBounds(g).hd;
    const got = this._spawnGroup(g, EDGE + hd, true);
    // anything that found no room to form up never arrives
    const short = (g.count - got) * per;
    if (short > 0) { this.count[ORC] -= short; this.initial[ORC] -= short; }
    this.count[ORC] -= got * per; // spawn() counted them again
    d.reserveN -= g.count * per; w.left -= g.count * per;
    if (def.cmd) d.cmdReserve -= g.count;
  },

  /** When the horde breaks, whatever was still waiting beyond the valley melts away with it. */
  _dropReserves() {
    const d = this.dir;
    if (!d || d.reserveN <= 0) return;
    this.stats.fled += d.reserveN; this.count[ORC] -= d.reserveN;
    d.reserveN = 0; d.cmdReserve = 0;
    for (const w of d.waves) { w.groups = []; w.pend = []; w.left = 0; if (w.state !== COMMITTED) w.state = COMMITTED; }
  },

  /** Attackers actually on the field. */
  onField() { return this.count[ORC] - (this.dir ? this.dir.reserveN : 0); },

  /**
   * What the HUD needs to know about the assault:
   *   { W, k, name, phase: 'approach'|'engaged'|'lull'|'last', eta, reserve, next: { name, note, in, forming } | null }
   */
  waveInfo() {
    const d = this.dir;
    if (!d) return null;
    const w = d.waves[d.cur], nx = d.waves[d.cur + 1] || null;
    const approaching = this.time < w.contactT && !d.contact;
    const phase = approaching ? 'approach' : d.lull ? 'lull' : !nx && w.state === COMMITTED && !d.contact ? 'last' : 'engaged';
    return {
      W: d.W, k: w.k, name: w.name, phase, eta: Math.max(0, w.contactT - this.time), reserve: d.reserveN, lullS: d.lullS,
      next: nx ? { name: nx.name, note: nx.note, forming: nx.state === FORMING, in: Math.max(0, (nx.state === FORMING ? nx.relT : nx.rel) - this.time) } : null,
    };
  },
};
