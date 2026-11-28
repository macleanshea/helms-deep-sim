// Application glue: state machine (setup -> battle -> debrief), the camera, input,
// the frame loop and the 2D overlay (selection, cursors, markers, losses, minimap).

import { WORLD_W, WORLD_H, DT, DEF, ORC, UNITS, U, C, SUPPORT, WEAPONS, CAPTAIN_REACH, WALL_H, RING_TOP, WIRE_HP, AV_HP } from './config.js';
import { buildMap, KEEP, WALL_HALF } from './map.js';
import { buildPreset, makeGroup, groupPositions, groupBounds, forceCost, horde, PRESETS, wallPoint, wallRunLength, parapetAt } from './scenarios.js';
import { scoreBattle } from './score.js';
import { Sim, S_MOVE, LOSS_CELL, LOSS_W, LOSS_H } from './sim/sim.js';
import { SUPPLY_R } from './sim/support.js';
import { drawAtlas } from './render/atlas.js';
import { Renderer, HERO_SCALE_DEFAULT } from './render/renderer.js';
import { Perf } from './render/perf.js';
import { toScreen, toGround, pick, camState, DEFAULT_YAW } from './render/camera.js';
import { Fx } from './render/fx.js';
import { FxQueue } from './sim/fxqueue.js';
import { Audio } from './audio.js';
import { buildUI, fmt } from './ui/ui.js';
import { loadPortraits } from './ui/portraits.js';
import { loadUnitPacks } from './render/assets.js';
import { LAYOUT } from './layout.js';

const $ = (id) => document.getElementById(id);
const glCanvas = $('gl'), overlay = $('overlay'), octx = overlay.getContext('2d');
const mm = $('mm'), mctx = mm.getContext('2d');
const params = new URLSearchParams(location.search);

// Start-up runs in stages with a pause between them (top-level await), so the loading screen can repaint and show progress.
// The percentages are each stage's share of a measured start-up; see src/loading.js.
const portraits = {}, portraitsReady = loadPortraits().then((tiles) => Object.assign(portraits, tiles)); // fetched while the rest of start-up runs
const loading = window.__loading || { set: async () => {}, done: () => $('loading').classList.add('done') };
await loading.set(5);
const map = buildMap();
await loading.set(25);
const atlas = drawAtlas();
await loading.set(30);
let renderer;
try {
  renderer = new Renderer(glCanvas, map, atlas);
} catch (err) {
  $('loading').innerHTML = '<span>This game needs WebGL2, which this browser does not support.</span>';
  throw err;
}
await loading.set(60);
const audio = new Audio();
const fx = new Fx(audio);

// lighting moods: [ambient, sun/moon, fog, lift]
const MOOD = {
  setup: [[0.52, 0.54, 0.58], [0.9, 0.88, 0.83], [0.11, 0.13, 0.15], 0.03],
  night: [[0.3, 0.36, 0.54], [0.46, 0.53, 0.7], [0.025, 0.035, 0.06], 0.26],
  dawn: [[0.5, 0.4, 0.36], [1.05, 0.72, 0.5], [0.16, 0.12, 0.11], 0.04],
  day: [[0.53, 0.55, 0.58], [0.93, 0.9, 0.85], [0.12, 0.14, 0.16], 0.03],
};

const app = {
  fxq: new FxQueue(), // what the battle asks of the effects, between its steps and the frame that shows them
  fx,
  mode: 'setup', map, setup: null, sim: null, oobOpen: false, modeChosen: false,
  cam: { x: WORLD_W / 2, y: WORLD_H / 2, z: 0, zoom: 0.6, yaw: DEFAULT_YAW, tilt: 0 },
  speed: 1, paused: false, tool: null, brushCount: 50,
  selGroup: null, hoverGroup: null, selection: [], markers: [],
  previewDirty: false, clock: 0, acc: 0, slowT: 0, showLosses: false,
  overlay: { zones: false, ranges: false }, artyPanel: false,
  env: { amb: MOOD.setup[0].slice(), sun: MOOD.setup[1].slice(), fog: MOOD.setup[2].slice(), lift: 0.03, flash: 0, shadows: true },
  bolt: -1, nextBolt: 14,
  mouse: { sx: 0, sy: 0, wx: 0, wy: 0, wz: 0, inside: false },
  drag: null, keys: new Set(),
  alerts: [], alertIdx: 0, alertKeyT: -9,
  groups: {}, lastClick: { t: -9, type: -1 }, groupTap: { k: '', t: -9 },
};
let ui;
let dpr = 1, vw = 1, vh = 1;
const T2 = [0, 0, 0], T3 = [0, 0, 0], T4 = [0, 0, 0], RP = [0, 0, 0, 0];
const MAX_ZOOM = 90; // closest view (px per meter at the middle of the screen): a soldier stands a fifth of the screen high

// ------------------------------------------------------------------ camera
const heightAt = (x, y) => (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H ? 0 : app.sim ? app.sim.surfZ(x, y) : map.groundZ(x, y));
app.cam.ground = map.terrZ; // the camera stays clear of the mountainsides (walls it may look over or through)
/** World -> overlay pixels: [x, y, scale there in px per meter (0: behind the camera)]. Result is valid until the next call. */
const S = (x, y, z = 0) => toScreen(app.cam, vw, vh, x, y, z, T2);
/** How flat a circle lying on the ground at a point looks from the camera: 1 from straight above, near 0 edge on. */
const flatAt = (x, y, z) => { const q = camState(app.cam, vw, vh); return Math.max(0.04, (q.ez - z) / Math.hypot(x - q.ex, y - q.ey, z - q.ez)); };
/** How far above its center, in pixels, the far edge of a ground circle of radius r appears. */
const riseOf = (x, y, z, r) => { const a = S(x, y, z)[1], yaw = app.cam.yaw; return a - toScreen(app.cam, vw, vh, x + Math.sin(yaw) * r, y - Math.cos(yaw) * r, z, T4)[1]; };
const labXY = new Float32Array(160);
function pickAt(sx, sy) { const p = pick(app.cam, vw, vh, sx, sy, heightAt, T3); return { x: p[0], y: p[1], z: p[2] }; }
function insets() { return app.mode === 'setup' ? { l: 316, r: 336, t: 54, b: 0 } : { l: 0, r: 0, t: 54, b: 120 }; }
let fitKey = '', fitVal = 1;
/** The zoom at which the whole valley just fits between the panels at the present heading. */
function fitZoom() {
  const i = insets(), key = `${vw} ${vh} ${app.cam.yaw.toFixed(3)} ${i.l} ${i.r} ${i.t} ${i.b}`;
  if (key === fitKey) return fitVal;
  // a trial camera over the middle of the map, drawn in or out until the map's corners fit (the pitch changes with the zoom, so by steps)
  const c = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1, yaw: app.cam.yaw }, aw = Math.max(50, vw - i.l - i.r), ah = Math.max(50, vh - i.t - i.b);
  for (let k = 0; k < 10; k++) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, y] of [[0, 0], [WORLD_W, 0], [0, WORLD_H], [WORLD_W, WORLD_H]]) { const q = toScreen(c, vw, vh, x, y, 0, T4); if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    c.zoom *= Math.min(aw / (x1 - x0), ah / (y1 - y0));
  }
  fitKey = key;
  return (fitVal = c.zoom);
}
function fitCamera() {
  const i = insets(), c = app.cam;
  c.zoom = fitZoom() * 1.25; c.tilt = 0; c.x = WORLD_W / 2 + 60; c.y = WORLD_H / 2 + 20;
  // slide the view until that point sits in the middle of the space between the panels
  for (let k = 0; k < 3; k++) {
    const g = toGround(c, vw, vh, i.l + (vw - i.l - i.r) / 2, i.t + (vh - i.t - i.b) / 2, 0, T4);
    c.x += WORLD_W / 2 + 60 - g[0]; c.y += WORLD_H / 2 + 20 - g[1];
  }
}
function clampCam() {
  const c = app.cam;
  c.zoom = Math.max(fitZoom() * 0.8, Math.min(MAX_ZOOM, c.zoom));
  c.tilt = Math.max(-0.2, Math.min(0.75, c.tilt || 0));
  c.x = Math.max(-120, Math.min(WORLD_W + 120, c.x)); c.y = Math.max(-120, Math.min(WORLD_H + 120, c.y));
}
function zoomAt(sx, sy, f) {
  const g0 = toGround(app.cam, vw, vh, sx, sy, 0, T2), x0 = g0[0], y0 = g0[1];
  app.cam.zoom *= f; clampCam();
  const g1 = toGround(app.cam, vw, vh, sx, sy, 0, T2);
  app.cam.x += x0 - g1[0]; app.cam.y += y0 - g1[1];
  clampCam();
}
function resize() {
  dpr = Math.min(renderer.quality === 'high' ? 2 : renderer.quality === 'medium' ? 1.5 : 1.25, window.devicePixelRatio || 1);
  vw = window.innerWidth; vh = window.innerHeight;
  renderer.resize(Math.round(vw * dpr), Math.round(vh * dpr));
  overlay.width = Math.round(vw * dpr); overlay.height = Math.round(vh * dpr);
  clampCam();
}

// ------------------------------------------------------------- setup state
function rebuildPreview() {
  app.previewDirty = false;
  app.sim = new Sim(map, app.setup, null);
  ui.updateHud();
}
function groupsChanged(roster = true) {
  app.previewDirty = true;
  if (roster) ui.refreshRoster();
  ui.refreshInspector();
}
/** Sandbox or challenge, read off the setup being edited. */
app.isSandbox = () => !!(app.setup && app.setup.options.sandbox);
/**
 * Load a scenario. In a challenge it is played as designed; in the sandbox it autofills the map with
 * both armies (the whole horde on the field at once) for the player to change as they like.
 */
app.loadPreset = (key, sandbox = app.isSandbox(), quiet = false) => {
  app.setup = buildPreset(map, key, sandbox);
  app.presetKey = key;
  app.selGroup = null; app.tool = null;
  ui.refreshPresetList(); ui.setPreset(key); ui.refreshRoster(); ui.refreshOptions(); ui.refreshInspector(); ui.refreshPalette(); ui.hint(null);
  rebuildPreview();
  const p = PRESETS.find((q) => q.key === key);
  if (p && !quiet && !sandbox) ui.toast(p.blurb);
};
/** Switch between the two ways to play. Both open on the Hornburg Garrison (in the sandbox, with the whole horde laid out to change). */
app.enterMode = (mode) => {
  const sb = mode === 'sandbox';
  if (app.mode === 'battle') app.backToSetup();
  const first = !app.modeChosen;
  app.modeChosen = true;
  if (first || sb !== app.isSandbox()) app.loadPreset('garrison', sb, true); else ui.refreshPresetList();
  ui.coach(sb ? 'sandbox' : 'challenge');
};
app.optionsChanged = () => { app.previewDirty = true; };
/** Sandbox: replace the generated horde with a fresh one of n, drawn up on the field. Hand-placed attackers stay. */
app.raiseHorde = (n) => {
  app.setup.groups = app.setup.groups.filter((g) => g.team !== ORC || g.phase == null).concat(horde(n, { waves: 1 }));
  app.selGroup = null;
  groupsChanged(); ui.refreshPalette();
  ui.toast(`Horde raised · ${fmt(n)}`);
};
const BEST_KEY = 'hd-best-v2'; // v2: the siege rules changed what a score is worth
/** Best score per scenario. Only well-formed entries are trusted; anything else in storage is ignored. */
const loadBest = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(BEST_KEY)), out = {};
    if (raw && typeof raw === 'object') for (const p of PRESETS) { const b = raw[p.key]; if (b && Number.isFinite(b.score)) out[p.key] = { score: b.score, medal: typeof b.medal === 'string' ? b.medal : null }; }
    return out;
  } catch { return {}; }
};
app.selectPlaceTool = (type) => {
  app.tool = type ? { kind: 'place', type } : null;
  app.selGroup = null;
  ui.refreshPalette(); ui.refreshInspector();
  const d = type && UNITS[U[type]];
  ui.hint(type ? `<b>${d.name}</b> · ${d.cls === C.OBST ? 'drag to lay a line' : 'click to place · drag for a line'} · right-click to finish` : null);
};
app.setTypeCount = (type, n) => {
  const gs = app.setup.groups.filter((g) => g.type === type);
  const cur = gs.reduce((a, g) => a + g.count, 0);
  if (!cur) return;
  if (n <= 0) app.setup.groups = app.setup.groups.filter((g) => g.type !== type);
  else {
    let acc = 0, done = 0;
    for (const g of gs) { acc += g.count; const t = Math.round((acc / cur) * n); g.count = t - done; done = t; }
    app.setup.groups = app.setup.groups.filter((g) => g.count > 0);
  }
  if (app.selGroup && !app.setup.groups.includes(app.selGroup)) app.selGroup = null;
  groupsChanged();
};
app.clearTeam = (team) => { app.setup.groups = app.setup.groups.filter((g) => g.team !== team); app.selGroup = null; groupsChanged(); };
app.editGroup = (g, patch) => { Object.assign(g, patch); if (patch.ang != null && !g.w) g.w = groupBounds(g).hw * 2 - UNITS[U[g.type]].spacing * 2; groupsChanged(); };
app.removeGroup = (g) => { app.setup.groups = app.setup.groups.filter((q) => q !== g); if (app.selGroup === g) app.selGroup = null; groupsChanged(); };

/** The band of wall walk a group posted along a wall takes up: its length, and how far out and in from the wall's center line it reaches. */
function runBand(g) {
  const r = g.run, d = UNITS[U[g.type]], half = r.wall ? KEEP.half : WALL_HALF, len = wallRunLength(map, r.wall, r.a, r.b);
  const st = Math.min(d.spacing * (g.spread || 1), 1.5), ranks = Math.ceil(g.count / Math.max(1, Math.floor(len / st) + 1));
  return { len, out: half, inn: Math.max(-half, half - 2 - (ranks - 1) * 1.6), top: r.wall ? RING_TOP : WALL_H };
}
/**
 * The box a formation really takes up, in its own frame (along its front, and front to back): the bounds of where its
 * units stand, with half a file's room round them. A block drawn wider than its men fill stands to one side of the
 * width it was given, so a box of that width ran on past them.
 */
const extents = new WeakMap();
function groupExtent(g) {
  const key = `${g.x},${g.y},${g.ang},${g.w},${g.count},${g.type},${g.spread || 1},${g.lv ? g.lv.tier + '/' + g.lv.wall : ''}`;
  let e = extents.get(g);
  if (e && e.key === key) return e;
  const d = UNITS[U[g.type]], pos = groupPositions(map, g), n = Math.min(g.count, pos.length / 2), ux = Math.cos(g.ang), uy = Math.sin(g.ang);
  let a0 = 1e9, a1 = -1e9, p0 = 1e9, p1 = -1e9;
  for (let k = 0; k < n; k++) { const dx = pos[k * 2] - g.x, dy = pos[k * 2 + 1] - g.y, a = dx * ux + dy * uy, q = -dx * uy + dy * ux; if (a < a0) a0 = a; if (a > a1) a1 = a; if (q < p0) p0 = q; if (q > p1) p1 = q; }
  if (!n) { const b = groupBounds(g); a0 = -b.hw; a1 = b.hw; p0 = -b.hd; p1 = b.hd; } else { const pad = Math.max(1.2, Math.min(d.spacing * 0.5, 5), (d.rad || 0) + 0.8); a0 -= pad; a1 += pad; p0 -= pad; p1 += pad; }
  e = { key, a0, a1, p0, p1 }; extents.set(g, e);
  return e;
}
function groupAt(wx, wy) {
  let best = null, ba = 1e12;
  const lockOrc = !app.isSandbox();
  for (const g of app.setup.groups) {
    if (g.phase > 0 || (lockOrc && g.team === ORC)) continue; // later waves are beyond the valley mouth; a challenge's enemy is fixed
    const pad = 3 / app.cam.zoom + 1;
    if (g.run) {
      // men along a wall walk: the pointer is over them where it is over their stretch of the walk
      const r = runBand(g);
      for (let k = 0; k <= 24; k++) {
        const w = wallPoint(map, g.run.wall, g.run.a + ((g.run.b - g.run.a) * k) / 24), o = (wx - w.x) * w.nx + (wy - w.y) * w.ny, t = Math.abs(-(wx - w.x) * w.ny + (wy - w.y) * w.nx);
        if (o < parapetAt(map, g.run.wall, w.x, w.y, w.nx, w.ny, r.out) + 1 + pad && o > r.inn - pad && t < r.len / 48 + 1 + pad) { const area = r.len * (r.out - r.inn) / 4; if (area < ba) { ba = area; best = g; } break; }
      }
      continue;
    }
    const b = groupExtent(g), ux = Math.cos(g.ang), uy = Math.sin(g.ang);
    const dx = wx - g.x, dy = wy - g.y;
    const a = dx * ux + dy * uy, p = -dx * uy + dy * ux;
    if (a > b.a0 - pad && a < b.a1 + pad && p > b.p0 - pad && p < b.p1 + pad) { const area = ((b.a1 - b.a0) * (b.p1 - b.p0)) / 4; if (area < ba) { ba = area; best = g; } }
  }
  return best;
}

// ------------------------------------------------------------ battle state
app.startBattle = () => {
  audio.unlock();
  const real = (g, team) => g.team === team && UNITS[U[g.type]].cls !== C.OBST;
  if (!app.setup.groups.some((g) => real(g, DEF)) || !app.setup.groups.some((g) => real(g, ORC))) { ui.toast('Place at least one defender and one attacker', 'warn'); audio.play('deny'); return; }
  const spent = forceCost(app.setup.groups);
  if (!app.isSandbox() && spent > app.setup.budget) { ui.toast(`Over budget by ${fmt(spent - app.setup.budget)} pts`, 'warn'); audio.play('deny'); return; }
  app.battleSpent = spent; app.lastScore = null;
  fx.reset(); renderer.clearDecals();
  // the sandbox rolls its dice from the seed in Settings; a challenge keeps its own
  // the battle reports its effects to a queue, which the frame loop plays on `fx` after stepping it
  app.fxq.clear();
  app.sim = new Sim(map, app.isSandbox() ? { ...app.setup, options: { ...app.setup.options, seed: Math.max(1, +app.settings.seed | 0 || 1) } } : app.setup, app.fxq);
  fx.groundFn = (x, y) => (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H ? 0 : app.sim.surfZ(x, y));
  app.mode = 'battle'; app.paused = false; app.speed = 1; app.acc = 0; app.slowT = 0; app.showLosses = false;
  app.overlay.zones = false; app.overlay.ranges = false; app.artyPanel = false; rangeCache.t = -1; rangeCache.keyStr = ''; ui.setOverlayKey(null);
  app.tool = null; app.selGroup = null; app.selection = []; app.markers = []; app.drag = null; app.bolt = -1; app.nextBolt = 10;
  app.alerts = []; app.alertIdx = 0; app.groups = {};
  ui.setMode('battle'); ui.clearFeed(); ui.hint(null); ui.hideModal();
  fitCamera();
  ui.banner(app.sim.opt.dawn > 0 ? 'Hold until dawn' : app.sim.opt.rout > 0 ? 'Rout the horde' : 'Destroy the horde', 'warn');
  audio.horn();
  mmBase = null;
  ui.updateHud();
};
app.backToSetup = () => {
  app.mode = 'setup'; app.tool = null; app.selection = []; app.markers = []; app.drag = null; app.showLosses = false;
  app.artyPanel = false; rangeCache.keyStr = ''; ui.setOverlayKey(null); ui.refreshArty();
  fx.reset(); renderer.clearDecals(); audio.setRoar(0);
  ui.setMode('setup'); ui.clearFeed(); ui.hint(null); ui.hideModal();
  rebuildPreview(); fitCamera();
  ui.refreshRoster(); ui.refreshPalette(); ui.refreshInspector();
};
app.setSpeed = (s) => { if (s === 0) app.paused = !app.paused; else { app.speed = s; app.paused = false; } ui.updateHud(); };
app.toggleMute = () => { audio.unlock(); audio.setMuted(!audio.muted); return audio.muted; };
app.toggleLosses = () => { app.showLosses = !app.showLosses; ui.updateHud(); };
app.armSupport = (k) => {
  if (app.mode !== 'battle' || app.sim.result) return;
  const s = app.sim.support[k];
  if (app.tool && app.tool.kind === 'support' && app.tool.name === k) { app.tool = null; ui.hint(null); return; }
  if (!app.sim.affordSupport(k)) { ui.toast(app.sim.opt.sandbox ? `${SUPPORT[k].name}: none left` : `${SUPPORT[k].name} costs ${s.cost} command points (you have ${Math.floor(app.sim.cp)})`, 'warn'); audio.play('deny'); return; }
  if (app.sim.time < s.ready) { ui.toast(`${SUPPORT[k].name} ready in ${Math.ceil(s.ready - app.sim.time)} s`, 'warn'); audio.play('deny'); return; }
  app.tool = { kind: 'support', name: k };
  audio.play('click');
  ui.hint(`<b>${SUPPORT[k].name}</b> · ${k === 'air' ? 'click a target, or drag to set the direction' : 'click a target'} · right-click to cancel`);
};
app.armFocus = () => {
  if (app.mode !== 'battle' || app.sim.result) return;
  if (app.sim.focus) { app.sim.clearFocus(); ui.toast('Focus Fire canceled'); return; }
  if (app.tool && app.tool.kind === 'focus') { app.tool = null; ui.hint(null); return; }
  app.tool = { kind: 'focus' };
  audio.play('click');
  ui.hint('<b>Focus Fire</b> · drag a circle on the map · right-click to cancel');
};
// ---- artillery: the garrison's own mortars and howitzers
const ARTY_COLS = ['240,179,74', '255,122,217', '122,255,193', '159,168,255', '255,210,122', '127,224,255', '255,140,100', '200,255,120'];
app.artyColor = (k) => ARTY_COLS[k % ARTY_COLS.length];
const liveArty = () => (app.sim ? app.sim.arty.filter((a) => a.n > 0) : []);
/** Arm the targeting cursor for the listed sections (null = every section). */
app.armFireMission = (groups = null) => {
  if (app.mode !== 'battle' || app.sim.result) return;
  if (!liveArty().length) { ui.toast('No artillery left', 'warn'); audio.play('deny'); return; }
  app.artyPanel = true;
  app.tool = { kind: 'fire', groups };
  audio.play('click');
  const one = groups && groups.length === 1 ? app.sim.arty.find((a) => a.g === groups[0]) : null;
  ui.hint(`<b>Target Artillery</b> · ${one ? one.label : 'all batteries'} · click a target · right-click to cancel`);
  ui.updateHud();
};
app.toggleFireMission = () => {
  if (app.mode !== 'battle') return;
  if (app.tool && app.tool.kind === 'fire') { app.tool = null; ui.hint(null); ui.updateHud(); return; }
  app.armFireMission(null);
};
app.closeArtyPanel = () => { app.artyPanel = false; if (app.tool && app.tool.kind === 'fire') { app.tool = null; ui.hint(null); } ui.updateHud(); };
app.artyOrder = (groups, mode) => {
  if (app.mode !== 'battle' || app.sim.result) return;
  if (mode === 'target') { app.armFireMission(groups); return; }
  for (const a of app.sim.arty) if (!groups || groups.includes(a.g)) app.sim.setArtyMode(a.g, mode);
  app.sim.updateArtillery();
  audio.play('click'); ui.updateHud();
};
app.toggleOverlay = (k) => { app.overlay[k] = !app.overlay[k]; rangeCache.t = -1; audio.play('click'); ui.updateHud(); };
/** Fall back to the keep: the whole garrison, or (selected = true) only the troops now selected. */
app.retreat = (selected) => {
  if (app.mode !== 'battle' || app.sim.result) return;
  if (selected && app.selection.length) {
    const n = app.sim.orderRetreat(app.selection);
    if (!n) { ui.toast('Already in the Hornburg, or unable to move'); return; }
    audio.play('confirm'); ui.toast(`${fmt(n)} falling back to the Hornburg`, 'warn');
    app.markers.push({ x: KEEP.cx, y: KEEP.cy, z: 12, r: KEEP.r + 8, t: 0, dur: 4, col: '94,200,242', label: 'Fall Back' });
    return;
  }
  const n = app.sim.orderRetreat();
  if (!n) ui.toast('Everyone is already in the Hornburg');
  else { audio.horn(); app.markers.push({ x: KEEP.cx, y: KEEP.cy, z: 12, r: KEEP.r + 8, t: 0, dur: 6, col: '94,200,242', label: 'Fall Back' }); }
};
// ---- fire discipline and control groups
const STANCES = [[0, 'At will'], [150, 'Hold to 150 m'], [75, 'Hold to 75 m'], [-1, 'Hold fire']];
app.stanceName = (v) => (STANCES.find((q) => q[0] === v) || STANCES[0])[1];
app.cycleStance = () => {
  if (app.mode !== 'battle' || app.sim.result || !app.selection.length) return;
  const cur = app.sim.holdR[app.selection[0]];
  const nx = STANCES[(STANCES.findIndex((q) => q[0] === cur) + 1) % STANCES.length];
  app.sim.setStance(app.selection, nx[0]);
  audio.play('click'); ui.toast(`Fire mode: ${nx[1].toLowerCase()}`, nx[0] ? 'warn' : 'good');
  ui.updateHud();
};
const liveGroup = (key) => (app.groups[key] || []).filter((u) => app.sim.alive[u.i] && app.sim.gen[u.i] === u.g && app.sim.team[u.i] === DEF);
app.groupCount = (key) => liveGroup(key).length;
app.assignGroup = (key) => {
  if (!app.selection.length) { delete app.groups[key]; ui.updateHud(); return; }
  app.groups[key] = app.selection.map((i) => ({ i, g: app.sim.gen[i] }));
  audio.play('click'); ui.toast(`Group ${key} set · ${fmt(app.selection.length)}`);
  ui.updateHud();
};
app.recallGroup = (key) => {
  const live = liveGroup(key);
  app.groups[key] = live;
  if (!live.length) return;
  app.selection = live.map((u) => u.i);
  // a second tap looks at them
  if (app.groupTap.k === key && app.clock - app.groupTap.t < 0.4) {
    let x = 0, y = 0; for (const u of live) { x += app.sim.x[u.i]; y += app.sim.y[u.i]; }
    app.jumpTo(x / live.length, y / live.length);
  }
  app.groupTap = { k: key, t: app.clock };
  audio.play('click'); ui.updateHud();
};

// ---- alerts: anything the sim reports with a position can be pinged and jumped to
app.jumpTo = (x, y) => { app.cam.x = x; app.cam.y = y; clampCam(); };
function noteAlert(e) {
  app.alerts.push({ x: e.x, y: e.y, t: app.clock, cls: e.cls || '', text: e.text });
  if (app.alerts.length > 20) app.alerts.shift();
  app.alertIdx = 0;
  if (e.cls === 'bad' || e.cls === 'warn') { audio.play('alert', e.cls === 'bad' ? 1 : 0.55, 0); marker(e.x, e.y, 14, 5, e.cls === 'bad' ? '255,110,90' : '240,179,74'); }
}
/** Jump to the latest alert; pressing again soon after steps back through earlier ones. */
app.jumpAlert = () => {
  const n = app.alerts.length;
  if (!n) { ui.toast('No alerts yet'); return; }
  app.alertIdx = app.clock - app.alertKeyT < 4 ? (app.alertIdx + 1) % n : 0;
  app.alertKeyT = app.clock;
  const a = app.alerts[n - 1 - app.alertIdx];
  app.jumpTo(a.x, a.y);
  ui.hint(`<b>${a.text}</b>${n > 1 ? ' · <b>G</b> for the previous alert' : ''}`);
  clearTimeout(app._alertHint); app._alertHint = setTimeout(() => { if (!app.tool) ui.hint(null); }, 2600);
};

function marker(x, y, r, dur, col, label, x2, y2) { app.markers.push({ x, y, z: heightAt(x, y), r, t: 0, dur, col, label, x2, y2 }); }

function fireTool(x0, y0, x1, y1) {
  const t = app.tool, sim = app.sim;
  if (t.kind === 'fire') {
    const n = sim.setArtyTarget(t.groups, x0, y0, 24);
    if (!n) { ui.toast('Out of range of every battery', 'warn'); audio.play('deny'); return; }
    const total = (t.groups ? sim.arty.filter((a) => t.groups.includes(a.g)) : sim.arty).filter((a) => a.n).length;
    ui.toast(`${n} ${n > 1 ? 'batteries' : 'battery'} firing${n < total ? ` · ${total - n} out of range` : ''}`, 'good');
    audio.play('confirm');
    sim.updateArtillery(); rangeCache.t = -1;
  } else if (t.kind === 'focus') {
    sim.setFocus(x0, y0, Math.max(28, Math.hypot(x1 - x0, y1 - y0)));
    audio.play('confirm');
  } else {
    const k = t.name;
    if (!sim.callSupport(k, x0, y0, x1, y1)) { audio.play('deny'); return; }
    audio.play('confirm');
    if (k === 'air') { const L = Math.hypot(x1 - x0, y1 - y0); if (L < 20) marker(x0, y0, 20, 7, '240,179,74', 'Air Strike', x0, y0 - 115); else marker((x0 + x1) / 2, (y0 + y1) / 2, 20, 7, '240,179,74', 'Air Strike', x1, y1); }
    else if (k === 'gunship') marker(x0, y0, 150, 48, '111,220,154', 'Gunships');
    else if (k === 'supply') marker(x0, y0, SUPPLY_R, 12, '111,220,154', 'Resupply');
    else marker(x0, y0, 14, 22, '94,200,242', 'Reinforce');
  }
  app.tool = null; ui.hint(null);
}

// ------------------------------------------------------------------- placing troops
// Men put on a wall are put ON the wall: the pointer locks onto the walk, a drag follows the walk's curve however far
// the pointer strays from it, and they stand at the parapet looking out. Anything else is put on the level that was
// pointed at when the button went down (the ground, or one of the Hornburg's courts) and stays on it.
const WALKS = [[], []]; // points down the middle of every wall walk that can be stood on: [the Deeping Wall, the ring]
for (let k = 0; k <= 200; k++) { const u = k / 200, p = wallPoint(map, 0, u); if (map.seg[map.cellOf(p.x, p.y)] >= 0) WALKS[0].push({ u, x: p.x, y: p.y, z: WALL_H }); }
for (let u = 0; u < 360; u += 1.25) { const p = wallPoint(map, 1, u); if (map.seg[map.cellOf(p.x, p.y)] >= 0) WALKS[1].push({ u, x: p.x, y: p.y, z: RING_TOP }); }
/** The wall walk at a point of the screen: { wall, u } (see scenarios.js wallPoint) or null. `only`: the nearest point of that wall, however far off. */
function wallNear(sx, sy, only = -1) {
  let best = null, bd = 1e18, scale = 0;
  for (let w = 0; w < 2; w++) {
    if (only >= 0 && w !== only) continue;
    for (const q of WALKS[w]) { const p = S(q.x, q.y, q.z); if (!p[2]) continue; const d = (p[0] - sx) * (p[0] - sx) + (p[1] - sy) * (p[1] - sy); if (d < bd) { bd = d; best = q; scale = p[2]; } }
  }
  if (!best) return null;
  const wall = WALKS[1].includes(best) ? 1 : 0;
  if (only < 0) {
    // under the pointer, or within a finger's width of it where the walk is too thin on screen to hit
    const hit = pickAt(sx, sy), sg = map.seg[map.cellOf(hit.x, hit.y)], onIt = sg >= 0 && app.sim && app.sim.elev[map.cellOf(hit.x, hit.y)] && map.segments[sg].group === wall;
    if (!onIt && Math.sqrt(bd) > Math.max(9, (wall ? KEEP.half : WALL_HALF) * scale * 0.3)) return null;
  }
  return { wall, u: best.u };
}
const lockable = (def) => def.team === DEF && def.cls === C.INF;
/**
 * What a press (and drag) with the placing tool would put down: the fields of a group, or null. `d` is the drag
 * (null while only hovering); the pointer is app.mouse.
 */
function placement(d) {
  const m = app.mouse, def = UNITS[U[app.tool.type]], click = Math.max(5, 10 / app.cam.zoom);
  const lock = d ? d.lock : lockable(def) && !m.alt ? wallNear(m.sx, m.sy) : null;
  if (lock) {
    const end = d ? wallNear(m.sx, m.sy, lock.wall) : null;
    let a = lock.u, b = end ? end.u : a;
    if (lock.wall === 1) { let db = b - a; db -= Math.round(db / 360) * 360; b = a + db; } // (the short way round the ring)
    let len = wallRunLength(map, lock.wall, a, b);
    if (len < click) {
      // a click: as much of the walk as the block needs standing two deep, centered where it was clicked
      const st = Math.min(def.spacing, 1.5), want = Math.max(st, Math.ceil(app.brushCount / 2) * st), du = (want / 2) / (lock.wall ? (KEEP.r * Math.PI) / 180 : map.wallLen);
      a = lock.u - du; b = lock.u + du;
      if (!lock.wall) { a = Math.max(0, a); b = Math.min(1, b); }
      len = wallRunLength(map, lock.wall, a, b);
    }
    const mid = wallPoint(map, lock.wall, (a + b) / 2);
    return { x: mid.x, y: mid.y, ang: Math.atan2(mid.nx, -mid.ny), w: len, extra: { run: { wall: lock.wall, a, b } }, lock: true };
  }
  // off the walls: on the level pointed at when the button went down, wherever the pointer goes after
  let x1 = m.wx, y1 = m.wy;
  if (d && d.z0 !== undefined) { const g = toGround(app.cam, vw, vh, m.sx, m.sy, d.z0, T4); x1 = g[0]; y1 = g[1]; }
  const x0 = d ? d.x0 : x1, y0 = d ? d.y0 : y1, L = Math.hypot(x1 - x0, y1 - y0), line = d && L > click;
  const lv = d && d.lv ? d.lv : { wall: map.seg[map.cellOf(x1, y1)] >= 0 && !!(app.sim && app.sim.elev[map.cellOf(x1, y1)]), tier: map.tier[map.cellOf(x1, y1)] };
  return { x: line ? (x0 + x1) / 2 : x1, y: line ? (y0 + y1) / 2 : y1, ang: line ? Math.atan2(y1 - y0, x1 - x0) : Math.PI / 2, w: line ? L : 0, extra: lockable(def) ? { lv } : {}, x0, y0, x1, y1, line };
}

// ------------------------------------------------------------------- input
function updateMouse(e) {
  const m = app.mouse;
  m.sx = e.clientX; m.sy = e.clientY; m.inside = true; m.alt = !!e.altKey;
  const p = pickAt(m.sx, m.sy); m.wx = p.x; m.wy = p.y; m.wz = p.z;
}
const panDrag = (m, btn, moved) => { const g = toGround(app.cam, vw, vh, m.sx, m.sy, 0, T4); return { kind: btn === 1 ? 'rot' : 'rpan', sx: m.sx, sy: m.sy, cx: app.cam.x, cy: app.cam.y, gx: g[0], gy: g[1], yaw: app.cam.yaw, tilt: app.cam.tilt || 0, moved, btn }; };
overlay.addEventListener('contextmenu', (e) => e.preventDefault());
overlay.addEventListener('pointerleave', () => { app.mouse.inside = false; });
overlay.addEventListener('pointerdown', (e) => {
  audio.unlock();
  updateMouse(e);
  overlay.setPointerCapture(e.pointerId);
  if (e.button === 1) e.preventDefault();
  const m = app.mouse;
  if (e.button !== 0) { app.drag = panDrag(m, e.button, false); return; }
  if (app.mode === 'setup') {
    if (app.tool) {
      const def = UNITS[U[app.tool.type]], c = map.cellOf(m.wx, m.wy), wall = map.seg[c] >= 0 && !!app.sim.elev[c];
      app.drag = { kind: 'place', x0: m.wx, y0: m.wy, z0: m.wz, lock: lockable(def) && !e.altKey ? wallNear(m.sx, m.sy) : null, lv: { wall, tier: map.tier[c] } };
      return;
    }
    const g = groupAt(m.wx, m.wy);
    if (g) { if (app.selGroup !== g) { app.selGroup = g; ui.refreshInspector(); } app.drag = { kind: 'moveGroup', g, ox: m.wx - g.x, oy: m.wy - g.y, moved: false }; }
    else { if (app.selGroup) { app.selGroup = null; ui.refreshInspector(); } app.drag = panDrag(m, 0, true); }
  } else {
    if (app.sim.result) { app.drag = panDrag(m, 0, true); return; }
    if (app.tool) app.drag = { kind: 'tool', x0: m.wx, y0: m.wy };
    else app.drag = { kind: 'box', sx: m.sx, sy: m.sy, add: e.shiftKey };
  }
});
overlay.addEventListener('pointermove', (e) => {
  updateMouse(e);
  const d = app.drag, m = app.mouse;
  if (!d) { if (app.mode === 'setup' && !app.tool) app.hoverGroup = groupAt(m.wx, m.wy); return; }
  if (d.kind === 'rpan') {
    if (Math.abs(m.sx - d.sx) + Math.abs(m.sy - d.sy) > 5) d.moved = true;
    if (d.moved) {
      const c = app.cam, keep = [c.x, c.y];
      // the ground point that was grabbed stays under the pointer
      c.x = d.cx; c.y = d.cy;
      const g = toGround(c, vw, vh, m.sx, m.sy, 0, T2);
      c.x = d.cx + d.gx - g[0]; c.y = d.cy + d.gy - g[1]; clampCam();
      if (Number.isNaN(c.x)) { c.x = keep[0]; c.y = keep[1]; }
    }
  } else if (d.kind === 'rot') {
    d.moved = true;
    // middle-drag: sideways turns the view, up and down tips it
    app.cam.yaw = d.yaw - (m.sx - d.sx) * 0.006;
    app.cam.tilt = d.tilt + (m.sy - d.sy) * 0.004; clampCam();
  } else if (d.kind === 'moveGroup') {
    d.g.x = m.wx - d.ox; d.g.y = m.wy - d.oy; d.moved = true;
    if (d.g.run || d.g.lv) {
      // a group of men put down by hand: slid along a wall it stays on the wall's curve; dragged off, it stands where it is dropped
      const def = UNITS[U[d.g.type]], lk = lockable(def) && !m.alt ? wallNear(m.sx, m.sy) : null;
      if (lk) {
        const len = d.g.run ? wallRunLength(map, d.g.run.wall, d.g.run.a, d.g.run.b) : Math.max(4, d.g.w), du = (len / 2) / (lk.wall ? (KEEP.r * Math.PI) / 180 : map.wallLen);
        let a = lk.u - du, b = lk.u + du; if (!lk.wall) { a = Math.max(0, a); b = Math.min(1, b); }
        const mid = wallPoint(map, lk.wall, (a + b) / 2);
        d.g.run = { wall: lk.wall, a, b }; delete d.g.lv; d.g.x = mid.x; d.g.y = mid.y; d.g.ang = Math.atan2(mid.nx, -mid.ny); d.g.w = wallRunLength(map, lk.wall, a, b);
      } else {
        const c = map.cellOf(d.g.x, d.g.y);
        if (d.g.run) { d.g.w = Math.min(d.g.w, 60); delete d.g.run; }
        d.g.lv = { wall: map.seg[c] >= 0 && !!app.sim.elev[c], tier: map.tier[c] };
      }
    }
  }
});
overlay.addEventListener('pointerup', (e) => {
  updateMouse(e);
  const d = app.drag, m = app.mouse;
  app.drag = null;
  if (!d) return;
  if (d.kind === 'rot') return;
  if (d.kind === 'rpan') {
    if (d.moved || d.btn !== 2) return;
    // plain right-click
    if (app.tool) { if (app.mode === 'setup') app.selectPlaceTool(null); else { app.tool = null; ui.hint(null); } return; }
    if (app.mode === 'setup') { if (app.selGroup) { app.selGroup = null; ui.refreshInspector(); } return; }
    if (app.selection.length && !app.sim.result) {
      if (app.sim.orderMove(app.selection, m.wx, m.wy)) { marker(m.wx, m.wy, 5, 1.2, '94,200,242'); audio.play('confirm'); } else audio.play('deny');
    }
  } else if (d.kind === 'place') {
    const def = UNITS[U[app.tool.type]], q = placement(d);
    const g = makeGroup(def.key, app.brushCount, q.x, q.y, q.ang, q.w, q.extra);
    if (q.line && def.cls === C.OBST && def.ob !== 'mine' && def.ob !== 'claymore') g.count = Math.ceil(q.w / 2) + 4; // a drawn line of wire/obstacles is always filled end to end
    const n = groupPositions(map, g).length / 2;
    if (!n) { ui.toast(`${def.name} can't be placed there`, 'warn'); audio.play('deny'); return; }
    if (n < g.count) { if (def.cls !== C.OBST) ui.toast(`Room for only ${fmt(n)} of ${fmt(g.count)}`, 'warn'); g.count = n; }
    app.setup.groups.push(g);
    audio.play('click');
    // (adding to a challenge's garrison opens its order of battle: what was added, and what it costs, is there to see)
    const opened = !app.isSandbox() && !app.oobOpen; if (opened) app.oobOpen = true;
    groupsChanged();
    if (opened) { ui.refreshRoster(); ui.refreshPalette(); ui.refreshInspector(); }
  } else if (d.kind === 'moveGroup') {
    if (d.moved) groupsChanged(false);
  } else if (d.kind === 'tool') {
    fireTool(d.x0, d.y0, m.wx, m.wy);
  } else if (d.kind === 'box') {
    const sim = app.sim, ids = [];
    const click = Math.abs(m.sx - d.sx) + Math.abs(m.sy - d.sy) < 6;
    const x0 = Math.min(d.sx, m.sx), x1 = Math.max(d.sx, m.sx), y0 = Math.min(d.sy, m.sy), y1 = Math.max(d.sy, m.sy);
    let best = -1, bd = 16 * 16;
    for (let i = 0; i < sim.n; i++) {
      if (!sim.alive[i] || sim.team[i] !== DEF || UNITS[sim.type[i]].cls === C.CACHE) continue;
      const p = S(sim.x[i], sim.y[i], sim.unitZ(i) + 1);
      if (click) { const dd = (p[0] - m.sx) ** 2 + (p[1] - m.sy) ** 2; if (dd < bd) { bd = dd; best = i; } }
      else if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) ids.push(i);
    }
    if (click && best >= 0) {
      const ty = sim.type[best];
      if (app.clock - app.lastClick.t < 0.35 && app.lastClick.type === ty) {
        // double-click: everyone of that kind in view
        for (let i = 0; i < sim.n; i++) {
          if (!sim.alive[i] || sim.team[i] !== DEF || sim.type[i] !== ty) continue;
          const p = S(sim.x[i], sim.y[i], sim.unitZ(i) + 1);
          if (p[0] >= 0 && p[1] >= 54 && p[0] <= vw && p[1] <= vh) ids.push(i);
        }
      } else ids.push(best);
      app.lastClick = { t: app.clock, type: ty };
    }
    app.selection = d.add ? [...new Set([...app.selection, ...ids])] : ids;
    if (ids.length) audio.play('click');
    ui.updateHud();
  }
});
overlay.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0014)); }, { passive: false });

const mmJump = (e) => { const r = mm.getBoundingClientRect(); app.cam.x = ((e.clientX - r.left) / r.width) * WORLD_W; app.cam.y = ((e.clientY - r.top) / r.height) * WORLD_H; clampCam(); };
let mmDown = false;
mm.addEventListener('pointerdown', (e) => { mmDown = true; mm.setPointerCapture(e.pointerId); mmJump(e); });
mm.addEventListener('pointermove', (e) => { if (mmDown) mmJump(e); });
mm.addEventListener('pointerup', () => { mmDown = false; });

window.addEventListener('keydown', (e) => {
  if (!ui) return; // still starting up
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone (Ctrl+R must not sound the retreat)
  const k = e.key.toLowerCase();
  if (ui.modalOpen()) { if (k === 'escape') ui.hideModal(); return; }
  if (k === 'escape' && ui.closePopups()) return;
  // control groups live on 6-0 (1-5 call support): Shift+digit assigns, digit recalls, tap twice to look
  if (app.mode === 'battle' && !app.sim.result && /^Digit[06-9]$/.test(e.code)) { const key = e.code.slice(5); if (e.shiftKey) app.assignGroup(key); else app.recallGroup(key); return; }
  app.keys.add(k);
  if (k === 'escape') {
    if (app.tool) { if (app.mode === 'setup') app.selectPlaceTool(null); else { app.tool = null; ui.hint(null); } }
    else if (app.selGroup) { app.selGroup = null; ui.refreshInspector(); }
    else if (app.selection.length) { app.selection = []; ui.updateHud(); }
    return;
  }
  if (k === '?' || (k === '/' && e.shiftKey)) { ui.showHelp(); return; }
  if (k === 'f2' || k === '`') { e.preventDefault(); perf.toggle(); return; }
  if (k === 'home') { app.cam.yaw = DEFAULT_YAW; fitCamera(); return; }
  if (app.mode === 'battle' && app.sim.result) { if (k === 'enter') ui.showEnd(app.sim); return; }
  if (app.mode === 'setup') {
    if (k === 'enter') app.startBattle();
    else if ((k === 'delete' || k === 'backspace') && app.selGroup) app.removeGroup(app.selGroup);
    else if (k === '[' && app.selGroup) app.editGroup(app.selGroup, { ang: app.selGroup.ang - Math.PI / 12 });
    else if (k === ']' && app.selGroup) app.editGroup(app.selGroup, { ang: app.selGroup.ang + Math.PI / 12 });
    return;
  }
  if (k === ' ') { e.preventDefault(); app.setSpeed(0); }
  else if (k === '=' || k === '+') app.setSpeed(Math.min(8, app.speed * 2));
  else if (k === '-' || k === '_') app.setSpeed(Math.max(1, app.speed / 2));
  else if (k >= '1' && k <= '4') { const name = Object.keys(SUPPORT)[+k - 1]; if (name) app.armSupport(name); }
  else if (k === 'f') app.armFocus();
  else if (k === 't') app.toggleFireMission();
  else if (k === 'z') app.toggleOverlay('zones');
  else if (k === 'v') app.toggleOverlay('ranges');
  else if (k === 'h') app.cycleStance();
  else if (k === 'r') app.retreat(!e.shiftKey);
  else if (k === 'l') app.toggleLosses();
  else if (k === 'g') app.jumpAlert();
  else if (k === 'x' && app.selection.length) app.sim.stop(app.selection);
  ui.updateHud();
});
window.addEventListener('keyup', (e) => app.keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => app.keys.clear());
window.addEventListener('resize', resize);

// ----------------------------------------------------------------- overlay
const FONT = '"Inter","Segoe UI",system-ui,sans-serif';
let selSetSrc = null, selSetVal = null; // the selection as a Set, rebuilt only when the selection array changes
/**
 * Add a circle lying flat on the ground to path `c`, as the camera sees it; `rev` winds it the other way (a hole).
 * Returns [x, y, scale, rise]: its center on screen and how far above the center its far edge appears. Valid until the next call.
 */
function ring(c, x, y, z, r, rev = false) {
  const n = r > 60 ? 64 : r > 12 ? 40 : 24;
  let on = false, top = 1e9;
  for (let k = 0; k <= n; k++) {
    const a = ((rev ? -k : k) / n) * 6.2832, q = toScreen(app.cam, vw, vh, x + Math.cos(a) * r, y + Math.sin(a) * r, z, T4);
    if (!q[2]) { on = false; continue; } // behind the camera
    if (on) c.lineTo(q[0], q[1]); else { c.moveTo(q[0], q[1]); on = true; }
    if (q[1] < top) top = q[1];
  }
  const p = toScreen(app.cam, vw, vh, x, y, z, T4);
  RP[0] = p[0]; RP[1] = p[1]; RP[2] = p[2]; RP[3] = top < 1e8 ? Math.max(0, p[1] - top) : 0;
  return RP;
}

/** Reach of a unit's weapon from a spot: the outer ring, and the inner one it cannot fire inside. Walls add reach. */
function rangeRings(c, def, x, y, alpha) {
  const z0 = heightAt(x, y) + 0.3;
  const label = (p, r, txt, col) => { c.font = `600 10px ${FONT}`; c.textAlign = 'center'; c.fillStyle = `rgba(${col},${alpha})`; c.fillText(txt, p[0], p[1] - p[3] - 5); };
  // commanders and captains: how far their steadying presence carries
  if (def.aura) {
    const col = '240,179,74';
    c.strokeStyle = `rgba(${col},${alpha * 0.8})`; c.lineWidth = 1.2; c.setLineDash([2, 5]);
    const reach = Math.round(def.aura * (def.team === ORC ? CAPTAIN_REACH : 1));
    c.beginPath(); const p = ring(c, x, y, z0, reach); c.stroke(); c.setLineDash([]);
    label(p, reach, `Steadies ${reach} m`, col);
  }
  const w = def.wdef || (def.ob === 'claymore' ? WEAPONS.claymore : def.pool ? { range: SUPPLY_R, supply: true } : null);
  if (!w || !w.range) return;
  const k = def.team === DEF && def.cls === C.INF && map.seg[map.cellOf(x, y)] >= 0 ? (heightAt(x, y) > 15 ? 1.2 : 1.12) : 1;
  const col = w.supply ? '111,220,154' : def.team === DEF ? '140,220,255' : '255,140,110';
  if (w.range * k < 1500) {
    c.strokeStyle = `rgba(${col},${alpha})`; c.lineWidth = 1.4; c.setLineDash([9, 6]);
    c.beginPath(); const p = ring(c, x, y, z0, w.range * k); c.stroke(); c.setLineDash([]);
    label(p, w.range * k, w.supply ? `Re-arms ${SUPPLY_R} m` : `${Math.round(w.range * k)} m${k > 1 ? ' from the wall' : ''}`, col);
  }
  if (w.min > 0) {
    c.strokeStyle = `rgba(${col},${alpha * 0.6})`; c.lineWidth = 1; c.beginPath(); const p = ring(c, x, y, z0, w.min); c.stroke();
    // a gun whose reach covers the whole map has only its minimum ring to show
    if (w.range * k >= 1500) label(p, w.min, `Map-wide · ${w.min} m minimum`, col);
  }
}
// ---- range overlays: unions of many circles, drawn through an offscreen layer so overlaps don't stack up
const rl = document.createElement('canvas'), rctx = rl.getContext('2d');
const rangeCache = { t: -1, zones: [], ranges: [], key: [] };
/** pts: [x, y, z, rOuter, rInner]. Fills the union of the annuli and outlines its edges. */
function unionArea(c, pts, col, fillA, lineA) {
  if (!pts.length) return;
  if (rl.width !== overlay.width || rl.height !== overlay.height) { rl.width = overlay.width; rl.height = overlay.height; }
  const r = rctx;
  r.setTransform(dpr, 0, 0, dpr, 0, 0); r.globalCompositeOperation = 'source-over'; r.clearRect(0, 0, vw, vh);
  const path = (shrink) => {
    r.beginPath();
    for (const p of pts) {
      const s = S(p[0], p[1], p[2]), k = s[2];
      if (!k) continue;
      const ro = p[3] * k;
      if (s[0] + ro < -50 || s[0] - ro > vw + 50 || s[1] + ro < -50 || s[1] - ro > vh + 50) continue;
      // (`shrink` is in pixels: the outline is what is left when the area is drawn again a little smaller)
      ring(r, p[0], p[1], p[2], Math.max(0.5 / k, p[3] - shrink / k));
      if (p[4] > 0) ring(r, p[0], p[1], p[2], p[4] + shrink / k, true);
    }
  };
  r.fillStyle = `rgb(${col})`; path(0); r.fill('nonzero');
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = fillA; c.drawImage(rl, 0, 0); c.restore();
  r.globalCompositeOperation = 'destination-out'; path(1.8); r.fill('nonzero'); r.globalCompositeOperation = 'source-over';
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = lineA; c.drawImage(rl, 0, 0); c.restore();
}
const WCOL = { rifle: '94,200,242', mg: '240,179,74', sniper: '200,150,255', gl: '111,220,154', rocket: '255,110,90', autocannon: '255,225,130', tankgun: '255,160,60' };
/** Sample the live positions behind both overlays a few times a second rather than every frame. */
function refreshRangeCache() {
  const sim = app.sim;
  if (rangeCache.t >= 0 && app.clock - rangeCache.t < 0.25) return rangeCache;
  rangeCache.t = app.clock;
  const arty = sim.updateArtillery();
  rangeCache.zones = arty.map((a, k) => ({ a, k, pts: a.n ? sim.groupUnits(a.g, 18).map((i) => [sim.x[i], sim.y[i], sim.unitZ(i) + 0.3, a.w.range, a.w.min]) : [] }));
  const by = {}, sel = app.selection.length ? app.selection : null;
  for (let q = 0, n = sel ? sel.length : sim.n; q < n; q++) {
    const i = sel ? sel[q] : q;
    if (!sim.alive[i] || sim.team[i] !== DEF) continue;
    const w = UNITS[sim.type[i]].wdef;
    if (!w || w.arc || !w.range) continue;
    const c = app.map.cellOf(sim.x[i], sim.y[i]), el = sim.elevD[c];
    const r = el ? w.range * (sim.segTop[sim.mseg[c]] > 15 ? 1.2 : 1.12) : w.range;
    (by[w.key] ||= []).push([sim.x[i], sim.y[i], sim.unitZ(i) + 0.3, r, w.min || 0]);
  }
  rangeCache.ranges = Object.entries(by).map(([k, pts]) => {
    if (pts.length > 260) { const st = pts.length / 260; pts = Array.from({ length: 260 }, (_, q) => pts[Math.floor(q * st)]); }
    return { k, pts, max: Math.max(...pts.map((p) => p[3])) };
  }).sort((a, b) => b.max - a.max);
  return rangeCache;
}
function artyCanReach(groups, x, y) {
  let n = 0;
  for (const zn of refreshRangeCache().zones) {
    if (!zn.a.n || (groups && !groups.includes(zn.a.g))) continue;
    if (zn.pts.some((p) => { const d = Math.hypot(p[0] - x, p[1] - y); return d <= p[3] && d >= p[4]; })) n++;
  }
  return n;
}
function tag(c, x, y, txt, col, bg = 'rgba(10,13,16,0.84)') {
  c.font = `700 11px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  const tw = c.measureText(txt).width + 14;
  c.fillStyle = bg; c.beginPath(); c.roundRect(x - tw / 2, y - 10, tw, 20, 5); c.fill();
  c.strokeStyle = `rgba(${col},0.7)`; c.lineWidth = 1; c.stroke();
  c.fillStyle = `rgb(${col})`; c.fillText(txt, x, y + 0.5);
}
/** Fire-mission markers; sections sharing a target share one label. */
function drawMissionMarks(c, zones, groups) {
  const seen = new Map();
  for (const zn of zones) {
    const a = zn.a;
    if (a.mode !== 'target' || !a.n || (groups && !groups.includes(a.g))) continue;
    const k = `${a.x.toFixed(1)},${a.y.toFixed(1)}`;
    drawMissionMark(c, a, app.artyColor(zn.k), !seen.has(k));
    seen.set(k, (seen.get(k) || []).concat(a));
  }
  const z = app.cam.zoom;
  for (const list of seen.values()) {
    const a = list[0], p = S(a.x, a.y, heightAt(a.x, a.y) + 0.3);
    tag(c, p[0], p[1] - riseOf(a.x, a.y, heightAt(a.x, a.y) + 0.3, a.r) - 14, list.length > 1 ? `Artillery · ${list.length} batteries` : `${a.label} · target`, list.length > 1 ? '240,179,74' : app.artyColor(zones.findIndex((q) => q.a === a)));
  }
}
function drawMissionMark(c, a, col, first) {
  const z = app.cam.zoom, h = heightAt(a.x, a.y) + 0.3;
  const from = S(a.cx, a.cy, heightAt(a.cx, a.cy) + 1), fx = from[0], fy = from[1];
  const to = S(a.x, a.y, h), tx = to[0], ty = to[1];
  c.strokeStyle = `rgba(${col},0.55)`; c.lineWidth = 1.2; c.setLineDash([3, 6]); c.beginPath(); c.moveTo(fx, fy); c.lineTo(tx, ty); c.stroke(); c.setLineDash([]);
  c.strokeStyle = `rgba(${col},0.95)`; c.lineWidth = 1.8; c.beginPath(); ring(c, a.x, a.y, h, a.r); c.stroke();
  const q = 10;
  if (first) { c.beginPath(); c.moveTo(tx - q, ty); c.lineTo(tx + q, ty); c.moveTo(tx, ty - q); c.lineTo(tx, ty + q); c.stroke(); }
}
/** Just the active fire missions (always shown, so the player can see where their guns are landing). */
function drawMissions(c) {
  if (!app.sim.arty.some((a) => a.mode === 'target')) return;
  drawMissionMarks(c, refreshRangeCache().zones, null);
}
function drawZones(c, groups) {
  const zones = refreshRangeCache().zones;
  for (const zn of zones) {
    const a = zn.a, col = app.artyColor(zn.k);
    if (!a.n || (groups && !groups.includes(a.g))) continue;
    unionArea(c, zn.pts, col, a.mode === 'hold' ? 0.04 : 0.09, 0.85);
  }
  for (const zn of zones) {
    const a = zn.a, col = app.artyColor(zn.k);
    if (!a.n || (groups && !groups.includes(a.g))) continue;
    const p = S(a.cx, a.cy, heightAt(a.cx, a.cy) + 6);
    const st = a.mode === 'hold' ? ' · holding' : '';
    tag(c, p[0], p[1] - 10, `${a.label} · ${a.w.min}–${a.w.range} m${st}`, col);
  }
  drawMissionMarks(c, zones, groups);
}
function drawRanges(c) {
  const rc = refreshRangeCache();
  const key = [];
  for (const r of rc.ranges) {
    const col = WCOL[r.k] || '230,230,230';
    unionArea(c, r.pts, col, 0.05, 0.75);
    key.push([col, WEAPONS[r.k].name, `${WEAPONS[r.k].range} m`]);
  }
  const ks = key.map((q) => q[1]).join();
  if (ks !== rangeCache.keyStr) { rangeCache.keyStr = ks; ui.setOverlayKey(key.length ? key : null); }
}
/** Every forced gate and every gap in the walls gets a marker, so the state of the defenses reads at a glance. */
function drawBreaches(c) {
  const segs = app.sim.segs, z = app.cam.zoom;
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    if (s.kind === 'wall' && !s.breached && s.hp < s.maxHp && z > 0.9 && s.valid) {
      const p = S(s.x, s.y, s.top + 4);
      if (p[0] > -40 && p[1] > -40 && p[0] < vw + 40 && p[1] < vh + 40) {
        const f = s.hp / s.maxHp;
        c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(p[0] - 17, p[1] - 1, 34, 5);
        c.fillStyle = f > 0.5 ? '#c9c2b4' : f > 0.25 ? '#f0b34a' : '#ff8b73'; c.fillRect(p[0] - 16, p[1], 32 * f, 3);
      }
    }
    if (!s.breached || !s.valid) continue;
    if (s.kind === 'wall' && k > 0 && segs[k - 1].kind === 'wall' && segs[k - 1].breached) continue;
    let k2 = k;
    while (s.kind === 'wall' && segs[k2 + 1] && segs[k2 + 1].kind === 'wall' && segs[k2 + 1].breached) k2++;
    const e = segs[k2], x = (s.x + e.x) / 2, y = (s.y + e.y) / 2;
    const p = S(x, y, s.top + 9);
    if (p[0] < -80 || p[1] < -40 || p[0] > vw + 80 || p[1] > vh + 40) continue;
    const txt = s.kind === 'gate' ? '✕ Gate breached' : s.kind === 'postern' ? '✕ Postern breached' : s.kind === 'door' ? '✕ Wall door breached' : s.culvert || e.culvert || (k <= app.map.CULVERT && k2 >= app.map.CULVERT) ? '✕ Culvert breached' : `✕ Wall breached${k2 > k ? ` · ${(k2 - k + 1) * Math.round(s.len)} m` : ''}`;
    c.strokeStyle = 'rgba(255,110,80,0.8)'; c.lineWidth = 1; c.beginPath(); const g = S(x, y, s.top * 0.3); c.moveTo(g[0], g[1]); c.lineTo(p[0], p[1] + 10); c.stroke();
    tag(c, p[0], p[1], txt, '255,139,115', 'rgba(40,10,6,0.88)');
  }
}

function drawOverlay(dtReal) {
  const c = octx, z = app.cam.zoom, sim = app.sim, m = app.mouse;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, vw, vh);
  c.lineJoin = 'round'; c.textBaseline = 'middle';

  if (app.mode === 'setup') {
    // place names
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `600 ${Math.max(10, Math.min(15, 9 + z * 3))}px ${FONT}`;
    // (they are for finding one's way about the valley: closer in, where the places speak for themselves, they fade away)
    const la = Math.max(0, Math.min(1, (6.5 - z) / 2.5));
    if (la > 0.01) for (const l of map.labels) {
      const p = S(l.x, l.y, heightAt(l.x, l.y) + 2), t = l.text.split('').join('\u200a');
      c.fillStyle = `rgba(0,0,0,${(0.6 * la).toFixed(3)})`; c.fillText(t, p[0] + 1, p[1] + 1.5);
      c.fillStyle = `rgba(255,255,255,${(0.78 * la).toFixed(3)})`; c.fillText(t, p[0], p[1]);
    }
    // formation outlines
    for (const g of app.setup.groups) {
      const sel = g === app.selGroup, hov = g === app.hoverGroup && !app.tool;
      if (g.phase > 0 || (!sel && !hov && z < 0.75)) continue;
      const b = groupBounds(g), col = g.team === DEF ? '94,200,242' : '232,87,61';
      const ux = Math.cos(g.ang), uy = Math.sin(g.ang), gz = heightAt(g.x, g.y) + 0.3;
      c.beginPath();
      let top = 1e9, cxs = 0;
      if (g.run) {
        // posted along a wall: the outline is their stretch of the walk, bent with the wall
        const r = runBand(g), N = Math.max(4, Math.min(48, Math.ceil(r.len / 4)));
        for (let k = 0; k <= 2 * N + 1; k++) {
          const f = k <= N ? k / N : (2 * N + 1 - k) / N, w = wallPoint(map, g.run.wall, g.run.a + (g.run.b - g.run.a) * f);
          const o = k <= N ? parapetAt(map, g.run.wall, w.x, w.y, w.nx, w.ny, r.out) + 1 : r.inn; // (out to the parapet as built: round a bastion where there is one)
          const q = S(w.x + w.nx * o, w.y + w.ny * o, r.top + 0.3);
          if (k) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]);
          top = Math.min(top, q[1]);
          if (k === (N >> 1)) cxs = q[0];
        }
      } else { const e = groupExtent(g); for (const [a, p] of [[e.a0, e.p0], [e.a1, e.p0], [e.a1, e.p1], [e.a0, e.p1]]) {
        const q = S(g.x + ux * a - uy * p, g.y + uy * a + ux * p, gz);
        if (a === e.a0 && p === e.p0) c.moveTo(q[0], q[1]); else c.lineTo(q[0], q[1]);
        top = Math.min(top, q[1]); cxs += q[0] / 4;
      } }
      c.closePath();
      c.strokeStyle = `rgba(${sel ? '240,179,74' : col},${sel ? 1 : hov ? 0.9 : 0.16})`; c.lineWidth = sel ? 2 : 1;
      c.fillStyle = `rgba(${sel ? '240,179,74' : col},${sel ? 0.14 : hov ? 0.1 : 0.015})`;
      c.fill(); c.stroke();
      if (sel) {
        // (the rings are drawn round where the units stand, which is not always the middle of the width they were given)
        let rx = g.x, ry = g.y;
        if (!g.run) { const e = groupExtent(g), ma = (e.a0 + e.a1) / 2, mp = (e.p0 + e.p1) / 2; rx += ux * ma - uy * mp; ry += uy * ma + ux * mp; }
        rangeRings(c, UNITS[U[g.type]], rx, ry, 0.8);
      }
      if (sel || hov) {
        const d = UNITS[U[g.type]];
        const txt = `${d.name} × ${fmt(g.count)}${g.delay ? ` · +${g.delay} s` : ''}`;
        c.font = `600 12px ${FONT}`; c.textAlign = 'center';
        const tw = c.measureText(txt).width + 14, ty = top - 16;
        c.fillStyle = 'rgba(10,13,16,0.9)'; c.beginPath(); c.roundRect(cxs - tw / 2, ty - 10, tw, 20, 5); c.fill();
        c.fillStyle = sel ? '#f0b34a' : '#e6e9ec'; c.fillText(txt, cxs, ty + 1);
      }
    }
    // what is still to come
    const wi = sim.waveInfo();
    if (wi && wi.reserve > 0) {
      const p = S(LAYOUT.approach.mouth[0], LAYOUT.approach.mouth[1], heightAt(LAYOUT.approach.mouth[0], LAYOUT.approach.mouth[1]) + 2), txt = `◀  ${wi.W - 1} more wave${wi.W > 2 ? 's' : ''} · ${fmt(wi.reserve)}`;
      c.font = `600 12px ${FONT}`; c.textAlign = 'left';
      const tw = c.measureText(txt).width + 16, bx = Math.max(insets().l + 8, p[0] - 8);
      c.fillStyle = 'rgba(10,13,16,0.85)'; c.beginPath(); c.roundRect(bx, p[1] - 11, tw, 22, 6); c.fill();
      c.fillStyle = '#ff9c86'; c.fillText(txt, bx + 8, p[1] + 1);
    }
    // placement ghost
    if (app.tool && m.inside) {
      const d = app.drag && app.drag.kind === 'place' ? app.drag : null;
      const def = UNITS[U[app.tool.type]], q = placement(d), line = q.line;
      const g = { id: 0, type: def.key, team: def.team, count: app.brushCount, x: q.x, y: q.y, ang: q.ang, w: q.w, ...q.extra };
      if (line && def.cls === C.OBST && def.ob !== 'mine' && def.ob !== 'claymore') g.count = Math.ceil(q.w / 2) + 4;
      const pos = groupPositions(map, g), n = Math.min(g.count, pos.length / 2);
      const col = def.team === DEF ? '94,200,242' : '232,87,61';
      c.fillStyle = `rgba(${col},0.8)`;
      const step = Math.max(1, Math.ceil(n / 1500)), rr = Math.max(1.3, def.rad * z);
      c.beginPath();
      for (let k = 0; k < n; k += step) { const p = S(pos[k * 2], pos[k * 2 + 1], heightAt(pos[k * 2], pos[k * 2 + 1]) + 0.5); c.moveTo(p[0] + rr, p[1]); c.arc(p[0], p[1], rr, 0, 6.2832); }
      c.fill();
      if (line) { const a = S(d.x0, d.y0, d.z0), b = S(q.x1, q.y1, d.z0); c.strokeStyle = `rgba(${col},0.9)`; c.lineWidth = 1.5; c.setLineDash([6, 5]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.setLineDash([]); }
      if (q.lock) {
        // the stretch of wall walk they will man, lit along its parapet
        const r = g.run, half = r.wall ? KEEP.half : WALL_HALF, top = r.wall ? RING_TOP : WALL_H;
        c.strokeStyle = `rgba(${col},0.95)`; c.lineWidth = 3; c.beginPath();
        for (let k = 0; k <= 32; k++) { const w = wallPoint(map, r.wall, r.a + ((r.b - r.a) * k) / 32), p = S(w.x + w.nx * (half - 0.3), w.y + w.ny * (half - 0.3), top + 0.2); if (k) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }
        c.stroke();
      }
      rangeRings(c, def, g.x, g.y, 0.85);
      c.font = `600 12px ${FONT}`; c.textAlign = 'left';
      c.fillStyle = n ? '#fff' : '#ff8b73';
      // requisition points are only spelled out once the order of battle is opened up (Advanced)
      const cost = def.cost && !app.isSandbox() ? n * def.cost : 0;
      const over = cost && forceCost(app.setup.groups) + cost > app.setup.budget;
      if (over) c.fillStyle = '#ff8b73';
      const pts = cost && app.oobOpen ? `  ·  ${fmt(cost)} pts` : '';
      const where = q.lock ? 'On the wall  ·  ' : g.lv && g.lv.tier ? (g.lv.tier === 2 ? 'Upper court  ·  ' : 'Inner court  ·  ') : '';
      c.fillText(n ? `${where}${fmt(n)}${n < g.count && def.cls !== C.OBST ? ' / ' + fmt(g.count) : ''}${pts}${over ? '  ·  over budget' : ''}` : "Can't place here", m.sx + 16, m.sy - 12);
    }
    return;
  }

  // ---- battle ----
  const t = app.clock;
  // where the fallen lie: a heat field over the ground for the horde (deeper color = more dead in that
  // 16 m square) and a ring for every square where defenders have died
  if (app.showLosses) {
    const L = sim.loss[ORC], H2 = LOSS_CELL / 2;
    const LV = [[1, '150,40,30', 0.2], [4, '205,60,36', 0.3], [12, '238,110,40', 0.4], [30, '255,190,80', 0.5]];
    for (let lv = 0; lv < LV.length; lv++) {
      const lo = LV[lv][0], hi = lv + 1 < LV.length ? LV[lv + 1][0] : 1e9;
      c.fillStyle = `rgba(${LV[lv][1]},${LV[lv][2]})`;
      c.beginPath();
      for (let cy = 0; cy < LOSS_H; cy++) for (let cx = 0; cx < LOSS_W; cx++) {
        const n = L[cy * LOSS_W + cx];
        if (n < lo || n >= hi) continue;
        const x = cx * LOSS_CELL + H2, y = cy * LOSS_CELL + H2, h = heightAt(x, y) + 0.2;
        let p = S(x - H2, y - H2, h);
        if (p[0] < -60 || p[1] < -60 || p[0] > vw + 60 || p[1] > vh + 60) continue;
        c.moveTo(p[0], p[1]);
        p = S(x + H2, y - H2, h); c.lineTo(p[0], p[1]);
        p = S(x + H2, y + H2, h); c.lineTo(p[0], p[1]);
        p = S(x - H2, y + H2, h); c.lineTo(p[0], p[1]);
        c.closePath();
      }
      c.fill();
    }
    const Ld = sim.loss[DEF];
    c.fillStyle = 'rgba(94,200,242,0.28)'; c.strokeStyle = 'rgba(140,220,255,0.95)'; c.lineWidth = 1.5;
    c.beginPath();
    for (let cy = 0; cy < LOSS_H; cy++) for (let cx = 0; cx < LOSS_W; cx++) {
      const n = Ld[cy * LOSS_W + cx];
      if (!n) continue;
      const x = cx * LOSS_CELL + H2, y = cy * LOSS_CELL + H2;
      const p = S(x, y, heightAt(x, y) + 0.3);
      if (p[0] < -30 || p[1] < -30 || p[0] > vw + 30 || p[1] > vh + 30) continue;
      if (!p[2]) continue;
      const r = Math.max(3, Math.min(LOSS_CELL * 0.5, 1.5 + Math.sqrt(n) * 1.4) * p[2]), px0 = p[0], py0 = p[1];
      c.moveTo(px0 + r, py0); c.ellipse(px0, py0, r, r * flatAt(x, y, 0), 0, 0, 6.2832);
    }
    c.fill(); c.stroke();
    c.font = `700 11px ${FONT}`; c.textAlign = 'left';
    c.fillStyle = 'rgba(10,13,16,0.82)'; c.beginPath(); c.roundRect(vw - 246, 62, 232, 44, 8); c.fill();
    c.fillStyle = '#e8573d'; c.fillText(`● Attackers killed  ${fmt(sim.initial[1] - sim.count[ORC] - sim.stats.fled)}`, vw - 234, 80);
    c.fillStyle = '#5ec8f2'; c.fillText(`● Defenders lost  ${fmt(sim.initial[0] - sim.defCombat < 0 ? 0 : Object.values(sim.stats.lostDef).reduce((a, b) => a + b, 0))}`, vw - 234, 96);
  }
  if (app.overlay.ranges) drawRanges(c);
  else if (rangeCache.keyStr) { rangeCache.keyStr = ''; ui.setOverlayKey(null); }
  const firing = app.tool && app.tool.kind === 'fire';
  if (app.overlay.zones || firing) drawZones(c, firing ? app.tool.groups : null);
  else drawMissions(c);
  // support / order markers
  for (let k = app.markers.length - 1; k >= 0; k--) {
    const mk = app.markers[k];
    mk.t += dtReal * (app.paused ? 0 : app.speed);
    if (mk.t > mk.dur) { app.markers.splice(k, 1); continue; }
    const a = Math.min(1, (mk.dur - mk.t) * 2) * (0.55 + 0.25 * Math.sin(t * 6));
    c.strokeStyle = `rgba(${mk.col},${a})`; c.lineWidth = 1.5;
    let lx, ly;
    if (mk.x2 != null) {
      const e = S(mk.x2, mk.y2, mk.z), ex = e[0], ey = e[1], b = S(mk.x * 2 - mk.x2, mk.y * 2 - mk.y2, mk.z), bx = b[0], by = b[1];
      c.setLineDash([10, 6]); c.beginPath(); c.moveTo(bx, by); c.lineTo(ex, ey); c.stroke(); c.setLineDash([]);
      const an = Math.atan2(ey - by, ex - bx);
      c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - Math.cos(an - 0.4) * 12, ey - Math.sin(an - 0.4) * 12); c.moveTo(ex, ey); c.lineTo(ex - Math.cos(an + 0.4) * 12, ey - Math.sin(an + 0.4) * 12); c.stroke();
      lx = (bx + ex) / 2; ly = (by + ey) / 2 - 12;
    } else {
      c.setLineDash(mk.r > 10 ? [8, 6] : []); c.lineDashOffset = -t * 20;
      c.beginPath(); const p = ring(c, mk.x, mk.y, mk.z + 0.3, mk.r * (mk.r <= 6 ? 1 + mk.t : 1)); c.stroke(); c.setLineDash([]);
      lx = p[0]; ly = p[1] - Math.max(8, p[3]) - 7;
    }
    if (mk.label) { c.font = `700 10px ${FONT}`; c.textAlign = 'center'; c.fillStyle = `rgba(${mk.col},${Math.min(1, a + 0.3)})`; c.fillText(mk.label, lx, ly); }
  }
  // focus zone
  if (sim.focus) {
    const f = sim.focus;
    c.strokeStyle = 'rgba(255,90,70,0.9)'; c.lineWidth = 2; c.setLineDash([12, 8]); c.lineDashOffset = t * 30;
    c.beginPath(); const p = ring(c, f.x, f.y, heightAt(f.x, f.y) + 0.3, f.r); c.stroke(); c.setLineDash([]);
    c.fillStyle = 'rgba(255,70,50,0.07)'; c.fill();
    c.font = `700 10px ${FONT}`; c.textAlign = 'center'; c.fillStyle = 'rgba(255,140,120,0.95)';
    c.fillText(`Focus Fire · ${Math.ceil(f.until - sim.time)} s`, p[0], p[1] - p[3] - 8);
  }
  // company morale: a flag where a company has broken, a mark where one is wavering
  c.font = `700 12px ${FONT}`; c.textAlign = 'center';
  let nLab = 0;
  for (let g = 0; g < sim.ng; g++) {
    const st = sim.gState[g], conf = sim.gConf[g] > sim.time, pin = sim.gPin[g] === 2;
    const wall = !st && !conf && !pin && sim.gShield[g] === 1 && sim.gAlive[g] >= 40; // a company behind locked shields
    if ((!st && !conf && !pin && !wall) || sim.gAlive[g] < 15 || sim.gExempt[g]) continue;
    const gx = sim.gCx[g], gy = sim.gCy[g];
    const p = S(gx, gy, heightAt(gx, gy) + 5);
    if (p[0] < 0 || p[1] < 60 || p[0] > vw || p[1] > vh) continue;
    const orc = sim.gTeam[g] === ORC;
    const txt = st >= 2 ? '⚑ Routed' : conf ? '? Confused' : st ? '! Wavering' : wall ? '▣ Shield wall' : '▼ Pinned';
    // keep the field legible: never stack labels on top of one another
    let clash = false;
    for (let k = 0; k < nLab; k += 2) if (Math.abs(labXY[k] - p[0]) < 96 && Math.abs(labXY[k + 1] - p[1]) < 24) { clash = true; break; }
    if (clash || nLab >= 80) continue;
    labXY[nLab++] = p[0]; labXY[nLab++] = p[1];
    const tw = c.measureText(txt).width + 10;
    c.fillStyle = 'rgba(10,13,16,0.72)'; c.beginPath(); c.roundRect(p[0] - tw / 2, p[1] - 9, tw, 18, 4); c.fill();
    c.fillStyle = st >= 2 ? (orc ? '#f2f2ea' : '#ff8b73') : wall ? '#d6dae6' : !st && !conf ? '#8fd8ff' : orc ? '#f0b34a' : '#ffb86a';
    c.fillText(txt, p[0], p[1] + 0.5); // middle baseline: vertically centered in the tag
  }
  // commanders: a star over each so they can be found (and hunted)
  for (const team of [DEF, ORC]) for (const i of sim.cmds[team]) {
    if (!sim.alive[i]) continue;
    const p = S(sim.x[i], sim.y[i], sim.unitZ(i) + 6);
    if (p[0] < 0 || p[1] < 60 || p[0] > vw || p[1] > vh) continue;
    c.fillStyle = team === DEF ? '#7fd8ff' : '#ff6a4f'; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 2;
    c.font = `700 13px ${FONT}`; c.strokeText('★', p[0], p[1]); c.fillText('★', p[0], p[1]);
  }
  // selection rings, bars
  if (selSetSrc !== app.selection) { selSetSrc = app.selection; selSetVal = app.selection.length ? new Set(app.selection) : null; }
  const selSet = selSetVal;
  if (selSet) {
    c.strokeStyle = 'rgba(120,225,255,0.95)'; c.lineWidth = 1.3;
    c.beginPath();
    let drawn = 0;
    for (const i of app.selection) {
      const uz = sim.unitZ(i);
      const p = S(sim.x[i], sim.y[i], uz + 0.15), sx = p[0], sy = p[1];
      if (sx < -20 || sy < -20 || sx > vw + 20 || sy > vh + 20) continue;
      const r = Math.max(3.5, (sim.rad[i] + 0.7) * p[2]);
      c.moveTo(sx + r, sy); c.ellipse(sx, sy, r, r * flatAt(sim.x[i], sim.y[i], uz), 0, 0, 6.2832);
      if (sim.state[i] === S_MOVE && drawn < 60) { const q = S(sim.tx[i], sim.ty[i], heightAt(sim.tx[i], sim.ty[i])); c.moveTo(sx, sy); c.lineTo(q[0], q[1]); }
      if (++drawn > 1500) break;
    }
    c.stroke();
    // the distance a small selection is holding its fire to (V shows its full reach)
    if (app.selection.length <= 30) {
      const seen = new Set();
      for (const i of app.selection) {
        const h = sim.holdR[i], w = UNITS[sim.type[i]].wdef;
        if (!(h > 0) || !w || !w.range || h >= w.range * 1.2) continue;
        const key = ((sim.x[i] / 24) | 0) + ':' + ((sim.y[i] / 24) | 0);
        if (seen.has(key)) continue; seen.add(key);
        c.strokeStyle = 'rgba(240,179,74,0.7)'; c.lineWidth = 1; c.setLineDash([8, 7]);
        c.beginPath(); ring(c, sim.x[i], sim.y[i], sim.unitZ(i) + 0.2, h); c.stroke(); c.setLineDash([]);
      }
    }
  }
  const bar = (sx, sy, w, frac, col) => { c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 5); c.fillStyle = col; c.fillRect(sx - w / 2, sy, w * Math.max(0, Math.min(1, frac)), 3); };
  let pips = 0;
  for (let i = 0; i < sim.n; i++) {
    if (!sim.alive[i]) continue;
    const d = UNITS[sim.type[i]];
    if (d.team === DEF) {
      if (d.cls === C.INF) {
        // foot soldiers: an amber pip when out of rounds; health and ammunition when selected and close enough to read
        const dry = d.ammo && sim.ammo[i] < 1, sel = selSet && z > 1.5 && selSet.has(i);
        if (!(dry && z > 1.1) && !sel) continue;
        const p = S(sim.x[i], sim.y[i], sim.unitZ(i) + 2.6);
        if (p[0] < -10 || p[1] < 50 || p[0] > vw + 10 || p[1] > vh + 10) continue;
        if (sel && pips++ < 300) {
          const px = p[0], py = p[1];
          bar(px, py - 5, 14, sim.hp[i] / d.hp, sim.hp[i] / d.hp > 0.4 ? '#5ec8f2' : '#e8573d');
          if (d.ammo) bar(px, py, 14, sim.ammo[i] / sim.maxAmmo(i), '#f0b34a');
        } else if (dry) { c.fillStyle = '#f0b34a'; c.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3); }
        continue;
      }
      const p = S(sim.x[i], sim.y[i], sim.unitZ(i) + 4);
      if (p[0] < -30 || p[1] < -30 || p[0] > vw + 30 || p[1] > vh + 30) continue;
      if (d.cls === C.CACHE) { if (z > 0.9) bar(p[0], p[1], 26, sim.ammo[i] / d.pool, '#6fdc9a'); }
      else if (sim.hp[i] < d.hp || (selSet && selSet.has(i))) bar(p[0], p[1], 30, sim.hp[i] / d.hp, sim.hp[i] / d.hp > 0.4 ? '#5ec8f2' : '#e8573d');
    } else if (d.sz === 2 && sim.hp[i] < d.hp && z > 1.2) {
      const p = S(sim.x[i], sim.y[i], sim.unitZ(i) + (d.carry ? 17 : 5));
      if (p[0] > -30 && p[1] > -30 && p[0] < vw + 30 && p[1] < vh + 30) bar(p[0], p[1], 30, sim.hp[i] / d.hp, '#e8573d');
    }
  }
  // gates
  for (const k of [map.GATE, map.POSTERN, map.DOOR]) {
    const s = sim.segs[k];
    if (s.breached || s.hp >= s.maxHp) continue;
    const p = S(s.x, s.y, s.top + 7);
    bar(p[0], p[1], 54, s.hp / s.maxHp, '#f0b34a');
    c.font = `700 10px ${FONT}`; c.textAlign = 'center'; c.fillStyle = '#f0b34a'; c.fillText(k === map.GATE ? 'Gate' : k === map.POSTERN ? 'Postern' : 'Wall door', p[0], p[1] - 5);
  }
  // wire and obstacles the horde is tearing at: what is left of each section
  if (z > 2.2) for (const pr of sim.props) {
    if (!pr.alive || (pr.kind !== 'wire' && pr.kind !== 'av')) continue;
    const cc = map.cellOf(pr.x, pr.y), f = pr.kind === 'wire' ? sim.wireHp[cc] / WIRE_HP : sim.avHp[cc] / AV_HP;
    if (f >= 0.995 || f <= 0) continue;
    const p = S(pr.x, pr.y, heightAt(pr.x, pr.y) + 2.2);
    if (p[0] < -20 || p[1] < -20 || p[0] > innerWidth + 20 || p[1] > innerHeight + 20) continue;
    bar(p[0], p[1], Math.max(12, Math.min(30, z * 3.2)), f, f > 0.5 ? '#c9cdd2' : '#f0b34a');
  }
  drawBreaches(c);
  // drag visuals
  const d = app.drag;
  if (d && d.kind === 'box') {
    c.fillStyle = 'rgba(94,200,242,0.1)'; c.strokeStyle = 'rgba(94,200,242,0.9)'; c.lineWidth = 1;
    c.fillRect(d.sx, d.sy, m.sx - d.sx, m.sy - d.sy); c.strokeRect(d.sx + 0.5, d.sy + 0.5, m.sx - d.sx, m.sy - d.sy);
  }
  if (app.tool && m.inside) {
    const k = app.tool.kind === 'support' ? app.tool.name : app.tool.kind;
    const ax = d && d.kind === 'tool' ? d.x0 : m.wx, ay = d && d.kind === 'tool' ? d.y0 : m.wy, az = heightAt(ax, ay) + 0.3;
    const col = k === 'focus' ? '255,90,70' : k === 'supply' || k === 'gunship' ? '111,220,154' : k === 'reinforce' ? '94,200,242' : '240,179,74';
    c.strokeStyle = `rgba(${col},0.95)`; c.fillStyle = `rgba(${col},0.1)`; c.lineWidth = 1.6;
    const circle = (r, dash) => { c.setLineDash(dash ? [7, 6] : []); c.beginPath(); ring(c, ax, ay, az, r); c.fill(); c.stroke(); c.setLineDash([]); };
    if (k === 'fire') {
      const ok = artyCanReach(app.tool.groups, ax, ay);
      c.strokeStyle = ok ? 'rgba(240,179,74,0.95)' : 'rgba(255,90,70,0.95)'; c.fillStyle = ok ? 'rgba(240,179,74,0.12)' : 'rgba(255,90,70,0.1)';
      circle(24, true);
      const p = S(ax, ay, az);
      c.font = `700 11px ${FONT}`; c.textAlign = 'center'; c.fillStyle = ok ? '#f0b34a' : '#ff8b73';
      c.fillText(ok ? `${ok} ${ok > 1 ? 'batteries' : 'battery'} in range` : 'Out of range', p[0], p[1] - riseOf(ax, ay, az, 24) - 12);
    } else if (k === 'focus') circle(Math.max(28, d ? Math.hypot(m.wx - d.x0, m.wy - d.y0) : 28), true);
    else if (k === 'gunship') { circle(150, true); c.beginPath(); ring(c, ax, ay, az, 85); c.stroke(); }
    else if (k === 'supply') circle(SUPPLY_R, true);
    else if (k === 'reinforce') circle(14, false);
    else if (k === 'air') {
      let dx = 0, dy = -1, L = 230, cx = ax, cy = ay;
      if (d && Math.hypot(m.wx - d.x0, m.wy - d.y0) >= 20) { const l = Math.hypot(m.wx - d.x0, m.wy - d.y0); dx = (m.wx - d.x0) / l; dy = (m.wy - d.y0) / l; L = Math.max(170, l); cx = (d.x0 + m.wx) / 2; cy = (d.y0 + m.wy) / 2; }
      // the strip the bombs will fall on, and the direction of the run
      c.beginPath();
      [[-L / 2 - 16, -27], [L / 2 + 16, -27], [L / 2 + 16, 27], [-L / 2 - 16, 27]].forEach(([a, p], n) => { const q = S(cx + dx * a - dy * p, cy + dy * a + dx * p, az); if (n) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
      c.closePath(); c.fill(); c.setLineDash([7, 6]); c.stroke(); c.setLineDash([]);
      const h0 = S(cx + dx * (L / 2 + 16), cy + dy * (L / 2 + 16), az), hx = h0[0], hy = h0[1], h1 = S(cx + dx * (L / 2 + 46), cy + dy * (L / 2 + 46), az);
      c.beginPath(); c.moveTo(hx, hy); c.lineTo(h1[0], h1[1]); c.stroke();
      const an = Math.atan2(h1[1] - hy, h1[0] - hx);
      c.beginPath(); c.moveTo(h1[0], h1[1]); c.lineTo(h1[0] - Math.cos(an - 0.45) * 11, h1[1] - Math.sin(an - 0.45) * 11); c.lineTo(h1[0] - Math.cos(an + 0.45) * 11, h1[1] - Math.sin(an + 0.45) * 11); c.closePath(); c.fillStyle = `rgba(${col},0.95)`; c.fill();
    }
    const p = S(ax, ay, az);
    c.beginPath(); c.moveTo(p[0] - 9, p[1]); c.lineTo(p[0] + 9, p[1]); c.moveTo(p[0], p[1] - 9); c.lineTo(p[0], p[1] + 9); c.stroke();
  }
  // night rain, thinning out as the sky lightens
  const rainA = Math.max(0, Math.min(1, (0.44 - app.env.amb[0]) * 6));
  if (rainA > 0.03) {
    if (!app.paused) app.rainT = (app.rainT || 0) + dtReal;
    const rt = app.rainT || 0;
    c.strokeStyle = `rgba(196,210,232,${0.16 * rainA * (renderer.quality === 'low' ? 1 : 1 - 0.8 * Math.max(0, Math.min(1, (app.cam.zoom - 3.5) / 4.5)))})`; c.lineWidth = 1; // (close in, the rain is in the scene: see fx.rain)
    c.beginPath();
    for (let k = 0; k < 130; k++) {
      const sp = 0.8 + ((k * 37) % 11) * 0.05, len = 12 + (k % 5) * 4;
      const px = ((k * 131.7 + rt * 240 * sp) % (vw + 160)) - 80, py = ((k * 71.3 + rt * 1250 * sp) % (vh + 80)) - 40;
      c.moveTo(px, py); c.lineTo(px - len * 0.2, py - len);
    }
    c.stroke();
  }
  if (app.env.flash > 0.01 && renderer.quality !== 'high') { c.fillStyle = `rgba(210,220,255,${app.env.flash})`; c.fillRect(0, 0, vw, vh); }
  if (app.paused && !sim.result) {
    c.font = `700 13px ${FONT}`; c.textAlign = 'center'; c.fillStyle = 'rgba(240,179,74,0.95)';
    c.fillText('Paused · you can still give orders', vw / 2, 78);
  }
}

// ----------------------------------------------------------------- minimap
let mmBase = null, mmImg = null, mmVersion = -1, mmFrame = 0;
function drawMinimap() {
  const sim = app.sim, W = mm.width, H = mm.height;
  if (!mmBase || mmVersion !== sim.structVersion) {
    const px = renderer.terrainThumb(W, H, sim);
    mmBase = new ImageData(W, H); mmImg = new ImageData(W, H); mmVersion = sim.structVersion;
    for (let k = 0; k < W * H; k++) { mmBase.data[k * 4] = px[k * 4] * 0.85; mmBase.data[k * 4 + 1] = px[k * 4 + 1] * 0.85; mmBase.data[k * 4 + 2] = px[k * 4 + 2] * 0.85; mmBase.data[k * 4 + 3] = 255; }
  }
  // one reusable image: start from the terrain each time, then dot the units on top
  const img = mmImg, dta = img.data;
  dta.set(mmBase.data);
  const kx = W / WORLD_W, ky = H / WORLD_H;
  for (let i = 0; i < sim.n; i++) {
    if (!sim.alive[i]) continue;
    const x = (sim.x[i] * kx) | 0, y = (sim.y[i] * ky) | 0;
    if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) continue;
    const o = (y * W + x) * 4;
    if (sim.team[i] === ORC) { dta[o] = 235; dta[o + 1] = 70; dta[o + 2] = 45; }
    else { dta[o] = 110; dta[o + 1] = 220; dta[o + 2] = 255; dta[o + 4] = 110; dta[o + 5] = 220; dta[o + 6] = 255; dta[o + W * 4] = 110; dta[o + W * 4 + 1] = 220; dta[o + W * 4 + 2] = 255; }
  }
  mctx.putImageData(img, 0, 0);
  // the patch of ground the camera sees
  mctx.strokeStyle = 'rgba(255,255,255,0.9)'; mctx.lineWidth = 1;
  mctx.beginPath();
  [[0, 54], [vw, 54], [vw, vh], [0, vh]].forEach(([sx, sy], n) => { const g = toGround(app.cam, vw, vh, sx, sy, 0, T2); if (n) mctx.lineTo(g[0] * kx, g[1] * ky); else mctx.moveTo(g[0] * kx, g[1] * ky); });
  mctx.closePath(); mctx.stroke();
  if (sim.focus) { mctx.strokeStyle = '#ff5a46'; mctx.beginPath(); mctx.arc(sim.focus.x * kx, sim.focus.y * ky, Math.max(3, sim.focus.r * kx), 0, 6.2832); mctx.stroke(); }
  for (const a of sim.arty) if (a.n && a.mode === 'target') { mctx.strokeStyle = '#f0b34a'; mctx.beginPath(); mctx.arc(a.x * kx, a.y * ky, 3, 0, 6.2832); mctx.moveTo(a.x * kx - 5, a.y * ky); mctx.lineTo(a.x * kx + 5, a.y * ky); mctx.moveTo(a.x * kx, a.y * ky - 5); mctx.lineTo(a.x * kx, a.y * ky + 5); mctx.stroke(); }
  for (const mk of app.markers) { if (!mk.label) continue; mctx.strokeStyle = `rgb(${mk.col})`; mctx.beginPath(); mctx.arc(mk.x * kx, mk.y * ky, 3.5, 0, 6.2832); mctx.stroke(); }
  // a wave forming or marching on: chevrons at the valley mouth
  const wv = sim.waveInfo();
  if (wv && !sim.result && ((wv.next && wv.next.forming) || wv.phase === 'approach')) {
    const hot = wv.phase === 'approach', a = 0.45 + 0.45 * Math.sin(app.clock * 5);
    mctx.strokeStyle = hot ? `rgba(255,110,90,${a})` : `rgba(240,179,74,${a})`; mctx.lineWidth = 2;
    // pointing at the stretch of wall it has been aimed at, when it has one
    const sec = hot ? wv.sector : wv.next.sector, yy = sec ? sec.y * ky : H * 0.5;
    for (let k = 0; k < 3; k++) { const x = 5 + k * 7; mctx.beginPath(); mctx.moveTo(x, yy - 9); mctx.lineTo(x + 6, yy); mctx.lineTo(x, yy + 9); mctx.stroke(); }
    if (sec) { mctx.setLineDash([4, 4]); mctx.lineWidth = 1.2; mctx.beginPath(); mctx.moveTo(30, yy); mctx.lineTo(sec.x * kx - 8, yy); mctx.stroke(); mctx.setLineDash([]); }
  }
  // alert pings: a ring that opens out from where it happened
  mctx.lineWidth = 1.6;
  for (const a of app.alerts) {
    const age = app.clock - a.t;
    if (age > 7) continue;
    const col = a.cls === 'bad' ? '255,110,90' : a.cls === 'warn' ? '240,179,74' : a.cls === 'good' ? '111,220,154' : '230,233,236';
    const u = (age % 1.75) / 1.75;
    mctx.strokeStyle = `rgba(${col},${(1 - u) * Math.min(1, (7 - age) / 2)})`;
    mctx.beginPath(); mctx.arc(a.x * kx, a.y * ky, 2.5 + u * 13, 0, 6.2832); mctx.stroke();
    mctx.fillStyle = `rgba(${col},${Math.min(1, (7 - age) / 2)})`; mctx.beginPath(); mctx.arc(a.x * kx, a.y * ky, 2, 0, 6.2832); mctx.fill();
  }
  mctx.lineWidth = 1;
}

// -------------------------------------------------------------------- loop
let last = performance.now(), hudT = 0;
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  app.clock += rdt;

  // Graphics quality on Auto: one level down when this machine is not holding the frame rate at the present one, one
  // level back up after it has run clean for a while. A level that failed is not tried again at once, and waits longer
  // each time it fails.
  const g = app.gfx;
  if (g.auto && !document.hidden && rdt < 0.25) {
    // (what a frame costs on this screen at best: a 30 Hz screen is not "slow" at 33 ms)
    g.best = Math.min(rdt, g.best + rdt * 0.0005);
    if (now < g.holdUntil) { g.n = g.slow = 0; g.w0 = now; } else {
      g.n++;
      // (a frame the battle's own arithmetic made long is not one that drawing less would mend)
      if (rdt > Math.max(0.0205, g.best * 1.4) && app.simMs < 9) g.slow++;
      if (g.n >= 90 || (now - g.w0 > 2500 && g.n >= 6)) { // (a second and a half of good frames, or two and a half seconds of whatever came)
        const at = GFX_ORDER.indexOf(g.level);
        if (g.slow > g.n / 3 && at > 0) {
          if (now - g.raisedAt < 12000) g.backoff = Math.min(600000, g.backoff * 2); // (it was the step up that did it)
          g.retryAt = now + g.backoff; g.calm = 0;
          app.applyQuality(GFX_ORDER[at - 1]); g.holdUntil = now + 2500;
        } else if (g.slow <= g.n / 40) {
          g.calm += now - g.w0;
          if (now - g.raisedAt > 45000) g.backoff = 60000; // (the last step up has held: start afresh)
          if (g.calm >= 20000 && at < GFX_ORDER.length - 1 && now >= g.retryAt) { /* twenty clean seconds */ g.calm = 0; g.raisedAt = now; app.applyQuality(GFX_ORDER[at + 1]); g.holdUntil = now + 2500; }
        } else g.calm = 0;
        g.n = g.slow = 0; g.w0 = now;
      }
    }
  }

  // keyboard pan and rotate
  const ks = app.keys, cam = app.cam;
  if (app.mode === 'battle' || !(document.activeElement instanceof HTMLInputElement)) {
    const pan = (620 / cam.zoom) * rdt, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    let rx = 0, ry = 0;
    if (ks.has('a') || ks.has('arrowleft')) rx -= pan;
    if (ks.has('d') || ks.has('arrowright')) rx += pan;
    if (ks.has('w') || ks.has('arrowup')) ry -= pan * 1.3;
    if (ks.has('s') || ks.has('arrowdown')) ry += pan * 1.3;
    if (rx || ry) { cam.x += cy * rx - sy * ry; cam.y += sy * rx + cy * ry; }
    if (ks.has('pageup')) cam.tilt = (cam.tilt || 0) + 0.8 * rdt;   // tip the view up toward the vertical, or lay it down
    if (ks.has('pagedown')) cam.tilt = (cam.tilt || 0) - 0.8 * rdt;
    if (ks.has('q')) cam.yaw += 1.3 * rdt;
    if (ks.has('e')) cam.yaw -= 1.3 * rdt;
    clampCam();
  }
  // the view looks at whatever stands at its center: a wall walk, the court, the valley floor (eased, so crossing a parapet does not jolt)
  { const tz = Math.max(0, Math.min(30, heightAt(cam.x, cam.y))); cam.z += (tz - cam.z) * Math.min(1, rdt * 6); if (Math.abs(tz - cam.z) < 0.01) cam.z = tz; }
  if (app.previewDirty && !(app.drag && app.drag.kind === 'moveGroup')) rebuildPreview();

  const sim = app.sim;
  fx.view.x = cam.x; fx.view.y = cam.y; fx.view.zoom = cam.zoom; fx.view.cy = Math.cos(cam.yaw); fx.view.sy = Math.sin(cam.yaw);
  // how far round the point of interest effects are worth their particles: what the screen shows at that depth, and more when the view lies low
  fx.view.rad = Math.min(520, (Math.hypot(vw / 2, vh / 2) / cam.zoom) * (1 + 1.6 * Math.cos(camState(cam, vw, vh).pitch)) + 40);

  let alpha = 1, simDt = 0, simMs = 0;
  const halted = app.paused || ui.modalOpen(); // the battle waits while a dialog is up
  if (app.mode === 'battle') {
    // a breath of slow motion when something momentous happens
    let scale = 1;
    if (app.slowT > 0) { app.slowT -= rdt; scale = app.slowT > 0.6 ? 0.2 : 0.2 + 0.8 * (1 - Math.max(0, app.slowT) / 0.6); }
    fx.frame(app.speed);
    if (!halted && !sim.result) {
      app.acc += rdt * app.speed * scale;
      const t0 = performance.now();
      let ticks = 0;
      while (app.acc >= DT && ticks < 10) {
        sim.step(); app.acc -= DT; ticks++; simDt += DT;
        if (performance.now() - t0 > 15) break;
      }
      fx.now = sim.time;
      app.fxq.replay(fx);
      simMs = performance.now() - t0; app.simMs = simMs;
      if (app.acc > DT * 2) app.acc = DT; // can't keep up: drop the backlog rather than spiral
      alpha = Math.min(1, app.acc / DT);
      const fdt = Math.min(0.25, rdt * app.speed * scale);
      // rain in the scene itself where the view is close enough to see it fall (further out, the streaks over the picture carry it)
      const rainNow = Math.max(0, Math.min(1, (0.44 - app.env.amb[0]) * 6)), nearK = Math.max(0, Math.min(1, (cam.zoom - 3.5) / 4.5));
      if (rainNow * nearK > 0.03 && renderer.quality !== 'low') fx.rain(cam.x, cam.y, heightAt, Math.max(18, Math.min(95, (0.62 * Math.max(innerWidth, innerHeight)) / cam.zoom)), rainNow * nearK, fdt);
      fx.update(fdt);
    } else if (sim.result) fx.update(rdt * 0.6);
    for (const e of sim.events) {
      const loc = e.x != null ? { x: e.x, y: e.y } : null;
      if (loc && (e.cls === 'bad' || e.cls === 'warn') && (e.type === 'banner' || e.type === 'log')) noteAlert(e); // good news does not need a ping
      if (e.type === 'banner') { ui.banner(e.text, e.cls); ui.toast(e.text, e.cls, loc); if (e.big && app.speed <= 2) app.slowT = 2.2; }
      else if (e.type === 'log') ui.toast(e.text, e.cls, loc);
      else if (e.type === 'cp' && e.amt >= 0.15) marker(e.x, e.y, 4, 3.5, '240,179,74', `+${e.amt.toFixed(1)} CP`);
      else if (e.type === 'end') {
        // score a challenge and remember the best result on each scenario
        const sc = sim.opt.sandbox ? null : scoreBattle(sim, { budget: app.setup.budget, spent: app.battleSpent });
        if (sc) {
          const best = loadBest(), old = best[app.presetKey];
          sc.best = old ? old.score : null;
          if (!old || sc.total > old.score) { sc.newBest = true; best[app.presetKey] = { score: sc.total, medal: sc.medal ? sc.medal.key : null }; try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* private mode */ } ui.refreshPresets(best); }
        }
        app.lastScore = sc;
        audio.horn(); setTimeout(() => { if (app.sim === sim && app.mode === 'battle') ui.showEnd(sim); }, 2600); ui.banner(e.win ? 'Victory' : 'Defeat', e.win ? 'good' : 'bad'); app.tool = null; ui.hint(null);
      }
    }
    sim.events.length = 0;
  }

  // light: a stormy night that grays toward dawn, with the odd flash of lightning
  let mood = MOOD.setup;
  if (app.mode === 'battle') {
    const p = sim.opt.dawn > 0 ? Math.min(1, sim.time / sim.opt.dawn) : Math.min(0.7, sim.time / 1500);
    if (p < 0.72) mood = MOOD.night;
    else if (p < 0.93) { const u = (p - 0.72) / 0.21; mood = [lerp3(MOOD.night[0], MOOD.dawn[0], u), lerp3(MOOD.night[1], MOOD.dawn[1], u), lerp3(MOOD.night[2], MOOD.dawn[2], u), 0.26 - 0.22 * u]; }
    else { const u = (p - 0.93) / 0.07; mood = [lerp3(MOOD.dawn[0], MOOD.day[0], u), lerp3(MOOD.dawn[1], MOOD.day[1], u), lerp3(MOOD.dawn[2], MOOD.day[2], u), 0.04]; }
    if (mood === MOOD.night && !halted && !sim.result) {
      if ((app.nextBolt -= rdt) <= 0) { app.bolt = 0; app.nextBolt = 14 + Math.random() * 26; setTimeout(() => audio.play('boom', 0.35, 0), 700 + Math.random() * 900); }
    }
  }
  const env = app.env, k = Math.min(1, rdt * 1.5);
  if (!app._base) app._base = { amb: env.amb.slice(), sun: env.sun.slice(), fog: env.fog.slice() };
  const base = app._base;
  for (let q = 0; q < 3; q++) { base.amb[q] += (mood[0][q] - base.amb[q]) * k; base.sun[q] += (mood[1][q] - base.sun[q]) * k; base.fog[q] += (mood[2][q] - base.fog[q]) * k; }
  env.lift += (mood[3] - env.lift) * k;
  let bolt = 0;
  if (app.bolt >= 0) { app.bolt += rdt; const b = app.bolt; bolt = b < 0.07 ? 1 : b < 0.15 ? 0.15 : b < 0.24 ? 0.7 : Math.max(0, 0.7 - (b - 0.24) * 2.4); if (b > 0.6) app.bolt = -1; }
  for (let q = 0; q < 3; q++) { env.amb[q] = base.amb[q] + bolt * [0.5, 0.55, 0.75][q]; env.sun[q] = base.sun[q] + bolt * [0.7, 0.75, 0.95][q]; env.fog[q] = base.fog[q] + bolt * 0.08; }
  env.flash = bolt * 0.07;
  env.wet = app.mode === 'battle' ? Math.max(0, Math.min(1, (0.44 - base.amb[0]) * 6)) : 0;   // it rains through the night

  const sh = fx.shake, shk = sh ? (sh * 2.2) / Math.max(0.6, cam.zoom * 0.5) : 0;
  const rcam = { x: cam.x + Math.sin(app.clock * 71) * shk, y: cam.y + Math.cos(app.clock * 83) * shk, z: cam.z, zoom: cam.zoom * dpr, yaw: cam.yaw, tilt: cam.tilt, dpr, ground: map.terrZ };
  renderer.render(rcam, sim, app.mode === 'battle' ? fx : null, alpha, env, app.clock);
  // drop the fallen from the selection (a fresh array only when someone actually fell)
  if (app.selection.length && app.selection.some((i) => !sim.alive[i] || sim.team[i] !== DEF)) app.selection = app.selection.filter((i) => sim.alive[i] && sim.team[i] === DEF);
  drawOverlay(rdt);
  perf.frame(rdt, simMs);

  hudT += rdt;
  if (hudT > 0.12) {
    hudT = 0;
    ui.updateHud();
    if (app.mode === 'battle') audio.setRoar(halted || sim.result ? 0 : Math.min(0.14, (sim.onField() / 9000) * 0.1 * Math.min(1, 0.4 + cam.zoom / 4)));
  }
  if (app.mode === 'battle' && (mmFrame++ & 3) === 0) drawMinimap();
}

// ---------------------------------------------------------------- settings
// Graphics quality is one setting. Each level is a rendering quality (the picture's resolution, its anti-aliasing, glow
// and HDR, rain in the scene) and how far out soldiers are drawn in full detail. Auto moves between them by the frame
// rate (see the loop). ?q=low|medium|high in the address fixes the rendering quality for a test, whatever is stored.
const GFX = { low: ['low', 0.5], medium: ['medium', 0.375], high: ['high', HERO_SCALE_DEFAULT], ultra: ['high', 0.225] }, GFX_ORDER = ['low', 'medium', 'high', 'ultra'];
const SETTINGS_KEY = 'hd-settings-v3';
app.settings = { quality: 'auto', autoLevel: 'high', seed: 1 };
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
  // (earlier versions kept only the model-detail step and the seed: the seed is carried over)
  const old = !saved && (JSON.parse(localStorage.getItem('hd-settings-v2')) || JSON.parse(localStorage.getItem('hd-settings-v1')));
  Object.assign(app.settings, saved || (old && old.seed ? { seed: old.seed } : {}));
} catch { /* private mode */ }
if (!GFX[app.settings.quality] && app.settings.quality !== 'auto') app.settings.quality = 'auto';
if (!GFX[app.settings.autoLevel]) app.settings.autoLevel = 'high';
const store = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings)); } catch { /* private mode */ } };
app.gfx = { level: 'high', auto: false, n: 0, slow: 0, calm: 0, w0: 0, best: 0.02, holdUntil: 0, retryAt: 0, raisedAt: -1e9, backoff: 60000 };
app.simMs = 0;
/** Put a level of graphics quality into effect (Auto calls this as it moves, and remembers where it got to). */
app.applyQuality = (level) => {
  const [q, detail] = GFX[level];
  app.gfx.level = level;
  renderer.heroScale = detail;
  if (renderer.quality !== q) { renderer.setQuality(q); resize(); }
  if (app.gfx.auto && app.settings.autoLevel !== level) { app.settings.autoLevel = level; store(); }
  if (ui && ui.refreshSettings) ui.refreshSettings();
};
/** Change a setting, apply it and remember it on this browser. */
app.setSetting = (k, v) => {
  app.settings[k] = v;
  if (k === 'quality') {
    const fixed = params.has('q') || params.has('bench');
    app.gfx.auto = v === 'auto' && !fixed;
    Object.assign(app.gfx, { n: 0, slow: 0, calm: 0, holdUntil: performance.now() + 3000, retryAt: 0, backoff: 60000 });
    if (!fixed) app.applyQuality(v === 'auto' ? app.settings.autoLevel : v);
  }
  store();
};

// -------------------------------------------------------------------- boot
if (params.has('q')) { renderer.setQuality(['low', 'medium', 'high'].includes(params.get('q')) ? params.get('q') : 'high'); renderer.heroScale = HERO_SCALE_DEFAULT; }
else app.setSetting('quality', app.settings.quality);
// unit models built from files arrive after the game is up: until then (or with ?assets=0) the built-in ones stand in
renderer.fx = fx;
if (params.get('assets') !== '0') {
  // the models are kept on the device by a service worker (sw.js), and the browser is asked not to throw them out
  // when it is short of room; neither is needed for the game to run
  if ('serviceWorker' in navigator && params.get('sw') !== '0') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  app.assetsReady = loadUnitPacks((name, pack, image) => renderer.addUnitAsset(name, pack, image), null, (name, prop) => renderer.addProp(name, prop), (name, image) => renderer.addTexture(name, image));
}
const perf = new Perf(app, renderer);
app.keepCentre = [KEEP.cx, KEEP.cy];
app.homeView = () => { app.cam.yaw = DEFAULT_YAW; fitCamera(); };
await loading.set(85);
// the menus wait a few seconds for the painted portraits; without them they show placeholders, and fill in if the pictures turn up late
const portraitsLate = await Promise.race([portraitsReady.then(() => false), new Promise((r) => setTimeout(r, 5000, true))]);
ui = buildUI(app, portraits);
if (portraitsLate) portraitsReady.then(() => { ui.refreshPalette(); ui.refreshRoster(); });
ui.refreshPresets(loadBest());
resize();
app.loadPreset('empty', true, true); // an empty field behind the welcome screen, until a mode is chosen
fitCamera();
requestAnimationFrame((t) => { last = t; frame(t); loading.set(100); loading.done(params.has('bench') ? 0 : 800); });
if (!params.has('bench')) ui.showWelcome();

// handy for debugging and automated tests
app.project = (x, y, z) => { const p = S(x, y, z == null ? heightAt(x, y) : z); return [p[0], p[1]]; };
app.rebuildPreview = rebuildPreview; // (for tools/uicheck.js)
window.__app = app; window.__ui = ui; window.__renderer = renderer; window.__fx = fx; window.__perf = perf;
if (params.has('perf')) perf.toggle(true);
if (params.has('bench')) setTimeout(() => perf.bench(), 500);
