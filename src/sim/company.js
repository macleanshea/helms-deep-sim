// Companies in formation. Mixed into Sim.prototype.
//
// The horde's foot and cavalry are drawn up in companies of about a hundred. A company on the march
// is a box, not a stream of individuals: it has an anchor at the middle of its front rank, a heading,
// a frontage and a depth, and every soldier keeps his own place in the box (how far across it, how
// far back). The anchor walks toward the company's aim, a stretch of the objective's frontage that
// is its own, and the soldiers keep their places; the box turns no faster than a line of men can
// wheel, waits for men who are held up (at wire, in a defile), narrows and deepens where the ground
// is narrow, closes up when shields are locked and opens out under shellfire, and shrinks as men
// fall. Close to its objective, or with an enemy at hand, the company breaks ranks and each man
// fights for himself (the press at a ladder's foot is a crowd, as it should be).
//
// Modes: 0 no formation (singles, engines, trolls, captains), 1 marching, 2 loose (every man for
// himself), 3 standing (halted in ranks at a stand-off: crossbows at volley range).
//
// Why: a path field sends every man down the one cheapest path, and a company following it collapses
// into a single file within a hundred meters. That is not how a host crosses a field, and it makes
// the horde a far better target than it should be.

import { CELL, GW, GH, DT, ORC, T, OB, UNITS, U, R, WORLD_W, WORLD_H } from '../config.js';
import { N_WALL } from '../map.js';

const MAXG = 4096;
export const F_NONE = 0, F_MARCH = 1, F_LOOSE = 2, F_STAND = 3;
const LOOSE_AT = 55;        // a company breaks ranks this far from its aim (m)
const VOLLEY_AT = 84;       // crossbows halt this far from what they mean to shoot at
const SIGHT = 420;          // how far off a company makes out troops standing in the open
const DCS = 8, DW = WORLD_W / DCS, DH = WORLD_H / DCS; // the defender grid (must match sim.js)

export const companyMethods = {
  _initCompanies() {
    const f = () => new Float32Array(MAXG);
    this.gForm = new Uint8Array(MAXG); this.gFree = new Uint8Array(MAXG);
    this.gAx = f(); this.gAy = f(); this.gHx = f().fill(1); this.gHy = f(); this.gDx = f().fill(1); this.gDy = f();
    this.gHalfW = f(); this.gHalfW0 = f(); this.gDepth = f(); this.gDepth0 = f(); this.gWLim = f().fill(1e9); this.gShift = f();
    this.gAimX = f().fill(-1); this.gAimY = f(); this.gAimU = f().fill(-1); this.gStand = f(); this.gSpd = f(); this.gPace = f().fill(1); this.gDress = f().fill(1); this.gSeenD = f().fill(1e9);
    this.gWaitT = f(); this.gFormT = f(); this.gFireT = f(); this.gSeenT = f().fill(-100); this.gHold = new Uint8Array(MAXG); this.gStallT = f().fill(-1);
    // roll-call of the men in ranks: how far behind their places they are, on average (this tick / last tick)
    this.fAcc = f(); this.fN = new Int32Array(MAXG); this.fAccF = f(); this.fNF = new Int32Array(MAXG); this.gLag = f();
    this.fu = new Float32Array(this.alive.length); this.fv = new Float32Array(this.alive.length);
    this.gapX = new Float32Array(this.alive.length); this.gapY = new Float32Array(this.alive.length); this.gapT = new Float32Array(this.alive.length);
    this.aimDirty = false;
  },

  /** Is a unit of this kind drawn up in a company? */
  _formable(d) { return d.team === ORC && !d.sz && !d.cmd && !d.crew && (d.role === R.MELEE || d.role === R.ARCHER); },

  /**
   * Split `n` places (x, y pairs in `pos`) of a formation laid along the unit vector (ux, uy) into companies:
   * blocks side by side, and one behind another when the formation is deep. Returns a list of index lists.
   */
  _companySplit(d, pos, n, ux, uy, cx, cy) {
    const max = d.role === R.ARCHER || d.key === 'uruk' ? 110 : 45;
    const ids = Array.from({ length: n }, (_, k) => k);
    if (n <= max) return [ids];
    const a = new Float32Array(n), p = new Float32Array(n);
    let a0 = 1e9, a1 = -1e9;
    for (let k = 0; k < n; k++) { const dx = pos[k * 2] - cx, dy = pos[k * 2 + 1] - cy; a[k] = dx * ux + dy * uy; p[k] = -dx * uy + dy * ux; if (a[k] < a0) a0 = a[k]; if (a[k] > a1) a1 = a[k]; }
    const nc = Math.ceil(n / max), front = Math.min(max, 110) / 5 * d.spacing;
    const across = Math.max(1, Math.min(nc, Math.round((a1 - a0) / front))), deep = Math.ceil(nc / across);
    ids.sort((i, j) => a[i] - a[j] || i - j);
    const out = [];
    for (let s = 0; s < across; s++) {
      const slice = ids.slice(Math.round((s * n) / across), Math.round(((s + 1) * n) / across));
      slice.sort((i, j) => p[i] - p[j] || i - j);
      for (let q = 0; q < deep; q++) { const part = slice.slice(Math.round((q * slice.length) / deep), Math.round(((q + 1) * slice.length) / deep)); if (part.length) out.push(part); }
    }
    return out;
  },

  /** Draw up company g from the soldiers `list` as they stand, facing (hx, hy). */
  _formCompany(g, list, hx, hy) {
    const n = list.length;
    if (n < 6) { this.gForm[g] = F_NONE; return; }
    let sx = 0, sy = 0;
    for (const i of list) { sx += this.x[i]; sy += this.y[i]; }
    let cx = sx / n, cy = sy / n;
    const rx = -hy, ry = hx;
    let l0 = 1e9, l1 = -1e9, f0 = 1e9, f1 = -1e9;
    for (const i of list) { const dx = this.x[i] - cx, dy = this.y[i] - cy, lat = dx * rx + dy * ry, al = dx * hx + dy * hy; if (lat < l0) l0 = lat; if (lat > l1) l1 = lat; if (al < f0) f0 = al; if (al > f1) f1 = al; }
    const mid = (l0 + l1) / 2; cx += rx * mid; cy += ry * mid;
    const hw = Math.max(0.8, (l1 - l0) / 2), dp = Math.max(0.8, f1 - f0);
    for (const i of list) { const dx = this.x[i] - cx, dy = this.y[i] - cy; this.fu[i] = (dx * rx + dy * ry) / hw; this.fv[i] = (f1 - (dx * hx + dy * hy)) / dp; this.gapT[i] = 0; }
    this.gForm[g] = F_MARCH; this.gFree[g] = 0; this.gHold[g] = 0;
    this.gAx[g] = cx + hx * f1; this.gAy[g] = cy + hy * f1; this.gHx[g] = this.gDx[g] = hx; this.gHy[g] = this.gDy[g] = hy;
    this.gHalfW[g] = this.gHalfW0[g] = hw; this.gDepth[g] = this.gDepth0[g] = dp; this.gWLim[g] = 1e9; this.gShift[g] = 0;
    this.gAimX[g] = -1; this.gAimU[g] = -1; this.gStand[g] = 0; this.gSpd[g] = 0; this.gPace[g] = 1; this.gDress[g] = 1; this.gLag[g] = 0; this.gSeenT[g] = -100; this.gSeenD[g] = 1e9;
    this.gCx[g] = cx; this.gCy[g] = cy;
    this.gFormT[g] = this.time; this.gFireT[g] = this.time;
    this.aimDirty = true;
  },

  /** Put company g's box back round its men (after a rout, a fall-back, a melee), facing its aim. */
  _reanchor(g) {
    let hx = this.gHx[g], hy = this.gHy[g];
    if (this.gAimX[g] >= 0) { const dx = this.gAimX[g] - this.gCx[g], dy = this.gAimY[g] - this.gCy[g], l = Math.sqrt(dx * dx + dy * dy); if (l > 1) { hx = dx / l; hy = dy / l; } }
    this.gHx[g] = this.gDx[g] = hx; this.gHy[g] = this.gDy[g] = hy;
    const s = this._boxScale(g);
    this.gHalfW[g] = this.gHalfW0[g] * s; this.gDepth[g] = this.gDepth0[g] * s;
    this.gAx[g] = this.gCx[g] + hx * this.gDepth[g] * 0.5; this.gAy[g] = this.gCy[g] + hy * this.gDepth[g] * 0.5;
    this.gSpd[g] = 0; this.gLag[g] = 0; this.gFormT[g] = this.time;
  },

  /** A company that has lost men closes up: its box shrinks with its strength. */
  _boxScale(g) { const s = Math.sqrt(Math.max(this.gAlive[g], 6) / Math.max(6, this.gN0[g])); return s < 0.3 ? 0.3 : s > 1 ? 1 : s; },

  /** Can a man on foot walk the straight line from (x0, y0) to (x1, y1)? Wire does not count: it is there to be cut. */
  _walkLine(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 3) return true;
    const n = Math.min(400, Math.ceil(d / 2)), ix = dx / n, iy = dy / n;
    let pc = ((y0 / CELL) | 0) * GW + ((x0 / CELL) | 0);
    for (let k = 1; k <= n; k++) {
      const x = x0 + ix * k, y = y0 + iy * k;
      if (x < 2 || y < 2 || x > WORLD_W - 2 || y > WORLD_H - 2) return false;
      const c = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
      if (c === pc) continue;
      if (!this.canEnter(pc, c, 0, true, true)) return false;
      pc = c;
    }
    return true;
  },

  /** The nearest of the garrison's troops standing on open ground (not on a wall) within r of x,y: the square of the distance, or 1e12. Result point in _ndx/_ndy. */
  _groundDefNear(x, y, r) {
    const b = this.defBox;
    if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) return 1e12;
    const cx = (x / DCS) | 0, cy = (y / DCS) | 0, m = Math.ceil(r / DCS);
    let bd = r * r;
    let found = false;
    for (let yy = Math.max(0, cy - m); yy <= Math.min(DH - 1, cy + m); yy++) for (let xx = Math.max(0, cx - m); xx <= Math.min(DW - 1, cx + m); xx++) {
      const j = this.dcHead[yy * DW + xx];
      if (j < 0) continue;
      for (let q = j; q >= 0; q = this.cnext[q]) {
        if (this.el[q] || !this.alive[q]) continue;
        const dx = this.x[q] - x, dy = this.y[q] - y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; this._ndx = this.x[q]; this._ndy = this.y[q]; found = true; }
        break; // one man of a cell stands for the rest of it
      }
    }
    return found ? bd : 1e12;
  },

  /**
   * Share out a sector's frontage among the companies bound for it: by kind, the nearest in the first line
   * and the rest behind, each line spread along the wall in the order the companies stand across the field
   * (so no two cross on the way in).
   */
  _assignAims() {
    this.aimDirty = false;
    const wl = this.wl, by = new Map();
    for (let g = 0; g < this.ng; g++) {
      if (this.gForm[g] !== F_MARCH && this.gForm[g] !== F_STAND) continue;
      if (!this.gAlive[g]) continue;
      const f = wl.forces[this.gForce[g]];
      if (!f || f.sector < 0 || f.sector > 2) { this.gAimU[g] = -1; continue; }
      const key = f.sector * 16 + (this.gType[g] === U.archer ? 1 : this.gType[g] === U.uruk ? 0 : 2);
      (by.get(key) || by.set(key, []).get(key)).push(g);
    }
    const len = (this.map.wallLen / N_WALL) * (N_WALL / 3);
    for (const [key, list] of by) {
      const sec = key >> 4, S = this.sectors[sec];
      let front = 0; for (const g of list) front += this.gHalfW0[g] * 2 + 6;
      const per = Math.max(1, Math.floor(len / (front / list.length)));
      list.sort((a, b) => Math.hypot(this.gCx[a] - S.x, this.gCy[a] - S.y) - Math.hypot(this.gCx[b] - S.x, this.gCy[b] - S.y) || a - b);
      for (let e = 0; e * per < list.length; e++) {
        const line = list.slice(e * per, (e + 1) * per);
        // (along the wall u runs from the keep end, which is the high-y end, toward the cliff)
        line.sort((a, b) => this.gCy[b] - this.gCy[a] || a - b);
        line.forEach((g, k) => { this.gAimU[g] = 0.06 + 0.88 * ((k + 0.5) / line.length); });
      }
    }
  },

  /** Where company g is bound: sets gAimX/gAimY (x < 0: nowhere of its own, it goes by its path field) and the stand-off it halts at. */
  _companyAim(g, d) {
    const wl = this.wl, f = wl.forces[this.gForce[g]];
    let ax = -1, ay = 0;
    const volley = d.role === R.ARCHER ? VOLLEY_AT : 0;
    let stand = volley;
    if (f && f.sector >= 0 && !f.reserve) {
      if (f.sector < 3) {
        const u = this.gAimU[g] >= 0 ? this.gAimU[g] : 0.5, n3 = N_WALL / 3;
        const s = this.segs[Math.min(N_WALL - 1, Math.floor(f.sector * n3 + u * n3))];
        ax = s.ox; ay = s.oy;
      } else if (f.sector === 3) { const s = this.segs[this.map.GATE]; ax = s.ox; ay = s.oy; }
      else if (f.sector === 5) {
        // up the ring by lashed ladders: a foot of the rock each, the crossbows halting closer to cover the climb
        const q = this._ringAim(g) || this._ringMid(); ax = q.x; ay = q.y; stand = volley ? 60 : 0;
      } else { const q = this._postFoot(); ax = q.x; ay = q.y; stand = 0; }
    }
    // troops standing in the open, seen ahead, are made for first
    const x = this.gAx[g], y = this.gAy[g];
    let d2 = SIGHT * SIGHT, nx = 0, ny = 0;
    for (const c of wl.exAll) { const px = (c % GW) * CELL + 2, py = ((c / GW) | 0) * CELL + 2, q = (px - x) * (px - x) + (py - y) * (py - y); if (q < d2) { d2 = q; nx = px; ny = py; } }
    if (d2 < SIGHT * SIGHT) {
      this.gSeenT[g] = this.time; this.gSeenD[g] = Math.sqrt(d2);
      const ex = nx - x, ey = ny - y, own = ax >= 0 ? (ax - x) * (ax - x) + (ay - y) * (ay - y) : 1e12;
      // (nearer than the objective and roughly ahead, or simply close)
      if (d2 < own && (d2 < 22500 || ex * this.gHx[g] + ey * this.gHy[g] > 0.5 * Math.sqrt(d2))) { ax = nx; ay = ny; stand = volley; }
    }
    this.gAimX[g] = ax; this.gAimY[g] = ay; this.gStand[g] = stand;
  },

  /** How wide a front the ground lets company g keep where its anchor stands: sets gWLim and the sideways shift of its anchor. */
  _companyWidth(g, want) {
    const x = this.gAx[g] - this.gHx[g] * 2, y = this.gAy[g] - this.gHy[g] * 2, rx = -this.gHy[g], ry = this.gHx[g];
    const c0 = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
    const reach = (sg) => {
      let pc = c0, k = 2;
      for (; k <= want; k += 2) {
        const px = x + rx * k * sg, py = y + ry * k * sg;
        if (px < 2 || py < 2 || px > WORLD_W - 2 || py > WORLD_H - 2) break;
        const c = ((py / CELL) | 0) * GW + ((px / CELL) | 0);
        if (c !== pc) { if (!this.canEnter(pc, c, 0, true, true)) break; pc = c; }
      }
      return Math.min(want, k - 1);
    };
    if (this.mtype[c0] === T.CLIFF) { this.gWLim[g] = want; this.gShift[g] = 0; return; }
    const a = reach(1), b = reach(-1);
    this.gWLim[g] = Math.max(2.5, (a + b) / 2);
    this.gShift[g] = (a - b) / 2;
  },

  /** Twice a second for each company in ranks: where it is bound, which way to turn, whether to break ranks or re-form. */
  _companyThink(g) {
    const d = UNITS[this.gType[g]], wl = this.wl;
    let fm = this.gForm[g];
    const cx = this.gCx[g], cy = this.gCy[g];
    if (fm === F_LOOSE) {
      // re-form once clear of the fight and still a march from anything to do
      if (this.time - this.gFormT[g] < 8 || this.gAlive[g] < 8) return;
      if (this._fortDist(cx, cy) < 110 || cx > this.map.wallJoin.x - 40) return;
      this.gAx[g] = cx; this.gAy[g] = cy;
      this._companyAim(g, d);
      if (this._groundDefNear(cx, cy, 70) < 1e11) return;
      if (this.gAimX[g] >= 0 && Math.hypot(this.gAimX[g] - cx, this.gAimY[g] - cy) < this.gStand[g] + 110) return;
      this.gForm[g] = F_MARCH; this._reanchor(g);
      return;
    }
    this._companyAim(g, d);
    const x = this.gAx[g], y = this.gAy[g], ax = this.gAimX[g], ay = this.gAimY[g];
    const c = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
    let dist = 1e9;
    if (ax >= 0) { const dx = ax - x, dy = ay - y; dist = Math.sqrt(dx * dx + dy * dy); }
    const stand = this.gStand[g];
    if (fm === F_STAND && this.gHold[g]) {
      // halted at the forming-up line until the wave steps off
      if (!this._forming(g)) { this.gHold[g] = 0; this.gForm[g] = F_MARCH; this.gFormT[g] = this.time; }
      return;
    }
    if (fm === F_STAND) {
      // crossbows halted with nothing in reach for a while close in a little; with the wall won or the last effort on, they go in
      if (wl.allIn || dist > stand + 30) { this.gForm[g] = F_MARCH; this.gFormT[g] = this.time; }
      else if (this.time - this.gFireT[g] > 14 && this.time - this.gFormT[g] > 14) { this.gForm[g] = F_LOOSE; this.gFormT[g] = this.time; }
      return;
    }
    // --- on the march
    if (x >= wl.formX && x < wl.formX + 50 && this._forming(g)) { this.gForm[g] = F_STAND; this.gHold[g] = 1; this.gFormT[g] = this.time; this.gSpd[g] = 0; return; }
    if (stand > 0 && dist < stand + 4 && !wl.allIn) { this.gForm[g] = F_STAND; this.gFormT[g] = this.time; this.gFireT[g] = this.time; this.gSpd[g] = 0; return; }
    if ((stand === 0 || wl.allIn) && (dist < LOOSE_AT || this._groundDefNear(x, y, 34) < 1e11)) { this.gForm[g] = F_LOOSE; this.gFormT[g] = this.time; return; }
    if (this.elev[c] || x > this.map.wallJoin.x + 30 || this.gAlive[g] < 6) { this.gForm[g] = F_LOOSE; this.gFormT[g] = this.time; return; } // inside the works, or too few to keep ranks
    // heading: straight at the aim where the way is clear, else by the path
    let hx = 0, hy = 0;
    if (ax >= 0 && dist > 1 && this._walkLine(x, y, ax, ay)) { hx = (ax - x) / dist; hy = (ay - y) / dist; }
    else if (this._flow(x, y, this.gField[g] ? this._fieldFor(g, c) : this.orcDir)) { hx = this.fdx; hy = this.fdy; }
    else if (ax >= 0 && dist > 1) { hx = (ax - x) / dist; hy = (ay - y) / dist; }
    if (hx || hy) { this.gDx[g] = hx; this.gDy[g] = hy; }
    // frontage the ground allows
    const s = this._boxScale(g), want = this.gHalfW0[g] * s * (this.gOpen[g] ? 1.2 : this.gShield[g] ? 0.8 : 1);
    this._companyWidth(g, want);
    // keep station: not treading on the heels of a company marching ahead. A follower closes to a few paces and then
    // keeps the leader's pace; it never stops dead behind a company that is moving. Crossbows and berserkers, who are
    // told to keep behind the leading shields, never hold up the companies that lead them.
    let pace = 1;
    const Hx = this.gHx[g], Hy = this.gHy[g], tg = this.gType[g], myV = Math.max(1, d.speed);
    for (let h = 0; h < this.ng; h++) {
      if (h === g || this.gForm[h] !== F_MARCH || !this.gAlive[h] || this.gFree[h]) continue;
      if (this.gCapX[h] < 1e8 && this.gCapX[g] > 1e8) continue;
      const ox = this.gAx[h] - x, oy = this.gAy[h] - y, al = ox * Hx + oy * Hy;
      if (al < 2 || al > this.gDepth[h] + 14) continue;
      const lat = Math.abs(-ox * Hy + oy * Hx);
      if (lat > (this.gHalfW[g] + this.gHalfW[h]) * 0.7) continue;
      if (this.gHx[h] * Hx + this.gHy[h] * Hy < 0.5) continue;
      const gap = al - this.gDepth[h]; // from my front rank to its rear rank
      if (gap > 10) continue;
      const lead = Math.max(0.15, (this.gSpd[h] + (gap > 4 ? 0.4 : 0)) / myV);
      const p = gap < 1 ? Math.min(lead, 0.2) : lead;
      if (p < pace) pace = p;
    }
    void tg;
    this.gPace[g] = pace;
  },

  /** Every tick: turn, change shape, and step each company's anchor. */
  _companies() {
    if (this.aimDirty && this.tick % 10 === 0) this._assignAims();
    const wl = this.wl;
    // --- dressing: the leading companies of a force keep abreast of each other
    if (this.tick % 10 === 5) {
      // the rearmost crewed ladder of each force, still on its way in (one pass over the engines)
      const ladOf = this._ladOf || (this._ladOf = new Float32Array(4096));
      ladOf.fill(-1, 0, wl.forces.length);
      const lmin = UNITS[U.ladder].crew.min;
      for (const e of this.engines) {
        if (this.type[e] !== U.ladder || !this.alive[e] || this.state[e] !== 1 || this.crewPts[e] < lmin) continue;
        const k = this.aux2[e], fi = this.gForce[this.grp[e]];
        if (k < 0 || fi < 0) continue;
        const r = Math.hypot(this.segs[k].ox - this.x[e], this.segs[k].oy - this.y[e]);
        if (r > 260 && r > ladOf[fi]) ladOf[fi] = r; // (over the last stretch the ladders run, and keep up)
      }
      for (const f of wl.forces) {
        if (f.reserve) continue;
        let sum = 0, n = 0;
        for (const g of f.groups) if (this.gForm[g] === F_MARCH && !this.gFree[g] && this.gType[g] === U.uruk && this.gAimX[g] >= 0 && this.gAlive[g] && this.time >= this.gWaitT[g]) { sum += Math.hypot(this.gAimX[g] - this.gAx[g], this.gAimY[g] - this.gAy[g]); n++; }
        // the ladders are carried inside the body of the force: the companies do not draw ahead of the last ladder that
        // still has hands to carry it (one that has fallen far behind, or lies abandoned, is left to the next wave), once
        // the wave has stepped off from its forming-up line
        const off = wl.waveGo[f.wave] !== undefined && wl.waveGo[f.wave] >= 0;
        let lad = off ? ladOf[f.id] : -1;
        if (n && lad > sum / n + 150) lad = -1;
        const mean = n ? sum / n : 0;
        for (const g of f.groups) {
          if (this.gForm[g] !== F_MARCH || this.gType[g] !== U.uruk || this.gAimX[g] < 0) { this.gDress[g] = 1; continue; }
          const rem = Math.hypot(this.gAimX[g] - this.gAx[g], this.gAimY[g] - this.gAy[g]);
          let k = n >= 2 ? 1 + (rem - mean) / 90 : 1;
          k = k < 0.7 ? 0.7 : k > 1.12 ? 1.12 : k;
          if (lad > 0 && rem < lad - 20 && rem > LOOSE_AT + 20) k = Math.min(k, Math.max(0.15, 1 - (lad - 20 - rem) / 25));
          this.gDress[g] = k;
        }
      }
    }
    const { fAcc, fN, fAccF, fNF, gLag } = this;
    for (let g = 0; g < this.ng; g++) {
      const fm = this.gForm[g];
      if (!fm) continue;
      // last tick's roll-call
      if (fN[g]) { const all = fAcc[g] / fN[g], fr = fNF[g] ? fAccF[g] / fNF[g] : all; gLag[g] = fr > all ? fr : all; } else gLag[g] = 0;
      fAcc[g] = 0; fN[g] = 0; fAccF[g] = 0; fNF[g] = 0;
      if (!this.gAlive[g] || this.gTeam[g] !== ORC) continue;
      // broken, ordered back or held in reserve: the men act for themselves, and the box is put round them again after
      if (this.gState[g] >= 2 || this.gOrder[g]) { this.gFree[g] = 1; continue; }
      if (this.gFree[g]) { this.gFree[g] = 0; if (fm !== F_LOOSE) { this.gForm[g] = F_MARCH; this._reanchor(g); } }
      if ((this.tick + g) % 5 === 0) this._companyThink(g);
      if (this.gForm[g] !== F_MARCH) { this.gSpd[g] = 0; continue; }
      if (this.time < this.gWaitT[g]) { this.gSpd[g] = 0; continue; }
      const d = UNITS[this.gType[g]];
      // --- wheel toward the wanted heading, no faster than the outer flank can run
      let hx = this.gHx[g], hy = this.gHy[g];
      const cr = hx * this.gDy[g] - hy * this.gDx[g], dt = hx * this.gDx[g] + hy * this.gDy[g];
      let turn = 1;
      if (cr > 0.01 || cr < -0.01 || dt < 0) {
        const want = Math.atan2(cr, dt), lim = Math.max(0.1, Math.min(0.7, 3.2 / Math.max(2, this.gHalfW[g]))) * DT;
        const a = want > lim ? lim : want < -lim ? -lim : want, ca = Math.cos(a), sa = Math.sin(a);
        const nx = hx * ca - hy * sa, ny = hx * sa + hy * ca;
        // the box turns about the middle of its front
        hx = this.gHx[g] = nx; hy = this.gHy[g] = ny;
        if (want > 0.5 || want < -0.5) turn = 0.45;
      }
      // --- shape: close order behind locked shields, open order under shellfire, a column in a defile
      const s = this._boxScale(g);
      let hw = this.gHalfW0[g] * s, dp = this.gDepth0[g] * s;
      if (this.gShield[g]) hw *= 0.8; else if (this.gOpen[g]) { hw *= 1.2; dp *= 2.3; }
      if (hw > this.gWLim[g]) { dp *= hw / this.gWLim[g]; hw = this.gWLim[g]; }
      this.gHalfW[g] += (hw - this.gHalfW[g]) * 0.04; this.gDepth[g] += (dp - this.gDepth[g]) * 0.04;
      // --- pace
      let v = d.speed;
      const pin = this.gPin[g];
      if (pin) v *= d.cav ? (pin === 2 ? 0.6 : 0.85) : this.gShield[g] ? (pin === 2 ? 0.75 : 0.9) : pin === 2 ? 0.3 : 0.65;
      if (this.gConf[g] > this.time) v *= 0.3;
      if (this.gShield[g]) v *= 0.7; else if (this.gAx[g] > this.gCapX[g] && v > 3.3) v = 3.3;
      v *= this.gPace[g] * this.gDress[g] * turn;
      const lag = gLag[g];
      if (lag > 1.5) v *= lag > 6 ? 0 : 1 - (lag - 1.5) / 4.5;
      // held up for long (at wire, in a crush): the ranks dissolve and every man works his own way through
      if (lag > 4) { if (this.gStallT[g] < 0) this.gStallT[g] = this.time; else if (this.time - this.gStallT[g] > 15) { this.gForm[g] = F_LOOSE; this.gFormT[g] = this.time; this.gStallT[g] = -1; continue; } }
      else this.gStallT[g] = -1;
      this.gSpd[g] += Math.max(-0.5, Math.min(0.25, v - this.gSpd[g]));
      v = this.gSpd[g];
      // --- step
      const sh = this.gShift[g], ss = sh > 0.3 ? 0.6 : sh < -0.3 ? -0.6 : 0; // sidle toward the middle of the gap
      const nx = this.gAx[g] + (hx * v + -hy * ss) * DT, ny = this.gAy[g] + (hy * v + hx * ss) * DT;
      if (ss) this.gShift[g] -= ss * DT;
      if (nx < 3 || ny < 3 || nx > WORLD_W - 3 || ny > WORLD_H - 3) continue;
      const c1 = ((ny / CELL) | 0) * GW + ((nx / CELL) | 0);
      if (this.mtype[c1] === T.CLIFF) { this.gSpd[g] = 0; continue; }
      this.gAx[g] = nx; this.gAy[g] = ny;
    }
  },

  /**
   * A soldier of a company in ranks: which way, and how fast, to keep his place. Result in this.fdx / fdy / fsp.
   * `vmax` is the fastest he can go as things stand (pinned, shields locked).
   */
  _formDir(i, g, x, y, vmax) {
    const hx = this.gHx[g], hy = this.gHy[g], u = this.fu[i] * this.gHalfW[g], v = this.fv[i] * this.gDepth[g];
    const ex = this.gAx[g] - hy * u - hx * v - x, ey = this.gAy[g] + hx * u - hy * v - y;
    const along = ex * hx + ey * hy;
    this.fAcc[g] += along; this.fN[g]++;
    if (this.fv[i] < 0.34) { this.fAccF[g] += along; this.fNF[g]++; }
    const av = this.gSpd[g];
    let vx = hx * av + ex * 0.8, vy = hy * av + ey * 0.8;
    const vm = Math.sqrt(vx * vx + vy * vy), lim = vmax * 1.22;
    if (vm < 0.12) { this.fdx = hx; this.fdy = hy; this.fsp = 0; return; }
    this.fdx = vx / vm; this.fdy = vy / vm; this.fsp = vm > lim ? lim : vm;
  },

  /** One tick for a soldier in ranks: keep his place (or make for a gap in the wire he has seen), and deal with what holds him up. */
  _formStep(i, d, g, x, y, vmax) {
    const hx = this.gHx[g], hy = this.gHy[g];
    if (this.gapT[i] > this.time) {
      const dx = this.gapX[i] - x, dy = this.gapY[i] - y, l = Math.sqrt(dx * dx + dy * dy);
      if (l < 2.5) this.gapT[i] = 0;
      this.fdx = dx / (l || 1); this.fdy = dy / (l || 1); this.fsp = vmax;
      // (he is still on the roll: counted as behind his place by as much as he is)
      const u = this.fu[i] * this.gHalfW[g], v = this.fv[i] * this.gDepth[g];
      const al = (this.gAx[g] - hy * u - hx * v - x) * hx + (this.gAy[g] + hx * u - hy * v - y) * hy;
      this.fAcc[g] += al; this.fN[g]++;
    } else this._formDir(i, g, x, y, vmax);
    const blk = this._move(i, this.fdx, this.fdy, this.fsp, d.sz, 0);
    if (this.fsp === 0 && ((this.tick + i) & 7) === 0) {
      let a = Math.atan2(hy, hx) - this.rot[i];
      if (a > Math.PI) a -= 2 * Math.PI; else if (a < -Math.PI) a += 2 * Math.PI;
      this.rot[i] += a * 0.5;
    }
    if (blk >= 0) {
      if (this.ob[blk] & OB.WIRE) { if (this.gapT[i] <= this.time && ((this.tick + i) & 15) === 0) this._gapSeek(i, x, y, blk, hx, hy); }
      else if (!this.orcBlock[blk]) this.snagT[i] = this.time + 2.5; // the ground will not let him keep his place: he finds his own way round for a moment
    }
  },

  /** A man in ranks held up by wire looks along it for a gap already cut close by. */
  _gapSeek(i, x, y, blk, hx, hy) {
    const bx = blk % GW, by = (blk / GW) | 0;
    let best = -1, bd = 1e9;
    for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
      const gx = bx + ox, gy = by + oy;
      if (gx < 1 || gy < 1 || gx >= GW - 1 || gy >= GH - 1) continue;
      const c = gy * GW + gx;
      if ((this.ob[c] & OB.WIRE) || this.mtype[c] === T.CLIFF || this.elev[c]) continue;
      // a cell of the belt's own line that stands open: wire on both sides of it along the belt, or cut wire's place
      const n = ((this.ob[c - 1] & OB.WIRE) ? 1 : 0) + ((this.ob[c + 1] & OB.WIRE) ? 1 : 0) + ((this.ob[c - GW] & OB.WIRE) ? 1 : 0) + ((this.ob[c + GW] & OB.WIRE) ? 1 : 0);
      if (!n) continue;
      const px = gx * CELL + 2, py = gy * CELL + 2, fx = px - x, fy = py - y;
      if (fx * hx + fy * hy < -1) continue; // not behind him
      const dd = fx * fx + fy * fy;
      if (dd < bd && ((ox * ox + oy * oy) > 0)) { bd = dd; best = c; }
    }
    if (best < 0) return false;
    // (it must lead on: the cell beyond it, the way he is going, is open too)
    const gx = best % GW, gy = (best / GW) | 0, qx = gx + Math.round(hx), qy = gy + Math.round(hy), q = qy * GW + qx;
    if (qx < 0 || qy < 0 || qx >= GW || qy >= GH || (this.ob[q] & OB.WIRE)) return false;
    this.gapX[i] = gx * CELL + 2 + hx * 3; this.gapY[i] = gy * CELL + 2 + hy * 3; this.gapT[i] = this.time + 7;
    return true;
  },
};
