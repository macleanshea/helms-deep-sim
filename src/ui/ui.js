// DOM user interface: setup panels, battle HUD, toasts and dialogs.

import { UNITS, U, DEF, ORC, SUPPORT, WEAPONS, C } from '../config.js';
import { PRESETS } from '../scenarios.js';
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
  preset.addEventListener('change', () => { app.loadPreset(preset.value); preset.blur(); });
  ui.setPreset = (k) => { preset.value = k; };
  $('btnBegin').addEventListener('click', () => app.startBattle());
  $('btnBack').addEventListener('click', () => app.backToSetup());
  $('btnHelp').addEventListener('click', () => ui.showHelp());
  $('btnSound').addEventListener('click', () => { const m = app.toggleMute(); $('btnSound').classList.toggle('off', m); });
  for (const b of document.querySelectorAll('#speedCtl .seg')) b.addEventListener('click', () => { app.setSpeed(+b.dataset.speed); b.blur(); });

  // ---------------------------------------------------- palette & brush
  const palette = $('palette');
  function renderPalette() {
    palette.innerHTML = '';
    const card = (d) => {
      const b = el('button', 'card ' + (d.team === DEF ? 'def' : 'orc') + (app.tool && app.tool.kind === 'place' && app.tool.type === d.key ? ' active' : ''));
      const ic = el('div', 'ico'); ic.append(icon(d, 44));
      b.append(ic, el('div', null, `<b>${d.name}</b><span>${d.desc}</span>`));
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
      const head = el('div', 'side-head ' + (team === DEF ? 'def' : 'orc'), `<div>${team === DEF ? 'DEFENDERS' : 'ATTACKERS'} <span>· ${fmt(total)}</span></div>`);
      const clr = el('button', null, 'Clear'); clr.addEventListener('click', () => app.clearTeam(team));
      if (byType.size) head.append(clr);
      roster.append(head);
      if (!byType.size) roster.append(el('div', 'empty', team === DEF ? 'No defenders placed yet.' : 'No attackers placed yet.'));
      for (const d of UNITS) {
        if (!byType.has(d.key)) continue;
        const row = el('div', 'rrow ' + (team === DEF ? 'def' : 'orc'));
        const ic = el('div', 'ico'); ic.append(icon(d, 26));
        const inp = el('input'); inp.type = 'number'; inp.min = 0; inp.max = 60000; inp.value = byType.get(d.key);
        inp.addEventListener('change', () => app.setTypeCount(d.key, Math.max(0, +inp.value | 0)));
        const x = el('button', 'x', '✕'); x.title = 'Remove all'; x.addEventListener('click', () => app.setTypeCount(d.key, 0));
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
    const o = app.setup.options;
    options.innerHTML = '';
    const sel = (label, cur, list, fn, tipText) => {
      const r = el('div', 'opt'), s = el('select');
      for (const [v, t] of list) { const op = el('option', null, t); op.value = v; s.append(op); }
      if (!list.some(([v]) => v === cur)) { const op = el('option', null, String(cur)); op.value = cur; s.append(op); }
      s.value = cur; s.addEventListener('change', () => { fn(+s.value); s.blur(); });
      r.append(el('span', null, label), s); options.append(r);
      if (tipText) bindTip(r, label, tipText);
    };
    sel('Ammunition', o.ammoMult, [[0.5, 'Scarce (50%)'], [1, 'Standard'], [1.5, 'Plentiful (150%)'], [2, 'Double'], [99, 'Unlimited']], (v) => { o.ammoMult = v; }, 'How much ammunition each defender starts with. When it runs dry they fight hand to hand.');
    sel('Relief at dawn', o.dawn, [[0, 'Never'], [480, 'After 8 min'], [720, 'After 12 min'], [900, 'After 15 min'], [1200, 'After 20 min'], [1800, 'After 30 min']], (v) => { o.dawn = v; }, 'Hold out this long and the relief column arrives: you win.');
    sel('Morale', o.morale === false ? 0 : 1, [[1, 'Companies can break'], [0, 'Off — nobody runs']], (v) => { o.morale = !!v; }, 'A company that takes heavy losses in a short time breaks and runs; commanders steady the troops around them, and losing one shakes them.');
    sel('Horde gives up at', o.rout, [[0, 'Never — to the last'], [0.05, '5% remaining'], [0.08, '8% remaining'], [0.15, '15% remaining'], [0.25, '25% remaining']], (v) => { o.rout = v; }, 'The whole host routs when this little of it is left.');
    const sh = el('h3', null, 'Support on call'); sh.style.marginTop = '12px'; options.append(sh);
    for (const k in SUPPORT) {
      const r = el('div', 'opt'), i = el('input');
      i.type = 'number'; i.min = 0; i.max = 99; i.value = o.support[k];
      i.addEventListener('change', () => { o.support[k] = Math.max(0, Math.min(99, +i.value | 0)); i.value = o.support[k]; });
      r.append(el('span', null, SUPPORT[k].name), i); options.append(r);
      bindTip(r, SUPPORT[k].name, SUPPORT[k].desc);
    }
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
  const sup = (k) => addCmd(k, SUPPORT[k].name, SUPPORT[k].key, ICONS[k], SUPPORT[k].name, SUPPORT[k].desc, () => app.armSupport(k));
  addGroup('Strike');
  sup('air'); sup('gunship'); sup('arty');
  addCmd('fire', 'Fire Mission', 'T', ICONS.fire, 'Fire Mission', 'Direct your own mortars and howitzers. Opens the artillery panel; click the map to put every section that can reach onto the target, or task, hold and release sections one by one.', () => app.toggleFireMission());
  addCmd('focus', 'Focus Fire', 'F', ICONS.focus, 'Focus Fire', 'Drag a circle on the map. Every weapon in range concentrates on targets inside it for 30 s. Press again to cancel.', () => app.armFocus());
  addGroup('Resupply &amp; Reinforce');
  sup('supply'); sup('reinforce');
  addCmd('retreat', 'Fall Back', 'R', ICONS.retreat, 'Retreat to the Keep', 'All infantry outside the Hornburg leave their posts, cross the wall walk and man the keep.', () => app.retreat());
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
  ui.toast = (text, cls = '') => { const t = el('div', 'toast ' + cls, text); feed.append(t); while (feed.children.length > 6) feed.firstChild.remove(); setTimeout(() => t.remove(), 7000); };
  ui.banner = (text, cls = '') => { bannerEl.innerHTML = ''; bannerEl.append(el('div', cls, text)); };
  ui.hint = (text) => { if (text) { hintEl.innerHTML = text; hintEl.classList.add('show'); } else hintEl.classList.remove('show'); };
  ui.clearFeed = () => { feed.innerHTML = ''; bannerEl.innerHTML = ''; };

  // ----------------------------------------------------------------- HUD
  const defCount = $('defCount'), orcCount = $('orcCount'), defBar = $('defBar'), orcBar = $('orcBar');
  const pauseBtn = document.querySelector('#speedCtl .seg[data-speed="0"]');
  const PAUSE_SVG = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 2h4v12H3zM9 2h4v12H9z" fill="currentColor"/></svg>';
  const PLAY_SVG = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 2.2v11.6L13.6 8z" fill="currentColor"/></svg>';
  const ammoPct = $('ammoPct'), ammoBar = $('ammoBar'), clock = $('clock'), dawn = $('dawn'), selinfo = $('selinfo');
  ui.updateHud = () => {
    const sim = app.sim;
    if (!sim) return;
    if (app.mode === 'setup') {
      defCount.textContent = fmt(sim.defCombat); orcCount.textContent = fmt(sim.count[ORC]);
      defBar.style.width = orcBar.style.width = '100%';
      return;
    }
    defCount.textContent = `${fmt(sim.defCombat)} / ${fmt(sim.initial[0])}`;
    orcCount.textContent = `${fmt(sim.count[ORC])} / ${fmt(sim.initial[1])}`;
    defBar.style.width = (100 * sim.defCombat / Math.max(1, sim.initial[0])) + '%';
    orcBar.style.width = (100 * sim.count[ORC] / Math.max(1, sim.initial[1])) + '%';
    const am = sim.ammoLevel();
    ammoPct.textContent = sim.opt.ammoMult > 50 ? '∞' : Math.round(am * 100) + '%';
    ammoBar.style.width = (am * 100) + '%';
    ammoPct.parentElement.classList.toggle('low', am < 0.3 && sim.opt.ammoMult <= 50);
    clock.textContent = mmss(sim.time);
    dawn.textContent = sim.opt.dawn > 0 ? `Relief in ${mmss(sim.opt.dawn - sim.time)}` : 'No relief coming';
    for (const b of document.querySelectorAll('#speedCtl .seg')) { const s = +b.dataset.speed; b.classList.toggle('active', app.paused ? s === 0 : s === app.speed); }
    // the pause button turns into a play button while the battle is paused
    if (pauseBtn.dataset.state !== String(app.paused)) {
      pauseBtn.dataset.state = String(app.paused);
      pauseBtn.innerHTML = app.paused ? PLAY_SVG : PAUSE_SVG;
      pauseBtn.title = app.paused ? 'Resume (Space)' : 'Pause (Space)';
    }
    for (const k in SUPPORT) {
      const s = sim.support[k], c = cmds[k];
      c.uses.textContent = s.left;
      const cd = Math.max(0, s.ready - sim.time);
      c.cool.style.height = s.left > 0 ? (100 * cd / s.cd) + '%' : '0';
      c.b.classList.toggle('spent', s.left <= 0);
      c.b.classList.toggle('cooling', cd > 0 && s.left > 0);
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
    // selection summary
    const sel = app.selection;
    if (!sel.length) { selinfo.hidden = true; return; }
    const by = new Map(); let am2 = 0, an = 0, hp = 0, mo = 0;
    for (const i of sel) { const d = UNITS[sim.type[i]]; by.set(d.name, (by.get(d.name) || 0) + 1); if (d.ammo) { am2 += Math.min(1, sim.ammo[i] / sim.maxAmmo(i)); an++; } hp += sim.hp[i] / d.hp; mo += sim.gMorale[sim.grp[i]]; }
    let html = `<b>${fmt(sel.length)} selected</b>`;
    for (const [n, c] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 5)) html += `<div class="line"><span>${n}</span><span>${fmt(c)}</span></div>`;
    html += `<div class="line"><span>Ammunition</span><span>${an ? Math.round(100 * am2 / an) + '%' : '—'}</span></div><div class="line"><span>Condition</span><span>${Math.round(100 * hp / sel.length)}%</span></div><div class="line"><span>Morale</span><span>${Math.round(mo / sel.length)}%</span></div>`;
    html += '<p class="tip"><b>Right-click</b> to move · <b>X</b> halt · <b>Esc</b> deselect</p>';
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
      <p class="sub">Set the field, then hold the Deep. Watch it unfold or take command.</p>
      <h4>Camera</h4>
      <div class="keys"><div><kbd>Scroll</kbd></div><span>Zoom toward the cursor</span><div><kbd>Right-drag</kbd> <kbd>W A S D</kbd></div><span>Pan the map</span><div><kbd>Q</kbd> <kbd>E</kbd> or <kbd>Middle-drag</kbd></div><span>Rotate the view</span><div><kbd>Minimap</kbd></div><span>Click to jump</span><div><kbd>F2</kbd></div><span>Performance overlay</span></div>
      <h4>Setting up</h4>
      <div class="keys"><div><kbd>Click</kbd></div><span>With a unit picked: drop a block of troops</span><div><kbd>Drag</kbd></div><span>Draw a line — along a wall top to man the battlements, or across the valley to lay wire, mines or a moat</span><div><kbd>Click formation</kbd></div><span>Select it; drag to move, <kbd>[</kbd> <kbd>]</kbd> rotate, <kbd>Del</kbd> remove</span><div><kbd>Enter</kbd></div><span>Begin the battle</span></div>
      <h4>In battle</h4>
      <div class="keys"><div><kbd>Space</kbd> <kbd>−</kbd> <kbd>+</kbd></div><span>Pause · slower · faster</span><div><kbd>1</kbd>–<kbd>5</kbd></div><span>Call support, then click the target (drag to aim an air strike)</span><div><kbd>T</kbd></div><span>Fire mission: open the artillery panel, then click a target for your mortars and howitzers (or task, hold and release each section)</span><div><kbd>F</kbd></div><span>Focus fire: drag a circle over the attackers to concentrate on</span><div><kbd>R</kbd></div><span>Fall back to the Hornburg</span><div><kbd>Z</kbd> · <kbd>V</kbd> · <kbd>L</kbd></div><span>Overlays: artillery fire zones · weapon ranges · where the fallen lie</span><div><kbd>Drag</kbd> then <kbd>Right-click</kbd></div><span>Box-select defenders and order them to move (<kbd>X</kbd> halts them)</span></div>
      <h4>What to watch for</h4>
      <div class="keys"><div>Ammunition</div><span>Troops re-arm within 60 m of a cache or supply drop. Amber dots are out of rounds.</span><div>Dead ground</div><span>Men on a wall can barely hit attackers hugging its foot. Guns on the Hornburg can — and so can grenades.</span><div>Captains</div><span>Uruk captains (banners) keep their companies steady. Kill one and those around him waver; companies that lose too many too fast break and run.</span><div>Siege works</div><span>Ladders and towers put attackers on the wall walk, sappers blow the culvert, a ram breaks the gate. Wire, moats and obstacles slow or stop them.</span></div>
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
    modal.hidden = false;
    modal.innerHTML = `<div class="dialog">
      <h1 class="${r.win ? 'win' : 'lose'}">${r.win ? 'Victory' : 'The Deep has fallen'}</h1>
      <p class="sub">${r.reason}</p>
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
