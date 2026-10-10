import { CAMERA } from '../config.js';

const capture = (el, e) => {
  try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
};

const DEAD = 0.18;
const deadzone = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

// Unified input state fed by keyboard/mouse, touch controls and gamepads.
// Gamepad (standard mapping): left stick move, right stick look, A jump, B / RB dash,
// X / RT attack, LB / LT grapple, Y Overdrive, R3 lock-on, Start pause, A confirms in menus.
// Gameplay code only reads the fields below; it never touches DOM events.
export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;

    this.move = { x: 0, y: 0 }; // x = right, y = forward, length <= 1
    this.lookX = 0; // radians accumulated this frame
    this.lookY = 0;
    this.jumpHeld = false;
    this.jumpPressed = false;
    this.dashPressed = false;
    this.grappleHeld = false;
    this.grapplePressed = false;
    this.attackPressed = false;
    this.lockPressed = false;
    this.overdrivePressed = false;

    this.enabled = false;
    this.pointerLocked = false;
    this.lockAcquired = false; // pointer lock worked at least once this session
    this.skipMoves = 0;
    this.mouseGrapple = false;
    this.dragLook = false; // mouse-drag fallback when pointer lock is unavailable
    this.onPauseRequest = null;
    this.onGamepadStart = null; // Start button
    this.onGamepadConfirm = null; // A button while in a menu
    this.pad = { prev: [], move: { x: 0, y: 0 }, jump: false, grapple: false, lastT: performance.now() };

    this.keys = new Set();
    this.stick = { id: null, x: 0, y: 0, ox: 0, oy: 0 };
    this.lookTouches = new Map();
    this.touchButtons = { jump: false, grapple: false };

    this.bindKeyboard();
    this.bindMouse();
    this.bindTouch();

    const releaseAll = () => this.releaseAll();
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', releaseAll);
  }

  get sens() { return this.settings.get('sensitivity'); }
  get ySign() { return this.settings.get('invertY') ? -1 : 1; }

  releaseAll() {
    this.keys.clear();
    this.stick.id = null;
    this.stick.x = this.stick.y = 0;
    this.lookTouches.clear();
    this.touchButtons.jump = this.touchButtons.grapple = false;
    this.mouseGrapple = false;
    this.dragLook = false;
    document.querySelectorAll('.tbtn.down').forEach((b) => b.classList.remove('down'));
    const base = document.getElementById('stick-base');
    base?.classList.remove('active');
    base?.removeAttribute('style');
    const knob = document.getElementById('stick-knob');
    if (knob) knob.style.transform = '';
  }

  // ---------- Keyboard ----------
  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        // With pointer lock, the browser exits lock itself and we pause from the lockchange event.
        if (!this.pointerLocked) this.onPauseRequest?.();
        return;
      }
      if (!this.enabled) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpPressed = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.dashPressed = true;
      if (e.code === 'KeyQ' || e.code === 'KeyE') this.grapplePressed = true;
      if (e.code === 'KeyJ') this.attackPressed = true;
      if (e.code === 'Tab' || e.code === 'KeyR') this.lockPressed = true;
      if (e.code === 'KeyF') this.overdrivePressed = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  // ---------- Mouse ----------
  bindMouse() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === c;
      this.skipMoves = 2; // browsers report a bogus jump right after (un)locking
      if (this.pointerLocked) this.lockAcquired = true;
      else if (this.enabled && this.lockAcquired && this.settings.controlMode === 'pc') this.onPauseRequest?.();
    });

    c.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.settings.controlMode !== 'pc') return;
      if (!this.pointerLocked) {
        this.requestLock();
        this.dragLook = true;
      }
      if (e.button === 0) this.attackPressed = true;
      if (e.button === 1) { e.preventDefault(); this.lockPressed = true; }
      if (e.button === 2) {
        this.mouseGrapple = true;
        this.grapplePressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.mouseGrapple = false;
      this.dragLook = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || this.settings.controlMode !== 'pc') return;
      if (!this.pointerLocked && !this.dragLook) return;
      if (this.skipMoves > 0) { this.skipMoves--; return; }
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      const k = CAMERA.mouseSens * this.sens;
      this.lookX += e.movementX * k;
      this.lookY += e.movementY * k * this.ySign;
    });
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      p?.catch?.(() => {});
    } catch { /* lock not allowed here (e.g. iframe); drag-look fallback covers it */ }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---------- Touch ----------
  bindTouch() {
    const stickZone = document.getElementById('stick-zone');
    const lookZone = document.getElementById('look-zone');
    const base = document.getElementById('stick-base');
    const knob = document.getElementById('stick-knob');
    const R = 56;

    stickZone.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== null) return;
      capture(stickZone, e);
      this.stick.id = e.pointerId;
      this.stick.ox = e.clientX;
      this.stick.oy = e.clientY;
      const rect = stickZone.getBoundingClientRect();
      base.style.left = `${e.clientX - rect.left}px`;
      base.style.top = `${e.clientY - rect.top}px`;
      base.style.bottom = 'auto';
      base.style.marginTop = '-64px';
      base.classList.add('active');
    });
    stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.ox;
      let dy = e.clientY - this.stick.oy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // Small dead zone, then full range.
      const m = Math.min(len, R) / R;
      const mag = m < 0.12 ? 0 : (m - 0.12) / 0.88;
      this.stick.x = len > 0 ? (dx / len) * mag : 0;
      this.stick.y = len > 0 ? (-dy / len) * mag : 0;
    });
    const endStick = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = null;
      this.stick.x = this.stick.y = 0;
      knob.style.transform = '';
      base.classList.remove('active');
      base.removeAttribute('style');
    };
    stickZone.addEventListener('pointerup', endStick);
    stickZone.addEventListener('pointercancel', endStick);

    lookZone.addEventListener('pointerdown', (e) => {
      capture(lookZone, e);
      this.lookTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    lookZone.addEventListener('pointermove', (e) => {
      const t = this.lookTouches.get(e.pointerId);
      if (!t || !this.enabled) return;
      const k = CAMERA.touchSens * this.sens;
      this.lookX += (e.clientX - t.x) * k;
      this.lookY += (e.clientY - t.y) * k * this.ySign;
      t.x = e.clientX;
      t.y = e.clientY;
    });
    const endLook = (e) => this.lookTouches.delete(e.pointerId);
    lookZone.addEventListener('pointerup', endLook);
    lookZone.addEventListener('pointercancel', endLook);

    for (const btn of document.querySelectorAll('.tbtn')) {
      const action = btn.dataset.action;
      btn.addEventListener('pointerdown', (e) => {
        capture(btn, e);
        btn.classList.add('down');
        if (!this.enabled) return;
        if (action === 'jump') { this.jumpPressed = true; this.touchButtons.jump = true; }
        if (action === 'dash') this.dashPressed = true;
        if (action === 'attack') this.attackPressed = true;
        if (action === 'lock') this.lockPressed = true;
        if (action === 'overdrive') this.overdrivePressed = true;
        if (action === 'grapple') { this.grapplePressed = true; this.touchButtons.grapple = true; }
      });
      const up = () => {
        btn.classList.remove('down');
        if (action === 'jump') this.touchButtons.jump = false;
        if (action === 'grapple') this.touchButtons.grapple = false;
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  pollGamepad() {
    const pad = this.pad;
    const now = performance.now();
    const dt = Math.min(0.05, (now - pad.lastT) / 1000);
    pad.lastT = now;
    pad.move.x = pad.move.y = 0;
    pad.jump = pad.grapple = false;
    let gp = null;
    try {
      for (const p of navigator.getGamepads?.() || []) if (p && p.connected) { gp = p; break; }
    } catch { /* not allowed in this frame */ }
    if (!gp) return;
    const down = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    const hit = (i) => down[i] && !pad.prev[i];
    pad.prev = down;
    if (hit(9)) this.onGamepadStart?.();
    if (!this.enabled) {
      if (hit(0)) this.onGamepadConfirm?.();
      return;
    }
    pad.move.x = deadzone(gp.axes[0] || 0);
    pad.move.y = -deadzone(gp.axes[1] || 0);
    const rx = deadzone(gp.axes[2] || 0);
    const ry = deadzone(gp.axes[3] || 0);
    // Response curve: fine control near the centre, fast turns at full tilt.
    this.lookX += rx * Math.abs(rx) * 3.2 * this.sens * dt;
    this.lookY += ry * Math.abs(ry) * 2.2 * this.sens * dt * this.ySign;
    pad.jump = down[0];
    pad.grapple = down[4] || down[6];
    if (hit(0)) this.jumpPressed = true;
    if (hit(1) || hit(5)) this.dashPressed = true;
    if (hit(2) || hit(7)) this.attackPressed = true;
    if (hit(4) || hit(6)) this.grapplePressed = true;
    if (hit(3)) this.overdrivePressed = true;
    if (hit(11) || hit(10)) this.lockPressed = true;
  }

  // Called once per frame before gameplay reads the state.
  update() {
    this.pollGamepad();
    const k = this.keys;
    let x = this.pad.move.x;
    let y = this.pad.move.y;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    x += this.stick.x;
    y += this.stick.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.move.x = x;
    this.move.y = y;

    this.jumpHeld = k.has('Space') || this.touchButtons.jump || this.pad.jump;
    this.grappleHeld = k.has('KeyQ') || k.has('KeyE') || this.mouseGrapple || this.touchButtons.grapple || this.pad.grapple;
  }

  // Called at the end of each frame: clears one-shot events.
  endFrame() {
    this.lookX = 0;
    this.lookY = 0;
    this.jumpPressed = false;
    this.dashPressed = false;
    this.grapplePressed = false;
    this.attackPressed = false;
    this.lockPressed = false;
    this.overdrivePressed = false;
  }
}
