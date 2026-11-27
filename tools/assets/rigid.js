// Bones and clips for a machine: a hull, and for a tank a turret that turns on it. The model comes from the generator
// as one shell with no parts, so the turret is whatever stands above a height the recipe gives (a share of the whole
// height), turning about the middle of that part. Its one clip, "turret", is a full turn: the game picks the frame
// from the angle between the gun and the hull.
//
//   "rigid": { "file": "<model.glb>", "nose": "+z" | "-z" | "+x" | "-x", "turret": { "above": 0.55, "pivot": [along, across]?, "reach": 0.2? } }
// The model is turned so that its nose is at +z (the generator's figures face that way), +y up.
import { ident, mul } from './glb.js';

const TURN = 180; // frames in the turret's full turn: two degrees a frame

/** The first mesh of a file with no skeleton: positions, normals, texture coordinates, triangles, and its colour image. */
export function staticMesh(g, nose = '+z') {
  const { gltf, accessor } = g, prim = gltf.meshes[0].primitives[0];
  const pos = accessor(prim.attributes.POSITION), nrm = accessor(prim.attributes.NORMAL), uv = accessor(prim.attributes.TEXCOORD_0), nv = pos.length / 3;
  const index = Uint32Array.from(prim.indices != null ? accessor(prim.indices, false) : Array.from({ length: nv }, (_, k) => k));
  // a turn about y that brings the nose to +z: (x, z) -> (x cos + z sin, -x sin + z cos)
  const a = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 }[nose];
  if (a == null) throw new Error(`nose "${nose}": one of +z, -z, +x, -x`);
  if (a) { const c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a)); for (const A of [pos, nrm]) for (let v = 0; v < nv; v++) { const x = A[v * 3], z = A[v * 3 + 2]; A[v * 3] = x * c + z * s; A[v * 3 + 2] = -x * s + z * c; } }
  const mat = gltf.materials && gltf.materials[prim.material], tex = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture;
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[v * 3 + k]); hi[k] = Math.max(hi[k], pos[v * 3 + k]); }
  return { pos, nrm, uv, index, nv, lo, hi, image: tex ? gltf.textures[tex.index].source : null };
}

export function rigid(g, opts = {}) {
  const M = staticMesh(g, opts.nose), { pos, nv, lo, hi } = M, H = hi[1] - lo[1], L = hi[2] - lo[2], Wd = hi[0] - lo[0], mid = (lo[0] + hi[0]) / 2;
  const names = ['hull'], joints = new Uint8Array(nv * 4), weights = new Float32Array(nv * 4);
  for (let v = 0; v < nv; v++) weights[v * 4] = 1;
  const pivots = [[mid, lo[1], (lo[2] + hi[2]) / 2]], clips = [{ name: 'idle', loop: true, frames: 1, stride: 0, mats: Float32Array.from(ident()) }];
  if (opts.turret) {
    names.push('turret');
    const cut = lo[1] + opts.turret.above * H;
    // the turret turns about the middle of what stands above the cut, the gun left out of the sum (it lies along the middle
    // line); with a `reach` (a share of the length), only what stands within it of that point, or ahead of it on the
    // middle line (the gun), is turret: an aerial at the far end of the hull stays where it is
    let sz = 0, n = 0;
    for (let v = 0; v < nv; v++) if (pos[v * 3 + 1] > cut && Math.abs(pos[v * 3] - mid) > 0.1 * Wd) { sz += pos[v * 3 + 2]; n++; }
    const p = opts.turret.pivot ? [mid + opts.turret.pivot[1] * Wd, cut, lo[2] + opts.turret.pivot[0] * L] : [mid, cut, n ? sz / n : (lo[2] + hi[2]) / 2];
    const reach = opts.turret.reach ? opts.turret.reach * L : Infinity;
    for (let v = 0; v < nv; v++) {
      if (pos[v * 3 + 1] <= cut) continue;
      const dx = pos[v * 3] - p[0], dz = pos[v * 3 + 2] - p[2];
      if (Math.hypot(dx, dz) < reach || (dz > 0 && Math.abs(dx) < 0.09 * Wd)) joints[v * 4] = 1;
    }
    pivots.push(p);
    const still = ident(), mats = new Float32Array(TURN * 2 * 16);
    for (let f = 0; f < TURN; f++) {
      const a = (f / TURN) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), r = ident();
      r[0] = c; r[2] = -s; r[8] = s; r[10] = c; // about y: the gun swings from +z toward +x
      const m = ident(); m[12] = p[0]; m[13] = p[1]; m[14] = p[2];
      const back = ident(); back[12] = -p[0]; back[13] = -p[1]; back[14] = -p[2];
      mats.set(still, f * 32); mats.set(mul(m, mul(r, back)), f * 32 + 16);
    }
    clips[0] = { name: 'idle', loop: true, frames: 1, stride: 0, mats: Float32Array.from([...ident(), ...ident()]) };
    clips.push({ name: 'turret', loop: true, frames: TURN, stride: 0, mats });
  }
  // The shell is one piece, so some triangles have corners on both the hull and the turret, and would be stretched
  // into sheets as it turns. They go with the turret, as a skirt round its foot: their hull corners are copied for it.
  let { pos: P, nrm: N, uv: U, index: I } = M, J = joints, Wt = weights;
  if (opts.turret) {
    const copy = new Map(), extra = [];
    const idx = Uint32Array.from(I);
    for (let t = 0; t < idx.length; t += 3) {
      const a = J[idx[t] * 4], b = J[idx[t + 1] * 4], c = J[idx[t + 2] * 4];
      if (a + b + c === 0 || a + b + c === 3) continue;
      for (let k = 0; k < 3; k++) { const v = idx[t + k]; if (J[v * 4]) continue; if (!copy.has(v)) { copy.set(v, nv + extra.length); extra.push(v); } idx[t + k] = copy.get(v); }
    }
    const n2 = nv + extra.length, grow = (A, w) => { const B = new A.constructor(n2 * w); B.set(A); extra.forEach((v, q) => B.set(A.subarray(v * w, v * w + w), (nv + q) * w)); return B; };
    P = grow(P, 3); N = grow(N, 3); U = grow(U, 2); J = grow(J, 4); Wt = grow(Wt, 4); I = idx;
    for (let q = nv; q < n2; q++) J[q * 4] = 1;
  }
  const ibm = new Float32Array(names.length * 16);
  pivots.forEach((p, b) => { const m = ident(); m[12] = -p[0]; m[13] = -p[1]; m[14] = -p[2]; ibm.set(m, b * 16); });
  return { mesh: { pos: P, nrm: N, uv: U, joints: J, weights: Wt, index: I, skin: { names, ibm } }, clips, fps: 30, image: M.image };
}
