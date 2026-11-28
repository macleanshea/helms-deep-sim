// Generate a humanoid unit's model with Meshy, from its concept prompt to the game's files.
//
//   node tools/assets/generate.js <unit>
//
// The steps, each skipped if it has already been done (the state is kept in assets-src/<unit>/state.json, and every
// paid task's id is written there the moment it is issued, so running this again never pays for the same thing twice):
//   1. a concept sheet from tools/assets/concepts/<unit>.prompt.txt and the unit's portrait (OpenAI image API)
//   2. Meshy: image to 3D, remesh to 10,000 triangles, rigging, and the clips the recipe orders by catalogue id
//   3. tools/assets/import.js and tools/assets/build.js
//
// It needs the two services reachable and their keys supplied by the environment (in a Claude Code cloud session the
// proxy adds them; elsewhere set MESHY_API_KEY and OPENAI_API_KEY), and the recipe tools/assets/units/<unit>.json with at
// least: height, lods, order ({ clip name: Meshy action id }), and optionally portrait, conceptSize, gear, loops.
// Costs, as Meshy's price list stood in November 2026: 30 credits a model, 5 to remesh, 5 to rig, 3 a clip.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)), root = path.resolve(here, '../..');
const unit = process.argv[2];
if (!unit) { console.error('usage: node tools/assets/generate.js <unit>'); process.exit(2); }
const recipeFile = path.join(here, 'units', `${unit}.json`), recipe = JSON.parse(fs.readFileSync(recipeFile, 'utf8'));
const work = path.join(root, 'assets-src', unit); fs.mkdirSync(work, { recursive: true });
const stateFile = path.join(work, 'state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { tasks: { anims: {} }, done: {} };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
const log = (s) => console.log(`[${unit}] ${s}`);
const env = { ...process.env, MESHY_API_KEY: process.env.MESHY_API_KEY || 'msy_proxy-injected', NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' };

/** Run the Meshy CLI and return its v1 result (throws with its error message otherwise). */
function meshy(args) {
  const r = spawnSync('npm', ['exec', '--yes', '--package=meshy-cli@0.4.0', '--', 'meshy', ...args, '--output-schema', 'v1', '--format', 'json', '--no-update-check'], { env, encoding: 'utf8', maxBuffer: 64 << 20 });
  let out; try { out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { throw new Error(`meshy ${args.slice(0, 2).join(' ')}: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`); }
  if (!out.ok) throw new Error(`meshy ${args.slice(0, 2).join(' ')}: ${out.error ? out.error.message : 'failed'}`);
  return out.result;
}
/** Issue a task once (its id is saved before anything else happens), then wait for it. */
function task(key, resource, createArgs, slot = state.tasks) {
  if (!slot[key]) {
    const r = meshy([resource, 'create', ...createArgs, '--async']);
    slot[key] = r.submission.task_id; save();
    log(`${resource} ${key}: issued ${slot[key]}`);
  }
  const id = slot[key];
  if (!state.done[id]) {
    let t;
    for (let tries = 0; tries < 6; tries++) { // a wait that times out is not a failure: the task goes on, and the same wait takes it up again
      try { t = meshy([resource, 'wait', id, '--timeout', '900', '--project', state.project, '--stage', key, '--workspace', work]).task; break; }
      catch (e) { if (!/timeout|timed out/i.test(e.message) || tries === 5) throw e; }
    }
    if (t.status !== 'SUCCEEDED') throw new Error(`${resource} ${key} ended ${t.status}`);
    state.done[id] = { credits: t.consumed_credits ?? null }; save();
    log(`${resource} ${key}: done (${t.consumed_credits ?? '?'} credits)`);
  }
  return id;
}
const download = (id, selector, file) => {
  if (fs.existsSync(file)) return;
  meshy(['download', '--task-json', path.join(state.project, `task_${id}.json`), ...selector, '--output', file, '--project', state.project, '--stage', 'download', '--workspace', work]);
};

// ---- 1. concept sheet
// (a unit with tools/assets/concepts/<unit>.text.txt has no sheet: its model is made from that description alone, see below)
const textFile = path.join(here, 'concepts', `${unit}.text.txt`), fromText = fs.existsSync(textFile);
const concept = path.join(work, 'concept.png'), keep = path.join(here, 'concepts', `${unit}.jpg`);
if (!fromText && !fs.existsSync(concept)) {
  const prompt = fs.readFileSync(path.join(here, 'concepts', `${unit}.prompt.txt`), 'utf8').trim();
  const portrait = path.join(root, recipe.portrait || `assets/units/${unit}.webp`), ref = path.join(work, 'portrait.png');
  execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert("RGB").save(sys.argv[2])', portrait, ref]);
  const out = path.join(work, 'concept.json');
  execFileSync('curl', ['-sS', '-m', '400', 'https://api.openai.com/v1/images/edits', '-H', `Authorization: Bearer ${process.env.OPENAI_API_KEY || 'proxy-injected'}`,
    '-F', `model=${recipe.conceptModel || 'gpt-image-2'}`, '-F', `image[]=@${ref}`, '--form-string', `prompt=${prompt}`, '-F', `size=${recipe.conceptSize || '1024x1536'}`, '-F', 'quality=high', '-o', out]);
  const d = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (!d.data) throw new Error(`concept: ${JSON.stringify(d).slice(0, 300)}`);
  fs.writeFileSync(concept, Buffer.from(d.data[0].b64_json, 'base64')); fs.unlinkSync(out);
  execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert("RGB").save(sys.argv[2], "JPEG", quality=86)', concept, keep]);
  log('concept sheet drawn');
}
if (process.argv.includes('--concept-only')) process.exit(0);

// ---- 2. Meshy
// (a beast or a machine gets no rig from Meshy, which rigs only two-legged figures: its bones are made in the import)
const fixed = recipe.quadruped ? 'quadruped' : recipe.rigid ? 'rigid' : null;
if (fromText && !state.tasks.preview) {
  // text to 3D is two tasks: a shape (preview), then its colours (refine, the task kept as "model")
  const r = meshy(['text-to-3d', 'create', '--mode', 'preview', '--prompt', fs.readFileSync(textFile, 'utf8').trim().slice(0, 600), '--async']);
  state.tasks.preview = r.submission.task_id; save();
  log(`text-to-3d preview: issued ${state.tasks.preview}`);
}
if (!fromText && !state.tasks.model) {
  const r = meshy(['image-to-3d', 'create', '--image-url', concept, '--model-type', 'standard', '--should-texture', 'true', '--enable-pbr', 'true', '--texture-resolution', '2k', ...(fixed ? [] : ['--pose-mode', 'a-pose']), '--target-formats', 'glb', '--async']);
  state.tasks.model = r.submission.task_id; save();
  log(`image-to-3d: issued ${state.tasks.model}`);
}
if (!state.project) {
  state.project = meshy(['project', 'init', '--root', path.join(work, 'meshy_output'), '--name', unit, '--task-id', fromText ? state.tasks.preview : state.tasks.model, '--task-type', fromText ? 'text-to-3d' : 'image-to-3d', '--workspace', work]).project_dir; save();
}
const model = fromText
  ? task('model', 'text-to-3d', ['--mode', 'refine', '--preview-task-id', task('preview', 'text-to-3d', []), '--texture-resolution', '2k', '--target-formats', 'glb', '--project', state.project, '--stage', 'refine', '--workspace', work])
  : task('model', 'image-to-3d', []);
const remesh = task('remesh', 'remesh', ['--input-task-id', model, '--topology', 'triangle', '--target-polycount', '10000', '--target-formats', 'glb', '--project', state.project, '--stage', 'remesh', '--workspace', work]);
if (fixed) {
  const file = path.join(work, 'model.glb');
  download(remesh, ['--asset', 'model.glb'], file);
  download(model, ['--asset', 'thumbnail.primary'], path.join(work, 'preview.png'));
  recipe[fixed].file = path.relative(root, file);
  recipe.source = fromText ? { generator: 'meshy', prompt: `tools/assets/concepts/${unit}.text.txt`, tasks: { 'text-to-3d': model, remesh } } : { generator: 'meshy', concept: path.relative(root, keep), prompt: `tools/assets/concepts/${unit}.prompt.txt`, tasks: { 'image-to-3d': model, remesh } };
  fs.writeFileSync(recipeFile, JSON.stringify(recipe, null, 2) + '\n');
  execFileSync(process.execPath, [path.join(here, 'import.js'), unit], { stdio: 'inherit' });
  if (!process.argv.includes('--no-build')) execFileSync(process.execPath, [path.join(here, 'build.js'), unit], { stdio: 'inherit' });
  log(`finished: ${Object.values(state.done).reduce((a, d) => a + (d.credits || 0), 0)} Meshy credits in all`);
  process.exit(0);
}
const rig = task('rig', 'rigging', ['--input-task-id', remesh, '--height-meters', String(recipe.height), '--project', state.project, '--stage', 'rig', '--workspace', work]);
const files = { rig: path.join(work, 'rigged.glb'), walk: path.join(work, 'walk.glb'), run: path.join(work, 'run.glb') };
download(rig, ['--asset', 'result.rigged_character_glb_url'], files.rig);
download(rig, ['--asset', 'result.basic_animations.walking_glb_url'], files.walk);
download(rig, ['--asset', 'result.basic_animations.running_glb_url'], files.run);
download(model, ['--asset', 'thumbnail.primary'], path.join(work, 'preview.png'));
// issue every clip first, then wait for them one by one: they are made side by side
for (const [name, action] of Object.entries(recipe.order || {})) {
  if (!state.tasks.anims[name]) {
    state.tasks.anims[name] = meshy(['animate', 'create', '--rig-task-id', rig, '--action-id', String(action), '--project', state.project, '--stage', `clip-${name}`, '--workspace', work, '--async']).submission.task_id; save();
    log(`clip ${name} (action ${action}): issued ${state.tasks.anims[name]}`);
  }
}
for (const name of Object.keys(recipe.order || {})) {
  const id = task(name, 'animate', [], state.tasks.anims);
  files[name] = path.join(work, `${name}.glb`);
  download(id, ['--asset', 'result.animation_glb_url'], files[name]);
}

// ---- 3. into the repository, and into the game
const LOOPS = new Set(recipe.loops || ['idle', 'walk', 'run', 'shield', 'carry', 'push', 'climb']), NO_GAIT = new Set(['idle', 'climb']);
const rel = (f) => path.relative(root, f);
recipe.rig = rel(files.rig);
recipe.clips = ['idle', 'walk', 'run', ...Object.keys(recipe.order || {}).filter((n) => n !== 'idle')].filter((n) => files[n]).map((n) => ({ name: n, file: rel(files[n]), loop: LOOPS.has(n), ...(NO_GAIT.has(n) ? { gait: false } : {}) }));
recipe.source = { generator: 'meshy', concept: rel(keep), prompt: `tools/assets/concepts/${unit}.prompt.txt`, tasks: { 'image-to-3d': model, remesh, rigging: rig, animations: state.tasks.anims } };
fs.writeFileSync(recipeFile, JSON.stringify(recipe, null, 2) + '\n');
execFileSync(process.execPath, [path.join(here, 'import.js'), unit], { stdio: 'inherit' });
// (several of these can run side by side, but build.js rewrites one manifest: --no-build leaves that to a single run after)
if (!process.argv.includes('--no-build')) execFileSync(process.execPath, [path.join(here, 'build.js'), unit], { stdio: 'inherit' });
const spent = Object.values(state.done).reduce((a, d) => a + (d.credits || 0), 0);
log(`finished: ${spent} Meshy credits in all`);
