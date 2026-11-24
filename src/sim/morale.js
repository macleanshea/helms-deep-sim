// Companies, commanders and morale. Mixed into Sim.prototype.
//
// Every formation placed in setup is a "group". A group remembers its recent losses
// (decaying with a 12 s half-life); the heavier those are against the men still standing,
// the faster its morale drains. Commanders within reach steady it. A group whose morale
// collapses breaks: attackers run for the valley mouth and may rally later, defenders
// abandon their post for the Hornburg. Killing a commander shocks and confuses every
// company around him.

import { DEF, ORC, UNITS, C } from '../config.js';
import { KEEP } from '../map.js';

const MAXG = 4096;
export const G_OK = 0, G_SHAKEN = 1, G_ROUT = 2, G_GONE = 3;
const HALF_LIFE = 0.5 ** (0.5 / 12); // per 0.5 s update
const SUP_FADE = 0.5 ** (0.5 / 4);   // suppression halves every 4 s

export const moraleMethods = {
  _initMorale() {
    this.ng = 0;
    this.gTeam = new Uint8Array(MAXG); this.gExempt = new Uint8Array(MAXG); this.gState = new Uint8Array(MAXG); this.gBreaks = new Uint8Array(MAXG); this.gInsp = new Uint8Array(MAXG);
    this.gAlive = new Int32Array(MAXG); this.gN0 = new Int32Array(MAXG);
    this.gRecent = new Float32Array(MAXG); this.gMorale = new Float32Array(MAXG).fill(100); this.gConf = new Float32Array(MAXG); this.gRoutT = new Float32Array(MAXG);
    this.gCx = new Float32Array(MAXG); this.gCy = new Float32Array(MAXG);
    // suppression: fire landing on a company builds up, fades in a few seconds, and pins it down
    this.gSup = new Float32Array(MAXG); this.gPin = new Uint8Array(MAXG); this.gFearless = new Uint8Array(MAXG);
    this._gsx = new Float64Array(MAXG); this._gsy = new Float64Array(MAXG); this._gn = new Int32Array(MAXG);
    this.hadCmd = [false, false];
    this._moraleLogT = [0, 0];
  },

  /** Register a new company. Exempt groups (vehicles, siege engines, lone specialists) never break. */
  newGroup(team, exempt) {
    const g = this.ng < MAXG - 1 ? this.ng++ : MAXG - 1;
    this.gTeam[g] = team; this.gExempt[g] = exempt ? 1 : 0; this.gState[g] = G_OK; this.gMorale[g] = 100;
    this.gSup[g] = 0; this.gPin[g] = 0; this.gFearless[g] = 0;
    return g;
  },

  _startMorale() {
    this._buildAux();
    this.hadCmd = [this.cmds[0].length > 0, this.cmds[1].length > 0 || !!(this.dir && this.dir.cmdReserve)];
    this._morale(true);
  },

  _morale(init) {
    const ng = this.ng, sx = this._gsx, sy = this._gsy, gn = this._gn;
    sx.fill(0, 0, ng); sy.fill(0, 0, ng); gn.fill(0, 0, ng);
    for (let i = 0, n = this.n; i < n; i++) { if (!this.alive[i]) continue; const g = this.grp[i]; sx[g] += this.x[i]; sy[g] += this.y[i]; gn[g]++; }
    const on = this.opt.morale !== false;
    for (let g = 0; g < ng; g++) {
      const cnt = gn[g];
      if (!cnt) continue;
      const cx = (this.gCx[g] = sx[g] / cnt), cy = (this.gCy[g] = sy[g] / cnt);
      if (init) continue;
      this.gRecent[g] *= HALF_LIFE;
      const team = this.gTeam[g];
      // suppression level: fire received lately against the men still standing
      let sup = 0;
      if (team === ORC) {
        const s = (this.gSup[g] *= SUP_FADE);
        sup = this.gExempt[g] || this.gFearless[g] ? 0 : Math.min(2.5, s / Math.max(8, cnt));
        this.gPin[g] = sup >= 1.2 ? 2 : sup >= 0.5 ? 1 : 0;
      }
      if (this.gExempt[g] || !on) continue;
      let insp = 0;
      for (const ci of this.cmds[team]) { if (!this.alive[ci]) continue; const r = UNITS[this.type[ci]].aura, dx = this.x[ci] - cx, dy = this.y[ci] - cy; if (dx * dx + dy * dy < r * r) { insp = 1; break; } }
      this.gInsp[g] = insp;
      const st = this.gState[g];
      const pressure = this.gRecent[g] / Math.max(8, cnt);
      let regen = team === ORC ? (insp ? 9 : 4) : (insp ? 6 : 2.5);
      if (this.hadCmd[team] && !this.cmds[team].length) regen *= 0.75; // leaderless
      if (st >= G_ROUT) regen += 2;
      const cap = 100 - 18 * this.gBreaks[g];
      let m = this.gMorale[g] + (regen - pressure * (team === ORC ? 13 : 30) - 6 * Math.min(1.5, sup)) * 0.5;
      if (m > cap) m = cap; else if (m < 0) m = 0;
      this.gMorale[g] = m;
      if (st <= G_SHAKEN) {
        if (m <= 20 && (team === ORC || this.time - this.gRoutT[g] > 40 || !this.gBreaks[g])) this._break(g, cnt);
        else this.gState[g] = m < 45 ? G_SHAKEN : G_OK;
      } else if (st === G_ROUT && m >= 60 && this.time - this.gRoutT[g] > 20) {
        this.gState[g] = G_OK;
        if (this.time > this._moraleLogT[1]) { this._moraleLogT[1] = this.time + 90; this.events.push({ type: 'log', text: 'A broken company rallies and turns back to the fight', cls: '', x: cx, y: cy }); }
      }
    }
  },

  _break(g, cnt) {
    const team = this.gTeam[g];
    this.gBreaks[g]++; this.gRoutT[g] = this.time; if (team === ORC) this.stats.routs++; else this.stats.routsDef = (this.stats.routsDef || 0) + 1;
    if (team === ORC) {
      this.gState[g] = this.gBreaks[g] >= 3 || cnt < 0.25 * this.gN0[g] ? G_GONE : G_ROUT;
      // fear spreads to the companies alongside
      for (let h = 0; h < this.ng; h++) {
        if (h === g || this.gTeam[h] !== ORC || this.gExempt[h] || this.gState[h] >= G_ROUT) continue;
        const dx = this.gCx[h] - this.gCx[g], dy = this.gCy[h] - this.gCy[g];
        if (dx * dx + dy * dy < 140 * 140) this.gMorale[h] = Math.max(0, this.gMorale[h] - 8);
      }
      this._brokeN = (this._brokeN || 0) + 1;
      if (this.time > this._moraleLogT[0]) {
        this._moraleLogT[0] = this.time + 45;
        this.events.push({ type: 'log', text: this._brokeN > 1 ? `${this._brokeN} Uruk companies have broken and run` : 'An Uruk company breaks and runs!', cls: 'good', x: this.gCx[g], y: this.gCy[g] });
        this._brokeN = 0;
      }
    } else {
      this.gState[g] = G_SHAKEN; this.gMorale[g] = 36;
      const list = [];
      for (let i = 0; i < this.n; i++) {
        if (!this.alive[i] || this.grp[i] !== g) continue;
        const d = UNITS[this.type[i]];
        if (d.cls !== C.INF || !d.speed) continue;
        const dk = Math.hypot(this.x[i] - KEEP.cx, this.y[i] - KEEP.cy);
        if (dk > KEEP.r + 6) list.push([dk, i]);
      }
      if (list.length) {
        this._toKeep(list);
        this.events.push({ type: 'log', text: `A platoon on ${this.sectors[this.sectorAt(this.gCx[g], this.gCy[g])].name} breaks under its losses and falls back to the keep`, cls: 'bad', x: this.gCx[g], y: this.gCy[g] });
      }
    }
  },

  _cmdDown(i, team, x, y) {
    let left = team === ORC && this.dir ? this.dir.cmdReserve : 0; // captains still to come count
    for (const ci of this.cmds[team]) if (ci !== i && this.alive[ci]) left++;
    this.cmds[team] = this.cmds[team].filter((ci) => ci !== i);
    for (let g = 0; g < this.ng; g++) {
      if (this.gTeam[g] !== team || this.gExempt[g] || !this.gAlive[g]) continue;
      const d = Math.hypot(this.gCx[g] - x, this.gCy[g] - y);
      if (d > 240 && left > 0) continue;
      this.gMorale[g] = Math.max(0, this.gMorale[g] - (d < 120 ? 40 : 22) - (left ? 0 : 8));
      if (d < 240) this.gConf[g] = this.time + 4 + this.rand() * 4;
    }
    if (team === ORC) this.events.push({ type: 'banner', text: left ? 'An Uruk captain is down — his companies waver' : 'The last Uruk captain has fallen — the horde is leaderless', cls: 'good', x, y });
    else this.events.push({ type: 'banner', text: left ? 'A commander is down — the line is shaken' : 'The garrison has lost its commanders', cls: 'bad', x, y });
    this.fx.sound('horn', x, y, 0.6);
  },
};
