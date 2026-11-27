// The loading screen's own script: a plain script that runs before the game's modules arrive. It fades the picture in once
// it has loaded and gives start-up (src/main.js) a way to show progress and to dismiss the screen.
(() => {
  const root = document.getElementById('loading'), img = root.querySelector('.ld-art img');
  const bar = document.getElementById('ldBar'), pct = document.getElementById('ldPct'), t0 = performance.now();
  const show = () => root.classList.add('art-in');
  if (img.complete && img.naturalWidth) show(); else img.addEventListener('load', show);
  window.__loading = {
    /** Show progress (0-100), then resolve once the browser has painted it. A hidden tab paints nothing, hence the timer. */
    set(v) {
      if (bar.isConnected) { bar.style.width = v + '%'; pct.textContent = Math.round(v) + '%'; }
      return new Promise((done) => { const t = setTimeout(done, 60); requestAnimationFrame(() => { clearTimeout(t); setTimeout(done, 0); }); });
    },
    /** Dismiss the screen, but not before it has been up for `min` ms: a flash of it is worse than a short wait. */
    done(min) { setTimeout(() => root.classList.add('done'), Math.max(0, min - (performance.now() - t0))); },
  };
})();
