// A fresh texture for each reduced level of detail.
//
// The generator cuts a model's texture into about a thousand small islands. Reduce the triangles and most of the
// survivors have corners on two or three islands, so the picture between them is a smear of whatever lies between
// those islands in the image: a soldier seen close is covered in shards. So each level is given a layout of its own
// (flat patches seen along the axis its triangles face, packed side by side) and the original picture is painted
// into it, texel by texel, from the nearest point of the full model. Every level then shows the true surface,
// whatever its triangles.
//
// Vertices are made anew per level: one for each place in each patch that uses it. They carry the number of an
// original vertex, from which the build takes position, normal and bone weights.

/**
 * @param m       { pos, nrm, uv, index }: the full model (model space; uv as the source picture is laid out)
 * @param levels  triangle lists over m's vertices, finest first (see simplify.js)
 * @param src     { w, h, px }: the source picture, RGB bytes, row 0 at v = 0
 * @param W, H    size of the picture to paint
 * @param regions [x, y, w, h] in it for each level
 * @param byBone  keep vertices of different bones apart even where they share a place (machines)
 * @param group   a number for each vertex (the figure 0, each piece of gear its own): a texel is painted only from its own
 *                group's surface, so a sword's grip does not take the color of the hand closed round it
 * @returns { px: Uint8Array(W * H * 3), levels: [{ from: Int32Array, uv: Float32Array, index: Uint32Array, charts }] }
 */
export function rebake(m, levels, src, W, H, regions, byBone = false, group = null) {
  const nv = m.pos.length / 3, pos = m.pos;
  // places: vertices that share a position
  const place = new Int32Array(nv), seen = new Map(), rep = [];
  for (let v = 0; v < nv; v++) {
    // (byBone: a machine's turret and hull meet in vertices that share a place but not a bone, and must stay two)
    const k = `${Math.round(pos[v * 3] * 1e5)},${Math.round(pos[v * 3 + 1] * 1e5)},${Math.round(pos[v * 3 + 2] * 1e5)}${byBone ? ',' + m.joints[v * 4] : ''}`;
    let p = seen.get(k); if (p == null) { p = rep.length; seen.set(k, p); rep.push(v); }
    place[v] = p;
  }
  const np = rep.length, P = new Float64Array(np * 3);
  for (let p = 0; p < np; p++) for (let e = 0; e < 3; e++) P[p * 3 + e] = pos[rep[p] * 3 + e];
  const near = nearest(m, group);
  const out = new Uint8Array(W * H * 3), done = new Uint8Array(W * H), res = [];
  const fr = (x) => x - Math.floor(x);
  const sample = (u, v, o) => {
    const x = Math.max(0, Math.min(src.w - 1.001, fr(u) * src.w - 0.5)), y = Math.max(0, Math.min(src.h - 1.001, fr(v) * src.h - 0.5));
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, a = (y0 * src.w + x0) * 3, b = a + 3, c = a + src.w * 3, d = c + 3, s = src.px;
    for (let e = 0; e < 3; e++) out[o + e] = Math.round((s[a + e] * (1 - fx) + s[b + e] * fx) * (1 - fy) + (s[c + e] * (1 - fx) + s[d + e] * fx) * fy);
  };

  levels.forEach((idx, level) => {
    const [RX, RY, RW, RH] = regions[level];
    // ---- this level's triangles, by place
    const T = [];
    for (let t = 0; t < idx.length; t += 3) { const a = place[idx[t]], b = place[idx[t + 1]], c = place[idx[t + 2]]; if (a !== b && b !== c && a !== c) T.push(a, b, c, idx[t], idx[t + 1], idx[t + 2]); }
    const nt = T.length / 6, fn = new Float64Array(nt * 3), cls = new Int8Array(nt);
    const edges = new Map(), adj = Array.from({ length: nt }, () => []);
    for (let t = 0; t < nt; t++) {
      const a = T[t * 6] * 3, b = T[t * 6 + 1] * 3, c = T[t * 6 + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
      fn[t * 3] = x; fn[t * 3 + 1] = y; fn[t * 3 + 2] = z;
      const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z), k = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
      cls[t] = k * 2 + (fn[t * 3 + k] < 0 ? 1 : 0);
      for (let e = 0; e < 3; e++) { const p = T[t * 6 + e], q = T[t * 6 + (e + 1) % 3], key = p < q ? p * np + q : q * np + p; const l2 = edges.get(key); if (l2) l2.push(t); else edges.set(key, [t]); }
    }
    for (const l of edges.values()) if (l.length === 2) { adj[l[0]].push(l[1]); adj[l[1]].push(l[0]); }
    const facing = (t, c) => fn[t * 3 + (c >> 1)] * (c & 1 ? -1 : 1);
    // a triangle among neighbors that mostly face another way joins them, if it can be seen from there: fewer, larger patches
    for (let pass = 0; pass < 4; pass++) for (let t = 0; t < nt; t++) {
      const n = adj[t]; if (n.length < 2) continue;
      let best = -1, bc = 0;
      for (const c of new Set(n.map((q) => cls[q]))) { const k = n.filter((q) => cls[q] === c).length; if (k > bc) { bc = k; best = c; } }
      if (best !== cls[t] && bc >= 2 && facing(t, best) > 0.3) cls[t] = best;
    }
    // a scrap of a few triangles facing its own way joins the neighbor it shares most edges with, where it can be seen from there
    for (let pass = 0; pass < (level ? 5 : 3); pass++) {
      const comp = new Int32Array(nt).fill(-1); let nc = 0;
      for (let seed = 0; seed < nt; seed++) {
        if (comp[seed] >= 0) continue;
        const mem = [seed], id = nc++; comp[seed] = id;
        for (let h = 0; h < mem.length; h++) for (const n of adj[mem[h]]) if (comp[n] < 0 && cls[n] === cls[seed]) { comp[n] = id; mem.push(n); }
        if (mem.length > (level ? 24 : 10)) continue;
        const votes = new Map();
        for (const t of mem) for (const n of adj[t]) if (cls[n] !== cls[seed]) votes.set(cls[n], (votes.get(cls[n]) || 0) + 1);
        let best = -1, bc = 0;
        for (const [c, k] of votes) if (k > bc && mem.every((t) => facing(t, c) > (level ? 0.08 : 0.15))) { bc = k; best = c; }
        if (best >= 0) for (const t of mem) cls[t] = best;
      }
    }
    // ---- patches: neighboring triangles that face the same way, as long as they do not lie over one another seen from there
    const chart = new Int32Array(nt).fill(-1), charts = [];
    const uvOf = (p, c, o) => { const a = c >> 1; o[0] = P[p * 3 + (a + 1) % 3]; o[1] = P[p * 3 + (a + 2) % 3]; };
    let area = 0; for (let t = 0; t < nt; t++) { const a = T[t * 6] * 3, b = T[t * 6 + 1] * 3, c = T[t * 6 + 2] * 3; area += Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]) * Math.hypot(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]) * 0.5; }
    const cell = Math.sqrt(area / Math.max(1, nt)) * 1.6 || 1;
    const q0 = [0, 0], q1 = [0, 0], q2 = [0, 0], r0 = [0, 0], r1 = [0, 0], r2 = [0, 0];
    const inside = (x, y, a, b, c) => { const d1 = (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]), d2 = (x - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (y - c[1]), d3 = (x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1]); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
    for (let seed = 0; seed < nt; seed++) {
      if (chart[seed] >= 0) continue;
      const id = charts.length, c = cls[seed], grid = new Map(), tris = [], queue = [seed];
      chart[seed] = id;
      while (queue.length) {
        const t = queue.pop();
        uvOf(T[t * 6], c, q0); uvOf(T[t * 6 + 1], c, q1); uvOf(T[t * 6 + 2], c, q2);
        const x0 = Math.floor(Math.min(q0[0], q1[0], q2[0]) / cell), x1 = Math.floor(Math.max(q0[0], q1[0], q2[0]) / cell), y0 = Math.floor(Math.min(q0[1], q1[1], q2[1]) / cell), y1 = Math.floor(Math.max(q0[1], q1[1], q2[1]) / cell);
        const mx = (q0[0] + q1[0] + q2[0]) / 3, my = (q0[1] + q1[1] + q2[1]) / 3;
        let clash = false;
        if (t !== seed) for (let gy = y0; gy <= y1 && !clash; gy++) for (let gx = x0; gx <= x1 && !clash; gx++) {
          const l = grid.get(gx * 73856093 ^ gy * 19349663); if (!l) continue;
          for (const s of l) {
            let shared = 0; for (let e = 0; e < 3; e++) for (let f = 0; f < 3; f++) if (T[t * 6 + e] === T[s * 6 + f]) shared++;
            if (shared) continue;
            uvOf(T[s * 6], c, r0); uvOf(T[s * 6 + 1], c, r1); uvOf(T[s * 6 + 2], c, r2);
            if (inside(mx, my, r0, r1, r2) || inside((r0[0] + r1[0] + r2[0]) / 3, (r0[1] + r1[1] + r2[1]) / 3, q0, q1, q2) || inside(q0[0], q0[1], r0, r1, r2) || inside(q1[0], q1[1], r0, r1, r2) || inside(q2[0], q2[1], r0, r1, r2) || inside(r0[0], r0[1], q0, q1, q2) || inside(r1[0], r1[1], q0, q1, q2) || inside(r2[0], r2[1], q0, q1, q2)) { clash = true; break; }
          }
        }
        if (clash) { chart[t] = -1; continue; }
        tris.push(t);
        for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) { const k = gx * 73856093 ^ gy * 19349663, l = grid.get(k); if (l) l.push(t); else grid.set(k, [t]); }
        for (const n of adj[t]) if (chart[n] < 0 && cls[n] === c) { chart[n] = id; queue.push(n); }
      }
      let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      for (const t of tris) for (let e = 0; e < 3; e++) { uvOf(T[t * 6 + e], c, q0); u0 = Math.min(u0, q0[0]); u1 = Math.max(u1, q0[0]); v0 = Math.min(v0, q0[1]); v1 = Math.max(v1, q0[1]); }
      charts.push({ c, tris, u0, v0, w: u1 - u0, h: v1 - v0, turn: v1 - v0 > u1 - u0 });
    }
    // ---- pack them into the level's part of the picture: the largest scale at which they all fit, on shelves
    const pad = level ? 1 : 2, order = charts.map((_, k) => k).sort((a, b) => Math.min(charts[b].w, charts[b].h) - Math.min(charts[a].w, charts[a].h));
    const fit = (k, commit) => {
      let x = 0, y = 0, shelf = 0;
      for (const ci of order) {
        const ch = charts[ci], w = Math.ceil(Math.max(ch.w, ch.h) * k) + 2 * pad + 1, h = Math.ceil(Math.min(ch.w, ch.h) * k) + 2 * pad + 1;
        if (w > RW) return false;
        if (x + w > RW) { x = 0; y += shelf; shelf = 0; }
        if (y + h > RH) return false;
        if (commit) { ch.x = RX + x; ch.y = RY + y; }
        x += w; if (h > shelf) shelf = h;
      }
      return true;
    };
    let lo = 0, hi = 1e5;
    for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (fit(mid, false)) lo = mid; else hi = mid; }
    if (!fit(lo, true)) throw new Error(`level ${level}: ${charts.length} patches do not fit ${RW} x ${RH} texels`);
    const K = lo;
    if (K * Math.sqrt(area) < 8) throw new Error(`level ${level}: ${charts.length} patches leave no room to paint in ${RW} x ${RH} texels`);
    // ---- vertices, and the painting
    const key = new Map(), from = [], uv = [], index = new Uint32Array(nt * 3), tx = [0, 0, 0], ty = [0, 0, 0];
    let filled = 0, sr = 0, sg = 0, sb = 0;
    for (let ci = 0; ci < charts.length; ci++) {
      const ch = charts[ci];
      for (const t of ch.tris) {
        for (let e = 0; e < 3; e++) {
          const p = T[t * 6 + e]; uvOf(p, ch.c, q0);
          let a = (q0[0] - ch.u0) * K, b = (q0[1] - ch.v0) * K; if (ch.turn) { const s = a; a = b; b = s; }
          tx[e] = ch.x + pad + 0.5 + a; ty[e] = ch.y + pad + 0.5 + b;
          const k = p * 65536 + ci; let v = key.get(k);
          if (v == null) { v = from.length; key.set(k, v); from.push(T[t * 6 + 3 + e]); uv.push(tx[e] / W, ty[e] / H); }
          index[t * 3 + e] = v;
        }
        const A = T[t * 6] * 3, B = T[t * 6 + 1] * 3, C = T[t * 6 + 2] * 3;
        const den = (ty[1] - ty[2]) * (tx[0] - tx[2]) + (tx[2] - tx[1]) * (ty[0] - ty[2]);
        if (Math.abs(den) < 1e-9) continue;
        const X0 = Math.max(RX, Math.floor(Math.min(tx[0], tx[1], tx[2]) - 1)), X1 = Math.min(RX + RW - 1, Math.ceil(Math.max(tx[0], tx[1], tx[2]) + 1)), Y0 = Math.max(RY, Math.floor(Math.min(ty[0], ty[1], ty[2]) - 1)), Y1 = Math.min(RY + RH - 1, Math.ceil(Math.max(ty[0], ty[1], ty[2]) + 1));
        // (a texel is painted if its center lies in the triangle or within about a texel of it: the margin is what filtering reads at an edge)
        const ad = Math.abs(den), k0 = ad / (Math.hypot(tx[1] - tx[2], ty[1] - ty[2]) || 1), k1 = ad / (Math.hypot(tx[0] - tx[2], ty[0] - ty[2]) || 1), k2 = ad / (Math.hypot(tx[0] - tx[1], ty[0] - ty[1]) || 1); // (a corner's weight times these: texels from the edge opposite)
        for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
          const cx = x + 0.5, cy = y + 0.5;
          let b0 = ((ty[1] - ty[2]) * (cx - tx[2]) + (tx[2] - tx[1]) * (cy - ty[2])) / den, b1 = ((ty[2] - ty[0]) * (cx - tx[2]) + (tx[0] - tx[2]) * (cy - ty[2])) / den, b2 = 1 - b0 - b1;
          const mn = Math.min(b0, b1, b2);
          if (b0 * k0 < -1.2 || b1 * k1 < -1.2 || b2 * k2 < -1.2) continue;
          const o = y * W + x, rank = mn >= 0 ? 2 : 1; // (a texel inside one triangle is not overwritten from the margin of its neighbor)
          if (done[o] >= rank) continue;
          b0 = Math.max(0, b0); b1 = Math.max(0, b1); b2 = Math.max(0, b2); const s = b0 + b1 + b2; b0 /= s; b1 /= s; b2 /= s;
          const h = near(P[A] * b0 + P[B] * b1 + P[C] * b2, P[A + 1] * b0 + P[B + 1] * b1 + P[C + 1] * b2, P[A + 2] * b0 + P[B + 2] * b1 + P[C + 2] * b2, fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2], group ? group[T[t * 6 + 3]] : -1);
          sample(h[0], h[1], o * 3);
          if (!done[o]) { filled++; sr += out[o * 3]; sg += out[o * 3 + 1]; sb += out[o * 3 + 2]; }
          done[o] = rank;
        }
      }
    }
    // ---- round every patch, a few texels of its own edge color, then the level's average: nothing foreign bleeds in when the picture is shrunk
    for (let pass = 0; pass < 6; pass++) {
      const add = [];
      for (let y = RY; y < RY + RH; y++) for (let x = RX; x < RX + RW; x++) {
        const o = y * W + x; if (done[o]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < RX || yy < RY || xx >= RX + RW || yy >= RY + RH) continue; const q = yy * W + xx; if (done[q]) { r += out[q * 3]; g += out[q * 3 + 1]; b += out[q * 3 + 2]; n++; } }
        if (n) add.push(o, Math.round(r / n), Math.round(g / n), Math.round(b / n));
      }
      for (let k = 0; k < add.length; k += 4) { const o = add[k]; out[o * 3] = add[k + 1]; out[o * 3 + 1] = add[k + 2]; out[o * 3 + 2] = add[k + 3]; done[o] = 1; }
    }
    const ar = filled ? Math.round(sr / filled) : 128, ag = filled ? Math.round(sg / filled) : 128, ab = filled ? Math.round(sb / filled) : 128;
    for (let y = RY; y < RY + RH; y++) for (let x = RX; x < RX + RW; x++) { const o = y * W + x; if (!done[o]) { out[o * 3] = ar; out[o * 3 + 1] = ag; out[o * 3 + 2] = ab; } }
    res.push({ from: Int32Array.from(from), uv: Float32Array.from(uv), index, charts: charts.length, scale: K, used: filled / (RW * RH) });
  });
  return { px: out, levels: res };
}

/** The full model's surface, for asking which point of it lies nearest a place: returns (x, y, z, nx, ny, nz) => [u, v]. */
function nearest(m, group) {
  const pos = m.pos, idx = m.index, nt = idx.length / 3, uv = m.uv;
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let v = 0; v < pos.length; v += 3) for (let e = 0; e < 3; e++) { if (pos[v + e] < lo[e]) lo[e] = pos[v + e]; if (pos[v + e] > hi[e]) hi[e] = pos[v + e]; }
  const G = 40, cs = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / G + 1e-9, nx = Math.ceil((hi[0] - lo[0]) / cs) + 1, ny = Math.ceil((hi[1] - lo[1]) / cs) + 1, nz = Math.ceil((hi[2] - lo[2]) / cs) + 1;
  const cells = Array.from({ length: nx * ny * nz }, () => null), tn = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; const l = Math.hypot(x, y, z) || 1; tn[t * 3] = x / l; tn[t * 3 + 1] = y / l; tn[t * 3 + 2] = z / l;
    const r = [0, 0, 0, 0, 0, 0];
    for (let e = 0; e < 3; e++) { r[e] = Math.floor((Math.min(pos[a + e], pos[b + e], pos[c + e]) - lo[e]) / cs); r[3 + e] = Math.floor((Math.max(pos[a + e], pos[b + e], pos[c + e]) - lo[e]) / cs); }
    for (let z2 = r[2]; z2 <= r[5]; z2++) for (let y2 = r[1]; y2 <= r[4]; y2++) for (let x2 = r[0]; x2 <= r[3]; x2++) { const k = (z2 * ny + y2) * nx + x2; (cells[k] || (cells[k] = [])).push(t); }
  }
  const stamp = new Int32Array(nt), res = [0, 0], bc = [0, 0, 0];
  let tick = 0;
  // squared distance from p to triangle t, its barycentric coordinates left in bc (Ericson, Real-Time Collision Detection 5.1.5)
  const dist2 = (px, py, pz, t) => {
    const A = idx[t * 3] * 3, B = idx[t * 3 + 1] * 3, C = idx[t * 3 + 2] * 3;
    const abx = pos[B] - pos[A], aby = pos[B + 1] - pos[A + 1], abz = pos[B + 2] - pos[A + 2], acx = pos[C] - pos[A], acy = pos[C + 1] - pos[A + 1], acz = pos[C + 2] - pos[A + 2];
    const apx = px - pos[A], apy = py - pos[A + 1], apz = pz - pos[A + 2];
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let u, v, w;
    if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; } else {
      const bpx = px - pos[B], bpy = py - pos[B + 1], bpz = pz - pos[B + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; } else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); u = 1 - v; w = 0; } else {
          const cpx = px - pos[C], cpy = py - pos[C + 1], cpz = pz - pos[C + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; } else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { w = d2 / (d2 - d6); u = 1 - w; v = 0; } else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / (d4 - d3 + d5 - d6); v = 1 - w; u = 0; } else { const dn = 1 / (va + vb + vc); v = vb * dn; w = vc * dn; u = 1 - v - w; }
            }
          }
        }
      }
    }
    bc[0] = u; bc[1] = v; bc[2] = w;
    const qx = pos[A] * u + pos[B] * v + pos[C] * w - px, qy = pos[A + 1] * u + pos[B + 1] * v + pos[C + 1] * w - py, qz = pos[A + 2] * u + pos[B + 2] * v + pos[C + 2] * w - pz;
    return qx * qx + qy * qy + qz * qz;
  };
  const fr = (x) => x - Math.floor(x);
  return (px, py, pz, fx, fy, fz, grp = -1) => {
    const cx = Math.floor((px - lo[0]) / cs), cy = Math.floor((py - lo[1]) / cs), cz = Math.floor((pz - lo[2]) / cs);
    let best = Infinity, bt = -1, b0 = 0, b1 = 0, b2 = 0;
    tick++;
    for (let ring = 0; ring <= G + 2; ring++) {
      for (let z = cz - ring; z <= cz + ring; z++) { if (z < 0 || z >= nz) continue; for (let y = cy - ring; y <= cy + ring; y++) { if (y < 0 || y >= ny) continue; const shell = Math.abs(z - cz) === ring || Math.abs(y - cy) === ring;
        for (let x = cx - ring; x <= cx + ring; x += shell ? 1 : 2 * ring || 1) {
          if (x < 0 || x >= nx) continue;
          const l = cells[(z * ny + y) * nx + x]; if (!l) continue;
          for (const t of l) {
            if (stamp[t] === tick) continue; stamp[t] = tick;
            if (grp >= 0 && group[idx[t * 3]] !== grp) continue;
            let d = dist2(px, py, pz, t);
            // (a surface facing the other way is another layer: the inside of a cloak, the far side of a thin plate)
            if (tn[t * 3] * fx + tn[t * 3 + 1] * fy + tn[t * 3 + 2] * fz < -0.2) d = d * 4 + cs * cs * 0.05;
            if (d < best) { best = d; bt = t; b0 = bc[0]; b1 = bc[1]; b2 = bc[2]; }
          }
        } } }
      if (bt >= 0 && best <= ring * cs * ring * cs) break;
    }
    if (bt < 0) { res[0] = 0; res[1] = 0; return res; }
    const A = idx[bt * 3] * 2, B = idx[bt * 3 + 1] * 2, C = idx[bt * 3 + 2] * 2;
    // (a triangle's corners may sit either side of the picture's edge: they are taken within one turn of the first)
    const ua = fr(uv[A]), va = fr(uv[A + 1]);
    let ub = fr(uv[B]), vb = fr(uv[B + 1]), uc = fr(uv[C]), vc = fr(uv[C + 1]);
    if (ub - ua > 0.5) ub -= 1; else if (ua - ub > 0.5) ub += 1; if (uc - ua > 0.5) uc -= 1; else if (ua - uc > 0.5) uc += 1;
    if (vb - va > 0.5) vb -= 1; else if (va - vb > 0.5) vb += 1; if (vc - va > 0.5) vc -= 1; else if (va - vc > 0.5) vc += 1;
    res[0] = ua * b0 + ub * b1 + uc * b2; res[1] = va * b0 + vb * b1 + vc * b2;
    return res;
  };
}
