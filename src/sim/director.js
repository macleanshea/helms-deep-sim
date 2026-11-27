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

import { WORLD_W, WORLD_H, DEF, ORC, UNITS, U, C } from '../config.js';
import { LAYOUT } from '../layout.js';
import { groupBounds, waveSummary } from '../scenarios.js';
import { G_ROUT } from './morale.js';

const TAIL = 330;        // the final wave steps off this long before dawn (s)
const MARCH = 3.2;       // pace at which a wave's ranks come over the map edge (m/s)
const AP = LAYOUT.approach;
const EDGE = AP.edge;    // where they appear (m from the west edge)
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
    // the last wave steps off well before dawn and the middle ones are brought forward:
    // an assault needs time at the wall, not only time to walk to it
    const span = Math.max(0, dawnEff - Math.max(TAIL, Math.min(520, dawnEff * 0.42)));
    const waves = sum.map((s, k) => ({ ...s, sector: -1, rel: W > 1 ? (k / (W - 1)) ** 1.3 * span : 0, relT: 0, state: k === 0 ? COMMITTED : PENDING, groups: [], pend: [], contactT: 0, left: 0, depth: 0 }));
    let reserveN = 0, cmdReserve = 0;
    for (const g of reserve) {
      const d = UNITS[U[g.type]], n = g.count * this._per(d);
      waves[g.phase].groups.push(g);
      waves[g.phase].depth = Math.max(waves[g.phase].depth, -(g.x - (g.hd || 0)));
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
    this.dir = { W, waves, cur: 0, reserveN, cmdReserve, lull: false, lullS: 0, contact: false, aimY: -1, lossMark: null };
  },

  _director() {
    const d = this.dir;
    if (!d || this.routing) return;
    const last = d.waves[d.cur];
    // ranks of the waves now coming on (more than one can be on the march at once)
    for (let k = 1; k <= d.cur; k++) {
      const w = d.waves[k];
      if (w.state !== ARRIVING) continue;
      const p = w.pend;
      while (p.length && p[p.length - 1].t <= this.time) this._arrive(w, p.pop().g);
      if (!p.length) w.state = COMMITTED;
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
    const allIn = this.wl.allIn; // the final effort: everything still waiting comes on at once
    if (next.state === PENDING) {
      const early = spent && this.time >= Math.max(last.relT + MIN_GAP, next.rel - EARLY);
      if (early || allIn || this.time >= next.rel - WARN) {
        next.state = FORMING;
        next.relT = allIn ? this.time + 3 : early ? this.time + WARN * 0.6 : next.rel;
        // the assaults in the middle of the night are thrown at the stretch of wall that looks weakest
        const plan = this._wlPlan(next.k, next.kind, next.groups.some((g) => g.type === 'ram' && g.count > 0));
        next.sector = plan.main;
        const note = this._wlAdapt(next);
        const where = next.sector >= 0 ? ` — massing against ${this.sectors[next.sector].name}` : '';
        this._alert(null, 0, `Horns down the valley — the ${next.name.toLowerCase()} is forming up${where}${note}`, 'warn', AP.alertX, next.sector >= 0 ? this.sectors[next.sector].y : AP.centre, true);
      }
    } else if (next.state === FORMING && this.time >= next.relT) {
      next.state = ARRIVING; next.relT = this.time; d.cur++;
      d.aimY = next.sector >= 0 ? this.sectors[next.sector].y : -1;
      d.lossMark = this.loss[ORC].slice();
      const groups = this._wlEscorts(next.groups);
      // each rank comes over the edge when it would have marched that far; the warlord also holds the
      // quicker formations back so that the wave reaches the wall together
      let hold = null;
      if (!allIn) hold = this._wlStagger(groups.map((g) => ({ type: g.type, x: EDGE, y: g.y, lane: g.y < AP.split[0] ? 0 : g.y < AP.split[1] ? 1 : 2, esc: g.esc })), this.wl.plans[next.k]);
      next.pend = groups.map((g, k) => ({ g, t: this.time + Math.max(0, -(g.x + (g.hd || 0))) / MARCH + (hold ? hold[k] : 0) })).sort((a, b) => b.t - a.t);
      next.contactT = this.time + Math.max(20, (this.defBox[0] - 240 - EDGE) / APPROACH) + (hold ? hold.slice().sort((a, b) => a - b)[hold.length >> 1] : 0);
      this._alert(null, 0, `${next.name} sighted at the valley mouth — wave ${next.k + 1} of ${d.W}`, 'bad', AP.alertX, AP.centre, true);
    }
  },

  /** Bring one reserve formation onto the field at the valley mouth. */
  _arrive(w, g) {
    const d = this.dir, def = UNITS[U[g.type]], per = this._per(def);
    const got = g.count > 0 ? this._spawnGroup(g, EDGE + groupBounds(g).hd, true) : 0;
    // anything that found no room to form up never arrives
    const short = (g.count - got) * per;
    if (short > 0) { this.count[ORC] -= short; this.initial[ORC] -= short; }
    this.count[ORC] -= got * per; // spawn() counted them again
    d.reserveN -= g.count * per; w.left -= g.count * per;
    if (def.cmd) d.cmdReserve -= g.count;
  },

  /**
   * Which third of the Deeping Wall looks easiest: thinly held, already damaged, where defenders
   * have been falling — and not where the last wave was cut down.
   */
  _weakSector() {
    const d = this.dir, held = [0, 0, 0], dmg = [0, 0, 0], nseg = [0, 0, 0], fell = [0, 0, 0], bled = [0, 0, 0];
    const open = [0, 0, 0];
    for (let k = 0; k < this.segs.length; k++) {
      const sg = this.segs[k];
      if (sg.kind !== 'wall') continue;
      const q = this.segSector(k);
      nseg[q]++; dmg[q] += sg.breached ? 3 : 1 - sg.hp / sg.maxHp;
    }
    {
      // the horde goes by what it has seen: the last head-count it had of each sector's wall, plus how
      // hard that sector has been firing. A stretch it has not yet looked at is taken for average.
      const wl = this.wl;
      let known = 0, sum = 0;
      for (let k = 0; k < 3; k++) if (wl.seen[k] >= 0) { known++; sum += wl.seen[k]; }
      const avg = known ? sum / known : 1, pk = Math.max(1, wl.peak[0], wl.peak[1], wl.peak[2]);
      for (let k = 0; k < 3; k++) {
        held[k] = (wl.seen[k] >= 0 ? wl.seen[k] : avg) + 0.5 * avg * (wl.peak[k] / pk);
        if (wl.seen[k] >= 0 && known > 1 && wl.seen[k] < 0.25 * avg) open[k] = 1.2; // a wall it has looked at and found all but empty is an open door
      }
    }
    const y0 = this.map.wallJoin.y, y1 = this.map.wallTop.y, lo = this.loss, mark = d ? d.lossMark : null;
    const cw = WORLD_W / 16, ch = WORLD_H / 16;
    for (let cy = 0; cy < ch; cy++) {
      const q = Math.max(0, Math.min(2, Math.floor((((cy + 0.5) * 16 - y0) / (y1 - y0)) * 3)));
      for (let cx = (AP.bled[0] / 16) | 0; cx < cw; cx++) {
        const c = cy * cw + cx;
        fell[q] += lo[DEF][c];
        if (cx * 16 < AP.bled[1]) bled[q] += lo[ORC][c] - (mark ? mark[c] : 0);
      }
    }
    const mx = (a) => Math.max(1, a[0], a[1], a[2]);
    const mh = mx(held), mf = mx(fell), mb = mx(bled);
    let best = 0, bs = -1e9;
    for (let k = 0; k < 3; k++) {
      const sc = 1.0 * (1 - held[k] / mh) + 0.8 * (dmg[k] / Math.max(1, nseg[k])) + 0.5 * (fell[k] / mf) - 0.6 * (bled[k] / mb) + 0.15 * this.rand2() + open[k];
      if (sc > bs) { bs = sc; best = k; }
    }
    return best;
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
    const approaching = this.time < w.contactT && (w.k > 0 || !d.contact); // stragglers of the last wave do not count as contact
    const phase = approaching ? 'approach' : d.lull ? 'lull' : !nx && w.state === COMMITTED && !d.contact ? 'last' : 'engaged';
    return {
      W: d.W, k: w.k, name: w.name, phase, eta: Math.max(0, w.contactT - this.time), reserve: d.reserveN, lullS: d.lullS,
      sector: w.sector >= 0 ? this.sectors[w.sector] : null,
      next: nx ? { name: nx.name, note: nx.note, forming: nx.state === FORMING, sector: nx.sector >= 0 ? this.sectors[nx.sector] : null, in: Math.max(0, (nx.state === FORMING ? nx.relT : nx.rel) - this.time) } : null,
    };
  },
};
