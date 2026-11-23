// The host of Isengard: Uruk-hai in several kits, crossbowmen, berserkers, sappers, captains,
// warg riders and siege trolls.

import { PART, ringZ, ringX } from '../mesh.js';
import { MAT } from '../materials.js';
import { figure, blockFigure, scalePose, STAND, dim } from './figure.js';
import { C } from './legacy.js';

const A = PART.ARM, F = PART.FOREARM;
const SKIN = [0.36, 0.3, 0.25], HIDE = [0.3, 0.2, 0.14], WHITE = [0.92, 0.9, 0.84], LEATHER = [0.24, 0.17, 0.12];

/** Hunched and broad, head thrust forward, feet apart. */
const URUK = {
  pelvis: [0, 0, 0.93], chest: [0.06, 0, 1.36], neck: [0.1, 0, 1.52], head: [0.14, 0, 1.645],
  hipL: [0, 0.125, 0.9], kneeL: [0.06, 0.145, 0.5], ankleL: [0, 0.155, 0.09],
  shoulderL: [0.06, 0.285, 1.45],
};
const SWORD_ARM = { elbowR: [0.2, -0.36, 1.2], handR: [0.42, -0.3, 1.38] };
const SHIELD_ARM = { elbowL: [0.22, 0.35, 1.2], handL: [0.42, 0.26, 1.24] };
const LOOSE_ARM = { elbowL: [0.04, 0.37, 1.16], handL: [0.14, 0.33, 0.92] };
// hip, shoulder x/z, swing, recoil, knee, -, elbow x/z
const ANIM = (swing, recoil = 0) => [0.9, 0.06, 1.45, swing, recoil, 0.5, 0, 0.2, 1.2];
const BULK = 1.18;

/** Single-edged blade along +x from the hand, with the Uruk back-spike near the point. */
function blade(m, L, w, part, col = C.blade) {
  m.mat = MAT.IRON;
  m.extrudeY([[0, -w / 2], [L * 0.8, -w / 2], [L, 0], [L * 0.86, w * 0.95], [L * 0.8, w / 2], [0, w / 2]], -0.012, 0.012, col, part);
  m.box(-0.02, 0, 0, 0.04, 0.05, w * 2, C.iron, part);
  m.mat = MAT.HIDE;
  m.tube([-0.22, 0, 0], [-0.02, 0, 0], 0.024, 0.024, 5, LEATHER, part);
}
/** Put a weapon in a hand: fn builds it along +x, `pitch` tilts it up from the horizontal. */
function inHand(m, hand, pitch, fn, yaw = 0) { m.push().translate(hand[0], hand[1], hand[2]); if (yaw) m.rotZ(yaw); m.rotY(-pitch); fn(); m.pop(); m.mat = MAT.PLAIN; }

/** Full iron helm: eye slit, nasal, crest, and the White Hand daubed on the brow. */
function helm(m, h, o = {}) {
  const k = o.k || 1, col = o.col || C.iron;
  m.mat = MAT.IRON;
  m.sphere([h[0], 0, h[2] + 0.005], [0.132 * k, 0.12 * k, 0.128 * k], col, 0, 8, 5);
  m.box(h[0] - 0.02, 0, h[2] + 0.135 * k, 0.24 * k, 0.022, 0.07, o.crest || C.ironLt);                 // crest
  m.box(h[0] + 0.125 * k, 0, h[2] - 0.03, 0.03, 0.03, 0.13, C.ironLt);                                  // nasal
  m.box(h[0] - 0.1 * k, 0, h[2] - 0.1, 0.12, 0.2 * k, 0.07, dim(col, 0.9));                             // neck guard
  m.mat = MAT.PLAIN;
  for (const s of [-1, 1]) m.box(h[0] + 0.118 * k, s * 0.052, h[2] + 0.012, 0.025, 0.055, 0.022, [0.02, 0.02, 0.02]);   // eye slits
  if (o.hand !== false) m.box(h[0] + 0.12 * k, 0, h[2] + 0.075, 0.03, 0.075, 0.06, WHITE);
}
/** Leather cap that leaves the face bare. */
function cap(m, h, col = LEATHER) { m.mat = MAT.HIDE; m.sphere([h[0] - 0.01, 0, h[2] + 0.02], [0.12, 0.108, 0.105], col, 0, 8, 3, 0.42, 1); }

/** Breastplate, shoulder guards and a skirt of cloth and plates. o: plate, cloth colours; bare (no breastplate). */
function armour(m, o = {}) {
  const b = BULK * (o.k || 1), plate = o.plate || C.iron, cloth = o.cloth || C.rust;
  if (!o.bare) {
    m.mat = MAT.IRON;
    m.loft([ringZ(0.01, 0, 1.05, 0.13 * b, 0.2 * b), ringZ(0.03, 0, 1.2, 0.148 * b, 0.215 * b), ringZ(0.055, 0, 1.38, 0.152 * b, 0.235 * b, dim(plate, 1.15)), ringZ(0.065, 0, 1.47, 0.125 * b, 0.215 * b)], 8, plate);
    m.box(0.07 + 0.15 * b, 0, 1.3, 0.02, 0.03, 0.3, C.ironLt);                                        // keel of the breastplate
  }
  // skirt: cloth under hanging plates
  m.mat = MAT.CLOTH;
  m.loft([ringZ(0, 0, 1.06, 0.128 * b, 0.19 * b), ringZ(0, 0, 0.72, 0.165 * b, 0.225 * b, dim(cloth, 0.75))], 8, cloth, 0, { capA: false, capB: false });
  m.mat = MAT.IRON;
  if (!o.noPlates) for (const [x, y, sx, sy] of [[0.15 * b, 0, 0.03, 0.2], [-0.15 * b, 0, 0.03, 0.2], [0, 0.21 * b, 0.16, 0.03], [0, -0.21 * b, 0.16, 0.03]]) m.box(x, y, 0.9, sx, sy, 0.28, dim(plate, 1.1));
  m.loft([ringZ(0, 0, 1.03, 0.135 * b, 0.2 * b), ringZ(0, 0, 1.09, 0.135 * b, 0.2 * b)], 8, LEATHER, 0, { capA: false, capB: false });   // belt
}
function pauldron(m, sh, side, part = 0, col = C.ironLt, k = 1) {
  m.mat = MAT.IRON;
  m.sphere([sh[0], sh[1] + side * 0.03, sh[2] + 0.02], [0.135 * k, 0.135 * k, 0.11 * k], col, part, 8, 3, 0.45, 1);
}
/** The tall Uruk shield with pointed ends, the White Hand on its face. Drawn facing +x at the hand. */
function shield(m, hand) {
  m.push().translate(hand[0] + 0.07, hand[1] - 0.04, hand[2] - 0.06).rotZ(0.25);
  const o = [[-0.26, -0.5], [0, -0.64], [0.26, -0.5], [0.29, 0.36], [0, 0.58], [-0.29, 0.36]];
  m.mat = MAT.IRON; m.extrudeX(o, 0, 0.035, C.iron);
  m.mat = MAT.PAINT; m.extrudeX(o.map(([y, z]) => [y * 0.84, z * 0.86]), 0.035, 0.05, C.rust);
  m.mat = MAT.PLAIN;
  m.box(0.055, 0, -0.06, 0.012, 0.16, 0.2, WHITE);
  for (const y of [-0.075, -0.025, 0.025, 0.075]) m.box(0.055, y, 0.1, 0.012, 0.03, 0.15, WHITE);
  m.box(0.055, 0.115, -0.02, 0.012, 0.03, 0.11, WHITE);
  m.pop();
}

/** An Uruk body with the usual gear. o: pose, skin / armour options, bare, noHelm, parts. Returns the joints. */
function uruk(m, o = {}) {
  const k = o.k || 1;
  const J = figure(m, {
    pose: { ...URUK, ...(o.pose || {}) }, bulk: BULK * k, headScale: o.noHelm ? 1.05 : 1, noHead: !o.noHelm && !o.cap,
    col: { legs: o.legs || [0.2, 0.17, 0.15], torso: o.bare ? o.skin || C.pale : [0.2, 0.17, 0.15], arms: o.sleeves || o.skin || SKIN, skin: o.skin || SKIN, boots: [0.12, 0.1, 0.09], hands: o.skin || SKIN },
    mat: { legs: MAT.HIDE, torso: o.bare ? MAT.SKIN : MAT.HIDE, arms: MAT.SKIN }, bareArms: true,
    greaves: o.noGreaves ? null : C.iron, bracers: o.noBracers ? null : C.iron,
    parts: { armR: A, foreR: F, ...(o.parts || {}) },
  });
  armour(m, { k, bare: o.bare, plate: o.plate, cloth: o.cloth, noPlates: o.bare });
  if (!o.noPauldrons) { pauldron(m, J.shoulderR, -1, (o.parts && o.parts.armR) === 0 ? 0 : A, o.pauldron, k); if (!o.onePauldron) pauldron(m, J.shoulderL, 1, (o.parts && o.parts.armL) || 0, o.pauldron, k); }
  if (o.cap) cap(m, J.head); else if (!o.noHelm) helm(m, J.head, { k, col: o.helm, crest: o.crest, hand: o.hand });
  m.mat = MAT.PLAIN;
  return J;
}

const mid = (o = {}) => (m) => blockFigure(m, { bulk: 1.15 * (o.k || 1), legs: C.iron, torso: o.torso || C.iron, head: o.head || C.ironLt, arm: o.arm || SKIN, weapon: o.weapon === null ? null : { len: 0.5, rise: 0.75, thick: 0.07, col: C.blade, y: -0.3, ...(o.weapon || {}) } });

function crossbow(m) {
  // stock, prod, string and stirrup, held across the body
  m.mat = MAT.TIMBER; m.box(0.52, 0, 1.3, 0.72, 0.06, 0.07, C.woodDk, A);
  m.mat = MAT.IRON;
  for (const s of [-1, 1]) { m.beam([0.84, 0, 1.31], [0.7, s * 0.4, 1.31], 0.045, C.ironLt, A, 0.03); m.beam([0.7, s * 0.4, 1.31], [0.42, 0, 1.33], 0.012, [0.7, 0.68, 0.6], A); }
  m.box(0.9, 0, 1.3, 0.1, 0.09, 0.02, C.iron, A);
  m.box(0.6, 0, 1.345, 0.36, 0.014, 0.014, C.blade, A);                                                // the bolt
}
function quiver(m) { m.mat = MAT.HIDE; m.push().translate(-0.2, 0.1, 1.3).rotX(0.3); m.lathe([[0.06, -0.25], [0.07, 0.2]], 6, LEATHER); m.mat = MAT.PLAIN; for (let k = 0; k < 4; k++) m.box((k % 2) * 0.04 - 0.02, (k >> 1) * 0.04 - 0.02, 0.27, 0.012, 0.012, 0.16, [0.8, 0.76, 0.7]); m.pop(); }

export const horde = {
  // sword and shield
  uruk: {
    anim: ANIM(1.2), mid: mid(),
    build: (m) => { const J = uruk(m, { pose: { ...SWORD_ARM, ...SHIELD_ARM } }); inHand(m, J.handR, 1.1, () => blade(m, 0.95, 0.075, F)); shield(m, J.handL); },
  },
  // pike
  urukB: {
    big: false, anim: ANIM(0.9), mid: mid({ weapon: { len: 0.9, rise: 2.4, thick: 0.05, col: C.woodDk } }),
    build: (m) => {
      const J = uruk(m, { pose: { ...LOOSE_ARM, elbowR: [0.18, -0.36, 1.18], handR: [0.4, -0.3, 1.3] }, parts: { armL: PART.ARM_FREE, foreL: PART.ARM_FREE }, helm: [0.23, 0.22, 0.24], crest: C.rust, cloth: [0.3, 0.2, 0.12] });
      inHand(m, J.handR, 1.25, () => { m.mat = MAT.TIMBER; m.tube([-0.9, 0, 0], [2.3, 0, 0], 0.024, 0.02, 5, C.woodDk, F); m.mat = MAT.IRON; m.lathe([[0.03, 0], [0.045, 0.06], [0.012, 0.42], [0, 0.46]], 4, C.blade, F, [2.3, 0, 0], 'x'); });
    },
  },
  // sword only, lighter kit
  urukC: {
    anim: ANIM(1.3), mid: mid({ torso: [0.25, 0.2, 0.17] }),
    build: (m) => {
      const J = uruk(m, { pose: { ...SWORD_ARM, ...LOOSE_ARM }, parts: { armL: PART.ARM_FREE, foreL: PART.ARM_FREE }, onePauldron: true, plate: [0.24, 0.2, 0.18], cloth: [0.34, 0.12, 0.09], hand: false });
      m.box(J.chest[0] + 0.19, 0, 1.3, 0.012, 0.13, 0.16, WHITE);                                     // the Hand on the breastplate instead
      inHand(m, J.handR, 1.05, () => blade(m, 1.05, 0.085, F));
    },
  },
  archer: {
    anim: ANIM(0.15, 0.08), mid: mid({ torso: [0.3, 0.2, 0.12], head: LEATHER, weapon: { len: 0.6, rise: 0, thick: 0.1, col: C.woodDk, y: 0 } }),
    build: (m) => {
      uruk(m, { pose: { elbowL: [0.3, 0.3, 1.18], handL: [0.56, 0.06, 1.27], elbowR: [0.1, -0.36, 1.16], handR: [0.3, -0.08, 1.26] }, parts: { armL: A, foreL: A, armR: A, foreR: A }, cap: true, noPauldrons: true, plate: [0.28, 0.2, 0.14], cloth: [0.3, 0.2, 0.12], noGreaves: true });
      crossbow(m); quiver(m);
    },
  },
  archerB: {
    anim: ANIM(0.15, 0.08), mid: mid({ torso: [0.24, 0.2, 0.18], weapon: { len: 0.6, rise: 0, thick: 0.1, col: C.woodDk, y: 0 } }),
    build: (m) => {
      uruk(m, { pose: { elbowL: [0.3, 0.3, 1.18], handL: [0.56, 0.06, 1.27], elbowR: [0.1, -0.36, 1.16], handR: [0.3, -0.08, 1.26] }, parts: { armL: A, foreL: A, armR: A, foreR: A }, noPauldrons: true, helm: [0.25, 0.24, 0.26], cloth: [0.22, 0.19, 0.16] });
      crossbow(m); quiver(m);
    },
  },
  // bare to the waist, a two-handed blade held high
  berserker: {
    anim: ANIM(1.5), mid: mid({ torso: C.pale, arm: C.pale, weapon: { len: 0.75, rise: 1.3, thick: 0.1 } }),
    build: (m) => {
      const J = uruk(m, { bare: true, skin: C.pale, pose: { elbowR: [0.2, -0.38, 1.52], handR: [0.34, -0.06, 1.72], elbowL: [0.2, 0.38, 1.52], handL: [0.36, 0.05, 1.76] }, parts: { armL: A, foreL: F, armR: A, foreR: F }, noPauldrons: true, noBracers: true, cloth: [0.2, 0.16, 0.14] });
      m.box(J.chest[0] + 0.165 * BULK, 0, 1.3, 0.012, 0.1, 0.22, [0.6, 0.12, 0.08]);                  // war paint
      inHand(m, [0.35, 0, 1.74], 1.2, () => blade(m, 1.5, 0.11, F));
    },
  },
  berserkerB: {
    anim: ANIM(1.5), mid: mid({ torso: C.pale, arm: C.pale, head: C.pale, weapon: { len: 0.75, rise: 1.3, thick: 0.1 } }),
    build: (m) => {
      const J = uruk(m, { bare: true, noHelm: true, skin: C.pale, pose: { elbowR: [0.2, -0.38, 1.52], handR: [0.34, -0.06, 1.72], elbowL: [0.2, 0.38, 1.52], handL: [0.36, 0.05, 1.76] }, parts: { armL: A, foreL: F, armR: A, foreR: F }, noPauldrons: true, cloth: [0.3, 0.1, 0.08] });
      m.box(J.head[0] + 0.095, 0, J.head[2] + 0.02, 0.02, 0.15, 0.1, WHITE);                           // the Hand across the face
      m.box(J.head[0], 0, J.head[2] + 0.11, 0.2, 0.03, 0.03, [0.6, 0.12, 0.08]);
      inHand(m, [0.35, 0, 1.74], 1.15, () => blade(m, 1.45, 0.12, F));
    },
  },
  // carries the blasting charge: a spiked iron sphere with a fuse
  sapper: {
    anim: ANIM(0), mid: (m) => { mid({ torso: C.pale, arm: C.pale, weapon: null })(m); m.box(0.5, 0, 1.15, 0.5, 0.5, 0.5, [0.13, 0.13, 0.14]); },
    build: (m) => {
      uruk(m, { bare: true, skin: C.pale, pose: { elbowL: [0.28, 0.36, 1.14], handL: [0.52, 0.28, 1.12], elbowR: [0.28, -0.36, 1.14], handR: [0.52, -0.28, 1.12] }, parts: { armR: 0, foreR: 0 }, noPauldrons: true, cloth: [0.25, 0.2, 0.16] });
      m.mat = MAT.IRON;
      m.sphere([0.55, 0, 1.18], 0.34, [0.14, 0.14, 0.15], 0, 10, 6);
      for (let k = 0; k < 10; k++) { m.push().translate(0.55, 0, 1.18).rotZ(k * 2.4).rotY(-(k / 10 - 0.5) * 2.4); m.lathe([[0.05, 0.3], [0, 0.5]], 4, C.ironLt, 0, [0, 0, 0], 'x', { capA: false }); m.pop(); }
      m.tube([0.55, 0, 1.5], [0.6, 0.03, 1.7], 0.02, 0.012, 4, [0.5, 0.42, 0.3]);
      m.mat = MAT.EMIT; m.sphere([0.6, 0.03, 1.72], 0.035, [1, 0.6, 0.2], 0, 4, 2);
    },
  },
  // a captain: taller, cloaked and crested, with the banner of the White Hand at his back
  chief: {
    anim: ANIM(1.3), mid: (m) => { mid({ k: 1.08, torso: [0.26, 0.24, 0.26] })(m); m.beam([-0.22, -0.2, 1.2], [-0.3, -0.2, 3.9], 0.06, C.woodDk); m.box(-0.75, -0.2, 3.4, 0.86, 0.03, 0.9, C.red, PART.BANNER); },
    build: (m) => {
      const J = uruk(m, { k: 1.08, pose: { ...SWORD_ARM, ...LOOSE_ARM }, parts: { armL: PART.ARM_FREE, foreL: PART.ARM_FREE }, plate: [0.26, 0.24, 0.26], helm: [0.24, 0.23, 0.25], crest: C.red, pauldron: [0.42, 0.4, 0.42] });
      m.box(J.head[0] - 0.02, 0, J.head[2] + 0.2, 0.3, 0.03, 0.1, C.red);                             // tall crest
      // cloak down the back
      m.mat = MAT.CLOTH;
      m.loft([ringZ(0, 0, 1.5, 0.2, 0.3, dim(C.red, 1.1)), ringZ(-0.05, 0, 1.2, 0.26, 0.33), ringZ(-0.1, 0, 0.7, 0.3, 0.36, dim(C.red, 0.7)), ringZ(-0.14, 0, 0.4, 0.3, 0.34, dim(C.red, 0.55))], 8, C.red, 0, { a0: Math.PI * 0.45, a1: Math.PI * 1.55, capA: false, capB: false });
      inHand(m, J.handR, 1.05, () => blade(m, 1.15, 0.1, F));
      m.mat = MAT.TIMBER; m.tube([-0.24, -0.2, 1.0], [-0.32, -0.2, 3.95], 0.035, 0.028, 5, C.woodDk);
      m.mat = MAT.IRON; m.lathe([[0.05, 0], [0, 0.25]], 4, C.blade, 0, [-0.32, -0.2, 3.95]);
      m.mat = MAT.CLOTH;
      m.box(-0.77, -0.2, 3.4, 0.86, 0.02, 0.9, C.red, PART.BANNER);
      m.mat = MAT.PLAIN;
      m.box(-0.77, -0.2, 3.32, 0.3, 0.04, 0.36, WHITE, PART.BANNER);
      for (const x of [-0.89, -0.81, -0.73, -0.65]) m.box(x, -0.2, 3.62, 0.055, 0.04, 0.26, WHITE, PART.BANNER);
    },
  },
  warg: {
    // hip, rider's shoulder x/z, swing, -, -, -, -, -, fore-and-aft position of the leg pivots
    anim: [0.86, 0, 1.75, 1.2, 0, 0, 0, 0, 0, 0.6],
    build: (m) => {
      const fur = C.fur, dk = dim(fur, 0.72);
      m.mat = MAT.HIDE;
      m.loft([ringX(-1.02, 0, 0.95, 0.06, 0.07, dk), ringX(-0.9, 0, 0.94, 0.19, 0.21), ringX(-0.6, 0, 0.93, 0.25, 0.28), ringX(-0.15, 0, 0.9, 0.24, 0.26), ringX(0.35, 0, 0.97, 0.29, 0.34),
        ringX(0.62, 0, 1.1, 0.26, 0.32, dk), ringX(0.86, 0, 1.14, 0.18, 0.21), ringX(1.06, 0, 1.12, 0.155, 0.17), ringX(1.2, 0, 1.06, 0.125, 0.125), ringX(1.42, 0, 1.0, 0.075, 0.07, dk), ringX(1.52, 0, 0.98, 0.04, 0.04, [0.06, 0.05, 0.05])], 8, fur);
      m.box(1.28, 0, 0.93, 0.36, 0.11, 0.05, dk);                                                     // jaw
      m.mat = MAT.PLAIN;
      for (const s of [-1, 1]) { for (const x of [1.22, 1.34, 1.44]) m.box(x, s * 0.045, 0.965, 0.025, 0.02, 0.04, WHITE); }
      m.mat = MAT.EMIT; for (const s of [-1, 1]) m.box(1.16, s * 0.09, 1.11, 0.03, 0.03, 0.025, [1, 0.75, 0.2]);
      m.mat = MAT.HIDE;
      for (const s of [-1, 1]) m.lathe([[0.06, 0], [0, 0.17]], 4, dk, 0, [1.0, s * 0.11, 1.24], 'z', { capA: false });   // ears
      m.path([[-1.0, 0, 0.95], [-1.3, 0, 0.8], [-1.5, 0, 0.55]], [0.06, 0.05, 0.02], 5, dk);                              // tail
      m.loft([ringX(0.25, 0, 1.28, 0.05, 0.08), ringX(0.8, 0, 1.33, 0.06, 0.1, dk)], 4, dk);                              // mane
      const leg = (x, s, part, hind) => m.path([[x, s * 0.2, 0.86], [x + (hind ? -0.12 : 0.05), s * 0.21, 0.46], [x + (hind ? 0.02 : 0), s * 0.21, 0.06]], [0.12, 0.07, 0.065], 5, fur, part);
      leg(0.58, 1, PART.LEG_L, false); leg(0.58, -1, PART.LEG_R, false); leg(-0.62, 1, PART.LEG_R, true); leg(-0.62, -1, PART.LEG_L, true);
      for (const [x, s, p] of [[0.58, 1, PART.LEG_L], [0.58, -1, PART.LEG_R], [-0.6, 1, PART.LEG_R], [-0.6, -1, PART.LEG_L]]) m.box(x + 0.06, s * 0.21, 0.04, 0.2, 0.13, 0.08, dk, p);
      // the rider, low over the shoulders
      const J = figure(m, {
        n: 5, bulk: 1.0, noHead: true, noHands: true,
        pose: { pelvis: [-0.12, 0, 1.24], chest: [0.02, 0, 1.62], neck: [0.07, 0, 1.76], head: [0.11, 0, 1.87], hipL: [-0.12, 0.13, 1.22], kneeL: [0.14, 0.3, 1.02], ankleL: [0.06, 0.32, 0.66],
          shoulderL: [0.02, 0.24, 1.7], elbowL: [0.22, 0.28, 1.5], handL: [0.44, 0.14, 1.42], elbowR: [0.14, -0.32, 1.5], handR: [0.32, -0.3, 1.68] },
        col: { legs: C.iron, torso: C.iron, arms: SKIN, boots: [0.1, 0.09, 0.08] }, mat: { legs: MAT.HIDE, torso: MAT.IRON }, bareArms: true,
        parts: { thighL: 0, shinL: 0, thighR: 0, shinR: 0, armR: A, foreR: A },
      });
      m.mat = MAT.IRON; m.sphere(J.head, [0.125, 0.115, 0.12], C.ironLt, 0, 6, 4);
      m.mat = MAT.PLAIN; m.box(J.head[0] + 0.115, 0, J.head[2] + 0.05, 0.02, 0.07, 0.06, WHITE);
      inHand(m, J.handR, 1.0, () => blade(m, 0.85, 0.07, A));
    },
  },
  troll: {
    // hip, shoulder x/z, swing, -, knee, -, elbow x/z
    anim: [1.82, 0.2, 2.86, 1.3, 0, 1.0, 0, 0.55, 2.2],
    build: (m) => {
      const sk = C.troll, dk = C.trollDk;
      const pose = { ...scalePose(STAND, 2), pelvis: [0, 0, 1.86], chest: [0.2, 0, 2.72], neck: [0.34, 0, 3.02], head: [0.5, 0, 3.2],
        hipL: [0, 0.3, 1.82], kneeL: [0.12, 0.36, 1.0], ankleL: [0, 0.38, 0.2], shoulderL: [0.22, 0.66, 2.86],
        elbowL: [0.24, 0.9, 2.1], handL: [0.5, 0.86, 1.4], elbowR: [0.55, -0.86, 2.2], handR: [1.0, -0.8, 2.05] };
      const J = figure(m, { pose, bulk: 2.5, headScale: 2.5, col: { legs: dk, torso: sk, arms: sk, skin: sk, boots: dk, hands: dk }, mat: { legs: MAT.HIDE, torso: MAT.HIDE, arms: MAT.HIDE }, parts: { armR: A, foreR: F, armL: PART.ARM_FREE, foreL: PART.ARM_FREE } });
      m.mat = MAT.HIDE;
      m.box(J.head[0] + 0.22, 0, J.head[2] - 0.14, 0.2, 0.34, 0.14, dk);                              // heavy jaw
      m.sphere([J.head[0] + 0.12, 0, J.head[2] + 0.1], [0.22, 0.27, 0.1], dk, 0, 6, 3);                 // brow
      m.mat = MAT.PLAIN; for (const s of [-1, 1]) m.box(J.head[0] + 0.3, s * 0.1, J.head[2] - 0.05, 0.03, 0.04, 0.1, WHITE);   // tusks
      // hide loincloth, iron shoulder plates and a studded collar, all crudely strapped on
      m.mat = MAT.HIDE;
      m.loft([ringZ(0, 0, 1.95, 0.36, 0.5), ringZ(0, 0, 1.3, 0.42, 0.54, dim(HIDE, 0.7))], 8, HIDE, 0, { capA: false, capB: false });
      m.mat = MAT.IRON;
      m.sphere([J.shoulderR[0], J.shoulderR[1] - 0.04, J.shoulderR[2] + 0.08], [0.36, 0.36, 0.28], C.iron, A, 8, 3, 0.45, 1);
      m.sphere([J.shoulderL[0], J.shoulderL[1] + 0.04, J.shoulderL[2] + 0.08], [0.36, 0.36, 0.28], C.iron, PART.ARM_FREE, 8, 3, 0.45, 1);
      m.loft([ringZ(0.28, 0, 2.9, 0.3, 0.4), ringZ(0.3, 0, 3.02, 0.26, 0.34)], 8, C.ironLt, 0, { capA: false, capB: false });
      m.box(0.2 + 0.36, 0, 2.3, 0.05, 0.7, 0.9, dim(C.iron, 1.1));                                    // belly plate
      // the club: a trunk bound and spiked with iron
      inHand(m, J.handR, 1.15, () => {
        m.mat = MAT.TIMBER; m.path([[-0.5, 0, 0], [0.9, 0, 0], [2.1, 0, 0]], [0.1, 0.15, 0.24], 7, C.woodDk, F);
        m.mat = MAT.IRON;
        for (const x of [1.2, 1.6, 1.95]) m.lathe([[0.27, -0.06], [0.27, 0.06]], 7, C.iron, F, [x, 0, 0], 'x');
        for (let k = 0; k < 6; k++) { const a = k * 1.047; m.beam([1.6 + (k % 2) * 0.3, Math.cos(a) * 0.2, Math.sin(a) * 0.2], [1.6 + (k % 2) * 0.3, Math.cos(a) * 0.42, Math.sin(a) * 0.42], 0.06, C.ironLt, F); }
      });
    },
  },
};
