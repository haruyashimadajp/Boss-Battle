import * as THREE from 'three';

// Pooled visual effects: expanding rings, afterimages and spark bursts.
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.rings = new RingPool(scene, 24);
    this.sparks = new SparkPool(scene, 600);
    this.ghosts = null; // created once the player model exists
  }

  initAfterimages(model) {
    this.ghosts = new AfterimagePool(this.scene, model, 14);
  }

  ring(pos, opts) { this.rings.spawn(pos, opts); }
  burst(pos, opts) { this.sparks.burst(pos, opts); }
  afterimage(opts) { this.ghosts?.spawn(opts); }

  update(dt) {
    this.rings.update(dt);
    this.sparks.update(dt);
    this.ghosts?.update(dt);
  }
}

const _v = new THREE.Vector3();

class RingPool {
  constructor(scene, n) {
    const geo = new THREE.RingGeometry(0.82, 1, 64);
    this.items = [];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, t: 0, life: 1, s0: 1, s1: 2, alpha: 1 });
    }
    this.next = 0;
  }

  // normal: direction the ring faces (default up = ground ring).
  spawn(pos, { color = 0x46e6ff, from = 0.3, to = 3, life = 0.4, normal = null, alpha = 1 } = {}) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.mesh.position.copy(pos);
    _v.copy(pos).add(normal || THREE.Object3D.DEFAULT_UP);
    it.mesh.lookAt(_v);
    it.mesh.material.color.set(color);
    it.mesh.visible = true;
    Object.assign(it, { t: 0, life, s0: from, s1: to, alpha });
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) { it.mesh.visible = false; continue; }
      const e = 1 - (1 - k) ** 3;
      it.mesh.scale.setScalar(it.s0 + (it.s1 - it.s0) * e);
      it.mesh.material.opacity = it.alpha * (1 - k) ** 1.5;
    }
  }
}

class SparkPool {
  constructor(scene, n) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.age = new Float32Array(n).fill(1);
    this.baseSize = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.next = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * (220.0 / max(-mv.z, 0.1));
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * (1.0 + a * 1.5), a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.color = new THREE.Color();
  }

  burst(origin, {
    count = 20, color = 0x46e6ff, speed = 8, spread = 1, dir = null, life = 0.5, size = 0.35, gravity = 0, drag = 3, flat = false,
  } = {}) {
    this.color.set(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      let x = Math.random() * 2 - 1;
      let y = flat ? Math.random() * 0.3 : Math.random() * 2 - 1;
      let z = Math.random() * 2 - 1;
      const len = Math.hypot(x, y, z) || 1;
      x /= len; y /= len; z /= len;
      if (dir) {
        x = dir.x + x * spread; y = dir.y + y * spread; z = dir.z + z * spread;
      }
      const s = speed * (0.4 + Math.random() * 0.6);
      this.pos.set([origin.x, origin.y, origin.z], i * 3);
      this.vel.set([x * s, y * s, z * s], i * 3);
      this.col.set([this.color.r, this.color.g, this.color.b], i * 3);
      this.life[i] = life * (0.6 + Math.random() * 0.4);
      this.age[i] = 0;
      this.baseSize[i] = size * (0.6 + Math.random() * 0.8);
      this.drag[i] = drag;
      this.grav[i] = gravity;
    }
  }

  update(dt) {
    const { pos, vel, age, life, size, alpha } = this;
    for (let i = 0; i < this.n; i++) {
      if (age[i] >= life[i]) { alpha[i] = 0; size[i] = 0; continue; }
      age[i] += dt;
      const k = Math.min(1, age[i] / life[i]);
      const damp = Math.exp(-this.drag[i] * dt);
      vel[i * 3] *= damp;
      vel[i * 3 + 1] = vel[i * 3 + 1] * damp - this.grav[i] * dt;
      vel[i * 3 + 2] *= damp;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      alpha[i] = 1 - k;
      size[i] = this.baseSize[i] * (1 - k * 0.6);
    }
    for (const name of ['position', 'size', 'alpha', 'color']) this.geo.attributes[name].needsUpdate = true;
  }
}

// Ghost copies of the player model that fade out (dash / grapple trails).
class AfterimagePool {
  constructor(scene, model, n) {
    this.sources = [];
    model.traverse((o) => { if (o.isMesh) this.sources.push(o); });
    this.items = [];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x46e6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const meshes = this.sources.map((src) => {
        const m = new THREE.Mesh(src.geometry, mat);
        m.matrixAutoUpdate = false;
        m.visible = false;
        m.frustumCulled = false;
        scene.add(m);
        return m;
      });
      this.items.push({ meshes, mat, t: 0, life: 0.3, alpha: 0.5, alive: false });
    }
    this.next = 0;
  }

  spawn({ color = 0x46e6ff, life = 0.3, alpha = 0.55 } = {}) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.meshes.forEach((m, i) => {
      m.matrix.copy(this.sources[i].matrixWorld);
      m.matrixWorldNeedsUpdate = true;
      m.visible = this.sources[i].visible;
    });
    it.mat.color.set(color);
    Object.assign(it, { t: 0, life, alpha, alive: true });
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.alive) continue;
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        it.alive = false;
        it.meshes.forEach((m) => { m.visible = false; });
        continue;
      }
      it.mat.opacity = it.alpha * (1 - k);
    }
  }
}
