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
  let ripples = [], emitting = false, lastEmit = 0, pvx = 0, pvy = 0, pt = 0;

  function readColors() {
    const cs = getComputedStyle(root), g = n => cs.getPropertyValue(n).trim();
    cFg = g('--fg'); cDot = g('--dot'); cAcc = g('--accent'); cLine = g('--line'); cMuted = g('--muted');
    if (reduce) draw(performance.now());
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
  let hx, hy, x, y, vx, vy, on, sx, sy, delay;
  let mx = -9999, my = -9999, grav = false;

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
    t0 = performance.now();
  }

  function draw(now) {
    const t = now - t0;
    ctx.clearRect(0, 0, W, H);
    const p = clamp(scrollY / H), sc = p * p * 420;
    const R = Math.max(90, gap * 9) * (grav ? 2.6 : 1);   // held left button: the same push, wider
    const R2 = R * R, G = Math.max(260, gap * 30), G2 = G * G;
    const sOn = gap * .66, sOff = Math.max(1.2, gap * .12), thr = gap * .45;
    let last = -1;
    ctx.globalAlpha = 1 - p * .85;
    const zt = now * .0007, NF = .0058, maxR = Math.max(W, H) * .95;
    ripples = ripples.filter(rp => (now - rp.t) * WAVE < maxR);
    if (emitting && now - lastEmit > 150) {            // held right button: a steady train of rings
      lastEmit = now;
      // A ring keeps the pointer's motion, capped at a third of the wave speed.
      let ix = now - pt < 90 ? pvx : 0, iy = now - pt < 90 ? pvy : 0;
      const sp = Math.hypot(ix, iy), cap = WAVE / 3;
      if (sp > cap) { ix *= cap / sp; iy *= cap / sp; }
      ripples.push({ x: mx, y: my, t: now, vx: ix, vy: iy });
    }
    for (const rp of ripples) {
      const age = now - rp.t;
      rp.r = age * WAVE; rp.cx = rp.x + rp.vx * age; rp.cy = rp.y + rp.vy * age; rp.p = 1.9 * (1 - rp.r / maxR);
    }
    for (let i = 0; i < n; i++) {
      let tx = hx[i], ty = hy[i], held = false;
      if (on[i]) {
        if (intro && t < delay[i]) held = true;
        else { tx += sx[i] * sc; ty += sy[i] * sc; }
      }
      if (!held && !reduce) {
        const dx = x[i] - mx, dy = y[i] - my, d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > .01) {             // hover (and held left button): push away
          const d = Math.sqrt(d2), f = 1 - d / R, k = f * f * (on[i] ? 5.5 : 3);
          vx[i] += dx / d * k; vy[i] += dy / d * k;
        }
        for (let r = 0; r < ripples.length; r++) {     // right click: rings travelling outwards
          const rp = ripples[r], qx = x[i] - rp.cx, qy = y[i] - rp.cy, q = Math.sqrt(qx * qx + qy * qy) || 1, off = Math.abs(q - rp.r);
          if (off < 44) { const k = (1 - off / 44) * rp.p; vx[i] += qx / q * k; vy[i] += qy / q * k; }
        }
        vx[i] = (vx[i] + (tx - x[i]) * .05) * .84;
        vy[i] = (vy[i] + (ty - y[i]) * .05) * .84;
        x[i] += vx[i]; y[i] += vy[i];
      }
      const ex = x[i] - hx[i], ey = y[i] - hy[i];
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
      ctx.fillRect(x[i] - s / 2, y[i] - s / 2, s, s);
    }
    if (intro && t > 2600) intro = false;
  }
  function loop(now) { if (!visible) { raf = 0; return; } draw(now); raf = requestAnimationFrame(loop); }
  const start = () => { if (!raf && !reduce) raf = requestAnimationFrame(loop); };
  function shock(px, py, power, radius) {
    for (let i = 0; i < n; i++) {
      const dx = x[i] - px, dy = y[i] - py, d = Math.hypot(dx, dy) || 1;
      if (d < radius) { const k = (1 - d / radius) * power; vx[i] += dx / d * k; vy[i] += dy / d * k; }
    }
  }
  const setPointer = e => {
    const r = cv.getBoundingClientRect(), nx = e.clientX - r.left, ny = e.clientY - r.top, now = performance.now(), dt = now - pt;
    if (mx > -999 && dt > 0 && dt < 120) { pvx += ((nx - mx) / dt - pvx) * .4; pvy += ((ny - my) / dt - pvy) * .4; } else pvx = pvy = 0;
    mx = nx; my = ny; pt = now;
  };
  addEventListener('pointermove', setPointer, { passive: true });
  document.addEventListener('pointerleave', () => { mx = my = -9999; });
  hero.addEventListener('contextmenu', e => e.preventDefault());
  hero.addEventListener('pointerdown', e => {
    if (reduce || e.target.closest('a, button')) return;
    setPointer(e);
    if (e.button === 0) grav = true;                  // hold left button: a wider push
    else if (e.button === 2) { emitting = true; lastEmit = 0; }   // hold right button: rings keep coming
  });
  addEventListener('pointerup', e => {
    grav = false; emitting = false; // release: everything it swallowed bursts out
    if (e.pointerType !== 'mouse') mx = my = -9999;
  });
  addEventListener('blur', () => { grav = false; emitting = false; });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }).observe(hero);
  let lastW = 0, rz;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (innerWidth === lastW && Math.abs(hero.offsetHeight - H) < 120) return;
      lastW = innerWidth; intro = false; build(); if (reduce) draw(performance.now());
    }, 150);
  });
  const boot = () => { lastW = innerWidth; build(); syncTheme(); reduce ? draw(performance.now()) : start(); };
  const fontReady = document.fonts && document.fonts.load ? document.fonts.load('800 100px Geist') : Promise.resolve();
  Promise.race([fontReady, new Promise(r => setTimeout(r, 1200))]).then(boot, boot);

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
  }), { threshold: .2 });
  $$('.rv').forEach(el => io.observe(el));

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
  onScroll();

  cards.forEach(c => c.addEventListener('pointermove', e => {
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true }));

  /* ---------- marquee that rides the scroll ---------- */
  const rows = $$('.mq-row');
  rows.forEach(r => { r.innerHTML = r.innerHTML.repeat(6); });
  if (!reduce) {
    const off = [0, 0]; let vel = 0, lastY = scrollY, mqRaf = 0, mqVis = false;
    const mq = () => {
      if (!mqVis) { mqRaf = 0; return; }
      const dy = scrollY - lastY; lastY = scrollY; vel += (dy - vel) * .12;
      rows.forEach((r, i) => {
        const w = r.scrollWidth / 6;
        off[i] += (i ? -1 : 1) * (.7 + vel * .45);
        r.style.transform = `translateX(${-(((off[i] % w) + w) % w)}px) skewX(${clamp(vel * -.25, -10, 10)}deg)`;
      });
      mqRaf = requestAnimationFrame(mq);
    };
    new IntersectionObserver(([e]) => { mqVis = e.isIntersecting; lastY = scrollY; if (mqVis && !mqRaf) mqRaf = requestAnimationFrame(mq); }).observe($('#stack'));
  }
})();
