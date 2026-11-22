// Battle simulation. Pure logic (no DOM) so it can run headless for balance tests.
// Units live in structure-of-arrays typed buffers; visual effects are reported
// through the `fx` interface and UI notifications through `events`.

import { WORLD_W, WORLD_H, CELL, GW, GH, DT, DEF, ORC, T, UNITS, U, WEAPONS, ARMOR_MULT, R, C, TR, SUPPORT, DEFAULT_OPTIONS } from '../config.js';
import { FlowSolver, DXN, DYN } from './flow.js';
import { groupPositions, canPlace } from '../scenarios.js';
import { KEEP } from '../map.js';

export const MAX_UNITS = 1 << 16;
const FINE = 2, FW = WORLD_W / FINE, FH = WORLD_H / FINE; // separation / blast grid
const OCS = 16, OW = WORLD_W / OCS, OH = WORLD_H / OCS;   // coarse grid of attackers
const DCS = 8, DW = WORLD_W / DCS, DH = WORLD_H / DCS;    // coarse grid of defenders

export const S_IDLE = 0, S_MOVE = 1, S_ACT = 2, S_DONE = 3, S_FLEE = 4, S_WAIT = 5;

const NOFX = new Proxy({}, { get: () => () => {} });
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
    this.mtype = map.type; this.mseg = map.seg;

    const N = MAX_UNITS;
    this.alive = new Uint8Array(N); this.team = new Uint8Array(N); this.type = new Uint8Array(N);
    this.state = new Uint8Array(N); this.el = new Uint8Array(N); this.ord = new Int8Array(N).fill(-1);
    this.x = new Float32Array(N); this.y = new Float32Array(N); this.px = new Float32Array(N); this.py = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.rot = new Float32Array(N); this.trot = new Float32Array(N);
    this.sepx = new Float32Array(N); this.sepy = new Float32Array(N);
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

    // fortification state
    this.segs = map.segments.map((s) => ({ ...s, hp: s.maxHp, breached: false, ladders: 0, claimed: 0 }));
    const ns = this.segs.length;
    this.sOpen = new Uint8Array(ns); this.sBreached = new Uint8Array(ns); this.sGroup = new Uint8Array(ns); this.sGate = new Uint8Array(ns);
    this.sLad = new Uint8Array(ns);
    this.sx = new Float32Array(ns); this.sy = new Float32Array(ns); this.snx = new Float32Array(ns); this.sny = new Float32Array(ns);
    this.segs.forEach((s, k) => { this.sGroup[k] = s.group; this.sGate[k] = s.kind === 'gate' || s.kind === 'postern' ? 1 : 0; this.sx[k] = s.x; this.sy[k] = s.y; this.snx[k] = s.nx; this.sny[k] = s.ny; this._syncSeg(k); });
    this.structVersion = 1;

    // navigation
    this.solver = new FlowSolver(GW, GH, CELL);
    this.orcCost = new Uint16Array(GW * GH); this.orcDir = new Uint8Array(GW * GH).fill(255);
    this.gateDir = new Uint8Array(GW * GH).fill(255);
    this.srcBuf = new Int32Array(8192); this.srcMark = new Uint8Array(GW * GH);
    this.wallInfo = { seg: this.mseg, open: this.sOpen, group: this.sGroup, gate: this.sGate, sx: this.sx, sy: this.sy, nx: this.snx, ny: this.sny };
    this.navDirty = true; this.lastNav = -100; this.gateDirty = true;
    this.orders = []; this.orderSeq = 0;

    this.time = 0; this.tick = 0;
    this.projectiles = []; this.aircraft = []; this.timed = []; this.drops = [];
    this.events = [];
    this.focus = null; this.holdIndirect = false; this.retreated = false;
    this.hvt = []; this.caches = [];
    this.count = [0, 0]; this.initial = [0, 0]; this.defCombat = 0;
    this.result = null; this.routing = false; this.routT = 0;
    this.stats = { kills: {}, lostDef: {}, lostOrc: {}, defLostBy: {}, shots: 0, startDef: {}, startOrc: {}, breaches: 0 };
    this.support = {};
    for (const k in SUPPORT) this.support[k] = { left: this.opt.support[k] ?? SUPPORT[k].def, max: this.opt.support[k] ?? SUPPORT[k].def, ready: 0, cd: SUPPORT[k].cd };
    this._cand = new Int32Array(24);
    this.defBox = [0, 0, 0, 0];

    for (const g of setup.groups) {
      const pos = groupPositions(map, g);
      const ti = U[g.type], d = UNITS[ti];
      const n = Math.min(g.count, pos.length / 2);
      const face = d.team === DEF ? Math.PI : 0;
      for (let k = 0; k < n; k++) {
        const i = this.spawn(ti, pos[k * 2], pos[k * 2 + 1], face + (this.rand() - 0.5) * 0.3);
        if (i < 0) break;
        if (d.team === ORC) { this.state[i] = g.delay > 0 ? S_WAIT : S_MOVE; this.aux[i] = g.delay || 0; }
      }
    }
    this.initial[0] = this.defCombat; this.initial[1] = this.count[1];
    for (let i = 0; i < this.n; i++) { const d = UNITS[this.type[i]]; const b = d.team === DEF ? this.stats.startDef : this.stats.startOrc; b[d.key] = (b[d.key] || 0) + 1; }
  }

  // ---------------------------------------------------------------- units
  spawn(ti, x, y, rot = 0) {
    let i;
    if (this.free.length) i = this.free.pop(); else if (this.n < MAX_UNITS) i = this.n++; else return -1;
    const d = UNITS[ti];
    this.alive[i] = 1; this.team[i] = d.team; this.type[i] = ti; this.state[i] = S_IDLE; this.ord[i] = -1;
    this.x[i] = this.px[i] = x; this.y[i] = this.py[i] = y; this.vx[i] = this.vy[i] = 0; this.sepx[i] = this.sepy[i] = 0;
    this.rot[i] = rot; this.trot[i] = rot;
    this.hp[i] = d.hp; this.rad[i] = d.rad;
    this.cd[i] = this.rand() * 1.2; this.cd2[i] = this.rand();
    const am = this.opt.ammoMult;
    this.ammo[i] = d.pool ? d.pool : d.ammo ? (am > 50 ? 1e9 : Math.ceil(d.ammo * am)) : 0;
    this.ammo2[i] = d.ammo2 ? (am > 50 ? 1e9 : d.ammo2 * am) : 0;
    this.target[i] = this.target2[i] = -1; this.aux[i] = 0; this.aux2[i] = -1; this.hitT[i] = -10; this.fireT[i] = -10;
    this.el[i] = this._elev(this.map.cellOf(x, y)) ? 1 : 0;
    this.count[d.team]++;
    if (d.team === DEF && d.cls !== C.CACHE) this.defCombat++;
    return i;
  }

  maxAmmo(i) { const d = UNITS[this.type[i]]; return d.pool ? d.pool : Math.ceil((d.ammo || 0) * Math.min(this.opt.ammoMult, 50)); }

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
    const d = UNITS[this.type[i]], team = d.team;
    this.count[team]--;
    const key = w ? w.key : 'other';
    if (team === ORC) {
      this.stats.kills[key] = (this.stats.kills[key] || 0) + 1;
      this.stats.lostOrc[d.key] = (this.stats.lostOrc[d.key] || 0) + 1;
      if (d.role === R.LADDER) {
        const k = this.aux2[i];
        if (k >= 0) { if (this.state[i] === S_DONE) { this.segs[k].ladders--; this._syncSeg(k); this.navDirty = true; } else this.segs[k].claimed--; }
      } else if (d.role === R.SAPPER && !silent && this.rand() < 0.4) {
        const x = this.x[i], y = this.y[i];
        this.timed.push({ t: this.time + 0.15, f: () => this.explode(x, y, 16, 520, W.blast, ORC, true) });
      }
    } else {
      if (d.cls !== C.CACHE) {
        this.defCombat--;
        this.stats.lostDef[d.key] = (this.stats.lostDef[d.key] || 0) + 1;
        this.stats.defLostBy[key] = (this.stats.defLostBy[key] || 0) + 1;
      }
    }
    if (!silent) this.fx.death(this.type[i], this.x[i], this.y[i], this.rot[i]);
    this.free.push(i);
  }

  _syncSeg(k) {
    const s = this.segs[k];
    this.sBreached[k] = s.breached ? 1 : 0;
    this.sLad[k] = s.ladders > 0 && !s.breached ? 1 : 0;
    this.sOpen[k] = s.breached || s.ladders > 0 || s.stairs ? 1 : 0;
  }

  _elev(c) { const s = this.mseg[c]; return s >= 0 && !this.sBreached[s]; }

  orcCanEnter(cf, ct, big) {
    if (this.mtype[ct] === T.CLIFF) return false;
    const st = this.mseg[ct];
    if (st < 0 || this.sBreached[st]) return true;
    if (big) return false;
    if (this.sOpen[st]) return true;
    const sf = this.mseg[cf];
    if (sf >= 0) return this.sGroup[sf] === this.sGroup[st];
    if (this.sGate[st]) return false;
    const cx = (cf % GW) * CELL + CELL / 2, cy = ((cf / GW) | 0) * CELL + CELL / 2;
    return (cx - this.sx[st]) * this.snx[st] + (cy - this.sy[st]) * this.sny[st] < 0;
  }

  defCanEnter(ct, veh) {
    if (this.mtype[ct] === T.CLIFF) return false;
    if (!veh) return true;
    const st = this.mseg[ct];
    return st < 0 || this.sBreached[st] === 1;
  }

  // mode: 0 orc, 1 big orc, 2 defender infantry, 3 defender vehicle
  _move(i, dirx, diry, speed, mode) {
    const x = this.x[i], y = this.y[i];
    const fx = (x / FINE) | 0, fy = (y / FINE) | 0;
    const ph = this.tick + i;
    if ((ph & 1) === 0 && ((ph & 2) === 0 || this.sepx[i] !== 0 || this.sepy[i] !== 0)) {
      let sx = 0, sy = 0, cnt = 0;
      const ri = this.rad[i], head = this.head, next = this.next, X = this.x, Y = this.y, RAD = this.rad;
      const y0 = fy > 0 ? fy - 1 : 0, y1 = fy < FH - 1 ? fy + 1 : FH - 1, x0 = fx > 0 ? fx - 1 : 0, x1 = fx < FW - 1 ? fx + 1 : FW - 1;
      for (let cy = y0; cy <= y1 && cnt < 26; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          for (let j = head[cy * FW + cx]; j >= 0; j = next[j]) {
            if (j === i) continue;
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
    if (mode < 2) {
      const s0 = this.mseg[c0];
      if (s0 >= 0 && this.sLad[s0]) speed *= 0.35;
      else if (this.mtype[c0] === T.WATER || (s0 >= 0 && this.sBreached[s0])) speed *= 0.7;
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
    let blocked = -2;
    const c1 = ((ny / CELL) | 0) * GW + ((nx / CELL) | 0);
    if (c1 !== c0) {
      const ok = mode < 2 ? this.orcCanEnter(c0, c1, mode === 1) : this.defCanEnter(c1, mode === 3);
      if (!ok) {
        blocked = this.mseg[c1];
        const ca = ((y / CELL) | 0) * GW + ((nx / CELL) | 0);
        if (ca === c0 || (mode < 2 ? this.orcCanEnter(c0, ca, mode === 1) : this.defCanEnter(ca, mode === 3))) { ny = y; vy *= 0.3; }
        else {
          const cb = ((ny / CELL) | 0) * GW + ((x / CELL) | 0);
          if (cb === c0 || (mode < 2 ? this.orcCanEnter(c0, cb, mode === 1) : this.defCanEnter(cb, mode === 3))) { nx = x; vx *= 0.3; }
          else { nx = x; ny = y; vx = 0; vy = 0; }
        }
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
      const s = this.mseg[c];
      if (s >= 0 && !this.sBreached[s]) return false;
    }
    return true;
  }

  // ------------------------------------------------------------- grids
  _buildGrids() {
    const { head, ocHead, ocCount, dcHead, dcCount, next, cnext, x, y, alive, team } = this;
    head.fill(-1); ocHead.fill(-1); ocCount.fill(0); dcHead.fill(-1); dcCount.fill(0);
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9, ox1 = -1e9;
    const raised = U.ladder;
    for (let i = 0, n = this.n; i < n; i++) {
      if (!alive[i]) continue;
      const xi = x[i], yi = y[i];
      const f = ((yi / FINE) | 0) * FW + ((xi / FINE) | 0);
      next[i] = head[f]; head[f] = i;
      if (team[i] === ORC) {
        if (this.type[i] === raised && this.state[i] === S_DONE) continue;
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
  }

  _buildAux() {
    const hv = this.hvt, ca = this.caches; hv.length = 0; ca.length = 0;
    const dg = this.danger; dg.fill(0);
    for (let i = 0, n = this.n; i < n; i++) {
      if (!this.alive[i]) continue;
      const d = UNITS[this.type[i]];
      if (d.team === ORC) { if (d.hvt && this.state[i] !== S_DONE) hv.push(i); continue; }
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
    const cost = this.orcCost, mt = this.mtype, ms = this.mseg, cnt = this.navCnt;
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
      if (t === T.CLIFF) { cost[c] = 0; continue; }
      let v = t === T.WATER ? 15 : 10;
      const s = ms[c];
      if (s >= 0) v = this.sBreached[s] ? 16 : this.sLad[s] ? 50 : 12;
      const k = cnt[c];
      cost[c] = v + (k > 8 ? 32 : k * 4);
    }
    if (ns > 0) this.solver.solve(cost, src, ns, this.orcDir, this.wallInfo);
    if (this.gateDirty) {
      this.gateDirty = false;
      const g = this.segs[this.map.GATE];
      for (let c = 0, n = GW * GH; c < n; c++) cost[c] = mt[c] === T.CLIFF || (ms[c] >= 0 && !this.sBreached[ms[c]]) ? 0 : 10;
      src[0] = this.map.cellOf(g.ox - 2, g.oy);
      this.solver.solve(cost, src, 1, this.gateDir, null);
    }
  }

  // --------------------------------------------------------------- step
  step() {
    if (this.result) return;
    this.tick++; this.time += DT;
    this._buildGrids();
    if (this.tick % 5 === 1) this._buildAux();
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

  _orc(i) {
    const d = UNITS[this.type[i]];
    const st = this.state[i];
    if (st === S_WAIT) { if (this.time >= this.aux[i]) this.state[i] = S_MOVE; return; }
    const x = this.x[i], y = this.y[i];
    if (this.cd[i] > 0) this.cd[i] -= DT;
    if (st === S_FLEE) {
      this._move(i, -1, ((i % 9) - 4) * 0.04, d.speed * 1.2, d.big ? 1 : 0);
      if (x < 8) this.kill(i, null, true);
      return;
    }
    const c = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
    const el = this._elev(c) ? 1 : 0;
    this.el[i] = el;
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
                this.cd[i] = w.reload * (0.8 + 0.4 * this.rand());
                this.rot[i] = Math.atan2(dy, dx);
                let acc = w.acc; if (this.el[t] && !el) acc *= 0.22;
                const hit = this.rand() < acc;
                this.fx.tracer(x, y, this.x[t] + (hit ? 0 : (this.rand() - 0.5) * 8), this.y[t] + (hit ? 0 : (this.rand() - 0.5) * 8), TR.ARROW);
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
        if (this._flow(x, y)) this._move(i, this.fdx, this.fdy, d.speed, 0); else this._move(i, 0, 0, 0, 0);
        return;
      }
      case R.MELEE:
      case R.TROLL: {
        if (((this.tick + i) & 3) === 0) { const b = this.defBox; this.target[i] = x > b[0] - 20 && x < b[2] + 20 && y > b[1] - 20 && y < b[3] + 20 ? this._nearDef(i, x, y, el) : -1; }
        const t = this.target[i];
        const big = d.big ? 1 : 0;
        let dirx = 0, diry = 0, direct = false;
        if (t >= 0 && this.alive[t] && this.team[t] === DEF) {
          const dx = this.x[t] - x, dy = this.y[t] - y, d2 = dx * dx + dy * dy;
          const tr = this.rad[t], reach = d.reach + tr;
          if (this.el[t] === el) {
            if (d2 < reach * reach) {
              this.vx[i] *= 0.4; this.vy[i] *= 0.4;
              if (this.cd[i] <= 0) {
                this.cd[i] = d.mreload * (0.85 + 0.3 * this.rand());
                this.rot[i] = Math.atan2(dy, dx);
                const xt = this.x[t], yt = this.y[t];
                if (d.maoe) { this._meleeSweep(xt, yt, d.maoe, d.mdmg, t); this.fx.dust(xt, yt, 3); this.fx.sound('thud', xt, yt, 0.5); }
                else this.fx.melee(xt, yt);
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
        const blk = this._move(i, dirx, diry, d.speed, big);
        if (d.sdmg && blk >= 0 && this.cd[i] <= 0 && this.segs[blk].kind !== 'tower') {
          this.cd[i] = d.mreload * 1.2;
          const s = this.segs[blk];
          this.fx.dust(x + dirx * 3, y + diry * 3, 4); this.fx.sound('thud', x, y, 0.7);
          this.damageSeg(blk, d.sdmg, s);
        }
        return;
      }
      case R.LADDER: {
        if (st === S_DONE) return;
        let k = this.aux2[i];
        if (st === S_ACT) {
          if (this.time >= this.aux[i]) {
            const s = this.segs[k];
            if (s.breached) { this.state[i] = S_MOVE; s.claimed--; this.aux2[i] = -1; return; }
            this.state[i] = S_DONE; s.ladders++; s.claimed--; this._syncSeg(k); this.navDirty = true;
            this.x[i] = s.x + s.nx * (s.half + 1.5); this.y[i] = s.y + s.ny * (s.half + 1.5);
            this.px[i] = this.x[i]; this.py[i] = this.y[i];
            this.rot[i] = Math.atan2(-s.ny, -s.nx);
            this.fx.dust(this.x[i], this.y[i], 3); this.fx.sound('ladder', this.x[i], this.y[i], 0.6);
            if (!this._ladderAnnounced) { this._ladderAnnounced = true; this.events.push({ type: 'banner', text: 'Ladders on the Deeping Wall', cls: 'warn' }); }
          }
          return;
        }
        if (k < 0 || this.segs[k].breached) { if (k >= 0) this.segs[k].claimed--; k = this._pickLadderSeg(y); this.aux2[i] = k; if (k >= 0) this.segs[k].claimed++; }
        if (k < 0) { const f = this.orcDir[c]; if (f !== 255) this._move(i, DXN[f], DYN[f], d.speed, 1); return; }
        const s = this.segs[k];
        const dx = s.ox - x, dy = s.oy - y, l = Math.sqrt(dx * dx + dy * dy);
        if (l < 2.5) { this.state[i] = S_ACT; this.aux[i] = this.time + 4; this.vx[i] = this.vy[i] = 0; this.rot[i] = Math.atan2(-s.ny, -s.nx); return; }
        this._move(i, dx / l, dy / l, d.speed, 1);
        return;
      }
      case R.RAM: {
        const g = this.segs[this.map.GATE];
        if (g.breached) {
          for (let k = 0; k < 8; k++) { const j = this.spawn(U.uruk, x + (this.rand() - 0.5) * 6, y + (this.rand() - 0.5) * 6, this.rot[i]); if (j >= 0) this.state[j] = S_MOVE; }
          this.kill(i, null, true);
          return;
        }
        const dx = g.ox - x, dy = g.oy - y, l = Math.sqrt(dx * dx + dy * dy);
        if (l < 5.5) {
          this.vx[i] = this.vy[i] = 0; this.rot[i] = Math.atan2(-g.ny, -g.nx);
          if (this.cd[i] <= 0) {
            this.cd[i] = 2.5; this.fireT[i] = this.time;
            this.fx.dust(g.ox - g.nx * 3, g.oy, 4); this.fx.sound('ram', g.ox, g.oy, 1);
            this.damageSeg(this.map.GATE, d.sdmg);
          }
          return;
        }
        const k = this.gateDir[c];
        if (k !== 255 && l > 10) this._move(i, DXN[k], DYN[k], d.speed, 1); else this._move(i, dx / l, dy / l, d.speed, 1);
        return;
      }
      case R.SAPPER: {
        let k = this.aux2[i];
        if (st === S_ACT) {
          if ((this.tick & 1) === 0) this.fx.spark(x, y);
          if (this.time >= this.aux[i]) this._detonate(i, k);
          return;
        }
        if (k < 0 || this.segs[k].breached) {
          const cu = this.segs[this.map.CULVERT];
          k = !cu.breached ? this.map.CULVERT : this._pickLadderSeg(y, true);
          this.aux2[i] = k;
        }
        if (k < 0) { const f = this.orcDir[c]; if (f !== 255) this._move(i, DXN[f], DYN[f], d.speed, 0); return; }
        const s = this.segs[k];
        const dx = s.ox - x, dy = s.oy - y, l = Math.sqrt(dx * dx + dy * dy);
        if (l < 3) { this.state[i] = S_ACT; this.aux[i] = this.time + 1.6; this.vx[i] = this.vy[i] = 0; this.fx.sound('fuse', x, y, 0.8); return; }
        if ((this.tick + i) % 6 === 0) this.fx.spark(x, y);
        this._move(i, dx / l, dy / l, d.speed, 0);
        return;
      }
      case R.CATAPULT: {
        const w = d.wdef;
        if (st === S_ACT) {
          if (this.cd[i] > 0) return;
          if (!this._catTarget(i, w)) { this.state[i] = S_MOVE; return; }
          this.cd[i] = w.reload * (0.9 + 0.2 * this.rand()); this.fireT[i] = this.time;
          const tx = this.tx[i], ty = this.ty[i];
          this.rot[i] = Math.atan2(ty - y, tx - x);
          this._launch(x, y, tx + (this.rand() - 0.5) * 2 * w.scatter, ty + (this.rand() - 0.5) * 2 * w.scatter, w, ORC, 3, w.flight);
          this.fx.sound('catapult', x, y, 0.7);
          return;
        }
        if ((this.tick + i) % 10 === 0 && this._catTarget(i, w)) { this.state[i] = S_ACT; this.vx[i] = this.vy[i] = 0; this.cd[i] = 2 + this.rand() * 3; return; }
        const k = this.orcDir[c];
        if (k !== 255) this._move(i, DXN[k], DYN[k], d.speed, 1);
        return;
      }
    }
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
    const x = this.x[i], y = this.y[i];
    this.kill(i, null, true);
    const s = this.segs[k];
    for (let j = k - 1; j <= k + 1; j++) { const q = this.segs[j]; if (q && q.group === s.group && q.kind !== 'tower') this.breachSeg(j, true); }
    this.explode(s.x, s.y, W.blast.aoe, W.blast.dmg, W.blast, ORC, true);
    this.events.push({ type: 'banner', text: s.culvert ? 'The culvert is blown — the Deeping Wall is breached!' : 'The wall is breached!', cls: 'bad' });
  }

  damageSeg(k, dmg) {
    const s = this.segs[k];
    if (s.breached || s.kind === 'tower') return;
    s.hp -= dmg;
    if (s.hp <= 0) {
      this.breachSeg(k);
      const txt = s.kind === 'gate' ? 'The Hornburg gate has fallen!' : s.kind === 'postern' ? 'The postern door is broken!' : 'A wall section has collapsed!';
      this.events.push({ type: 'banner', text: txt, cls: 'bad' });
    }
  }

  breachSeg(k, quiet) {
    const s = this.segs[k];
    if (s.breached) return;
    s.breached = true; s.hp = 0; s.ladders = 0;
    this._syncSeg(k);
    this.navDirty = true; this.gateDirty = true; this.structVersion++; this.stats.breaches++;
    this.fx.breach(s.x, s.y, s.kind === 'gate' || s.kind === 'postern' ? 1 : 0, quiet);
    // raised ladders on this section fall with it
    for (let i = 0; i < this.n; i++) if (this.alive[i] && this.type[i] === U.ladder && this.aux2[i] === k && this.state[i] === S_DONE) { this.aux2[i] = -1; this.kill(i, null); }
  }

  // ---------------------------------------------------------- defenders
  _def(i) {
    const d = UNITS[this.type[i]];
    if (d.cls === C.CACHE) return;
    const x = this.x[i], y = this.y[i];
    const c = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
    const el = this._elev(c) ? 1 : 0;
    this.el[i] = el;
    if (this.state[i] === S_MOVE) {
      const dx = this.tx[i] - x, dy = this.ty[i] - y, d2 = dx * dx + dy * dy;
      if (d2 < 0.6 || this.time > this.aux[i]) { this.state[i] = S_IDLE; this.vx[i] = this.vy[i] = 0; }
      else {
        let dirx, diry;
        const l = Math.sqrt(d2);
        const f = this.ord[i] >= 0 ? this.orders[this.ord[i]] : null;
        const k = f && d2 > 64 ? f.dir[c] : 255;
        if (k !== 255) { dirx = DXN[k]; diry = DYN[k]; } else { dirx = dx / l; diry = dy / l; }
        this._move(i, dirx, diry, Math.min(d.speed, l / DT), d.cls === C.INF ? 2 : 3);
      }
      if (d.cls !== C.VEH) { if (this.cd[i] > 0) this.cd[i] -= DT; return; }
    }
    const w = d.wdef;
    if (this.cd[i] > 0) this.cd[i] -= DT;
    else if (this.ammo[i] >= 1) this._fire(i, d, w, 0, el, x, y);
    else if (d.cls === C.INF) this._bayonet(i, x, y);
    if (d.w2def) {
      if (this.cd2[i] > 0) this.cd2[i] -= DT;
      else if (this.ammo2[i] >= 1) this._fire(i, d, d.w2def, 1, el, x, y);
    }
  }

  _bayonet(i, x, y) {
    const fx = (x / FINE) | 0, fy = (y / FINE) | 0;
    for (let cy = Math.max(0, fy - 1); cy <= Math.min(FH - 1, fy + 1); cy++) for (let cx = Math.max(0, fx - 1); cx <= Math.min(FW - 1, fx + 1); cx++) {
      for (let j = this.head[cy * FW + cx]; j >= 0; j = this.next[j]) {
        if (!this.alive[j] || this.team[j] !== ORC) continue;
        const dx = this.x[j] - x, dy = this.y[j] - y;
        if (dx * dx + dy * dy < 5.5) {
          this.cd[i] = 1.1; this.rot[i] = Math.atan2(dy, dx);
          this.damage(j, W.bayonet.dmg, W.bayonet); this.fx.melee(this.x[j], this.y[j]);
          return;
        }
      }
    }
    this.cd[i] = 0.3;
  }

  _fire(i, d, w, slot, el, x, y) {
    const cdA = slot ? this.cd2 : this.cd;
    if (w.arc) {
      if (this.holdIndirect) { cdA[i] = 0.5; return; }
      if (!this._acquireIndirect(i, w, x, y)) { cdA[i] = 0.6 + this.rand() * 0.8; return; }
      const tx = this.tx[i] + (this.rand() + this.rand() - 1) * w.scatter, ty = this.ty[i] + (this.rand() + this.rand() - 1) * w.scatter;
      const dist = Math.hypot(tx - x, ty - y);
      this.ammo[i]--; cdA[i] = w.reload * (0.9 + 0.25 * this.rand()); this.fireT[i] = this.time; this.stats.shots++;
      const ang = Math.atan2(ty - y, tx - x);
      if (d.cls === C.INF) this.rot[i] = ang; else this.trot[i] = ang;
      this._launch(x, y, tx, ty, w, DEF, 2, w.flight + dist / 400);
      this.fx.muzzle(x + Math.cos(ang) * d.rad, y + Math.sin(ang) * d.rad, ang, w.flash);
      this.fx.sound(w.snd, x, y, 1);
      return;
    }
    const tA = slot ? this.target2 : this.target;
    const range = el ? w.range * 1.12 : w.range;
    let t = tA[i], dx = 0, dy = 0, d2 = 0, ok = false;
    if (t >= 0 && this.alive[t] && this.team[t] === ORC) {
      dx = this.x[t] - x; dy = this.y[t] - y; d2 = dx * dx + dy * dy;
      ok = d2 <= range * range && d2 >= (w.min || 0) * (w.min || 0);
    }
    if (!ok) {
      t = this._acquireDirect(i, w, range, el, x, y);
      tA[i] = t;
      if (t < 0) { cdA[i] = 0.25 + this.rand() * 0.4; return; }
      dx = this.x[t] - x; dy = this.y[t] - y; d2 = dx * dx + dy * dy;
    }
    const dist = Math.sqrt(d2);
    const ang = Math.atan2(dy, dx);
    if (d.cls === C.VEH) this.trot[i] = ang; else this.rot[i] = ang;
    if (slot) this.ammo2[i]--; else this.ammo[i]--;
    cdA[i] = w.reload * (0.85 + 0.3 * this.rand());
    this.fireT[i] = this.time; this.stats.shots++;
    const mr = d.rad + (d.cls === C.VEH ? 2.5 : 0.7);
    const mx = x + Math.cos(ang) * mr, my = y + Math.sin(ang) * mr;
    this.fx.muzzle(mx, my, ang, w.flash);
    this.fx.sound(w.snd, x, y, 1);
    const xt = this.x[t], yt = this.y[t];
    if (w.speed) {
      const fl = dist / w.speed, sc = dist * 0.012 + 0.6;
      const tx = xt + this.vx[t] * fl + (this.rand() + this.rand() - 1) * sc, ty = yt + this.vy[t] * fl + (this.rand() + this.rand() - 1) * sc;
      this._launch(mx, my, tx, ty, w, DEF, w.trail ? 1 : w.aoe > 4.5 ? 0 : 5, Math.max(0.1, fl));
      return;
    }
    let acc = w.acc + (w.accFar - w.acc) * (dist / range);
    if (el) acc *= 1.1;
    const hit = this.rand() < acc;
    if (hit) this.damage(t, w.dmg, w);
    else if (this.rand() < 0.3) {
      // a miss into a packed formation still finds somebody
      const oc = ((yt / OCS) | 0) * OW + ((xt / OCS) | 0);
      const j = this.ocHead[oc];
      if (j >= 0 && j !== t && this.ocCount[oc] > 12) this.damage(j, w.dmg, w);
    }
    if (w.multi && this.rand() < w.multi) { const j = this.cnext[t]; if (j >= 0 && this.alive[j] && this.team[j] === ORC) this.damage(j, w.dmg, w); }
    if (hit) this.fx.tracer(mx, my, xt, yt, w.tracer);
    else this.fx.tracer(mx, my, xt + dx / dist * 25 + (this.rand() - 0.5) * 5, yt + dy / dist * 25 + (this.rand() - 0.5) * 5, w.tracer);
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

  _acquireDirect(i, w, range, el, x, y) {
    if (x - this.orcMaxX > range) return -1; // the whole horde is still out of reach
    const r2 = range * range, m2 = (w.min || 0) * (w.min || 0);
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
        if (!this.alive[j] || !(UNITS[this.type[j]].hvt & w.pref)) continue;
        const ex = this.x[j] - x, ey = this.y[j] - y, e2 = ex * ex + ey * ey;
        if (e2 > r2 || e2 < m2) continue;
        const sc = e2 * (0.5 + this.rand());
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
    for (let k = 0; k < 4; k++) {
      const j = this._randOrcInCell(cand[(this.rand() * found) | 0]);
      if (j < 0) continue;
      const ex = this.x[j] - x, ey = this.y[j] - y, e2 = ex * ex + ey * ey;
      if (e2 > r2 || e2 < m2) continue;
      if (el || this.el[j] || this._los(x, y, this.x[j], this.y[j])) return j;
    }
    return -1;
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
  _launch(x0, y0, x1, y1, w, team, vis, T) {
    this.projectiles.push({ x0, y0, x1, y1, t: 0, T, w, team, vis, arc: w.arc ? 1 : 0, x: x0, y: y0, px: x0, py: y0, h: 0, rot: Math.atan2(y1 - y0, x1 - x0) });
  }

  _projectiles() {
    const ps = this.projectiles;
    let k = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.t += DT;
      const u = p.t / p.T;
      if (u >= 1) { this.explode(p.x1, p.y1, p.w.aoe, p.w.dmg, p.w, p.team, !!p.w.ff); continue; }
      p.px = p.x; p.py = p.y;
      p.x = p.x0 + (p.x1 - p.x0) * u; p.y = p.y0 + (p.y1 - p.y0) * u;
      p.h = p.arc ? 4 * u * (1 - u) : p.vis === 4 ? 1 - u : 0;
      if (p.vis === 1 && (this.tick & 1)) this.fx.trail(p.x, p.y);
      ps[k++] = p;
    }
    ps.length = k;
  }

  explode(x, y, r, dmg, w, team, ff) {
    this.fx.explosion(x, y, r, w.fxk || 0);
    const x0 = Math.max(0, ((x - r) / FINE) | 0), x1 = Math.min(FW - 1, ((x + r) / FINE) | 0);
    const y0 = Math.max(0, ((y - r) / FINE) | 0), y1 = Math.min(FH - 1, ((y + r) / FINE) | 0);
    const r2 = r * r, enemy = team === DEF ? ORC : DEF;
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
        if (this.team[j] === DEF) { if (team === ORC && this.el[j]) dm *= 0.6; else if (team === DEF) dm *= 0.7; }
        this.damage(j, dm, w);
      }
    }
    if (w.sdmg) { const s = this.mseg[this.map.cellOf(x, y)]; if (s >= 0) this.damageSeg(s, w.sdmg); }
  }

  // ---------------------------------------------------------- logistics
  _supply() {
    for (const ci of this.caches) {
      if (!this.alive[ci] || this.ammo[ci] <= 0) continue;
      const x = this.x[ci], y = this.y[ci], R2 = 45 * 45;
      const x0 = Math.max(0, ((x - 45) / DCS) | 0), x1 = Math.min(DW - 1, ((x + 45) / DCS) | 0);
      const y0 = Math.max(0, ((y - 45) / DCS) | 0), y1 = Math.min(DH - 1, ((y + 45) / DCS) | 0);
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
          if (given < 6) this.fx.pickup(this.x[j], this.y[j]);
          if (this.ammo[ci] <= 0) break;
        }
      }
      if (this.ammo[ci] <= 0) { this.kill(ci, null, true); this.events.push({ type: 'log', text: 'An ammo point has run dry', cls: 'warn' }); }
    }
  }

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
  }

  // ------------------------------------------------------ player orders
  canSupport(kind) { const s = this.support[kind]; return s && s.left > 0 && this.time >= s.ready && !this.result; }

  callSupport(kind, x, y, x2 = x, y2 = y) {
    if (!this.canSupport(kind)) return false;
    const s = this.support[kind];
    s.left--; s.ready = this.time + s.cd;
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
        this.timed.push({ t: ti - 0.7, f: () => this._launch(bx - dx * speed * 0.6, by - dy * speed * 0.6, bx, by, W.bomb, DEF, 4, 0.7) });
      }
      this.timed.push({ t: this.time + (sd - 500) / speed, f: () => this.fx.sound('jet', cx, cy, 1) });
      this.events.push({ type: 'log', text: 'Fast air inbound — bombs in 5 seconds', cls: 'good' });
    } else if (kind === 'arty') {
      for (let k = 0; k < 20; k++) {
        const a = rnd() * 6.2832, rr = 45 * Math.sqrt(rnd());
        const tx = x + Math.cos(a) * rr, ty = y + Math.sin(a) * rr;
        this.timed.push({ t: this.time + 4.5 + k * 0.45 + rnd() * 0.3, f: () => { this._launch(tx + 40, ty - 300, tx, ty, W.arty, DEF, 0, 0.6); this.fx.sound('incoming', tx, ty, 0.6); } });
      }
      this.events.push({ type: 'log', text: 'Fire mission — shot, over', cls: 'good' });
    } else if (kind === 'gunship') {
      for (let j = 0; j < 2; j++) {
        const sx = WORLD_W + 150 + j * 90, sy = y - 120 + j * 240;
        this.aircraft.push({ kind: 'helo', x: sx, y: sy, px: sx, py: sy, cx: x, cy: y, phase: j * Math.PI, rot: Math.PI, t: 0, st: 0, until: 0, gcd: 0, rcd: 1 + j });
      }
      this.fx.sound('helo', x, y, 1);
      this.events.push({ type: 'log', text: 'Gunships on station in moments', cls: 'good' });
    } else if (kind === 'supply') {
      const sp = 115, sd = 650;
      this.aircraft.push({ kind: 'cargo', x: x + sd, y: y, px: x + sd, py: y, vx: -sp, vy: 0, rot: Math.PI, t: 0, life: (sd + x + 300) / sp });
      this.timed.push({ t: this.time + sd / sp, f: () => { for (let k = 0; k < 2; k++) this.drops.push({ x: x + (k ? 9 : -9), y: y + (rnd() - 0.5) * 14, t: 0, T: 5.5 }); } });
      this.fx.sound('cargo', x, y, 1);
      this.events.push({ type: 'log', text: 'Resupply bird inbound', cls: 'good' });
    } else if (kind === 'reinforce') {
      const sx = WORLD_W + 200, sy = y + 50;
      this.aircraft.push({ kind: 'transport', x: sx, y: sy, px: sx, py: sy, cx: x, cy: y, rot: Math.PI, t: 0, st: 0, until: 0, dropped: 0 });
      this.fx.sound('helo', x, y, 1);
      this.events.push({ type: 'log', text: 'Air assault platoon inbound', cls: 'good' });
    }
    return true;
  }

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
                this.fx.tracer(a.x, a.y, tx, ty, TR.CANNON); this.fx.sound('autocannon', a.x, a.y, 0.7);
                this.explode(tx, ty, W.heli_gun.aoe, W.heli_gun.dmg, W.heli_gun, DEF, false);
              }
            }
            if ((a.rcd -= DT) <= 0) {
              a.rcd = 2.2;
              const t = this._randOrcNear(a.cx, a.cy, 150);
              if (t >= 0) { this._launch(a.x, a.y, this.x[t], this.y[t], W.heli_rkt, DEF, 1, 0.9); this.fx.sound('rocket', a.x, a.y, 0.8); }
            }
          } else if (a.dropped < 30 && this.tick % 2 === 0) {
            const mix = ['rifle', 'rifle', 'rifle', 'rifle', 'rifle', 'mg', 'rifle', 'rifle', 'rifle', 'marksman', 'rifle', 'rifle', 'at', 'rifle', 'rifle'];
            const ti = U[mix[a.dropped % mix.length]], d = UNITS[ti];
            const ang = a.dropped * 2.4, rr = 3 + Math.sqrt(a.dropped) * 2.4;
            const ux = a.cx + Math.cos(ang) * rr, uy = a.cy + Math.sin(ang) * rr;
            if (canPlace(this.map, d, ux, uy, null)) { this.spawn(ti, ux, uy, Math.PI); this.fx.dust(ux, uy, 1.5); }
            a.dropped++;
          }
          if (this.time >= a.until) a.st = 2;
        } else {
          fly(WORLD_W + 400, a.cy - 100);
          keep = a.x < WORLD_W + 300;
        }
      }
      if (keep) list[k++] = a;
    }
    list.length = k;
  }

  _drops() {
    let k = 0;
    for (const dr of this.drops) {
      dr.t += DT;
      if (dr.t >= dr.T) {
        let { x, y } = dr;
        for (let a = 0; a < 12 && !canPlace(this.map, UNITS[U.crate], x, y); a++) { x = dr.x + Math.cos(a) * (6 + a * 2); y = dr.y + Math.sin(a) * (6 + a * 2); }
        this.spawn(U.crate, x, y, this.rand() * 6.28);
        this.fx.dust(x, y, 3);
      } else this.drops[k++] = dr;
    }
    this.drops.length = k;
  }

  setFocus(x, y, r) {
    this.focus = { x, y, r: Math.max(18, r), until: this.time + 30 };
    for (let i = 0; i < this.n; i++) if (this.alive[i] && this.team[i] === DEF) { this.target[i] = -1; this.target2[i] = -1; }
  }
  clearFocus() { this.focus = null; }

  _orderField(x, y, veh) {
    const cost = new Uint16Array(GW * GH), mt = this.mtype, ms = this.mseg;
    for (let c = 0; c < cost.length; c++) cost[c] = mt[c] === T.CLIFF || (veh && ms[c] >= 0 && !this.sBreached[ms[c]]) ? 0 : 10;
    const c = this.map.cellOf(x, y);
    if (!cost[c]) return -1;
    const dir = new Uint8Array(GW * GH);
    this.srcBuf[0] = c;
    this.solver.solve(cost, this.srcBuf, 1, dir, null);
    const idx = this.orderSeq++ % 12;
    this.orders[idx] = { dir };
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
    for (const [list, isVeh] of [[inf, false], [veh, true]]) {
      if (!list.length) continue;
      const fi = this._orderField(x, y, isVeh);
      if (fi < 0) continue;
      const sp = isVeh ? 11 : 2.3;
      const cols = Math.ceil(Math.sqrt(list.length));
      let k = 0;
      for (let s = 0; s < list.length * 6 && k < list.length; s++) {
        const cx = (s % cols) - (cols - 1) / 2, cy = Math.floor(s / cols) - (cols - 1) / 2;
        const px = x + cx * sp, py = y + cy * sp;
        if (px < 4 || py < 4 || px > WORLD_W - 4 || py > WORLD_H - 4 || !this.defCanEnter(this.map.cellOf(px, py), isVeh)) continue;
        const i = list[k++];
        this.tx[i] = px; this.ty[i] = py; this.state[i] = S_MOVE; this.ord[i] = fi; this.aux[i] = this.time + 400; this.target[i] = -1;
        any = true;
      }
    }
    return any;
  }

  stop(ids) { for (const i of ids) if (this.alive[i] && this.team[i] === DEF) { this.state[i] = S_IDLE; this.vx[i] = this.vy[i] = 0; } }

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
    list.sort((a, b) => a[0] - b[0]);
    const fi = this._orderField(KEEP.cx - 40, KEEP.cy, false);
    const slots = this.map.keepSlots;
    // skip slots that already have someone standing on them
    let s = 0;
    for (const [, i] of list) {
      let slot = null;
      while (s < slots.length) {
        const q = slots[s++];
        const c = ((q.y / DCS) | 0) * DW + ((q.x / DCS) | 0);
        let occ = false;
        for (let j = this.dcHead[c]; j >= 0; j = this.cnext[j]) { const dx = this.x[j] - q.x, dy = this.y[j] - q.y; if (dx * dx + dy * dy < 1.2) { occ = true; break; } }
        if (!occ) { slot = q; break; }
      }
      if (!slot) slot = { x: KEEP.cx + (this.rand() - 0.5) * 120, y: KEEP.cy + (this.rand() - 0.5) * 120 };
      this.tx[i] = slot.x; this.ty[i] = slot.y; this.state[i] = S_MOVE; this.ord[i] = fi; this.aux[i] = this.time + 600; this.target[i] = -1;
    }
    this.retreated = true;
    this.events.push({ type: 'banner', text: 'Fall back to the keep!', cls: 'warn' });
    return list.length;
  }

  // -------------------------------------------------------------- outcome
  _checkEnd() {
    if (this.defCombat <= 0) return this._finish(false, 'The garrison has been wiped out.');
    if (this.count[ORC] <= 0) return this._finish(true, this.routing ? 'The horde has broken and fled the valley.' : 'The horde has been annihilated.');
    if (this.routing) { if (this.time > this.routT + 14) this._finish(true, 'The horde has broken and fled the valley.'); return; }
    if (this.opt.rout > 0 && this.count[ORC] <= this.initial[ORC] * this.opt.rout) {
      this.routing = true; this.routT = this.time;
      for (let i = 0; i < this.n; i++) if (this.alive[i] && this.team[i] === ORC && this.state[i] !== S_DONE) this.state[i] = S_FLEE;
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
  defendersInRect(x0, y0, x1, y1) {
    const out = [];
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.team[i] !== DEF) continue;
      if (UNITS[this.type[i]].cls === C.CACHE) continue;
      const x = this.x[i], y = this.y[i];
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push(i);
    }
    return out;
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
