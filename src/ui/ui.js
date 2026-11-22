// DOM user interface: setup panels, battle HUD, toasts and dialogs.

import { UNITS, U, DEF, ORC, SUPPORT, WEAPONS, C } from '../config.js';
import { PRESETS } from '../scenarios.js';
import { makeIcon } from '../render/atlas.js';

const $ = (id) => document.getElementById(id);
export const fmt = (n) => Math.round(n).toLocaleString('en-US');
const mmss = (s) => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const I = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}${extra}</svg>`;
const ICONS = {
  air: I('<path d="M12 2.5l1.6 6.5 7.9 4.2v1.8l-7.9-2.2-.5 5 2.4 1.8v1.4L12 20l-3.5 1v-1.4l2.4-1.8-.5-5-7.9 2.2v-1.8L10.400 9z" fill="currentColor" stroke="none"/>'),
  gunship: I('<path d="M3 5.5h16M11 5.5v3"/><path d="M5 12.5c0-2.2 2.3-4 6-4s7.5 1.6 9 5l-2.200 1.800H9l-2-2.800z" fill="currentColor" stroke="none"/><path d="M7 13H2.500l-.5-3M9 18.500h9M11 15.300v3.200M15 15.300v3.200"/>'),
  arty: I('<circle cx="12" cy="12" r="7.500"/><path d="M12 1.500v6M12 16.500v6M1.500 12h6M16.500 12h6"/><circle cx="12" cy="12" r="1.600" fill="currentColor"/>'),
  supply: I('<path d="M4 8.500a8 8 0 0116 0z" fill="currentColor" stroke="none"/><path d="M4 8.500l6 7M20 8.500l-6 7M12 8.500v7"/><rect x="8.500" y="15.500" width="7" height="6" rx="1" fill="currentColor" stroke="none"/>'),
  reinforce: I('<circle cx="6" cy="8" r="2.200" fill="currentColor" stroke="none"/><circle cx="12" cy="6.500" r="2.400" fill="currentColor" stroke="none"/><circle cx="18" cy="8" r="2.200" fill="currentColor" stroke="none"/><path d="M2.500 19c0-4 1.500-6.500 3.500-6.500s2.300 1.200 2.800 2.500M21.500 19c0-4-1.500-6.500-3.500-6.500s-2.300 1.200-2.800 2.500M7.500 20.500c0-5.500 2-8.500 4.500-8.500s4.500 3 4.500 8.500"/>'),
  focus: I('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="3.200"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>'),
  hold: I('<path d="M6 19.500l2.500-11 3 .7-2.500 11z" fill="currentColor" stroke="none"/><path d="M4 20.500h9"/><circle cx="16.500" cy="8" r="5"/><path d="M13 11.500l7-7"/>'),
  retreat: I('<path d="M11 21V9.500l2-1.500 1.200 1.500h3.600L19 8l2 1.500V21h-3.500v-3.500a1.500 1.500 0 00-3 0V21z" fill="currentColor" stroke="none"/><path d="M2.500 14h6M6 11l3 3-3 3"/>'),
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
    for (const d of UNITS) {
      if (d.team !== tab || d.hidden) continue;
      const b = el('button', 'card ' + (d.team === DEF ? 'def' : 'orc') + (app.tool && app.tool.kind === 'place' && app.tool.type === d.key ? ' active' : ''));
      const ic = el('div', 'ico'); ic.append(icon(d, 44));
      const tx = el('div', null, `<b>${d.name}</b><span>${d.desc}</span>`);
      b.append(ic, tx);
      b.addEventListener('click', () => { app.selectPlaceTool(app.tool && app.tool.type === d.key ? null : d.key); b.blur(); });
      palette.append(b);
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
  const roster = $('roster');
  ui.refreshRoster = () => {
    roster.innerHTML = '';
    for (const team of [DEF, ORC]) {
      const byType = new Map();
      for (const g of app.setup.groups) if (g.team === team) byType.set(g.type, (byType.get(g.type) || 0) + g.count);
      let total = 0; for (const v of byType.values()) total += v;
      const head = el('div', 'side-head ' + (team === DEF ? 'def' : 'orc'), `<div>${team === DEF ? 'DEFENDERS' : 'ATTACKERS'} <span>· ${fmt(total)}</span></div>`);
      const clr = el('button', null, 'Clear'); clr.addEventListener('click', () => app.clearTeam(team));
      if (total) head.append(clr);
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
    addNum('Units', g.count, 1, 20000, (v) => app.editGroup(g, { count: v | 0 }));
    if (g.team === ORC) addNum('Advance after (s)', g.delay || 0, 0, 3600, (v) => app.editGroup(g, { delay: v }));
    const btns = el('div', 'btns');
    const mk = (t, fn, cls) => { const b = el('button', cls, t); b.addEventListener('click', fn); btns.append(b); };
    mk('⟲ Rotate', () => app.editGroup(g, { ang: g.ang - Math.PI / 12, w: g.w || 0 }));
    mk('Rotate ⟳', () => app.editGroup(g, { ang: g.ang + Math.PI / 12 }));
    mk('Delete', () => app.removeGroup(g), 'danger');
    insp.append(btns, el('p', 'tip', 'Drag the formation on the map to move it. <b>Del</b> removes it.'));
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
    sel('Horde breaks at', o.rout, [[0, 'Never — to the last'], [0.05, '5% remaining'], [0.08, '8% remaining'], [0.15, '15% remaining'], [0.25, '25% remaining']], (v) => { o.rout = v; }, 'The attackers rout and flee when this little of the starting host is left.');
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
  const addCmd = (id, name, key, svg, title, body, fn) => {
    const b = el('button', 'cmd', `<span class="key">${key}</span><span class="uses"></span>${svg}<span class="name">${name}</span><i class="cool"></i>`);
    b.addEventListener('click', () => { fn(); b.blur(); });
    bindTip(b, `${title} <kbd>${key}</kbd>`, body);
    cmdbar.append(b);
    cmds[id] = { b, uses: b.querySelector('.uses'), cool: b.querySelector('.cool') };
  };
  for (const k in SUPPORT) addCmd(k, SUPPORT[k].name, SUPPORT[k].key, ICONS[k], SUPPORT[k].name, SUPPORT[k].desc, () => app.armSupport(k));
  cmdbar.append(el('div', 'sep'));
  addCmd('focus', 'Focus Fire', 'F', ICONS.focus, 'Focus Fire', 'Drag a circle on the map. Every weapon in range concentrates on targets inside it for 30 s. Press again to cancel.', () => app.armFocus());
  addCmd('hold', 'Hold Mortars', 'H', ICONS.hold, 'Hold Indirect Fire', 'Mortars and howitzers cease fire to save shells until you release them.', () => app.toggleHold());
  addCmd('retreat', 'Fall Back', 'R', ICONS.retreat, 'Retreat to the Keep', 'All infantry outside the Hornburg abandon their posts and run for its walls.', () => app.retreat());

  // ------------------------------------------------------ toasts & hints
  const feed = $('feed'), bannerEl = $('banner'), hintEl = $('hint');
  ui.toast = (text, cls = '') => { const t = el('div', 'toast ' + cls, text); feed.append(t); while (feed.children.length > 6) feed.firstChild.remove(); setTimeout(() => t.remove(), 7000); };
  ui.banner = (text, cls = '') => { bannerEl.innerHTML = ''; bannerEl.append(el('div', cls, text)); };
  ui.hint = (text) => { if (text) { hintEl.innerHTML = text; hintEl.classList.add('show'); } else hintEl.classList.remove('show'); };
  ui.clearFeed = () => { feed.innerHTML = ''; bannerEl.innerHTML = ''; };

  // ----------------------------------------------------------------- HUD
  const defCount = $('defCount'), orcCount = $('orcCount'), defBar = $('defBar'), orcBar = $('orcBar');
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
    cmds.hold.b.classList.toggle('on', sim.holdIndirect);
    cmds.hold.b.querySelector('.name').textContent = sim.holdIndirect ? 'Mortars Held' : 'Hold Mortars';
    // selection summary
    const sel = app.selection;
    if (!sel.length) { selinfo.hidden = true; return; }
    const by = new Map(); let am2 = 0, an = 0, hp = 0;
    for (const i of sel) { const d = UNITS[sim.type[i]]; by.set(d.name, (by.get(d.name) || 0) + 1); if (d.ammo) { am2 += Math.min(1, sim.ammo[i] / sim.maxAmmo(i)); an++; } hp += sim.hp[i] / d.hp; }
    let html = `<b>${fmt(sel.length)} selected</b>`;
    for (const [n, c] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 5)) html += `<div class="line"><span>${n}</span><span>${fmt(c)}</span></div>`;
    html += `<div class="line"><span>Ammunition</span><span>${an ? Math.round(100 * am2 / an) + '%' : '—'}</span></div><div class="line"><span>Condition</span><span>${Math.round(100 * hp / sel.length)}%</span></div>`;
    html += '<p class="tip"><b>Right-click</b> to move · <b>S</b> stop · <b>Esc</b> deselect</p>';
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
      <div class="keys"><div><kbd>Scroll</kbd></div><span>Zoom toward the cursor</span><div><kbd>Right-drag</kbd> <kbd>W A S D</kbd></div><span>Pan the map</span><div><kbd>Minimap</kbd></div><span>Click to jump</span></div>
      <h4>Setting up</h4>
      <div class="keys"><div><kbd>Click</kbd></div><span>With a unit picked: drop a block of troops</span><div><kbd>Drag</kbd></div><span>Draw a firing line — along a wall top to man the battlements</span><div><kbd>Click formation</kbd></div><span>Select it; drag to move, <kbd>Q</kbd> <kbd>E</kbd> rotate, <kbd>Del</kbd> remove</span><div><kbd>Enter</kbd></div><span>Begin the battle</span></div>
      <h4>In battle</h4>
      <div class="keys"><div><kbd>Space</kbd> <kbd>−</kbd> <kbd>+</kbd></div><span>Pause · slower · faster</span><div><kbd>1</kbd>–<kbd>5</kbd></div><span>Call support, then click the target (drag to aim an air strike)</span><div><kbd>F</kbd></div><span>Focus fire: drag a circle over the enemy you want dead</span><div><kbd>H</kbd></div><span>Hold / release mortars and howitzers</span><div><kbd>R</kbd></div><span>Fall back to the Hornburg</span><div><kbd>Drag</kbd> then <kbd>Right-click</kbd></div><span>Box-select defenders and order them to move</span></div>
      <h4>What to watch for</h4>
      <div class="keys"><div>Ammunition</div><span>Troops re-arm within 45 m of a cache or supply drop. Dry rifles mean bayonets.</span><div>Sappers</div><span>They run for the culvert with a blasting charge. Marksmen prioritise them.</span><div>Ladders &amp; rams</div><span>Ladders open the wall top; a ram on the causeway breaks the gate.</span><div>Trolls</div><span>Rifles barely scratch them. Rockets, tanks and artillery do.</span></div>
      <div class="actions"><button class="primary" id="mClose">Got it</button></div></div>`;
    $('mClose').addEventListener('click', ui.hideModal);
  };

  ui.showEnd = (sim) => {
    const r = sim.result, st = sim.stats;
    modal.dataset.dismiss = '0';
    const kills = Object.entries(st.kills).filter(([k]) => k !== 'other').sort((a, b) => b[1] - a[1]);
    const totalK = sim.initial[1] - sim.count[ORC];
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
        <div class="stat"><small>Defenders lost</small><b>${fmt(totalL)} <span style="font-size:12px;color:var(--dim)">/ ${fmt(sim.initial[0])}</span></b></div>
        <div class="stat"><small>Exchange ratio</small><b>${totalL ? (totalK / totalL).toFixed(1) + ' : 1' : '—'}</b></div>
      </div>
      <div class="cols">
        <div><h3>Kills by weapon</h3>${kills.slice(0, 10).map(([k, v]) => `<div class="krow"><span>${wname(k)}</span><div class="kb"><i style="width:${(100 * v) / maxK}%"></i></div><span>${fmt(v)}</span></div>`).join('') || '<div class="empty">None</div>'}</div>
        <div><h3>Defender losses</h3>${lost.slice(0, 10).map(([k, v]) => `<div class="krow loss"><span>${UNITS[U[k]].name}</span><div class="kb"><i style="width:${(100 * v) / maxL}%"></i></div><span>${fmt(v)}</span></div>`).join('') || '<div class="empty">Not a single soldier.</div>'}
        <h3 style="margin-top:14px">Fortifications</h3><div class="krow"><span>Sections breached</span><div></div><span>${st.breaches}</span></div><div class="krow"><span>Rounds fired</span><div></div><span>${fmt(st.shots)}</span></div></div>
      </div>
      <div class="actions"><button id="mView">Survey the field</button><button id="mEdit">Change the setup</button><button class="primary" id="mAgain">Fight again</button></div></div>`;
    $('mView').addEventListener('click', ui.hideModal);
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
