// The horde's engines: scaling ladders and their crews, the battering ram, catapults and the great
// siege towers. Moving pieces (the ram's log, the catapult's arm, the tower's drawbridge) are part ARM.

import { PART } from '../mesh.js';
import { MAT } from '../materials.js';
import { figure, dim } from './figure.js';
import { C } from './legacy.js';

const A = PART.ARM;
const WOOD = C.wood, WOODD = C.woodDk, IRON = C.iron, IRONL = C.ironLt, SKIN = [0.36, 0.3, 0.25], WHITE = [0.92, 0.9, 0.84];

/** A lightly built Uruk for crews: walks, arms up to whatever it carries or pushes at height z. */
function crewman(m, x, y, hold = 1.45, reach = 0.25) {
  m.at(x, y, 0, 0, () => {
    const J = figure(m, {
      n: 5, bulk: 1.15, noHead: true, noHands: true,
      pose: { pelvis: [0, 0, 0.93], chest: [0.05, 0, 1.36], neck: [0.09, 0, 1.52], head: [0.13, 0, 1.64], hipL: [0, 0.125, 0.9], kneeL: [0.06, 0.145, 0.5], ankleL: [0, 0.155, 0.09],
        shoulderL: [0.06, 0.28, 1.45], elbowL: [0.12 + reach * 0.5, 0.3, (1.45 + hold) / 2 - 0.12], handL: [0.1 + reach, 0.24, hold] },
      col: { legs: IRON, torso: IRON, arms: SKIN, boots: [0.12, 0.1, 0.09] }, mat: { legs: MAT.HIDE, torso: MAT.IRON }, bareArms: true,
    });
    m.withMat(MAT.IRON, () => m.sphere(J.head, [0.13, 0.118, 0.125], IRONL, 0, 6, 3));
    m.withMat(MAT.PLAIN, () => m.box(J.head[0] + 0.118, 0, J.head[2] + 0.06, 0.02, 0.07, 0.06, WHITE));
  });
}
/** Solid wooden wheel with an iron tire and hub, lying across the frame. */
function cartWheel(m, x, y, z, r, w, n = 12) {
  m.withMat(MAT.TIMBER, () => m.lathe([[r * 0.94, -w / 2], [r * 0.94, w / 2], [r * 0.94, w / 2], [0, w / 2, dim(WOODD, 0.8)]], n, WOODD, 0, [x, y, z], 'y'));
  m.withMat(MAT.IRON, () => { m.lathe([[r * 0.94, -w * 0.6], [r, -w * 0.6], [r, w * 0.6], [r * 0.94, w * 0.6]], n, IRON, 0, [x, y, z], 'y', { capA: false, capB: false }); m.lathe([[r * 0.22, w / 2], [r * 0.16, w / 2 + 0.1], [0, w / 2 + 0.1]], 8, IRONL, 0, [x, y, z], 'y', { capA: false }); });
  m.withMat(MAT.IRON, () => { for (let k = 0; k < 4; k++) { const a = k * 0.785; m.box(x, y + w / 2 + 0.012, z, Math.abs(Math.cos(a)) * r * 1.7 + 0.07, 0.02, Math.abs(Math.sin(a)) * r * 1.7 + 0.07, dim(IRON, 0.9)); if (k === 1) break; } });
}
function rungs(m, a, b, half, n, t = 0.035) {
  const ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  m.withMat(MAT.TIMBER, () => {
    for (const s of [-1, 1]) m.tube([a[0], a[1] + s * half, a[2]], [b[0], b[1] + s * half, b[2]], t * 1.5, t * 1.5, 5, WOOD);
    for (let k = 1; k < n; k++) { const u = k / n; m.tube([a[0] + ax[0] * u, a[1] - half, a[2] + ax[2] * u], [a[0] + ax[0] * u, a[1] + half, a[2] + ax[2] * u], t, t, 4, WOODD); }
  });
}

/** The ram itself: its wheeled frame, hide roof and slung trunk. */
function ramBody(m) {
  for (const x of [-1.8, 1.4]) m.mirror(() => cartWheel(m, x, 1.28, 0.55, 0.55, 0.22));
  m.withMat(MAT.TIMBER, () => {
    m.mirror(() => { m.box(-0.2, 1.02, 0.72, 5.0, 0.24, 0.26, WOODD); });
    for (const x of [-2.5, -0.2, 2.1]) m.box(x, 0, 0.72, 0.24, 2.3, 0.22, WOOD);
    // A-frames fore and aft under a ridge pole
    for (const x of [-2.5, 2.1]) m.mirror(() => m.beam([x, 1.02, 0.85], [x, 0.08, 3.02], 0.2, WOOD));
    m.box(-0.2, 0, 3.05, 5.3, 0.22, 0.22, WOODD);
    m.mirror(() => m.box(-0.2, 1.1, 1.75, 5.0, 0.14, 0.14, WOOD));
  });
  // the penthouse roof: raw hides nailed over planks, in overlapping panels
  m.withMat(MAT.HIDE, () => m.mirror(() => {
    for (let k = 0; k < 3; k++) {
      const x0 = -2.85 + k * 1.75, x1 = x0 + 1.85, sh = [1, 0.82, 1.12][k], t = 0.07 + k * 0.012;
      m.prism([[x0, 1.3, 1.62], [x1, 1.3, 1.62], [x1, 0.02, 3.2], [x0, 0.02, 3.2]], [[x0, 1.3, 1.62 + t], [x1, 1.3, 1.62 + t], [x1, 0.02, 3.2 + t], [x0, 0.02, 3.2 + t]], dim(C.hide, sh));
    }
  }));
  // the ram: a trunk shod with an iron head, slung on chains
  m.withMat(MAT.TIMBER, () => m.lathe([[0.2, -2.9], [0.27, -2.6], [0.27, 3.2]], 8, WOOD, A, [0.4, 0, 1.5], 'x', { capB: false }));
  m.withMat(MAT.IRON, () => {
    m.lathe([[0.3, 3.0], [0.33, 3.3], [0.3, 3.7], [0.14, 4.1], [0, 4.2]], 8, IRONL, A, [0.4, 0, 1.5], 'x', { capA: false });
    for (const x of [-1.6, 0.4, 2.2]) m.lathe([[0.29, -0.07], [0.29, 0.07]], 8, IRON, A, [0.4 + x, 0, 1.5], 'x', { capA: false, capB: false });
    for (const s of [-1, 1]) m.lathe([[0.07, 0], [0, 0.26]], 4, IRONL, A, [3.9, s * 0.22, 1.72], 'z', { capA: false });   // the wolf's ears
    for (const x of [-1.3, 1.5]) for (const s of [-1, 1]) m.tube([x, s * 0.2, 1.7], [x, s * 0.08, 2.95], 0.025, 0.025, 4, IRON);
  });
}

/** The carried ladder itself: rails, rungs and the iron hooks at its head. */
function ladderBody(m) {
  rungs(m, [-6, 0, 1.47], [6, 0, 1.47], 0.36, 14);
  m.withMat(MAT.IRON, () => { for (const s of [-1, 1]) { m.tube([6, s * 0.36, 1.47], [6.35, s * 0.36, 1.3], 0.03, 0.02, 4, IRONL); m.box(5.6, s * 0.36, 1.47, 0.5, 0.11, 0.11, IRON); } });
}

export const siege = {
  // a twelve-meter ladder carried at shoulder height
  ladder: {
    // hip, -, -, -, -, knee, -, -, -, fore-and-aft position of the carriers
    anim: [0.9, 0, 0, 0, 0, 0.5, 0, 0, 0, 3.6],
    build: (m) => {
      ladderBody(m);
      for (const x of [-3.6, 3.6]) for (const s of [-1, 1]) m.push().scale(1, s, 1) && (crewman(m, x, 0.66, 1.47, 0.02), m.pop());
    },
  },
  // the ladder alone: with crewed engines on, its carriers are soldiers in their own right
  ladderBare: { build: (m) => ladderBody(m) },
  // the same ladder raised against the wall
  ladderUp: {
    build: (m) => {
      rungs(m, [0, 0, 0], [3.3, 0, 12.6], 0.4, 26, 0.045);
      m.withMat(MAT.IRON, () => { for (const s of [-1, 1]) { m.tube([3.3, s * 0.4, 12.6], [3.95, s * 0.4, 12.75], 0.05, 0.04, 5, IRONL); m.tube([3.95, s * 0.4, 12.75], [4.05, s * 0.4, 12.2], 0.04, 0.02, 5, IRONL); m.box(0.05, s * 0.4, 0.12, 0.3, 0.14, 0.24, IRON); } });
    },
  },
  ram: {
    // the log lunges forward on each blow (negative recoil); the crew push at the rear and the front
    anim: [0.9, 0, 0, 0, -1.3, 0.5, 0, 0, 0, 1.55],
    build: (m) => {
      ramBody(m);
      for (const x of [-1.55, 1.55]) for (const s of [-1, 1]) m.push().scale(1, s, 1) && (crewman(m, x, 0.7, 1.35, 0.3), m.pop());
    },
  },
  ramBare: { anim: [0.9, 0, 0, 0, -1.3, 0.5, 0, 0, 0, 1.55], build: (m) => ramBody(m) },
  catapult: {
    // the arm (part ARM) whips up and over about its axle
    anim: [0, 0.8, 1.45, 1.35, 0],
    build: (m) => {
      for (const x of [-1.8, 1.8]) m.mirror(() => cartWheel(m, x, 1.55, 0.62, 0.62, 0.24));
      m.withMat(MAT.TIMBER, () => {
        m.mirror(() => {
          m.box(0, 1.2, 0.82, 5.2, 0.3, 0.3, WOOD);
          m.beam([0.8, 1.2, 0.95], [0.8, 1.2, 3.3], 0.3, WOOD);
          m.beam([-1.2, 1.2, 0.95], [0.7, 1.2, 2.9], 0.2, WOODD); m.beam([2.3, 1.2, 0.95], [0.9, 1.2, 2.6], 0.2, WOODD);
        });
        for (const x of [-2.45, 0, 2.45]) m.box(x, 0, 0.82, 0.3, 2.7, 0.3, WOODD);
        m.box(0.8, 0, 3.22, 0.34, 2.9, 0.34, WOODD);                                                    // the stop the arm strikes
        m.lathe([[0.14, -1.35], [0.14, 1.35]], 8, WOODD, 0, [0.8, 0, 1.45], 'y');                       // axle
        // the throwing arm and its spoon
        m.path([[1.5, 0, 1.28], [0.8, 0, 1.45], [-3.2, 0, 2.42]], [0.16, 0.16, 0.1], 6, WOOD, A);
        m.lathe([[0.5, 0], [0.5, 0.28], [0.42, 0.28], [0.36, 0.08], [0, 0.06]], 8, WOODD, A, [-3.35, 0, 2.38]);
      });
      m.withMat(MAT.ROCK || MAT.PLAIN, () => m.sphere([-3.35, 0, 2.72], 0.36, C.stone, A, 6, 4));
      m.withMat(MAT.HIDE, () => m.lathe([[0.3, -0.5], [0.34, 0], [0.3, 0.5]], 8, [0.5, 0.42, 0.3], 0, [0.8, 0, 1.45], 'y'));   // the twisted skein
      m.withMat(MAT.IRON, () => {
        m.cbox(1.75, 0, 1.25, 0.8, 1.1, 0.8, 0.05, IRON, A);                                            // counterweight
        m.lathe([[0.12, -0.9], [0.12, 0.9]], 6, IRON, 0, [-2.2, 0, 1.05], 'y');                         // windlass
        m.mirror(() => { for (let k = 0; k < 4; k++) m.tube([-2.2, 1.05, 1.05], [-2.2 + Math.cos(k * 1.57) * 0.45, 1.05, 1.05 + Math.sin(k * 1.57) * 0.45], 0.03, 0.03, 4, WOODD); });
      });
      m.withMat(MAT.PLAIN, () => { for (const [x, y] of [[2.9, 0.4], [3.1, -0.3], [2.7, -0.5], [3.0, 0.05]]) m.sphere([x, y, 0.3], [0.34, 0.32, 0.28], dim(C.stone, 0.8 + (x % 0.3)), 0, 6, 3); });
    },
  },
  tower: {
    // the drawbridge (part ARM) drops forward about its hinge when the tower docks
    anim: [0, 2.72, 12.3, 1.5708, 0],
    build: (m) => {
      const H = 14.6, w = 2.6;
      for (const x of [-2.2, 2.2]) m.mirror(() => cartWheel(m, x, 2.85, 0.95, 0.95, 0.42, 14));
      m.withMat(MAT.TIMBER, () => {
        m.mirror(() => { m.box(0, 2.3, 1.0, 6.2, 0.36, 0.4, WOODD); m.box(0, 2.7, 0.95, 0.3, 1.1, 0.3, WOODD); });
        for (const x of [-2.8, 0, 2.8]) m.box(x, 0, 1.0, 0.36, 5.0, 0.36, WOODD);
        for (const z of [1.25, 4.6, 8.4, 12.2]) m.box(0, 0, z, 5.0, 5.0, 0.2, WOOD);                       // floors
      });
      m.withMat(MAT.TIMBER_V, () => {
        // corner posts leaning in toward the top, and cross-braces on the open faces
        for (const sx of [-1, 1]) m.mirror(() => m.beam([sx * w, w, 0.8], [sx * w * 0.92, w * 0.92, H], 0.4, WOODD));
        for (let s = 0; s < 3; s++) {
          const z0 = [1.35, 4.7, 8.5][s], z1 = [4.5, 8.3, 12.1][s];
          m.mirror(() => { m.beam([-w, w * 0.97, z0], [w, w * 0.95, z1], 0.2, WOOD); m.beam([w, w * 0.97, z0], [-w, w * 0.95, z1], 0.2, WOOD); });
          m.beam([-w * 0.97, -w, z0], [-w * 0.95, w, z1], 0.2, WOOD); m.beam([-w * 0.97, w, z0], [-w * 0.95, -w, z1], 0.2, WOOD);
        }
        // boarded sides with gaps between the boards
        m.mirror(() => { for (let k = 0; k < 7; k++) if (k !== 3) m.box(-1.95 + k * 0.65, w * 0.99, 6.9, 0.52, 0.07, 10.6, dim(WOOD, 0.8 + (k % 3) * 0.12)); });
        // the fighting top: a boarded parapet with gaps to shoot through
        m.mirror(() => { for (let k = 0; k < 6; k++) m.box(-2.0 + k * 0.8, 2.34, 13.1 + (k % 2) * 0.25, 0.7, 0.1, 1.7 + (k % 2) * 0.5, WOOD); });
        for (let k = 0; k < 6; k++) m.box(-2.38, -2.0 + k * 0.8, 13.1 + (k % 2) * 0.25, 0.1, 0.7, 1.7 + (k % 2) * 0.5, WOOD);
        // the drawbridge, raised until the tower docks
        m.box(2.72, 0, 14.4, 0.16, 3.4, 4.2, WOODD, A);
        for (const y of [-1.5, 0, 1.5]) m.box(2.82, y, 14.4, 0.1, 0.2, 4.2, WOOD, A);
      });
      // the front and its hides: wet skins hung over the boards against fire
      m.withMat(MAT.HIDE, () => {
        for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) {
          const sh = 0.78 + ((r * 3 + k * 5) % 7) * 0.07;
          m.push().translate(w * 0.99 + 0.05 + (r % 2) * 0.03, -1.74 + k * 1.74, 2.7 + r * 2.75).rotY(0.02); m.box(0, 0, 0, 0.07, 1.8, 2.95, dim(C.hide, sh)); m.pop();
        }
      });
      m.withMat(MAT.IRON, () => {
        for (const y of [-1.55, 1.55]) { m.lathe([[0.07, 0], [0, 0.45]], 4, IRONL, A, [2.72, y, 16.5], 'z', { capA: false }); m.tube([2.6, y, 16.2], [-0.6, y * 0.6, 14.3], 0.03, 0.03, 4, IRON); }
        for (const z of [3, 6.5, 10]) m.box(w * 0.99 + 0.11, 0, z, 0.04, 5.2, 0.14, IRON);
      });
      // ladders up the inside, a ramp at the rear, and a banner over all
      rungs(m, [-2.1, 0.9, 1.3], [-1.3, 0.9, 12.2], 0.35, 22);
      m.withMat(MAT.TIMBER, () => m.beam([-2.7, 0, 1.15], [-4.6, 0, 0.15], 0.24, WOODD, 0, 1.8));
      m.withMat(MAT.TIMBER, () => m.tube([-2.2, -2.2, 14], [-2.3, -2.2, 18.4], 0.06, 0.04, 5, WOODD));
      m.withMat(MAT.CLOTH, () => m.box(-3.1, -2.2, 17.5, 1.5, 0.03, 1.5, C.red, PART.BANNER));
      m.withMat(MAT.PLAIN, () => { m.box(-3.1, -2.2, 17.35, 0.5, 0.05, 0.6, WHITE, PART.BANNER); for (const x of [-3.3, -3.17, -3.03, -2.9]) m.box(x, -2.2, 17.85, 0.09, 0.05, 0.42, WHITE, PART.BANNER); });
    },
  },
};
