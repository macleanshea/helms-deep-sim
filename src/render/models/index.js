// Every model the renderer can draw, at three levels of detail:
//   full — the detailed model, used when a unit is large enough on screen for it to show
//   mid  — a blocky stand-in of a few dozen triangles (also what casts the unit's shadow)
//   lod  — one or two boxes of the right size and average colour, for the far view
// Model modules export { name: { build, mid?, anim? } }. Anything without a detailed model yet falls
// back to its original blocky definition.

import { MeshBuilder } from '../mesh.js';
import { legacy } from './legacy.js';
import { infantry } from './infantry.js';
import { horde } from './horde.js';
import { vehicles } from './vehicles.js';
import { siege } from './siege.js';
import { aircraft } from './aircraft.js';
import { props } from './props.js';

/**
 * Animation constants: hip height, shoulder pivot x and z, swing (rad) and recoil (m) of the weapon arm,
 * then knee height, main rotor x, elbow (or tail rotor) x and z, and how far fore and aft of the
 * centre a four-legged creature's legs pivot.
 */
const ANIM = {
  default: [0.84, 0.2, 1.3, 0.25, 0.12],
  uruk: [0.84, 0.2, 1.3, 1.5, 0], archer: [0.84, 0.2, 1.3, 0.2, 0.1], berserker: [0.84, 0.2, 1.3, 1.7, 0], chief: [0.84, 0.2, 1.3, 1.6, 0], sapper: [0.84, 0.2, 1.3, 0, 0],
  warg: [0.6, 0.1, 1.4, 1.2, 0, 0, 0, 0, 0, 0.6], troll: [1.5, 0.3, 2.8, 1.5, 0], ladder: [0.84, 0, 0, 0, 0], ladderBare: [0, 0, 0, 0, 0], ram: [0, 0, 0, 0, -1.3], ramBare: [0, 0, 0, 0, -1.3], catapult: [0, 0.8, 1.4, -1.5, 0],
  tower: [0, 2.5, 12.3, -1.5708, 0], tankTurret: [0, 0, 0, 0, 0.5], ifvTurret: [0, 0, 0, 0, 0.18], howitzer: [0, 0, 0, 0, 0.6], mortar: [0, 0, 0, 0, 0.12],
  helo: [0, 0, 0, 0, 0, 0, 0.4, 0, 0], transport: [0, 0, 0, 0, 0, 0, 0.2, 0, 0],
};

const modules = [infantry, horde, vehicles, siege, aircraft, props];

function make(fn) { const m = new MeshBuilder(); fn(m); return m.build(); }

/** Far-view stand-in: one box (two for a standing figure) the size and average colour of the mesh. */
function boxLod(mesh) {
  const b = mesh.bbox, lm = new MeshBuilder(), a = mesh.avg, k = 1.25;
  const bw = Math.min(0.8, Math.max(0.45, (b[3] - b[2]) * 0.7)), tall = b[4] > 1.2 && b[4] < 3.2 && b[1] - b[0] < 3;
  if (tall) { lm.box(0, 0, b[4] * 0.42, bw * 0.7, bw, b[4] * 0.84, [a[0] * k, a[1] * k, a[2] * k]); lm.box(0.02, 0, b[4] * 0.9, bw * 0.55, bw * 0.55, b[4] * 0.2, [a[0] * k * 1.3, a[1] * k * 1.3, a[2] * k * 1.3]); }
  else lm.box((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, b[4] / 2, Math.max(0.5, (b[1] - b[0]) * 0.8), Math.max(0.5, (b[3] - b[2]) * 0.8), Math.max(0.6, b[4]), [a[0] * k, a[1] * k, a[2] * k]);
  return lm.build();
}

/** Build every model. Returns { name: { name, full, mid, lod, anim, bbox, big } }. */
export function buildModels() {
  const hero = Object.assign({}, ...modules);
  const out = {};
  for (const name of new Set([...Object.keys(legacy), ...Object.keys(hero)])) {
    const h = hero[name];
    const full = make(h ? h.build : legacy[name]);
    // the stand-in: an explicit one, else the original blocky model where a detailed one replaced it
    const mid = h && h.mid ? make(h.mid) : h && legacy[name] ? make(legacy[name]) : null;
    const ref = mid || full, b = ref.bbox;
    const anim = (h && h.anim) || ANIM[name] || ANIM.default;
    out[name] = {
      name, full, mid, lod: boxLod(ref), bbox: full.bbox,
      anim: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => anim[k] || 0),
      // large things are never reduced to a box: they stay recognisable from any distance
      big: h && h.big != null ? h.big : b[4] > 3.2 || b[1] - b[0] > 4,
    };
  }
  return out;
}
