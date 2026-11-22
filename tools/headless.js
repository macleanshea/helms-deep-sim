// Headless balance / performance run.
//
//   node tools/headless.js [preset] [maxSeconds] [none|auto]        positional form
//   node tools/headless.js --preset garrison --seed 3 --policy auto --opt dawn=900 --json
//
// Flags: --preset, --seed, --max (seconds), --policy none|auto, --horde n, --opt key=value (repeatable;
// support.<kind>=n reaches the support table), --json (one summary line, nothing else), --quiet,
// --verify (run twice and compare state hashes). HORDE=n in the environment still works.
import { pathToFileURL } from 'node:url';
import { buildMap } from '../src/map.js';
import { buildPreset, horde } from '../src/scenarios.js';
import { Sim } from '../src/sim/sim.js';
import { DEF, ORC } from '../src/config.js';
import { autopilot } from './autopilot.js';

let sharedMap = null;

/** Run one battle to its end (or `max` seconds) and return a summary object. */
export function runBattle(cfg = {}) {
  const { preset = 'garrison', seed = 1, max = 2400, policy = 'none', opts = {}, hordeN = 0, log = null } = cfg;
  const map = sharedMap || (sharedMap = buildMap());
  const setup = buildPreset(map, preset);
  if (hordeN) setup.groups = setup.groups.filter((g) => g.team === DEF).concat(horde(hordeN));
  setup.options.seed = seed;
  for (const [k, v] of Object.entries(opts)) {
    if (k.startsWith('support.')) setup.options.support[k.slice(8)] = v; else setup.options[k] = v;
  }
  const sim = new Sim(map, setup, null);
  const pilot = policy === 'none' ? null : autopilot(sim, policy);
  if (log) log(`defenders ${sim.initial[0]}  orcs ${sim.initial[1]}`);
  let worst = 0, total = 0, next = 60, gateT = -1, ammoMin = 1;
  const gate = sim.segs[map.GATE];
  while (!sim.result && sim.time < max) {
    const a = performance.now();
    sim.step();
    const d = performance.now() - a;
    total += d; if (d > worst) worst = d;
    if (pilot) pilot.step();
    if (gateT < 0 && gate.breached) gateT = sim.time;
    if (log) for (const e of sim.events) if (e.type === 'banner') log(`  [${sim.time.toFixed(0)}s] ${e.text}`);
    sim.events.length = 0;
    if (sim.time >= next) {
      next += 60;
      const am = sim.ammoLevel(); if (am < ammoMin) ammoMin = am;
      if (log) log(`t=${sim.time.toFixed(0)}s def=${sim.defCombat} orc=${sim.count[ORC]} fled=${sim.stats.fled} routs=${sim.stats.routs}/${sim.stats.routsDef || 0} ammo=${(am * 100).toFixed(0)}% avg=${(total / sim.tick).toFixed(2)}ms worst=${worst.toFixed(1)}ms`);
    }
  }
  const r = sim.result || { win: null, reason: 'time limit', time: sim.time };
  const round = (v, p = 2) => +v.toFixed(p);
  return {
    preset, seed, policy, win: r.win, reason: r.reason, t: round(r.time, 1), dawn: sim.opt.dawn,
    def0: sim.initial[0], defEnd: sim.defCombat, orc0: sim.initial[1], orcEnd: sim.count[ORC],
    fled: sim.stats.fled, breaches: sim.stats.breaches, gateT: round(gateT, 0), ammoMin: round(ammoMin),
    calls: pilot ? pilot.calls : {},
    tickAvg: round(total / Math.max(1, sim.tick)), tickMax: round(worst, 1), hash: sim.hash(),
    stats: sim.stats,
  };
}

function parseArgs(argv) {
  const cfg = { opts: {} }, flags = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (k === 'json' || k === 'quiet' || k === 'verify') { flags[k] = true; continue; }
    const v = argv[++i];
    if (k === 'opt') { const [ok, ov] = v.split('='); cfg.opts[ok] = ov === 'true' ? true : ov === 'false' ? false : +ov; }
    else if (k === 'preset') cfg.preset = v;
    else if (k === 'policy') cfg.policy = v;
    else if (k === 'seed') cfg.seed = +v;
    else if (k === 'max') cfg.max = +v;
    else if (k === 'horde') cfg.hordeN = +v;
    else throw new Error(`unknown flag --${k}`);
  }
  if (pos[0]) cfg.preset = pos[0];
  if (pos[1]) cfg.max = +pos[1];
  if (pos[2]) cfg.policy = pos[2];
  if (process.env.HORDE && !cfg.hordeN) cfg.hordeN = +process.env.HORDE;
  return { cfg, flags };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { cfg, flags } = parseArgs(process.argv.slice(2));
  const loud = !flags.json && !flags.quiet;
  const res = runBattle({ ...cfg, log: loud ? (s) => console.log(s) : null });
  if (flags.verify) {
    const again = runBattle(cfg);
    if (again.hash !== res.hash) { console.error(`NOT DETERMINISTIC: ${res.hash} vs ${again.hash}`); process.exit(1); }
    if (!flags.json) console.log(`deterministic: hash ${res.hash} reproduced`);
  }
  if (flags.json) { const { stats, ...line } = res; console.log(JSON.stringify(line)); }
  else {
    const { stats } = res;
    console.log('RESULT', { win: res.win, reason: res.reason, time: res.t }, `avg=${res.tickAvg}ms worst=${res.tickMax}ms hash=${res.hash}`);
    console.log(`defenders ${res.defEnd}/${res.def0}  horde ${res.orcEnd}/${res.orc0}  gate fell ${res.gateT < 0 ? 'never' : res.gateT + 's'}`);
    console.log('kills', stats.kills);
    console.log('lostDef', stats.lostDef, 'by', stats.defLostBy);
    console.log('lostOrc', stats.lostOrc, 'fled', stats.fled, 'routs', stats.routs, 'breaches', stats.breaches);
    if (Object.keys(res.calls).length) console.log('support calls', res.calls);
  }
}
