// Headless balance / performance run:  node tools/headless.js [preset] [maxSeconds] [policy]
import { buildMap } from '../src/map.js';
import { buildPreset } from '../src/scenarios.js';
import { Sim } from '../src/sim/sim.js';
import { UNITS, DEF, ORC } from '../src/config.js';

const preset = process.argv[2] || 'garrison';
const maxT = +(process.argv[3] || 1500);
const policy = process.argv[4] || 'none';
if (process.env.HORDE) globalThis.HORDE = +process.env.HORDE;
const t0 = performance.now();
const map = buildMap();
const tMap = performance.now() - t0;
const setup = buildPreset(map, preset);
const sim = new Sim(map, setup, null);
console.log(`map ${tMap.toFixed(0)}ms  defenders ${sim.initial[0]}  orcs ${sim.initial[1]}`);
let worst = 0, total = 0, next = 60;
while (!sim.result && sim.time < maxT) {
  const a = performance.now();
  sim.step();
  const d = performance.now() - a;
  total += d; if (d > worst) worst = d;
  if (policy === 'auto' && sim.tick % 50 === 0) {
    // crude autopilot: drop support on the densest attacker cell
    let best = -1, bc = 40;
    for (let c = 0; c < sim.ocCount.length; c++) if (sim.ocCount[c] > bc && !sim.danger[c]) { bc = sim.ocCount[c]; best = c; }
    if (best >= 0) { const x = (best % 120) * 16 + 8, y = ((best / 120) | 0) * 16 + 8; for (const k of ['arty', 'air', 'gunship']) if (sim.callSupport(k, x, y)) break; }
    if (sim.ammoLevel() < 0.45) sim.callSupport('supply', 1300, 450);
  }
  for (const e of sim.events) if (e.type === 'banner') console.log(`  [${sim.time.toFixed(0)}s] ${e.text}`);
  sim.events.length = 0;
  if (sim.time >= next) {
    next += 60;
    console.log(`t=${sim.time.toFixed(0)}s def=${sim.defCombat} orc=${sim.count[ORC]} ammo=${(sim.ammoLevel() * 100).toFixed(0)}% avg=${(total / sim.tick).toFixed(2)}ms worst=${worst.toFixed(1)}ms`);
  }
}
console.log('RESULT', sim.result, `ticks=${sim.tick} avg=${(total / sim.tick).toFixed(2)}ms worst=${worst.toFixed(1)}ms`);
console.log('kills', sim.stats.kills);
console.log('lostDef', sim.stats.lostDef, 'by', sim.stats.defLostBy);
console.log('lostOrc', sim.stats.lostOrc);
