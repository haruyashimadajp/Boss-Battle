import * as THREE from 'three';
import { PLAYER as P, BOSS } from '../config.js';

const _v = new THREE.Vector3();

export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.status = document.getElementById('status');
    this.reticle = document.getElementById('reticle');
    this.flashEl = document.getElementById('flash');
    this.fpsEl = document.getElementById('fps');
    this.hpPips = this.makePips('hp-pips', P.maxHp);
    this.dashPips = this.makePips('dash-pips', P.dashCharges);
    this.airPips = this.makePips('air-pips', P.airJumps);
    this.frames = 0;
    this.fpsTime = 0;
    this.lastHp = P.maxHp;
    this.flashScale = 1;

    this.bossBar = document.getElementById('boss-bar');
    this.bossFill = this.bossBar.querySelector('.boss-hp-fill');
    this.bossTrail = this.bossBar.querySelector('.boss-hp-trail');
    this.breakFill = this.bossBar.querySelector('.boss-break-fill');
    this.bossBar.querySelector('.boss-hp-mark').style.left = `${BOSS.phase1End * 100}%`;
    this.trail = 1;
    this.trailHold = 0;

    this.comboEl = document.getElementById('combo');
    this.comboNum = this.comboEl.querySelector('b');
    this.bannerEl = document.querySelector('#banner span');

    this.dmgLayer = document.getElementById('dmg-layer');
    this.dmgPool = Array.from({ length: 24 }, () => {
      const el = document.createElement('div');
      el.className = 'dmg';
      el.hidden = true;
      this.dmgLayer.appendChild(el);
      return { el, pos: new THREE.Vector3(), t: 0, life: 0.8, alive: false, dx: 0 };
    });
    this.dmgNext = 0;
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
  showBoss(on) { this.bossBar.hidden = !on; }

  flash(color = '#ffffff', alpha = 0.6) {
    const f = this.flashEl;
    f.style.transition = 'none';
    f.style.background = color;
    f.style.opacity = alpha * this.flashScale;
    void f.offsetWidth; // restart the fade
    f.style.transition = '';
    f.style.opacity = 0;
  }

  banner(text, cls = '', duration = 1.2) {
    const b = this.bannerEl;
    b.className = '';
    b.textContent = text;
    b.style.setProperty('--d', `${duration}s`);
    void b.offsetWidth;
    b.className = `show ${cls}`;
  }

  combo(n) {
    this.comboNum.textContent = n;
    this.comboEl.classList.toggle('on', n >= 2);
    this.comboEl.classList.remove('bump');
    void this.comboEl.offsetWidth;
    if (n >= 2) this.comboEl.classList.add('bump');
  }

  // Floating damage number at a world position.
  damage(pos, text, cls = '') {
    const d = this.dmgPool[this.dmgNext];
    this.dmgNext = (this.dmgNext + 1) % this.dmgPool.length;
    d.pos.copy(pos);
    d.el.textContent = text;
    d.el.className = `dmg ${cls}`;
    d.t = 0;
    d.life = cls === 'crit' ? 1.0 : 0.8;
    d.dx = (Math.random() - 0.5) * 40;
    d.alive = true;
    d.el.hidden = false;
  }

  update(dt, player, camera, boss) {
    if (player.hp < this.lastHp) {
      this.status.classList.remove('hurt');
      void this.status.offsetWidth;
      this.status.classList.add('hurt');
    }
    this.lastHp = player.hp;
    this.hpPips.forEach((p, i) => p.classList.toggle('full', i < player.hp));
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
      this.reticle.classList.toggle('weak', a.kind === 'weak');
    } else {
      this.reticle.classList.remove('on', 'active');
    }

    if (boss && !this.bossBar.hidden) {
      const hp = boss.hp / BOSS.maxHp;
      // White trail catches up with the HP bar after a short delay.
      if (hp < this.trail) {
        this.trailHold -= dt;
        if (this.trailHold <= 0) this.trail = Math.max(hp, this.trail - dt * 0.25);
      } else {
        this.trail = hp;
        this.trailHold = 0.5;
      }
      if (hp < this.lastBossHp) this.trailHold = 0.5;
      this.lastBossHp = hp;
      this.bossFill.style.transform = `scaleX(${hp})`;
      this.bossTrail.style.transform = `scaleX(${this.trail})`;
      const broken = boss.state === 'broken';
      this.bossBar.classList.toggle('broken', broken);
      const g = broken ? 1 - boss.stateT / BOSS.breakDuration : boss.breakGauge;
      this.breakFill.style.transform = `scaleX(${Math.max(0, g)})`;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const d of this.dmgPool) {
      if (!d.alive) continue;
      d.t += dt;
      if (d.t >= d.life) { d.alive = false; d.el.hidden = true; continue; }
      _v.copy(d.pos).project(camera);
      if (_v.z > 1) { d.el.hidden = true; continue; }
      const k = d.t / d.life;
      const x = (_v.x * 0.5 + 0.5) * w + d.dx * k;
      const y = (-_v.y * 0.5 + 0.5) * h - 50 * (1 - (1 - k) ** 2);
      const s = k < 0.12 ? 1.6 - k * 5 : 1;
      d.el.hidden = false;
      d.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${s})`;
      d.el.style.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
    }

    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fpsEl.textContent = `${Math.round(this.frames / this.fpsTime)} FPS`;
      this.frames = 0;
      this.fpsTime = 0;
    }
  }

  resetBoss() {
    this.trail = 1;
    this.lastBossHp = 1;
  }
}
