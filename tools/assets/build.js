// Build a unit's game files from its rigged, animated source models.
//
//   node tools/assets/build.js uruk            one unit (tools/assets/units/uruk.json)
//   node tools/assets/build.js                 every unit that has a recipe
//
// It works from the unit's source in tools/assets/src/<unit>/ (put there by tools/assets/import.js from the
// generator's files) and its recipe in tools/assets/units/<unit>.json (height, levels of detail, gear). The output, in
// assets/game/, is what the game loads: one pack per unit holding its levels of detail (finest first) and every clip
// as bone matrices sampled at a fixed rate, a small WebP of its colours, and a line in manifest.json.
// File names carry a hash of their contents, so they can be cached for ever.
//
// Needs nothing but Node and, for the texture, Python with Pillow (python3 -c "import PIL").
//
// The pack (little-endian): "HDU1", a JSON header's byte length, the header, then the data it points into.
//   vertices, 28 bytes each: position 3 x float32 (metres; +x forward, +y left, +z up, feet at the origin),
//     normal 3 x int8 and a pad byte, texture coordinate 2 x uint16, bones 4 x uint8, weights 4 x uint8
//   indices: uint16
//   animation: float32, 12 per bone per frame: the top three rows of the matrix that carries a vertex from
//     its rest place to its place in that frame (bone 0 first), frames of all clips one after another
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSource } from './source.js';
import { simplify } from './simplify.js';

const here = fileURLToPath(new URL('.', import.meta.url)), root = path.resolve(here, '../..');
const OUT = path.join(root, 'assets/game');
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);
const AX = [2, 0, 1]; // the game's x, y, z are the model file's z, x, y (it faces +z with +y up)

function buildUnit(name) {
  const recipe = JSON.parse(fs.readFileSync(path.join(here, 'units', `${name}.json`), 'utf8'));
  const S = readSource(name), m = S.mesh;
  const nv = m.pos.length / 3, nj = m.skin.names.length;
  if (nj > 64) throw new Error(`${name}: ${nj} bones (64 at most)`);

  // ---- rest pose into the game's space: upright, feet on the ground, the height the recipe asks for
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.pos[v * 3 + k]); hi[k] = Math.max(hi[k], m.pos[v * 3 + k]); }
  const s = recipe.height / (hi[1] - lo[1]), o = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) for (let e = 0; e < 3; e++) { P[v * 3 + e] = (m.pos[v * 3 + AX[e]] - o[AX[e]]) * s; N[v * 3 + e] = m.nrm[v * 3 + AX[e]]; }

  // ---- clips: bone matrices per frame, into the game's space
  const frames = [], clips = [];
  const jointIndex = (re) => m.skin.names.findIndex((n) => re.test(n));
  for (const c of S.clips) {
    const over = (recipe.clips || []).find((q) => q.name === c.name) || {};
    clips.push({ name: c.name, start: frames.length, frames: c.frames, loop: c.loop, fps: S.fps, stride: +((over.stride != null ? over.stride : c.stride * s)).toFixed(3) });
    for (let f = 0; f < c.frames; f++) {
      const out = new Float32Array(nj * 12);
      for (let j = 0; j < nj; j++) {
        const M = c.mats.subarray((f * nj + j) * 16, (f * nj + j) * 16 + 16);
        // t' = s C (R o + t - o); R' = C R C^-1
        const Ro = [M[0] * o[0] + M[4] * o[1] + M[8] * o[2], M[1] * o[0] + M[5] * o[1] + M[9] * o[2], M[2] * o[0] + M[6] * o[1] + M[10] * o[2]];
        for (let e = 0; e < 3; e++) {
          const ge = AX[e];
          for (let e2 = 0; e2 < 3; e2++) out[j * 12 + e * 4 + e2] = M[AX[e2] * 4 + ge];
          out[j * 12 + e * 4 + 3] = s * (Ro[ge] + M[12 + ge] - o[ge]);
        }
      }
      frames.push(out);
    }
  }

  // ---- gear: plain boxes that ride on one bone each (a blade in the hand, a shield on the forearm). They are added
  // to every level of detail after it is reduced, and coloured from the swatch strip the texture step appends.
  const strip = (recipe.gear || []).length > 0, vScale = strip ? 16 / 17 : 1;
  const restOf = (bone) => {
    // where a bone sits in the rest pose: the inverse of its inverse-bind matrix carries the origin there
    const b = m.skin.ibm.subarray(bone * 16, bone * 16 + 16), R = [b[0], b[1], b[2], b[4], b[5], b[6], b[8], b[9], b[10]], t = [b[12], b[13], b[14]];
    const p = [-(R[0] * t[0] + R[1] * t[1] + R[2] * t[2]), -(R[3] * t[0] + R[4] * t[1] + R[5] * t[2]), -(R[6] * t[0] + R[7] * t[1] + R[8] * t[2])]; // -R^T t (R is a rotation)
    const l = Math.hypot(b[0], b[1], b[2]) ** 2 || 1;
    return [0, 1, 2].map((e) => ((p[AX[e]] / l) - o[AX[e]]) * s);
  };
  const gear = []; // { bone, verts: [[x, y, z, nx, ny, nz]...], tris: [...], swatch }
  const box = (bone, swatch, c, ax, ay, az, far = false) => { // far: kept at the coarsest level of detail too
    // a box centred at c with half-axes ax, ay, az (vectors in game space)
    const verts = [], tris = [];
    for (const [n, u, v] of [[ax, ay, az], [ay, az, ax], [az, ax, ay]]) for (const sg of [1, -1]) {
      const l = Math.hypot(...n) || 1, nn = n.map((q) => (q / l) * sg), b0 = verts.length;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) verts.push([c[0] + n[0] * sg + u[0] * su + v[0] * sv, c[1] + n[1] * sg + u[1] * su + v[1] * sv, c[2] + n[2] * sg + u[2] * su + v[2] * sv, ...nn]);
      // wound so the face looks outward (u x v points along n for these three orderings)
      if (sg > 0) tris.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3); else tris.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2);
    }
    gear.push({ bone, swatch, verts, tris, far });
  };
  const SW = { iron: 0, wood: 1, leather: 2, paint: 3 };
  for (const it of recipe.gear || []) {
    const bone = jointIndex(new RegExp(`^${it.bone}$`, 'i'));
    if (bone < 0) throw new Error(`${name}: no bone "${it.bone}" for its ${it.kind}`);
    const h = restOf(bone);
    if (it.kind === 'sword') {
      // held point-up and forward: a grip, a cross-guard and a broad cleaver of a blade
      const L = it.length || 0.78, d = [0.62, 0, 0.78], side = [0, 1, 0], up = [-0.78, 0, 0.62];
      const along = (a, k) => a.map((q) => q * k), at = (k) => [h[0] + d[0] * k, h[1] + d[1] * k, h[2] + d[2] * k - 0.04];
      box(bone, SW.leather, at(0.02), along(d, 0.1), along(side, 0.02), along(up, 0.025));
      box(bone, SW.iron, at(0.13), along(d, 0.02), along(side, 0.03), along(up, 0.1));
      box(bone, SW.iron, at(0.15 + L / 2), along(d, L / 2), along(side, 0.012), along(up, 0.038), true);
    } else if (it.kind === 'shield') {
      // a tall board strapped to the outside of the forearm, an iron boss, a pale hand daubed on it
      const hand = restOf(jointIndex(/^lefthand$/i)), c = [(h[0] + hand[0]) / 2 + 0.03, (h[1] + hand[1]) / 2 + 0.07, (h[2] + hand[2]) / 2 + 0.05];
      const w = it.width || 0.3, t = it.height || 0.48, n = [0.25, 0.97, 0], f = [0.97, -0.25, 0];
      const along = (a, k) => a.map((q) => q * k);
      box(bone, SW.wood, c, along(n, 0.022), along(f, w), [0, 0, t], true);
      box(bone, SW.iron, [c[0] + n[0] * 0.04, c[1] + n[1] * 0.04, c[2]], along(n, 0.03), along(f, 0.08), [0, 0, 0.08]);
      box(bone, SW.paint, [c[0] + n[0] * 0.026, c[1] + n[1] * 0.026, c[2] + t * 0.5], along(n, 0.006), along(f, w * 0.45), [0, 0, t * 0.22]);
    } else throw new Error(`${name}: unknown gear "${it.kind}"`);
  }

  // ---- levels of detail
  const sections = [], lods = [];
  let offset = 0;
  const add = (buf) => { const at = offset; sections.push(buf); offset += buf.byteLength; const pad = (4 - (offset & 3)) & 3; if (pad) { sections.push(Buffer.alloc(pad)); offset += pad; } return at; };
  recipe.lods.forEach((target, level) => {
    const kit = gear.filter((q) => level < 3 || q.far), gearVerts = kit.reduce((a, q) => a + q.verts.length, 0), gearTris = kit.reduce((a, q) => a + q.tris.length / 3, 0);
    const want = Math.max(40, target - gearTris);
    const idx = want >= m.index.length / 3 ? m.index : simplify(m.pos, m.uv, m.index, want);
    const remap = new Int32Array(nv).fill(-1); let n = 0;
    for (const v of idx) if (remap[v] < 0) remap[v] = n++;
    if (n + gearVerts > 65535) throw new Error(`${name}: level ${level} has ${n + gearVerts} vertices (65535 at most)`);
    const infl = [4, 2, 1, 1][Math.min(level, 3)], vb = Buffer.alloc((n + gearVerts) * 28);
    for (let v = 0; v < nv; v++) {
      const k = remap[v]; if (k < 0) continue;
      const b = k * 28;
      for (let e = 0; e < 3; e++) { vb.writeFloatLE(P[v * 3 + e], b + e * 4); vb.writeInt8(Math.max(-127, Math.min(127, Math.round(N[v * 3 + e] * 127))), b + 12 + e); }
      const u = m.uv[v * 2] - Math.floor(m.uv[v * 2]), t = m.uv[v * 2 + 1] - Math.floor(m.uv[v * 2 + 1]);
      vb.writeUInt16LE(Math.round(u * 65535), b + 16); vb.writeUInt16LE(Math.round(t * vScale * 65535), b + 18);
      // the heaviest `infl` bones, their weights made to add up to 255
      const ws = [0, 1, 2, 3].map((q) => [m.weights[v * 4 + q], m.joints[v * 4 + q]]).sort((a, c) => c[0] - a[0]).slice(0, infl);
      const sum = ws.reduce((a, c) => a + c[0], 0) || 1;
      let left = 255;
      ws.forEach(([w, j], q) => { const wb = q === ws.length - 1 ? left : Math.min(left, Math.round((w / sum) * 255)); left -= wb; vb.writeUInt8(j, b + 20 + q); vb.writeUInt8(wb, b + 24 + q); });
    }
    const ib = Buffer.alloc((idx.length + gearTris * 3) * 2);
    idx.forEach((v, q) => ib.writeUInt16LE(remap[v], q * 2));
    let gv = n, gi = idx.length;
    for (const q of kit) {
      for (const t of q.tris) ib.writeUInt16LE(gv + t, (gi++) * 2);
      for (const v of q.verts) {
        const b = gv++ * 28;
        for (let e = 0; e < 3; e++) { vb.writeFloatLE(v[e], b + e * 4); vb.writeInt8(Math.round(v[3 + e] * 127), b + 12 + e); }
        vb.writeUInt16LE(Math.round(((q.swatch + 0.5) / 4) * 65535), b + 16); vb.writeUInt16LE(Math.round((16.5 / 17) * 65535), b + 18);
        vb.writeUInt8(q.bone, b + 20); vb.writeUInt8(255, b + 24);
      }
    }
    lods.push({ triangles: idx.length / 3 + gearTris, vertices: n + gearVerts, influences: infl, vertexOffset: add(vb), indexOffset: add(ib) });
  });
  const anim = Buffer.concat(frames.map((f) => Buffer.from(f.buffer, f.byteOffset, f.byteLength)));
  const animOffset = add(anim);

  // ---- colours
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.startsWith(`${name}.`)) fs.unlinkSync(path.join(OUT, f));
  let texFile = null;
  if (S.colour) {
    const tmp = S.colour, outTmp = path.join(os.tmpdir(), `hd-${name}-${process.pid}.webp`);
    execFileSync('python3', ['-I', path.join(here, 'texture.py'), tmp, outTmp, String(recipe.texture || 512), strip ? 'swatches' : 'plain'], { stdio: ['ignore', 'inherit', 'inherit'] });
    const bytes = fs.readFileSync(outTmp);
    texFile = `${name}.${hash(bytes)}.webp`;
    fs.writeFileSync(path.join(OUT, texFile), bytes);
    fs.unlinkSync(outTmp);
  }
  const header = Buffer.from(JSON.stringify({ name, height: recipe.height, bones: nj, boneNames: m.skin.names, fps: S.fps, frames: frames.length, clips, lods, animOffset, texture: texFile, source: recipe.source || null }));
  const pre = Buffer.alloc(8); pre.write('HDU1', 0, 'latin1'); pre.writeUInt32LE(header.length, 4);
  const headPad = Buffer.alloc((4 - ((8 + header.length) & 3)) & 3);
  const pack = Buffer.concat([pre, header, headPad, ...sections]);
  const packFile = `${name}.${hash(pack)}.bin`;
  fs.writeFileSync(path.join(OUT, packFile), pack);
  console.log(`${name}: ${packFile} ${(pack.length / 1024).toFixed(0)} KB (${lods.map((l) => `${l.triangles} tris / ${l.vertices} verts`).join(', ')}; ${nj} bones, ${frames.length} frames in ${clips.length} clips: ${clips.map((c) => `${c.name} ${c.frames}${c.stride ? ` stride ${c.stride} m` : ''}`).join(', ')})${texFile ? `, ${texFile} ${(fs.statSync(path.join(OUT, texFile)).size / 1024).toFixed(0)} KB` : ''}`);
  return { pack: packFile, texture: texFile, bytes: pack.length };
}

const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const all = fs.readdirSync(path.join(here, 'units')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const manifestFile = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { units: {} };
for (const n of names.length ? names : all) manifest.units[n] = buildUnit(n);
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
