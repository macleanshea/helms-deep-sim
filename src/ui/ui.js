// DOM user interface: setup panels, battle HUD, toasts and dialogs.

import { UNITS, U, DEF, ORC, SUPPORT, WEAPONS, C, R } from '../config.js';
import { SUPPLY_R } from '../sim/support.js';
import { PRESETS, waveSummary, forceCost } from '../scenarios.js';

const $ = (id) => document.getElementById(id);
export const fmt = (n) => Math.round(n).toLocaleString('en-US');
const mmss = (s) => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
/** How far a unit reaches, as shown on its card and in battle: weapon range, or re-arming radius. */
export function reachOf(d) {
  const w = d.wdef || (d.ob === 'claymore' ? WEAPONS.claymore : null);
  // indirect fire is shown with its minimum: it cannot land rounds any closer
  const mn = w && w.arc && w.min;
  if (w && w.range) return { text: w.range >= 1500 ? 'Map-wide' : `${mn ? mn + '–' : ''}${w.range} m`, what: d.ob ? 'Blast range' : `${w.name} range${mn ? ', minimum to maximum' : ''}` };
  if (d.pool) return { text: `${SUPPLY_R} m`, what: 'Re-arm range' };
  return null;
}
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const RANGE_SVG = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.6"/><circle cx="6" cy="6" r="1.3" fill="currentColor"/></svg>';
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  air: I('<path d="M12 2.5l1.6 6.5 7.9 4.2v1.8l-7.9-2.2-.5 5 2.4 1.8v1.4L12 20l-3.500 1v-1.400l2.400-1.800-.5-5-7.900 2.200v-1.800L10.400 9z" fill="currentColor" stroke="none"/>'),
  gunship: I('<path d="M3 5.500h16M11 5.500v3"/><path d="M5 12.500c0-2.200 2.300-4 6-4s7.500 1.600 9 5l-2.200 1.800H9l-2-2.800z" fill="currentColor" stroke="none"/><path d="M7 13H2.500l-.5-3M9 18.500h9M11 15.300v3.200M15 15.300v3.200"/>'),
  supply: I('<path d="M4 8.500a8 8 0 0116 0z" fill="currentColor" stroke="none"/><path d="M4 8.500l6 7M20 8.500l-6 7M12 8.500v7"/><rect x="8.500" y="15.500" width="7" height="6" rx="1" fill="currentColor" stroke="none"/>'),
  reinforce: I('<circle cx="6" cy="8" r="2.200" fill="currentColor" stroke="none"/><circle cx="12" cy="6.500" r="2.400" fill="currentColor" stroke="none"/><circle cx="18" cy="8" r="2.200" fill="currentColor" stroke="none"/><path d="M2.500 19c0-4 1.500-6.500 3.500-6.500s2.300 1.200 2.800 2.500M21.500 19c0-4-1.500-6.500-3.500-6.500s-2.300 1.200-2.800 2.500M7.500 20.500c0-5.500 2-8.500 4.500-8.500s4.500 3 4.500 8.500"/>'),
  focus: I('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="3.200"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>'),
  fire: I('<path d="M5 20.500l3.500-12.500 3 .8-3.500 12.500z" fill="currentColor" stroke="none"/><path d="M3 21h8"/><circle cx="17" cy="7" r="4.200"/><path d="M17 1.500v3M17 9.500v3M11.500 7h3M19.500 7h3"/>'),
  zones: I('<path d="M3 19a9 9 0 0118 0"/><path d="M7 19a5 5 0 0110 0" stroke-dasharray="2 2"/><circle cx="12" cy="19" r="1.400" fill="currentColor"/>'),
  ranges: I('<path d="M12 20L4.500 7.500A13 13 0 0119.500 7.500z" fill="currentColor" fill-opacity=".22"/><path d="M12 20L4.500 7.500A13 13 0 0119.500 7.500z"/><circle cx="12" cy="20" r="1.400" fill="currentColor"/>'),
  retreat: I('<path d="M11 21V9.500l2-1.500 1.200 1.500h3.600L19 8l2 1.500V21h-3.500v-3.500a1.500 1.500 0 00-3 0V21z" fill="currentColor" stroke="none"/><path d="M2.500 14h6M6 11l3 3-3 3"/>'),
  losses: I('<path d="M12 3v18M7 8h10" /><circle cx="6" cy="17" r="1.300" fill="currentColor"/><circle cx="18" cy="16" r="1.300" fill="currentColor"/><circle cx="16.500" cy="20" r="1.300" fill="currentColor"/><circle cx="8" cy="20.500" r="1.300" fill="currentColor"/>'),
};

/** `portraits`: { unit key: { img, x, y, size } }, tiles of the painted atlas (see portraits.js). It may fill in after the UI is built. */
export function buildUI(app, portraits) {
  /** What one unit counts for in its side's strength: with crewed engines on, an engine is timber, not troops. */
  const strength = (d) => (d.crew ? 0 : 1) + (d.carry || 0); // an engine is timber, not troops
  const ui = {};
  const icon = (d, px) => {
    const cv = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1), src = portraits[d.key];
    const n = cv.width = cv.height = Math.round(px * dpr); cv.style.width = cv.style.height = px + 'px';
    const c = cv.getContext('2d');
    if (src) { c.imageSmoothingQuality = 'high'; c.drawImage(src.img, src.x, src.y, src.size, src.size, 0, 0, n, n); return cv; }
    // no picture (the atlas failed to load, or has not arrived yet): a circle with a cross through it
    const r = n * 0.27, k = r * 0.48;
    c.strokeStyle = 'rgba(141, 152, 163, 0.75)'; c.lineWidth = Math.max(1, n / 22); c.lineCap = 'round';
    c.beginPath(); c.arc(n / 2, n / 2, r, 0, Math.PI * 2);
    c.moveTo(n / 2 - k, n / 2 - k); c.lineTo(n / 2 + k, n / 2 + k); c.moveTo(n / 2 + k, n / 2 - k); c.lineTo(n / 2 - k, n / 2 + k);
    c.stroke();
    return cv;
  };
  let tab = DEF;

  // ------------------------------------------------------------ tooltips
  const tip = $('tooltip');
  function bindTip(node, title, body) {
    node.addEventListener('mouseenter', () => {
      tip.innerHTML = `<b>${title}</b><span>${typeof body === 'function' ? body() : body}</span>`; // body may depend on the moment
      tip.hidden = false;
      const r = node.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
      if (y < 60) { y = r.top; x = r.right + 10; if (x + tw > innerWidth - 8) x = r.left - tw - 10; }
      tip.style.left = Math.max(8, Math.min(innerWidth - tw - 8, x)) + 'px';
      tip.style.top = Math.max(8, y) + 'px';
    });
    node.addEventListener('mouseleave', () => { tip.hidden = true; });
  }

  // ------------------------------------------------------------- top bar
  const preset = $('preset'), modeSw = $('modeSw');
  let bestScores = {};
  /**
   * The scenario list for the current mode. A challenge offers the scenarios, each with the best medal
   * and score won on it; the sandbox opens on the same scenario with both armies laid out, and offers the others (and a blank map) to autofill it.
   */
  ui.refreshPresetList = () => {
    const sb = app.isSandbox(), cur = preset.value;
    preset.innerHTML = '';
    const blank = PRESETS.find((p) => p.key === 'empty'), rest = PRESETS.filter((p) => p !== blank && !p.hidden);
    for (const p of sb ? [blank, ...rest] : rest) {
      const b = !sb && bestScores[p.key];
      // (the best score won on it is shown beside the list, labelled: tacked onto the name it read as part of the name)
      const o = el('option', null, p.name + (p.level ? ` (${p.level})` : '') + (b && b.medal ? '  ★' : ''));
      o.value = p.key; preset.append(o);
    }
    preset.value = cur;
    ui.showBest();
    preset.title = sb ? 'Replaces both armies on the map' : '';
    for (const b of modeSw.children) b.classList.toggle('active', app.modeChosen && (b.dataset.mode === 'sandbox') === sb);
  };
  /** The best score on the chosen challenge, beside the list (nothing in the sandbox, or before one is won). */
  ui.showBest = () => {
    const b = !app.isSandbox() && bestScores[preset.value], out = $('presetBest');
    out.textContent = b ? `Best ${b.score}${b.medal ? ' ★' : ''}` : '';
    out.hidden = !b;
  };
  ui.refreshPresets = (best) => { bestScores = best; ui.refreshPresetList(); };
  preset.addEventListener('change', () => { ui.hideCoach(); app.loadPreset(preset.value); preset.blur(); ui.showBest(); });
  ui.setPreset = (k) => { preset.value = k; ui.showBest(); };
  for (const b of modeSw.children) {
    const sb = b.dataset.mode === 'sandbox';
    b.addEventListener('click', () => { if (!app.modeChosen || sb !== app.isSandbox()) app.enterMode(b.dataset.mode); b.blur(); });
    bindTip(b, sb ? 'Sandbox' : 'Challenge', sb
      ? 'Build both armies and set the rules. Not scored.'
      : 'Hold a set scenario until dawn, on a budget. Scored, with medals.');
  }
  const btnBegin = $('btnBegin');
  btnBegin.addEventListener('click', () => app.startBattle());
  /** A challenge cannot begin while the garrison costs more than its requisition. */
  ui.refreshBegin = () => {
    const over = !app.isSandbox() ? forceCost(app.setup.groups) - app.setup.budget : 0;
    btnBegin.disabled = over > 0;
    btnBegin.title = over > 0 ? `Over budget by ${fmt(over)} pts. Edit the garrison to begin.` : '';
  };
  const btnBack = $('btnBack');
  btnBack.addEventListener('click', () => app.backToSetup());
  $('btnResult').addEventListener('click', () => { if (app.sim && app.sim.result) ui.showEnd(app.sim); });
  $('btnHelp').addEventListener('click', () => { ui.closePopups(); ui.showHelp(); });
  $('btnSettings').addEventListener('click', (e) => { e.stopPropagation(); ui.toggleSettings(); $('btnSettings').blur(); });
  $('btnSound').addEventListener('click', () => { const m = app.toggleMute(); $('btnSound').classList.toggle('off', m); });
  for (const b of document.querySelectorAll('#speedCtl .seg')) b.addEventListener('click', () => { app.setSpeed(+b.dataset.speed); b.blur(); });

  // ---------------------------------------------------- palette & brush
  const palette = $('palette');
  function renderPalette() {
    palette.innerHTML = '';
    const sandbox = !app.setup || app.isSandbox();
    if (tab === ORC && !sandbox) {
      // in a challenge the enemy is what it is
      const box = el('div', 'locked', '<b>Attackers are fixed in a challenge</b><span>Sandbox lets you edit both armies. It is not scored.</span>');
      const b = el('button', null, 'Switch to Sandbox'); b.addEventListener('click', () => app.enterMode('sandbox'));
      box.append(b); palette.append(box);
      return;
    }
    const showCost = !sandbox && app.oobOpen; // requisition points only once the order of battle is opened up
    const card = (d) => {
      const b = el('button', 'card ' + (d.team === DEF ? 'def' : 'orc') + (app.tool && app.tool.kind === 'place' && app.tool.type === d.key ? ' active' : ''));
      const ic = el('div', 'ico'); ic.append(icon(d, 44));
      const r = reachOf(d);
      const meta = (r ? `<i class="rng" title="${r.what}">${RANGE_SVG}${r.text}</i>` : '') + (d.cost && showCost ? `<em title="Requisition cost">${d.cost} pts</em>` : '');
      b.append(ic, el('div', null, `<b><span class="nm">${d.name}</span>${meta ? `<span class="meta">${meta}</span>` : ''}</b><span>${d.desc}</span>`));
      b.addEventListener('click', () => { app.selectPlaceTool(app.tool && app.tool.type === d.key ? null : d.key); b.blur(); });
      if (d.note) bindTip(b, d.name, `${d.note}<br><br><b>Counter:</b> ${d.counter}`);
      palette.append(b);
    };
    const mine = UNITS.filter((d) => d.team === tab && !d.hidden);
    const section = (title, list) => { if (!list.length) return; palette.append(el('div', 'pal-head', title)); list.forEach(card); };
    if (tab === DEF) {
      section('Troops', mine.filter((d) => d.cls === C.INF));
      section('Vehicles and guns', mine.filter((d) => d.cls === C.VEH || d.cls === C.GUN));
      section('Obstacles and supply', mine.filter((d) => d.cls === C.OBST || d.cls === C.CACHE));
    } else {
      // a whole host in waves, without laying out each one by hand
      const cur = app.setup.groups.filter((g) => g.team === ORC && g.phase != null).reduce((a, g) => a + g.count * strength(UNITS[U[g.type]]), 0);
      const box = el('div', 'raise', `<b>Raise a horde</b><span>Fills the valley with a mixed horde of this size.${cur ? ` Replaces the current ${fmt(cur)}.` : ''}</span>`);
      const row = el('div', 'row'), inp = el('input'), go = el('button', 'primary', cur ? 'Replace' : 'Raise');
      inp.type = 'number'; inp.min = 100; inp.max = 40000; inp.step = 500; inp.value = cur ? Math.round(cur / 500) * 500 || 500 : 8000;
      go.addEventListener('click', () => { app.raiseHorde(Math.max(100, Math.min(40000, +inp.value | 0))); go.blur(); });
      row.append(inp, go); box.append(row); palette.append(box);
      // siege engines are the attackers' vehicles; everything on foot (or paw) is troops
      const engine = (d) => d.role === R.RAM || d.role === R.CATAPULT || d.role === R.TOWER;
      section('Troops', mine.filter((d) => !engine(d)));
      section('Siege engines', mine.filter(engine));
    }
  }
  for (const t of document.querySelectorAll('#teamTabs .tab')) t.addEventListener('click', () => {
    tab = +t.dataset.team;
    for (const q of document.querySelectorAll('#teamTabs .tab')) q.classList.toggle('active', q === t);
    if (app.tool && app.tool.kind === 'place') app.selectPlaceTool(null); else renderPalette();
  });
  const brush = $('brushCount'), chips = $('brushChips');
  const setBrush = (n) => { app.brushCount = Math.max(1, Math.min(5000, n | 0 || 1)); brush.value = app.brushCount; for (const c of chips.children) c.classList.toggle('active', +c.textContent.replace(/,/g, '') === app.brushCount); };
  for (const n of [1, 5, 10, 50, 250, 1000]) { const c = el('button', null, fmt(n)); c.addEventListener('click', () => setBrush(n)); chips.append(c); }
  brush.addEventListener('change', () => setBrush(+brush.value));
  ui.setBrush = setBrush;
  ui.refreshPalette = renderPalette;

  // -------------------------------------------------------------- roster
  const roster = $('roster'), btnAdv = $('btnAdvanced');
  const attackSec = $('attackSec'), attackList = $('attackList');
  btnAdv.addEventListener('click', () => { app.oobOpen = !app.oobOpen; btnAdv.blur(); ui.refreshRoster(); renderPalette(); ui.refreshInspector(); });
  ui.refreshRoster = () => {
    const sandbox = app.isSandbox(), open = sandbox || app.oobOpen;
    ui.refreshBegin();
    // a challenge's order of attack: what comes when (below the order of battle)
    const ws = sandbox ? [] : waveSummary(app.setup.groups, true).filter((w) => w.size > 0);
    attackSec.hidden = ws.length < 2;
    attackList.innerHTML = '';
    for (const w of ws) attackList.append(el('div', 'wrow', `<i>${w.k + 1}</i><div>${w.name}${w.k === 0 ? ' · on the field' : ''}<span>${w.note || 'infantry only'}</span></div><b>${fmt(w.size)}</b>`));
    // in a challenge the order of battle folds away behind Advanced: the garrison is issued ready to fight
    btnAdv.hidden = sandbox;
    btnAdv.setAttribute('aria-expanded', String(open));
    btnAdv.classList.toggle('open', open);
    roster.hidden = !open;
    roster.innerHTML = '';
    if (!open) return;
    for (const team of [DEF, ORC]) {
      const byType = new Map();
      for (const g of app.setup.groups) if (g.team === team) byType.set(g.type, (byType.get(g.type) || 0) + g.count);
      let total = 0; for (const [k, v] of byType) if (UNITS[U[k]].cls !== C.OBST) total += v * strength(UNITS[U[k]]);
      const locked = team === ORC && !sandbox;
      const head = el('div', 'side-head ' + (team === DEF ? 'def' : 'orc'), `<div>${team === DEF ? 'Defenders' : 'Attackers'} <span>· ${fmt(total)}</span></div>`);
      const clr = el('button', null, 'Clear'); clr.addEventListener('click', () => app.clearTeam(team));
      if (byType.size && !locked) head.append(clr);
      roster.append(head);
      if (team === DEF && !sandbox) {
        // what the garrison has cost against what the scenario allows
        const spent = forceCost(app.setup.groups), budget = app.setup.budget, over = spent > budget;
        const req = el('div', 'req' + (over ? ' over' : ''), `<div><span>Requisition</span><b>${fmt(spent)} / ${fmt(budget)} pts</b></div><div class="bar"><i style="width:${Math.min(100, (100 * spent) / Math.max(1, budget))}%"></i></div>${over ? `<small>Over by ${fmt(spent - budget)} pts. Remove units to begin.</small>` : `<small>${spent >= budget ? 'All spent' : `${fmt(budget - spent)} pts left. Unspent points add to your score.`}</small>`}`);
        roster.append(req);
      }
      if (!byType.size) roster.append(el('div', 'empty', team === DEF ? 'No defenders yet. Pick a unit to place.' : 'No attackers yet. Open the Attackers tab.'));
      for (const d of UNITS) {
        if (!byType.has(d.key)) continue;
        const row = el('div', 'rrow ' + (team === DEF ? 'def' : 'orc'));
        const ic = el('div', 'ico'); ic.append(icon(d, 26));
        const inp = el('input'); inp.type = 'number'; inp.min = 0; inp.max = 60000; inp.value = byType.get(d.key);
        inp.addEventListener('change', () => app.setTypeCount(d.key, Math.max(0, +inp.value | 0)));
        const x = el('button', 'x', '✕'); x.title = 'Remove all'; x.addEventListener('click', () => app.setTypeCount(d.key, 0));
        if (locked) { inp.disabled = true; x.style.visibility = 'hidden'; }
        row.append(ic, el('div', null, d.name), inp, x);
        roster.append(row);
      }
    }
  };

  const insp = $('inspector');
  ui.refreshInspector = () => {
    const g = app.selGroup;
    if (!g) { insp.hidden = true; return; }
    insp.hidden = false;
    const d = UNITS[U[g.type]];
    insp.innerHTML = `<div class="sec-head"><h3>Formation</h3><i class="info" tabindex="0">?</i></div><div style="font-weight:700;margin-bottom:6px">${d.name}</div>`;
    bindTip(insp.querySelector('.info'), 'Formation', 'Drag on the map to move. <b>[</b> <b>]</b> rotate, <b>Del</b> deletes.');
    const addNum = (label, val, min, max, fn) => { const r = el('div', 'opt'); const i = el('input'); i.type = 'number'; i.min = min; i.max = max; i.value = val; i.addEventListener('change', () => fn(Math.max(min, Math.min(max, +i.value || 0)))); r.append(el('span', null, label), i); insp.append(r); };
    addNum('Count', g.count, 1, 20000, (v) => app.editGroup(g, { count: v | 0 }));
    if (d.cost && !app.isSandbox() && app.oobOpen) insp.append(el('div', 'opt', `<span>Cost</span><b>${fmt(d.cost * g.count)} pts</b>`));
    if (g.team === ORC) addNum('Advance after (s)', g.delay || 0, 0, 3600, (v) => app.editGroup(g, { delay: v }));
    const btns = el('div', 'btns');
    const mk = (t, fn, cls, title) => { const b = el('button', cls, t); b.title = title; b.addEventListener('click', fn); btns.append(b); };
    mk('<span class="rot">⟲</span>Rotate', () => app.editGroup(g, { ang: g.ang - Math.PI / 12 }), 'rotate', 'Rotate left ([)');
    mk('Rotate<span class="rot">⟳</span>', () => app.editGroup(g, { ang: g.ang + Math.PI / 12 }), 'rotate', 'Rotate right (])');
    mk('Delete', () => app.removeGroup(g), 'danger', 'Delete formation (Del)');
    insp.append(btns);
  };

  // ------------------------------------------------------------- options
  const options = $('options'), supportOpts = $('supportOpts'), winOpts = $('winOpts');
  ui.refreshOptions = () => {
    const o = app.setup.options, sb = !!o.sandbox;
    options.innerHTML = supportOpts.innerHTML = winOpts.innerHTML = '';
    // a challenge's options are part of the scenario and shown for reference; the sandbox's are the player's
    const sel = (box, label, cur, list, fn, tipText) => {
      const r = el('div', 'opt'), s = el('select');
      for (const [v, t] of list) { const op = el('option', null, t); op.value = v; s.append(op); }
      if (!list.some(([v]) => v === cur)) { const op = el('option', null, String(cur)); op.value = cur; s.append(op); }
      s.value = cur; s.disabled = !sb; s.addEventListener('change', () => { fn(+s.value); s.blur(); app.optionsChanged(); });
      r.append(el('span', null, label), s); box.append(r);
      if (tipText) bindTip(r, label, tipText);
    };
    const num = (box, label, val, min, max, fn, tipText) => {
      const r = el('div', 'opt'), i = el('input');
      i.type = 'number'; i.min = min; i.max = max; i.value = val; i.disabled = !sb;
      i.addEventListener('change', () => { const v = Math.max(min, Math.min(max, +i.value | 0)); i.value = v; fn(v); app.optionsChanged(); });
      r.append(el('span', null, label), i); box.append(r);
      if (tipText) bindTip(r, label, tipText);
    };
    // battle options
    sel(options, 'Ammo', o.ammoMult, [[0.5, '50%'], [1, '100%'], [1.5, '150%'], [2, '200%'], [99, 'Unlimited']], (v) => { o.ammoMult = v; }, 'Starting ammo for every defender. Troops with none fight hand to hand.');
    sel(options, 'Morale', o.morale === false ? 0 : 1, [[1, 'On'], [0, 'Off']], (v) => { o.morale = !!v; }, 'Units that take heavy losses quickly rout. Commanders and Uruk captains steady those near them.');
    // support: Command Points in a challenge, a number of calls per kind in the sandbox
    if (sb) for (const k in SUPPORT) num(supportOpts, SUPPORT[k].name, o.support[k], 0, 99, (v) => { o.support[k] = v; }, SUPPORT[k].desc);
    else {
      // the same rows as the sandbox, read-only: the pool, then what each call costs from it
      const cpTip = 'Pay for support calls. They refill slowly; killing captains, trolls and siege engines earns more.';
      num(supportOpts, 'Command points at start', o.cpStart, 0, 99, () => {}, cpTip);
      num(supportOpts, 'Command points per min', Math.round(o.cpRate * 60), 0, 99, () => {}, cpTip);
      for (const k in SUPPORT) num(supportOpts, `${SUPPORT[k].name} cost`, SUPPORT[k].cost, 0, 99, () => {}, `${SUPPORT[k].desc} Costs ${SUPPORT[k].cost} command points.`);
    }
    // win conditions: the defenders win if either is met; they lose if the garrison is wiped out
    sel(winOpts, 'Dawn after', o.dawn, [[0, 'Never'], [480, '8 min'], [600, '10 min'], [720, '12 min'], [900, '15 min'], [1200, '20 min'], [1800, '30 min']], (v) => { o.dawn = v; },
      `Hold out this long to win.${sb ? '' : ' The final wave attacks shortly before dawn.'}`);
    sel(winOpts, 'Horde routs at', o.rout, [[0, 'Never'], [0.01, '1% strength'], [0.05, '5% strength'], [0.08, '8% strength'], [0.15, '15% strength'], [0.25, '25% strength']], (v) => { o.rout = v; }, 'You win when the horde falls to this share of its starting strength. The white mark on the attackers bar shows it.');
  };

  // --------------------------------------------------------- command bar
  const cmdbar = $('cmdbar');
  const cmds = {};
  let group = null;
  const addGroup = (title) => {
    const g = el('div', 'cgroup');
    g.append(el('div', 'cg-label', title));
    group = el('div', 'cg-btns'); g.append(group);
    cmdbar.append(g);
  };
  const addCmd = (id, name, key, svg, title, body, fn) => {
    const b = el('button', 'cmd', `<span class="key">${key}</span><span class="uses"></span>${svg}<span class="name">${name}</span><i class="cool"></i>`);
    b.addEventListener('click', () => { fn(); b.blur(); });
    bindTip(b, `${title} <kbd>${key}</kbd>`, body);
    group.append(b);
    cmds[id] = { b, uses: b.querySelector('.uses'), cool: b.querySelector('.cool') };
  };
  // the purse every challenge support call is paid from (the sandbox counts uses instead)
  const cpBox = el('div', 'cpbox', '<small>Command</small><b id="cpVal">0</b><div class="bar"><i id="cpBar"></i></div><small id="cpRate"></small>');
  bindTip(cpBox, 'Command points', 'Pay for support calls. They refill slowly; killing captains, trolls and siege engines earns more.');
  cmdbar.append(cpBox);
  const supTip = (k) => () => `${SUPPORT[k].desc} <i class="cost">${app.sim && app.sim.opt.sandbox ? `${app.sim.support[k].left} left` : `Costs ${SUPPORT[k].cost} command points`}</i>`;
  const sup = (k) => addCmd(k, SUPPORT[k].name, SUPPORT[k].key, ICONS[k], SUPPORT[k].name, supTip(k), () => app.armSupport(k));
  addGroup('Fire');
  sup('air'); sup('gunship');
  addCmd('fire', 'Target Artillery', 'T', ICONS.fire, 'Target Artillery', 'Aim your mortars and howitzers. Click the map to fire every battery in range. Free.', () => app.toggleFireMission());
  addCmd('focus', 'Focus Fire', 'F', ICONS.focus, 'Focus Fire', 'Drag a circle on the map. Every weapon in range fires there for 30 s.', () => app.armFocus());
  addGroup('Garrison');
  sup('supply'); sup('reinforce');
  addCmd('retreat', 'Fall Back', 'R', ICONS.retreat, 'Fall Back', 'Infantry outside the Hornburg retreat into it. With troops selected, only they retreat; <b>Shift+R</b> always sends everyone.', () => app.retreat(false));
  addGroup('Overlays');
  addCmd('zones', 'Artillery Range', 'Z', ICONS.zones, 'Artillery Range', 'Shows where each battery can fire.', () => app.toggleOverlay('zones'));
  addCmd('ranges', 'Weapon Range', 'V', ICONS.ranges, 'Weapon Range', 'Shows range by weapon, for the selection or the whole garrison. Troops on a wall reach further.', () => app.toggleOverlay('ranges'));
  addCmd('losses', 'Losses', 'L', ICONS.losses, 'Losses', 'Shows where troops on both sides have died.', () => app.toggleLosses());

  // ------------------------------------------------------ artillery panel
  const artyPanel = $('artyPanel'), overlayKey = $('overlayKey');
  let artyRows = null, artyKey = '';
  const MODES = [['free', 'Auto'], ['target', 'Target'], ['hold', 'Hold']];
  const modeSeg = (onPick) => {
    const seg = el('div', 'mseg');
    for (const [m, t] of MODES) { const b = el('button', null, t); b.dataset.mode = m; b.addEventListener('click', () => { onPick(m); b.blur(); }); seg.append(b); }
    return seg;
  };
  const buildArty = (list) => {
    artyPanel.innerHTML = '';
    const head = el('div', 'ap-head', '<b>Artillery</b>');
    const x = el('button', 'x', '✕'); x.title = 'Close (T)'; x.addEventListener('click', () => app.closeArtyPanel()); head.append(x);
    artyPanel.append(head);
    const all = el('div', 'ap-row all');
    all.append(el('div', 'ap-name', '<b>All batteries</b>'), modeSeg((m) => app.artyOrder(null, m)));
    artyPanel.append(all);
    artyRows = list.map((a, k) => {
      const row = el('div', 'ap-row');
      const nm = el('div', 'ap-name', `<i style="background:rgb(${app.artyColor(k)})"></i><b>${a.label}</b><small></small>`);
      const seg = modeSeg((m) => app.artyOrder([a.g], m));
      row.append(nm, seg);
      artyPanel.append(row);
      return { row, info: nm.querySelector('small'), seg, a };
    });
    artyPanel.append(el('p', 'tip', '<b>Target</b> fires where you click the map.'));
  };
  ui.refreshArty = () => {
    const sim = app.sim;
    if (!sim || app.mode !== 'battle' || !app.artyPanel) { artyPanel.hidden = true; return; }
    const list = sim.arty;
    const key = list.map((a) => a.g).join(',');
    if (key !== artyKey || !artyRows) { artyKey = key; buildArty(list); }
    artyPanel.hidden = false;
    const armed = app.tool && app.tool.kind === 'fire' ? app.tool.groups : undefined;
    // what each section is doing, as one choice: a section armed to fire counts as Target
    const modeOf = (a) => (armed !== undefined && (armed === null || armed.includes(a.g)) ? 'target' : a.mode);
    for (const r of artyRows) {
      const a = r.a, dead = !a.n;
      r.row.classList.toggle('dead', dead);
      r.info.textContent = dead ? 'Destroyed' : `${a.n} ${a.n === 1 ? 'gun' : 'guns'} · ${Math.round(a.ammo * 100)}% ammo · ${a.key === 'howitzer' ? 'map-wide' : a.w.range + ' m'}`;
      for (const b of r.seg.children) {
        const m = b.dataset.mode;
        b.classList.toggle('active', !dead && modeOf(a) === m);
        b.disabled = dead;
      }
    }
    const live = list.filter((a) => a.n);
    artyPanel.querySelector('.ap-row.all').querySelectorAll('button').forEach((b) => b.classList.toggle('active', live.length > 0 && live.every((a) => modeOf(a) === b.dataset.mode)));
  };
  ui.setOverlayKey = (items) => {
    if (!items || !items.length) { overlayKey.hidden = true; return; }
    overlayKey.hidden = false;
    overlayKey.innerHTML = items.map(([col, name, val]) => `<div class="ok-row"><i style="background:rgb(${col})"></i><span>${name}</span><b>${val}</b></div>`).join('');
  };

  // ------------------------------------------------------ toasts & hints
  const feed = $('feed'), bannerEl = $('banner'), hintEl = $('hint');
  // a toast that knows where it happened can be clicked to go there, and stays up a little longer
  ui.toast = (text, cls = '', loc = null) => {
    const life = loc ? 12 : 7;
    const t = el('div', 'toast ' + cls + (loc ? ' loc' : ''), text);
    t.style.animationDuration = life + 's';
    if (loc) { t.title = 'Go to location'; t.addEventListener('click', () => app.jumpTo(loc.x, loc.y)); }
    feed.append(t);
    while (feed.children.length > 7) feed.firstChild.remove();
    setTimeout(() => t.remove(), life * 1000);
  };
  ui.banner = (text, cls = '') => { bannerEl.innerHTML = ''; bannerEl.append(el('div', cls, text)); };
  ui.hint = (text) => { if (text) { hintEl.innerHTML = text; hintEl.classList.add('show'); } else hintEl.classList.remove('show'); };
  ui.clearFeed = () => { feed.innerHTML = ''; bannerEl.innerHTML = ''; };

  // ----------------------------------------------------------------- HUD
  const defCount = $('defCount'), orcCount = $('orcCount'), defBar = $('defBar'), orcBar = $('orcBar');
  const pauseBtn = document.querySelector('#speedCtl .seg[data-speed="0"]');
  const PAUSE_SVG = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 2h4v12H3zM9 2h4v12H9z" fill="currentColor"/></svg>';
  const PLAY_SVG = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 2.2v11.6L13.6 8z" fill="currentColor"/></svg>';
  const cpVal = $('cpVal'), cpBar = $('cpBar'), cpRate = $('cpRate');
  const ammoPct = $('ammoPct'), ammoBar = $('ammoBar'), clock = $('clock'), dawn = $('dawn'), selinfo = $('selinfo');
  const grpbar = $('grpbar'); let grpHtml = '';
  grpbar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) app.recallGroup(b.dataset.g); });
  const orcRes = $('orcRes'), orcRout = $('orcRout'), orcLbl = $('orcLbl'), orcForce = $('orcForce');
  const waveBox = $('waveBox'), wavePips = $('wavePips'), waveName = $('waveName'), waveNote = $('waveNote');
  ui.updateHud = () => {
    const sim = app.sim;
    if (!sim) return;
    if (app.mode === 'setup') {
      defCount.textContent = fmt(sim.defCombat); orcCount.textContent = fmt(sim.count[ORC]);
      defBar.style.width = orcBar.style.width = '100%'; orcRes.style.width = '0'; orcRout.hidden = true; orcLbl.textContent = 'Attackers';
      return;
    }
    defCount.textContent = `${fmt(sim.defCombat)} / ${fmt(sim.initial[0])}`;
    orcCount.textContent = `${fmt(sim.count[ORC])} / ${fmt(sim.initial[1])}`;
    defBar.style.width = (100 * sim.defCombat / Math.max(1, sim.initial[0])) + '%';
    // the horde bar shows what is on the field, what is still to come, and the point at which it breaks
    const o0 = Math.max(1, sim.initial[1]), wi = sim.waveInfo(), res = wi ? wi.reserve : 0;
    orcBar.style.width = (100 * (sim.count[ORC] - res) / o0) + '%';
    orcRes.style.width = (100 * res / o0) + '%';
    orcRout.hidden = !(sim.opt.rout > 0); orcRout.style.left = (100 * sim.opt.rout) + '%';
    orcLbl.textContent = res > 0 ? `Attackers · ${fmt(res)} to come` : 'Attackers';
    orcForce.title = sim.opt.rout > 0 ? `The horde routs at ${Math.round(sim.opt.rout * 100)}% strength (white mark)` : '';
    waveBox.hidden = !wi || !!sim.result;
    if (wi) {
      if (wavePips.children.length !== wi.W) { wavePips.innerHTML = ''; for (let k = 0; k < wi.W; k++) wavePips.append(el('i')); }
      for (let k = 0; k < wi.W; k++) wavePips.children[k].className = k < wi.k ? 'done' : k === wi.k ? 'now' : k === wi.k + 1 && wi.next && wi.next.forming ? 'soon' : '';
      const nx = wi.next;
      waveName.textContent = `Wave ${wi.k + 1} of ${wi.W} · ${wi.name}`;
      waveNote.textContent = sim.result ? '' : nx ? `Next wave in ${mmss(nx.in)}` : 'Final wave';
      waveBox.classList.toggle('lull', wi.phase === 'lull' && !(nx && nx.forming));
      waveBox.classList.toggle('hot', wi.phase === 'engaged');
    }
    const am = sim.ammoLevel();
    ammoPct.textContent = sim.opt.ammoMult > 50 ? '∞' : Math.round(am * 100) + '%';
    ammoBar.style.width = (am * 100) + '%';
    ammoPct.parentElement.classList.toggle('low', am < 0.3 && sim.opt.ammoMult <= 50);
    $('btnResult').hidden = !sim.result;
    btnBack.textContent = sim.result ? 'Back to setup' : 'End battle';
    clock.textContent = mmss(sim.time);
    dawn.textContent = sim.opt.dawn > 0 ? `Dawn in ${mmss(sim.opt.dawn - sim.time)}` : '';
    for (const b of document.querySelectorAll('#speedCtl .seg')) { const s = +b.dataset.speed; b.classList.toggle('active', app.paused ? s === 0 : s === app.speed); }
    // the pause button turns into a play button while the battle is paused
    if (pauseBtn.dataset.state !== String(app.paused)) {
      pauseBtn.dataset.state = String(app.paused);
      pauseBtn.innerHTML = app.paused ? PLAY_SVG : PAUSE_SVG;
      pauseBtn.title = app.paused ? 'Resume (Space)' : 'Pause (Space)';
    }
    const sb = !!sim.opt.sandbox;
    cpBox.hidden = sb;
    cmdbar.classList.toggle('sandbox', sb);
    if (!sb) {
      cpVal.textContent = Math.floor(sim.cp + 1e-6);
      cpBar.style.width = (100 * (sim.cp - Math.floor(sim.cp + 1e-6))) + '%';
      cpRate.textContent = sim.cp >= sim.opt.cpCap ? 'Full' : `+${Math.round(sim.opt.cpRate * 60)} / min`;
    }
    for (const k in SUPPORT) {
      const s = sim.support[k], c = cmds[k], can = sim.affordSupport(k);
      c.uses.textContent = sb ? s.left : s.cost;
      const cd = Math.max(0, s.ready - sim.time);
      c.cool.style.height = can ? (100 * cd / s.cd) + '%' : '0';
      c.b.classList.toggle('spent', !can);
      c.b.classList.toggle('cooling', cd > 0 && can);
      c.b.classList.toggle('armed', !!app.tool && app.tool.kind === 'support' && app.tool.name === k);
    }
    cmds.focus.b.classList.toggle('armed', !!app.tool && app.tool.kind === 'focus');
    cmds.focus.b.classList.toggle('on', !!sim.focus);
    cmds.focus.b.querySelector('.name').textContent = sim.focus ? 'Cancel Focus' : 'Focus Fire';
    const missions = sim.arty.some((a) => a.n && a.mode === 'target');
    cmds.fire.b.classList.toggle('armed', !!app.tool && app.tool.kind === 'fire');
    cmds.fire.b.classList.toggle('on', missions && !(app.tool && app.tool.kind === 'fire'));
    cmds.fire.b.classList.toggle('spent', !sim.arty.some((a) => a.n));
    cmds.losses.b.classList.toggle('armed', !!app.showLosses);
    cmds.zones.b.classList.toggle('armed', !!app.overlay.zones);
    cmds.ranges.b.classList.toggle('armed', !!app.overlay.ranges);
    ui.refreshArty();
    // control groups
    let gh = '';
    for (const key of ['6', '7', '8', '9', '0']) { const n = app.groupCount(key); if (n) gh += `<button data-g="${key}"><kbd>${key}</kbd>${fmt(n)}</button>`; }
    if (gh !== grpHtml) { grpHtml = gh; grpbar.innerHTML = gh; grpbar.hidden = !gh; }
    // selection summary
    const sel = app.selection;
    if (!sel.length) { selinfo.hidden = true; return; }
    const by = new Map(), reach = new Set(); let am2 = 0, an = 0, hp = 0, mo = 0;
    for (const i of sel) { const d = UNITS[sim.type[i]]; by.set(d.name, (by.get(d.name) || 0) + 1); const r = reachOf(d); reach.add(r ? r.text : '—'); if (d.ammo) { am2 += Math.min(1, sim.ammo[i] / sim.maxAmmo(i)); an++; } hp += sim.hp[i] / d.hp; mo += sim.gMorale[sim.grp[i]]; }
    let html = `<b>${fmt(sel.length)} selected</b>`;
    for (const [n, c] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 5)) html += `<div class="line"><span>${n}</span><span>${fmt(c)}</span></div>`;
    html += `<div class="line"><span>Ammo</span><span>${an ? Math.round(100 * am2 / an) + '%' : '—'}</span></div><div class="line"><span>Health</span><span>${Math.round(100 * hp / sel.length)}%</span></div><div class="line"><span>Morale</span><span>${Math.round(mo / sel.length)}%</span></div><div class="line"><span>Range</span><span>${reach.size === 1 ? [...reach][0] : 'Mixed'}</span></div>`;
    const st = sim.holdR[sel[0]], mixed = sel.some((i) => sim.holdR[i] !== st);
    html += `<div class="line"><span>Fire mode</span><span class="${st && !mixed ? 'held' : ''}">${mixed ? 'Mixed' : app.stanceName(st)}</span></div>`;
    html += '<p class="tip"><b>Right-click</b> move · <b>H</b> fire mode · <b>R</b> fall back · <b>X</b> halt</p>';
    selinfo.innerHTML = html; selinfo.hidden = false;
  };

  // -------------------------------------------------------------- dialogs
  const modal = $('modal');
  let onModalClose = null;
  ui.hideModal = () => { modal.hidden = true; modal.innerHTML = ''; const f = onModalClose; onModalClose = null; if (f) f(); };
  ui.modalOpen = () => !modal.hidden;
  modal.addEventListener('mousedown', (e) => { if (e.target === modal && modal.dataset.dismiss === '1') ui.hideModal(); });

  // How to play: a fixed header (tabs and a close button) over a scrolling body, one tab at a time
  const k = (...keys) => keys.map((q) => `<kbd>${q}</kbd>`).join(' ');
  const rows = (list) => `<div class="keys">${list.map(([a, b]) => `<div>${a}</div><span>${b}</span>`).join('')}</div>`;
  const HELP = [
    ['basics', 'Basics', `
      <h4>Modes</h4>${rows([
        ['Challenge', 'A set scenario. Attackers come in waves, the garrison has a budget, and support costs command points. Scored.'],
        ['Sandbox', 'Build both armies and set the rules. Every attacker starts on the map. Not scored.'],
      ])}
      <h4>Winning</h4>${rows([
        ['Victory', 'Hold until dawn, or rout the horde: it flees when its bar drops to the white mark.'],
        ['Defeat', 'The garrison is wiped out.'],
      ])}
      <h4>Challenges</h4>${rows([
        ['Waves', 'The top bar counts down to the next wave. Destroy a wave quickly to earn a pause before the next.'],
        ['Command points', 'Pay for support calls. They refill slowly; killing captains, trolls and siege engines earns more.'],
        ['Score', 'Points for winning, surviving defenders, an intact gate and wall, and unspent requisition.'],
      ])}`],
    ['controls', 'Controls', `
      <h4>Setup</h4>${rows([
        [k('Click'), 'Place a block of the chosen unit. The dashed ring shows its range'],
        [k('Drag'), `Draw a line. On a wall, troops line the parapet; hold ${k('Alt')} to place freely`],
        [k('Click formation'), `Select it. Drag to move, ${k('[', ']')} to rotate, ${k('Del')} to delete`],
        [k('Enter'), 'Begin the battle'],
      ])}
      <h4>Orders</h4>${rows([
        [`${k('Drag')} · ${k('Double-click')}`, 'Select troops · select every unit of that type in view'],
        [`${k('Right-click')} · ${k('X')}`, 'Move · halt'],
        [k('H'), 'Fire mode: at will, hold to 150 m, hold to 75 m, hold fire. Closer shots hit more often and save ammo'],
        [`${k('R')} · ${k('Shift+R')}`, 'Selected troops fall back to the Hornburg · everyone falls back'],
        [`${k('Shift+6')}…${k('0')}`, 'Set a control group. Press its number to select it, twice to jump to it'],
      ])}
      <h4>Support</h4>${rows([
        [`${k('1')}–${k('4')}`, 'Call support, then click a target'],
        [k('T'), 'Target Artillery: aim your mortars and howitzers'],
        [k('F'), 'Focus Fire: drag a circle; every weapon in range fires there'],
        [`${k('Z')} · ${k('V')} · ${k('L')}`, 'Overlays: artillery range · weapon range · losses'],
      ])}
      <h4>Time and camera</h4>${rows([
        [`${k('Space')} ${k('−')} ${k('+')}`, 'Pause · slower · faster'],
        [k('Scroll'), 'Zoom'],
        [`${k('Right-drag')} ${k('W A S D')}`, 'Pan'],
        [`${k('Middle-drag')} ${k('Q')} ${k('E')}`, `Rotate. Drag up or down, or ${k('PgUp')} ${k('PgDn')}, to tilt`],
        [k('Home'), 'Reset the view'],
        [k('G'), 'Jump to the latest alert; press again for earlier ones'],
        [k('F2'), 'Performance overlay'],
      ])}`],
    ['tips', 'Tips', `${rows([
        ['Ammo', 'Troops re-arm within 60 m of an ammo cache or crate. An amber pip marks a soldier with no ammo.'],
        ['Lines of fire', 'Only two ranks can fire from a wall, three on open ground. Spread troops out instead of packing them in.'],
        ['Dead ground', 'Troops on a wall can barely hit attackers at its foot. Grenades and guns on the Hornburg can.'],
        ['The postern', 'The gate behind the Hornburg is weak. If the Deeping Wall falls, the horde reaches it through the Deep.'],
        ['The wall door', 'Where the wall joins the Hornburg, a door leads into the court. Attackers holding that end of the wall can break it down.'],
        ['Pinned ▼', 'Machine guns and shellfire pin companies: they slow down and stop shooting. Crossbows and catapults pin your platoons the same way.'],
        ['Shield wall ▣', 'Within small-arms range, Uruk-hai lock shields that stop most bullets from the front. Use explosives or flanking fire.'],
        ['Captains ★', 'Companies near a captain rarely rout, and nearby troops absorb shots aimed at the captain. Thin the escort, then use Focus Fire.'],
        ['Siege engines', 'Small arms hurt only the crews of ladders, rams and towers. Troops at the top of a ladder throw it down once it is clear.'],
        ['Warg riders', 'They wait out of range for a breach and attack troops caught outside the walls. Shortly before dawn, the whole horde attacks at once.'],
      ])}`],
    ['enemy', 'Enemy', `${rows(UNITS.filter((d) => d.team === ORC && d.note).map((d) => [d.name, `${d.note}<br><i>Counter:</i> ${d.counter}`]))}`],
  ];
  let helpTab = 'basics';
  ui.showHelp = () => {
    onModalClose = null;
    modal.dataset.dismiss = '1';
    modal.hidden = false;
    modal.innerHTML = `<div class="dialog help" role="dialog" aria-label="How to play">
      <div class="help-head"><div class="help-title"><h1>How to play</h1><button class="x" id="mClose" title="Close (Esc)" aria-label="Close">✕</button></div>
      <div class="help-tabs" role="tablist">${HELP.map(([key, name]) => `<button role="tab" data-tab="${key}">${name}</button>`).join('')}</div></div>
      <div class="help-body"></div></div>`;
    const body = modal.querySelector('.help-body'), tabs = modal.querySelectorAll('.help-tabs button');
    const show = (key) => {
      helpTab = key; body.innerHTML = HELP.find((h) => h[0] === key)[2]; body.scrollTop = 0;
      for (const t of tabs) { const on = t.dataset.tab === key; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); }
    };
    for (const t of tabs) t.addEventListener('click', () => { show(t.dataset.tab); t.blur(); });
    show(helpTab);
    $('mClose').addEventListener('click', ui.hideModal);
  };

  /** The first thing on screen: what this is, and the two ways to play it. */
  ui.showWelcome = () => {
    modal.dataset.dismiss = '0';
    modal.hidden = false;
    modal.innerHTML = `<div class="dialog welcome">
      <div class="wl-brand"><svg viewBox="0 0 32 32" width="46" height="46" aria-hidden="true"><path d="M5 26V12l5-4 2 4h8l2-4 5 4v14h-8v-6a3 3 0 0 0-6 0v6z" fill="currentColor"/></svg><div><h1>Helm’s Deep</h1><small>Modern Defense Simulator</small></div></div>
      <p class="lead">A modern garrison defends the Hornburg and the Deeping Wall against a horde of Uruk-hai. Place your troops, then command the defence in real time.</p>
      <div class="wl-modes">
        <button class="wl-mode primary-mode" id="wlSandbox"><b>Sandbox</b><span>Build both armies and set the rules. Not scored.</span><em>Start building →</em></button>
        <button class="wl-mode" id="wlChallenge"><b>Challenge</b><span>Hold a set scenario until dawn, on a budget. Scored, with medals.</span><em>Take command →</em></button>
      </div>
      <div class="wl-foot"><button class="link" id="wlHelp">How to play</button></div></div>`;
    const go = (mode) => { onModalClose = null; ui.hideModal(); app.enterMode(mode); };
    onModalClose = () => app.enterMode('sandbox'); // Esc: the default, the sandbox
    $('wlSandbox').addEventListener('click', () => go('sandbox'));
    $('wlChallenge').addEventListener('click', () => go('challenge'));
    $('wlSandbox').focus({ preventScroll: true }); // Enter or Space takes the default
    $('wlHelp').addEventListener('click', () => { onModalClose = null; ui.showHelp(); onModalClose = () => ui.showWelcome(); });
  };

  // ------------------------------------------------------------ coach mark
  // A light, see-through pointer at the scenario picker the first time each mode is entered.
  const coach = $('coach'), coachSpot = coach.querySelector('.spot'), coachCard = coach.querySelector('.coach-card'), coachBody = coach.querySelector('.coach-body');
  const coached = new Set();
  const placeCoach = () => {
    if (coach.hidden) return;
    const r = $('presetBox').getBoundingClientRect(), pad = 6;
    Object.assign(coachSpot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    const cw = coachCard.offsetWidth, x = Math.max(12, Math.min(innerWidth - cw - 12, r.left + r.width / 2 - 60));
    coachCard.style.left = x + 'px'; coachCard.style.top = r.bottom + 18 + 'px';
    coachCard.querySelector('.arrow').style.left = Math.max(14, Math.min(cw - 28, r.left + r.width / 2 - x - 9)) + 'px';
  };
  ui.coach = (kind) => {
    if (coached.has(kind)) return;
    coached.add(kind);
    coachBody.innerHTML = kind === 'sandbox'
      ? '<b>Both armies are yours to edit</b><p>Pick a scenario here to load its armies, or <b>Blank Map</b> to start empty.</p>'
      : '<b>The garrison is ready</b><p>Press <b>Begin battle</b>, or pick another scenario here.</p>';
    coach.hidden = false;
    placeCoach();
  };
  ui.hideCoach = () => { coach.hidden = true; };
  $('coachOk').addEventListener('click', ui.hideCoach);
  // a click anywhere else also puts it away (and still does whatever it was aimed at)
  window.addEventListener('pointerdown', (e) => { if (!coach.hidden && !(e.target instanceof Node && coachCard.contains(e.target))) ui.hideCoach(); }, true);
  window.addEventListener('resize', placeCoach);

  // --------------------------------------------------------------- settings
  const menu = $('settingsMenu'), btnSettings = $('btnSettings');
  const QUALITY = [['auto', 'Auto', ''], ['low', 'Low', 'Fastest. No anti-aliasing, glow or HDR'], ['medium', 'Medium', 'Light anti-aliasing, glow and HDR'],
    ['high', 'High', 'Full anti-aliasing and resolution'], ['ultra', 'Ultra', 'High, with detailed soldiers at any distance']];
  const renderSettings = () => {
    const cur = app.settings.quality, now = app.gfx.level, fixed = !app.gfx.auto && cur === 'auto'; // (fixed: a test address is holding the quality)
    menu.innerHTML = '<h3>Settings</h3>';
    const nowName = QUALITY.find((q) => q[0] === now)[1];
    const r = el('div', 'set-row'), lab = el('div', null, `<b>Graphics quality</b><span>${cur === 'auto' && !fixed ? `Auto adjusts to keep the frame rate smooth. Now: ${nowName}.` : 'Higher is sharper but slower.'}</span>`);
    const seg = el('div', 'set-seg');
    for (const [v, t, tip] of QUALITY) {
      const b = el('button', v === cur ? 'active' : '', t);
      if (tip) b.title = tip;
      b.addEventListener('click', () => { app.setSetting('quality', v); renderSettings(); });
      seg.append(b);
    }
    r.append(lab, seg); menu.append(r);
    // the sandbox's dice; a challenge always plays with its own
    const r2 = el('div', 'set-row set-inline'), inp = el('input');
    inp.type = 'number'; inp.min = 1; inp.max = 9999; inp.value = app.settings.seed;
    inp.addEventListener('change', () => { const v = Math.max(1, Math.min(9999, +inp.value | 0 || 1)); inp.value = v; app.setSetting('seed', v); });
    r2.append(el('div', null, '<b>Random seed</b><span>Sandbox only. The same seed, setup and orders replay the same battle.</span>'), inp);
    menu.append(r2);
  };
  /** Auto has moved to another level: show it, if the menu is open. */
  ui.refreshSettings = () => { if (!menu.hidden) renderSettings(); };
  ui.toggleSettings = (on = menu.hidden) => {
    if (!on) { menu.hidden = true; btnSettings.classList.remove('open'); return; }
    renderSettings();
    menu.hidden = false; btnSettings.classList.add('open');
    const b = btnSettings.getBoundingClientRect();
    menu.style.top = b.bottom + 10 + 'px';
    menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, b.right - menu.offsetWidth + 40)) + 'px';
  };
  window.addEventListener('pointerdown', (e) => { const t = e.target instanceof Node ? e.target : null; if (!menu.hidden && !(t && (menu.contains(t) || btnSettings.contains(t)))) ui.toggleSettings(false); }, true);

  /** Close any open popover; true if one was open. */
  ui.closePopups = () => { const was = !menu.hidden || !coach.hidden; ui.toggleSettings(false); ui.hideCoach(); return was; };

  ui.showEnd = (sim) => {
    const r = sim.result, st = sim.stats;
    onModalClose = null;
    modal.dataset.dismiss = '0';
    const kills = Object.entries(st.kills).filter(([k]) => k !== 'other').sort((a, b) => b[1] - a[1]);
    const totalK = kills.reduce((a, b) => a + b[1], 0) + (st.kills.other || 0);
    const maxK = Math.max(1, ...kills.map((k) => k[1]));
    const lost = Object.entries(st.lostDef).sort((a, b) => b[1] - a[1]);
    const totalL = lost.reduce((a, b) => a + b[1], 0);
    const maxL = Math.max(1, ...lost.map((k) => k[1]));
    const wname = (k) => (WEAPONS[k] ? WEAPONS[k].name : k);
    const sc = app.lastScore;
    const scoreHtml = !sc ? (sim.opt.sandbox ? '<p class="unscored">Sandbox battles are not scored.</p>' : '') : `<div class="scorebox${sc.medal ? ' ' + sc.medal.key : ''}">
        <div class="total"><small>Score</small><b>${fmt(sc.total)}</b>${sc.medal ? `<span class="medal">★ ${sc.medal.name}</span>` : ''}<em>${sc.newBest ? 'New best' : sc.best != null ? `Best ${fmt(sc.best)}` : ''}</em></div>
        <div class="lines">${sc.lines.map(([l, p, dt]) => `<div class="${p ? '' : 'zero'}"><span>${l}${dt ? ` <i>${dt}</i>` : ''}</span><b>${p ? '+' + fmt(p) : '—'}</b></div>`).join('')}</div></div>`;
    modal.hidden = false;
    modal.innerHTML = `<div class="dialog">
      <h1 class="${r.win ? 'win' : 'lose'}">${r.win ? 'Victory' : 'Defeat'}</h1>
      <p class="sub">${r.reason}</p>
      ${scoreHtml}
      <div class="stats">
        <div class="stat"><small>Duration</small><b>${mmss(r.time)}</b></div>
        <div class="stat"><small>Attackers killed</small><b>${fmt(totalK)}</b></div>
        <div class="stat"><small>Attackers routed</small><b>${fmt(st.fled)}</b></div>
        <div class="stat"><small>Defenders lost</small><b>${fmt(totalL)} <span style="font-size:12px;color:var(--dim)">/ ${fmt(sim.initial[0])}</span></b></div>
      </div>
      <div class="cols">
        <div><h3>Kills by weapon</h3>${kills.slice(0, 11).map(([k, v]) => `<div class="krow"><span>${wname(k)}</span><div class="kb"><i style="width:${(100 * v) / maxK}%"></i></div><span>${fmt(v)}</span></div>`).join('') || '<div class="empty">None</div>'}</div>
        <div><h3>Defender losses</h3>${lost.slice(0, 9).map(([k, v]) => `<div class="krow loss"><span>${UNITS[U[k]].name}</span><div class="kb"><i style="width:${(100 * v) / maxL}%"></i></div><span>${fmt(v)}</span></div>`).join('') || '<div class="empty">None</div>'}
        <h3 style="margin-top:14px">Battle</h3><div class="krow"><span>Wall breaches</span><div></div><span>${st.breaches}</span></div><div class="krow"><span>Companies routed</span><div></div><span>${st.routs}</span></div><div class="krow"><span>Rounds fired</span><div></div><span>${fmt(st.shots)}</span></div><div class="krow"><span>Kill ratio</span><div></div><span>${totalL ? (totalK / totalL).toFixed(1) + ' : 1' : '—'}</span></div></div>
      </div>
      <div class="actions"><button id="mView">View battlefield</button><button id="mEdit">Back to setup</button><button class="primary" id="mAgain">Fight again</button></div></div>`;
    $('mView').addEventListener('click', () => { ui.hideModal(); app.showLosses = true; });
    $('mEdit').addEventListener('click', () => { ui.hideModal(); app.backToSetup(); });
    $('mAgain').addEventListener('click', () => { ui.hideModal(); app.startBattle(); });
  };

  ui.setMode = (mode) => {
    document.getElementById('app').className = mode === 'setup' ? 'mode-setup' : 'mode-battle';
    tip.hidden = true;
    ui.hideCoach(); // it points at the scenario picker, which a battle hides
  };

  renderPalette(); setBrush(50);
  return ui;
}
