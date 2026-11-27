// Headless balance / performance run.
//
//   node tools/headless.js [preset] [maxSeconds] [none|auto]        positional form
//   node tools/headless.js --preset garrison --seed 3 --policy auto --opt dawn=900 --json
//
// Flags: --preset, --seed, --max (seconds), --policy none|auto|dump, --horde n, --opt key=value (repeatable;
// support.<kind>=n reaches the support table), --json (one summary line, nothing else), --quiet,
// --verify (run twice and compare state hashes). HORDE=n in the environment still works.
import { pathToFileURL } from 'node:url';
import { buildMap } from '../src/map.js';
import { buildPreset, horde, forceCost, PRESETS } from '../src/scenarios.js';
import { scoreBattle } from '../src/score.js';
import { Sim } from '../src/sim/sim.js';
import { DEF, ORC, UNITS } from '../src/config.js';
import { autopilot } from './autopilot.js';

let sharedMap = null;

/** Run one battle to its end (or `max` seconds) and return a summary object. */
export function runBattle(cfg = {}) {
  const { preset = 'garrison', seed = 1, max = 2400, policy = 'none', opts = {}, hordeN = 0, log = null } = cfg;
  if (!PRESETS.some((p) => p.key === preset)) throw new Error(`unknown preset "${preset}" (try ${PRESETS.map((p) => p.key).join(', ')})`);
  const map = sharedMap || (sharedMap = buildMap());
  const setup = buildPreset(map, preset, false);
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
  // how far from the works each kind of attacker falls
  const fell = {};
  const kill = sim.kill.bind(sim);
  sim.kill = (i, w, silent) => {
    if (sim.alive[i] && sim.team[i] === ORC && !silent) { const k = UNITS[sim.type[i]].key; (fell[k] || (fell[k] = [])).push(sim._fortDist(sim.x[i], sim.y[i])); }
    return kill(i, w, silent);
  };
  let firstWallT = -1, peakOnWall = 0, peakCell = 0, win10 = 0, worst10 = 0;
  const cells = new Map();
  while (!sim.result && sim.time < max) {
    const a = performance.now();
    sim.step();
    const d = performance.now() - a;
    total += d; if (d > worst) worst = d;
    // the cost that matters to a browser frame at 8x speed: the dearest run of ten steps
    win10 += d; if (sim.tick % 10 === 0) { if (win10 > worst10) worst10 = win10; win10 = 0; }
    if (sim.tick % 50 === 0) {
      let on = 0; cells.clear();
      for (let i = 0; i < sim.n; i++) {
        if (!sim.alive[i] || sim.team[i] !== ORC) continue;
        if (sim.el[i]) { on++; continue; }
        if (sim.rad[i] > 0.7) continue;
        if (firstWallT < 0 && sim.x[i] > 700 && sim._fortDist(sim.x[i], sim.y[i]) < 40) firstWallT = sim.time;
        const c = ((sim.y[i] / 2) | 0) * 720 + ((sim.x[i] / 2) | 0), v = (cells.get(c) || 0) + 1;
        cells.set(c, v); if (v > peakCell) peakCell = v;
      }
      if (on > peakOnWall) peakOnWall = on;
    }
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
  const sc = sim.result && !sim.opt.sandbox ? scoreBattle(sim, { budget: setup.budget, spent: forceCost(setup.groups) }) : null;
  const round = (v, p = 2) => +v.toFixed(p);
  const fellAt = {};
  for (const k in fell) { const a = fell[k].sort((x, y) => x - y); fellAt[k] = Math.round(a[a.length >> 1]); }
  const st = sim.stats;
  let captains = 0;
  for (let i = 0; i < sim.n; i++) if (sim.alive[i] && sim.team[i] === ORC && UNITS[sim.type[i]].cmd) captains++;
  return {
    preset, seed, policy, win: r.win, reason: r.reason, t: round(r.time, 1), dawn: sim.opt.dawn,
    def0: sim.initial[0], defEnd: sim.defCombat, orc0: sim.initial[1], orcEnd: sim.count[ORC],
    fled: sim.stats.fled, breaches: sim.stats.breaches, gateT: round(gateT, 0), ammoMin: round(ammoMin),
    calls: pilot ? pilot.calls : {},
    cp: sim.opt.sandbox ? null : { earned: round(sim.cpStats.earned, 1), bounty: round(sim.cpStats.bounty, 1), spent: sim.cpStats.spent, left: round(sim.cp, 1) },
    lullS: sim.dir ? sim.dir.lullS : 0,
    score: sc ? sc.total : null, medal: sc && sc.medal ? sc.medal.key : null,
    tickAvg: round(total / Math.max(1, sim.tick)), tickMax: round(worst, 1), tick10: round(worst10, 1), hash: sim.hash(),
    siege: {
      ladders: st.startOrc.ladder || 0, laddersUp: st.laddersUp, thrown: st.thrown, towers: st.startOrc.tower || 0, towersUp: st.towersUp,
      dropped: st.dropped, recovered: st.recovered, footholdT: round(st.footholdT, 0), firstWallT: round(firstWallT, 0), peakOnWall, peakCell,
      captains: `${captains}/${st.startOrc.chief || 0}`, blocked: st.blocked, rallied: st.rallied, fellAt,
    },
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
    if (k === 'opt') {
      // numbers and true/false are parsed; anything else (e.g. pacing=steady) stays a string
      const [ok, ov = ''] = v.split('='), num = Number(ov);
      cfg.opts[ok] = ov === 'true' ? true : ov === 'false' ? false : ov !== '' && !Number.isNaN(num) ? num : ov;
    }
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
  let res;
  try { res = runBattle({ ...cfg, log: loud ? (s) => console.log(s) : null }); } catch (err) { console.error(err.message); process.exit(1); }
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
    const sg = res.siege;
    console.log(`siege: ladders raised ${sg.laddersUp}/${sg.ladders} (thrown down ${sg.thrown}), towers docked ${sg.towersUp}/${sg.towers}, engines dropped ${sg.dropped} and picked up again ${sg.recovered}`);
    console.log(`       first attacker at the wall ${sg.firstWallT < 0 ? 'never' : sg.firstWallT + 's'}, first foothold ${sg.footholdT < 0 ? 'never' : sg.footholdT + 's'}, most on the wall at once ${sg.peakOnWall}, most in one 2 m cell ${sg.peakCell}`);
    console.log(`       captains alive ${sg.captains}, shots stopped by shields ${sg.blocked}, companies rallied ${sg.rallied}`);
    console.log('       median distance from the works at death (m):', sg.fellAt);
    console.log(`perf: avg ${res.tickAvg} ms a step, worst step ${res.tickMax} ms, worst ten steps ${res.tick10} ms`);
  }
}
