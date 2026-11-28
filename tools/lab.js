// The lab: many small battles, to learn what each unit is worth against what, where.
//
//   node tools/lab.js                         every set, 3 seeds, results to lab-out/lab.json and a summary on screen
//   node tools/lab.js --sets duel,scale --seeds 2 --tag before
//   node tools/lab.js --sets duel --filter wall --md docs/lab/duel.md
//   node tools/lab.js --list                  how many experiments each set holds
//   node tools/lab.js --one '{"setting":"open","def":[["rifle",100]],"orc":[["uruk",400]]}' [--plot dir]
//
// An experiment is a garrison and a horde put down in one of four settings on the real map and
// fought to a finish (or to a time limit) with nobody giving orders:
//   open   a line in the open valley, the horde 420 m off
//   wire   the same behind a belt of wire
//   wall   on the center of the Deeping Wall (guns in the Deep, vehicles in front), the horde with ladders
//   ramp   at the head of the causeway, the horde climbing it
// Sets:
//   duel      one kind of defender, a fixed requisition's worth, against one kind of attack, light and heavy
//   marginal  a balanced garrison on the wall, plus 400 pts of one thing: what does the addition buy?
//   scale     1 to 250 of one kind against six times their number, drawn up as a block or as a line
//   threat    the balanced garrison against equal "threat points" of each kind of attack
// The horde is sized in threat points (TP below), a rough worth per attacker, so that unlike attacks can
// be compared; a defender's worth is its requisition cost.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMap } from '../src/map.js';
import { groupPositions } from '../src/scenarios.js';
import { Sim } from '../src/sim/sim.js';
import { DEF, ORC, UNITS, U, C, DEFAULT_OPTIONS } from '../src/config.js';

/** Rough worth of one attacker, for sizing unlike hordes alike. An engine's crew is counted with the Uruk-hai. */
export const TP = { uruk: 3, archer: 3, berserker: 10, warg: 8, chief: 30, troll: 80, ladder: 6, sapper: 20, catapult: 60, ram: 40, tower: 160 };

const V = Math.PI / 2;
const BUDGET = 1200;
const DEF_TYPES = ['rifle', 'mg', 'marksman', 'grenadier', 'at', 'mortar', 'howitzer', 'ifv', 'tank'];

/** Attack packages: shares of the threat points by type (ladders are added to suit in the wall setting). */
const PACK = {
  uruk: { uruk: 1 }, archer: { archer: 0.7, uruk: 0.3 }, berserker: { berserker: 1 }, warg: { warg: 1 }, troll: { troll: 0.8, uruk: 0.2 },
  mixed: { uruk: 0.5, archer: 0.18, berserker: 0.1, warg: 0.07, troll: 0.1, chief: 0.05 },
  escalade: { uruk: 0.75, berserker: 0.2, chief: 0.05 }, volley: { uruk: 0.5, archer: 0.45, chief: 0.05 },
  towers: { tower: 0.45, troll: 0.25, uruk: 0.3 }, sappers: { sapper: 0.25, uruk: 0.7, chief: 0.05 }, catapults: { catapult: 0.4, uruk: 0.55, chief: 0.05 },
  siege: { uruk: 0.4, archer: 0.12, berserker: 0.08, troll: 0.12, tower: 0.1, catapult: 0.08, sapper: 0.05, chief: 0.05 },
};
const PACKS = { open: ['uruk', 'archer', 'berserker', 'warg', 'troll', 'mixed'], wire: ['uruk', 'berserker', 'warg', 'mixed'], ramp: ['uruk', 'berserker', 'troll', 'mixed'], wall: ['escalade', 'volley', 'towers', 'sappers', 'catapults', 'siege'] };

function pack(name, tp) {
  const out = [];
  for (const [type, share] of Object.entries(PACK[name])) { const n = Math.round((tp * share) / TP[type]); if (n > 0) out.push([type, n]); }
  return out;
}

const BASE = [['rifle', 60], ['mg', 6], ['grenadier', 6], ['marksman', 4], ['at', 4], ['mortar', 3], ['cmd', 1]]; // 1,470 pts
const ADD = ['rifle', 'mg', 'marksman', 'grenadier', 'at', 'mortar', 'howitzer', 'ifv', 'tank', 'cmd', 'cache', 'wire', 'mine', 'claymore', 'hedgehog'];

/** Every experiment of the named sets. */
export function experiments(sets, seeds) {
  const out = [];
  const push = (e) => { for (let s = 1; s <= seeds; s++) out.push({ ...e, seed: s }); };
  if (sets.includes('duel')) {
    for (const setting of ['open', 'wire', 'ramp', 'wall']) for (const d of DEF_TYPES) for (const p of PACKS[setting]) for (const k of [1, 2.5]) {
      push({ set: 'duel', setting, def: [[d, Math.max(1, Math.round(BUDGET / UNITS[U[d]].cost))]], orc: pack(p, BUDGET * k), pack: p, k, key: d });
    }
  }
  if (sets.includes('marginal')) {
    for (const p of ['escalade', 'siege']) {
      push({ set: 'marginal', setting: 'wall', def: BASE, orc: pack(p, 3000), pack: p, key: 'base' });
      for (const a of ADD) push({ set: 'marginal', setting: 'wall', def: [...BASE, [a, Math.max(1, Math.round(400 / UNITS[U[a]].cost))]], orc: pack(p, 3000), pack: p, key: a });
    }
  }
  if (sets.includes('scale')) {
    for (const d of ['rifle', 'mg', 'grenadier']) for (const n of [1, 5, 25, 100, 250]) for (const shape of ['block', 'line']) {
      const tp = n * UNITS[U[d]].cost * 1.5;
      push({ set: 'scale', setting: 'open', def: [[d, n]], shape, orc: pack('uruk', tp), pack: 'uruk', key: `${d} ${shape}`, n });
    }
  }
  if (sets.includes('threat')) {
    for (const p of PACKS.wall.concat(['uruk', 'berserker', 'troll'])) for (const tp of [2000, 4000]) push({ set: 'threat', setting: 'wall', def: BASE, orc: pack(p, tp), pack: p, key: p, tp });
  }
  return out;
}

// ---------------------------------------------------------------- one battle
let map = null;
const defOf = (t) => UNITS[U[t]];

/** The setup for one experiment: { groups, options }. */
export function buildSetup(e) {
  if (!map) map = buildMap();
  const groups = [];
  const mk = (type, count, x, y, ang, w, extra = {}) => { const g = { id: groups.length + 1, type, team: defOf(type).team, count, x, y, ang, w, delay: 0, ...extra }; groups.push(g); return g; };
  const wall = e.setting === 'wall', ramp = e.setting === 'ramp';
  // --- the garrison
  const mid = map.wallAt(0.5);
  let back = 0; // how far behind the front the next line stands (open ground)
  const works = [];
  for (const [type, n] of e.def) {
    const d = defOf(type);
    if (d.cls === C.OBST) { works.push([type, n]); continue; }
    if (wall) {
      if (d.cls === C.INF && !(d.wdef && d.wdef.arc)) { const half = Math.min(0.2, 0.02 + (n * 1.5) / 2 / map.wallLen / 2 + 0.06); mk(type, n, mid.x, mid.y, V, 0, { run: { wall: 0, a: 0.5 - half, b: 0.5 + half } }); }
      else if (d.cls === C.VEH) mk(type, n, 905, mid.y + (groups.length % 2 ? 40 : -40), V, 60);
      else if (d.cls === C.CACHE) mk(type, n, mid.x + 26, mid.y, V, 20);
      else mk(type, n, type === 'howitzer' ? 1180 : 1070, mid.y + 20, V, 60);
    } else if (ramp) {
      // across the head of the causeway, ranks running back toward the gate
      mk(type, n, 846 + back * 0.91, 670 + back * 0.42, Math.atan2(-0.91, 0.42), 11);
      back += Math.ceil(n / 6) * d.spacing + 3;
    } else {
      const arc = d.wdef && d.wdef.arc, sp = d.spacing;
      const w = e.shape === 'block' ? 0 : e.shape === 'line' ? Math.max(sp, (Math.ceil(n / 2) - 1) * sp) : Math.min(140, Math.max(sp, (Math.ceil(n / 2) - 1) * sp));
      const g = mk(type, n, 780 + back + (arc ? 70 : 0), 330, V, w);
      const cols = w > 0 ? Math.floor(w / sp) + 1 : Math.ceil(Math.sqrt(n * 1.8));
      if (!arc) back += Math.ceil(n / cols) * sp + 4;
      g.x += (Math.ceil(n / cols) * sp) / 2;
    }
  }
  for (const [type, n] of works) {
    const x = wall ? mid.x - 60 : 700, y = wall ? mid.y : 330;
    if (type === 'wire' || type === 'hedgehog') mk(type, 1e4, x - (type === 'hedgehog' ? 14 : 0), y, V, n * 4);
    else if (type === 'mine') mk(type, n, x - 24, y, V, 160);
    else mk(type, n, x + 26, y, V, 120);
  }
  if (e.setting === 'wire') mk('wire', 1e4, 700, 330, V, 220);
  for (const g of groups) if (g.count === 1e4) g.count = groupPositions(map, g).length / 2;
  // --- the horde
  let x = wall ? 560 : ramp ? 660 : 360, foot = 0;
  const y = wall ? mid.y : ramp ? 500 : 330;
  const orc = e.orc.map((q) => q.slice());
  for (const [type, n] of orc) if (!defOf(type).crew && !defOf(type).big && !defOf(type).cav) foot += n;
  if (wall && !orc.some((q) => q[0] === 'ladder')) orc.push(['ladder', Math.max(4, Math.round(foot / 45))]);
  const order = ['tower', 'ram', 'troll', 'ladder', 'uruk', 'berserker', 'archer', 'catapult', 'chief', 'sapper', 'warg'];
  orc.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  for (const [type, n] of orc) {
    const d = defOf(type), W = d.crew || d.big ? 150 : 130, cols = Math.floor(W / d.spacing) + 1, depth = Math.ceil(n / cols) * d.spacing;
    mk(type, n, x - depth / 2, y, V, W);
    x -= depth + 5;
  }
  const max = e.max || (wall ? 480 : 360);
  const options = { ...DEFAULT_OPTIONS, dawn: max, rout: 0.03, cpStart: 0, cpRate: 0, seed: e.seed || 1, aimSector: wall ? 1 : -1, ...(e.opts || {}) };
  return { groups, options };
}

/** Fight one experiment out. Returns a flat result row. */
export function runExperiment(e, onSim) {
  const setup = buildSetup(e), sim = new Sim(map, setup, null);
  let defPts0 = 0, tp0 = 0;
  for (let i = 0; i < sim.n; i++) { if (!sim.alive[i]) continue; const d = UNITS[sim.type[i]]; if (d.team === DEF) defPts0 += d.cost || 0; else tp0 += (TP[d.key] || 0) + (d.carry ? d.carry * TP.uruk : 0); }
  const t0 = performance.now();
  while (!sim.result) { sim.step(); sim.events.length = 0; if (onSim) onSim(sim); }
  let defPts = 0, tp = 0, defN = 0, ammo = 0, ammoN = 0;
  for (let i = 0; i < sim.n; i++) {
    if (!sim.alive[i]) continue;
    const d = UNITS[sim.type[i]];
    if (d.team === DEF) { defPts += d.cost || 0; if (d.cls !== C.CACHE) defN++; if (d.ammo) { ammo += Math.min(1, sim.ammo[i] / sim.maxAmmo(i)); ammoN++; } }
    else if (sim.state[i] !== 4) tp += (TP[d.key] || 0) + (d.carry ? (sim.ammo[i] | 0) * TP.uruk : 0);
  }
  const st = sim.stats, r = sim.result;
  const out = r.win ? (sim.time >= sim.opt.dawn - 0.5 ? 'H' : 'W') : 'L'; // won outright, held to time, lost
  return {
    set: e.set, setting: e.setting, key: e.key, pack: e.pack, k: e.k, n: e.n, tp: e.tp, shape: e.shape, seed: e.seed,
    out, t: Math.round(sim.time), def0: sim.initial[0], defEnd: defN, defPts0, defPts, tp0, tpEnd: tp,
    stop: +(1 - tp / Math.max(1, tp0)).toFixed(3), surv: +(defPts / Math.max(1, defPts0)).toFixed(3),
    killed: Object.values(st.lostOrc).reduce((a, b) => a + b, 0), fled: st.fled, ammo: ammoN ? +(ammo / ammoN).toFixed(2) : 1, shots: st.shots,
    breaches: st.breaches, laddersUp: st.laddersUp, foothold: Math.round(st.footholdT), ms: Math.round(performance.now() - t0),
  };
}

// ------------------------------------------------------------------ summaries
const pad = (s, n) => String(s).padEnd(n);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (v) => `${Math.round(v * 100)}`.padStart(3);

/** Markdown summary of a result set. */
export function summarize(rows) {
  const L = [];
  const by = (f) => { const m = new Map(); for (const r of rows) { const k = f(r); if (k == null) continue; (m.get(k) || m.set(k, []).get(k)).push(r); } return m; };
  const duel = rows.filter((r) => r.set === 'duel');
  if (duel.length) {
    L.push('## Duel: 1,200 pts of one defender against one kind of attack', '', 'Each cell: light attack / heavy attack (1x and 2.5x the defenders\' worth in threat points), as', '`outcome stopped%/survived%`. W won outright, H held to the time limit, L lost.', '');
    const value = new Map();
    for (const setting of ['open', 'wire', 'ramp', 'wall']) {
      const rs = duel.filter((r) => r.setting === setting);
      if (!rs.length) continue;
      const packs = [...new Set(rs.map((r) => r.pack))], types = [...new Set(rs.map((r) => r.key))];
      L.push(`### ${setting}`, '', `| defender | ${packs.join(' | ')} | mean stopped | mean survived |`, `| --- | ${packs.map(() => '---').join(' | ')} | --- | --- |`);
      for (const t of types) {
        const cells = packs.map((p) => [1, 2.5].map((k) => {
          const q = rs.filter((r) => r.key === t && r.pack === p && r.k === k);
          if (!q.length) return '—';
          const o = { W: 0, H: 0, L: 0 }; for (const r of q) o[r.out]++;
          const best = Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];
          return `${best} ${pct(mean(q.map((r) => r.stop))).trim()}/${pct(mean(q.map((r) => r.surv))).trim()}`;
        }).join(' · '));
        const q = rs.filter((r) => r.key === t), ms = mean(q.map((r) => r.stop * r.k)), sv = mean(q.map((r) => r.surv));
        (value.get(t) || value.set(t, []).get(t)).push({ setting, ms, sv, win: mean(q.map((r) => (r.out === 'L' ? 0 : 1))) });
        L.push(`| ${t} | ${cells.join(' | ')} | ${ms.toFixed(2)} | ${pct(sv).trim()}% |`);
      }
      L.push('');
    }
    L.push('### Worth by defender', '', 'Threat points stopped per requisition point (1.00: stopped its own worth), by setting, and how often it was not wiped out.', '', '| defender | open | wire | ramp | wall | not lost |', '| --- | --- | --- | --- | --- | --- |');
    for (const [t, v] of value) { const g = (s) => { const q = v.find((x) => x.setting === s); return q ? q.ms.toFixed(2) : '—'; }; L.push(`| ${t} | ${g('open')} | ${g('wire')} | ${g('ramp')} | ${g('wall')} | ${pct(mean(v.map((x) => x.win))).trim()}% |`); }
    L.push('');
  }
  const marg = rows.filter((r) => r.set === 'marginal');
  if (marg.length) {
    L.push('## Marginal: a balanced 1,470 pt garrison on the wall, plus 400 pts of one thing', '', 'Against 3,000 threat points. Change from the garrison alone.', '', '| added | attack | held | stopped | survived | change in stopped | change in survived |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const p of [...new Set(marg.map((r) => r.pack))]) {
      const base = marg.filter((r) => r.pack === p && r.key === 'base'), b0 = mean(base.map((r) => r.stop)), s0 = mean(base.map((r) => r.surv));
      for (const k of [...new Set(marg.filter((r) => r.pack === p).map((r) => r.key))]) {
        const q = marg.filter((r) => r.pack === p && r.key === k), st = mean(q.map((r) => r.stop)), sv = mean(q.map((r) => r.surv));
        L.push(`| ${k} | ${p} | ${q.filter((r) => r.out !== 'L').length}/${q.length} | ${pct(st).trim()}% | ${pct(sv).trim()}% | ${k === 'base' ? '' : (st - b0 >= 0 ? '+' : '') + Math.round((st - b0) * 100)} | ${k === 'base' ? '' : (sv - s0 >= 0 ? '+' : '') + Math.round((sv - s0) * 100)} |`);
      }
    }
    L.push('');
  }
  const scale = rows.filter((r) => r.set === 'scale');
  if (scale.length) {
    L.push('## Scale: n defenders in the open against 1.5 times their worth of Uruk-hai', '', 'Each cell: `outcome stopped%/survived%`.', '', '| defender, drawn up as | 1 | 5 | 25 | 100 | 250 |', '| --- | --- | --- | --- | --- | --- |');
    for (const [k, q] of by((r) => (r.set === 'scale' ? r.key : null))) {
      L.push(`| ${k} | ${[1, 5, 25, 100, 250].map((n) => { const z = q.filter((r) => r.n === n); if (!z.length) return '—'; const o = { W: 0, H: 0, L: 0 }; for (const r of z) o[r.out]++; return `${Object.entries(o).sort((a, b) => b[1] - a[1])[0][0]} ${pct(mean(z.map((r) => r.stop))).trim()}/${pct(mean(z.map((r) => r.surv))).trim()}`; }).join(' | ')} |`);
    }
    L.push('');
  }
  const threat = rows.filter((r) => r.set === 'threat');
  if (threat.length) {
    L.push('## Threat: the balanced garrison on the wall against equal threat points of each attack', '', '| attack | 2,000 TP | 4,000 TP |', '| --- | --- | --- |');
    for (const [k, q] of by((r) => (r.set === 'threat' ? r.key : null))) {
      L.push(`| ${k} | ${[2000, 4000].map((tp) => { const z = q.filter((r) => r.tp === tp); if (!z.length) return '—'; return `held ${z.filter((r) => r.out !== 'L').length}/${z.length}, stopped ${pct(mean(z.map((r) => r.stop))).trim()}%, survived ${pct(mean(z.map((r) => r.surv))).trim()}%`; }).join(' | ')} |`);
    }
    L.push('');
  }
  return L.join('\n');
}

// ----------------------------------------------------------------------- main
if (!isMainThread) {
  parentPort.on('message', (e) => { try { parentPort.postMessage({ ok: true, r: runExperiment(e) }); } catch (err) { parentPort.postMessage({ ok: false, err: String(err && err.stack || err), e }); } });
} else if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2), get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const one = get('one', null);
  if (one) {
    const e = JSON.parse(one), dir = get('plot', null);
    let shoot = null;
    if (dir) {
      const { drawSim, png } = await import('./plot.js');
      fs.mkdirSync(dir, { recursive: true });
      const every = +get('every', 30), box = get('box', null) ? get('box').split(',').map(Number) : e.setting === 'wall' ? [480, 250, 1120, 650] : e.setting === 'ramp' ? [560, 400, 960, 780] : [300, 180, 900, 480];
      let next = 0;
      shoot = (sim) => { if (sim.time < next) return; const im = drawSim(sim, { box, scale: 2, by: get('by', 'type') }); fs.writeFileSync(path.join(dir, `t${String(Math.round(next)).padStart(4, '0')}.png`), png(im.w, im.h, im.rgb)); next += every; };
    }
    console.log(runExperiment(e, shoot));
  } else {
    const sets = get('sets', 'duel,marginal,scale,threat').split(','), seeds = +get('seeds', 3), tag = get('tag', 'lab'), filter = get('filter', null);
    let jobs = experiments(sets, seeds);
    if (filter) jobs = jobs.filter((e) => JSON.stringify(e).includes(filter));
    if (args.includes('--list')) { const c = {}; for (const e of jobs) c[e.set] = (c[e.set] || 0) + 1; console.log(c, 'total', jobs.length); process.exit(0); }
    const N = Math.max(1, Math.min(+get('jobs', os.cpus().length), jobs.length)), rows = [], t0 = Date.now();
    let next = 0, done = 0, failed = 0;
    await new Promise((resolve) => {
      for (let w = 0; w < N; w++) {
        const wk = new Worker(new URL(import.meta.url), { workerData: {} });
        const feed = () => { if (next < jobs.length) wk.postMessage(jobs[next++]); else { wk.terminate(); if (done === jobs.length) resolve(); } };
        wk.on('message', (m) => { done++; if (m.ok) rows.push(m.r); else { failed++; console.error(m.err, JSON.stringify(m.e)); } if (done % 50 === 0) process.stderr.write(`${done}/${jobs.length} `); feed(); });
        feed();
      }
    });
    process.stderr.write('\n');
    rows.sort((a, b) => JSON.stringify([a.set, a.setting, a.key, a.pack, a.k, a.n, a.tp, a.seed]).localeCompare(JSON.stringify([b.set, b.setting, b.key, b.pack, b.k, b.n, b.tp, b.seed])));
    fs.mkdirSync('lab-out', { recursive: true });
    fs.writeFileSync(path.join('lab-out', `${tag}.json`), JSON.stringify(rows));
    const md = `# Lab results: ${tag}\n\n${rows.length} experiments (${failed} failed) in ${Math.round((Date.now() - t0) / 1000)} s.\n\n${summarize(rows)}`;
    const mdFile = get('md', null);
    if (mdFile) { fs.mkdirSync(path.dirname(mdFile), { recursive: true }); fs.writeFileSync(mdFile, md + '\n'); }
    console.log(md);
  }
}
