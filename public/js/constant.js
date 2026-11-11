// Picks this browser's gravitational constant. Unitless, on the scale of the
// 10000 used in the other lab simulation. Log-uniform so low and high values
// are equally likely, which makes neighbouring students' values differ a lot.

export const G_MIN = 8000;
export const G_MAX = 100000;
const AVOID = 10000; // don't hand anyone the familiar value
const AVOID_BAND = 0.1;

export function randomG() {
  for (;;) {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    const u = (buf[0] * 2 ** 21 + (buf[1] >>> 11)) / 2 ** 53; // [0, 1)
    const g = G_MIN * Math.pow(G_MAX / G_MIN, u);
    if (Math.abs(g / AVOID - 1) > AVOID_BAND) return Number(g.toPrecision(3));
  }
}
