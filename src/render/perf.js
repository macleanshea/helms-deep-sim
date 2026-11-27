// Performance overlay and benchmark.
//   ?perf   (or F2 / `)  shows frame time, CPU and GPU time per stage, triangles and draw calls
//   ?bench              fast-forwards the largest scenario to its final assault, then steps through a
//                       fixed set of views and reports each
// GPU times need the EXT_disjoint_timer_query_webgl2 extension (desktop Chrome and Edge have it).

const fmtK = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n)));
const TIERS = ['full models', 'stand-ins', 'boxes', 'dots'];
/** Triangles a frame may spend on units and their shadows; the levels of detail are tuned to stay under it. */
export const UNIT_TRI_BUDGET = 2.5e6;
/** Battle time (s) the benchmark fast-forwards to: the last and heaviest wave of the largest scenario is arriving. */
const BENCH_TIME = 880;

export class Perf {
  constructor(app, renderer) {
    this.app = app; this.r = renderer; this.on = false;
    this.dts = new Float32Array(240); this.k = 0; this.n = 0; this.simMs = 0; this.t = 0;
    this.el = document.createElement('pre');
    this.el.id = 'perf'; this.el.hidden = true;
    document.getElementById('app').appendChild(this.el);
    this.benchRows = null;
    // after a benchmark: a button that puts the table, and what it was measured on, on the clipboard
    this.copyBtn = document.createElement('button');
    this.copyBtn.id = 'perfCopy'; this.copyBtn.hidden = true; this.copyBtn.textContent = 'Copy results';
    this.copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(this.report || ''); this.copyBtn.textContent = 'Copied'; }
      catch { this.copyBtn.textContent = 'Could not copy: select the text instead'; this.el.style.pointerEvents = 'auto'; this.el.style.userSelect = 'text'; }
    });
    document.getElementById('app').appendChild(this.copyBtn);
  }

  toggle(on = !this.on) { this.on = on; this.r.perfOn = on; this.el.hidden = !on; }

  /** Called once per frame with the real frame interval (s) and the time spent stepping the sim (ms). */
  frame(rdt, simMs) {
    this.dts[this.k] = rdt * 1000; this.k = (this.k + 1) % this.dts.length; if (this.n < this.dts.length) this.n++;
    this.simMs = this.simMs * 0.9 + simMs * 0.1;
    if (!this.on) return;
    if ((this.t += rdt) < 0.25) return;
    this.t = 0;
    this.el.textContent = this.text();
  }

  /**
   * Median, mean and 99th-percentile frame time (ms) over the last `count` frames, and how many of them ran long:
   * over 20 ms is a visible hitch at 60 fps, over 33 ms is a dropped frame even at 30.
   */
  frameStats(count = this.n) {
    const m = Math.min(count, this.n), a = new Float32Array(m);
    for (let i = 0; i < m; i++) a[i] = this.dts[(this.k - 1 - i + this.dts.length * 2) % this.dts.length];
    a.sort();
    let sum = 0, over20 = 0, over33 = 0; for (const v of a) { sum += v; if (v > 20) over20++; if (v > 33.4) over33++; }
    return { med: a[m >> 1] || 0, mean: m ? sum / m : 0, p99: a[Math.min(m - 1, Math.floor(m * 0.99))] || 0, over20, over33, frames: m };
  }

  snapshot() {
    const s = this.r.stats, t = s.tris, f = this.frameStats();
    const gpu = Object.values(s.gpu).reduce((a, b) => a + b, 0);
    return {
      frameMs: f.med, worstMs: f.p99, fps: f.mean ? 1000 / f.mean : 0, over20: f.over20, over33: f.over33, frames: f.frames, simMs: this.simMs, renderMs: s.cpu, gpuMs: Object.keys(s.gpu).length ? gpu : null, gpu: { ...s.gpu },
      tris: t.terrain + t.fort + t.units + t.shadows + t.fx, unitTris: t.units + t.shadows, fortTris: t.fort, draws: s.draws, units: s.units, tier: s.tier,
    };
  }

  text() {
    const s = this.r.stats, t = s.tris, p = this.snapshot(), c = this.r.canvas;
    const L = [];
    L.push(`${p.fps.toFixed(0)} fps   ${p.frameMs.toFixed(1)} ms   worst ${p.worstMs.toFixed(1)} ms      ${this.r.quality} · ${c.width}×${c.height} · ${TIERS[p.tier]}`);
    L.push(`long frames in the last ${p.frames}: ${p.over20} over 20 ms, ${p.over33} over 33 ms`);
    L.push(`cpu   sim ${p.simMs.toFixed(1)}   render ${p.renderMs.toFixed(1)} ms`);
    if (p.gpuMs != null) L.push(`gpu   ${Object.entries(p.gpu).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('   ')}   = ${p.gpuMs.toFixed(1)} ms`);
    else L.push(s.gpuOk ? 'gpu   measuring…' : 'gpu   timing is not available in this browser');
    L.push(`tris  terrain ${fmtK(t.terrain)}   fortress ${fmtK(t.fort)}   units ${fmtK(t.units)}   shadows ${fmtK(t.shadows)}   effects ${fmtK(t.fx)}   = ${fmtK(p.tris)}`);
    L.push(`      unit budget ${Math.round((p.unitTris / UNIT_TRI_BUDGET) * 100)}% of ${fmtK(UNIT_TRI_BUDGET)}   ${p.draws} draw calls   ${fmtK(p.units)} units in view`);
    if (this.benchRows) {
      L.push('', ...this.benchTable());
    }
    return L.join('\n');
  }

  /** The benchmark's rows as lines of text. */
  benchTable() {
    const L = ['benchmark                 frame   worst   >20  >33    gpu   render   tris   units  draws  detail'];
    for (const b of this.benchRows) L.push(`${b.view.padEnd(24)} ${b.frameMs.toFixed(1).padStart(6)}  ${b.worstMs.toFixed(1).padStart(6)}  ${String(b.over20).padStart(4)} ${String(b.over33).padStart(4)}  ${(b.gpuMs == null ? '—' : b.gpuMs.toFixed(1)).padStart(5)}  ${b.renderMs.toFixed(1).padStart(6)}  ${fmtK(b.tris).padStart(6)}  ${fmtK(b.units).padStart(5)}  ${String(b.draws).padStart(5)}  ${TIERS[b.tier]}`);
    return L;
  }

  /** What the numbers were measured on: without it a benchmark table cannot be compared with another. */
  machine() {
    const gl = this.r.gl, c = this.r.canvas, ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return [`gpu      ${gpu}`, `browser  ${navigator.userAgent}`, `canvas   ${c.width}×${c.height} (device pixel ratio ${window.devicePixelRatio}), quality ${this.r.quality}, ${navigator.hardwareConcurrency || '?'} threads`];
  }

  /**
   * Step through the fixed benchmark views of the busiest preset. Resolves with one row per view.
   * `settle` frames are skipped after each camera move, then `frames` are sampled.
   */
  async bench(settle = 20, frames = 90) {
    const app = this.app, raf = () => new Promise((r) => requestAnimationFrame(r));
    this.toggle(true);
    if (app.mode === 'battle') app.backToSetup();
    app.loadPreset('benchmark', false, true); app.startBattle(); // the heaviest load there is: thirty thousand
    document.getElementById('modal').hidden = true;
    app.paused = true;
    // fast-forward to the final assault, when the field is fullest (the horde comes on in waves)
    const sim = app.sim, until = BENCH_TIME;
    while (sim.time < until && !sim.result) {
      for (let k = 0; k < 150 && sim.time < until && !sim.result; k++) { sim.step(); sim.events.length = 0; }
      this.el.textContent = `benchmark: fast-forwarding the battle… ${Math.round((sim.time / until) * 100)}%`;
      await raf();
    }
    const cells = new Map();
    for (let i = 0; i < sim.n; i++) if (sim.alive[i] && sim.team[i] === 1) { const k = ((sim.y[i] / 80) | 0) * 100 + ((sim.x[i] / 80) | 0); cells.set(k, (cells.get(k) || 0) + 1); }
    let bk = 0, bv = 0; for (const [k, v] of cells) if (v > bv) { bv = v; bk = k; }
    const hx = (bk % 100) * 80 + 40, hy = ((bk / 100) | 0) * 80 + 40, keep = app.keepCentre;
    const views = [['whole map', null], ['horde, zoom 2.5', [hx, hy, 2.5]], ['horde, zoom 3.5', [hx, hy, 3.5]], ['horde, zoom 6', [hx, hy, 6]], ['horde, zoom 11', [hx, hy, 11]], ['horde, zoom 14', [hx, hy, 14]], ['horde, zoom 24', [hx, hy, 24]], ['horde, zoom 36', [hx, hy, 36]], ['keep, zoom 4', [keep[0], keep[1], 4]], ['keep, zoom 12', [keep[0], keep[1], 12]]];
    const rows = [];
    for (const [view, c] of views) {
      if (c) { app.cam.x = c[0]; app.cam.y = c[1]; app.cam.zoom = c[2]; } else app.homeView();
      for (let k = 0; k < settle; k++) await raf();
      this.n = 0;
      for (let k = 0; k < frames; k++) await raf();
      rows.push({ view, ...this.snapshot() });
      this.benchRows = rows; this.el.textContent = this.text();
    }
    console.table(rows.map((b) => ({ view: b.view, 'frame ms': +b.frameMs.toFixed(1), 'worst ms': +b.worstMs.toFixed(1), 'over 20 ms': b.over20, 'over 33 ms': b.over33, 'gpu ms': b.gpuMs == null ? 'n/a' : +b.gpuMs.toFixed(1), 'render cpu ms': +b.renderMs.toFixed(1), triangles: Math.round(b.tris), 'unit triangles': Math.round(b.unitTris), units: b.units, detail: TIERS[b.tier] })));
    window.__bench = rows;
    this.report = ['Helm\u2019s Deep benchmark', ...this.machine(), `scene    ${app.presetKey} at ${Math.round(sim.time)} s, ${sim.count[0] + sim.count[1]} alive; frame times in ms over ${frames} frames a view`, '', ...this.benchTable()].join('\n');
    window.__benchText = this.report;
    this.copyBtn.hidden = false; this.copyBtn.textContent = 'Copy results';
    return rows;
  }
}
