import * as THREE from 'three';
import { OVERDRIVE as OD } from '../config.js';

// Overdrive sword waves: crescents of light launched by every swing while Overdrive is active.
// They fly straight, pass through platforms and hit each target at most once.

const OFFSET = 1.85; // distance from the group origin to the arc's leading edge
const arcGeo = new THREE.RingGeometry(1.3, 2.3, 40, 1, -1.05, 2.1);
const coreGeo = new THREE.RingGeometry(1.8, 2.0, 40, 1, -0.95, 1.9);
// Curved band standing on the arc, so the wave still reads when seen edge-on from behind.
const bandGeo = new THREE.CylinderGeometry(1.9, 1.9, 1.0, 40, 1, true, Math.PI / 2 - 1.0, 2.0).rotateX(Math.PI / 2);
const bandCoreGeo = new THREE.CylinderGeometry(1.92, 1.92, 0.28, 40, 1, true, Math.PI / 2 - 0.95, 1.9).rotateX(Math.PI / 2);
const UP = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

export const OD_COLOR = 0xc89bff;

export class SlashWaves {
  constructor(scene) {
    this.pool = [];
    for (let i = 0; i < 12; i++) {
      const group = new THREE.Group();
      const mat = (color, opacity) => new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const outer = new THREE.Mesh(arcGeo, mat(OD_COLOR, 0.75));
      const core = new THREE.Mesh(coreGeo, mat(0xffffff, 0.75));
      const band = new THREE.Mesh(bandGeo, mat(OD_COLOR, 0.6));
      const bandCore = new THREE.Mesh(bandCoreGeo, mat(0xffffff, 0.75));
      for (const m of [outer, core, band, bandCore]) { m.frustumCulled = false; group.add(m); }
      group.visible = false;
      scene.add(group);
      this.pool.push({ group, outer, core, band, bandCore, pos: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, alive: false, dmg: 0, hits: new Set() });
    }
    this.next = 0;
  }

  // roll tilts the crescent (0 = flat, PI/2 = upright), matching the swing.
  fire(origin, dir, roll, dmg) {
    const w = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    w.alive = true;
    w.dist = 0;
    w.dmg = dmg;
    w.hits.clear();
    w.pos.copy(origin);
    w.dir.copy(dir).normalize();
    // Basis: x = travel direction, z = arc plane normal (up rolled around x), y = z × x.
    _x.copy(w.dir);
    const ref = Math.abs(_x.y) > 0.95 ? _y.set(1, 0, 0) : UP;
    _z.copy(ref).addScaledVector(_x, -_x.dot(ref)).normalize();
    _z.applyAxisAngle(_x, roll);
    _y.crossVectors(_z, _x);
    _m.makeBasis(_x, _y, _z);
    w.group.quaternion.setFromRotationMatrix(_m);
    w.group.visible = true;
    return w;
  }

  get any() { return this.pool.some((w) => w.alive); }

  // targets: [{ id, pos, r }]; onHit(target, wave) is called once per target per wave.
  update(dt, targets, onHit) {
    for (const w of this.pool) {
      if (!w.alive) continue;
      const step = OD.wave.speed * dt;
      w.pos.addScaledVector(w.dir, step);
      w.dist += step;
      const k = w.dist / OD.wave.range;
      const s = 0.9 + k * 1.0;
      w.group.scale.setScalar(s);
      w.group.position.copy(w.pos).addScaledVector(w.dir, -OFFSET * s);
      const fade = k > 0.7 ? (1 - k) / 0.3 : 1;
      w.outer.material.opacity = 0.75 * fade;
      w.core.material.opacity = 0.75 * fade;
      w.band.material.opacity = 0.6 * fade;
      w.bandCore.material.opacity = 0.75 * fade;
      for (const t of targets) {
        if (w.hits.has(t.id)) continue;
        if (t.kind === 'weak' && w.hits.has('#weak')) continue; // one weak point per wave
        if (t.pos.distanceTo(w.pos) > OD.wave.radius * s + t.r) continue;
        w.hits.add(t.id);
        if (t.kind === 'weak') w.hits.add('#weak');
        onHit(t, w);
      }
      if (k >= 1) this.kill(w);
    }
  }

  kill(w) {
    w.alive = false;
    w.group.visible = false;
  }

  clear() { for (const w of this.pool) this.kill(w); }
}
