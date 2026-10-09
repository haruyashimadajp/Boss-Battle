import * as THREE from 'three';
import { PLAYER as P, COMBAT } from '../config.js';
import { resolve, probeGround, groundHeightBelow } from '../world/collision.js';
import { buildPlayerModel } from './model.js';
import { SwordTrail } from '../fx/trail.js';
import { addOutline } from '../fx/outline.js';

const UP = new THREE.Vector3(0, 1, 0);
const _wish = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _side = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();

const _hit = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _bladeBase = new THREE.Vector3();
const _bladeTip = new THREE.Vector3();

const COLOR = { cyan: 0x46e6ff, violet: 0xb77dff, white: 0xffffff };

export class Player {
  constructor(scene, world, fx, events) {
    this.world = world;
    this.fx = fx;
    // events: shake(a), flash(color, alpha), onAttackHit(target, attack, point, dir),
    //         onPlungeLand(pos, attack), onDeath()
    this.events = events;
    // Returns the things the sword can hit: [{ id, pos, r, kind }]. Set by the game.
    this.targets = () => [];

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = Math.PI; // model yaw (faces -z, toward the boss)

    this.model = buildPlayerModel();
    scene.add(this.model.root);
    fx.initAfterimages(this.model.root);
    // Outline after the afterimage pool is built so ghosts don't copy the hulls.
    this.model.outlines = addOutline(this.model.root, { color: 0x02020a, thickness: 0.0048 });
    this.trail = new SwordTrail(scene);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);

    const ropeGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    ropeGeo.translate(0, 0.5, 0);
    this.rope = new THREE.Group();
    const ropeCore = new THREE.Mesh(ropeGeo, new THREE.MeshBasicMaterial({ color: 0xe9d8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ropeCore.scale.set(0.03, 1, 0.03);
    const ropeGlow = new THREE.Mesh(ropeGeo, new THREE.MeshBasicMaterial({ color: COLOR.violet, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    ropeGlow.scale.set(0.11, 1, 0.11);
    this.rope.add(ropeCore, ropeGlow);
    this.rope.visible = false;
    for (const m of [ropeCore, ropeGlow]) m.frustumCulled = false;
    scene.add(this.rope);

    this.respawn(true);
  }

  respawn(initial = false) {
    if (initial) {
      this.hp = P.maxHp;
      this.dead = false;
    }
    this.hurtT = 0;
    this.stunT = 0;
    this.dashAge = 99;
    this.combat = { active: null, step: 0, air: false, t: 0, queued: false, idle: 99, hitSet: new Set(), target: null, dir: new THREE.Vector3(0, 0, -1), recover: 0 };
    let c = initial ? this.world.spawnCollider : (this.safeGround || this.world.spawnCollider);
    if (c.yMax < -100) c = this.world.spawnCollider; // that platform has fallen away
    this.pos.set(c.x, c.yMax, c.z);
    if (initial) this.pos.copy(this.world.spawn);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.ground = c;
    this.safeGround = c;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.airJumps = P.airJumps;
    this.jumpCut = false;
    this.dashCharges = P.dashCharges;
    this.dashT = 0;
    this.dashCd = 0;
    this.dashRecharge = 0;
    this.dashDir = new THREE.Vector3(0, 0, -1);
    this.iframes = 0;
    this.ghostT = 0;
    this.grapple = { state: 'idle', anchor: null, t: 0, cd: 0 };
    this.target = null;
    this.landSquash = 0;
    this.runPhase = 0;
    this.rope.visible = false;
  }

  get dashing() { return this.dashT > 0; }
  get grappling() { return this.grapple.state !== 'idle'; }
  get invulnerable() { return this.iframes > 0; }
  get attacking() { return this.combat.active !== null; }
  get center() { return _tmp2.set(this.pos.x, this.pos.y + P.height * 0.55, this.pos.z); }

  update(dt, input, rig, camera, controlMode) {
    const g = this.grapple;
    const wasGrounded = this.grounded;

    // ---- Timers ----
    this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.dashAge += dt;
    g.cd = Math.max(0, g.cd - dt);
    const cb = this.combat;
    cb.recover = Math.max(0, cb.recover - dt);
    if (!cb.active) cb.idle += dt;
    const stunned = this.stunT > 0;
    if (input.jumpPressed && !stunned) this.jumpBuf = P.jumpBuffer;

    // ---- Ride moving platforms ----
    if (this.grounded && this.ground) {
      this.pos.x += this.ground.dx;
      this.pos.y += this.ground.dy;
      this.pos.z += this.ground.dz;
    }

    // ---- Camera-relative wish direction ----
    const fx = -Math.sin(rig.yaw);
    const fz = -Math.cos(rig.yaw);
    // right = (cos yaw, 0, -sin yaw)
    _wish.set(
      Math.cos(rig.yaw) * input.move.x + fx * input.move.y,
      0,
      -Math.sin(rig.yaw) * input.move.x + fz * input.move.y,
    );
    if (stunned) _wish.set(0, 0, 0);
    const wishLen = Math.min(1, _wish.length());

    // ---- Grapple targeting ----
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camDir);
    if (!this.grappling) this.target = this.findTarget(controlMode);
    for (const a of this.world.anchors) a.targeted = a === (this.grappling ? g.anchor : this.target);

    // ---- Dash ----
    if (input.dashPressed && !stunned && this.dashCharges > 0 && this.dashCd <= 0) {
      if (this.grappling) this.endGrapple(false);
      cb.active = null; // dash cancels a swing
      this.dashAge = 0;
      if (wishLen > 0.1) this.dashDir.copy(_wish).normalize();
      else this.dashDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
      this.dashCharges--;
      this.dashT = P.dashDuration;
      this.dashCd = P.dashDuration + P.dashCooldown;
      this.iframes = P.dashIFrames;
      this.vel.copy(this.dashDir).multiplyScalar(P.dashSpeed);
      this.jumpCut = false;
      this.ghostT = 0;
      const c = this.center;
      this.fx.ring(c, { color: COLOR.cyan, from: 0.4, to: 2.4, life: 0.25, normal: this.dashDir });
      this.fx.burst(c, { count: 18, color: COLOR.cyan, speed: 10, dir: _tmp.copy(this.dashDir).negate(), spread: 0.6, life: 0.35, size: 0.3 });
      this.events.shake(0.12);
    }

    // ---- Grapple fire ----
    // Holding the button grabs the next anchor that comes into view;
    // after a grapple ends you must release before it grabs again.
    if (!input.grappleHeld) g.needRelease = false;
    if ((input.grapplePressed || (input.grappleHeld && !g.needRelease))
        && !stunned && g.state === 'idle' && g.cd <= 0 && this.target) {
      cb.active = null;
      g.state = 'firing';
      g.anchor = this.target;
      g.t = 0;
      this.dashT = 0;
      this.airJumps = P.airJumps;
      this.dashCharges = P.dashCharges;
      this.fx.burst(g.anchor.pos, { count: 14, color: COLOR.violet, speed: 6, life: 0.35 });
    }
    if (g.state !== 'idle' && !input.grappleHeld) this.endGrapple(true);

    // Jump cancels a dash and keeps its momentum (dash-jump).
    if (this.dashing && this.jumpBuf > 0 && (this.grounded || this.coyote > 0 || this.airJumps > 0)) {
      this.dashT = 0;
      this.vel.copy(this.dashDir).multiplyScalar(Math.max(P.runSpeed, P.dashExitSpeed * 1.25));
    }

    // ---- Sword ----
    if (input.attackPressed && !stunned && !this.dashing && !this.grappling && cb.recover <= 0) {
      if (cb.active) cb.queued = true;
      else this.startAttack(wishLen);
    }

    if (this.dashing) {
      // Dash: fixed velocity, no gravity.
      this.dashT -= dt;
      this.vel.copy(this.dashDir).multiplyScalar(P.dashSpeed);
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.fx.afterimage({ color: COLOR.cyan, life: 0.28, alpha: 0.5 });
        this.ghostT = 0.03;
      }
      if (this.dashT <= 0) {
        const exit = this.grounded ? Math.max(P.runSpeed, P.dashExitSpeed) : P.dashExitSpeed;
        this.vel.copy(this.dashDir).multiplyScalar(exit);
        this.vel.y = 0;
      }
    } else if (g.state !== 'idle') {
      this.updateGrapple(dt);
    } else if (cb.active) {
      this.updateAttack(dt, wishLen);
    } else {
      this.updateLocomotion(dt, input, wishLen);
    }

    // ---- Integrate with sub-steps so fast moves never tunnel ----
    const speed = this.vel.length();
    const steps = Math.min(10, Math.max(1, Math.ceil((speed * dt) / 0.2)));
    const sdt = dt / steps;
    const impactVy = this.vel.y;
    for (let i = 0; i < steps; i++) {
      _prev.copy(this.pos);
      this.pos.addScaledVector(this.vel, sdt);
      resolve(this.pos, _prev, this.vel, P.radius, P.height, this.world.colliders);
    }

    // ---- Ground check ----
    this.ground = null;
    this.grounded = false;
    if (this.vel.y <= 0.01) {
      const c = probeGround(this.pos, P.radius, this.world.colliders, wasGrounded ? 0.35 : 0.06);
      if (c) {
        this.pos.y = c.yMax;
        this.vel.y = 0;
        this.grounded = true;
        this.ground = c;
        // Remember solid ground for respawns (moving platforms count; their collider moves with them).
        if (c.r >= 2.4) this.safeGround = c;
      }
    }

    if (this.grounded && !wasGrounded) this.onLand(impactVy);
    if (!this.grounded && wasGrounded && this.vel.y <= 0) this.coyote = P.coyoteTime;

    if (this.grounded && !this.dashing && this.dashCharges < P.dashCharges) {
      this.dashRecharge += dt;
      if (this.dashRecharge >= P.dashGroundRecharge) {
        this.dashRecharge = 0;
        this.dashCharges++;
      }
    } else {
      this.dashRecharge = 0;
    }

    if (this.pos.y < P.killY) this.fallOut();

    this.updateVisuals(dt, wishLen);
  }

  updateLocomotion(dt, input, wishLen) {
    const v = this.vel;
    const hx = v.x;
    const hz = v.z;
    const hSpeed = Math.hypot(hx, hz);

    if (this.grounded) {
      const tx = _wish.x * P.runSpeed;
      const tz = _wish.z * P.runSpeed;
      const rate = (wishLen > 0.05 ? P.groundAccel : P.groundFriction) * dt;
      const dx = tx - hx;
      const dz = tz - hz;
      const d = Math.hypot(dx, dz);
      if (d <= rate) { v.x = tx; v.z = tz; } else { v.x += (dx / d) * rate; v.z += (dz / d) * rate; }
    } else {
      const cap = Math.max(P.runSpeed, hSpeed);
      if (wishLen > 0.05) {
        v.x += _wish.x * P.airAccel * dt;
        v.z += _wish.z * P.airAccel * dt;
      } else if (hSpeed > 0) {
        const k = Math.max(0, hSpeed - P.airFriction * dt) / hSpeed;
        v.x *= k; v.z *= k;
      }
      let s = Math.hypot(v.x, v.z);
      if (s > cap) { v.x *= cap / s; v.z *= cap / s; s = cap; }
      if (s > P.runSpeed) {
        const ns = Math.max(P.runSpeed, s - P.overspeedDecay * dt);
        v.x *= ns / s; v.z *= ns / s;
      }
    }

    // Jump / double jump.
    if (this.jumpBuf > 0 && (this.grounded || this.coyote > 0)) {
      v.y = P.jumpVelocity;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.grounded = false;
      this.jumpCut = true;
      this.landSquash = -0.25;
      this.fx.ring(_tmp.copy(this.pos).setY(this.pos.y + 0.05), { color: COLOR.cyan, from: 0.3, to: 1.6, life: 0.3, alpha: 0.6 });
    } else if (input.jumpPressed && !this.grounded && this.airJumps > 0) {
      v.y = P.doubleJumpVelocity;
      this.airJumps--;
      this.jumpBuf = 0;
      this.jumpCut = true;
      this.landSquash = -0.3;
      // A double jump lets you change direction in the air.
      if (wishLen > 0.1) {
        const s = Math.max(P.runSpeed * wishLen, Math.hypot(v.x, v.z) * 0.85);
        v.x = _wish.x / wishLen * s;
        v.z = _wish.z / wishLen * s;
      }
      this.fx.ring(this.pos, { color: COLOR.violet, from: 0.4, to: 2.2, life: 0.35 });
      this.fx.burst(this.pos, { count: 16, color: COLOR.violet, speed: 6, dir: _tmp.set(0, -1, 0), spread: 0.9, life: 0.4, size: 0.28 });
    }

    // Variable jump height: releasing early cuts the rise.
    if (this.jumpCut && !input.jumpHeld && v.y > 0) {
      v.y *= P.jumpCutMult;
      this.jumpCut = false;
    }
    if (v.y <= 0) this.jumpCut = false;

    if (!this.grounded) {
      const gmul = v.y < 0 ? P.fallGravityMult : 1;
      v.y = Math.max(-P.maxFallSpeed, v.y - P.gravity * gmul * dt);
    }
  }

  // ---------- Sword ----------

  findAttackTarget() {
    const c = this.center;
    let best = null;
    let bestScore = Infinity;
    for (const t of this.targets()) {
      const surface = t.pos.distanceTo(c) - t.r;
      if (surface > COMBAT.assistRange) continue;
      const score = surface - (t.kind === 'weak' ? 3 : 0);
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  startAttack(wishLen) {
    const cb = this.combat;
    const air = !this.grounded;
    if (cb.idle > COMBAT.comboReset || cb.air !== air) cb.step = 0;
    const list = air ? COMBAT.air : COMBAT.ground;
    const def = list[cb.step];
    cb.step = (cb.step + 1) % list.length;
    Object.assign(cb, { active: def, air, t: 0, queued: false, idle: 0, slashed: false });
    cb.hitSet.clear();

    // Aim assist: turn toward (and lunge at) the nearest target in range.
    cb.target = this.findAttackTarget();
    const c = this.center;
    if (cb.target) {
      cb.dir.copy(cb.target.pos).sub(c);
      if (!air) cb.dir.y = 0;
    } else if (wishLen > 0.1) {
      cb.dir.copy(_wish);
    } else {
      cb.dir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    }
    if (cb.dir.lengthSq() < 1e-6) cb.dir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    cb.dir.normalize();
    this.facing = Math.atan2(cb.dir.x, cb.dir.z);

    if (def.plunge) {
      this.vel.set(cb.dir.x * 4, -COMBAT.plungeSpeed * 0.3, cb.dir.z * 4);
      this.fx.ring(c, { color: COLOR.cyan, from: 0.5, to: 2.5, life: 0.25 });
    } else if (air) {
      this.vel.y = Math.max(this.vel.y, COMBAT.airHover);
    }
  }

  updateAttack(dt) {
    const cb = this.combat;
    const def = cb.active;
    cb.t += dt;

    if (def.plunge) {
      // Accelerate into the dive, hitting everything on the way down.
      this.vel.y = Math.max(-COMBAT.plungeSpeed, this.vel.y - 160 * dt);
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.fx.afterimage({ color: COLOR.cyan, life: 0.25, alpha: 0.45 });
        this.ghostT = 0.035;
      }
      _hit.copy(this.center);
      _hit.y -= 0.5;
      this.attackHitCheck(def, _hit);
      if (cb.t > 1.6) cb.active = null; // fell past everything
      return;
    }

    const c = this.center;
    if (cb.t < def.hitStart) {
      // Wind-up: lunge toward the target unless already in reach.
      let speed = def.lunge;
      if (cb.target && cb.target.pos.distanceTo(c) - cb.target.r < def.reach * 0.7) speed = 0;
      this.vel.x = cb.dir.x * speed;
      this.vel.z = cb.dir.z * speed;
      if (cb.air) this.vel.y = cb.target ? cb.dir.y * speed + COMBAT.airHover * 0.5 : Math.max(this.vel.y, 0);
    } else {
      const k = Math.exp(-(cb.air ? 6 : 14) * dt);
      this.vel.x *= k;
      this.vel.z *= k;
    }
    if (!this.grounded) {
      const gmul = cb.air ? 0.25 : 1;
      this.vel.y = Math.max(-P.maxFallSpeed, this.vel.y - P.gravity * gmul * dt);
    }

    if (cb.t >= def.hitStart && !cb.slashed) {
      cb.slashed = true;
      _pt.copy(c).addScaledVector(cb.dir, 0.4);
      this.fx.slash(_pt, cb.dir, {
        roll: def.roll, flip: def.flip, radius: def.reach * 1.2,
        color: def.heavy ? 0x9ff4ff : COLOR.cyan, sweep: def.hitEnd - def.hitStart + 0.02,
      });
    }
    if (cb.t >= def.hitStart && cb.t <= def.hitEnd) {
      this.attackHitCheck(def, _hit.copy(c).addScaledVector(cb.dir, def.reach * 0.55));
    }
    if (cb.queued && cb.t >= def.cancel) {
      cb.active = null;
      this.startAttack(0);
      return;
    }
    if (cb.t >= def.dur) cb.active = null;
  }

  attackHitCheck(def, hitCenter) {
    const cb = this.combat;
    for (const t of this.targets()) {
      if (cb.hitSet.has(t.id)) continue;
      if (t.pos.distanceTo(hitCenter) > def.reach + t.r) continue;
      cb.hitSet.add(t.id);
      // Contact point on the target's surface, facing the player.
      _pt.copy(hitCenter).sub(t.pos);
      if (_pt.lengthSq() < 1e-6) _pt.set(0, 1, 0);
      _pt.setLength(Math.min(t.r, t.pos.distanceTo(hitCenter))).add(t.pos);
      this.events.onAttackHit(t, def, _pt.clone(), cb.dir.clone());
    }
  }

  // ---------- Taking damage ----------

  // Returns 'perfect' (dodged during dash i-frames), 'ignored' (still invulnerable) or 'hit'.
  takeDamage(dmg, from) {
    if (this.dead) return 'ignored';
    if (this.iframes > 0) return 'perfect';
    if (this.hurtT > 0) return 'ignored';
    this.hp = Math.max(0, this.hp - dmg);
    this.hurtT = P.hurtIFrames;
    this.stunT = P.hurtStun;
    this.combat.active = null;
    this.dashT = 0;
    if (this.grappling) this.endGrapple(false);
    _tmp.copy(this.pos).sub(from).setY(0);
    if (_tmp.lengthSq() < 1e-4) _tmp.set(Math.sin(this.facing), 0, Math.cos(this.facing)).negate();
    _tmp.normalize();
    this.vel.set(_tmp.x * 12, 9, _tmp.z * 12);
    this.grounded = false;
    if (this.hp <= 0) {
      this.dead = true;
      this.events.onDeath();
    }
    return 'hit';
  }

  findTarget(controlMode) {
    const cone = Math.cos(((controlMode === 'mobile' ? P.grappleConeDegTouch : P.grappleConeDeg) * Math.PI) / 180);
    let best = null;
    let bestScore = -Infinity;
    const c = this.center;
    for (const a of this.world.anchors) {
      if (!a.active) continue;
      const dist = a.pos.distanceTo(c);
      if (dist > P.grappleRange || dist < 3) continue;
      _tmp.copy(a.pos).sub(_camPos).normalize();
      const dot = _tmp.dot(_camDir);
      if (dot < cone) continue;
      const score = dot * 4 - dist / P.grappleRange;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  updateGrapple(dt) {
    const g = this.grapple;
    g.t += dt;
    const c = this.center;
    const dir = _dir.copy(g.anchor.pos).sub(c);
    const dist = dir.length();
    dir.normalize();

    if (g.state === 'firing') {
      // Hook is in flight: hang in the air briefly.
      this.vel.multiplyScalar(Math.exp(-6 * dt));
      this.vel.y -= P.gravity * 0.3 * dt;
      if (g.t >= P.grappleFireTime) {
        g.state = 'pulling';
        g.t = 0;
        this.fx.ring(g.anchor.pos, { color: COLOR.violet, from: 0.5, to: 4, life: 0.35, normal: dir });
        this.events.shake(0.1);
      }
      return;
    }

    // Pull toward the anchor, damping sideways motion so we don't orbit it.
    const along = this.vel.dot(dir);
    _tmp.copy(dir).multiplyScalar(along);
    _side.copy(this.vel).sub(_tmp).multiplyScalar(Math.exp(-5 * dt));
    this.vel.copy(_tmp).add(_side).addScaledVector(dir, P.grappleAccel * dt);
    if (this.vel.length() > P.grappleMaxSpeed) this.vel.setLength(P.grappleMaxSpeed);

    this.ghostT -= dt;
    if (this.ghostT <= 0) {
      this.fx.afterimage({ color: COLOR.violet, life: 0.22, alpha: 0.35 });
      this.ghostT = 0.05;
    }

    if (dist < P.grappleReleaseDist || g.t > P.grappleMaxTime) {
      // Arrived: pop upward and keep some momentum.
      this.vel.multiplyScalar(0.55);
      this.vel.y = Math.max(this.vel.y, P.grappleEndPop);
      this.fx.burst(g.anchor.pos, { count: 26, color: COLOR.violet, speed: 12, life: 0.45, size: 0.35 });
      this.fx.ring(g.anchor.pos, { color: COLOR.white, from: 0.5, to: 3.5, life: 0.3, normal: dir });
      this.events.shake(0.18);
      this.endGrapple(false);
    }
  }

  endGrapple(released) {
    const g = this.grapple;
    if (released && g.state === 'pulling') {
      // Slingshot: a small boost along the current velocity.
      const s = this.vel.length();
      if (s > 1) this.vel.multiplyScalar(Math.min(P.grappleMaxSpeed, s * 1.08) / s);
    }
    g.state = 'idle';
    g.anchor = null;
    g.cd = P.grappleCooldown;
    g.needRelease = true;
  }

  onLand(vy) {
    this.airJumps = P.airJumps;
    this.dashCharges = P.dashCharges;
    const cb = this.combat;
    if (cb.active?.plunge) {
      this.events.onPlungeLand(this.pos.clone(), cb.active);
      cb.active = null;
      cb.recover = 0.25;
      this.landSquash = 0.5;
      return;
    }
    if (cb.active) cb.air = false;
    const hard = Math.min(1, Math.max(0, (-vy - 10) / 30));
    this.landSquash = 0.15 + hard * 0.35;
    if (hard > 0) {
      this.fx.ring(_tmp.copy(this.pos).setY(this.pos.y + 0.05), { color: 0xbfd8ff, from: 0.5, to: 2 + hard * 4, life: 0.4, alpha: 0.4 + hard * 0.6 });
      this.fx.burst(_tmp, { count: Math.round(8 + hard * 24), color: 0x9fb6ff, speed: 4 + hard * 8, flat: true, life: 0.45, size: 0.3 });
      if (hard > 0.3) this.events.shake(hard * 0.35);
    }
  }

  fallOut() {
    this.events.flash('#b77dff', 0.6);
    this.events.shake(0.3);
    // Hard mode: the void costs HP.
    this.hp = Math.max(0, this.hp - P.fallDamage);
    this.events.onFall?.();
    if (this.hp <= 0) {
      this.dead = true;
      this.events.onDeath();
      return;
    }
    const hp = this.hp;
    this.respawn();
    this.hp = hp;
    this.hurtT = P.hurtIFrames;
  }

  updateVisuals(dt, wishLen) {
    const m = this.model;
    m.root.position.copy(this.pos);

    // Facing.
    let want = this.facing;
    if (this.dashing) want = Math.atan2(this.dashDir.x, this.dashDir.z);
    else if (this.grappling) want = Math.atan2(this.grapple.anchor.pos.x - this.pos.x, this.grapple.anchor.pos.z - this.pos.z);
    else if (Math.hypot(this.vel.x, this.vel.z) > 1 && wishLen > 0.05) want = Math.atan2(this.vel.x, this.vel.z);
    let d = want - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, dt * (this.dashing ? 30 : 14));
    m.root.rotation.y = this.facing;

    // Lean, squash and stretch.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const lean = this.grounded ? Math.min(0.25, hs / 50) : Math.min(0.5, hs / 60);
    m.body.rotation.x += ((this.dashing ? 0.6 : lean) - m.body.rotation.x) * Math.min(1, dt * 12);
    this.landSquash += (0 - this.landSquash) * Math.min(1, dt * 10);
    const stretch = this.grounded ? 0 : Math.max(-0.12, Math.min(0.15, this.vel.y / 120));
    const sy = 1 - this.landSquash + stretch;
    m.body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));

    // Run cycle.
    if (this.grounded && hs > 0.5) this.runPhase += dt * hs * 1.1;
    const swing = this.grounded ? Math.sin(this.runPhase) * Math.min(1, hs / P.runSpeed) * 0.9 : 0.5;
    m.legL.rotation.x = swing;
    m.legR.rotation.x = this.grounded ? -swing : -0.2;
    m.armL.rotation.x = -swing * 0.7;
    m.armR.rotation.x = this.grappling ? -2.6 : swing * 0.7;
    m.armR.rotation.z = 0;

    // Sword: drawn while fighting, sheathed otherwise.
    const cb = this.combat;
    const drawn = cb.active !== null || cb.idle < 0.8;
    m.handSword.visible = drawn;
    m.backSword.visible = !drawn;
    if (cb.active) {
      const def = cb.active;
      if (def.plunge) {
        m.armR.rotation.x = -2.9;
      } else {
        const k = THREE.MathUtils.smoothstep(cb.t, def.hitStart - 0.06, def.hitEnd);
        m.armR.rotation.x = THREE.MathUtils.lerp(-2.6, 0.4, k);
        m.armR.rotation.z = (def.flip ? -1 : 1) * Math.cos(def.roll) * THREE.MathUtils.lerp(0.9, -0.9, k);
      }
    }

    // Ribbon trail along the blade while it is swinging.
    let swinging = false;
    if (cb.active) {
      const def = cb.active;
      swinging = def.plunge || (cb.t >= def.hitStart - 0.05 && cb.t <= def.hitEnd + 0.04);
    }
    if (swinging) {
      m.root.updateMatrixWorld();
      m.handSword.localToWorld(_bladeBase.set(0, 0.2, 0));
      m.handSword.localToWorld(_bladeTip.set(0, 1.4, 0));
      this.trail.setColor(cb.active.heavy ? 0x9ff4ff : COLOR.cyan);
    }
    this.trail.update(dt, swinging, _bladeBase, _bladeTip);

    // Blink while recovering from a hit.
    m.root.visible = this.hurtT <= 0 || Math.floor(this.hurtT * 18) % 2 === 0;

    // Glow pulses while invulnerable.
    m.glow.emissiveIntensity = this.iframes > 0 ? 4 : this.grappling ? 2.8 : 1.8;

    // Drop shadow marker: always shows where you will land.
    const gy = groundHeightBelow(this.pos.x, this.pos.y, this.pos.z, this.world.colliders);
    if (gy > -Infinity) {
      const h = this.pos.y - gy;
      this.shadow.visible = true;
      this.shadow.position.set(this.pos.x, gy + 0.03, this.pos.z);
      this.shadow.scale.setScalar(Math.max(0.4, 1 - h / 30));
      this.shadow.material.opacity = Math.max(0.15, 0.5 - h / 60);
    } else {
      this.shadow.visible = false;
    }

    // Grapple rope.
    const g = this.grapple;
    if (g.state !== 'idle') {
      m.root.updateMatrixWorld();
      const hand = m.hand.getWorldPosition(_tmp);
      _tmp2.copy(g.anchor.pos).sub(hand);
      const full = _tmp2.length();
      const len = g.state === 'firing' ? full * Math.min(1, g.t / P.grappleFireTime) : full;
      this.rope.visible = true;
      this.rope.position.copy(hand);
      this.rope.quaternion.setFromUnitVectors(UP, _tmp2.normalize());
      this.rope.scale.set(1, len, 1);
    } else {
      this.rope.visible = false;
    }
  }
}
