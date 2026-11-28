// Take a unit's rigged model and animation clips from the generator's .glb files into the repository's own
// compact source (tools/assets/src/<unit>/, see source.js), from which tools/assets/build.js makes the game's files.
//
//   node tools/assets/import.js uruk
//
// The unit's recipe (tools/assets/units/<unit>.json) says where the generator's files are: `rig`, and a `file`
// for each of `clips`. Those paths are outside the repository (assets-src/ is not committed), so this is run
// once, when the files have just been generated; after that the source in the repository is all that is needed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGlb, skinnedMesh, sampleClip, mul } from './glb.js';
import { writeSource } from './source.js';
import { quadruped } from './quadruped.js';
import { rigid } from './rigid.js';

const here = fileURLToPath(new URL('.', import.meta.url)), root = path.resolve(here, '../..'), FPS = 30;
/** A model's color texture as a JPEG worth keeping (1024 px at most). */
function colourOf(g, image) {
  if (image == null) return null;
  const tmp = path.join(os.tmpdir(), `hd-import-${process.pid}`), out = `${tmp}.jpg`;
  fs.writeFileSync(tmp, g.image(image).bytes);
  execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]).convert("RGB")\nif max(im.size) > 1024: im = im.resize((1024, 1024), Image.LANCZOS)\nim.save(sys.argv[2], "JPEG", quality=90)', tmp, out]);
  const bytes = fs.readFileSync(out); fs.unlinkSync(tmp); fs.unlinkSync(out);
  return bytes;
}
const report = (name, m, nj, clips) => {
  const dir = path.join(here, 'src', name), size = fs.readdirSync(dir).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
  console.log(`${name}: ${m.pos.length / 3} vertices, ${m.index.length / 3} triangles, ${nj} bones, ${clips.length} clips (${clips.map((c) => `${c.name} ${c.frames}`).join(', ')}) -> tools/assets/src/${name}/ ${(size / 1e6).toFixed(1)} MB`);
};
for (const name of process.argv.slice(2)) {
  const recipe = JSON.parse(fs.readFileSync(path.join(here, 'units', `${name}.json`), 'utf8')), src = (f) => path.resolve(root, f);
  if (recipe.quadruped) {
    // a beast the generator could not rig: its skeleton and clips are made here (see quadruped.js)
    const g = readGlb(src(recipe.quadruped.file)), q = quadruped(g, recipe.quadruped);
    writeSource(name, { mesh: q.mesh, clips: q.clips, fps: q.fps, colour: colourOf(g, q.image), note: recipe.source || null });
    report(name, q.mesh, q.mesh.skin.names.length, q.clips);
    continue;
  }
  if (recipe.rigid) {
    // a machine: a hull, and a turret if the recipe says where it begins (see rigid.js)
    const g = readGlb(src(recipe.rigid.file)), q = rigid(g, recipe.rigid);
    writeSource(name, { mesh: q.mesh, clips: q.clips, fps: q.fps, colour: colourOf(g, q.image), note: recipe.source || null });
    report(name, q.mesh, q.mesh.skin.names.length, q.clips);
    continue;
  }
  const g = readGlb(src(recipe.rig)), m = skinnedMesh(g), nj = m.skin.joints.length;
  const jointIndex = (re) => m.skin.names.findIndex((n) => re.test(n));
  const hips = Math.max(0, jointIndex(/hips|pelvis|root/i)), foot = jointIndex(/left.*foot|foot.*l$/i);
  const clips = [];
  for (const c of recipe.clips) {
    const cg = c.file ? readGlb(src(c.file)) : g, cm = c.file ? skinnedMesh(cg) : m;
    if (cm.skin.joints.length !== nj) throw new Error(`${name}: clip ${c.name} has a different skeleton`);
    const sm = sampleClip(cg, c.clip || 0, FPS), nf = c.loop ? sm.frames : sm.frames + 1;
    const skinAt = (f) => { const w = sm.world(Math.min(f, sm.frames)); return cm.skin.joints.map((node, j) => mul(w[node], Array.from(cm.skin.ibm.subarray(j * 16, j * 16 + 16)))); };
    const rows = []; for (let f = 0; f < nf; f++) rows.push(skinAt(f));
    // a walk that travels is made to walk on the spot: the game moves the soldier, and needs to know how far a cycle carries him
    let stride = 0;
    if (c.loop) {
      const end = skinAt(sm.frames)[hips], dz = end[14] - rows[0][hips][14], dx = end[12] - rows[0][hips][12];
      if (Math.hypot(dz, dx) > 0.15) { stride = Math.hypot(dz, dx); for (let f = 0; f < nf; f++) for (let j = 0; j < nj; j++) { rows[f][j][14] -= dz * (f / nf); rows[f][j][12] -= dx * (f / nf); } }
      else if (c.gait !== false && foot >= 0) {
        // on the spot already: a cycle carries him two steps, and a step is as long as a foot's swing fore and aft of the hips
        let a = 1e9, b = -1e9;
        for (let f = 0; f < nf; f++) { const w = sm.world(f), d = w[cm.skin.joints[foot]][14] - w[cm.skin.joints[hips]][14]; a = Math.min(a, d); b = Math.max(b, d); }
        stride = 2 * (b - a);
      }
    }
    const mats = new Float32Array(nf * nj * 16);
    rows.forEach((row, f) => row.forEach((M, j) => mats.set(M, (f * nj + j) * 16)));
    clips.push({ name: c.name, loop: !!c.loop, frames: nf, stride, mats });
  }
  writeSource(name, { mesh: m, clips, fps: FPS, colour: colourOf(g, m.baseColorImage), note: recipe.source || null });
  report(name, m, nj, clips);
}
