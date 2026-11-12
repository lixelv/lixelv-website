// Core of the page: theme, the pixel-field hero, scroll effects, marquee.
(() => {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  let cFg = '#fff', cDot = '#555', cAcc = '#0f0', cLine = '#333', cMuted = '#888';

  /* ---------- theme ---------- */
  const themeBtn = $('#theme');
  const isLight = () => root.dataset.theme ? root.dataset.theme === 'light' : matchMedia('(prefers-color-scheme: light)').matches;
  /* 3D Perlin noise: the field shows a 2D slice that drifts along the third axis. */
  const PERM = new Uint8Array(512);
  { const p = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0, t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, a, b, c) => { h &= 15; const u = h < 8 ? a : b, v = h < 4 ? b : h === 12 || h === 14 ? a : c; return (h & 1 ? -u : u) + (h & 2 ? -v : v); };
  function noise3(px, py, pz) {
    const X = Math.floor(px) & 255, Y = Math.floor(py) & 255, Z = Math.floor(pz) & 255;
    px -= Math.floor(px); py -= Math.floor(py); pz -= Math.floor(pz);
    const u = fade(px), v = fade(py), w = fade(pz);
    const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z, B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
    const l = (t, a, b) => a + t * (b - a);
    return l(w,
      l(v, l(u, grad(PERM[AA], px, py, pz), grad(PERM[BA], px - 1, py, pz)), l(u, grad(PERM[AB], px, py - 1, pz), grad(PERM[BB], px - 1, py - 1, pz))),
      l(v, l(u, grad(PERM[AA + 1], px, py, pz - 1), grad(PERM[BA + 1], px - 1, py, pz - 1)), l(u, grad(PERM[AB + 1], px, py - 1, pz - 1), grad(PERM[BB + 1], px - 1, py - 1, pz - 1))));
  }
  const WAVE = .7;                                  // ring speed, px per ms
  // The physics runs in fixed ticks, whatever the screen's refresh rate is, and the picture is
  // interpolated between two ticks. The per-tick constants were tuned on a 144 Hz screen.
  const TICK = 1000 / 144;
  let ripples = [], emitting = false, emitMask = 2, lastEmit = 0, pvx = 0, pvy = 0, pt = 0;
  const fields = [];                                // the small dot fields behind the demos

  function readColors() {
    const cs = getComputedStyle(root), g = n => cs.getPropertyValue(n).trim();
    cFg = g('--fg'); cDot = g('--dot'); cAcc = g('--accent'); cLine = g('--line'); cMuted = g('--muted');
    if (reduce) draw();
    fields.forEach(f => f.paint());
  }
  const syncTheme = () => { themeBtn.textContent = isLight() ? 'Dark' : 'Light'; readColors(); };
  try { const s = localStorage.getItem('theme'); if (s) root.dataset.theme = s; } catch (e) {}
  themeBtn.addEventListener('click', () => {
    root.dataset.theme = isLight() ? 'dark' : 'light';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
    syncTheme();
  });

  /* ---------- pixel field: the name, drawn in live pixels ---------- */
  const hero = $('.hero'), cv = $('#field'), ctx = cv.getContext('2d');
  let W = 0, H = 0, gap = 12, n = 0, t0 = 0, raf = 0, visible = true, intro = !reduce;
  let hx, hy, x, y, lx, ly, vx, vy, on, sx, sy, delay;   // lx, ly: where a dot was one tick ago
  let mx = -9999, my = -9999, fmx = -9999, fmy = -9999, grav = false, idle = 0;
  let cmx = -9999, cmy = -9999, ghostOn = false;      // the pointer in window coordinates; mx, my are in the field's
  let simNow = 0, lastFrame = 0, acc = 0;            // the simulation's own clock, in ms

  function build() {
    const r = hero.getBoundingClientRect();
    W = r.width; H = r.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gap = Math.max(7, Math.min(14, W / 100));
    const cols = Math.floor(W / gap), rows = Math.floor(H / gap);
    const ox = (W - (cols - 1) * gap) / 2, oy = (H - (rows - 1) * gap) / 2;
    const S = 4, o = document.createElement('canvas');
    o.width = cols * S; o.height = rows * S;
    const c = o.getContext('2d', { willReadFrequently: true });
    const font = s => `800 ${s}px Geist, "Arial Black", system-ui, sans-serif`;
    c.font = font(100);
    const w100 = c.measureText('lixelv').width;
    const fs = Math.min(100 * (cols * S * (W < 720 ? .88 : .72)) / w100, rows * S * .5);
    c.font = font(fs); c.textAlign = 'center'; c.fillStyle = '#000';
    c.fillText('lixelv', o.width / 2, o.height * .47 + fs * .36);
    const img = c.getImageData(0, 0, o.width, o.height).data;
    n = cols * rows;
    hx = new Float32Array(n); hy = new Float32Array(n); x = new Float32Array(n); y = new Float32Array(n);
    lx = new Float32Array(n); ly = new Float32Array(n);
    vx = new Float32Array(n); vy = new Float32Array(n); sx = new Float32Array(n); sy = new Float32Array(n);
    delay = new Float32Array(n); on = new Uint8Array(n);
    for (let r2 = 0, i = 0; r2 < rows; r2++) for (let c2 = 0; c2 < cols; c2++, i++) {
      hx[i] = ox + c2 * gap; hy[i] = oy + r2 * gap;
      on[i] = img[((r2 * S + (S >> 1)) * o.width + c2 * S + (S >> 1)) * 4 + 3] > 120 ? 1 : 0;
      const ang = Math.random() * 6.283, mag = .3 + Math.random();
      sx[i] = Math.cos(ang) * mag; sy[i] = Math.sin(ang) * mag - .6;
      if (on[i] && intro) {
        x[i] = Math.random() * W; y[i] = Math.random() * H;
        delay[i] = 250 + (c2 / cols) * 700 + Math.random() * 500;
      } else { x[i] = hx[i]; y[i] = hy[i]; }
    }
    lx.set(x); ly.set(y);
    t0 = simNow;
  }

  /** One tick of the simulation. The pointer is swept from (ax, ay) to (bx, by), so a fast
   *  stroke pushes everything along its path, not only what is under the sampled positions. */
  function step(ax, ay, bx, by, has, p) {
    const t = simNow - t0, sc = p * p * 420;
    const R = Math.max(90, gap * 9) * (grav ? 2.6 : 1);   // held left button: the same push, wider
    const R2 = R * R, maxR = Math.max(W, H) * .95;
    if (emitting && has && simNow - lastEmit >= 150) {   // held right button: a steady train of rings
      lastEmit = simNow;
      // A ring keeps the pointer's motion, capped at a third of the wave speed.
      const fresh = performance.now() - pt < 90;
      let ix = fresh ? pvx : 0, iy = fresh ? pvy : 0;
      const sp = Math.hypot(ix, iy), cap = WAVE / 3;
      if (sp > cap) { ix *= cap / sp; iy *= cap / sp; }
      ripples.push({ x: bx, y: by, t: simNow, vx: ix, vy: iy });
    }
    // A ring is gone once its strength has faded to nothing. (Left alone it would go on with a
    // negative strength and pull the far corners back into colour.)
    if (ripples.length && (simNow - ripples[0].t) * WAVE >= maxR) ripples = ripples.filter(rp => (simNow - rp.t) * WAVE < maxR);
    for (const rp of ripples) {
      const age = simNow - rp.t;
      rp.r = age * WAVE; rp.cx = rp.x + rp.vx * age; rp.cy = rp.y + rp.vy * age; rp.p = 1.9 * (1 - rp.r / maxR);
      const lo = Math.max(0, rp.r - 44), hi = rp.r + 44;
      rp.lo2 = lo * lo; rp.hi2 = hi * hi;
    }
    const nr = ripples.length, sdx = bx - ax, sdy = by - ay, sl2 = sdx * sdx + sdy * sdy;
    const minX = Math.min(ax, bx) - R, maxX = Math.max(ax, bx) + R, minY = Math.min(ay, by) - R, maxY = Math.max(ay, by) + R;
    lx.set(x); ly.set(y);
    for (let i = 0; i < n; i++) {
      let tx = hx[i], ty = hy[i];
      if (on[i]) {
        if (intro && t < delay[i]) continue;         // still waiting for its turn to fly in
        tx += sx[i] * sc; ty += sy[i] * sc;
      }
      const xi = x[i], yi = y[i];
      if (has && xi > minX && xi < maxX && yi > minY && yi < maxY) {   // hover (and held left button): push away
        let cx = bx, cy = by;
        if (sl2 > .01) { let u = ((xi - ax) * sdx + (yi - ay) * sdy) / sl2; u = u < 0 ? 0 : u > 1 ? 1 : u; cx = ax + u * sdx; cy = ay + u * sdy; }
        const dx = xi - cx, dy = yi - cy, d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > .01) {
          const d = Math.sqrt(d2), f = 1 - d / R, k = f * f * (on[i] ? 5.5 : 3);
          vx[i] += dx / d * k; vy[i] += dy / d * k;
        }
      }
      for (let r = 0; r < nr; r++) {                 // right click: rings travelling outwards
        const rp = ripples[r], qx = xi - rp.cx, qy = yi - rp.cy, q2 = qx * qx + qy * qy;
        if (q2 > rp.lo2 && q2 < rp.hi2) {
          const q = Math.sqrt(q2) || 1, off = Math.abs(q - rp.r), k = (1 - off / 44) * rp.p;
          vx[i] += qx / q * k; vy[i] += qy / q * k;
        }
      }
      vx[i] = (vx[i] + (tx - xi) * .05) * .84;
      vy[i] = (vy[i] + (ty - yi) * .05) * .84;
      x[i] = xi + vx[i]; y[i] = yi + vy[i];
    }
    if (intro && t > 2600) intro = false;
  }

  /** Paints the dots `a` of the way from the previous tick to the current one. */
  function draw(a = 1, now = performance.now()) {
    ctx.clearRect(0, 0, W, H);
    const p = clamp(scrollY / H);
    const sOn = gap * .66, sOff = Math.max(1.2, gap * .12), thr = gap * .45;
    let last = -1;
    ctx.globalAlpha = 1 - p * .85;
    const zt = now * .0007, NF = .0058;
    for (let i = 0; i < n; i++) {
      const px = lx[i] + (x[i] - lx[i]) * a, py = ly[i] + (y[i] - ly[i]) * a;
      const ex = px - hx[i], ey = py - hy[i];
      const moved = (ex > thr || ex < -thr || ey > thr || ey < -thr) && p < .02;
      const nz = noise3(hx[i] * NF, hy[i] * NF, zt);
      let s, cat;
      if (on[i]) {
        s = sOn * (.84 + .3 * nz);
        cat = moved ? 2 : 1;
      } else {
        s = sOff * (1 + (nz > 0 ? nz * 3.2 : 0)) * (moved ? 1.7 : 1);
        cat = moved ? 2 : 0;
      }
      if (cat !== last) { ctx.fillStyle = cat === 2 ? cAcc : cat === 1 ? cFg : cDot; last = cat; }
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
    }
  }
  function loop(now) {
    if (!visible) { raf = 0; return; }
    let dt = now - lastFrame; lastFrame = now;
    if (!(dt > 0) || dt > 100) dt = TICK;            // the first frame, or back from a hidden tab
    acc += dt;
    const steps = Math.floor(acc / TICK); acc -= steps * TICK;
    if (steps) {
      toField();
      const p = clamp(scrollY / H), has = mx > -999, sweep = has && fmx > -999;
      const x0 = sweep ? fmx : mx, y0 = sweep ? fmy : my;
      for (let s = 0; s < steps; s++) {
        simNow += TICK;
        const a = s / steps, b = (s + 1) / steps;
        step(x0 + (mx - x0) * a, y0 + (my - y0) * a, x0 + (mx - x0) * b, y0 + (my - y0) * b, has, p);
      }
      fmx = mx; fmy = my;
    }
    draw(acc / TICK, now);
    raf = requestAnimationFrame(loop);
  }
  const start = () => { if (!raf && !reduce && lx) { lastFrame = 0; raf = requestAnimationFrame(loop); } };   // lx: the field is built
  const release = () => { grav = false; emitting = false; };
  // The pointer is kept in window coordinates and placed in the field on every frame: while the page
  // scrolls under a resting pointer no event arrives, and a position remembered in the field's own
  // coordinates would stay behind, then jump when the scroll ends.
  const toField = () => {
    if (cmx < -999) { mx = my = -9999; return; }
    const r = cv.getBoundingClientRect(); mx = cmx - r.left; my = cmy - r.top;
  };
  const noPointer = () => { cmx = cmy = mx = my = fmx = fmy = -9999; };
  const setPointer = e => {
    const nx = e.clientX, ny = e.clientY, now = performance.now(), dt = now - pt;
    if (cmx > -999 && dt > 0 && dt < 120) { pvx += ((nx - cmx) / dt - pvx) * .4; pvy += ((ny - cmy) / dt - pvy) * .4; } else pvx = pvy = 0;
    cmx = nx; cmy = ny; pt = now; ghostOn = false; toField();
  };
  // The chat's cursor (mcp.js) parts the field like a real pointer.
  addEventListener('ghost:move', e => {
    if (e.detail) { cmx = e.detail.x; cmy = e.detail.y; ghostOn = true; }
    else if (ghostOn) { ghostOn = false; noPointer(); }
  });
  addEventListener('pointermove', e => {
    setPointer(e);
    // A release that never arrived as an event (it happens after a context menu): three moves in a row with no button down.
    if (grav || emitting) { if (e.buttons) idle = 0; else if (++idle > 2) release(); }
  }, { passive: true });
  // The pointer left the window. (On `document` this event is not reliable across engines.)
  root.addEventListener('pointerleave', noPointer);
  hero.addEventListener('contextmenu', e => e.preventDefault());
  hero.addEventListener('pointerdown', e => {
    if (reduce || e.target.closest('a, button')) return;
    setPointer(e); fmx = mx; fmy = my; idle = 0;
    const second = e.button === 2 || (e.button === 0 && e.ctrlKey);   // ctrl+click is the Mac's right click
    if (second) { emitting = true; lastEmit = 0; }     // hold right button: rings keep coming
    else if (e.button === 0) grav = true;              // hold left button: a wider push
  });
  const up = e => {
    release();
    if (e.pointerType && e.pointerType !== 'mouse') noPointer();
  };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
  addEventListener('mouseup', release);
  addEventListener('blur', release);
  // A burst of rings from the middle of the name (the chat's MCP tool `hero_wave` asks for it).
  addEventListener('field:burst', () => {
    if (reduce) return;
    for (let k = 0; k < 4; k++) setTimeout(() => ripples.push({ x: W / 2, y: H * .47, t: simNow, vx: 0, vy: 0 }), k * 170);
  });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }).observe(hero);
  let lastW = 0, rz;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (innerWidth === lastW && Math.abs(hero.offsetHeight - H) < 120) return;
      lastW = innerWidth; intro = false; build(); if (reduce) draw();
    }, 150);
  });
  const boot = () => { lastW = innerWidth; build(); syncTheme(); reduce ? draw() : start(); };
  // WebKit can run this script before the style sheets are applied (Chromium never does). Measuring
  // the hero or reading the colour tokens at that point gives a field built for the wrong box, in no
  // colour at all, so everything that measures waits for the sheets first, and the font after them.
  const sheet = link => new Promise(done => {
    if (!link || link.sheet) return done();
    link.addEventListener('load', done, { once: true }); link.addEventListener('error', done, { once: true });
  });
  const limit = (promise, ms) => Promise.race([promise, new Promise(r => setTimeout(r, ms))]);
  const styled = Promise.all($$('link[rel="stylesheet"]').map(l => l.href.startsWith(location.origin) ? sheet(l) : limit(sheet(l), 1200)));
  styled
    .then(() => limit(document.fonts && document.fonts.load ? document.fonts.load('800 100px Geist') : null, 1200))
    .then(boot, boot);

  /* ---------- the dots behind each demo: the hero's field, calmed down ---------- */
  // Same springs, no shimmer, no clicks: the dots only step aside for the pointer and drift back.
  function dotField(host) {
    const GAP = 18, R = 78, R2 = R * R, c = document.createElement('canvas'), g = c.getContext('2d');
    c.className = 'dots'; c.setAttribute('aria-hidden', 'true'); host.prepend(c);
    let w = 0, h = 0, m = 0, fx, fy, px, py, qx, qy, ux, uy, ptx = -9999, pty = -9999, lpx = -9999, lpy = -9999, fr = 0, lastT = 0, ac = 0;
    function size() {
      w = host.clientWidth; h = host.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.ceil(w / GAP), rows = Math.ceil(h / GAP);
      m = cols * rows;
      fx = new Float32Array(m); fy = new Float32Array(m); px = new Float32Array(m); py = new Float32Array(m);
      qx = new Float32Array(m); qy = new Float32Array(m); ux = new Float32Array(m); uy = new Float32Array(m);
      for (let r = 0, i = 0; r < rows; r++) for (let k = 0; k < cols; k++, i++) { fx[i] = px[i] = qx[i] = GAP / 2 + k * GAP; fy[i] = py[i] = qy[i] = GAP / 2 + r * GAP; }
      paint();
    }
    function paint(a = 1) {
      if (!m) return;
      g.clearRect(0, 0, w, h); g.fillStyle = cDot; g.globalAlpha = .7;
      for (let i = 0; i < m; i++) g.fillRect(qx[i] + (px[i] - qx[i]) * a - 1, qy[i] + (py[i] - qy[i]) * a - 1, 2, 2);
    }
    function tick(ax, ay, bx, by, has) {
      const sdx = bx - ax, sdy = by - ay, sl2 = sdx * sdx + sdy * sdy;
      let energy = 0;
      qx.set(px); qy.set(py);
      for (let i = 0; i < m; i++) {
        const xi = px[i], yi = py[i];
        if (has) {
          let cx = bx, cy = by;
          if (sl2 > .01) { let u = ((xi - ax) * sdx + (yi - ay) * sdy) / sl2; u = u < 0 ? 0 : u > 1 ? 1 : u; cx = ax + u * sdx; cy = ay + u * sdy; }
          const dx = xi - cx, dy = yi - cy, d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 > .01) { const d = Math.sqrt(d2), f = 1 - d / R, k = f * f * 1.5; ux[i] += dx / d * k; uy[i] += dy / d * k; }
        }
        ux[i] = (ux[i] + (fx[i] - xi) * .05) * .84; uy[i] = (uy[i] + (fy[i] - yi) * .05) * .84;
        px[i] = xi + ux[i]; py[i] = yi + uy[i];
        energy += Math.abs(ux[i]) + Math.abs(uy[i]) + Math.abs(px[i] - fx[i]) + Math.abs(py[i] - fy[i]);
      }
      return energy;
    }
    function frame(now) {
      let dt = now - lastT; lastT = now;
      if (!(dt > 0) || dt > 100) dt = TICK;
      ac += dt;
      const steps = Math.floor(ac / TICK); ac -= steps * TICK;
      let energy = 1;
      if (steps) {
        const has = ptx > -999, sweep = has && lpx > -999, x0 = sweep ? lpx : ptx, y0 = sweep ? lpy : pty;
        for (let s = 0; s < steps; s++) energy = tick(x0 + (ptx - x0) * s / steps, y0 + (pty - y0) * s / steps, x0 + (ptx - x0) * (s + 1) / steps, y0 + (pty - y0) * (s + 1) / steps, has);
        lpx = ptx; lpy = pty;
      }
      if (ptx < -999 && energy < .5) {               // everything is back home: stop until the pointer returns
        for (let i = 0; i < m; i++) { px[i] = qx[i] = fx[i]; py[i] = qy[i] = fy[i]; ux[i] = uy[i] = 0; }
        paint(); fr = 0; return;
      }
      paint(ac / TICK);
      fr = requestAnimationFrame(frame);
    }
    const wake = () => { if (!fr && !reduce && m) { lastT = 0; fr = requestAnimationFrame(frame); } };
    const at = (cx, cy) => {                          // client coordinates; the card may be scaled
      const r = c.getBoundingClientRect();
      if (!r.width || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) { ptx = pty = lpx = lpy = -9999; return; }
      ptx = (cx - r.left) * w / r.width; pty = (cy - r.top) * h / r.height; wake();
    };
    const gone = () => { ptx = pty = lpx = lpy = -9999; };
    host.addEventListener('pointermove', e => at(e.clientX, e.clientY), { passive: true });
    host.addEventListener('pointerleave', gone);
    host.addEventListener('pointercancel', gone);
    host.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') gone(); });
    // The chat's own cursor (js/demos/mcp.js) moves the dots like a real one.
    addEventListener('ghost:move', e => { if (e.detail) at(e.detail.x, e.detail.y); else gone(); });
    new ResizeObserver(size).observe(host);
    size();
    return { paint };
  }
  $$('.viz').forEach(v => fields.push(dotField(v)));

  /* ---------- scramble text ---------- */
  const GLYPHS = '01<>/\\_-=+*#';
  function scramble(el) {
    if (reduce || el._busy) return;
    const text = el.dataset.text || (el.dataset.text = el.textContent);
    el._busy = true;
    const began = performance.now(), dur = Math.min(900, 260 + text.length * 28);
    (function tick(now) {
      const k = Math.min(1, (now - began) / dur), done = Math.floor(k * text.length);
      let out = text.slice(0, done);
      for (let i = done; i < text.length; i++) out += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      el.textContent = out;
      if (k < 1) requestAnimationFrame(tick); else { el.textContent = text; el._busy = false; }
    })(began);
  }
  $$('a').forEach(a => { const t = $('[data-scramble]', a); if (t) a.addEventListener('pointerenter', () => scramble(t)); });
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in'); io.unobserve(e.target);
    const s = e.target.matches('.label') && $('[data-scramble]', e.target);
    if (s) scramble(s);
    if (e.target.matches('.big')) bigWave(0);
  }), { threshold: .2 });
  $$('.rv').forEach(el => io.observe(el));

  /* ---------- contact link: letters that behave like the hero's dots ---------- */
  // Each letter sits on a spring. The pointer parts them, a ring runs through the word when the
  // pointer arrives, and a letter that is out of place shows a random glyph until it is back.
  const big = $('.big'), bigT = big.firstElementChild;
  let bigWave = () => {};
  if (!reduce) {
    const L = [...bigT.textContent].map(ch => {
      const el = document.createElement('span'); el.className = 'c'; el.textContent = ch;
      return { el, ch, x: 0, y: 0, vx: 0, vy: 0, hx: 0, hy: 0, hot: false, g: 0 };
    });
    bigT.replaceChildren(...L.map(l => l.el));
    let fs = 100, bw = 0, bx = -9999, by = -9999, waves = [], bRaf = 0, bLast = 0, bAcc = 0, bNow = 0;
    const measure = () => {
      fs = parseFloat(getComputedStyle(big).fontSize) || 100;
      L.forEach(l => { l.el.style.transform = ''; l.el.style.width = ''; l.el.textContent = l.ch; });
      const ws = L.map(l => l.el.getBoundingClientRect().width);
      L.forEach((l, i) => { l.el.style.width = (ws[i] / fs).toFixed(4) + 'em'; });   // a glyph swap must not shift the neighbours
      L.forEach(l => { l.hx = l.el.offsetLeft - bigT.offsetLeft + l.el.offsetWidth / 2; l.hy = l.el.offsetTop - bigT.offsetTop + l.el.offsetHeight / 2; });
      bw = bigT.offsetWidth;
    };
    function bigTick() {
      const r = fs * 1.15, r2 = r * r, band = fs * .5;
      for (const w of waves) w.r = (bNow - w.t) * 1.1;
      waves = waves.filter(w => w.r < bw + fs);
      let energy = waves.length;
      for (const l of L) {
        if (bx > -999) {
          const dx = l.hx + l.x - bx, dy = l.hy + l.y - by, d2 = dx * dx + dy * dy;
          if (d2 < r2 && d2 > .01) { const d = Math.sqrt(d2), f = 1 - d / r, k = f * f * fs * .02; l.vx += dx / d * k; l.vy += dy / d * k; }
        }
        for (const w of waves) { const off = Math.abs(Math.abs(l.hx - w.x) - w.r); if (off < band) l.vy -= (1 - off / band) * fs * .02; }
        l.vx = (l.vx - l.x * .05) * .84; l.vy = (l.vy - l.y * .05) * .84;
        l.x += l.vx; l.y += l.vy;
        energy += Math.abs(l.x) + Math.abs(l.y) + Math.abs(l.vx) + Math.abs(l.vy);
      }
      return energy;
    }
    function bigFrame(now) {
      let dt = now - bLast; bLast = now;
      if (!(dt > 0) || dt > 100) dt = TICK;
      bAcc += dt;
      let energy = 1;
      for (let s = Math.floor(bAcc / TICK); s > 0; s--) { bAcc -= TICK; bNow += TICK; energy = bigTick(); }
      const rest = bx < -999 && energy < .4;
      for (const l of L) {
        const m = rest ? 0 : Math.hypot(l.x, l.y), hot = m > fs * .06;
        if (hot && bNow - l.g > 60) { l.g = bNow; l.el.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0]; }
        if (hot !== l.hot) { l.hot = hot; l.el.classList.toggle('hot', hot); if (!hot) l.el.textContent = l.ch; }
        l.el.style.transform = m > .05 ? `translate(${l.x.toFixed(2)}px,${l.y.toFixed(2)}px) rotate(${clamp(l.vx * 2.4, -18, 18).toFixed(2)}deg)` : '';
      }
      if (rest) { L.forEach(l => { l.x = l.y = l.vx = l.vy = 0; }); bRaf = 0; return; }
      bRaf = requestAnimationFrame(bigFrame);
    }
    const bigWake = () => { if (!bRaf) { bLast = 0; bRaf = requestAnimationFrame(bigFrame); } };
    bigWave = at => { waves.push({ x: at, t: bNow, r: 0 }); bigWake(); };
    const zone = $('#contact'), bigGone = () => { bx = by = -9999; };
    zone.addEventListener('pointermove', e => {
      const r = bigT.getBoundingClientRect();
      bx = e.clientX - r.left; by = e.clientY - r.top;
      if (bx > -fs * 1.2 && bx < bw + fs * 1.2 && by > -fs * 1.2 && by < r.height + fs * 1.2) bigWake(); else bigGone();
    }, { passive: true });
    zone.addEventListener('pointerleave', bigGone);
    zone.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') bigGone(); });
    big.addEventListener('pointerenter', e => bigWave(e.clientX - bigT.getBoundingClientRect().left));
    big.addEventListener('focus', () => bigWave(0));
    addEventListener('resize', measure);
    measure(); styled.then(() => { measure(); document.fonts && document.fonts.ready.then(measure); });
  }

  /* ---------- scroll-driven: progress bar, statement, card stack, timeline ---------- */
  const st = $('#statement'), words = [];
  (function split(node) {
    [...node.childNodes].forEach(ch => {
      if (ch.nodeType === 3) {
        const f = document.createDocumentFragment();
        ch.textContent.split(/(\s+)/).forEach(tk => {
          if (!tk.trim()) { f.append(tk); return; }
          const s = document.createElement('span'); s.className = 'w'; s.textContent = tk; words.push(s); f.append(s);
        });
        ch.replaceWith(f);
      } else split(ch);
    });
  })(st);
  const bar = $('#bar'), cards = $$('.card'), pathEl = $('#pathlist'), railFill = $('.rail b'), steps = $$('#pathlist li');
  let ticking = false;
  function onScroll() {
    ticking = false;
    const vh = innerHeight;
    bar.style.transform = `scaleX(${clamp(scrollY / (root.scrollHeight - vh))})`;
    const r = st.getBoundingClientRect();
    const lit = Math.round(clamp((vh * .9 - r.top) / (r.height + vh * .4)) * words.length);
    words.forEach((w, i) => w.classList.toggle('lit', i < lit));
    cards.forEach((c, i) => {                          // each card shrinks and dims as the next slides over it
      const nx = cards[i + 1]; if (!nx) return;
      const k = clamp(1 - (nx.getBoundingClientRect().top - c.getBoundingClientRect().top) / c.offsetHeight);
      c.style.setProperty('--k', k.toFixed(3));
    });
    const pr = pathEl.getBoundingClientRect(), line = vh * .62;
    railFill.style.transform = `scaleY(${clamp((line - pr.top) / pr.height)})`;
    steps.forEach(li => li.classList.toggle('on', reduce || li.getBoundingClientRect().top < line));
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', onScroll);
  onScroll(); styled.then(onScroll);

  /* ---------- marquee that rides the scroll ---------- */
  const rows = $$('.mq-row');
  // Five more copies of each row make the loop seamless. The list itself is read once, from the
  // .sr list in index.html; the rows are aria-hidden, and so is every copy, should one ever move out.
  rows.forEach(r => {
    const one = [...r.children];
    for (let k = 1; k < 6; k++) one.forEach(el => { const d = el.cloneNode(true); d.setAttribute('aria-hidden', 'true'); r.append(d); });
  });
  if (!reduce) {
    const off = [0, 0]; let vel = 0, lastY = scrollY, mqRaf = 0, mqVis = false, mqT = 0, widths = [];
    const measure = () => { widths = rows.map(r => r.scrollWidth / 6); };
    measure(); addEventListener('resize', measure); styled.then(() => { measure(); document.fonts && document.fonts.ready.then(measure); });
    const mq = now => {
      if (!mqVis) { mqRaf = 0; mqT = 0; return; }
      const f = mqT ? Math.min(12, (now - mqT) / TICK) : 1; mqT = now;   // ticks since the last frame: the speed no longer follows the refresh rate
      const dy = (scrollY - lastY) / f; lastY = scrollY; vel += (dy - vel) * (1 - Math.pow(.88, f));
      rows.forEach((r, i) => {
        const w = widths[i] || 1;
        off[i] += (i ? -1 : 1) * (.7 + vel * .45) * f;
        r.style.transform = `translateX(${-(((off[i] % w) + w) % w)}px) skewX(${clamp(vel * -.25, -10, 10)}deg)`;
      });
      mqRaf = requestAnimationFrame(mq);
    };
    new IntersectionObserver(([e]) => { mqVis = e.isIntersecting; lastY = scrollY; if (mqVis && !mqRaf) mqRaf = requestAnimationFrame(mq); }).observe($('#stack'));
  }
})();
