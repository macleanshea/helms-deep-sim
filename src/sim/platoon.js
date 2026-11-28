// The garrison's platoons. Mixed into Sim.prototype.
//
// Every formation of foot soldiers the player puts down is a platoon, and formations put down side by side
// on the same level are joined into one (ten riflemen placed one by one along a wall are a section, not
// ten men). A platoon shares its morale, is selected as one, and deploys as one:
//
//   Firing line   On open ground (and in the Hornburg's courts) a platoon stands in a line facing the
//                 enemy, up to three ranks deep (prone, kneeling, standing), each rank offset a third of a
//                 file so that every man has a clear lane past the men in front. 250 riflemen make a line
//                 about 130 m long, not a square in which most cannot fire. On a wall walk the parapet
//                 does the same job: the front rank kneels at it, the second stands behind.
//   Moving        Sent somewhere, a platoon forms the same line at the far end, facing the way it went;
//                 sent onto a wall walk, it lines the parapet nearest the point clicked.
//   Auto          (the default) A platoon left to itself: turns its line to face attackers who have come
//                 round its flank, shifts along its wall to a stretch under attack when its own has gone
//                 quiet, goes up against a foothold or into the face of a breach if it is in reserve and
//                 idle, walks back to the nearest ammo when its pouches are nearly empty and returns to
//                 its post after. The remnant of a platoon that has lost three men in four joins the
//                 nearest platoon beside it.
//   Manual        Holds the ground it was given and fires at what it can see; moves only when ordered.
//
// Reinforcements landed by helicopter are one mixed platoon that forms a line on landing.

import { DEF, T, UNITS, C, WORLD_W, WORLD_H } from '../config.js';
import { S_MOVE } from './sim.js';
import { SUPPLY_R } from './support.js';

const MAXG = 4096;
const FILE = 1.6;          // between files in a firing line (m): ranks are offset a third of this
const RANK = 1.7;          // between ranks
const JOIN = 4;            // formations this close (between the nearest men) on one level are one platoon
const PLATOON_MAX = 80;    // ... unless that would make a platoon bigger than this
const THINK = 20;          // ticks between a platoon's looks round (2 s)
const IDLE = 10;           // seconds without a shot before a platoon counts as idle
const MOVE_GAP = 15;       // seconds between one platoon's moves on its own account

const DCS = 8, DW = WORLD_W / DCS, DH = WORLD_H / DCS; // the defender grid (must match sim.js)
const OCS = 16, OW = WORLD_W / OCS, OH = WORLD_H / OCS; // the attacker grid

export const platoonMethods = {
  _initPlatoons() {
    this.gAuto = new Uint8Array(MAXG).fill(1); this.gFaceX = new Float32Array(MAXG).fill(-1); this.gFaceY = new Float32Array(MAXG);
    this.gMoveT = new Float32Array(MAXG).fill(-100); this.gHomeX = new Float32Array(MAXG).fill(-1); this.gHomeY = new Float32Array(MAXG);
    this.gTask = new Uint8Array(MAXG); // 0 at its post, 1 shifted along a wall, 2 counter-attacking, 3 re-arming
    this.gHoldA = new Float32Array(MAXG); // fire discipline an auto platoon keeps by itself as its ammo runs down (m; 0 none)
    this._autoSolves = 0; this._autoSolveT = 0;
    this.stats.autoMoves = 0;
  },

  /** Is this unit a soldier of a platoon (direct-fire foot)? Mortars stay in their batteries, commanders alone. */
  _platoonable(d) { return d.team === DEF && d.cls === C.INF && !d.cmd && !(d.wdef && d.wdef.arc); },

  /** Members of every live defender group, as lists keyed by group. */
  _members() {
    const m = new Map();
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.team[i] !== DEF) continue;
      const g = this.grp[i];
      (m.get(g) || m.set(g, []).get(g)).push(i);
    }
    return m;
  },

  /** The battle opens: join formations that stand side by side, and draw each platoon on open ground up in its line. */
  _platoonsStart() {
    const mem = this._members(), list = [];
    for (const [g, ids] of mem) {
      if (g === this.miscGroup[DEF] || !ids.length || !this._platoonable(UNITS[this.type[ids[0]]])) continue;
      const lv = this.el[ids[0]], tr = this.tier[this.map.cellOf(this.x[ids[0]], this.y[ids[0]])];
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const i of ids) { const x = this.x[i], y = this.y[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      list.push({ g, ids, lv, tr, box: [x0, y0, x1, y1], root: g });
    }
    // union by nearness: the bounding boxes, grown by JOIN, overlap, and two men of the two are within JOIN of each other
    const find = (a) => { while (a.root !== a.g) a = list.find((q) => q.g === a.root); return a; };
    const near = (a, b) => {
      if (a.lv !== b.lv || a.tr !== b.tr) return false;
      if (a.box[0] - JOIN > b.box[2] || b.box[0] - JOIN > a.box[2] || a.box[1] - JOIN > b.box[3] || b.box[1] - JOIN > a.box[3]) return false;
      for (const i of a.ids) for (const j of b.ids) { const dx = this.x[i] - this.x[j], dy = this.y[i] - this.y[j]; if (dx * dx + dy * dy < JOIN * JOIN) return true; }
      return false;
    };
    const size = new Map(list.map((a) => [a.g, a.ids.length]));
    for (let p = 0; p < list.length; p++) for (let q = p + 1; q < list.length; q++) {
      const A = find(list[p]), B = find(list[q]);
      if (A === B || size.get(A.g) + size.get(B.g) > PLATOON_MAX || !near(list[p], list[q])) continue;
      B.root = A.g; size.set(A.g, size.get(A.g) + size.get(B.g));
    }
    for (const a of list) {
      const r = find(a);
      if (r === a) continue;
      for (const i of a.ids) { this.grp[i] = r.g; this.gAlive[a.g]--; this.gN0[a.g]--; this.gAlive[r.g]++; this.gN0[r.g]++; }
      r.ids.push(...a.ids); a.ids = [];
    }
    // the line faces the horde as it stands on the field (or up the valley, toward its mouth, if none is in sight yet);
    // the ground taken by everyone who is not drawn up in a line (on the walls, the guns) is taken already
    const lined = new Set();
    for (const a of list) if (a.ids.length && !a.lv) for (const i of a.ids) lined.add(i);
    this._claimAll(lined);
    for (const a of list) {
      if (!a.ids.length || a.lv) continue;
      const f = this._threatDir(a.ids);
      this._deploy(a.g, a.ids, f[0], f[1], null, null, true);
    }
  },

  /** Which way a platoon should face: toward the nearest mass of attackers within 600 m, else down the valley. */
  _threatDir(ids) {
    let cx = 0, cy = 0;
    for (const i of ids) { cx += this.x[i]; cy += this.y[i]; }
    cx /= ids.length; cy /= ids.length;
    let bx = 0, by = 0, bw = 0;
    const x0 = Math.max(0, ((cx - 600) / OCS) | 0), x1 = Math.min(OW - 1, ((cx + 600) / OCS) | 0), y0 = Math.max(0, ((cy - 600) / OCS) | 0), y1 = Math.min(OH - 1, ((cy + 600) / OCS) | 0);
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const n = this.ocCount[yy * OW + xx];
      if (!n) continue;
      const px = xx * OCS + 8, py = yy * OCS + 8, d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d2 > 360000) continue;
      const w = n / (1 + d2 / 10000);
      bx += px * w; by += py * w; bw += w;
    }
    if (bw > 0) { const dx = bx / bw - cx, dy = by / bw - cy, l = Math.sqrt(dx * dx + dy * dy); if (l > 5) return [dx / l, dy / l, cx, cy]; }
    return [-1, 0, cx, cy];
  },

  /** Mark the ground every standing defender takes, except those in `skip` (who are about to move). */
  _claimAll(skip) {
    const c = this._claims || (this._claims = new Map());
    c.clear();
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.team[i] !== DEF || skip.has(i)) continue;
      const k = ((((this.y[i] / 2) | 0) * (WORLD_W / 2) + ((this.x[i] / 2) | 0)) * 2) + this.el[i];
      c.set(k, (c.get(k) || 0) + (this.rad[i] > 1 ? 2 : 1));
    }
  },
  /** Is there room at x,y on level lv for one more (no more than two to a 2 m square)? Takes it if so. */
  _claim(x, y, lv) {
    const c = this._claims;
    if (!c) return true;
    const k = ((((y / 2) | 0) * (WORLD_W / 2) + ((x / 2) | 0)) * 2) + lv, v = c.get(k) || 0;
    if (v >= 2) return false;
    c.set(k, v + 1);
    return true;
  },

  /** Can a defender stand at x,y on ground level `tier` (open ground, or one of the Hornburg's courts)? */
  _groundOk(x, y, tier) {
    if (x < 4 || y < 4 || x > WORLD_W - 4 || y > WORLD_H - 4) return false;
    const c = this.map.cellOf(x, y), t = this.mtype[c];
    return !this.elevD[c] && t !== T.CLIFF && t !== T.STAIR && t !== T.DOOR && this.tier[c] === tier && this.mseg[c] < 0;
  },

  /**
   * Places for n men in a firing line centered at (cx, cy) facing (fx, fy) on ground level `tier`: up to three ranks,
   * each offset a third of a file, filled from the middle outward. Places that cannot be stood on are skipped and the
   * line runs on past them.
   */
  _lineSlots(cx, cy, fx, fy, n, tier) {
    const rx = -fy, ry = fx, ranks = n <= 3 ? 1 : n <= 10 ? 2 : 3, out = [];
    for (let k = 0, tries = 0; out.length < n * 2 && tries < n * 4 + 40; k++) {
      const file = k === 0 ? 0 : (k & 1 ? (k + 1) >> 1 : -(k >> 1));
      for (let r = 0; r < ranks && out.length < n * 2; r++) {
        tries++;
        const lat = file * FILE + (r * FILE) / 3 - FILE / 3, back = r * RANK;
        const x = cx + rx * lat - fx * back, y = cy + ry * lat - fy * back;
        if (this._groundOk(x, y, tier) && this._claim(x, y, 0)) out.push(x, y);
      }
    }
    return out;
  },

  /** Places along the parapet of the wall walk nearest (px, py), on wall group `wg`: the front rank first, then the second. */
  _parapetSlots(px, py, wg, n) {
    const cand = [];
    for (let k = 0; k < this.segs.length; k++) {
      const s = this.segs[k];
      if (s.group !== wg || s.breached || s.kind === 'gate' || s.kind === 'postern' || s.kind === 'door') continue;
      const d0 = Math.hypot(s.x - px, s.y - py);
      if (d0 > 30 + n * 0.8) continue;
      const m = Math.max(1, Math.floor(s.len / 1.2));
      for (let r = 0; r < 2; r++) {
        const off = s.half - (r ? 2.6 : 1.0);
        for (let q = 0; q < m; q++) {
          const u = (q + 0.5) * 1.2 - (m * 1.2) / 2, x = s.x + s.tx * u + s.nx * off, y = s.y + s.ty * u + s.ny * off, c = this.map.cellOf(x, y);
          if (this.elevD[c] !== wg + 1) continue;
          if (this._claims && (this._claims.get(((((y / 2) | 0) * (WORLD_W / 2) + ((x / 2) | 0)) * 2) + 1) || 0) >= 2) continue;
          cand.push([Math.hypot(x - px, y - py) + (r ? 25 : 0), x, y]);
        }
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (let k = 0; k < cand.length && out.length < n * 2; k++) if (this._claim(cand[k][1], cand[k][2], 1)) out.push(cand[k][1], cand[k][2]);
    return out;
  },

  /**
   * Draw platoon g (members `ids`) up in a firing line at (cx, cy) facing (fx, fy); with no point, where it stands.
   * `now`: place them there at once (the battle has not begun); otherwise they walk, as under an order.
   */
  _deploy(g, ids, fx, fy, cx, cy, now) {
    const live = ids.filter((i) => this.alive[i] && UNITS[this.type[i]].speed);
    if (!live.length) return false;
    if (cx === null) { cx = 0; cy = 0; for (const i of live) { cx += this.x[i]; cy += this.y[i]; } cx /= live.length; cy /= live.length; }
    const tier = this.tier[this.map.cellOf(cx, cy)];
    if (!this._groundOk(cx, cy, tier)) return false;
    if (!now) this._claimAll(new Set(live)); // (before the battle the whole garrison's ground is claimed at once: see _platoonsStart)
    const pos = this._lineSlots(cx, cy, fx, fy, live.length, tier), k = pos.length / 2;
    if (k < live.length) return false;
    this._assignSlots(live, pos, -fy, fx, now, null);
    this.gFaceX[g] = fx; this.gFaceY[g] = fy;
    return true;
  },

  /**
   * Send `live` men to the places `pos`, matched in order along the line (so nobody crosses his neighbors to get to his
   * place). `fi` is the path field for walking there, if any.
   */
  _assignSlots(live, pos, rx, ry, now, fi) {
    const n = live.length, slots = [];
    for (let k = 0; k < n; k++) slots.push(k);
    const lat = (x, y) => x * rx + y * ry;
    slots.sort((a, b) => lat(pos[a * 2], pos[a * 2 + 1]) - lat(pos[b * 2], pos[b * 2 + 1]) || a - b);
    const men = live.slice().sort((a, b) => lat(this.x[a], this.y[a]) - lat(this.x[b], this.y[b]) || a - b);
    const face = Math.atan2(ry, -rx) - Math.PI / 2; // (r is the line's right hand: the front is r turned a quarter back)
    for (let k = 0; k < n; k++) {
      const i = men[k], x = pos[slots[k] * 2], y = pos[slots[k] * 2 + 1];
      this.ax[i] = x; this.ay[i] = y;
      if (now) {
        this.x[i] = this.px[i] = this.bx[i] = x; this.y[i] = this.py[i] = this.by[i] = y;
        this.rot[i] = this.trot[i] = Math.atan2(rx, -ry);
      } else {
        this.tx[i] = x; this.ty[i] = y; this.state[i] = S_MOVE; this.ord[i] = fi === null ? -1 : fi; this.target[i] = -1;
        this.aux[i] = this.time + 30 + Math.hypot(x - this.x[i], y - this.y[i]) / (UNITS[this.type[i]].speed || 1) * 4;
      }
    }
    void face;
  },

  /** Auto or manual, for the given defenders' platoons. */
  setAuto(ids, on) { for (const i of ids) if (this.alive[i] && this.team[i] === DEF) { const g = this.grp[i]; this.gAuto[g] = on ? 1 : 0; if (!on) { this.gTask[g] = 0; this.gHomeX[g] = -1; this.gHoldA[g] = 0; } } },

  /** Twice a second or so, each platoon looks round (auto platoons act on what they see). */
  _platoons() {
    if (this.tick % THINK !== 11) return;
    if (this.time - this._autoSolveT > 1) { this._autoSolveT = this.time; this._autoSolves = 0; }
    const mem = this._members();
    for (const [g, ids] of mem) {
      if (g === this.miscGroup[DEF] || this.gExempt[g] || !ids.length) continue;
      const d = UNITS[this.type[ids[0]]];
      if (!this._platoonable(d)) continue;
      this._remnant(g, ids, mem);
      if (!this.gAuto[g]) { this.gHoldA[g] = 0; continue; }
      // fire discipline: with pouches getting light, an auto platoon lets them come closer, where shots tell
      { let am = 0, mx = 0; for (const i of ids) { am += Math.min(this.ammo[i], this.maxAmmo(i)); mx += this.maxAmmo(i); } const fr = mx ? am / mx : 1; this.gHoldA[g] = fr < 0.3 ? 75 : fr < 0.6 ? 150 : 0; }
      if (this.gState[g] >= 2 || !this.gAlive[g]) continue;
      let moving = 0;
      for (const i of ids) if (this.state[i] === S_MOVE) moving++;
      if (moving > ids.length / 3) continue;
      if (this.time - this.gMoveT[g] < MOVE_GAP) continue;
      this._autoThink(g, ids);
    }
  },

  /** A platoon reduced to a remnant joins the nearest platoon on its level within 30 m. */
  _remnant(g, ids, mem) {
    if (this.gAlive[g] >= Math.max(4, this.gN0[g] * 0.25) || this.gN0[g] < 8) return;
    const i0 = ids[0], lv = this.el[i0], cx = this.gCx[g], cy = this.gCy[g];
    let best = -1, bd = 900;
    for (const [h, hs] of mem) {
      if (h === g || h === this.miscGroup[DEF] || this.gExempt[h] || !hs.length || this.el[hs[0]] !== lv || !this._platoonable(UNITS[this.type[hs[0]]]) || this.gState[h] >= 2) continue;
      const d2 = (this.gCx[h] - cx) ** 2 + (this.gCy[h] - cy) ** 2;
      if (d2 < bd) { bd = d2; best = h; }
    }
    if (best < 0) return;
    for (const i of ids) { this.grp[i] = best; this.gAlive[g]--; this.gAlive[best]++; this.gN0[best]++; }
    mem.set(best, mem.get(best).concat(ids)); mem.set(g, []);
  },

  /** What an idle platoon in auto mode does. */
  _autoThink(g, ids) {
    const cx = this.gCx[g], cy = this.gCy[g], i0 = ids[0], lv = this.el[i0], idle = this.time - this.gFireT[g] > IDLE;
    // --- ammo: nearly out, and a cache within reach
    let am = 0, mx = 0;
    for (const i of ids) { am += Math.min(this.ammo[i], this.maxAmmo(i)); mx += this.maxAmmo(i); }
    const frac = mx ? am / mx : 1;
    if (this.gTask[g] === 3) {
      if (frac > 0.8 && this.gHomeX[g] >= 0) { this._autoMove(g, ids, this.gHomeX[g], this.gHomeY[g], 0); this.gHomeX[g] = -1; }
      return;
    }
    if (frac < 0.15) {
      let best = -1, bd = 300 * 300;
      for (const c of this.caches) { if (!this.alive[c] || this.ammo[c] < 5) continue; const d2 = (this.x[c] - cx) ** 2 + (this.y[c] - cy) ** 2; if (d2 < bd) { bd = d2; best = c; } }
      if (best >= 0 && bd > (SUPPLY_R - 10) ** 2) {
        const dx = cx - this.x[best], dy = cy - this.y[best], l = Math.sqrt(dx * dx + dy * dy) || 1;
        if (this.gHomeX[g] < 0) { this.gHomeX[g] = cx; this.gHomeY[g] = cy; }
        if (this._autoMove(g, ids, this.x[best] + (dx / l) * 18, this.y[best] + (dy / l) * 18, 3)) this._alert('rearm' + g, 60, 'Platoon going back for ammo', '', cx, cy);
        return;
      }
    }
    if (!idle) return;
    if (lv) {
      // --- on a wall: shift along it to a stretch under attack nearby
      const c0 = this.map.cellOf(cx, cy), k0 = this.mseg[c0];
      if (k0 < 0) return;
      const wg = this.segs[k0].group;
      let best = -1, bs = 12;
      for (let k = 0; k < this.segs.length; k++) {
        const s = this.segs[k];
        if (s.group !== wg || s.breached || s.kind !== 'wall' && wg === 0) continue;
        const d = Math.hypot(s.x - cx, s.y - cy);
        if (d < 25 || d > 110) continue;
        const ox = (s.ox / OCS) | 0, oy = (s.oy / OCS) | 0;
        let n = 0;
        for (let yy = Math.max(0, oy - 1); yy <= Math.min(OH - 1, oy + 1); yy++) for (let xx = Math.max(0, ox - 2); xx <= Math.min(OW - 1, ox + 1); xx++) n += this.ocCount[yy * OW + xx];
        n += s.ladders * 20;
        const def = this._defNear(s.x, s.y, 12, 1);
        const sc = n / (1 + def * 0.5) - d * 0.05;
        if (sc > bs) { bs = sc; best = k; }
      }
      if (best >= 0) { const s = this.segs[best]; if (this.gHomeX[g] < 0) { this.gHomeX[g] = cx; this.gHomeY[g] = cy; } this._autoMove(g, ids, s.x, s.y, 1); }
      return;
    }
    // --- on the ground: attackers inside the works (on a wall walk, or come through into the Deep or a court) within 250 m
    let bx = 0, by = 0, bn = 0;
    const x0 = Math.max(0, ((cx - 250) / OCS) | 0), x1 = Math.min(OW - 1, ((cx + 250) / OCS) | 0), y0 = Math.max(0, ((cy - 250) / OCS) | 0), y1 = Math.min(OH - 1, ((cy + 250) / OCS) | 0);
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      for (let j = this.ocHead[yy * OW + xx]; j >= 0; j = this.cnext[j]) {
        const inside = this.el[j] || this.x[j] > this.map.wallAt(Math.max(0, Math.min(1, (this.y[j] - this.map.wallJoin.y) / (this.map.wallTop.y - this.map.wallJoin.y)))).x + 6;
        if (!inside) continue;
        bx += this.x[j]; by += this.y[j]; bn++;
      }
    }
    if (bn >= 6) {
      bx /= bn; by /= bn;
      const dx = cx - bx, dy = cy - by, l = Math.sqrt(dx * dx + dy * dy) || 1;
      if (l > 70) {
        // a firing position 50 m short of them, on this platoon's side
        let tx = bx + (dx / l) * 50, ty = by + (dy / l) * 50;
        const tier = this.tier[this.map.cellOf(cx, cy)];
        if (!this._groundOk(tx, ty, tier)) { tx = bx + (dx / l) * 80; ty = by + (dy / l) * 80; }
        if (this._groundOk(tx, ty, tier)) { if (this.gHomeX[g] < 0) { this.gHomeX[g] = cx; this.gHomeY[g] = cy; } if (this._autoMove(g, ids, tx, ty, 2, -dx / l, -dy / l)) this._alert('counter' + g, 60, 'Reserve moving to engage', '', tx, ty); }
        return;
      }
    }
    // --- the line faces the wrong way: attackers within reach have come round its flank
    const w = UNITS[this.type[ids[0]]].wdef;
    if (w && this.gFaceX[g] !== -1 || this.gFaceY[g] !== 0) {
      const f = this._threatDir(ids);
      const near = this._orcMassNear(cx, cy, w ? w.range : 200);
      if (near && f[0] * this.gFaceX[g] + f[1] * this.gFaceY[g] < 0.5) { this._deploy(g, ids, f[0], f[1], null, null, false); this.gMoveT[g] = this.time; }
    }
    // --- nothing doing, and away from its post: go back to it
    if (this.gTask[g] && this.gHomeX[g] >= 0 && this.time - this.gFireT[g] > 30) { this._autoMove(g, ids, this.gHomeX[g], this.gHomeY[g], 0); this.gHomeX[g] = -1; }
  },

  /** Are there attackers within r of a point (a quick look at the coarse grid)? */
  _orcMassNear(x, y, r) {
    const x0 = Math.max(0, ((x - r) / OCS) | 0), x1 = Math.min(OW - 1, ((x + r) / OCS) | 0), y0 = Math.max(0, ((y - r) / OCS) | 0), y1 = Math.min(OH - 1, ((y + r) / OCS) | 0);
    let n = 0;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) n += this.ocCount[yy * OW + xx];
    return n >= 6;
  },

  /** Defenders on level lv within r of a point. */
  _defNear(x, y, r, lv) {
    const cx = (x / DCS) | 0, cy = (y / DCS) | 0, m = Math.ceil(r / DCS);
    let n = 0;
    for (let yy = Math.max(0, cy - m); yy <= Math.min(DH - 1, cy + m); yy++) for (let xx = Math.max(0, cx - m); xx <= Math.min(DW - 1, cx + m); xx++) {
      for (let j = this.dcHead[yy * DW + xx]; j >= 0; j = this.cnext[j]) if (this.el[j] === lv && (this.x[j] - x) ** 2 + (this.y[j] - y) ** 2 < r * r) n++;
    }
    return n;
  },

  /** A move a platoon makes on its own account. Path fields cost a few milliseconds: no more than two a second for the whole garrison. */
  _autoMove(g, ids, x, y, task, fx, fy) {
    if (this._autoSolves >= 2) return false;
    this._autoSolves++;
    const ok = this.orderMove(ids, x, y, fx, fy, true);
    if (ok) { this.gMoveT[g] = this.time; this.gTask[g] = task; this.stats.autoMoves++; }
    return ok;
  },
};

/** Exported for the UI: is this group a platoon of the garrison? */
export const isPlatoon = (sim, g) => sim.gTeam[g] === DEF && !sim.gExempt[g] && g !== sim.miscGroup[DEF];

