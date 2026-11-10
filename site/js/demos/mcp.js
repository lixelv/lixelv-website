// The page side of GlassChat's "site" MCP server. The model asks for a tool (server/tools.json),
// and this module carries it out in the visitor's browser: a small cursor with the chat's name
// moves over the page and presses the real buttons of the demos, then the result goes back.
// It also owns the pinned mode: the chat leaves its card and stays at the side of the screen
// while the visitor looks at the other demos.
import { $, $$, sleep, reduce } from '../util.js';

const root = document.documentElement;
const gc = $('#gc'), home = $('#gc-viz'), msgs = $('#gc-msgs'), pinBtn = $('#gc-pin');
const cards = $$('.card'), cardsEl = $('.cards');
const CARD = { controlhub: 0, polycode: 1, glasschat: 2, ionet: 3, calculator: 4 };
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
pinBtn.addEventListener('click', () => (pinned ? unpin() : pin()));
$('button', away).addEventListener('click', unpin);
addEventListener('keydown', e => { if (e.key === 'Escape') unpin(); });
// A click that is neither in the chat nor on a demo sends the chat home.
addEventListener('pointerdown', e => {
  if (pinned && e.isTrusted && e.target !== root && !e.target.closest('.gc, .viz')) unpin();
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
const ghost = make('div', 'mcp-cursor', '<svg viewBox="0 0 20 22" width="20" height="22"><path d="M3 2v14.2l3.9-3.5 2.7 6 2.4-1.1-2.7-5.9 5.2-.3z"/></svg><b>GlassChat</b>');
ghost.setAttribute('aria-hidden', 'true');
document.body.append(ghost);
let gx = 0, gy = 0, shown = false, restTimer = 0;

function place() {
  ghost.style.transform = `translate(${(gx - 3).toFixed(1)}px, ${(gy - 2).toFixed(1)}px)`;
  dispatchEvent(new CustomEvent('ghost:move', { detail: { x: gx, y: gy } }));   // the dot fields part for it too
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

  async controlhub_run({ script, computers }) {
    const id = SCRIPT[script];
    if (!id) return `There is no script "${script}".`;
    await open(CARD.controlhub);
    const tiles = $$('#ch-grid .pc'), run = $('#ch-run'), log = $('#ch-log');
    const working = () => tiles.some(t => /running|booting/.test(t.dataset.status));
    await until(() => !working(), 5000, 650);        // the demo runs once by itself when it first comes into view
    await press($(`#ch-scripts [data-s="${id}"]`));
    if (Array.isArray(computers)) {
      const want = new Set(computers.map(Number));
      for (const [i, tile] of tiles.entries()) if (tile.classList.contains('sel') !== want.has(i + 1)) await press(tile, .5, .4);
    }
    const state = () => tiles.map(t => `${$('.nm span', t).textContent} ${t.dataset.status}${t.classList.contains('full') ? ' (notepad, fullscreen)' : t.classList.contains('has-win') ? ' (notepad open)' : ''}`).join('; ');
    if (run.disabled) return `Nothing ran. The button says "${run.textContent.trim()}". Computers: ${state()}.`;
    const before = log.firstElementChild;
    await press(run);
    await until(() => !working(), 9000, 700);
    const rows = [];
    for (let r = log.firstElementChild; r && r !== before && rows.length < 9; r = r.nextElementSibling) rows.unshift(r.textContent.replace(/^[\d:]+/, '').trim());
    return `Ran ${script}. Log: ${rows.join(' | ')}. Computers now: ${state()}.`;
  },

  async polycode_run({ code = '', stdin = [] }) {
    code = String(code).replace(/\r/g, '').slice(0, 1200);
    if (!code.trim()) return 'No code was given.';
    await open(CARD.polycode);
    const ed = $('#pcx-code'), run = $('#pcx-run'), status = $('#pcx-status'), out = $('#pcx-out'), form = $('#pcx-in'), line = $('#pcx-line');
    const running = () => run.classList.contains('stop');
    if (running()) { await press(run); await until(() => !running(), 3000); }
    // The source appears line by line, as if pasted by a quick typist.
    await reveal(ed); await moveTo(ed, .2, .25);
    const lines = code.split('\n'), per = Math.min(80, 1500 / lines.length);
    for (let i = 1; i <= lines.length; i++) {
      ed.value = lines.slice(0, i).join('\n');
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(per);
    }
    let started = false;
    const seen = new MutationObserver(() => { if (running()) started = true; });   // a quick program is over between two looks
    seen.observe(run, { attributes: true, attributeFilter: ['class'] });
    await press(run);
    const queue = Array.isArray(stdin) ? stdin.map(String) : [], began = Date.now();
    let note = '';
    for (;;) {
      await wait(120);
      if (Date.now() - began > 60_000) { note = ' Stopped after 60 seconds.'; if (running()) run.click(); break; }
      if (!form.hidden) {
        if (!queue.length) { note = ' The program asked for more input than was given, so it was stopped.'; run.click(); await until(() => !running(), 2500); break; }
        await typeInto(line, queue.shift());
        if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        continue;
      }
      if (started && !running()) break;
      if (!started && Date.now() - began > 900 && status.classList.contains('bad')) break;   // Python did not load
    }
    seen.disconnect();
    return `Status: ${status.textContent.trim() || 'unknown'}.${note}\nConsole:\n${out.textContent.slice(-1100) || '(nothing printed)'}`;
  },

  async ionet_send({ message = '', encrypt = true }) {
    await open(CARD.ionet);
    const input = $('#nx-msg'), box = $('#nx-enc'), step = $('#nx-step');
    const done = () => step.textContent.startsWith('Delivered');
    await typeInto(input, [...String(message)].slice(0, 14).join('') || 'hello');
    // Flipping the switch starts a new session and sends by itself.
    if (box.checked !== !!encrypt) await press($('.nx-sw'), .25, .5); else await press($('#nx-form button'));
    await until(() => !done(), 600);
    const ok = await until(done, 25_000);
    const cells = sel => $$(sel + ' > i').map(i => i.textContent).join(' ');
    const got = encrypt ? $$('#nx-de .xc').map(c => c.children[2].textContent).join('').replace(/␣/g, ' ') : $$('#nx-rx i').map(i => i.textContent).join('').replace(/␣/g, ' ');
    return `${ok ? step.textContent : 'It did not finish in time.'} Sent "${input.value}". On the wire: ${cells('#nx-tx')}. ${encrypt ? `Both sides derived the same key (starts ${$('#nx-key b')?.textContent || '?'}). ` : ''}The receiver read "${got}".`;
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

  async set_theme({ theme }) {
    const light = root.dataset.theme ? root.dataset.theme === 'light' : matchMedia('(prefers-color-scheme: light)').matches;
    if (theme !== 'light' && theme !== 'dark') return 'The theme is either light or dark.';
    if ((theme === 'light') !== light) $('#theme').click();
    return `The theme is ${theme} now.`;
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
let queue = Promise.resolve();
/** Runs one tool and returns its result as text. Calls are carried out one at a time. */
export function callTool(name, args) {
  const run = async () => {
    clearTimeout(restTimer);
    try {
      if (!TOOLS[name]) return `There is no tool "${name}".`;
      return String(await TOOLS[name](args && typeof args === 'object' ? args : {})).slice(0, 1500);
    } catch (err) {
      return `The tool failed: ${err && err.message || err}`;
    } finally { rest(); }
  };
  return (queue = queue.then(run, run));
}
