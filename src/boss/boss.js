import * as THREE from 'three';
import { BOSS } from '../config.js';
import { makeSphere } from '../world/collision.js';
import { LaserSweep, OrbVolley, WingSlam } from './hazards.js';

// "Seraph of the Broken Sun": a floating core with a halo and four wings.
// Phase 1 (HALO): laser sweeps, homing orbs and wing slams. Four weak points on the wings.
//
// events: onBreak(), onBreakEnd(), onWeakDestroyed(wp), onPhaseClear(), onIntroDone()

const TAU = Math.PI * 2;
const WHITE = new THREE.Color(0xffffff);
const _v = new THREE.Vector3();

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

    this.coreColor = new THREE.Color(0xffa53a);
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x3a1a00, emissive: this.coreColor.clone(), emissiveIntensity: 2.0 });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(BOSS.coreRadius, 3), this.coreMat);
    this.body.add(this.core);
    world.solids.push(this.core);
    this.collider = makeSphere(0, BOSS.hoverY, 0, BOSS.coreRadius);
    world.colliders.push(this.collider);

    this.shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(7.2, 1),
      new THREE.MeshBasicMaterial({ color: 0xffd38a, wireframe: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.body.add(this.shell);

    const haloTilt = new THREE.Group();
    haloTilt.rotation.set(0.32, 0, 0.12);
    this.root.add(haloTilt);
    this.halo = new THREE.Group();
    haloTilt.add(this.halo);
    const haloGeo = new THREE.TorusGeometry(12.5, 0.38, 10, 120).rotateX(Math.PI / 2);
    this.halo.add(new THREE.Mesh(haloGeo, new THREE.MeshStandardMaterial({ color: 0x3a2400, emissive: 0xffc061, emissiveIntensity: 3 })));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      world.addAnchor(this.halo, Math.sin(a) * 12.5, 1.6, Math.cos(a) * 12.5);
    }

    // Wings, each carrying a weak point (also a grapple target).
    this.wingMat = new THREE.MeshStandardMaterial({ color: 0x1c1830, emissive: 0xff7a2a, emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.3, flatShading: true });
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

      const mat = new THREE.MeshStandardMaterial({ color: 0x400010, emissive: 0xff3d6e, emissiveIntensity: 3 });
      const crystal = new THREE.Mesh(wpGeo, mat);
      const ring = new THREE.Mesh(wpRingGeo, new THREE.MeshBasicMaterial({ color: 0xff8fb0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      const anchor = world.addAnchor(this.wings, bx * 0.95, by * 0.95, -2.2, { kind: 'weak', crystal, ring });
      this.weakPoints.push({ id: `weak${i}`, anchor, mat, blade, hp: BOSS.weakHp, alive: true, flash: 0 });
    }

    this.light = new THREE.PointLight(0xffa64d, 1600, 0, 2);
    this.body.add(this.light);

    // Pillar of light from the core down to the center platform.
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 3.5, 26, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beam.position.set(0, 16, 0);
    scene.add(this.beam);
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
    this.beam.visible = true;
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
    // Scorch the wing so the loss stays visible.
    wp.blade.material = this.wingMat.clone();
    wp.blade.material.emissive.set(0x220008);
    this.events.onWeakDestroyed(wp);
  }

  enterBreak() {
    this.cancelHazards();
    this.state = 'broken';
    this.stateT = 0;
    this.shell.visible = false;
    this.beam.visible = false;
    this.events.onBreak();
  }

  clearPhase() {
    if (this.state === 'cleared') return;
    this.cancelHazards();
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
          this.beam.visible = true;
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
    let glow = 1.5 + Math.sin(t * 2.2) * 0.2;
    if (this.state === 'broken') glow = 3.2 + Math.sin(t * 14) * 0.8;
    if (this.state === 'attack' && this.stateT < 1) glow += this.stateT * 1.5;
    this.coreMat.emissive.copy(this.coreColor).lerp(WHITE, this.state === 'broken' ? 0.45 : 0);
    this.coreMat.emissive.lerp(WHITE, this.flash * 0.8);
    this.coreMat.emissiveIntensity = glow + this.flash * 3;
    for (const wp of this.weakPoints) {
      wp.flash = Math.max(0, wp.flash - dt * 8);
      wp.mat.emissive.setHex(0xff3d6e).lerp(WHITE, wp.flash);
      wp.mat.emissiveIntensity = 3 + Math.sin(t * 6) * 0.8 + wp.flash * 4;
    }
  }
}
