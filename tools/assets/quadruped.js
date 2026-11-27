// A skeleton and clips for a four-legged beast whose model came without them (the generator rigs only two-legged
// figures). The bones are given places on the model by the recipe, as shares of its length and height; each vertex
// is bound to the bones of the region it lies in, blended across the joints; and the clips (idle, walk, run, attack,
// die) are made here from a few sines, not captured from life.
//
// The model stands along +z with +y up (as the generator's figures do), its nose at +z. In the recipe:
//   "quadruped": { "file": "<model.glb>", "nose": "+z" | "-z", ...places, see DEFAULTS below }
// Places are [along, up]: 0..1 from tail to nose, and from the feet to the top of the back.
import { ident, mul } from './glb.js';

const DEFAULTS = {
  pelvis: [0.25, 0.55], chest: [0.5, 0.6], head: [0.7, 0.6], tail: [0.1, 0.7],
  foreHip: [0.56, 0.42], foreKnee: [0.56, 0.19], hindHip: [0.2, 0.45], hindKnee: [0.17, 0.2],
  spine: [0.3, 0.5],        // along: the body passes from the pelvis to the chest between these
  neck: [0.66, 0.78],       // and from the chest to the head between these
  tailEnd: 0.11,            // everything behind this is tail
  foreLeg: [0.44, 0.68], hindLeg: [0.115, 0.32], // along: where the legs are
  legIn: 0.16,              // a leg lies further than this from the middle line (a share of the half-width)
  stride: { walk: 0.55, run: 1.75 }, // how far a cycle carries it, in lengths of the model
};
export const BONES = ['pelvis', 'chest', 'head', 'tail', 'foreL', 'foreLowL', 'foreR', 'foreLowR', 'hindL', 'hindLowL', 'hindR', 'hindLowR'];
const PARENT = [-1, 0, 1, 0, 1, 4, 1, 6, 0, 8, 0, 10];

const rot = (axis, a) => { // column-major 4x4, a turn about one axis
  const c = Math.cos(a), s = Math.sin(a), m = ident();
  if (axis === 'x') { m[5] = c; m[6] = s; m[9] = -s; m[10] = c; } else if (axis === 'y') { m[0] = c; m[2] = -s; m[8] = s; m[10] = c; } else { m[0] = c; m[1] = s; m[4] = -s; m[5] = c; }
  return m;
};
const move = (x, y, z) => { const m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; };
const about = (p, r) => mul(move(p[0], p[1], p[2]), mul(r, move(-p[0], -p[1], -p[2]))); // a turn `r` about the point p
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** @returns {{ mesh, clips, image }} in the shape tools/assets/source.js stores (image: the index of the colour texture's image, or null) */
export function quadruped(g, opts = {}) {
  const O = { ...DEFAULTS, ...opts, stride: { ...DEFAULTS.stride, ...(opts.stride || {}) } };
  const { gltf, accessor } = g, prim = gltf.meshes[0].primitives[0];
  const pos = accessor(prim.attributes.POSITION), nrm = accessor(prim.attributes.NORMAL), uv = accessor(prim.attributes.TEXCOORD_0), nv = pos.length / 3;
  const index = Uint32Array.from(prim.indices != null ? accessor(prim.indices, false) : Array.from({ length: nv }, (_, k) => k));
  if (O.nose === '-z') for (let v = 0; v < nv; v++) { pos[v * 3] = -pos[v * 3]; pos[v * 3 + 2] = -pos[v * 3 + 2]; nrm[v * 3] = -nrm[v * 3]; nrm[v * 3 + 2] = -nrm[v * 3 + 2]; } // (half a turn about y)
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[v * 3 + k]); hi[k] = Math.max(hi[k], pos[v * 3 + k]); }
  const L = hi[2] - lo[2], H = hi[1] - lo[1], mid = (lo[0] + hi[0]) / 2, halfW = (hi[0] - lo[0]) / 2;
  const at = ([u, w], side = 0) => [mid + side * halfW * 0.5, lo[1] + w * H, lo[2] + u * L];

  // ---- where the bones turn
  const pivot = [at(O.pelvis), at(O.chest), at(O.head), at(O.tail),
    at(O.foreHip, 1), at(O.foreKnee, 1), at(O.foreHip, -1), at(O.foreKnee, -1), at(O.hindHip, 1), at(O.hindKnee, 1), at(O.hindHip, -1), at(O.hindKnee, -1)];

  // ---- which bones carry each vertex
  const joints = new Uint8Array(nv * 4), weights = new Float32Array(nv * 4);
  for (let v = 0; v < nv; v++) {
    const u = (pos[v * 3 + 2] - lo[2]) / L, w = (pos[v * 3 + 1] - lo[1]) / H, x = (pos[v * 3] - mid) / halfW;
    const acc = new Map(), add = (b, k) => { if (k > 1e-4) acc.set(b, (acc.get(b) || 0) + k); };
    // the trunk: pelvis -> chest -> head along the body, and the tail behind
    const kHead = smooth(O.neck[0], O.neck[1], u), kChest = smooth(O.spine[0], O.spine[1], u) * (1 - kHead), kTail = 1 - smooth(O.tailEnd - 0.05, O.tailEnd, u);
    let trunk = [[0, (1 - kChest - kHead) * (1 - kTail)], [1, kChest], [2, kHead], [3, kTail * (1 - kChest - kHead)]];
    // a leg: below its hip, off the middle line, within its stretch of the body
    let leg = 0, up = -1;
    const fore = u > O.foreLeg[0] && u < O.foreLeg[1], hind = u > O.hindLeg[0] && u < O.hindLeg[1];
    if ((fore || hind) && Math.abs(x) > O.legIn) {
      const hip = fore ? O.foreHip[1] : O.hindHip[1], knee = fore ? O.foreKnee[1] : O.hindKnee[1];
      leg = 1 - smooth(hip - 0.07, hip + 0.05, w);
      // (the legs fade out toward the ends of their stretch high up, where they join the body, so no seam shows)
      const r = fore ? O.foreLeg : O.hindLeg, edge = Math.min(smooth(r[0], r[0] + 0.04, u), 1 - smooth(r[1] - 0.04, r[1], u));
      leg *= w < hip - 0.1 ? 1 : edge;
      up = (fore ? 4 : 8) + (x > 0 ? 0 : 2);
      const low = 1 - smooth(knee - 0.035, knee + 0.035, w);
      add(up, leg * (1 - low)); add(up + 1, leg * low);
    }
    for (const [b, k] of trunk) add(b, k * (1 - leg));
    const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((a, c) => a + c[1], 0) || 1;
    top.forEach(([b, k], q) => { joints[v * 4 + q] = b; weights[v * 4 + q] = k / sum; });
  }

  // ---- clips: per frame, a turn for each bone about its own place, and a shift and turn of the whole beast
  const FPS = 30, TAU = Math.PI * 2;
  const pose = (P) => { // P: { root: 4x4 or null, turn: { bone index: 4x4 rotation } } -> one 4x4 per bone, rest place -> place in the frame
    const W = new Array(BONES.length);
    for (let b = 0; b < BONES.length; b++) {
      const local = P.turn[b] ? about(pivot[b], P.turn[b]) : ident();
      W[b] = PARENT[b] < 0 ? mul(P.root || ident(), local) : mul(W[PARENT[b]], local);
    }
    return W;
  };
  // a leg's turns at a point in its cycle: swung back while it bears weight, lifted and bent as it comes forward
  const legTurns = (turn, upper, ph, swing, bend, lean = 0) => {
    const a = Math.sin(TAU * ph), lift = Math.max(0, -Math.cos(TAU * ph)); // (a positive turn about x carries the foot back)
    turn[upper] = rot('x', swing * a + lean); turn[upper + 1] = rot('x', bend * lift * lift);
  };
  const clip = (name, frames, loop, stride, fn) => {
    const mats = new Float32Array(frames * BONES.length * 16);
    for (let f = 0; f < frames; f++) { const W = pose(fn(loop ? f / frames : f / (frames - 1))); W.forEach((M, b) => mats.set(M, (f * BONES.length + b) * 16)); }
    return { name, loop, frames, stride, mats };
  };
  const clips = [
    clip('idle', 72, true, 0, (t) => {
      const turn = {}, s = Math.sin(TAU * t), s2 = Math.sin(TAU * 2 * t);
      turn[2] = mul(rot('y', 0.1 * s), rot('x', 0.05 * s2)); turn[3] = rot('y', 0.22 * Math.sin(TAU * t + 1)); turn[1] = rot('x', 0.012 * s2);
      return { turn };
    }),
    clip('walk', 32, true, O.stride.walk * L, (t) => {
      const turn = {};
      legTurns(turn, 4, t, 0.36, 0.7); legTurns(turn, 6, t + 0.5, 0.36, 0.7); legTurns(turn, 8, t + 0.75, 0.33, 0.6); legTurns(turn, 10, t + 0.25, 0.33, 0.6);
      turn[2] = rot('x', 0.05 * Math.sin(TAU * 2 * t)); turn[3] = rot('y', 0.15 * Math.sin(TAU * t)); turn[1] = rot('y', 0.03 * Math.sin(TAU * t));
      return { turn, root: move(0, 0.012 * H * Math.sin(TAU * 2 * t), 0) };
    }),
    clip('run', 16, true, O.stride.run * L, (t) => {
      // a gallop: the hind legs drive together, then the forelegs reach together, and the back flexes between
      const turn = {}, flex = Math.sin(TAU * t);
      legTurns(turn, 4, t + 0.0, 0.8, 1.1, -0.1); legTurns(turn, 6, t + 0.09, 0.8, 1.1, -0.1); legTurns(turn, 8, t + 0.5, 0.75, 0.9, 0.1); legTurns(turn, 10, t + 0.59, 0.75, 0.9, 0.1);
      turn[1] = rot('x', -0.13 * flex); turn[2] = rot('x', 0.16 * flex + 0.05); turn[3] = rot('x', -0.35 + 0.2 * flex);
      return { turn, root: mul(move(0, H * (0.05 + 0.05 * Math.sin(TAU * t + 0.6)), 0), about(pivot[0], rot('x', 0.07 * flex))) };
    }),
    clip('attack', 27, false, 0, (t) => {
      // a lunge and a snap of the jaws: it rocks back, throws itself forward with the head down, and recovers
      const turn = {}, back = Math.sin(Math.PI * Math.min(1, t / 0.3)) * (t < 0.3 ? 1 : 0), go = t < 0.3 ? 0 : Math.sin(Math.PI * (t - 0.3) / 0.7);
      turn[2] = rot('x', -0.25 * back + 0.5 * go * Math.cos(Math.PI * (t - 0.3) / 0.7 * 0.5)); turn[1] = rot('x', 0.1 * go);
      turn[4] = rot('x', -0.5 * go + 0.2 * back); turn[6] = rot('x', -0.5 * go + 0.2 * back); turn[5] = rot('x', 0.4 * go); turn[7] = rot('x', 0.4 * go);
      turn[8] = rot('x', 0.35 * go - 0.15 * back); turn[10] = rot('x', 0.35 * go - 0.15 * back); turn[3] = rot('x', -0.4 * go);
      return { turn, root: move(0, H * 0.04 * go, L * (0.14 * go - 0.05 * back)) };
    }),
    clip('die', 42, false, 0, (t) => {
      // it stumbles, its legs go, and it rolls onto its side
      const turn = {}, e = t * t * (3 - 2 * t), fold = Math.min(1, t * 2.2), roll = Math.max(0, (t - 0.18) / 0.82), r = roll * roll * (3 - 2 * roll);
      for (const b of [4, 6, 8, 10]) { turn[b] = rot('x', (b < 8 ? -0.5 : 0.4) * fold); turn[b + 1] = rot('x', 1.0 * fold); }
      turn[2] = mul(rot('x', 0.35 * e), rot('y', 0.3 * r)); turn[3] = rot('x', -0.5 * e);
      const side = [mid - halfW * 0.45, lo[1], 0];
      return { turn, root: mul(about(side, rot('z', (Math.PI / 2) * 0.96 * r)), move(0, -H * 0.2 * fold * (1 - r), 0)) };
    }),
  ];

  // (a bone's "inverse bind" here is only where it turns: the clips' matrices already carry rest places to posed ones)
  const ibm = new Float32Array(BONES.length * 16);
  pivot.forEach((p, b) => ibm.set(move(-p[0], -p[1], -p[2]), b * 16));
  const mat = gltf.materials && gltf.materials[prim.material], tex = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture;
  return { mesh: { pos, nrm, uv, joints, weights, index, skin: { names: BONES.slice(), ibm } }, clips, fps: FPS, image: tex ? gltf.textures[tex.index].source : null };
}
