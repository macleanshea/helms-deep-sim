// Flow-field solver on the nav grid (Dial's bucketed Dijkstra over integer costs).
// A field stores, per cell, the neighbor direction that leads toward the nearest source.
//
// Movement rules encoded here (and mirrored by Sim.canEnter):
//  - ground to ground: only if the walking heights differ by at most `step`
//  - onto or off a built roadway (`way`): only where it is level with the ground beside it (WAY_STEP)
//  - along a wall walk: free within the same fortification group
//  - ground <-> wall walk: only through a stair head or door (`portal` bits),
//    or up a raised ladder / docked siege tower (`ladder` cells, attackers only)
//  - with `virt`, a closed wall can still be "entered" at a huge cost so that a field
//    leads attackers to press against the stretch of wall nearest the defenders.
//  - `jump` links join two cells that are not neighbors: the foot of a long ladder on the valley
//    floor and the wall walk it leans on, across the band of rock between them.

import { WAY_STEP } from '../config.js';

export const DX = [1, 1, 0, -1, -1, -1, 0, 1];
export const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const S2 = Math.SQRT1_2;
export const DXN = [1, S2, 0, -S2, -1, -S2, 0, S2];
export const DYN = [0, S2, 1, S2, 0, -S2, -1, -S2];
const B = 8192, MASK = B - 1; // bucket count must exceed the largest single step cost

export class FlowSolver {
  constructor(gw, gh) {
    this.gw = gw; this.gh = gh;
    const n = gw * gh;
    this.dist = new Int32Array(n);
    this.bhead = new Int32Array(B);
    this.enode = new Int32Array(n * 8 + 4096); this.edist = new Int32Array(n * 8 + 4096); this.enext = new Int32Array(n * 8 + 4096); // (room for the jump links too)
  }

  /**
   * @param cost    Uint16Array, 0 = impassable, otherwise cost of entering the cell
   * @param sources Int32Array of source cells
   * @param dirOut  Uint8Array receiving direction index 0..7 (255 = none)
   * @param nav     { cz, elev, portal, step, ladder?, virt?, way?, jump? }
   *                cz Float32 walking height, elev Uint8 (0 ground, else wall group + 1),
   *                portal Uint8 link bits, ladder Uint8 cells with a way up,
   *                virt Uint16 per cell: cost of "pressing" into a closed wall (0 = never),
   *                way Uint8: 1 on a built roadway, whose sides are walled (see WAY_STEP)
   *                jump { head: Int32 per cell (-1 none), from, cost, dir, next }: links into a cell from a cell
   *                that is not its neighbor, listed under the cell they lead into; `dir` is the way a unit at
   *                `from` sets off (it cannot walk there: it climbs, see Sim._startClimb)
   */
  solve(cost, sources, nsrc, dirOut, nav) {
    const { gw, gh, dist, bhead, enode, edist, enext } = this;
    const { cz, elev, portal, step, ladder, virt, way, jump } = nav;
    const jh = jump && jump.count ? jump.head : null;
    dist.fill(0x7fffffff);
    dirOut.fill(255);
    bhead.fill(-1);
    let ec = 0, pending = 0;
    for (let i = 0; i < nsrc; i++) {
      const s = sources[i];
      if (dist[s] !== 0) { dist[s] = 0; enode[ec] = s; edist[ec] = 0; enext[ec] = bhead[0]; bhead[0] = ec++; pending++; }
    }
    for (let cur = 0; pending > 0; cur++) {
      const b = cur & MASK;
      let e = bhead[b];
      if (e < 0) continue;
      bhead[b] = -1;
      for (; e >= 0; e = enext[e]) {
        pending--;
        const u = enode[e];
        if (edist[e] !== dist[u]) continue;
        const ux = u % gw, uy = (u / gw) | 0;
        const cu = cost[u], cd = Math.round(cu * 1.4142), eu = elev[u], zu = cz[u];
        for (let k = 0; k < 8; k++) {
          // a unit standing in n moves in direction k to reach u
          const nx = ux - DX[k], ny = uy - DY[k];
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const n = ny * gw + nx;
          if (cost[n] === 0) continue;
          let st = (k & 1) ? cd : cu;
          const en = elev[n];
          if (en === eu) {
            if (!eu) {
              const dz = cz[n] - zu;
              if (dz > step || dz < -step) continue;
              if (way && way[n] !== way[u] && (dz > WAY_STEP || dz < -WAY_STEP)) continue; // a roadway's walled side
            }
          } else if (!((portal[n] >> k) & 1)) {
            if (en) continue;                            // no jumping off a wall
            if (ladder && ladder[u]) st += 45;           // climb
            else if (virt && virt[u]) st += virt[u];     // press against the masonry
            else continue;
          }
          const nd = cur + st;
          if (nd < dist[n]) {
            dist[n] = nd; dirOut[n] = k;
            const nb = nd & MASK;
            enode[ec] = n; edist[ec] = nd; enext[ec] = bhead[nb]; bhead[nb] = ec++; pending++;
          }
        }
        if (jh) for (let j = jh[u]; j >= 0; j = jump.next[j]) {
          const n = jump.from[j];
          if (cost[n] === 0) continue;
          const nd = cur + cu + jump.cost[j];
          if (nd < dist[n]) {
            dist[n] = nd; dirOut[n] = jump.dir[j];
            const nb = nd & MASK;
            enode[ec] = n; edist[ec] = nd; enext[ec] = bhead[nb]; bhead[nb] = ec++; pending++;
          }
        }
      }
    }
  }
}
