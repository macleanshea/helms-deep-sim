// Balance matrix: every preset x policy x seed, run in parallel, printed as a table.
//
//   node tools/matrix.js                       all challenge presets, policies none+auto, seeds 1-3
//   node tools/matrix.js --presets recon,garrison --seeds 5 --policies auto --opt cpRate=0.03
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const presets = get('presets', 'recon,three-hundred,garrison,combined').split(',');
const policies = get('policies', 'none,auto').split(',');
const seeds = Array.from({ length: +get('seeds', 3) }, (_, i) => i + 1);
const extra = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--opt' || args[i] === '--max') extra.push(args[i], args[i + 1]);

const jobs = [];
for (const p of presets) for (const pol of policies) for (const s of seeds) jobs.push({ p, pol, s });
const script = fileURLToPath(new URL('./headless.js', import.meta.url));

function run(job) {
  return new Promise((resolve) => {
    const ch = spawn(process.execPath, [script, '--preset', job.p, '--policy', job.pol, '--seed', String(job.s), '--json', ...extra]);
    let out = '', err = '';
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { err += d; });
    ch.on('close', () => { try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { resolve({ preset: job.p, policy: job.pol, seed: job.s, error: err.trim().split('\n').pop() || 'no output' }); } });
  });
}

const results = new Array(jobs.length);
let nextJob = 0;
async function worker() { while (nextJob < jobs.length) { const k = nextJob++; results[k] = await run(jobs[k]); process.stderr.write('.'); } }
await Promise.all(Array.from({ length: Math.max(1, Math.min(os.cpus().length, jobs.length)) }, worker));
process.stderr.write('\n');

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('preset', 15) + pad('policy', 8) + pad('seed', 5) + pad('result', 7) + pad('end', 12) + pad('defenders', 12) + pad('horde left', 13) + pad('gate', 7) + pad('ammo', 6) + pad('score', 7) + pad('cp', 14) + 'tick ms');
for (const r of results) {
  if (r.error) { console.log(pad(r.preset, 15) + pad(r.policy, 8) + pad(r.seed, 5) + 'ERROR ' + r.error); continue; }
  const frac = r.dawn ? ` (${(r.t / r.dawn).toFixed(2)})` : '';
  console.log(pad(r.preset, 15) + pad(r.policy, 8) + pad(r.seed, 5) + pad(r.win === null ? '—' : r.win ? 'WIN' : 'loss', 7) + pad(Math.round(r.t) + frac, 12)
    + pad(`${r.defEnd}/${r.def0}`, 12) + pad(`${r.orcEnd}/${r.orc0}`, 13) + pad(r.gateT < 0 ? '—' : r.gateT, 7) + pad(Math.round(r.ammoMin * 100) + '%', 6)
    + pad(r.score != null ? r.score : '—', 7) + pad(r.cp ? `${r.cp.spent}/${r.cp.earned}` : '—', 14) + `${r.tickAvg} / ${r.tickMax}`);
}
// one line per preset x policy
console.log('');
for (const p of presets) for (const pol of policies) {
  const rs = results.filter((r) => !r.error && r.preset === p && r.policy === pol);
  if (!rs.length) continue;
  const wins = rs.filter((r) => r.win).length;
  const med = (f) => { const v = rs.map(f).sort((a, b) => a - b); return v[v.length >> 1]; };
  console.log(`${pad(p, 15)}${pad(pol, 8)}wins ${wins}/${rs.length}   median end ${Math.round(med((r) => r.t))}s${rs[0].dawn ? ` (${med((r) => r.t / r.dawn).toFixed(2)} of dawn)` : ''}   median survivors ${Math.round(100 * med((r) => r.defEnd / r.def0))}%`);
}
