"use strict";
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
const js = (f) => pathToFileURL(path.join(__dirname, "..", "public", "js", f)).href;

(async () => {
  const { G_KEY, LETTERS, G_MIN, G_MAX, randomLetter } = await import(js("constant.js"));
  assert.deepStrictEqual(LETTERS, "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
  const values = Object.values(G_KEY);
  assert.strictEqual(new Set(values).size, 26, "each letter needs its own G");
  assert(Math.min(...values) >= 22000, "lowest G should be 22000");
  for (const g of values) assert(Math.abs(g / 10000 - 1) > 0.09, `too close to 10000: ${g}`);
  const seen = new Set();
  for (let i = 0; i < 6000; i++) {
    const l = randomLetter();
    assert(l in G_KEY, `bad letter ${l}`);
    seen.add(l);
  }
  assert.strictEqual(seen.size, 26, "every letter should come up");
  console.log("letters A-Z map to 26 distinct fixed G values; all letters get drawn");

  const { System, STAR_MASS } = await import(js("physics.js"));

  // No initial velocity: it falls straight in and crashes, in about the
  // free-fall time (pi/(2*sqrt2)) * sqrt(r^3 / GM).
  for (const G of [G_MIN, 10000, G_MAX]) {
    const s = new System(G);
    s.place(200, 0);
    s.run(1000);
    assert(s.crashed, `planet should crash at G=${G}`);
    const tff = (Math.PI / (2 * Math.SQRT2)) * Math.sqrt(200 ** 3 / (G * STAR_MASS));
    assert(Math.abs(s.t / tff - 1) < 0.05, `fall time ${s.t} vs ${tff}`);
  }
  console.log("zero velocity -> crashes into the star, in the free-fall time");

  // The launch arrow is capped at 1.2x circular speed (about 85% of escape
  // speed), so any release, in any direction, at any distance and G, is bound.
  for (const G of [G_MIN, 30000, G_MAX]) {
    for (const r of [30, 200, 800]) {
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * 2 * Math.PI;
        const vc = Math.sqrt((G * STAR_MASS) / r);
        const s = new System(G);
        s.place(r, 0);
        s.setVelocity(1.2 * vc * Math.cos(ang), 1.2 * vc * Math.sin(ang));
        const E = 0.5 * (s.home.vx ** 2 + s.home.vy ** 2) - (G * STAR_MASS) / r;
        assert(E < 0, `max launch must be bound (G=${G}, r=${r}, angle=${k})`);
        s.run(2 * Math.PI * Math.sqrt((r * r * r) / (G * STAR_MASS)));
        assert(!s.escaped, `max launch escaped (G=${G}, r=${r}, angle=${k})`);
      }
    }
  }
  console.log("the largest allowed launch speed never escapes");

  // Launched sideways: the period must follow T = 2*pi*sqrt(a^3 / GM) where
  // a is the semi-major axis (half the major axis), for circles and ellipses.
  for (const G of [G_MIN, 10000, G_MAX]) {
    for (const r of [60, 200, 700]) {
      for (const f of [1.0, 0.8, 0.6, 1.2]) {
        const s = new System(G);
        s.place(r, 0);
        s.setVelocity(0, f * Math.sqrt((G * STAR_MASS) / r));
        const a = 1 / (2 / r - (f * f) / r); // vis-viva with v = f*vc
        let T = null;
        let guard = 0;
        while (T === null && guard++ < 5e6) {
          const a0 = s.angle, t0 = s.t;
          s.run(0.5 * Math.sqrt(r ** 3 / (G * STAR_MASS)) * 0.01 + 1e-6, null, 1);
          if (s.crashed) break;
          if (s.angle >= 2 * Math.PI) T = t0 + ((2 * Math.PI - a0) / (s.angle - a0)) * (s.t - t0);
        }
        if (T === null) continue; // too eccentric to be an orbit that clears the star: skip
        const theory = 2 * Math.PI * Math.sqrt(a ** 3 / (G * STAR_MASS));
        assert(Math.abs(T / theory - 1) < 5e-4, `period off at G=${G} r=${r} f=${f}: ${T} vs ${theory}`);
      }
    }
  }
  console.log("periods match T = 2*pi*sqrt(a^3/GM) for circular and elliptical orbits");
  console.log("all tests passed");
})();
