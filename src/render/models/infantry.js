// The garrison's infantry: one soldier in several loadouts.

import { PART, ringZ } from '../mesh.js';
import { MAT } from '../materials.js';
import { figure, blockFigure, dim } from './figure.js';
import { C } from './legacy.js';

const A = PART.ARM;
const GUN = [0.1, 0.1, 0.1], POLY = [0.14, 0.14, 0.13], BOOT = [0.16, 0.13, 0.1], GLOVE = [0.2, 0.2, 0.17];

/** Weapon shouldered, sighting along it: the stock in the right shoulder, the left hand forward. */
const AIM = {
  elbowL: [0.28, 0.22, 1.2], handL: [0.52, -0.01, 1.3],
  elbowR: [0.06, -0.33, 1.16], handR: [0.27, -0.1, 1.27],
};
// hip, shoulder x/z, swing (negative: the muzzle climbs), recoil, knee
const ANIM = [0.9, 0.05, 1.4, -0.07, 0.05, 0.5];

/** A rifle lying along x at height z. o: len, optic, heavy (machine gun), launcher, scope, can. */
function rifle(m, y, z, o = {}) {
  const L = o.len || 0.93, k = o.heavy ? 1.35 : 1;
  m.mat = MAT.IRON;
  m.box(0.1, y, z - 0.015, 0.2, 0.045, 0.11, POLY, A);                                        // stock
  m.box(0.33, y, z, 0.28, 0.052 * k, 0.1 * k, GUN, A);                                         // receiver
  m.box(0.6, y, z + 0.004, 0.27, 0.056, 0.07, POLY, A);                                        // handguard
  m.tube([0.72, y, z + 0.008], [L, y, z + 0.008], 0.013 * k, 0.013 * k, 5, GUN, A);
  m.tube([L - 0.02, y, z + 0.008], [L + (o.can ? 0.2 : 0.05), y, z + 0.008], o.can ? 0.026 : 0.02, o.can ? 0.026 : 0.02, 6, GUN, A);
  m.box(0.25, y, z - 0.09, 0.05, 0.04, 0.11, POLY, A);                                         // grip
  if (o.heavy) {
    m.box(0.38, y + 0.06, z - 0.09, 0.2, 0.11, 0.15, [0.3, 0.33, 0.2], A);                     // belt box
    for (const s of [-1, 1]) m.tube([L - 0.12, y, z - 0.01], [L + 0.02, y + s * 0.13, z - 0.28], 0.012, 0.012, 4, GUN, A);
    m.box(0.36, y, z + 0.07, 0.16, 0.02, 0.03, GUN, A);
  } else { m.push().translate(0.37, y, z - 0.05).rotY(-0.22); m.box(0, 0, -0.08, 0.07, 0.034, 0.2, GUN, A); m.pop(); }   // magazine
  if (o.launcher) m.tube([0.5, y, z - 0.055], [0.78, y, z - 0.055], 0.03, 0.03, 6, [0.2, 0.2, 0.2], A);
  if (o.scope) { m.tube([0.24, y, z + 0.095], [0.52, y, z + 0.095], 0.027, 0.034, 6, GUN, A); m.box(0.36, y, z + 0.062, 0.14, 0.03, 0.03, GUN, A); }
  else if (o.optic !== false) { m.tube([0.3, y, z + 0.088], [0.41, y, z + 0.088], 0.024, 0.024, 6, GUN, A); m.box(0.355, y, z + 0.06, 0.08, 0.03, 0.03, GUN, A); }
}

/**
 * The soldier under the weapon: camouflage, plate carrier with pouches, belt, pack, knee pads and
 * helmet. o: uni, vest, helm colors; hat ('boonie' | 'beret'); pose; pack: false.
 */
function soldier(m, o = {}) {
  const uni = o.uni || C.uni, vest = o.vest || C.vest, helm = o.helm || C.helm;
  const J = figure(m, {
    pose: { ...AIM, ...(o.pose || {}) }, col: { legs: uni, torso: uni, arms: uni, skin: C.skin, boots: BOOT, hands: GLOVE },
    mat: { legs: MAT.CAMO, torso: MAT.CAMO, arms: MAT.CAMO }, parts: { armL: A, foreL: A, armR: A, foreR: A },
  });
  // plate carrier, pouches, belt
  m.mat = MAT.CLOTH;
  m.loft([ringZ(0.01, 0, 1.07, 0.138, 0.192), ringZ(0.015, 0, 1.2, 0.152, 0.21), ringZ(0.02, 0, 1.36, 0.15, 0.22), ringZ(0.02, 0, 1.41, 0.128, 0.205)], 8, vest);
  for (const y of [-0.09, 0, 0.09]) m.box(0.175, y, 1.15, 0.05, 0.075, 0.15, dim(vest, 0.82));
  m.box(0.02, 0.22, 1.12, 0.1, 0.05, 0.14, dim(vest, 0.9));
  m.loft([ringZ(0, 0, 1.0, 0.13, 0.19), ringZ(0, 0, 1.05, 0.13, 0.19)], 8, [0.14, 0.13, 0.1], 0, { capA: false, capB: false });
  m.box(0.02, -0.215, 0.8, 0.09, 0.05, 0.17, [0.12, 0.12, 0.11], PART.LEG_R);                    // holster
  for (const [s, p] of [[1, PART.SHIN_L], [-1, PART.SHIN_R]]) m.box(0.095, s * 0.115, 0.5, 0.05, 0.11, 0.13, [0.17, 0.17, 0.14], p);
  if (o.pack !== false) {
    m.mat = MAT.CAMO;
    m.cbox(-0.22, 0, 1.25, 0.16, 0.29, 0.36, 0.03, dim(uni, 0.78));
    m.box(-0.23, 0, 1.47, 0.12, 0.27, 0.1, dim(uni, 0.62));
  }
  const h = J.head;
  if (o.hat === 'boonie') {
    m.mat = MAT.CAMO;
    m.sphere([h[0], 0, h[2] + 0.03], [0.105, 0.098, 0.09], helm, 0, 8, 3, 0.45, 1);
    m.lathe([[0.1, 0], [0.2, -0.03], [0.2, -0.015], [0.1, 0.02]], 8, dim(helm, 0.9), 0, [h[0], 0, h[2] + 0.035]);
  } else if (o.hat === 'beret') {
    m.mat = MAT.CLOTH;
    m.sphere([h[0] - 0.01, 0.02, h[2] + 0.085], [0.115, 0.125, 0.045], helm, 0, 8, 3);
  } else {
    m.mat = MAT.CAMO;
    m.sphere([h[0] - 0.005, 0, h[2] + 0.015], [0.124, 0.114, 0.118], helm, 0, 8, 4, 0.4, 1);
    m.mat = MAT.PLAIN;
    m.box(h[0] + 0.115, 0, h[2] + 0.065, 0.03, 0.06, 0.04, GUN);                                // night-vision mount
    for (const s of [-1, 1]) m.box(h[0], s * 0.1, h[2] - 0.01, 0.07, 0.03, 0.08, [0.13, 0.13, 0.12]);   // headset
  }
  m.mat = MAT.PLAIN;
  return J;
}

const mid = (o = {}) => (m) => blockFigure(m, { legs: C.uniDk, torso: o.uni || C.uni, head: o.helm || C.helm, arm: o.uni || C.uni, weapon: { len: 0.6, thick: 0.07, col: C.gun, z: 1.33, y: -0.07, ...(o.weapon || {}) } });

export const infantry = {
  rifle: { anim: ANIM, mid: mid(), build: (m) => { soldier(m); rifle(m, -0.07, 1.345); } },
  mg: {
    anim: ANIM, mid: mid({ weapon: { len: 0.85, thick: 0.1 } }),
    build: (m) => { soldier(m); rifle(m, -0.07, 1.34, { len: 1.12, heavy: true, optic: false }); m.mat = MAT.IRON; for (let k = 0; k < 5; k++) m.box(0.1 - k * 0.03, 0.05 + k * 0.035, 1.3 - k * 0.05, 0.03, 0.05, 0.045, [0.5, 0.4, 0.18]); },   // a belt over the shoulder
  },
  marksman: {
    anim: ANIM, mid: mid({ uni: C.ghil, helm: C.ghil, weapon: { len: 0.95, thick: 0.06 } }),
    build: (m) => {
      const g = C.ghil;
      soldier(m, { uni: g, vest: dim(g, 0.8), helm: g, hat: 'boonie', pack: false });
      // ghillie: a shaggy cape over the shoulders and back
      m.mat = MAT.HIDE;
      m.loft([ringZ(-0.02, 0, 1.47, 0.16, 0.25, dim(g, 1.1)), ringZ(-0.06, 0, 1.3, 0.2, 0.26), ringZ(-0.1, 0, 1.0, 0.21, 0.25, dim(g, 0.8)), ringZ(-0.12, 0, 0.8, 0.17, 0.2, dim(g, 0.7))], 8, g, 0, { a0: Math.PI * 0.42, a1: Math.PI * 1.58, capA: false, capB: false });
      rifle(m, -0.07, 1.345, { len: 1.12, scope: true, can: true });
    },
  },
  grenadier: {
    anim: ANIM, mid: mid(),
    build: (m) => {
      soldier(m); rifle(m, -0.07, 1.345, { launcher: true });
      m.mat = MAT.IRON;
      for (let k = 0; k < 6; k++) m.sphere([0.13 - k * 0.012, -0.14 + k * 0.055, 1.38 - k * 0.055], 0.028, [0.42, 0.36, 0.16], 0, 5, 3);   // bandolier of grenades
    },
  },
  at: {
    anim: [0.9, 0.05, 1.4, -0.05, 0.1, 0.5], mid: mid({ weapon: { len: 1.2, thick: 0.15, col: C.vehDk, z: 1.6, y: -0.22 } }),
    build: (m) => {
      soldier(m, { pose: { elbowL: [0.3, 0.14, 1.34], handL: [0.42, -0.1, 1.5], elbowR: [0.12, -0.33, 1.3], handR: [0.22, -0.2, 1.5] } });
      // launch tube on the shoulder, sight unit under it, two spare rounds on the pack
      m.mat = MAT.PAINT;
      m.lathe([[0.088, -0.52], [0.088, -0.42], [0.066, -0.42], [0.066, 0.66], [0.09, 0.66], [0.09, 0.78], [0.05, 0.78], [0.05, 0.78], [0, 0.74, [0.03, 0.03, 0.03]]], 8, C.vehDk, A, [0, -0.21, 1.61], 'x');
      m.cbox(0.32, -0.21, 1.5, 0.2, 0.1, 0.12, 0.02, [0.16, 0.17, 0.14], A);
      m.tube([0.36, -0.21, 1.45], [0.36, -0.21, 1.38], 0.02, 0.02, 5, GUN, A);
      for (const y of [-0.08, 0.08]) m.lathe([[0.055, 0], [0.055, 0.62]], 6, dim(C.vehDk, 0.9), 0, [-0.33, y, 1.0], 'z');
    },
  },
  cmd: {
    anim: ANIM, mid: (m) => { mid({ helm: [0.25, 0.3, 0.2] })(m); m.beam([-0.3, 0.12, 1.5], [-0.42, 0.12, 3.3], 0.035, C.gun); m.box(-0.62, 0.12, 3.05, 0.42, 0.03, 0.3, [0.35, 0.7, 0.9], PART.BANNER); },
    build: (m) => {
      soldier(m, { helm: [0.36, 0.14, 0.12], hat: 'beret', pack: false });
      rifle(m, -0.07, 1.345, { len: 0.8 });
      // radio pack with a whip aerial, and the command pennant that marks the team out
      m.mat = MAT.PAINT;
      m.cbox(-0.22, 0, 1.28, 0.16, 0.3, 0.42, 0.02, C.vehDk);
      m.box(-0.14, 0.1, 1.5, 0.04, 0.08, 0.05, GUN);
      m.mat = MAT.IRON;
      m.tube([-0.26, 0.12, 1.48], [-0.42, 0.12, 3.3], 0.014, 0.006, 4, GUN);
      m.tube([-0.26, -0.1, 1.48], [-0.3, -0.1, 2.1], 0.01, 0.005, 4, GUN);
      m.mat = MAT.CLOTH;
      m.box(-0.62, 0.12, 3.05, 0.42, 0.012, 0.3, [0.35, 0.7, 0.9], PART.BANNER);
      m.box(-0.62, 0.12, 3.05, 0.2, 0.02, 0.1, [0.9, 0.92, 0.95], PART.BANNER);
    },
  },
};
