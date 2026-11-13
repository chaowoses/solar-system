// Each browser gets a random letter A-H; each letter is a fixed gravitational
// constant (unitless, on the scale of the 10000 used in the other lab
// simulation). The instructor keeps the key; students only ever see the letter.

export const G_KEY = {
  A: 22000,
  B: 28000,
  C: 35000,
  D: 44000,
  E: 55000,
  F: 70000,
  G: 90000,
  H: 115000,
};

export const LETTERS = Object.keys(G_KEY);
export const G_MIN = G_KEY.A;
export const G_MAX = G_KEY.H;

export function randomLetter() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return LETTERS[buf[0] % LETTERS.length]; // 8 divides 2^32: no modulo bias
}
