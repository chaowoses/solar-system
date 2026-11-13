// Optional 3D view of the same simulation, drawn with three.js in a stylised,
// saturated "painted space" look: a turquoise-and-green planet with a glowing
// atmosphere and drifting clouds, a boiling sun with a soft corona, a nebula sky,
// drifting dust, and a gentle film grade. It only
// draws; the physics lives in physics.js. The page talks to it through
// project/unproject so the whole lab (placing, aiming, measuring) works in 3D.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { STAR_RADIUS } from "./physics.js";

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);
  const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;
  vec4 s1=floor(b1)*2.+1.;
  vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
  m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){
  float a=.5, s=0.;
  for(int i=0;i<5;i++){ s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; }
  return s;
}
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); } // palette is written in sRGB
`;

const SURFACE_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vWN;
varying vec3 vWP;
void main(){
  vObj = position;
  vWN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const PLANET_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uTime;
varying vec3 vObj;
varying vec3 vWN;
varying vec3 vWP;
${NOISE}
void main(){
  vec3 n = normalize(vObj);
  vec3 w = n + 0.35 * vec3(snoise(n*1.7), snoise(n*1.7+5.), snoise(n*1.7+11.));
  float h = fbm(w * 1.5 + 3.0) * 0.9 + 0.5;
  float biome = fbm(n * 1.2 + 20.0) * 0.5 + 0.5;
  float fine = snoise(n * 9.0) * 0.5 + 0.5;
  float sea = 0.52;

  vec3 deep    = vec3(0.02, 0.15, 0.38);
  vec3 shallow = vec3(0.06, 0.70, 0.80);
  vec3 sand    = vec3(0.95, 0.83, 0.52);
  vec3 grassA  = vec3(0.16, 0.66, 0.30);
  vec3 grassB  = vec3(0.60, 0.80, 0.22);
  vec3 dry     = vec3(0.86, 0.52, 0.24);
  vec3 rock    = vec3(0.50, 0.38, 0.40);
  vec3 snow    = vec3(0.96, 0.98, 1.00);

  float oceanMask = 1.0 - smoothstep(sea - 0.01, sea + 0.01, h);
  vec3 col = mix(deep, shallow, smoothstep(sea - 0.22, sea - 0.01, h));
  vec3 land = mix(grassA, grassB, smoothstep(0.3, 0.75, biome + (fine - 0.5) * 0.35));
  land = mix(land, dry, smoothstep(0.62, 0.82, biome));
  land = mix(land, rock, smoothstep(sea + 0.18, sea + 0.34, h));
  land = mix(land, snow, smoothstep(sea + 0.36, sea + 0.46, h));
  land = mix(sand, land, smoothstep(sea + 0.005, sea + 0.045, h));
  land *= 0.9 + 0.2 * fine;
  col = mix(land, col, oceanMask);
  float pole = smoothstep(0.88, 0.96, abs(n.y) + (h - 0.5) * 0.18);
  col = lin(mix(col, snow, pole));

  vec3 N = normalize(vWN);
  vec3 V = normalize(cameraPosition - vWP);
  float ndl = dot(N, uSun);
  // soft wrapped diffuse: no hard terminator, light rolls off gently
  float lit = smoothstep(-0.25, 0.85, ndl);
  vec3 sunCol = vec3(1.0, 0.93, 0.82);
  vec3 fill = lin(vec3(0.14, 0.20, 0.42));       // cool light bounced from the nebula
  vec3 light = fill * (0.75 - 0.45 * lit) + sunCol * (1.25 * lit * lit + 0.10 * lit);
  vec3 c = col * light;
  // glitter on the water
  vec3 H = normalize(uSun + V);
  c += oceanMask * pow(max(dot(N, H), 0.0), 90.0) * sunCol * 0.9 * step(0.0, ndl);
  // atmospheric haze at the limb, strongest on the sunlit side
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.2);
  c += lin(vec3(0.34, 0.66, 1.00)) * fres * (0.10 + 0.75 * smoothstep(-0.4, 0.6, ndl));
  gl_FragColor = vec4(c, 1.0);
}`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uTime;
varying vec3 vObj;
varying vec3 vWN;
varying vec3 vWP;
${NOISE}
void main(){
  vec3 n = normalize(vObj);
  vec3 w = n + 0.25 * vec3(snoise(n*2.0+uTime*0.01), snoise(n*2.0+7.), 0.0);
  float d = fbm(w * 2.6 + 40.0) * 0.5 + 0.5;
  float a = smoothstep(0.60, 0.82, d);
  vec3 N = normalize(vWN);
  float ndl = dot(N, uSun);
  float lit = smoothstep(-0.25, 0.85, ndl);
  vec3 c = mix(lin(vec3(0.10, 0.14, 0.30)), vec3(1.05, 0.98, 0.90), lit * lit);
  gl_FragColor = vec4(c, a * 0.8);
}`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uSun;
varying vec3 vObj;
varying vec3 vWN;
varying vec3 vWP;
void main(){
  vec3 N = normalize(vWN);
  vec3 V = normalize(cameraPosition - vWP);
  float d = max(dot(-N, V), 0.0);   // 0 at the shell's edge, grows toward the planet
  float glow = pow(d, 1.7);
  float s = dot(N, uSun);
  float lit = smoothstep(-0.6, 0.55, s);
  vec3 c = mix(vec3(0.03, 0.10, 0.42), vec3(0.22, 0.66, 1.2), lit);
  // a thin warm blush where day turns to night
  c += vec3(0.9, 0.4, 0.3) * exp(-pow(s * 4.0, 2.0)) * 0.22;
  gl_FragColor = vec4(c * glow * (0.2 + 1.5 * lit), glow);
}`;

const SUN_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vObj;
varying vec3 vWN;
varying vec3 vWP;
${NOISE}
void main(){
  vec3 n = normalize(vObj);
  float g = fbm(n * 3.0 + vec3(uTime * 0.05, 0.0, uTime * 0.03));
  float g2 = snoise(n * 8.0 - vec3(0.0, uTime * 0.1, 0.0));
  float heat = clamp(0.62 + 0.45 * g + 0.10 * g2, 0.0, 1.0);
  vec3 c = mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.82, 0.38), heat);
  c = mix(c, vec3(1.0, 0.98, 0.88), smoothstep(0.55, 1.0, heat));
  vec3 V = normalize(cameraPosition - vWP);
  float mu = max(dot(normalize(vWN), V), 0.0);
  c *= 0.62 + 0.38 * pow(mu, 0.45);          // gentle limb darkening, not a hard edge
  gl_FragColor = vec4(c * 1.7, 1.0);
}`;

// A camera-facing plane carrying the sun's glow: a soft core, a wide halo and
// slowly shifting streamers. No hard cross; everything fades to nothing.
const CORONA_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const CORONA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBody;     // sun disc radius as a fraction of this plane
varying vec2 vUv;
${NOISE}
void main(){
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float x = max(r / uBody, 1.0);                // 1 at the sun's limb
  float core = exp(-(x - 1.0) * 3.2) * 0.85;      // hot ring hugging the disc
  float halo = pow(1.0 / x, 1.7) * 0.34;         // long soft falloff
  float rays = 0.5 + 0.5 * snoise(vec3(cos(a) * 1.9, sin(a) * 1.9, uTime * 0.06 + x * 0.25));
  float rays2 = 0.5 + 0.5 * snoise(vec3(cos(a * 2.0) * 3.4, sin(a * 2.0) * 3.4, -uTime * 0.04));
  float streak = pow(rays * rays2, 2.2) * pow(1.0 / x, 1.3) * 0.6;
  float fall = 1.0 - smoothstep(0.55, 1.0, r);   // fade out well before the plane's edge
  vec3 warm = vec3(1.0, 0.72, 0.36);
  vec3 hot  = vec3(1.0, 0.94, 0.78);
  vec3 red  = vec3(1.0, 0.38, 0.12);
  vec3 col = hot * core + warm * halo + mix(warm, red, smoothstep(1.0, 6.0, x)) * streak;
  gl_FragColor = vec4(col * fall, 1.0);
}`;

// The sky: layered nebula, a faint galactic band, and light scattered toward the sun.
const SKY_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSkySun;
varying vec3 vObj;
${NOISE}
void main(){
  vec3 d = normalize(vObj);
  vec3 q = d + 0.05 * vec3(sin(uTime * 0.02), 0.0, cos(uTime * 0.017));   // barely-there drift
  float a = fbm(q * 1.5 + 2.0) * 0.5 + 0.5;
  float b = fbm(q * 2.3 - 9.0) * 0.5 + 0.5;
  float c = fbm(q * 3.6 + 14.0) * 0.5 + 0.5;
  vec3 col = mix(lin(vec3(0.018, 0.022, 0.075)), lin(vec3(0.045, 0.030, 0.115)), 1.0 - abs(d.y));
  col += lin(vec3(0.20, 0.07, 0.36)) * smoothstep(0.42, 0.82, a) * 0.9;
  col += lin(vec3(0.02, 0.36, 0.46)) * smoothstep(0.46, 0.86, b) * 0.8;
  col += lin(vec3(0.70, 0.22, 0.42)) * smoothstep(0.56, 0.88, c) * smoothstep(0.42, 0.85, a) * 0.55;
  col += lin(vec3(1.00, 0.70, 0.40)) * smoothstep(0.62, 0.92, fbm(q * 5.0 + 3.0) * 0.5 + 0.5) * smoothstep(0.5, 0.8, b) * 0.12;
  float band = exp(-pow(dot(d, normalize(vec3(0.25, 0.9, 0.35))) * 3.0, 2.0));
  col += lin(vec3(0.40, 0.46, 0.80)) * band * (0.25 + 0.5 * c) * 0.5;
  float s = max(dot(d, uSkySun), 0.0);
  col += lin(vec3(1.0, 0.55, 0.28)) * (pow(s, 90.0) * 0.30 + pow(s, 14.0) * 0.035);
  gl_FragColor = vec4(col * 0.85, 1.0);
}`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime;
uniform float uPx;
varying vec3 vCol;
void main(){
  vCol = aColor * (0.8 + 0.2 * sin(uTime * 1.3 + aPhase));
  gl_PointSize = aSize * uPx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const STAR_FRAG = /* glsl */ `
varying vec3 vCol;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 2.2);
  gl_FragColor = vec4(vCol * a * 1.6, a);
}`;

// drifting dust near the orbital plane: it gives the scene depth and parallax
const DUST_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uPx;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  gl_PointSize = clamp(aSize * uPx * (420.0 / max(dist, 1.0)), 1.0, 7.0 * uPx);
  vA = (0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 0.6 + aPhase))) * smoothstep(40.0, 220.0, dist) * (1.0 - smoothstep(2500.0, 5200.0, dist));
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FRAG = /* glsl */ `
varying float vA;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 1.6) * vA;
  gl_FragColor = vec4(vec3(0.78, 0.86, 1.0) * a * 0.9, a);
}`;

const DEBRIS_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform float uPx;
varying vec3 vCol;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vCol = aColor;
  vA = aAlpha;
  gl_PointSize = clamp(aSize * uPx * (500.0 / max(-mv.z, 1.0)), 1.5, 16.0 * uPx);
  gl_Position = projectionMatrix * mv;
}`;
const DEBRIS_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 1.3) * vA;
  // hot white-orange at first, cooling to the chunk's own colour
  vec3 c = mix(vCol, vec3(1.0, 0.7, 0.3), smoothstep(0.55, 1.0, vA)) * 1.6;
  gl_FragColor = vec4(c * a, a);
}`;

const TRAIL_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSide;
varying vec3 vCol;
varying float vSide;
void main(){
  vCol = aColor;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TRAIL_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vSide;
void main(){
  float a = pow(max(1.0 - abs(vSide), 0.0), 1.4);   // bright spine, soft edges
  gl_FragColor = vec4(vCol, a);
}`;

// last pass: a whisper of chromatic fringe, vignette, film grain and a cool grade
const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float d = dot(c, c);
      vec2 off = c * d * 0.014;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - smoothstep(0.10, 0.52, d) * 0.55;
      col = col * vec3(0.97, 0.985, 1.05) + vec3(0.003, 0.005, 0.014);
      float n = fract(sin(dot(vUv * vec2(1731.0, 977.0) + fract(uTime) * 53.0, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.022;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

function glowTexture(stops) {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  // smooth the given stops into many so the edge fades to exactly nothing
  const parse = (str) => str.match(/[\d.]+/g).map(Number);
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    let j = 1;
    while (j < stops.length - 1 && stops[j][0] < t) j++;
    const [t0, c0] = stops[j - 1];
    const [t1, c1] = stops[j];
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const q = u * u * (3 - 2 * u);
    const a = parse(c0), b = parse(c1);
    const m = a.map((v, k) => v + (b[k] - v) * q);
    const fade = Math.pow(1 - t, 1.5); // force zero at the rim
    gr.addColorStop(t, `rgba(${m[0] | 0},${m[1] | 0},${m[2] | 0},${m[3] * fade})`);
  }
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createView3D(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 40000);
  camera.position.set(0, 620, 0.001);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = true; // right-drag or shift-drag
  controls.screenSpacePanning = false; // slide along the orbital plane, not up the screen
  controls.enableZoom = false; // zooming is handled below: fast and exponential, like the 2D view
  controls.minDistance = 30;
  controls.maxDistance = 6000;
  controls.rotateSpeed = 0.7;
  let touching = false;
  let lastTouch = -1e9;
  controls.addEventListener("start", () => (touching = true));
  controls.addEventListener("end", () => {
    touching = false;
    lastTouch = performance.now();
  });

  const uniforms = {
    uTime: { value: 0 },
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uSkySun: { value: new THREE.Vector3(0, 0, -1) },
    uPx: { value: dpr },
  };
  const shader = (frag, extra = {}) =>
    new THREE.ShaderMaterial({ uniforms, vertexShader: SURFACE_VERT, fragmentShader: frag, ...extra });
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

  /* ---- sky ---- */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(20000, 48, 32),
    shader(SKY_FRAG, { side: THREE.BackSide, depthWrite: false })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  const N_STARS = 3600;
  const pos = new Float32Array(N_STARS * 3);
  const col = new Float32Array(N_STARS * 3);
  const size = new Float32Array(N_STARS);
  const phase = new Float32Array(N_STARS);
  const tints = [[1, 1, 1], [0.8, 0.88, 1], [1, 0.9, 0.74], [1, 0.76, 0.6], [0.7, 0.8, 1], [1, 0.7, 0.9]];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < N_STARS; i++) {
    const u = rnd() * 2 - 1;
    const t = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos.set([r * Math.cos(t) * 15000, u * 15000, r * Math.sin(t) * 15000], i * 3);
    const tint = tints[(rnd() * tints.length) | 0];
    const br = 0.3 + rnd() ** 3 * 0.9;
    col.set([tint[0] * br, tint[1] * br, tint[2] * br], i * 3);
    size[i] = 2 + rnd() ** 4 * 9;
    phase[i] = rnd() * 6.28;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  sg.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  sg.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  sg.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  const stars = new THREE.Points(
    sg,
    new THREE.ShaderMaterial({ uniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, ...additive })
  );
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  scene.add(stars);

  /* ---- drifting dust ---- */
  const N_DUST = 1800;
  const dp = new Float32Array(N_DUST * 3);
  const ds = new Float32Array(N_DUST);
  const dph = new Float32Array(N_DUST);
  for (let i = 0; i < N_DUST; i++) {
    const r = 60 + Math.sqrt(rnd()) * 1500;
    const a = rnd() * Math.PI * 2;
    dp.set([Math.cos(a) * r, (rnd() + rnd() + rnd() - 1.5) * 90, Math.sin(a) * r], i * 3);
    ds[i] = 1.2 + rnd() ** 2 * 3.4;
    dph[i] = rnd() * 6.28;
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
  dg.setAttribute("aSize", new THREE.BufferAttribute(ds, 1));
  dg.setAttribute("aPhase", new THREE.BufferAttribute(dph, 1));
  const dust = new THREE.Points(
    dg,
    new THREE.ShaderMaterial({ uniforms, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, ...additive })
  );
  dust.frustumCulled = false;
  scene.add(dust);

  /* ---- sun ---- */
  const sun = new THREE.Group();
  scene.add(sun);
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(STAR_RADIUS, 64, 48), shader(SUN_FRAG));
  sun.add(sunMesh);
  const CORONA_SIZE = STAR_RADIUS * 36; // plane edge length in world units
  const coronaU = { uTime: uniforms.uTime, uBody: { value: (STAR_RADIUS * 2) / CORONA_SIZE } };
  const corona = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({ uniforms: coronaU, vertexShader: CORONA_VERT, fragmentShader: CORONA_FRAG, ...additive })
  );
  corona.scale.setScalar(CORONA_SIZE);
  sun.add(corona);
  const bloomGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture([[0, "rgba(255,200,120,0.22)"], [0.3, "rgba(255,140,60,0.06)"], [1, "rgba(255,100,30,0)"]]),
      ...additive,
    })
  );
  bloomGlow.scale.setScalar(STAR_RADIUS * 50);
  sun.add(bloomGlow);

  /* ---- planet ---- */
  const planet = new THREE.Group();
  scene.add(planet);
  const tilt = new THREE.Group();
  tilt.rotation.z = 0.41;
  planet.add(tilt);
  const surface = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), shader(PLANET_FRAG));
  tilt.add(surface);
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.018, 80, 56),
    shader(CLOUD_FRAG, { transparent: true, depthWrite: false })
  );
  tilt.add(clouds);
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.16, 64, 48),
    shader(ATMO_FRAG, { side: THREE.BackSide, ...additive })
  );
  planet.add(atmo);

  /* ---- orbit trail: a soft ribbon of light, deep teal where the planet has been, warming to gold at its head ---- */
  const MAX_TRAIL = 8100;
  const trailGeo = new THREE.BufferGeometry();
  const trailPos = new Float32Array(MAX_TRAIL * 2 * 3);
  const trailCol = new Float32Array(MAX_TRAIL * 2 * 3);
  const trailSide = new Float32Array(MAX_TRAIL * 2);
  const trailIdx = new Uint32Array((MAX_TRAIL - 1) * 6);
  for (let i = 0; i < MAX_TRAIL - 1; i++) {
    trailSide[i * 2] = -1;
    trailSide[i * 2 + 1] = 1;
    trailIdx.set([i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2], i * 6);
  }
  trailSide[(MAX_TRAIL - 1) * 2] = -1;
  trailSide[(MAX_TRAIL - 1) * 2 + 1] = 1;
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute("aColor", new THREE.BufferAttribute(trailCol, 3));
  trailGeo.setAttribute("aSide", new THREE.BufferAttribute(trailSide, 1));
  trailGeo.setIndex(new THREE.BufferAttribute(trailIdx, 1));
  trailGeo.setDrawRange(0, 0);
  const trailMesh = new THREE.Mesh(
    trailGeo,
    new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  trailMesh.frustumCulled = false;
  scene.add(trailMesh);
  let trailRef = null;
  let trailLen = -1;
  let trailWidth = 0;

  function rebuildTrail(trail, w) {
    const n = Math.min(trail.length, MAX_TRAIL);
    const closed = n > 3 && trail[0][0] === trail[n - 1][0] && trail[0][1] === trail[n - 1][1];
    for (let i = 0; i < n; i++) {
      const prev = trail[Math.max(0, i - 1)];
      const next = trail[Math.min(n - 1, i + 1)];
      const dx = next[0] - prev[0];
      const dz = -(next[1] - prev[1]);
      const L = Math.hypot(dx, dz) || 1;
      const nx = (-dz / L) * (w / 2);
      const nz = (dx / L) * (w / 2);
      const x = trail[i][0];
      const z = -trail[i][1];
      trailPos.set([x + nx, 0, z + nz, x - nx, 0, z - nz], i * 6);
      let f = n > 1 ? i / (n - 1) : 1;
      if (closed) f = Math.sin(f * Math.PI); // one full lap: teal at the join, gold opposite, no seam
      const k = f * f;
      const glow = (0.35 + 0.65 * f) * 1.35; // older parts fade
      const r = (0.12 + k * 1.1) * glow;
      const g = (0.7 + k * 0.1) * glow;
      const bl = (0.8 - k * 0.55) * glow;
      trailCol.set([r, g, bl, r, g, bl], i * 6);
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.aColor.needsUpdate = true;
    trailGeo.setDrawRange(0, n >= 2 ? (n - 1) * 6 : 0);
  }

  /* ---- collision: flash, shockwave, flying debris and a camera jolt ---- */
  const boom = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture([[0, "rgba(255,250,210,1)"], [0.2, "rgba(255,170,60,0.8)"], [0.55, "rgba(230,70,20,0.3)"], [1, "rgba(200,40,10,0)"]]),
      ...additive,
    })
  );
  boom.visible = false;
  scene.add(boom);
  const ringTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, "rgba(255,200,120,0)");
    gr.addColorStop(0.6, "rgba(255,200,120,0)");
    gr.addColorStop(0.8, "rgba(255,232,180,0.9)");
    gr.addColorStop(0.9, "rgba(255,140,60,0.35)");
    gr.addColorStop(1, "rgba(255,100,30,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const shock = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, ...additive }));
  shock.visible = false;
  scene.add(shock);

  const N_DEB = 420;
  const debPos = new Float32Array(N_DEB * 3);
  const debVel = new Float32Array(N_DEB * 3);
  const debCol = new Float32Array(N_DEB * 3);
  const debSize = new Float32Array(N_DEB);
  const debAlpha = new Float32Array(N_DEB);
  const debGeo = new THREE.BufferGeometry();
  debGeo.setAttribute("position", new THREE.BufferAttribute(debPos, 3));
  debGeo.setAttribute("aColor", new THREE.BufferAttribute(debCol, 3));
  debGeo.setAttribute("aSize", new THREE.BufferAttribute(debSize, 1));
  debGeo.setAttribute("aAlpha", new THREE.BufferAttribute(debAlpha, 1));
  const debris = new THREE.Points(
    debGeo,
    new THREE.ShaderMaterial({ uniforms, vertexShader: DEBRIS_VERT, fragmentShader: DEBRIS_FRAG, ...additive })
  );
  debris.frustumCulled = false;
  debris.visible = false;
  scene.add(debris);
  const chunkColors = [[0.2, 0.75, 0.3], [0.1, 0.45, 1.0], [0.95, 0.85, 0.5], [1, 1, 1], [1, 0.5, 0.15], [0.5, 0.35, 0.3]];
  const impact = new THREE.Vector3();
  const shake = new THREE.Vector3();
  let crashStart = 0;

  function startCollision(ix, iz, nx, nz, scale) {
    impact.set(ix, 0, iz);
    for (let i = 0; i < N_DEB; i++) {
      // fragments leave the sun's surface in a fan around the outward direction
      const spread = 0.35 + Math.random() * 0.9;
      const vx = nx * (0.7 + Math.random()) + (Math.random() - 0.5) * 2 * spread;
      const vz = nz * (0.7 + Math.random()) + (Math.random() - 0.5) * 2 * spread;
      const vy = (Math.random() - 0.5) * 1.6;
      const L = Math.hypot(vx, vy, vz) || 1;
      const speed = (45 + Math.random() ** 1.5 * 260) * scale;
      debVel.set([(vx / L) * speed, (vy / L) * speed, (vz / L) * speed], i * 3);
      debPos.set([ix, 0, iz], i * 3);
      debCol.set(chunkColors[(Math.random() * chunkColors.length) | 0], i * 3);
      debSize[i] = 4 + Math.random() ** 2 * 14;
      debAlpha[i] = 1;
    }
  }
  function updateCollision(e, dt, camDist) {
    const life = Math.min(1, e / 4.5);
    const k = Math.exp(-0.45 * dt);
    for (let i = 0; i < N_DEB; i++) {
      for (let a = 0; a < 3; a++) {
        debVel[i * 3 + a] *= k;
        debPos[i * 3 + a] += debVel[i * 3 + a] * dt;
      }
      debAlpha[i] = Math.pow(1 - life, 1.4) * (0.7 + 0.3 * Math.sin(e * 18 + i));
    }
    debGeo.attributes.position.needsUpdate = true;
    debGeo.attributes.aAlpha.needsUpdate = true;
    debGeo.attributes.aColor.needsUpdate = true;
    debGeo.attributes.aSize.needsUpdate = true;
    debris.visible = life < 1;
    // jolt: a short, decaying shake that scales with how far the camera is
    const amp = e < 0.9 ? Math.exp(-e * 5) * camDist * 0.006 : 0;
    shake.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
  }
  function endCollision() {
    crashStart = 0;
    boom.visible = false;
    shock.visible = false;
    debris.visible = false;
    shake.set(0, 0, 0);
    bloom.strength = BLOOM_BASE;
  }

  /* ---- post: bloom, tone/colour output, then the grade ---- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const BLOOM_BASE = 0.6;
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_BASE, 0.3, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GRADE);
  composer.addPass(grade);

  let cw = 1;
  let ch = 1;
  function resize(w, h) {
    cw = Math.max(1, w);
    ch = Math.max(1, h);
    renderer.setSize(cw, ch, false);
    composer.setPixelRatio(dpr);
    composer.setSize(cw, ch);
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
  }

  function resetCamera(r = 200) {
    // a bird's-eye view straight down on the orbital plane (screen-up is world +y, as in 2D),
    // far enough back to frame the planet's current orbit
    const d = Math.max(420, r * 3.2);
    camera.position.set(0, d, 0.001);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  /** Zoom by factor f about a screen point: the spot on the orbital plane under it stays put. */
  function zoomAt(sx, sy, f) {
    const q = unproject(sx, sy);
    const pivot = q ? new THREE.Vector3(q[0], 0, -q[1]) : controls.target.clone();
    const cur = camera.position.distanceTo(controls.target);
    const next = Math.min(controls.maxDistance, Math.max(controls.minDistance, cur / f));
    const k = cur / next; // the factor actually applied, after clamping
    camera.position.sub(pivot).multiplyScalar(1 / k).add(pivot);
    controls.target.sub(pivot).multiplyScalar(1 / k).add(pivot);
    controls.update();
  }
  const zoom = (f) => zoomAt(cw / 2, ch / 2, f);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; // lines / pages -> px
      lastTouch = performance.now();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * unit * 0.0016));
    },
    { passive: false }
  );

  /* ---- picking: the page works in world (x, y) on the orbital plane ---- */
  const tmpV = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let curRad = 6;

  /** World (x, y) -> canvas pixels. */
  function project(wx, wy) {
    camera.updateMatrixWorld();
    tmpV.set(wx, 0, -wy).project(camera);
    return [((tmpV.x + 1) / 2) * cw, ((1 - tmpV.y) / 2) * ch];
  }
  /** Canvas pixels -> world (x, y) on the orbital plane, or null if the ray misses it. */
  function unproject(sx, sy) {
    camera.updateMatrixWorld();
    ray.setFromCamera({ x: (sx / cw) * 2 - 1, y: 1 - (sy / ch) * 2 }, camera);
    return ray.ray.intersectPlane(plane, hit) ? [hit.x, -hit.z] : null;
  }
  /** World units per screen pixel at a point on the plane. */
  function wpp(wx, wy) {
    tmpV.set(wx, 0, -wy);
    const d = camera.position.distanceTo(tmpV);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / ch;
  }
  const planetPx = (wx, wy) => curRad / wpp(wx, wy);
  /** World units per pixel at the default framing (camera 640 up): the arrow's fixed reference scale. */
  const refWpp = () => (2 * 640 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / ch;
  const poke = () => (lastTouch = performance.now());

  let lastT = 0;

  /** Draw one frame. `s` = { star, planet, trail, crashed, cinematic } from the simulation. */
  function render(nowMs, s) {
    const t = nowMs / 1000;
    const dt = Math.min(0.1, t - lastT || 0.016);
    lastT = t;
    uniforms.uTime.value = t;
    grade.uniforms.uTime.value = t;
    controls.update();

    // world (x, y) -> scene (x, 0, -y): looking down from +Y, y points up the screen
    const sx = s.star.x, sz = -s.star.y;
    const px = s.planet.x, pz = -s.planet.y;
    sun.position.set(sx, 0, sz);
    planet.position.set(px, 0, pz);
    uniforms.uSun.value.set(sx - px, 0, sz - pz).normalize();
    uniforms.uSkySun.value.set(sx, 0, sz).sub(camera.position).normalize();

    // keep the planet readable at any camera distance (bodies are not to scale)
    const dist = camera.position.distanceTo(planet.position);
    curRad = Math.min(8, Math.max(3.5, dist * 0.0125));
    planet.scale.setScalar(curRad);
    surface.rotation.y += dt * 0.35;
    clouds.rotation.y += dt * 0.43;
    dust.rotation.y = t * 0.004;

    // the sun's glow grows a little when you are far away so it never vanishes
    const far = camera.position.distanceTo(sun.position);
    const k = Math.max(1, far / 800);
    sunMesh.scale.setScalar(Math.min(1.5, Math.max(1, far / 500)));
    corona.scale.setScalar(CORONA_SIZE * k);
    coronaU.uBody.value = (STAR_RADIUS * 2 * sunMesh.scale.x) / (CORONA_SIZE * k);
    corona.quaternion.copy(camera.quaternion);
    bloomGlow.scale.setScalar(STAR_RADIUS * 50 * k);

    // collision: the planet is destroyed on the sun's surface
    if (s.crashed) {
      if (!crashStart) {
        crashStart = t;
        const dx = px - sx, dz = pz - sz;
        const L = Math.hypot(dx, dz) || 1;
        const surf = STAR_RADIUS * sunMesh.scale.x;
        startCollision(sx + (dx / L) * surf, sz + (dz / L) * surf, dx / L, dz / L, curRad / 6);
      }
      const e = t - crashStart;
      planet.visible = false;
      boom.visible = true;
      boom.position.copy(impact);
      boom.scale.setScalar(curRad * (6 + 26 * (1 - Math.exp(-e * 4))) + 10);
      boom.material.opacity = 0.22 + 0.78 * Math.exp(-e * 2.0);
      shock.visible = e < 2.6;
      shock.position.copy(impact);
      shock.scale.setScalar(curRad * 3 + e * 380);
      shock.material.opacity = Math.exp(-e * 1.2);
      bloom.strength = BLOOM_BASE + 1.4 * Math.exp(-e * 2.6);
      updateCollision(e, dt, camera.position.distanceTo(impact));
    } else {
      if (crashStart) endCollision();
      planet.visible = true;
    }

    // trail: keep the ribbon a steady few pixels wide whatever the zoom
    const wantW = Math.max(1.4, camera.position.distanceTo(controls.target) * 0.006);
    if (s.trail !== trailRef || s.trail.length !== trailLen || Math.abs(wantW / (trailWidth || 1) - 1) > 0.04) {
      trailRef = s.trail;
      trailLen = s.trail.length;
      trailWidth = wantW;
      rebuildTrail(s.trail, wantW);
    }

    // stars and sky sit at infinity
    stars.position.copy(camera.position);
    sky.position.copy(camera.position);

    camera.position.add(shake);
    composer.render();
    camera.position.sub(shake);
  }

  return { resize, render, resetCamera, zoom, project, unproject, wpp, refWpp, planetPx, poke, camera, controls };
}
