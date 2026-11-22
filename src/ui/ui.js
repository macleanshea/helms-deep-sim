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
  hold: I('<path d="M6 19.500l2.500-11 3 .7-2.500 11z" fill="currentColor" stroke="none"/><path d="M4 20.500h9"/><circle cx="16.500" cy="8" r="5"/><path d="M13 11.500l7-7"/>'),
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
      tip.innerHTML = `<b>${title}</b><span>${body}</span>`;
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
  const preset = $('preset');
  for (const p of PRESETS) { const o = el('option', null, p.name); o.value = p.key; preset.append(o); }
  /** Show the best medal and score won on each scenario next to its name. */
  ui.refreshPresets = (best) => { for (const o of preset.options) { const p = PRESETS.find((q) => q.key === o.value), b = best[o.value]; o.textContent = p.name + (b ? `   ${b.medal ? '★ ' : ''}${b.score}` : ''); } };
  preset.addEventListener('change', () => { app.loadPreset(preset.value); preset.blur(); });
  ui.setPreset = (k) => { preset.value = k; };
  $('btnBegin').addEventListener('click', () => app.startBattle());
  $('btnBack').addEventListener('click', () => app.backToSetup());
  $('btnResult').addEventListener('click', () => { if (app.sim && app.sim.result) ui.showEnd(app.sim); });
  $('btnHelp').addEventListener('click', () => ui.showHelp());
  $('btnSound').addEventListener('click', () => { const m = app.toggleMute(); $('btnSound').classList.toggle('off', m); });
  for (const b of document.querySelectorAll('#speedCtl .seg')) b.addEventListener('click', () => { app.setSpeed(+b.dataset.speed); b.blur(); });
  $('btnSkip').addEventListener('click', () => { app.skipAhead(); $('btnSkip').blur(); });

  // ---------------------------------------------------- palette & brush
  const palette = $('palette');
  function renderPalette() {
    palette.innerHTML = '';
    const sandbox = !app.setup || !!app.setup.options.sandbox;
    if (tab === ORC && !sandbox) {
      // in a challenge the enemy is what it is
      const box = el('div', 'locked', '<b>The enemy is fixed in a challenge.</b><span>The horde\'s order of battle and the battle options are part of the scenario. Switch to Sandbox to build both armies freely — sandbox battles are not scored.</span>');
      const b = el('button', null, 'Switch to Sandbox'); b.addEventListener('click', () => app.setSandbox(true));
      box.append(b); palette.append(box);
      return;
    }
    const card = (d) => {
      const b = el('button', 'card ' + (d.team === DEF ? 'def' : 'orc') + (app.tool && app.tool.kind === 'place' && app.tool.type === d.key ? ' active' : ''));
      const ic = el('div', 'ico'); ic.append(icon(d, 44));
      b.append(ic, el('div', null, `<b>${d.name}${d.cost && !sandbox ? `<em title="Requisition cost each">${d.cost}</em>` : ''}</b><span>${d.desc}</span>`));
      b.addEventListener('click', () => { app.selectPlaceTool(app.tool && app.tool.type === d.key ? null : d.key); b.blur(); });
      palette.append(b);
    };
    const mine = UNITS.filter((d) => d.team === tab && !d.hidden);
    if (tab === DEF) {
      palette.append(el('div', 'pal-head', 'Troops &amp; vehicles'));
      mine.filter((d) => d.cls !== C.OBST).forEach(card);
      palette.append(el('div', 'pal-head', 'Field works'));
      mine.filter((d) => d.cls === C.OBST).forEach(card);
    } else mine.forEach(card);
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
  const roster = $('roster');
  ui.refreshRoster = () => {
    roster.innerHTML = '';
    for (const team of [DEF, ORC]) {
      const byType = new Map();
      for (const g of app.setup.groups) if (g.team === team) byType.set(g.type, (byType.get(g.type) || 0) + g.count);
      let total = 0; for (const [k, v] of byType) if (UNITS[U[k]].cls !== C.OBST) total += v * (1 + (UNITS[U[k]].carry || 0));
      const sandbox = !!app.setup.options.sandbox, locked = team === ORC && !sandbox;
      const head = el('div', 'side-head ' + (team === DEF ? 'def' : 'orc'), `<div>${team === DEF ? 'DEFENDERS' : 'ATTACKERS'} <span>· ${fmt(total)}</span></div>`);
      const clr = el('button', null, 'Clear'); clr.addEventListener('click', () => app.clearTeam(team));
      if (byType.size && !locked) head.append(clr);
      roster.append(head);
      if (team === DEF && !sandbox) {
        // what the garrison has cost against what the scenario allows
        const spent = forceCost(app.setup.groups), budget = app.setup.budget, over = spent > budget;
        const req = el('div', 'req' + (over ? ' over' : ''), `<div><span>Requisition</span><b>${fmt(spent)} / ${fmt(budget)}</b></div><div class="bar"><i style="width:${Math.min(100, (100 * spent) / Math.max(1, budget))}%"></i></div>${over ? `<small>Over by ${fmt(spent - budget)} — remove something before the battle.</small>` : `<small>${fmt(budget - spent)} left to spend</small>`}`);
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
      if (team === ORC) {
        // the order of attack: what comes when
        const ws = waveSummary(app.setup.groups).filter((w) => w.size > 0);
        if (ws.length > 1) {
          const box = el('div', 'waves', '<h3>Order of attack</h3>');
          for (const w of ws) box.append(el('div', 'wrow', `<i>${w.k + 1}</i><div>${w.name}${w.k === 0 ? ' — on the field' : ''}<span>${w.note || 'infantry'}</span></div><b>${fmt(w.size)}</b>`));
          roster.append(box);
        }
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
    if (d.cost && !app.setup.options.sandbox) insp.append(el('div', 'opt', `<span>Requisition</span><b>${fmt(d.cost * g.count)}</b>`));
    if (g.team === ORC) addNum('Advance after (s)', g.delay || 0, 0, 3600, (v) => app.editGroup(g, { delay: v }));
    const btns = el('div', 'btns');
    const mk = (t, fn, cls) => { const b = el('button', cls, t); b.addEventListener('click', fn); btns.append(b); };
    mk('⟲ Rotate', () => app.editGroup(g, { ang: g.ang - Math.PI / 12 }));
    mk('Rotate ⟳', () => app.editGroup(g, { ang: g.ang + Math.PI / 12 }));
    mk('Delete', () => app.removeGroup(g), 'danger');
    insp.append(btns, el('p', 'tip', 'Drag the formation on the map to move it. <b>[</b> <b>]</b> rotate, <b>Del</b> removes it.'));
  };

  // ------------------------------------------------------------- options
  const options = $('options');
  ui.refreshOptions = () => {
    const o = app.setup.options, sb = !!o.sandbox;
    options.innerHTML = '';
    // challenge or sandbox
    const mode = el('div', 'modesw');
    for (const [v, t, tipText] of [[0, 'Challenge', 'Scored. The enemy and the battle options are fixed by the scenario; you choose and place the garrison within its requisition budget and pay for support with Command Points.'], [1, 'Sandbox', 'Free build. Place anything on either side, change every option, call support by a fixed number of uses. Not scored.']]) {
      const b = el('button', (sb ? 1 : 0) === v ? 'active' : '', t);
      b.addEventListener('click', () => { if ((sb ? 1 : 0) !== v) app.setSandbox(!!v); b.blur(); });
      bindTip(b, t, tipText);
      mode.append(b);
    }
    options.append(mode);
    const sel = (label, cur, list, fn, tipText) => {
      const r = el('div', 'opt'), s = el('select');
      for (const [v, t] of list) { const op = el('option', null, t); op.value = v; s.append(op); }
      if (!list.some(([v]) => v === cur)) { const op = el('option', null, String(cur)); op.value = cur; s.append(op); }
      s.value = cur; s.disabled = !sb; s.addEventListener('change', () => { fn(+s.value); s.blur(); app.optionsChanged(); });
      r.append(el('span', null, label), s); options.append(r);
      if (tipText) bindTip(r, label, tipText);
    };
    const num = (label, val, min, max, fn, tipText) => {
      const r = el('div', 'opt'), i = el('input');
      i.type = 'number'; i.min = min; i.max = max; i.value = val;
      i.addEventListener('change', () => { const v = Math.max(min, Math.min(max, +i.value | 0)); i.value = v; fn(v); app.optionsChanged(); });
      r.append(el('span', null, label), i); options.append(r);
      if (tipText) bindTip(r, label, tipText);
    };
    sel('Ammunition', o.ammoMult, [[0.5, 'Scarce (50%)'], [1, 'Standard'], [1.5, 'Plentiful (150%)'], [2, 'Double'], [99, 'Unlimited']], (v) => { o.ammoMult = v; }, 'How much ammunition each defender starts with. When it runs dry they fight hand to hand.');
    sel('Relief at dawn', o.dawn, [[0, 'Never'], [480, 'After 8 min'], [600, 'After 10 min'], [720, 'After 12 min'], [900, 'After 15 min'], [1200, 'After 20 min'], [1800, 'After 30 min']], (v) => { o.dawn = v; }, 'Hold out this long and the relief column arrives: you win. The horde paces its waves so the last and heaviest lands shortly before dawn.');
    sel('Morale', o.morale === false ? 0 : 1, [[1, 'Companies can break'], [0, 'Off — nobody runs']], (v) => { o.morale = !!v; }, 'A company that takes heavy losses in a short time breaks and runs; commanders steady the troops around them, and losing one shakes them.');
    sel('Horde gives up at', o.rout, [[0, 'Never — to the last'], [0.05, '5% remaining'], [0.08, '8% remaining'], [0.15, '15% remaining'], [0.25, '25% remaining']], (v) => { o.rout = v; }, 'The whole host routs when this little of it is left.');
    if (!sb) {
      const sh = el('h3', null, 'Support'); sh.style.marginTop = '12px'; options.append(sh);
      const r = el('div', 'opt', `<span>Command Points</span><b>${o.cpStart} to start · +${(o.cpRate * 60).toFixed(1)} / min</b>`);
      options.append(r);
      bindTip(r, 'Command Points', 'One pool pays for every support call. It refills slowly, and killing captains, trolls and siege engines pays a bounty.');
      options.append(el('p', 'tip', Object.values(SUPPORT).map((q) => `${q.name} <b>${q.cost}</b>`).join(' · ')));
      return;
    }
    const sh = el('h3', null, 'Support on call'); sh.style.marginTop = '12px'; options.append(sh);
    for (const k in SUPPORT) num(SUPPORT[k].name, o.support[k], 0, 99, (v) => { o.support[k] = v; }, SUPPORT[k].desc);
    num('Random seed', o.seed, 1, 9999, (v) => { o.seed = v; }, 'The same setup with the same seed and the same orders plays out the same way. Change it for a different roll of the dice.');
  };

  // --------------------------------------------------------- command bar
  const cmdbar = $('cmdbar');
  const cmds = {};
  const addCmd = (id, name, key, svg, title, body, fn) => {
    const b = el('button', 'cmd', `<span class="key">${key}</span><span class="uses"></span>${svg}<span class="name">${name}</span><i class="cool"></i>`);
    b.addEventListener('click', () => { fn(); b.blur(); });
    bindTip(b, `${title} <kbd>${key}</kbd>`, body);
    cmdbar.append(b);
    cmds[id] = { b, uses: b.querySelector('.uses'), cool: b.querySelector('.cool') };
  };
  // the purse every support call is paid from
  const cpBox = el('div', 'cpbox', '<small>Command</small><b id="cpVal">0</b><div class="bar"><i id="cpBar"></i></div><small id="cpRate"></small>');
  bindTip(cpBox, 'Command Points', 'Every support call is paid for from this one pool. It refills slowly through the night, and killing captains, trolls and siege engines pays a bounty — so what you spend now you cannot spend later.');
  cmdbar.append(cpBox);
  for (const k in SUPPORT) addCmd(k, SUPPORT[k].name, SUPPORT[k].key, ICONS[k], SUPPORT[k].name, `${SUPPORT[k].desc} <i class="cost">Costs ${SUPPORT[k].cost} Command Points.</i>`, () => app.armSupport(k));
  cmdbar.append(el('div', 'sep'));
  addCmd('focus', 'Focus Fire', 'F', ICONS.focus, 'Focus Fire', 'Drag a circle on the map. Every weapon in range concentrates on targets inside it for 30 s. Press again to cancel.', () => app.armFocus());
  addCmd('hold', 'Hold Mortars', 'H', ICONS.hold, 'Hold Indirect Fire', 'Mortars and howitzers cease fire to save shells until you release them.', () => app.toggleHold());
  addCmd('retreat', 'Fall Back', 'R', ICONS.retreat, 'Retreat to the Keep', 'All infantry outside the Hornburg leave their posts, cross the wall walk and man the keep. With troops selected, <b>R</b> pulls back only those; <b>Shift+R</b> is always the general retreat.', () => app.retreat(false));
  cmdbar.append(el('div', 'sep'));
  addCmd('losses', 'Losses', 'L', ICONS.losses, 'Show Losses', 'Overlay where soldiers and attackers have fallen so far.', () => app.toggleLosses());

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
  const ammoPct = $('ammoPct'), ammoBar = $('ammoBar'), clock = $('clock'), dawn = $('dawn'), selinfo = $('selinfo');
  const cpVal = $('cpVal'), cpBar = $('cpBar'), cpRate = $('cpRate');
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
      const at = (w) => (w && w.sector ? ` → ${w.sector.name.replace('the ', '')}` : '');
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
    cmds.hold.b.classList.toggle('on', sim.holdIndirect);
    cmds.hold.b.querySelector('.name').textContent = sim.holdIndirect ? 'Mortars Held' : 'Hold Mortars';
    cmds.losses.b.classList.toggle('armed', !!app.showLosses);
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
    html += '<p class="tip"><b>Right-click</b> move · <b>V</b> fire discipline · <b>R</b> fall back to the keep · <b>X</b> halt · <b>Shift+6…0</b> make a group</p>';
    selinfo.innerHTML = html; selinfo.hidden = false;
  };

  // -------------------------------------------------------------- dialogs
  const modal = $('modal');
  ui.hideModal = () => { modal.hidden = true; modal.innerHTML = ''; };
  ui.modalOpen = () => !modal.hidden;
  modal.addEventListener('mousedown', (e) => { if (e.target === modal && modal.dataset.dismiss === '1') ui.hideModal(); });

  ui.showHelp = () => {
    modal.dataset.dismiss = '1';
    modal.hidden = false;
    modal.innerHTML = `<div class="dialog">
      <h1 style="font-size:22px">How to play</h1>
      <p class="sub">Garrison the Deep within your budget, then hold it through the night. The battle waits while this is open.</p>
      <h4>The night</h4>
      <div class="keys"><div>Waves</div><span>The horde comes on in waves — a vanguard, escalades with ladders, the siege train, and a final assault timed to land before dawn. The top bar counts down to each and says what it brings and which stretch of wall it is aimed at. Cut a wave down quickly and you earn a lull.</span><div>Winning</div><span>Hold until the relief arrives at dawn, or break the horde: it runs when it is down to the white mark on its bar.</span><div>Command Points</div><span>Every support call is paid from one pool that refills slowly; killing captains, trolls and siege engines pays a bounty. A strike now is a resupply you cannot afford later.</span><div>Score</div><span>Challenges are scored on the win, soldiers brought through, an intact gate and wall, and requisition left unspent. Sandbox lifts every limit and is not scored.</span></div>
      <h4>Camera</h4>
      <div class="keys"><div><kbd>Scroll</kbd></div><span>Zoom toward the cursor</span><div><kbd>Right-drag</kbd> <kbd>W A S D</kbd></div><span>Pan the map</span><div><kbd>Q</kbd> <kbd>E</kbd> or <kbd>Middle-drag</kbd></div><span>Rotate the view</span><div><kbd>G</kbd> · <kbd>Minimap</kbd></div><span>Jump to the latest alert (again for the one before) · click the minimap or any alert in the feed to look there</span></div>
      <h4>Setting up</h4>
      <div class="keys"><div><kbd>Click</kbd></div><span>With a unit picked: drop a block of troops. The dashed ring is its weapon's reach from that spot</span><div><kbd>Drag</kbd></div><span>Draw a line — along a wall top to man the battlements, or across the valley to lay wire, mines or a moat</span><div><kbd>Click formation</kbd></div><span>Select it; drag to move, <kbd>[</kbd> <kbd>]</kbd> rotate, <kbd>Del</kbd> remove</span><div><kbd>Enter</kbd></div><span>Begin the battle</span></div>
      <h4>In battle</h4>
      <div class="keys"><div><kbd>Space</kbd> <kbd>−</kbd> <kbd>+</kbd> <kbd>N</kbd></div><span>Pause · slower · faster · fast-forward through a quiet spell to the next contact</span><div><kbd>1</kbd>–<kbd>5</kbd></div><span>Call support, then click the target (drag to aim an air strike)</span><div><kbd>F</kbd></div><span>Focus fire: drag a circle. Everything in range concentrates there — and marksmen pick out any captain inside it</span><div><kbd>H</kbd> · <kbd>L</kbd></div><span>Hold mortars · show where the fallen lie</span><div><kbd>Drag</kbd> / <kbd>Double-click</kbd></div><span>Box-select defenders / select every unit of that kind in view</span><div><kbd>Right-click</kbd> · <kbd>X</kbd></div><span>Move the selection · halt it</span><div><kbd>V</kbd></div><span>Fire discipline for the selection: at will, hold to 150 m, hold to 75 m, hold fire. Close shots hit far more often, so held fire stretches ammunition</span><div><kbd>R</kbd> · <kbd>Shift+R</kbd></div><span>Pull the selected troops back to the Hornburg · general retreat</span><div><kbd>Shift+6</kbd>…<kbd>0</kbd> · <kbd>6</kbd>…<kbd>0</kbd></div><span>Make a control group from the selection · recall it (tap twice to look at it)</span></div>
      <h4>What to watch for</h4>
      <div class="keys"><div>Ammunition</div><span>Troops re-arm within 60 m of a cache or supply drop. An amber pip marks a soldier out of rounds; a sector that runs dry raises an alert.</span><div>Dead ground</div><span>Men on a wall can barely hit attackers hugging its foot. Guns on the Hornburg can — and so can grenades.</span><div>Suppression</div><span>Machine guns and shellfire pin companies down (▼): they slow to a crawl, their archers stop shooting and their nerve wears away. Berserkers cannot be pinned.</span><div>Captains ★</div><span>They drive their wave on from the rear and are not shot on sight. Mark one with focus fire; when he falls the companies around him waver.</span><div>Siege works</div><span>Ladders and towers put attackers on the wall walk, sappers blow the culvert, a ram breaks the gate, catapults batter the wall and hunt mortars that keep firing from one spot. Alerts warn of each while there is still time to act.</span></div>
      <div class="actions"><button class="primary" id="mClose">Got it</button></div></div>`;
    $('mClose').addEventListener('click', ui.hideModal);
  };

  ui.showEnd = (sim) => {
    const r = sim.result, st = sim.stats;
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
  ui.setTab = (t) => { tab = t; for (const q of document.querySelectorAll('#teamTabs .tab')) q.classList.toggle('active', +q.dataset.team === t); renderPalette(); };
  ui.getTab = () => tab;

  renderPalette(); setBrush(50);
  return ui;
}
