// Lines of fire for the garrison. Mixed into Sim.prototype.
//
// A soldier cannot shoot through the men in front of him. Standing still, each defender on foot
// has a rank, counted from the friends in a narrow lane ahead of him:
//   on flat ground   nobody ahead: prone      one: kneeling    two: standing    more: no line of fire
//   on a wall walk   nobody ahead: kneeling at the parapet     one: standing    more: no line of fire
// So three ranks can fire on the flat and two on a battlement, where the parapet takes the place of
// the prone man. A man with no line of fire looks for a place that has one (a free spot at the
// parapet, or a sidestep on the flat) and walks to it, never far from where he was posted; when a
// man in front falls, the one behind steps up. On a wall a man covers the ground before him, 75
// degrees either side of straight out: he cannot fire along the wall. Standing men also take up
// room like anybody else, and shuffle out of a spot that is over-full.
//
// Lobbed and indirect weapons (grenade launchers, mortars) go over friends' heads and are exempt.

import { WORLD_W, WORLD_H, DEF, ORC, T, UNITS, C } from '../config.js';
import { S_MOVE, FINE_CELL as FINE, FINE_W as FW, FINE_H as FH } from './sim.js';

const LANE = 6;            // how far ahead a friend still blocks (m)
const LANE_HALF = 0.5;     // half the width of the lane
const REACH2 = 30 * 30;    // a man will not go further than this from his post for a firing position
const ARC2 = 0.067;        // cos^2 of 75 degrees
const FULL = 4;            // bodies that fit in one fine cell (as for the attackers)

export const postMethods = {
  /**
   * Friends in the way of a shot from x,y along the unit vector ux,uy on level `lv`: standing
   * defenders on foot in the lane. A vehicle or gun in the way blocks outright (returns 9).
   */
  _lane(i, x, y, ux, uy, lv) {
    const x1 = x + ux * LANE, y1 = y + uy * LANE;
    const cx0 = Math.max(0, ((Math.min(x, x1) - 3) / FINE) | 0), cx1 = Math.min(FW - 1, ((Math.max(x, x1) + 3) / FINE) | 0);
    const cy0 = Math.max(0, ((Math.min(y, y1) - 3) / FINE) | 0), cy1 = Math.min(FH - 1, ((Math.max(y, y1) + 3) / FINE) | 0);
    const { head, next, team, alive, el, type, state, rad } = this, X = this.x, Y = this.y, tr = this.tier[this.map.cellOf(x, y)];
    let n = 0;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      for (let j = head[cy * FW + cx]; j >= 0; j = next[j]) {
        if (j === i || team[j] !== DEF || !alive[j] || el[j] !== lv) continue;
        const dx = X[j] - x, dy = Y[j] - y, along = dx * ux + dy * uy;
        if (along < 0.45) continue;
        if (!lv && tr !== this.tier[this.map.cellOf(X[j], Y[j])]) continue; // (men in another court stand above or below the shot)
        const cls = UNITS[type[j]].cls;
        let lat = dx * uy - dy * ux; if (lat < 0) lat = -lat;
        if (cls === C.VEH || cls === C.GUN) { if (along < LANE + 2 && lat < rad[j] + 0.3) return 9; continue; }
        if (cls !== C.INF || along > LANE || lat >= LANE_HALF || state[j] === S_MOVE) continue;
        n++;
      }
    }
    return n;
  },

  /** Is an attacker within a few meters on the same level? */
  _orcClose(x, y, lv) {
    const fx = (x / FINE) | 0, fy = (y / FINE) | 0;
    for (let cy = Math.max(0, fy - 2); cy <= Math.min(FH - 1, fy + 2); cy++) for (let cx = Math.max(0, fx - 2); cx <= Math.min(FW - 1, fx + 2); cx++) {
      for (let j = this.head[cy * FW + cx]; j >= 0; j = this.next[j]) {
        if (this.team[j] !== ORC || !this.alive[j] || this.el[j] !== lv) continue;
        const dx = this.x[j] - x, dy = this.y[j] - y;
        if (dx * dx + dy * dy < 25) return true;
      }
    }
    return false;
  },

  /** Is the spot px,py clear of other standing defenders on level `lv`? */
  _spotFree(px, py, lv, i) {
    const fx = (px / FINE) | 0, fy = (py / FINE) | 0;
    for (let cy = Math.max(0, fy - 1); cy <= Math.min(FH - 1, fy + 1); cy++) for (let cx = Math.max(0, fx - 1); cx <= Math.min(FW - 1, fx + 1); cx++) {
      for (let j = this.head[cy * FW + cx]; j >= 0; j = this.next[j]) {
        if (j === i || this.team[j] !== DEF || !this.alive[j] || this.el[j] !== lv) continue;
        const dx = this.x[j] - px, dy = this.y[j] - py;
        if (dx * dx + dy * dy < 0.7) return false;
      }
    }
    return true;
  },

  /**
   * Twice a second for a defender on foot who is standing still: his rank (0-2 may fire, 3 has
   * no line of fire) and his posture (0 standing, 1 kneeling, 2 prone).
   */
  _post(i, d, x, y, eg, c) {
    const lv = eg ? 1 : 0, w = d.wdef;
    if (!w || w.arc) { this.rank[i] = 0; this.pose[i] = 0; return; }
    let ux, uy, parapet = false;
    if (eg) {
      // on a wall he faces out over the parapet, unless what he is shooting at is inside the walls
      const s = this.segs[this.mseg[c]];
      ux = s.nx; uy = s.ny;
      const t = this.target[i];
      if (t >= 0 && this.alive[t] && (this.x[t] - x) * ux + (this.y[t] - y) * uy < 0) { ux = -ux; uy = -uy; }
      else parapet = (x - s.x) * s.nx + (y - s.y) * s.ny > s.half - 2.3;
    } else { ux = Math.cos(this.rot[i]); uy = Math.sin(this.rot[i]); }
    const n = this._lane(i, x, y, ux, uy, lv);
    let rank, pose;
    if (eg) { rank = n === 0 ? 0 : n === 1 ? 1 : 3; pose = n === 0 && parapet ? 1 : 0; }
    else { rank = n > 2 ? 3 : n; pose = n === 0 ? 2 : n === 1 ? 1 : 0; }
    // he stands easy until there is something to shoot at, and gets to his feet with an enemy at arm's length
    if (rank === 3 || d.cmd || (this.target[i] < 0 && this.time - this.fireT[i] > 12) || this._orcClose(x, y, lv)) pose = 0;
    this.rank[i] = rank; this.pose[i] = pose;
    // too many bodies in one spot: shuffle out of it
    if (this.time >= this.seekT[i] && this.occ[(((y / FINE) | 0) * FW + ((x / FINE) | 0)) * 2 + lv] > FULL) this._settle(i, d, x, y, eg);
  },

  /** May a man on a wall (outward normal this._anx,_any) fire at something offset ex,ey from him? */
  _arc(j, ex, ey, e2) {
    if (!this._arcOn || this.el[j]) return true;           // along the wall top itself: no parapet in the way
    const o = ex * this._anx + ey * this._any;
    if (o * o < ARC2 * e2) return false;                   // along the wall
    return o > 0 || e2 < 3600;                             // out over the parapet, or down inside the walls close by
  },

  /** Send defender i to px,py on his own account (not an order: his post stays where it was). */
  _goPost(i, d, x, y, px, py) {
    this.tx[i] = px; this.ty[i] = py; this.state[i] = S_MOVE; this.ord[i] = -1; this.target[i] = -1; this.target2[i] = -1;
    this.aux[i] = this.time + 6 + (Math.hypot(px - x, py - y) / (d.speed || 1)) * 3;
    this.resT[((py / FINE) | 0) * FW + ((px / FINE) | 0)] = this.time + 8;
    this.stats.reposts++;
  },

  /** A man with no line of fire looks for a place that has one. Returns true if he sets off for it. */
  _seek(i, d, x, y, eg, c) {
    this.seekT[i] = this.time + 3 + (i % 7) * 0.2;
    const ax = this.ax[i], ay = this.ay[i], lv = eg ? 1 : 0, tr0 = this.tier[this.map.cellOf(x, y)];
    let bx = 0, by = 0, bd = 1e9;
    const tryAt = (px, py, extra) => {
      if (px < 3 || py < 3 || px > WORLD_W - 3 || py > WORLD_H - 3) return;
      if ((px - ax) * (px - ax) + (py - ay) * (py - ay) > REACH2) return;
      const dd = (px - x) * (px - x) + (py - y) * (py - y) + extra;
      if (dd >= bd) return;
      const pc = this.map.cellOf(px, py);
      if (this.elevD[pc] !== eg || this.mtype[pc] === T.CLIFF || (!eg && (this.mtype[pc] === T.STAIR || this.tier[pc] !== tr0))) return;
      if (this.resT[((py / FINE) | 0) * FW + ((px / FINE) | 0)] > this.time || !this._spotFree(px, py, lv, i)) return;
      bd = dd; bx = px; by = py;
    };
    if (eg) {
      // free places at the parapet of his own stretch of wall and the next few: front rank first, then the second
      const k0 = this.mseg[c], g0 = this.segs[k0].group;
      for (let dk = -3; dk <= 3; dk++) {
        const s = this.segs[k0 + dk];
        if (!s || s.group !== g0 || s.breached) continue;
        const m = Math.floor(s.len / 1.2);
        for (let r = 0; r < 2; r++) {
          const off = s.half - (r ? 2.6 : 1.0);
          for (let q = 0; q < m; q++) { const u = (q + 0.5) * 1.2 - (m * 1.2) / 2; tryAt(s.x + s.tx * u + s.nx * off, s.y + s.ty * u + s.ny * off, r ? 40 : 0); }
        }
      }
    } else {
      // on the flat: a sidestep to a clear lane, or forward into a gap in the ranks ahead
      const ux = Math.cos(this.rot[i]), uy = Math.sin(this.rot[i]);
      for (let k = 1; k <= 5; k++) for (let sg = -1; sg <= 1; sg += 2) {
        const qx = x - uy * 1.3 * k * sg, qy = y + ux * 1.3 * k * sg;
        if (this._lane(i, qx, qy, ux, uy, 0) <= 2) tryAt(qx, qy, 0);
      }
      for (let k = 1; k <= 3; k++) { const qx = x + ux * 1.6 * k, qy = y + uy * 1.6 * k; if (this._lane(i, qx, qy, ux, uy, 0) <= 2) tryAt(qx, qy, 6); }
    }
    if (bd > 1e8) { this.seekT[i] = this.time + 5 + (i % 5) * 0.3; return false; }
    this._goPost(i, d, x, y, bx, by);
    return true;
  },

  /** A man standing in an over-full spot moves to the nearest ground on his level with room. */
  _settle(i, d, x, y, eg) {
    this.seekT[i] = this.time + 2 + (i % 5) * 0.3;
    const fx = (x / FINE) | 0, fy = (y / FINE) | 0, lv = eg ? 1 : 0, ax = this.ax[i], ay = this.ay[i], tr0 = this.tier[this.map.cellOf(x, y)];
    const home = (x - ax) * (x - ax) + (y - ay) * (y - ay);
    for (let r = 1; r <= 4; r++) {
      let bx = -1, by = 0, bd = 1e9;
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        if (Math.max(ox < 0 ? -ox : ox, oy < 0 ? -oy : oy) !== r) continue;
        const cx = fx + ox, cy = fy + oy;
        if (cx < 1 || cy < 1 || cx >= FW - 1 || cy >= FH - 1) continue;
        const f = cy * FW + cx;
        if (this.occ[f * 2 + lv] > 1 || this.resT[f] > this.time) continue;
        const px = cx * FINE + 1, py = cy * FINE + 1, pc = this.map.cellOf(px, py);
        if (this.elevD[pc] !== eg || this.mtype[pc] === T.CLIFF || (!eg && (this.mtype[pc] === T.STAIR || this.tier[pc] !== tr0))) continue;
        const da = (px - ax) * (px - ax) + (py - ay) * (py - ay);
        if (da > REACH2 && da > home) continue; // (a man who never reached his post may still shuffle, but not further from it)
        const dd = ox * ox + oy * oy + ((i + cx * 3 + cy) % 3) * 0.1;
        if (dd < bd) { bd = dd; bx = px; by = py; }
      }
      if (bx >= 0) { this._goPost(i, d, x, y, bx, by); return true; }
    }
    return false;
  },
};
