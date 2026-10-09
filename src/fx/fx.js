import * as THREE from 'three';

// Pooled visual effects: expanding rings, afterimages and spark bursts.
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.rings = new RingPool(scene, 24);
    this.sparks = new SparkPool(scene, 900);
    this.slashes = new SlashPool(scene, 8);
    this.rocks = new ShardPool(scene, 140, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }));
    this.crystals = new ShardPool(scene, 140, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scorches = new ScorchPool(scene, 90);
    this.ghosts = null; // created once the player model exists
  }

  initAfterimages(model) {
    this.ghosts = new AfterimagePool(this.scene, model, 14);
  }

  ring(pos, opts) { this.rings.spawn(pos, opts); }
  burst(pos, opts) { this.sparks.burst(pos, opts); }
  afterimage(opts) { this.ghosts?.spawn(opts); }
  slash(pos, forward, opts) { this.slashes.spawn(pos, forward, opts); }
  converge(pos, opts) { this.sparks.converge(pos, opts); }
  // Flying debris. glow: additive crystal shards (use colours > 1 to bloom); otherwise rock chunks.
  shards(pos, opts = {}) { (opts.glow ? this.crystals : this.rocks).burst(pos, opts); }
  scorch(pos, opts) { this.scorches.spawn(pos, opts); }

  update(dt) {
    this.slashes.update(dt);
    this.rocks.update(dt);
    this.crystals.update(dt);
    this.scorches.update(dt);
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

  // Particles that start on a sphere and stream into its centre (charge-up effect).
  converge(center, { count = 20, radius = 6, color = 0xffa040, life = 0.5, size = 0.4 } = {}) {
    this.color.set(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      let x = Math.random() * 2 - 1;
      let y = Math.random() * 2 - 1;
      let z = Math.random() * 2 - 1;
      const len = Math.hypot(x, y, z) || 1;
      x /= len; y /= len; z /= len;
      const r = radius * (0.7 + Math.random() * 0.3);
      const l = life * (0.7 + Math.random() * 0.3);
      this.pos.set([center.x + x * r, center.y + y * r, center.z + z * r], i * 3);
      this.vel.set([(-x * r) / l, (-y * r) / l, (-z * r) / l], i * 3);
      this.col.set([this.color.r, this.color.g, this.color.b], i * 3);
      this.life[i] = l;
      this.age[i] = 0;
      this.baseSize[i] = size * (0.6 + Math.random() * 0.8);
      this.drag[i] = 0;
      this.grav[i] = 0;
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

// True when the object and all its ancestors are visible.
function isShown(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
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
      m.visible = isShown(this.sources[i]);
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

// Sword slash arcs: a ring sector swept by a bright head with a fading tail.
const SLASH_VERT = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const SLASH_FRAG = /* glsl */ `
  uniform float uProgress;
  uniform float uFade;
  uniform float uThetaStart;
  uniform float uThetaLen;
  uniform float uInner;
  uniform float uOuter;
  uniform float uFlip;
  uniform vec3 uColor;
  varying vec2 vLocal;
  void main() {
    float a = atan(vLocal.y, vLocal.x);
    float u = clamp((a - uThetaStart) / uThetaLen, 0.0, 1.0);
    if (uFlip > 0.5) u = 1.0 - u;
    float r = (length(vLocal) - uInner) / (uOuter - uInner);
    float head = uProgress * 1.25;
    float tail = smoothstep(head - 0.75, head, u) * step(u, head);
    float edge = pow(clamp(r, 0.0, 1.0), 2.5);
    float alpha = tail * (0.25 + edge * 1.4) * uFade;
    vec3 col = mix(uColor, vec3(1.0), edge * 0.8) * (1.2 + edge * 2.5);
    gl_FragColor = vec4(col, alpha);
  }`;

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

class SlashPool {
  constructor(scene, n) {
    this.items = [];
    const thetaLen = Math.PI * 1.15;
    const thetaStart = Math.PI / 2 - thetaLen / 2;
    for (let i = 0; i < n; i++) {
      const inner = 0.5;
      const outer = 1;
      const geo = new THREE.RingGeometry(inner, outer, 40, 1, thetaStart, thetaLen);
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: SLASH_VERT,
        fragmentShader: SLASH_FRAG,
        uniforms: {
          uProgress: { value: 0 },
          uFade: { value: 1 },
          uThetaStart: { value: thetaStart },
          uThetaLen: { value: thetaLen },
          uInner: { value: inner },
          uOuter: { value: outer },
          uFlip: { value: 0 },
          uColor: { value: new THREE.Color(0x46e6ff) },
        },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, t: 0, life: 0.25, sweep: 0.1 });
    }
    this.next = 0;
  }

  // forward: swing direction; roll rotates the arc plane around it (0 = horizontal).
  spawn(pos, forward, { roll = 0, flip = false, radius = 2.2, color = 0x46e6ff, sweep = 0.09, life = 0.26 } = {}) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    _y.copy(forward).normalize();
    _x.set(0, 1, 0).cross(_y);
    if (_x.lengthSq() < 1e-4) _x.set(1, 0, 0);
    _x.normalize();
    _z.crossVectors(_x, _y).normalize(); // arc plane normal
    // Rotate the arc's spread axis (x) toward z by roll.
    _x.multiplyScalar(Math.cos(roll)).addScaledVector(_z, Math.sin(roll)).normalize();
    _z.crossVectors(_x, _y).normalize();
    _m.makeBasis(_x, _y, _z);
    it.mesh.quaternion.setFromRotationMatrix(_m);
    it.mesh.position.copy(pos);
    it.mesh.scale.setScalar(radius);
    const u = it.mesh.material.uniforms;
    u.uFlip.value = flip ? 1 : 0;
    u.uColor.value.set(color);
    u.uProgress.value = 0;
    u.uFade.value = 1;
    it.mesh.visible = true;
    Object.assign(it, { t: 0, life, sweep });
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.t += dt;
      const u = it.mesh.material.uniforms;
      u.uProgress.value = Math.min(1, it.t / it.sweep);
      u.uFade.value = 1 - Math.max(0, (it.t - it.sweep) / (it.life - it.sweep));
      if (it.t >= it.life) it.mesh.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Tumbling debris (one instanced draw call per pool).
const _o = new THREE.Object3D();
const _col = new THREE.Color();

class ShardPool {
  constructor(scene, n, material) {
    const geo = new THREE.TetrahedronGeometry(0.5, 0);
    geo.scale(1, 1.8, 0.6);
    this.mesh = new THREE.InstancedMesh(geo, material, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = n;
    for (let i = 0; i < n; i++) {
      _o.scale.setScalar(0);
      _o.updateMatrix();
      this.mesh.setMatrixAt(i, _o.matrix);
      this.mesh.setColorAt(i, _col.set(0xffffff));
    }
    scene.add(this.mesh);
    this.n = n;
    this.items = Array.from({ length: n }, () => ({
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(),
      t: 0, life: 0, size: 1, alive: false, color: new THREE.Color(),
    }));
    this.next = 0;
  }

  burst(origin, { count = 12, color = 0x8a7f9a, speed = 14, size = 1, life = 1.4, gravity = 30, up = 0.6 } = {}) {
    for (let k = 0; k < count; k++) {
      const it = this.items[this.next];
      this.next = (this.next + 1) % this.n;
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 2 - 1 + up;
      it.pos.copy(origin);
      it.vel.set(Math.cos(a), e, Math.sin(a)).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      it.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      it.spin.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
      it.t = 0;
      it.life = life * (0.6 + Math.random() * 0.4);
      it.size = size * (0.4 + Math.random() * 0.9);
      it.gravity = gravity;
      it.alive = true;
      it.color.set(color);
    }
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      if (!it.alive) continue;
      any = true;
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        it.alive = false;
        _o.scale.setScalar(0);
      } else {
        it.vel.y -= it.gravity * dt;
        it.pos.addScaledVector(it.vel, dt);
        it.rot.x += it.spin.x * dt;
        it.rot.y += it.spin.y * dt;
        it.rot.z += it.spin.z * dt;
        _o.position.copy(it.pos);
        _o.rotation.copy(it.rot);
        _o.scale.setScalar(it.size * (k > 0.7 ? (1 - k) / 0.3 : 1));
      }
      _o.updateMatrix();
      this.mesh.setMatrixAt(i, _o.matrix);
      this.mesh.setColorAt(i, it.color);
    }
    if (any || this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    this.dirty = any;
  }
}

// ---------------------------------------------------------------------------
// Glowing scorch marks left on platforms by the laser. They cool from white-hot to dark.
class ScorchPool {
  constructor(scene, n) {
    const geo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    for (let i = 0; i < n; i++) {
      _o.scale.setScalar(0);
      _o.updateMatrix();
      this.mesh.setMatrixAt(i, _o.matrix);
      this.mesh.setColorAt(i, _col.set(0x000000));
    }
    scene.add(this.mesh);
    this.n = n;
    this.items = Array.from({ length: n }, () => ({ pos: new THREE.Vector3(), t: 0, life: 0, size: 1, alive: false }));
    this.next = 0;
  }

  spawn(pos, { size = 0.9, life = 2.6 } = {}) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.n;
    it.pos.copy(pos);
    it.t = 0;
    it.life = life;
    it.size = size * (0.8 + Math.random() * 0.4);
    it.rot = Math.random() * Math.PI;
    it.alive = true;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      if (!it.alive) continue;
      any = true;
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        it.alive = false;
        _o.scale.setScalar(0);
        _col.setRGB(0, 0, 0);
      } else {
        _o.position.copy(it.pos);
        _o.rotation.set(0, it.rot, 0);
        _o.scale.set(it.size, 1, it.size * 0.7);
        // White-hot -> orange -> dim red ember.
        const heat = (1 - k) ** 2;
        _col.setRGB(1.6 * heat + 0.25 * (1 - k), 0.9 * heat * heat + 0.05 * (1 - k), 0.5 * heat ** 3);
      }
      _o.updateMatrix();
      this.mesh.setMatrixAt(i, _o.matrix);
      this.mesh.setColorAt(i, _col);
    }
    if (any || this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
    this.dirty = any;
  }
}
