// Ionet demo: follow one message through the pipeline.
// Plain session:      Transmitter ─────────────▶ Receiver   (input and output directly connected)
// Encrypted session:  Encryptor ▶ Transmitter ─▶ Receiver ▶ Decryptor
// The key agreement (X25519) and the cipher (ChaCha20) are computed for real, in this tab.
import { $, $$, sleep, reduce, esc, hex, onceVisible } from '../util.js';
import { keyPair, x25519, chacha20Stream, xor } from './ionet-crypto.js';

const root = $('#nx'), form = $('#nx-form'), msg = $('#nx-msg'), encBox = $('#nx-enc');
const box = { tx: $('#nx-tx'), rx: $('#nx-rx'), en: $('#nx-en'), de: $('#nx-de') };
const wire = $('#nx-wire'), step = $('#nx-step'), keyEl = $('#nx-key');
const utf8 = new TextEncoder(), TRAVEL = 480, MAX_BYTES = 16;

let run = 0, session = null;     // session: { client, server } shared keys (equal), n: messages sent

const glyph = ch => (ch === ' ' ? '␣' : ch);
const cellsHTML = (items, cls) => items.map(t => `<i class="${cls}">${esc(t)}</i>`).join('');
function active(name) {
  $$('.nx-b', root).forEach(b => b.classList.toggle('on', b.dataset.b === name));
  wire.classList.toggle('on', name === 'wire');
}
function clip(text) {            // keep the payload small enough to watch
  while (utf8.encode(text).length > MAX_BYTES) text = [...text].slice(0, -1).join('');
  return text;
}
function flip(cell, text, cls) {
  cell.classList.remove('flip'); void cell.offsetWidth; cell.classList.add('flip');
  setTimeout(() => { cell.textContent = text; cell.className = cls + ' flip'; }, reduce ? 0 : 115);
}
/** Turns the cells of a block into `items` one by one; rebuilds them when the count differs. */
async function morph(el, items, cls, live, gap = 55) {
  if (el.children.length !== items.length) { el.innerHTML = cellsHTML(items, cls); await sleep(260); return; }
  for (let i = 0; i < items.length && live(); i++) { flip(el.children[i], items[i], cls); await sleep(gap); }
  await sleep(240);
}
const bits = b => b.toString(2).padStart(8, '0');
/** XOR written the way a sum is written at school: one byte over the other, a rule, the result
 *  under it, filled in from the right. The cells above hold every byte of the message; each one
 *  turns into its result when its sum is done. */
async function columns(el, top, key, res, from, to, live) {
  el.innerHTML = cellsHTML(from.labels, from.cls) + '<div class="xs" aria-hidden="true">'
    + ['', '⊕', ''].map((op, r) => `${r === 2 ? '<hr>' : ''}<span class="xo">${op}</span><span class="xb"></span><span class="xh"></span>`).join('') + '</div>';
  const cells = [...el.children].slice(0, top.length), row = $$('.xb', el), side = $$('.xh', el);
  const per = Math.max(12, Math.min(40, 1500 / (top.length * 8)));       // a long message is summed faster
  await sleep(420);
  for (let i = 0; i < top.length && live(); i++) {
    cells[i].classList.add('cur');
    row[0].textContent = bits(top[i]); side[0].textContent = hex(top[i]);
    row[1].textContent = bits(key[i]); side[1].textContent = hex(key[i]);
    const sum = bits(res[i]); side[2].textContent = '';
    for (let b = 7; b >= 0 && live(); b--) { row[2].textContent = sum.slice(b).padStart(8, ' '); await sleep(per); }
    side[2].textContent = hex(res[i]);
    await sleep(per * 3);
    cells[i].classList.remove('cur'); flip(cells[i], to.labels[i], to.cls);
  }
  await sleep(600);
}
function packet(cls, back = false) {
  if (reduce) return;
  const p = document.createElement('i');
  p.className = `pkt ${cls}${back ? ' back' : ''}`;
  p.addEventListener('animationend', () => p.remove());
  wire.append(p);
}
function showKey() {
  keyEl.innerHTML = session ? `<span>same</span><span>key</span><b>${hex(session.client[0])}${hex(session.client[1])}</b>` : '<span>ECDH</span><b>—</b>';
  keyEl.classList.toggle('set', !!session);
}

async function handshake(live) {
  const a = keyPair(), b = keyPair();
  active('wire');
  step.textContent = '1. Handshake: the two sides swap public keys (ECDH)';
  for (let i = 0; i < 4; i++) { packet('key'); await sleep(70); }
  await sleep(TRAVEL); if (!live()) return;
  for (let i = 0; i < 4; i++) { packet('key', true); await sleep(70); }
  await sleep(TRAVEL); if (!live()) return;
  // Each side combines its own secret with the other's public key and lands on the same value.
  session = { client: x25519(a.secret, b.public), server: x25519(b.secret, a.public), n: 0 };
  showKey();
  step.textContent = '2. Both sides now hold the same key. It never crossed the wire.';
  await sleep(1100);
}

async function send() {
  const my = ++run, live = () => my === run;
  const text = clip(msg.value);
  if (!text) { step.textContent = 'Type a message first'; return; }
  if (text !== msg.value) msg.value = text;
  const secure = encBox.checked, bytes = utf8.encode(text), chars = [...text].map(glyph);
  root.classList.toggle('plain', !secure);
  Object.values(box).forEach(el => (el.innerHTML = ''));
  wire.querySelectorAll('.pkt').forEach(p => p.remove());
  showKey();

  let payload = bytes, stream = null;
  if (secure) {
    if (!session) { await handshake(live); if (!live()) return; }
    // --- Encryptor: text -> bytes -> XOR with the keystream
    active('enc');
    step.textContent = 'Encryptor: every byte of your text is XORed with a byte of the keystream';
    const nonce = new Uint8Array(12); new DataView(nonce.buffer).setUint32(0, session.n++, true);
    stream = chacha20Stream(session.client, nonce, 0, bytes.length);
    payload = xor(bytes, stream);
    await columns(box.en, bytes, stream, payload, { labels: chars.length === bytes.length ? chars : [...bytes].map(hex), cls: 'ch' }, { labels: [...payload].map(hex), cls: 'c' }, live);
    if (!live()) return;
  }

  // --- Transmitter: the payload goes out (the length prefix of the real frame is not drawn)
  active('tx');
  if (secure) {
    step.textContent = 'Transmitter: the bytes leave encrypted, only the ciphertext goes out';
    box.tx.innerHTML = cellsHTML([...payload].map(hex), 'c');
  } else {
    step.textContent = 'Transmitter: the text becomes bytes and goes out as it is';
    box.tx.innerHTML = cellsHTML(chars, 'ch');
    await sleep(480); if (!live()) return;
    await morph(box.tx, [...bytes].map(hex), 'p', live); if (!live()) return;
  }
  await sleep(420); if (!live()) return;

  // --- The wire: one packet per byte
  active('wire');
  step.textContent = secure ? 'On the wire: only ciphertext travels' : 'On the wire: the bytes travel in the clear';
  for (let i = 0; i < payload.length && live(); i++) {
    packet(secure ? 'c' : 'p');
    setTimeout(() => {
      if (live()) box.rx.insertAdjacentHTML('beforeend', `<i class="${secure ? 'c' : 'p'}">${hex(payload[i])}</i>`);
    }, reduce ? 0 : TRAVEL);
    await sleep(80);
  }
  await sleep(TRAVEL + 160); if (!live()) return;

  // --- Receiver, and the Decryptor when the session is encrypted
  active('rx');
  await sleep(420); if (!live()) return;
  if (!secure) {
    step.textContent = 'Receiver: bytes back to text';
    await morph(box.rx, chars, 'ch', live); if (!live()) return;
    step.textContent = 'Delivered. Plain session: input and output are connected directly.';
  } else {
    active('dec');
    step.textContent = 'Decryptor: the same keystream turns the noise back into your text';
    // Mirror of the encryptor: the ciphertext over the same keystream gives your text back.
    const nonce = new Uint8Array(12); new DataView(nonce.buffer).setUint32(0, session.n - 1, true);
    const ks = chacha20Stream(session.server, nonce, 0, payload.length);   // the server's own key, same keystream
    const plain = xor(payload, ks);
    const got = new TextDecoder().decode(plain);
    const out = [...got].length === plain.length ? [...got].map(glyph) : [...plain].map(hex);
    await columns(box.de, payload, ks, plain, { labels: [...payload].map(hex), cls: 'c' }, { labels: out, cls: 'ch' }, live);
    if (!live()) return;
    step.textContent = 'Delivered. Only the two ends ever saw the text.';
  }
  await sleep(900); if (live()) active(null);
}

form.addEventListener('submit', e => { e.preventDefault(); send(); });
encBox.addEventListener('change', () => { session = null; send(); });   // a new session negotiates a new key
// The chat's tool `ionet_reset`: forget the session, so the next message shows the handshake again.
addEventListener('ionet:reset', () => {
  run++; session = null;
  Object.values(box).forEach(el => (el.innerHTML = ''));
  active(null); showKey(); step.textContent = 'Type a message and press Send';
});

root.classList.toggle('plain', !encBox.checked);
showKey();
step.textContent = 'Type a message and press Send';
onceVisible(root, send, .45);
