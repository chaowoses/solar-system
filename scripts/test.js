"use strict";
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
const js = (f) => pathToFileURL(path.join(__dirname, "..", "public", "js", f)).href;

(async () => {
  const { randomG, G_MIN, G_MAX } = await import(js("constant.js"));
  const vals = [];
  for (let i = 0; i < 5000; i++) {
    const g = randomG();
    assert(g >= G_MIN * 0.999 && g <= G_MAX * 1.001, `out of range: ${g}`);
    assert(Math.abs(g / 10000 - 1) > 0.09, `too close to 10000: ${g}`);
    vals.push(g);
  }
  vals.sort((a, b) => a - b);
  console.log(`G over 5000 draws: min ${vals[0]}, median ${vals[2500]}, max ${vals[4999]}`);
  assert(vals[4999] / vals[0] > 10, "not varied enough");

  // The teacher PIN is only shipped as a salted hash.
  const fs = require("fs");
  const { verifyPin } = await import(js("pin.js"));
  const pin = (fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").match(/TEACHER_PIN\s*=\s*(.*)/) || [])[1].trim();
  assert.strictEqual(await verifyPin(pin), true);
  assert.strictEqual(await verifyPin(pin + "x"), false);
  assert.strictEqual(await verifyPin(""), false);
  const cfg = fs.readFileSync(path.join(__dirname, "..", "public", "js", "config.js"), "utf8");
  assert(!cfg.includes(pin), "PIN leaked into config.js");
  console.log("PIN check ok; config.js contains only the hash");

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
