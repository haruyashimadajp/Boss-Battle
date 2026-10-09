import * as THREE from 'three';
import { BOSS } from '../config.js';
import { makeSphere } from '../world/collision.js';
import { LaserSweep, OrbVolley, WingSlam } from './hazards.js';
import { HaloBlades, SpiralBarrage, GravityWell, LanceDash, MeteorRain, AnnihilationBeam } from './hazards2.js';
import { buildAngel } from './angel.js';
import { addOutline, addRim } from '../fx/outline.js';

// The boss fight in three phases.
//   Phase 1 HALO      "Seraph of the Broken Sun": floating core, halo, four wings with weak points.
//   Phase 2 ECLIPSE   the core hatches Seraphina, an angel girl. Wing jewels are the weak points.
//   Phase 3 SUPERNOVA Seraphina turns crimson; her heart jewel is the weak point.
//   At 0 HP she waits for the finisher, then dissolves into light.
//
// events: onBreak(), onBreakEnd(), onWeakDestroyed(wp), onPhaseEnd(phase), onTransformFlash(phase),
//         onPhaseStart(phase), onFinisherReady(), onDefeated(), onIntroDone()

const TAU = Math.PI * 2;
const WHITE = new THREE.Color(0xffffff);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

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


const PHASE_NAMES = {
  1: 'SERAPH OF THE BROKEN SUN',
  2: 'SERAPHINA — ECLIPSE',
  3: 'SERAPHINA — SUPERNOVA',
};
const HIDDEN_Y = -1e4;

export class Boss {
  constructor(scene, world, fx, events) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.events = events;
    this.hazards = [];
    this.ctx = null; // hazard context, set by the game
    this.angelPos = new THREE.Vector3(0, 18, 0);
    this.home = new THREE.Vector3(0, 18, 0);
    this.build();
    this.buildAngel();
    this.reset();
  }

  // ---------- Phase 1 model ----------
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
    this.haloAnchors = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      this.haloAnchors.push(world.addAnchor(this.halo, Math.sin(a) * 12.5, 1.6, Math.cos(a) * 12.5));
    }

    this.wingMat = addRim(new THREE.MeshStandardMaterial({ color: 0x2a2440, emissive: 0xff7a2a, emissiveIntensity: 0.3, metalness: 0.7, roughness: 0.3, flatShading: true }), 0xffc061, 0.7, 2.0);
    this.wings = new THREE.Group();
    this.body.add(this.wings);
    this.wp1 = [];
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
      this.wp1.push({ id: `weak${i}`, anchor, mat, blade, maxHp: BOSS.weakHp, hp: BOSS.weakHp, alive: true, flash: 0 });
    }
    addOutline(this.core, { color: 0x1a0800, thickness: 0.003 });
    addOutline(this.wings, { color: 0x05030a, thickness: 0.0035, filter: (o) => o.material === this.wingMat || o.geometry === wpGeo });

    this.light = new THREE.PointLight(0xffa64d, 1600, 0, 2);
    this.body.add(this.light);
  }

  // ---------- Phase 2-3 model ----------
  buildAngel() {
    const { world } = this;
    const a = buildAngel();
    this.angel = a;
    this.scene.add(a.root);

    // Body spheres: collision and sword targets (local offsets from her chest).
    this.angelParts = [
      { off: new THREE.Vector3(0, 2.95, 0), r: 1.4 },
      { off: new THREE.Vector3(0, 0.6, 0), r: 1.35 },
      { off: new THREE.Vector3(0, -2.6, 0), r: 2.4 },
    ].map((p) => ({ ...p, col: makeSphere(0, HIDDEN_Y, 0, p.r), pos: new THREE.Vector3() }));
    for (const p of this.angelParts) world.colliders.push(p.col);

    // Wing jewels (Phase 2 weak points, also grapple targets).
    const jewelGeo = new THREE.IcosahedronGeometry(0.5, 1);
    const ringGeo = new THREE.TorusGeometry(0.85, 0.05, 6, 32);
    this.wp2 = a.wingJewelSpots.map((spot, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x400018, emissive: 0xff3d7e, emissiveIntensity: 1.5 });
      const crystal = new THREE.Mesh(jewelGeo, mat);
      addOutline(crystal, { color: 0x1a0008, thickness: 0.004 });
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff8fb0, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
      const anchor = world.addAnchor(spot.parent, spot.pos.x, spot.pos.y, spot.pos.z, { kind: 'weak', crystal, ring });
      return { id: `jewel${i}`, anchor, mat, maxHp: BOSS.angelWeakHp, hp: BOSS.angelWeakHp, alive: true, flash: 0 };
    });
    // Heart jewel (Phase 3 weak point). It never breaks; it is where the finisher lands.
    const heartRing = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 32), new THREE.MeshBasicMaterial({ color: 0xff8fb0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    const heartAnchor = world.addAnchor(a.torso, 0, 0.5, 1.05, { kind: 'weak', crystal: new THREE.Object3D(), ring: heartRing });
    this.wp3 = [{ id: 'heart', anchor: heartAnchor, mat: a.M.jewel, maxHp: Infinity, hp: Infinity, alive: true, flash: 0, heart: true }];
    // Plain grapple points on the upper wing tips.
    this.angelAnchors = a.wingTips.map((tip) => world.addAnchor(tip.parent, tip.pos.x, tip.pos.y, tip.pos.z));
    a.root.visible = false;
  }

  get weakPoints() { return this.phase === 1 ? this.wp1 : this.phase === 2 ? this.wp2 : this.wp3; }
  get name() { return PHASE_NAMES[this.phase]; }

  phaseStartHp(phase) { return phase === 1 ? BOSS.maxHp : phase === 2 ? BOSS.maxHp * BOSS.phase1End : BOSS.maxHp * BOSS.phase2End; }
  get phaseEndHp() { return this.phase === 1 ? BOSS.maxHp * BOSS.phase1End : this.phase === 2 ? BOSS.maxHp * BOSS.phase2End : 0; }
  get broken() { return this.state === 'broken'; }
  // Can be hit and attacks.
  get active() { return ['intro', 'idle', 'attack', 'broken', 'recover'].includes(this.state); }

  // Put the boss at the start of a phase (new fight = 1, checkpoint retry = 2 or 3).
  reset(phase = 1) {
    this.cancelHazards();
    this.phase = phase;
    this.hp = this.phaseStartHp(phase);
    this.breakGauge = 0;
    this.state = 'dormant'; // dormant | intro | idle | attack | broken | recover | transform | finisher | dying | dead
    this.stateT = 0;
    this.idleT = 2;
    this.lastAttack = null;
    this.recent = [];
    this.flash = 0;
    this.y = BOSS.hoverY;
    this.yaw = 0;
    this.dissolve = 0;
    this.shell.visible = true;
    this.root.visible = phase === 1;
    this.root.scale.setScalar(1);
    for (const wp of this.wp1) {
      wp.hp = wp.maxHp;
      wp.alive = true;
      wp.blade.material = this.wingMat;
    }
    for (const wp of this.wp2) { wp.hp = wp.maxHp; wp.alive = true; }
    this.root.position.set(0, this.y, 0);

    const a = this.angel;
    a.root.visible = phase >= 2;
    a.root.scale.setScalar(1);
    a.setDissolve(0);
    a.setPalette(phase);
    a.setMood(phase === 3 ? 'angry' : 'calm');
    a.setPose('idle');
    a.halo.visible = true;
    this.angelPos.set(0, 18, 14);
    this.home.copy(this.angelPos);
    this.syncAnchors();
    this.world.setPhase(phase, true);
  }

  // Grapple anchors / weak points that exist in the current phase.
  syncAnchors() {
    const p = this.phase;
    const show = (anchor, on) => { anchor.active = on; anchor.group.visible = on; };
    for (const a of this.haloAnchors) show(a, p === 1);
    for (const wp of this.wp1) show(wp.anchor, p === 1 && wp.alive);
    for (const wp of this.wp2) show(wp.anchor, p === 2 && wp.alive);
    for (const wp of this.wp3) show(wp.anchor, p === 3);
    for (const a of this.angelAnchors) show(a, p >= 2);
  }

  start(introTime = 2.2) {
    this.state = 'intro';
    this.stateT = 0;
    this.introTime = introTime;
    const c = this.getCorePos(_v);
    this.fx.converge(c, { count: 120, radius: 30, color: 0xffc061, life: 1.0, size: 1.2 });
    this.fx.ring(c, { color: 0xffd38a, from: 30, to: 6, life: 1.0, normal: this.ctx?.camNormal });
  }

  getCorePos(out) {
    if (this.phase === 1) return out.copy(this.root.position);
    return out.copy(this.angel.root.position);
  }

  // Everything the player's sword can hit right now.
  getTargets(out) {
    if (!this.active) return out;
    if (this.phase === 1) {
      out.push({ id: 'core', pos: this.getCorePos(new THREE.Vector3()), r: BOSS.coreRadius, kind: 'core' });
    } else {
      // Any body part counts as one target (shared id: one hit per swing).
      for (const p of this.angelParts) out.push({ id: 'core', pos: p.pos, r: p.r, kind: 'core' });
    }
    for (const wp of this.weakPoints) {
      if (wp.alive) out.push({ id: wp.id, pos: wp.anchor.pos, r: wp.heart ? 1.0 : 1.3, kind: 'weak', ref: wp });
    }
    for (const h of this.hazards) h.targets?.(out);
    return out;
  }

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
    if (this.hp <= this.phaseEndHp) this.endPhase();
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
    if (wp.blade) {
      wp.blade.material = this.wingMat.clone();
      wp.blade.material.emissive.set(0x220008);
    }
    this.events.onWeakDestroyed(wp);
  }

  enterBreak() {
    this.cancelHazards();
    const c = this.getCorePos(_v);
    this.fx.shards(c, { glow: true, count: 60, color: new THREE.Color(3, 2.2, 1), speed: 26, size: 1.1, life: 1.4, gravity: 12, up: 0 });
    this.fx.ring(c, { color: 0xffffff, from: 4, to: 22, life: 0.6, normal: this.ctx?.camNormal });
    this.ctx?.shockwave?.(c, { strength: 1.6, speed: 0.7, life: 0.8 });
    this.state = 'broken';
    this.stateT = 0;
    this.shell.visible = false;
    if (this.phase >= 2) {
      this.angel.setMood('dizzy');
      this.angel.setPose('dizzy');
      this.angel.halo.visible = true;
    }
    this.events.onBreak();
  }

  // HP reached this phase's threshold: transform, or wait for the finisher.
  endPhase() {
    if (this.state === 'transform' || this.state === 'finisher') return;
    this.cancelHazards();
    this.breakGauge = 0;
    this.stateT = 0;
    if (this.phase < 3) {
      this.state = 'transform';
      this.transformFrom = this.phase;
      this.burst = false;
      this.events.onPhaseEnd(this.phase);
    } else {
      this.state = 'finisher';
      this.angel.setMood('dizzy');
      this.angel.setPose('dizzy');
      this.events.onFinisherReady();
    }
  }

  // The finisher connected: dissolve into light.
  beginDissolve() {
    this.state = 'dying';
    this.stateT = 0;
    this.angel.setMood('peace');
    this.angel.setPose('peace');
    const c = this.getCorePos(_v);
    this.fx.shards(c, { glow: true, count: 120, color: new THREE.Color(3, 2.6, 1.6), speed: 26, size: 1, life: 2.2, gravity: -2, up: 0 });
    this.ctx?.shockwave?.(c, { strength: 2.2, speed: 0.6, life: 1.2 });
  }

  cancelHazards() {
    for (const h of this.hazards) h.cancel();
    this.hazards.length = 0;
  }

  // Pick the next attack. Avoids repeats; layers attacks as HP drops.
  chooseAttack() {
    const ctx = this.ctx;
    const hpFrac = this.hp / BOSS.maxHp;
    const push = (h) => this.hazards.push(h);
    const pickFrom = (weights) => {
      const entries = Object.entries(weights).filter(([k]) => k !== this.lastAttack);
      let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
      for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
      return entries[0][0];
    };

    if (this.phase === 1) {
      let pick = pickFrom({ laser: 1, orbs: 1, slam: 1 });
      if (hpFrac < 0.8 && Math.random() < 0.35) pick = 'combo';
      this.lastAttack = pick === 'combo' ? null : pick;
      if (pick === 'laser') push(new LaserSweep(ctx));
      if (pick === 'orbs') push(new OrbVolley(ctx, hpFrac < 0.8 ? 12 : 10));
      if (pick === 'slam') push(new WingSlam(ctx));
      if (pick === 'combo') { push(new OrbVolley(ctx, 6)); push(new WingSlam(ctx)); }
      return;
    }

    this.reposition();
    if (this.phase === 2) {
      let pick = pickFrom({ laser: 1, orbs: 0.8, blades: 1.4, spiral: 1.3, well: 1, lance: 1.2 });
      if (hpFrac < 0.45 && Math.random() < 0.3) pick = 'combo';
      this.lastAttack = pick === 'combo' ? null : pick;
      if (pick === 'laser') push(new LaserSweep(ctx));
      if (pick === 'orbs') push(new OrbVolley(ctx, 10));
      if (pick === 'blades') push(new HaloBlades(ctx));
      if (pick === 'spiral') push(new SpiralBarrage(ctx));
      if (pick === 'well') push(new GravityWell(ctx));
      if (pick === 'lance') push(new LanceDash(ctx));
      if (pick === 'combo') {
        const c = Math.floor(Math.random() * 3);
        if (c === 0) { push(new SpiralBarrage(ctx, { arms: 2 })); push(new GravityWell(ctx)); }
        if (c === 1) { push(new HaloBlades(ctx)); push(new OrbVolley(ctx, 6)); }
        if (c === 2) { push(new LanceDash(ctx)); push(new SpiralBarrage(ctx, { arms: 2, duration: 1.6 })); }
      }
      return;
    }

    // Phase 3: no annihilation beam twice within three attacks.
    const weights = { meteors: 1.3, beam: 0.9, blades: 1, spiral: 1.1, lance: 1.2, well: 0.8 };
    if (this.recent.includes('beam')) delete weights.beam;
    let pick = pickFrom(weights);
    const desperate = hpFrac < 0.1;
    if (Math.random() < (desperate ? 0.6 : 0.35) && pick !== 'beam') pick = 'combo';
    this.lastAttack = pick === 'combo' ? null : pick;
    this.recent.push(pick);
    if (this.recent.length > 3) this.recent.shift();
    const spiral3 = { arms: 4, speed: 14, turn: 1.8 };
    if (pick === 'meteors') push(new MeteorRain(ctx));
    if (pick === 'beam') push(new AnnihilationBeam(ctx));
    if (pick === 'blades') push(new HaloBlades(ctx, { count: 12, gaps: 2, speed: 18, spin: 0.8 }));
    if (pick === 'spiral') push(new SpiralBarrage(ctx, spiral3));
    if (pick === 'lance') push(new LanceDash(ctx, { telegraph: 0.75, dash: 0.32 }));
    if (pick === 'well') push(new GravityWell(ctx));
    if (pick === 'combo') {
      const c = Math.floor(Math.random() * 3);
      if (c === 0) { push(new MeteorRain(ctx, { count: 10 })); push(new SpiralBarrage(ctx, { arms: 3, speed: 13 })); }
      if (c === 1) { push(new HaloBlades(ctx, { count: 12, gaps: 2, speed: 18 })); push(new GravityWell(ctx)); }
      if (c === 2) { push(new LanceDash(ctx, { telegraph: 0.75, dash: 0.32 })); push(new MeteorRain(ctx, { count: 8 })); }
    }
  }

  // Glide to a new spot in front of the player before attacking.
  reposition() {
    const p = this.ctx.player.pos;
    const pa = Math.atan2(p.x, p.z);
    const a = pa + (Math.random() - 0.5) * 2.2;
    const r = this.phase === 3 ? 10 + Math.random() * 12 : 15 + Math.random() * 9;
    const y = this.phase === 3 ? 11 + Math.random() * 7 : 14 + Math.random() * 6;
    this.home.set(Math.sin(a) * r, y, Math.cos(a) * r);
  }

  update(dt, t, player) {
    this.stateT += dt;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      if (!this.hazards[i].update(dt)) this.hazards.splice(i, 1);
    }

    switch (this.state) {
      case 'intro':
        if (this.stateT > (this.introTime ?? 2.2)) {
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
          const [lo, hi] = this.phase === 1 ? [BOSS.idleMin, BOSS.idleMax]
            : this.phase === 2 ? [0.8, 1.4] : this.hp / BOSS.maxHp < 0.1 ? [0.35, 0.7] : [0.6, 1.1];
          this.idleT = lo + Math.random() * (hi - lo);
        }
        break;
      case 'broken':
        if (this.stateT > BOSS.breakDuration) {
          this.state = 'recover';
          this.stateT = 0;
          this.breakGauge = 0;
          this.shell.visible = true;
          if (this.phase >= 2) {
            this.angel.setMood(this.phase === 3 ? 'angry' : 'calm');
            this.angel.setPose('idle');
          }
          this.events.onBreakEnd();
        }
        break;
      case 'recover':
        if (this.stateT > 1.5) {
          this.state = 'idle';
          this.idleT = 0.8;
        }
        break;
      case 'transform':
        this.updateTransform(dt, t);
        break;
      case 'dying':
        this.dissolve = Math.min(1, this.stateT / 3);
        this.angel.setDissolve(this.dissolve);
        if (Math.random() < 0.7) {
          this.getCorePos(_v).add(_w.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 4));
          this.fx.burst(_v, { count: 3, color: 0xfff0c8, speed: 2, life: 1.2, size: 0.8, gravity: -3 });
        }
        if (this.stateT > 3.2) {
          this.state = 'dead';
          this.angel.root.visible = false;
          for (const p of this.angelParts) p.col.y = HIDDEN_Y;
          this.syncAnchorsOff();
          this.events.onDefeated();
        }
        break;
      default:
        break;
    }

    if (this.phase === 1 || (this.state === 'transform' && this.stateT < 1.6 && this.transformFrom === 1)) this.updateSeraph(dt, t, player);
    if (this.phase >= 2 || this.angel.root.visible) this.updateAngel(dt, t, player);
  }

  syncAnchorsOff() {
    for (const wp of [...this.wp2, ...this.wp3]) { wp.anchor.active = false; wp.anchor.group.visible = false; }
    for (const a of this.angelAnchors) { a.active = false; a.group.visible = false; }
  }

  // ---------- Transformations ----------
  // Phase 1 -> 2 (5 s): the core shakes and cracks, bursts, and Seraphina unfolds from it.
  // Phase 2 -> 3 (3.6 s): she curls up and flares crimson.
  updateTransform(dt, t) {
    const st = this.stateT;
    const c = this.getCorePos(_v);
    if (this.transformFrom === 1) {
      if (st < 1.6) {
        this.root.position.x = (Math.random() - 0.5) * st * 0.8;
        this.root.position.z = (Math.random() - 0.5) * st * 0.8;
        this.coreMat.userData.uniforms.uHeat.value = 0.5 + st * 1.2;
        this.fx.converge(c, { count: 6, radius: 18, color: 0xffd38a, life: 0.6, size: 0.9 });
        if (Math.random() < 0.15) this.fx.shards(c, { glow: true, count: 4, color: new THREE.Color(3, 2, 0.8), speed: 14, size: 0.6, life: 0.8 });
      } else if (!this.burst) {
        this.burst = true;
        this.root.visible = false;
        this.collider.y = HIDDEN_Y;
        this.phase = 2;
        this.hp = this.phaseStartHp(2);
        this.angel.root.visible = true;
        this.angel.root.scale.setScalar(0.05);
        this.angel.setPalette(2);
        this.angel.setMood('calm');
        this.angel.setPose('peace');
        this.angelPos.set(0, BOSS.hoverY - 4, 0);
        this.home.set(0, 18, 12);
        this.fx.shards(c, { glow: true, count: 140, color: new THREE.Color(3.2, 2.4, 1), speed: 36, size: 1.3, life: 2, gravity: 6, up: 0 });
        this.fx.shards(c, { count: 50, color: 0x2a2440, speed: 24, size: 1.8, life: 2.4, gravity: 10, up: 0 });
        this.fx.shards(c, { glow: true, count: 60, color: new THREE.Color(2.6, 2.6, 2.6), speed: 10, size: 0.7, life: 3, gravity: -1.5, up: 0 });
        this.ctx?.shockwave?.(c, { strength: 2.2, speed: 0.5, life: 1.2 });
        this.world.setPhase(2);
        this.syncAnchors();
        this.events.onTransformFlash(2);
      } else {
        const k = Math.min(1, (st - 1.6) / 1.6);
        this.angel.root.scale.setScalar(0.05 + 0.95 * (1 - (1 - k) ** 3));
        if (st > 3.4) this.angel.setPose('idle');
      }
      if (st > 5.0) this.finishTransform();
    } else {
      if (st < 1.4) {
        this.angel.setPose('charge');
        this.angelPos.x += (Math.random() - 0.5) * 0.3;
        this.angelPos.z += (Math.random() - 0.5) * 0.3;
        this.fx.converge(c, { count: 6, radius: 14, color: 0xff3a5a, life: 0.5, size: 0.8 });
      } else if (!this.burst) {
        this.burst = true;
        this.phase = 3;
        this.hp = this.phaseStartHp(3);
        this.angel.setPalette(3);
        this.angel.setMood('angry');
        this.fx.shards(c, { glow: true, count: 100, color: new THREE.Color(3, 0.4, 0.7), speed: 30, size: 1.1, life: 1.8, gravity: 4, up: 0 });
        this.fx.ring(c, { color: 0xff3050, from: 2, to: 30, life: 0.7, normal: this.ctx?.camNormal });
        this.ctx?.shockwave?.(c, { strength: 2, speed: 0.6, life: 1 });
        this.world.setPhase(3);
        this.syncAnchors();
        this.events.onTransformFlash(3);
      } else if (st > 2.2) {
        this.angel.setPose('idle');
      }
      if (st > 3.6) this.finishTransform();
    }
  }

  finishTransform() {
    this.state = 'idle';
    this.idleT = 1.0;
    this.stateT = 0;
    this.burst = false;
    this.breakGauge = 0;
    this.events.onPhaseStart(this.phase);
  }

  updateSeraph(dt, t, player) {
    const targetY = this.state === 'broken' ? BOSS.brokenY : BOSS.hoverY;
    const k = this.state === 'broken' ? 4 : 1.5;
    this.y += (targetY - this.y) * Math.min(1, dt * k);
    const bob = this.state === 'broken' ? Math.sin(t * 9) * 0.15 : Math.sin(t * 0.5) * 0.6;
    if (this.state !== 'transform') this.root.position.set(0, this.y + bob, 0);
    else this.root.position.y = this.y + bob;
    this.collider.y = this.root.visible ? this.root.position.y : HIDDEN_Y;

    if (player && this.state !== 'broken' && this.state !== 'dormant') {
      const want = Math.atan2(player.pos.x, player.pos.z);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 0.8);
    }
    this.body.rotation.y = this.yaw;
    this.body.rotation.z = this.state === 'broken' ? Math.sin(this.stateT * 2) * 0.15 + 0.25 : 0;

    const spin = this.state === 'broken' ? 0.03 : this.state === 'transform' ? 2.5 : 0.22;
    this.halo.rotation.y += dt * spin;
    this.core.rotation.y += dt * 0.15;
    this.shell.rotation.y -= dt * 0.25;
    this.shell.rotation.x += dt * 0.1;
    this.wings.rotation.z = Math.sin(t * 0.7) * 0.05 + (this.state === 'broken' ? -0.3 : 0);

    this.flash = Math.max(0, this.flash - dt * 8);
    let heat = 0;
    if (this.state === 'broken') heat = 1 + Math.sin(t * 14) * 0.25;
    else if (this.state === 'attack' && this.stateT < 1) heat = this.stateT * 0.5;
    const cu = this.coreMat.userData.uniforms;
    cu.uTime.value = t;
    if (this.state !== 'transform') cu.uHeat.value += (heat - cu.uHeat.value) * Math.min(1, dt * 8);
    cu.uFlash.value = this.flash;
    this.coreMat.emissiveIntensity = 1 + Math.sin(t * 2.2) * 0.12;
    this.updateWeakGlow(this.wp1, dt, t);
  }

  updateAngel(dt, t, player) {
    const a = this.angel;
    const lanceActive = this.hazards.some((h) => h instanceof LanceDash);
    if (this.state === 'broken' || this.state === 'finisher') {
      // Drift down, dazed, within reach.
      _w.set(this.angelPos.x, Math.max(9, this.angelPos.y - 1), this.angelPos.z);
      const h = Math.hypot(_w.x, _w.z);
      if (h > 20) { _w.x *= 20 / h; _w.z *= 20 / h; }
      this.angelPos.lerp(_w, Math.min(1, dt * 1.5));
    } else if (!lanceActive && this.state !== 'transform') {
      this.angelPos.lerp(this.home, Math.min(1, dt * 1.6));
    } else if (this.state === 'transform' && this.transformFrom === 1) {
      this.angelPos.lerp(this.home, Math.min(1, dt * 0.8));
    }
    const bob = this.state === 'broken' || this.state === 'finisher' ? Math.sin(t * 2) * 0.3 : Math.sin(t * 1.3) * 0.5;
    a.root.position.set(this.angelPos.x, this.angelPos.y + bob, this.angelPos.z);

    if (player && !['broken', 'finisher', 'dying'].includes(this.state)) {
      const want = Math.atan2(player.pos.x - a.root.position.x, player.pos.z - a.root.position.z);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 3);
    }
    a.root.rotation.y = this.yaw;
    a.root.rotation.z = this.state === 'broken' ? Math.sin(t * 1.5) * 0.12 : 0;
    a.state.flap = this.state === 'broken' ? 0.4 : this.phase === 3 ? 1.5 : 1;
    a.update(dt, t);

    // Body spheres follow her.
    a.root.updateMatrixWorld();
    for (const p of this.angelParts) {
      p.pos.copy(p.off).applyMatrix4(a.root.matrixWorld);
      p.col.x = p.pos.x;
      p.col.z = p.pos.z;
      p.col.y = a.root.visible && this.state !== 'dying' && this.state !== 'dead' ? p.pos.y : HIDDEN_Y;
      p.col.r = p.r * a.root.scale.x;
    }
    if (this.state === 'broken' && Math.random() < 0.3) {
      // Dizzy sparkles circling her head.
      const hp = this.angelParts[0].pos;
      const ang = t * 4;
      this.fx.burst(_v.set(hp.x + Math.sin(ang) * 1.8, hp.y + 1.6, hp.z + Math.cos(ang) * 1.8), { count: 1, color: 0xfff0a0, speed: 0.5, life: 0.5, size: 0.7 });
    }

    this.flash = Math.max(0, this.flash - dt * 8);
    // Hit flash: brighten her rim briefly.
    for (const key of ['skin', 'dress', 'hair', 'armor']) {
      const m = a.M[key];
      m.emissive.setScalar(this.flash * 0.6);
      m.emissiveIntensity = 1;
    }
    this.updateWeakGlow(this.phase === 2 ? this.wp2 : this.wp3, dt, t);
  }

  updateWeakGlow(list, dt, t) {
    for (const wp of list) {
      wp.flash = Math.max(0, wp.flash - dt * 8);
      wp.mat.emissive.setHex(0xff3d6e).lerp(WHITE, wp.flash);
      wp.mat.emissiveIntensity = (wp.heart ? 2.4 : 1.5) + Math.sin(t * 6) * 0.4 + wp.flash * 3;
    }
  }
}
