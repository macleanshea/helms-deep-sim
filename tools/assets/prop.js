// A sculpted piece of the fortress: the generator's shape, to be drawn with the game's own stone.
//
//   node tools/assets/prop.js <name>
//
// The model (tools/assets/src/<name>/, put there by import.js) is kept as its shape alone: places, normals, triangles,
// and for each place how light or dark the generator painted it there (its windows, joints and shaded hollows), as a
// share of the piece's average. The game lays its own stone over that, so a sculpted tower is as sharp as the walls
// beside it at any zoom. The file is small: 10 bytes a place, 2 an index.
//
//   assets/game/<name>-prop.<hash>.bin: "HDP1", uint32 length of a JSON header, the header, then
//     places x 3 int16 (x, y across; z up; the whole piece in a box 1 high standing on z = 0, centered on its axis),
//     places x 3 int8 normal, places x 1 uint8 shade (128 = the average), triangles x 3 uint16 (or uint32)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSource } from './source.js';

const here = fileURLToPath(new URL('.', import.meta.url)), OUT = path.resolve(here, '../../assets/game');
const name = process.argv[2];
if (!name) { console.error('usage: node tools/assets/prop.js <name>'); process.exit(2); }
const S = readSource(name), m = S.mesh, nv = m.pos.length / 3;
const raw = path.join(os.tmpdir(), `hd-prop-${process.pid}.rgb`);
const [sw, sh] = execFileSync('python3', ['-I', path.join(here, 'texture.py'), 'raw', S.colour, raw], { encoding: 'utf8' }).trim().split(' ').map(Number);
const px = fs.readFileSync(raw); fs.unlinkSync(raw);
const lumAt = (u, v) => { const x = Math.min(sw - 1, Math.max(0, Math.floor((u - Math.floor(u)) * sw))), y = Math.min(sh - 1, Math.max(0, Math.floor((v - Math.floor(v)) * sh))), o = (y * sw + x) * 3; return 0.3 * px[o] + 0.59 * px[o + 1] + 0.11 * px[o + 2]; };
// places: vertices that share a position (the generator splits them along its texture's seams)
const place = new Int32Array(nv), seen = new Map(), P = [], N = [], L = [], C = [];
for (let v = 0; v < nv; v++) {
  const k = `${Math.round(m.pos[v * 3] * 1e5)},${Math.round(m.pos[v * 3 + 1] * 1e5)},${Math.round(m.pos[v * 3 + 2] * 1e5)}`;
  let p = seen.get(k);
  if (p == null) { p = P.length / 3; seen.set(k, p); P.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]); N.push(0, 0, 0); L.push(0); C.push(0); }
  place[v] = p; for (let e = 0; e < 3; e++) N[p * 3 + e] += m.nrm[v * 3 + e];
  L[p] += lumAt(m.uv[v * 2], m.uv[v * 2 + 1]); C[p]++;
}
const np = P.length / 3;
let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], mean = 0;
for (let p = 0; p < np; p++) { for (let e = 0; e < 3; e++) { lo[e] = Math.min(lo[e], P[p * 3 + e]); hi[e] = Math.max(hi[e], P[p * 3 + e]); } L[p] /= C[p]; mean += L[p] / np; }
// the axis: the middle of the top fifth (a plinth or a buttress may be lopsided; the shaft is not), or for a piece that is
// no tower ("prop": { "center": "box" } in its recipe) the middle of its box
const recipe = JSON.parse(fs.readFileSync(path.join(here, 'units', `${name}.json`), 'utf8'));
let ax = 0, az = 0, an = 0; for (let p = 0; p < np; p++) if (P[p * 3 + 1] > lo[1] + 0.6 * (hi[1] - lo[1])) { ax += P[p * 3]; az += P[p * 3 + 2]; an++; }
ax /= an; az /= an;
if (recipe.prop && recipe.prop.centre === 'box') { ax = (lo[0] + hi[0]) / 2; az = (lo[2] + hi[2]) / 2; }
const H = hi[1] - lo[1];
let reach = 0, foot = 0; // how far the piece stands out from its axis, at most and in its lowest tenth
for (let p = 0; p < np; p++) { const r = Math.hypot(P[p * 3] - ax, P[p * 3 + 2] - az) / H; reach = Math.max(reach, r); if (P[p * 3 + 1] < lo[1] + 0.1 * H) foot = Math.max(foot, r); }
const Q = 32767 / Math.max(1, reach), pos = new Int16Array(np * 3), nrm = new Int8Array(np * 3), shade = new Uint8Array(np);
for (let p = 0; p < np; p++) {
  // the model's y is up and its z forward: the game's z is up
  pos[p * 3] = Math.round(((P[p * 3 + 2] - az) / H) * Q); pos[p * 3 + 1] = Math.round(((P[p * 3] - ax) / H) * Q); pos[p * 3 + 2] = Math.round(((P[p * 3 + 1] - lo[1]) / H) * 32767);
  const l = Math.hypot(N[p * 3], N[p * 3 + 1], N[p * 3 + 2]) || 1;
  nrm[p * 3] = Math.round((N[p * 3 + 2] / l) * 127); nrm[p * 3 + 1] = Math.round((N[p * 3] / l) * 127); nrm[p * 3 + 2] = Math.round((N[p * 3 + 1] / l) * 127);
  shade[p] = Math.max(0, Math.min(255, Math.round((L[p] / mean) * 128)));
}
const tris = [];
for (let t = 0; t < m.index.length; t += 3) { const a = place[m.index[t]], b = place[m.index[t + 1]], c = place[m.index[t + 2]]; if (a !== b && b !== c && a !== c) tris.push(a, b, c); } // (the turn of the axes above is a rotation: the winding stands)
const wide = np > 65535, index = wide ? Uint32Array.from(tris) : Uint16Array.from(tris);
const header = Buffer.from(JSON.stringify({ name, places: np, triangles: tris.length / 3, wide, xy: +(1 / Q).toFixed(9), reach: +reach.toFixed(4), foot: +foot.toFixed(4), box: [(lo[2] - az) / H, (hi[2] - az) / H, (lo[0] - ax) / H, (hi[0] - ax) / H].map((q) => +q.toFixed(4)), source: recipe.source || null })); // box: how far it reaches along the game's x (its depth) and y (its breadth), in heights
const pre = Buffer.alloc(8); pre.write('HDP1', 0, 'latin1'); pre.writeUInt32LE(header.length, 4);
const pad = (n) => Buffer.alloc((4 - (n & 3)) & 3);
const parts = [pre, header, pad(8 + header.length), Buffer.from(pos.buffer), pad(pos.byteLength), Buffer.from(nrm.buffer), pad(nrm.byteLength), Buffer.from(shade.buffer), pad(shade.byteLength), Buffer.from(index.buffer)];
const bin = Buffer.concat(parts), file = `${name}-prop.${crypto.createHash('sha256').update(bin).digest('hex').slice(0, 10)}.bin`;
for (const f of fs.readdirSync(OUT)) if (f.startsWith(`${name}-prop.`)) fs.unlinkSync(path.join(OUT, f));
fs.writeFileSync(path.join(OUT, file), bin);
const mf = path.join(OUT, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
manifest.props = manifest.props || {}; manifest.props[name] = { file, bytes: bin.length };
fs.writeFileSync(mf, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${name}: ${file} ${(bin.length / 1024).toFixed(0)} KB (${np} places, ${tris.length / 3} triangles; stands out ${reach.toFixed(3)} of its height at most, ${foot.toFixed(3)} at its foot)`);
