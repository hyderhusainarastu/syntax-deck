// World: depth and light behind the text. One light; dust; parallax tied to state.depth.
// Holds no text and no content. Reads only `hooks` (apply, theme, wash, reduced) and CSS tokens (--world-*).
// A cue is a settled vector of numbers, so go(i) from anywhere lands on the same state: there is nothing to replay.
import {
  BufferAttribute, BufferGeometry, Mesh, NormalBlending, PerspectiveCamera, PlaneGeometry, Points, Scene,
  ShaderMaterial, WebGLRenderer,
} from 'three';
import { hooks } from '../engine/hooks.mjs';

const DPR_CAP = 1.5;
const ENTRY_S = 1.6;             // cue entry
const DEPTH_S = 0.9;             // depth-only change, in step with the token tween
const IDLE_AFTER_MS = 10000;     // no step change for this long drops the loop
const IDLE_FRAME_MS = 50;        // 20 fps
const DUST = 1600;
const CAM_Z = 6;                 // at z=0 the view is 2 units tall
const DRIFT_PERIOD_S = 3600;     // drift is periodic over this, so the clock stays small on a deck left open for hours

// Screen units: y runs -1..1, x runs -aspect..aspect. The focus Greek sits around y=.36.
// Every cue keeps the source below PLANE_Y except ascend, so entering ascend from anywhere crosses the plane.
const PLANE_Y = 0.46;
const REST = { sy: .30, sx: 0, i: .30, r: .55, core: .24, beam: 0, split: 0, shelf: 0, plane: 0, gather: 0, twin: 0, dust: .50 };
const CUES = {
  rest:     { to: REST },
  form:     { to: { ...REST, i: .40, r: .75, core: .22, gather: 1, dust: 1 } },
  identify: { to: { ...REST, sy: .36, i: .95, r: .80, core: .80, shelf: .62, dust: .85 },
              win: { i: [.40, .62], core: [.40, .62], shelf: [.40, .62] } },     // one step, not a ramp
  fork:     { to: { ...REST, sy: .40, i: .26, r: .42, core: .55, beam: 1, split: 1, dust: .60 },
              win: { beam: [0, .45], split: [.40, 1] } },                        // one beam first, then it divides
  twin:     { to: { ...REST, sy: .30, sx: .88, i: .62, r: .50, core: .42, twin: 1, dust: .80 } },
  ascend:   { to: { ...REST, sy: .80, i: .80, r: .85, core: .90, plane: 1, dust: .70 },
              win: { plane: [0, .35], sy: [.12, 1] } },                          // the plane is there before the light passes it
};

const FIELD = /* glsl */`
uniform float uSy, uSx, uI, uR, uCore, uBeam, uSplit, uShelf, uPlane, uTwin, uZoom;
const float PLANE_Y = ${PLANE_Y.toFixed(3)};
float sq(float x) { return x * x; }
float segment(vec2 p, vec2 a, vec2 b, out float h) {
  vec2 ap = p - a, ab = b - a;
  h = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
  return length(ap - ab * h);
}
// The light as one scalar, in screen units. Space is folded on x=0: with uSx>0 the one source has a mirror image,
// and the beam's branch has its twin, with no second light in the code.
float field(vec2 screen) {
  vec2 p = screen / uZoom;
  vec2 q = vec2(abs(p.x), p.y);
  vec2 s = vec2(uSx, uSy);
  vec2 d = q - s;
  float r2 = dot(d, d);
  float f = uI / (1.0 + r2 / (uR * uR)) + uCore * exp(-r2 / 0.0045);
  if (uBeam > 0.001) {
    float h;
    vec2 fork = vec2(0.0, 0.02);
    float stem = segment(q, s, fork, h);
    f += uBeam * 0.62 * exp(-sq(stem / 0.055));
    float arm = segment(q, fork, vec2(uSplit * 1.45, -1.15), h);
    f += uBeam * mix(0.62, 0.50, uSplit) * (1.0 - 0.55 * h) * exp(-sq(arm / (0.055 + 0.075 * h)));
  }
  f += uShelf * exp(-sq((p.y - uSy) / 0.075) - sq(p.x / 1.35));
  f *= 1.0 - 0.55 * uTwin * exp(-sq(p.x / 0.07));                        // the seam between the two fields
  if (uPlane > 0.001) {
    float dy = p.y - PLANE_Y;
    float side = clamp((uSy - PLANE_Y) / 0.05, -1.0, 1.0);               // which side of the plane the source is on
    f *= 1.0 - 0.70 * uPlane * smoothstep(0.0, 0.05, -dy * side);        // the far side is in the plane's shadow
    f += uPlane * 0.75 * exp(-sq(dy / 0.0075) - sq(p.x / 1.6));          // its edge
    f += uPlane * 0.40 * max(side, 0.0) * exp(-sq((dy - 0.055) / 0.05) - sq(p.x / 0.95));   // the pool it catches
  }
  return f;
}`;

const QUAD_VS = /* glsl */`
uniform float uAspect;
varying vec2 vP;
void main() { vP = position.xy * vec2(uAspect, 1.0); gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const QUAD_FS = /* glsl */`
uniform vec3 uBg, uLight;
uniform float uGain;
varying vec2 vP;
${FIELD}
float dither(vec2 c) { return fract(52.9829189 * fract(dot(c, vec2(0.06711056, 0.00583715)))); }
void main() {
  float a = 1.0 - exp(-1.6 * field(vP) * uGain);                         // soft shoulder, so the core never clips flat
  gl_FragColor = vec4(mix(uBg, uLight, a) + (dither(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
}`;

const DUST_VS = /* glsl */`
attribute vec3 aTwinPos, aGatherPos;
attribute vec4 aDrift;                                                   // phase x, phase y, cycles per period, size
attribute float aSide;
uniform float uPhase, uPx, uDust, uGather, uAspect, uGain;
varying float vLit, vA;
${FIELD}
void main() {
  float g = uGather * step(0.2, fract(aDrift.x * 7.0));                  // a fifth stays loose in the room
  float flip = mix(1.0, aSide, uTwin);
  vec3 pos = mix(position, aTwinPos, uTwin);
  float w = 6.28318 * aDrift.z * uPhase;
  vec3 drift = vec3(flip * sin(w + aDrift.x), sin(w * 0.73 + aDrift.y), 0.5 * cos(w * 0.61 + aDrift.x)) * 0.05;
  pos = mix(pos, vec3(aGatherPos.x * uAspect, aGatherPos.yz), g) + drift * (1.0 - 0.85 * g);
  vec4 view = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * view;
  float lit = field(gl_Position.xy / gl_Position.w * vec2(uAspect, 1.0)) * uGain;
  vLit = clamp(lit, 0.0, 1.0);
  vA = uDust * uGain * (0.60 + 0.50 * g + 1.5 * vLit);
  gl_PointSize = max(1.0, uPx * aDrift.w * ${CAM_Z.toFixed(1)} / -view.z);
}`;

const DUST_FS = /* glsl */`
uniform vec3 uDustC, uLight;
varying float vLit, vA;
void main() {
  float a = smoothstep(0.5, 0.18, length(gl_PointCoord - 0.5)) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uDustC, uLight, vLit), min(a, 0.95));
}`;

const clamp01 = x => Math.min(1, Math.max(0, x));
const easeInOut = t => (t < .5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));         // power2.inOut, as the token tween

function hexToVec(v) {
  const h = String(v).trim().replace(/^#/, '');
  const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(full)) return null;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
}

function readColours() {
  const css = getComputedStyle(document.documentElement);
  const out = {
    bg: hexToVec(css.getPropertyValue('--world-bg')),
    light: hexToVec(css.getPropertyValue('--world-light')),
    dust: hexToVec(css.getPropertyValue('--world-dust')),
  };
  return out.bg && out.light && out.dust ? out : null;
}

function buildDust() {
  let seed = 0x5eed;                                                     // fixed, so a cue's still frame is one frame
  const rnd = () => {                                                    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pos = new Float32Array(DUST * 3), twin = new Float32Array(DUST * 3), gather = new Float32Array(DUST * 3);
  const drift = new Float32Array(DUST * 4), side = new Float32Array(DUST);
  for (let i = 0; i < DUST; i += 2) {
    const z = -5 + rnd() * 7.5, spread = (CAM_Z - z) / CAM_Z;            // even on screen, whatever the depth
    const x = (rnd() * 2 - 1) * 2.45 * spread, y = (rnd() * 2 - 1) * spread;
    const phaseX = rnd() * 6.283, phaseY = rnd() * 6.283, cycles = 60 + Math.floor(rnd() * 120), size = 1.1 + 2.2 * rnd() * rnd();
    for (let k = 0; k < 2 && i + k < DUST; k++) {                        // a mirror pair shares its motion
      const j = i + k, s = k ? 1 : -1;
      pos.set(k ? [(rnd() * 2 - 1) * 2.45 * spread, (rnd() * 2 - 1) * spread, z] : [x, y, z], j * 3);
      twin.set([s * Math.abs(x), y, z], j * 3);
      const row = Math.floor(rnd() * 5), word = Math.floor(rnd() * 15);  // five lines of broken runs, the look of a text setting
      gather.set([(-1 + 2 * (word + rnd() * .74) / 15) * .9, .70 - row * .165 + (rnd() - .5) * .022, (rnd() - .5) * .12], j * 3);
      drift.set([phaseX + k * 1.7, phaseY, cycles, size], j * 4);
      side[j] = s;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aTwinPos', new BufferAttribute(twin, 3));
  g.setAttribute('aGatherPos', new BufferAttribute(gather, 3));
  g.setAttribute('aDrift', new BufferAttribute(drift, 4));
  g.setAttribute('aSide', new BufferAttribute(side, 1));
  return g;
}

export async function initWorld(canvas, deck) {
  const root = document.documentElement;
  // Rejection is the report: main.mjs turns it into the `nowebgl` event, so nothing is emitted twice.
  const refuse = reason => { root.classList.add('no-webgl'); throw new Error(reason); };

  if (new URLSearchParams(location.search).get('nowebgl') === '1') refuse('nowebgl flag');
  if (!canvas) refuse('no canvas');
  const colours = readColours();
  if (!colours) refuse('world tokens missing');
  // Probed by hand: on failure three logs a console error before it throws.
  const attrs = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
  const gl = canvas.getContext('webgl2', attrs);
  if (!gl) refuse('no webgl2');

  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, context: gl, ...attrs });
  } catch (err) {
    refuse(String(err));
  }

  const camera = new PerspectiveCamera(2 * Math.atan(1 / CAM_Z) * 180 / Math.PI, 1, .1, 30);
  camera.position.z = CAM_Z;
  const U = {
    uBg: { value: colours.bg }, uLight: { value: colours.light }, uDustC: { value: colours.dust },
    uAspect: { value: 16 / 9 }, uPx: { value: 2 }, uPhase: { value: .25 }, uGain: { value: 1 }, uZoom: { value: 1 },
    uSy: { value: 0 }, uSx: { value: 0 }, uI: { value: 0 }, uR: { value: 1 }, uCore: { value: 0 }, uBeam: { value: 0 },
    uSplit: { value: 0 }, uShelf: { value: 0 }, uPlane: { value: 0 }, uTwin: { value: 0 }, uGather: { value: 0 }, uDust: { value: 0 },
  };
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2),
    new ShaderMaterial({ uniforms: U, vertexShader: QUAD_VS, fragmentShader: QUAD_FS, depthTest: false, depthWrite: false }));
  const dust = new Points(buildDust(),
    new ShaderMaterial({ uniforms: U, vertexShader: DUST_VS, fragmentShader: DUST_FS, depthTest: false, depthWrite: false,
                         transparent: true, blending: NormalBlending }));
  quad.frustumCulled = dust.frustumCulled = false;
  quad.renderOrder = 0;
  dust.renderOrder = 1;
  scene.add(quad, dust);

  const now = () => performance.now();
  const p = { ...REST, depth: 0 };       // the live pose; every frame is drawn from this
  let cue = 'rest', depth = 0, tween = null;
  let lost = false, paused = false;
  let reduced = root.classList.contains('reduced');
  let frame = 0, timer = 0, lastFrame = 0, lastStep = now(), phase = .25;

  const target = () => ({ ...CUES[cue].to, depth });

  const writeUniforms = () => {
    U.uSy.value = p.sy; U.uSx.value = p.sx; U.uI.value = p.i; U.uR.value = p.r; U.uCore.value = p.core;
    U.uBeam.value = p.beam; U.uSplit.value = p.split; U.uShelf.value = p.shelf; U.uPlane.value = p.plane;
    U.uTwin.value = p.twin; U.uGather.value = p.gather; U.uDust.value = p.dust;
    U.uZoom.value = 1 + .07 * p.depth;
    camera.position.set(0, .12 * p.depth, CAM_Z - .55 * p.depth);
    U.uPhase.value = phase;
  };

  const draw = () => { writeUniforms(); renderer.render(scene, camera); };

  const fail = reason => {
    if (lost) return;
    lost = true;
    halt();
    tween = null;
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    root.classList.add('no-webgl');
    hooks.emit('nowebgl', { reason });
  };

  const halt = () => {
    cancelAnimationFrame(frame); clearTimeout(timer);
    frame = timer = 0;
  };

  const looping = () => !lost && !paused && !reduced && !document.hidden;

  const schedule = () => {
    if (frame || timer || !looping()) return;
    if (!tween && now() - lastStep > IDLE_AFTER_MS) {
      timer = setTimeout(() => { timer = 0; frame = requestAnimationFrame(tick); }, IDLE_FRAME_MS);
    } else {
      frame = requestAnimationFrame(tick);
    }
  };

  const advance = t => {
    if (!tween) return;
    const u = clamp01((t - tween.start) / tween.ms);
    for (const k of Object.keys(tween.to)) {
      const [a, b] = tween.win[k] ?? [0, 1];
      p[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * easeInOut(clamp01((u - a) / (b - a)));
    }
    if (u >= 1) { Object.assign(p, tween.to); tween = null; }
  };

  function tick(t) {
    frame = 0;
    if (lost) return;
    try {
      phase = (phase + Math.min(t - lastFrame, 100) / 1000 / DRIFT_PERIOD_S) % 1;
      lastFrame = t;
      advance(now());
      draw();
    } catch (err) {
      fail(String(err));
      return;
    }
    schedule();
  }

  // One frame outside the loop: a still in reduced motion, or a repaint after a resize or theme change when paused.
  const still = () => {
    if (lost || frame || timer) return;
    frame = requestAnimationFrame(t => {
      frame = 0;
      try { draw(); } catch (err) { fail(String(err)); return; }
      if (looping()) { lastFrame = t; schedule(); }
    });
  };

  const land = () => { tween = null; Object.assign(p, target()); };

  const onApply = ({ state, immediate }) => {
    const nextCue = CUES[state.world] ? state.world : 'rest';
    const nextDepth = state.depth ?? 0;
    const cueChanged = nextCue !== cue, depthChanged = nextDepth !== depth;
    cue = nextCue;
    depth = nextDepth;
    if (lost) return;                    // cue() keeps tracking the deck; nothing draws
    lastStep = now();
    if (immediate || reduced) {
      land();
    } else if (cueChanged || depthChanged) {
      tween = { from: { ...p }, to: target(), start: now(), ms: (cueChanged ? ENTRY_S : DEPTH_S) * 1000,
                win: cueChanged ? CUES[cue].win ?? {} : {} };
    }
    if (timer) { clearTimeout(timer); timer = 0; }
    if (looping()) schedule(); else still();
  };

  const onColours = () => {
    if (lost) return;
    const c = readColours();
    if (c) { U.uBg.value = c.bg; U.uLight.value = c.light; U.uDustC.value = c.dust; }
    still();
  };

  const onWash = v => {
    U.uGain.value = v ? 1.45 : 1;        // the raised scrim takes light away; the world gives some back
    onColours();
  };

  const onReduced = v => {
    reduced = !!v;
    if (lost) return;
    if (reduced) { land(); phase = .25; halt(); still(); } else schedule();
  };

  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    U.uAspect.value = w / h;
    U.uPx.value = renderer.getPixelRatio() * h / 1080 * 2.6;
    still();
  };

  const onVisibility = () => {
    if (document.hidden) { halt(); return; }
    lastFrame = now();
    if (looping()) schedule(); else still();
  };

  // Subscribed before returning, so deck.start() cannot apply the first state unheard.
  hooks.on('apply', onApply);
  hooks.on('theme', onColours);
  hooks.on('wash', onWash);
  hooks.on('reduced', onReduced);
  if (root.classList.contains('wash')) U.uGain.value = 1.45;
  canvas.addEventListener('webglcontextlost', () => fail('webglcontextlost'), { once: true });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  resize();
  writeUniforms();

  return {
    get mode() { return lost ? 'fallback' : 'webgl'; },
    cue: () => cue,
    pause() { paused = true; halt(); },
    resume() { paused = false; schedule(); },
  };
}
