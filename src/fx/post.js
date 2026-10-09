import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const MAX_SHOCKS = 4;

// Final screen pass, applied after tone mapping:
//   shockwave distortion -> radial blur + chromatic aberration -> god rays from the boss core
//   -> colour grading -> slow-mo tint -> vignette -> speed lines
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAspect: { value: 1 },
    uTime: { value: 0 },
    uAberration: { value: 0 },
    uTint: { value: new THREE.Color(0x4fb8ff) },
    uTintAmount: { value: 0 },
    uVignette: { value: 0.35 },
    uShocks: { value: Array.from({ length: MAX_SHOCKS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uBlur: { value: 0 },
    uSpeedLines: { value: 0 },
    uRayPos: { value: new THREE.Vector2(0.5, 0.5) },
    uRayStrength: { value: 0 },
    uRayColor: { value: new THREE.Color(1.0, 0.7, 0.4) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uSaturation: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAspect;
    uniform float uTime;
    uniform float uAberration;
    uniform vec3 uTint;
    uniform float uTintAmount;
    uniform float uVignette;
    uniform vec4 uShocks[${MAX_SHOCKS}];
    uniform float uBlur;
    uniform float uSpeedLines;
    uniform vec2 uRayPos;
    uniform float uRayStrength;
    uniform vec3 uRayColor;
    uniform vec3 uGain;
    uniform vec3 uLift;
    uniform float uSaturation;
    varying vec2 vUv;

    float hash(float n) { return fract(sin(n) * 43758.5453); }

    void main() {
      vec2 uv = vUv;

      // Shockwaves: x,y = screen centre, z = radius, w = strength.
      for (int i = 0; i < ${MAX_SHOCKS}; i++) {
        vec4 s = uShocks[i];
        if (s.w <= 0.0) continue;
        vec2 d = uv - s.xy;
        d.x *= uAspect;
        float dist = length(d);
        float band = smoothstep(0.09, 0.0, abs(dist - s.z));
        uv -= normalize(d + 1e-5) * band * s.w * 0.035 * vec2(1.0 / uAspect, 1.0);
      }

      // Radial blur toward the centre plus chromatic aberration.
      vec2 c = uv - 0.5;
      vec2 off = c * uAberration * 0.03;
      vec3 col = vec3(0.0);
      float blur = uBlur * 0.05;
      for (int i = 0; i < 6; i++) {
        vec2 suv = 0.5 + c * (1.0 - float(i) * blur / 6.0);
        col.r += texture2D(tDiffuse, suv + off).r;
        col.g += texture2D(tDiffuse, suv).g;
        col.b += texture2D(tDiffuse, suv - off).b;
      }
      col /= 6.0;

      // God rays: march toward the light, gathering bright pixels.
      if (uRayStrength > 0.0) {
        vec2 dir = (uRayPos - uv) / 18.0;
        vec2 p = uv;
        float decay = 1.0;
        vec3 rays = vec3(0.0);
        for (int i = 0; i < 18; i++) {
          p += dir;
          vec3 s = texture2D(tDiffuse, clamp(p, 0.0, 1.0)).rgb;
          float b = max(0.0, dot(s, vec3(0.333)) - 0.72);
          rays += s * b * decay;
          decay *= 0.9;
        }
        col += min(rays * uRayColor * uRayStrength * 0.3, vec3(0.45));
      }

      // Grading.
      col = col * uGain + uLift;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, uSaturation);

      // Perfect-dodge tint.
      col = mix(col, uTint * (lum * 1.4 + 0.05), uTintAmount * 0.55);

      // Vignette.
      vec2 vd = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(vd) * (1.0 + uTintAmount * 0.5));
      col *= mix(1.0, v, uVignette + uTintAmount * 0.4);

      // Speed lines streaming from the edges.
      if (uSpeedLines > 0.0) {
        float a = atan(vd.y, vd.x);
        float slot = floor(a * 48.0);
        float n = hash(slot * 13.1 + floor(uTime * 24.0));
        float line = step(0.82, n) * smoothstep(0.22, 0.62, length(vd * vec2(uAspect, 1.0)) * 0.8);
        col += vec3(0.85, 0.95, 1.0) * line * uSpeedLines * 0.22;
      }

      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Colour grades (gain, lift, saturation). Phases 2-3 will add violet / crimson.
const GRADES = {
  phase1: { gain: [1.04, 1.0, 0.94], lift: [0.0, 0.0, 0.01], sat: 1.05 },
  title: { gain: [1.0, 0.98, 1.02], lift: [0.0, 0.0, 0.0], sat: 1.0 },
  break: { gain: [1.04, 1.02, 1.0], lift: [0.0, 0.0, 0.01], sat: 0.8 },
  clear: { gain: [1.06, 1.0, 0.9], lift: [0.0, 0.0, 0.0], sat: 1.1 },
  dead: { gain: [1.0, 0.75, 0.78], lift: [0.03, 0.0, 0.0], sat: 0.35 },
};

const _p = new THREE.Vector3();

// Rendering pipeline.
//   HIGH:   bloom + shadows + screen effects, pixel ratio up to 2
//   MEDIUM: bloom + screen effects, no shadows, pixel ratio up to 1.5 (mobile default)
//   LOW:    direct render, pixel ratio 1 (no screen-space effects)
export class Post {
  constructor(renderer, scene, camera, world) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.3, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    // After OutputPass so it works on display colours.
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.aberration = 0;
    this.tint = 0;
    this.speed = 0;
    this.rays = 0;
    this.rayPos = null;
    this.shocks = [];
    this.grade = GRADES.title;
    this.intensity = 1; // "reduced effects" setting scales distortion and aberration
    this.quality = 'high';
  }

  setQuality(q) {
    this.quality = q;
    const r = this.renderer;
    const high = q === 'high';
    const maxRatio = { high: 2, medium: 1.5, low: 1 }[q] ?? 1;
    r.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
    r.shadowMap.enabled = high;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.world.lights.moon.castShadow = high;
    // Materials must recompile when shadows are toggled.
    this.scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
    });
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.final.uniforms.uAspect.value = w / h;
  }

  // Kick of chromatic aberration on a heavy hit (decays on its own).
  pulse(amount) { this.aberration = Math.min(1.5, this.aberration + amount * this.intensity); }

  // 0..1 blue tint while perfect-dodge slow-mo is active.
  setTint(amount) { this.tint = amount; }

  // 0..1 radial blur + speed lines.
  setSpeed(amount) { this.speed = amount; }

  // World-space light source for god rays (or null) and its strength.
  setGodRays(pos, strength) { this.rayPos = pos; this.rays = strength; }

  setGrade(name) { this.grade = GRADES[name] || GRADES.phase1; }

  // Screen-space distortion ring anchored to a world position.
  shockwave(pos, { strength = 1, speed = 0.9, life = 0.6 } = {}) {
    if (this.shocks.length >= MAX_SHOCKS) this.shocks.shift();
    this.shocks.push({ pos: pos.clone(), strength: strength * this.intensity, speed, life, t: 0 });
  }

  update(dt, time) {
    const u = this.final.uniforms;
    u.uTime.value = time;
    this.aberration = Math.max(0, this.aberration - dt * 3);
    u.uAberration.value = this.aberration;
    const k = Math.min(1, dt * 10);
    u.uTintAmount.value += (this.tint - u.uTintAmount.value) * k;
    u.uBlur.value += (this.speed * this.intensity - u.uBlur.value) * k;
    u.uSpeedLines.value = u.uBlur.value;

    const g = this.grade;
    const kg = Math.min(1, dt * 3);
    u.uGain.value.x += (g.gain[0] - u.uGain.value.x) * kg;
    u.uGain.value.y += (g.gain[1] - u.uGain.value.y) * kg;
    u.uGain.value.z += (g.gain[2] - u.uGain.value.z) * kg;
    u.uLift.value.x += (g.lift[0] - u.uLift.value.x) * kg;
    u.uLift.value.y += (g.lift[1] - u.uLift.value.y) * kg;
    u.uLift.value.z += (g.lift[2] - u.uLift.value.z) * kg;
    u.uSaturation.value += (g.sat - u.uSaturation.value) * kg;

    // God rays fade out as the light leaves the screen or goes behind the camera.
    let ray = 0;
    if (this.rayPos && this.rays > 0) {
      _p.copy(this.rayPos).project(this.camera);
      if (_p.z < 1) {
        const sx = _p.x * 0.5 + 0.5;
        const sy = _p.y * 0.5 + 0.5;
        u.uRayPos.value.set(sx, sy);
        const off = Math.max(Math.abs(_p.x), Math.abs(_p.y));
        ray = this.rays * THREE.MathUtils.clamp(1.6 - off, 0, 1);
      }
    }
    u.uRayStrength.value += (ray - u.uRayStrength.value) * k;

    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.t += dt;
      if (s.t >= s.life) this.shocks.splice(i, 1);
    }
    for (let i = 0; i < MAX_SHOCKS; i++) {
      const v = u.uShocks.value[i];
      const s = this.shocks[i];
      if (!s) { v.w = 0; continue; }
      _p.copy(s.pos).project(this.camera);
      if (_p.z >= 1) { v.w = 0; continue; }
      const kk = s.t / s.life;
      v.set(_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5, s.t * s.speed, s.strength * (1 - kk) ** 1.5);
    }
  }

  render() {
    if (this.quality !== 'low') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
