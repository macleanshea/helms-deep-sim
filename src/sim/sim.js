// Battle simulation. Pure logic (no DOM) so it can run headless for balance tests.
// Units live in structure-of-arrays typed buffers; visual effects are reported
// through the `fx` interface and UI notifications through `events`.

import { WORLD_W, WORLD_H, CELL, GW, GH, DT, DEF, ORC, T, OB, STEP, UNITS, U, WEAPONS, ARMOR_MULT, R, C, TR, SUPPORT, DEFAULT_OPTIONS } from '../config.js';
import { FlowSolver, DXN, DYN } from './flow.js';
import { groupPositions } from '../scenarios.js';
import { KEEP, N_WALL } from '../map.js';
import { supportMethods } from './support.js';
import { moraleMethods } from './morale.js';

export { SUPPLY_R } from './support.js';
export const MAX_UNITS = 1 << 16;
const FINE = 2, FW = WORLD_W / FINE, FH = WORLD_H / FINE; // separation / blast grid
const OCS = 16, OW = WORLD_W / OCS, OH = WORLD_H / OCS;   // coarse grid of attackers
const DCS = 8, DW = WORLD_W / DCS, DH = WORLD_H / DCS;    // coarse grid of defenders
export const LOSS_CELL = OCS, LOSS_W = OW, LOSS_H = OH;

export const S_IDLE = 0, S_MOVE = 1, S_ACT = 2, S_DONE = 3, S_FLEE = 4, S_WAIT = 5, S_CLIMB = 6;
export const LADDER_TIME = 4, TOWER_TIME = 5;
// direction index for a (dy+1)*3+(dx+1) neighbour offset
const KDIR = [5, 6, 7, 4, -1, 0, 3, 2, 1];

const NOFX = new Proxy({}, { get: () => () => {} });
let sharedSolver = null;
const W = WEAPONS;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Sim {
  constructor(map, setup, fx) {
    this.map = map;
    this.fx = fx || NOFX;
    const o = setup.options || {};
    this.opt = { ...DEFAULT_OPTIONS, ...o, support: { ...DEFAULT_OPTIONS.support, ...(o.support || {}) } };
    this.rand = mulberry(this.opt.seed || 1);
    this.mtype = map.type; this.mseg = map.seg; this.cz = map.cz; this.portal = map.portal;

    const N = MAX_UNITS;
    this.alive = new Uint8Array(N); this.team = new Uint8Array(N); this.type = new Uint8Array(N);
    this.state = new Uint8Array(N); this.el = new Uint8Array(N); this.ord = new Int8Array(N).fill(-1); this.grp = new Uint16Array(N);
    this.x = new Float32Array(N); this.y = new Float32Array(N); this.px = new Float32Array(N); this.py = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.rot = new Float32Array(N); this.trot = new Float32Array(N);
    this.sepx = new Float32Array(N); this.sepy = new Float32Array(N); this.bx = new Float32Array(N); this.by = new Float32Array(N);
    this.hp = new Float32Array(N); this.rad = new Float32Array(N);
    this.cd = new Float32Array(N); this.cd2 = new Float32Array(N);
    this.ammo = new Float32Array(N); this.ammo2 = new Float32Array(N);
    this.target = new Int32Array(N).fill(-1); this.target2 = new Int32Array(N).fill(-1);
    this.tx = new Float32Array(N); this.ty = new Float32Array(N);
    this.aux = new Float32Array(N); this.aux2 = new Int32Array(N).fill(-1);
    this.hitT = new Float32Array(N).fill(-10); this.fireT = new Float32Array(N).fill(-10);
    this.next = new Int32Array(N); this.cnext = new Int32Array(N);
    this.n = 0; this.free = [];

    this.head = new Int32Array(FW * FH);
    this.ocHead = new Int32Array(OW * OH); this.ocCount = new Uint16Array(OW * OH);
    this.dcHead = new Int32Array(DW * DH); this.dcCount = new Uint16Array(DW * DH);
    this.danger = new Uint8Array(OW * OH);
    this.navCnt = new Uint8Array(GW * GH);
    this.loss = [new Uint16Array(OW * OH), new Uint16Array(OW * OH)];

    // fortification state
    const NC = GW * GH;
    this.segs = map.segments.map((s) => ({ ...s, hp: s.maxHp, breached: false, ladders: 0, claimed: 0 }));
    this.segTop = new Float32Array(this.segs.map((s) => s.top));
    this.elev = new Uint8Array(NC);   // wall group + 1 where a wall (or a shut gate) still stands
    this.elevD = this.elev;           // the garrison keeps its gates barred, so both sides see the same walls
    this.virt = new Uint16Array(NC);
    this.deadG = new Uint8Array(NC);  // ground hugging the foot of a wall: hard to hit from on top of it
    this.orcBlock = new Uint8Array(NC);
    this.ladderAt = new Int32Array(NC).fill(-1); this.lad = new Uint8Array(NC);
    for (let c = 0; c < NC; c++) if (this.mtype[c] === T.DOOR) this.orcBlock[c] = 1;
    // field works
    this.ob = new Uint8Array(NC); this.wireHp = new Int16Array(NC); this.mines = new Uint8Array(NC);
    this.cover = new Uint8Array(NC); this.dyn = new Uint8Array(NC);
    this.propAt = new Int32Array(NC).fill(-1);
    this.props = []; this.clays = []; this.propVersion = 0;
    this._syncWalls();
    this.structVersion = 1;

    // navigation
    this.solver = sharedSolver || (sharedSolver = new FlowSolver(GW, GH)); // large scratch buffers: one per page
    this.orcCost = new Uint16Array(NC); this.orcDir = new Uint8Array(NC).fill(255);
    this.gateDir = new Uint8Array(NC).fill(255);
    this.srcBuf = new Int32Array(8192); this.srcMark = new Uint8Array(NC);
    this.navOrc = { cz: this.cz, elev: this.elev, portal: this.portal, step: STEP, ladder: this.lad, virt: this.virt };
    this.navHeavy = { cz: this.cz, elev: this.elev, portal: this.portal, step: 1.6 };
    this.navDef = { cz: this.cz, elev: this.elevD, portal: this.portal, step: STEP };
    this.navVeh = { cz: this.cz, elev: this.elevD, portal: this.portal, step: 1.6 };
    this.navDirty = true; this.lastNav = -100; this.gateDirty = true;
    this.orders = []; this.orderSeq = 0;

    this.time = 0; this.tick = 0;
    this.projectiles = []; this.aircraft = []; this.timed = []; this.drops = [];
    this.events = [];
    this.focus = null; this.holdIndirect = false; this.retreated = false;
    this.hvt = []; this.caches = []; this.heavy = []; this.cmds = [[], []];
    this.count = [0, 0]; this.initial = [0, 0]; this.defCombat = 0;
    this.result = null; this.routing = false; this.routT = 0;
    this.stats = { kills: {}, lostDef: {}, lostOrc: {}, defLostBy: {}, shots: 0, startDef: {}, startOrc: {}, breaches: 0, fled: 0, routs: 0 };
    this.support = {};
    for (const k in SUPPORT) this.support[k] = { left: this.opt.support[k] ?? SUPPORT[k].def, max: this.opt.support[k] ?? SUPPORT[k].def, ready: 0, cd: SUPPORT[k].cd };
    this._cand = new Int32Array(24);
    this.defBox = [0, 0, 0, 0]; this.orcMaxX = 0;
    this.linkT = new Float32Array(N);
    this._bx = NaN; this._by = 0; this._bp = 0;
    this._initMorale();
    this.miscGroup = [this.newGroup(DEF, true), this.newGroup(ORC, true)];
    // the defence is reported on by sector: three stretches of the Deeping Wall and the Hornburg
    this.sectors = ['the north wall', 'the centre wall', 'the south wall', 'the Hornburg'].map((name, k) => {
      if (k === 3) return { name, x: KEEP.cx - KEEP.r, y: KEEP.cy };
      const sg = this.segs[Math.floor(((k + 0.5) * N_WALL) / 3)];
      return { name, x: sg.x, y: sg.y };
    });
    this._alertT = new Map();

    for (const g of setup.groups) {
      const pos = groupPositions(map, g);
      const ti = U[g.type], d = UNITS[ti];
      const n = Math.min(g.count, pos.length / 2);
      if (d.cls === C.OBST) { for (let k = 0; k < n; k++) this._addWork(d.ob, pos[k * 2], pos[k * 2 + 1], g.ang); continue; }
      const gid = this.newGroup(d.team, n < 5 || d.sz > 0 || d.cmd || (d.team === DEF && d.cls !== C.INF));
      const face = d.team === DEF ? Math.PI : 0;
      for (let k = 0; k < n; k++) {
        const i = this.spawn(ti, pos[k * 2], pos[k * 2 + 1], face + (this.rand() - 0.5) * 0.3, gid);
        if (i < 0) break;
        if (d.team === ORC) { this.state[i] = g.delay > 0 ? S_WAIT : S_MOVE; this.aux[i] = g.delay || 0; }
      }
    }
    this.initial[0] = this.defCombat; this.initial[1] = this.count[1];
    for (let i = 0; i < this.n; i++) { const d = UNITS[this.type[i]]; const b = d.team === DEF ? this.stats.startDef : this.stats.startOrc; b[d.key] = (b[d.key] || 0) + 1; }
    this._startMorale();
  }

  // ---------------------------------------------------------------- units
  spawn(ti, x, y, rot = 0, g = -1) {
    let i;
    if (this.free.length) i = this.free.pop(); else if (this.n < MAX_UNITS) i = this.n++; else return -1;
    const d = UNITS[ti];
    this.alive[i] = 1; this.team[i] = d.team; this.type[i] = ti; this.state[i] = S_IDLE; this.ord[i] = -1;
    this.x[i] = this.px[i] = x; this.y[i] = this.py[i] = y; this.vx[i] = this.vy[i] = 0; this.sepx[i] = this.sepy[i] = 0;
    this.bx[i] = x; this.by[i] = y;
    this.rot[i] = rot; this.trot[i] = rot;
    this.hp[i] = d.hp; this.rad[i] = d.rad;
    this.cd[i] = this.rand() * 1.2; this.cd2[i] = this.rand();
    const am = this.opt.ammoMult;
    this.ammo[i] = d.pool ? d.pool : d.carry ? d.carry : d.ammo ? (am > 50 ? 1e9 : Math.ceil(d.ammo * am)) : 0;
    this.ammo2[i] = d.ammo2 ? (am > 50 ? 1e9 : d.ammo2 * am) : 0;
    this.target[i] = this.target2[i] = -1; this.aux[i] = 0; this.aux2[i] = -1; this.hitT[i] = -10; this.fireT[i] = -10; this.linkT[i] = 0;
    const c = this.map.cellOf(x, y);
    this.el[i] = (d.team === DEF ? this.elevD[c] : this.elev[c]) ? 1 : 0;
    if (g < 0) g = this.miscGroup[d.team];
    this.grp[i] = g; this.gAlive[g]++; this.gN0[g]++;
    this.count[d.team] += 1 + (d.carry || 0);
    if (d.team === DEF && d.cls !== C.CACHE) this.defCombat++;
    return i;
  }

  maxAmmo(i) { const d = UNITS[this.type[i]]; return d.pool ? d.pool : Math.ceil((d.ammo || 0) * Math.min(this.opt.ammoMult, 50)); }

  /** Which sector a wall segment belongs to. */
  segSector(k) { return k >= N_WALL ? 3 : Math.min(2, Math.floor((k * 3) / N_WALL)); }
  /** Which sector a point on the defenders' side falls in. */
  sectorAt(x, y) {
    const dx = x - KEEP.cx, dy = y - KEEP.cy;
    if (dx * dx + dy * dy < (KEEP.r + 14) * (KEEP.r + 14)) return 3;
    const y0 = this.map.wallJoin.y, y1 = this.map.wallTop.y;
    return Math.max(0, Math.min(2, Math.floor(((y - y0) / (y1 - y0)) * 3)));
  }

  /**
   * Tell the player something, at most once every `gap` seconds per key. Alerts carry a map
   * position so the UI can ping it and jump the camera there.
   */
  _alert(key, gap, text, cls, x, y, banner, big) {
    if (key) { const t = this._alertT.get(key); if (t !== undefined && this.time < t) return false; this._alertT.set(key, this.time + gap); }
    this.events.push({ type: banner ? 'banner' : 'log', text, cls, x, y, big: !!big });
    return true;
  }

  /** Height of a unit's feet above datum. */
  unitZ(i) {
    const x = this.x[i], y = this.y[i];
    if (this.state[i] === S_CLIMB) {
      const L = this.target2[i], u = Math.min(1, (this.time - this.aux[i]) / (L >= 0 && this.type[L] === U.tower ? TOWER_TIME : LADDER_TIME));
      return this.map.groundZ(this.bx[i], this.by[i]) * (1 - u) + this.segTop[0] * u;
    }
    if (this.el[i]) { const s = this.mseg[this.map.cellOf(x, y)]; if (s >= 0) return this.segTop[s]; }
    return this.map.groundZ(x, y);
  }

  damage(i, dmg, w) {
    if (!this.alive[i]) return;
    const d = UNITS[this.type[i]];
    if (w) dmg *= ARMOR_MULT[w.kind][d.armor];
    this.hitT[i] = this.time;
    if ((this.hp[i] -= dmg) <= 0) this.kill(i, w);
  }

  kill(i, w, silent) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    const d = UNITS[this.type[i]], team = d.team, x = this.x[i], y = this.y[i];
    this.count[team]--;
    const g = this.grp[i];
    this.gAlive[g]--;
    const key = w ? w.key : 'other';
    if (!silent) {
      this.gRecent[g] += 1;
      const lc = ((y / OCS) | 0) * OW + ((x / OCS) | 0);
      if (this.loss[team][lc] < 65535) this.loss[team][lc]++;
    }
    if (team === ORC) {
      if (!silent) {
        this.stats.kills[key] = (this.stats.kills[key] || 0) + 1;
        this.stats.lostOrc[d.key] = (this.stats.lostOrc[d.key] || 0) + 1;
      }
      if (d.role === R.LADDER || d.role === R.TOWER) {
        const k = this.aux2[i];
        if (k >= 0) {
          const s = this.segs[k];
          if (this.state[i] === S_DONE) { s.ladders--; this._unlink(i); } else s.claimed--;
        }
        if (d.role === R.TOWER) {
          // whoever was still inside either scrambles out or goes down with it
          const aboard = this.ammo[i] | 0, out = silent ? aboard : Math.floor(aboard * 0.5);
          this.count[ORC] -= aboard;
          if (!silent && aboard - out > 0) { this.stats.kills[key] = (this.stats.kills[key] || 0) + aboard - out; this.stats.lostOrc.uruk = (this.stats.lostOrc.uruk || 0) + aboard - out; }
          const tg = this.target[i] >= 0 ? this.target[i] : this.miscGroup[ORC];
          for (let k2 = 0; k2 < out; k2++) {
            const a = this.rand() * 6.28, rr = 3 + this.rand() * 6;
            let sx = x + Math.cos(a) * rr, sy = y + Math.sin(a) * rr;
            const sc = this.map.cellOf(sx, sy);
            if (this.mtype[sc] === T.CLIFF || this.elev[sc]) { sx = x; sy = y; }
            const j = this.spawn(U.uruk, sx, sy, a, tg); if (j >= 0) this.state[j] = S_MOVE;
          }
        }
      } else if (d.role === R.SAPPER && !silent && this.rand() < 0.4) {
        this.timed.push({ t: this.time + 0.15, f: () => this.explode(x, y, 16, 520, W.blast, ORC, true) });
      }
    } else if (d.cls !== C.CACHE) {
      this.defCombat--;
      this.stats.lostDef[d.key] = (this.stats.lostDef[d.key] || 0) + 1;
      this.stats.defLostBy[key] = (this.stats.defLostBy[key] || 0) + 1;
    }
    if (d.cmd && !silent) this._cmdDown(i, team, x, y);
    if (!silent) this.fx.death(this.type[i], x, y, this.unitZ(i), this.rot[i], this._bx, this._by, this._bp);
    this.free.push(i);
  }

  // ------------------------------------------------------------- terrain
  /** Recompute which cells still carry a standing wall after a breach. */
  _syncWalls() {
    const { elev, virt, deadG, mseg, segs } = this;
    for (let c = 0, n = GW * GH; c < n; c++) {
      const s = mseg[c];
      if (s < 0 || segs[s].breached) { elev[c] = 0; virt[c] = 0; continue; }
      elev[c] = segs[s].group + 1; virt[c] = segs[s].virt;
    }
    deadG.fill(0);
    for (let gy = 1; gy < GH - 1; gy++) for (let gx = 1; gx < GW - 1; gx++) {
      const c = gy * GW + gx;
      if (elev[c] || this.mtype[c] === T.CLIFF) continue;
      const e = elev[c - 1] || elev[c + 1] || elev[c - GW] || elev[c + GW];
      if (e) deadG[c] = e;
    }
  }

  canEnter(cf, ct, sz, orc) {
    const mt = this.mtype[ct];
    if (mt === T.CLIFF) return false;
    let et, ef;
    if (orc) { if (this.orcBlock[ct]) return false; et = this.elev[ct]; ef = this.elev[cf]; } else { et = this.elevD[ct]; ef = this.elevD[cf]; }
    if (et === ef) {
      if (et) return true;
      const dz = this.cz[ct] - this.cz[cf];
      if (dz > STEP || dz < -STEP) return false;
      if (sz === 0) return true;
      if (mt === T.STAIR) return false;
      if (sz === 2 && (dz > 1.6 || dz < -1.6 || (this.ob[ct] & (OB.AV | OB.MOAT)))) return false;
      return true;
    }
    if (sz) return false;
    const k = KDIR[(((ct / GW) | 0) - ((cf / GW) | 0) + 1) * 3 + (ct % GW) - (cf % GW) + 1];
    return k >= 0 && ((this.portal[cf] >> k) & 1) === 1;
  }

  /** Place a defensive work piece. */
  _addWork(kind, x, y, ang) {
    const c = this.map.cellOf(x, y);
    const prop = { kind, x, y, ang, alive: 1 };
    if (kind === 'wire') { if (this.ob[c] & OB.WIRE) return; this.ob[c] |= OB.WIRE; this.wireHp[c] = 520; this.propAt[c] = this.props.length; }
    else if (kind === 'av') { if (this.ob[c] & OB.AV) return; this.ob[c] |= OB.AV; this.cover[c] = 1; this.propAt[c] = this.props.length; }
    else if (kind === 'moat') { if (this.ob[c] & OB.MOAT) return; this.ob[c] |= OB.MOAT; prop.x = (c % GW) * CELL + 2; prop.y = ((c / GW) | 0) * CELL + 2; }
    else if (kind === 'mine') { if (this.mines[c] > 200) return; this.mines[c]++; }
    else if (kind === 'claymore') {
      // face the enemy: the perpendicular to the laid line that points down the valley
      let dx = -Math.sin(ang), dy = Math.cos(ang);
      if (dx > 0.01 || (Math.abs(dx) <= 0.01 && dy > 0)) { dx = -dx; dy = -dy; }
      prop.ang = Math.atan2(dy, dx);
      this.clays.push({ x, y, dx, dy, prop });
    }
    this.props.push(prop);
  }

  _clearOb(c, flag) {
    if (!(this.ob[c] & flag)) return;
    this.ob[c] &= ~flag;
    if (flag === OB.AV) this.cover[c] = 0;
    const p = this.propAt[c];
    if (p >= 0 && this.props[p].alive) { this.props[p].alive = 0; this.propVersion++; this.fx.dust(this.props[p].x, this.props[p].y, this.map.groundZ(this.props[p].x, this.props[p].y), 2.5); }
    this.propAt[c] = -1;
  }

  // mode: 0 attacker, 1 defender;  sz: 0 foot, 1 big, 2 heavy
  _move(i, dirx, diry, speed, sz, mode) {
    const x = this.x[i], y = this.y[i];
    const fx = (x / FINE) | 0, fy = (y / FINE) | 0;
    const ph = this.tick + i;
    if ((ph & 1) === 0 && ((ph & 2) === 0 || this.sepx[i] !== 0 || this.sepy[i] !== 0)) {
      let sx = 0, sy = 0, cnt = 0;
      const ri = this.rad[i], head = this.head, next = this.next, X = this.x, Y = this.y, RAD = this.rad, EL = this.el, ei = EL[i];
      const y0 = fy > 0 ? fy - 1 : 0, y1 = fy < FH - 1 ? fy + 1 : FH - 1, x0 = fx > 0 ? fx - 1 : 0, x1 = fx < FW - 1 ? fx + 1 : FW - 1;
      for (let cy = y0; cy <= y1 && cnt < 26; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          for (let j = head[cy * FW + cx]; j >= 0; j = next[j]) {
            if (j === i || EL[j] !== ei) continue;
            cnt++;
            const dx = x - X[j], dy = y - Y[j];
            const rr = ri + RAD[j] + 0.42;
            const d2 = dx * dx + dy * dy;
            if (d2 < rr * rr) {
              if (d2 > 1e-4) { const d = Math.sqrt(d2), f = (rr - d) / (rr * d); sx += dx * f; sy += dy * f; }
              else { sx += ((i * 7 + j) % 5) - 2; sy += ((i * 3 + j * 5) % 5) - 2; }
            }
          }
        }
      }
      this.sepx[i] = sx; this.sepy[i] = sy;
    }
    const c0 = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
    const t0 = this.mtype[c0];
    if (t0 !== T.GROUND) {
      if (t0 === T.WATER) speed *= 0.75;
      else if (t0 === T.STAIR) speed *= 0.6;
      else if (t0 === T.WALL && !this.elev[c0]) speed *= 0.45; // scrambling over rubble
    }
    const o = this.ob[c0];
    if (o) {
      if (o & OB.WIRE) {
        if (mode) speed *= 0.5;
        else {
          speed *= sz ? 0.6 : 0.3;
          if ((this.wireHp[c0] -= sz === 2 ? 40 : sz ? 10 : 1) <= 0) this._clearOb(c0, OB.WIRE);
        }
      }
      if (o & OB.MOAT) speed *= sz ? 0.5 : 0.35;
      if (o & OB.AV) { speed *= 0.8; if (!mode && sz === 1 && this.rand() < 0.04) this._clearOb(c0, OB.AV); }
    }
    const k = 1.7 * (speed > 1 ? speed : 1);
    let vx = this.vx[i], vy = this.vy[i];
    vx += (dirx * speed + this.sepx[i] * k - vx) * 0.42;
    vy += (diry * speed + this.sepy[i] * k - vy) * 0.42;
    const vm = vx * vx + vy * vy, lim = speed * 1.25 + 0.6;
    if (vm > lim * lim) { const f = lim / Math.sqrt(vm); vx *= f; vy *= f; }
    let nx = x + vx * DT, ny = y + vy * DT;
    if (nx < 2) nx = 2; else if (nx > WORLD_W - 2) nx = WORLD_W - 2;
    if (ny < 2) ny = 2; else if (ny > WORLD_H - 2) ny = WORLD_H - 2;
    let blocked = -1;
    const c1 = ((ny / CELL) | 0) * GW + ((nx / CELL) | 0);
    if (c1 !== c0) {
      const orc = !mode;
      if (!this.canEnter(c0, c1, sz, orc)) {
        blocked = c1;
        const ca = ((y / CELL) | 0) * GW + ((nx / CELL) | 0);
        if (ca === c0 || this.canEnter(c0, ca, sz, orc)) { ny = y; vy *= 0.3; }
        else {
          const cb = ((ny / CELL) | 0) * GW + ((x / CELL) | 0);
          if (cb === c0 || this.canEnter(c0, cb, sz, orc)) { nx = x; vx *= 0.3; }
          else { nx = x; ny = y; vx = 0; vy = 0; }
        }
      } else if (orc && this.mines[c1] && this.rand() < 0.55) {
        this.mines[c1]--;
        const mx = nx, my = ny;
        this.timed.push({ t: this.time, f: () => this.explode(mx, my, W.mine.aoe, W.mine.dmg, W.mine, DEF, false) });
      }
    }
    this.x[i] = nx; this.y[i] = ny; this.vx[i] = vx; this.vy[i] = vy;
    if ((ph & 1) === 1 && vx * vx + vy * vy > 0.2) {
      let a = Math.atan2(vy, vx) - this.rot[i];
      if (a > Math.PI) a -= 2 * Math.PI; else if (a < -Math.PI) a += 2 * Math.PI;
      this.rot[i] += a * 0.6;
    }
    return blocked;
  }

  /** Smoothly interpolated flow direction at a point; result in this.fdx / this.fdy. */
  _flow(x, y) {
    const gx = x / CELL - 0.5, gy = y / CELL - 0.5;
    let ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    if (ix < 0) ix = 0; else if (ix > GW - 2) ix = GW - 2;
    if (iy < 0) iy = 0; else if (iy > GH - 2) iy = GH - 2;
    const d = this.orcDir, c = iy * GW + ix;
    let sx = 0, sy = 0, k;
    if ((k = d[c]) !== 255) { const w = (1 - fx) * (1 - fy); sx += DXN[k] * w; sy += DYN[k] * w; }
    if ((k = d[c + 1]) !== 255) { const w = fx * (1 - fy); sx += DXN[k] * w; sy += DYN[k] * w; }
    if ((k = d[c + GW]) !== 255) { const w = (1 - fx) * fy; sx += DXN[k] * w; sy += DYN[k] * w; }
    if ((k = d[c + GW + 1]) !== 255) { const w = fx * fy; sx += DXN[k] * w; sy += DYN[k] * w; }
    // far from the fight the host marches up the valley in its ranks; close in, it follows the flow
    const far = this.defBox[0] - 200 - x;
    if (far > 0) { const w = far > 120 ? 2.2 : (far / 120) * 2.2; sx += w; }
    const l = Math.sqrt(sx * sx + sy * sy);
    if (l < 0.05) { this.fdx = 0; this.fdy = 0; return false; }
    this.fdx = sx / l; this.fdy = sy / l;
    return true;
  }

  _los(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 20) return true;
    const n = (d / CELL) | 0, ix = dx / n, iy = dy / n;
    for (let k = 2; k < n - 1; k++) {
      const c = (((y1 + iy * k) / CELL) | 0) * GW + (((x1 + ix * k) / CELL) | 0);
      if (this.mtype[c] === T.CLIFF) { if (k > 3 && k < n - 3) return false; continue; }
      if (this.elev[c]) return false;
    }
    return true;
  }

  // ------------------------------------------------------------- grids
  _buildGrids() {
    const { head, ocHead, ocCount, dcHead, dcCount, next, cnext, x, y, alive, team } = this;
    head.fill(-1); ocHead.fill(-1); ocCount.fill(0); dcHead.fill(-1); dcCount.fill(0);
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9, ox1 = -1e9;
    const lt = U.ladder, tt = U.tower;
    for (let i = 0, n = this.n; i < n; i++) {
      if (!alive[i]) continue;
      const xi = x[i], yi = y[i];
      const f = ((yi / FINE) | 0) * FW + ((xi / FINE) | 0);
      next[i] = head[f]; head[f] = i;
      if (team[i] === ORC) {
        const ty = this.type[i];
        if ((ty === lt || ty === tt) && this.state[i] === S_DONE) continue; // raised works are not rifle targets
        const c = ((yi / OCS) | 0) * OW + ((xi / OCS) | 0);
        cnext[i] = ocHead[c]; ocHead[c] = i; ocCount[c]++;
        if (xi > ox1) ox1 = xi;
      } else {
        const c = ((yi / DCS) | 0) * DW + ((xi / DCS) | 0);
        cnext[i] = dcHead[c]; dcHead[c] = i; dcCount[c]++;
        if (xi < bx0) bx0 = xi; if (xi > bx1) bx1 = xi; if (yi < by0) by0 = yi; if (yi > by1) by1 = yi;
      }
    }
    this.orcMaxX = ox1;
    this.defBox[0] = bx0; this.defBox[1] = by0; this.defBox[2] = bx1; this.defBox[3] = by1;
    // moving siege engines give cover to whoever is behind them
    const dyn = this.dyn; dyn.fill(0);
    for (const i of this.heavy) {
      if (!alive[i]) continue;
      const gx = (x[i] / CELL) | 0, gy = (y[i] / CELL) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const xx = gx + ox, yy = gy + oy; if (xx >= 0 && yy >= 0 && xx < GW && yy < GH) dyn[yy * GW + xx] = 1; }
    }
  }

  _buildAux() {
    const hv = this.hvt, ca = this.caches, he = this.heavy; hv.length = 0; ca.length = 0; he.length = 0;
    this.cmds[0].length = 0; this.cmds[1].length = 0;
    const dg = this.danger; dg.fill(0);
    for (let i = 0, n = this.n; i < n; i++) {
      if (!this.alive[i]) continue;
      const d = UNITS[this.type[i]];
      if (d.cmd) this.cmds[d.team].push(i);
      if (d.team === ORC) {
        if (d.hvt && (this.state[i] !== S_DONE || d.role === R.TOWER)) hv.push(i);
        if (d.sz === 2) he.push(i);
        continue;
      }
      if (d.cls === C.CACHE) ca.push(i);
      const cx = (this.x[i] / OCS) | 0, cy = (this.y[i] / OCS) | 0;
      for (let oy = -2; oy <= 2; oy++) {
        const yy = cy + oy; if (yy < 0 || yy >= OH) continue;
        for (let ox = -2; ox <= 2; ox++) {
          const xx = cx + ox; if (xx < 0 || xx >= OW) continue;
          const v = (ox >= -1 && ox <= 1 && oy >= -1 && oy <= 1) ? 2 : 1;
          if (dg[yy * OW + xx] < v) dg[yy * OW + xx] = v;
        }
      }
    }
  }

  _nav() {
    this.lastNav = this.tick; this.navDirty = false;
    const cost = this.orcCost, mt = this.mtype, cnt = this.navCnt, ob = this.ob, elev = this.elev;
    cnt.fill(0);
    const src = this.srcBuf, mark = this.srcMark; let ns = 0;
    mark.fill(0);
    for (let i = 0, n = this.n; i < n; i++) {
      if (!this.alive[i]) continue;
      const c = ((this.y[i] / CELL) | 0) * GW + ((this.x[i] / CELL) | 0);
      if (this.team[i] === ORC) { if (cnt[c] < 255) cnt[c]++; }
      else if (!mark[c] && ns < src.length) { mark[c] = 1; src[ns++] = c; }
    }
    for (let c = 0, n = GW * GH; c < n; c++) {
      const t = mt[c];
      if (t === T.CLIFF || this.orcBlock[c]) { cost[c] = 0; continue; }
      let v = t === T.GROUND ? 10 : t === T.WATER ? 13 : t === T.STAIR ? 14 : t === T.WALL ? (elev[c] ? 12 : 22) : 10;
      const o = ob[c];
      if (o) v += (o & OB.WIRE ? 30 : 0) + (o & OB.MOAT ? 30 : 0) + (o & OB.AV ? 6 : 0);
      const k = cnt[c];
      cost[c] = v + (k > 8 ? 32 : k * 4);
    }
    if (ns > 0) this.solver.solve(cost, src, ns, this.orcDir, this.navOrc);
    if (this.gateDirty) {
      this.gateDirty = false;
      const g = this.segs[this.map.GATE];
      for (let c = 0, n = GW * GH; c < n; c++) cost[c] = mt[c] === T.CLIFF || mt[c] === T.STAIR || this.orcBlock[c] || elev[c] || (ob[c] & (OB.AV | OB.MOAT)) ? 0 : 10;
      src[0] = this.map.cellOf(g.ox, g.oy);
      this.solver.solve(cost, src, 1, this.gateDir, this.navHeavy);
    }
  }

  // --------------------------------------------------------------- step
  step() {
    if (this.result) return;
    this.tick++; this.time += DT;
    if (this.tick % 5 === 1) this._buildAux();
    this._buildGrids();
    if ((this.navDirty && this.tick - this.lastNav >= 3) || this.tick - this.lastNav >= 20) this._nav();
    const { alive, team, px, py, x, y } = this;
    for (let i = 0, n = this.n; i < n; i++) {
      if (!alive[i]) continue;
      px[i] = x[i]; py[i] = y[i];
      if (team[i] === ORC) this._orc(i); else this._def(i);
    }
    this._projectiles();
    if (this.timed.length) {
      const due = [];
      this.timed = this.timed.filter((e) => (e.t <= this.time ? (due.push(e), false) : true));
      for (const e of due) e.f();
    }
    if (this.aircraft.length) this._aircraft();
    if (this.drops.length) this._drops();
    if (this.tick % 10 === 3) this._supply();
    if (this.tick % 20 === 7) this._ammoWatch();
    if (this.clays.length && this.tick % 3 === 0) this._claymores();
    if (this.tick % 5 === 2) this._morale();
    if (this.focus && this.time > this.focus.until) this.focus = null;
    if (this.tick % 5 === 0) this._checkEnd();
  }

  // ---------------------------------------------------------- attackers
  _nearDef(i, x, y, el) {
    const cx = (x / DCS) | 0, cy = (y / DCS) | 0;
    let best = -1, bd = 1e9, alt = -1, ad = 1e9;
    const y0 = cy > 0 ? cy - 1 : 0, y1 = cy < DH - 1 ? cy + 1 : DH - 1, x0 = cx > 0 ? cx - 1 : 0, x1 = cx < DW - 1 ? cx + 1 : DW - 1;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      for (let j = this.dcHead[yy * DW + xx]; j >= 0; j = this.cnext[j]) {
        if (!this.alive[j]) continue;
        const dx = this.x[j] - x, dy = this.y[j] - y;
        const d = dx * dx + dy * dy - this.rad[j] * this.rad[j];
        if (this.el[j] === el) { if (d < bd) { bd = d; best = j; } } else if (d < ad) { ad = d; alt = j; }
      }
    }
    return best >= 0 ? best : alt;
  }

  _findDefInRange(x, y, range, el) {
    const cx = (x / DCS) | 0, cy = (y / DCS) | 0, maxR = Math.ceil(range / DCS), r2 = range * range;
    const dc = this.dcHead;
    for (let r = 0; r <= maxR; r++) {
      for (let oy = -r; oy <= r; oy++) {
        const yy = cy + oy; if (yy < 0 || yy >= DH) continue;
        const step = (oy === -r || oy === r || r === 0) ? 1 : 2 * r;
        for (let ox = -r; ox <= r; ox += step) {
          const xx = cx + ox; if (xx < 0 || xx >= DW) continue;
          const j = dc[yy * DW + xx];
          if (j < 0 || !this.alive[j]) continue;
          const dx = this.x[j] - x, dy = this.y[j] - y;
          if (dx * dx + dy * dy > r2) continue;
          if (this.el[j] || el || this._los(x, y, this.x[j], this.y[j])) return j;
        }
      }
    }
    return -1;
  }

  /** Try to start up the ladder or tower that serves wall cell cw. */
  _startClimb(i, cw) {
    const L = this.ladderAt[cw];
    if (L < 0 || !this.alive[L] || this.state[L] !== S_DONE || this.time < this.linkT[L]) return false;
    const tower = this.type[L] === U.tower;
    this.linkT[L] = this.time + (tower ? 0.35 : 0.75);
    this.state[i] = S_CLIMB; this.aux[i] = this.time; this.target2[i] = L;
    this.bx[i] = this.x[L]; this.by[i] = this.y[L]; this.tx[i] = this.tx[L]; this.ty[i] = this.ty[L];
    this.vx[i] = this.vy[i] = 0; this.sepx[i] = this.sepy[i] = 0;
    this.rot[i] = Math.atan2(this.ty[L] - this.y[L], this.tx[L] - this.x[L]);
    return true;
  }

  _climb(i) {
    const L = this.target2[i];
    const ok = L >= 0 && this.alive[L] && this.state[L] === S_DONE && (this.type[L] === U.ladder || this.type[L] === U.tower);
    const u = (this.time - this.aux[i]) / (ok && this.type[L] === U.tower ? TOWER_TIME : LADDER_TIME);
    if (!ok) {
      // the ladder went out from under them
      this.state[i] = S_MOVE; this.target2[i] = -1; this.el[i] = 0;
      this.x[i] = this.bx[i] + (this.rand() - 0.5) * 3; this.y[i] = this.by[i] + (this.rand() - 0.5) * 3;
      this.px[i] = this.x[i]; this.py[i] = this.y[i];
      this.damage(i, 40 + 120 * Math.min(1, u), null);
      return;
    }
    if (u >= 1) {
      this.x[i] = this.tx[i] + (this.rand() - 0.5); this.y[i] = this.ty[i] + (this.rand() - 0.5);
      this.state[i] = S_MOVE; this.target2[i] = -1; this.el[i] = 1; this.target[i] = -1;
      return;
    }
    this.x[i] = this.bx[i] + (this.tx[i] - this.bx[i]) * u; this.y[i] = this.by[i] + (this.ty[i] - this.by[i]) * u;
  }

  _unlink(L) {
    const c = this.map.cellOf(this.tx[L], this.ty[L]);
    if (this.ladderAt[c] === L) { this.ladderAt[c] = -1; this.lad[c] = 0; this.navDirty = true; }
  }

  _orc(i) {
    const d = UNITS[this.type[i]];
    const st = this.state[i];
    if (st === S_WAIT) { if (this.time >= this.aux[i]) { this.state[i] = S_MOVE; this.linkT[i] = this.time; } return; }
    if (st === S_CLIMB) { this._climb(i); return; }
    const x = this.x[i], y = this.y[i];
    if (this.cd[i] > 0) this.cd[i] -= DT;
    const c = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
    const el = this.elev[c] ? 1 : 0;
    this.el[i] = el;
    const g = this.grp[i], gs = this.gState[g];
    if (st === S_FLEE || (gs >= 2 && !el && x < 930)) {
      // broken: run for the valley mouth
      if (st === S_DONE) return;
      this._move(i, -1, ((i % 9) - 4) * 0.05, d.speed * 1.15, d.sz, 0);
      if (x < 10) { if (st === S_FLEE || gs === 3) { this.stats.fled++; this.kill(i, null, true); } else { this.vx[i] = 0; this.vy[i] = 0; } }
      return;
    }
    let speed = d.speed;
    if (this.gConf[g] > this.time) { if (((this.tick + i) & 7) < 5) { this.vx[i] *= 0.6; this.vy[i] *= 0.6; return; } speed *= 0.5; }
    switch (d.role) {
      case R.ARCHER: {
        let t = this.target[i];
        const w = d.wdef;
        if (t >= 0) {
          if (this.alive[t] && this.team[t] === DEF) {
            const dx = this.x[t] - x, dy = this.y[t] - y, d2 = dx * dx + dy * dy;
            if (d2 <= w.range * w.range) {
              this.vx[i] *= 0.5; this.vy[i] *= 0.5;
              if (this.cd[i] <= 0) {
                this.cd[i] = w.reload * (0.8 + 0.4 * this.rand()); this.fireT[i] = this.time;
                this.rot[i] = Math.atan2(dy, dx);
                let acc = w.acc; if (this.el[t] && !el) acc *= 0.22;
                const hit = this.rand() < acc, zt = this.unitZ(t) + 1.2;
                this.fx.tracer(x, y, this.unitZ(i) + 1.3, this.x[t] + (hit ? 0 : (this.rand() - 0.5) * 8), this.y[t] + (hit ? 0 : (this.rand() - 0.5) * 8), zt + (hit ? 0 : this.rand() * 2), TR.ARROW, hit ? 1 : 0);
                if (hit) this.damage(t, w.dmg, w);
              }
              return;
            }
          }
          this.target[i] = t = -1;
        }
        if ((this.tick + i) % 12 === 0) {
          const b = this.defBox, rg = w.range;
          if (x > b[0] - rg && x < b[2] + rg && y > b[1] - rg && y < b[3] + rg) {
            t = this._findDefInRange(x, y, rg * 0.92, el);
            if (t >= 0) { this.target[i] = t; return; }
          }
        }
        let blk = -1;
        if (this._flow(x, y)) blk = this._move(i, this.fdx, this.fdy, speed, 0, 0); else this._move(i, 0, 0, 0, 0, 0);
        if (blk >= 0 && this.lad[blk] && !el) this._startClimb(i, blk);
        return;
      }
      case R.MELEE:
      case R.TROLL: {
        if (((this.tick + i) & 3) === 0) { const b = this.defBox; this.target[i] = x > b[0] - 20 && x < b[2] + 20 && y > b[1] - 20 && y < b[3] + 20 ? this._nearDef(i, x, y, el) : -1; }
        const t = this.target[i];
        let dirx = 0, diry = 0, direct = false;
        if (t >= 0 && this.alive[t] && this.team[t] === DEF) {
          const dx = this.x[t] - x, dy = this.y[t] - y, d2 = dx * dx + dy * dy;
          const tr = this.rad[t], reach = d.reach + tr;
          if (this.el[t] === el) {
            if (d2 < reach * reach) {
              this.vx[i] *= 0.4; this.vy[i] *= 0.4;
              if (this.cd[i] <= 0) {
                this.cd[i] = d.mreload * (0.85 + 0.3 * this.rand()); this.fireT[i] = this.time;
                this.rot[i] = Math.atan2(dy, dx);
                const xt = this.x[t], yt = this.y[t], zt = this.unitZ(t);
                if (d.maoe) { this._meleeSweep(xt, yt, d.maoe, d.mdmg, t); this.fx.dust(xt, yt, zt, 3); this.fx.sound('thud', xt, yt, 0.5); }
                else this.fx.melee(xt, yt, zt + 1.2);
                this.damage(t, d.mdmg, d.maoe ? W.smash : W.melee);
              }
              return;
            }
            if (d2 < (7 + tr) * (7 + tr)) { const l = Math.sqrt(d2); dirx = dx / l; diry = dy / l; direct = true; }
          }
        }
        if (!direct) {
          if (this._flow(x, y)) { dirx = this.fdx; diry = this.fdy; }
          else if (t >= 0 && this.alive[t]) { const dx = this.x[t] - x, dy = this.y[t] - y, l = Math.sqrt(dx * dx + dy * dy) || 1; dirx = dx / l; diry = dy / l; }
        }
        const blk = this._move(i, dirx, diry, speed, d.sz, 0);
        if (blk >= 0 && this.elev[blk]) {
          if (this.lad[blk] && !d.sz && !el) { this._startClimb(i, blk); return; }
          if (this.cd[i] <= 0) {
            // hack at whatever masonry or timber bars the way
            const k = this.mseg[blk], s = this.segs[k];
            const dmg = d.sdmg ? (s.maxHp > 1e8 ? 0 : d.sdmg) : (s.kind === 'gate' || s.kind === 'postern' ? 5 : 0);
            if (dmg) {
              this.cd[i] = d.mreload * 1.2; this.fireT[i] = this.time;
              if (d.sdmg) { this.fx.dust(x + dirx * 3, y + diry * 3, this.unitZ(i) + 2, 4); this.fx.sound('thud', x, y, 0.7); } else this.fx.melee(x + dirx * 1.5, y + diry * 1.5, this.unitZ(i) + 1.2);
              this.damageSeg(k, dmg);
            }
          }
        }
        return;
      }
      case R.LADDER:
      case R.TOWER: {
        if (st === S_DONE) { if (d.role === R.TOWER) this._towerUnload(i); return; }
        const tower = d.role === R.TOWER;
        let k = this.aux2[i];
        if (st === S_ACT) {
          if (this.time >= this.aux[i]) {
            const s = this.segs[k];
            if (s.breached) { this.state[i] = S_MOVE; s.claimed--; this.aux2[i] = -1; return; }
            this.state[i] = S_DONE; s.ladders++; s.claimed--;
            const off = tower ? 4.6 : 2.8;
            this.x[i] = s.x + s.nx * (s.half + off); this.y[i] = s.y + s.ny * (s.half + off);
            this.px[i] = this.x[i]; this.py[i] = this.y[i];
            this.tx[i] = s.x + s.nx * (s.half - 1.6); this.ty[i] = s.y + s.ny * (s.half - 1.6);
            this.rot[i] = Math.atan2(-s.ny, -s.nx);
            const cw = this.map.cellOf(this.tx[i], this.ty[i]);
            this.ladderAt[cw] = i; this.lad[cw] = 1; this.navDirty = true;
            this.fx.dust(this.x[i], this.y[i], this.map.groundZ(this.x[i], this.y[i]), tower ? 6 : 3); this.fx.sound('ladder', this.x[i], this.y[i], tower ? 1 : 0.6);
            const where = this.sectors[this.segSector(k)].name;
            if (tower) this._alert(null, 0, `A siege tower is against ${where}!`, 'bad', this.x[i], this.y[i], true);
            else if (!this._ladderAnnounced) { this._ladderAnnounced = true; this._alert(null, 0, 'Ladders on the Deeping Wall', 'warn', this.x[i], this.y[i], true); }
            else this._alert('ladUp' + this.segSector(k), 25, `Ladders are up on ${where}`, 'warn', this.x[i], this.y[i]);
          }
          return;
        }
        if (k < 0 || this.segs[k].breached) { if (k >= 0) this.segs[k].claimed--; k = this._pickLadderSeg(y); this.aux2[i] = k; if (k >= 0) this.segs[k].claimed++; }
        if (k < 0) { if (this._flow(x, y)) this._move(i, this.fdx, this.fdy, speed, d.sz, 0); return; }
        const s = this.segs[k];
        const ax = s.ox + (tower ? s.nx * 2.2 : 0), ay = s.oy + (tower ? s.ny * 2.2 : 0);
        const dx = ax - x, dy = ay - y, l = Math.sqrt(dx * dx + dy * dy);
        if (l < 130 && !this.ammo2[i]) {
          // seen coming: one warning per engine while there is still time to do something about it
          this.ammo2[i] = 1;
          const where = this.sectors[this.segSector(k)].name;
          if (tower) this._alert(null, 0, `A siege tower is closing on ${where}`, 'warn', x, y);
          else this._alert('ladIn' + this.segSector(k), 30, `Ladder crews are making for ${where}`, 'warn', x, y);
        }
        if (l < 2.5) { this.state[i] = S_ACT; this.aux[i] = this.time + (tower ? 3 : 4); this.vx[i] = this.vy[i] = 0; this.rot[i] = Math.atan2(-s.ny, -s.nx); return; }
        const bc = this._move(i, dx / l, dy / l, speed, d.sz, 0);
        if (tower) {
          // the crew drag anti-vehicle obstacles aside, slowly
          if (bc >= 0 && (this.ob[bc] & OB.AV) && this.rand() < 0.025) { this._clearOb(bc, OB.AV); this.fx.dust((bc % GW) * CELL + 2, ((bc / GW) | 0) * CELL + 2, this.cz[bc], 3); }
          // a tower that cannot get forward lets its company out where it stands
          if (Math.abs(this.x[i] - this.bx[i]) + Math.abs(this.y[i] - this.by[i]) > 1.5) { this.bx[i] = this.x[i]; this.by[i] = this.y[i]; this.linkT[i] = this.time; }
          else if (this.time - this.linkT[i] > 9) {
            this._alert(null, 0, 'A siege tower is stuck — its company dismounts', 'good', x, y);
            this.fx.death(this.type[i], x, y, this.map.groundZ(x, y), this.rot[i], NaN, 0, 0);
            this.kill(i, null, true);
          }
        }
        return;
      }
      case R.RAM: {
        const gseg = this.segs[this.map.GATE];
        if (this.gateDir[c] !== 255) this.linkT[i] = this.time;
        if (gseg.breached || this.time - this.linkT[i] > 12) {
          for (let k = 0; k < 8; k++) { const j = this.spawn(U.uruk, x + (this.rand() - 0.5) * 6, y + (this.rand() - 0.5) * 6, this.rot[i], g); if (j >= 0) this.state[j] = S_MOVE; }
          this.kill(i, null, true);
          return;
        }
        const dx = gseg.ox - x, dy = gseg.oy - y, l = Math.sqrt(dx * dx + dy * dy);
        if (l < 140 && !this.ammo2[i]) { this.ammo2[i] = 1; this._alert('ramIn', 20, 'A battering ram is on the causeway', 'bad', x, y); }
        if (l < 5.5) {
          this.linkT[i] = this.time;
          this.vx[i] = this.vy[i] = 0; this.rot[i] = Math.atan2(-gseg.ny, -gseg.nx);
          if (this.cd[i] <= 0) {
            this.cd[i] = 2.5; this.fireT[i] = this.time;
            this.fx.dust(gseg.ox - gseg.nx * 3, gseg.oy - gseg.ny * 3, this.cz[c] + 2, 4); this.fx.sound('ram', gseg.ox, gseg.oy, 1);
            this.damageSeg(this.map.GATE, d.sdmg);
          }
          return;
        }
        const k = this.gateDir[c];
        if (k !== 255 && l > 10) this._move(i, DXN[k], DYN[k], speed, 2, 0); else this._move(i, dx / l, dy / l, speed, 2, 0);
        return;
      }
      case R.SAPPER: {
        let k = this.aux2[i];
        if (st === S_ACT) {
          if ((this.tick & 1) === 0) this.fx.spark(x, y, this.unitZ(i) + 1.5);
          if (this.time >= this.aux[i]) this._detonate(i, k);
          return;
        }
        if (k < 0 || this.segs[k].breached) {
          const cu = this.segs[this.map.CULVERT];
          k = !cu.breached ? this.map.CULVERT : this._pickLadderSeg(y, true);
          this.aux2[i] = k;
        }
        if (k < 0) { if (this._flow(x, y)) this._move(i, this.fdx, this.fdy, speed, 0, 0); return; }
        const s = this.segs[k];
        const dx = s.ox - x, dy = s.oy - y, l = Math.sqrt(dx * dx + dy * dy);
        if (l < 160 && !this.ammo2[i]) { this.ammo2[i] = 1; this._alert('sapIn', 25, s.culvert ? 'Sappers are running for the culvert' : `Sappers are running for ${this.sectors[this.segSector(k)].name}`, 'bad', x, y); }
        if (l < 3) { this.state[i] = S_ACT; this.aux[i] = this.time + 1.6; this.vx[i] = this.vy[i] = 0; this.fx.sound('fuse', x, y, 0.8); return; }
        if ((this.tick + i) % 6 === 0) this.fx.spark(x, y, this.unitZ(i) + 1.5);
        this._move(i, dx / l, dy / l, speed, 0, 0);
        return;
      }
      case R.CATAPULT: {
        const w = d.wdef;
        if (st === S_ACT) {
          if (this.cd[i] > 0) return;
          if (!this._catTarget(i, w)) { this.state[i] = S_MOVE; return; }
          this.cd[i] = w.reload * (0.9 + 0.2 * this.rand()); this.fireT[i] = this.time;
          const tx = this.tx[i] + (this.rand() - 0.5) * 2 * w.scatter, ty = this.ty[i] + (this.rand() - 0.5) * 2 * w.scatter;
          this.rot[i] = Math.atan2(ty - y, tx - x);
          this._launch(x, y, this.cz[c] + 3, tx, ty, this.surfZ(tx, ty), w, ORC, 3, w.flight);
          this.fx.sound('catapult', x, y, 0.7);
          return;
        }
        if ((this.tick + i) % 10 === 0 && this._catTarget(i, w)) { this.state[i] = S_ACT; this.vx[i] = this.vy[i] = 0; this.cd[i] = 2 + this.rand() * 3; return; }
        if (this._flow(x, y)) this._move(i, this.fdx, this.fdy, speed, 2, 0);
        return;
      }
    }
  }

  _towerUnload(i) {
    if (this.ammo[i] < 1 || this.tick % 3) return;
    if (this.target[i] < 0) this.target[i] = this.newGroup(ORC);
    const k = this.aux2[i], s = this.segs[k];
    const a = (this.rand() - 0.5) * 3;
    this.ammo[i]--; this.count[ORC]--;
    const j = this.spawn(U.uruk, this.tx[i] + s.tx * a, this.ty[i] + s.ty * a, this.rot[i], this.target[i]);
    if (j >= 0) { this.state[j] = S_MOVE; this.el[j] = 1; }
  }

  _meleeSweep(x, y, r, dmg, skip) {
    const cx = (x / DCS) | 0, cy = (y / DCS) | 0;
    for (let yy = Math.max(0, cy - 1); yy <= Math.min(DH - 1, cy + 1); yy++) for (let xx = Math.max(0, cx - 1); xx <= Math.min(DW - 1, cx + 1); xx++) {
      for (let j = this.dcHead[yy * DW + xx]; j >= 0; j = this.cnext[j]) {
        if (j === skip || !this.alive[j]) continue;
        const dx = this.x[j] - x, dy = this.y[j] - y, rr = r + this.rad[j];
        if (dx * dx + dy * dy < rr * rr) this.damage(j, dmg * 0.6, W.smash);
      }
    }
  }

  _pickLadderSeg(y, any) {
    let best = -1, bs = 1e9;
    for (let tries = 0; tries < 6; tries++) {
      const k = (this.rand() * this.map.GATE) | 0;
      const s = this.segs[k];
      if (!s || s.kind !== 'wall' || !s.valid || s.breached || (!any && (s.culvert || s.ladders + s.claimed >= 1))) continue;
      const sc = Math.abs(s.y - y) + this.rand() * 120;
      if (sc < bs) { bs = sc; best = k; }
    }
    if (best < 0 && !any) {
      for (let tries = 0; tries < 8; tries++) {
        const k = (this.rand() * this.map.GATE) | 0;
        const s = this.segs[k];
        if (s && s.kind === 'wall' && s.valid && !s.breached && !s.culvert && s.ladders + s.claimed < 3) return k;
      }
    }
    return best;
  }

  _catTarget(i, w) {
    const x = this.x[i], y = this.y[i];
    const b = this.defBox;
    if (x < b[0] - w.range || x > b[2] + w.range) return false;
    const x0 = Math.max(0, ((x - w.range) / DCS) | 0), x1 = Math.min(DW - 1, ((x + w.range) / DCS) | 0);
    const y0 = Math.max(0, ((y - w.range) / DCS) | 0), y1 = Math.min(DH - 1, ((y + w.range) / DCS) | 0);
    const r2 = w.range * w.range, m2 = w.min * w.min;
    let best = -1, bs = 0;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const n = this.dcCount[yy * DW + xx];
      if (!n) continue;
      const dx = xx * DCS + 4 - x, dy = yy * DCS + 4 - y, d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 < m2) continue;
      const sc = (n + 1) * (0.4 + this.rand());
      if (sc > bs) { bs = sc; best = yy * DW + xx; }
    }
    if (best < 0) return false;
    this.tx[i] = (best % DW) * DCS + 4; this.ty[i] = ((best / DW) | 0) * DCS + 4;
    return true;
  }

  _detonate(i, k) {
    this.kill(i, null, true);
    const s = this.segs[k];
    const fresh = !s.breached;
    for (let j = k - 1; j <= k + 1; j++) { const q = this.segs[j]; if (q && q.kind === 'wall') this.breachSeg(j, j !== k); }
    this.explode(s.x, s.y, W.blast.aoe, W.blast.dmg, W.blast, ORC, true);
    if (fresh) this._alert(null, 0, s.culvert ? 'The culvert is blown — the Deeping Wall is breached!' : `${this.sectors[this.segSector(k)].name.replace(/^t/, 'T')} is breached!`, 'bad', s.x, s.y, true, true);
  }

  damageSeg(k, dmg) {
    const s = this.segs[k];
    if (s.breached || s.maxHp > 1e8) return;
    const before = s.hp / s.maxHp;
    s.hp -= dmg;
    if (s.hp <= 0) {
      this.breachSeg(k);
      const txt = s.kind === 'gate' ? 'The Hornburg gate has fallen!' : s.kind === 'postern' ? 'The postern door is broken!' : `A section of ${this.sectors[this.segSector(k)].name} has collapsed!`;
      this._alert(null, 0, txt, 'bad', s.x, s.y, true, s.kind === 'gate');
      return;
    }
    // warn while there is still something to be done about it
    const now = s.hp / s.maxHp;
    if (s.kind === 'gate' || s.kind === 'postern') {
      const what = s.kind === 'gate' ? 'The gate' : 'The postern door';
      if (before > 0.5 && now <= 0.5) this._alert(null, 0, `${what} is splintering — half its strength is gone`, 'bad', s.x, s.y, true);
      else if (before > 0.25 && now <= 0.25) this._alert(null, 0, `${what} is about to give way`, 'bad', s.x, s.y, true);
      else if (before >= 1) this._alert(null, 0, `${what} is under attack`, 'warn', s.x, s.y);
    } else if (before > 0.5 && now <= 0.5) this._alert('wallHp' + this.segSector(k), 30, `${this.sectors[this.segSector(k)].name.replace(/^t/, 'T')} is being battered down`, 'warn', s.x, s.y);
  }

  breachSeg(k, quiet) {
    const s = this.segs[k];
    if (s.breached) return;
    s.breached = true; s.hp = 0; s.ladders = 0;
    this._syncWalls();
    this.navDirty = true; this.gateDirty = true; this.structVersion++; this.stats.breaches++;
    this.fx.breach(s, quiet);
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      // raised ladders and docked towers on this section come down with it; anyone standing on it falls
      if ((this.type[i] === U.ladder || this.type[i] === U.tower) && this.aux2[i] === k && this.state[i] === S_DONE) { this._unlink(i); this.aux2[i] = -1; this.kill(i, null); continue; }
      if (this.el[i] && this.mseg[this.map.cellOf(this.x[i], this.y[i])] === k) { this.el[i] = 0; this.damage(i, 60 + this.rand() * 80, W.blast); }
    }
  }

  // ---------------------------------------------------------- defenders
  _def(i) {
    const d = UNITS[this.type[i]];
    if (d.cls === C.CACHE) return;
    const x = this.x[i], y = this.y[i];
    const c = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
    const eg = this.elevD[c], el = eg ? 1 : 0;
    this.el[i] = el;
    if (this.state[i] === S_MOVE) {
      const dx = this.tx[i] - x, dy = this.ty[i] - y, d2 = dx * dx + dy * dy;
      if (d2 < 1 || this.time > this.aux[i]) { this.state[i] = S_IDLE; this.vx[i] = this.vy[i] = 0; }
      else {
        let dirx, diry;
        const l = Math.sqrt(d2);
        // follow the order's path field; cut straight to the assigned spot only once it is close and on the same level
        const f = this.ord[i] >= 0 ? this.orders[this.ord[i]] : null;
        let k = f && d2 > 30 ? f.dir[c] : 255;
        const te = this.elev[this.map.cellOf(this.tx[i], this.ty[i])];
        if (eg === 2 && te === 2 && d2 > 16) {
          // along the Hornburg's curtain wall: walk round the ring rather than straight across the court
          const ux = x - KEEP.cx, uy = y - KEEP.cy, ur = Math.sqrt(ux * ux + uy * uy) || 1;
          let da = Math.atan2(this.ty[i] - KEEP.cy, this.tx[i] - KEEP.cx) - Math.atan2(uy, ux);
          if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
          const sg = da > 0 ? 1 : -1, rc = (Math.hypot(this.tx[i] - KEEP.cx, this.ty[i] - KEEP.cy) - ur) * 0.35;
          dirx = (-uy / ur) * sg + (ux / ur) * rc; diry = (ux / ur) * sg + (uy / ur) * rc;
          const dl = Math.sqrt(dirx * dirx + diry * diry) || 1; dirx /= dl; diry /= dl;
        } else {
          if (k !== 255 && d2 < 144 && te === eg) k = 255;
          if (k !== 255) { dirx = DXN[k]; diry = DYN[k]; } else { dirx = dx / l; diry = dy / l; }
        }
        this._move(i, dirx, diry, Math.min(d.speed, l / DT), d.cls === C.INF ? 0 : 2, 1);
      }
      if (d.cls !== C.VEH) { if (this.cd[i] > 0) this.cd[i] -= DT; return; }
    }
    const g = this.grp[i];
    const slow = this.gState[g] >= 1 || this.gConf[g] > this.time ? 0.6 : 1;
    const w = d.wdef;
    if (this.cd[i] > 0) this.cd[i] -= DT * slow;
    else if (this.ammo[i] >= 1) this._fire(i, d, w, 0, eg, x, y, c);
    else if (d.cls === C.INF) this._bayonet(i, x, y);
    if (d.w2def) {
      if (this.cd2[i] > 0) this.cd2[i] -= DT * slow;
      else if (this.ammo2[i] >= 1) this._fire(i, d, d.w2def, 1, eg, x, y, c);
    }
  }

  _bayonet(i, x, y) {
    const fx = (x / FINE) | 0, fy = (y / FINE) | 0, el = this.el[i];
    for (let cy = Math.max(0, fy - 1); cy <= Math.min(FH - 1, fy + 1); cy++) for (let cx = Math.max(0, fx - 1); cx <= Math.min(FW - 1, fx + 1); cx++) {
      for (let j = this.head[cy * FW + cx]; j >= 0; j = this.next[j]) {
        if (!this.alive[j] || this.team[j] !== ORC || this.el[j] !== el) continue;
        const dx = this.x[j] - x, dy = this.y[j] - y;
        if (dx * dx + dy * dy < 5.5) {
          this.cd[i] = 1.1; this.rot[i] = Math.atan2(dy, dx); this.fireT[i] = this.time;
          this.damage(j, W.bayonet.dmg, W.bayonet); this.fx.melee(this.x[j], this.y[j], this.unitZ(j) + 1.2);
          return;
        }
      }
    }
    this.cd[i] = 0.3;
  }

  /** Height of whatever surface is at x,y: a standing wall walk, or the ground. */
  surfZ(x, y) {
    const c = this.map.cellOf(x, y);
    return this.elev[c] ? this.segTop[this.mseg[c]] : this.map.groundZ(x, y);
  }

  _fire(i, d, w, slot, eg, x, y, c) {
    const cdA = slot ? this.cd2 : this.cd, el = eg ? 1 : 0;
    const z0 = (eg ? this.segTop[this.mseg[c]] : this.map.groundZ(x, y)) + (d.cls === C.INF ? 1.4 : 2.2);
    if (w.arc) {
      if (this.holdIndirect) { cdA[i] = 0.5; return; }
      if (!this._acquireIndirect(i, w, x, y)) { cdA[i] = 0.6 + this.rand() * 0.8; return; }
      const tx = this.tx[i] + (this.rand() + this.rand() - 1) * w.scatter, ty = this.ty[i] + (this.rand() + this.rand() - 1) * w.scatter;
      const dist = Math.hypot(tx - x, ty - y);
      this.ammo[i]--; cdA[i] = w.reload * (0.9 + 0.25 * this.rand()); this.fireT[i] = this.time; this.stats.shots++;
      const ang = Math.atan2(ty - y, tx - x);
      if (d.cls === C.INF) this.rot[i] = ang; else this.trot[i] = ang;
      this._launch(x, y, z0, tx, ty, this.surfZ(tx, ty), w, DEF, 2, w.flight + dist / 400);
      this.fx.muzzle(x + Math.cos(ang) * d.rad, y + Math.sin(ang) * d.rad, z0 + 0.6, ang, w.flash, 1);
      this.fx.sound(w.snd, x, y, 1);
      return;
    }
    const tA = slot ? this.target2 : this.target;
    const range = el ? w.range * (this.segTop[this.mseg[c]] > 15 ? 1.2 : 1.12) : w.range;
    let t = tA[i], dx = 0, dy = 0, d2 = 0, ok = false;
    if (t >= 0 && this.alive[t] && this.team[t] === ORC) {
      dx = this.x[t] - x; dy = this.y[t] - y; d2 = dx * dx + dy * dy;
      ok = d2 <= range * range && d2 >= (w.min || 0) * (w.min || 0);
    }
    if (!ok) {
      t = this._acquireDirect(i, w, range, eg, x, y);
      tA[i] = t;
      if (t < 0) { cdA[i] = 0.25 + this.rand() * 0.4; return; }
      dx = this.x[t] - x; dy = this.y[t] - y; d2 = dx * dx + dy * dy;
    }
    const dist = Math.sqrt(d2) || 1;
    const ang = Math.atan2(dy, dx);
    if (d.cls === C.VEH) this.trot[i] = ang; else this.rot[i] = ang;
    if (slot) this.ammo2[i]--; else this.ammo[i]--;
    cdA[i] = w.reload * (0.85 + 0.3 * this.rand());
    this.fireT[i] = this.time; this.stats.shots++;
    const mr = d.rad + (d.cls === C.VEH ? 2.5 : 0.7);
    const mx = x + Math.cos(ang) * mr, my = y + Math.sin(ang) * mr;
    this.fx.muzzle(mx, my, z0, ang, w.flash, 0);
    this.fx.sound(w.snd, x, y, 1);
    const xt = this.x[t], yt = this.y[t], zt = this.unitZ(t) + 1;
    if (w.speed) {
      const fl = dist / w.speed, sc = dist * 0.012 + 0.6;
      const tx = xt + this.vx[t] * fl + (this.rand() + this.rand() - 1) * sc, ty = yt + this.vy[t] * fl + (this.rand() + this.rand() - 1) * sc;
      this._launch(mx, my, z0, tx, ty, zt - 1, w, DEF, w.trail ? 1 : w.aoe > 4.5 ? 0 : w.tracer === TR.CANNON ? 6 : 5, Math.max(0.1, fl), w.key === 'gl' ? dist * 0.1 : 0);
      return;
    }
    let acc = w.acc + (w.accFar - w.acc) * (dist / range);
    if (el) acc *= 1.1;
    // cover: the foot of one's own wall is dead ground; solid objects and ditches shield whoever is behind them
    const td = UNITS[this.type[t]];
    if (this.state[t] !== S_CLIMB) {
      const tc = ((yt / CELL) | 0) * GW + ((xt / CELL) | 0);
      if (eg && this.deadG[tc] === eg) acc *= 0.3;
      if (td.sz === 0) {
        const c2 = (((yt - (dy / dist) * 4.5) / CELL) | 0) * GW + (((xt - (dx / dist) * 4.5) / CELL) | 0);
        if (this.cover[c2] | this.dyn[c2] | this.cover[tc]) acc *= el ? 0.7 : 0.5;
        if (this.ob[tc] & OB.MOAT) acc *= el ? 1.15 : 0.45;
      }
    }
    const hit = this.rand() < acc;
    if (hit) this.damage(t, w.dmg, w);
    else if (this.rand() < 0.3) {
      // a miss into a packed formation still finds somebody
      const oc = ((yt / OCS) | 0) * OW + ((xt / OCS) | 0);
      const j = this.ocHead[oc];
      if (j >= 0 && j !== t && this.ocCount[oc] > 12) this.damage(j, w.dmg, w);
    }
    if (w.multi && this.rand() < w.multi) { const j = this.cnext[t]; if (j >= 0 && this.alive[j] && this.team[j] === ORC) this.damage(j, w.dmg, w); }
    if (hit) this.fx.tracer(mx, my, z0, xt, yt, zt, w.tracer, 1);
    else {
      const ex = xt + (dx / dist) * 22 + (this.rand() - 0.5) * 5, ey = yt + (dy / dist) * 22 + (this.rand() - 0.5) * 5;
      this.fx.tracer(mx, my, z0, ex, ey, this.surfZ(ex, ey), w.tracer, 0);
    }
  }

  _randOrcInCell(c) {
    const n = this.ocCount[c];
    if (!n) return -1;
    let k = (this.rand() * n) | 0, j = this.ocHead[c];
    while (k-- > 0 && j >= 0) j = this.cnext[j];
    return j >= 0 && this.alive[j] ? j : -1;
  }

  _randOrcNear(cx, cy, r) {
    for (let k = 0; k < 10; k++) {
      const a = this.rand() * 6.2832, rr = r * Math.sqrt(this.rand());
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) continue;
      const j = this._randOrcInCell(((y / OCS) | 0) * OW + ((x / OCS) | 0));
      if (j >= 0) return j;
    }
    return -1;
  }

  _acquireDirect(i, w, range, eg, x, y) {
    if (x - this.orcMaxX > range) return -1; // the whole horde is still out of reach
    const r2 = range * range, m2 = (w.min || 0) * (w.min || 0), el = eg ? 1 : 0;
    const f = this.focus;
    if (f) {
      const dx = f.x - x, dy = f.y - y, rr = range + f.r;
      if (dx * dx + dy * dy < rr * rr) {
        for (let k = 0; k < 3; k++) {
          const j = this._randOrcNear(f.x, f.y, f.r);
          if (j < 0) break;
          const ex = this.x[j] - x, ey = this.y[j] - y, e2 = ex * ex + ey * ey;
          if (e2 <= r2 && e2 >= m2 && (!w.prefOnly || (UNITS[this.type[j]].hvt & w.pref)) && (el || this.el[j] || this._los(x, y, this.x[j], this.y[j]))) return j;
        }
      }
    }
    if (w.pref) {
      let best = -1, bs = 1e18;
      const hv = this.hvt;
      for (let k = 0; k < hv.length; k++) {
        const j = hv[k];
        if (!this.alive[j]) continue;
        const td = UNITS[this.type[j]];
        if (!(td.hvt & w.pref)) continue;
        const ex = this.x[j] - x, ey = this.y[j] - y, e2 = ex * ex + ey * ey;
        if (e2 > r2 || e2 < m2) continue;
        const sc = e2 * (0.5 + this.rand()) * (td.pri || 1);
        if (sc < bs && (el || this.el[j] || this._los(x, y, this.x[j], this.y[j]))) { bs = sc; best = j; }
      }
      if (best >= 0 || w.prefOnly) return best;
    }
    const cx = (x / OCS) | 0, cy = (y / OCS) | 0, maxR = Math.ceil(range / OCS);
    const cand = this._cand, oc = this.ocCount;
    let found = 0, firstR = -1;
    for (let r = 0; r <= maxR; r++) {
      if (firstR >= 0 && r > firstR + 1) break;
      for (let oy = -r; oy <= r; oy++) {
        const yy = cy + oy; if (yy < 0 || yy >= OH) continue;
        const step = (oy === -r || oy === r || r === 0) ? 1 : 2 * r;
        for (let ox = -r; ox <= r; ox += step) {
          const xx = cx + ox; if (xx < 0 || xx >= OW) continue;
          if (oc[yy * OW + xx] > 0) { if (found < 24) cand[found++] = yy * OW + xx; if (firstR < 0) firstR = r; }
        }
      }
    }
    if (!found) return -1;
    let fallback = -1;
    for (let k = 0; k < 5; k++) {
      const j = this._randOrcInCell(cand[(this.rand() * found) | 0]);
      if (j < 0) continue;
      const ex = this.x[j] - x, ey = this.y[j] - y, e2 = ex * ex + ey * ey;
      if (e2 > r2 || e2 < m2) continue;
      if (!(el || this.el[j] || this._los(x, y, this.x[j], this.y[j]))) continue;
      // prefer targets that are not tucked in under one's own wall
      if (eg && !w.speed && this.deadG[((this.y[j] / CELL) | 0) * GW + ((this.x[j] / CELL) | 0)] === eg && this.state[j] !== S_CLIMB) { fallback = j; continue; }
      return j;
    }
    return fallback;
  }

  _acquireIndirect(i, w, x, y) {
    const r2 = w.range * w.range, m2 = w.min * w.min;
    const f = this.focus;
    if (f) {
      const dx = f.x - x, dy = f.y - y, d2 = dx * dx + dy * dy;
      if (d2 <= r2 && d2 >= m2) {
        const a = this.rand() * 6.2832, rr = f.r * Math.sqrt(this.rand()) * 0.8;
        this.tx[i] = f.x + Math.cos(a) * rr; this.ty[i] = f.y + Math.sin(a) * rr;
        return true;
      }
    }
    const x0 = Math.max(0, ((x - w.range) / OCS) | 0), x1 = Math.min(OW - 1, ((x + w.range) / OCS) | 0);
    const y0 = Math.max(0, ((y - w.range) / OCS) | 0), y1 = Math.min(OH - 1, ((y + w.range) / OCS) | 0);
    const oc = this.ocCount, dg = this.danger, lim = w.aoe > 16 ? 0 : 1;
    let best = -1, bs = 3;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const c = yy * OW + xx, n = oc[c];
      if (n < 3 || dg[c] > lim) continue;
      const dx = xx * OCS + 8 - x, dy = yy * OCS + 8 - y, d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 < m2) continue;
      const sc = n * (0.45 + this.rand());
      if (sc > bs) { bs = sc; best = c; }
    }
    if (best < 0) return false;
    const j = this.ocHead[best];
    const fl = w.flight * 0.8;
    this.tx[i] = (best % OW) * OCS + 8 + (j >= 0 ? this.vx[j] * fl : 0);
    this.ty[i] = ((best / OW) | 0) * OCS + 8 + (j >= 0 ? this.vy[j] * fl : 0);
    return true;
  }

  // -------------------------------------------------- ordnance in flight
  // vis: 0 shell, 1 rocket, 2 mortar bomb, 3 rock, 4 aerial bomb, 5 grenade, 6 cannon round
  _launch(x0, y0, z0, x1, y1, z1, w, team, vis, T, arcH) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    if (arcH === undefined) arcH = w.arc ? Math.min(110, 16 + dist * 0.22) : 0;
    this.projectiles.push({ x0, y0, z0, x1, y1, z1, t: 0, T, w, team, vis, arcH, x: x0, y: y0, z: z0, px: x0, py: y0, pz: z0, rot: Math.atan2(y1 - y0, x1 - x0) });
  }

  _projectiles() {
    const ps = this.projectiles;
    let k = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.t += DT;
      const u = p.t / p.T;
      if (u >= 1) { this.explode(p.x1, p.y1, p.w.aoe, p.w.dmg, p.w, p.team, !!p.w.ff); continue; }
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x = p.x0 + (p.x1 - p.x0) * u; p.y = p.y0 + (p.y1 - p.y0) * u;
      p.z = p.z0 + (p.z1 - p.z0) * u + p.arcH * 4 * u * (1 - u);
      if (p.vis === 1 || p.vis === 2 || p.vis === 4) this.fx.trail(p.x, p.y, p.z, p.vis);
      ps[k++] = p;
    }
    ps.length = k;
  }

  explode(x, y, r, dmg, w, team, ff) {
    const z = this.surfZ(x, y);
    this.fx.explosion(x, y, z, r, w.fxk || 0);
    const x0 = Math.max(0, ((x - r) / FINE) | 0), x1 = Math.min(FW - 1, ((x + r) / FINE) | 0);
    const y0 = Math.max(0, ((y - r) / FINE) | 0), y1 = Math.min(FH - 1, ((y + r) / FINE) | 0);
    const r2 = r * r, enemy = team === DEF ? ORC : DEF;
    const high = this.elev[this.map.cellOf(x, y)] ? 1 : 0;
    this._bx = x; this._by = y; this._bp = r;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      for (let j = this.head[cy * FW + cx]; j >= 0; j = this.next[j]) {
        if (!this.alive[j] || (!ff && this.team[j] !== enemy)) continue;
        const dx = this.x[j] - x, dy = this.y[j] - y, d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        // fragmentation is patchy: small targets are either caught or spared, big ones soak the blast
        const f = 1 - Math.sqrt(d2) / r;
        let dm;
        if (this.rad[j] > 1) dm = dmg * (0.25 + 0.75 * f);
        else if (this.rand() < f * f * 1.15) dm = dmg * (0.6 + 0.4 * f);
        else continue;
        // a wall between the burst and the target takes most of it
        if (this.el[j] !== high && this.state[j] !== S_CLIMB && r < 15) dm *= 0.35;
        if (this.team[j] === DEF) { if (team === ORC && this.el[j]) dm *= 0.6; else if (team === DEF) dm *= 0.7; }
        this.damage(j, dm, w);
      }
    }
    this._bx = NaN;
    if (w.sdmg) { const s = this.mseg[this.map.cellOf(x, y)]; if (s >= 0) this.damageSeg(s, w.sdmg); }
    if (r >= 5) {
      // blast clears wire
      const gx0 = Math.max(0, ((x - r) / CELL) | 0), gx1 = Math.min(GW - 1, ((x + r) / CELL) | 0), gy0 = Math.max(0, ((y - r) / CELL) | 0), gy1 = Math.min(GH - 1, ((y + r) / CELL) | 0);
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) { const c = gy * GW + gx; if ((this.ob[c] & OB.WIRE) && (this.wireHp[c] -= 300) <= 0) this._clearOb(c, OB.WIRE); }
    }
  }

  _claymores() {
    const cl = this.clays, R2 = W.claymore.range * W.claymore.range;
    for (let n = cl.length - 1; n >= 0; n--) {
      const m = cl[n];
      const x0 = Math.max(0, ((m.x - 44) / OCS) | 0), x1 = Math.min(OW - 1, ((m.x + 44) / OCS) | 0), y0 = Math.max(0, ((m.y - 44) / OCS) | 0), y1 = Math.min(OH - 1, ((m.y + 44) / OCS) | 0);
      let cnt = 0, near = false;
      for (let yy = y0; yy <= y1 && !near; yy++) for (let xx = x0; xx <= x1; xx++) {
        for (let j = this.ocHead[yy * OW + xx]; j >= 0; j = this.cnext[j]) {
          const dx = this.x[j] - m.x, dy = this.y[j] - m.y, d2 = dx * dx + dy * dy;
          if (d2 > R2 * 0.45) continue;
          const dot = dx * m.dx + dy * m.dy;
          if (dot > 0 && dot * dot > d2 * 0.67) { cnt++; if (d2 < 81) near = true; }
        }
      }
      if (cnt < 7 && !near) continue;
      this.fx.claymore(m.x, m.y, this.map.groundZ(m.x, m.y) + 0.4, m.dx, m.dy);
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
        for (let j = this.ocHead[yy * OW + xx]; j >= 0; j = this.cnext[j]) {
          if (!this.alive[j]) continue;
          const dx = this.x[j] - m.x, dy = this.y[j] - m.y, d2 = dx * dx + dy * dy;
          if (d2 > R2) continue;
          const dot = dx * m.dx + dy * m.dy;
          if (dot <= 0 || dot * dot < d2 * 0.67) continue;
          if (this.rand() < 0.9 - Math.sqrt(d2) * 0.014) this.damage(j, W.claymore.dmg, W.claymore);
        }
      }
      m.prop.alive = 0; this.propVersion++;
      cl.splice(n, 1);
    }
  }

  // ------------------------------------------------------ player orders
  setFocus(x, y, r) {
    this.focus = { x, y, r: Math.max(18, r), until: this.time + 30 };
    for (let i = 0; i < this.n; i++) if (this.alive[i] && this.team[i] === DEF) { this.target[i] = -1; this.target2[i] = -1; }
  }
  clearFocus() { this.focus = null; }

  /** Path field for an order. `x` may be a list of destination cells instead of a point. */
  _orderField(x, y, veh, r = 14) {
    const cost = new Uint16Array(GW * GH), mt = this.mtype;
    for (let c = 0; c < cost.length; c++) cost[c] = mt[c] === T.CLIFF || (veh && (this.elevD[c] || mt[c] === T.STAIR || (this.ob[c] & (OB.AV | OB.MOAT)))) ? 0 : 10;
    let ns = 1;
    if (Array.isArray(x)) { ns = Math.min(x.length, this.srcBuf.length); for (let k = 0; k < ns; k++) this.srcBuf[k] = x[k]; if (!ns) return -1; }
    else { const c = this.map.cellOf(x, y); if (!cost[c]) return -1; this.srcBuf[0] = c; }
    const dir = new Uint8Array(GW * GH);
    this.solver.solve(cost, this.srcBuf, ns, dir, veh ? this.navVeh : this.navDef);
    const idx = this.orderSeq++ % 12;
    this.orders[idx] = { dir, x, y, r };
    for (let i = 0; i < this.n; i++) if (this.ord[i] === idx) this.ord[i] = -1;
    return idx;
  }

  /** Move the given defenders to x,y in a compact block. */
  orderMove(ids, x, y) {
    const inf = [], veh = [];
    for (const i of ids) {
      if (!this.alive[i] || this.team[i] !== DEF) continue;
      const d = UNITS[this.type[i]];
      if (!d.speed) continue;
      (d.cls === C.VEH ? veh : inf).push(i);
    }
    let any = false;
    const te = this.elevD[this.map.cellOf(x, y)];
    for (const [list, isVeh] of [[inf, false], [veh, true]]) {
      if (!list.length) continue;
      const sp = isVeh ? 11 : 2.3;
      const cols = Math.ceil(Math.sqrt(list.length));
      const fi = this._orderField(x, y, isVeh, cols * sp * 0.75 + 10);
      if (fi < 0) continue;
      let k = 0;
      for (let s = 0; s < list.length * 8 && k < list.length; s++) {
        const cx = (s % cols) - (cols - 1) / 2, cy = Math.floor(s / cols) - (cols - 1) / 2;
        const px = x + cx * sp, py = y + cy * sp;
        if (px < 4 || py < 4 || px > WORLD_W - 4 || py > WORLD_H - 4) continue;
        const pc = this.map.cellOf(px, py);
        // keep the whole block on the level that was clicked (all on the wall walk, or all on the ground)
        if (this.mtype[pc] === T.CLIFF || this.elevD[pc] !== te || (isVeh && (this.mtype[pc] === T.STAIR || (this.ob[pc] & (OB.AV | OB.MOAT))))) continue;
        const i = list[k++];
        this.tx[i] = px; this.ty[i] = py; this.state[i] = S_MOVE; this.ord[i] = fi; this.target[i] = -1;
        this.aux[i] = this.time + 30 + Math.hypot(px - this.x[i], py - this.y[i]) / UNITS[this.type[i]].speed * 4;
        any = true;
      }
    }
    return any;
  }

  stop(ids) { for (const i of ids) if (this.alive[i] && this.team[i] === DEF) { this.state[i] = S_IDLE; this.vx[i] = this.vy[i] = 0; } }

  /** Send the listed [distance, unit] pairs to free positions inside the Hornburg. */
  _toKeep(list) {
    if (!list.length) return 0;
    list.sort((a, b) => a[0] - b[0]);
    if (!this._keepField || this.time - this._keepField.t > 2) {
      const ring = [];
      for (let c = 0; c < GW * GH; c++) if (this.elev[c] === 2) ring.push(c);
      this._keepField = { t: this.time, court: this._orderField(KEEP.cx - 20, KEEP.cy + 30, false, 6), ring: this._orderField(ring, 0, false, 6) };
    }
    const kf = this._keepField, slots = this.map.keepSlots;
    let s = this._slotCursor || 0;
    for (const [, i] of list) {
      let slot = null;
      for (let tries = 0; tries < slots.length && !slot; tries++) {
        const q = slots[s++ % slots.length];
        const c = ((q.y / DCS) | 0) * DW + ((q.x / DCS) | 0);
        let occ = false;
        for (let j = this.dcHead[c]; j >= 0; j = this.cnext[j]) { const dx = this.x[j] - q.x, dy = this.y[j] - q.y; if (dx * dx + dy * dy < 1.2) { occ = true; break; } }
        if (!occ) slot = q;
      }
      if (!slot) slot = { x: KEEP.cx - 20 + (this.rand() - 0.5) * 60, y: KEEP.cy + 30 + (this.rand() - 0.5) * 40 };
      this.tx[i] = slot.x; this.ty[i] = slot.y; this.state[i] = S_MOVE; this.target[i] = -1;
      this.ord[i] = this.elev[this.map.cellOf(slot.x, slot.y)] === 2 ? kf.ring : kf.court;
      this.aux[i] = this.time + 40 + Math.hypot(slot.x - this.x[i], slot.y - this.y[i]) / UNITS[this.type[i]].speed * 4;
    }
    this._slotCursor = s % slots.length;
    return list.length;
  }

  /** Fall back: every foot soldier outside the Hornburg runs for its walls. */
  orderRetreat() {
    const list = [];
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.team[i] !== DEF) continue;
      const d = UNITS[this.type[i]];
      if (d.cls !== C.INF || !d.speed) continue;
      const dk = Math.hypot(this.x[i] - KEEP.cx, this.y[i] - KEEP.cy);
      if (dk > KEEP.r + 6) list.push([dk, i]);
    }
    if (!list.length) return 0;
    this._toKeep(list);
    this.retreated = true;
    this.events.push({ type: 'banner', text: 'Fall back to the keep!', cls: 'warn', x: KEEP.cx, y: KEEP.cy });
    return list.length;
  }

  // -------------------------------------------------------------- outcome
  _checkEnd() {
    if (this.defCombat <= 0) return this._finish(false, 'The garrison has been wiped out.');
    if (this.count[ORC] <= 0) return this._finish(true, this.routing || this.stats.fled > this.initial[ORC] * 0.2 ? 'The horde has broken and fled the valley.' : 'The horde has been annihilated.');
    if (this.routing) { if (this.time > this.routT + 14) this._finish(true, 'The horde has broken and fled the valley.'); return; }
    if (this.opt.rout > 0 && this.count[ORC] <= this.initial[ORC] * this.opt.rout) {
      this.routing = true; this.routT = this.time;
      for (let i = 0; i < this.n; i++) if (this.alive[i] && this.team[i] === ORC && this.state[i] !== S_DONE && this.state[i] !== S_CLIMB) this.state[i] = S_FLEE;
      this.events.push({ type: 'banner', text: 'The horde breaks — they are running!', cls: 'good' });
      return;
    }
    if (this.opt.dawn > 0 && this.time >= this.opt.dawn) this._finish(true, 'Dawn. The relief column crests the ridge — you held the Deep.');
  }

  _finish(win, reason) {
    this.result = { win, reason, time: this.time };
    this.events.push({ type: 'end', win, reason });
  }

  // ------------------------------------------------------------- queries
  /** Cheap fingerprint of the whole battle state, for checking that runs are reproducible. */
  hash() {
    let h = 0x811c9dc5;
    const mix = (v) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
    mix(this.tick); mix(this.count[0]); mix(this.count[1]); mix(this.defCombat);
    for (let i = 0; i < this.n; i++) { if (!this.alive[i]) continue; mix(i); mix(this.x[i] * 16); mix(this.y[i] * 16); mix(this.hp[i]); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  defenderAt(x, y, r) {
    let best = -1, bd = r * r;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.team[i] !== DEF) continue;
      const dx = this.x[i] - x, dy = this.y[i] - y, rr = this.rad[i];
      const d = dx * dx + dy * dy - rr * rr;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
}

Object.assign(Sim.prototype, supportMethods, moraleMethods);
