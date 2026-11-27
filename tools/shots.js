// Fixed-camera screenshots of the game, for comparing one version's picture with another's.
//
//   node tools/shots.js                         every view, PNG, into ./shots
//   node tools/shots.js --out docs/baseline/shots --jpeg 80 --size 1600x900 --quality high
//   node tools/shots.js --only keep-z9,battle-*  these views only (a trailing * matches the rest of a name)
//   node tools/shots.js --compare docs/baseline/shots     shoot, then report how far each view differs
//   node tools/shots.js --no-battle             setup views only (much quicker)
//
// It serves the repository itself (server.js on a spare port) and drives headless Chromium through
// Playwright, which must be installed where Node can find it (`npm i -g playwright`, or NODE_PATH).
// Rendering is forced onto the software rasteriser so the same code gives the same pixels on any
// machine: the pictures say nothing about speed. The game's clock is held still while shooting, the
// quality level is pinned, and the battle views are reached by stepping the seeded simulation, so
// two runs of the same code agree pixel for pixel in the 3D scene.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = (k) => args.includes('--' + k);
const get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(get('out', path.join(root, 'shots')));
const [W, H] = get('size', '1280x720').split('x').map(Number);
const noAssets = flag('no-assets'); // the built-in models only
const quality = get('quality', 'medium'); // 'high' is four times the work for the software rasteriser: minutes a view
const jpeg = get('jpeg', null), ext = jpeg ? 'jpg' : 'png';
const only = get('only', '').split(',').filter(Boolean);
const compare = get('compare', null);
const port = +get('port', 5187);

/**
 * The views. `at` is [x, y, zoom, yaw?, tilt?] in world metres, px per metre and radians (null: the home view);
 * `ui` keeps the panels on screen. Battle views are taken `t` seconds into the named preset.
 */
const YAW = 1.2;
const SETUP = [
  ['setup-ui', null, { ui: true }],
  ['whole-map', null],
  ['keep-z4', [960, 710, 4]],
  ['keep-z9', [975, 725, 9]],
  ['keep-from-the-deep-z6', [985, 705, 6, YAW + Math.PI]],
  ['gate-causeway-z6', [820, 650, 6]],
  ['wall-stair-z14', [972, 560, 14]],
  ['wall-culvert-z5', [960, 440, 5]],
  ['the-deep-z3', [1180, 470, 3]],
  ['postern-z10', [1045, 660, 10, YAW + 2.2]],
  ['garrison-z36', [962, 500, 36]],
  ['hornburg-from-the-valley', [930, 705, 5.2, 1.35, -0.2]],
  ['hornburg-from-above-the-deep', [985, 715, 5, YAW + Math.PI, 0]],
  ['the-deep-from-the-wall', [1090, 480, 3.4, 1.57, -0.1]],
  ['postern-and-rear-ramp', [1046, 684, 13, YAW + 2.6, 0]],
  ['court-stairs', [948, 690, 11, 0.5, 0]],
  ['inner-courts', [976, 728, 6.5, 0.4, 0]],
  ['culvert-from-the-deep', [985, 452, 12, YAW + Math.PI, 0]],
  ['gatehouse', [872, 684, 12, YAW, 0]],
  ['low-toward-the-wall', [840, 470, 16, YAW, -0.14]],
  ['low-down-the-valley', [958, 430, 22, YAW + Math.PI, -0.12]],
];
const BATTLE = { preset: 'garrison', t: 420, views: [
  ['battle-whole-map', null],
  ['battle-wall-z8', [950, 440, 8]],
  ['battle-wall-foot-z20', [945, 470, 20]],
  ['battle-horde-z5', 'horde', 5],
  ['battle-horde-z16', 'horde', 16],
  ['battle-horde-z60', 'horde', 60],
] };

const HIDE_UI = '#topbar,#left,#right,#minimap,#feed,#banner,#hint,#cmdbar,#leftHud,#selinfo,#grpbar,#tooltip,#vignette,#coach,#modal,#perf,#perfCopy,#settingsMenu{display:none!important}';

function serve() {
  return new Promise((resolve, reject) => {
    const ch = spawn(process.execPath, [path.join(root, 'server.js'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let seen = '';
    const done = (d) => { seen += d; if (/http:\/\//.test(seen)) resolve(ch); };
    ch.stdout.on('data', done); ch.stderr.on('data', done);
    ch.on('exit', (c) => reject(new Error(`server.js exited (${c}): ${seen.trim()}`)));
    setTimeout(() => resolve(ch), 1500); // it may not announce itself; the page load will say if it is not there
  });
}

async function main() {
  let chromium;
  try { ({ chromium } = createRequire(import.meta.url)('playwright')); }
  catch { console.error('tools/shots.js needs Playwright where Node can find it (npm i -g playwright, or set NODE_PATH).'); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const fails = [];
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/?q=${quality}${noAssets ? '&assets=0' : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__app && window.__ui && window.__renderer, null, { timeout: 120000 });
    await page.evaluate(() => window.__app.assetsReady); // unit models from files, if any, are in before the first picture
    // hold the animation clock still (banners, water) and silence the things that move on their own
    await page.evaluate(() => {
      const app = window.__app;
      Object.defineProperty(app, 'clock', { get: () => 1000, set: () => {}, configurable: true });
      // the same "random" numbers every frame, so rain and the like are drawn alike however many frames have gone by
      let seed = 1;
      Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (f) => raf((t) => { seed = 20241; f(t); });
      // take the welcome screen's Challenge button: closing the dialog any other way resets the map to an empty sandbox
      const go = document.getElementById('wlChallenge'); if (go) go.click();
      window.__settle = (n) => new Promise((done) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : done()); f(); });
    });
    await page.addStyleTag({ content: HIDE_UI });
    const wanted = (name) => !only.length || only.some((o) => name === o || (o.endsWith('*') && name.startsWith(o.slice(0, -1))));
    const shoot = async (name, at, opts = {}) => {
      if (!wanted(name)) return;
      await page.evaluate(async ({ at, ui }) => {
        const app = window.__app;
        document.querySelectorAll('style').forEach((s) => { if (s.textContent.startsWith('#topbar,#left')) s.disabled = !!ui; });
        if (at) { app.cam.x = at[0]; app.cam.y = at[1]; app.cam.zoom = at[2]; app.cam.yaw = at[3] == null ? 1.2 : at[3]; app.cam.tilt = at[4] || 0; } else app.homeView();
        await window.__settle(3);
      }, { at, ui: opts.ui });
      const file = path.join(out, `${name}.${ext}`);
      await page.screenshot(jpeg ? { path: file, type: 'jpeg', quality: +jpeg } : { path: file });
      // what the view cost to draw: units in view, triangles spent on them, draw calls
      const st = await page.evaluate(() => { const r = window.__renderer, s = r.stats; return [s.units, Math.round((s.tris.units + s.tris.shadows) / 1000), s.draws, +r.lodBias.toFixed(2)]; });
      process.stdout.write(`  ${name.padEnd(26)} ${String(st[0]).padStart(6)} units  ${String(st[1]).padStart(5)}k unit triangles  ${String(st[2]).padStart(3)} draws${st[3] > 1 ? `  (detail pulled in x${st[3]})` : ''}\n`);
    };

    await page.evaluate(async () => { window.__app.loadPreset('garrison', false, true); await window.__settle(6); });
    console.log(`setup views (${W}x${H}) -> ${path.relative(process.cwd(), out) || '.'}`);
    for (const [name, at, opts] of SETUP) await shoot(name, at, opts);

    if (!flag('no-battle') && BATTLE.views.some(([n]) => wanted(n))) {
      console.log(`battle views: ${BATTLE.preset} at ${BATTLE.t} s`);
      const horde = await page.evaluate(async ({ preset, t }) => {
        const app = window.__app;
        app.loadPreset(preset, false, true); app.startBattle();
        if (app.mode !== 'battle') throw new Error('the battle did not start');
        app.paused = true;
        const sim = app.sim;
        while (sim.time < t && !sim.result) {
          for (let k = 0; k < 100 && sim.time < t && !sim.result; k++) { sim.step(); sim.events.length = 0; }
          if (app.fxq) app.fxq.replay(window.__fx); // the ground keeps the dead and the craters of the battle so far
          await new Promise((r) => setTimeout(r, 0));
        }
        // stepping the battle with the picture frozen piles up hours of muzzle flashes: clear them, then let a moment's worth happen
        window.__fx.reset();
        for (let k = 0; k < 6 && !sim.result; k++) { sim.step(); sim.events.length = 0; }
        if (app.fxq) app.fxq.replay(window.__fx);
        // the thickest of the horde, as the benchmark finds it
        const cells = new Map();
        for (let i = 0; i < sim.n; i++) if (sim.alive[i] && sim.team[i] === 1) { const k = ((sim.y[i] / 80) | 0) * 100 + ((sim.x[i] / 80) | 0); cells.set(k, (cells.get(k) || 0) + 1); }
        let bk = 0, bv = 0; for (const [k, v] of cells) if (v > bv) { bv = v; bk = k; }
        // the light eases from the setup's to the night's over a couple of dozen frames: let it arrive
        await window.__settle(36);
        return [(bk % 100) * 80 + 40, ((bk / 100) | 0) * 80 + 40];
      }, BATTLE);
      for (const [name, at, zoom] of BATTLE.views) await shoot(name, at === 'horde' ? [horde[0], horde[1], zoom] : at);
    }
    if (errors.length) { console.error('page errors:\n  ' + errors.slice(0, 8).join('\n  ')); fails.push('page errors'); }

    if (compare) {
      const ref = path.resolve(compare);
      console.log(`\ncompared with ${path.relative(process.cwd(), ref)} (share of pixels that differ by more than 2/255 · largest difference)`);
      const mime = (f) => (f.endsWith('.png') ? 'image/png' : 'image/jpeg');
      for (const f of fs.readdirSync(out).filter((n) => n.endsWith('.' + ext)).sort()) {
        const stem = f.slice(0, -ext.length - 1), other = ['png', 'jpg'].map((e) => path.join(ref, `${stem}.${e}`)).find((p) => fs.existsSync(p));
        if (!other) { console.log(`  ${stem.padEnd(28)} (no reference)`); continue; }
        const a = `data:${mime(f)};base64,${fs.readFileSync(path.join(out, f)).toString('base64')}`;
        const b = `data:${mime(other)};base64,${fs.readFileSync(other).toString('base64')}`;
        const r = await page.evaluate(async ([a, b]) => {
          const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
          const [ia, ib] = await Promise.all([load(a), load(b)]);
          if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
          const px = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
          const pa = px(ia), pb = px(ib);
          let n = 0, max = 0;
          for (let i = 0; i < pa.length; i += 4) { const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2])); if (d > 2) n++; if (d > max) max = d; }
          return { share: n / (pa.length / 4), max };
        }, [a, b]);
        if (r.size) { console.log(`  ${stem.padEnd(28)} sizes differ: ${r.size}`); fails.push(stem); continue; }
        console.log(`  ${stem.padEnd(28)} ${(r.share * 100).toFixed(3).padStart(8)}%   ${String(r.max).padStart(3)}`);
        if (r.share > +get('tolerance', 0)) fails.push(stem);
      }
      console.log(fails.length ? `\nDIFFERENT: ${fails.join(', ')}` : '\nidentical');
    }
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
