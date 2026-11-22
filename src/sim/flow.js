// Dijkstra flow-field solver on the nav grid.
// A field stores, per cell, the neighbour direction that leads toward the nearest source.

export const DX = [1, 1, 0, -1, -1, -1, 0, 1];
export const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const S2 = Math.SQRT1_2;
export const DXN = [1, S2, 0, -S2, -1, -S2, 0, S2];
export const DYN = [0, S2, 1, S2, 0, -S2, -1, -S2];
const B = 1024, MASK = B - 1; // bucket count must exceed the largest single step cost

export class FlowSolver {
  constructor(gw, gh, cell) {
    this.gw = gw; this.gh = gh; this.cell = cell;
    const n = gw * gh;
    this.dist = new Int32Array(n);
    this.bhead = new Int32Array(B);
    this.enode = new Int32Array(n * 8 + 16); this.edist = new Int32Array(n * 8 + 16); this.enext = new Int32Array(n * 8 + 16);
  }

  /**
   * Dial's algorithm (bucketed Dijkstra) over integer step costs.
   * @param cost    Uint16Array, 0 = impassable, otherwise cost of entering the cell
   * @param sources Int32Array of source cells
   * @param dirOut  Uint8Array receiving direction index 0..7 (255 = none)
   * @param wall    optional {seg, open, group, gate, sx, sy, nx, ny} describing fortifications
   */
  solve(cost, sources, nsrc, dirOut, wall) {
    const { gw, gh, dist, cell, bhead, enode, edist, enext } = this;
    dist.fill(0x7fffffff);
    dirOut.fill(255);
    bhead.fill(-1);
    let ec = 0, pending = 0;
    for (let i = 0; i < nsrc; i++) {
      const s = sources[i];
      if (dist[s] !== 0) { dist[s] = 0; enode[ec] = s; edist[ec] = 0; enext[ec] = bhead[0]; bhead[0] = ec++; pending++; }
    }
    const half = cell / 2;
    const wseg = wall ? wall.seg : null;
    for (let cur = 0; pending > 0; cur++) {
      const b = cur & MASK;
      let e = bhead[b];
      if (e < 0) continue;
      bhead[b] = -1;
      for (; e >= 0; e = enext[e]) {
        pending--;
        const u = enode[e];
        if (edist[e] !== dist[u]) continue;
        const d = cur;
        const ux = u % gw, uy = (u / gw) | 0;
        const cu = cost[u], cd = Math.round(cu * 1.4142);
        let su = -1, closed = false;
        if (wseg) { su = wseg[u]; closed = su >= 0 && !wall.open[su]; }
        for (let k = 0; k < 8; k++) {
          // a unit standing in n moves in direction k to reach u
          const nx = ux - DX[k], ny = uy - DY[k];
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const n = ny * gw + nx;
          if (cost[n] === 0) continue;
          let step = (k & 1) ? cd : cu;
          if (closed) {
            const sn = wseg[n];
            if (!(sn >= 0 && wall.group[sn] === wall.group[su])) {
              const inner = !wall.gate[su] && ((nx * cell + half - wall.sx[su]) * wall.nx[su] + (ny * cell + half - wall.sy[su]) * wall.ny[su] < 0);
              step += inner ? 30 : 600;
            }
          }
          const nd = d + step;
          if (nd < dist[n]) {
            dist[n] = nd; dirOut[n] = k;
            const nb = nd & MASK;
            enode[ec] = n; edist[ec] = nd; enext[ec] = bhead[nb]; bhead[nb] = ec++; pending++;
          }
        }
      }
    }
  }
}
