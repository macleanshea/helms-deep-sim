// Build a unit's game files from its rigged, animated source models.
//
//   node tools/assets/build.js uruk            one unit (tools/assets/units/uruk.json)
//   node tools/assets/build.js                 every unit that has a recipe
//
// It works from the unit's source in tools/assets/src/<unit>/ (put there by tools/assets/import.js from the
// generator's files) and its recipe in tools/assets/units/<unit>.json (height, levels of detail, gear). The output, in
// assets/game/, is what the game loads: one pack per unit holding its levels of detail (finest first) and every clip
// as bone matrices sampled at a fixed rate, a small WebP of its colours, and a line in manifest.json.
// File names carry a hash of their contents, so they can be cached for ever.
//
// Needs nothing but Node and, for the texture, Python with Pillow (python3 -c "import PIL").
//
// The pack (little-endian): "HDU1", a JSON header's byte length, the header, then the data it points into.
//   vertices, 28 bytes each: position 3 x float32 (metres; +x forward, +y left, +z up, feet at the origin),
//     normal 3 x int8 and a pad byte, texture coordinate 2 x uint16, bones 4 x uint8, weights 4 x uint8
//   indices: uint16
//   animation: float32, 12 per bone per frame: the top three rows of the matrix that carries a vertex from
//     its rest place to its place in that frame (bone 0 first), frames of all clips one after another
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seated } from './rider.js';
import { readSource } from './source.js';
import { simplify } from './simplify.js';

const here = fileURLToPath(new URL('.', import.meta.url)), root = path.resolve(here, '../..');
const OUT = path.join(root, 'assets/game');
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);
const AX = [2, 0, 1]; // the game's x, y, z are the model file's z, x, y (it faces +z with +y up)

function buildUnit(name) {
  const recipe = JSON.parse(fs.readFileSync(path.join(here, 'units', `${name}.json`), 'utf8'));
  const S = readSource(recipe.use || name); // (`use`: another unit's body and clips, with gear and a choice of clips of its own)
  let m = S.mesh, colour = S.colour;
  if (recipe.rider) {
    // a rider: another unit's figure, seated, made part of this mesh and carried by the bones of the back. The two
    // textures go side by side, so each model's texture coordinates are squeezed into its own half.
    const R = recipe.rider, rs = readSource(R.unit), fig = seated(rs, R.pose), n0 = m.pos.length / 3, n1 = fig.pos.length / 3;
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let v = 0; v < n0; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.pos[v * 3 + k]); hi[k] = Math.max(hi[k], m.pos[v * 3 + k]); }
    const L = hi[2] - lo[2], H = hi[1] - lo[1], k = (R.height / fig.height) / (recipe.height / H), zs = lo[2] + R.seat * L;
    let top = -1e9; // the top of the back where he sits
    for (let v = 0; v < n0; v++) if (Math.abs(m.pos[v * 3 + 2] - zs) < 0.03 * L && Math.abs(m.pos[v * 3] - (lo[0] + hi[0]) / 2) < 0.1 * (hi[0] - lo[0])) top = Math.max(top, m.pos[v * 3 + 1]);
    const seat = [(lo[0] + hi[0]) / 2, top + (R.rise != null ? R.rise : 0.06) * H, zs];
    const bones = (R.bones || [['pelvis', 0.5], ['chest', 0.5]]).map(([b, w]) => [m.skin.names.indexOf(b), w]);
    const pos = new Float32Array((n0 + n1) * 3), nrm = new Float32Array((n0 + n1) * 3), uv = new Float32Array((n0 + n1) * 2), joints = new Uint8Array((n0 + n1) * 4), weights = new Float32Array((n0 + n1) * 4);
    pos.set(m.pos); nrm.set(m.nrm); joints.set(m.joints); weights.set(m.weights);
    const wrap = (q) => q - Math.floor(q);
    for (let v = 0; v < n0; v++) { uv[v * 2] = wrap(m.uv[v * 2]) * 0.5; uv[v * 2 + 1] = wrap(m.uv[v * 2 + 1]); }
    for (let v = 0; v < n1; v++) {
      const o = (n0 + v) * 3;
      for (let e = 0; e < 3; e++) { pos[o + e] = (fig.pos[v * 3 + e] - fig.hips[e]) * k + seat[e]; nrm[o + e] = fig.nrm[v * 3 + e]; }
      uv[(n0 + v) * 2] = 0.5 + wrap(fig.uv[v * 2]) * 0.5; uv[(n0 + v) * 2 + 1] = wrap(fig.uv[v * 2 + 1]);
      bones.forEach(([b, w], q) => { joints[(n0 + v) * 4 + q] = b; weights[(n0 + v) * 4 + q] = w; });
    }
    const index = new Uint32Array(m.index.length + fig.index.length);
    index.set(m.index); for (let q = 0; q < fig.index.length; q++) index[m.index.length + q] = fig.index[q] + n0;
    m = { ...m, pos, nrm, uv, joints, weights, index, saddleTop: top };
    colour = `${S.colour}+${rs.colour}`;
  }
  const nv = m.pos.length / 3, nj = m.skin.names.length;
  if (nj > 64) throw new Error(`${name}: ${nj} bones (64 at most)`);

  // ---- rest pose into the game's space: upright, feet on the ground, the height the recipe asks for
  // (the height is the beast's own, to the top of its back, whoever sits on it)
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  const nOwn = S.mesh.pos.length / 3;
  for (let v = 0; v < nOwn; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.pos[v * 3 + k]); hi[k] = Math.max(hi[k], m.pos[v * 3 + k]); }
  // (a machine is given by its length, a figure by its height)
  const s = recipe.length ? recipe.length / (hi[2] - lo[2]) : recipe.height / (hi[1] - lo[1]), o = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) for (let e = 0; e < 3; e++) { P[v * 3 + e] = (m.pos[v * 3 + AX[e]] - o[AX[e]]) * s; N[v * 3 + e] = m.nrm[v * 3 + AX[e]]; }

  // ---- clips: bone matrices per frame, into the game's space
  const frames = [], clips = [];
  const jointIndex = (re) => m.skin.names.findIndex((n) => re.test(n));
  // (a mortar is a thing of its own, not part of the man: it gets a bone of its own after his, placed clip by clip below)
  const props = (recipe.gear || []).some((g) => g.kind === 'mortar') ? 1 : 0, nb = nj + props;
  const bake = (c, f) => {
    const out = new Float32Array(nb * 12);
    for (let j = 0; j < nj; j++) {
      const M = c.mats.subarray((f * nj + j) * 16, (f * nj + j) * 16 + 16);
      // t' = s C (R o + t - o); R' = C R C^-1
      const Ro = [M[0] * o[0] + M[4] * o[1] + M[8] * o[2], M[1] * o[0] + M[5] * o[1] + M[9] * o[2], M[2] * o[0] + M[6] * o[1] + M[10] * o[2]];
      for (let e = 0; e < 3; e++) {
        const ge = AX[e];
        for (let e2 = 0; e2 < 3; e2++) out[j * 12 + e * 4 + e2] = M[AX[e2] * 4 + ge];
        out[j * 12 + e * 4 + 3] = s * (Ro[ge] + M[12 + ge] - o[ge]);
      }
    }
    return out;
  };
  const baked = new Map(); // every clip of the source, by name: { rows, loop, stride }
  for (const c of S.clips) {
    const over = (recipe.clips || []).find((q) => q.name === c.name) || {};
    const rows = []; for (let f = 0; f < c.frames; f++) rows.push(bake(c, f));
    baked.set(c.name, { rows, loop: c.loop, stride: over.stride != null ? over.stride : c.stride * s });
  }
  // a recipe may cut clips of its own out of the source's (`derive`: a held stance is a second of a longer action, played
  // there and back so it has no seam) and leave source clips out of the game (`drop`)
  const drop = new Set(recipe.drop || []);
  for (const d of recipe.derive || []) drop.add(d.name); // (a cut takes the place of a source clip of the same name)
  const final = [...baked].filter(([n]) => !drop.has(n)).map(([n, b]) => ({ name: n, ...b }));
  for (const d of recipe.derive || []) {
    const src = baked.get(d.from); if (!src) throw new Error(`${name}: clip "${d.name}" is cut from "${d.from}", which the source does not have`);
    const n = src.rows.length, a = Math.max(0, Math.min(n - 1, Math.round(d.range[0] * n))), b = Math.max(a + 1, Math.min(n, Math.round(d.range[1] * n)));
    let rows = src.rows.slice(a, b);
    if (d.loop === 'pingpong' && rows.length > 2) rows = rows.concat(rows.slice(1, -1).reverse());
    final.push({ name: d.name, rows, loop: d.loop !== false, stride: d.stride != null ? d.stride : a === 0 && b === n ? src.stride : 0 });
  }
  for (const c of final) {
    clips.push({ name: c.name, start: frames.length, frames: c.rows.length, loop: !!c.loop, fps: S.fps, stride: +c.stride.toFixed(3) });
    frames.push(...c.rows);
  }
  const clipRow = (cname, at) => { const c = clips.find((q) => q.name === cname); if (!c) throw new Error(`${name}: no clip "${cname}"`); return frames[c.start + Math.min(c.frames - 1, Math.floor(at * c.frames))]; };

  // ---- gear: plain boxes that ride on one bone each (a blade in the hand, a shield on the forearm). They are added
  // to every level of detail after it is reduced, and coloured from the swatch strip the texture step appends.
  const strip = (recipe.gear || []).length > 0, vScale = strip ? 16 / 17 : 1;
  const restOf = (bone) => {
    // where a bone sits in the rest pose: the inverse of its inverse-bind matrix carries the origin there
    const b = m.skin.ibm.subarray(bone * 16, bone * 16 + 16), R = [b[0], b[1], b[2], b[4], b[5], b[6], b[8], b[9], b[10]], t = [b[12], b[13], b[14]];
    const p = [-(R[0] * t[0] + R[1] * t[1] + R[2] * t[2]), -(R[3] * t[0] + R[4] * t[1] + R[5] * t[2]), -(R[6] * t[0] + R[7] * t[1] + R[8] * t[2])]; // -R^T t (R is a rotation)
    const l = Math.hypot(b[0], b[1], b[2]) ** 2 || 1;
    return [0, 1, 2].map((e) => ((p[AX[e]] / l) - o[AX[e]]) * s);
  };
  const gear = []; // { bone, verts: [[x, y, z, nx, ny, nz]...], tris: [...], swatch }
  const box = (bone, swatch, c, ax, ay, az, far = false) => { // far: kept at the coarsest level of detail too
    // a box centred at c with half-axes ax, ay, az (vectors in game space)
    const verts = [], tris = [];
    for (const [n, u, v] of [[ax, ay, az], [ay, az, ax], [az, ax, ay]]) for (const sg of [1, -1]) {
      const l = Math.hypot(...n) || 1, nn = n.map((q) => (q / l) * sg), b0 = verts.length;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) verts.push([c[0] + n[0] * sg + u[0] * su + v[0] * sv, c[1] + n[1] * sg + u[1] * su + v[1] * sv, c[2] + n[2] * sg + u[2] * su + v[2] * sv, ...nn]);
      // wound so the face looks outward (u x v points along n for these three orderings)
      if (sg > 0) tris.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3); else tris.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2);
    }
    gear.push({ bone, swatch, verts, tris, far });
  };
  const SW = { iron: 0, wood: 1, leather: 2, paint: 3 };
  // (metres, for a man: the grip is in the right hand, the barrel runs forward of it and the stock back to the shoulder)
  const FIREARMS = {
    rifle: [['iron', 0.1, 0.07, 0.2, 0.022, 0.035, 1], ['iron', 0.45, 0.085, 0.17, 0.012, 0.012, 1], ['leather', -0.22, 0.05, 0.13, 0.02, 0.04], ['iron', 0.12, -0.04, 0.025, 0.014, 0.07], ['iron', 0.1, 0.125, 0.05, 0.014, 0.014]],
    mg: [['iron', 0.12, 0.07, 0.26, 0.03, 0.045, 1], ['iron', 0.62, 0.085, 0.26, 0.016, 0.016, 1], ['leather', -0.24, 0.05, 0.12, 0.024, 0.05], ['wood', 0.14, -0.06, 0.07, 0.05, 0.06, 1], ['iron', 0.8, -0.06, 0.012, 0.012, 0.12]],
    sniper: [['iron', 0.1, 0.07, 0.22, 0.02, 0.032, 1], ['iron', 0.6, 0.082, 0.3, 0.011, 0.011, 1], ['leather', -0.24, 0.045, 0.14, 0.02, 0.045], ['iron', 0.12, 0.135, 0.13, 0.02, 0.02, 1], ['iron', 0.78, -0.05, 0.01, 0.01, 0.1]],
    launcher: [['iron', 0.08, 0.07, 0.16, 0.022, 0.035, 1], ['iron', 0.22, 0.04, 0.07, 0.05, 0.05, 1], ['iron', 0.4, 0.075, 0.1, 0.024, 0.024, 1], ['leather', -0.2, 0.05, 0.11, 0.02, 0.04]],
    tube: [['paint', 0.05, 0.14, 0.52, 0.055, 0.055, 1], ['iron', -0.5, 0.14, 0.05, 0.07, 0.07, 1], ['iron', 0.6, 0.14, 0.04, 0.065, 0.065, 1], ['iron', 0.05, 0.03, 0.03, 0.02, 0.07]],
  };
  for (const it of recipe.gear || []) {
    const bone = jointIndex(new RegExp(`^${it.bone}$`, 'i'));
    if (bone < 0) throw new Error(`${name}: no bone "${it.bone}" for its ${it.kind}`);
    const h = restOf(bone);
    if (it.kind === 'sword') {
      // held point-up and forward: a grip, a cross-guard and a broad cleaver of a blade
      const L = it.length || 0.78, d = [0.62, 0, 0.78], side = [0, 1, 0], up = [-0.78, 0, 0.62];
      const along = (a, k) => a.map((q) => q * k), at = (k) => [h[0] + d[0] * k, h[1] + d[1] * k, h[2] + d[2] * k - 0.04];
      box(bone, SW.leather, at(0.02), along(d, 0.1), along(side, 0.02), along(up, 0.025));
      box(bone, SW.iron, at(0.13), along(d, 0.02), along(side, 0.03), along(up, 0.1));
      box(bone, SW.iron, at(0.15 + L / 2), along(d, L / 2), along(side, 0.012), along(up, 0.038), true);
    } else if (it.kind === 'shield') {
      // a tall board strapped to the outside of the forearm, an iron boss, a pale hand daubed on it
      const hand = restOf(jointIndex(/^lefthand$/i)), c = [(h[0] + hand[0]) / 2 + 0.03, (h[1] + hand[1]) / 2 + 0.07, (h[2] + hand[2]) / 2 + 0.05];
      const w = it.width || 0.3, t = it.height || 0.48, n = [0.25, 0.97, 0], f = [0.97, -0.25, 0];
      const along = (a, k) => a.map((q) => q * k);
      box(bone, SW.wood, c, along(n, 0.022), along(f, w), [0, 0, t], true);
      box(bone, SW.iron, [c[0] + n[0] * 0.04, c[1] + n[1] * 0.04, c[2]], along(n, 0.03), along(f, 0.08), [0, 0, 0.08]);
      box(bone, SW.paint, [c[0] + n[0] * 0.026, c[1] + n[1] * 0.026, c[2] + t * 0.5], along(n, 0.006), along(f, w * 0.45), [0, 0, t * 0.22]);
    } else if (it.kind === 'crossbow') {
      // carried across the body: a stock, and the bow's limb set across its head
      const d = [0.9, 0.3, 0.3], l = Math.hypot(...d), f = d.map((q) => q / l), sd = [-0.3, 0.95, 0], up = [0, 0, 1];
      const along = (a, k) => a.map((q) => q * k), at = (k) => [h[0] + f[0] * k, h[1] + f[1] * k, h[2] + f[2] * k - 0.03];
      box(bone, SW.wood, at(0.2), along(f, 0.36), along(sd, 0.025), along(up, 0.035), true);
      box(bone, SW.iron, at(0.5), along(f, 0.02), along(sd, 0.34), along(up, 0.02), true);
    } else if (it.kind === 'club') {
      // a troll's club: a tree trunk shod with iron, as long as the troll's arm
      const L = recipe.height * 0.42, d = [0.55, 0, 0.83], side = [0, 1, 0], up = [-0.83, 0, 0.55];
      const along = (a, k) => a.map((q) => q * k), at = (k) => [h[0] + d[0] * k, h[1] + d[1] * k, h[2] + d[2] * k];
      box(bone, SW.wood, at(L * 0.45), along(d, L * 0.55), along(side, L * 0.06), along(up, L * 0.06), true);
      box(bone, SW.iron, at(L * 0.88), along(d, L * 0.14), along(side, L * 0.085), along(up, L * 0.085));
    } else if (FIREARMS[it.kind]) {
      // a firearm lies in the right hand as the clip named by `align` holds it: its barrel runs from that hand toward the
      // other (which carries the fore-end), its top is whatever was up at that moment
      const al = it.align || { clip: 'aim', at: 0 }, row = clipRow(al.clip, al.at || 0);
      const posed = (j, p) => [0, 1, 2].map((e) => row[j * 12 + e * 4] * p[0] + row[j * 12 + e * 4 + 1] * p[1] + row[j * 12 + e * 4 + 2] * p[2] + row[j * 12 + e * 4 + 3]);
      const back = (j, v) => [0, 1, 2].map((e) => row[j * 12 + e] * v[0] + row[j * 12 + 4 + e] * v[1] + row[j * 12 + 8 + e] * v[2]); // by the bone's rotation, transposed
      const other = jointIndex(new RegExp(`^${al.to || 'LeftHand'}$`, 'i')), pr = posed(bone, h), pl = posed(other, restOf(other));
      const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((q) => q / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      let dW = norm([pl[0] - pr[0], pl[1] - pr[1], pl[2] - pr[2]]);
      if (al.level) dW = norm([dW[0], dW[1], dW[2] * (1 - al.level)]); // (flattened toward the horizon when the hands do not sit on one line with the bore)
      const sW = norm(cross(dW, [0, 0, 1])), uW = cross(sW, dW);
      const d = back(bone, dW), up = back(bone, uW), side = back(bone, sW);
      const along = (a, k) => a.map((q) => q * k);
      // parts: [swatch, along the barrel from the grip, above the grip, half-length, half-width, half-height, seen from afar]
      for (const [sw, fwd, rise, hl, hw, hh, far] of FIREARMS[it.kind]) {
        const c = [0, 1, 2].map((e) => h[e] + d[e] * fwd + up[e] * rise);
        box(bone, SW[sw], c, along(d, hl), along(side, hw), along(up, hh), !!far);
      }
    } else if (it.kind === 'mortar') {
      // a mortar stood on the ground beside him as he kneels (in the frame `align` names): a baseplate, the tube leaning
      // forward, a bipod. It has the extra bone to itself: still while he serves it or falls, slung on his back when he moves.
      const al = it.align || { clip: 'aim', at: 0 }, row = clipRow(al.clip, al.at || 0), o12 = bone * 12, P = nj;
      const hp = [0, 1, 2].map((e) => row[o12 + e * 4] * h[0] + row[o12 + e * 4 + 1] * h[1] + row[o12 + e * 4 + 2] * h[2] + row[o12 + e * 4 + 3]);
      const base = [hp[0] + (it.forward != null ? it.forward : 0.62), hp[1] + (it.side != null ? it.side : -0.38), 0], d = [0.42, 0, 0.907], L = it.length || 1.15;
      const pt = (k) => [base[0] + d[0] * k, base[1] + d[1] * k, base[2] + d[2] * k];
      box(P, SW.iron, [base[0] - 0.04, base[1], 0.03], [0.2, 0, 0], [0, 0.2, 0], [0, 0, 0.03], true);
      box(P, SW.paint, pt(L / 2 + 0.04), d.map((q) => q * L / 2), [0, 0.05, 0], [-0.907 * 0.05, 0, 0.42 * 0.05], true);
      for (const sg of [1, -1]) { // the bipod's two legs, from two thirds up the tube out to the ground ahead
        const top = pt(L * 0.66), foot = [top[0] + 0.22, top[1] + sg * 0.26, 0], mid = top.map((q, e) => (q + foot[e]) / 2), half = top.map((q, e) => (q - foot[e]) / 2);
        box(P, SW.iron, mid, half, [0.014, 0, 0], [0, 0.014, 0], false);
      }
      // carried: stood upright (the tube's lean turned out of it) with its middle behind his upper back
      const spine = jointIndex(/^spine$/i), sr = restOf(spine), mid = pt(L / 2), cs = 0.907, sn = -0.42; // turn about y taking d to straight up
      const R = [cs, 0, sn, 0, 1, 0, -sn, 0, cs], Rm = [0, 1, 2].map((e) => R[e * 3] * mid[0] + R[e * 3 + 1] * mid[1] + R[e * 3 + 2] * mid[2]);
      const T = [sr[0] - 0.2 - Rm[0], sr[1] - Rm[1], sr[2] - 0.05 - Rm[2]];
      for (const c of clips) for (let f = 0; f < c.frames; f++) {
        const fr = frames[c.start + f], q = P * 12;
        if (c.name === 'walk' || c.name === 'run') {
          const a = spine * 12;
          for (let e = 0; e < 3; e++) {
            for (let e2 = 0; e2 < 3; e2++) fr[q + e * 4 + e2] = fr[a + e * 4] * R[e2] + fr[a + e * 4 + 1] * R[3 + e2] + fr[a + e * 4 + 2] * R[6 + e2];
            fr[q + e * 4 + 3] = fr[a + e * 4] * T[0] + fr[a + e * 4 + 1] * T[1] + fr[a + e * 4 + 2] * T[2] + fr[a + e * 4 + 3];
          }
        } else { fr.fill(0, q, q + 12); fr[q] = fr[q + 5] = fr[q + 10] = 1; }
      }
    } else throw new Error(`${name}: unknown gear "${it.kind}"`);
  }

  // ---- levels of detail
  const sections = [], lods = [];
  let offset = 0;
  const add = (buf) => { const at = offset; sections.push(buf); offset += buf.byteLength; const pad = (4 - (offset & 3)) & 3; if (pad) { sections.push(Buffer.alloc(pad)); offset += pad; } return at; };
  recipe.lods.forEach((target, level) => {
    const kit = gear.filter((q) => level < 3 || q.far), gearVerts = kit.reduce((a, q) => a + q.verts.length, 0), gearTris = kit.reduce((a, q) => a + q.tris.length / 3, 0);
    const want = Math.max(40, target - gearTris);
    const idx = want >= m.index.length / 3 ? m.index : simplify(m.pos, m.uv, m.index, want);
    const remap = new Int32Array(nv).fill(-1); let n = 0;
    for (const v of idx) if (remap[v] < 0) remap[v] = n++;
    if (n + gearVerts > 65535) throw new Error(`${name}: level ${level} has ${n + gearVerts} vertices (65535 at most)`);
    const infl = [4, 2, 1, 1][Math.min(level, 3)], vb = Buffer.alloc((n + gearVerts) * 28);
    for (let v = 0; v < nv; v++) {
      const k = remap[v]; if (k < 0) continue;
      const b = k * 28;
      for (let e = 0; e < 3; e++) { vb.writeFloatLE(P[v * 3 + e], b + e * 4); vb.writeInt8(Math.max(-127, Math.min(127, Math.round(N[v * 3 + e] * 127))), b + 12 + e); }
      const u = m.uv[v * 2] - Math.floor(m.uv[v * 2]), t = m.uv[v * 2 + 1] - Math.floor(m.uv[v * 2 + 1]);
      vb.writeUInt16LE(Math.round(u * 65535), b + 16); vb.writeUInt16LE(Math.round(t * vScale * 65535), b + 18);
      // the heaviest `infl` bones, their weights made to add up to 255
      const ws = [0, 1, 2, 3].map((q) => [m.weights[v * 4 + q], m.joints[v * 4 + q]]).sort((a, c) => c[0] - a[0]).slice(0, infl);
      const sum = ws.reduce((a, c) => a + c[0], 0) || 1;
      let left = 255;
      ws.forEach(([w, j], q) => { const wb = q === ws.length - 1 ? left : Math.min(left, Math.round((w / sum) * 255)); left -= wb; vb.writeUInt8(j, b + 20 + q); vb.writeUInt8(wb, b + 24 + q); });
    }
    const ib = Buffer.alloc((idx.length + gearTris * 3) * 2);
    idx.forEach((v, q) => ib.writeUInt16LE(remap[v], q * 2));
    let gv = n, gi = idx.length;
    for (const q of kit) {
      for (const t of q.tris) ib.writeUInt16LE(gv + t, (gi++) * 2);
      for (const v of q.verts) {
        const b = gv++ * 28;
        for (let e = 0; e < 3; e++) { vb.writeFloatLE(v[e], b + e * 4); vb.writeInt8(Math.round(v[3 + e] * 127), b + 12 + e); }
        vb.writeUInt16LE(Math.round(((q.swatch + 0.5) / 4) * 65535), b + 16); vb.writeUInt16LE(Math.round((16.5 / 17) * 65535), b + 18);
        vb.writeUInt8(q.bone, b + 20); vb.writeUInt8(255, b + 24);
      }
    }
    lods.push({ triangles: idx.length / 3 + gearTris, vertices: n + gearVerts, influences: infl, vertexOffset: add(vb), indexOffset: add(ib) });
  });
  const anim = Buffer.concat(frames.map((f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength)));
  const animOffset = add(anim);

  // ---- colours
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.startsWith(`${name}.`)) fs.unlinkSync(path.join(OUT, f));
  let texFile = null;
  if (colour) {
    const tmp = colour, outTmp = path.join(os.tmpdir(), `hd-${name}-${process.pid}.webp`);
    execFileSync('python3', ['-I', path.join(here, 'texture.py'), tmp, outTmp, String(recipe.texture || 512), strip ? 'swatches' : 'plain', ...(recipe.swatches ? [['iron', 'wood', 'leather', 'paint'].map((k) => recipe.swatches[k].join(',')).join(';')] : [])], { stdio: ['ignore', 'inherit', 'inherit'] });
    const bytes = fs.readFileSync(outTmp);
    texFile = `${name}.${hash(bytes)}.webp`;
    fs.writeFileSync(path.join(OUT, texFile), bytes);
    fs.unlinkSync(outTmp);
  }
  const header = Buffer.from(JSON.stringify({ name, height: +((hi[1] - lo[1]) * s).toFixed(3), ...(recipe.length ? { span: +(Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * s).toFixed(2) } : {}), bones: nb, boneNames: props ? [...m.skin.names, 'prop'] : m.skin.names, fps: S.fps, frames: frames.length, clips, lods, animOffset, texture: texFile, source: recipe.source || null }));
  const pre = Buffer.alloc(8); pre.write('HDU1', 0, 'latin1'); pre.writeUInt32LE(header.length, 4);
  const headPad = Buffer.alloc((4 - ((8 + header.length) & 3)) & 3);
  const pack = Buffer.concat([pre, header, headPad, ...sections]);
  const packFile = `${name}.${hash(pack)}.bin`;
  fs.writeFileSync(path.join(OUT, packFile), pack);
  console.log(`${name}: ${packFile} ${(pack.length / 1024).toFixed(0)} KB (${lods.map((l) => `${l.triangles} tris / ${l.vertices} verts`).join(', ')}; ${nb} bones, ${frames.length} frames in ${clips.length} clips: ${clips.map((c) => `${c.name} ${c.frames}${c.stride ? ` stride ${c.stride} m` : ''}`).join(', ')})${texFile ? `, ${texFile} ${(fs.statSync(path.join(OUT, texFile)).size / 1024).toFixed(0)} KB` : ''}`);
  return { pack: packFile, texture: texFile, bytes: pack.length };
}

const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const all = fs.readdirSync(path.join(here, 'units')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const manifestFile = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { units: {} };
for (const n of names.length ? names : all) manifest.units[n] = buildUnit(n);
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
