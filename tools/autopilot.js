// Stand-in for a player in headless runs. It only uses the sim's public order API.
//
//   auto    drop whatever support is available on the densest attacker cell, resupply dry troops
import { UNITS, DEF } from '../src/config.js';

const OCS = 16, OW = 90;

export function autopilot(sim, policy = 'auto') {
  const calls = {};
  const call = (kind, x, y, x2, y2) => { if (!sim.callSupport(kind, x, y, x2, y2)) return false; calls[kind] = (calls[kind] || 0) + 1; return true; };

  /** Centre of the densest attacker cell that is not danger-close, or null. */
  function densest(min) {
    let best = -1, bc = min;
    for (let c = 0; c < sim.ocCount.length; c++) if (sim.ocCount[c] > bc && !sim.danger[c]) { bc = sim.ocCount[c]; best = c; }
    return best < 0 ? null : { x: (best % OW) * OCS + 8, y: ((best / OW) | 0) * OCS + 8, n: bc };
  }
  /** Largest 60 m knot of defenders that are out of ammunition, or null. */
  function dryKnot(min) {
    const cnt = new Map();
    for (let i = 0; i < sim.n; i++) {
      if (!sim.alive[i] || sim.team[i] !== DEF || !UNITS[sim.type[i]].ammo || sim.ammo[i] >= 1) continue;
      const k = ((sim.y[i] / 60) | 0) * 100 + ((sim.x[i] / 60) | 0);
      cnt.set(k, (cnt.get(k) || 0) + 1);
    }
    let bk = -1, bv = min;
    for (const [k, v] of cnt) if (v > bv) { bv = v; bk = k; }
    return bk < 0 ? null : { x: (bk % 100) * 60 + 30, y: ((bk / 100) | 0) * 60 + 30, n: bv };
  }

  function step() {
    if (sim.tick % 50) return;
    const t = densest(40);
    if (t) for (const k of ['arty', 'air', 'gunship']) if (call(k, t.x, t.y)) break;
    if (sim.ammoLevel() < 0.5) { const d = dryKnot(8); if (d) call('supply', d.x, d.y); }
  }

  if (policy !== 'auto') throw new Error(`unknown policy "${policy}"`);
  return { step, calls };
}
