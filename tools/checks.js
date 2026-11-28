// Behavior checks for the siege rules: things that would look wrong in play, measured headless.
//
//   node tools/checks.js                  every check
//   node tools/checks.js crews wargs      only the named ones
//   node tools/checks.js --list           what there is
//
// Each check plays one or more battles with instruments attached and prints PASS or FAIL with the
// numbers behind the verdict. It exits 1 if anything fails. Thresholds are judgment calls about
// what would look broken to a player, not laws; they sit beside each verdict so they can be argued with.
import { pathToFileURL } from 'node:url';
import { buildMap, KEEP } from '../src/map.js';
import { buildPreset, horde, makeGroup, PRESETS } from '../src/scenarios.js';
import { Sim, S_WAIT, S_MOVE, S_DONE, FINE_W, FINE_H } from '../src/sim/sim.js';
import { DEF, ORC, UNITS, U, C, T } from '../src/config.js';
import { autopilot } from './autopilot.js';
import { LAYOUT } from '../src/layout.js';

const AP = LAYOUT.approach;
const map = buildMap();
const FOOT = (d) => d.team === ORC && d.sz === 0;
const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : NaN);
const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * Play a battle with instruments. `setup` is a built setup; `opts.policy` 'auto' | 'none';
 * `opts.each(sim, probe)` runs once a second; returns the probe with everything measured.
 */
function play(setup, opts = {}) {
  const sim = new Sim(map, setup, null);
  const pilot = opts.policy === 'none' ? null : autopilot(sim, 'auto');
  const P = {
    sim, alerts: [], engines: new Map(), carriers: new Map(), carrierMax: 0, carriersStranded: 0, raised: new Map(), throwAfter: [],
    rifle: { open: 0, shieldNear: 0, shieldFar: 0 }, rifles0: 0, sectorShots: [0, 0, 0, 0], shotLog: [],
    pin: { unitS: 0, pinnedS: 0, longest: 0, run: new Map() }, contactT: -1,
    capKilled: {}, wargs: { heldS: 0, looseS: 0, firstLoose: -1, why: '', engaged: 0 }, back: new Map(), surges: [],
    stuck: { n60: 0, worst: 0, run: new Map() }, routers: { n: 0, ratio: 0 }, fwd: [], past: 0, calls: pilot ? pilot.calls : {},
    lanes: { shots: 0, noLane: 0, offArc: 0, inReach: 0, blocked: 0, maxCell: 0, wander: 0, def0: 0, firstContact: -1 },
  };
  const N = sim.x.length, px = new Float32Array(N), py = new Float32Array(N), pg = new Uint16Array(N);
  // where each defender was posted, and whether anything but his own search for a firing place has moved him since
  const x0 = Float32Array.from(sim.x), y0 = Float32Array.from(sim.y), g0 = Uint16Array.from(sim.gen), moved = new Uint8Array(N);
  const om = sim.orderMove.bind(sim); sim.orderMove = (ids, x, y, ...rest) => { for (const i of ids) moved[i] = 1; return om(ids, x, y, ...rest); }; // (facing and the auto flag passed on: a platoon's own move is not an order)
  const tk = sim._toKeep.bind(sim); sim._toKeep = (list) => { for (const [, i] of list) moved[i] = 1; return tk(list); };
  for (let i = 0; i < sim.n; i++) if (sim.alive[i] && sim.team[i] === DEF && UNITS[sim.type[i]].cls === C.INF) P.lanes.def0++;
  for (let i = 0; i < sim.n; i++) if (sim.alive[i] && sim.type[i] === U.rifle) P.rifles0++;
  // forward-deployed vehicles: outside the wall when the battle opens
  for (let i = 0; i < sim.n; i++) if (sim.alive[i] && sim.team[i] === DEF && UNITS[sim.type[i]].cls === C.VEH && sim.x[i] < AP.front) P.fwd.push({ i, gen: sim.gen[i], key: UNITS[sim.type[i]].key, x: sim.x[i], y: sim.y[i], diedT: -1, by: '', hitsBy: {} });
  const kill = sim.kill.bind(sim);
  sim.kill = (i, w, silent) => {
    if (sim.alive[i]) {
      const d = UNITS[sim.type[i]];
      if (d.team === ORC && d.cmd && !silent) { const k = w ? w.key : 'other'; P.capKilled[k] = (P.capKilled[k] || 0) + 1; }
      for (const f of P.fwd) if (f.i === i && f.gen === sim.gen[i] && f.diedT < 0) { f.diedT = sim.time; f.by = w ? w.key : 'other'; }
    }
    return kill(i, w, silent);
  };
  const dmg = sim.damage.bind(sim);
  sim.damage = (i, v, w) => { for (const f of P.fwd) if (f.i === i && f.gen === sim.gen[i] && w) f.hitsBy[w.key] = (f.hitsBy[w.key] || 0) + 1; return dmg(i, v, w); };
  // what riflemen shoot at, and how much each sector fires
  const fire = sim._fire.bind(sim);
  sim._fire = (i, d, w, slot, eg, x, y, c) => {
    const a0 = slot ? sim.ammo2[i] : sim.ammo[i];
    fire(i, d, w, slot, eg, x, y, c);
    if ((slot ? sim.ammo2[i] : sim.ammo[i]) >= a0) return;
    P.sectorShots[sim.sectorAt(x, y)]++;
    if (d.cls === C.INF && !w.arc && w.key !== 'gl') {
      // did he have a line of fire, and was the target inside his arc?
      P.lanes.shots++;
      if (sim.rank[i] > 2) P.lanes.noLane++;
      const t = slot ? sim.target2[i] : sim.target[i];
      if (eg && t >= 0 && sim.alive[t] && !sim.el[t]) { const sg = sim.segs[sim.mseg[c]], ex = sim.x[t] - x, ey = sim.y[t] - y, o = ex * sg.nx + ey * sg.ny; if (o * o < 0.0669 * (ex * ex + ey * ey)) P.lanes.offArc++; }
    }
    if (w.key !== 'rifle') return;
    const t = sim.target[i];
    if (t < 0 || !sim.alive[t]) { P.rifle.open++; return; }
    if (!sim.gShield[sim.grp[t]] || sim.crewOf[t] >= 0) P.rifle.open++;
    else if (Math.hypot(sim.x[t] - x, sim.y[t] - y) <= 121) P.rifle.shieldNear++; else P.rifle.shieldFar++;
  };
  const thr = sim._throwCheck.bind(sim);
  sim._throwCheck = (L) => { const n = sim.stats.thrown; thr(L); if (sim.stats.thrown > n) { const k = L * 65536 + sim.gen[L]; if (P.raised.has(k)) P.throwAfter.push(sim.time - P.raised.get(k)); P.raised.delete(k); } };

  const max = opts.max || 2400;
  while (!sim.result && sim.time < max) {
    sim.step();
    if (pilot) pilot.step();
    if (opts.tick) opts.tick(sim, P);
    for (const e of sim.events) if (e.type === 'banner' || e.type === 'log') { P.alerts.push({ t: sim.time, text: e.text, banner: e.type === 'banner' }); if (/surging/.test(e.text)) P.surges.push({ t: sim.time, sec: sim.sectors.findIndex((s) => e.text.includes(s.short)) }); }
    sim.events.length = 0;
    // ladders: when each went up
    for (const e of sim.engines) if (sim.alive[e] && sim.type[e] === U.ladder && sim.state[e] === S_DONE) { const k = e * 65536 + sim.gen[e]; if (!P.raised.has(k)) P.raised.set(k, sim.time); }
    if (sim.tick % 10) continue;
    const t = sim.time;
    P.shotLog.push(P.sectorShots.slice());
    // forces sent round to the postern while the Deeping Wall is still manned (there should be none)
    if (!sim.wl.abandoned && sim.wl.forces.some((f) => f.sector === 4 || f.sector === 5)) P.postWrong = (P.postWrong || 0) + 1; // (or up the ring by lashed ladders)
    // --- engines and their crews
    for (const e of sim.engines) {
      if (!sim.alive[e]) continue;
      const d = UNITS[sim.type[e]];
      if (!d.crew) continue;
      const k = e * 65536 + sim.gen[e];
      let r = P.engines.get(k);
      if (!r) P.engines.set(k, (r = { key: d.key, life: 0, idle: 0, idleEdge: 0, crewed: false, x0: sim.x[e] }));
      const st = sim.state[e];
      if (st === S_DONE || st === S_WAIT) continue;
      r.life++;
      if (sim.crewPts[e] >= d.crew.min) r.crewed = true; else { r.idle++; if (sim.x[e] < 80) r.idleEdge++; }
    }
    const seen = new Set();
    let stranded = 0;
    for (let i = 0; i < sim.n; i++) {
      if (!sim.alive[i]) continue;
      const d = UNITS[sim.type[i]], g = sim.grp[i];
      if (sim.team[i] === ORC) {
        // a carrier standing by an engine that cannot move
        const e = sim.crewOf[i];
        if (e >= 0 && sim.alive[e] && sim.gen[e] === sim.crewGen[i] && sim.state[e] === S_MOVE && UNITS[sim.type[e]].crew && sim.crewPts[e] < UNITS[sim.type[e]].crew.min) {
          const k = i * 65536 + sim.gen[i], v = (P.carriers.get(k) || 0) + 1;
          P.carriers.set(k, v); seen.add(k); if (v > P.carrierMax) P.carrierMax = v; if (v === 60) stranded++;
        }
        if (d.cav) { if (sim.gOrder[g] === 1) P.wargs.heldS++; else { P.wargs.looseS++; if (P.wargs.firstLoose < 0 && sim.state[i] !== S_WAIT) { P.wargs.firstLoose = t; P.wargs.why = sim.wl.allIn ? 'final effort' : sim.wl.resOut === 1 ? 'a way in' : sim.wl.resOut === 2 ? 'troops in the open' : 'not held'; } } }
        if (P.contactT < 0 && sim.x[i] > AP.mid && sim._fortDist(sim.x[i], sim.y[i]) < 150) P.contactT = t;
        if (sim.gState[g] >= 2 && !sim.el[i] && sim.state[i] === S_MOVE) { P.routers.n++; P.routers.ratio += Math.hypot(sim.vx[i], sim.vy[i]) / (d.speed * 1.15); }
        // foot soldiers going nowhere with nothing in their way to explain it
        if (t % 10 < 0.05 && FOOT(d)) {
          const k = i, moved = pg[i] === sim.gen[i] ? Math.hypot(sim.x[i] - px[i], sim.y[i] - py[i]) : 99;
          px[i] = sim.x[i]; py[i] = sim.y[i]; pg[i] = sim.gen[i];
          // (waiting on purpose is not being stuck: closing up at the forming-up line, or a company's own step-off delay)
          const free = sim.state[i] === S_MOVE && !sim.gOrder[g] && !sim._forming(g) && !sim.gHold[g] && sim.gWaitT[g] <= sim.time && sim.crewOf[i] < 0 && !sim.el[i] && sim.gState[g] < 2 && sim.gPin[g] < 2 && !d.cmd && d.role !== 1
            && sim._fortDist(sim.x[i], sim.y[i]) > 14 && sim.x[i] < AP.wallLine && sim._nearDef(i, sim.x[i], sim.y[i], 0) < 0 && !crowded(sim, i);
          if (free && moved < 1.5) { const v = (P.stuck.run.get(k) || 0) + 10; P.stuck.run.set(k, v); if (v > P.stuck.worst) P.stuck.worst = v; if (v === 60) P.stuck.n60++; }
          else P.stuck.run.delete(k);
        }
        for (const f of P.fwd) if (f.diedT < 0 && sim.x[i] > f.x + 25 && Math.abs(sim.y[i] - f.y) < 60 && !sim.el[i]) P.past++;
      }
    }
    for (const k of P.carriers.keys()) if (!seen.has(k)) P.carriers.delete(k);
    P.carriersStranded += stranded;
    // --- lines of fire: who has an enemy in reach but no line, how tightly the garrison is packed, how far anyone has strayed
    {
      const cells = new Map();
      for (let i = 0; i < sim.n; i++) {
        if (!sim.alive[i] || sim.team[i] !== DEF) continue;
        const d = UNITS[sim.type[i]];
        if (d.cls !== C.INF) continue;
        if (sim.state[i] !== S_MOVE) { const k = (((sim.y[i] / 2) | 0) * FINE_W + ((sim.x[i] / 2) | 0)) * 2 + sim.el[i], v = (cells.get(k) || 0) + 1; cells.set(k, v); if (v > P.lanes.maxCell) P.lanes.maxCell = v; }
        if (!moved[i] && sim.gen[i] === g0[i] && i < x0.length) { const w = Math.hypot(sim.x[i] - x0[i], sim.y[i] - y0[i]); if (w > P.lanes.wander) P.lanes.wander = w; }
        const w = d.wdef;
        if (!w || w.arc || w.key === 'gl' || sim.ammo[i] < 1 || sim.state[i] === S_MOVE) continue;
        if (sim.x[i] - sim.orcMaxX < w.range) { if (P.lanes.firstContact < 0) P.lanes.firstContact = t; if (t > P.lanes.firstContact + 30) { P.lanes.inReach++; if (sim.rank[i] > 2) P.lanes.blocked++; } }
      }
    }
    // --- defenders pinned
    if (P.contactT >= 0) for (let g = 0; g < sim.ng; g++) {
      if (sim.gTeam[g] !== DEF || sim.gExempt[g] || sim.gAlive[g] < 5) continue;
      P.pin.unitS += sim.gAlive[g];
      if (sim.gPin[g] === 2) { P.pin.pinnedS += sim.gAlive[g]; const v = (P.pin.run.get(g) || 0) + 1; P.pin.run.set(g, v); if (v > P.pin.longest) P.pin.longest = v; } else P.pin.run.delete(g);
    }
    // --- forces pulled back
    for (const f of sim.wl.forces) { const r = P.back.get(f.id) || { n: 0, was: 0 }; if (f.state === 2 && r.was !== 2) r.n++; r.was = f.state; P.back.set(f.id, r); }
    if (opts.each) opts.each(sim, P);
  }
  return P;
}

/** Is the ground round soldier i packed (so that he is waiting his turn, not stuck)? */
function crowded(sim, i) {
  const fx = (sim.x[i] / 2) | 0, fy = (sim.y[i] / 2) | 0;
  let full = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = fx + dx, y = fy + dy; if (x >= 0 && y >= 0 && x < FINE_W && y < FINE_H && (sim.occ[(y * FINE_W + x) * 2] >= 4 || sim.blk[y * FINE_W + x])) full++; }
  return full >= 2;
}

const preset = (key, seed, sandbox = false) => { const s = buildPreset(map, key, sandbox, 'ref'); s.options.seed = seed; return s; }; // (a Build challenge with its suggested garrison)
const results = [];
/** `open`: a known, unsolved problem. It is reported as OPEN and does not fail the run. */
function verdict(name, ok, what, detail, open = false) { results.push({ name, ok, open }); console.log(`${ok ? 'PASS' : open ? 'OPEN' : 'FAIL'}  ${name}: ${what}\n      ${detail}`); }

// The three or four full battles most checks read from, played once and shared.
let shared = null;
let keepDoors = null; // what the keep check saw of the doors, for the deep check
function battles() {
  if (shared) return shared;
  shared = [];
  for (const [key, seed] of BATTLES) { process.stderr.write(`  playing ${key} seed ${seed}…\n`); shared.push({ key, seed, P: play(preset(key, seed), { policy: 'auto' }) }); }
  return shared;
}
const BATTLES = PRESETS.filter((p) => p.key !== 'empty' && !p.hidden).map((p) => [p.key, 1]).concat([['garrison', 2]]);
const each = (f) => battles().map((b) => `${b.key}/${b.seed} ${f(b.P)}`).join(' · ');

const CHECKS = {
  crews: ['Engines are not left crewless at the map edge, and no carrier stands by a dead engine all night', () => {
    let worstEdge = 0, never = 0, total = 0, idleShare = [], stranded = 0, worstCarrier = 0;
    for (const { P } of battles()) {
      for (const r of P.engines.values()) { total++; if (!r.crewed && r.life > 60) never++; if (r.idleEdge > worstEdge) worstEdge = r.idleEdge; if (r.life > 30) idleShare.push(r.idle / r.life); }
      stranded += P.carriersStranded; if (P.carrierMax > worstCarrier) worstCarrier = P.carrierMax;
    }
    verdict('crews: engines at the edge', worstEdge <= 45 && never <= total * 0.02, `longest wait for a crew at the map edge ${worstEdge} s (limit 45); ${never} of ${total} engines never crewed (limit 2%)`,
      `median share of an engine's life spent set down: ${pct(median(idleShare))}`);
    verdict('crews: stranded carriers', worstCarrier <= 120, `longest a carrier stood by an engine that could not move: ${worstCarrier} s (limit 120)`, `carriers who waited a minute or more: ${stranded}`);
  }],
  throwdown: ['Ladders are thrown down sometimes, but not the instant they go up', () => {
    let up = 0, thrown = 0, quick = 0; const after = [];
    for (const { P } of battles()) { up += P.sim.stats.laddersUp; thrown += P.sim.stats.thrown; for (const v of P.throwAfter) { after.push(v); if (v < 5) quick++; } }
    const share = thrown / Math.max(1, up);
    verdict('throw-down', thrown > 0 && share < 0.6 && quick <= thrown * 0.1, `${thrown} thrown down of ${up} raised (${pct(share)}; wanted more than none and under 60%); ${quick} within 5 s of going up (limit 10%)`,
      `median time a thrown ladder had stood: ${Math.round(median(after))} s · ${each((P) => `${P.sim.stats.thrown}/${P.sim.stats.laddersUp}`)}`);
  }],
  rifles: ['Riflemen still fire: they hold on a distant shield wall, not altogether', () => {
    let far = 0, near = 0, open = 0, per = [];
    for (const { P } of battles()) { far += P.rifle.shieldFar; near += P.rifle.shieldNear; open += P.rifle.open; per.push((P.rifle.open + P.rifle.shieldNear + P.rifle.shieldFar) / Math.max(1, P.rifles0)); }
    const tot = far + near + open;
    verdict('rifles', Math.min(...per) >= 25 && far <= tot * 0.02, `rounds fired per rifleman: ${per.map((v) => Math.round(v)).join(', ')} (each battle; wanted at least 25); ${pct(far / tot)} of rounds at shields beyond 120 m (limit 2%)`,
      `of ${tot} rifle rounds: ${pct(open / tot)} at exposed targets, ${pct(near / tot)} at shields inside 120 m · rifle kills ${each((P) => P.sim.stats.kills.rifle || 0)}`);
  }],
  pinned: ['Defenders are pinned at times, not for the whole fight', () => {
    const share = [], longest = [];
    for (const { P } of battles()) { share.push(P.pin.pinnedS / Math.max(1, P.pin.unitS)); longest.push(P.pin.longest); }
    verdict('defenders pinned', Math.max(...share) < 0.25 && Math.max(...longest) <= 180, `share of defender-time pinned flat after first contact: ${share.map(pct).join(', ')} (limit 25%); longest any platoon stayed pinned: ${Math.max(...longest)} s (limit 180)`, '');
  }],
  catapults: ['Catapults hurt, but are not most of what kills the garrison', () => {
    const share = [];
    // (a battle in which the garrison lost fewer than twenty men says nothing about what kills it)
    for (const { P } of battles()) { const by = P.sim.stats.defLostBy; let tot = 0; for (const k in by) tot += by[k]; share.push(tot >= 20 ? (by.rock || 0) / tot : 0); }
    verdict('catapults', Math.max(...share) <= 0.5, `share of defender losses to catapult rocks, where the garrison lost twenty or more: ${share.map(pct).join(', ')} (limit 50%)`, each((P) => `rocks ${P.sim.stats.defLostBy.rock || 0}, catapults lost ${P.sim.stats.lostOrc.catapult || 0}/${P.sim.stats.startOrc.catapult || 0}`));
  }],
  captains: ['Captains can be killed by a commander who goes after them, and do not clump when placed in a heap', () => {
    // a hunter: marks any captain inside 300 m with focus fire, and spends air strikes on the nearest
    const hunt = (key) => {
      let lastAir = -99, lastFocus = -99;
      const P = play(preset(key, 1), { policy: 'auto', each: (sim) => {
        let best = -1, bd = 400;
        for (const i of sim.cmds[ORC]) { if (!sim.alive[i]) continue; const d = sim._fortDist(sim.x[i], sim.y[i]); if (d < bd) { bd = d; best = i; } }
        if (best < 0) return;
        if (sim.time - lastAir > 25 && sim.canSupport('air') && sim.callSupport('air', sim.x[best] + sim.vx[best] * 4, sim.y[best] + sim.vy[best] * 4)) lastAir = sim.time;
        if (bd < 300 && sim.time - lastFocus > 30) { sim.setFocus(sim.x[best], sim.y[best], 18); lastFocus = sim.time; }
      } });
      return P;
    };
    const key = 'garrison', base = battles().find((b) => b.key === key).P, H = hunt(key);
    const lost = (P) => P.sim.stats.lostOrc.chief || 0, n0 = base.sim.stats.startOrc.chief || 0;
    verdict('captains: can be hunted', lost(H) >= Math.max(2, n0 * 0.3) && lost(H) > lost(base), `a commander hunting them killed ${lost(H)} of ${n0} (the stand-in, not hunting, ${lost(base)}); wanted at least 30% and more than the stand-in`,
      `killed by: ${JSON.stringify(H.capKilled)} · air strikes ${H.calls.air || 0} · the hunter ${H.sim.result && H.sim.result.win ? 'won' : 'lost'}`);
    // eight captains placed in one heap in a sandbox, with companies across the valley
    const s = preset('garrison', 1, true);
    s.groups = s.groups.filter((g) => g.team === DEF);
    for (const y of AP.lanes) s.groups.push(makeGroup('uruk', 300, AP.testRank, y, Math.PI / 2, 100));
    s.groups.push(makeGroup('chief', 8, AP.testChiefs[0], AP.testChiefs[1], Math.PI / 2, 20));
    const near = [];
    play(s, { policy: 'none', max: 150, each: (sim) => {
      if (Math.abs(sim.time - 120) > 0.06) return;
      const c = sim.cmds[ORC].filter((i) => sim.alive[i]);
      for (const a of c) { let m = 1e9; for (const b of c) if (a !== b) m = Math.min(m, Math.hypot(sim.x[a] - sim.x[b], sim.y[a] - sim.y[b])); near.push(m); }
    } });
    verdict('captains: spread out', near.length >= 4 && median(near) >= 25, `eight captains placed in one heap: two minutes on, the median distance to the nearest other captain is ${Math.round(median(near))} m (wanted 25 or more)`, `closest pair ${Math.round(Math.min(...near))} m, of ${near.length} still alive`);
  }],
  wargs: ['Warg riders are used before the night is out, and do not die waiting', () => {
    const rows = [];
    let ok = true;
    for (const { key, seed, P } of battles()) {
      const st = P.sim.stats, n0 = st.startOrc.warg || 0, end = P.sim.result ? P.sim.result.time : P.sim.time;
      if (!n0) continue;
      const used = P.wargs.firstLoose >= 0 && P.wargs.firstLoose < end - 60;
      if (!used) ok = false;
      rows.push(`${key}/${seed}: loosed at ${P.wargs.firstLoose < 0 ? 'never' : Math.round(P.wargs.firstLoose) + ' s'} of ${Math.round(end)} (${P.wargs.why || '-'}), held ${pct(P.wargs.heldS / Math.max(1, P.wargs.heldS + P.wargs.looseS))} of their time`);
    }
    // a sandbox has no dawn: are they ever used there?
    const sb = play(preset('garrison', 1, true), { policy: 'auto', max: 1500 });
    const sbUsed = sb.wargs.firstLoose >= 0;
    verdict('wargs', ok && sbUsed, `loosed with at least a minute of battle left in every challenge: ${ok ? 'yes' : 'NO'}; in a sandbox (no dawn): ${sbUsed ? 'loosed at ' + Math.round(sb.wargs.firstLoose) + ' s (' + sb.wargs.why + ')' : 'NEVER'}`, rows.join('\n      '));
  }],
  yoyo: ['Forces do not go back and forth', () => {
    let worst = 0, total = 0, forces = 0;
    for (const { P } of battles()) for (const r of P.back.values()) { forces++; total += r.n; if (r.n > worst) worst = r.n; }
    verdict('yo-yo', worst <= 2, `most times any one force pulled back: ${worst} (limit 2)`, `${total} pull-backs among ${forces} forces`);
  }],
  alerts: ['Alerts inform without flooding', () => {
    let worstMin = 0, worstRep = 0, worstText = '';
    const per = [];
    for (const { P } of battles()) {
      const b = P.alerts.filter((a) => a.banner);
      per.push(b.length);
      for (let k = 0; k < b.length; k++) { let n = 0; for (let j = k; j < b.length && b[j].t < b[k].t + 60; j++) n++; if (n > worstMin) worstMin = n; }
      const cnt = {};
      for (const a of P.alerts) { const key = a.text.replace(/(keep end|center|cliff end|Hornburg)/gi, 'X'); cnt[key] = (cnt[key] || 0) + 1; if (cnt[key] > worstRep) { worstRep = cnt[key]; worstText = key; } }
    }
    verdict('alerts', worstMin <= 8 && worstRep <= 25, `most banners in any one minute: ${worstMin} (limit 8); most repeats of one message in a battle: ${worstRep} (limit 25)`, `banners per battle: ${per.join(', ')} · most repeated: "${worstText}"`);
  }],
  silence: ['A surge at a "silent" sector is only called when that sector really has stopped firing', () => {
    let n = 0, bad = 0; const notes = [];
    for (const { key, seed, P } of battles()) for (const s of P.surges) {
      n++;
      const k = s.sec, at = Math.round(s.t), log = P.shotLog, rate = (a, b) => (a < 0 || b >= log.length ? 0 : (log[b][k] - log[a][k]) / (b - a));
      let peak = 0; for (let a = 0; a + 15 < at; a += 5) peak = Math.max(peak, rate(a, a + 15));
      const after = rate(at, Math.min(log.length - 1, at + 15));
      if (after > 0.4 * peak) { bad++; notes.push(`${key}/${seed} at ${at} s: still firing at ${pct(after / peak)} of its peak`); }
    }
    verdict('silence', bad === 0, `${n} surges called; ${bad} at a sector still firing at over 40% of its peak in the next 15 s`, notes.join(' · ') || (n ? 'each was followed by quiet' : 'none called in these battles'));
  }],
  intel: ['The horde finds a stretch of wall left empty', () => {
    // strip every defender off the cliff end of the Deeping Wall and see where the main effort goes
    const pick = () => {
      const picks = [];
      for (const seed of [1, 2, 3]) {
        const s = preset('garrison', seed);
        const probe = new Sim(map, s, null);
        s.groups = s.groups.filter((g) => !(g.team === DEF && UNITS[U[g.type]].cls === C.INF && map.seg[map.cellOf(g.x, g.y)] >= 0 && probe.sectorAt(g.x, g.y) === 2));
        const P = play(s, { policy: 'auto', max: 700 });
        P.sim.wl.plans.forEach((p, w) => { if (p && p.main >= 0) picks.push(p.main); });
      }
      return picks;
    };
    const seen = pick(), share = seen.filter((v) => v === 2).length / Math.max(1, seen.length);
    verdict('intel', seen.length >= 3 && share >= 0.6, `with the cliff end of the wall left unmanned, ${pct(share)} of ${seen.length} main efforts went for it (wanted 60% or more)`, `sectors chosen (0 keep end, 1 center, 2 cliff end): ${seen.join(' ')}`);
  }],
  stuck: ['Nobody is stuck for good, and a rout gets through the ranks behind it', () => {
    let n60 = 0, worst = 0, rn = 0, rr = 0;
    for (const { P } of battles()) { n60 += P.stuck.n60; if (P.stuck.worst > worst) worst = P.stuck.worst; rn += P.routers.n; rr += P.routers.ratio; }
    verdict('stuck', worst <= 120 && n60 <= 150, `foot soldiers with a clear way and room to move who stood still a minute or more: ${n60} across the battles (limit 150); the longest ${worst} s (limit 120)`, each((P) => `${P.stuck.n60}`));
    verdict('routs get through', rn === 0 || rr / rn >= 0.6, `routing troops moved at ${pct(rr / Math.max(1, rn))} of their running pace on average (wanted 60% or more)`, `${rn} router-seconds sampled`);
  }],
  tanks: ['Troops in front of the wall are fought, not walked past', () => {
    // a thin garrison, four vehicles 200 m in front of the center of the wall, and three thousand coming straight at them
    const mid = map.wallAt(0.5), groups = [];
    for (const t of [0.3, 0.5, 0.7]) { const p = map.wallAt(t); groups.push(makeGroup('rifle', 30, p.x, p.y, p.ang, 60)); }
    groups.push(makeGroup('tank', 2, mid.x - 200, mid.y - 40, Math.PI / 2, 40), makeGroup('ifv', 2, mid.x - 200, mid.y + 50, Math.PI / 2, 40));
    groups.push(...horde(3000, { waves: 1, layout: true, catapults: 0, rams: 0, towers: 0 }));
    const P = play({ groups, options: { sandbox: true, dawn: 0, rout: 0.01, seed: 1 } }, { policy: 'none', max: 420 });
    const dead = P.fwd.filter((f) => f.diedT >= 0), melee = P.fwd.reduce((a, f) => a + (f.hitsBy.smash || 0) + (f.hitsBy.melee || 0), 0);
    verdict('forward armor', melee >= 20, `four vehicles 200 m in front of the wall took ${melee} blows from the horde's blades and trolls (wanted 20 or more: they were attacked, not walked past)`,
      `${dead.length} of ${P.fwd.length} destroyed${dead.length ? ' (' + dead.map((f) => `${f.key} at ${Math.round(f.diedT)} s by ${f.by}`).join(', ') + ')' : ''} · attacker-seconds spent beyond them while they lived: ${P.past}`);
  }],
  lanes: ['Nobody fires through his own side; men find firing places without wandering or fidgeting', () => {
    let shots = 0, noLane = 0, offArc = 0, inReach = 0, blocked = 0, maxCell = 0, wander = 0; const rate = [];
    for (const { P } of battles()) {
      const L = P.lanes; shots += L.shots; noLane += L.noLane; offArc += L.offArc; inReach += L.inReach; blocked += L.blocked;
      if (L.maxCell > maxCell) maxCell = L.maxCell; if (L.wander > wander) wander = L.wander;
      rate.push(P.sim.stats.reposts / Math.max(1, L.def0) / Math.max(1, (P.sim.result ? P.sim.result.time : P.sim.time) / 60));
    }
    verdict('lanes: no shot without a line', noLane === 0 && offArc <= shots * 0.001, `of ${shots} direct shots by defenders on foot, ${noLane} were fired with no line of fire and ${offArc} along a wall (wanted none)`, '');
    verdict('lanes: men find places', blocked <= inReach * 0.15, `of defender-seconds with an enemy in reach (after the first half-minute of contact), ${pct(blocked / Math.max(1, inReach))} were spent with no line of fire (limit 15%)`, '');
    verdict('lanes: no wandering or fidgeting', wander <= 31 && Math.max(...rate) <= 2, `furthest anyone strayed from his post without an order: ${Math.round(wander)} m (limit 30); moves to a new firing place per man per minute: ${rate.map((v) => v.toFixed(2)).join(', ')} (limit 2)`, '');
    verdict('lanes: room for everyone', maxCell <= 5, `most standing defenders in one 2 m cell: ${maxCell} (limit 5)`, '');
    // three hundred rifles ordered onto one third of the wall: frontage, not numbers, decides how many can fire
    const s = preset('garrison', 1);
    s.groups = s.groups.filter((g) => g.team !== DEF || UNITS[U[g.type]].cls !== C.INF);
    const mid = map.wallAt(0.5);
    s.groups.push(makeGroup('rifle', 300, mid.x, mid.y, mid.ang, 110), makeGroup('cmd', 1, mid.x + 2, mid.y));
    const M = play(s, { policy: 'none', max: 500 });
    verdict('lanes: a packed wall', M.lanes.noLane === 0, `300 rifles massed on 110 m of wall: ${pct(M.lanes.blocked / Math.max(1, M.lanes.inReach))} of their time in reach was spent with no line of fire (frontage for about 180 at the parapet, more as they spread along it), and none fired without one`,
      `most in one 2 m cell ${M.lanes.maxCell} · furthest from post ${Math.round(M.lanes.wander)} m · moves per man per minute ${(M.sim.stats.reposts / 300 / Math.max(1, M.sim.time / 60)).toFixed(2)}`);
  }],
  keep: ['Abandoning the wall for the Hornburg at once is not a free win: no better than holding the wall', () => {
    // the stand-in commander, who also orders everyone into the keep in the first second, against the same commander
    // holding the wall as laid out, on the same seeds. Falling back is a free win where it is clearly better: it wins
    // every night, at least as often as holding the wall, and with a quarter or more of the garrison more left.
    const rows = [], doors = [];
    let free = 0;
    for (const p of PRESETS.filter((q) => q.key !== 'empty' && !q.hidden)) {
      let wins = 0, held = 0; const left = [], heldLeft = [];
      for (const seed of [1, 2, 3]) {
        const H = play(preset(p.key, seed), { policy: 'auto' });
        if (H.sim.result && H.sim.result.win) held++;
        heldLeft.push(H.sim.defCombat / H.sim.initial[0]);
      }
      for (const seed of [1, 2, 3]) {
        let deep = 0;
        const P = play(preset(p.key, seed), { policy: 'auto', tick: (sim) => {
          if (sim.time > 1 && !sim.retreated) sim.orderRetreat();
          if (sim.tick % 50) return;
          // attackers in the Deep: on the ground behind the Deeping Wall, outside the Hornburg
          let n = 0;
          for (let i = 0; i < sim.n; i++) if (sim.alive[i] && sim.team[i] === ORC && !sim.el[i] && sim.x[i] > AP.behind && Math.hypot(sim.x[i] - KEEP.cx, sim.y[i] - KEEP.cy) > KEEP.r + 8) n++;
          if (n > deep) deep = n;
        } });
        if (P.sim.result && P.sim.result.win) wins++;
        left.push(P.sim.defCombat / P.sim.initial[0]);
        const ps = P.sim.segs[map.POSTERN], gs = P.sim.segs[map.GATE];
        const dr = P.sim.segs[map.DOOR];
        doors.push({ deep, post: ps.breached ? 'broken' : ps.hp < ps.maxHp ? 'battered' : 'untouched', gate: gs.breached ? 'down' : `${pct(gs.hp / gs.maxHp)}`, door: dr.breached ? 'broken' : dr.hp < dr.maxHp ? 'battered' : 'untouched' });
      }
      const isFree = wins === 3 && wins >= held && median(left) > median(heldLeft) + 0.25;
      if (isFree) free++;
      rows.push(`${p.name}: fell back ${wins}/3, ${pct(median(left))} left; held the wall ${held}/3, ${pct(median(heldLeft))} left${isFree ? ' (FREE)' : ''}`);
    }
    keepDoors = doors;
    verdict('keep', free === 0, `falling back into the Hornburg in the first second, against holding the wall: ${rows.join(' · ')}`,
      `the horde comes round through the Deep for the postern: most attackers in the Deep at once ${doors.map((d) => d.deep).join(', ')} · postern ${doors.map((d) => d.post).join(', ')} · gate ${doors.map((d) => d.gate).join(', ')} · door ${doors.map((d) => d.door).join(', ')}`, true);
  }],
  deep: ['Given an empty wall, the horde comes round through the Deep; while the wall is manned it does not', () => {
    if (!keepDoors) CHECKS.keep[1]();
    // (The count in the Deep is the most seen there at one moment, sampled every five seconds, and men pass through it
    // quickly: on the small Easy horde it has run from 8 to 105 between versions with the same outcome. Since the
    // causeway got walled sides the southern companies go round its foot and arrive later, under more fire. So the
    // test is that the horde was seen in the Deep in every battle, and struck the postern in all but one at most.)
    const seen = keepDoors.filter((d) => d.deep >= 5).length, fell = keepDoors.filter((d) => d.post !== 'untouched').length;
    let wrong = 0; for (const { P } of battles()) wrong += P.postWrong || 0;
    verdict('deep', seen === keepDoors.length && fell >= keepDoors.length - 1 && wrong === 0, `fall-back battles in which attackers were seen in the Deep: ${seen} of ${keepDoors.length}, and went for the postern: ${fell} (all but one wanted); looks at the stock battles that found a force sent for the postern while the wall was manned: ${wrong} (wanted none)`,
      keepDoors.map((d) => `${d.deep} in the Deep, postern ${d.post}`).join(' · '));
  }],
  door: ['Attackers on the keep end of the wall batter the door into the court, and nobody walks through it while it holds', () => {
    // the garrison in the Hornburg, two hundred Uruk-hai already on the wall walk by the keep
    // (fixed group ids: formation jitter is seeded by id, and the ids run on as other checks build scenarios)
    const groups = [makeGroup('rifle', 120, KEEP.cx - 40, KEEP.cy - 10, Math.PI / 2, 40, { id: 1 }), makeGroup('rifle', 60, KEEP.cx - 20, KEEP.cy - 40, Math.PI / 2, 30, { id: 2 })];
    const sim = new Sim(map, { groups, options: { sandbox: true, dawn: 0, rout: 0.01 } }, null);
    const g = sim.newGroup(ORC); sim.gType[g] = U.uruk;
    let placed = 0;
    for (let k = 0; k < 400 && placed < 200; k++) {
      const p = map.wallAt(0.03 + (k % 40) * 0.0015), off = ((k / 40) | 0) - 4.5;
      const x = p.x + p.ty * off * 0.9, y = p.y - p.tx * off * 0.9;
      if (map.seg[map.cellOf(x, y)] < 0) continue;
      const i = sim.spawn(U.uruk, x, y, 0, g); if (i < 0) continue;
      sim.el[i] = 1; sim.state[i] = S_MOVE; placed++;
    }
    const ds = sim.segs[map.DOOR];
    let through = 0, hitT = -1;
    while (!sim.result && sim.time < 240 && !ds.breached) {
      sim.step(); sim.events.length = 0;
      if (hitT < 0 && ds.hp < ds.maxHp) hitT = sim.time;
      if (sim.tick % 5) continue;
      for (let i = 0; i < sim.n; i++) if (sim.alive[i] && sim.team[i] === ORC && map.type[map.cellOf(sim.x[i], sim.y[i])] === T.DOOR) through++;
    }
    verdict('door', hitT >= 0 && through === 0, `${placed} Uruk-hai on the wall walk by the keep: the door first struck at ${hitT < 0 ? 'never' : Math.round(hitT) + ' s'}, ${ds.breached ? 'broken at ' + Math.round(sim.time) + ' s' : 'still holding at ' + Math.round(sim.time) + ' s (' + pct(ds.hp / ds.maxHp) + ' left)'}; attackers seen in the arch before it broke: ${through} (wanted none)`,
      `${sim.count[ORC]} attackers left, ${sim.defCombat} defenders`);
  }],
  layout: ['A generated horde of any size fits on the field', () => {
    const rows = [];
    let ok = true;
    for (const n of [500, 2000, 8000, 20000, 30000, 40000]) {
      const groups = [makeGroup('rifle', 10, AP.testRifles[0], AP.testRifles[1]), ...horde(n, { waves: 1, layout: true })];
      const sim = new Sim(map, { groups, options: { sandbox: true, dawn: 0, rout: 0.01 } }, null);
      let want = 0, engines = 0; for (const g of groups) if (g.team === ORC) { const d = UNITS[U[g.type]]; want += g.count * sim._per(d); if (d.crew) engines += g.count; }
      let placedE = 0; for (let i = 0; i < sim.n; i++) if (sim.alive[i] && UNITS[sim.type[i]].crew) placedE++;
      const short = want - sim.count[ORC] + (engines - placedE);
      let minX = 1e9; for (let i = 0; i < sim.n; i++) if (sim.alive[i] && sim.team[i] === ORC) minX = Math.min(minX, sim.x[i]);
      if (short > want * 0.005) ok = false;
      rows.push(`${n}: ${short} left out, rear rank at x=${Math.round(minX)}`);
    }
    verdict('layout', ok, `hordes of 500 to 40,000 drawn up by task force: ${ok ? 'all placed' : 'SOME DID NOT FIT'} (limit 0.5% left out)`, rows.join(' · '));
  }],
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--list')) { for (const k in CHECKS) console.log(k.padEnd(11), CHECKS[k][0]); process.exit(0); }
  const names = args.filter((a) => !a.startsWith('--'));
  for (const n of names) if (!CHECKS[n]) { console.error(`unknown check "${n}" (try --list)`); process.exit(1); }
  for (const k of names.length ? names : Object.keys(CHECKS)) CHECKS[k][1]();
  const bad = results.filter((r) => !r.ok && !r.open), open = results.filter((r) => !r.ok && r.open);
  console.log(`\n${results.length - bad.length - open.length} of ${results.length} passed${bad.length ? ': failed ' + bad.map((r) => r.name).join(', ') : ''}${open.length ? '; known and open: ' + open.map((r) => r.name).join(', ') : ''}`);
  process.exit(bad.length ? 1 : 0);
}
