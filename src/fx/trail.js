import * as THREE from 'three';

// Ribbon that follows the sword blade (base -> tip) and fades with age.
// Each frame the blade pushes a new pair of points; old pairs shrink out of the tail.
export class SwordTrail {
  constructor(scene, segments = 22) {
    this.n = segments;
    this.base = Array.from({ length: segments }, () => new THREE.Vector3());
    this.tip = Array.from({ length: segments }, () => new THREE.Vector3());
    this.age = new Float32Array(segments).fill(99);
    this.count = 0;

    const pos = new Float32Array(segments * 2 * 3);
    const fade = new Float32Array(segments * 2);
    const edge = new Float32Array(segments * 2);
    for (let i = 0; i < segments; i++) { edge[i * 2] = 0; edge[i * 2 + 1] = 1; }
    const index = [];
    for (let i = 0; i < segments - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('fade', new THREE.BufferAttribute(fade, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('edge', new THREE.BufferAttribute(edge, 1));
    g.setIndex(index);
    this.geo = g;

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0x46e6ff) } },
      vertexShader: /* glsl */ `
        attribute float fade;
        attribute float edge;
        varying float vFade;
        varying float vEdge;
        void main() {
          vFade = fade;
          vEdge = edge;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vFade;
        varying float vEdge;
        void main() {
          // Brightest along the blade's edge (tip side), white-hot near the newest segment.
          float e = pow(vEdge, 1.8);
          vec3 col = mix(uColor, vec3(1.0), e * vFade * 0.8) * (1.0 + e * 2.0);
          gl_FragColor = vec4(col, vFade * (0.15 + e * 0.85));
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.life = 0.16;
  }

  setColor(hex) { this.material.uniforms.uColor.value.set(hex); }

  // active: push the current blade position; otherwise just let the tail fade.
  update(dt, active, base, tip) {
    for (let i = 0; i < this.n; i++) this.age[i] += dt;
    if (active) {
      // Shift everything back one slot, newest at index 0.
      for (let i = this.n - 1; i > 0; i--) {
        this.base[i].copy(this.base[i - 1]);
        this.tip[i].copy(this.tip[i - 1]);
        this.age[i] = this.age[i - 1];
      }
      this.base[0].copy(base);
      this.tip[0].copy(tip);
      this.age[0] = 0;
    }

    const pos = this.geo.attributes.position.array;
    const fade = this.geo.attributes.fade.array;
    let visible = false;
    for (let i = 0; i < this.n; i++) {
      const f = Math.max(0, 1 - this.age[i] / this.life);
      if (f > 0) visible = true;
      // Collapse dead segments onto the tip so they draw nothing.
      const b = f > 0 ? this.base[i] : this.tip[i];
      const t = this.tip[i];
      // The ribbon narrows toward the tail.
      pos[i * 6] = t.x + (b.x - t.x) * f;
      pos[i * 6 + 1] = t.y + (b.y - t.y) * f;
      pos[i * 6 + 2] = t.z + (b.z - t.z) * f;
      pos[i * 6 + 3] = t.x;
      pos[i * 6 + 4] = t.y;
      pos[i * 6 + 5] = t.z;
      fade[i * 2] = f;
      fade[i * 2 + 1] = f;
    }
    this.mesh.visible = visible;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.fade.needsUpdate = true;
  }
}
