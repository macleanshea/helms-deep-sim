// Does pointing at the picture still find the right place and the right soldiers?
//
//   node tools/uicheck.js
//
// Loads the game in headless Chromium (Playwright, software rendering) and checks, at a spread of
// zooms, headings and tilts: that a ground point projected to the screen and picked again comes back
// to itself; that the pointer's world position (what orders and placement use) follows; and that a
// box drawn round defenders in battle selects them. Exits 1 on any failure.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url)), port = 5193;
let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); }
catch { console.error('tools/uicheck.js needs Playwright where Node can find it.'); process.exit(2); }
const server = spawn(process.execPath, [path.join(root, 'server.js'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
const verdict = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/?q=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && window.__ui && window.__renderer, null, { timeout: 120000 });
  await page.evaluate(() => { document.getElementById('wlChallenge').click(); });
  const cam = await import(new URL('../src/render/camera.js', import.meta.url));
  // 1. project, then pick: the same ground point comes back (flat ground in front of the wall, and the court)
  const views = [];
  for (const zoom of [0.9, 6, 36, 80]) for (const yaw of [1.2, 3.4]) for (const tilt of [0, 0.4]) views.push({ zoom, yaw, tilt });
  let worst = 0, worstAt = '', n = 0;
  for (const v of views) {
    for (const [x, y] of [[640, 470], [820, 380], [300, 600]]) {
      const got = await page.evaluate(async ({ v, x, y }) => {
        const app = window.__app, c = app.cam;
        c.x = x + 3; c.y = y - 2; c.zoom = v.zoom; c.yaw = v.yaw; c.tilt = v.tilt;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { cam: { x: c.x, y: c.y, z: c.z, zoom: c.zoom, yaw: c.yaw, tilt: c.tilt }, vw: innerWidth, vh: innerHeight, gz: app.map.groundZ(x, y) };
      }, { v, x, y });
      // the page's camera, rebuilt here (without the mountain test, which flat ground does not need)
      const s = cam.toScreen(got.cam, got.vw, got.vh, x, y, got.gz, [0, 0, 0]);
      if (!s[2] || s[0] < 330 || s[0] > got.vw - 350 || s[1] < 70 || s[1] > got.vh - 20) continue; // off screen or under a panel
      await page.mouse.move(s[0], s[1]);
      const m = await page.evaluate(() => ({ x: window.__app.mouse.wx, y: window.__app.mouse.wy }));
      const err = Math.hypot(m.x - x, m.y - y); n++;
      if (err > worst) { worst = err; worstAt = `zoom ${v.zoom} yaw ${v.yaw} tilt ${v.tilt} at ${x},${y}`; }
    }
  }
  verdict('a ground point projected to the screen is picked again', n >= 12 && worst < 0.5, `${n} points over ${views.length} views: worst error ${worst.toFixed(3)} m (limit 0.5)${worst >= 0.5 ? ' — ' + worstAt : ''}`);

  // 2. in battle, a box drawn on screen selects the defenders inside it and no others
  await page.evaluate(async () => {
    const app = window.__app;
    app.loadPreset('garrison', false, true); app.startBattle();
    app.paused = true;
    const c = app.cam; c.x = 955; c.y = 440; c.zoom = 10; c.yaw = 1.2; c.tilt = 0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
  });
  await page.waitForTimeout(600);
  const box = [380, 150, 900, 600];
  await page.mouse.move(box[0], box[1]); await page.mouse.down(); await page.mouse.move(box[2], box[3], { steps: 6 }); await page.mouse.up();
  const res = await page.evaluate(async (box) => {
    const app = window.__app, sim = app.sim, mod = await import('./src/render/camera.js');
    const inside = new Set();
    for (let i = 0; i < sim.n; i++) {
      if (!sim.alive[i] || sim.team[i] !== 0) continue;
      const p = mod.toScreen(app.cam, innerWidth, innerHeight, sim.x[i], sim.y[i], sim.unitZ(i) + 1, [0, 0, 0]);
      if (p[2] && p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3]) inside.add(i);
    }
    const got = new Set(app.selection);
    let missed = 0, extra = 0;
    for (const i of inside) if (!got.has(i)) missed++;
    for (const i of got) if (!inside.has(i)) extra++;
    return { want: inside.size, got: got.size, missed, extra };
  }, box);
  // (the game may leave out what cannot be commanded, such as field works: allow a handful either way)
  verdict('a box drawn in battle selects the defenders inside it', res.got >= 3 && res.missed <= Math.max(3, res.want * 0.1) && res.extra <= 3, `${res.got} selected; ${res.want} defenders stand inside the box; ${res.missed} of those not selected, ${res.extra} selected from outside it`);
  verdict('no errors on the page', !errors.length, errors.length ? errors.slice(0, 4).join(' | ') : 'none');
} finally {
  await browser.close(); server.kill();
}
process.exit(failed ? 1 : 0);
