// DOM user interface: setup panels, battle HUD, toasts and dialogs.

import { UNITS, U, DEF, ORC, SUPPORT, WEAPONS, C } from '../config.js';
import { PRESETS, waveSummary, forceCost } from '../scenarios.js';
import { makeIcon } from '../render/atlas.js';

const $ = (id) => document.getElementById(id);
export const fmt = (n) => Math.round(n).toLocaleString('en-US');
const mmss = (s) => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  air: I('<path d="M12 2.5l1.6 6.5 7.9 4.2v1.8l-7.9-2.2-.5 5 2.4 1.8v1.4L12 20l-3.500 1v-1.400l2.400-1.800-.5-5-7.900 2.200v-1.800L10.400 9z" fill="currentColor" stroke="none"/>'),
  gunship: I('<path d="M3 5.500h16M11 5.500v3"/><path d="M5 12.500c0-2.200 2.300-4 6-4s7.500 1.600 9 5l-2.200 1.800H9l-2-2.800z" fill="currentColor" stroke="none"/><path d="M7 13H2.500l-.5-3M9 18.500h9M11 15.300v3.200M15 15.300v3.200"/>'),
  arty: I('<circle cx="12" cy="12" r="7.500"/><path d="M12 1.500v6M12 16.500v6M1.500 12h6M16.500 12h6"/><circle cx="12" cy="12" r="1.600" fill="currentColor"/>'),
  supply: I('<path d="M4 8.500a8 8 0 0116 0z" fill="currentColor" stroke="none"/><path d="M4 8.500l6 7M20 8.500l-6 7M12 8.500v7"/><rect x="8.500" y="15.500" width="7" height="6" rx="1" fill="currentColor" stroke="none"/>'),
  reinforce: I('<circle cx="6" cy="8" r="2.200" fill="currentColor" stroke="none"/><circle cx="12" cy="6.500" r="2.400" fill="currentColor" stroke="none"/><circle cx="18" cy="8" r="2.200" fill="currentColor" stroke="none"/><path d="M2.500 19c0-4 1.500-6.500 3.500-6.500s2.300 1.200 2.800 2.500M21.500 19c0-4-1.500-6.500-3.500-6.500s-2.300 1.200-2.800 2.500M7.500 20.500c0-5.500 2-8.500 4.500-8.500s4.500 3 4.500 8.500"/>'),
  focus: I('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="3.200"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>'),
  fire: I('<path d="M5 20.500l3.500-12.500 3 .8-3.500 12.500z" fill="currentColor" stroke="none"/><path d="M3 21h8"/><circle cx="17" cy="7" r="4.200"/><path d="M17 1.500v3M17 9.500v3M11.500 7h3M19.500 7h3"/>'),
  zones: I('<path d="M3 19a9 9 0 0118 0"/><path d="M7 19a5 5 0 0110 0" stroke-dasharray="2 2"/><circle cx="12" cy="19" r="1.400" fill="currentColor"/>'),
  ranges: I('<path d="M12 20L4.500 7.500A13 13 0 0119.500 7.500z" fill="currentColor" fill-opacity=".22"/><path d="M12 20L4.500 7.500A13 13 0 0119.500 7.500z"/><circle cx="12" cy="20" r="1.400" fill="currentColor"/>'),
  retreat: I('<path d="M11 21V9.500l2-1.500 1.200 1.500h3.600L19 8l2 1.500V21h-3.500v-3.500a1.500 1.500 0 00-3 0V21z" fill="currentColor" stroke="none"/><path d="M2.500 14h6M6 11l3 3-3 3"/>'),
  losses: I('<path d="M12 3v18M7 8h10" /><circle cx="6" cy="17" r="1.300" fill="currentColor"/><circle cx="18" cy="16" r="1.300" fill="currentColor"/><circle cx="16.500" cy="20" r="1.300" fill="currentColor"/><circle cx="8" cy="20.500" r="1.300" fill="currentColor"/>'),
};

export function buildUI(app, atlas) {
  const ui = {};
  const icon = (d, px) => makeIcon(atlas, d.spr, px, d.turret ?? -1);
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
   * and score won on it; the sandbox starts from a blank map and offers the scenarios to autofill it.
   */
  ui.refreshPresetList = () => {
    const sb = app.isSandbox(), cur = preset.value;
    preset.innerHTML = '';
    const blank = PRESETS.find((p) => p.key === 'empty'), rest = PRESETS.filter((p) => p !== blank);
    for (const p of sb ? [blank, ...rest] : rest) {
      const b = !sb && bestScores[p.key];
      const o = el('option', null, p.name + (b ? `   ${b.medal ? '★ ' : ''}${b.score}` : ''));
      o.value = p.key; preset.append(o);
    }
    preset.value = cur;
    preset.title = sb ? 'Autofill the map with a scenario\'s armies' : 'Choose the challenge';
    for (const b of modeSw.children) b.classList.toggle('active', app.modeChosen && (b.dataset.mode === 'sandbox') === sb);
  };
  ui.refreshPresets = (best) => { bestScores = best; ui.refreshPresetList(); };
  preset.addEventListener('change', () => { ui.hideCoach(); app.loadPreset(preset.value); preset.blur(); });
  ui.setPreset = (k) => { preset.value = k; };
  for (const b of modeSw.children) {
    const sb = b.dataset.mode === 'sandbox';
    b.addEventListener('click', () => { if (!app.modeChosen || sb !== app.isSandbox()) app.enterMode(b.dataset.mode); b.blur(); });
    bindTip(b, sb ? 'Sandbox' : 'Challenge', sb
      ? 'Build both armies freely on a blank map, or autofill it from a scenario. No budget and no waves: the whole horde is on the field, and you choose the win conditions. Not scored.'
      : 'Play a scenario as designed: hold the Deep until dawn against a horde that comes in waves, with the garrison you can field on its requisition. Scored, with medals.');
  }
  const btnBegin = $('btnBegin');
  btnBegin.addEventListener('click', () => app.startBattle());
  /** A challenge cannot begin while the garrison costs more than its requisition. */
  ui.refreshBegin = () => {
    const over = !app.isSandbox() ? forceCost(app.setup.groups) - app.setup.budget : 0;
    btnBegin.disabled = over > 0;
    btnBegin.title = over > 0 ? `The garrison is ${fmt(over)} requisition points over budget — open Advanced under Order of Battle to trim it` : 'Begin the battle (Enter)';
  };
  $('btnBack').addEventListener('click', () => app.backToSetup());
  $('btnResult').addEventListener('click', () => { if (app.sim && app.sim.result) ui.showEnd(app.sim); });
  $('btnHelp').addEventListener('click', () => { ui.closePopups(); ui.showHelp(); });
  $('btnSettings').addEventListener('click', (e) => { e.stopPropagation(); ui.toggleSettings(); $('btnSettings').blur(); });
  $('btnSound').addEventListener('click', () => { const m = app.toggleMute(); $('btnSound').classList.toggle('off', m); });
  for (const b of document.querySelectorAll('#speedCtl .seg')) b.addEventListener('click', () => { app.setSpeed(+b.dataset.speed); b.blur(); });
  $('btnSkip').addEventListener('click', () => { app.skipAhead(); $('btnSkip').blur(); });

  // ---------------------------------------------------- palette & brush
  const palette = $('palette');
  function renderPalette() {
    palette.innerHTML = '';
    const sandbox = !app.setup || app.isSandbox();
    if (tab === ORC && !sandbox) {
      // in a challenge the enemy is what it is
      const box = el('div', 'locked', '<b>The enemy is fixed in a challenge.</b><span>The horde\'s order of battle and the battle options are part of the scenario. Switch to Sandbox to build both armies freely — sandbox battles are not scored.</span>');
      const b = el('button', null, 'Switch to Sandbox'); b.addEventListener('click', () => app.enterMode('sandbox'));
      box.append(b); palette.append(box);
      return;
    }
    const showCost = !sandbox && app.oobOpen; // requisition points only once the order of battle is opened up
    const card = (d) => {
      const b = el('button', 'card ' + (d.team === DEF ? 'def' : 'orc') + (app.tool && app.tool.kind === 'place' && app.tool.type === d.key ? ' active' : ''));
      const ic = el('div', 'ico'); ic.append(icon(d, 44));
      b.append(ic, el('div', null, `<b>${d.name}${d.cost && showCost ? `<em title="Requisition points each">${d.cost} pts</em>` : ''}</b><span>${d.desc}</span>`));
      b.addEventListener('click', () => { app.selectPlaceTool(app.tool && app.tool.type === d.key ? null : d.key); b.blur(); });
      palette.append(b);
    };
    const mine = UNITS.filter((d) => d.team === tab && !d.hidden);
    if (tab === DEF) {
      palette.append(el('div', 'pal-head', 'Troops &amp; vehicles'));
      mine.filter((d) => d.cls !== C.OBST).forEach(card);
      palette.append(el('div', 'pal-head', 'Field works'));
      mine.filter((d) => d.cls === C.OBST).forEach(card);
    } else {
      // a whole host in waves, without laying out each one by hand
      const cur = app.setup.groups.filter((g) => g.team === ORC && g.phase != null).reduce((a, g) => a + g.count * (1 + (UNITS[U[g.type]].carry || 0)), 0);
      const box = el('div', 'raise', `<b>Raise a horde</b><span>A full host with its ladders, engines and captains, drawn up in the valley and advancing together when the battle begins. ${cur ? `Replaces the ${fmt(cur)} raised now; formations you placed yourself stay.` : 'Formations you place yourself go on the field as placed.'}</span>`);
      const row = el('div', 'row'), inp = el('input'), go = el('button', 'primary', cur ? 'Replace' : 'Raise');
      inp.type = 'number'; inp.min = 100; inp.max = 40000; inp.step = 500; inp.value = cur ? Math.round(cur / 500) * 500 || 500 : 8000;
      go.addEventListener('click', () => { app.raiseHorde(Math.max(100, Math.min(40000, +inp.value | 0))); go.blur(); });
      row.append(inp, go); box.append(row); palette.append(box);
      palette.append(el('div', 'pal-head', 'Or place formations by hand'));
      mine.forEach(card);
    }
  }
  for (const t of document.querySelectorAll('#teamTabs .tab')) t.addEventListener('click', () => {
    tab = +t.dataset.team;
    for (const q of document.querySelectorAll('#teamTabs .tab')) q.classList.toggle('active', q === t);
    if (app.tool && app.tool.kind === 'place') app.selectPlaceTool(null); else renderPalette();
  });
  const brush = $('brushCount'), chips = $('brushChips');
  const setBrush = (n) => { app.brushCount = Math.max(1, Math.min(5000, n | 0 || 1)); brush.value = app.brushCount; for (const c of chips.children) c.classList.toggle('active', +c.textContent.replace(/,/g, '') === app.brushCount); };
  for (const n of [1, 10, 50, 250, 1000]) { const c = el('button', null, fmt(n)); c.addEventListener('click', () => setBrush(n)); chips.append(c); }
  brush.addEventListener('change', () => setBrush(+brush.value));
  ui.setBrush = setBrush;
  ui.refreshPalette = renderPalette;

  // -------------------------------------------------------------- roster
  const roster = $('roster'), oobNote = $('oobNote'), btnAdv = $('btnAdvanced');
  const attackSec = $('attackSec'), attackList = $('attackList');
  btnAdv.addEventListener('click', () => { app.oobOpen = !app.oobOpen; btnAdv.blur(); ui.refreshRoster(); renderPalette(); ui.refreshInspector(); });
  ui.refreshRoster = () => {
    const sandbox = app.isSandbox(), open = sandbox || app.oobOpen;
    ui.refreshBegin();
    // a challenge's order of attack: what comes when (below the order of battle)
    const ws = sandbox ? [] : waveSummary(app.setup.groups).filter((w) => w.size > 0);
    attackSec.hidden = ws.length < 2;
    attackList.innerHTML = '';
    for (const w of ws) attackList.append(el('div', 'wrow', `<i>${w.k + 1}</i><div>${w.name}${w.k === 0 ? ' — on the field' : ''}<span>${w.note || 'infantry'}</span></div><b>${fmt(w.size)}</b>`));
    // in a challenge the order of battle folds away behind Advanced: the garrison is issued ready to fight
    btnAdv.hidden = sandbox;
    btnAdv.setAttribute('aria-expanded', String(open));
    btnAdv.classList.toggle('open', open);
    oobNote.hidden = open;
    oobNote.innerHTML = 'The garrison is issued at its full requisition, open <b>Advanced</b> to make adjustments.';
    roster.hidden = !open;
    roster.innerHTML = '';
    if (!open) return;
    for (const team of [DEF, ORC]) {
      const byType = new Map();
      for (const g of app.setup.groups) if (g.team === team) byType.set(g.type, (byType.get(g.type) || 0) + g.count);
      let total = 0; for (const [k, v] of byType) if (UNITS[U[k]].cls !== C.OBST) total += v * (1 + (UNITS[U[k]].carry || 0));
      const locked = team === ORC && !sandbox;
      const head = el('div', 'side-head ' + (team === DEF ? 'def' : 'orc'), `<div>${team === DEF ? 'DEFENDERS' : 'ATTACKERS'} <span>· ${fmt(total)}</span></div>`);
      const clr = el('button', null, 'Clear'); clr.addEventListener('click', () => app.clearTeam(team));
      if (byType.size && !locked) head.append(clr);
      roster.append(head);
      if (team === DEF && !sandbox) {
        // what the garrison has cost against what the scenario allows
        const spent = forceCost(app.setup.groups), budget = app.setup.budget, over = spent > budget;
        const req = el('div', 'req' + (over ? ' over' : ''), `<div><span>Requisition points</span><b>${fmt(spent)} / ${fmt(budget)}</b></div><div class="bar"><i style="width:${Math.min(100, (100 * spent) / Math.max(1, budget))}%"></i></div>${over ? `<small>Over by ${fmt(spent - budget)} — remove something before the battle.</small>` : `<small>${spent >= budget ? 'All spent' : `${fmt(budget - spent)} left — unspent points add to the score`}</small>`}`);
        roster.append(req);
      }
      if (!byType.size) roster.append(el('div', 'empty', team === DEF ? 'No defenders placed yet.' : 'No attackers placed yet.'));
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
    insp.innerHTML = `<h3>Selected formation</h3><div style="font-weight:700;margin-bottom:6px">${d.name}</div>`;
    const addNum = (label, val, min, max, fn) => { const r = el('div', 'opt'); const i = el('input'); i.type = 'number'; i.min = min; i.max = max; i.value = val; i.addEventListener('change', () => fn(Math.max(min, Math.min(max, +i.value || 0)))); r.append(el('span', null, label), i); insp.append(r); };
    addNum(d.cls === C.OBST ? 'Pieces' : 'Units', g.count, 1, 20000, (v) => app.editGroup(g, { count: v | 0 }));
    if (d.cost && !app.isSandbox() && app.oobOpen) insp.append(el('div', 'opt', `<span>Requisition points</span><b>${fmt(d.cost * g.count)}</b>`));
    if (g.team === ORC) addNum('Advance after (s)', g.delay || 0, 0, 3600, (v) => app.editGroup(g, { delay: v }));
    const btns = el('div', 'btns');
    const mk = (t, fn, cls) => { const b = el('button', cls, t); b.addEventListener('click', fn); btns.append(b); };
    mk('⟲ Rotate', () => app.editGroup(g, { ang: g.ang - Math.PI / 12 }));
    mk('Rotate ⟳', () => app.editGroup(g, { ang: g.ang + Math.PI / 12 }));
    mk('Delete', () => app.removeGroup(g), 'danger');
    insp.append(btns, el('p', 'tip', 'Drag the formation on the map to move it. <b>[</b> <b>]</b> rotate, <b>Del</b> removes it.'));
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
    sel(options, 'Ammunition', o.ammoMult, [[0.5, 'Scarce (50%)'], [1, 'Standard'], [1.5, 'Plentiful (150%)'], [2, 'Double'], [99, 'Unlimited']], (v) => { o.ammoMult = v; }, 'How much ammunition each defender starts with. When it runs dry they fight hand to hand.');
    sel(options, 'Morale', o.morale === false ? 0 : 1, [[1, 'Companies can break'], [0, 'Off — nobody runs']], (v) => { o.morale = !!v; }, 'A company that takes heavy losses in a short time breaks and runs; commanders steady the troops around them, and losing one shakes them.');
    if (sb) num(options, 'Random seed', o.seed, 1, 9999, (v) => { o.seed = v; }, 'The same setup with the same seed and the same orders plays out the same way. Change it for a different roll of the dice.');
    // support: Command Points in a challenge, a number of calls per kind in the sandbox
    if (sb) for (const k in SUPPORT) num(supportOpts, SUPPORT[k].name, o.support[k], 0, 99, (v) => { o.support[k] = v; }, SUPPORT[k].desc);
    else {
      // the same rows as the sandbox, read-only: the pool, then what each call costs from it
      const cpTip = 'One pool pays for every support call. It refills slowly, and killing captains, trolls and siege engines pays a bounty.';
      num(supportOpts, 'Command Points at start', o.cpStart, 0, 99, () => {}, cpTip);
      num(supportOpts, 'Command Points per min', +(o.cpRate * 60).toFixed(1), 0, 99, () => {}, cpTip);
      for (const k in SUPPORT) num(supportOpts, `${SUPPORT[k].name} cost`, SUPPORT[k].cost, 0, 99, () => {}, `${SUPPORT[k].desc} Costs ${SUPPORT[k].cost} Command Points a call.`);
    }
    // win conditions: the defenders win if either is met; they lose if the garrison is wiped out
    sel(winOpts, 'Relief at dawn', o.dawn, [[0, 'Never'], [480, 'After 8 min'], [600, 'After 10 min'], [720, 'After 12 min'], [900, 'After 15 min'], [1200, 'After 20 min'], [1800, 'After 30 min']], (v) => { o.dawn = v; },
      `Hold out this long and the relief column arrives: you win.${sb ? '' : ' The horde paces its waves so the last and heaviest lands shortly before dawn.'}`);
    sel(winOpts, 'Horde gives up at', o.rout, [[0, 'Never — to the last'], [0.01, '1% remaining'], [0.05, '5% remaining'], [0.08, '8% remaining'], [0.15, '15% remaining'], [0.25, '25% remaining']], (v) => { o.rout = v; }, 'The whole host breaks and flees when this little of it is left: you win. The white mark on its bar in battle shows the point.');
    winOpts.append(el('p', 'tip', 'You win when either is met, and lose if the garrison is wiped out.'));
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
  bindTip(cpBox, 'Command Points', 'Every support call is paid for from this one pool. It refills slowly through the night, and killing captains, trolls and siege engines pays a bounty — so what you spend now you cannot spend later.');
  cmdbar.append(cpBox);
  const supTip = (k) => () => `${SUPPORT[k].desc} <i class="cost">${app.sim && app.sim.opt.sandbox ? 'The number in the corner is how many calls are left.' : `Costs ${SUPPORT[k].cost} Command Points.`}</i>`;
  const sup = (k) => addCmd(k, SUPPORT[k].name, SUPPORT[k].key, ICONS[k], SUPPORT[k].name, supTip(k), () => app.armSupport(k));
  addGroup('Strike');
  sup('air'); sup('gunship'); sup('arty');
  addCmd('fire', 'Fire Mission', 'T', ICONS.fire, 'Fire Mission', 'Direct your own mortars and howitzers. Opens the artillery panel; click the map to put every section that can reach onto the target, or task, hold and release sections one by one.', () => app.toggleFireMission());
  addCmd('focus', 'Focus Fire', 'F', ICONS.focus, 'Focus Fire', 'Drag a circle on the map. Every weapon in range concentrates on targets inside it for 30 s. Press again to cancel.', () => app.armFocus());
  addGroup('Resupply &amp; Reinforce');
  sup('supply'); sup('reinforce');
  addCmd('retreat', 'Fall Back', 'R', ICONS.retreat, 'Retreat to the Keep', 'All infantry outside the Hornburg leave their posts, cross the wall walk and man the keep. With troops selected, <b>R</b> pulls back only those; <b>Shift+R</b> is always the general retreat.', () => app.retreat(false));
  addGroup('Overlays');
  addCmd('zones', 'Fire Zones', 'Z', ICONS.zones, 'Artillery Fire Zones', 'Show where each mortar and howitzer section can land its rounds: everything between its minimum and maximum range.', () => app.toggleOverlay('zones'));
  addCmd('ranges', 'Ranges', 'V', ICONS.ranges, 'Weapon Ranges', 'Show how far the rest of the garrison can reach, by weapon. With troops selected, shows just theirs. Troops on a wall see a little further.', () => app.toggleOverlay('ranges'));
  addCmd('losses', 'Losses', 'L', ICONS.losses, 'Show Losses', 'Overlay where soldiers and attackers have fallen so far.', () => app.toggleLosses());

  // ------------------------------------------------------ artillery panel
  const artyPanel = $('artyPanel'), overlayKey = $('overlayKey');
  let artyRows = null, artyKey = '';
  const MODES = [['free', 'Free'], ['target', 'Target'], ['hold', 'Hold']];
  const modeSeg = (onPick) => {
    const seg = el('div', 'mseg');
    for (const [m, t] of MODES) { const b = el('button', null, t); b.dataset.mode = m; b.addEventListener('click', () => { onPick(m); b.blur(); }); seg.append(b); }
    return seg;
  };
  const buildArty = (list) => {
    artyPanel.innerHTML = '';
    const head = el('div', 'ap-head', '<b>Artillery</b><span class="dim">click the map to fire</span>');
    const x = el('button', 'x', '✕'); x.title = 'Close (T)'; x.addEventListener('click', () => app.closeArtyPanel()); head.append(x);
    artyPanel.append(head);
    const all = el('div', 'ap-row all');
    all.append(el('div', 'ap-name', '<b>All sections</b>'), modeSeg((m) => app.artyOrder(null, m)));
    artyPanel.append(all);
    artyRows = list.map((a, k) => {
      const row = el('div', 'ap-row');
      const nm = el('div', 'ap-name', `<i style="background:rgb(${app.artyColor(k)})"></i><b>${a.label}</b><small></small>`);
      const seg = modeSeg((m) => app.artyOrder([a.g], m));
      row.append(nm, seg);
      artyPanel.append(row);
      return { row, info: nm.querySelector('small'), seg, a };
    });
    artyPanel.append(el('p', 'tip', '<b>Target</b> then click the map. Sections that cannot reach keep picking their own targets.'));
  };
  ui.refreshArty = () => {
    const sim = app.sim;
    if (!sim || app.mode !== 'battle' || !app.artyPanel) { artyPanel.hidden = true; return; }
    const list = sim.arty;
    const key = list.map((a) => a.g).join(',');
    if (key !== artyKey || !artyRows) { artyKey = key; buildArty(list); }
    artyPanel.hidden = false;
    const armed = app.tool && app.tool.kind === 'fire' ? app.tool.groups : undefined;
    for (const r of artyRows) {
      const a = r.a, dead = !a.n;
      r.row.classList.toggle('dead', dead);
      r.info.textContent = dead ? 'destroyed' : `${a.n} ${a.key === 'howitzer' ? 'guns' : 'tubes'} · ${Math.round(a.ammo * 100)}% ammo · ${a.key === 'howitzer' ? 'map-wide' : a.w.range + ' m'}${a.mode === 'hold' ? ' · holding' : a.mode === 'target' ? ' · on target' : ''}`;
      for (const b of r.seg.children) {
        const m = b.dataset.mode;
        b.classList.toggle('active', m === 'target' ? a.mode === 'target' || (armed !== undefined && (armed === null || armed.includes(a.g))) : a.mode === m);
        b.disabled = dead;
      }
    }
    artyPanel.querySelector('.ap-row.all').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'target' ? armed === null : list.length > 0 && list.every((a) => !a.n || a.mode === b.dataset.mode)));
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
    if (loc) { t.title = 'Click to look there'; t.addEventListener('click', () => app.jumpTo(loc.x, loc.y)); }
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
  const waveBox = $('waveBox'), wavePips = $('wavePips'), waveName = $('waveName'), waveNote = $('waveNote'), btnSkip = $('btnSkip');
  ui.updateHud = () => {
    const sim = app.sim;
    if (!sim) return;
    if (app.mode === 'setup') {
      defCount.textContent = fmt(sim.defCombat); orcCount.textContent = fmt(sim.count[ORC]);
      defBar.style.width = orcBar.style.width = '100%'; orcRes.style.width = '0'; orcRout.hidden = true; orcLbl.textContent = 'The Horde';
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
    orcLbl.textContent = res > 0 ? `Horde · ${fmt(res)} to come` : 'The Horde';
    orcForce.title = sim.opt.rout > 0 ? `The horde breaks and runs when ${Math.round(sim.opt.rout * 100)}% of it is left (the white mark).` : '';
    waveBox.hidden = !wi;
    if (wi) {
      if (wavePips.children.length !== wi.W) { wavePips.innerHTML = ''; for (let k = 0; k < wi.W; k++) wavePips.append(el('i')); }
      for (let k = 0; k < wi.W; k++) wavePips.children[k].className = k < wi.k ? 'done' : k === wi.k ? 'now' : k === wi.k + 1 && wi.next && wi.next.forming ? 'soon' : '';
      const nx = wi.next;
      waveName.textContent = `Wave ${wi.k + 1} of ${wi.W} · ${wi.name}`;
      let note;
      const at = (w) => (w && w.sector ? ` → ${w.sector.short}` : '');
      if (wi.phase === 'approach') note = `contact in about ${mmss(wi.eta)}${at(wi)}`;
      else if (nx && nx.forming) note = `${nx.name} steps off in ${mmss(nx.in)}${at(nx)}`;
      else if (wi.phase === 'lull') note = `lull — ${nx.name} within ${mmss(nx.in)}`;
      else if (nx) note = `engaged · next: ${nx.name} in ${mmss(nx.in)}`;
      else note = sim.opt.dawn > 0 ? 'the last of them — hold until dawn' : 'the last of them';
      waveNote.textContent = sim.result ? '' : note;
      waveBox.classList.toggle('lull', wi.phase === 'lull' && !(nx && nx.forming));
      waveBox.classList.toggle('hot', wi.phase === 'engaged');
      btnSkip.hidden = !!sim.result || !(wi.phase === 'lull' || wi.phase === 'approach') || !!app.skip;
    }
    const am = sim.ammoLevel();
    ammoPct.textContent = sim.opt.ammoMult > 50 ? '∞' : Math.round(am * 100) + '%';
    ammoBar.style.width = (am * 100) + '%';
    ammoPct.parentElement.classList.toggle('low', am < 0.3 && sim.opt.ammoMult <= 50);
    $('btnResult').hidden = !sim.result;
    clock.textContent = mmss(sim.time);
    dawn.textContent = sim.opt.dawn > 0 ? `Relief in ${mmss(sim.opt.dawn - sim.time)}` : 'No relief coming';
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
      cpRate.textContent = sim.cp >= sim.opt.cpCap ? 'full' : `+${(sim.opt.cpRate * 60).toFixed(1)} / min`;
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
    cmds.fire.uses.textContent = sim.arty.filter((a) => a.n).length || '';
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
    const by = new Map(); let am2 = 0, an = 0, hp = 0, mo = 0;
    for (const i of sel) { const d = UNITS[sim.type[i]]; by.set(d.name, (by.get(d.name) || 0) + 1); if (d.ammo) { am2 += Math.min(1, sim.ammo[i] / sim.maxAmmo(i)); an++; } hp += sim.hp[i] / d.hp; mo += sim.gMorale[sim.grp[i]]; }
    let html = `<b>${fmt(sel.length)} selected</b>`;
    for (const [n, c] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 5)) html += `<div class="line"><span>${n}</span><span>${fmt(c)}</span></div>`;
    html += `<div class="line"><span>Ammunition</span><span>${an ? Math.round(100 * am2 / an) + '%' : '—'}</span></div><div class="line"><span>Condition</span><span>${Math.round(100 * hp / sel.length)}%</span></div><div class="line"><span>Morale</span><span>${Math.round(mo / sel.length)}%</span></div>`;
    const st = sim.holdR[sel[0]], mixed = sel.some((i) => sim.holdR[i] !== st);
    html += `<div class="line"><span>Fire</span><span class="${st && !mixed ? 'held' : ''}">${mixed ? 'mixed' : app.stanceName(st)}</span></div>`;
    html += '<p class="tip"><b>Right-click</b> move · <b>H</b> fire discipline · <b>R</b> fall back to the keep · <b>X</b> halt · <b>Shift+6…0</b> make a group</p>';
    selinfo.innerHTML = html; selinfo.hidden = false;
  };

  // -------------------------------------------------------------- dialogs
  const modal = $('modal');
  let onModalClose = null;
  ui.hideModal = () => { modal.hidden = true; modal.innerHTML = ''; const f = onModalClose; onModalClose = null; if (f) f(); };
  ui.modalOpen = () => !modal.hidden;
  modal.addEventListener('mousedown', (e) => { if (e.target === modal && modal.dataset.dismiss === '1') ui.hideModal(); });

  ui.showHelp = () => {
    onModalClose = null;
    modal.dataset.dismiss = '1';
    modal.hidden = false;
    modal.innerHTML = `<div class="dialog">
      <h1 style="font-size:22px">How to play</h1>
      <p class="sub">Garrison the Deep, then hold it against the horde. The battle waits while this is open.</p>
      <h4>Two ways to play</h4>
      <div class="keys"><div>Challenge</div><span>A scenario played as designed. The garrison is issued at its full requisition — open <b>Advanced</b> under Order of Battle to see the points and change what it fields. The horde comes in waves; hold until the relief arrives at dawn, or break it: it runs when it is down to the white mark on its bar. Scored, with medals.</span><div>Sandbox</div><span>Build both armies freely, from a blank map or autofilled from a scenario. The whole horde is on the field from the start, and you set the win conditions: by default no relief comes, and you win when the horde gives up with only a remnant left. You lose if the garrison is wiped out. Not scored.</span></div>
      <h4>The night</h4>
      <div class="keys"><div>Waves</div><span>In a challenge the horde comes on in waves — a vanguard, escalades with ladders, the siege train, and a final assault timed to land before dawn. The top bar counts down to each and says which stretch of wall it is aimed at. Cut a wave down quickly and you earn a lull.</span><div>Command Points</div><span>In a challenge every support call is paid from one pool that refills slowly; killing captains, trolls and siege engines pays a bounty. A strike now is a resupply you cannot afford later. In the sandbox each kind of support has a set number of calls instead.</span><div>Score</div><span>Challenges are scored on the win, soldiers brought through, an intact gate and wall, and requisition points left unspent.</span></div>
      <h4>Camera</h4>
      <div class="keys"><div><kbd>Scroll</kbd></div><span>Zoom toward the cursor</span><div><kbd>Right-drag</kbd> <kbd>W A S D</kbd></div><span>Pan the map</span><div><kbd>Q</kbd> <kbd>E</kbd> or <kbd>Middle-drag</kbd></div><span>Rotate the view</span><div><kbd>G</kbd> · <kbd>Minimap</kbd></div><span>Jump to the latest alert (again for the one before) · click the minimap or any alert in the feed to look there</span><div><kbd>F2</kbd></div><span>Performance overlay</span></div>
      <h4>Setting up</h4>
      <div class="keys"><div><kbd>Click</kbd></div><span>With a unit picked: drop a block of troops. The dashed ring is its weapon's reach from that spot</span><div><kbd>Drag</kbd></div><span>Draw a line — along a wall top to man the battlements, or across the valley to lay wire, obstacles or mines</span><div><kbd>Click formation</kbd></div><span>Select it; drag to move, <kbd>[</kbd> <kbd>]</kbd> rotate, <kbd>Del</kbd> remove</span><div><kbd>Enter</kbd></div><span>Begin the battle</span></div>
      <h4>In battle</h4>
      <div class="keys"><div><kbd>Space</kbd> <kbd>−</kbd> <kbd>+</kbd> <kbd>N</kbd></div><span>Pause · slower · faster · fast-forward through a quiet spell to the next contact</span><div><kbd>1</kbd>–<kbd>5</kbd></div><span>Call support, then click the target (drag to aim an air strike)</span><div><kbd>T</kbd></div><span>Fire mission: open the artillery panel, then click a target for your mortars and howitzers (or task, hold and release each section)</span><div><kbd>F</kbd></div><span>Focus fire: drag a circle. Everything in range concentrates there — and marksmen pick out any captain inside it</span><div><kbd>Z</kbd> · <kbd>V</kbd> · <kbd>L</kbd></div><span>Overlays: artillery fire zones · weapon ranges · where the fallen lie</span><div><kbd>Drag</kbd> / <kbd>Double-click</kbd></div><span>Box-select defenders / select every unit of that kind in view</span><div><kbd>Right-click</kbd> · <kbd>X</kbd></div><span>Move the selection · halt it</span><div><kbd>H</kbd></div><span>Fire discipline for the selection: at will, hold to 150 m, hold to 75 m, hold fire. Close shots hit far more often, so held fire stretches ammunition</span><div><kbd>R</kbd> · <kbd>Shift+R</kbd></div><span>Pull the selected troops back to the Hornburg · general retreat</span><div><kbd>Shift+6</kbd>…<kbd>0</kbd> · <kbd>6</kbd>…<kbd>0</kbd></div><span>Make a control group from the selection · recall it (tap twice to look at it)</span></div>
      <h4>What to watch for</h4>
      <div class="keys"><div>Ammunition</div><span>Troops re-arm within 60 m of a cache or supply drop. An amber pip marks a soldier out of rounds; a sector that runs dry raises an alert.</span><div>Dead ground</div><span>Men on a wall can barely hit attackers hugging its foot. Guns on the Hornburg can — and so can grenades.</span><div>Suppression</div><span>Machine guns and shellfire pin companies down (▼): they slow to a crawl, their archers stop shooting and their nerve wears away. Berserkers cannot be pinned.</span><div>Captains ★</div><span>They drive their wave on from the rear and are not shot on sight. Mark one with focus fire; when he falls the companies around him waver.</span><div>Siege works</div><span>Ladders and towers put attackers on the wall walk, sappers blow the culvert, a ram breaks the gate, catapults batter the wall and hunt mortars that keep firing from one spot. Alerts warn of each while there is still time to act.</span></div>
      <div class="actions"><button class="primary" id="mClose">Got it</button></div></div>`;
    $('mClose').addEventListener('click', ui.hideModal);
  };

  /** The first thing on screen: what this is, and the two ways to play it. */
  ui.showWelcome = () => {
    modal.dataset.dismiss = '0';
    modal.hidden = false;
    modal.innerHTML = `<div class="dialog welcome">
      <div class="wl-brand"><svg viewBox="0 0 32 32" width="46" height="46" aria-hidden="true"><path d="M5 26V12l5-4 2 4h8l2-4 5 4v14h-8v-6a3 3 0 0 0-6 0v6z" fill="currentColor"/></svg><div><h1>Helm’s Deep</h1><small>Modern Defense Simulator</small></div></div>
      <p class="lead">A modern garrison holds the Hornburg and the Deeping Wall against a host of Uruk-hai. Lay out riflemen, machine guns, mortars, armour and field works, then command the defence in real time: call in air strikes and artillery, direct your guns, keep the ammunition flowing and fall back to the keep when the wall gives way.</p>
      <div class="wl-modes">
        <button class="wl-mode primary-mode" id="wlSandbox"><b>Sandbox</b><span>Build both armies freely on an open map, or autofill it from a scenario. No budget and no waves — the whole horde is on the field, and you set the win conditions.</span><em>Start building →</em></button>
        <button class="wl-mode" id="wlChallenge"><b>Challenge</b><span>Hold the Deep through the night against a horde that comes in waves, with the garrison your requisition can field. Scored, with medals for the best defence.</span><em>Take command →</em></button>
      </div>
      <div class="wl-foot"><button class="link" id="wlHelp">How to play</button><span>You can switch modes any time from the top bar.</span></div></div>`;
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
      ? '<b>Start from a blank map — or autofill it</b><p>Pick a scenario here to fill the map with both of its armies in one go, then change anything you like. Or stay on the blank map and build each side yourself from the panel on the left.</p>'
      : '<b>The Hornburg Garrison is ready</b><p>Its garrison is already in place, issued at full requisition — press <b>Begin Battle</b> to take command. Choose a different challenge here; open <b>Advanced</b> on the right to rework the order of battle.</p>';
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
  const DETAIL = [[0.5, 'Close up'], [0.375, 'Medium'], [0.3, 'Far (default)'], [0.225, 'Very far']];
  const renderSettings = () => {
    const cur = app.settings.heroScale;
    menu.innerHTML = '<h3>Settings</h3>';
    const r = el('div', 'set-row'), lab = el('div', null, '<b>Detailed models</b><span>How far out units are drawn in more detail. Further out looks better but costs frame rate in big battles.</span>');
    const seg = el('div', 'set-seg');
    for (const [v, t] of DETAIL) {
      const b = el('button', Math.abs(v - cur) < 1e-3 ? 'active' : '', t.replace(' (default)', ''));
      const L = app.lodAt(v), f = (z) => z.toFixed(1);
      b.title = `${t}: dots below ${f(L.dot)} px/m, boxes to ${f(L.box)}, stand-ins to ${f(L.hero)}, full models beyond`;
      b.addEventListener('click', () => { app.setSetting('heroScale', v); renderSettings(); });
      seg.append(b);
    }
    r.append(lab, seg); menu.append(r);
  };
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
      <h1 class="${r.win ? 'win' : 'lose'}">${r.win ? 'Victory' : 'The Deep has fallen'}</h1>
      <p class="sub">${r.reason}</p>
      ${scoreHtml}
      <div class="stats">
        <div class="stat"><small>Duration</small><b>${mmss(r.time)}</b></div>
        <div class="stat"><small>Enemy killed</small><b>${fmt(totalK)}</b></div>
        <div class="stat"><small>Enemy routed</small><b>${fmt(st.fled)}</b></div>
        <div class="stat"><small>Defenders lost</small><b>${fmt(totalL)} <span style="font-size:12px;color:var(--dim)">/ ${fmt(sim.initial[0])}</span></b></div>
      </div>
      <div class="cols">
        <div><h3>Kills by weapon</h3>${kills.slice(0, 11).map(([k, v]) => `<div class="krow"><span>${wname(k)}</span><div class="kb"><i style="width:${(100 * v) / maxK}%"></i></div><span>${fmt(v)}</span></div>`).join('') || '<div class="empty">None</div>'}</div>
        <div><h3>Defender losses</h3>${lost.slice(0, 9).map(([k, v]) => `<div class="krow loss"><span>${UNITS[U[k]].name}</span><div class="kb"><i style="width:${(100 * v) / maxL}%"></i></div><span>${fmt(v)}</span></div>`).join('') || '<div class="empty">Not a single soldier.</div>'}
        <h3 style="margin-top:14px">The fight</h3><div class="krow"><span>Sections breached</span><div></div><span>${st.breaches}</span></div><div class="krow"><span>Companies broken</span><div></div><span>${st.routs}</span></div><div class="krow"><span>Rounds fired</span><div></div><span>${fmt(st.shots)}</span></div><div class="krow"><span>Exchange ratio</span><div></div><span>${totalL ? (totalK / totalL).toFixed(1) + ' : 1' : '—'}</span></div></div>
      </div>
      <div class="actions"><button id="mView">Survey the field</button><button id="mEdit">Change the setup</button><button class="primary" id="mAgain">Fight again</button></div></div>`;
    $('mView').addEventListener('click', () => { ui.hideModal(); app.showLosses = true; });
    $('mEdit').addEventListener('click', () => { ui.hideModal(); app.backToSetup(); });
    $('mAgain').addEventListener('click', () => { ui.hideModal(); app.startBattle(); });
  };

  ui.setMode = (mode) => {
    document.getElementById('app').className = mode === 'setup' ? 'mode-setup' : 'mode-battle';
    tip.hidden = true;
  };

  renderPalette(); setBrush(50);
  return ui;
}
