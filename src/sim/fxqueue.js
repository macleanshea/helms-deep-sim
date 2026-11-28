// The effects a simulation asks for, written down instead of carried out.
//
// The simulation reports what happens (a shot, a blast, a death, a sound) through an `fx` object with
// the methods listed below. Handing it an FxQueue instead of the real thing records each call as plain
// data; `replay` then plays them, in order, on the real one. That keeps the simulation free of the
// renderer, and means the two need not run in the same place or at the same moment: a queue can be
// sent from a worker and replayed on the page.

/** Every call the simulation makes on its `fx` (see the "sim-facing API" of render/fx.js). */
export const FX_CALLS = ['tracer', 'muzzle', 'explosion', 'melee', 'death', 'dust', 'breach', 'spark', 'pickup', 'trail', 'claymore', 'sound'];
/** Most calls kept: stepping a battle with nothing playing them back must not grow without end. */
const LIMIT = 60000;

export class FxQueue {
  constructor() { this.calls = []; this.dropped = 0; }
  /** Play every recorded call on `fx`, oldest first, and forget them. */
  replay(fx) {
    const c = this.calls;
    for (let i = 0; i < c.length; i++) { const a = c[i]; fx[a[0]](a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]); }
    c.length = 0; this.dropped = 0;
  }
  clear() { this.calls.length = 0; this.dropped = 0; }
}
for (const name of FX_CALLS) {
  FxQueue.prototype[name] = function (a, b, c, d, e, f, g, h) {
    if (this.calls.length >= LIMIT) { this.dropped++; return; }
    // a wall section is passed whole when it falls: keep a copy of its plain fields, as it stood at that moment
    this.calls.push([name, name === 'breach' ? { ...a } : a, b, c, d, e, f, g, h]);
  };
}
