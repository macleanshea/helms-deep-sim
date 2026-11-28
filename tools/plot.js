// Top-down pictures of a headless battle, for looking at how the two sides move.
//
//   node tools/plot.js --preset garrison --at 120,240,360 --out shots/plot
//   node tools/plot.js --preset first-night --policy auto --every 60 --box 500,150,1150,860 --scale 2
//   node tools/plot.js --preset siege-train --policy auto --fall 1 --at 300,450   (the garrison in the Hornburg at 1 s)
//
// One PNG per time asked for: the ground by kind, wire and obstacles, every unit as a dot colored by
// what it is (and, for the horde, by company where --by company is given), ladders and breaches. No
// browser and no dependencies: it steps the simulation and writes the pixels itself.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { buildMap } from '../src/map.js';
import { buildPreset } from '../src/scenarios.js';
import { Sim } from '../src/sim/sim.js';
import { WORLD_W, WORLD_H, CELL, GW, DEF, ORC, T, OB, UNITS, U, C, R } from '../src/config.js';
import { autopilot } from './autopilot.js';

/** Encode an RGB buffer (w*h*3) as a PNG file. */
export function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

const GROUND = { [T.GROUND]: [38, 46, 34], [T.CLIFF]: [22, 22, 24], [T.WALL]: [96, 92, 84], [T.WATER]: [30, 52, 70], [T.COURT]: [70, 66, 58], [T.ROAD]: [62, 56, 44], [T.STAIR]: [120, 110, 90], [T.DOOR]: [140, 100, 60] };
const DEFCOL = { rifle: [90, 200, 255], mg: [255, 255, 120], marksman: [200, 160, 255], grenadier: [120, 255, 160], at: [255, 160, 60], mortar: [255, 120, 220], howitzer: [255, 80, 200], ifv: [255, 255, 255], tank: [255, 255, 255], cmd: [255, 255, 255], cache: [60, 120, 200], crate: [60, 120, 200] };
const ORCCOL = { uruk: [230, 70, 50], archer: [240, 150, 40], berserker: [255, 60, 160], warg: [200, 110, 255], chief: [255, 255, 0], troll: [150, 255, 90], ladder: [255, 220, 150], ram: [255, 220, 150], sapper: [255, 255, 255], catapult: [200, 200, 120], tower: [255, 220, 150] };
const hue = (k) => { const h = (k * 0.6180339) % 1, f = (n) => { const q = (n + h * 6) % 6; return Math.round(255 * (0.95 - 0.6 * Math.max(0, Math.min(q, 4 - q, 1)))); }; return [f(5), f(3), f(1)]; };

/**
 * Draw the battle as it stands. opts: { box: [x0, y0, x1, y1] in meters, scale: px per meter, by: 'type' | 'company' | 'state' }.
 * Returns { w, h, rgb }.
 */
export function drawSim(sim, opts = {}) {
  const [x0, y0, x1, y1] = opts.box || [0, 0, WORLD_W, WORLD_H], sc = opts.scale || 1;
  const w = Math.round((x1 - x0) * sc), h = Math.round((y1 - y0) * sc), rgb = Buffer.alloc(w * h * 3);
  const put = (px, py, c) => { if (px < 0 || py < 0 || px >= w || py >= h) return; const o = (py * w + px) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; };
  const dot = (x, y, r, c) => { const px = Math.round((x - x0) * sc), py = Math.round((y - y0) * sc); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 0.5) put(px + dx, py + dy, c); };
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = x0 + px / sc, y = y0 + py / sc;
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) continue;
    const c = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
    let col = GROUND[sim.mtype[c]] || GROUND[0];
    if (sim.mseg[c] >= 0 && !sim.elev[c]) col = [70, 50, 40];            // a breach
    if (sim.ob[c] & OB.WIRE) col = [110, 110, 130];
    else if (sim.ob[c] & OB.AV) col = [130, 100, 60];
    else if (sim.mines[c]) col = [60, 60, 30];
    if (sim.lad[c]) col = [255, 230, 120];
    put(px, py, col);
  }
  for (let i = 0; i < sim.n; i++) {
    if (!sim.alive[i]) continue;
    const d = UNITS[sim.type[i]];
    let col, r = sc >= 2 ? 1 : 0;
    if (d.team === DEF) { col = DEFCOL[d.key] || [90, 200, 255]; if (d.cls !== C.INF) r += 1; if (sim.ammo[i] < 1 && d.ammo) col = [70, 90, 110]; }
    else {
      col = opts.by === 'company' ? hue(sim.grp[i]) : opts.by === 'state' ? [[230, 70, 50], [255, 200, 60], [120, 120, 255], [90, 90, 90]][sim.gState[sim.grp[i]]] : ORCCOL[d.key] || [230, 70, 50];
      if (opts.by === 'state' && sim.gPin[sim.grp[i]] === 2) col = [255, 255, 255];
      if (d.big) r += 1; if (d.heavy || d.role === R.TROLL) r += 1;
    }
    dot(sim.x[i], sim.y[i], r, col);
  }
  return { w, h, rgb };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const preset = get('preset', 'garrison'), seed = +get('seed', 1), policy = get('policy', 'none'), out = get('out', 'shots/plot');
  const every = +get('every', 0), max = +get('max', 2400), by = get('by', 'type'), scale = +get('scale', 1);
  const fall = get('fall', '') === '1'; // everyone into the Hornburg in the first second
  const box = get('box', null) ? get('box').split(',').map(Number) : null;
  let at = get('at', '') ? get('at').split(',').map(Number) : [];
  if (every) for (let t = every; t <= max; t += every) at.push(t);
  at = [...new Set(at)].sort((a, b) => a - b);
  const map = buildMap(), setup = buildPreset(map, preset, get('sandbox', '') === '1', get('garrison', 'ref')); // (a Build challenge with its suggested garrison)
  setup.options.seed = seed;
  const sim = new Sim(map, setup, null), pilot = policy === 'none' ? null : autopilot(sim, policy);
  fs.mkdirSync(out, { recursive: true });
  const shoot = (t) => { const im = drawSim(sim, { box, scale, by }); const f = path.join(out, `${preset}-${String(Math.round(t)).padStart(4, '0')}.png`); fs.writeFileSync(f, png(im.w, im.h, im.rgb)); console.log(f, `def ${sim.defCombat} orc ${sim.count[ORC]}`); };
  if (at[0] === 0) { shoot(0); at.shift(); }
  while (!sim.result && at.length && sim.time < max) {
    sim.step(); if (pilot) pilot.step(); sim.events.length = 0;
    if (fall && sim.time > 1 && !sim.retreated) sim.orderRetreat();
    if (sim.time >= at[0]) { shoot(at.shift()); }
  }
  if (sim.result) console.log('ended', sim.result);
}
