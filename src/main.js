// Application glue: state machine (setup -> battle -> debrief), isometric camera, input,
// the frame loop and the 2D overlay (selection, cursors, markers, losses, minimap).

import { WORLD_W, WORLD_H, DT, DEF, ORC, UNITS, U, C, SUPPORT } from './config.js';
import { buildMap, KEEP } from './map.js';
import { buildPreset, makeGroup, groupPositions, groupBounds, PRESETS } from './scenarios.js';
import { Sim, S_MOVE, LOSS_CELL, LOSS_W, LOSS_H } from './sim/sim.js';
import { drawAtlas } from './render/atlas.js';
import { Renderer } from './render/renderer.js';
import { toScreen, toGround, pick, SIN_P, DEFAULT_YAW } from './render/camera.js';
import { Fx } from './render/fx.js';
import { Audio } from './audio.js';
import { buildUI, fmt } from './ui/ui.js';

const $ = (id) => document.getElementById(id);
const glCanvas = $('gl'), overlay = $('overlay'), octx = overlay.getContext('2d');
const mm = $('mm'), mctx = mm.getContext('2d');
const params = new URLSearchParams(location.search);

const map = buildMap();
const atlas = drawAtlas();
let renderer;
try {
  renderer = new Renderer(glCanvas, map, atlas);
} catch (err) {
  $('loading').innerHTML = '<span>This simulator needs WebGL2, which this browser or device did not provide.</span>';
  throw err;
}
const audio = new Audio();
const fx = new Fx(audio);

// lighting moods: [ambient, sun/moon, fog, lift]
const MOOD = {
  setup: [[0.5, 0.52, 0.55], [0.92, 0.86, 0.76], [0.1, 0.12, 0.14], 0.03],
  night: [[0.3, 0.36, 0.54], [0.46, 0.53, 0.7], [0.025, 0.035, 0.06], 0.26],
  dawn: [[0.5, 0.4, 0.36], [1.05, 0.72, 0.5], [0.16, 0.12, 0.11], 0.04],
  day: [[0.52, 0.53, 0.55], [0.95, 0.9, 0.8], [0.12, 0.14, 0.16], 0.03],
};

const app = {
  mode: 'setup', map, setup: null, sim: null,
  cam: { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 0.6, yaw: DEFAULT_YAW },
  speed: 1, paused: false, tool: null, brushCount: 50,
  selGroup: null, hoverGroup: null, selection: [], markers: [],
  previewDirty: false, clock: 0, acc: 0, slowT: 0, showLosses: false,
  env: { amb: MOOD.setup[0].slice(), sun: MOOD.setup[1].slice(), fog: MOOD.setup[2].slice(), lift: 0.03, flash: 0, shadows: true },
  bolt: -1, nextBolt: 14,
  mouse: { sx: 0, sy: 0, wx: 0, wy: 0, wz: 0, inside: false },
  drag: null, keys: new Set(),
};
let ui;
let dpr = 1, vw = 1, vh = 1;
const T2 = [0, 0], T3 = [0, 0, 0];

// ------------------------------------------------------------------ camera
const heightAt = (x, y) => (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H ? 0 : app.sim ? app.sim.surfZ(x, y) : map.groundZ(x, y));
/** World -> overlay pixels. Result is valid until the next call. */
const S = (x, y, z = 0) => toScreen(app.cam, vw, vh, x, y, z, T2);
const labXY = new Float32Array(160);
function pickAt(sx, sy) { const p = pick(app.cam, vw, vh, sx, sy, heightAt, T3); return { x: p[0], y: p[1], z: p[2] }; }
function insets() { return app.mode === 'setup' ? { l: 316, r: 336, t: 54, b: 0 } : { l: 0, r: 0, t: 54, b: 96 }; }
function fitZoom() {
  const i = insets(), c = Math.abs(Math.cos(app.cam.yaw)), s = Math.abs(Math.sin(app.cam.yaw));
  const ew = WORLD_W * c + WORLD_H * s, eh = (WORLD_W * s + WORLD_H * c) * SIN_P;
  return Math.min((vw - i.l - i.r) / ew, (vh - i.t - i.b) / eh);
}
function fitCamera() {
  const i = insets(), c = app.cam;
  c.zoom = fitZoom() * 1.32; c.x = WORLD_W / 2 + 60; c.y = WORLD_H / 2 - 20;
  const g = toGround(c, vw, vh, vw - (i.l + (vw - i.l - i.r) / 2), vh - (i.t + (vh - i.t - i.b) / 2), 0, T2);
  c.x = g[0]; c.y = g[1];
}
function clampCam() {
  const c = app.cam;
  c.zoom = Math.max(fitZoom() * 0.8, Math.min(18, c.zoom));
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
  dpr = Math.min(renderer.quality === 'high' ? 2 : 1.25, window.devicePixelRatio || 1);
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
app.loadPreset = (key) => {
  app.setup = buildPreset(map, key);
  app.presetKey = key;
  app.selGroup = null; app.tool = null;
  ui.setPreset(key); ui.refreshRoster(); ui.refreshOptions(); ui.refreshInspector(); ui.refreshPalette(); ui.hint(null);
  rebuildPreview();
  const p = PRESETS.find((q) => q.key === key);
  if (p) ui.toast(p.blurb);
};
app.selectPlaceTool = (type) => {
  app.tool = type ? { kind: 'place', type } : null;
  app.selGroup = null;
  ui.refreshPalette(); ui.refreshInspector();
  const d = type && UNITS[U[type]];
  ui.hint(type ? `<b>${d.name}</b> — ${d.cls === C.OBST ? 'drag to lay a line' : 'click to drop a block, drag to draw a line'} · right-click when done` : null);
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

function groupAt(wx, wy) {
  let best = null, ba = 1e12;
  for (const g of app.setup.groups) {
    const b = groupBounds(g), ux = Math.cos(g.ang), uy = Math.sin(g.ang);
    const dx = wx - g.x, dy = wy - g.y;
    const a = dx * ux + dy * uy, p = -dx * uy + dy * ux;
    const pad = 3 / app.cam.zoom + 1;
    if (Math.abs(a) < b.hw + pad && Math.abs(p) < b.hd + pad) { const area = b.hw * b.hd; if (area < ba) { ba = area; best = g; } }
  }
  return best;
}

// ------------------------------------------------------------ battle state
app.startBattle = () => {
  audio.unlock();
  const real = (g, team) => g.team === team && UNITS[U[g.type]].cls !== C.OBST;
  if (!app.setup.groups.some((g) => real(g, DEF)) || !app.setup.groups.some((g) => real(g, ORC))) { ui.toast('Place at least one defender and one attacker first.', 'warn'); audio.play('deny'); return; }
  fx.reset(); renderer.clearDecals();
  app.sim = new Sim(map, app.setup, fx);
  fx.groundFn = (x, y) => (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H ? 0 : app.sim.surfZ(x, y));
  app.mode = 'battle'; app.paused = false; app.speed = 1; app.acc = 0; app.slowT = 0; app.showLosses = false;
  app.tool = null; app.selGroup = null; app.selection = []; app.markers = []; app.drag = null; app.bolt = -1; app.nextBolt = 10;
  ui.setMode('battle'); ui.clearFeed(); ui.hint(null); ui.hideModal();
  fitCamera();
  ui.banner('Hold the Deep', 'warn');
  ui.toast('The horde advances in waves. Space pauses; number keys call support.');
  audio.horn();
  mmBase = null;
  ui.updateHud();
};
app.backToSetup = () => {
  app.mode = 'setup'; app.tool = null; app.selection = []; app.markers = []; app.drag = null; app.showLosses = false;
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
  if (s.left <= 0) { ui.toast(`No ${SUPPORT[k].name.toLowerCase()} left.`, 'warn'); audio.play('deny'); return; }
  if (app.sim.time < s.ready) { ui.toast(`${SUPPORT[k].name} ready in ${Math.ceil(s.ready - app.sim.time)} s.`, 'warn'); audio.play('deny'); return; }
  app.tool = { kind: 'support', name: k };
  audio.play('click');
  ui.hint(`<b>${SUPPORT[k].name}</b> — ${k === 'air' ? 'click a target, or drag to set the attack heading' : 'click the target'} · right-click to cancel`);
};
app.armFocus = () => {
  if (app.mode !== 'battle') return;
  if (app.sim.focus) { app.sim.clearFocus(); ui.toast('Focus fire lifted.'); return; }
  if (app.tool && app.tool.kind === 'focus') { app.tool = null; ui.hint(null); return; }
  app.tool = { kind: 'focus' };
  audio.play('click');
  ui.hint('<b>Focus Fire</b> — drag a circle over the enemy · right-click to cancel');
};
app.toggleHold = () => {
  if (app.mode !== 'battle') return;
  app.sim.holdIndirect = !app.sim.holdIndirect;
  ui.toast(app.sim.holdIndirect ? 'Mortars and howitzers: hold fire.' : 'Mortars and howitzers: fire at will.', app.sim.holdIndirect ? 'warn' : 'good');
  audio.play('click');
};
app.retreat = () => {
  if (app.mode !== 'battle' || app.sim.result) return;
  const n = app.sim.orderRetreat();
  if (!n) ui.toast('Everyone is already inside the Hornburg.');
  else { audio.horn(); app.markers.push({ x: KEEP.cx, y: KEEP.cy, z: 12, r: KEEP.r + 8, t: 0, dur: 6, col: '94,200,242', label: 'FALL BACK' }); }
};

function marker(x, y, r, dur, col, label, x2, y2) { app.markers.push({ x, y, z: heightAt(x, y), r, t: 0, dur, col, label, x2, y2 }); }

function fireTool(x0, y0, x1, y1) {
  const t = app.tool, sim = app.sim;
  if (t.kind === 'focus') {
    sim.setFocus(x0, y0, Math.max(28, Math.hypot(x1 - x0, y1 - y0)));
    ui.toast('All guns: concentrate fire on the marked area.', 'good');
    audio.play('confirm');
  } else {
    const k = t.name;
    if (!sim.callSupport(k, x0, y0, x1, y1)) { audio.play('deny'); return; }
    audio.play('confirm');
    if (k === 'air') { const L = Math.hypot(x1 - x0, y1 - y0); if (L < 20) marker(x0, y0, 20, 7, '240,179,74', 'AIR STRIKE', x0, y0 - 115); else marker((x0 + x1) / 2, (y0 + y1) / 2, 20, 7, '240,179,74', 'AIR STRIKE', x1, y1); }
    else if (k === 'arty') marker(x0, y0, 45, 14, '240,179,74', 'FIRE MISSION');
    else if (k === 'gunship') marker(x0, y0, 150, 48, '111,220,154', 'GUNSHIPS');
    else if (k === 'supply') marker(x0, y0, 60, 12, '111,220,154', 'RESUPPLY');
    else marker(x0, y0, 14, 22, '94,200,242', 'AIR ASSAULT');
  }
  app.tool = null; ui.hint(null);
}

// ------------------------------------------------------------------- input
function updateMouse(e) {
  const m = app.mouse;
  m.sx = e.clientX; m.sy = e.clientY; m.inside = true;
  const p = pickAt(m.sx, m.sy); m.wx = p.x; m.wy = p.y; m.wz = p.z;
}
const panDrag = (m, btn, moved) => ({ kind: btn === 1 ? 'rot' : 'rpan', sx: m.sx, sy: m.sy, cx: app.cam.x, cy: app.cam.y, yaw: app.cam.yaw, moved, btn });
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
    if (app.tool) { app.drag = { kind: 'place', x0: m.wx, y0: m.wy }; return; }
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
      c.x = d.cx; c.y = d.cy;
      const g = toGround(c, vw, vh, vw / 2 - (m.sx - d.sx), vh / 2 - (m.sy - d.sy), 0, T2);
      c.x = g[0]; c.y = g[1]; clampCam();
      if (Number.isNaN(c.x)) { c.x = keep[0]; c.y = keep[1]; }
    }
  } else if (d.kind === 'rot') {
    d.moved = true;
    app.cam.yaw = d.yaw - (m.sx - d.sx) * 0.006;
  } else if (d.kind === 'moveGroup') {
    d.g.x = m.wx - d.ox; d.g.y = m.wy - d.oy; d.moved = true;
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
    const L = Math.hypot(m.wx - d.x0, m.wy - d.y0);
    const line = L > Math.max(5, 10 / app.cam.zoom);
    const def = UNITS[U[app.tool.type]];
    const g = line ? makeGroup(def.key, app.brushCount, (d.x0 + m.wx) / 2, (d.y0 + m.wy) / 2, Math.atan2(m.wy - d.y0, m.wx - d.x0), L) : makeGroup(def.key, app.brushCount, m.wx, m.wy, Math.PI / 2, 0);
    if (line && def.cls === C.OBST && def.ob !== 'mine' && def.ob !== 'claymore') g.count = Math.max(g.count, Math.floor(L / def.spacing) + 1); // a drawn line of wire/obstacles is always filled end to end
    const n = groupPositions(map, g).length / 2;
    if (!n) { ui.toast(`${def.name} can't be placed there.`, 'warn'); audio.play('deny'); return; }
    if (n < g.count) { if (def.cls !== C.OBST) ui.toast(`Only room for ${fmt(n)} of ${fmt(g.count)} here.`, 'warn'); g.count = n; }
    app.setup.groups.push(g);
    audio.play('click');
    groupsChanged();
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
    if (click && best >= 0) ids.push(best);
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
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); return; }
  const k = e.key.toLowerCase();
  if (ui.modalOpen()) { if (k === 'escape') ui.hideModal(); return; }
  app.keys.add(k);
  if (k === 'escape') {
    if (app.tool) { if (app.mode === 'setup') app.selectPlaceTool(null); else { app.tool = null; ui.hint(null); } }
    else if (app.selGroup) { app.selGroup = null; ui.refreshInspector(); }
    else if (app.selection.length) { app.selection = []; ui.updateHud(); }
    return;
  }
  if (k === '?' || (k === '/' && e.shiftKey)) { ui.showHelp(); return; }
  if (k === 'home') { app.cam.yaw = DEFAULT_YAW; fitCamera(); return; }
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
  else if (k >= '1' && k <= '5') { const name = Object.keys(SUPPORT)[+k - 1]; if (name) app.armSupport(name); }
  else if (k === 'f') app.armFocus();
  else if (k === 'h') app.toggleHold();
  else if (k === 'r') app.retreat();
  else if (k === 'l') app.toggleLosses();
  else if (k === 'x' && app.selection.length) app.sim.stop(app.selection);
  ui.updateHud();
});
window.addEventListener('keyup', (e) => app.keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => app.keys.clear());
window.addEventListener('resize', resize);

// ----------------------------------------------------------------- overlay
const FONT = '"Inter","Segoe UI",system-ui,sans-serif';
function ring(c, x, y, z, r) { const p = S(x, y, z); c.ellipse(p[0], p[1], Math.max(2, r * app.cam.zoom), Math.max(1.4, r * app.cam.zoom * SIN_P), 0, 0, 6.2832); return p; }

function drawOverlay(dtReal) {
  const c = octx, z = app.cam.zoom, sim = app.sim, m = app.mouse;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, vw, vh);
  c.lineJoin = 'round';

  if (app.mode === 'setup') {
    // place names
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `600 ${Math.max(10, Math.min(15, 9 + z * 3))}px ${FONT}`;
    for (const l of map.labels) {
      const p = S(l.x, l.y, heightAt(l.x, l.y) + 2), t = l.text.split('').join(' ');
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillText(t, p[0] + 1, p[1] + 1.5);
      c.fillStyle = 'rgba(255,255,255,0.78)'; c.fillText(t, p[0], p[1]);
    }
    // formation outlines
    for (const g of app.setup.groups) {
      const sel = g === app.selGroup, hov = g === app.hoverGroup && !app.tool;
      if (!sel && !hov && z < 0.75) continue;
      const b = groupBounds(g), col = g.team === DEF ? '94,200,242' : '232,87,61';
      const ux = Math.cos(g.ang), uy = Math.sin(g.ang), gz = heightAt(g.x, g.y) + 0.3;
      c.beginPath();
      let top = 1e9, cxs = 0;
      for (const [a, p] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const q = S(g.x + ux * a * b.hw - uy * p * b.hd, g.y + uy * a * b.hw + ux * p * b.hd, gz);
        if (a === -1 && p === -1) c.moveTo(q[0], q[1]); else c.lineTo(q[0], q[1]);
        top = Math.min(top, q[1]); cxs += q[0] / 4;
      }
      c.closePath();
      c.strokeStyle = `rgba(${sel ? '240,179,74' : col},${sel ? 1 : hov ? 0.9 : 0.16})`; c.lineWidth = sel ? 2 : 1;
      c.fillStyle = `rgba(${sel ? '240,179,74' : col},${sel ? 0.14 : hov ? 0.1 : 0.015})`;
      c.fill(); c.stroke();
      if (sel || hov) {
        const d = UNITS[U[g.type]];
        const txt = `${d.name} × ${fmt(g.count)}${g.delay ? ` · +${g.delay}s` : ''}`;
        c.font = `600 12px ${FONT}`; c.textAlign = 'center';
        const tw = c.measureText(txt).width + 14, ty = top - 16;
        c.fillStyle = 'rgba(10,13,16,0.9)'; c.beginPath(); c.roundRect(cxs - tw / 2, ty - 10, tw, 20, 5); c.fill();
        c.fillStyle = sel ? '#f0b34a' : '#e6e9ec'; c.fillText(txt, cxs, ty + 1);
      }
    }
    // placement ghost
    if (app.tool && m.inside) {
      const d = app.drag && app.drag.kind === 'place' ? app.drag : null;
      const def = UNITS[U[app.tool.type]];
      const L = d ? Math.hypot(m.wx - d.x0, m.wy - d.y0) : 0;
      const line = d && L > Math.max(5, 10 / z);
      const g = { id: 0, type: def.key, team: def.team, count: app.brushCount, x: line ? (d.x0 + m.wx) / 2 : m.wx, y: line ? (d.y0 + m.wy) / 2 : m.wy, ang: line ? Math.atan2(m.wy - d.y0, m.wx - d.x0) : Math.PI / 2, w: line ? L : 0 };
      if (line && def.cls === C.OBST && def.ob !== 'mine' && def.ob !== 'claymore') g.count = Math.max(g.count, Math.floor(L / def.spacing) + 1);
      const pos = groupPositions(map, g), n = Math.min(g.count, pos.length / 2);
      const col = def.team === DEF ? '94,200,242' : '232,87,61';
      c.fillStyle = `rgba(${col},0.8)`;
      const step = Math.max(1, Math.ceil(n / 1500)), rr = Math.max(1.3, def.rad * z);
      c.beginPath();
      for (let k = 0; k < n; k += step) { const p = S(pos[k * 2], pos[k * 2 + 1], heightAt(pos[k * 2], pos[k * 2 + 1]) + 0.5); c.moveTo(p[0] + rr, p[1]); c.arc(p[0], p[1], rr, 0, 6.2832); }
      c.fill();
      if (line) { const a = S(d.x0, d.y0, heightAt(d.x0, d.y0)); c.strokeStyle = `rgba(${col},0.9)`; c.lineWidth = 1.5; c.setLineDash([6, 5]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(m.sx, m.sy); c.stroke(); c.setLineDash([]); }
      c.font = `600 12px ${FONT}`; c.textAlign = 'left';
      c.fillStyle = n ? '#fff' : '#ff8b73';
      c.fillText(n ? `${fmt(n)}${n < g.count && def.cls !== C.OBST ? ' / ' + fmt(g.count) : ''}` : 'Not here', m.sx + 16, m.sy - 12);
    }
    return;
  }

  // ---- battle ----
  const t = app.clock;
  // where the fallen lie: a heat field over the ground for the horde (deeper colour = more dead in that
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
      const r = Math.max(3, Math.min(LOSS_CELL * 0.5, 1.5 + Math.sqrt(n) * 1.4) * z);
      c.moveTo(p[0] + r, p[1]); c.ellipse(p[0], p[1], r, r * SIN_P, 0, 0, 6.2832);
    }
    c.fill(); c.stroke();
    c.font = `700 11px ${FONT}`; c.textAlign = 'left';
    c.fillStyle = 'rgba(10,13,16,0.82)'; c.beginPath(); c.roundRect(vw - 246, 62, 232, 44, 8); c.fill();
    c.fillStyle = '#e8573d'; c.fillText(`● attackers fallen  ${fmt(sim.initial[1] - sim.count[ORC] - sim.stats.fled)}`, vw - 234, 80);
    c.fillStyle = '#5ec8f2'; c.fillText(`● defenders fallen  ${fmt(sim.initial[0] - sim.defCombat < 0 ? 0 : Object.values(sim.stats.lostDef).reduce((a, b) => a + b, 0))}`, vw - 234, 96);
  }
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
      lx = p[0]; ly = p[1] - Math.max(8, mk.r * z * SIN_P) - 7;
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
    c.fillText(`FOCUS FIRE ${Math.ceil(f.until - sim.time)}s`, p[0], p[1] - f.r * z * SIN_P - 8);
  }
  // company morale: a flag where a company has broken, a mark where one is wavering
  c.font = `700 12px ${FONT}`; c.textAlign = 'center';
  let nLab = 0;
  for (let g = 0; g < sim.ng; g++) {
    const st = sim.gState[g], conf = sim.gConf[g] > sim.time;
    if ((!st && !conf) || sim.gAlive[g] < 15 || sim.gExempt[g]) continue;
    const gx = sim.gCx[g], gy = sim.gCy[g];
    const p = S(gx, gy, heightAt(gx, gy) + 5);
    if (p[0] < 0 || p[1] < 60 || p[0] > vw || p[1] > vh) continue;
    const orc = sim.gTeam[g] === ORC;
    const txt = st >= 2 ? '⚑ routed' : conf ? '?' : '! wavering';
    // keep the field legible: never stack labels on top of one another
    let clash = false;
    for (let k = 0; k < nLab; k += 2) if (Math.abs(labXY[k] - p[0]) < 96 && Math.abs(labXY[k + 1] - p[1]) < 24) { clash = true; break; }
    if (clash || nLab >= 80) continue;
    labXY[nLab++] = p[0]; labXY[nLab++] = p[1];
    const tw = c.measureText(txt).width + 10;
    c.fillStyle = 'rgba(10,13,16,0.72)'; c.beginPath(); c.roundRect(p[0] - tw / 2, p[1] - 9, tw, 17, 4); c.fill();
    c.fillStyle = st >= 2 ? (orc ? '#f2f2ea' : '#ff8b73') : orc ? '#f0b34a' : '#ffb86a';
    c.fillText(txt, p[0], p[1] + 4);
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
  const selSet = app.selection.length ? new Set(app.selection) : null;
  if (selSet) {
    c.strokeStyle = 'rgba(120,225,255,0.95)'; c.lineWidth = 1.3;
    c.beginPath();
    let drawn = 0;
    for (const i of app.selection) {
      const uz = sim.unitZ(i);
      const p = S(sim.x[i], sim.y[i], uz + 0.15), sx = p[0], sy = p[1];
      if (sx < -20 || sy < -20 || sx > vw + 20 || sy > vh + 20) continue;
      const r = Math.max(3.5, (sim.rad[i] + 0.7) * z);
      c.moveTo(sx + r, sy); c.ellipse(sx, sy, r, r * SIN_P, 0, 0, 6.2832);
      if (sim.state[i] === S_MOVE && drawn < 60) { const q = S(sim.tx[i], sim.ty[i], heightAt(sim.tx[i], sim.ty[i])); c.moveTo(sx, sy); c.lineTo(q[0], q[1]); }
      if (++drawn > 1500) break;
    }
    c.stroke();
  }
  const bar = (sx, sy, w, frac, col) => { c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 5); c.fillStyle = col; c.fillRect(sx - w / 2, sy, w * Math.max(0, Math.min(1, frac)), 3); };
  for (let i = 0; i < sim.n; i++) {
    if (!sim.alive[i]) continue;
    const d = UNITS[sim.type[i]];
    if (d.team === DEF) {
      if (d.cls === C.INF) continue;
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
  for (const k of [map.GATE, map.POSTERN]) {
    const s = sim.segs[k];
    if (s.breached || s.hp >= s.maxHp) continue;
    const p = S(s.x, s.y, s.top + 7);
    bar(p[0], p[1], 54, s.hp / s.maxHp, '#f0b34a');
    c.font = `700 10px ${FONT}`; c.textAlign = 'center'; c.fillStyle = '#f0b34a'; c.fillText(k === map.GATE ? 'GATE' : 'POSTERN', p[0], p[1] - 5);
  }
  // drag visuals
  const d = app.drag;
  if (d && d.kind === 'box') {
    c.fillStyle = 'rgba(94,200,242,0.1)'; c.strokeStyle = 'rgba(94,200,242,0.9)'; c.lineWidth = 1;
    c.fillRect(d.sx, d.sy, m.sx - d.sx, m.sy - d.sy); c.strokeRect(d.sx + 0.5, d.sy + 0.5, m.sx - d.sx, m.sy - d.sy);
  }
  if (app.tool && m.inside) {
    const k = app.tool.kind === 'focus' ? 'focus' : app.tool.name;
    const ax = d && d.kind === 'tool' ? d.x0 : m.wx, ay = d && d.kind === 'tool' ? d.y0 : m.wy, az = heightAt(ax, ay) + 0.3;
    const col = k === 'focus' ? '255,90,70' : k === 'supply' || k === 'gunship' ? '111,220,154' : k === 'reinforce' ? '94,200,242' : '240,179,74';
    c.strokeStyle = `rgba(${col},0.95)`; c.fillStyle = `rgba(${col},0.1)`; c.lineWidth = 1.6;
    const circle = (r, dash) => { c.setLineDash(dash ? [7, 6] : []); c.beginPath(); ring(c, ax, ay, az, r); c.fill(); c.stroke(); c.setLineDash([]); };
    if (k === 'focus') circle(Math.max(28, d ? Math.hypot(m.wx - d.x0, m.wy - d.y0) : 28), true);
    else if (k === 'arty') circle(45, true);
    else if (k === 'gunship') { circle(150, true); c.beginPath(); ring(c, ax, ay, az, 85); c.stroke(); }
    else if (k === 'supply') circle(60, true);
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
    c.strokeStyle = `rgba(196,210,232,${0.16 * rainA})`; c.lineWidth = 1;
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
    c.fillText('PAUSED — orders can still be given', vw / 2, 78);
  }
}

// ----------------------------------------------------------------- minimap
let mmBase = null, mmVersion = -1, mmFrame = 0;
function drawMinimap() {
  const sim = app.sim, W = mm.width, H = mm.height;
  if (!mmBase || mmVersion !== sim.structVersion) {
    const px = renderer.terrainThumb(W, H, sim);
    mmBase = new ImageData(W, H); mmVersion = sim.structVersion;
    for (let k = 0; k < W * H; k++) { mmBase.data[k * 4] = px[k * 4] * 0.85; mmBase.data[k * 4 + 1] = px[k * 4 + 1] * 0.85; mmBase.data[k * 4 + 2] = px[k * 4 + 2] * 0.85; mmBase.data[k * 4 + 3] = 255; }
  }
  const img = new ImageData(new Uint8ClampedArray(mmBase.data), W, H), dta = img.data;
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
  for (const mk of app.markers) { if (!mk.label) continue; mctx.strokeStyle = `rgb(${mk.col})`; mctx.beginPath(); mctx.arc(mk.x * kx, mk.y * ky, 3.5, 0, 6.2832); mctx.stroke(); }
}

// -------------------------------------------------------------------- loop
let last = performance.now(), hudT = 0, slowFrames = 0, fastFrames = 0;
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  app.clock += rdt;

  // step down to the cheaper render path if this machine cannot hold 30 fps with the full one
  if (!params.has('q') && renderer.quality === 'high') {
    if (rdt > 0.036) slowFrames++; else fastFrames++;
    if (slowFrames + fastFrames >= 90) { if (slowFrames > 55) { renderer.setQuality('low'); resize(); ui.toast('Switched to performance rendering to keep the frame rate up.'); } slowFrames = fastFrames = 0; }
  }

  // keyboard pan and rotate
  const ks = app.keys, cam = app.cam;
  if (app.mode === 'battle' || !(document.activeElement instanceof HTMLInputElement)) {
    const pan = (620 / cam.zoom) * rdt, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    let rx = 0, ry = 0;
    if (ks.has('a') || ks.has('arrowleft')) rx -= pan;
    if (ks.has('d') || ks.has('arrowright')) rx += pan;
    if (ks.has('w') || ks.has('arrowup')) ry -= pan / SIN_P;
    if (ks.has('s') || ks.has('arrowdown')) ry += pan / SIN_P;
    if (rx || ry) { cam.x += cy * rx - sy * ry; cam.y += sy * rx + cy * ry; }
    if (ks.has('q')) cam.yaw += 1.3 * rdt;
    if (ks.has('e')) cam.yaw -= 1.3 * rdt;
    clampCam();
  }
  if (app.previewDirty && !(app.drag && app.drag.kind === 'moveGroup')) rebuildPreview();

  const sim = app.sim;
  fx.view.x = cam.x; fx.view.y = cam.y; fx.view.zoom = cam.zoom; fx.view.cy = Math.cos(cam.yaw); fx.view.sy = Math.sin(cam.yaw);
  fx.view.rad = Math.hypot(vw / 2, vh / 2 / SIN_P) / cam.zoom + 40;

  let alpha = 1, simDt = 0;
  if (app.mode === 'battle') {
    // a breath of slow motion when something momentous happens
    let scale = 1;
    if (app.slowT > 0) { app.slowT -= rdt; scale = app.slowT > 0.6 ? 0.2 : 0.2 + 0.8 * (1 - Math.max(0, app.slowT) / 0.6); }
    fx.frame(app.speed);
    if (!app.paused && !sim.result) {
      app.acc += rdt * app.speed * scale;
      const t0 = performance.now();
      let ticks = 0;
      while (app.acc >= DT && ticks < 10) {
        sim.step(); app.acc -= DT; ticks++; simDt += DT;
        if (performance.now() - t0 > 15) break;
      }
      if (app.acc > DT * 2) app.acc = DT; // can't keep up: drop the backlog rather than spiral
      alpha = Math.min(1, app.acc / DT);
      fx.update(Math.min(0.25, rdt * app.speed * scale));
    } else if (sim.result) fx.update(rdt * 0.6);
    for (const e of sim.events) {
      if (e.type === 'banner') { ui.banner(e.text, e.cls); ui.toast(e.text, e.cls); if (e.big && app.speed <= 2) app.slowT = 2.2; }
      else if (e.type === 'log') ui.toast(e.text, e.cls);
      else if (e.type === 'end') { audio.horn(); setTimeout(() => { if (app.sim === sim && app.mode === 'battle') ui.showEnd(sim); }, 2600); ui.banner(e.win ? 'Victory' : 'The Deep has fallen', e.win ? 'good' : 'bad'); app.tool = null; ui.hint(null); }
    }
    sim.events.length = 0;
  }

  // light: a stormy night that greys toward dawn, with the odd flash of lightning
  let mood = MOOD.setup;
  if (app.mode === 'battle') {
    const p = sim.opt.dawn > 0 ? Math.min(1, sim.time / sim.opt.dawn) : Math.min(0.7, sim.time / 1500);
    if (p < 0.72) mood = MOOD.night;
    else if (p < 0.93) { const u = (p - 0.72) / 0.21; mood = [lerp3(MOOD.night[0], MOOD.dawn[0], u), lerp3(MOOD.night[1], MOOD.dawn[1], u), lerp3(MOOD.night[2], MOOD.dawn[2], u), 0.26 - 0.22 * u]; }
    else { const u = (p - 0.93) / 0.07; mood = [lerp3(MOOD.dawn[0], MOOD.day[0], u), lerp3(MOOD.dawn[1], MOOD.day[1], u), lerp3(MOOD.dawn[2], MOOD.day[2], u), 0.04]; }
    if (mood === MOOD.night && !app.paused && !sim.result) {
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

  const sh = fx.shake, shk = sh ? (sh * 2.2) / Math.max(0.6, cam.zoom * 0.5) : 0;
  const rcam = { x: cam.x + Math.sin(app.clock * 71) * shk, y: cam.y + Math.cos(app.clock * 83) * shk, zoom: cam.zoom * dpr, yaw: cam.yaw, dpr };
  renderer.render(rcam, sim, app.mode === 'battle' ? fx : null, alpha, env, app.clock);
  if (app.selection.length) app.selection = app.selection.filter((i) => sim.alive[i] && sim.team[i] === DEF);
  drawOverlay(rdt);

  hudT += rdt;
  if (hudT > 0.12) {
    hudT = 0;
    ui.updateHud();
    if (app.mode === 'battle') audio.setRoar(app.paused || sim.result ? 0 : Math.min(0.14, (sim.count[ORC] / 9000) * 0.1 * Math.min(1, 0.4 + cam.zoom / 4)));
  }
  if (app.mode === 'battle' && (mmFrame++ & 3) === 0) drawMinimap();
}

// -------------------------------------------------------------------- boot
if (params.has('q')) renderer.setQuality(params.get('q') === 'low' ? 'low' : 'high');
ui = buildUI(app, atlas);
resize();
app.loadPreset('garrison');
fitCamera();
requestAnimationFrame((t) => { last = t; frame(t); $('loading').classList.add('done'); });
if (!localStorage.getItem('hd-seen-help-2')) { localStorage.setItem('hd-seen-help-2', '1'); ui.showHelp(); }

// handy for debugging and automated tests
app.project = (x, y, z) => { const p = S(x, y, z == null ? heightAt(x, y) : z); return [p[0], p[1]]; };
window.__app = app; window.__renderer = renderer; window.__fx = fx;
