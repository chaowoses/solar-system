// Each browser gets a random letter A-Z; each letter is a fixed gravitational
// constant (unitless, on the scale of the 10000 used in the other lab
// simulation). The instructor keeps the key; students only ever see the letter.

export const G_KEY = {
  A: 22000,
  B: 24000,
  C: 25500,
  D: 27500,
  E: 30000,
  F: 32500,
  G: 35000,
  H: 37500,
  I: 40500,
  J: 44000,
  K: 47500,
  L: 51000,
  M: 55500,
  N: 59500,
  O: 64500,
  P: 69500,
  Q: 75000,
  R: 81000,
  S: 87500,
  T: 94500,
  U: 102000,
  V: 110500,
  W: 119000,
  X: 128500,
  Y: 139000,
  Z: 150000,
};

export const LETTERS = Object.keys(G_KEY);
export const G_MIN = G_KEY.A;
export const G_MAX = G_KEY.H;

export function randomLetter() {
  // rejection sampling, so every letter is exactly equally likely
  const n = LETTERS.length;
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return LETTERS[buf[0] % n];
}
