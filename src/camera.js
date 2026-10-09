import * as THREE from 'three';
import { CAMERA as C, PLAYER as P } from './config.js';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const _off = new THREE.Vector3();
const _want = new THREE.Vector3();

// Third-person orbit camera with wall avoidance, speed FOV kick and trauma shake.
export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;
    this.pitch = 0.22;
    this.dist = C.distance;
    this.focus = new THREE.Vector3();
    this.trauma = 0;
    this.fov = C.fov;
    this.t = 0;
    this.ray = new THREE.Raycaster();
  }

  snap(player) {
    this.focus.copy(player.pos).y += C.height;
    this.yaw = 0;
    this.pitch = 0.22;
    this.dist = C.distance;
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt, player, input) {
    this.t += dt;
    this.yaw -= input.lookX;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookY, C.pitchMin, C.pitchMax);

    // Follow: tight horizontally, softer vertically so jumps don't jerk the view.
    const tx = player.pos.x;
    const ty = player.pos.y + C.height;
    const tz = player.pos.z;
    this.focus.x = damp(this.focus.x, tx, 22, dt);
    this.focus.z = damp(this.focus.z, tz, 22, dt);
    this.focus.y = damp(this.focus.y, ty, player.grounded ? 14 : 7, dt);

    const cp = Math.cos(this.pitch);
    _off.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // Pull in when geometry is between the player and the camera.
    let want = C.distance;
    this.ray.set(this.focus, _off);
    this.ray.far = C.distance + 0.5;
    const hit = this.ray.intersectObjects(this.world.solids, false)[0];
    if (hit) want = Math.max(C.minDistance, hit.distance - 0.45);
    this.dist = want < this.dist ? want : damp(this.dist, want, 5, dt);

    _want.copy(this.focus).addScaledVector(_off, this.dist);
    this.camera.position.copy(_want);
    this.camera.lookAt(this.focus);

    // Speed-based FOV kick.
    const speed = player.vel.length();
    const k = THREE.MathUtils.clamp((speed - P.runSpeed) / (P.grappleMaxSpeed - P.runSpeed), 0, 1);
    const targetFov = C.fov + C.fovBoost * (player.dashing ? 1 : k);
    this.fov = damp(this.fov, targetFov, player.dashing ? 18 : 6, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    this.applyShake(dt);
  }

  // Slow cinematic orbit used behind the title screen.
  updateTitle(dt, t) {
    const a = t * 0.06;
    this.camera.position.set(Math.sin(a) * 72, 26 + Math.sin(t * 0.2) * 4, Math.cos(a) * 72);
    this.camera.lookAt(0, 22, 0);
    if (this.camera.fov !== C.fov) {
      this.camera.fov = C.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  applyShake(dt) {
    if (this.trauma <= 0) return;
    const s = this.trauma * this.trauma;
    const t = this.t * 40;
    const n = (o) => Math.sin(t * 1.0 + o) * 0.6 + Math.sin(t * 2.3 + o * 1.7) * 0.4;
    this.camera.position.x += n(1) * s * 0.5;
    this.camera.position.y += n(2) * s * 0.5;
    this.camera.position.z += n(3) * s * 0.5;
    this.camera.rotateZ(n(4) * s * 0.05);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
  }
}
