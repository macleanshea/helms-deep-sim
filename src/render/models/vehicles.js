// The garrison's heavy equipment: main battle tank, wheeled infantry fighting vehicle, towed
// howitzer, mortar team, and the ammunition cache and crates. Hulls and turrets are separate
// models so turrets can traverse; barrels are part ARM so they recoil.

import { PART } from '../mesh.js';
import { MAT } from '../materials.js';
import { figure, dim } from './figure.js';
import { C } from './legacy.js';

const A = PART.ARM;
const G = C.veh, GD = C.vehDk, GL = [0.4, 0.43, 0.27], BLACK = [0.07, 0.07, 0.07], RUBBER = [0.09, 0.09, 0.085], STEEL = [0.32, 0.33, 0.34], GLASS = [0.1, 0.16, 0.2];

/** Road wheel or tyre lying across the hull: rim, rounded shoulders and a recessed hub. */
function wheel(m, x, y, z, r, w, tyre = RUBBER, hub = GD, n = 12) {
  const h = w / 2;
  m.withMat(MAT.PLAIN, () => m.lathe([[r * 0.55, -h], [r * 0.9, -h], [r, -h * 0.6], [r, h * 0.6], [r * 0.9, h], [r * 0.55, h]], n, tyre, 0, [x, y, z], 'y', { capA: false, capB: false }));
  m.withMat(MAT.PAINT, () => m.lathe([[r * 0.56, h * 0.9], [r * 0.5, h * 0.55], [r * 0.2, h * 0.5], [r * 0.2, h * 0.8], [0, h * 0.8]], n, hub, 0, [x, y, z], 'y', { capA: false }));
}
/** A hatch: a low disc with a raised rim and a handle. */
function hatch(m, x, y, z, r, col = GD) { m.lathe([[r, 0], [r, 0.05], [r * 0.86, 0.07], [0, 0.07]], 10, col, 0, [x, y, z]); m.box(x, y, z + 0.09, r * 0.5, 0.03, 0.03, BLACK); }
function antenna(m, x, y, z, h) { m.withMat(MAT.IRON, () => { m.tube([x, y, z], [x, y, z + 0.12], 0.03, 0.025, 5, BLACK); m.tube([x, y, z + 0.12], [x - h * 0.08, y, z + h], 0.012, 0.005, 4, BLACK); }); }
/** A crewman kneeling on one knee (for the gun crews). */
function kneeler(m, x, y, yaw, o = {}) {
  m.at(x, y, 0, yaw, () => figure(m, {
    n: 5, pose: { pelvis: [-0.05, 0, 0.55], chest: [0.06, 0, 0.95], neck: [0.1, 0, 1.1], head: [0.13, 0, 1.23], hipL: [-0.05, 0.1, 0.52], kneeL: [0.3, 0.12, 0.5], ankleL: [0.3, 0.12, 0.09],
      hipR: [-0.05, -0.1, 0.52], kneeR: [0.2, -0.13, 0.12], ankleR: [-0.25, -0.13, 0.1], shoulderL: [0.06, 0.22, 1.04], elbowL: [0.3, 0.24, 0.9], handL: [0.5, 0.16, 0.95], ...(o.pose || {}) },
    col: { legs: C.uni, torso: C.uni, arms: C.uni, skin: C.skin, boots: [0.16, 0.13, 0.1], hands: [0.2, 0.2, 0.17] }, mat: { legs: MAT.CAMO, torso: MAT.CAMO, arms: MAT.CAMO },
    parts: { thighL: 0, shinL: 0, thighR: 0, shinR: 0 },
  }));
  m.at(x, y, 0, yaw, () => m.withMat(MAT.CAMO, () => m.sphere([0.125, 0, 1.245], [0.124, 0.114, 0.118], C.helm, 0, 6, 3, 0.4, 1)));
}
function crateBox(m, x, y, z, sx, sy, sz, col, yaw = 0) {
  m.at(x, y, z, yaw, () => {
    m.withMat(MAT.TIMBER, () => m.box(0, 0, sz / 2, sx, sy, sz, col));
    m.withMat(MAT.TIMBER_V, () => { for (const s of [-0.36, 0.36]) m.box(s * sx, 0, sz / 2, sx * 0.09, sy + 0.04, sz + 0.03, dim(col, 0.75)); });
    m.withMat(MAT.IRON, () => { for (const s of [-1, 1]) m.box(0, s * (sy / 2 + 0.015), sz * 0.6, sx * 0.3, 0.02, 0.04, BLACK); });
  });
}

export const vehicles = {
  tank: {
    build: (m) => {
      m.mat = MAT.PAINT;
      // hull: a low tub between the tracks under a wide upper hull with a long sloped glacis
      m.extrudeY([[-3.55, 0.42], [3.15, 0.42], [3.8, 0.95], [3.6, 1.22], [-3.62, 1.22]], -1.22, 1.22, GD);
      m.extrudeY([[-3.72, 1.2], [3.55, 1.2], [3.75, 1.3], [2.15, 1.7], [-3.72, 1.7]], -1.86, 1.86, G);
      m.box(-2.75, 0, 1.73, 1.9, 2.5, 0.07, GD);                                                        // engine deck
      m.withMat(MAT.PLAIN, () => { for (const y of [-0.75, 0.75]) for (let k = 0; k < 6; k++) m.box(-3.3 + k * 0.22, y, 1.775, 0.1, 1.0, 0.03, BLACK); });   // grilles
      m.cbox(-3.78, 0, 1.3, 0.14, 2.9, 0.5, 0.03, GD);
      m.withMat(MAT.PLAIN, () => { for (const y of [-0.9, 0.9]) m.lathe([[0.16, 0], [0.16, 0.06]], 8, BLACK, 0, [-3.86, y, 1.35], 'x'); });   // exhausts
      hatch(m, 2.35, 0, 1.63, 0.4);
      m.withMat(MAT.GLASS, () => { for (const y of [-0.25, 0, 0.25]) m.box(2.78, y, 1.6, 0.06, 0.18, 0.07, GLASS); });   // driver's periscopes
      m.withMat(MAT.EMIT, () => { for (const y of [-1.45, 1.45]) m.box(3.6, y, 1.36, 0.05, 0.2, 0.1, [0.75, 0.72, 0.6]); });
      for (const y of [-1.0, 1.0]) m.withMat(MAT.IRON, () => { m.tube([3.7, y - 0.12, 1.1], [3.86, y, 1.0], 0.03, 0.03, 5, STEEL); m.tube([3.86, y, 1.0], [3.7, y + 0.12, 1.1], 0.03, 0.03, 5, STEEL); });   // tow shackles
      m.mirror(() => {
        // track: a belt round the running gear, with cleats along the top and front
        m.withMat(MAT.IRON, () => {
          m.extrudeY([[-3.88, 0.6], [-3.62, 1.02], [3.55, 1.02], [3.98, 0.7], [3.45, 0.03], [-3.35, 0.03]], 1.27, 1.9, RUBBER);
          for (let k = 0; k < 24; k++) m.box(-3.5 + k * 0.305, 1.585, 1.035, 0.11, 0.62, 0.035, [0.14, 0.14, 0.13]);
          for (let k = 0; k < 3; k++) m.box(3.68 + k * 0.1, 1.585, 0.93 - k * 0.13, 0.1, 0.62, 0.05, [0.14, 0.14, 0.13]);
        });
        for (let k = 0; k < 7; k++) wheel(m, -2.72 + k * 0.92, 1.6, 0.39, 0.36, 0.5, [0.1, 0.1, 0.09], GD, 10);
        wheel(m, -3.42, 1.6, 0.66, 0.33, 0.46, STEEL, GD, 10); wheel(m, 3.5, 1.6, 0.66, 0.3, 0.46, [0.1, 0.1, 0.09], GD, 10);
        // side skirts in panels, mudguards front and rear
        for (let k = 0; k < 6; k++) m.cbox(-3.02 + k * 1.15, 1.93, 0.92 - (k === 5 ? 0.06 : 0), 1.1, 0.06, k === 5 ? 0.5 : 0.62, 0.02, k % 2 ? G : GL);
        m.cbox(3.72, 1.6, 1.22, 0.5, 0.7, 0.05, 0.02, GD); m.cbox(-3.7, 1.6, 1.22, 0.4, 0.7, 0.05, 0.02, GD);
        m.cbox(-1.2, 1.55, 1.82, 1.5, 0.5, 0.2, 0.03, GD);                                              // stowage bin
      });
    },
  },
  tankTurret: {
    build: (m) => {
      m.mat = MAT.PAINT;
      // a wide, low shell with wedge-shaped cheeks and a long bustle
      const plan = [[2.25, 0.52], [1.55, 1.3], [-1.3, 1.42], [-2.75, 1.15], [-2.75, -1.15], [-1.3, -1.42], [1.55, -1.3], [2.25, -0.52]];
      m.extrudeZ(plan, 1.72, 2.4, G, 0, 0.9, -0.05);
      m.extrudeZ(plan.map(([x, y]) => [x * 0.86 - 0.1, y * 0.86]), 2.4, 2.47, GL);
      m.withMat(MAT.IRON, () => { for (const y of [-1.2, 1.2]) for (let k = 0; k < 4; k++) m.box(-2.55 + k * 0.35, y, 2.0, 0.04, 0.04, 0.5, STEEL); for (const z of [1.8, 2.22]) for (const y of [-1.2, 1.2]) m.box(-2.0, y, z, 1.2, 0.035, 0.035, STEEL); m.box(-2.82, 0, 2.0, 0.035, 2.4, 0.035, STEEL); });   // bustle rack
      m.cbox(-2.1, 0, 2.0, 1.0, 1.9, 0.4, 0.04, dim(GD, 1.1));
      // mantlet and gun: barrel with a bore evacuator and muzzle reference collar
      m.cbox(2.3, 0, 2.06, 0.55, 0.9, 0.56, 0.06, GD, A);
      m.lathe([[0.2, 0], [0.16, 0.3], [0.13, 1.75], [0.13, 1.75], [0.19, 1.8], [0.19, 2.5], [0.13, 2.56], [0.115, 4.0], [0.115, 4.0], [0.14, 4.02], [0.14, 4.2], [0.09, 4.2], [0.09, 4.2], [0, 4.1, [0.02, 0.02, 0.02]]], 10, [0.2, 0.22, 0.16], A, [2.45, 0, 2.06], 'x', { capA: false });
      m.box(2.45, 0.42, 2.14, 0.5, 0.1, 0.1, BLACK, A);                                                 // coaxial gun
      // commander's cupola with a machine gun, loader's hatch, sight housings
      m.lathe([[0.42, 0], [0.42, 0.22], [0.34, 0.26], [0.34, 0.26], [0, 0.26, GD]], 10, GD, 0, [-0.25, 0.62, 2.45]);
      m.withMat(MAT.GLASS, () => { for (let k = 0; k < 6; k++) { const a = k * 1.047; m.box(-0.25 + Math.cos(a) * 0.4, 0.62 + Math.sin(a) * 0.4, 2.6, 0.07, 0.07, 0.07, GLASS); } });
      m.withMat(MAT.IRON, () => { m.tube([-0.25, 0.62, 2.7], [-0.25, 0.62, 2.9], 0.03, 0.03, 5, BLACK); m.box(0.1, 0.62, 2.93, 1.1, 0.07, 0.09, BLACK); m.box(-0.2, 0.74, 2.9, 0.22, 0.14, 0.16, [0.25, 0.28, 0.18]); });
      hatch(m, -0.2, -0.62, 2.46, 0.36);
      m.cbox(1.1, -0.75, 2.58, 0.5, 0.42, 0.3, 0.04, GD); m.withMat(MAT.GLASS, () => m.box(1.36, -0.75, 2.6, 0.02, 0.3, 0.18, GLASS));   // gunner's sight
      m.cbox(0.9, 0.55, 2.54, 0.3, 0.3, 0.2, 0.03, GD);
      // smoke dischargers, aerials, wind sensor
      m.withMat(MAT.IRON, () => { for (const s of [-1, 1]) for (let k = 0; k < 6; k++) m.tube([0.9 + (k % 3) * 0.16, s * 1.36, 2.02 + (k > 2 ? 0.14 : 0)], [1.02 + (k % 3) * 0.16, s * 1.5, 2.12 + (k > 2 ? 0.14 : 0)], 0.045, 0.045, 5, BLACK); });
      antenna(m, -2.3, 0.9, 2.42, 2.2); antenna(m, -2.3, -0.9, 2.42, 1.6);
      m.withMat(MAT.IRON, () => m.tube([-1.6, 0, 2.47], [-1.6, 0, 2.9], 0.02, 0.02, 4, BLACK));
    },
  },
  ifv: {
    build: (m) => {
      m.mat = MAT.PAINT;
      // boat-shaped lower hull, upper hull with a sharp nose and sloped sides
      m.extrudeY([[-3.3, 0.55], [2.5, 0.55], [3.45, 1.1], [3.3, 1.3], [-3.3, 1.3]], -1.05, 1.05, GD);
      const sec = (x0, x1, top) => m.prism([[x0, -1.45, 1.25], [x0, 1.45, 1.25], [x0, 1.3, top], [x0, -1.3, top]], [[x1, -1.45, 1.25], [x1, 1.45, 1.25], [x1, 1.3, top], [x1, -1.3, top]], G);
      sec(-3.3, 2.0, 1.98);
      m.prism([[2.0, -1.45, 1.25], [2.0, 1.45, 1.25], [2.0, 1.3, 1.98], [2.0, -1.3, 1.98]], [[3.5, -1.2, 1.22], [3.5, 1.2, 1.22], [3.3, 1.1, 1.4], [3.3, -1.1, 1.4]], G);
      m.box(-0.4, 0, 2.0, 5.0, 2.3, 0.05, GL);
      hatch(m, 2.2, 0.6, 1.9, 0.34); hatch(m, -2.0, 0.55, 2.02, 0.36); hatch(m, -2.0, -0.55, 2.02, 0.36);
      m.withMat(MAT.PLAIN, () => { for (let k = 0; k < 5; k++) m.box(1.3 + k * 0.14, -0.7, 2.03, 0.07, 0.8, 0.03, BLACK); m.lathe([[0.09, 0], [0.09, 0.5]], 6, BLACK, 0, [0.9, -1.38, 1.7], 'x'); });   // engine grille, exhaust
      m.withMat(MAT.EMIT, () => { for (const y of [-1.0, 1.0]) m.box(3.42, y, 1.3, 0.05, 0.22, 0.12, [0.75, 0.72, 0.6]); });
      m.cbox(3.35, 0, 1.0, 0.1, 1.9, 0.5, 0.03, GD);                                                     // trim vane
      m.withMat(MAT.PLAIN, () => { m.box(-3.31, 0, 1.4, 0.03, 1.5, 1.0, dim(GD, 0.8)); m.box(-3.33, 0, 1.4, 0.02, 0.05, 1.0, BLACK); });   // rear ramp
      m.mirror(() => {
        for (const x of [-2.4, -0.85, 0.75, 2.3]) { wheel(m, x, 1.3, 0.56, 0.56, 0.4, RUBBER, GD, 12); m.cbox(x, 1.33, 1.2, 1.3, 0.45, 0.06, 0.02, GD); }
        for (let k = 0; k < 3; k++) m.cbox(-2.0 + k * 1.3, 1.48, 1.62, 1.1, 0.14, 0.5, 0.03, k % 2 ? G : GL);   // stowage along the sides
        m.withMat(MAT.GLASS, () => m.box(2.1, 0.9, 2.02, 0.2, 0.16, 0.08, GLASS));
      });
      antenna(m, -3.0, 1.1, 2.0, 2.0);
    },
  },
  ifvTurret: {
    build: (m) => {
      m.mat = MAT.PAINT;
      const plan = [[1.25, 0.4], [0.8, 0.9], [-0.9, 0.92], [-1.15, 0.6], [-1.15, -0.6], [-0.9, -0.92], [0.8, -0.9], [1.25, -0.4]];
      m.extrudeZ(plan, 2.02, 2.58, G, 0, 0.88);
      m.cbox(1.25, 0, 2.3, 0.4, 0.5, 0.36, 0.04, GD, A);
      m.lathe([[0.085, 0], [0.085, 0.5], [0.05, 0.55], [0.05, 2.1], [0.05, 2.1], [0.075, 2.12], [0.075, 2.35], [0.03, 2.35], [0.03, 2.35], [0, 2.3, [0.02, 0.02, 0.02]]], 8, [0.16, 0.17, 0.14], A, [1.35, 0, 2.32], 'x', { capA: false });
      m.box(1.5, 0.22, 2.36, 0.5, 0.07, 0.07, BLACK, A);
      hatch(m, -0.35, 0.42, 2.58, 0.3); hatch(m, -0.35, -0.42, 2.58, 0.3);
      m.cbox(0.45, -0.5, 2.7, 0.4, 0.34, 0.24, 0.03, GD); m.withMat(MAT.GLASS, () => m.box(0.66, -0.5, 2.71, 0.02, 0.24, 0.14, GLASS));
      m.cbox(-0.2, 1.02, 2.3, 0.9, 0.24, 0.34, 0.04, GD);                                               // missile box
      m.withMat(MAT.IRON, () => { for (const s of [-1, 1]) for (let k = 0; k < 4; k++) m.tube([0.5 + k * 0.13, s * 0.9, 2.22], [0.6 + k * 0.13, s * 1.02, 2.32], 0.04, 0.04, 5, BLACK); });
      antenna(m, -1.0, -0.5, 2.58, 1.8);
    },
  },
  howitzer: {
    build: (m) => {
      m.mat = MAT.PAINT;
      // carriage: axle and wheels, split trails with spades, cradle and trunnions
      m.mirror(() => {
        wheel(m, 0, 1.05, 0.6, 0.6, 0.34, RUBBER, GD, 12);
        m.path([[-0.2, 0.45, 0.62], [-2.4, 1.0, 0.36], [-4.3, 1.5, 0.2]], [0.13, 0.12, 0.1], 6, G);
        m.cbox(-4.4, 1.52, 0.2, 0.12, 0.6, 0.4, 0.03, GD);                                              // spade
        m.cbox(0.05, 0.42, 1.2, 0.5, 0.12, 0.9, 0.03, GD);                                              // trunnion cheek
        m.cbox(0.35, 0.62, 1.5, 0.08, 0.7, 1.0, 0.02, GL);                                              // shield half
      });
      m.tube([0, -1.05, 0.6], [0, 1.05, 0.6], 0.1, 0.1, 6, GD);
      m.cbox(-0.2, 0, 0.9, 0.9, 0.7, 0.3, 0.04, GD);
      // the piece, laid at a modest elevation: breech, recuperator, barrel and muzzle brake
      m.push().translate(-0.5, 0, 1.3).rotY(-0.235);
      m.cbox(-0.2, 0, 0, 0.6, 0.42, 0.44, 0.05, GD, A);
      m.lathe([[0.2, 0], [0.17, 0.5], [0.13, 2.2], [0.11, 4.6], [0.11, 4.6], [0.2, 4.62], [0.2, 4.72], [0.16, 4.74], [0.16, 4.92], [0.2, 4.94], [0.2, 5.06], [0.08, 5.06], [0.08, 5.06], [0, 5.0, [0.02, 0.02, 0.02]]], 10, [0.25, 0.27, 0.18], A, [0, 0, 0], 'x', { capA: false });
      for (const z of [0.24, -0.24]) m.tube([0.1, 0, z], [1.9, 0, z], 0.075, 0.075, 6, G, A);
      m.pop();
      // ready rounds and the gun detachment
      m.withMat(MAT.IRON, () => { for (let k = 0; k < 5; k++) m.lathe([[0.075, 0], [0.075, 0.55], [0.03, 0.75], [0, 0.78]], 6, [0.42, 0.4, 0.2], 0, [-1.6 - (k % 3) * 0.2, -1.5 + (k > 2 ? 0.2 : 0), 0]); });
      crateBox(m, -2.4, -1.9, 0, 1.1, 0.5, 0.35, C.crate, 0.3);
      kneeler(m, -1.4, 0.75, -0.5); kneeler(m, -1.9, -0.85, 0.7, { pose: { handL: [0.45, 0.2, 0.6] } });
    },
  },
  mortar: {
    build: (m) => {
      m.mat = MAT.PAINT;
      m.lathe([[0.46, 0], [0.46, 0.05], [0.3, 0.09], [0, 0.09]], 10, GD, 0, [0.5, 0, 0]);                 // baseplate
      m.withMat(MAT.IRON, () => {
        m.push().translate(0.5, 0, 0.08).rotY(-1.14);
        m.lathe([[0.075, 0], [0.065, 0.1], [0.06, 1.3], [0.06, 1.3], [0.07, 1.32], [0.07, 1.38], [0.045, 1.38], [0.045, 1.38], [0, 1.3, [0.02, 0.02, 0.02]]], 8, STEEL, A, [0, 0, 0], 'x', { capA: false });
        m.pop();
        for (const s of [-1, 1]) m.tube([0.98, 0, 1.08], [1.25, s * 0.42, 0], 0.022, 0.022, 5, BLACK);    // bipod
        m.box(0.95, 0, 1.0, 0.12, 0.2, 0.08, BLACK);
      });
      crateBox(m, -0.35, 0.55, 0, 0.6, 0.34, 0.3, C.crate, 0.2);
      m.withMat(MAT.IRON, () => { for (let k = 0; k < 3; k++) m.lathe([[0.04, 0], [0.04, 0.22], [0.015, 0.34], [0, 0.35]], 6, [0.3, 0.33, 0.2], 0, [-0.3 + k * 0.11, 0.2, 0]); });
      kneeler(m, -0.45, -0.3, 0.25);
    },
  },
  cache: {
    build: (m) => {
      // a stack of ammunition boxes under a camouflage net, with a marker
      crateBox(m, -0.8, 0.5, 0, 1.5, 1.1, 0.9, C.crate, 0.05); crateBox(m, 0.8, 0.4, 0, 1.4, 1.2, 0.8, [0.38, 0.4, 0.26], -0.08);
      crateBox(m, -0.5, -0.8, 0, 1.6, 1.0, 0.8, [0.4, 0.38, 0.24], 0.12); crateBox(m, 0.9, -0.8, 0, 1.2, 1.0, 0.7, C.crate);
      crateBox(m, 0, 0, 0.85, 1.5, 1.2, 0.7, [0.47, 0.45, 0.28], 0.2);
      m.withMat(MAT.IRON, () => { for (let k = 0; k < 4; k++) m.lathe([[0.09, 0], [0.09, 0.6], [0.04, 0.82], [0, 0.85]], 6, [0.42, 0.4, 0.2], 0, [1.75, -0.3 + k * 0.22, 0]); });
      m.withMat(MAT.CAMO, () => {
        const p = [[-1.9, -1.7, 0.05], [1.9, -1.7, 0.05], [1.9, 1.6, 0.05], [-1.9, 1.6, 0.05]], t = [0, 0, 1.75];
        for (let k = 0; k < 4; k++) { const a = p[k], b = p[(k + 1) % 4], mid = [(a[0] + b[0]) / 2 * 0.8, (a[1] + b[1]) / 2 * 0.8, 1.2]; m.tri(a, mid, t, [0.24, 0.3, 0.17]); m.tri(mid, b, t, [0.2, 0.26, 0.15]); m.tri(t, mid, a, [0.2, 0.25, 0.14]); m.tri(t, b, mid, [0.18, 0.22, 0.13]); }
      });
      m.withMat(MAT.IRON, () => { for (const [x, y] of [[-1.9, -1.7], [1.9, -1.7], [1.9, 1.6], [-1.9, 1.6]]) m.tube([x, y, 0], [x, y, 0.3], 0.03, 0.03, 4, BLACK); });
      m.withMat(MAT.EMIT, () => m.box(0.3, 0.2, 1.62, 0.5, 0.03, 0.3, dim(C.amber, 0.9)));
    },
  },
  crate: {
    build: (m) => { crateBox(m, 0, 0, 0, 1.8, 1.4, 1.2, C.crate); m.withMat(MAT.CLOTH, () => { for (const x of [-0.5, 0.5]) m.box(x, 0, 0.6, 0.08, 1.44, 1.24, [0.2, 0.24, 0.15]); }); m.withMat(MAT.EMIT, () => m.box(0, 0, 1.22, 0.6, 0.5, 0.03, dim(C.amber, 0.8))); },
  },
};
