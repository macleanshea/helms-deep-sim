// Small procedural sound bank built on WebAudio — no asset files.
// Every sound is a shaped burst of filtered noise and/or a pitched sweep.

const DEFS = {
  //            noise: [filterType, f0, f1, Q]      tone: [wave, f0, f1]       dur    gain  gap(s) between repeats
  rifle:      { n: ['bandpass', 2400, 900, 1.2],  d: 0.07, g: 0.22, gap: 0.035 },
  mg:         { n: ['bandpass', 1500, 600, 1.0],  d: 0.06, g: 0.24, gap: 0.045 },
  sniper:     { n: ['bandpass', 3200, 500, 0.8],  d: 0.22, g: 0.4,  gap: 0.12 },
  autocannon: { n: ['lowpass', 1400, 300, 1],     t: ['square', 150, 60], d: 0.11, g: 0.3, gap: 0.07 },
  thump:      { t: ['sine', 320, 90],             n: ['lowpass', 900, 200, 1], d: 0.14, g: 0.3, gap: 0.08 },
  mortar:     { t: ['sine', 220, 50],             n: ['lowpass', 700, 150, 1], d: 0.28, g: 0.45, gap: 0.15 },
  cannon:     { t: ['sine', 130, 32],             n: ['lowpass', 1800, 120, 0.7], d: 0.7, g: 0.75, gap: 0.2 },
  rocket:     { n: ['bandpass', 500, 3000, 1.5],  d: 0.6, g: 0.3, gap: 0.2, slow: true },
  pop:        { n: ['lowpass', 1600, 200, 1],     t: ['sine', 180, 60], d: 0.12, g: 0.22, gap: 0.05 },
  blast:      { n: ['lowpass', 1500, 90, 0.7],    t: ['sine', 110, 34], d: 0.6, g: 0.6, gap: 0.09 },
  boom:       { n: ['lowpass', 1100, 60, 0.7],    t: ['sine', 85, 26], d: 1.3, g: 0.95, gap: 0.12 },
  breach:     { n: ['lowpass', 900, 40, 0.6],     t: ['sine', 70, 20], d: 2.6, g: 1.2, gap: 0.5 },
  collapse:   { n: ['lowpass', 500, 60, 0.6],     d: 2.2, g: 0.9, gap: 0.5, slow: true },
  gatebreak:  { n: ['bandpass', 700, 150, 0.8],   t: ['sawtooth', 90, 40], d: 1.4, g: 0.9, gap: 0.5 },
  thud:       { t: ['sine', 95, 38],              n: ['lowpass', 400, 100, 1], d: 0.3, g: 0.5, gap: 0.12 },
  ram:        { t: ['sine', 75, 30],              n: ['lowpass', 600, 80, 1], d: 0.5, g: 0.9, gap: 0.3 },
  clash:      { n: ['bandpass', 5200, 3800, 6],   d: 0.05, g: 0.1, gap: 0.05 },
  crack:      { n: ['bandpass', 1200, 300, 2],    d: 0.25, g: 0.4, gap: 0.2 },
  ladder:     { n: ['bandpass', 900, 500, 3],     d: 0.18, g: 0.4, gap: 0.3 },
  catapult:   { n: ['bandpass', 400, 1400, 2],    d: 0.4, g: 0.35, gap: 0.3, slow: true },
  fuse:       { n: ['highpass', 4000, 6000, 1],   d: 1.4, g: 0.15, gap: 0.5 },
  incoming:   { t: ['sine', 1900, 500],           d: 0.6, g: 0.1, gap: 0.2 },
  jet:        { n: ['bandpass', 300, 2600, 0.9],  d: 3.6, g: 0.8, gap: 1, slow: true, swell: true },
  cargo:      { n: ['lowpass', 260, 180, 1],      t: ['sawtooth', 70, 62], d: 7, g: 0.4, gap: 2, swell: true },
  helo:       { n: ['lowpass', 320, 260, 1],      d: 6, g: 0.6, gap: 2, chop: 13, swell: true },
  click:      { t: ['sine', 880, 660],            d: 0.05, g: 0.12, gap: 0.02 },
  deny:       { t: ['square', 180, 140],          d: 0.12, g: 0.1, gap: 0.1 },
  confirm:    { t: ['sine', 520, 780],            d: 0.12, g: 0.14, gap: 0.05 },
};

export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.last = {}; this.volume = 0.7; }

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // low battle rumble that follows the size of the fight
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 220; lp.Q.value = 0.5;
    this.roar = ctx.createGain(); this.roar.gain.value = 0;
    src.connect(lp); lp.connect(this.roar); this.roar.connect(this.master); src.start();
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume; }
  setRoar(v) { if (this.roar) this.roar.gain.setTargetAtTime(Math.min(0.16, v), this.ctx.currentTime, 0.6); }

  play(name, vol = 1, pan = 0) {
    const ctx = this.ctx, def = DEFS[name];
    if (!ctx || this.muted || !def || vol < 0.02 || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - (this.last[name] || -9) < def.gap) return;
    this.last[name] = now;
    const dur = def.d * (0.9 + Math.random() * 0.2);
    const out = ctx.createGain();
    const peak = def.g * vol;
    if (def.swell) { out.gain.setValueAtTime(0.0001, now); out.gain.exponentialRampToValueAtTime(peak, now + dur * 0.45); out.gain.exponentialRampToValueAtTime(0.0001, now + dur); }
    else { out.gain.setValueAtTime(peak, now); out.gain.exponentialRampToValueAtTime(0.0001, now + dur); }
    let dest = out;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan * 0.8; out.connect(p); p.connect(this.master); } else out.connect(this.master);
    if (def.chop) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain(), am = ctx.createGain();
      lfo.type = 'square'; lfo.frequency.value = def.chop; lg.gain.value = 0.5; am.gain.value = 0.5;
      lfo.connect(lg); lg.connect(am.gain); am.connect(out); lfo.start(now); lfo.stop(now + dur);
      dest = am;
    }
    const pitch = 0.88 + Math.random() * 0.24;
    if (def.n) {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = def.n[0]; f.Q.value = def.n[3];
      f.frequency.setValueAtTime(def.n[1] * pitch, now);
      f.frequency.exponentialRampToValueAtTime(Math.max(30, def.n[2] * pitch), now + dur * (def.slow ? 1 : 0.7));
      src.connect(f); f.connect(dest);
      src.start(now, Math.random() * 1.5); src.stop(now + dur + 0.02);
    }
    if (def.t) {
      const o = ctx.createOscillator(); o.type = def.t[0];
      o.frequency.setValueAtTime(def.t[1] * pitch, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, def.t[2] * pitch), now + dur * 0.8);
      const g = ctx.createGain(); g.gain.value = def.n ? 0.8 : 1;
      o.connect(g); g.connect(dest); o.start(now); o.stop(now + dur + 0.02);
    }
  }

  /** The Horn of Helm Hammerhand. */
  horn() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const out = ctx.createGain(); out.connect(this.master);
    out.gain.setValueAtTime(0.0001, now); out.gain.exponentialRampToValueAtTime(0.32, now + 0.5); out.gain.setValueAtTime(0.32, now + 2.2); out.gain.exponentialRampToValueAtTime(0.0001, now + 3.6);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, now); lp.frequency.linearRampToValueAtTime(1300, now + 1.2); lp.Q.value = 2;
    lp.connect(out);
    for (const [f, g] of [[98, 1], [98.7, 0.7], [147, 0.5], [196, 0.3]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.94, now); o.frequency.linearRampToValueAtTime(f, now + 0.35);
      const og = ctx.createGain(); og.gain.value = g * 0.4;
      o.connect(og); og.connect(lp); o.start(now); o.stop(now + 3.7);
    }
  }
}
