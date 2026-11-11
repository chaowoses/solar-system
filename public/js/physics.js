// Unitless two-body gravity (matches the lab sheet: star M = 500, planet 0.001).
// Real Newtonian physics: the planet is given a position and an initial
// velocity and then simply obeys F = G m M / r². With no sideways velocity it
// falls straight into the star; slower-than-circular launches give ellipses
// that reach in close; fast enough and it escapes.

export const STAR_MASS = 500;
export const PLANET_MASS = 0.001;
export const STAR_RADIUS = 10; // the planet crashes when it gets this close
export const R_MIN = 25; // closest the planet may be placed
export const R_MAX = 800; // farthest the planet may be placed
export const ESCAPE_R = 20000;

// Time step = ETA × the local dynamical time sqrt(r³/GM). It shrinks by
// itself near the star, so close passes of eccentric orbits stay accurate, and
// the step depends on G, so accuracy doesn't depend on the hidden constant.
const ETA = 0.003;

export class System {
  constructor(G) {
    this.G = G;
    this.home = { x: 200, y: 0, vx: 0, vy: 0 }; // where the student put it, and how fast it starts
    this.reset();
  }

  /** Planet back at its placed position and velocity; clock to zero. */
  reset() {
    const h = this.home;
    this.t = 0;
    this.crashed = false;
    this.escaped = false;
    this.angle = 0;
    this.prevTheta = Math.atan2(h.y, h.x);
    this.bodies = [
      { x: 0, y: 0, vx: (-PLANET_MASS * h.vx) / STAR_MASS, vy: (-PLANET_MASS * h.vy) / STAR_MASS, m: STAR_MASS },
      { x: h.x, y: h.y, vx: h.vx, vy: h.vy, m: PLANET_MASS },
    ];
    this.acc = [[0, 0], [0, 0]];
    this.computeAcc();
  }

  /** Move the planet before the run (distance from the star is clamped). */
  place(x, y) {
    const r = Math.hypot(x, y) || 1e-9;
    const k = Math.min(R_MAX, Math.max(R_MIN, r)) / r;
    this.home.x = x * k;
    this.home.y = y * k;
    this.reset();
  }

  setVelocity(vx, vy) {
    this.home.vx = vx;
    this.home.vy = vy;
    this.reset();
  }

  get radius() {
    const [s, p] = this.bodies;
    return Math.hypot(p.x - s.x, p.y - s.y);
  }

  computeAcc() {
    const [a, b] = this.bodies;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const r2 = dx * dx + dy * dy;
    const inv = this.G / (r2 * Math.sqrt(r2));
    this.acc[0][0] = inv * b.m * dx;
    this.acc[0][1] = inv * b.m * dy;
    this.acc[1][0] = -inv * a.m * dx;
    this.acc[1][1] = -inv * a.m * dy;
  }

  step(dt) {
    const bs = this.bodies;
    const a = this.acc;
    for (let i = 0; i < 2; i++) {
      bs[i].vx += 0.5 * dt * a[i][0];
      bs[i].vy += 0.5 * dt * a[i][1];
      bs[i].x += dt * bs[i].vx;
      bs[i].y += dt * bs[i].vy;
    }
    this.computeAcc();
    for (let i = 0; i < 2; i++) {
      bs[i].vx += 0.5 * dt * a[i][0];
      bs[i].vy += 0.5 * dt * a[i][1];
    }
    this.t += dt;

    const th = Math.atan2(bs[1].y - bs[0].y, bs[1].x - bs[0].x);
    let d = th - this.prevTheta;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    this.angle += d;
    this.prevTheta = th;

    const r = this.radius;
    if (r <= STAR_RADIUS) {
      // Hit the star: stick to the surface and stop.
      const k = STAR_RADIUS / r;
      bs[1].x = bs[0].x + (bs[1].x - bs[0].x) * k;
      bs[1].y = bs[0].y + (bs[1].y - bs[0].y) * k;
      bs[1].vx = bs[0].vx;
      bs[1].vy = bs[0].vy;
      this.crashed = true;
    } else if (r > ESCAPE_R) {
      this.escaped = true;
    }
  }

  /**
   * Advance the simulation by `duration` of simulated time (1:1 with the wall
   * clock when called once per frame). `onStep` runs after every step.
   */
  run(duration, onStep, maxSteps = 6000) {
    const end = this.t + duration;
    let n = 0;
    while (this.t < end - 1e-12 && n++ < maxSteps && !this.crashed && !this.escaped) {
      const r = this.radius;
      const h = Math.min(ETA * Math.sqrt((r * r * r) / (this.G * STAR_MASS)), end - this.t);
      this.step(h);
      if (onStep) onStep();
    }
  }

  orbits() {
    return this.angle / (2 * Math.PI);
  }
}
