// Triangle reduction for the unit pipeline: quadric-error edge collapse that only ever moves a vertex onto
// one of its neighbours, so every surviving vertex is an original one and keeps its texture coordinate,
// normal and bone weights untouched.
//
// A model's vertices are split along texture seams (two vertices, one place). Collapses are decided per place,
// and each corner of a triangle that moves takes the vertex of the destination that lies on its own side of the seam.

/**
 * @param pos    Float32Array, 3 per vertex
 * @param uv     Float32Array, 2 per vertex (used only to choose between a place's vertices across a seam)
 * @param index  triangle list
 * @param target triangles wanted
 * @returns Uint32Array triangle list over the same vertices (unused ones are simply no longer referenced)
 */
export function simplify(pos, uv, index, target) {
  const nv = pos.length / 3, nt0 = index.length / 3;
  // places: vertices that share a position
  const place = new Int32Array(nv), seen = new Map();
  let np = 0;
  for (let v = 0; v < nv; v++) {
    const k = `${Math.round(pos[v * 3] * 1e5)},${Math.round(pos[v * 3 + 1] * 1e5)},${Math.round(pos[v * 3 + 2] * 1e5)}`;
    let p = seen.get(k); if (p == null) { p = np++; seen.set(k, p); }
    place[v] = p;
  }
  const px = new Float64Array(np * 3);
  for (let v = nv - 1; v >= 0; v--) { const p = place[v]; px[p * 3] = pos[v * 3]; px[p * 3 + 1] = pos[v * 3 + 1]; px[p * 3 + 2] = pos[v * 3 + 2]; }
  const tri = Uint32Array.from(index), alive = new Uint8Array(nt0).fill(1);
  const tris = Array.from({ length: np }, () => new Set()); // triangles at each place
  const Q = new Float64Array(np * 10);
  const addPlane = (p, a, b, c, d, w) => { const q = p * 10; Q[q] += a * a * w; Q[q + 1] += a * b * w; Q[q + 2] += a * c * w; Q[q + 3] += a * d * w; Q[q + 4] += b * b * w; Q[q + 5] += b * c * w; Q[q + 6] += b * d * w; Q[q + 7] += c * c * w; Q[q + 8] += c * d * w; Q[q + 9] += d * d * w; };
  const normal = (a, b, c, out) => {
    const ux = px[b * 3] - px[a * 3], uy = px[b * 3 + 1] - px[a * 3 + 1], uz = px[b * 3 + 2] - px[a * 3 + 2], vx = px[c * 3] - px[a * 3], vy = px[c * 3 + 1] - px[a * 3 + 1], vz = px[c * 3 + 2] - px[a * 3 + 2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
    return out;
  };
  const N = [0, 0, 0], N2 = [0, 0, 0], edgeUse = new Map();
  let live = 0;
  for (let t = 0; t < nt0; t++) {
    const a = place[tri[t * 3]], b = place[tri[t * 3 + 1]], c = place[tri[t * 3 + 2]];
    if (a === b || b === c || a === c) { alive[t] = 0; continue; }
    live++;
    tris[a].add(t); tris[b].add(t); tris[c].add(t);
    normal(a, b, c, N);
    const l = Math.hypot(N[0], N[1], N[2]) || 1e-12, nx = N[0] / l, ny = N[1] / l, nz = N[2] / l, d = -(nx * px[a * 3] + ny * px[a * 3 + 1] + nz * px[a * 3 + 2]);
    for (const p of [a, b, c]) addPlane(p, nx, ny, nz, d, l * 0.5);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? u * np + v : v * np + u; edgeUse.set(k, (edgeUse.get(k) || 0) + 1); }
  }
  // an open edge (a hem, a hole) is held in place by a plane standing on it
  for (let t = 0; t < nt0; t++) {
    if (!alive[t]) continue;
    const a = place[tri[t * 3]], b = place[tri[t * 3 + 1]], c = place[tri[t * 3 + 2]];
    normal(a, b, c, N);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      if (edgeUse.get(u < v ? u * np + v : v * np + u) !== 1) continue;
      const ex = px[v * 3] - px[u * 3], ey = px[v * 3 + 1] - px[u * 3 + 1], ez = px[v * 3 + 2] - px[u * 3 + 2];
      let bx = ey * N[2] - ez * N[1], by = ez * N[0] - ex * N[2], bz = ex * N[1] - ey * N[0];
      const l = Math.hypot(bx, by, bz) || 1e-12; bx /= l; by /= l; bz /= l;
      const d = -(bx * px[u * 3] + by * px[u * 3 + 1] + bz * px[u * 3 + 2]), w = (ex * ex + ey * ey + ez * ez) * 8;
      addPlane(u, bx, by, bz, d, w); addPlane(v, bx, by, bz, d, w);
    }
  }
  const errAt = (p, x, y, z) => { const q = p * 10; return Q[q] * x * x + 2 * Q[q + 1] * x * y + 2 * Q[q + 2] * x * z + 2 * Q[q + 3] * x + Q[q + 4] * y * y + 2 * Q[q + 5] * y * z + 2 * Q[q + 6] * y + Q[q + 7] * z * z + 2 * Q[q + 8] * z + Q[q + 9]; };
  // a binary heap of candidate collapses [cost, from, to, stamp of from, stamp of to]
  const heap = [], stamp = new Uint32Array(np), gone = new Uint8Array(np);
  const push = (e) => { let i = heap.length; heap.push(e); while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= e[0]) break; heap[i] = heap[p]; i = p; } heap[i] = e; };
  const pop = () => {
    const top = heap[0], e = heap.pop();
    if (heap.length) { let i = 0; for (;;) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= e[0]) break; heap[i] = heap[c]; i = c; } heap[i] = e; }
    return top;
  };
  const offer = (u, v) => push([errAt(u, px[v * 3], px[v * 3 + 1], px[v * 3 + 2]) + errAt(v, px[v * 3], px[v * 3 + 1], px[v * 3 + 2]), u, v, stamp[u], stamp[v]]);
  const neighbours = (p) => { const s = new Set(); for (const t of tris[p]) for (let k = 0; k < 3; k++) { const q = place[tri[t * 3 + k]]; if (q !== p) s.add(q); } return s; };
  for (let p = 0; p < np; p++) for (const q of neighbours(p)) offer(p, q);

  while (live > target && heap.length) {
    const [, u, v, su, sv] = pop();
    if (gone[u] || gone[v] || stamp[u] !== su || stamp[v] !== sv) continue;
    // would any triangle that stays turn over, or collapse to nothing?
    let bad = false;
    for (const t of tris[u]) {
      const a = place[tri[t * 3]], b = place[tri[t * 3 + 1]], c = place[tri[t * 3 + 2]];
      if (a === v || b === v || c === v) continue;
      normal(a, b, c, N);
      normal(a === u ? v : a, b === u ? v : b, c === u ? v : c, N2);
      const d = N[0] * N2[0] + N[1] * N2[1] + N[2] * N2[2], l2 = Math.hypot(N2[0], N2[1], N2[2]), l1 = Math.hypot(N[0], N[1], N[2]);
      if (d < 0.15 * l1 * l2 || l2 < 1e-12) { bad = true; break; }
    }
    if (bad) continue;
    // which vertex of `v` each vertex of `u` becomes: the one it shares a triangle with (the same side of a seam)
    const to = new Map(), atV = new Set();
    for (const t of tris[v]) for (let k = 0; k < 3; k++) if (place[tri[t * 3 + k]] === v) atV.add(tri[t * 3 + k]);
    for (const t of tris[u]) {
      let wu = -1, wv = -1;
      for (let k = 0; k < 3; k++) { const w = tri[t * 3 + k]; if (place[w] === u) wu = w; else if (place[w] === v) wv = w; }
      if (wv >= 0 && !to.has(wu)) to.set(wu, wv);
    }
    for (const t of [...tris[u]]) {
      const a = place[tri[t * 3]], b = place[tri[t * 3 + 1]], c = place[tri[t * 3 + 2]];
      if (a === v || b === v || c === v) { alive[t] = 0; live--; tris[a].delete(t); tris[b].delete(t); tris[c].delete(t); continue; }
      for (let k = 0; k < 3; k++) {
        const w = tri[t * 3 + k];
        if (place[w] !== u) continue;
        let nw = to.get(w);
        if (nw == null) { // across a seam from the collapsing edge: the vertex of `v` nearest in the texture
          let best = 1e18;
          for (const c2 of atV) { const d = (uv[c2 * 2] - uv[w * 2]) ** 2 + (uv[c2 * 2 + 1] - uv[w * 2 + 1]) ** 2; if (d < best) { best = d; nw = c2; } }
          to.set(w, nw);
        }
        tri[t * 3 + k] = nw;
      }
      tris[v].add(t);
    }
    tris[u].clear(); gone[u] = 1;
    for (let k = 0; k < 10; k++) Q[v * 10 + k] += Q[u * 10 + k];
    stamp[v]++;
    for (const q of neighbours(v)) { offer(v, q); offer(q, v); }
  }
  const out = new Uint32Array(live * 3);
  let o = 0;
  for (let t = 0; t < nt0; t++) if (alive[t]) { out[o++] = tri[t * 3]; out[o++] = tri[t * 3 + 1]; out[o++] = tri[t * 3 + 2]; }
  return out;
}
