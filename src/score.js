// Scoring for challenge battles. Pure: used by the end-of-battle report and the headless harness.

import { ORC } from './config.js';

export const MEDALS = [
  { key: 'gold', name: 'Gold', min: 850 },
  { key: 'silver', name: 'Silver', min: 650 },
  { key: 'bronze', name: 'Bronze', min: 0 },
];

/**
 * Score a finished battle.  `req`: { budget, spent } in requisition points (optional).
 * Any win outscores any loss. Returns { total, medal, lines: [[label, points, detail]] }.
 */
export function scoreBattle(sim, req) {
  const r = sim.result, st = sim.stats;
  if (!r) return null;
  const lines = [];
  const add = (label, pts, detail) => { lines.push([label, Math.round(pts), detail]); };
  const dawn = sim.opt.dawn > 0 ? sim.opt.dawn : 1200;
  if (r.win) {
    const all = sim.initial[0] + (st.reinforced || 0);
    const surv = all > 0 ? Math.min(1, sim.defCombat / all) : 0;
    add('Victory', 400, '');
    add('Defenders alive', 300 * surv, `${Math.round(surv * 100)}% of the garrison`);
    const gate = !sim.segs[sim.map.GATE].breached;
    add('Gate intact', gate ? 100 : 0, gate ? '' : 'breached');
    const wall = !sim.segs.some((s) => s.kind === 'wall' && s.breached);
    add('Wall intact', wall ? 100 : 0, wall ? '' : `${st.breaches} section${st.breaches === 1 ? '' : 's'} breached`);
    if (req && req.budget > 0) {
      const un = Math.max(0, 1 - req.spent / req.budget);
      add('Requisition unspent', 100 * Math.min(1, un / 0.25), `${Math.round(un * 100)}% of the budget`);
    }
    const broke = sim.opt.dawn > 0 && r.time < sim.opt.dawn - 1;
    add('Horde routed before dawn', broke ? 50 : 0, broke ? '' : 'dawn came first');
  } else {
    add('Time held', 200 * Math.min(1, r.time / dawn), `${Math.round(Math.min(1, r.time / dawn) * 100)}% of the night`);
    const killed = sim.initial[ORC] > 0 ? Math.max(0, 1 - (sim.count[ORC] + st.fled) / sim.initial[ORC]) : 0;
    add('Attackers killed', 100 * killed, `${Math.round(killed * 100)}% of the horde`);
  }
  const total = lines.reduce((a, l) => a + l[1], 0);
  const medal = r.win ? MEDALS.find((m) => total >= m.min) : null;
  return { total, medal, lines, win: r.win };
}
