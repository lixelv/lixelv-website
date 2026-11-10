// Polycode demo: a small slice of the real thing. The editor is editable, Run executes
// real Python in this tab (Pyodide in a worker), input() works, Stop interrupts.
// Python is downloaded only after the visitor clicks into the editor or presses Run.
import { $, esc, highlightPython } from '../util.js';

const STDIN_READY = 1, STDIN_EOF = 2, STDIN_INTERRUPT = 3, STDIN_MAX_BYTES = 64 * 1024;
const RUN_TIMEOUT_MS = 120_000;   // as in Polycode
const SAMPLE = `name = input("What's your name? ")
print(f"hi, {name}!")

a = int(input("a = "))
b = int(input("b = "))

print(f"\\na + b = {a + b}")
`;

const code = $('#pcx-code'), hl = $('#pcx-hl'), out = $('#pcx-out'), status = $('#pcx-status');
const runBtn = $('#pcx-run'), form = $('#pcx-in'), line = $('#pcx-line'), con = $('#pcx-con');
const isolated = self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';

let worker = null, ready = null, buffers = null;
let state = 'cold';                // cold | loading | ready | running
let python = '', timeout = 0, killTimer = 0, waitingInput = false;

/* ---------- editor: a transparent textarea over a highlighted copy ---------- */
function paint() { hl.innerHTML = highlightPython(code.value) + '\n'; }
code.value = SAMPLE; paint();
code.addEventListener('input', paint);
code.addEventListener('scroll', () => { hl.scrollTop = code.scrollTop; hl.scrollLeft = code.scrollLeft; });
code.addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    code.setRangeText('    ', code.selectionStart, code.selectionEnd, 'end'); paint();
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toggle(); }
  else if (e.key === 'Enter' && !e.shiftKey) {      // keep the indentation, one level deeper after ":"
    const before = code.value.slice(0, code.selectionStart), cur = before.slice(before.lastIndexOf('\n') + 1);
    const indent = cur.match(/^ */)[0] + (cur.trimEnd().endsWith(':') ? '    ' : '');
    e.preventDefault();
    code.setRangeText('\n' + indent, code.selectionStart, code.selectionEnd, 'end'); paint();
  }
});
// The first click into the editor is the signal to fetch Python.
code.addEventListener('focus', () => { if (state === 'cold') load(); });

/* ---------- console ---------- */
function print(text, cls = '') {
  const last = out.lastElementChild;
  if (last && last.className === cls) last.textContent += text;
  else { const s = document.createElement('span'); s.className = cls; s.textContent = text; out.append(s); }
  if (out.textContent.length > 1_000_000) out.textContent = out.textContent.slice(-800_000);   // only so a runaway loop cannot freeze the tab
  con.scrollTop = con.scrollHeight;
}
function setStatus(text, cls = '') { status.textContent = text; status.className = 'pcx-status ' + cls; }
function setState(next) {
  state = next;
  runBtn.textContent = next === 'running' ? '■ Stop' : next === 'loading' ? '… Loading' : '▶ Run';
  runBtn.classList.toggle('stop', next === 'running');
  runBtn.disabled = false;
}
function askInput(on) {
  waitingInput = on; form.hidden = !on;
  if (on) { line.value = ''; line.focus({ preventScroll: true }); con.scrollTop = con.scrollHeight; }
}

/* ---------- worker ---------- */
function load() {
  if (ready) return ready;
  if (state === 'cold') setState('loading');
  worker = new Worker('js/demos/py-worker.js');
  buffers = isolated ? {
    control: new SharedArrayBuffer(8),                 // [0] stdin state, [1] byte length of the line
    data: new SharedArrayBuffer(STDIN_MAX_BYTES),
    interrupt: new SharedArrayBuffer(1),
  } : null;
  ready = new Promise((resolve, reject) => {
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'status') setStatus(m.text, 'busy');
      else if (m.type === 'ready') { python = m.python; if (state === 'loading') setState('ready'); setStatus(`Python ${python}, WebAssembly`, 'ok'); resolve(); }
      else if (m.type === 'fatal') { fail(`Python did not load: ${m.text}`); reject(new Error(m.text)); }
      else if (m.type === 'out') print(m.text, m.stream === 'err' ? 'err' : '');
      else if (m.type === 'input_request') askInput(true);
      else if (m.type === 'done') finish(m);
    };
    worker.onerror = e => { fail('Python did not load. Check the connection and try again.'); reject(e); };
  });
  ready.catch(() => {});
  worker.postMessage({ type: 'init', buffers });
  return ready;
}
function fail(text) {
  worker?.terminate(); worker = null; ready = null;
  clearTimeout(timeout); clearTimeout(killTimer); askInput(false);
  setState('cold'); setStatus(text, 'bad');
}
function finish({ exitCode, ms }) {
  clearTimeout(timeout); clearTimeout(killTimer); askInput(false);
  setState('ready');
  const took = ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
  if (exitCode === 0) setStatus(`✓ finished in ${took}`, 'ok');
  else if (exitCode === 130) setStatus('Stopped', 'bad');
  else setStatus(`exit code ${exitCode}`, 'bad');
}

let queued = false;
async function run() {
  if (queued) return;                                   // a second click while Python is still loading
  queued = true;
  out.textContent = '';
  if (state === 'cold' || state === 'loading') print('Loading Python (first run only)…\n', 'hint');
  try { await load(); } catch { queued = false; return; }
  queued = false;
  out.textContent = '';
  const source = code.value;
  setState('running'); setStatus('Running…', 'busy');
  worker.postMessage({ type: 'run', source });
  timeout = setTimeout(() => { print('\nStopped: the program ran for 2 minutes.\n', 'err'); stop(); }, RUN_TIMEOUT_MS);
}

function stop() {
  if (state !== 'running') return;
  if (buffers) {
    const control = new Int32Array(buffers.control);
    new Uint8Array(buffers.interrupt)[0] = 2;          // SIGINT: KeyboardInterrupt inside Python
    if (waitingInput) { Atomics.store(control, 0, STDIN_INTERRUPT); Atomics.notify(control, 0); }
  }
  askInput(false);
  // If the interpreter does not answer the interrupt (or there is no shared memory), replace it.
  clearTimeout(killTimer);
  killTimer = setTimeout(() => {
    if (state !== 'running') return;
    worker?.terminate(); worker = null; ready = null;
    print('\nKeyboardInterrupt\n', 'err');
    clearTimeout(timeout); setState('cold'); setStatus('Stopped, interpreter restarted', 'bad');
  }, buffers ? 1500 : 0);
}

function toggle() { if (state === 'running') stop(); else run(); }
runBtn.addEventListener('click', toggle);

form.addEventListener('submit', e => {
  e.preventDefault();
  if (!waitingInput || !buffers) return;
  const text = line.value, bytes = new TextEncoder().encode(text).slice(0, STDIN_MAX_BYTES);
  const control = new Int32Array(buffers.control);
  new Uint8Array(buffers.data).set(bytes);
  print(text + '\n', 'in');                             // echo what was typed, like a terminal
  askInput(false);
  Atomics.store(control, 1, bytes.length);
  Atomics.store(control, 0, STDIN_READY);
  Atomics.notify(control, 0);
});
line.addEventListener('keydown', e => {                 // Ctrl+D: end of input
  if (e.key === 'd' && e.ctrlKey && waitingInput && buffers) {
    e.preventDefault(); askInput(false);
    const control = new Int32Array(buffers.control);
    Atomics.store(control, 0, STDIN_EOF); Atomics.notify(control, 0);
  }
});

out.innerHTML = `<span class="hint">${esc('Edit the code and press Run (Ctrl+Enter). This is real Python: it downloads once and runs in this tab, like in Polycode.')}</span>`;
setStatus('click the editor to load Python');
