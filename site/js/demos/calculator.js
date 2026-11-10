// Calculator demo: small, but real. Works with the mouse and, once focused, the keyboard.
import { $, $$ } from '../util.js';

const box = $('#calc'), out = $('output', box), expr = $('#calc-expr');
const OPS = { '+': (a, b) => a + b, '−': (a, b) => a - b, '×': (a, b) => a * b, '÷': (a, b) => (b ? a / b : NaN) };
const KEYS = { '*': '×', x: '×', '/': '÷', '-': '−', Enter: '=', Escape: 'C', c: 'C', Delete: 'C' };
const fmt = n => String(+n.toPrecision(10)).slice(0, 12);
let cur = '0', acc = null, op = null, fresh = true;

function press(k) {
  if (/^\d$/.test(k)) { cur = (fresh || cur === '0' ? k : cur + k).slice(0, 10); fresh = false; if (!op) expr.textContent = ''; }
  else if (k === 'Backspace') { if (!fresh) cur = cur.length > 1 ? cur.slice(0, -1) : '0'; }
  else if (k === 'C') { cur = '0'; acc = null; op = null; fresh = true; expr.textContent = ''; }
  else if (k in OPS || k === '=') {
    const v = parseFloat(cur) || 0, before = acc;
    if (op && !fresh) { expr.textContent = `${fmt(before)} ${op} ${fmt(v)} ${k === '=' ? '=' : k}`; acc = OPS[op](acc, v); }
    else if (acc === null || !op) { acc = v; if (k !== '=') expr.textContent = `${fmt(v)} ${k}`; }
    else if (k !== '=') expr.textContent = `${fmt(acc)} ${k}`;
    op = k === '=' ? null : k; fresh = true;
    if (Number.isFinite(acc)) cur = fmt(acc); else { cur = 'error'; acc = null; op = null; }
    out.classList.remove('pop'); void out.offsetWidth; out.classList.add('pop');
  } else return false;
  out.textContent = cur;
  return true;
}

// Safari does not focus a button on click, so the keyboard would stay deaf after using the mouse.
box.addEventListener('pointerdown', () => { if (!box.contains(document.activeElement)) box.focus({ preventScroll: true }); });
box.addEventListener('click', e => { const b = e.target.closest('button'); if (b) press(b.textContent); });
box.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('button')) return;   // let a focused button click itself
  const k = KEYS[e.key] ?? e.key;
  if (!press(k)) return;
  e.preventDefault();
  const b = $$('button', box).find(x => x.textContent === k);
  if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120); }
});
