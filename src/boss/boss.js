import * as THREE from 'three';
import { BOSS } from '../config.js';
import { makeSphere } from '../world/collision.js';
import { LaserSweep, OrbVolley, WingSlam } from './hazards.js';
import { addOutline, addRim } from '../fx/outline.js';

// "Seraph of the Broken Sun": a floating core with a halo and four wings.
// Phase 1 (HALO): laser sweeps, homing orbs and wing slams. Four weak points on the wings.
//
// events: onBreak(), onBreakEnd(), onWeakDestroyed(wp), onPhaseClear(), onIntroDone()

const TAU = Math.PI * 2;
const WHITE = new THREE.Color(0xffffff);
const _v = new THREE.Vector3();

// "Eclipse" core: a dark sphere with a bright corona rim and slowly drifting glowing cracks.
// Reads as a solid shape instead of a white bloom blob. uHeat brightens it (broken / cleared).
function makeCoreMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x1c120c, metalness: 0.5, roughness: 0.4, emissive: 0xffa53a, emissiveIntensity: 1 });
  const uniforms = {
    uTime: { value: 0 },
    uHeat: { value: 0 },
    uFlash: { value: 0 },
    uRim: { value: new THREE.Color(1.0, 0.62, 0.24) },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uHeat;
        uniform float uFlash;
        uniform vec3 uRim;
        varying vec3 vObjPos;
        float h3(vec3 p) { return fract(sin(dot(p, vec3(17.1, 31.7, 11.3))) * 43758.5453); }
        float n3(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 sp = normalize(vObjPos) * 2.4;
        float n = n3(sp + vec3(0.0, uTime * 0.12, 0.0)) * 0.6 + n3(sp * 2.3 - vec3(uTime * 0.08)) * 0.4;
        float crack = 1.0 - smoothstep(0.0, 0.05 + uHeat * 0.05, abs(n - 0.5));
        float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.4);
        totalEmissiveRadiance = emissive * (crack * (0.9 + uHeat * 1.2) + uHeat * 0.35)
          + uRim * rim * (1.3 + uHeat)
          + vec3(1.0, 0.95, 0.85) * uFlash * 0.7;`);
  };
  m.customProgramCacheKey = () => 'eclipse-core';
  return m;
}

export class Boss {
  constructor(scene, world, fx, events) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.events = events;
    this.hazards = [];
    this.ctx = null; // hazard context, set by the game
    this.build();
    this.reset();
  }

  build() {
    const { scene, world } = this;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.body = new THREE.Group(); // turns to face the player
    this.root.add(this.body);

    this.coreMat = makeCoreMaterial();
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(BOSS.coreRadius, 3), this.coreMat);
    this.body.add(this.core);
    world.solids.push(this.core);
    this.collider = makeSphere(0, BOSS.hoverY, 0, BOSS.coreRadius);
    world.colliders.push(this.collider);

    this.shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(7.2, 1),
      new THREE.MeshBasicMaterial({ color: 0xffd38a, wireframe: true, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.body.add(this.shell);

    const haloTilt = new THREE.Group();
    haloTilt.rotation.set(0.32, 0, 0.12);
    this.root.add(haloTilt);
    this.halo = new THREE.Group();
    haloTilt.add(this.halo);
    const haloGeo = new THREE.TorusGeometry(12.5, 0.38, 10, 120).rotateX(Math.PI / 2);
    this.halo.add(new THREE.Mesh(haloGeo, new THREE.MeshStandardMaterial({ color: 0x3a2400, emissive: 0xffc061, emissiveIntensity: 1.2 })));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      world.addAnchor(this.halo, Math.sin(a) * 12.5, 1.6, Math.cos(a) * 12.5);
    }

    // Wings, each carrying a weak point (also a grapple target).
    this.wingMat = addRim(new THREE.MeshStandardMaterial({ color: 0x2a2440, emissive: 0xff7a2a, emissiveIntensity: 0.3, metalness: 0.7, roughness: 0.3, flatShading: true }), 0xffc061, 0.7, 2.0);
    this.wings = new THREE.Group();
    this.body.add(this.wings);
    this.weakPoints = [];
    const wpGeo = new THREE.IcosahedronGeometry(1.1, 2);
    const wpRingGeo = new THREE.TorusGeometry(1.7, 0.06, 6, 40);
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const upper = i < 2;
      const blade = new THREE.Mesh(new THREE.ConeGeometry(1.6, upper ? 20 : 14, 4), this.wingMat);
      blade.scale.z = 0.25;
      const bx = side * (upper ? 11 : 9);
      const by = upper ? 6 : -5;
      blade.position.set(bx, by, -3);
      blade.rotation.z = side * (upper ? -1.0 : -2.3);
      this.wings.add(blade);

      const mat = new THREE.MeshStandardMaterial({ color: 0x400010, emissive: 0xff3d6e, emissiveIntensity: 1.5 });
      const crystal = new THREE.Mesh(wpGeo, mat);
      const ring = new THREE.Mesh(wpRingGeo, new THREE.MeshBasicMaterial({ color: 0xff8fb0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      const anchor = world.addAnchor(this.wings, bx * 0.95, by * 0.95, -2.2, { kind: 'weak', crystal, ring });
      this.weakPoints.push({ id: `weak${i}`, anchor, mat, blade, hp: BOSS.weakHp, alive: true, flash: 0 });
    }

    // Dark silhouettes so the boss reads as a solid shape, not just a glow.
    addOutline(this.core, { color: 0x1a0800, thickness: 0.003 });
    addOutline(this.wings, { color: 0x05030a, thickness: 0.0035, filter: (o) => o.material === this.wingMat || o.geometry === wpGeo });

    this.light = new THREE.PointLight(0xffa64d, 1600, 0, 2);
    this.body.add(this.light);

  }

  reset() {
    for (const h of this.hazards) h.cancel();
    this.hazards.length = 0;
    this.hp = BOSS.maxHp;
    this.breakGauge = 0;
    this.state = 'dormant'; // dormant | intro | idle | attack | broken | recover | cleared
    this.stateT = 0;
    this.idleT = 2;
    this.lastAttack = null;
    this.flash = 0;
    this.y = BOSS.hoverY;
    this.yaw = 0;
    this.shell.visible = true;
    for (const wp of this.weakPoints) {
      wp.hp = BOSS.weakHp;
      wp.alive = true;
      wp.anchor.active = true;
      wp.anchor.group.visible = true;
      wp.blade.material = this.wingMat;
    }
    this.root.position.set(0, this.y, 0);
  }

  get phaseEndHp() { return BOSS.maxHp * BOSS.phase1End; }
  get broken() { return this.state === 'broken'; }
  get active() { return this.state !== 'dormant' && this.state !== 'cleared'; }

  start() {
    this.state = 'intro';
    this.stateT = 0;
    const c = this.getCorePos(_v);
    this.fx.converge(c, { count: 120, radius: 30, color: 0xffc061, life: 1.0, size: 1.2 });
    this.fx.ring(c, { color: 0xffd38a, from: 30, to: 6, life: 1.0, normal: this.ctx?.camNormal });
  }

  getCorePos(out) {
    return out.set(this.root.position.x, this.root.position.y, this.root.position.z);
  }

  // Everything the player's sword can hit right now.
  getTargets(out) {
    if (!this.active) return out;
    out.push({ id: 'core', pos: this.getCorePos(new THREE.Vector3()), r: BOSS.coreRadius, kind: 'core' });
    for (const wp of this.weakPoints) {
      if (wp.alive) out.push({ id: wp.id, pos: wp.anchor.pos, r: 1.3, kind: 'weak', ref: wp });
    }
    for (const h of this.hazards) h.targets?.(out);
    return out;
  }

  // Incoming attacks, for the off-screen warning arrows: [{ pos, kind }].
  getThreats(out) {
    for (const h of this.hazards) h.threats?.(out);
    return out;
  }

  // Apply damage. Returns what happened, for hit feedback.
  takeHit(kind, dmg, wp = null) {
    if (!this.active || this.state === 'intro') return null;
    let amount = dmg;
    let breakGain = 0;
    let destroyed = false;
    const crit = this.broken;
    if (kind === 'weak' && wp?.alive) {
      amount = dmg * BOSS.weakMult;
      wp.hp -= amount;
      wp.flash = 1;
      breakGain = BOSS.breakPerWeakHit;
      if (wp.hp <= 0) {
        destroyed = true;
        amount += BOSS.weakDestroyBonus;
        breakGain += BOSS.breakPerWeakDestroy;
        this.destroyWeakPoint(wp);
      }
    } else if (kind === 'reflect') {
      amount = dmg;
      breakGain = BOSS.breakPerReflect;
    } else {
      breakGain = BOSS.breakPerCoreHit;
    }
    if (crit) amount *= BOSS.brokenMult;
    amount = Math.round(amount);

    this.hp = Math.max(this.phaseEndHp, this.hp - amount);
    this.flash = 1;
    if (!this.broken) {
      this.breakGauge = Math.min(1, this.breakGauge + breakGain);
      if (this.breakGauge >= 1) this.enterBreak();
    }
    if (this.hp <= this.phaseEndHp) this.clearPhase();
    return { amount, crit, weak: kind === 'weak', destroyed };
  }

  destroyWeakPoint(wp) {
    wp.alive = false;
    wp.anchor.active = false;
    wp.anchor.group.visible = false;
    const p = wp.anchor.pos;
    this.fx.burst(p, { count: 60, color: 0xff3d6e, speed: 20, life: 0.7, size: 0.6 });
    this.fx.burst(p, { count: 30, color: 0xffffff, speed: 12, life: 0.4, size: 0.5 });
    this.fx.ring(p, { color: 0xff8fb0, from: 1, to: 9, life: 0.5, normal: this.ctx?.camNormal });
    this.fx.shards(p, { glow: true, count: 34, color: new THREE.Color(3, 0.5, 1.3), speed: 18, size: 0.8, life: 1.2, gravity: 14 });
    this.fx.shards(p, { count: 14, color: 0x2a2440, speed: 12, size: 1.4, life: 1.8 });
    this.ctx?.shockwave?.(p, { strength: 1.1, speed: 0.8, life: 0.6 });
    // Scorch the wing so the loss stays visible.
    wp.blade.material = this.wingMat.clone();
    wp.blade.material.emissive.set(0x220008);
    this.events.onWeakDestroyed(wp);
  }

  enterBreak() {
    this.cancelHazards();
    // The shell shatters as the boss falls.
    const c = this.getCorePos(_v);
    this.fx.shards(c, { glow: true, count: 60, color: new THREE.Color(3, 2.2, 1), speed: 26, size: 1.1, life: 1.4, gravity: 12, up: 0 });
    this.fx.ring(c, { color: 0xffffff, from: 4, to: 22, life: 0.6, normal: this.ctx?.camNormal });
    this.ctx?.shockwave?.(c, { strength: 1.6, speed: 0.7, life: 0.8 });
    this.state = 'broken';
    this.stateT = 0;
    this.shell.visible = false;
    this.events.onBreak();
  }

  clearPhase() {
    if (this.state === 'cleared') return;
    this.cancelHazards();
    const c = this.getCorePos(_v);
    this.fx.shards(c, { glow: true, count: 120, color: new THREE.Color(3.2, 2, 0.8), speed: 34, size: 1.3, life: 2.2, gravity: 6, up: 0 });
    this.fx.shards(c, { count: 50, color: 0x2a2440, speed: 22, size: 1.8, life: 2.5, gravity: 10, up: 0 });
    this.ctx?.shockwave?.(c, { strength: 2, speed: 0.5, life: 1.2 });
    this.state = 'cleared';
    this.stateT = 0;
    this.events.onPhaseClear();
  }

  cancelHazards() {
    for (const h of this.hazards) h.cancel();
    this.hazards.length = 0;
  }

  chooseAttack() {
    const options = ['laser', 'orbs', 'slam'].filter((a) => a !== this.lastAttack);
    let pick = options[Math.floor(Math.random() * options.length)];
    // Below 80% HP the boss starts layering attacks.
    if (this.hp < BOSS.maxHp * 0.8 && Math.random() < 0.35) pick = 'combo';
    this.lastAttack = pick === 'combo' ? null : pick;
    const ctx = this.ctx;
    const hard = this.hp < BOSS.maxHp * 0.8;
    if (pick === 'laser') this.hazards.push(new LaserSweep(ctx));
    if (pick === 'orbs') this.hazards.push(new OrbVolley(ctx, hard ? 12 : 10));
    if (pick === 'slam') this.hazards.push(new WingSlam(ctx));
    if (pick === 'combo') {
      this.hazards.push(new OrbVolley(ctx, 6));
      this.hazards.push(new WingSlam(ctx));
    }
    this.attackPose = pick;
  }

  update(dt, t, player) {
    this.stateT += dt;

    // Hazards run on boss time (slowed during perfect-dodge slow-mo).
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      if (!this.hazards[i].update(dt)) this.hazards.splice(i, 1);
    }

    switch (this.state) {
      case 'intro':
        if (this.stateT > 2.2) {
          this.state = 'idle';
          this.idleT = 0.6;
          this.events.onIntroDone?.();
        }
        break;
      case 'idle':
        this.idleT -= dt;
        if (this.idleT <= 0) {
          this.chooseAttack();
          this.state = 'attack';
          this.stateT = 0;
        }
        break;
      case 'attack':
        if (this.hazards.length === 0) {
          this.state = 'idle';
          this.idleT = BOSS.idleMin + Math.random() * (BOSS.idleMax - BOSS.idleMin);
        }
        break;
      case 'broken':
        if (this.stateT > BOSS.breakDuration) {
          this.state = 'recover';
          this.stateT = 0;
          this.breakGauge = 0;
          this.shell.visible = true;
          this.events.onBreakEnd();
        }
        break;
      case 'recover':
        if (this.stateT > 1.5) {
          this.state = 'idle';
          this.idleT = 0.8;
        }
        break;
      default:
        break;
    }

    // ---- Motion ----
    const targetY = this.state === 'broken' ? BOSS.brokenY : BOSS.hoverY;
    const k = this.state === 'broken' ? 4 : 1.5;
    this.y += (targetY - this.y) * Math.min(1, dt * k);
    const bob = this.state === 'broken' ? Math.sin(t * 9) * 0.15 : Math.sin(t * 0.5) * 0.6;
    this.root.position.set(0, this.y + bob, 0);
    this.collider.y = this.root.position.y;

    if (player && this.state !== 'broken' && this.state !== 'dormant') {
      const want = Math.atan2(player.pos.x, player.pos.z);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 0.8);
    }
    this.body.rotation.y = this.yaw;
    this.body.rotation.z = this.state === 'broken' ? Math.sin(this.stateT * 2) * 0.15 + 0.25 : 0;

    const spin = this.state === 'broken' ? 0.03 : this.state === 'cleared' ? 2 : 0.22;
    this.halo.rotation.y += dt * spin;
    this.core.rotation.y += dt * 0.15;
    this.shell.rotation.y -= dt * 0.25;
    this.shell.rotation.x += dt * 0.1;
    this.wings.rotation.z = Math.sin(t * 0.7) * 0.05 + (this.state === 'broken' ? -0.3 : 0);

    // ---- Glow / flash ----
    this.flash = Math.max(0, this.flash - dt * 8);
    let heat = 0;
    if (this.state === 'broken') heat = 1 + Math.sin(t * 14) * 0.25;
    else if (this.state === 'cleared') heat = 1.6;
    else if (this.state === 'attack' && this.stateT < 1) heat = this.stateT * 0.5; // wind-up glow
    const cu = this.coreMat.userData.uniforms;
    cu.uTime.value = t;
    cu.uHeat.value += (heat - cu.uHeat.value) * Math.min(1, dt * 8);
    cu.uFlash.value = this.flash;
    this.coreMat.emissiveIntensity = 1 + Math.sin(t * 2.2) * 0.12;
    for (const wp of this.weakPoints) {
      wp.flash = Math.max(0, wp.flash - dt * 8);
      wp.mat.emissive.setHex(0xff3d6e).lerp(WHITE, wp.flash);
      wp.mat.emissiveIntensity = 1.5 + Math.sin(t * 6) * 0.4 + wp.flash * 3;
    }
  }
}
