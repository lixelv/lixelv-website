// Ionet demo: follow one message through the pipeline.
// Plain session:      Transmitter ─────────────▶ Receiver   (input and output directly connected)
// Encrypted session:  Encryptor ▶ Transmitter ─▶ Receiver ▶ Decryptor
// The key agreement (X25519) and the cipher (ChaCha20) are computed for real, in this tab.
import { $, $$, sleep, reduce, esc, hex, onceVisible } from '../util.js';
import { keyPair, x25519, chacha20Stream, xor } from './ionet-crypto.js';

const root = $('#nx'), form = $('#nx-form'), msg = $('#nx-msg'), encBox = $('#nx-enc');
const box = { tx: $('#nx-tx'), rx: $('#nx-rx'), en: $('#nx-en'), de: $('#nx-de') };
const note = { tx: $('#nx-tx-n'), rx: $('#nx-rx-n'), en: $('#nx-en-n'), de: $('#nx-de-n') };
const wire = $('#nx-wire'), step = $('#nx-step'), keyEl = $('#nx-key');
const utf8 = new TextEncoder(), TRAVEL = 480, MAX_BYTES = 16;

let run = 0, session = null;     // session: { client, server } shared keys (equal), n: messages sent

const short = b => hex(b[0]) + hex(b[1]) + '…' + hex(b[b.length - 1]);
const glyph = ch => (ch === ' ' ? '␣' : ch);
const cellsHTML = (items, cls) => items.map(t => `<i class="${cls}">${esc(t)}</i>`).join('');
const setNote = (k, text, cls = '') => { note[k].textContent = text; note[k].className = cls; };
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
function packet(cls, back = false) {
  if (reduce) return;
  const p = document.createElement('i');
  p.className = `pkt ${cls}${back ? ' back' : ''}`;
  p.addEventListener('animationend', () => p.remove());
  wire.append(p);
}
function showKey() {
  keyEl.innerHTML = session ? `<span>same</span><span>key</span><b>${hex(session.client[0])}${hex(session.client[1])}</b>` : '<span>ECDH</span><b>· ·</b>';
  keyEl.classList.toggle('set', !!session);
}

async function handshake(live) {
  const a = keyPair(), b = keyPair();
  active('wire');
  step.textContent = '1 · Handshake: the two sides swap public keys (ECDH)';
  setNote('en', `public key ${short(a.public)}`); setNote('de', `public key ${short(b.public)}`);
  for (let i = 0; i < 4; i++) { packet('key'); await sleep(70); }
  await sleep(TRAVEL); if (!live()) return;
  for (let i = 0; i < 4; i++) { packet('key', true); await sleep(70); }
  await sleep(TRAVEL); if (!live()) return;
  // Each side combines its own secret with the other's public key and lands on the same value.
  session = { client: x25519(a.secret, b.public), server: x25519(b.secret, a.public), n: 0 };
  showKey();
  setNote('en', `shared key ${short(session.client)}`, 'good'); setNote('de', `shared key ${short(session.server)}`, 'good');
  step.textContent = '2 · Both sides now hold the same key. It never crossed the wire.';
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
  ['tx', 'rx'].forEach(k => setNote(k, ''));
  showKey();

  let payload = bytes, stream = null;
  if (secure) {
    if (!session) { await handshake(live); if (!live()) return; }
    setNote('de', `shared key ${short(session.server)}`, 'good');
    // --- Encryptor: text -> bytes -> XOR with the keystream
    active('enc');
    step.textContent = 'Encryptor · your text in, ciphertext out: each byte is XORed with the keystream';
    // One column per byte: your text on top, the keystream byte under it, the result at the bottom.
    const top = chars.length === bytes.length ? chars : [...bytes].map(hex);
    box.en.innerHTML = top.map(t => `<span class="xc"><i class="ch">${esc(t)}</i><i class="k hid"></i><i class="c hid"></i></span>`).join('');
    setNote('en', 'your text');
    await sleep(520); if (!live()) return;
    const nonce = new Uint8Array(12); new DataView(nonce.buffer).setUint32(0, session.n++, true);
    stream = chacha20Stream(session.client, nonce, 0, bytes.length);
    payload = xor(bytes, stream);
    const cols = [...box.en.children];
    setNote('en', 'each byte ⊕ a keystream byte');
    for (let i = 0; i < cols.length && live(); i++) { const k = cols[i].children[1]; k.textContent = hex(stream[i]); k.classList.remove('hid'); await sleep(60); }
    await sleep(280); if (!live()) return;
    for (let i = 0; i < cols.length && live(); i++) { const c = cols[i].children[2]; c.textContent = hex(payload[i]); c.classList.remove('hid'); await sleep(80); }
    await sleep(700); if (!live()) return;
  }

  // --- Transmitter: frame = 4-byte length + payload
  active('tx');
  const lenCell = `<i class="len">len ${bytes.length}</i>`;
  if (secure) {
    step.textContent = 'Transmitter · the bytes leave encrypted: length, then ciphertext';
    box.tx.innerHTML = lenCell + cellsHTML([...payload].map(hex), 'c');
  } else {
    step.textContent = 'Transmitter · the text becomes bytes and goes out as it is';
    box.tx.innerHTML = cellsHTML(chars, 'ch'); setNote('tx', 'text');
    await sleep(480); if (!live()) return;
    await morph(box.tx, [...bytes].map(hex), 'p', live); if (!live()) return;
    box.tx.insertAdjacentHTML('afterbegin', lenCell);
  }
  setNote('tx', `${4 + bytes.length} bytes to the socket`);
  await sleep(420); if (!live()) return;

  // --- The wire: one packet per byte
  active('wire');
  step.textContent = secure ? 'On the wire · only ciphertext travels' : 'On the wire · the bytes travel in the clear';
  for (let i = 0; i < payload.length && live(); i++) {
    packet(secure ? 'c' : 'p');
    setTimeout(() => {
      if (live()) box.rx.insertAdjacentHTML('beforeend', `<i class="${secure ? 'c' : 'p'}">${hex(payload[i])}</i>`);
    }, reduce ? 0 : TRAVEL);
    await sleep(80);
  }
  await sleep(TRAVEL + 160); if (!live()) return;

  // --- Receiver, and the Decryptor when the session is encrypted
  active('rx'); setNote('rx', `${4 + bytes.length} bytes received`);
  await sleep(420); if (!live()) return;
  if (!secure) {
    step.textContent = 'Receiver · bytes back to text';
    await morph(box.rx, chars, 'ch', live); if (!live()) return;
    setNote('rx', 'text', 'good');
    step.textContent = 'Delivered. Plain session: input and output are connected directly.';
  } else {
    active('dec');
    step.textContent = 'Decryptor · the same keystream turns the noise back into bytes, then text';
    // Mirror of the encryptor: ciphertext on top, the same keystream byte under it, your text at the bottom.
    box.de.innerHTML = [...payload].map(b => `<span class="xc"><i class="c">${hex(b)}</i><i class="k hid"></i><i class="ch hid"></i></span>`).join('');
    setNote('de', 'ciphertext');
    await sleep(480); if (!live()) return;
    const nonce = new Uint8Array(12); new DataView(nonce.buffer).setUint32(0, session.n - 1, true);
    const ks = chacha20Stream(session.server, nonce, 0, payload.length);   // the server's own key, same keystream
    const plain = xor(payload, ks);
    const got = new TextDecoder().decode(plain);
    const out = [...got].length === plain.length ? [...got].map(glyph) : [...plain].map(hex);
    const cols = [...box.de.children];
    setNote('de', 'each byte ⊕ the same keystream byte');
    for (let i = 0; i < cols.length && live(); i++) { const k = cols[i].children[1]; k.textContent = hex(ks[i]); k.classList.remove('hid'); await sleep(60); }
    await sleep(280); if (!live()) return;
    for (let i = 0; i < cols.length && live(); i++) { const c = cols[i].children[2]; c.textContent = out[i]; c.classList.remove('hid'); await sleep(80); }
    if (!live()) return;
    step.textContent = 'Delivered. Only the two ends ever saw the text.';
  }
  await sleep(900); if (live()) active(null);
}

form.addEventListener('submit', e => { e.preventDefault(); send(); });
encBox.addEventListener('change', () => { session = null; send(); });   // a new session negotiates a new key

root.classList.toggle('plain', !encBox.checked);
showKey();
step.textContent = 'Type a message and press Send';
onceVisible(root, send, .45);
