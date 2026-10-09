import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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

  render() {
    if (this.quality !== 'low') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
