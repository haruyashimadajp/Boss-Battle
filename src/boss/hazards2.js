import * as THREE from 'three';
import { Hazard, additive, beamGeo, beamMaterial, pointInPlatform, distToSegment } from './hazards.js';
import { addOutline } from '../fx/outline.js';

// Phase 2-3 attacks for Seraphina. Same contract as hazards.js:
// update(dt) returns false when finished, cancel() removes it, threats(out) feeds the HUD arrows.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const playerCenter = (player, out) => out.set(player.pos.x, player.pos.y + 1, player.pos.z);

// Platform whose top contains (x, z), or null.
function platformAt(world, x, z) {
  for (const p of world.platforms) {
    if (p.crumble) continue;
    const c = p.cols[0];
    if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return p;
  }
  return null;
}

// Ground warning decal: dark base, bright edge and a filling disc that shows the timing.
const discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
const edgeGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
function makeMarker(h, radius) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0x3a0008, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const fill = new THREE.Mesh(discGeo, additive(0xff2030, 0.4, { polygonOffset: true, polygonOffsetFactor: -3 }));
  const edge = new THREE.Mesh(edgeGeo, additive(0xff5060, 1, { side: THREE.DoubleSide }));
  base.scale.setScalar(radius);
  edge.scale.setScalar(radius);
  g.add(base, fill, edge);
  for (const m of g.children) m.frustumCulled = false;
  g.userData = { fill, edge, radius };
  return h.add(g);
}

// ---------------------------------------------------------------------------
// Halo blades: her halo splits into a ring of blades that spins outward at your height.
// Slip through a gap, jump over, or dash through.
const bladeGeo = new THREE.OctahedronGeometry(1, 0).scale(0.45, 0.22, 2.4);
export class HaloBlades extends Hazard {
  constructor(ctx, { count = 10, gaps = 2, speed = 15, spin = 0.6 } = {}) {
    super(ctx);
    this.telegraph = 1.0;
    this.speed = speed;
    this.spin = spin * (Math.random() < 0.5 ? 1 : -1);
    this.center = ctx.boss.getCorePos(new THREE.Vector3());
    this.y0 = ctx.player.pos.y + 1;
    this.rot = Math.random() * Math.PI * 2;
    const gapStart = Math.floor(Math.random() * count);
    this.blades = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a0a00, emissive: 0xff6a30, emissiveIntensity: 1.5, metalness: 0.6, roughness: 0.3 });
    for (let i = 0; i < count; i++) {
      if ((i - gapStart + count) % count < gaps) continue;
      const m = this.add(new THREE.Mesh(bladeGeo, mat));
      addOutline(m, { color: 0x140400, thickness: 0.004 });
      this.blades.push({ mesh: m, a: (i / count) * Math.PI * 2 });
    }
    this.halfWidth = 2.6;
    // Band showing the height the ring will sweep through.
    this.band = this.add(new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 96).rotateX(-Math.PI / 2), additive(0xff4050, 0.5, { side: THREE.DoubleSide })));
    ctx.boss.angel.halo.visible = false;
    ctx.boss.angel.setPose('cast');
    this.r = 3;
  }

  threats(out) { out.push({ pos: this.center, kind: 'laser' }); }

  update(dt) {
    this.tick(dt);
    const { player, fx } = this.ctx;
    const t = this.t;
    if (t < this.telegraph * 0.6) {
      this.ctx.boss.getCorePos(this.center);
      this.y0 = player.pos.y + 1;
    }
    this.rot += this.spin * dt * (t < this.telegraph ? 3 : 1);
    if (t >= this.telegraph) this.r += this.speed * dt;
    const r = this.r;
    for (const b of this.blades) {
      const a = b.a + this.rot;
      b.mesh.position.set(this.center.x + Math.sin(a) * r, this.y0, this.center.z + Math.cos(a) * r);
      b.mesh.rotation.set(0, a + Math.PI / 2, t * 8);
    }
    // Warning band at the player's distance and the ring's height.
    const pd = Math.hypot(player.pos.x - this.center.x, player.pos.z - this.center.z);
    this.band.position.set(this.center.x, this.y0, this.center.z);
    this.band.scale.setScalar(Math.max(r + 0.5, pd));
    this.band.material.opacity = (t < this.telegraph ? 0.25 : 0.4) + Math.sin(t * 14) * 0.15;
    if (t < this.telegraph && Math.random() < 0.5) fx.converge(this.center, { count: 2, radius: 5, color: 0xff8a4a, life: 0.3 });

    if (t >= this.telegraph) {
      playerCenter(player, _a);
      const dy = Math.abs(_a.y - this.y0);
      const d = Math.hypot(_a.x - this.center.x, _a.z - this.center.z);
      if (dy < 1.0 && Math.abs(d - r) < 0.9) {
        const ap = Math.atan2(_a.x - this.center.x, _a.z - this.center.z);
        for (const b of this.blades) {
          let da = ap - (b.a + this.rot);
          da = Math.atan2(Math.sin(da), Math.cos(da));
          if (Math.abs(da) < this.halfWidth / Math.max(r, 1) + 0.03) { this.tryHit(1, b.mesh.position); break; }
        }
      }
    }
    if (r > 58) {
      this.cancel();
      return false;
    }
    return true;
  }

  cancel() {
    this.ctx.boss.angel.halo.visible = true;
    this.ctx.boss.angel.setPose('idle');
    super.cancel();
  }
}

// ---------------------------------------------------------------------------
// Spiral barrage: rotating arms of light bullets, tilted so the spiral passes through you.
const bulletGeo = new THREE.IcosahedronGeometry(0.42, 1);
const bulletGlowGeo = new THREE.SphereGeometry(0.85, 10, 8);
const MAX_BULLETS = 240;
export class SpiralBarrage extends Hazard {
  constructor(ctx, { arms = 3, duration = 2.6, interval = 0.075, speed = 12, turn = 1.5 } = {}) {
    super(ctx);
    Object.assign(this, { arms, duration, interval, speed, turn });
    this.telegraph = 0.6;
    this.emitT = 0;
    this.base = Math.random() * Math.PI * 2;
    this.dirSign = Math.random() < 0.5 ? 1 : -1;
    this.bullets = [];
    this.outline = this.add(new THREE.InstancedMesh(bulletGeo, new THREE.MeshBasicMaterial({ color: 0x1a0006, side: THREE.BackSide }), MAX_BULLETS));
    this.core = this.add(new THREE.InstancedMesh(bulletGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.35, 0.7) }), MAX_BULLETS));
    this.glow = this.add(new THREE.InstancedMesh(bulletGlowGeo, additive(0xff2a6a, 0.35), MAX_BULLETS));
    for (const im of [this.outline, this.core, this.glow]) { im.count = 0; im.frustumCulled = false; }
    ctx.boss.angel.setPose('cast');
  }

  threats(out) {
    if (this.t < this.telegraph + this.duration) out.push({ pos: this.ctx.boss.getCorePos(_c), kind: 'orb' });
  }

  update(dt) {
    this.tick(dt);
    const { player, fx, boss, world } = this.ctx;
    const t = this.t;
    const origin = boss.getCorePos(_b);
    if (t < this.telegraph) {
      fx.converge(origin, { count: 3, radius: 6, color: 0xff4a8a, life: 0.3 });
    } else if (t < this.telegraph + this.duration) {
      this.emitT -= dt;
      while (this.emitT <= 0) {
        this.emitT += this.interval;
        const horiz = Math.hypot(player.pos.x - origin.x, player.pos.z - origin.z);
        const el = THREE.MathUtils.clamp(Math.atan2(player.pos.y + 1 - origin.y, Math.max(horiz, 1)), -0.7, 0.7);
        const st = t - this.telegraph;
        for (let i = 0; i < this.arms; i++) {
          if (this.bullets.length >= MAX_BULLETS) break;
          const a = this.base + this.dirSign * st * this.turn + (i / this.arms) * Math.PI * 2;
          const dir = new THREE.Vector3(Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a));
          this.bullets.push({ pos: origin.clone().addScaledVector(dir, 3), vel: dir.multiplyScalar(this.speed), life: 5 });
        }
      }
    } else if (this.bullets.length === 0) {
      this.cancel();
      return false;
    }

    playerCenter(player, _a);
    let n = 0;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.pos.addScaledVector(b.vel, dt);
      let dead = b.life <= 0 || pointInPlatform(b.pos, world.colliders);
      if (!dead && b.pos.distanceTo(_a) < 0.95) {
        const r = this.tryHit(1, b.pos, 0.5);
        if (r && r !== 'perfect') dead = true;
      }
      if (dead) {
        fx.burst(b.pos, { count: 3, color: 0xff4a8a, speed: 4, life: 0.25 });
        this.bullets.splice(i, 1);
      }
    }
    for (const b of this.bullets) {
      _m.compose(b.pos, _q.identity(), _s.setScalar(1));
      this.core.setMatrixAt(n, _m);
      this.glow.setMatrixAt(n, _m);
      _m.compose(b.pos, _q, _s.setScalar(1.3));
      this.outline.setMatrixAt(n, _m);
      n++;
    }
    for (const im of [this.outline, this.core, this.glow]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
    return true;
  }

  cancel() {
    this.ctx.boss.angel.setPose('idle');
    super.cancel();
  }
}

// ---------------------------------------------------------------------------
// Gravity well: a black star forms where you stand, drags you in, then bursts.
export class GravityWell extends Hazard {
  constructor(ctx) {
    super(ctx);
    this.form = 0.5;
    this.pull = 2.2;
    this.blast = 6.5;
    this.center = playerCenter(ctx.player, new THREE.Vector3());
    this.core = this.add(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0x000000 })));
    this.shell = this.add(new THREE.Mesh(new THREE.SphereGeometry(1.3, 24, 16), additive(0x9a4dff, 0.5)));
    this.disk = this.add(new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.14, 8, 64), additive(0xd8a8ff, 0.9)));
    this.zone = this.add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), additive(0xff3050, 0.07, { side: THREE.BackSide })));
    this.zoneRing = this.add(new THREE.Mesh(edgeGeo, additive(0xff4060, 0.9, { side: THREE.DoubleSide })));
    ctx.boss.angel.setPose('point');
  }

  threats(out) { out.push({ pos: this.center, kind: 'slam' }); }

  update(dt) {
    this.tick(dt);
    const { player, fx } = this.ctx;
    const t = this.t;
    if (t < 0.4) playerCenter(player, this.center);
    const k = Math.min(1, t / this.form);
    const c = this.center;
    for (const m of [this.core, this.shell, this.disk, this.zone, this.zoneRing]) m.position.copy(c);
    this.core.scale.setScalar(1.4 * k);
    this.shell.scale.setScalar(1.4 * k * (1 + Math.sin(t * 20) * 0.06));
    this.disk.scale.setScalar(k);
    this.disk.rotation.set(Math.PI / 2 + 0.4, t * 3, 0);
    this.zone.scale.setScalar(this.blast * k);
    this.zoneRing.scale.setScalar(this.blast * k);
    this.zoneRing.material.opacity = 0.5 + Math.sin(t * 16) * 0.4;

    if (t > this.form && t < this.form + this.pull) {
      fx.converge(c, { count: 3, radius: 9, color: 0xb98aff, life: 0.4, size: 0.5 });
      playerCenter(player, _a);
      const d = _a.distanceTo(c);
      if (d < 24 && d > 0.5) {
        // Drag toward the centre; stronger up close. Dash or grapple to escape.
        const pull = 4.5 + 7 * (1 - d / 24);
        _b.subVectors(c, _a).normalize();
        player.pos.addScaledVector(_b, pull * dt);
      }
      return true;
    }
    if (t >= this.form + this.pull && !this.exploded) {
      this.exploded = true;
      fx.ring(c, { color: 0xd8a8ff, from: 1, to: this.blast * 2.2, life: 0.45, normal: this.ctx.camNormal });
      fx.burst(c, { count: 60, color: 0xb98aff, speed: 22, life: 0.5, size: 0.55 });
      fx.shards(c, { glow: true, count: 24, color: new THREE.Color(1.6, 0.8, 3), speed: 20, size: 0.6, life: 0.9, up: 0 });
      this.ctx.shockwave?.(c, { strength: 1.4, speed: 0.9, life: 0.6 });
      this.ctx.shake(0.45);
      for (const m of [this.core, this.shell, this.disk, this.zone, this.zoneRing]) m.visible = false;
      if (playerCenter(player, _a).distanceTo(c) < this.blast + 0.4) this.tryHit(2, c);
    }
    if (t > this.form + this.pull + 0.4) {
      this.cancel();
      return false;
    }
    return true;
  }

  cancel() {
    this.ctx.boss.angel.setPose('idle');
    super.cancel();
  }
}

// ---------------------------------------------------------------------------
// Lance dash: she aims her staff and charges straight through your position.
export class LanceDash extends Hazard {
  constructor(ctx, { telegraph = 1.0, dash = 0.38 } = {}) {
    super(ctx);
    this.telegraph = telegraph;
    this.dash = dash;
    this.start = ctx.boss.angelPos.clone();
    this.end = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.aim();
    this.warn = this.add(new THREE.Mesh(beamGeo, additive(0xff2a40, 0.16)));
    this.warnCore = this.add(new THREE.Mesh(beamGeo, additive(0xff6070, 0.9)));
    this.prev = this.start.clone();
    ctx.boss.angel.setPose('lance');
  }

  aim() {
    playerCenter(this.ctx.player, _a);
    _a.y -= 1.0; // aim at chest height of the angel's body (her origin is her chest)
    this.dir.subVectors(_a, this.start).normalize();
    this.end.copy(_a).addScaledVector(this.dir, 12);
    const h = Math.hypot(this.end.x, this.end.z);
    if (h > 42) { this.end.x *= 42 / h; this.end.z *= 42 / h; }
    this.end.y = THREE.MathUtils.clamp(this.end.y, 6, 30);
    this.dir.subVectors(this.end, this.start).normalize();
  }

  threats(out) { if (this.t < this.telegraph) out.push({ pos: this.start, kind: 'laser' }); }

  update(dt) {
    this.tick(dt);
    const { boss, fx } = this.ctx;
    const t = this.t;
    if (t < this.telegraph) {
      if (t < this.telegraph * 0.7) this.aim();
      const len = this.start.distanceTo(this.end);
      for (const m of [this.warn, this.warnCore]) {
        m.position.copy(this.start);
        m.quaternion.setFromUnitVectors(UP, this.dir);
      }
      this.warn.scale.set(2.2, len, 2.2);
      this.warnCore.scale.set(0.12 + Math.abs(Math.sin(t * 25)) * 0.1, len, 0.12 + Math.abs(Math.sin(t * 25)) * 0.1);
      this.warn.material.opacity = 0.1 + Math.abs(Math.sin(t * 12)) * 0.12;
      // Wind up: lean back along the line.
      boss.angelPos.copy(this.start).addScaledVector(this.dir, -1.5 * (t / this.telegraph));
      return true;
    }
    const dt2 = t - this.telegraph;
    if (dt2 < this.dash) {
      this.warn.visible = this.warnCore.visible = false;
      const k = dt2 / this.dash;
      const e = k * k * (3 - 2 * k);
      this.prev.copy(boss.angelPos);
      boss.angelPos.lerpVectors(this.start, this.end, e);
      fx.burst(boss.angelPos, { count: 6, color: 0xffe0a0, speed: 6, life: 0.4, size: 0.6 });
      playerCenter(this.ctx.player, _a);
      if (distToSegment(_a, this.prev, boss.angelPos) < 2.6) this.tryHit(2, boss.angelPos);
      return true;
    }
    if (!this.landed) {
      this.landed = true;
      fx.ring(boss.angelPos, { color: 0xffe0a0, from: 1, to: 9, life: 0.4, normal: this.dir });
      this.ctx.shake(0.3);
      boss.home.copy(this.end);
    }
    if (dt2 > this.dash + 0.5) {
      this.cancel();
      return false;
    }
    return true;
  }

  cancel() {
    this.ctx.boss.angel.setPose('idle');
    super.cancel();
  }
}

// ---------------------------------------------------------------------------
// Meteor rain (Phase 3): marked impact zones, half of them around you.
const meteorGeo = new THREE.DodecahedronGeometry(1.1, 0);
export class MeteorRain extends Hazard {
  constructor(ctx, { count = 14, interval = 0.2, fall = 1.3 } = {}) {
    super(ctx);
    Object.assign(this, { count, interval, fall });
    this.spawned = 0;
    this.spawnT = 0;
    this.meteors = [];
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x2a1410, emissive: 0xff4a1a, emissiveIntensity: 1.2, flatShading: true });
    ctx.boss.angel.setPose('charge');
  }

  pickTarget() {
    const { player, world } = this.ctx;
    let p = null;
    let x = 0;
    let z = 0;
    if (this.spawned % 2 === 0) {
      x = player.pos.x + (Math.random() - 0.5) * 9;
      z = player.pos.z + (Math.random() - 0.5) * 9;
      p = platformAt(world, x, z) || platformAt(world, player.pos.x, player.pos.z);
      if (!p) return { p: null, off: null, pos: new THREE.Vector3(player.pos.x, player.pos.y, player.pos.z) };
    } else {
      const list = world.platforms.filter((q) => !q.crumble && q.r > 2);
      p = list[Math.floor(Math.random() * list.length)];
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * p.r * 0.7;
      x = p.group.position.x + Math.sin(a) * rr;
      z = p.group.position.z + Math.cos(a) * rr;
    }
    const gp = p.group.position;
    return { p, off: new THREE.Vector3(x - gp.x, 0, z - gp.z), pos: new THREE.Vector3(x, gp.y, z) };
  }

  threats(out) {
    for (const m of this.meteors) if (!m.done) out.push({ pos: m.target, kind: 'slam' });
  }

  update(dt) {
    this.tick(dt);
    const { player, fx } = this.ctx;
    this.spawnT -= dt;
    while (this.spawned < this.count && this.spawnT <= 0) {
      this.spawnT += this.interval;
      const tg = this.pickTarget();
      this.spawned++;
      const marker = makeMarker(this, 3.2);
      const rock = this.add(new THREE.Mesh(meteorGeo, this.rockMat));
      const glow = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 8), additive(0xff6020, 0.35));
      rock.add(glow);
      addOutline(rock, { color: 0x100400, thickness: 0.004, filter: (o) => o === rock });
      const from = new THREE.Vector3((Math.random() - 0.5) * 20, 50, (Math.random() - 0.5) * 20);
      this.meteors.push({ ...tg, target: tg.pos, marker, rock, from, t: 0, done: false });
    }

    let alive = this.spawned < this.count;
    for (const m of this.meteors) {
      if (m.done) continue;
      alive = true;
      m.t += dt;
      // Follow the platform as the arena orbits.
      if (m.p) m.target.set(m.p.group.position.x + m.off.x, m.p.group.position.y, m.p.group.position.z + m.off.z);
      const k = Math.min(1, m.t / this.fall);
      m.marker.position.set(m.target.x, m.target.y + 0.06, m.target.z);
      m.marker.userData.fill.scale.setScalar(Math.max(0.01, 3.2 * k));
      m.marker.userData.edge.material.opacity = 0.6 + Math.sin(m.t * 18) * 0.4;
      m.rock.position.copy(m.target).addScaledVector(m.from, 1 - k);
      m.rock.rotation.x += dt * 4;
      m.rock.rotation.y += dt * 3;
      fx.burst(m.rock.position, { count: 2, color: 0xff7a3a, speed: 3, life: 0.4, size: 0.7 });
      if (k >= 1) {
        m.done = true;
        m.marker.visible = false;
        m.rock.visible = false;
        _a.copy(m.target).y += 0.4;
        fx.ring(_a, { color: 0xffb070, from: 0.5, to: 7, life: 0.35 });
        fx.burst(_a, { count: 30, color: 0xff7a3a, speed: 16, flat: true, life: 0.5, size: 0.55, gravity: 10 });
        fx.shards(_a, { count: 10, color: 0x4a3030, speed: 12, size: 0.9, life: 1.2 });
        fx.scorch(_a.setY(m.target.y + 0.05), { size: 2.6, life: 3 });
        this.ctx.shockwave?.(m.target, { strength: 0.6, speed: 1.2, life: 0.35 });
        const d = player.pos.distanceTo(m.target);
        this.ctx.shake(Math.max(0.05, 0.35 - d / 80));
        const hd = Math.hypot(player.pos.x - m.target.x, player.pos.z - m.target.z);
        const dy = player.pos.y - m.target.y;
        if (hd < 3.4 && dy > -1 && dy < 4) this.tryHit(1, m.target, 0.3);
      }
    }
    if (!alive) {
      this.cancel();
      return false;
    }
    return true;
  }

  cancel() {
    this.ctx.boss.angel.setPose('idle');
    super.cancel();
  }
}

// ---------------------------------------------------------------------------
// Annihilation beam (Phase 3): a huge beam at your position after a long charge.
// Pillars and platforms block it: hide behind one, get out of the line, or perfect-dodge.
export class AnnihilationBeam extends Hazard {
  constructor(ctx) {
    super(ctx);
    this.telegraph = 2.4;
    this.fire = 1.5;
    this.radius = 4.5;
    this.origin = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.end = new THREE.Vector3();
    this.warn = this.add(new THREE.Mesh(beamGeo, additive(0xff2040, 0.1, { side: THREE.DoubleSide })));
    this.warnLine = this.add(new THREE.Mesh(beamGeo, additive(0xff5060, 0.9)));
    this.charge = this.add(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), additive(0xff6a80, 0.85)));
    this.beam = this.add(new THREE.Group());
    this.parts = [beamMaterial(0xfff2f0, 2.4, 0.4), beamMaterial(0xff3a5a, 1.8, 1.4), beamMaterial(0xff1040, 1.0, 3.0)]
      .map((m) => { const mesh = new THREE.Mesh(beamGeo, m); mesh.frustumCulled = false; this.beam.add(mesh); return mesh; });
    this.beam.visible = false;
    this.aim();
    ctx.boss.angel.setPose('charge');
    ctx.banner?.('!! TAKE COVER !!', 'bad', 1.6);
  }

  aim() {
    this.ctx.boss.getCorePos(this.origin);
    this.origin.y += 1.5;
    playerCenter(this.ctx.player, _a);
    this.dir.subVectors(_a, this.origin).normalize();
  }

  // March along the beam's centre line until it hits a platform or pillar.
  measure() {
    for (let d = 6; d < 140; d += 1) {
      this.end.copy(this.origin).addScaledVector(this.dir, d);
      if (pointInPlatform(this.end, this.ctx.world.colliders)) return d;
    }
    return 140;
  }

  threats(out) { out.push({ pos: this.origin, kind: 'laser' }); }

  place(obj, len, r) {
    obj.position.copy(this.origin);
    obj.quaternion.setFromUnitVectors(UP, this.dir);
    obj.scale.set(r, len, r);
  }

  update(dt) {
    this.tick(dt);
    const { player, fx } = this.ctx;
    const t = this.t;
    if (t < this.telegraph) {
      if (t < this.telegraph - 0.6) this.aim();
      const len = this.measure();
      this.place(this.warn, len, this.radius);
      this.place(this.warnLine, len, 0.15 + Math.abs(Math.sin(t * 30)) * 0.12);
      this.warn.material.opacity = 0.06 + Math.abs(Math.sin(t * 10)) * 0.1 * (t / this.telegraph);
      const k = t / this.telegraph;
      this.charge.position.copy(this.origin).addScaledVector(this.dir, 3);
      this.charge.scale.setScalar(0.5 + k * 3.2 + Math.sin(t * 40) * 0.2);
      fx.converge(this.charge.position, { count: 5, radius: 14, color: 0xff5a7a, life: 0.5, size: 0.7 });
      return true;
    }
    const ft = t - this.telegraph;
    if (ft < this.fire + 0.4) {
      if (!this.beam.visible) {
        this.beam.visible = true;
        this.warn.visible = this.warnLine.visible = false;
        this.ctx.shockwave?.(this.charge.position, { strength: 1.8, speed: 0.7, life: 0.8 });
        this.ctx.flash?.('#ffd0d8', 0.5);
      }
      const len = this.measure();
      const fade = ft > this.fire ? 1 - (ft - this.fire) / 0.4 : Math.min(1, ft / 0.1);
      const flick = 1 + Math.sin(t * 50) * 0.08;
      const radii = [1.6, 3.4, this.radius + 0.6];
      this.parts.forEach((m, i) => {
        this.place(m, len, radii[i] * fade * flick);
        m.material.uniforms.uTime.value = t;
        m.material.uniforms.uLen.value = len;
      });
      this.charge.scale.setScalar(3.6 * fade * flick);
      this.ctx.shake(0.12 * fade);
      fx.burst(this.end, { count: 6, color: 0xff7a5a, speed: 18, life: 0.4, size: 0.6, gravity: 15 });
      if (Math.random() < 0.4) fx.scorch(_b.copy(this.end), { size: 3, life: 3 });
      if (fade > 0.5) {
        // Hit if inside the beam's radius and not shielded (the beam stops at the first obstacle).
        playerCenter(player, _a);
        _b.subVectors(_a, this.origin);
        const along = _b.dot(this.dir);
        const perp = _b.addScaledVector(this.dir, -along).length();
        if (along > 0 && along < len + 1.2 && perp < this.radius) this.tryHit(3, this.origin, 0.8);
      }
      return true;
    }
    this.cancel();
    return false;
  }

  cancel() {
    this.ctx.boss.angel.setPose('idle');
    super.cancel();
  }
}

export { platformAt };
