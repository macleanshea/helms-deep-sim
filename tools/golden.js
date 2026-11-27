// Golden hashes: proof that a refactor changed nothing.
//
//   node tools/golden.js              compare with docs/baseline/golden.json; exit 1 on any difference
//   node tools/golden.js --update     record the present code as the new reference
//   node tools/golden.js --quick      the map and fortress hashes only (a second or two)
//
// Three things are hashed: everything buildMap() returns that the game reads (nav grid, heights,
// wall sections, stairs, ramps, fall-back places), the fortress mesh the renderer raises from it,
// and the state of whole battles (each challenge with and without the stand-in commander, and the
// opening of the benchmark). The simulation is deterministic, so identical hashes mean an identical
// battle, tick for tick. A change that is meant to alter the map or the rules must re-record them.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMap } from '../src/map.js';
import { buildStructures } from '../src/render/structures.js';

const args = process.argv.slice(2);
const file = fileURLToPath(new URL('../docs/baseline/golden.json', import.meta.url));
const BATTLES = [
  ['first-night', 'none', 1, 2400], ['first-night', 'auto', 1, 2400],
  ['garrison', 'none', 1, 2400], ['garrison', 'auto', 1, 2400],
  ['three-hundred', 'none', 1, 2400], ['three-hundred', 'auto', 2, 2400],
  ['benchmark', 'none', 1, 400],
];

const sha = (parts) => { const h = createHash('sha256'); for (const p of parts) h.update(typeof p === 'string' ? p : Buffer.from(p.buffer, p.byteOffset, p.byteLength)); return h.digest('hex').slice(0, 16); };
/** JSON with numbers rounded to a micrometre, so a hash does not turn on the last bit of a sum. */
const plain = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : typeof x === 'function' ? undefined : x));

function mapHashes() {
  const map = buildMap();
  const grids = sha([map.type, map.seg, map.cz, map.gz, map.portal]);
  const terrain = sha([map.hm]);
  const lines = sha([plain({ segments: map.segments, stairs: map.stairs, causeway: [...map.causeway], causeLen: map.causeway.len, rear: [...map.rear], rearLen: map.rear.len,
    keepSlots: map.keepSlots, labels: map.labels, GATE: map.GATE, POSTERN: map.POSTERN, DOOR: map.DOOR, CULVERT: map.CULVERT, wallTop: map.wallTop, wallJoin: map.wallJoin, wallLen: map.wallLen,
    causeHalf: map.causeHalf, rearHalf: map.rearHalf })]);
  // sampled, as the callers use them: the wall curve, the stream, the ramp profile, the aircraft floor
  const fn = [];
  for (let i = 0; i <= 200; i++) { const p = map.wallAt(i / 200); fn.push(p.x, p.y, p.tx, p.ty, p.ang, map.rampZ(i / 200), map.streamY(i * 7.2)); }
  for (let y = -200; y <= 1160; y += 40) for (let x = -200; x <= 1640; x += 40) fn.push(map.airFloor(x, y), map.terrZ(x, y));
  const sampled = sha([plain(fn)]);
  const segs = map.segments.map((s) => ({ ...s, breached: false }));
  const whole = buildStructures(map, segs);
  // and with the culvert blown and the gate down, so the broken pieces are covered too
  for (const k of [map.CULVERT - 1, map.CULVERT, map.CULVERT + 1, map.GATE]) segs[k].breached = true;
  const broken = buildStructures(map, segs);
  return { 'map grids': grids, 'map terrain': terrain, 'map lines': lines, 'map functions': sampled,
    'fortress mesh': `${whole.count} ${sha([whole.data.subarray ? whole.data : new Uint8Array(whole.data)])}`,
    'fortress mesh, breached': `${broken.count} ${sha([broken.data.subarray ? broken.data : new Uint8Array(broken.data)])}` };
}

function battle([preset, policy, seed, max]) {
  return new Promise((resolve) => {
    const ch = spawn(process.execPath, [fileURLToPath(new URL('./headless.js', import.meta.url)), '--preset', preset, '--policy', policy, '--seed', String(seed), '--max', String(max), '--json']);
    let out = '', err = '';
    ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; });
    ch.on('close', () => {
      try { const r = JSON.parse(out.trim().split('\n').pop()); resolve(`${r.hash} ${r.win === null ? 'unfinished' : r.win ? 'win' : 'loss'} at ${r.t} s, ${r.defEnd}/${r.def0} v ${r.orcEnd}/${r.orc0}`); }
      catch { resolve(`ERROR ${err.trim().split('\n').pop() || 'no output'}`); }
    });
  });
}

const now = mapHashes();
if (!args.includes('--quick')) {
  const res = new Array(BATTLES.length); let next = 0;
  const worker = async () => { while (next < BATTLES.length) { const k = next++; res[k] = await battle(BATTLES[k]); process.stderr.write('.'); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(os.cpus().length, BATTLES.length)) }, worker));
  process.stderr.write('\n');
  BATTLES.forEach(([p, pol, seed, max], k) => { now[`battle ${p}, ${pol === 'auto' ? 'stand-in commander' : 'no orders'}, seed ${seed}${max < 2400 ? `, first ${max} s` : ''}`] = res[k]; });
}

if (args.includes('--update')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...old, ...now }, null, 2) + '\n');
  console.log(`recorded ${Object.keys(now).length} hashes in docs/baseline/golden.json`);
  process.exit(0);
}
if (!fs.existsSync(file)) { console.error('no docs/baseline/golden.json yet: run with --update'); process.exit(1); }
const ref = JSON.parse(fs.readFileSync(file, 'utf8'));
let bad = 0;
for (const k of Object.keys(now)) {
  const same = ref[k] === now[k];
  if (!same) bad++;
  console.log(`${same ? 'same     ' : 'DIFFERENT'}  ${k}${same ? '' : `\n             was ${ref[k]}\n             now ${now[k]}`}`);
}
console.log(bad ? `\n${bad} of ${Object.keys(now).length} differ` : `\nall ${Object.keys(now).length} identical`);
process.exit(bad ? 1 : 0);
