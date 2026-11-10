// ControlHub demo: a tiny dashboard. Pick a script, pick computers, run it,
// and watch each machine react. The scripts follow the real ones: the `controlhub`
// library API, and shutdown.py / startup.py from control-hub/core-scripts.
import { $, $$, sleep, reduce, onceVisible, highlightPython } from '../util.js';

const SCRIPTS = {
  open: { name: 'run_program', code: 'from controlhub import run_program\n\nrun_program("notepad")' },
  full: { name: 'fullscreen', code: 'from controlhub import fullscreen\n\nfullscreen()' },
  cmd: { name: 'cmd', code: 'from controlhub import cmd\n\ncmd("echo Hello World")' },
  kill: { name: 'kill_process', code: 'from controlhub import kill_process\n\nkill_process("notepad")' },
  shutdown: { name: 'shutdown', code: 'from controlhub import cmd\n\ncmd("shutdown /s /t 1")' },
  // Wake-on-LAN: an online machine sends magic packets to the selected offline ones.
  awake: { name: 'awake', code: 'from wakeonlan import send_magic_packet\n\nfor pc in computers:  # the selected, offline ones\n    send_magic_packet(pc["mac"])' },
};
// status: online | idle | offline (the real client reports online, idle and running)
const PCS = [
  { name: 'PC-01', status: 'online', sel: true },
  { name: 'PC-02', status: 'online', sel: true },
  { name: 'PC-03', status: 'online', sel: true },
  { name: 'PC-04', status: 'idle', sel: false },
  { name: 'PC-05', status: 'offline', sel: false },
  { name: 'PC-06', status: 'online', sel: false },
];

const grid = $('#ch-grid'), log = $('#ch-log'), code = $('#ch-code'), runBtn = $('#ch-run'), tabs = $$('#ch-scripts button');
let current = 'open', hinted = false;

grid.innerHTML = PCS.map((p, i) => `
  <button type="button" class="pc" data-i="${i}">
    <span class="scr"><span class="win"></span><span class="out"></span></span>
    <span class="nm"><i></i><span>${p.name}</span></span>
  </button>`).join('');
const tiles = $$('.pc', grid);

const up = p => p.status !== 'offline' && !p.booting;
/** The machines the current script would act on: awake takes the offline ones, the rest need a live client. */
const targets = id => PCS.filter(p => p.sel && !p.busy && !p.booting && (id === 'awake' ? p.status === 'offline' : up(p)));

function paint() {
  PCS.forEach((p, i) => {
    const t = tiles[i], state = p.booting ? 'booting' : p.busy ? 'running' : p.status;
    t.dataset.status = state;
    t.classList.toggle('sel', p.sel);
    t.classList.toggle('has-win', !!p.win);
    t.classList.toggle('full', !!p.full);
    t.classList.toggle('dying', !!p.dying);
    t.setAttribute('aria-pressed', String(p.sel));
    t.setAttribute('aria-label', `${p.name}, ${state}${p.sel ? ', selected' : ''}`);
  });
  const n = targets(current).length;
  if (current === 'awake') runBtn.innerHTML = n ? `▶ Wake <b>${n}</b>` : 'Select an offline computer';
  else runBtn.innerHTML = n ? `▶ Run on <b>${n}</b>` : 'Select an online computer';
  runBtn.disabled = !n;
}

function say(html, cls = '') {
  const t = new Date().toLocaleTimeString('en-GB');
  const row = document.createElement('div');
  row.className = cls;
  row.innerHTML = `<time>${t}</time>${html}`;
  // The log is a reversed flex column: the newest row is first in the DOM and the view
  // stays pinned to the bottom on its own, even while the card is off screen.
  log.prepend(row);
  while (log.children.length > 30) log.lastChild.remove();
  log.scrollTop = 0;
}

function pick(id) {
  current = id;
  tabs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === id)));
  code.innerHTML = highlightPython(SCRIPTS[id].code);
  paint();
}

/** What the script does on one machine. Returns the note for the log. */
function effect(p, tile, id) {
  if (id === 'open') { p.win = true; return 'notepad opened'; }
  if (id === 'full') { if (p.win) { p.full = true; return 'window maximised'; } return 'no window to maximise'; }
  if (id === 'kill') { const had = p.win; p.win = p.full = false; return had ? '1 process killed' : '0 processes found'; }
  if (id === 'shutdown') return 'shutting down';
  const out = $('.out', tile);
  out.textContent = 'Hello World';
  tile.classList.add('echo');
  setTimeout(() => tile.classList.remove('echo'), reduce ? 0 : 2200);
  return 'stdout: Hello World';
}

async function runOn(p, id) {
  const i = PCS.indexOf(p);
  p.busy = true; paint();
  const took = 350 + Math.random() * 900;
  await sleep(took);
  if (p.status === 'idle') p.status = 'online';       // a task wakes an idle machine
  const note = effect(p, tiles[i], id);
  say(`<b>${p.name}</b> ${SCRIPTS[id].name} <span class="ok">✓</span> <span class="dim">${note}, ${(took / 1000).toFixed(1)}s</span>`);
  if (id === 'shutdown') {                             // the screen collapses, then the client drops off
    p.dying = true; paint();
    await sleep(650);
    p.dying = false; p.win = p.full = false; p.status = 'offline';
    say(`<b>${p.name}</b> <span class="dim">client disconnected</span>`);
  }
  p.busy = false; paint();
}

async function boot(p, how) {
  p.booting = true; paint();
  await sleep(1300 + Math.random() * 900);
  p.booting = false; p.status = 'online'; paint();
  say(`<b>${p.name}</b> <span class="ok">●</span> <span class="dim">${how}, client connected</span>`);
}

async function wake(list) {
  const sender = PCS.find(p => up(p) && !p.busy) || PCS.find(up);
  if (!sender) {
    // Nothing on the network can send the packet. Someone has to walk over.
    say('<span class="dim">no computer is online to send the magic packet from</span>', 'warn');
    await sleep(1100);
    say(`<b>${list[0].name}</b> <span class="dim">someone pressed its power button</span>`);
    await boot(list[0], 'powered on by hand');
    return;
  }
  say(`<span class="dim">→ awake runs on ${sender.name}</span>`);
  sender.busy = true; paint();
  await sleep(450);
  for (const p of list) {
    say(`<b>${sender.name}</b> <span class="dim">sent magic packet to</span> <b>${p.name}</b>`);
    boot(p, 'woke up');
    await sleep(160);
  }
  sender.busy = false; paint();
}

async function run() {
  const id = current, list = targets(id);
  if (!list.length) return;
  if (id === 'awake') return wake(list);
  say(`<span class="dim">→ ${SCRIPTS[id].name} sent to ${list.length} computer${list.length > 1 ? 's' : ''}</span>`);
  for (const p of list) { runOn(p, id); await sleep(110); }   // tasks fan out one by one
}

grid.addEventListener('click', e => {
  const t = e.target.closest('.pc'); if (!t) return;
  const p = PCS[+t.dataset.i];
  p.sel = !p.sel; paint();
  if (p.sel && p.status === 'offline' && current !== 'awake' && !hinted) {
    hinted = true;
    say(`<b>${p.name}</b> <span class="dim">is offline. Pick</span> awake <span class="dim">to start it.</span>`);
  }
});
tabs.forEach(b => b.addEventListener('click', () => pick(b.dataset.s)));
runBtn.addEventListener('click', run);

pick('open');
say('<span class="dim">5 clients connected, 1 offline</span>');
onceVisible($('#ch'), () => setTimeout(run, reduce ? 0 : 500), .5);
