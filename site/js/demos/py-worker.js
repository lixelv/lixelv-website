// Runs Python (Pyodide, CPython compiled to WebAssembly) off the main thread, so a
// program that waits for input() or loops forever never freezes the page.
//
// A small port of Polycode's runner: github.com/lixelv/polycode
//   frontend/src/workers/runner.worker.ts, src/python/runner.py, src/lib/python/signal-buffer.ts
// Kept: the blocking input() over a SharedArrayBuffer, Stop as a real KeyboardInterrupt,
// the sliced time.sleep, and tracebacks that start in main.py.

const PYODIDE_VERSION = '314.0.7'; // same as Polycode
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const STDIN_WAITING = 0, STDIN_READY = 1, STDIN_EOF = 2, STDIN_INTERRUPT = 3;

const RUNNER_PY = `
"""Runs the user's program inside Pyodide as __main__."""
import builtins
import os
import sys
import traceback

PROJECT = "/home/pyodide/project"
SLEEP_STEP = 0.05
SLEEP_RANGE = 1e10


def install_sleep():
    """time.sleep in slices, checking for a Stop after each: Pyodide looks at the
    interrupt buffer only every so often, so a long sleep would notice it seconds late."""
    import functools
    import time

    import pyodide_js

    original = time.sleep

    @functools.wraps(original)
    def sleep(seconds, /):
        if not isinstance(seconds, (int, float)) or seconds != seconds or abs(seconds) >= SLEEP_RANGE:
            original(seconds)
            pyodide_js.checkInterrupt()
            return
        if seconds < 0:
            raise ValueError("sleep length must be non-negative")
        remaining = seconds
        while True:
            part = min(remaining, SLEEP_STEP)
            original(part)
            pyodide_js.checkInterrupt()
            remaining -= part
            if remaining <= 0:
                return

    time.sleep = sleep


def _flush(stream):
    try:
        stream.flush()
    except (ValueError, OSError):
        pass


def run_main(source, arm=None):
    """Writes the source to main.py (so tracebacks show its lines) and runs it."""
    import linecache

    os.makedirs(PROJECT, exist_ok=True)
    os.chdir(PROJECT)
    path = "main.py"
    with open(path, "w", encoding="utf-8") as f:
        f.write(source)
    linecache.checkcache()
    if PROJECT not in sys.path:
        sys.path.insert(0, PROJECT)
    try:
        code = compile(source, path, "exec")
    except SyntaxError as exc:
        traceback.print_exception(type(exc), exc, None)
        return 1
    sys.argv = [path]
    namespace = {"__name__": "__main__", "__file__": path, "__builtins__": builtins}
    try:
        if arm:
            arm()
        exec(code, namespace)
    except SystemExit as exc:
        code = exc.code
        if code is None:
            return 0
        if isinstance(code, int):
            return code
        print(code, file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\\nKeyboardInterrupt", file=sys.stderr)
        return 130
    except BaseException as exc:
        # Drop this bootstrap's frame so the traceback starts in main.py.
        traceback.print_exception(type(exc), exc, exc.__traceback__.tb_next)
        return 1
    finally:
        _flush(sys.stdout)
        _flush(sys.stderr)
    return 0
`;

let py = null, runner = null, buffers = null, eofRepeat = false;
const post = msg => self.postMessage(msg);

/**
 * What Pyodide gets as its interrupt buffer. Its signal check reads the buffer and then
 * always writes 0, so a Stop written between the two would be erased. Here the write
 * happens only after a read that saw a signal. (Polycode's signal-buffer.ts.)
 */
function signalBuffer(raw) {
  let seen = 0;
  return {
    get 0() { return (seen = Atomics.load(raw, 0)); },
    set 0(value) { if (seen) Atomics.store(raw, 0, value); },
  };
}

function stream(name) {
  const decoder = new TextDecoder();
  return { write(bytes) { const text = decoder.decode(bytes, { stream: true }); if (text) post({ type: 'out', stream: name, text }); return bytes.length; }, isatty: true };
}

/** Blocks the worker until the page sends a line (or EOF / Stop). */
function readLine() {
  if (!buffers) {
    // Without cross-origin isolation there is no SharedArrayBuffer to block on: input() gets EOF.
    post({ type: 'out', stream: 'err', text: 'input() needs this page to be served with COOP and COEP headers (the bundled server sends them).\n' });
    return null;
  }
  // input() on a tty reads once more after an empty read: without this, EOF has to be sent twice.
  if (eofRepeat) { eofRepeat = false; return null; }
  const { control, data } = buffers;
  Atomics.store(control, 0, STDIN_WAITING);
  post({ type: 'input_request' });
  Atomics.wait(control, 0, STDIN_WAITING);
  const state = Atomics.load(control, 0);
  if (state === STDIN_INTERRUPT) { py.checkInterrupt(); return null; } // raises KeyboardInterrupt inside Python
  if (state === STDIN_EOF) { eofRepeat = true; return null; }
  return new TextDecoder().decode(data.slice(0, Atomics.load(control, 1)));
}

async function boot(shared) {
  post({ type: 'status', text: 'Downloading Python…' });
  importScripts(PYODIDE_CDN + 'pyodide.js');
  py = await self.loadPyodide({ indexURL: PYODIDE_CDN, stdout: () => {}, stderr: () => {} });
  post({ type: 'status', text: 'Starting Python…' });
  if (shared) buffers = { control: new Int32Array(shared.control), data: new Uint8Array(shared.data), interrupt: new Uint8Array(shared.interrupt) };

  py.FS.mkdirTree('/home/pyodide/polycode');
  py.FS.writeFile('/home/pyodide/polycode/__init__.py', '');
  py.FS.writeFile('/home/pyodide/polycode/runner.py', RUNNER_PY);
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
  runner = py.pyimport('polycode.runner');
  runner.install_sleep();
  // The user's code must not find our package.
  py.runPython("import shutil, sys\nsys.path.remove('/home/pyodide')\nfor n in [n for n in sys.modules if n == 'polycode' or n.startswith('polycode.')]:\n    del sys.modules[n]\nshutil.rmtree('/home/pyodide/polycode')");

  py.setStdout(stream('out'));
  py.setStderr(stream('err'));
  py.setStdin({ stdin: readLine, isatty: true });
  post({ type: 'ready', python: py.runPython('import sys; sys.version.split()[0]'), isolated: !!buffers });
}

function run(source) {
  const started = performance.now();
  eofRepeat = false;
  // Interrupts go on just before the program starts: a Stop that came earlier is raised right away.
  const arm = buffers ? () => { py.setInterruptBuffer(signalBuffer(buffers.interrupt)); py.checkInterrupt(); } : undefined;
  let exitCode = 1;
  try {
    exitCode = arm ? runner.run_main.callKwargs(source, { arm }) : runner.run_main(source);
  } catch (err) {
    post({ type: 'out', stream: 'err', text: String(err && err.message || err) + '\n' });
  } finally {
    if (buffers) { py.setInterruptBuffer(undefined); buffers.interrupt[0] = 0; }
  }
  post({ type: 'done', exitCode, ms: performance.now() - started });
}

self.onmessage = async ({ data: msg }) => {
  if (msg.type === 'init') {
    try { await boot(msg.buffers); } catch (err) { post({ type: 'fatal', text: String(err && err.message || err) }); }
  } else if (msg.type === 'run') run(msg.source);
};
