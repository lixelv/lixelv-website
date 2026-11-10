// The two primitives Ionet's encrypted sessions are built on, in plain JavaScript,
// so the demo shows real key agreement and real ciphertext instead of random bytes.
// X25519 follows RFC 7748, ChaCha20 follows RFC 8439 (both checked against the RFC vectors).

const P = 2n ** 255n - 19n;
const mod = a => ((a % P) + P) % P;
const fromLE = bytes => bytes.reduceRight((n, b) => (n << 8n) | BigInt(b), 0n);
const toLE = n => Uint8Array.from({ length: 32 }, (_, i) => Number((n >> BigInt(8 * i)) & 255n));

function pow(base, exp) {
  let result = 1n;
  for (base = mod(base); exp > 0n; exp >>= 1n, base = mod(base * base)) if (exp & 1n) result = mod(result * base);
  return result;
}

/** Scalar multiplication on Curve25519 (Montgomery ladder). */
export function x25519(scalar, u) {
  const k = Uint8Array.from(scalar);
  k[0] &= 248; k[31] &= 127; k[31] |= 64;
  const kn = fromLE(k), x1 = fromLE(u) & ((1n << 255n) - 1n);
  let x2 = 1n, z2 = 0n, x3 = x1, z3 = 1n, swap = 0n;
  for (let t = 254n; t >= 0n; t--) {
    const bit = (kn >> t) & 1n;
    if (swap ^ bit) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
    swap = bit;
    const A = mod(x2 + z2), AA = mod(A * A), B = mod(x2 - z2), BB = mod(B * B), E = mod(AA - BB);
    const C = mod(x3 + z3), D = mod(x3 - z3), DA = mod(D * A), CB = mod(C * B);
    x3 = mod((DA + CB) ** 2n); z3 = mod(x1 * mod((DA - CB) ** 2n));
    x2 = mod(AA * BB); z2 = mod(E * (AA + 121665n * E));
  }
  if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
  return toLE(mod(x2 * pow(z2, P - 2n)));
}

const BASE = Uint8Array.from({ length: 32 }, (_, i) => (i ? 0 : 9));
export function keyPair() {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return { secret, public: x25519(secret, BASE) };
}

const rotl = (v, n) => (v << n) | (v >>> (32 - n));
function quarter(s, a, b, c, d) {
  s[a] += s[b]; s[d] = rotl(s[d] ^ s[a], 16);
  s[c] += s[d]; s[b] = rotl(s[b] ^ s[c], 12);
  s[a] += s[b]; s[d] = rotl(s[d] ^ s[a], 8);
  s[c] += s[d]; s[b] = rotl(s[b] ^ s[c], 7);
}

/** ChaCha20 keystream for `length` bytes. key: 32 bytes, nonce: 12 bytes. */
export function chacha20Stream(key, nonce, counter, length) {
  const kv = new DataView(key.buffer, key.byteOffset, 32), nv = new DataView(nonce.buffer, nonce.byteOffset, 12);
  const init = new Uint32Array(16), out = new Uint8Array(Math.ceil(length / 64) * 64), ov = new DataView(out.buffer);
  init.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
  for (let i = 0; i < 8; i++) init[4 + i] = kv.getUint32(i * 4, true);
  for (let i = 0; i < 3; i++) init[13 + i] = nv.getUint32(i * 4, true);
  for (let block = 0; block * 64 < length; block++) {
    init[12] = counter + block;
    const s = init.slice();
    for (let round = 0; round < 10; round++) {
      quarter(s, 0, 4, 8, 12); quarter(s, 1, 5, 9, 13); quarter(s, 2, 6, 10, 14); quarter(s, 3, 7, 11, 15);
      quarter(s, 0, 5, 10, 15); quarter(s, 1, 6, 11, 12); quarter(s, 2, 7, 8, 13); quarter(s, 3, 4, 9, 14);
    }
    for (let i = 0; i < 16; i++) ov.setUint32(block * 64 + i * 4, (s[i] + init[i]) >>> 0, true);
  }
  return out.subarray(0, length);
}

export const xor = (data, stream) => data.map((b, i) => b ^ stream[i]);
