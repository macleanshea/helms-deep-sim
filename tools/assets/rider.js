// A rider for a beast: a two-legged unit's model set in one fixed pose (astride, hands forward) so that the build can
// fasten it to the beast's back as part of the same mesh. Nothing of the rider moves by itself: he goes where the back goes.
import { ident, mul } from './glb.js';

const PARENT = {
  Spine02: 'Hips', Spine01: 'Spine02', Spine: 'Spine01', neck: 'Spine', Head: 'neck', head_end: 'Head', headfront: 'Head',
  LeftShoulder: 'Spine', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm',
  RightShoulder: 'Spine', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightHand: 'RightForeArm',
  LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', LeftToeBase: 'LeftFoot',
  RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg', RightToeBase: 'RightFoot',
};
const rot = (axis, a) => {
  const c = Math.cos(a), s = Math.sin(a), m = ident();
  if (axis === 'x') { m[5] = c; m[6] = s; m[9] = -s; m[10] = c; } else if (axis === 'y') { m[0] = c; m[2] = -s; m[8] = s; m[10] = c; } else { m[0] = c; m[1] = s; m[4] = -s; m[5] = c; }
  return m;
};
const move = (x, y, z) => { const m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; };

/**
 * @param src   a unit's source (tools/assets/source.js readSource), a figure standing along +z with +y up
 * @param pose  { thigh, splay, knee, lean, arm, elbow } in radians (all optional)
 * @returns { pos, nrm, uv, index, hips: [x, y, z], height } in the figure's own units, hips where they were
 */
export function seated(src, pose = {}) {
  const P = { thigh: 1.2, splay: 0.55, knee: 1.35, lean: 0.16, arm: 0.75, elbow: 0.5, raise: 0.95, ...pose }; // raise: how far the sword arm is lifted from the rein hand's level
  const m = src.mesh, names = m.skin.names, nj = names.length, nv = m.pos.length / 3;
  const pivot = names.map((_, j) => { // where each bone turns, from its inverse-bind matrix
    const b = m.skin.ibm.subarray(j * 16, j * 16 + 16), l = b[0] * b[0] + b[1] * b[1] + b[2] * b[2] || 1;
    return [0, 1, 2].map((k) => -(b[k * 4] * b[12] + b[k * 4 + 1] * b[13] + b[k * 4 + 2] * b[14]) / l);
  });
  const id = (n) => names.indexOf(n), side = (n) => (pivot[id(n)][0] > pivot[id('Hips')][0] ? 1 : -1);
  const turn = {}; // (a positive turn about x carries what hangs below a joint backward, and what stands above it forward)
  for (const s of ['Left', 'Right']) {
    turn[`${s}UpLeg`] = mul(rot('z', P.splay * side(`${s}UpLeg`)), rot('x', -P.thigh));
    turn[`${s}Leg`] = rot('x', P.knee);
    turn[`${s}Arm`] = rot('y', -P.arm * side(`${s}Arm`)); // the arms, held out to the sides at rest, come round to the front
    if (s === 'Right' && P.raise) turn.RightArm = mul(rot('z', P.raise * side('RightArm')), rot('y', -P.arm * 0.35 * side('RightArm'))); // the sword arm: up and a little forward, blade over his head
    turn[`${s}ForeArm`] = rot('y', -P.elbow * side(`${s}Arm`));
  }
  turn.Spine02 = rot('x', P.lean); turn.neck = rot('x', -P.lean * 0.7);
  const W = new Array(nj), done = new Array(nj).fill(false);
  const world = (j) => {
    if (done[j]) return W[j];
    const p = pivot[j], t = turn[names[j]], local = t ? mul(move(p[0], p[1], p[2]), mul(t, move(-p[0], -p[1], -p[2]))) : ident();
    const par = PARENT[names[j]] != null ? id(PARENT[names[j]]) : -1;
    W[j] = par >= 0 ? mul(world(par), local) : local; done[j] = true;
    return W[j];
  };
  for (let j = 0; j < nj; j++) world(j);
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
  let lo = 1e9, hi = -1e9;
  for (let v = 0; v < nv; v++) {
    const x = m.pos[v * 3], y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2], nx = m.nrm[v * 3], ny = m.nrm[v * 3 + 1], nz = m.nrm[v * 3 + 2];
    lo = Math.min(lo, y); hi = Math.max(hi, y);
    let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
    for (let q = 0; q < 4; q++) {
      const w = m.weights[v * 4 + q]; if (!w) continue;
      const M = W[m.joints[v * 4 + q]];
      px += w * (M[0] * x + M[4] * y + M[8] * z + M[12]); py += w * (M[1] * x + M[5] * y + M[9] * z + M[13]); pz += w * (M[2] * x + M[6] * y + M[10] * z + M[14]);
      qx += w * (M[0] * nx + M[4] * ny + M[8] * nz); qy += w * (M[1] * nx + M[5] * ny + M[9] * nz); qz += w * (M[2] * nx + M[6] * ny + M[10] * nz);
    }
    const l = Math.hypot(qx, qy, qz) || 1;
    pos.set([px, py, pz], v * 3); nrm.set([qx / l, qy / l, qz / l], v * 3);
  }
  // (where a joint has come to in this pose: the rider's gear is set by his hands)
  const joint = (n) => { const j = id(n), M = W[j], p = pivot[j]; return [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]]; };
  return { pos, nrm, uv: m.uv, index: m.index, hips: pivot[id('Hips')], height: hi - lo, joint };
}
