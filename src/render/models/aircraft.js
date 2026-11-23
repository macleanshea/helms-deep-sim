// Air support: strike jet, gunship, transport helicopter, cargo aircraft and the resupply parachute.
// Rotors are parts ROTOR (about the mast) and TAIL_ROTOR (about its hub) and spin in the shader.

import { PART, ringX } from '../mesh.js';
import { MAT } from '../materials.js';
import { dim } from './figure.js';
import { C } from './legacy.js';

const J = C.jet, JD = dim(C.jet, 0.72), G = C.veh, GD = C.vehDk, GLASS = [0.1, 0.17, 0.22], BLACK = [0.06, 0.06, 0.06];

/** A store on a pylon: bomb or missile, drawn along +x. */
function store(m, x, y, z, L, r, col, fins = true) {
  m.withMat(MAT.PAINT, () => m.lathe([[0, 0], [r, L * 0.18], [r, L * 0.75], [r * 0.5, L]], 6, col, 0, [x - L / 2, y, z], 'x'));
  if (fins) m.withMat(MAT.PAINT, () => { m.box(x + L * 0.42, y, z, L * 0.16, r * 3.4, 0.02, GD); m.box(x + L * 0.42, y, z, L * 0.16, 0.02, r * 3.4, GD); });
}
/** Four-bladed rotor with a hub, as part `part`, centred at (x, y, z) in the horizontal plane. */
function rotor(m, x, z, R, chord, part = PART.ROTOR) {
  m.withMat(MAT.IRON, () => {
    m.box(x, 0, z, R * 2, chord, 0.05, BLACK, part); m.box(x, 0, z, chord, R * 2, 0.05, BLACK, part);
    m.lathe([[chord * 0.9, -0.1], [chord * 0.9, 0.08], [0, 0.14]], 8, [0.2, 0.2, 0.2], part, [x, 0, z]);
  });
}

export const aircraft = {
  jet: {
    build: (m) => {
      m.mat = MAT.PAINT;
      m.loft([ringX(8.4, 0, -0.12, 0, 0), ringX(7.7, 0, -0.1, 0.2, 0.18), ringX(6.3, 0, -0.04, 0.44, 0.42), ringX(4.6, 0, 0, 0.62, 0.62), ringX(2.8, 0, 0, 0.82, 0.7), ringX(0.5, 0, -0.05, 1.0, 0.66),
        ringX(-2.4, 0, -0.05, 0.95, 0.62), ringX(-4.6, 0, 0, 0.74, 0.56), ringX(-5.7, 0, 0, 0.56, 0.5)], 10, J);
      m.withMat(MAT.IRON, () => m.lathe([[0.56, 0], [0.5, -0.5], [0.42, -0.9], [0.42, -0.9], [0.3, -0.5, BLACK], [0, -0.4, [0.9, 0.5, 0.2]]], 10, [0.22, 0.22, 0.24], 0, [-5.7, 0, 0], 'x', { capA: false }));
      m.withMat(MAT.GLASS, () => m.loft([ringX(5.5, 0, 0.42, 0.06, 0.04), ringX(4.6, 0, 0.6, 0.3, 0.3), ringX(3.5, 0, 0.66, 0.33, 0.32), ringX(2.3, 0, 0.58, 0.2, 0.14)], 8, GLASS));
      m.mirror(() => {
        m.extrudeZ([[1.6, 0.7], [-1.3, 4.9], [-2.7, 4.9], [-3.1, 0.7]], -0.1, 0.03, J);                    // wing
        m.extrudeZ([[-4.3, 0.55], [-5.6, 2.7], [-6.4, 2.7], [-6.1, 0.55]], -0.04, 0.04, J);                // tailplane
        m.push().translate(0, 0.55, 0).rotX(-0.3); m.extrudeY([[-3.5, 0.3], [-5.7, 2.9], [-6.5, 2.9], [-6.0, 0.3]], -0.05, 0.05, JD); m.pop();   // canted fin
        m.withMat(MAT.PLAIN, () => m.box(2.3, 0.95, -0.2, 1.4, 0.5, 0.6, BLACK));                          // intake
        m.cbox(1.5, 0.95, -0.2, 2.6, 0.56, 0.66, 0.08, JD);
        for (const y of [2.5, 3.8]) { m.box(-0.9, y, -0.24, 1.4, 0.08, 0.26, JD); store(m, -0.7, y, -0.5, 2.6, 0.17, [0.25, 0.28, 0.22]); }
        store(m, -1.9, 4.98, -0.04, 2.4, 0.07, [0.85, 0.85, 0.82]);
      });
    },
  },
  helo: {
    // -, -, -, -, -, -, main rotor x, tail rotor x and z
    anim: [0, 0, 0, 0, 0, 0, 0.4, -7.6, 1.5],
    build: (m) => {
      m.mat = MAT.PAINT;
      m.loft([ringX(4.0, 0, -0.35, 0.1, 0.1), ringX(3.3, 0, -0.2, 0.4, 0.45), ringX(2.2, 0, 0, 0.56, 0.78), ringX(0.8, 0, 0.05, 0.66, 0.95), ringX(-0.8, 0, 0.05, 0.66, 0.9), ringX(-2.2, 0, 0.2, 0.46, 0.58), ringX(-2.9, 0, 0.3, 0.3, 0.34)], 8, G);
      m.path([[-2.7, 0, 0.32], [-5.4, 0, 0.55], [-7.6, 0, 0.75]], [0.3, 0.2, 0.13], 6, G);
      m.extrudeY([[-6.6, 0.7], [-7.5, 2.3], [-8.1, 2.3], [-7.8, 0.7]], -0.07, 0.07, GD);                    // fin
      m.box(-7.3, 0, 0.95, 0.7, 2.2, 0.06, GD);                                                           // stabiliser
      m.withMat(MAT.GLASS, () => {                                                                         // tandem canopy
        m.loft([ringX(3.5, 0, 0.2, 0.1, 0.06), ringX(2.9, 0, 0.5, 0.36, 0.34), ringX(2.2, 0, 0.72, 0.42, 0.36), ringX(1.5, 0, 0.98, 0.46, 0.34), ringX(0.9, 0, 0.98, 0.3, 0.16)], 6, GLASS);
      });
      m.mirror(() => {
        m.lathe([[0.2, 0.9], [0.34, 0.6], [0.36, -1.0], [0.26, -1.5], [0.26, -1.5], [0.14, -1.4, BLACK]], 8, GD, 0, [0, 0.86, 0.72], 'x');   // engine
        m.cbox(0.4, 1.6, -0.15, 1.2, 1.9, 0.14, 0.04, GD);                                               // stub wing
        m.withMat(MAT.IRON, () => { m.lathe([[0.24, -0.9], [0.24, 0.9], [0.24, 0.9], [0.16, 0.86, BLACK]], 8, [0.16, 0.17, 0.14], 0, [0.5, 1.5, -0.45], 'x'); });   // rocket pod
        for (const y of [2.2, 2.45]) store(m, 0.6, y, -0.4, 1.6, 0.08, [0.2, 0.22, 0.18], false);
        m.withMat(MAT.IRON, () => { m.tube([1.6, 0.6, -0.5], [1.7, 0.95, -1.15], 0.05, 0.05, 5, BLACK); m.lathe([[0.26, -0.1], [0.26, 0.1]], 8, BLACK, 0, [1.7, 1.0, -1.2], 'y'); });   // main gear
      });
      m.withMat(MAT.IRON, () => { m.tube([3.2, 0, -0.6], [3.4, 0, -0.85], 0.12, 0.1, 6, BLACK); m.tube([3.3, 0, -0.85], [4.6, 0, -0.9], 0.045, 0.045, 5, BLACK); m.tube([0.4, 0, 0.95], [0.4, 0, 1.36], 0.2, 0.14, 6, BLACK); m.lathe([[0.2, -0.1], [0.2, 0.1]], 6, BLACK, 0, [-6.9, 0, 0.35], 'y'); });
      rotor(m, 0.4, 1.4, 7.2, 0.4);
      m.withMat(MAT.IRON, () => { m.box(-7.6, 0.2, 1.5, 2.6, 0.04, 0.2, BLACK, PART.TAIL_ROTOR); m.box(-7.6, 0.2, 1.5, 0.2, 0.04, 2.6, BLACK, PART.TAIL_ROTOR); });
    },
  },
  transport: {
    anim: [0, 0, 0, 0, 0, 0, 0.2, -9.6, 2.3],
    build: (m) => {
      m.mat = MAT.PAINT;
      // a deep cabin with a glazed nose, engines on the roof and an upswept tail
      m.loft([ringX(6.1, 0, -0.5, 0.3, 0.3), ringX(5.3, 0, -0.2, 0.95, 0.95), ringX(4.0, 0, 0.05, 1.25, 1.3), ringX(0.5, 0, 0.05, 1.3, 1.35), ringX(-3.0, 0, 0.1, 1.2, 1.25), ringX(-4.4, 0, 0.5, 0.7, 0.75), ringX(-5.0, 0, 0.75, 0.42, 0.42)], 8, G);
      m.path([[-4.8, 0, 0.75], [-7.4, 0, 1.05], [-9.5, 0, 1.3]], [0.44, 0.3, 0.2], 6, G);
      m.extrudeY([[-8.5, 1.2], [-9.4, 3.3], [-10.1, 3.3], [-9.9, 1.2]], -0.09, 0.09, GD);
      m.box(-9.2, 0, 1.5, 0.9, 3.4, 0.08, GD);
      m.withMat(MAT.GLASS, () => m.loft([ringX(5.9, 0, 0.05, 0.3, 0.2), ringX(5.2, 0, 0.5, 0.8, 0.5), ringX(4.3, 0, 0.75, 0.95, 0.5), ringX(3.7, 0, 0.9, 0.7, 0.3)], 6, GLASS));
      m.mirror(() => {
        m.withMat(MAT.PLAIN, () => m.box(0.6, 1.3, 0.05, 2.4, 0.06, 1.5, BLACK));                           // open cabin door
        m.cbox(-1.0, 1.36, 0.05, 0.9, 0.08, 1.5, 0.02, GD);                                               // the door slid back
        m.lathe([[0.3, 1.0], [0.42, 0.7], [0.44, -1.2], [0.3, -1.6], [0.3, -1.6], [0.18, -1.5, BLACK]], 8, GD, 0, [0.2, 0.72, 1.62], 'x');
        m.withMat(MAT.IRON, () => { m.tube([2.4, 1.0, -1.1], [2.5, 1.5, -1.75], 0.06, 0.06, 5, BLACK); m.lathe([[0.32, -0.12], [0.32, 0.12]], 8, BLACK, 0, [2.5, 1.55, -1.8], 'y'); });
      });
      m.withMat(MAT.IRON, () => { m.tube([0.2, 0, 1.6], [0.2, 0, 2.16], 0.26, 0.18, 6, BLACK); m.lathe([[0.22, -0.1], [0.22, 0.1]], 6, BLACK, 0, [-8.4, 0, 0.75], 'y'); });
      rotor(m, 0.2, 2.2, 9.3, 0.5);
      m.withMat(MAT.IRON, () => { m.box(-9.6, 0.3, 2.3, 3.4, 0.05, 0.26, BLACK, PART.TAIL_ROTOR); m.box(-9.6, 0.3, 2.3, 0.26, 0.05, 3.4, BLACK, PART.TAIL_ROTOR); });
    },
  },
  cargo: {
    build: (m) => {
      m.mat = MAT.PAINT;
      m.loft([ringX(16.6, 0, -0.9, 0, 0), ringX(15.6, 0, -0.75, 0.9, 0.8), ringX(13.8, 0, -0.2, 1.75, 1.7), ringX(11, 0, 0, 2.05, 2.05), ringX(-5, 0, 0, 2.05, 2.05), ringX(-10, 0, 0.6, 1.6, 1.5), ringX(-15, 0, 1.7, 0.8, 0.8), ringX(-17.6, 0, 2.3, 0.3, 0.3)], 10, J);
      m.withMat(MAT.GLASS, () => m.loft([ringX(15.4, 0, 0.0, 0.6, 0.2), ringX(14.4, 0, 0.75, 1.3, 0.5), ringX(13.2, 0, 1.2, 1.4, 0.4)], 6, GLASS));
      m.withMat(MAT.PLAIN, () => m.box(-9.5, 0, -0.75, 6.0, 2.6, 0.1, BLACK));                             // the ramp, open for the drop
      m.mirror(() => {
        m.extrudeZ([[4.2, 0], [3.4, 19], [1.2, 19], [-1.0, 0]], 1.85, 2.3, J, 0, 0.92);                    // high wing
        for (const y of [5.5, 11]) {
          m.lathe([[0, 2.9], [0.45, 2.5], [0.7, 1.4], [0.7, -1.6], [0.4, -2.4]], 8, JD, 0, [3.0, y, 1.45], 'x');
          m.withMat(MAT.IRON, () => { m.lathe([[0.16, 0], [0, 0.5]], 6, BLACK, 0, [5.9, y, 1.45], 'x', { capA: false }); for (let k = 0; k < 4; k++) { m.push().translate(5.75, y, 1.45).rotX(k * 0.785 + 0.3); m.box(0, 0, 0, 0.08, 4.1, 0.3, BLACK); m.pop(); if (k === 1) break; } });
        }
        m.extrudeZ([[-14.6, 0], [-16.2, 6.2], [-17.6, 6.2], [-17.8, 0]], 2.5, 2.75, J);                    // tailplane
        m.cbox(1.0, 2.3, -1.5, 5.0, 0.9, 1.0, 0.2, JD);                                                   // undercarriage fairing
      });
      m.extrudeY([[-12.8, 2.0], [-16.4, 8.2], [-18.2, 8.2], [-18.0, 2.2]], -0.16, 0.16, J);                 // fin
    },
  },
  chute: {
    build: (m) => {
      // a ribbed canopy in alternating gores, shroud lines, and the crate slung beneath
      const n = 12, r1 = 2.6, r2 = 4.5, zt = 11.7, z1 = 10.9, z2 = 9.2;
      m.mat = MAT.CLOTH;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * 6.2832, a1 = ((k + 1) / n) * 6.2832, col = k & 1 ? C.chute : C.olive, in_ = dim(col, 0.62);
        const P = (a, r, z) => [Math.cos(a) * r, Math.sin(a) * r, z], am = (a0 + a1) / 2;
        const t = [0, 0, zt], a = P(a0, r1, z1), b = P(a1, r1, z1), c = P(a1, r2, z2), d = P(a0, r2, z2), e = P(am, r2 * 1.04, z2 - 0.35);   // the hem billows between the lines
        m.tri(t, a, b, col); m.quad(a, d, c, b, col); m.tri(d, e, c, col);
        m.tri(t, b, a, in_); m.quad(a, b, c, d, in_); m.tri(d, c, e, in_);
        m.withMat(MAT.PLAIN, () => m.tube(d, [0.5 * Math.cos(a0), 0.4 * Math.sin(a0), 1.35], 0.02, 0.02, 3, [0.75, 0.75, 0.7]));
      }
      m.withMat(MAT.TIMBER, () => m.box(0, 0, 0.6, 1.8, 1.4, 1.2, C.crate));
      m.withMat(MAT.CLOTH, () => { for (const x of [-0.5, 0.5]) m.box(x, 0, 0.6, 0.1, 1.44, 1.24, [0.2, 0.24, 0.15]); m.box(0, 0, 0.6, 1.84, 0.1, 1.24, [0.2, 0.24, 0.15]); });
    },
  },
};
