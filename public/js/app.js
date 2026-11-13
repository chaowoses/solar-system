import { System, STAR_MASS, PLANET_MASS, STAR_RADIUS } from "./physics.js";
import { loadOrCreateLetter } from "./storage.js";
import { G_KEY } from "./constant.js";

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
let ctx = canvas.getContext("2d"); // swapped to the overlay's context while drawing the 3D overlay
const hud = $("hud3d");
const hctx = hud.getContext("2d");
let W = 0;
let H = 0;

// Optional 3D view (three.js), loaded the first time it is switched on.
let v3 = null;
let mode3d = false;

const PLANET_COLOR = "#6fa8c9";
const VEL_COLOR = "#9cc9e4"; // a lighter cousin of the planet colour
// the 3D view wears the sun's warm gold instead, to sit in the scene
const VEL_COLOR_3D = "#ffc46b";
let velColor = VEL_COLOR;
let ringColor = "rgba(156,201,228,0.45)";
let dashColor = "rgba(235,230,216,0.75)";
const TAPE_COLOR = "#f2c879";
const MONO = "ui-monospace, Consolas, monospace";
const VIEW_RADIUS = 520; // distance that fits the screen at the default zoom
// The launch arrow is measured against the circular-orbit speed at the planet's
// distance, not in raw speed units: CIRC_PX of arrow means "exactly circular",
// whatever this browser's G is or wherever the planet sits. The arrow can't be
// pulled past MAX_AIM x circular (about 85% of escape speed), so a release is
// always a bound orbit: it can't fly off forever.
const CIRC_PX = 90;
const MAX_AIM = 1.2;
let aim = { x: 0, y: 0 }; // arrow offset in px at the default zoom (x right, y up); it scales with the view
const aimScale = () => view.scale / view.fit; // on-screen px per default-zoom px
let aim3 = { x: 0, y: 0 }; // the same arrow in 3D: a velocity in units of circular speed, along the world axes

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
  hud.width = canvas.width;
  hud.height = canvas.height;
  hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.fit = (0.5 * Math.min(W, H) * 0.9) / VIEW_RADIUS;
  if (!view.moved) fitView();
  buildBackdrop();
  if (v3) v3.resize(W, H);
  dirty = true;
}

function fitView() {
  view.cx = 0;
  view.cy = 0;
  view.scale = view.fit;
  view.moved = false;
}

const toScreen = (x, y) => (mode3d && v3 ? v3.project(x, y) : [W / 2 + (x - view.cx) * view.scale, H / 2 - (y - view.cy) * view.scale]);
const toWorld = (sx, sy) => {
  if (mode3d && v3) return v3.unproject(sx, sy) || [0, 0];
  return [view.cx + (sx - W / 2) / view.scale, view.cy - (sy - H / 2) / view.scale];
};

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

function drawVelocity(px, py, tx, ty) {
  const len = Math.hypot(tx - px, ty - py);
  if (len < 1) return;
  const ux = (tx - px) / len;
  const uy = (ty - py) / len;
  const R = 8; // handle ring, same as the tape measure's

  ctx.strokeStyle = velColor;
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
  ctx.fillStyle = velColor;
  ctx.fill();

  // the launch speed, beside the handle
  const label = "v = " + Math.hypot(sys.home.vx, sys.home.vy).toFixed(1);
  ctx.font = `600 12px ${MONO}`;
  ctx.textAlign = ux > 0.35 ? "left" : ux < -0.35 ? "right" : "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(13,16,21,0.85)";
  const lx = tx + ux * (R + 8);
  const ly = ty + uy * (R + 8) + (uy > 0.35 ? 12 : uy < -0.35 ? -2 : 4);
  ctx.strokeText(label, lx, ly);
  ctx.fillStyle = velColor;
  ctx.fillText(label, lx, ly);
  ctx.textAlign = "left";
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
    const aimLen = Math.hypot(aim.x, aim.y);
    drawAimMarks(px, py, aimLen);
    const k = aimScale();
    if (aimLen > 0) drawVelocity(px, py, px + aim.x * k, py - aim.y * k);
  }

  if (tape.on && tape.a && tape.b) drawTape();

  drawScale();
}

/** The dashed ring round a planet that is still being placed, and the grab ring for giving it a velocity. */
function drawAimMarks(px, py, aimLen, ring = 12) {
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = dashColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(px, py, ring, 0, TAU);
  ctx.stroke();
  if (aimLen < 20) {
    // no velocity yet: show where to grab to give it one
    ctx.strokeStyle = ringColor;
    ctx.beginPath();
    ctx.arc(px, py, 34, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** The 3D view's overlay: aim arrow, grab rings and tape measure, drawn in screen space over the scene. */
function drawOverlay3D() {
  const keep = ctx;
  ctx = hctx;
  ctx.clearRect(0, 0, W, H);
  velColor = VEL_COLOR_3D;
  ringColor = "rgba(255,196,107,0.4)";
  dashColor = "rgba(255,226,170,0.7)";
  ctx.shadowColor = "rgba(255,160,60,0.85)";
  ctx.shadowBlur = 10;
  const p = sys.bodies[1];
  const [px, py] = v3.project(p.x, p.y);
  if (!started && !sys.crashed) {
    const aw = CIRC_PX * v3.refWpp(); // world length of "circular speed": fixed, so it scales with the zoom
    const [tx, ty] = v3.project(p.x + aim3.x * aw, p.y + aim3.y * aw);
    const len = Math.hypot(aim3.x, aim3.y) * CIRC_PX;
    drawAimMarks(px, py, len, Math.max(12, v3.planetPx(p.x, p.y) + 5));
    if (len > 0) drawVelocity(px, py, tx, ty);
  }
  ctx.shadowBlur = 0;
  if (tape.on && tape.a && tape.b) drawTape();
  velColor = VEL_COLOR;
  ringColor = "rgba(156,201,228,0.45)";
  dashColor = "rgba(235,230,216,0.75)";
  ctx = keep;
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
  if (sys && mode3d && v3) {
    if (playing) {
      sys.run(dt * speed, sampleTrail);
      if (sys.crashed || sys.escaped) {
        playing = false;
        updateUI();
      }
    }
    updateReadouts();
    const [star, planet] = sys.bodies;
    v3.render(now, { star, planet, trail, crashed: sys.crashed, cinematic: playing });
    drawOverlay3D();
    dirty = true; // redraw the 2D view when switching back
  } else if (sys) {
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
        // (in 3D these land on the orbital plane under those screen points)
        tape.a = { x: ax, y: ay };
        tape.b = { x: bx, y: by };
      }
    }
    updateUI();
    dirty = true;
  });
  $("toggle3d").addEventListener("click", async () => {
    const btn = $("toggle3d");
    if (!mode3d && !v3) {
      btn.disabled = true;
      try {
        const { createView3D } = await import("./view3d.js");
        v3 = createView3D($("view3d"));
        v3.resize(W, H);
      } catch (err) {
        console.error(err);
        btn.textContent = "3D unavailable";
        return;
      } finally {
        btn.disabled = false;
      }
    }
    mode3d = !mode3d;
    document.body.classList.toggle("mode3d", mode3d);
    $("hint3d").hidden = !mode3d;
    btn.setAttribute("aria-pressed", String(mode3d));
    btn.textContent = mode3d ? "2D view" : "3D view";
    // the launch arrow is the same velocity in both views; only its units differ
    // (screen pixels in 2D, multiples of circular speed along the world axes in 3D)
    const vc = Math.sqrt((sys.G * STAR_MASS) / Math.hypot(sys.home.x, sys.home.y));
    if (mode3d) {
      aim3 = { x: sys.home.vx / vc, y: sys.home.vy / vc };
      v3.resetCamera(Math.hypot(sys.home.x, sys.home.y));
    } else {
      aim = { x: aim3.x * CIRC_PX, y: aim3.y * CIRC_PX };
    }
    dirty = true;
  });
  $("zin").addEventListener("click", () => (mode3d ? v3.zoom(1.4) : zoomAt(W / 2, H / 2, 1.4)));
  $("zout").addEventListener("click", () => (mode3d ? v3.zoom(1 / 1.4) : zoomAt(W / 2, H / 2, 1 / 1.4)));
  $("fit").addEventListener("click", () => {
    if (mode3d) v3.resetCamera(Math.hypot(sys.home.x, sys.home.y));
    else fitView();
    dirty = true;
  });

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat) return;
    if (e.target !== document.body && e.target !== canvas && e.target !== $("view3d")) return;
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

/** Turn the on-screen arrow into a real velocity for wherever the planet is now. */
function applyAim() {
  const h = sys.home;
  const vc = Math.sqrt((sys.G * STAR_MASS) / Math.hypot(h.x, h.y));
  sys.setVelocity((aim.x / CIRC_PX) * vc, (aim.y / CIRC_PX) * vc);
}

function planetScreen() {
  return toScreen(sys.bodies[1].x, sys.bodies[1].y);
}

/** What would a press at (sx, sy) grab? "planet", "velocity" or null. */
function grabTarget(sx, sy) {
  if (!sys || started) return null;
  const [px, py] = planetScreen();
  const d = Math.hypot(sx - px, sy - py);
  if (d <= PLANET_PICK) return "planet";
  const len = Math.hypot(aim.x, aim.y);
  const k = aimScale();
  if (len > 0 && Math.hypot(sx - (px + aim.x * k), sy - (py - aim.y * k)) <= HANDLE_PICK) return "velocity";
  if (len < 20 && d <= AIM_RING) return "velocity";
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
    applyAim(); // keep the same arrow (relative to circular speed) at the new distance
    edited();
  };
  const aimAt = (sx, sy) => {
    const [px, py] = planetScreen();
    const k = aimScale();
    let dx = (sx - px) / k;
    let dy = -(sy - py) / k;
    const len = Math.hypot(dx, dy);
    const max = CIRC_PX * MAX_AIM;
    if (len > max) {
      dx *= max / len;
      dy *= max / len;
    }
    aim = len < 3 ? { x: 0, y: 0 } : { x: dx, y: dy };
    applyAim();
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
/* Pointer interaction in the 3D view                                  */
/* ------------------------------------------------------------------ */

// Same lab, same gestures: drag the planet along the orbital plane, drag the
// arrow to set the velocity, drag the tape. Anything else orbits the camera.
function wire3D() {
  const c3 = $("view3d");
  let grab = null;
  const local = (e) => {
    const r = c3.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const arrowWorld = () => CIRC_PX * v3.refWpp();
  const edited = () => {
    trail = [];
    updateUI();
  };
  const applyAim3 = () => {
    const h = sys.home;
    const vc = Math.sqrt((sys.G * STAR_MASS) / Math.hypot(h.x, h.y));
    sys.setVelocity(aim3.x * vc, aim3.y * vc);
  };

  function target(x, y) {
    if (started) return null;
    const p = sys.bodies[1];
    const [px, py] = v3.project(p.x, p.y);
    const d = Math.hypot(x - px, y - py);
    if (d <= Math.max(PLANET_PICK, v3.planetPx(p.x, p.y) + 4)) return "planet";
    const aw = arrowWorld();
    const [tx, ty] = v3.project(p.x + aim3.x * aw, p.y + aim3.y * aw);
    const len = Math.hypot(aim3.x, aim3.y) * CIRC_PX;
    if (len > 0 && Math.hypot(x - tx, y - ty) <= HANDLE_PICK) return "velocity";
    if (len < 20 && d <= AIM_RING) return "velocity";
    return null;
  }
  function placeAt(x, y) {
    const q = v3.unproject(x, y);
    if (!q) return;
    sys.place(q[0] - sys.bodies[0].x, q[1] - sys.bodies[0].y);
    applyAim3(); // keep the same arrow (relative to circular speed) at the new distance
    edited();
  }
  function aimAt(x, y) {
    const q = v3.unproject(x, y);
    if (!q) return;
    const p = sys.bodies[1];
    const aw = arrowWorld();
    let rx = (q[0] - p.x) / aw;
    let ry = (q[1] - p.y) / aw;
    const len = Math.hypot(rx, ry);
    const max = MAX_AIM; // multiples of circular speed, as in 2D
    if (len > max) {
      rx *= max / len;
      ry *= max / len;
    }
    aim3 = len * CIRC_PX < 3 ? { x: 0, y: 0 } : { x: rx, y: ry };
    applyAim3();
    edited();
  }

  // Capture phase, so a grab on the planet/arrow/tape never reaches the camera controls.
  c3.addEventListener(
    "pointerdown",
    (e) => {
      if (!sys || !mode3d || !v3 || e.button !== 0) return; // right-drag / shift-drag pan the camera
      const [x, y] = local(e);
      v3.poke();
      let taken = false;
      const part = tapeHit(x, y);
      if (part) {
        const q = v3.unproject(x, y);
        if (q) {
          tapeGrab = { part, wx: q[0], wy: q[1], a: { ...tape.a }, b: { ...tape.b } };
          taken = true;
        }
      } else {
        grab = target(x, y);
        taken = !!grab;
      }
      if (!taken) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      c3.setPointerCapture(e.pointerId);
      if (grab === "planet") placeAt(x, y);
      else if (grab === "velocity") aimAt(x, y);
    },
    true
  );
  c3.addEventListener("pointermove", (e) => {
    if (!sys || !mode3d || !v3) return;
    const [x, y] = local(e);
    if (tapeGrab) {
      const q = v3.unproject(x, y);
      if (!q) return;
      const [wx, wy] = q;
      if (tapeGrab.part === "a") tape.a = { x: wx, y: wy };
      else if (tapeGrab.part === "b") tape.b = { x: wx, y: wy };
      else {
        const dx = wx - tapeGrab.wx;
        const dy = wy - tapeGrab.wy;
        tape.a = { x: tapeGrab.a.x + dx, y: tapeGrab.a.y + dy };
        tape.b = { x: tapeGrab.b.x + dx, y: tapeGrab.b.y + dy };
      }
    } else if (grab === "planet") placeAt(x, y);
    else if (grab === "velocity") aimAt(x, y);
    else c3.style.cursor = target(x, y) || tapeHit(x, y) ? "pointer" : "";
  });
  const end = () => {
    grab = null;
    tapeGrab = null;
  };
  c3.addEventListener("pointerup", end);
  c3.addEventListener("pointercancel", end);
}

/* ------------------------------------------------------------------ */
/* Timer panel: drag by its header, resize from the corner, reset      */
/* ------------------------------------------------------------------ */

function wireHud() {
  const box = $("hudbox");
  const grip = $("timerGrip");
  const rz = $("timerResize");
  const rb = $("timerReset");
  const MIN_S = 0.7;
  const MAX_S = 2.4;
  let s = 1; // size, as a multiple of the default
  let moved = false;

  const refresh = () => {
    box.style.setProperty("--s", String(s));
    rb.hidden = !moved && s === 1;
  };
  const keepOnScreen = () => {
    const w = box.offsetWidth * s;
    const h = box.offsetHeight * s;
    const x = Math.min(Math.max(0, box.offsetLeft), Math.max(0, window.innerWidth - w));
    const y = Math.min(Math.max(0, box.offsetTop), Math.max(0, window.innerHeight - h));
    if (x !== box.offsetLeft || y !== box.offsetTop) {
      box.style.left = x + "px";
      box.style.top = y + "px";
      moved = true;
    }
  };
  const reset = () => {
    s = 1;
    moved = false;
    box.style.left = "";
    box.style.top = "";
    refresh();
  };

  // A small helper: run move/up handlers for one drag.
  const drag = (el, e, onMove) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const up = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.classList.remove("dragging");
    };
    el.classList.add("dragging");
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  grip.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#timerReset")) return;
    const x0 = box.offsetLeft;
    const y0 = box.offsetTop;
    const px = e.clientX;
    const py = e.clientY;
    drag(grip, e, (ev) => {
      const w = box.offsetWidth * s;
      const h = box.offsetHeight * s;
      box.style.left = Math.min(Math.max(0, x0 + ev.clientX - px), Math.max(0, window.innerWidth - w)) + "px";
      box.style.top = Math.min(Math.max(0, y0 + ev.clientY - py), Math.max(0, window.innerHeight - h)) + "px";
      moved = true;
      refresh();
    });
  });

  rz.addEventListener("pointerdown", (e) => {
    const s0 = s;
    const px = e.clientX;
    const base = box.offsetWidth;
    drag(rz, e, (ev) => {
      s = Math.min(MAX_S, Math.max(MIN_S, s0 + (ev.clientX - px) / base));
      keepOnScreen();
      refresh();
    });
  });

  rb.addEventListener("click", reset);
  grip.addEventListener("dblclick", (e) => {
    if (!e.target.closest("#timerReset")) reset();
  });
  window.addEventListener("resize", () => {
    if (moved) keepOnScreen();
  });
  refresh();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

$("starMass").textContent = String(STAR_MASS);
$("planetMass").textContent = String(PLANET_MASS);
wireControls();
wireCanvas();
wire3D();
wireHud();

/** Start fresh for a given letter A-Z (each is a fixed G). */
function launch(letter) {
  $("letter").textContent = letter;
  sys = new System(G_KEY[letter]);
  aim = { x: 0, y: 0 };
  started = false;
  trail = [];
  setPlaying(false);
  dirty = true;
}

new ResizeObserver(resize).observe(canvas);
resize();
updateUI();
requestAnimationFrame(frame);
loadOrCreateLetter().then(launch);
