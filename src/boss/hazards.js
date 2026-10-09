import * as THREE from 'three';
import { BOSS } from '../config.js';
import { groundHeightBelow } from '../world/collision.js';

// Boss attacks. Each hazard is created with a context:
//   ctx = { scene, fx, world, boss, player, hitPlayer(dmg, from, hazard) -> 'hit'|'perfect'|'ignored',
//           shake(a), onReflectHit(orb) }
// update(dt) returns false once the hazard has finished; cancel() removes it early.

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _end = new THREE.Vector3();

const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true).translate(0, 0.5, 0);
const additive = (color, opacity = 1, extra = {}) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, ...extra,
});

// Returns the platform collider containing p, or null.
function pointInPlatform(p, colliders) {
  for (const c of colliders) {
    if (c.type !== 'cyl') continue;
    if (p.y < c.yMin || p.y > c.yMax) continue;
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    if (dx * dx + dz * dz < c.r * c.r) return c;
  }
  return null;
}

// Energy beam: brightest where the surface faces the camera, with noise scrolling along it.
function beamMaterial(color, intensity, power) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uLen: { value: 1 },
      uIntensity: { value: intensity },
      uPower: { value: power },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uLen;
      uniform float uIntensity;
      uniform float uPower;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float body = pow(facing, uPower);
        float along = vUv.y * uLen;
        float n = noise(vec2(vUv.x * 8.0, along * 0.35 - uTime * 16.0));
        float n2 = noise(vec2(vUv.x * 3.0 + 5.0, along * 0.12 - uTime * 6.0));
        float a = body * (0.5 + 0.5 * n) * (0.65 + 0.35 * n2);
        a *= smoothstep(0.0, 0.04, vUv.y);
        gl_FragColor = vec4(uColor * uIntensity * (0.8 + n * 0.7), a);
      }`,
  });
}

function distToSegment(p, a, b) {
  _seg.subVectors(b, a);
  const len2 = _seg.lengthSq();
  const t = len2 > 0 ? THREE.MathUtils.clamp(_q.subVectors(p, a).dot(_seg) / len2, 0, 1) : 0;
  return _q.copy(a).addScaledVector(_seg, t).distanceTo(p);
}

// Shortest distance from a beam segment to the player's body (sampled at feet, chest and head).
function beamToPlayer(player, a, b) {
  let d = Infinity;
  for (const h of [0.3, 0.95, 1.6]) {
    _p.set(player.pos.x, player.pos.y + h, player.pos.z);
    d = Math.min(d, distToSegment(_p, a, b));
  }
  return d;
}

class Hazard {
  constructor(ctx) {
    this.ctx = ctx;
    this.t = 0;
    this.meshes = [];
    this.hitCool = 0;
  }

  add(mesh) {
    mesh.frustumCulled = false;
    this.ctx.scene.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  // One hit per contact: after touching the player (hit or dodge) the hazard ignores them briefly.
  tryHit(dmg, from, cool = 0.6) {
    if (this.hitCool > 0) return null;
    const r = this.ctx.hitPlayer(dmg, from, this);
    if (r !== 'ignored') this.hitCool = cool;
    return r;
  }

  tick(dt) {
    this.t += dt;
    this.hitCool = Math.max(0, this.hitCool - dt);
  }

  cancel() {
    for (const m of this.meshes) {
      this.ctx.scene.remove(m);
      m.traverse((o) => o.material?.dispose?.());
    }
    this.meshes.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Laser sweep: a beam from the core aimed at the player's height, swept sideways.
// Dodge by jumping over it, moving in/out so it passes above/below, or dashing through.
export class LaserSweep extends Hazard {
  constructor(ctx) {
    super(ctx);
    this.telegraph = 1.0;
    this.sweep = 1.7;
    this.tail = 0.35;
    this.sign = Math.random() < 0.5 ? 1 : -1;
    this.arc = 1.25;
    this.origin = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.end = new THREE.Vector3();
    this.aim();

    this.aimLine = this.add(new THREE.Mesh(beamGeo, additive(0xff4060, 0.7)));
    this.charge = this.add(new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), additive(0xff6040, 0.8)));
    this.beam = this.add(new THREE.Group());
    this.beamCore = new THREE.Mesh(beamGeo, beamMaterial(0xfff2e0, 2.6, 0.4));
    this.beamGlow = new THREE.Mesh(beamGeo, beamMaterial(0xff5a3c, 1.7, 1.6));
    this.beamOuter = new THREE.Mesh(beamGeo, beamMaterial(0xff2d55, 0.9, 3.0));
    this.beamParts = [this.beamCore, this.beamGlow, this.beamOuter];
    this.lastScorch = new THREE.Vector3(1e9, 0, 0);
    this.hitCol = null;
    this.beam.add(this.beamCore, this.beamGlow, this.beamOuter);
    for (const m of this.beam.children) m.frustumCulled = false;
    this.beam.visible = false;
  }

  aim() {
    const { boss, player } = this.ctx;
    boss.getCorePos(this.origin);
    _a.copy(player.pos);
    _a.y += 1.0;
    const dx = _a.x - this.origin.x;
    const dz = _a.z - this.origin.z;
    this.yaw0 = Math.atan2(dx, dz);
    this.pitch = Math.atan2(_a.y - this.origin.y, Math.hypot(dx, dz));
  }

  dirAt(yaw, out) {
    const cp = Math.cos(this.pitch);
    return out.set(cp * Math.sin(yaw), Math.sin(this.pitch), cp * Math.cos(yaw));
  }

  placeBeam(obj, len) {
    obj.position.copy(this.origin);
    obj.quaternion.setFromUnitVectors(UP, this.dir);
    obj.scale.set(1, len, 1);
  }

  // March along the beam until it hits a platform.
  measure() {
    const cols = this.ctx.world.colliders;
    for (let d = 7; d < 120; d += 1.5) {
      this.end.copy(this.origin).addScaledVector(this.dir, d);
      this.hitCol = pointInPlatform(this.end, cols);
      if (this.hitCol) return d;
    }
    return 120;
  }

  update(dt) {
    this.tick(dt);
    const { boss, fx } = this.ctx;
    boss.getCorePos(this.origin);
    const t = this.t;
    const startYaw = this.yaw0 - this.sign * this.arc;

    if (t < this.telegraph) {
      // Track the player for the first part of the wind-up, then lock in.
      if (t < this.telegraph * 0.6) this.aim();
      this.dirAt(this.yaw0 - this.sign * this.arc, this.dir);
      const len = this.measure();
      this.placeBeam(this.aimLine, len);
      const w = 0.05 + 0.08 * Math.abs(Math.sin(t * 40));
      this.aimLine.scale.x = this.aimLine.scale.z = w;
      const k = t / this.telegraph;
      this.charge.position.copy(this.origin).addScaledVector(this.dir, 6.5);
      this.charge.scale.setScalar(0.3 + k * 2.2 + Math.sin(t * 50) * 0.15);
      fx.converge(this.charge.position, { count: 3, radius: 7, color: 0xff7a4a, life: 0.35, size: 0.45 });
      return true;
    }

    const st = t - this.telegraph;
    if (st < this.sweep + this.tail) {
      if (!this.beam.visible) {
        this.beam.visible = true;
        this.aimLine.visible = false;
        this.ctx.shake(0.25);
        this.ctx.shockwave?.(this.charge.position, { strength: 0.7, speed: 0.8, life: 0.5 });
        fx.ring(this.charge.position, { color: 0xffd0a0, from: 1, to: 8, life: 0.35, normal: this.dir });
      }
      const k = Math.min(1, st / this.sweep);
      const e = k * k * (3 - 2 * k);
      this.dirAt(startYaw + this.sign * this.arc * 2 * e, this.dir);
      const len = this.measure();
      const fade = st > this.sweep ? 1 - (st - this.sweep) / this.tail : 1;
      const flick = 1 + Math.sin(t * 60) * 0.12;
      this.placeBeam(this.beam, len);
      this.beamCore.scale.set(0.35 * fade * flick, 1, 0.35 * fade * flick);
      this.beamGlow.scale.set(1.0 * fade * flick, 1, 1.0 * fade * flick);
      this.beamOuter.scale.set(2.2 * fade, 1, 2.2 * fade);
      for (const m of this.beamParts) {
        m.material.uniforms.uTime.value = t;
        m.material.uniforms.uLen.value = len;
      }
      this.charge.position.copy(this.origin).addScaledVector(this.dir, 6.5);
      this.charge.scale.setScalar(2.6 * fade * flick);

      if (len < 120) {
        fx.burst(this.end, { count: 4, color: 0xffa060, speed: 14, life: 0.4, size: 0.45, gravity: 20 });
        // Burn a glowing trail across the platform tops.
        const c = this.hitCol;
        if (c && this.end.y > c.yMax - 1.2 && this.end.distanceTo(this.lastScorch) > 0.7) {
          _p.set(this.end.x, c.yMax + 0.04, this.end.z);
          fx.scorch(_p);
          this.lastScorch.copy(this.end);
        }
        if (Math.random() < 0.25) fx.ring(this.end, { color: 0xff6040, from: 0.5, to: 3, life: 0.3, alpha: 0.6 });
      }
      if (fade > 0.4) {
        _end.copy(this.origin).addScaledVector(this.dir, len);
        if (beamToPlayer(this.ctx.player, this.origin, _end) < 1.2) this.tryHit(BOSS.dmg.laser, this.origin);
      }
      return true;
    }
    this.cancel();
    return false;
  }
}

// ---------------------------------------------------------------------------
// Homing orb volley. Orbs can be slashed to send them back into the core.
let orbId = 0;
const orbGeo = new THREE.IcosahedronGeometry(0.7, 2);
const orbGlowGeo = new THREE.SphereGeometry(1.6, 16, 12);
// Colour values above 1 so the orbs catch the bloom.
const ORB_HOT = new THREE.Color(4, 0.7, 1.6);
const ORB_REFLECT = new THREE.Color(0.8, 3, 4);

export class OrbVolley extends Hazard {
  constructor(ctx, count = 10) {
    super(ctx);
    this.orbs = [];
    this.count = count;
    this.spawned = 0;
    this.spawnT = 0;
    this.base = Math.random() * Math.PI * 2;
    ctx.boss.getCorePos(_a);
    ctx.fx.converge(_a, { count: 50, radius: 14, color: 0xff4a7a, life: 0.45, size: 0.6 });
  }

  spawnOrb() {
    const { boss } = this.ctx;
    boss.getCorePos(_a);
    const i = this.spawned++;
    const ang = this.base + (i / this.count) * Math.PI * 2;
    const pos = new THREE.Vector3(_a.x + Math.cos(ang) * 9, _a.y + Math.sin(ang * 2) * 2.5, _a.z + Math.sin(ang) * 9);
    const mat = new THREE.MeshBasicMaterial({ color: ORB_HOT });
    const mesh = this.add(new THREE.Mesh(orbGeo, mat));
    const glow = new THREE.Mesh(orbGlowGeo, additive(0xff2d6e, 0.45));
    glow.frustumCulled = false;
    mesh.add(glow);
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.01);
    this.orbs.push({
      id: `orb${orbId++}`, mesh, glow, pos, vel: new THREE.Vector3(),
      state: 'hover', t: 0, hoverFor: 0.7 + (this.count - i) * 0.04, trailT: 0, alive: true,
      reflect: null,
    });
    this.ctx.fx.ring(pos, { color: 0xff4a7a, from: 0.2, to: 2, life: 0.3 });
  }

  explode(o, color = 0xff4a7a, big = false) {
    o.alive = false;
    o.state = 'dead';
    o.mesh.visible = false;
    this.ctx.fx.burst(o.pos, { count: big ? 30 : 16, color, speed: big ? 16 : 9, life: 0.45, size: 0.4 });
    this.ctx.fx.ring(o.pos, { color, from: 0.3, to: big ? 4 : 2.4, life: 0.3, normal: this.ctx.camNormal });
  }

  // Sword-reflect: fly back into the core.
  reflectOrb(o) {
    if (o.state === 'reflected' || !o.alive) return;
    o.state = 'reflected';
    o.mesh.material.color.copy(ORB_REFLECT);
    o.glow.material.color.set(0x46e6ff);
    o.t = 0;
    this.ctx.fx.ring(o.pos, { color: 0x46e6ff, from: 0.3, to: 3, life: 0.3, normal: this.ctx.camNormal });
  }

  targets(out) {
    for (const o of this.orbs) {
      if (o.alive && o.state !== 'reflected') out.push({ id: o.id, pos: o.pos, r: 0.8, kind: 'orb', ref: o, hazard: this });
    }
  }

  update(dt) {
    this.tick(dt);
    const { player, fx, world, boss } = this.ctx;
    this.spawnT -= dt;
    while (this.spawned < this.count && this.spawnT <= 0) {
      this.spawnOrb();
      this.spawnT += 0.06;
    }

    let alive = this.spawned < this.count;
    for (const o of this.orbs) {
      if (!o.alive) continue;
      alive = true;
      o.t += dt;
      o.mesh.scale.setScalar(Math.min(1, o.mesh.scale.x + dt * 5));
      o.glow.scale.setScalar(1 + Math.sin(o.t * 20) * 0.15);

      if (o.state === 'hover') {
        o.pos.y += Math.sin(o.t * 6) * dt * 0.8;
        if (o.t >= o.hoverFor) {
          o.state = 'homing';
          o.t = 0;
          _a.copy(player.pos).y += 1;
          o.vel.subVectors(_a, o.pos).setLength(15);
        }
      } else if (o.state === 'homing') {
        _a.copy(player.pos).y += 1;
        _a.sub(o.pos).normalize();
        _b.copy(o.vel).normalize().lerp(_a, Math.min(1, 1.6 * dt)).normalize();
        o.vel.copy(_b).multiplyScalar(15);
        if (o.t > 6) this.explode(o);
      } else if (o.state === 'reflected') {
        boss.getCorePos(_a);
        o.vel.subVectors(_a, o.pos).setLength(34);
        if (o.pos.distanceTo(_a) < BOSS.coreRadius + 0.6) {
          this.explode(o, 0x46e6ff, true);
          this.ctx.onReflectHit(o);
          continue;
        }
      }
      o.pos.addScaledVector(o.vel, dt);
      o.mesh.position.copy(o.pos);

      o.trailT -= dt;
      if (o.trailT <= 0 && o.state !== 'hover') {
        o.trailT = 0.03;
        fx.burst(o.pos, { count: 1, color: o.state === 'reflected' ? 0x46e6ff : 0xff4a7a, speed: 1, life: 0.35, size: 0.5 });
      }

      if (o.state === 'homing') {
        _a.set(player.pos.x, player.pos.y + 0.95, player.pos.z);
        if (o.pos.distanceTo(_a) < 1.25) {
          const r = this.ctx.hitPlayer(BOSS.dmg.orb, o.pos, o);
          if (r !== 'ignored' && r !== 'perfect') { this.explode(o); continue; }
        }
        if (pointInPlatform(o.pos, world.colliders)) this.explode(o);
      }
    }
    if (!alive) this.cancel();
    return alive;
  }

  cancel() {
    for (const o of this.orbs) if (o.alive) { o.alive = false; this.ctx.fx.burst(o.pos, { count: 6, color: 0xff4a7a, speed: 4, life: 0.3 }); }
    super.cancel();
  }
}

// ---------------------------------------------------------------------------
// Wing slam: a giant blade falls on the player's spot, then a shockwave rolls outward.
// Get out of the circle, then jump the ring.
const slamBladeGeo = new THREE.ConeGeometry(2.4, 22, 4).rotateX(Math.PI).translate(0, 11, 0);
const discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
const ringGeo = new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);
const waveGeo = new THREE.TorusGeometry(1, 0.035, 8, 80).rotateX(Math.PI / 2);

export class WingSlam extends Hazard {
  constructor(ctx) {
    super(ctx);
    this.telegraph = 1.1;
    this.drop = 0.13;
    this.radius = 5;
    this.waveMax = 22;
    this.waveTime = 0.9;
    this.center = new THREE.Vector3();
    this.track();

    this.disc = this.add(new THREE.Mesh(discGeo, additive(0xff2d55, 0.12)));
    this.fill = this.add(new THREE.Mesh(discGeo, additive(0xff2d55, 0.25)));
    this.edge = this.add(new THREE.Mesh(ringGeo, additive(0xff4060, 0.9, { side: THREE.DoubleSide })));
    this.blade = this.add(new THREE.Mesh(slamBladeGeo, new THREE.MeshStandardMaterial({
      color: 0x1c1830, emissive: 0xff5a2a, emissiveIntensity: 1.2, metalness: 0.7, roughness: 0.3, flatShading: true, transparent: true,
    })));
    this.blade.scale.set(1, 1, 0.3);
    this.wave = this.add(new THREE.Mesh(waveGeo, additive(0xffb070, 1)));
    this.wave.visible = false;
    this.waveHit = false;
    this.place();
  }

  track() {
    const p = this.ctx.player.pos;
    const gy = groundHeightBelow(p.x, p.y + 0.5, p.z, this.ctx.world.colliders);
    this.center.set(p.x, gy > -Infinity ? gy : p.y, p.z);
  }

  place() {
    const c = this.center;
    for (const m of [this.disc, this.fill, this.edge]) m.position.set(c.x, c.y + 0.06, c.z);
    this.disc.scale.setScalar(this.radius);
    this.edge.scale.setScalar(this.radius);
  }

  update(dt) {
    this.tick(dt);
    const { player, fx } = this.ctx;
    const t = this.t;
    const c = this.center;

    if (t < this.telegraph) {
      if (t < this.telegraph * 0.55) { this.track(); this.place(); }
      const k = t / this.telegraph;
      this.fill.scale.setScalar(Math.max(0.01, this.radius * k));
      this.edge.material.opacity = 0.5 + 0.5 * Math.abs(Math.sin(t * 18));
      this.blade.position.set(c.x, c.y + 26 - k * 3, c.z);
      this.blade.rotation.y += dt * 2;
      this.blade.material.emissiveIntensity = 1 + k * 3;
      _a.copy(this.blade.position).y += 4;
      fx.converge(_a, { count: 2, radius: 6, color: 0xff7a3a, life: 0.3, size: 0.5 });
      return true;
    }

    const dt2 = t - this.telegraph;
    if (dt2 < this.drop) {
      this.blade.position.y = c.y + 23 - (dt2 / this.drop) * 23;
      return true;
    }

    if (!this.impacted) {
      this.impacted = true;
      this.blade.position.y = c.y;
      this.disc.visible = this.fill.visible = this.edge.visible = false;
      this.wave.visible = true;
      fx.burst(_a.copy(c).setY(c.y + 0.5), { count: 60, color: 0xffa060, speed: 22, flat: true, life: 0.6, size: 0.6, gravity: 10 });
      fx.burst(_a, { count: 24, color: 0xffffff, speed: 12, life: 0.35, size: 0.5 });
      fx.ring(_a.copy(c).setY(c.y + 0.15), { color: 0xfff0d0, from: 1, to: this.radius * 1.6, life: 0.35 });
      fx.shards(_a, { count: 28, color: 0x6a6080, speed: 16, size: 1.2, life: 1.6 });
      fx.shards(_a, { glow: true, count: 18, color: new THREE.Color(3, 1.2, 0.4), speed: 20, size: 0.6, life: 0.9 });
      _p.copy(c).setY(c.y + 0.05);
      fx.scorch(_p, { size: this.radius * 0.9, life: 3.5 });
      this.ctx.shockwave?.(_a, { strength: 1.3, speed: 0.9, life: 0.7 });
      const d = player.pos.distanceTo(c);
      this.ctx.shake(Math.max(0.15, 0.7 - d / 60));
      this.ctx.impactFlash?.(d);
      const hd = Math.hypot(player.pos.x - c.x, player.pos.z - c.z);
      const dy = player.pos.y - c.y;
      if (hd < this.radius + 0.4 && dy > -1 && dy < 5) this.tryHit(BOSS.dmg.slam, c);
    }

    const wt = dt2 - this.drop;
    if (wt < this.waveTime) {
      const k = wt / this.waveTime;
      const r = this.radius + (this.waveMax - this.radius) * (1 - (1 - k) ** 2);
      this.wave.position.set(c.x, c.y + 0.5, c.z);
      this.wave.scale.set(r, 1 + (1 - k) * 18, r);
      this.wave.material.opacity = 1 - k * 0.8;
      if (!this.waveHit) {
        const hd = Math.hypot(player.pos.x - c.x, player.pos.z - c.z);
        const dy = player.pos.y - c.y;
        if (Math.abs(hd - r) < 1.0 && dy > -0.5 && dy < 1.3) {
          if (this.tryHit(BOSS.dmg.shockwave, c, 0.2)) this.waveHit = true;
        }
      }
    } else {
      this.wave.visible = false;
    }

    // The blade lingers, then lifts away and fades.
    if (wt > 0.5) {
      const k = Math.min(1, (wt - 0.5) / 0.6);
      this.blade.position.y = c.y + k * 12;
      this.blade.material.opacity = 1 - k;
    }
    if (wt > 1.2) {
      this.cancel();
      return false;
    }
    return true;
  }
}
