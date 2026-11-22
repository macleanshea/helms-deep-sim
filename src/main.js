// Application glue: state machine (setup → battle → debrief), camera, input,
// the frame loop and the 2D overlay (selection, cursors, markers, minimap).

import { WORLD_W, WORLD_H, DT, DEF, ORC, UNITS, U, C, SUPPORT, WEAPONS } from './config.js';
import { buildMap, KEEP } from './map.js';
import { buildPreset, makeGroup, groupPositions, groupBounds, PRESETS } from './scenarios.js';
import { Sim, S_MOVE } from './sim/sim.js';
import { drawAtlas } from './render/atlas.js';
import { Renderer } from './render/renderer.js';
import { Fx } from './render/fx.js';
import { Audio } from './audio.js';
import { buildUI, fmt } from './ui/ui.js';

const $ = (id) => document.getElementById(id);
const glCanvas = $('gl'), overlay = $('overlay'), octx = overlay.getContext('2d');
const mm = $('mm'), mctx = mm.getContext('2d');

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

const NIGHT = [0.62, 0.71, 0.92], DAWN = [1.06, 0.84, 0.68], DAY = [1.0, 0.97, 0.9], SETUP = [0.95, 0.94, 0.9];

const app = {
  mode: 'setup', map, setup: null, sim: null,
  cam: { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 0.6 },
  speed: 1, paused: false, tool: null, brushCount: 50,
  selGroup: null, hoverGroup: null, selection: [], markers: [],
  previewDirty: false, amb: SETUP.slice(), clock: 0, acc: 0, endShown: false,
  mouse: { sx: 0, sy: 0, wx: 0, wy: 0, inside: false },
  drag: null, keys: new Set(),
};
let ui;
let dpr = 1, vw = 1, vh = 1;

// ------------------------------------------------------------------ camera
const toWorldX = (sx) => app.cam.x + (sx - vw / 2) / app.cam.zoom;
const toWorldY = (sy) => app.cam.y + (sy - vh / 2) / app.cam.zoom;
const toScreenX = (wx) => (wx - app.cam.x) * app.cam.zoom + vw / 2;
const toScreenY = (wy) => (wy - app.cam.y) * app.cam.zoom + vh / 2;
function insets() { return app.mode === 'setup' ? { l: 316, r: 336, t: 54, b: 0 } : { l: 0, r: 0, t: 54, b: 0 }; }
function fitZoom() { const i = insets(); return Math.min((vw - i.l - i.r) / WORLD_W, (vh - i.t - i.b) / WORLD_H); }
function fitCamera() {
  const i = insets(), z = fitZoom() * 0.99;
  app.cam.zoom = z; app.cam.x = WORLD_W / 2 - (i.l - i.r) / 2 / z; app.cam.y = WORLD_H / 2 - (i.t - i.b) / 2 / z;
}
function clampCam() {
  const c = app.cam;
  c.zoom = Math.max(fitZoom() * 0.7, Math.min(16, c.zoom));
  c.x = Math.max(-200, Math.min(WORLD_W + 200, c.x)); c.y = Math.max(-150, Math.min(WORLD_H + 150, c.y));
}
function zoomAt(sx, sy, f) {
  const wx = toWorldX(sx), wy = toWorldY(sy);
  app.cam.zoom *= f; clampCam();
  app.cam.x = wx - (sx - vw / 2) / app.cam.zoom; app.cam.y = wy - (sy - vh / 2) / app.cam.zoom;
  clampCam();
}
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
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
  ui.hint(type ? `<b>${UNITS[U[type]].name}</b> — click to drop a block, drag to draw a line · right-click when done` : null);
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
  if (!app.setup.groups.some((g) => g.team === DEF) || !app.setup.groups.some((g) => g.team === ORC)) { ui.toast('Place at least one defender and one attacker first.', 'warn'); audio.play('deny'); return; }
  fx.reset(); renderer.clearDecals();
  app.sim = new Sim(map, app.setup, fx);
  app.mode = 'battle'; app.paused = false; app.speed = 1; app.acc = 0; app.endShown = false;
  app.tool = null; app.selGroup = null; app.selection = []; app.markers = []; app.drag = null;
  ui.setMode('battle'); ui.clearFeed(); ui.hint(null); ui.hideModal();
  fitCamera();
  ui.banner('Hold the Deep', 'warn');
  ui.toast('The horde advances in waves. Space pauses; number keys call support.');
  audio.horn();
  mmBase = null;
  ui.updateHud();
};
app.backToSetup = () => {
  app.mode = 'setup'; app.tool = null; app.selection = []; app.markers = []; app.drag = null;
  fx.reset(); renderer.clearDecals(); audio.setRoar(0);
  ui.setMode('setup'); ui.clearFeed(); ui.hint(null); ui.hideModal();
  rebuildPreview(); fitCamera();
  ui.refreshRoster(); ui.refreshPalette(); ui.refreshInspector();
};
app.setSpeed = (s) => { if (s === 0) app.paused = !app.paused; else { app.speed = s; app.paused = false; } ui.updateHud(); };
app.toggleMute = () => { audio.unlock(); audio.setMuted(!audio.muted); return audio.muted; };
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
  else { audio.horn(); app.markers.push({ x: KEEP.cx, y: KEEP.cy, r: KEEP.r + 8, t: 0, dur: 6, col: '94,200,242', label: 'FALL BACK' }); }
};

function marker(x, y, r, dur, col, label, x2, y2) { app.markers.push({ x, y, r, t: 0, dur, col, label, x2, y2 }); }

function fireTool(x0, y0, x1, y1) {
  const t = app.tool, sim = app.sim;
  if (t.kind === 'focus') {
    const r = Math.max(28, Math.hypot(x1 - x0, y1 - y0));
    sim.setFocus(x0, y0, r);
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
  m.sx = e.clientX; m.sy = e.clientY; m.wx = toWorldX(m.sx); m.wy = toWorldY(m.sy); m.inside = true;
}
overlay.addEventListener('contextmenu', (e) => e.preventDefault());
overlay.addEventListener('pointerleave', () => { app.mouse.inside = false; });
overlay.addEventListener('pointerdown', (e) => {
  audio.unlock();
  updateMouse(e);
  overlay.setPointerCapture(e.pointerId);
  const m = app.mouse;
  if (e.button !== 0) { app.drag = { kind: 'rpan', sx: m.sx, sy: m.sy, cx: app.cam.x, cy: app.cam.y, moved: false, btn: e.button }; return; }
  if (app.mode === 'setup') {
    if (app.tool) { app.drag = { kind: 'place', x0: m.wx, y0: m.wy }; return; }
    const g = groupAt(m.wx, m.wy);
    if (g) { if (app.selGroup !== g) { app.selGroup = g; ui.refreshInspector(); } app.drag = { kind: 'moveGroup', g, ox: m.wx - g.x, oy: m.wy - g.y, moved: false }; }
    else { if (app.selGroup) { app.selGroup = null; ui.refreshInspector(); } app.drag = { kind: 'rpan', sx: m.sx, sy: m.sy, cx: app.cam.x, cy: app.cam.y, moved: true, btn: 0 }; }
  } else {
    if (app.sim.result) { app.drag = { kind: 'rpan', sx: m.sx, sy: m.sy, cx: app.cam.x, cy: app.cam.y, moved: true, btn: 0 }; return; }
    if (app.tool) app.drag = { kind: 'tool', x0: m.wx, y0: m.wy };
    else app.drag = { kind: 'box', x0: m.wx, y0: m.wy, sx: m.sx, sy: m.sy, add: e.shiftKey };
  }
});
overlay.addEventListener('pointermove', (e) => {
  updateMouse(e);
  const d = app.drag, m = app.mouse;
  if (!d) { if (app.mode === 'setup' && !app.tool) app.hoverGroup = groupAt(m.wx, m.wy); return; }
  if (d.kind === 'rpan') {
    if (Math.abs(m.sx - d.sx) + Math.abs(m.sy - d.sy) > 5) d.moved = true;
    if (d.moved) { app.cam.x = d.cx - (m.sx - d.sx) / app.cam.zoom; app.cam.y = d.cy - (m.sy - d.sy) / app.cam.zoom; clampCam(); }
  } else if (d.kind === 'moveGroup') {
    d.g.x = m.wx - d.ox; d.g.y = m.wy - d.oy; d.moved = true;
  }
});
overlay.addEventListener('pointerup', (e) => {
  updateMouse(e);
  const d = app.drag, m = app.mouse;
  app.drag = null;
  if (!d) return;
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
    const n = groupPositions(map, g).length / 2;
    if (!n) { ui.toast(`${def.name} can't be placed there.`, 'warn'); audio.play('deny'); return; }
    if (n < g.count) { ui.toast(`Only room for ${fmt(n)} of ${fmt(g.count)} here.`, 'warn'); g.count = n; }
    app.setup.groups.push(g);
    audio.play('click');
    groupsChanged();
  } else if (d.kind === 'moveGroup') {
    if (d.moved) groupsChanged(false);
  } else if (d.kind === 'tool') {
    fireTool(d.x0, d.y0, m.wx, m.wy);
  } else if (d.kind === 'box') {
    const sim = app.sim;
    let ids;
    if (Math.abs(m.sx - d.sx) + Math.abs(m.sy - d.sy) < 6) { const i = sim.defenderAt(m.wx, m.wy, Math.max(2.5, 10 / app.cam.zoom)); ids = i >= 0 && UNITS[sim.type[i]].cls !== C.CACHE ? [i] : []; }
    else ids = sim.defendersInRect(d.x0, d.y0, m.wx, m.wy);
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
  if (app.mode === 'setup') {
    if (k === 'enter') app.startBattle();
    else if ((k === 'delete' || k === 'backspace') && app.selGroup) app.removeGroup(app.selGroup);
    else if (k === 'q' && app.selGroup) app.editGroup(app.selGroup, { ang: app.selGroup.ang - Math.PI / 12 });
    else if (k === 'e' && app.selGroup) app.editGroup(app.selGroup, { ang: app.selGroup.ang + Math.PI / 12 });
    return;
  }
  if (k === ' ') { e.preventDefault(); app.setSpeed(0); }
  else if (k === '=' || k === '+') app.setSpeed(Math.min(8, app.speed * 2));
  else if (k === '-' || k === '_') app.setSpeed(Math.max(1, app.speed / 2));
  else if (k >= '1' && k <= '5') { const name = Object.keys(SUPPORT)[+k - 1]; if (name) app.armSupport(name); }
  else if (k === 'f') app.armFocus();
  else if (k === 'h') app.toggleHold();
  else if (k === 'r') app.retreat();
  else if (k === 'x' && app.selection.length) { app.sim.stop(app.selection); }
  ui.updateHud();
});
window.addEventListener('keyup', (e) => app.keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => app.keys.clear());
window.addEventListener('resize', resize);

// ----------------------------------------------------------------- overlay
function drawOverlay(dtReal) {
  const c = octx, z = app.cam.zoom, sim = app.sim, m = app.mouse;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, vw, vh);
  c.lineJoin = 'round';
  const X = toScreenX, Y = toScreenY;

  if (app.mode === 'setup') {
    // place names
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `600 ${Math.max(10, Math.min(15, 9 + z * 3))}px ${getComputedStyle(document.body).fontFamily}`;
    for (const l of map.labels) {
      c.save(); c.translate(X(l.x), Y(l.y)); if (l.rot) c.rotate(l.rot);
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillText(l.text.split('').join(' '), 1, 1.5);
      c.fillStyle = 'rgba(255,255,255,0.72)'; c.fillText(l.text.split('').join(' '), 0, 0);
      c.restore();
    }
    // formation outlines
    for (const g of app.setup.groups) {
      const sel = g === app.selGroup, hov = g === app.hoverGroup && !app.tool;
      if (!sel && !hov && z < 0.5) continue;
      const b = groupBounds(g), col = g.team === DEF ? '94,200,242' : '232,87,61';
      c.save(); c.translate(X(g.x), Y(g.y)); c.rotate(g.ang);
      c.strokeStyle = `rgba(${sel ? '240,179,74' : col},${sel ? 1 : hov ? 0.9 : 0.28})`; c.lineWidth = sel ? 2 : 1;
      c.fillStyle = `rgba(${sel ? '240,179,74' : col},${sel ? 0.12 : hov ? 0.1 : 0.03})`;
      c.beginPath(); c.roundRect(-b.hw * z, -b.hd * z, b.hw * 2 * z, b.hd * 2 * z, 4); c.fill(); c.stroke();
      c.restore();
      if (sel || hov) {
        const d = UNITS[U[g.type]];
        const txt = `${d.name} × ${fmt(g.count)}${g.delay ? ` · +${g.delay}s` : ''}`;
        c.font = '600 12px system-ui'; c.textAlign = 'center';
        const tw = c.measureText(txt).width + 14, tx = X(g.x), ty = Y(g.y) - Math.max(b.hd, b.hw * Math.abs(Math.cos(g.ang))) * z - 16;
        c.fillStyle = 'rgba(10,13,16,0.9)'; c.beginPath(); c.roundRect(tx - tw / 2, ty - 10, tw, 20, 5); c.fill();
        c.fillStyle = sel ? '#f0b34a' : '#e6e9ec'; c.fillText(txt, tx, ty + 1);
      }
    }
    // placement ghost
    if (app.tool && m.inside) {
      const d = app.drag && app.drag.kind === 'place' ? app.drag : null;
      const def = UNITS[U[app.tool.type]];
      const L = d ? Math.hypot(m.wx - d.x0, m.wy - d.y0) : 0;
      const line = d && L > Math.max(5, 10 / z);
      const g = { id: 0, type: def.key, team: def.team, count: app.brushCount, x: line ? (d.x0 + m.wx) / 2 : m.wx, y: line ? (d.y0 + m.wy) / 2 : m.wy, ang: line ? Math.atan2(m.wy - d.y0, m.wx - d.x0) : Math.PI / 2, w: line ? L : 0 };
      const pos = groupPositions(map, g), n = Math.min(g.count, pos.length / 2);
      const col = def.team === DEF ? '94,200,242' : '232,87,61';
      c.fillStyle = `rgba(${col},0.75)`;
      const step = Math.max(1, Math.ceil(n / 1500)), rr = Math.max(1.2, def.rad * z);
      c.beginPath();
      for (let k = 0; k < n; k += step) { const px = X(pos[k * 2]), py = Y(pos[k * 2 + 1]); c.moveTo(px + rr, py); c.arc(px, py, rr, 0, 6.2832); }
      c.fill();
      if (line) { c.strokeStyle = `rgba(${col},0.9)`; c.lineWidth = 1.5; c.setLineDash([6, 5]); c.beginPath(); c.moveTo(X(d.x0), Y(d.y0)); c.lineTo(m.sx, m.sy); c.stroke(); c.setLineDash([]); }
      c.font = '600 12px system-ui'; c.textAlign = 'left';
      c.fillStyle = n ? '#fff' : '#ff8b73';
      c.fillText(n ? `${fmt(n)}${n < g.count ? ' / ' + fmt(g.count) : ''}` : 'Not here', m.sx + 16, m.sy - 12);
    }
    return;
  }

  // ---- battle ----
  const t = app.clock;
  // support / order markers
  for (let k = app.markers.length - 1; k >= 0; k--) {
    const mk = app.markers[k];
    mk.t += dtReal * (app.paused ? 0 : app.speed);
    if (mk.t > mk.dur) { app.markers.splice(k, 1); continue; }
    const a = Math.min(1, (mk.dur - mk.t) * 2) * (0.55 + 0.25 * Math.sin(t * 6));
    const sx = X(mk.x), sy = Y(mk.y);
    c.strokeStyle = `rgba(${mk.col},${a})`; c.lineWidth = 1.5;
    if (mk.x2 != null) {
      const ex = X(mk.x2), ey = Y(mk.y2), bx = sx * 2 - ex, by = sy * 2 - ey;
      c.setLineDash([10, 6]); c.beginPath(); c.moveTo(bx, by); c.lineTo(ex, ey); c.stroke(); c.setLineDash([]);
      const an = Math.atan2(ey - by, ex - bx);
      c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - Math.cos(an - 0.4) * 12, ey - Math.sin(an - 0.4) * 12); c.moveTo(ex, ey); c.lineTo(ex - Math.cos(an + 0.4) * 12, ey - Math.sin(an + 0.4) * 12); c.stroke();
    } else {
      c.setLineDash(mk.r > 10 ? [8, 6] : []); c.lineDashOffset = -t * 20;
      c.beginPath(); c.arc(sx, sy, Math.max(4, mk.r * z * (mk.r <= 6 ? 1 + mk.t : 1)), 0, 6.2832); c.stroke(); c.setLineDash([]);
    }
    if (mk.label) { c.font = '700 10px system-ui'; c.textAlign = 'center'; c.fillStyle = `rgba(${mk.col},${Math.min(1, a + 0.3)})`; c.fillText(mk.label, sx, sy - Math.max(8, (mk.x2 != null ? 0 : mk.r) * z) - 7); }
  }
  // focus zone
  if (sim.focus) {
    const f = sim.focus, sx = X(f.x), sy = Y(f.y), r = f.r * z;
    c.strokeStyle = 'rgba(255,90,70,0.9)'; c.lineWidth = 2; c.setLineDash([12, 8]); c.lineDashOffset = t * 30;
    c.beginPath(); c.arc(sx, sy, r, 0, 6.2832); c.stroke(); c.setLineDash([]);
    c.fillStyle = 'rgba(255,70,50,0.07)'; c.fill();
    c.beginPath(); for (let k = 0; k < 4; k++) { const a = k * 1.5708 + t * 0.6; c.moveTo(sx + Math.cos(a) * (r - 8), sy + Math.sin(a) * (r - 8)); c.lineTo(sx + Math.cos(a) * (r + 10), sy + Math.sin(a) * (r + 10)); } c.stroke();
    c.font = '700 10px system-ui'; c.textAlign = 'center'; c.fillStyle = 'rgba(255,140,120,0.95)';
    c.fillText(`FOCUS FIRE ${Math.ceil(f.until - sim.time)}s`, sx, sy - r - 8);
  }
  // selection rings, bars, ammo warnings
  const selSet = app.selection.length ? new Set(app.selection) : null;
  if (selSet) {
    c.strokeStyle = 'rgba(120,225,255,0.95)'; c.lineWidth = 1.3;
    c.beginPath();
    let drawn = 0;
    for (const i of app.selection) {
      const sx = X(sim.x[i]), sy = Y(sim.y[i]);
      if (sx < -20 || sy < -20 || sx > vw + 20 || sy > vh + 20) continue;
      const r = Math.max(3, (sim.rad[i] + 0.55) * z);
      c.moveTo(sx + r, sy); c.arc(sx, sy, r, 0, 6.2832);
      if (sim.state[i] === S_MOVE && drawn < 80) { c.moveTo(sx, sy); c.lineTo(X(sim.tx[i]), Y(sim.ty[i])); }
      if (++drawn > 1500) break;
    }
    c.stroke();
  }
  const bar = (sx, sy, w, frac, col) => { c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 5); c.fillStyle = col; c.fillRect(sx - w / 2, sy, w * Math.max(0, Math.min(1, frac)), 3); };
  for (let i = 0; i < sim.n; i++) {
    if (!sim.alive[i] || sim.team[i] !== DEF) continue;
    const d = UNITS[sim.type[i]];
    const sx = X(sim.x[i]), sy = Y(sim.y[i]);
    if (sx < -30 || sy < -30 || sx > vw + 30 || sy > vh + 30) continue;
    if (d.cls === C.CACHE) { if (z > 0.9) bar(sx, sy - d.size * 0.5 * z - 6, 26, sim.ammo[i] / d.pool, '#6fdc9a'); continue; }
    if (d.cls !== C.INF) { if (sim.hp[i] < d.hp || (selSet && selSet.has(i))) bar(sx, sy - d.size * 0.42 * z - 7, 30, sim.hp[i] / d.hp, sim.hp[i] / d.hp > 0.4 ? '#5ec8f2' : '#e8573d'); }
    if (d.ammo && sim.ammo[i] < 1 && z > 5) { const r = Math.max(1.2, Math.min(2.2, z * 0.3)); c.fillStyle = '#ff6a4a'; c.fillRect(sx - r, sy - (d.rad + 1.3) * z - r * 2, r * 2, r * 2); }
  }
  // gates
  for (const k of [map.GATE, map.POSTERN]) {
    const s = sim.segs[k];
    if (s.breached || s.hp >= s.maxHp) continue;
    const sx = X(s.x), sy = Y(s.y) - 14 * z - 10;
    bar(sx, sy, 54, s.hp / s.maxHp, '#f0b34a');
    c.font = '700 10px system-ui'; c.textAlign = 'center'; c.fillStyle = '#f0b34a'; c.fillText(k === map.GATE ? 'GATE' : 'POSTERN', sx, sy - 5);
  }
  // drag visuals
  const d = app.drag;
  if (d && d.kind === 'box') {
    const x0 = X(d.x0), y0 = Y(d.y0);
    c.fillStyle = 'rgba(94,200,242,0.1)'; c.strokeStyle = 'rgba(94,200,242,0.9)'; c.lineWidth = 1;
    c.fillRect(x0, y0, m.sx - x0, m.sy - y0); c.strokeRect(x0 + 0.5, y0 + 0.5, m.sx - x0, m.sy - y0);
  }
  if (app.tool && m.inside) {
    const k = app.tool.kind === 'focus' ? 'focus' : app.tool.name;
    const ax = d && d.kind === 'tool' ? d.x0 : m.wx, ay = d && d.kind === 'tool' ? d.y0 : m.wy;
    const sx = X(ax), sy = Y(ay);
    const col = k === 'focus' ? '255,90,70' : k === 'supply' || k === 'gunship' ? '111,220,154' : k === 'reinforce' ? '94,200,242' : '240,179,74';
    c.strokeStyle = `rgba(${col},0.95)`; c.fillStyle = `rgba(${col},0.1)`; c.lineWidth = 1.6;
    const circle = (r, dash) => { c.setLineDash(dash ? [7, 6] : []); c.beginPath(); c.arc(sx, sy, r * z, 0, 6.2832); c.fill(); c.stroke(); c.setLineDash([]); };
    if (k === 'focus') circle(Math.max(28, d ? Math.hypot(m.wx - d.x0, m.wy - d.y0) : 28), true);
    else if (k === 'arty') circle(45, true);
    else if (k === 'gunship') { circle(150, true); c.beginPath(); c.arc(sx, sy, 85 * z, 0, 6.2832); c.stroke(); }
    else if (k === 'supply') circle(60, true);
    else if (k === 'reinforce') circle(14, false);
    else if (k === 'air') {
      let dx = 0, dy = -1, L = 230, cx = ax, cy = ay;
      if (d && Math.hypot(m.wx - d.x0, m.wy - d.y0) >= 20) { const l = Math.hypot(m.wx - d.x0, m.wy - d.y0); dx = (m.wx - d.x0) / l; dy = (m.wy - d.y0) / l; L = Math.max(170, l); cx = (d.x0 + m.wx) / 2; cy = (d.y0 + m.wy) / 2; }
      c.save(); c.translate(X(cx), Y(cy)); c.rotate(Math.atan2(dy, dx));
      c.beginPath(); c.roundRect((-L / 2 - 16) * z, -27 * z, (L + 32) * z, 54 * z, 27 * z); c.fill(); c.setLineDash([7, 6]); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.moveTo((L / 2 + 30) * z, 0); c.lineTo((L / 2 + 16) * z, -8); c.lineTo((L / 2 + 16) * z, 8); c.closePath(); c.fillStyle = `rgba(${col},0.95)`; c.fill();
      c.restore();
    }
    c.beginPath(); c.moveTo(sx - 9, sy); c.lineTo(sx + 9, sy); c.moveTo(sx, sy - 9); c.lineTo(sx, sy + 9); c.stroke();
  }
  // night rain, thinning out as the sky lightens
  const rainA = Math.max(0, Math.min(1, (0.93 - app.amb[0]) * 3));
  if (rainA > 0.03) {
    if (!app.paused) app.rainT = (app.rainT || 0) + dtReal;
    const rt = app.rainT || 0;
    c.strokeStyle = `rgba(196,210,232,${0.17 * rainA})`; c.lineWidth = 1;
    c.beginPath();
    for (let k = 0; k < 130; k++) {
      const sp = 0.8 + ((k * 37) % 11) * 0.05, len = 12 + (k % 5) * 4;
      const px = ((k * 131.7 + rt * 240 * sp) % (vw + 160)) - 80, py = ((k * 71.3 + rt * 1250 * sp) % (vh + 80)) - 40;
      c.moveTo(px, py); c.lineTo(px - len * 0.2, py - len);
    }
    c.stroke();
  }
  if (app.paused && !sim.result) {
    c.font = '700 13px system-ui'; c.textAlign = 'center'; c.fillStyle = 'rgba(240,179,74,0.95)';
    c.fillText('PAUSED — orders can still be given', vw / 2, 78);
  }
}

// ----------------------------------------------------------------- minimap
let mmBase = null, mmVersion = -1, mmFrame = 0;
function drawMinimap() {
  const sim = app.sim, W = mm.width, H = mm.height;
  if (!mmBase || mmVersion !== sim.structVersion) {
    const px = renderer.terrainThumb(W, H);
    mmBase = new ImageData(W, H); mmVersion = sim.structVersion;
    for (let k = 0; k < W * H; k++) { mmBase.data[k * 4] = px[k * 4] * 0.8; mmBase.data[k * 4 + 1] = px[k * 4 + 1] * 0.8; mmBase.data[k * 4 + 2] = px[k * 4 + 2] * 0.8; mmBase.data[k * 4 + 3] = 255; }
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
  mctx.strokeStyle = 'rgba(255,255,255,0.9)'; mctx.lineWidth = 1;
  const hw = vw / app.cam.zoom / 2, hh = vh / app.cam.zoom / 2;
  mctx.strokeRect((app.cam.x - hw) * kx + 0.5, (app.cam.y - hh) * ky + 0.5, hw * 2 * kx, hh * 2 * ky);
  if (sim.focus) { mctx.strokeStyle = '#ff5a46'; mctx.beginPath(); mctx.arc(sim.focus.x * kx, sim.focus.y * ky, Math.max(3, sim.focus.r * kx), 0, 6.2832); mctx.stroke(); }
  for (const mk of app.markers) { if (!mk.label) continue; mctx.strokeStyle = `rgb(${mk.col})`; mctx.beginPath(); mctx.arc(mk.x * kx, mk.y * ky, 3.5, 0, 6.2832); mctx.stroke(); }
}

// -------------------------------------------------------------------- loop
let last = performance.now(), hudT = 0, simMs = 2;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  app.clock += rdt;

  // keyboard pan
  const ks = app.keys, pan = (620 / app.cam.zoom) * rdt;
  if (app.mode === 'battle' || !(document.activeElement instanceof HTMLInputElement)) {
    if (ks.has('a') || ks.has('arrowleft')) app.cam.x -= pan;
    if (ks.has('d') || ks.has('arrowright')) app.cam.x += pan;
    if (ks.has('w') || ks.has('arrowup')) app.cam.y -= pan;
    if (ks.has('s') || ks.has('arrowdown')) app.cam.y += pan;
    clampCam();
  }
  if (app.previewDirty && !(app.drag && app.drag.kind === 'moveGroup')) rebuildPreview();

  const sim = app.sim;
  const hw = vw / app.cam.zoom / 2, hh = vh / app.cam.zoom / 2;
  fx.view.x = app.cam.x; fx.view.y = app.cam.y; fx.view.hw = hw; fx.view.hh = hh; fx.view.zoom = app.cam.zoom;

  let alpha = 1, simDt = 0;
  if (app.mode === 'battle') {
    fx.frame(app.speed);
    if (!app.paused && !sim.result) {
      app.acc += rdt * app.speed;
      const t0 = performance.now();
      let ticks = 0;
      const budget = 15;
      while (app.acc >= DT && ticks < 10) {
        sim.step(); app.acc -= DT; ticks++; simDt += DT;
        if (performance.now() - t0 > budget) break;
      }
      if (ticks) simMs = simMs * 0.9 + ((performance.now() - t0) / ticks) * 0.1;
      if (app.acc > DT * 2) app.acc = DT; // can't keep up: drop the backlog rather than spiral
      alpha = Math.min(1, app.acc / DT);
    } else if (sim.result) { simDt = rdt * 0.6; alpha = 1; }
    fx.update(simDt > 0 ? Math.min(simDt, 0.25) : 0);
    for (const e of sim.events) {
      if (e.type === 'banner') { ui.banner(e.text, e.cls); ui.toast(e.text, e.cls); }
      else if (e.type === 'log') ui.toast(e.text, e.cls);
      else if (e.type === 'end') { audio.horn(); setTimeout(() => { if (app.sim === sim && app.mode === 'battle') ui.showEnd(sim); }, 2600); ui.banner(e.win ? 'Victory' : 'The Deep has fallen', e.win ? 'good' : 'bad'); app.tool = null; ui.hint(null); }
    }
    sim.events.length = 0;
  }

  // ambient light: night battle that greys toward dawn
  let target = SETUP;
  if (app.mode === 'battle') {
    const p = sim.opt.dawn > 0 ? Math.min(1, sim.time / sim.opt.dawn) : Math.min(0.8, sim.time / 1500);
    if (p < 0.72) target = NIGHT;
    else if (p < 0.93) { const u = (p - 0.72) / 0.21; target = NIGHT.map((v, k) => v + (DAWN[k] - v) * u); }
    else { const u = (p - 0.93) / 0.07; target = DAWN.map((v, k) => v + (DAY[k] - v) * u); }
  }
  for (let k = 0; k < 3; k++) app.amb[k] += (target[k] - app.amb[k]) * Math.min(1, rdt * 1.5);

  const sh = fx.shake;
  const cam = { x: app.cam.x + (sh ? Math.sin(app.clock * 71) * sh * 2.2 / Math.max(0.6, app.cam.zoom * 0.5) : 0), y: app.cam.y + (sh ? Math.cos(app.clock * 83) * sh * 2.2 / Math.max(0.6, app.cam.zoom * 0.5) : 0), zoom: app.cam.zoom * dpr };
  if (app.selection.length) app.selection = app.selection.filter((i) => sim.alive[i] && sim.team[i] === DEF);
  renderer.render(cam, sim, app.mode === 'battle' ? fx : null, alpha, app.amb, app.clock);
  drawOverlay(rdt);

  hudT += rdt;
  if (hudT > 0.12) {
    hudT = 0;
    ui.updateHud();
    if (app.mode === 'battle') audio.setRoar(app.paused || sim.result ? 0 : Math.min(0.14, (sim.count[ORC] / 9000) * 0.1 * Math.min(1, 0.4 + app.cam.zoom / 4)));
  }
  if (app.mode === 'battle' && (mmFrame++ & 3) === 0) drawMinimap();
}

// -------------------------------------------------------------------- boot
ui = buildUI(app, atlas);
resize();
app.loadPreset('garrison');
fitCamera();
requestAnimationFrame((t) => { last = t; frame(t); $('loading').classList.add('done'); });
if (!localStorage.getItem('hd-seen-help')) { localStorage.setItem('hd-seen-help', '1'); ui.showHelp(); }

// handy for debugging and automated tests
window.__app = app;
