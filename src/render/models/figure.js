// A jointed human-shaped figure built from a table of joint positions, so the same builder gives
// a standing rifleman, a hunched Uruk, a kneeling mortar crewman, a warg rider or a troll.
// Limbs are tagged with animation parts (see PART): thighs and shins for the walk cycle, upper
// arm and forearm for the strike. Gear is added by the caller around the returned joints.

import { PART, ringZ } from '../mesh.js';
import { MAT } from '../materials.js';

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const dim = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** Standing at ease. Left-side joints (y > 0); the right side mirrors them unless given. */
export const STAND = {
  pelvis: [0, 0, 0.92], chest: [0.02, 0, 1.33], neck: [0.03, 0, 1.5], head: [0.05, 0, 1.635],
  hipL: [0, 0.105, 0.9], kneeL: [0.03, 0.115, 0.5], ankleL: [-0.01, 0.12, 0.09],
  shoulderL: [0.02, 0.235, 1.42], elbowL: [0, 0.26, 1.14], handL: [0.1, 0.23, 0.9],
};
/** Every joint of a pose scaled about the ground origin (for trolls and the like). */
export const scalePose = (pose, k) => Object.fromEntries(Object.entries(pose).map(([j, p]) => [j, [p[0] * k, p[1] * k, p[2] * k]]));

/**
 * Build the body. Options:
 *   pose   joint overrides            bulk   girth multiplier        n   sides of the torso loft (8 full, 5 light)
 *   col    { legs, torso, arms, skin, boots, hands }                 mat { legs, torso, arms, boots }
 *   parts  { thighL, shinL, thighR, shinR, armL, foreL, armR, foreR } animation part per limb
 *   greaves / bracers  colour of iron shin and forearm guards        bareArms, noHead, noHands, headScale
 * Returns the resolved joints.
 */
export function figure(m, o = {}) {
  const J = { ...STAND, ...(o.pose || {}) };
  for (const k of ['hip', 'knee', 'ankle', 'shoulder', 'elbow', 'hand']) if (!J[k + 'R']) J[k + 'R'] = [J[k + 'L'][0], -J[k + 'L'][1], J[k + 'L'][2]];
  const b = o.bulk || 1, n = o.n || 8, full = n >= 8, nl = full ? 6 : 5, hs = (o.headScale || 1) * Math.min(b, 1.25);
  const c = { legs: [0.4, 0.4, 0.3], torso: [0.4, 0.4, 0.3], arms: [0.4, 0.4, 0.3], skin: [0.72, 0.56, 0.44], boots: [0.15, 0.12, 0.1], ...(o.col || {}) };
  const mt = { legs: MAT.CLOTH, torso: MAT.CLOTH, arms: MAT.CLOTH, boots: MAT.HIDE, ...(o.mat || {}) };
  const pt = { thighL: PART.LEG_L, shinL: PART.SHIN_L, thighR: PART.LEG_R, shinR: PART.SHIN_R, armL: 0, foreL: 0, armR: 0, foreR: 0, ...(o.parts || {}) };
  const keep = m.mat;
  for (const s of ['L', 'R']) {
    const hip = J['hip' + s], knee = J['knee' + s], ank = J['ankle' + s];
    m.mat = mt.legs;
    m.path([hip, knee], [0.108 * b, 0.082 * b], nl, c.legs, pt['thigh' + s]);
    m.mat = o.greaves ? MAT.IRON : mt.legs;
    m.path([knee, ank], [0.08 * b, 0.06 * b], nl, o.greaves || c.legs, pt['shin' + s]);
    m.mat = mt.boots;
    m.box(ank[0] + 0.06 * b, ank[1], ank[2] - 0.03 * b, 0.28 * b, 0.13 * b, 0.12 * b, c.boots, pt['shin' + s]);
  }
  // torso: hips, waist, chest, shoulders and the stub of a neck
  m.mat = mt.torso;
  const pv = J.pelvis, ch = J.chest, nk = J.neck, at = (t) => lerp3(pv, ch, t);
  const R = (p, rx, ry, col) => ringZ(p[0], p[1], p[2], rx * b, ry * b, col);
  m.loft([R([pv[0], pv[1], pv[2] - 0.08 * b], 0.11, 0.165, c.legs), R(at(0.1), 0.125, 0.185, c.legs), R(at(0.3), 0.115, 0.172), R(at(0.62), 0.13, 0.195), R(at(0.94), 0.135, 0.215),
    R(lerp3(ch, nk, 0.6), 0.11, 0.185), R(lerp3(ch, nk, 0.96), 0.06, 0.066), R([nk[0], nk[1], nk[2] + 0.05 * b], 0.05, 0.052, c.skin)], n, c.torso);
  if (!o.noHead) { m.mat = MAT.SKIN; m.sphere(J.head, [0.097 * hs, 0.086 * hs, 0.108 * hs], c.skin, 0, n, full ? 5 : 3); }
  for (const s of ['L', 'R']) {
    const sh = J['shoulder' + s], el = J['elbow' + s], hd = J['hand' + s], ac = o.bareArms ? c.skin : c.arms;
    m.mat = o.bareArms ? MAT.SKIN : mt.arms;
    if (full) m.sphere(sh, 0.078 * b, ac, pt['arm' + s], 6, 3);
    m.path([sh, el], [0.073 * b, 0.06 * b], nl, ac, pt['arm' + s]);
    if (o.bracers) m.mat = MAT.IRON;
    m.path([el, hd], [0.06 * b, 0.048 * b], nl, o.bracers || ac, pt['fore' + s]);
    if (!o.noHands) { m.mat = MAT.SKIN; m.box(hd[0], hd[1], hd[2], 0.1 * b, 0.085 * b, 0.1 * b, c.hands || c.skin, pt['fore' + s]); }
  }
  m.mat = keep;
  return J;
}

/**
 * The blocky stand-in for a figure: legs, body, head, one arm and whatever it carries, about seventy
 * triangles. o: { legs, torso, head, arm } colours, bulk, tall, weapon: { len, thick, col, z, rise, y }.
 */
export function blockFigure(m, o) {
  const b = o.bulk || 1, t = o.tall || 1;
  m.box(0, 0.115 * b, 0.45 * t, 0.2 * b, 0.19 * b, 0.9 * t, o.legs, PART.LEG_L);
  m.box(0, -0.115 * b, 0.45 * t, 0.2 * b, 0.19 * b, 0.9 * t, o.legs, PART.LEG_R);
  m.box(0.01, 0, 1.2 * t, 0.3 * b, 0.47 * b, 0.62 * t, o.torso);
  m.box(0.04, 0, 1.65 * t, 0.23 * b, 0.22 * b, 0.27 * t, o.head);
  m.box(0.2 * b, -0.24 * b, 1.3 * t, 0.4 * b, 0.12 * b, 0.12 * b, o.arm || o.torso, PART.ARM);
  const w = o.weapon;
  if (w) m.beam([0.3 * b, w.y == null ? -0.2 * b : w.y, (w.z || 1.3) * t], [0.3 * b + w.len, w.y == null ? -0.2 * b : w.y, (w.z || 1.3) * t + (w.rise || 0)], w.thick || 0.07, w.col, PART.ARM);
}
