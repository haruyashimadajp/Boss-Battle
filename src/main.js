import * as THREE from 'three';
import { Settings } from './settings.js';
import { Input } from './input/input.js';
import { buildWorld } from './world/arena.js';
import { Player } from './player/player.js';
import { Boss } from './boss/boss.js';
import { CameraRig } from './camera.js';
import { FX } from './fx/fx.js';
import { Post } from './fx/post.js';
import { HUD } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { CAMERA, BOSS, PLAYER } from './config.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 2000);

const settings = new Settings();
const world = buildWorld(scene);
const fx = new FX(scene);
const rig = new CameraRig(camera, world);
const hud = new HUD();
const post = new Post(renderer, scene, camera, world);
const input = new Input(canvas, settings);

const game = { state: 'title', time: 0, timeScale: 1 };
// Per-fight state: hitstop, perfect-dodge slow-mo, ending sequence and stats.
const fight = { hitstop: 0, witch: 0, ending: null, combo: 0, comboT: 0, stats: null, perfected: new WeakSet() };
let menus = null;

const camNormal = new THREE.Vector3();
const _v = new THREE.Vector3();
const _core = new THREE.Vector3();
const _cam = new THREE.Vector3();
const INTRO_TIME = 4.0;
const BOSS_NAME = 'SERAPH OF THE BROKEN SUN';

// ---------- Hit feedback helpers ----------
const hitstop = (s) => { fight.hitstop = Math.max(fight.hitstop, s); };

function addCombo() {
  fight.combo += 1;
  fight.comboT = 2.5;
  fight.stats.maxCombo = Math.max(fight.stats.maxCombo, fight.combo);
  hud.combo(fight.combo);
}

function showDamage(point, res) {
  const cls = res.crit ? 'crit' : res.weak ? 'weak' : '';
  hud.damage(point, res.crit ? `${res.amount}!` : `${res.amount}`, cls);
  fight.stats.dealt += res.amount;
}

// ---------- Player ----------
const player = new Player(scene, world, fx, {
  shake: (a) => rig.shake(a),
  flash: (c, a) => hud.flash(c, a),
  onAttackHit,
  onPlungeLand,
  onDeath: () => endFight(false),
  onFall: () => { fight.stats.damageTaken += PLAYER.fallDamage; },
});

function onAttackHit(target, def, point, dir) {
  if (target.kind === 'orb') {
    target.hazard.reflectOrb(target.ref);
    hitstop(0.05);
    rig.shake(0.12);
    fx.burst(point, { count: 14, color: 0x46e6ff, speed: 10, life: 0.3, size: 0.35 });
    fight.stats.reflects++;
    addCombo();
    return;
  }
  const res = boss.takeHit(target.kind, def.dmg, target.ref);
  if (!res) return;
  const color = res.crit ? 0xffffff : res.weak ? 0xff3d6e : 0xffc061;
  hitstop(def.hitstop + (res.crit ? 0.04 : 0));
  rig.shake(def.shake + (res.crit ? 0.1 : 0));
  _v.copy(dir).negate();
  fx.burst(point, { count: def.heavy ? 42 : 24, color, speed: def.heavy ? 20 : 13, dir: _v, spread: 1.2, life: 0.42, size: 0.42, gravity: 8 });
  fx.burst(point, { count: 10, color: 0xffffff, speed: 8, life: 0.2, size: 0.3 });
  fx.ring(point, { color, from: 0.3, to: def.heavy ? 4.5 : 2.6, life: 0.22, normal: camNormal });
  if (def.heavy || res.crit || res.weak) post.pulse(def.heavy || res.crit ? 0.7 : 0.35);
  if (def.heavy || res.crit) post.shockwave(point, { strength: 0.6, speed: 1.4, life: 0.3 });
  showDamage(point, res);
  addCombo();
}

function onPlungeLand(pos, def) {
  fx.ring(_v.copy(pos).setY(pos.y + 0.1), { color: 0x9ff4ff, from: 0.5, to: def.landRadius * 2.2, life: 0.4 });
  fx.ring(_v, { color: 0xffffff, from: 0.3, to: def.landRadius * 1.2, life: 0.25 });
  fx.burst(_v, { count: 50, color: 0x46e6ff, speed: 18, flat: true, life: 0.5, size: 0.5, gravity: 6 });
  rig.shake(def.shake);
  hitstop(0.08);
  post.pulse(0.6);
  post.shockwave(_v, { strength: 1.0, speed: 1.0, life: 0.45 });
  for (const t of boss.getTargets([])) {
    if (t.pos.distanceTo(pos) > def.landRadius + t.r) continue;
    if (t.kind === 'orb') { t.hazard.reflectOrb(t.ref); continue; }
    const res = boss.takeHit(t.kind, def.landDmg, t.ref);
    if (res) {
      showDamage(_v.copy(t.pos).lerp(pos, t.kind === 'core' ? 0.6 : 0), res);
      addCombo();
      hitstop(def.hitstop);
    }
  }
}

// ---------- Boss ----------
const boss = new Boss(scene, world, fx, {
  onBreak: () => {
    hud.banner('BREAK!', 'break', 1.6);
    hud.flash('#ffffff', 0.55);
    hitstop(0.25);
    rig.shake(0.7);
    post.pulse(1.2);
    fight.stats.breaks++;
  },
  onBreakEnd: () => hud.banner('RECOVERED', 'bad', 1.0),
  onWeakDestroyed: () => {
    hud.banner('WEAK POINT DESTROYED', 'weak', 1.4);
    hitstop(0.18);
    rig.shake(0.5);
    post.pulse(0.9);
  },
  onPhaseClear: () => endFight(true),
  onIntroDone: () => {},
});

boss.ctx = {
  scene, fx, world, boss, player, camNormal,
  hitPlayer,
  shake: (a) => rig.shake(a),
  shockwave: (pos, o) => post.shockwave(pos, o),
  impactFlash: (dist) => { if (dist < 25) hud.flash('#ffd8a0', 0.25); },
  onReflectHit: () => {
    const res = boss.takeHit('reflect', BOSS.reflectDmg);
    if (!res) return;
    boss.getCorePos(_v);
    showDamage(_v, res);
    hitstop(0.08);
    rig.shake(0.25);
    addCombo();
  },
};
player.targets = () => boss.getTargets([]);
const _lock = new THREE.Vector3();
rig.lockTarget = () => (boss.active ? boss.getCorePos(_lock) : null);

// Boss attack reaches the player. Returns 'hit' | 'perfect' | 'ignored'.
function hitPlayer(dmg, from, source) {
  if (game.state !== 'playing' || fight.ending) return 'ignored';
  const r = player.takeDamage(dmg, from);
  if (r === 'perfect') {
    if (!fight.perfected.has(source)) {
      fight.perfected.add(source);
      perfectDodge();
    }
  } else if (r === 'hit') {
    fight.stats.damageTaken += dmg;
    hitstop(0.12);
    rig.shake(0.6);
    hud.flash('#ff2d55', 0.45);
    post.pulse(1.3);
    fx.burst(player.center, { count: 30, color: 0xff2d55, speed: 12, life: 0.4, size: 0.4 });
    hud.damage(_v.copy(player.pos).setY(player.pos.y + 2.2), `-${dmg}`, 'player');
    fight.combo = 0;
    hud.combo(0);
  }
  return r;
}

function perfectDodge() {
  fight.witch = BOSS.perfectSlowmo;
  fight.stats.perfects++;
  player.dashCharges = PLAYER.dashCharges;
  player.airJumps = PLAYER.airJumps;
  hud.banner('PERFECT DODGE', 'perfect', 1.0);
  fx.ring(player.center, { color: 0x46e6ff, from: 0.5, to: 7, life: 0.45, normal: camNormal });
  fx.burst(player.center, { count: 30, color: 0x9ff4ff, speed: 14, life: 0.5, size: 0.35 });
  post.pulse(0.6);
  post.shockwave(player.center, { strength: 0.9, speed: 1.1, life: 0.5 });
  hitstop(0.05);
}

// ---------- Fight flow ----------
function newStats() {
  return { start: game.time, time: 0, dealt: 0, damageTaken: 0, perfects: 0, maxCombo: 0, reflects: 0, breaks: 0 };
}

function setState(state) {
  game.state = state;
  input.enabled = state === 'playing';
  menus.setState(state);
  hud.show(state === 'playing' || state === 'paused');
  hud.showBoss(state === 'playing' || state === 'paused');
}

function setCinematic(on, skippable = false) {
  document.body.classList.toggle('cinematic', on);
  document.body.classList.toggle('skippable', on && skippable);
}

function start() {
  player.respawn(true);
  boss.reset();
  rig.snap(player);
  Object.assign(fight, {
    hitstop: 0, witch: 0, ending: null, combo: 0, comboT: 0, stats: newStats(), perfected: new WeakSet(),
    cine: { kind: 'intro', t: 0 }, skipReq: false,
  });
  game.timeScale = 1;
  hud.resetBoss();
  hud.combo(0);
  resume();
  setCinematic(true, true);
}

// Boss reveal finished (or skipped): hand the camera back to the player.
function endIntro() {
  const c = fight.cine;
  if (!c.bossStarted) {
    boss.start();
    hud.banner(BOSS_NAME, 'gold', 2.2);
  }
  fight.cine = null;
  fight.stats.start = game.time;
  setCinematic(false);
  rig.snap(player);
  rig.lookIdle = 99;
}

// Camera paths for the intro, the phase-clear beat and defeat.
function cinematicCamera(c) {
  const core = boss.getCorePos(_core);
  let fov = 52;
  if (c.kind === 'intro') {
    if (c.t < 1.5) {
      // Low angle behind the player: their silhouette against the boss.
      const k = c.t / 1.5;
      _cam.set(player.pos.x + 1.3 - k * 0.3, player.pos.y + 0.7 + k * 0.3, player.pos.z + 3.2 - k * 0.6);
      _v.set(player.pos.x, player.pos.y + 1.6, player.pos.z).lerp(core, 0.45);
      camera.position.copy(_cam);
      camera.lookAt(_v);
      fov = 62 - k * 6;
    } else {
      // Cut to a crane shot circling the boss.
      const k = (c.t - 1.5) / (INTRO_TIME - 1.5);
      const a = 0.55 + k * 0.8;
      const r = 48 - k * 8;
      _cam.set(core.x + Math.sin(a) * r, core.y - 8 + k * 10, core.z + Math.cos(a) * r);
      fov = 46;
      camera.position.copy(_cam);
      camera.lookAt(core);
    }
  } else if (c.kind === 'clear') {
    const a = c.base + c.t * 0.35;
    camera.position.set(core.x + Math.sin(a) * 52, core.y + 6, core.z + Math.cos(a) * 52);
    camera.lookAt(core);
  } else {
    // Defeat: pull up and away from the fallen player.
    camera.position.set(player.pos.x + 1, player.pos.y + 3 + c.t * 3, player.pos.z + 5 + c.t * 2);
    camera.lookAt(player.pos);
    fov = 60;
  }
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  rig.applyShake(1 / 60);
}

function resume() {
  setState('playing');
  if (settings.controlMode === 'pc') input.requestLock();
  else {
    try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {}); } catch { /* optional */ }
  }
}

function pause() {
  if (game.state !== 'playing' || fight.ending) return;
  input.releaseAll();
  setState('paused');
  input.exitLock();
}

function toTitle() {
  input.exitLock();
  boss.reset();
  fight.cine = null;
  setCinematic(false);
  setState('title');
}

// Win (phase cleared) or lose: slow-motion beat, then the result screen.
function endFight(win) {
  if (fight.ending) return;
  fight.stats.time = (game.time - fight.stats.start);
  fight.ending = { win, t: win ? 2.8 : 2.0 };
  game.timeScale = win ? 0.3 : 0.25;
  fight.witch = 0;
  fight.cine = { kind: win ? 'clear' : 'dead', t: 0, base: Math.atan2(player.pos.x, player.pos.z) + 0.6 };
  setCinematic(true);
  if (win) {
    hud.banner('PHASE 1 CLEAR', 'gold', 2.4);
    hud.flash('#ffffff', 0.8);
    rig.shake(0.9);
    post.pulse(1.5);
    boss.getCorePos(_v);
    fx.burst(_v, { count: 120, color: 0xffc061, speed: 30, life: 1.2, size: 0.8 });
    fx.ring(_v, { color: 0xffffff, from: 2, to: 30, life: 0.9, normal: camNormal });
  } else {
    hud.banner('DEFEATED', 'bad', 1.8);
    hud.flash('#ff2d55', 0.6);
    post.pulse(1.5);
    boss.cancelHazards();
  }
}

function rankFor(s) {
  const score = 100 - s.time / 3 - s.damageTaken * 12 + s.perfects * 4 + Math.min(10, s.maxCombo / 3);
  if (score >= 80) return 'S';
  if (score >= 60) return 'A';
  if (score >= 40) return 'B';
  if (score >= 20) return 'C';
  return 'D';
}

function showResult(win) {
  const s = fight.stats;
  const m = Math.floor(s.time / 60);
  const sec = (s.time % 60).toFixed(1).padStart(4, '0');
  const bossLeft = Math.round(((boss.hp - boss.phaseEndHp) / (BOSS.maxHp - boss.phaseEndHp)) * 100);
  const rows = [
    ['Time', `${m}:${sec}`],
    ['Damage taken', `${s.damageTaken}`],
    ['Perfect dodges', `${s.perfects}`],
    ['Max combo', `${s.maxCombo}`],
  ];
  if (!win) rows.push(['Phase 1 HP left', `${bossLeft}%`]);
  else rows.push(['Breaks', `${s.breaks}`]);
  fight.cine = null;
  setCinematic(false);
  menus.showResult({ win, rank: win ? rankFor(s) : '—', rows });
  input.exitLock();
  input.releaseAll();
  setState('result');
}

input.onPauseRequest = () => {
  if (game.state === 'playing') pause();
  else if (game.state === 'paused' && settings.controlMode === 'mobile') resume();
};

let currentQuality = null;
menus = new Menus({
  settings,
  input,
  onStart: start,
  onResume: resume,
  onPause: pause,
  onRespawn: start,
  onQuit: toTitle,
  onApply: (mode) => {
    const q = settings.get('quality');
    if (q !== currentQuality) {
      currentQuality = q;
      post.setQuality(q);
    }
    hud.showFps(settings.get('showFps'));
    const reduced = settings.get('effects') === 'reduced';
    rig.shakeScale = reduced ? 0.3 : 1;
    hud.flashScale = reduced ? 0.35 : 1;
    post.intensity = reduced ? 0.3 : 1;
    if (mode === 'mobile') input.exitLock();
  },
});
setState('title');

window.addEventListener('resize', () => post.resize());
// Any tap or key skips the intro (after a short grace period, see step()).
window.addEventListener('pointerdown', () => { if (fight.cine?.kind === 'intro') fight.skipReq = true; });
window.addEventListener('keydown', () => { if (fight.cine?.kind === 'intro') fight.skipReq = true; });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- Main loop ----------
// One simulation step. Rendering is separate so tests can fast-forward the game.
function step(rawDt) {
  input.update();
  const playing = game.state === 'playing';
  const running = game.state !== 'paused';
  let dt = running ? rawDt : 0;

  if (playing) {
    if (fight.hitstop > 0) {
      fight.hitstop -= rawDt;
      dt *= 0.04;
    }
    dt *= game.timeScale;
    if (fight.ending) {
      fight.ending.t -= rawDt;
      if (fight.ending.t <= 0) {
        game.timeScale = 1;
        showResult(fight.ending.win);
      }
    }
    fight.comboT -= dt;
    if (fight.combo > 0 && fight.comboT <= 0) {
      fight.combo = 0;
      hud.combo(0);
    }
  }
  // Perfect-dodge slow-mo: the boss and its attacks slow down, the player doesn't.
  const bossDt = fight.witch > 0 ? dt * BOSS.perfectScale : dt;
  fight.witch = Math.max(0, fight.witch - dt);
  post.setTint(fight.witch > 0 ? 1 : 0);
  game.time += bossDt;

  camera.getWorldDirection(camNormal).negate();
  world.update(bossDt, game.time, camera);
  boss.update(bossDt, game.time, playing ? player : null);

  const cine = playing ? fight.cine : null;
  if (cine) {
    cine.t += rawDt;
    if (cine.kind === 'intro') {
      if (cine.t >= 1.5 && !cine.bossStarted) {
        cine.bossStarted = true;
        boss.start();
        hud.banner(BOSS_NAME, 'gold', 2.6);
      }
      if (cine.t >= INTRO_TIME || (cine.t > 0.4 && fight.skipReq)) endIntro();
      fight.skipReq = false;
    }
  }

  if (playing) {
    if (input.lockPressed && !fight.cine) {
      rig.locked = !rig.locked;
      rig.lookIdle = 99;
      document.getElementById('btn-lock').classList.toggle('on', rig.locked);
      hud.banner(rig.locked ? 'LOCK-ON' : 'FREE CAMERA', '', 0.7);
    }
    const intro = fight.cine?.kind === 'intro';
    if (!player.dead && !intro) player.update(dt, input, rig, camera, settings.controlMode);
    else if (intro) player.updateVisuals(dt, 0); // stand idle at the spawn point
    if (fight.cine) cinematicCamera(fight.cine);
    else rig.update(dt, player, input);
    // Fade the player out when the camera is pushed right up against them.
    player.model.setOpacity(Math.min(1, Math.max(0.15, (rig.dist - 1.4) / 1.8)));
    // Keep the shadow camera centred on the player.
    const moon = world.lights.moon;
    moon.position.set(player.pos.x - 15, player.pos.y + 40, player.pos.z + 12);
    moon.target.position.copy(player.pos);
  } else if (game.state === 'title') {
    rig.updateTitle(rawDt, game.time);
  }

  // Screen effects: grade, god rays from the core, speed blur.
  boss.getCorePos(_core);
  let grade = 'phase1';
  let rays = 0.18;
  if (game.state === 'title') { grade = 'title'; rays = 0.3; }
  else if (fight.ending) { grade = fight.ending.win ? 'clear' : 'dead'; rays = fight.ending.win ? 0.5 : 0.1; }
  else if (boss.broken) { grade = 'break'; rays = 0.3; }
  post.setGrade(grade);
  post.setGodRays(_core, rays);
  let speed = 0;
  if (playing && !fight.cine) {
    if (player.dashing) speed = 1;
    else if (player.combat.active?.plunge) speed = 0.8;
    else speed = THREE.MathUtils.clamp((player.vel.length() - 16) / 24, 0, 1);
  }
  post.setSpeed(speed);

  fx.update(dt);
  post.update(rawDt, game.time);
  hud.update(rawDt, player, camera, boss);
  hud.updateThreats(playing && !fight.cine ? boss.getThreats([]) : [], camera, player, game.time);
  input.endFrame();
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  step(rawDt);
  post.render();
}
requestAnimationFrame(frame);

// Debugging / automated tests from the console. sim() fast-forwards without rendering.
window.__game = {
  game, fight, player, boss, rig, world, settings, input,
  sim(seconds, dt = 1 / 60) { for (let t = 0; t < seconds; t += dt) step(dt); },
};
