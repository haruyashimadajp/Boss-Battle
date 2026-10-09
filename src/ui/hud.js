import * as THREE from 'three';
import { PLAYER as P } from '../config.js';

const _v = new THREE.Vector3();

export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.reticle = document.getElementById('reticle');
    this.flashEl = document.getElementById('flash');
    this.fpsEl = document.getElementById('fps');
    this.dashPips = this.makePips('dash-pips', P.dashCharges);
    this.airPips = this.makePips('air-pips', P.airJumps);
    this.frames = 0;
    this.fpsTime = 0;
  }

  makePips(id, n) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    return Array.from({ length: n }, () => {
      const pip = document.createElement('div');
      pip.className = 'pip full';
      el.appendChild(pip);
      return pip;
    });
  }

  show(on) { this.root.hidden = !on; }
  showFps(on) { this.fpsEl.hidden = !on; }

  flash(color = '#ffffff', alpha = 0.6) {
    const f = this.flashEl;
    f.style.transition = 'none';
    f.style.background = color;
    f.style.opacity = alpha;
    void f.offsetWidth; // restart the fade
    f.style.transition = '';
    f.style.opacity = 0;
  }

  update(dt, player, camera) {
    this.dashPips.forEach((p, i) => p.classList.toggle('full', i < player.dashCharges));
    this.airPips.forEach((p, i) => p.classList.toggle('full', i < player.airJumps));

    const a = player.grappling ? player.grapple.anchor : player.target;
    if (a) {
      _v.copy(a.pos).project(camera);
      const visible = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
      this.reticle.style.transform = `translate(${x}px, ${y}px)`;
      this.reticle.classList.toggle('on', visible);
      this.reticle.classList.toggle('active', player.grappling);
    } else {
      this.reticle.classList.remove('on', 'active');
    }

    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fpsEl.textContent = `${Math.round(this.frames / this.fpsTime)} FPS`;
      this.frames = 0;
      this.fpsTime = 0;
    }
  }
}
