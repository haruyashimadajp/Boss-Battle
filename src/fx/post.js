import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Hit feedback: radial chromatic aberration, colour tint (perfect-dodge slow-mo) and vignette.
const ImpactShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAberration: { value: 0 },
    uTint: { value: new THREE.Color(0x4fb8ff) },
    uTintAmount: { value: 0 },
    uVignette: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAberration;
    uniform vec3 uTint;
    uniform float uTintAmount;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      vec2 off = d * uAberration * 0.03;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, uTint * (lum * 1.4 + 0.05), uTintAmount * 0.55);
      float v = smoothstep(0.85, 0.2, length(d) * (1.0 + uTintAmount * 0.5));
      col *= mix(1.0, v, uVignette + uTintAmount * 0.4);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Rendering pipeline.
//   HIGH:   bloom + shadows, pixel ratio up to 2
//   MEDIUM: bloom, no shadows, pixel ratio up to 1.5 (mobile default)
//   LOW:    direct render, pixel ratio 1
export class Post {
  constructor(renderer, scene, camera, world) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.5, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    // After OutputPass so it works on display colours.
    this.impact = new ShaderPass(ImpactShader);
    this.composer.addPass(this.impact);
    this.aberration = 0;
    this.tint = 0;
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
  }

  // Kick of chromatic aberration on a heavy hit (decays on its own).
  pulse(amount) { this.aberration = Math.min(1.5, this.aberration + amount); }

  // 0..1 blue tint while perfect-dodge slow-mo is active.
  setTint(amount) { this.tint = amount; }

  update(dt) {
    this.aberration = Math.max(0, this.aberration - dt * 3);
    const u = this.impact.uniforms;
    u.uAberration.value = this.aberration;
    u.uTintAmount.value += (this.tint - u.uTintAmount.value) * Math.min(1, dt * 10);
  }

  render() {
    if (this.quality !== 'low') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
