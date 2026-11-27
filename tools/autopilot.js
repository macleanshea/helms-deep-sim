// Stand-ins for a player in headless runs. They give orders through the sim's public order API,
// and read its attacker density grid (ocCount) and danger-close map to choose targets.
//
//   auto    a reasonably careful commander: keeps the line in ammunition, spends on siege engines
//           before they reach the wall, shells the thickest of the press, holds a reserve for resupply
//   dump    the old crude one: whatever is available goes on the densest cell
import { UNITS, U, DEF, SUPPORT } from '../src/config.js';
import { LAYOUT } from '../src/layout.js';
import { LOSS_CELL as OCS, LOSS_W as OW, LOSS_H as OH } from '../src/sim/sim.js'; // the sim's coarse attacker grid

export function autopilot(sim, policy = 'auto') {
  const calls = {};
  const call = (kind, x, y, x2, y2) => { if (!sim.callSupport(kind, x, y, x2, y2)) return false; calls[kind] = (calls[kind] || 0) + 1; return true; };
  const cellXY = (c) => ({ x: (c % OW) * OCS + 8, y: ((c / OW) | 0) * OCS + 8 });

  /** Centre of the densest attacker cell that is not danger-close, or null. */
  function densest(min) {
    let best = -1, bc = min;
    for (let c = 0; c < sim.ocCount.length; c++) if (sim.ocCount[c] > bc && !sim.danger[c]) { bc = sim.ocCount[c]; best = c; }
    return best < 0 ? null : { ...cellXY(best), n: bc };
  }
  /** Densest 3x3 block of attacker cells (48 m square) that is clear of friendly troops. */
  function densestBlock() {
    const oc = sim.ocCount, dg = sim.danger;
    let best = -1, bn = 0;
    for (let y = 1; y < OH - 1; y++) for (let x = 1; x < OW - 1; x++) {
      const c = y * OW + x;
      if (dg[c] || !oc[c]) continue;
      const n = oc[c - OW - 1] + oc[c - OW] + oc[c - OW + 1] + oc[c - 1] + oc[c] + oc[c + 1] + oc[c + OW - 1] + oc[c + OW] + oc[c + OW + 1];
      if (n > bn) { bn = n; best = c; }
    }
    return best < 0 ? null : { ...cellXY(best), n: bn };
  }
  function massNear(x, y, r) {
    let n = 0;
    const x0 = Math.max(0, ((x - r) / OCS) | 0), x1 = Math.min(OW - 1, ((x + r) / OCS) | 0), y0 = Math.max(0, ((y - r) / OCS) | 0), y1 = Math.min(OH - 1, ((y + r) / OCS) | 0);
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) n += sim.ocCount[yy * OW + xx];
    return n;
  }
  /** Largest 60 m knot of defenders at or below `frac` of their ammunition, or null. */
  function dryKnot(min, frac) {
    const cnt = new Map();
    for (let i = 0; i < sim.n; i++) {
      if (!sim.alive[i] || sim.team[i] !== DEF || !UNITS[sim.type[i]].ammo) continue;
      if (frac ? sim.ammo[i] > sim.maxAmmo(i) * frac : sim.ammo[i] >= 1) continue;
      const k = ((sim.y[i] / 60) | 0) * 100 + ((sim.x[i] / 60) | 0);
      cnt.set(k, (cnt.get(k) || 0) + 1);
    }
    let bk = -1, bv = min;
    for (const [k, v] of cnt) if (v >= bv) { bv = v; bk = k; }
    return bk < 0 ? null : { x: (bk % 100) * 60 + 30, y: ((bk / 100) | 0) * 60 + 30, n: bv };
  }
  /** A siege engine or knot of trolls close enough to be worth a strike. */
  function siegeTarget() {
    const gate = sim.segs[sim.map.GATE], wallX = sim.defBox[0];
    let trolls = [];
    for (const i of sim.hvt) {
      if (!sim.alive[i]) continue;
      const t = sim.type[i], x = sim.x[i], y = sim.y[i];
      if (sim.danger[((y / OCS) | 0) * OW + ((x / OCS) | 0)] > 1) continue;
      if (t === U.ram && !gate.breached && Math.hypot(gate.ox - x, gate.oy - y) < 170) return { x: x + sim.vx[i] * 5, y: y + sim.vy[i] * 5 };
      if (t === U.tower && sim.state[i] !== 3 && x > wallX - 190) return { x: x + sim.vx[i] * 5, y: y + sim.vy[i] * 5 };
      if (t === U.troll && x > wallX - 170) trolls.push(i);
    }
    for (const i of trolls) {
      let near = 0;
      for (const j of trolls) if (Math.hypot(sim.x[i] - sim.x[j], sim.y[i] - sim.y[j]) < 40) near++;
      if (near >= 3) return { x: sim.x[i] + sim.vx[i] * 5, y: sim.y[i] + sim.vy[i] * 5 };
    }
    return null;
  }

  let lastSupply = -99, lastSiege = -99;
  function careful() {
    if (sim.tick % 20) return;
    const cpMode = !sim.opt.sandbox;
    // keep a resupply in hand whenever the garrison's pouches are getting light
    const hold = cpMode && sim.ammoLevel() < 0.6 ? SUPPORT.supply.cost : 0;
    const can = (k) => sim.canSupport(k) && (!cpMode || k === 'supply' || sim.cp - SUPPORT[k].cost >= hold);
    if (sim.time - lastSupply > 20 && sim.canSupport('supply')) {
      const d = dryKnot(Math.max(3, Math.round(sim.defCombat * 0.06)), 0.25);
      if (d && call('supply', d.x, d.y)) { lastSupply = sim.time; return; }
    }
    if (sim.time - lastSiege > 12) {
      const s = siegeTarget();
      if (s) { for (const k of ['air', 'gunship']) if (can(k) && call(k, s.x, s.y)) { lastSiege = sim.time; return; } }
    }
    if (sim.defCombat < sim.initial[0] * 0.55 && can('reinforce') && call('reinforce', LAYOUT.posts.court[0], LAYOUT.posts.court[1])) return;
    const b = densestBlock();
    if (!b) return;
    const thresh = Math.max(60, sim.onField() * 0.03);
    if (b.n < thresh) return;
    if (can('gunship') && massNear(b.x, b.y, 150) > thresh * 4 && call('gunship', b.x, b.y)) return;
    if (b.n > thresh * 1.6 && can('air')) call('air', b.x, b.y);
  }

  function dump() {
    if (sim.tick % 50) return;
    const t = densest(40);
    if (t) for (const k of ['air', 'gunship']) if (call(k, t.x, t.y)) break;
    if (sim.ammoLevel() < 0.5) { const d = dryKnot(8, 0); if (d) call('supply', d.x, d.y); }
  }

  if (policy !== 'auto' && policy !== 'dump') throw new Error(`unknown policy "${policy}"`);
  return { step: policy === 'dump' ? dump : careful, calls };
}
