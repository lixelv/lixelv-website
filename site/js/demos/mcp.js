// The page side of GlassChat's "site" MCP server. The model asks for a tool (server/tools.json),
// and this module carries it out in the visitor's browser: a small cursor with the chat's name
// moves over the page and presses the real buttons of the demos, then the result goes back.
// It also owns the pinned mode: the chat leaves its card and stays at the side of the screen
// while the visitor looks at the other demos.
import { $, $$, sleep, reduce } from '../util.js';

const root = document.documentElement;
const gc = $('#gc'), home = $('#gc-viz'), msgs = $('#gc-msgs'), pinBtn = $('#gc-pin');
const cards = $$('.card'), cardsEl = $('.cards');
// Card name (data-card in index.html) -> its place in the stack. Read from the page, so adding,
// hiding or moving a card needs no change here.
const CARD = Object.fromEntries(cards.map((c, i) => [c.dataset.card, i]));
const SECTION = { top: '#top', about: '#statement', stack: '#stack', work: '#work', path: '#path', contact: '#contact' };
const SCRIPT = { run_program: 'open', fullscreen: 'full', cmd: 'cmd', kill_process: 'kill', shutdown: 'shutdown', awake: 'awake' };

const wait = ms => new Promise(r => setTimeout(r, ms));             // a real pause, also with reduced motion
const narrow = () => matchMedia('(max-width: 820px)').matches;       // cards are stacked, nothing is sticky
/** Polls until fn() is true or the time is up. `first`: how long to wait before the first look. */
async function until(fn, timeout, first = 0) {
  if (first) await wait(first);
  for (const end = Date.now() + timeout; Date.now() < end; await wait(80)) if (fn()) return true;
  return false;
}
/** A pause the visitor can cut short (see `hurry`): the `wait` tool, a highlight, a caption. */
let endPause = null;
const pause = ms => new Promise(done => { endPause = done; setTimeout(done, ms); });
export function hurry() { if (endPause) endPause(); }
const clampN = (v, lo, hi, or) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : or; };
function make(tag, cls, html = '') { const el = document.createElement(tag); el.className = cls; el.innerHTML = html; return el; }

/* ---------- pinned mode ---------- */
// The dock covers the text column of the cards: it dims and blurs it, fades out over a short
// gradient, and leaves the demos on the right untouched.
const dock = make('div', 'gc-dock', '<div class="gc-dock-shade"></div><div class="gc-dock-slot"></div>');
const slot = dock.lastChild;
// Strip 0 is the body of the shade; strips 1..8 are the gradient, the weakest at the edge (--o: 0).
dock.firstChild.innerHTML = Array.from({ length: 9 }, (_, k) => `<i style="--t:${(1 - k / 9).toFixed(3)};--o:${k ? 8 - k : 8}"></i>`).join('');
const away = make('div', 'gc-away', '<span>The chat is pinned to the side.</span><button type="button">Bring it back <kbd>Esc</kbd></button>');
away.hidden = true;
document.body.append(dock);
home.append(away);
let pinned = false;

function layout() {            // the dock ends where the demos begin
  const info = $('.card-info');
  dock.style.setProperty('--dock-w', Math.round(cardsEl.getBoundingClientRect().left + info.offsetWidth) + 'px');
}
/** The dock steps aside as soon as the visitor scrolls away from the demos, and returns with them. */
function watch() {
  if (!pinned) return;
  const r = cardsEl.getBoundingClientRect(), vh = innerHeight;
  dock.classList.toggle('away', !(r.top < vh * .6 && r.bottom > vh * .45));
}
function fly(first) {          // FLIP: the window travels from where it was to where it is now
  msgs.scrollTop = msgs.scrollHeight;
  const last = gc.getBoundingClientRect();
  if (reduce || !first.width || !last.width || !gc.animate) return;
  gc.animate([
    { transformOrigin: '0 0', transform: `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${first.width / last.width}, ${first.height / last.height})` },
    { transformOrigin: '0 0', transform: 'none' },
  ], { duration: 520, easing: 'cubic-bezier(.2, .7, .2, 1)' });
}
export function pin() {
  if (pinned) return;
  pinned = true; layout();
  const first = gc.getBoundingClientRect();
  away.hidden = false; slot.append(gc);
  dock.classList.add('on'); watch(); fly(first);
  pinBtn.setAttribute('aria-pressed', 'true'); pinBtn.title = 'Back to the card (Esc)';
}
export function unpin() {
  if (!pinned) return;
  pinned = false;
  const first = gc.getBoundingClientRect();
  away.before(gc); away.hidden = true;
  dock.classList.remove('on', 'away'); fly(first);
  pinBtn.setAttribute('aria-pressed', 'false'); pinBtn.title = 'Pin to the side';
}
/** The visitor sent the chat home (a tool doing the same is not announced): a running guide stops. */
function release() {
  if (!pinned) return;
  unpin();
  dispatchEvent(new CustomEvent('chat:released'));
}
pinBtn.addEventListener('click', () => (pinned ? release() : pin()));
$('button', away).addEventListener('click', release);
addEventListener('keydown', e => { if (e.key === 'Escape') release(); });
// A click that is neither in the chat nor on a demo sends the chat home.
addEventListener('pointerdown', e => {
  if (pinned && e.isTrusted && e.target !== root && !e.target.closest('.gc, .viz')) release();
}, true);
let ticking = false;
addEventListener('scroll', () => { if (pinned && !ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; watch(); }); } }, { passive: true });
addEventListener('resize', () => { if (pinned) { layout(); watch(); } });

/* ---------- getting a card on screen ---------- */
async function scrollToY(top) {
  top = Math.max(0, Math.min(top, root.scrollHeight - innerHeight));
  if (Math.abs(scrollY - top) < 3) return;
  scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
  for (let i = 0, last = scrollY, still = 0; i < 80 && Math.abs(scrollY - top) >= 3 && still < 5; i++) {
    await wait(50);
    still = scrollY === last ? still + 1 : 0; last = scrollY;
  }
  await wait(120);
}
/** Scrolls so that card i has just reached its sticky position and covers the ones before it. */
async function showCard(i) {
  const card = cards[i];
  if (narrow()) return scrollToY($('.viz', card).getBoundingClientRect().top + scrollY - 12);
  const gap = parseFloat(getComputedStyle(cardsEl).rowGap) || 0;
  const natural = cardsEl.getBoundingClientRect().top + scrollY + i * (card.offsetHeight + gap);
  await scrollToY(natural - (56 + i * 12) + 1);   // 56 + n * 12: the cards' sticky offsets in style.css
}
/** On a phone the pinned chat takes the lower part of the screen: keep the target above it. */
async function reveal(el) {
  if (!narrow()) return;
  const r = el.getBoundingClientRect(), floor = (pinned ? dock.getBoundingClientRect().top : innerHeight) - 12;
  if (r.top < 12) await scrollToY(scrollY + r.top - 24);
  else if (r.bottom > floor) await scrollToY(scrollY + Math.min(r.top - 24, r.bottom - floor));
}

/* ---------- the cursor ---------- */
const ghost = make('div', 'mcp-cursor', '<svg viewBox="0 0 20 22" width="20" height="22"><path d="M3 2v14.2l3.9-3.5 2.7 6 2.4-1.1-2.7-5.9 5.2-.3z"/></svg><b>GlassChat</b><em></em>');
ghost.setAttribute('aria-hidden', 'true');
document.body.append(ghost);
let gx = 0, gy = 0, shown = false, restTimer = 0;

function place() {
  ghost.style.transform = `translate(${(gx - 3).toFixed(1)}px, ${(gy - 2).toFixed(1)}px)`;
  dispatchEvent(new CustomEvent('ghost:move', { detail: { x: gx, y: gy } }));   // the dot fields part for it too
}
const spot = (x, y) => ({ getBoundingClientRect: () => ({ left: x, top: y, width: 0, height: 0 }) });   // a bare point as a target
async function appear() {      // the cursor comes into view where it stands
  clearTimeout(restTimer);
  if (!shown) { [gx, gy] = origin(); place(); ghost.classList.add('on'); shown = true; await sleep(160); }
}
const point = (el, fx, fy) => { const r = el.getBoundingClientRect(); return [r.left + r.width * fx, r.top + r.height * fy]; };
function origin() {            // the cursor comes out of the chat's send button
  const [x, y] = point($('#gc-form button'), .5, .5);
  return x > 0 && x < innerWidth && y > 0 && y < innerHeight ? [x, y] : [24, innerHeight / 2];
}
/** Glides to a point inside el, following it if the page moves meanwhile. */
async function moveTo(el, fx = .5, fy = .5) {
  clearTimeout(restTimer);
  if (!shown) { [gx, gy] = origin(); place(); ghost.classList.add('on'); shown = true; await sleep(160); }
  const sx = gx, sy = gy;
  let [tx, ty] = point(el, fx, fy);
  const dist = Math.hypot(tx - sx, ty - sy), dur = reduce ? 0 : Math.min(820, 200 + dist * .9);
  const bend = (Math.random() - .5) * Math.min(70, dist * .2);
  if (dur) await new Promise(done => {
    const began = performance.now();
    (function frame(now) {
      const k = Math.min(1, Math.max(0, (now - began) / dur)), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      [tx, ty] = point(el, fx, fy);
      const nx = sy - ty, ny = tx - sx, nl = Math.hypot(nx, ny) || 1, arc = Math.sin(Math.PI * e) * bend;   // a slight curve, like a hand
      gx = sx + (tx - sx) * e + nx / nl * arc; gy = sy + (ty - sy) * e + ny / nl * arc;
      place();
      if (k < 1) requestAnimationFrame(frame); else done();
    })(began);
  });
  [gx, gy] = point(el, fx, fy); place();
}
/** Moves to el and clicks it: the demo's own handler does the rest. */
async function press(el, fx, fy) {
  await reveal(el);
  await moveTo(el, fx, fy);
  ghost.classList.add('down'); el.classList.add('mcp-hit');
  if (!reduce) {
    const ring = make('i', 'mcp-ring');
    ring.style.left = gx + 'px'; ring.style.top = gy + 'px';
    ring.addEventListener('animationend', () => ring.remove());
    document.body.append(ring);
  }
  await sleep(110);
  el.click();
  await sleep(130);
  ghost.classList.remove('down');
  setTimeout(() => el.classList.remove('mcp-hit'), 240);
}
/** Types into a field, a character at a time. The field is not focused: no keyboard pops up on a phone. */
async function typeInto(input, text, per = 38) {
  await reveal(input);
  await moveTo(input, .12, .5);
  input.classList.add('mcp-hit'); input.value = '';
  for (const ch of text) { input.value += ch; input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(per); }
  setTimeout(() => input.classList.remove('mcp-hit'), 240);
}
function rest() {              // nothing left to do: back into the chat
  clearTimeout(restTimer);
  restTimer = setTimeout(async () => {
    if (!shown) return;
    await moveTo($('#gc-form button'));
    ghost.classList.remove('on'); shown = false;
    dispatchEvent(new CustomEvent('ghost:move', { detail: null }));
  }, 1100);
}

/* ---------- tools ---------- */
/** Before working on another card: keep the chat in sight, bring the card up. */
async function open(i) {
  if (!pinned) { pin(); await sleep(420); }
  await showCard(i);
  await sleep(220);
}

/** What the visitor is looking at: the card or section in the middle of the screen. */
function inView() {
  const el = document.elementFromPoint(innerWidth * (narrow() ? .5 : .75), innerHeight * .5);
  const card = el && el.closest('.card');
  if (card) return `the ${card.dataset.card} card`;
  const sec = el && el.closest('section[id], header[id], .hero, footer');
  if (!sec) return 'the page';
  if (sec.matches('.hero')) return 'the top (the name in pixels)';
  return `the ${Object.keys(SECTION).find(k => SECTION[k] === '#' + sec.id) || sec.id || 'footer'} section`;
}

/** The page from top to bottom, each part with where it sits relative to the screen. */
function whereIs() {
  const parts = [['top (the name in pixels)', $('.hero')], ...['about', 'stack'].map(k => [`${k} section`, $(SECTION[k])]),
    ...cards.map(c => [`${c.dataset.card} card`, c]), ...['path', 'contact'].map(k => [`${k} section`, $(SECTION[k])])].filter(p => p[1]);
  // On a wide screen the cards are sticky and pile up, so their boxes overlap: what is really in front
  // is whatever sits at the same point inView() looks at. The ones under it count as passed.
  const hit = document.elementFromPoint(innerWidth * (narrow() ? .5 : .75), innerHeight * .5);
  const front = parts.findIndex(([, el]) => hit && el.contains(hit));
  return parts.map(([name, el], i) => {
    const r = el.getBoundingClientRect();
    const where = i === front ? 'IN VIEW (middle of the screen)' : r.bottom <= 0 || (front >= 0 && i < front && el.matches('.card')) ? 'above (passed)'
      : r.top >= innerHeight ? 'below' : 'partly on screen';
    return `${name}: ${where}`;
  });
}

/* ControlHub */
const chTiles = () => $$('#ch-grid .pc');
/** One line per computer, so the model can see what a script would change before it runs one. */
const chState = () => {
  const tab = $('#ch-scripts [aria-pressed="true"]'), run = $('#ch-run');
  const pcs = chTiles().map(t => {
    const win = t.classList.contains('full') ? 'notepad open, fullscreen' : t.classList.contains('has-win') ? 'notepad open, not fullscreen' : 'no window';
    return `${$('.nm span', t).textContent}: ${t.dataset.status}, ${win}${t.classList.contains('sel') ? ', selected' : ''}`;
  });
  return `script tab "${tab ? tab.textContent : '?'}", Run button "${run.textContent.trim()}"${run.disabled ? ' (disabled)' : ''}.\n  ${pcs.join('\n  ')}`;
};
/** Chooses a script and, if given, the computers. Returns a message when it cannot. */
async function chSelect(script, computers) {
  const id = SCRIPT[script];
  if (!id) return `There is no script "${script}".`;
  await open(CARD.controlhub);
  const tiles = chTiles(), working = () => tiles.some(t => /running|booting/.test(t.dataset.status));
  await until(() => !working(), 5000, 650);        // the demo runs once by itself when it first comes into view
  await press($(`#ch-scripts [data-s="${id}"]`));
  if (Array.isArray(computers)) {
    const want = new Set(computers.map(Number));
    for (const [i, tile] of tiles.entries()) if (tile.classList.contains('sel') !== want.has(i + 1)) await press(tile, .5, .4);
  }
  return { run: $('#ch-run'), working };
}

/* Polycode */
function poly() {
  const run = $('#pcx-run');
  return { ed: $('#pcx-code'), run, status: $('#pcx-status'), out: $('#pcx-out'), form: $('#pcx-in'), line: $('#pcx-line'), running: () => run.classList.contains('stop') };
}
/** The source appears line by line, as if pasted by a quick typist; a long program takes no longer. */
async function polyType(code) {
  const { ed } = poly();
  await reveal(ed); await moveTo(ed, .2, .25);
  const lines = code.split('\n'), chunk = Math.ceil(lines.length / 60), per = Math.min(80, 1500 / Math.ceil(lines.length / chunk));
  for (let i = chunk; i < lines.length + chunk; i += chunk) {
    ed.value = lines.slice(0, i).join('\n');
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    ed.scrollTop = ed.scrollHeight;
    await sleep(per);
  }
  ed.scrollTop = 0; ed.dispatchEvent(new Event('scroll'));
}
/** Follows a run to its end, typing `queue` into input() as it is asked for. `start` presses Run. */
async function polyWatch(queue, start) {
  const { run, status, out, form, line, running } = poly();
  let started = !start && running(), note = '';
  const seen = new MutationObserver(() => { if (running()) started = true; });   // a quick program is over between two looks
  seen.observe(run, { attributes: true, attributeFilter: ['class'] });
  if (start) await start();
  for (const began = Date.now(); ;) {
    await wait(120);
    if (Date.now() - began > 60_000) { note = ' Stopped after 60 seconds.'; if (running()) run.click(); break; }
    if (!form.hidden) {
      if (!queue.length) { note = ' The program is waiting at input(). Answer with polycode_input, or end it with polycode_stop.'; break; }
      await typeInto(line, queue.shift());
      if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      await until(() => form.hidden || !running(), 1500);
      continue;
    }
    if (started && !running()) break;
    if (!started && Date.now() - began > 900 && status.classList.contains('bad')) break;   // Python did not load
  }
  seen.disconnect();
  return `Status: ${status.textContent.trim() || 'unknown'}.${note}\nConsole:\n${out.textContent.slice(-1100) || '(nothing printed)'}`;
}

/* Ionet */
async function ionetDone() {
  const step = $('#nx-step'), secure = $('#nx-enc').checked, done = () => step.textContent.startsWith('Delivered');
  await until(() => !done(), 600);
  const ok = await until(done, 30_000);
  const cells = sel => $$(sel + ' > i').map(i => i.textContent).join(' ');
  const got = $$(secure ? '#nx-de > i' : '#nx-rx > i').map(i => i.textContent).join('').replace(/␣/g, ' ');
  return `${ok ? step.textContent : 'It did not finish in time.'} Sent "${$('#nx-msg').value}". On the wire: ${cells('#nx-tx')}. ${secure ? `Both sides derived the same key (starts ${$('#nx-key b')?.textContent || '?'}). The visitor saw each byte XORed with the keystream, written as a column sum in binary. ` : ''}The receiver read "${got}".`;
}

/* things `highlight` can point at: [card name, or null outside the cards, selector] */
const SPOT = {
  'hero': [null, '.hero'], 'theme_button': [null, '#theme'],
  'controlhub.scripts': ['controlhub', '#ch-scripts'], 'controlhub.computers': ['controlhub', '#ch-grid'], 'controlhub.run': ['controlhub', '#ch-run'], 'controlhub.log': ['controlhub', '#ch-log'],
  'polycode.editor': ['polycode', '.pcx-ed'], 'polycode.run': ['polycode', '#pcx-run'], 'polycode.console': ['polycode', '#pcx-con'],
  'glasschat.window': ['glasschat', '#gc'],
  'ionet.input': ['ionet', '#nx-form'], 'ionet.encryptor': ['ionet', '#nx [data-b="enc"]'], 'ionet.transmitter': ['ionet', '#nx [data-b="tx"]'], 'ionet.wire': ['ionet', '#nx-wire'],
  'ionet.receiver': ['ionet', '#nx [data-b="rx"]'], 'ionet.decryptor': ['ionet', '#nx [data-b="dec"]'], 'ionet.key': ['ionet', '#nx-key'],
  // The Calculator card is hidden (index.html):
  // 'calculator.display': ['calculator', '#calc output'], 'calculator.keys': ['calculator', '#calc'],
};
/* ways across the pixel field for `hero_push`: k in 0..1 -> a point in the hero's box */
const PATHS = {
  sweep: (k, w, h) => [w * (.1 + .8 * k), h * (.47 + .12 * Math.sin(k * 6.283))],
  circle: (k, w, h) => [w * .5 + h * .3 * Math.cos(k * 6.283 - 1.571), h * .47 + h * .22 * Math.sin(k * 6.283 - 1.571)],
  zigzag: (k, w, h) => [w * (.12 + .76 * k), h * (.47 + .2 * (2 * Math.abs((k * 4) % 2 - 1) - 1))],
};
/* tools that work a demo: the page holds for a moment after them, so the result can be seen */
const DEMO = /^(controlhub|polycode|ionet|calculator|hero)_|^set_theme$/;

const TOOLS = {
  async go_to({ target }) {
    if (target in CARD) { await showCard(CARD[target]); return `The ${target} card is on screen.`; }
    const el = $(SECTION[target] || '');
    if (!el) return `There is no "${target}" on this page.`;
    await scrollToY(el.getBoundingClientRect().top + scrollY - (target === 'about' ? innerHeight * .25 : 0));
    return `Scrolled to ${target}.${pinned ? ' The pinned chat hides away from the demos and returns when the visitor scrolls back to them.' : ''}`;
  },

  async pin_chat({ pinned: want = true }) {
    if (want) { pin(); if (cardsEl.getBoundingClientRect().bottom < 0 || cardsEl.getBoundingClientRect().top > innerHeight) await showCard(CARD.glasschat); }
    else unpin();
    await sleep(520);
    return want ? 'The chat is pinned to the side. The visitor can send it back with Esc or a click outside.' : 'The chat is back in its card.';
  },

  async unpin_chat() { return TOOLS.pin_chat({ pinned: false }); },

  async scroll_by({ screens = 1 }) {
    const by = clampN(screens, -3, 3, 1), from = scrollY;
    await scrollToY(scrollY + by * innerHeight);
    const moved = Math.round(scrollY - from);
    return `${moved ? `Scrolled ${moved > 0 ? 'down' : 'up'} ${Math.abs(moved)} px.` : 'The page is already at its end there.'} In view now: ${inView()}.`;
  },

  async where_is_visitor() {
    const max = Math.max(1, root.scrollHeight - innerHeight);
    return [`In view: ${inView()}. Scrolled ${Math.round(scrollY / max * 100)}% of the page${scrollY < 4 ? ' (at the very top)' : scrollY >= max - 4 ? ' (at the very end)' : ''}.`,
      `Screen: ${innerWidth}x${innerHeight}, ${narrow() ? 'phone layout, cards stacked' : 'wide, cards stack as you scroll'}. Chat: ${pinned ? 'pinned to the side' : 'in its card'}.`,
      'The page, top to bottom:', ...whereIs().map(l => '  ' + l)].join('\n');
  },

  async get_page_state() {
    const light = root.dataset.theme ? root.dataset.theme === 'light' : matchMedia('(prefers-color-scheme: light)').matches;
    const max = Math.max(1, root.scrollHeight - innerHeight), pc = poly();
    return [
      `In view: ${inView()}. Scrolled ${Math.round(scrollY / max * 100)}% of the page.`,
      `Theme: ${light ? 'light' : 'dark'}. Chat: ${pinned ? 'pinned to the side' : 'in its card'}. Screen: ${narrow() ? 'narrow (phone layout)' : 'wide'}.${reduce ? ' The visitor asked for reduced motion.' : ''}`,
      `ControlHub: ${chState()}.`,
      `Polycode: ${pc.status.textContent.trim() || 'not started'}${pc.running() ? ', a program is running' : ''}${pc.form.hidden ? '' : ', waiting at input()'}.`,
      `Ionet: ${$('#nx-enc').checked ? 'encrypted' : 'plain'} session, message "${$('#nx-msg').value}". ${$('#nx-step').textContent}`,
      // `Calculator display: ${$('#calc output').textContent}.`,   (the Calculator card is hidden)
    ].join('\n');
  },

  async read_section({ target }) {
    const el = target in CARD ? $('.card-info', cards[CARD[target]]) : $(target === 'top' ? '.hero' : SECTION[target] || '');
    if (!el) return `There is no "${target}" on this page.`;
    const text = (el.innerText || el.textContent).replace(/\s*\n\s*/g, '\n').replace(/[ \t]+/g, ' ').trim();
    return text.slice(0, 1300) || '(no text there)';
  },

  async highlight({ target, seconds = 2 }) {
    const at = SPOT[target];
    if (!at) return `There is nothing called "${target}". Use one of: ${Object.keys(SPOT).join(', ')}.`;
    if (target === 'hero') await scrollToY(0);
    else if (at[0] && !(at[0] === 'glasschat' && pinned)) await open(CARD[at[0]]);
    const el = $(at[1]);
    if (!el || !el.getClientRects().length) return `"${target}" is not shown right now.`;
    await reveal(el); await moveTo(el, .5, .5);
    el.classList.add('mcp-spot');
    await pause(clampN(seconds, .5, 6, 2) * 1000);
    el.classList.remove('mcp-spot');
    return `Pointed at ${target}.`;
  },

  async caption({ text = '', seconds = 3 }) {
    text = String(text).replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!text) return 'No text was given.';
    await appear();
    const label = $('em', ghost);
    label.textContent = text; ghost.classList.add('say');
    await pause(clampN(seconds, 1, 8, 3) * 1000);
    ghost.classList.remove('say');
    return 'The caption was shown next to your cursor.';
  },

  async wait({ seconds = 2 }) {
    const s = clampN(seconds, .5, 8, 2), began = Date.now();
    await pause(s * 1000);
    return `Waited ${((Date.now() - began) / 1000).toFixed(1)} s.`;
  },

  async controlhub_select({ script, computers }) {
    const r = await chSelect(script, computers);
    return typeof r === 'string' ? r : `Selected ${script}. The button says "${r.run.textContent.trim()}". Computers: ${chState()}.`;
  },

  async controlhub_run({ script, computers }) {
    const r = await chSelect(script, computers);
    if (typeof r === 'string') return r;
    const { run, working } = r, log = $('#ch-log');
    if (run.disabled) return `Nothing ran. The button says "${run.textContent.trim()}". Computers: ${chState()}.`;
    const before = log.firstElementChild;
    await press(run);
    await until(() => !working(), 9000, 700);
    const rows = [];
    for (let r2 = log.firstElementChild; r2 && r2 !== before && rows.length < 9; r2 = r2.nextElementSibling) rows.unshift(r2.textContent.replace(/^[\d:]+/, '').trim());
    return `Ran ${script}. Log: ${rows.join(' | ')}. Computers now: ${chState()}.`;
  },

  async polycode_set_code({ code = '' }) {
    code = String(code).replace(/\r/g, '');
    if (!code.trim()) return 'No code was given.';
    await open(CARD.polycode);
    const pc = poly();
    if (pc.running()) { await press(pc.run); await until(() => !pc.running(), 3000); }
    await polyType(code);
    return `The editor holds the program now (${code.split('\n').length} lines). It has not been run.`;
  },

  async polycode_run({ code = '', stdin = [] }) {
    code = String(code).replace(/\r/g, '');
    await open(CARD.polycode);
    const pc = poly();
    if (!code.trim() && !pc.ed.value.trim()) return 'No code was given and the editor is empty.';
    if (pc.running()) { await press(pc.run); await until(() => !pc.running(), 3000); }
    if (code.trim()) await polyType(code);       // without code: run what the editor already holds
    return polyWatch(Array.isArray(stdin) ? stdin.map(String) : [], () => press(pc.run));
  },

  async polycode_input({ text = '' }) {
    await open(CARD.polycode);
    if (poly().form.hidden) return 'The program is not waiting for input.';
    return polyWatch([String(text)]);
  },

  async polycode_stop() {
    await open(CARD.polycode);
    const pc = poly();
    if (!pc.running()) return `Nothing is running. Status: ${pc.status.textContent.trim() || 'unknown'}.`;
    await press(pc.run); await until(() => !pc.running(), 3000);
    return `Stopped. Status: ${pc.status.textContent.trim() || 'unknown'}.`;
  },

  async ionet_send({ message = '', encrypt = true }) {
    await open(CARD.ionet);
    const input = $('#nx-msg'), box = $('#nx-enc');
    await typeInto(input, [...String(message)].slice(0, 14).join('') || 'hello');
    // Flipping the switch starts a new session and sends by itself.
    if (box.checked !== !!encrypt) await press($('.nx-sw'), .25, .5); else await press($('#nx-form button'));
    return ionetDone();
  },

  async ionet_mode({ encrypt = true }) {
    await open(CARD.ionet);
    if ($('#nx-enc').checked === !!encrypt) return `The session is already ${encrypt ? 'encrypted' : 'plain'}.`;
    await press($('.nx-sw'), .25, .5);           // a new session: the message in the field is sent again
    return `Switched to ${encrypt ? 'an encrypted' : 'a plain'} session. ${await ionetDone()}`;
  },

  async ionet_reset() {
    await open(CARD.ionet);
    dispatchEvent(new CustomEvent('ionet:reset'));
    await sleep(300);
    return 'The session is forgotten. The next encrypted message starts with a new key exchange.';
  },

  /* The Calculator card is hidden (index.html), and so are its tools (tools.json: "disabled").
  async calculator_clear() {
    await open(CARD.calculator);
    await press($$('#calc button').find(b => b.textContent === 'C'));
    return `Cleared. Display: ${$('#calc output').textContent}.`;
  },

  async calculator_press({ keys = '' }) {
    const MAP = { '*': '×', x: '×', X: '×', '×': '×', '/': '÷', '÷': '÷', '-': '−', '−': '−', '+': '+', '=': '=', c: 'C', C: 'C' };
    const list = [...String(keys)].map(k => (/\d/.test(k) ? k : MAP[k])).filter(Boolean).slice(0, 24);
    if (!list.length) return 'No usable keys. Use digits, + - * /, = and C.';
    await open(CARD.calculator);
    const buttons = $$('#calc button');
    for (const k of list) await press(buttons.find(b => b.textContent === k));
    const expr = $('#calc-expr').textContent.trim();
    return `Pressed ${list.join(' ')}. Display: ${$('#calc output').textContent}${expr ? ` (${expr})` : ''}.`;
  },
  */

  async set_theme({ theme }) {
    const light = root.dataset.theme ? root.dataset.theme === 'light' : matchMedia('(prefers-color-scheme: light)').matches;
    if (theme !== 'light' && theme !== 'dark') return 'The theme is either light or dark.';
    if ((theme === 'light') !== light) $('#theme').click();
    return `The theme is ${theme} now.`;
  },

  async hero_push({ path = 'sweep' }) {
    const shape = PATHS[path];
    if (!shape) return `There is no path "${path}". Use sweep, circle or zigzag.`;
    await scrollToY(0);
    if (reduce) return 'The visitor has asked for reduced motion, so the field stays still.';
    const r = $('.hero').getBoundingClientRect(), to = k => { const [x, y] = shape(k, r.width, r.height); return [r.left + x, r.top + y]; };
    await moveTo(spot(...to(0)));
    await new Promise(done => {
      const began = performance.now(), dur = 2600;
      (function frame(now) {
        const k = Math.min(1, Math.max(0, (now - began) / dur));
        [gx, gy] = to(k); place();
        if (k < 1) requestAnimationFrame(frame); else done();
      })(began);
    });
    await wait(500);
    return `Your cursor went through the pixel field (${path}); the dots stepped aside and are settling back.`;
  },

  async hero_wave() {
    await scrollToY(0);
    if (reduce) return 'The visitor has asked for reduced motion, so the field stays still.';
    dispatchEvent(new CustomEvent('field:burst'));
    await wait(1600);
    return 'A burst of rings went through the pixel field at the top of the page.';
  },
};

export const toolNames = Object.keys(TOOLS);
/** The state sent with every chat request, so the model starts from what the page shows (not a tool call). */
export const pageState = () => TOOLS.get_page_state().catch(() => '');
let queue = Promise.resolve();
/** Runs one tool and returns its result as text. Calls are carried out one at a time. */
export function callTool(name, args) {
  const run = async () => {
    clearTimeout(restTimer);
    try {
      if (!TOOLS[name]) return `There is no tool "${name}".`;
      const result = String(await TOOLS[name](args && typeof args === 'object' ? args : {})).slice(0, 1500);
      if (DEMO.test(name)) await wait(600);
      return result;
    } catch (err) {
      return `The tool failed: ${err && err.message || err}`;
    } finally { rest(); }
  };
  return (queue = queue.then(run, run));
}
