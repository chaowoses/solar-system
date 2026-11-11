import { System, STAR_MASS, PLANET_MASS, STAR_RADIUS } from "./physics.js";
import { loadOrCreateG, saveG } from "./storage.js";
import { randomG } from "./constant.js";
import { verifyPin } from "./pin.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let sys = null;
let started = false; // has Play been pressed since the last Reset / edit?
let playing = false;
let dirty = true;

// The orbit path the planet has traced. It is kept after pausing and after
// Reset so it can be measured, and only cleared when the planet is moved,
// re-aimed, or launched again. It stops growing once it closes (one full lap).
let trail = [];
let trailAngle = 0;

const view = { cx: 0, cy: 0, scale: 1, fit: 1, moved: false };
// The tape measure is its own tool: toggled on, it appears as a segment with a
// draggable handle at each end (world coordinates, no snapping to anything).
const tape = { on: false, a: null, b: null };
let tapeGrab = null;

// Shown big behind everything, rising from the bottom edge, when the planet crashes.
const crashImg = new Image();
crashImg.src = "img/crash.png";
crashImg.onload = () => (dirty = true);
let crashAt = null;
const SHOW_MS = 100; // total time on screen
const FADE_OUT_MS = 40;
const CRASH_ALPHA = 0.07; // how see-through it is (lower = fainter)

const canvas = $("view");
const ctx = canvas.getContext("2d");
let W = 0;
let H = 0;

const PLANET_COLOR = "#6fa8c9";
const VEL_COLOR = "#9cc9e4"; // a lighter cousin of the planet colour
const TAPE_COLOR = "#f2c879";
const MONO = "ui-monospace, Consolas, monospace";
const VIEW_RADIUS = 520; // distance that fits the screen at the default zoom
const VSCALE = 0.3; // on-screen pixels of velocity arrow per unit of speed
const V_MAX = 2000;

/* ------------------------------------------------------------------ */
/* Canvas + camera                                                     */
/* ------------------------------------------------------------------ */

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  W = r.width;
  H = r.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.fit = (0.5 * Math.min(W, H) * 0.9) / VIEW_RADIUS;
  if (!view.moved) fitView();
  buildBackdrop();
  dirty = true;
}

function fitView() {
  view.cx = 0;
  view.cy = 0;
  view.scale = view.fit;
  view.moved = false;
}

const toScreen = (x, y) => [W / 2 + (x - view.cx) * view.scale, H / 2 - (y - view.cy) * view.scale];
const toWorld = (sx, sy) => [view.cx + (sx - W / 2) / view.scale, view.cy - (sy - H / 2) / view.scale];

function zoomAt(sx, sy, factor) {
  const [wx, wy] = toWorld(sx, sy);
  view.scale = Math.min(view.fit * 200, Math.max(view.fit * 0.2, view.scale * factor));
  view.cx = wx - (sx - W / 2) / view.scale;
  view.cy = wy + (sy - H / 2) / view.scale;
  view.moved = true;
  dirty = true;
}

// ---- the backdrop: nebula clouds, a Milky Way band, vignette (drawn once per
// resize into an offscreen canvas) plus three layers of stars that drift very
// slightly against the view when you pan, for depth. ----
const rng = (seed) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
};
const STAR_TINTS = ["255,255,255", "205,224,255", "255,236,205", "255,212,176", "188,208,255"];
const starLayers = (() => {
  const rnd = rng(7);
  // [count, parallax, radius min/max, alpha min/max]: far layers are dimmer and move less
  const spec = [
    [280, 0.015, 0.5, 0.9, 0.1, 0.35],
    [150, 0.04, 0.7, 1.2, 0.2, 0.6],
    [48, 0.09, 1.0, 1.8, 0.45, 0.95],
  ];
  return spec.map(([n, par, r0, r1, a0, a1]) => ({
    par,
    stars: Array.from({ length: n }, () => {
      const r = r0 + rnd() * (r1 - r0);
      return { x: rnd(), y: rnd(), r, a: a0 + rnd() * (a1 - a0), c: STAR_TINTS[(rnd() * STAR_TINTS.length) | 0], bright: par > 0.08 && r > 1.68 };
    }),
  }));
})();

let backdrop = null;
function buildBackdrop() {
  const dpr = window.devicePixelRatio || 1;
  const c = document.createElement("canvas");
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  const big = Math.max(W, H);
  const rnd = rng(31);

  const base = g.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, "#0b101a");
  base.addColorStop(0.55, "#090b13");
  base.addColorStop(1, "#0d0b16");
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);

  // nebula: overlapping soft blobs of muted teal, violet and rose
  g.globalCompositeOperation = "lighter";
  const clouds = [
    [0.2, 0.28, 0.5, "36,96,124", 0.075],
    [0.8, 0.72, 0.55, "92,52,132", 0.07],
    [0.64, 0.18, 0.4, "126,58,90", 0.045],
    [0.28, 0.84, 0.42, "28,88,100", 0.05],
    [0.92, 0.26, 0.36, "52,72,136", 0.05],
  ];
  for (const [cx, cy, rad, col, alpha] of clouds) {
    for (let k = 0; k < 7; k++) {
      const x = (cx + (rnd() - 0.5) * 0.26) * W;
      const y = (cy + (rnd() - 0.5) * 0.26) * H;
      const r = rad * big * (0.45 + rnd() * 0.7);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const al = alpha * (0.45 + rnd() * 0.55);
      gr.addColorStop(0, "rgba(" + col + "," + al + ")");
      gr.addColorStop(0.55, "rgba(" + col + "," + al * 0.35 + ")");
      gr.addColorStop(1, "rgba(" + col + ",0)");
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  // Milky Way: a soft diagonal haze with a dense scatter of tiny stars in it
  const p0 = [-0.1 * W, 0.86 * H];
  const p1 = [1.1 * W, 0.14 * H];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = p0[0] + (p1[0] - p0[0]) * t;
    const y = p0[1] + (p1[1] - p0[1]) * t;
    const r = 0.2 * big;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(150,168,215,0.03)");
    gr.addColorStop(1, "rgba(150,168,215,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const spread = 0.085 * big;
  const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  for (let i = 0; i < 1100; i++) {
    const t = rnd();
    const off = (rnd() + rnd() + rnd() - 1.5) * spread * 1.4;
    const x = p0[0] + (p1[0] - p0[0]) * t + nx * off;
    const y = p0[1] + (p1[1] - p0[1]) * t + ny * off;
    const al = (0.04 + rnd() * 0.2) * Math.max(0.15, 1 - Math.abs(off) / (spread * 2));
    g.fillStyle = "rgba(222,232,255," + al + ")";
    const sz = rnd() < 0.1 ? 1.2 : 0.8;
    g.fillRect(x, y, sz, sz);
  }

  // vignette: the corners fall away into black
  g.globalCompositeOperation = "source-over";
  const v = g.createRadialGradient(W / 2, H / 2, big * 0.25, W / 2, H / 2, big * 0.78);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.5)");
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  backdrop = c;
}

function drawStars() {
  // how far the world origin sits from the screen centre; stars follow a small fraction of it
  const ox = -view.cx * view.scale;
  const oy = view.cy * view.scale;
  for (const layer of starLayers) {
    const dx = ox * layer.par;
    const dy = oy * layer.par;
    for (const s of layer.stars) {
      let x = (s.x * W + dx) % W;
      let y = (s.y * H + dy) % H;
      if (x < 0) x += W;
      if (y < 0) y += H;
      if (s.bright) {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, s.r * 4.5);
        gr.addColorStop(0, "rgba(" + s.c + "," + s.a * 0.32 + ")");
        gr.addColorStop(1, "rgba(" + s.c + ",0)");
        ctx.fillStyle = gr;
        ctx.fillRect(x - s.r * 4.5, y - s.r * 4.5, s.r * 9, s.r * 9);
        ctx.strokeStyle = "rgba(" + s.c + "," + s.a * 0.3 + ")";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x - s.r * 5, y);
        ctx.lineTo(x + s.r * 5, y);
        ctx.moveTo(x, y - s.r * 5);
        ctx.lineTo(x, y + s.r * 5);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(" + s.c + "," + s.a + ")";
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, TAU);
      ctx.fill();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

function drawTrail() {
  if (trail.length < 2) return;
  ctx.strokeStyle = PLANET_COLOR;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.beginPath();
  trail.forEach(([x, y], i) => {
    const [px, py] = toScreen(x, y);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawVelocity(px, py, tx, ty, speed) {
  const len = Math.hypot(tx - px, ty - py);
  if (len < 1) return;
  const ux = (tx - px) / len;
  const uy = (ty - py) / len;
  const R = 8; // handle ring, same as the tape measure's

  ctx.strokeStyle = VEL_COLOR;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // shaft: from the planet's edge to the handle
  const x0 = px + ux * 8;
  const y0 = py + uy * 8;
  const xe = tx - ux * R;
  const ye = ty - uy * R;
  if (Math.hypot(xe - x0, ye - y0) > 1 && (xe - x0) * ux + (ye - y0) * uy > 0) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(xe, ye);
    ctx.stroke();
    // open chevron just before the handle (skipped when the vector is too short to hold one)
    const room = (xe - x0) * ux + (ye - y0) * uy;
    if (room > 14) {
      const c = 8;
      const nx = -uy;
      const ny = ux;
      ctx.beginPath();
      ctx.moveTo(xe - ux * c + nx * c * 0.55, ye - uy * c + ny * c * 0.55);
      ctx.lineTo(xe, ye);
      ctx.lineTo(xe - ux * c - nx * c * 0.55, ye - uy * c - ny * c * 0.55);
      ctx.stroke();
    }
  }

  // handle: ring with a centre dot
  ctx.beginPath();
  ctx.arc(tx, ty, R, 0, TAU);
  ctx.fillStyle = "rgba(13,16,21,0.85)";
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(tx, ty, 2.2, 0, TAU);
  ctx.fillStyle = VEL_COLOR;
  ctx.fill();

  // label on a dark pill, like the tape's
  const label = "v " + speed.toFixed(1);
  ctx.font = "600 12px " + MONO;
  const tw = ctx.measureText(label).width;
  const lx = tx + 14;
  const ly = ty - 24;
  ctx.fillStyle = "#0d1015";
  ctx.fillRect(lx - 6, ly - 1, tw + 12, 19);
  ctx.fillStyle = VEL_COLOR;
  ctx.textAlign = "left";
  ctx.fillText(label, lx, ly + 12.5);
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (backdrop) ctx.drawImage(backdrop, 0, 0, W, H);
  else {
    ctx.fillStyle = "#0b0e16";
    ctx.fillRect(0, 0, W, H);
  }
  drawCrash(); // right after the backdrop, so it sits behind absolutely everything else
  drawStars();
  if (!sys) return;

  const [star, planet] = sys.bodies;
  const [sx, sy] = toScreen(star.x, star.y);
  const [px, py] = toScreen(planet.x, planet.y);
  const placing = !started;

  drawTrail();

  // Star: drawn at its real size so a crash looks like a crash
  const sr = Math.max(5, STAR_RADIUS * view.scale);
  const gr = Math.max(46, sr * 5);
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
  glow.addColorStop(0, "rgba(232,163,61,0.55)");
  glow.addColorStop(0.35, "rgba(232,163,61,0.14)");
  glow.addColorStop(1, "rgba(232,163,61,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(sx - gr, sy - gr, gr * 2, gr * 2);
  ctx.fillStyle = "#f0b552";
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, TAU);
  ctx.fill();

  // Planet (or, after a crash, the explosion where it hit; Reset clears it)
  if (sys.crashed) drawExplosion(px, py);
  else {
    ctx.fillStyle = PLANET_COLOR;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, TAU);
    ctx.fill();
  }

  if (placing) {
    const h = sys.home;
    const speed = Math.hypot(h.vx, h.vy);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(235,230,216,0.75)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(px, py, 12, 0, TAU);
    ctx.stroke();
    if (speed * VSCALE < 20) {
      // no velocity yet: show where to grab to give it one
      ctx.strokeStyle = "rgba(156,201,228,0.45)";
      ctx.beginPath();
      ctx.arc(px, py, 34, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    if (speed > 0) {
      const tx = px + h.vx * VSCALE;
      const ty = py - h.vy * VSCALE;
      drawVelocity(px, py, tx, ty, speed);
    }
  }

  if (tape.on && tape.a && tape.b) drawTape();

  drawScale();
}

function drawExplosion(x, y) {
  const R = Math.max(26, STAR_RADIUS * view.scale * 3);
  const burst = (r, color) => {
    // jagged starburst: spikes of slightly different lengths, fixed so it doesn't shimmer
    const spikes = 12;
    const len = [1, 0.74, 0.95, 0.68, 1, 0.8, 0.92, 0.7, 0.98, 0.76, 0.9, 0.72];
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const ang = (i * Math.PI) / spikes - Math.PI / 2;
      const rad = i % 2 === 0 ? r * len[i / 2] : r * 0.46;
      const px = x + Math.cos(ang) * rad;
      const py = y + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  const glow = ctx.createRadialGradient(x, y, 0, x, y, R * 1.7);
  glow.addColorStop(0, "rgba(255,140,60,0.45)");
  glow.addColorStop(1, "rgba(255,140,60,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, R * 1.7, 0, TAU);
  ctx.fill();
  burst(R, "#d9461f");
  burst(R * 0.72, "#f58a24");
  burst(R * 0.42, "#ffd45e");
  ctx.fillStyle = "#fff6d6";
  ctx.beginPath();
  ctx.arc(x, y, R * 0.16, 0, TAU);
  ctx.fill();
}

function drawCrash() {
  if (!crashAt || !crashImg.complete || !crashImg.naturalWidth) return;
  // A brief, faint flash: it simply appears (no animation in), holds, then
  // fades out quickly.
  const t = performance.now() - crashAt;
  if (t >= SHOW_MS) return;
  const fadeOut = Math.min(1, (SHOW_MS - t) / FADE_OUT_MS);
  const ratio = crashImg.naturalWidth / crashImg.naturalHeight;
  const h = Math.min(H * 0.92, (W * 0.8) / ratio);
  const w = h * ratio;
  ctx.save();
  ctx.globalAlpha = CRASH_ALPHA * fadeOut;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(crashImg, (W - w) / 2, H - h, w, h);
  ctx.restore();
}

function drawTape() {
  const [x1, y1] = toScreen(tape.a.x, tape.a.y);
  const [x2, y2] = toScreen(tape.b.x, tape.b.y);
  ctx.strokeStyle = TAPE_COLOR;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  for (const [x, y] of [[x1, y1], [x2, y2]]) {
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, TAU);
    ctx.fillStyle = "rgba(13,16,21,0.85)";
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, TAU);
    ctx.fillStyle = TAPE_COLOR;
    ctx.fill();
  }
  const label = Math.hypot(tape.b.x - tape.a.x, tape.b.y - tape.a.y).toFixed(1);
  ctx.font = `600 12px ${MONO}`;
  const tw = ctx.measureText(label).width;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  ctx.fillStyle = "#0d1015";
  ctx.fillRect(mx - tw / 2 - 6, my - 28, tw + 12, 19);
  ctx.fillStyle = TAPE_COLOR;
  ctx.textAlign = "center";
  ctx.fillText(label, mx, my - 14);
  ctx.textAlign = "left";
}

function drawScale() {
  const raw = 120 / view.scale;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const nice = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
  $("scaleBar").style.width = `${nice * view.scale}px`;
  $("scaleLabel").textContent = `${nice >= 1 ? nice : nice.toFixed(2)} units`;
}

/* ------------------------------------------------------------------ */
/* Simulation loop (1 simulated second per real second)                */
/* ------------------------------------------------------------------ */

function startTrail() {
  trail = [[sys.bodies[1].x, sys.bodies[1].y]];
  trailAngle = sys.angle;
}

function sampleTrail() {
  if (trailAngle >= TAU || trail.length > 8000) return;
  // A point per ~0.6 degrees swept, or per 2% of the radius travelled (so a
  // straight plunge into the star still draws a line).
  const last = trail[trail.length - 1];
  const p = sys.bodies[1];
  const moved = Math.hypot(p.x - last[0], p.y - last[1]);
  if (sys.angle - trailAngle >= 0.01 || moved >= 0.02 * sys.radius) {
    trailAngle = Math.max(trailAngle, sys.angle);
    trail.push([p.x, p.y]);
    if (trailAngle >= TAU) trail.push(trail[0]); // closed a full lap: snap shut
  }
}

// The simulation advances by (real elapsed time) x (speed slider), and the
// timer reads the simulation clock. At 1.00x the timer is the wall clock;
// slowed down or sped up, it still reads true simulated seconds, so a period
// measured at any speed is the same number.
let speed = 1;
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (sys) {
    if (playing) {
      sys.run(dt * speed, sampleTrail);
      if (sys.crashed || sys.escaped) {
        playing = false;
        updateUI();
      }
      dirty = true;
    }
    if (sys.crashed) {
      if (!crashAt) crashAt = performance.now();
      if (performance.now() - crashAt < SHOW_MS + 50) dirty = true; // keep animating until it has faded
    } else crashAt = null;
    if (dirty) {
      updateReadouts();
      draw();
      dirty = false;
    }
  }
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* Readouts + controls                                                 */
/* ------------------------------------------------------------------ */

function updateReadouts() {
  $("timer").textContent = sys.t.toFixed(3);
  updateTheory();
}

function updateSpeed() {
  speed = Number($("speed").value); // 0.5x to 5x
  $("speedOut").textContent = `${speed.toFixed(1)}×`;
}

function updateUI() {
  $("play").textContent = playing ? "Pause" : "Play";
  $("tape").setAttribute("aria-pressed", String(tape.on));
}

function setPlaying(p) {
  playing = p;
  last = performance.now();
  updateUI();
}

function play() {
  if (!sys || sys.crashed || sys.escaped) return;
  if (!started) {
    started = true;
    startTrail();
  }
  setPlaying(!playing);
}

function reset() {
  if (!sys) return;
  sys.reset();
  trail = []; // Reset clears the drawn path; pausing keeps it so it can be measured
  started = false;
  setPlaying(false);
  dirty = true;
}

function wireControls() {
  $("play").addEventListener("click", play);
  $("reset").addEventListener("click", reset);
  $("speed").addEventListener("input", updateSpeed);
  updateSpeed();
  $("tape").addEventListener("click", () => {
    tape.on = !tape.on;
    if (tape.on) {
      const inView = (p) => {
        if (!p) return false;
        const [x, y] = toScreen(p.x, p.y);
        return x >= 0 && x <= W && y >= 0 && y <= H;
      };
      if (!inView(tape.a) && !inView(tape.b)) {
        // appear in the middle of the screen, wherever the view is
        const [ax, ay] = toWorld(W / 2 - 120, H * 0.7);
        const [bx, by] = toWorld(W / 2 + 120, H * 0.7);
        tape.a = { x: ax, y: ay };
        tape.b = { x: bx, y: by };
      }
    }
    updateUI();
    dirty = true;
  });
  $("zin").addEventListener("click", () => zoomAt(W / 2, H / 2, 1.4));
  $("zout").addEventListener("click", () => zoomAt(W / 2, H / 2, 1 / 1.4));
  $("fit").addEventListener("click", () => {
    fitView();
    dirty = true;
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") $("teacher").hidden = true;
    if (e.code !== "Space" || e.repeat) return;
    if (e.target !== document.body && e.target !== canvas) return;
    e.preventDefault();
    play();
  });
}

/* ------------------------------------------------------------------ */
/* Pointer interaction                                                 */
/* ------------------------------------------------------------------ */

const PLANET_PICK = 11;
const HANDLE_PICK = 14;
const AIM_RING = 46;

function planetScreen() {
  return toScreen(sys.bodies[1].x, sys.bodies[1].y);
}

/** What would a press at (sx, sy) grab? "planet", "velocity" or null. */
function grabTarget(sx, sy) {
  if (!sys || started) return null;
  const [px, py] = planetScreen();
  const d = Math.hypot(sx - px, sy - py);
  if (d <= PLANET_PICK) return "planet";
  const h = sys.home;
  const speed = Math.hypot(h.vx, h.vy);
  if (speed > 0 && Math.hypot(sx - (px + h.vx * VSCALE), sy - (py - h.vy * VSCALE)) <= HANDLE_PICK) return "velocity";
  if (speed * VSCALE < 20 && d <= AIM_RING) return "velocity";
  return null;
}

const TAPE_PICK = 14;

/** Which part of the tape would a press grab? "a", "b" (the end handles), "body" or null. */
function tapeHit(sx, sy) {
  if (!tape.on || !tape.a || !tape.b) return null;
  const [x1, y1] = toScreen(tape.a.x, tape.a.y);
  const [x2, y2] = toScreen(tape.b.x, tape.b.y);
  if (Math.hypot(sx - x1, sy - y1) <= TAPE_PICK) return "a";
  if (Math.hypot(sx - x2, sy - y2) <= TAPE_PICK) return "b";
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((sx - x1) * dx + (sy - y1) * dy) / L2)) : 0;
  return Math.hypot(sx - (x1 + t * dx), sy - (y1 + t * dy)) <= 8 ? "body" : null;
}

function wireCanvas() {
  let pan = null;
  let grab = null;
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const edited = () => {
    trail = []; // a new setup means a new run: drop the old path
    dirty = true;
    updateUI();
  };
  const placeAt = (sx, sy) => {
    const [wx, wy] = toWorld(sx, sy);
    sys.place(wx - sys.bodies[0].x, wy - sys.bodies[0].y);
    edited();
  };
  const aimAt = (sx, sy) => {
    const [px, py] = planetScreen();
    let vx = (sx - px) / VSCALE;
    let vy = -(sy - py) / VSCALE;
    const v = Math.hypot(vx, vy);
    if (v > V_MAX) {
      vx *= V_MAX / v;
      vy *= V_MAX / v;
    }
    sys.setVelocity(vx, vy);
    edited();
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (!sys) return;
    const [x, y] = local(e);
    canvas.setPointerCapture(e.pointerId);
    const part = tapeHit(x, y);
    if (part) {
      const [wx, wy] = toWorld(x, y);
      tapeGrab = { part, wx, wy, a: { ...tape.a }, b: { ...tape.b } };
      canvas.classList.add("dragging");
      return;
    }
    grab = grabTarget(x, y);
    if (grab === "planet") placeAt(x, y);
    else if (grab === "velocity") aimAt(x, y);
    else pan = { x, y };
    canvas.classList.add("dragging");
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!sys) return;
    const [x, y] = local(e);
    if (tapeGrab) {
      const [wx, wy] = toWorld(x, y);
      if (tapeGrab.part === "a") tape.a = { x: wx, y: wy };
      else if (tapeGrab.part === "b") tape.b = { x: wx, y: wy };
      else {
        const dx = wx - tapeGrab.wx;
        const dy = wy - tapeGrab.wy;
        tape.a = { x: tapeGrab.a.x + dx, y: tapeGrab.a.y + dy };
        tape.b = { x: tapeGrab.b.x + dx, y: tapeGrab.b.y + dy };
      }
      dirty = true;
    } else if (grab === "planet") placeAt(x, y);
    else if (grab === "velocity") aimAt(x, y);
    else if (pan) {
      view.cx -= (x - pan.x) / view.scale;
      view.cy += (y - pan.y) / view.scale;
      view.moved = true;
      pan = { x, y };
      dirty = true;
    } else {
      const t = grabTarget(x, y);
      canvas.classList.toggle("over-planet", t === "planet" || t === "velocity" || !!tapeHit(x, y));
    }
  });

  const end = () => {
    tapeGrab = null;
    pan = null;
    grab = null;
    canvas.classList.remove("dragging");
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      zoomAt(x, y, Math.exp(-e.deltaY * 0.0016));
    },
    { passive: false }
  );
}

/* ------------------------------------------------------------------ */
/* Instructor panel: the PIN opens it                                  */
/* ------------------------------------------------------------------ */

// What Newton says the current setup will do, from the planet's placed
// position and velocity: semi-major axis a (half the major axis, the lab's r)
// and period T = 2 pi sqrt(a^3 / GM). null when it isn't a closed orbit
// (unbound, or it dips inside the star).
function theory() {
  const h = sys.home;
  const GM = sys.G * STAR_MASS;
  const r = Math.hypot(h.x, h.y);
  const inv = 2 / r - (h.vx * h.vx + h.vy * h.vy) / GM;
  if (inv <= 1e-12) return null;
  const a = 1 / inv;
  const L = h.x * h.vy - h.y * h.vx; // angular momentum per unit mass
  const e = Math.sqrt(Math.max(0, 1 - (L * L) / GM / a));
  if (a * (1 - e) <= STAR_RADIUS) return null;
  return { a, T: TAU * Math.sqrt((a * a * a) / GM) };
}

const showTheory = { radius: false, period: false };

function updateTheory() {
  $("theory").hidden = !(showTheory.radius || showTheory.period);
  $("theoryR").hidden = !showTheory.radius;
  $("theoryT").hidden = !showTheory.period;
  if (!sys || !(showTheory.radius || showTheory.period)) return;
  const th = theory();
  $("theoryRVal").textContent = th ? th.a.toFixed(1) : "—";
  $("theoryTVal").textContent = th ? `${th.T.toFixed(3)} s` : "—";
}

function wireTeacher() {
  const panel = $("teacher");
  const err = $("teacherError");
  const rb = $("randomize");
  let armTimer = 0;
  let wrong = 0;
  let lockedUntil = 0;
  let gShown = false;

  // The PIN box is an ordinary text input that CSS draws as dots (so typing,
  // pasting and IMEs all behave natively). It is deliberately not type="password"
  // so browsers and password managers have nothing to offer to save. The eye
  // button shows it in the clear.
  const pinEl = $("pin");
  const nativeMask = CSS.supports("-webkit-text-security", "disc") || CSS.supports("text-security", "disc");
  let pinShown = false;
  const applyMask = () => {
    pinEl.classList.toggle("masked", !pinShown);
    if (!nativeMask) pinEl.type = pinShown ? "text" : "password"; // browsers that can't mask text inputs
    $("togglePin").setAttribute("aria-pressed", String(pinShown));
    $("togglePin").setAttribute("aria-label", pinShown ? "Hide PIN" : "Show PIN");
    $("togglePin").title = pinShown ? "Hide PIN" : "Show PIN";
  };
  applyMask();
  $("togglePin").addEventListener("click", () => {
    pinShown = !pinShown;
    applyMask();
    pinEl.focus();
  });

  const disarm = () => {
    clearTimeout(armTimer);
    rb.classList.remove("armed");
    rb.textContent = "Randomize G";
  };
  const fail = (msg) => {
    err.textContent = msg;
    err.hidden = false;
  };
  const renderG = () => {
    $("gValue").textContent = gShown && sys ? String(sys.G) : "•••••";
    $("toggleG").textContent = gShown ? "Hide" : "Show";
    $("toggleG").setAttribute("aria-pressed", String(gShown));
  };
  const lock = () => {
    $("pinForm").hidden = false;
    $("tools").hidden = true;
    pinEl.value = "";
    pinShown = false;
    applyMask();
    err.hidden = true;
    gShown = false;
    renderG();
    disarm();
  };
  // Closing the panel locks it again and hides G; the theory toggles stay as set.
  const open = (show) => {
    panel.hidden = !show;
    if (show) {
      lock();
      $("pin").focus();
    } else lock();
  };
  const refreshAll = () => {
    dirty = true;
    updateTheory();
  };

  // The PIN is only ever compared as a salted hash (see scripts/build-config.js).
  // A short lockout after repeated misses slows down guessing at the keyboard.
  async function pinOk() {
    const pin = pinEl.value;
    if (Date.now() < lockedUntil) {
      fail(`Too many wrong tries. Wait ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.`);
      return false;
    }
    if (!pin) {
      fail("Enter the PIN.");
      return false;
    }
    if (await verifyPin(pin)) {
      wrong = 0;
      return true;
    }
    if (++wrong >= 5) {
      wrong = 0;
      lockedUntil = Date.now() + 30000;
    }
    fail("That PIN isn't right.");
    $("pin").select();
    return false;
  }

  $("openTeacher").addEventListener("click", () => open(panel.hidden));
  $("closeTeacher").addEventListener("click", () => open(false));

  $("pinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!sys || !(await pinOk())) return;
    pinEl.value = "";
    $("pinForm").hidden = true;
    $("tools").hidden = false;
    renderG();
  });

  $("toggleG").addEventListener("click", () => {
    gShown = !gShown;
    renderG();
  });
  $("optRadius").addEventListener("change", (e) => {
    showTheory.radius = e.target.checked;
    refreshAll();
  });
  $("optPeriod").addEventListener("change", (e) => {
    showTheory.period = e.target.checked;
    refreshAll();
  });

  // Two clicks: the first arms the button so a stray click can't restart a
  // student's run.
  rb.addEventListener("click", async () => {
    if (!rb.classList.contains("armed")) {
      rb.classList.add("armed");
      rb.textContent = "Click again to confirm";
      armTimer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    if (!sys) return;
    const g = randomG();
    await saveG(g);
    launch(g);
    renderG();
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

$("starMass").textContent = String(STAR_MASS);
$("planetMass").textContent = String(PLANET_MASS);
wireControls();
wireCanvas();
wireTeacher();

/** Start fresh with a given G (first load, or after the teacher randomizes). */
function launch(G) {
  sys = new System(G);
  started = false;
  trail = [];
  setPlaying(false);
  dirty = true;
}

new ResizeObserver(resize).observe(canvas);
resize();
updateUI();
requestAnimationFrame(frame);
loadOrCreateG().then(launch);
