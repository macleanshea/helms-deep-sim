// Ordnance in flight, field works and flying debris.

import { MAT } from '../materials.js';
import { dim } from './figure.js';
import { C } from './legacy.js';

const BLACK = [0.07, 0.07, 0.07], STEEL = [0.3, 0.31, 0.33];

export const props = {
  // ---- ordnance, drawn along +x
  shell: { build: (m) => { m.mat = MAT.IRON; m.lathe([[0.15, -0.6], [0.17, -0.5], [0.17, 0.2], [0.08, 0.6], [0, 0.72]], 6, [0.95, 0.85, 0.6], 0, [0, 0, 0], 'x'); m.lathe([[0.18, -0.42], [0.18, -0.34]], 6, [0.8, 0.5, 0.25], 0, [0, 0, 0], 'x', { capA: false, capB: false }); } },
  round: { build: (m) => { m.mat = MAT.EMIT; m.lathe([[0.08, -0.7], [0.08, 0.5], [0, 0.7]], 4, [1, 0.78, 0.4], 0, [0, 0, 0], 'x'); } },
  rocket: {
    build: (m) => {
      m.mat = MAT.PAINT; m.lathe([[0.1, -0.95], [0.14, -0.8], [0.14, 0.55], [0.07, 0.85], [0, 0.95]], 6, [0.82, 0.83, 0.8], 0, [0, 0, 0], 'x');
      for (let k = 0; k < 2; k++) { m.push().rotX(k * 1.5708); m.extrudeY([[-0.95, 0.12], [-0.6, 0.12], [-0.75, 0.4], [-0.95, 0.4]], -0.015, 0.015, STEEL); m.extrudeY([[-0.95, -0.12], [-0.6, -0.12], [-0.75, -0.4], [-0.95, -0.4]], -0.015, 0.015, STEEL); m.pop(); }
      m.mat = MAT.EMIT; m.lathe([[0.09, -0.96], [0, -1.25]], 5, [1, 0.7, 0.3], 0, [0, 0, 0], 'x', { capA: false });
    },
  },
  bombm: {
    build: (m) => {
      m.mat = MAT.PAINT; m.lathe([[0.12, -1.3], [0.33, -0.7], [0.36, 0.3], [0.2, 1.0], [0, 1.3]], 8, [0.24, 0.27, 0.22], 0, [0, 0, 0], 'x');
      m.lathe([[0.37, 0.5], [0.37, 0.62]], 8, [0.75, 0.7, 0.2], 0, [0, 0, 0], 'x', { capA: false, capB: false });
      for (let k = 0; k < 2; k++) { m.push().rotX(k * 1.5708 + 0.785); m.box(-1.25, 0, 0, 0.5, 1.3, 0.04, C.gun); m.pop(); }
      m.lathe([[0.62, -1.5], [0.62, -1.2]], 8, C.gun, 0, [0, 0, 0], 'x', { capA: false, capB: false });
    },
  },
  rockm: { build: (m) => { m.mat = MAT.ROCK; m.sphere([0, 0, 0], [0.95, 0.85, 0.8], C.stone, 0, 7, 5); m.sphere([0.35, 0.3, 0.3], [0.6, 0.55, 0.5], dim(C.stone, 0.85), 0, 5, 3); m.sphere([-0.4, -0.3, -0.2], [0.6, 0.6, 0.55], dim(C.stone, 1.1), 0, 5, 3); } },
  bolt: {
    build: (m) => {
      m.mat = MAT.TIMBER; m.tube([-0.75, 0, 0], [0.6, 0, 0], 0.03, 0.03, 4, [0.16, 0.13, 0.1]);
      m.mat = MAT.IRON; m.lathe([[0.05, 0.6], [0, 0.8]], 4, C.blade, 0, [0, 0, 0], 'x', { capA: false });
      m.mat = MAT.PLAIN; for (let k = 0; k < 2; k++) { m.push().rotX(k * 1.5708); m.box(-0.62, 0, 0, 0.22, 0.14, 0.012, [0.7, 0.66, 0.6]); m.pop(); }
    },
  },
  // ---- field works
  wire: {
    build: (m) => {
      // concertina wire: three coils strung along crossed pickets
      m.mat = MAT.IRON;
      for (const x of [-1.45, 0, 1.45]) { m.tube([x, -0.55, 0], [x, 0.5, 1.15], 0.035, 0.035, 4, C.woodDk); m.tube([x, 0.55, 0], [x, -0.5, 1.15], 0.035, 0.035, 4, C.woodDk); }
      const wc = [0.56, 0.57, 0.6];
      for (const [cy, cz, r, ph] of [[-0.32, 0.36, 0.34, 0], [0.32, 0.36, 0.34, 1.6], [0, 0.82, 0.3, 3.1]]) {
        const pts = [];
        for (let k = 0; k <= 40; k++) { const u = k / 40, a = u * 6.2832 * 4.5 + ph; pts.push([-1.6 + u * 3.2, cy + Math.cos(a) * r, cz + Math.sin(a) * r]); }
        m.path(pts, 0.014, 3, wc, 0, { capA: false, capB: false });
      }
    },
  },
  hedgehog: {
    build: (m) => {
      // three lengths of angle iron crossed and bolted
      m.mat = MAT.IRON;
      const s = [0.24, 0.21, 0.2], L = (a, b) => { m.beam(a, b, 0.2, s, 0, 0.035); m.beam(a, b, 0.035, dim(s, 0.8), 0, 0.2); };
      L([-0.95, -0.95, 0], [0.95, 0.95, 1.5]); L([0.95, -0.95, 0], [-0.95, 0.95, 1.5]); L([0, 1.1, 0.02], [0, -1.1, 1.4]);
      m.cbox(0, 0, 0.75, 0.34, 0.34, 0.34, 0.05, dim(s, 1.3));
    },
  },
  moat: {
    build: (m) => {
      m.mat = MAT.GLASS; m.box(0, 0, 0.1, 4.3, 4.3, 0.1, C.water);
      m.mat = MAT.DIRT;
      for (const [x, y, sx, sy] of [[0, 2.0, 4.5, 0.7], [0, -2.0, 4.5, 0.7], [2.0, 0, 0.7, 4.5], [-2.0, 0, 0.7, 4.5]]) m.prism([[x - sx / 2, y - sy / 2, 0.02], [x + sx / 2, y - sy / 2, 0.02], [x + sx / 2, y + sy / 2, 0.02], [x - sx / 2, y + sy / 2, 0.02]], [[x - sx * 0.42, y - sy * 0.2, 0.42], [x + sx * 0.42, y - sy * 0.2, 0.42], [x + sx * 0.42, y + sy * 0.2, 0.42], [x - sx * 0.42, y + sy * 0.2, 0.42]], C.earth);
    },
  },
  mine: { build: (m) => { m.mat = MAT.PAINT; m.lathe([[0.3, 0], [0.31, 0.07], [0.27, 0.11], [0.12, 0.11], [0.12, 0.11], [0.1, 0.16], [0, 0.16, C.gun]], 10, [0.22, 0.25, 0.16]); } },
  claymore: {
    build: (m) => {
      m.mat = MAT.PAINT;
      for (let k = -2; k <= 2; k++) { m.push().translate(-0.04 * k * k * 0.25, k * 0.084, 0.3).rotZ(k * -0.1); m.box(0, 0, 0, 0.06, 0.09, 0.2, [0.3, 0.36, 0.2]); m.pop(); }
      m.mat = MAT.IRON;
      for (const s of [-1, 1]) { m.tube([0, s * 0.13, 0.2], [0.1, s * 0.2, 0], 0.012, 0.012, 3, C.gun); m.tube([0, s * 0.13, 0.2], [-0.12, s * 0.18, 0], 0.012, 0.012, 3, C.gun); }
    },
  },
  // ---- debris (tinted per piece)
  cube: { build: (m) => { m.mat = MAT.ASHLAR; m.cbox(0, 0, 0, 1, 1, 1, 0.12, [1, 1, 1]); } },
  plank: { build: (m) => { m.mat = MAT.TIMBER; m.box(0, 0, 0, 2.2, 0.3, 0.12, C.wood); } },
};
