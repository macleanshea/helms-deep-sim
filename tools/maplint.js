// Map lint: is the battlefield still a place the battle can be fought on?
//
//   node tools/maplint.js            every assertion, then the map's measurements
//   node tools/maplint.js --json     the measurements as one JSON line (for diffing two layouts)
//
// It plays nothing: it builds the map, stands each preset's armies on it and solves a few paths.
// Run it after any change to the layout (src/map.js); `npm run checks` then says whether the siege
// still behaves, and `npm run matrix` whether it is still balanced. It exits 1 if anything fails.
import { buildMap } from '../src/map.js';
import { buildPreset, groupPositions, horde, makeGroup, PRESETS } from '../src/scenarios.js';
import { Sim } from '../src/sim/sim.js';
import { CELL, GW, GH, T, STEP, DEF, ORC, UNITS, U } from '../src/config.js';

const json = process.argv.includes('--json');
const map = buildMap();
const NC = GW * GH;
const results = [];
/** `open`: the failure is a known defect of the present map, listed in KNOWN below; reported, but not a failure. */
const check = (name, ok, detail, open = false) => { results.push({ name, ok, open: !ok && open }); if (!json) console.log(`${ok ? 'PASS' : open ? 'OPEN' : 'FAIL'}  ${name}\n      ${detail}`); };
// Defects of the map as it stands, found by this lint and left for the redesign to put right. Anything beyond these fails.
const KNOWN = {
  // the first wall section's foot is up on the Hornburg's rock shelf: no one can walk to it from the valley
  wallFeet: [0],
  // the wall walk does not carry over the door arch, and there is no stair east of it: this arc of the Hornburg's wall
  // (over the postern), and one section half sunk in the cliff, can be garrisoned at setup but not walked to or from
  ringWalks: [38, 39, 40, 41, 51, 67, 68, 69, 70, 71, 73],
};
const within = (ids, known) => ids.every((i) => known.includes(i));
const cellXY = (c) => [(c % GW) * CELL + CELL / 2, ((c / GW) | 0) * CELL + CELL / 2];

// ---- the armies fit --------------------------------------------------------------------------
{
  const rows = []; let ok = true;
  for (const p of PRESETS) {
    if (p.key === 'empty') continue;
    const setup = buildPreset(map, p.key, false);
    let want = 0, got = 0; const short = [];
    for (const g of setup.groups) {
      if (g.team === ORC && g.phase > 0) continue; // later waves wait off the map until the director brings them on
      const placed = Math.min(g.count, groupPositions(map, g, g.team === ORC).length / 2);
      want += g.count; got += placed;
      // defenders are placed by hand: every one must stand. A horde may lose the odd straggler to a rock.
      if (placed < g.count && (g.team === DEF || placed < g.count * 0.98)) short.push(`${g.type} ${placed}/${g.count} at ${Math.round(g.x)},${Math.round(g.y)}`);
    }
    if (short.length) ok = false;
    rows.push(`${p.key}: ${got}/${want}${short.length ? ' SHORT ' + short.slice(0, 4).join('; ') : ''}`);
  }
  check('every preset stands all its groups', ok, rows.join(' · '));
}
{
  const rows = []; let ok = true;
  for (const n of [500, 8000, 20000, 30000, 40000]) {
    const groups = [makeGroup('rifle', 10, map.rear[map.rear.length - 1].x, map.rear[map.rear.length - 1].y), ...horde(n, { waves: 1, layout: true })];
    const sim = new Sim(map, { groups, options: { sandbox: true, dawn: 0, rout: 0.01 } }, null);
    let want = 0, engines = 0, placedE = 0;
    for (const g of groups) if (g.team === ORC) { const d = UNITS[U[g.type]]; want += g.count * sim._per(d); if (d.crew) engines += g.count; }
    for (let i = 0; i < sim.n; i++) if (sim.alive[i] && UNITS[sim.type[i]].crew) placedE++;
    const short = want - sim.count[ORC] + (engines - placedE);
    if (short > want * 0.005) ok = false;
    rows.push(`${n}: ${short} left out`);
  }
  check('a horde of any size fits on the field', ok, rows.join(' · ') + ' (limit 0.5%)');
}

// ---- the fortress's parts ----------------------------------------------------------------------
const sim = new Sim(map, buildPreset(map, 'garrison', false), null);
const { mtype, mseg, cz, elev, portal } = sim;
const segs = map.segments, gate = segs[map.GATE], post = segs[map.POSTERN], door = segs[map.DOOR];
const walls = segs.filter((s) => s.kind === 'wall'), ring = segs.filter((s) => s.group === 1);
{
  const culv = segs[map.CULVERT];
  const doorCells = []; for (let c = 0; c < NC; c++) if (mtype[c] === T.DOOR) doorCells.push(c);
  const doorLinked = doorCells.some((c) => portal[c] !== 0);
  const bad = [];
  if (!culv.valid) bad.push('the culvert section is not a usable wall section');
  if (!gate.valid) bad.push('the gate section is not usable');
  if (!post.valid) bad.push('the postern section is not usable');
  if (mtype[map.cellOf(gate.ox, gate.oy)] !== T.ROAD) bad.push('the ground outside the gate is not road');
  if (!doorCells.length) bad.push('there is no door from the wall walk');
  else if (!doorLinked) bad.push('the door is not linked to a wall walk');
  if (door.kind !== 'door') bad.push('map.DOOR is not a door section');
  const shortSeg = walls.filter((s) => s.valid && (s.len < 8 || s.len > 12.5));
  if (shortSeg.length) bad.push(`${shortSeg.length} wall sections are outside 8-12.5 m`);
  check('gate, postern, door and culvert are in place', !bad.length,
    bad.length ? bad.join('; ') : `wall ${walls.filter((s) => s.valid).length}/${walls.length} sections usable (${walls[0].len.toFixed(1)} m each), ring ${ring.filter((s) => s.valid).length}/${ring.length}, ${doorCells.length} door cells`);
}
{
  // every flight of steps: a way on at the foot, and a link to a wall walk at the head
  const rows = []; let ok = true;
  map.stairs.forEach((st, k) => {
    let head = false, foot = false, n = 0;
    for (let c = 0; c < NC; c++) {
      if (mtype[c] !== T.STAIR) continue;
      const [x, y] = cellXY(c), rx = x - st.x, ry = y - st.y, a = rx * st.dx + ry * st.dy, p = -rx * st.dy + ry * st.dx;
      if (a < -CELL || a > st.len + CELL || Math.abs(p) > st.half + CELL) continue;
      n++;
      if (portal[c]) head = true;
      for (const d of [-1, 1, -GW, GW, -GW - 1, -GW + 1, GW - 1, GW + 1]) {
        const m = c + d; if (m < 0 || m >= NC) continue;
        if (mtype[m] !== T.STAIR && mtype[m] !== T.CLIFF && mseg[m] < 0 && Math.abs(cz[m] - cz[c]) <= STEP) foot = true;
      }
    }
    if (!head || !foot || !n) ok = false;
    rows.push(`${k}: ${n} cells${head ? '' : ' NO HEAD'}${foot ? '' : ' NO FOOT'}`);
  });
  check('every stair joins the ground to a wall walk', ok, rows.join(' · '));
}

// ---- ways through ------------------------------------------------------------------------------
const solve = (srcCells, nav, costOf) => {
  const cost = new Uint16Array(NC), dir = new Uint8Array(NC), src = Int32Array.from(srcCells);
  for (let c = 0; c < NC; c++) cost[c] = costOf(c);
  sim.solver.solve(cost, src, src.length, dir, nav);
  const seen = new Uint8Array(NC);
  for (let c = 0; c < NC; c++) if (dir[c] !== 255) seen[c] = 1;
  for (const s of srcCells) seen[s] = 1;
  return seen;
};
const gateCell = map.cellOf(gate.ox, gate.oy);
// heavy engines: as the sim routes a ram to the gate (no stairs, no walls, shallow steps only)
const heavy = solve([gateCell], sim.navHeavy, (c) => (mtype[c] === T.CLIFF || mtype[c] === T.STAIR || sim.orcBlock[c] || elev[c] ? 0 : 10));
// men on foot, attackers' rules with every wall standing
const footOrc = solve([gateCell], { cz, elev, portal, step: STEP }, (c) => (mtype[c] === T.CLIFF || sim.orcBlock[c] ? 0 : 10));
// the garrison's rules, from the court
let courtCell = -1; for (let c = 0; c < NC && courtCell < 0; c++) if (mtype[c] === T.COURT) courtCell = c;
const footDef = courtCell < 0 ? new Uint8Array(NC) : solve([courtCell], sim.navDef, (c) => (mtype[c] === T.CLIFF ? 0 : 10));
{
  const rows = []; let ok = true;
  for (const p of PRESETS) {
    if (p.key === 'empty') continue;
    const rams = buildPreset(map, p.key, false).groups.filter((g) => g.type === 'ram');
    const lost = rams.filter((g) => !heavy[map.cellOf(g.x, g.y)]);
    if (lost.length) ok = false;
    rows.push(`${p.key}: ${rams.length - lost.length}/${rams.length} rams`);
  }
  // and the road itself must be gentle enough for wheels
  let grade = 0; const cw = map.causeway;
  for (let i = 1; i < cw.length; i++) { const d = Math.hypot(cw[i].x - cw[i - 1].x, cw[i].y - cw[i - 1].y); grade = Math.max(grade, (Math.abs(map.rampZ(cw[i].t) - map.rampZ(cw[i - 1].t)) / d) * CELL); }
  if (grade > 1.6) ok = false;
  check('a ram can reach the gate from where it starts', ok, `${rows.join(' · ')} · steepest causeway step ${grade.toFixed(2)} m per cell (limit 1.6)`);
}
{
  // the horde must be able to walk from the valley mouth to the wall foot and the gate
  let field = 0, reach = 0;
  for (let gy = 0; gy < GH; gy++) { const c = gy * GW + 2; if (mtype[c] === T.GROUND || mtype[c] === T.WATER) { field++; if (footOrc[c]) reach++; } }
  const feet = walls.filter((s) => s.valid), cut = feet.filter((s) => !footOrc[map.cellOf(s.ox, s.oy)]).map((s) => s.id);
  check('the horde can walk from the valley mouth to the gate and to every wall section', field > 0 && reach === field && !cut.length,
    `${reach}/${field} cells of the entry edge lead to the gate; ${feet.length - cut.length}/${feet.length} wall feet reached${cut.length ? ' (not sections ' + cut.join(', ') + ')' : ''}`,
    field > 0 && reach === field && within(cut, KNOWN.wallFeet));
}
{
  // the garrison: court, every wall walk, the steps and the Deep are one connected place
  const walks = segs.filter((s) => s.valid && s.kind !== 'gate' && s.kind !== 'postern' && s.kind !== 'door');
  const cut = walks.filter((s) => !footDef[map.cellOf(s.x, s.y)]).map((s) => s.id), walkOk = walks.length - cut.length;
  const rearFoot = map.rear[map.rear.length - 1], deepOk = !!footDef[map.cellOf(rearFoot.x, rearFoot.y)];
  let stairs = 0, stairsOk = 0; for (let c = 0; c < NC; c++) if (mtype[c] === T.STAIR) { stairs++; if (footDef[c]) stairsOk++; }
  const slots = map.keepSlots.length, slotsOk = map.keepSlots.filter((s) => footDef[map.cellOf(s.x, s.y)]).length;
  const rest = courtCell >= 0 && deepOk && stairsOk === stairs && slotsOk === slots && slots >= 600;
  check('court, wall walks, steps and the Deep are connected for the garrison', rest && !cut.length,
    `${walkOk}/${walks.length} wall walks${cut.length ? ' (not sections ' + cut.join(', ') + ')' : ''} · ${stairsOk}/${stairs} stair cells · the Deep ${deepOk ? 'reached' : 'CUT OFF'} · ${slotsOk}/${slots} fall-back places (at least 600 wanted)`,
    rest && within(cut, KNOWN.ringWalks));
}
{
  // falling back must mean defending two short fronts: the postern is reached from the Deep, not from the valley
  // (the head of the rear ramp, where the sim sends attackers too: the section's own outside point is on the rock beside it)
  const head = map.rear[2], pc = map.cellOf(head.x, head.y);
  const ok = footDef[pc] && !footOrc[pc];
  check('the postern opens on the Deep, behind the wall', !!ok, `outside the postern: ${footDef[pc] ? 'reached by the garrison from the court' : 'NOT reachable by the garrison'}, ${footOrc[pc] ? 'OPEN to the valley with the wall standing' : 'closed to the valley while the wall stands'}`);
}

// ---- measurements --------------------------------------------------------------------------------
// ground a man could walk to from the valley mouth with the walls standing is "the field"; ground he reaches from the foot of the rear ramp is "the Deep"
const ground = (c) => (mtype[c] === T.CLIFF || elev[c] ? 0 : 10);
let west = -1; for (let gy = 0; gy < GH && west < 0; gy++) { const c = ((GH >> 1) + (gy & 1 ? -1 : 1) * ((gy + 1) >> 1)) * GW + 2; if (mtype[c] === T.GROUND) west = c; }
const rearFoot = map.rear[map.rear.length - 1];
const fieldSet = solve([west], { cz, elev, portal: new Uint8Array(NC), step: STEP }, ground);
const deepSet = solve([map.cellOf(rearFoot.x, rearFoot.y)], { cz, elev, portal: new Uint8Array(NC), step: STEP }, ground);
const area = (f) => { let n = 0; for (let c = 0; c < NC; c++) if (f(c)) n++; return n * CELL * CELL; };
const J = map.wallJoin, Tp = map.wallTop;
let deepDepth = 0, deepWidth = 0;
{
  // depth: how far behind the wall line the Deep's floor runs; width: its widest span across that axis
  const ax = Tp.y - J.y, ay = -(Tp.x - J.x), al = Math.hypot(ax, ay), nx = ax / al, ny = ay / al, tx = -ny, ty = nx;
  const sgn = (rearFoot.x - J.x) * nx + (rearFoot.y - J.y) * ny > 0 ? 1 : -1;
  const span = new Map();
  for (let c = 0; c < NC; c++) {
    if (!deepSet[c] || mtype[c] === T.COURT || mtype[c] === T.STAIR) continue;
    const [x, y] = cellXY(c), d = ((x - J.x) * nx + (y - J.y) * ny) * sgn, a = (x - J.x) * tx + (y - J.y) * ty;
    if (d > deepDepth) deepDepth = d;
    const k = Math.round(d / 16), s = span.get(k) || [1e9, -1e9]; s[0] = Math.min(s[0], a); s[1] = Math.max(s[1], a); span.set(k, s);
  }
  for (const s of span.values()) deepWidth = Math.max(deepWidth, s[1] - s[0]);
}
const ringLen = ring.reduce((a, s) => a + (s.valid ? s.len : 0), 0);
const M = {
  world: [GW * CELL, GH * CELL],
  wallLength: +map.wallLen.toFixed(1), wallSections: walls.length, wallHeight: walls[0].top, wallThickness: walls[0].half * 2,
  ringLengthStanding: +ringLen.toFixed(1), ringHeight: ring[0].top,
  causewayLength: +map.causeway.len.toFixed(1), causewayWidth: map.causeHalf * 2, rearRampLength: +map.rear.len.toFixed(1),
  fieldArea: area((c) => fieldSet[c]), deepArea: area((c) => deepSet[c] && mtype[c] !== T.COURT), courtArea: area((c) => mtype[c] === T.COURT),
  deepDepth: Math.round(deepDepth), deepWidth: Math.round(deepWidth),
  keepSlots: map.keepSlots.length, stairs: map.stairs.length,
  cells: Object.fromEntries(Object.entries(T).map(([k, v]) => [k.toLowerCase(), area((c) => mtype[c] === v) / (CELL * CELL)])),
};

const bad = results.filter((r) => !r.ok && !r.open), open = results.filter((r) => r.open);
if (json) console.log(JSON.stringify({ ok: !bad.length, failed: bad.map((r) => r.name), open: open.map((r) => r.name), ...M }));
else {
  const L = M.wallLength, r = (v) => (v / L).toFixed(2);
  console.log(`\nmeasurements (in brackets: as a share of the Deeping Wall's length)`);
  console.log(`  Deeping Wall   ${L} m in ${M.wallSections} sections, walk at ${M.wallHeight} m, ${M.wallThickness} m thick`);
  console.log(`  Hornburg wall  ${M.ringLengthStanding} m standing clear of the rock (${r(M.ringLengthStanding)}), walk at ${M.ringHeight} m`);
  console.log(`  causeway       ${M.causewayLength} m (${r(M.causewayLength)}), ${M.causewayWidth} m wide · rear ramp ${M.rearRampLength} m`);
  console.log(`  the field      ${(M.fieldArea / 1e4).toFixed(1)} ha in front of the wall`);
  console.log(`  the Deep       ${(M.deepArea / 1e4).toFixed(1)} ha, ${M.deepDepth} m deep (${r(M.deepDepth)}), ${M.deepWidth} m across at its widest (${r(M.deepWidth)})`);
  console.log(`  the court      ${M.courtArea} m², ${M.keepSlots} fall-back places`);
  console.log(`\n${results.length - bad.length - open.length} of ${results.length} passed${bad.length ? ': FAILED ' + bad.map((b) => b.name).join('; ') : ''}${open.length ? `; ${open.length} known and open` : ''}`);
}
process.exit(bad.length ? 1 : 0);
