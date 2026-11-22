// Procedural sprite atlas. Everything is drawn top-down, facing +x, into 128 px cells.

export const ATLAS_SIZE = 2048;
export const CELLPX = 128;
export const COLS = ATLAS_SIZE / CELLPX;

export const SPR = {
  rifle: 0, mg: 1, marksman: 2, grenadier: 3, at: 4, mortar: 5, howitzer: 6, ifvHull: 7, ifvTurret: 8, tankHull: 9, tankTurret: 10, cache: 11, crate: 12,
  uruk: 16, archer: 17, berserker: 18, warg: 19, troll: 20, ladder: 21, ladderUp: 22, ram: 23, sapper: 24, catapult: 25,
  jet: 32, helo: 33, rotor: 34, cargo: 35, transport: 36, chute: 37, shell: 38, rock: 39, bomb: 40, rocket: 41,
  glow: 48, smoke: 49, streak: 50, ring: 51, spark: 52, debris: 53, flash: 54, corpseOrc: 55, corpseMan: 56, scorch: 57, blood: 58, crater: 59, corpseTroll: 60, wreck: 61, rubble: 62, dot: 63, arrow: 64, splinter: 65,
};

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function cell(ctx, idx, fn) {
  const cx = (idx % COLS) * CELLPX + CELLPX / 2, cy = Math.floor(idx / COLS) * CELLPX + CELLPX / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - 62, cy - 62, 124, 124); ctx.clip();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  fn(ctx);
  ctx.restore();
}
const ell = (c, x, y, rx, ry, fill, stroke, lw = 2) => { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, 6.2832); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); } };
const rect = (c, x, y, w, h, fill, stroke, lw = 2, r = 0) => { c.beginPath(); if (r) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); } };
const line = (c, x1, y1, x2, y2, col, lw) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = col; c.lineWidth = lw; c.stroke(); };
const poly = (c, pts, fill, stroke, lw = 2) => { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); } };
function sheen(c, x, y, r, a = 0.35) {
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
}

const OUT = '#14160f';
function soldier(c, o = {}) {
  const uni = o.uni || '#8b8a5e', vest = o.vest || '#4e5239', helm = o.helm || '#6d7049';
  rect(c, -19, -11, 12, 22, '#3f4230', OUT, 2, 4); // pack
  ell(c, 0, 0, 12, 21, uni, OUT, 2.5);
  ell(c, 1, 0, 9.5, 14, vest, null);
  if (o.pre) o.pre(c);
  line(c, 3, -17, 21, -4, OUT, 9.5); line(c, 3, -17, 21, -4, uni, 6);
  line(c, 3, 17, 15, 8, OUT, 9.5); line(c, 3, 17, 15, 8, uni, 6);
  if (o.weapon) o.weapon(c);
  ell(c, 3, 0, 10.5, 10.5, helm, OUT, 2.5);
  sheen(c, 3, 0, 10, 0.3);
  if (o.post) o.post(c);
}
const rifleW = (len = 44, th = 4) => (c) => { rect(c, 8, 2, len - 8, th + 3, OUT); rect(c, 9, 3.5, len - 10, th, '#23241f'); rect(c, 14, 2.5, 9, th + 2, '#3a3b33'); };

function orc(c, o = {}) {
  const arm = o.armor || '#4b2c27', skin = o.skin || '#5d5346';
  if (o.shield) { ell(c, 13, -19, 13, 13, '#7a2a20', '#0b0a0a', 2.5); ell(c, 13, -19, 8, 8, null, '#9a8a7d', 2); ell(c, 13, -19, 4, 5, '#d8d4c8'); }
  ell(c, 0, 0, 13, 22, arm, '#0a0a0b', 2.5);
  c.strokeStyle = 'rgba(190,180,175,0.4)'; c.lineWidth = 2;
  for (let k = -2; k <= 2; k++) { c.beginPath(); c.arc(-14, k * 7, 14, -0.5, 0.5); c.stroke(); }
  if (!o.bare) { ell(c, 0, -17, 8, 8, '#6a6a72', '#0a0a0b', 2); ell(c, 0, 17, 8, 8, '#6a6a72', '#0a0a0b', 2); sheen(c, 0, -17, 7, 0.25); sheen(c, 0, 17, 7, 0.25); }
  else { ell(c, 0, -17, 8, 8, skin, '#0a0a0b', 2); ell(c, 0, 17, 8, 8, skin, '#0a0a0b', 2); }
  if (o.weapon) o.weapon(c);
  if (o.bare) { ell(c, 4, 0, 10, 10, skin, '#0a0a0b', 2.5); line(c, -2, -3, 12, -3, '#a5281c', 3); line(c, -2, 4, 12, 4, '#a5281c', 2); }
  else {
    ell(c, 4, 0, 10.5, 10.5, '#55555c', '#0a0a0b', 2.5); sheen(c, 4, 0, 10, 0.3);
    line(c, -5, 0, 13, 0, '#19191b', 2.5);
    // the White Hand
    ell(c, 3, 0, 4, 5, '#e4e0d4');
    for (let k = -2; k <= 2; k++) line(c, 5, k * 2, 10, k * 2.6, '#e4e0d4', 1.6);
  }
}
const blade = (c) => { line(c, 8, 19, 46, 25, '#0a0a0b', 7); line(c, 14, 20, 46, 25, '#aeb2b6', 4); line(c, 8, 19, 14, 20, '#4a3524', 5); };

function vehicleHull(c, L, Wd, col, dark, tracks) {
  rect(c, -L / 2, -Wd / 2 - 5, L, 9, '#1d1e1a', '#0c0d0a', 2, 3);
  rect(c, -L / 2, Wd / 2 - 4, L, 9, '#1d1e1a', '#0c0d0a', 2, 3);
  if (tracks) { c.strokeStyle = 'rgba(90,90,80,0.7)'; c.lineWidth = 1.5; for (let x = -L / 2 + 4; x < L / 2; x += 5) { c.beginPath(); c.moveTo(x, -Wd / 2 - 5); c.lineTo(x, -Wd / 2 + 4); c.moveTo(x, Wd / 2 - 4); c.lineTo(x, Wd / 2 + 5); c.stroke(); } }
  else for (let k = 0; k < 4; k++) { const x = -L / 2 + 10 + k * (L - 20) / 3; rect(c, x - 6, -Wd / 2 - 6, 12, 5, '#111', null, 0, 2); rect(c, x - 6, Wd / 2 + 1, 12, 5, '#111', null, 0, 2); }
  poly(c, [-L / 2 + 2, -Wd / 2 + 1, L / 2 - 12, -Wd / 2 + 1, L / 2, -Wd / 2 + 9, L / 2, Wd / 2 - 9, L / 2 - 12, Wd / 2 - 1, -L / 2 + 2, Wd / 2 - 1], col, '#0f100c', 2.5);
  const g = c.createLinearGradient(0, -Wd / 2, 0, Wd / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
  poly(c, [-L / 2 + 2, -Wd / 2 + 1, L / 2 - 12, -Wd / 2 + 1, L / 2, -Wd / 2 + 9, L / 2, Wd / 2 - 9, L / 2 - 12, Wd / 2 - 1, -L / 2 + 2, Wd / 2 - 1], g);
  rect(c, -L / 2 + 5, -Wd / 2 + 6, L * 0.22, Wd - 12, dark, 'rgba(0,0,0,0.5)', 1.5, 2);
  c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1.2;
  for (let k = 0; k < 5; k++) { const x = -L / 2 + 8 + k * 4; c.beginPath(); c.moveTo(x, -Wd / 2 + 8); c.lineTo(x, Wd / 2 - 8); c.stroke(); }
  line(c, L / 2 - 13, -Wd / 2 + 3, L / 2 - 13, Wd / 2 - 3, 'rgba(0,0,0,0.35)', 1.5);
  // camouflage blotches
  c.fillStyle = 'rgba(40,46,28,0.45)';
  for (let k = 0; k < 6; k++) { c.beginPath(); c.ellipse((rnd() - 0.5) * L * 0.8, (rnd() - 0.5) * Wd * 0.7, 6 + rnd() * 8, 3 + rnd() * 5, rnd() * 3, 0, 6.28); c.fill(); }
}

function blob(c, r, col, n = 9, jag = 0.35) {
  c.beginPath();
  for (let k = 0; k <= n; k++) { const a = (k / n) * 6.2832, rr = r * (1 - jag + rnd() * jag * 2); const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (k === 0) c.moveTo(x, y); else c.lineTo(x, y); }
  c.closePath(); c.fillStyle = col; c.fill();
}

export function drawAtlas() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS_SIZE;
  const ctx = cv.getContext('2d');
  seed = 7;
  const S = SPR;

  // ---------------------------------------------------------- defenders
  cell(ctx, S.rifle, (c) => soldier(c, { weapon: rifleW(42) }));
  cell(ctx, S.mg, (c) => {
    // assistant gunner
    c.save(); c.translate(-12, 26); c.scale(0.8, 0.8); c.rotate(-0.35); soldier(c, {}); c.restore();
    c.save(); c.translate(-4, -8);
    soldier(c, { weapon: (q) => { rect(q, 8, 1, 46, 8, OUT); rect(q, 9, 2.5, 44, 5, '#1e1f1b'); rect(q, 12, -6, 12, 9, '#4b5038', OUT, 1.5); line(q, 46, 5, 54, -6, '#1e1f1b', 2.5); line(q, 46, 5, 54, 16, '#1e1f1b', 2.5); } });
    c.restore();
  });
  cell(ctx, S.marksman, (c) => soldier(c, { uni: '#5d6a40', vest: '#404a2c', helm: '#535f38', weapon: (q) => { rect(q, 6, 2.5, 52, 6, OUT); rect(q, 7, 4, 50, 3, '#262722'); rect(q, 16, 0.5, 13, 5, '#15150f'); }, post: (q) => { q.fillStyle = 'rgba(60,72,38,0.9)'; for (let k = 0; k < 9; k++) { q.beginPath(); q.ellipse(3 + (rnd() - 0.5) * 22, (rnd() - 0.5) * 22, 4, 2.2, rnd() * 3, 0, 6.28); q.fill(); } } }));
  cell(ctx, S.grenadier, (c) => soldier(c, { weapon: (q) => { rifleW(34)(q); rect(q, 20, 8, 20, 8, OUT, null, 0, 2); rect(q, 21, 9.5, 18, 5, '#3c3d36', null, 0, 2); }, post: (q) => { for (let k = 0; k < 3; k++) ell(q, -3, -8 + k * 8, 3, 3, '#9a8f4a', OUT, 1); } }));
  cell(ctx, S.at, (c) => soldier(c, { weapon: (q) => { rect(q, -24, 9, 72, 11, OUT, null, 0, 3); rect(q, -22, 10.5, 68, 8, '#4f553c', null, 0, 3); rect(q, 36, 9, 12, 11, '#2a2b25', OUT, 1.5, 2); rect(q, 6, 4, 8, 7, '#191a16'); } }));
  cell(ctx, S.mortar, (c) => {
    ell(c, 6, 0, 16, 16, '#2c2e26', '#0d0e0b', 2.5); ell(c, 6, 0, 11, 11, '#3a3d31');
    line(c, 6, 0, 34, -15, '#191a16', 3); line(c, 6, 0, 34, 15, '#191a16', 3);
    rect(c, 2, -5.5, 34, 11, '#0d0e0b', null, 0, 4); rect(c, 3, -4, 32, 8, '#474b3a', null, 0, 4); ell(c, 33, 0, 3.4, 3.4, '#0a0a0a');
    for (const [x, y, r] of [[-26, -24, 0.7], [-28, 24, -0.6]]) { c.save(); c.translate(x, y); c.scale(0.62, 0.62); c.rotate(r); soldier(c, {}); c.restore(); }
    rect(c, -14, 30, 16, 11, '#5a5a3c', OUT, 1.5, 2);
  });
  cell(ctx, S.howitzer, (c) => {
    line(c, -8, 0, -56, -26, '#0e0f0c', 8); line(c, -8, 0, -56, 26, '#0e0f0c', 8);
    line(c, -8, 0, -56, -26, '#4a4f39', 5); line(c, -8, 0, -56, 26, '#4a4f39', 5);
    rect(c, -60, -31, 9, 10, '#33362a', OUT, 1.5); rect(c, -60, 21, 9, 10, '#33362a', OUT, 1.5);
    rect(c, -12, -22, 9, 12, '#141410', null, 0, 3); rect(c, -12, 10, 9, 12, '#141410', null, 0, 3);
    rect(c, -6, -5, 64, 10, '#0e0f0c', null, 0, 3); rect(c, -5, -3.5, 62, 7, '#575c44', null, 0, 3); rect(c, 50, -5.5, 9, 11, '#3b3e30', OUT, 1.5, 2);
    poly(c, [-4, -18, 8, -15, 8, 15, -4, 18], '#515640', OUT, 2);
    for (const [x, y] of [[-30, -6], [-34, 9], [-22, 16]]) { c.save(); c.translate(x, y); c.scale(0.42, 0.42); soldier(c, {}); c.restore(); }
  });
  cell(ctx, S.ifvHull, (c) => vehicleHull(c, 104, 46, '#5c6341', '#454a31', false));
  cell(ctx, S.ifvTurret, (c) => {
    rect(c, 8, -3.2, 46, 6.4, '#0e0f0c', null, 0, 2); rect(c, 9, -1.8, 44, 3.6, '#34372b', null, 0, 2);
    poly(c, [-14, -11, 6, -13, 14, -7, 14, 7, 6, 13, -14, 11], '#69704a', '#0f100c', 2.5); sheen(c, 0, 0, 14, 0.22);
    ell(c, -4, -4, 4, 4, '#3d412f', OUT, 1.2); rect(c, -6, 5, 9, 5, '#2b2e22', OUT, 1);
  });
  cell(ctx, S.tankHull, (c) => vehicleHull(c, 98, 44, '#565d3c', '#3f442d', true));
  cell(ctx, S.tankTurret, (c) => {
    rect(c, 14, -3.6, 48, 7.2, '#0e0f0c', null, 0, 2); rect(c, 15, -2.2, 46, 4.4, '#3b3f2f', null, 0, 2); rect(c, 34, -3.4, 8, 6.8, '#2b2e22');
    poly(c, [-24, -14, 2, -17, 18, -9, 20, 0, 18, 9, 2, 17, -24, 14], '#646b46', '#0f100c', 2.5); sheen(c, -2, 0, 20, 0.22);
    rect(c, -22, -9, 8, 18, '#484d33', 'rgba(0,0,0,0.5)', 1.2, 2);
    ell(c, -4, -6, 5, 5, '#3d412f', OUT, 1.4); ell(c, -2, 7, 4, 4, '#3d412f', OUT, 1.2);
    line(c, -4, -6, 6, -13, '#15160f', 2);
  });
  const crateBox = (c, x, y, w, h, col) => { rect(c, x, y, w, h, col, OUT, 2, 2); line(c, x + 3, y + h / 2, x + w - 3, y + h / 2, 'rgba(0,0,0,0.4)', 1.5); line(c, x + w / 2, y + 2, x + w / 2, y + h - 2, 'rgba(255,255,255,0.12)', 1.5); };
  cell(ctx, S.cache, (c) => {
    crateBox(c, -34, -26, 30, 22, '#6a6a44'); crateBox(c, -2, -30, 32, 24, '#5d6340'); crateBox(c, -30, 0, 26, 26, '#59603d'); crateBox(c, 0, -2, 34, 28, '#6f6d46'); crateBox(c, -12, -14, 26, 22, '#77754b');
    c.strokeStyle = 'rgba(50,58,34,0.55)'; c.lineWidth = 1.4;
    for (let k = -44; k < 50; k += 9) { c.beginPath(); c.moveTo(k, -40); c.lineTo(k + 26, 40); c.moveTo(k + 26, -40); c.lineTo(k, 40); c.stroke(); }
    rect(c, 6, 4, 16, 10, '#d8b23a', OUT, 1.5); line(c, 9, 9, 19, 9, '#111', 2);
  });
  cell(ctx, S.crate, (c) => { crateBox(c, -30, -24, 60, 48, '#6f6d46'); line(c, -30, -8, 30, -8, '#2d2e22', 4); line(c, -30, 10, 30, 10, '#2d2e22', 4); rect(c, -10, -6, 20, 14, '#d8b23a', OUT, 1.5); line(c, -6, 1, 6, 1, '#111', 2.5); });

  // ---------------------------------------------------------- attackers
  cell(ctx, S.uruk, (c) => orc(c, { shield: true, weapon: blade }));
  cell(ctx, S.archer, (c) => orc(c, { armor: '#43362a', weapon: (q) => { line(q, 6, 6, 44, 6, '#0a0a0b', 6); line(q, 8, 6, 44, 6, '#4d3a28', 3); q.beginPath(); q.arc(26, 6, 20, -1.25, 1.25); q.strokeStyle = '#0a0a0b'; q.lineWidth = 5; q.stroke(); q.strokeStyle = '#6b6d70'; q.lineWidth = 2.5; q.stroke(); line(q, 32, -13, 32, 25, 'rgba(220,220,210,0.6)', 1); } }));
  cell(ctx, S.berserker, (c) => orc(c, { bare: true, armor: '#4a3f37', skin: '#8a7462', weapon: (q) => { line(q, 2, 20, 58, 12, '#0a0a0b', 9); line(q, 16, 18, 58, 12, '#c0c4c8', 5.5); line(q, 2, 20, 16, 18, '#3a281a', 6); line(q, 14, 11, 18, 25, '#55565a', 4); } }));
  cell(ctx, S.warg, (c) => {
    ell(c, -44, 0, 12, 4, '#3b3129', '#0a0908', 2);
    ell(c, -4, 0, 38, 15, '#4d4136', '#0a0908', 2.5);
    c.strokeStyle = 'rgba(25,20,16,0.5)'; c.lineWidth = 2; for (let k = 0; k < 16; k++) { const x = -34 + rnd() * 60, y = (rnd() - 0.5) * 22; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 7, y + (rnd() - 0.5) * 3); c.stroke(); }
    poly(c, [26, -11, 48, -6, 56, 0, 48, 6, 26, 11], '#40362d', '#0a0908', 2.5); ell(c, 34, -11, 4, 3, '#2a231d'); ell(c, 34, 11, 4, 3, '#2a231d'); ell(c, 44, -3.5, 1.6, 1.6, '#e8c04a'); ell(c, 44, 3.5, 1.6, 1.6, '#e8c04a');
    for (const [x, y] of [[14, -17], [14, 17], [-26, -16], [-26, 16]]) ell(c, x, y, 6, 4, '#3b3129', '#0a0908', 1.5);
    c.save(); c.translate(-8, 0); c.scale(0.62, 0.62); orc(c, { weapon: (q) => { line(q, 8, 19, 52, 30, '#0a0a0b', 7); line(q, 14, 20, 52, 30, '#aeb2b6', 4); } }); c.restore();
  });
  cell(ctx, S.troll, (c) => {
    line(c, 0, -34, 36, -40, '#0d0d0b', 20); line(c, 0, -34, 36, -40, '#6c705d', 15);
    line(c, 0, 34, 30, 36, '#0d0d0b', 20); line(c, 0, 34, 30, 36, '#6c705d', 15);
    line(c, 30, 36, 58, 14, '#0b0907', 12); line(c, 30, 36, 58, 14, '#4a3524', 8); ell(c, 56, 15, 8, 8, '#3b2a1c', '#0b0907', 2);
    for (let k = 0; k < 5; k++) line(c, 56, 15, 56 + Math.cos(k * 1.3) * 12, 15 + Math.sin(k * 1.3) * 12, '#9a9a94', 2.5);
    ell(c, -2, 0, 28, 40, '#62665a', '#0d0d0b', 3); sheen(c, -2, 0, 34, 0.18);
    c.fillStyle = 'rgba(40,42,34,0.5)'; for (let k = 0; k < 12; k++) { c.beginPath(); c.ellipse(-2 + (rnd() - 0.5) * 40, (rnd() - 0.5) * 60, 3 + rnd() * 5, 2 + rnd() * 3, rnd() * 3, 0, 6.28); c.fill(); }
    rect(c, -22, -30, 34, 60, 'rgba(45,42,40,0.75)', '#0d0d0b', 2, 8);
    c.strokeStyle = 'rgba(150,150,150,0.35)'; c.lineWidth = 2; for (let k = -24; k <= 24; k += 8) { c.beginPath(); c.moveTo(-20, k); c.lineTo(10, k); c.stroke(); }
    ell(c, 12, 0, 13, 13, '#74786a', '#0d0d0b', 3); sheen(c, 12, 0, 12, 0.25); ell(c, 20, -5, 2, 2, '#ffb030'); ell(c, 20, 5, 2, 2, '#ffb030');
  });
  const ladder = (c) => { line(c, -56, -6, 56, -6, '#0c0a08', 6); line(c, -56, 6, 56, 6, '#0c0a08', 6); line(c, -56, -6, 56, -6, '#7b5d3c', 3.2); line(c, -56, 6, 56, 6, '#7b5d3c', 3.2); for (let x = -52; x <= 52; x += 8) line(c, x, -6, x, 6, '#6a4f33', 2.6); };
  cell(ctx, S.ladder, (c) => {
    ladder(c);
    for (const [x, y] of [[-36, -15], [-36, 15], [4, -15], [4, 15], [38, -15], [38, 15]]) { c.save(); c.translate(x, y); c.scale(0.4, 0.4); orc(c, {}); c.restore(); }
  });
  cell(ctx, S.ladderUp, (c) => { c.save(); c.scale(1, 1.25); ladder(c); c.restore(); line(c, 50, -12, 50, 12, '#555', 4); line(c, 44, -10, 58, -14, '#555', 3); line(c, 44, 10, 58, 14, '#555', 3); });
  cell(ctx, S.ram, (c) => {
    for (const [x, y] of [[-34, -27], [-34, 27], [18, -27], [18, 27]]) rect(c, x - 8, y - 4, 16, 8, '#17120d', '#050403', 1.5, 3);
    rect(c, -48, -6, 108, 12, '#0b0806', null, 0, 4); rect(c, -47, -4.5, 106, 9, '#5d4329', null, 0, 4);
    poly(c, [48, -8, 62, -4, 62, 4, 48, 8], '#55575b', '#0b0806', 2);
    rect(c, -46, -24, 76, 48, '#4b3a29', '#0b0806', 2.5, 4);
    c.strokeStyle = 'rgba(15,10,6,0.55)'; c.lineWidth = 2; for (let x = -40; x < 30; x += 9) { c.beginPath(); c.moveTo(x, -23); c.lineTo(x, 23); c.stroke(); }
    line(c, -46, 0, 30, 0, 'rgba(120,95,65,0.8)', 3);
    c.fillStyle = 'rgba(70,35,25,0.5)'; for (let k = 0; k < 7; k++) { c.beginPath(); c.ellipse(-40 + rnd() * 64, (rnd() - 0.5) * 40, 7, 4, rnd() * 3, 0, 6.28); c.fill(); }
    for (const [x, y] of [[-30, -31], [0, -31], [-30, 31], [0, 31], [-54, -12], [-54, 12]]) { c.save(); c.translate(x, y); c.scale(0.36, 0.36); orc(c, {}); c.restore(); }
  });
  cell(ctx, S.sapper, (c) => orc(c, { bare: true, armor: '#3a332d', skin: '#7a6a5a', weapon: (q) => {
    ell(q, 26, 0, 15, 15, '#1c1c1e', '#050505', 2.5); sheen(q, 26, 0, 14, 0.3);
    for (let k = 0; k < 8; k++) { const a = k * 0.785; line(q, 26 + Math.cos(a) * 13, Math.sin(a) * 13, 26 + Math.cos(a) * 20, Math.sin(a) * 20, '#3a3a3e', 3); }
    line(q, -4, 22, 10, 30, '#3a281a', 4); ell(q, 12, 31, 5, 5, '#ffb43a'); ell(q, 12, 31, 2.5, 2.5, '#fff3c0');
  } }));
  cell(ctx, S.catapult, (c) => {
    for (const [x, y] of [[-30, -30], [-30, 30], [28, -30], [28, 30]]) rect(c, x - 9, y - 4, 18, 8, '#17120d', '#050403', 1.5, 3);
    rect(c, -44, -26, 86, 8, '#5a422a', '#0b0806', 2, 2); rect(c, -44, 18, 86, 8, '#5a422a', '#0b0806', 2, 2);
    rect(c, -44, -26, 8, 52, '#4d3823', '#0b0806', 2, 2); rect(c, 34, -26, 8, 52, '#4d3823', '#0b0806', 2, 2); rect(c, 4, -26, 8, 52, '#6a4e31', '#0b0806', 2, 2);
    rect(c, -52, -4.5, 62, 9, '#0b0806', null, 0, 3); rect(c, -51, -3, 60, 6, '#7a5a38', null, 0, 3);
    ell(c, -50, 0, 11, 11, '#3c2c1c', '#0b0806', 2.5); ell(c, -50, 0, 7, 7, '#77797c', '#222', 1.5);
    for (const [x, y] of [[20, -38], [20, 38], [-14, 40]]) { c.save(); c.translate(x, y); c.scale(0.36, 0.36); orc(c, {}); c.restore(); }
  });

  // ---- icons for units and works that are drawn as 3D meshes in the field
  cell(ctx, 13, (c) => { soldier(c, { helm: '#4a5a3a', weapon: rifleW(38) }); line(c, -14, -6, -40, -30, '#111', 2.5); poly(c, [-40, -30, -22, -34, -26, -22], '#5ec8f2', '#0b2530', 1.5); });
  cell(ctx, 14, (c) => {
    c.strokeStyle = '#3a2a1c'; c.lineWidth = 6; for (const x of [-40, 40]) { c.beginPath(); c.moveTo(x - 12, -26); c.lineTo(x + 12, 26); c.moveTo(x + 12, -26); c.lineTo(x - 12, 26); c.stroke(); }
    c.strokeStyle = '#b9bcc2'; c.lineWidth = 2.5; for (let k = -44; k < 44; k += 12) { c.beginPath(); c.ellipse(k + 6, 0, 9, 22, 0.3, 0, 6.2832); c.stroke(); }
  });
  cell(ctx, 15, (c) => { for (const a of [0.5, -0.5, 1.5708]) { c.save(); c.rotate(a); rect(c, -44, -6, 88, 12, '#4a4643', '#141312', 2.5); line(c, -40, -2, 40, -2, 'rgba(255,255,255,0.18)', 2); c.restore(); } });
  cell(ctx, 26, (c) => { rect(c, -50, -34, 100, 68, '#4a3b2a', '#17110b', 3, 10); rect(c, -42, -24, 84, 48, '#14242c', null, 0, 8); c.strokeStyle = 'rgba(160,200,220,0.35)'; c.lineWidth = 2; for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(-30, k * 12); c.quadraticCurveTo(0, k * 12 - 6, 30, k * 12); c.stroke(); } });
  cell(ctx, 27, (c) => { ell(c, 0, 0, 34, 34, '#3d4329', '#11130c', 3); ell(c, 0, 0, 22, 22, '#2b301e', '#11130c', 2); ell(c, 0, 0, 8, 8, '#111'); for (let k = 0; k < 3; k++) { const a = k * 2.094; line(c, Math.cos(a) * 12, Math.sin(a) * 12, Math.cos(a) * 20, Math.sin(a) * 20, '#11130c', 3); } });
  cell(ctx, 28, (c) => { c.beginPath(); c.arc(-60, 0, 76, -0.42, 0.42); c.arc(-60, 0, 62, 0.42, -0.42, true); c.closePath(); c.fillStyle = '#4f5a34'; c.fill(); c.strokeStyle = '#11130c'; c.lineWidth = 3; c.stroke(); line(c, -4, -18, -22, -30, '#111', 3); line(c, -4, 18, -22, 30, '#111', 3); c.strokeStyle = 'rgba(240,179,74,0.75)'; c.lineWidth = 2; c.setLineDash([5, 5]); for (const a of [-0.45, 0, 0.45]) { c.beginPath(); c.moveTo(20, 0); c.lineTo(20 + Math.cos(a) * 38, Math.sin(a) * 38); c.stroke(); } c.setLineDash([]); });
  cell(ctx, 29, (c) => { poly(c, [-18, -22, -44, -30, -44, 30, -18, 22], '#8e1f16', '#0b0a0a', 2.5); orc(c, { armor: '#5a4a48', shield: true, weapon: blade }); line(c, -6, -10, -6, -44, '#2a1c12', 4); poly(c, [-6, -44, 20, -40, 20, -22, -6, -24], '#a3271b', '#0b0a0a', 2); ell(c, 8, -32, 4, 5, '#e4e0d4'); });
  cell(ctx, 30, (c) => {
    for (const [x, y] of [[-30, -34], [-30, 34], [26, -34], [26, 34]]) rect(c, x - 10, y - 5, 20, 10, '#17120d', '#050403', 1.5, 3);
    rect(c, -40, -30, 76, 60, '#4b3a29', '#0b0806', 3, 3); rect(c, -32, -22, 60, 44, '#6a5137', '#0b0806', 2);
    c.strokeStyle = 'rgba(15,10,6,0.55)'; c.lineWidth = 2; for (let x = -26; x < 28; x += 9) { c.beginPath(); c.moveTo(x, -22); c.lineTo(x, 22); c.stroke(); }
    rect(c, 36, -18, 18, 36, '#3a2c1e', '#0b0806', 2); line(c, 40, -14, 40, 14, 'rgba(255,255,255,0.15)', 2);
    for (const [x, y] of [[-14, -8], [4, 8], [-12, 10], [8, -10]]) { c.save(); c.translate(x, y); c.scale(0.32, 0.32); orc(c, {}); c.restore(); }
  });

  // ------------------------------------------------------------ aircraft
  cell(ctx, S.jet, (c) => {
    poly(c, [58, 0, 30, -6, 6, -9, -22, -46, -38, -46, -24, -9, -44, -8, -54, -22, -60, -22, -54, 0, -60, 22, -54, 22, -44, 8, -24, 9, -38, 46, -22, 46, 6, 9, 30, 6], '#7d858c', '#1c2024', 2.5);
    poly(c, [58, 0, 30, -6, -44, -3, -44, 3, 30, 6], 'rgba(255,255,255,0.14)');
    ell(c, 30, 0, 9, 3.5, '#22303a', '#0e1216', 1.2); line(c, -44, -4, -52, -4, '#33383c', 4); line(c, -44, 4, -52, 4, '#33383c', 4);
    for (const y of [-26, 26, -36, 36]) rect(c, -24, y - 1.6, 16, 3.2, '#3a4046');
  });
  cell(ctx, S.helo, (c) => {
    line(c, -58, 0, -8, 0, '#161a12', 8); line(c, -58, 0, -8, 0, '#4d5639', 5);
    line(c, -56, -9, -56, 9, '#161a12', 5); line(c, -56, -9, -56, 9, '#4d5639', 2.5);
    rect(c, -12, -22, 18, 44, '#3e4630', '#161a12', 2, 3);
    for (const y of [-20, 20]) { rect(c, -8, y - 3, 22, 6, '#2a2e22', '#111', 1.2, 2); }
    poly(c, [44, 0, 34, -8, 4, -10, -22, -6, -22, 6, 4, 10, 34, 8], '#56603f', '#161a12', 2.5);
    ell(c, 26, 0, 10, 5.5, '#1c2a30', '#0c1012', 1.3); ell(c, 12, 0, 7, 5, '#1c2a30', '#0c1012', 1.3);
    line(c, 44, 0, 54, 0, '#1b1c18', 3);
  });
  cell(ctx, S.rotor, (c) => {
    const g = c.createRadialGradient(0, 0, 4, 0, 0, 60);
    g.addColorStop(0, 'rgba(30,32,28,0.5)'); g.addColorStop(0.9, 'rgba(40,42,38,0.16)'); g.addColorStop(1, 'rgba(40,42,38,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, 60, 0, 6.2832); c.fill();
    for (let k = 0; k < 4; k++) { c.save(); c.rotate(k * 1.5708 + 0.3); const b = c.createLinearGradient(0, -5, 0, 5); b.addColorStop(0, 'rgba(15,16,14,0)'); b.addColorStop(0.5, 'rgba(15,16,14,0.75)'); b.addColorStop(1, 'rgba(15,16,14,0)'); c.fillStyle = b; c.fillRect(0, -5, 58, 10); c.restore(); }
    ell(c, 0, 0, 5, 5, '#1a1b18');
  });
  cell(ctx, S.cargo, (c) => {
    poly(c, [6, -6, -6, -60, -18, -60, -14, -6], '#6f7780', '#1c2024', 2.5); poly(c, [6, 6, -6, 60, -18, 60, -14, 6], '#6f7780', '#1c2024', 2.5);
    poly(c, [-44, -4, -52, -24, -60, -24, -56, -4], '#6f7780', '#1c2024', 2); poly(c, [-44, 4, -52, 24, -60, 24, -56, 4], '#6f7780', '#1c2024', 2);
    rect(c, -58, -7.5, 116, 15, '#868e96', '#1c2024', 2.5, 7); rect(c, -50, -2.5, 96, 3, 'rgba(255,255,255,0.18)');
    for (const y of [-24, -42, 24, 42]) { rect(c, -4, y - 3.5, 16, 7, '#4a5057', '#1c2024', 1.5, 3); ell(c, 14, y, 2, 9, 'rgba(30,30,30,0.4)'); }
    ell(c, 48, 0, 6, 5, '#22303a');
  });
  cell(ctx, S.transport, (c) => {
    line(c, -58, 0, -20, 0, '#161a12', 9); line(c, -58, 0, -20, 0, '#525a3d', 6); line(c, -56, -10, -56, 10, '#525a3d', 3);
    rect(c, -28, -13, 68, 26, '#5a6342', '#161a12', 2.5, 10);
    ell(c, 30, 0, 8, 9, '#1c2a30', '#0c1012', 1.3); rect(c, -10, -13, 16, 26, 'rgba(0,0,0,0.25)');
    rect(c, -16, -19, 26, 6, '#3d4430', '#161a12', 1.5, 2); rect(c, -16, 13, 26, 6, '#3d4430', '#161a12', 1.5, 2);
  });
  cell(ctx, S.chute, (c) => {
    for (let k = 0; k < 12; k++) { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 56, k * 0.5236, (k + 1) * 0.5236); c.closePath(); c.fillStyle = k & 1 ? '#c9cbb8' : '#7d8759'; c.fill(); c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1.5; c.stroke(); }
    const g = c.createRadialGradient(-14, -14, 4, 0, 0, 58); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0.3)'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 56, 0, 6.2832); c.fill();
    ell(c, 0, 0, 5, 5, '#22241b');
  });
  cell(ctx, S.shell, (c) => { const g = c.createLinearGradient(-50, 0, 30, 0); g.addColorStop(0, 'rgba(255,200,120,0)'); g.addColorStop(1, 'rgba(255,235,190,0.95)'); c.fillStyle = g; c.beginPath(); c.moveTo(-50, 0); c.lineTo(22, -7); c.lineTo(32, 0); c.lineTo(22, 7); c.closePath(); c.fill(); ell(c, 24, 0, 9, 6, '#3a3c36', '#111', 1.5); });
  cell(ctx, S.rock, (c) => { blob(c, 40, '#55575a', 10, 0.2); c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.arc(10, 10, 30, 0, 6.28); c.fill(); blob(c, 26, '#7c7e80', 8, 0.25); sheen(c, -6, -8, 28, 0.3); });
  cell(ctx, S.bomb, (c) => { rect(c, -36, -10, 66, 20, '#3d4238', '#0d0e0b', 2.5, 10); poly(c, [-36, -10, -52, -22, -44, 0, -52, 22, -36, 10], '#2c3028', '#0d0e0b', 2); line(c, -6, -9, -6, 9, '#c9b23a', 4); sheen(c, 0, -3, 24, 0.25); });
  cell(ctx, S.rocket, (c) => { rect(c, -30, -5, 60, 10, '#c8ccc6', '#222', 2, 5); poly(c, [-30, -5, -42, -14, -36, 0, -42, 14, -30, 5], '#7a7e78', '#222', 1.5); const g = c.createLinearGradient(-60, 0, -30, 0); g.addColorStop(0, 'rgba(255,170,60,0)'); g.addColorStop(1, 'rgba(255,230,160,1)'); c.fillStyle = g; c.fillRect(-60, -5, 30, 10); });

  // ------------------------------------------------------------- effects
  cell(ctx, S.glow, (c) => { const g = c.createRadialGradient(0, 0, 0, 0, 0, 60); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.14)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(-62, -62, 124, 124); });
  cell(ctx, S.smoke, (c) => {
    for (let k = 0; k < 22; k++) { const a = rnd() * 6.28, r = rnd() * 28, rr = 16 + rnd() * 18; const x = Math.cos(a) * r, y = Math.sin(a) * r; const g = c.createRadialGradient(x, y, 0, x, y, rr); const v = 200 + (rnd() * 55) | 0; g.addColorStop(0, `rgba(${v},${v},${v},0.3)`); g.addColorStop(1, `rgba(${v},${v},${v},0)`); c.fillStyle = g; c.fillRect(-62, -62, 124, 124); }
  });
  cell(ctx, S.streak, (c) => { const g = c.createLinearGradient(-60, 0, 60, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.75, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,1)'); c.fillStyle = g; c.beginPath(); c.moveTo(-60, 0); c.lineTo(48, -22); c.quadraticCurveTo(62, 0, 48, 22); c.closePath(); c.fill(); });
  cell(ctx, S.ring, (c) => { c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 5; c.shadowColor = '#fff'; c.shadowBlur = 8; c.beginPath(); c.arc(0, 0, 50, 0, 6.2832); c.stroke(); });
  cell(ctx, S.spark, (c) => { c.fillStyle = '#fff'; c.shadowColor = '#fff'; c.shadowBlur = 10; poly(c, [0, -44, 7, -7, 44, 0, 7, 7, 0, 44, -7, 7, -44, 0, -7, -7], '#fff'); });
  cell(ctx, S.debris, (c) => { poly(c, [-30, -18, 4, -34, 34, -10, 26, 24, -8, 34, -36, 12], '#77756e', '#2a2925', 4); poly(c, [-30, -18, 4, -34, 34, -10, 0, 0], 'rgba(255,255,255,0.18)'); });
  cell(ctx, S.flash, (c) => { const g = c.createRadialGradient(-30, 0, 0, -10, 0, 70); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,240,200,0.85)'); g.addColorStop(1, 'rgba(255,200,120,0)'); c.fillStyle = g; poly(c, [-50, 0, -30, -16, 0, -30, -6, -10, 58, 0, -6, 10, 0, 30, -30, 16], g); });
  cell(ctx, S.corpseOrc, (c) => { ell(c, 0, 0, 22, 12, '#1a191b'); line(c, -10, -6, -30, -18, '#1a191b', 7); line(c, 8, 6, 30, 16, '#1a191b', 7); line(c, 8, -8, 26, -20, '#201f22', 6); ell(c, -22, 6, 9, 9, '#2a2a2e'); line(c, 16, 14, 40, 6, '#6a6d70', 3); ell(c, -22, 6, 3, 4, 'rgba(220,216,200,0.6)'); });
  cell(ctx, S.corpseMan, (c) => { ell(c, 0, 0, 22, 11, '#6f6f4c'); line(c, -10, -6, -30, -14, '#6f6f4c', 7); line(c, 8, 6, 28, 18, '#6f6f4c', 7); line(c, 10, -6, 28, -14, '#66664a', 6); ell(c, -20, 4, 9, 9, '#585b3d'); ell(c, 2, 0, 12, 8, '#454833'); line(c, -4, 16, 26, 22, '#1e1f1b', 3.5); });
  cell(ctx, S.scorch, (c) => { for (let k = 0; k < 14; k++) { const a = rnd() * 6.28, r = rnd() * 22, rr = 18 + rnd() * 22; const x = Math.cos(a) * r, y = Math.sin(a) * r; const g = c.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, 'rgba(12,10,8,0.5)'); g.addColorStop(1, 'rgba(12,10,8,0)'); c.fillStyle = g; c.fillRect(-62, -62, 124, 124); } });
  cell(ctx, S.blood, (c) => { c.fillStyle = '#fff'; blob(c, 20, '#fff', 11, 0.45); for (let k = 0; k < 9; k++) { const a = rnd() * 6.28, r = 20 + rnd() * 28; ell(c, Math.cos(a) * r, Math.sin(a) * r, 2 + rnd() * 5, 2 + rnd() * 4, '#fff'); } });
  cell(ctx, S.crater, (c) => { const g = c.createRadialGradient(0, 0, 4, 0, 0, 58); g.addColorStop(0, 'rgba(22,17,12,0.8)'); g.addColorStop(0.4, 'rgba(40,31,22,0.62)'); g.addColorStop(0.6, 'rgba(98,82,60,0.5)'); g.addColorStop(0.8, 'rgba(70,58,42,0.22)'); g.addColorStop(1, 'rgba(50,42,30,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 60, 0, 6.2832); c.fill(); for (let k = 0; k < 16; k++) { const a = rnd() * 6.28, r = 34 + rnd() * 22; ell(c, Math.cos(a) * r, Math.sin(a) * r, 2 + rnd() * 3, 2 + rnd() * 3, 'rgba(70,58,44,0.7)'); } });
  cell(ctx, S.corpseTroll, (c) => { ell(c, 0, 0, 44, 28, '#3d4037'); line(c, -20, -16, -52, -30, '#3d4037', 16); line(c, 20, 14, 52, 28, '#3d4037', 16); ell(c, -40, 14, 14, 14, '#4a4d43'); rect(c, -22, -18, 44, 36, 'rgba(28,26,25,0.7)', null, 0, 8); });
  cell(ctx, S.wreck, (c) => { rect(c, -50, -24, 100, 48, '#1b1a17', '#070706', 3, 6); rect(c, -46, -30, 92, 8, '#0e0d0b', null, 0, 3); rect(c, -46, 22, 92, 8, '#0e0d0b', null, 0, 3); poly(c, [-16, -12, 10, -16, 20, 0, 10, 14, -16, 10], '#26241f', '#070706', 2); line(c, 12, -2, 50, -14, '#151412', 5); c.fillStyle = 'rgba(70,40,20,0.5)'; for (let k = 0; k < 8; k++) { c.beginPath(); c.ellipse((rnd() - 0.5) * 80, (rnd() - 0.5) * 36, 8, 5, rnd() * 3, 0, 6.28); c.fill(); } });
  cell(ctx, S.rubble, (c) => { for (let k = 0; k < 26; k++) { c.save(); c.translate((rnd() - 0.5) * 90, (rnd() - 0.5) * 90); c.rotate(rnd() * 6); const s = 4 + rnd() * 10; const v = 90 + (rnd() * 70) | 0; rect(c, -s, -s * 0.7, s * 2, s * 1.4, `rgb(${v},${v - 4},${v - 10})`, 'rgba(0,0,0,0.6)', 1.5); c.restore(); } });
  cell(ctx, S.dot, (c) => ell(c, 0, 0, 52, 52, '#fff'));
  cell(ctx, S.arrow, (c) => { line(c, -56, 0, 50, 0, '#fff', 12); poly(c, [44, -18, 60, 0, 44, 18], '#fff'); });
  cell(ctx, S.splinter, (c) => { poly(c, [-50, -6, 40, -10, 54, 0, 38, 9, -48, 7], '#6b5035', '#1a120a', 4); });
  return cv;
}

/** Small icon canvas for UI use. */
export function makeIcon(atlas, spr, px = 44, turret = -1) {
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = cv.height = px * dpr;
  cv.style.width = cv.style.height = px + 'px';
  const c = cv.getContext('2d');
  c.translate(cv.width / 2, cv.height / 2); c.rotate(-Math.PI / 2); c.translate(-cv.width / 2, -cv.height / 2);
  for (const s of [spr, turret]) if (s >= 0) c.drawImage(atlas, (s % COLS) * CELLPX, Math.floor(s / COLS) * CELLPX, CELLPX, CELLPX, 0, 0, cv.width, cv.height);
  return cv;
}
