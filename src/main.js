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
import { CAMERA, BOSS, PLAYER, OVERDRIVE as OD, DIFFICULTY } from './config.js';
import { audio } from './audio/audio.js';
import { SlashWaves, OD_COLOR } from './player/overdrive.js';

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
const waves = new SlashWaves(scene);

const game = { state: 'title', time: 0, timeScale: 1 };
// Per-fight state: hitstop, perfect-dodge slow-mo, ending sequence and stats.
const fight = {
  hitstop: 0, witch: 0, ending: null, combo: 0, comboT: 0, stats: null, perfected: new WeakSet(),
  cine: null, finisher: null, checkpoint: 1,
};
let menus = null;

const camNormal = new THREE.Vector3();
const _v = new THREE.Vector3();
const _core = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _w = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const INTRO_TIME = 4.0;
const BOSS_NAME = 'SERAPH OF THE BROKEN SUN';
const PHASE_TITLES = { 2: ['SERAPHINA', 'PHASE 2 — ECLIPSE'], 3: ['SUPERNOVA', 'PHASE 3 — SERAPHINA AWAKENS'] };

// ---------- Hit feedback helpers ----------
const hitstop = (s) => { fight.hitstop = Math.max(fight.hitstop, s); };

// ---------- Music ----------
// The wanted track is remembered so it can start as soon as audio is unlocked.
let musicTrack = null;
function playMusic(name, fade) {
  musicTrack = name;
  audio.music?.play(name, fade);
}
const unlockAudio = () => {
  audio.unlock();
  if (audio.music && audio.music.current?.name !== musicTrack) audio.music.play(musicTrack);
};
window.addEventListener('pointerdown', unlockAudio, true);
window.addEventListener('keydown', unlockAudio, true);

// ---------- Overdrive ----------
function gainOD(amount) {
  if (player.overdrive || player.dead) return;
  const before = player.od;
  player.od = Math.min(1, player.od + amount);
  if (before < 1 && player.od >= 1) {
    audio.play('odReady');
    hud.banner(settings.controlMode === 'mobile' ? 'OVERDRIVE READY — OD' : 'OVERDRIVE READY — F', 'od', 1.2);
  }
}

function activateOverdrive() {
  player.od = 0;
  player.odT = OD.duration;
  player.dashCharges = PLAYER.dashCharges;
  player.airJumps = PLAYER.airJumps;
  fight.stats.overdrives++;
  const c = player.center.clone();
  boss.clearProjectiles(c, OD.clearRadius);
  hitstop(0.18);
  rig.shake(0.5);
  post.pulse(1);
  post.shockwave(c, { strength: 1.5, speed: 0.9, life: 0.6 });
  fx.ring(c, { color: OD_COLOR, from: 0.5, to: OD.clearRadius * 2, life: 0.5, normal: camNormal });
  fx.ring(c, { color: 0xffffff, from: 0.5, to: 6, life: 0.3, normal: camNormal });
  fx.burst(c, { count: 70, color: OD_COLOR, speed: 20, life: 0.6, size: 0.5 });
  fx.converge(c, { count: 40, radius: 8, color: 0xffffff, life: 0.35, size: 0.4 });
  hud.flash('#c89bff', 0.35);
  hud.banner('OVERDRIVE', 'od', 1.4);
  audio.play('overdrive');
  audio.duckMusic(0.5, 0.8);
}

// Every swing during Overdrive launches sword waves (three, fanned, on a heavy hit).
function onSlash(def, origin, dir) {
  if (!player.overdrive) return;
  const dmg = Math.max(OD.wave.minDmg, Math.round(def.dmg * OD.wave.dmgMult * OD.dmgMult));
  // Aim at the boss target closest to where you swing (within ~55°), so waves reach her in the air.
  let best = null;
  let bestDot = 0.57;
  for (const t of boss.getTargets([])) {
    if (t.kind === 'orb') continue;
    _w.subVectors(t.pos, origin);
    const d = _w.length();
    if (d > OD.wave.range + t.r) continue;
    const dot = _w.setY(0).normalize().dot(_v.copy(dir).setY(0).normalize()) + (t.kind === 'weak' ? 0.05 : 0);
    if (dot > bestDot) { bestDot = dot; best = t; }
  }
  const aim = best ? _cam.subVectors(best.pos, origin).normalize() : _cam.copy(dir);
  const spread = def.heavy ? [-0.22, 0, 0.22] : [0];
  for (const a of spread) {
    _v.copy(aim).applyAxisAngle(_up, a);
    // Kept close to horizontal: a flat crescent reads best from the chase camera.
    waves.fire(_w.copy(origin).addScaledVector(_v, 0.8), _v, def.roll * 0.15 * (def.flip ? -1 : 1), dmg);
  }
  audio.play('wave');
}

function onWaveHit(t, w) {
  onAttackHit(t, { dmg: w.dmg, hitstop: 0.03, shake: 0.1, wave: true }, w.pos.clone(), w.dir.clone());
}

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
  onSlash,
});

function onAttackHit(target, def, point, dir) {
  if (target.kind === 'orb') {
    target.hazard.reflectOrb(target.ref);
    hitstop(0.05);
    rig.shake(0.12);
    fx.burst(point, { count: 14, color: 0x46e6ff, speed: 10, life: 0.3, size: 0.35 });
    fight.stats.reflects++;
    addCombo();
    audio.play('reflect', { pos: point });
    gainOD(OD.gain.reflect);
    return;
  }
  const dmg = def.wave ? def.dmg : def.dmg * (player.overdrive ? OD.dmgMult : 1);
  const res = boss.takeHit(target.kind, dmg, target.ref);
  if (!res) return;
  audio.play(res.crit ? 'crit' : res.weak ? 'hitWeak' : 'hit', { pos: point, vol: def.wave ? 0.6 : 1 });
  if (!def.wave) gainOD(res.weak ? OD.gain.weak : OD.gain.hit);
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
  audio.play('plungeLand');
  audio.duckMusic(0.4, 0.4);
  const hitIds = new Set();
  for (const t of boss.getTargets([])) {
    if (t.pos.distanceTo(pos) > def.landRadius + t.r) continue;
    if (t.kind === 'orb') { t.hazard.reflectOrb(t.ref); continue; }
    // One hit on the body and at most one weak point per landing.
    const key = t.kind === 'weak' ? '#weak' : t.id;
    if (hitIds.has(key)) continue;
    hitIds.add(key);
    const res = boss.takeHit(t.kind, def.landDmg * (player.overdrive ? OD.dmgMult : 1), t.ref);
    if (res) {
      gainOD(res.weak ? OD.gain.weak : OD.gain.hit);
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
    audio.play('break');
    audio.duckMusic(0.7, 1);
    gainOD(OD.gain.break);
  },
  onBreakEnd: () => {
    hud.banner('RECOVERED', 'bad', 1.0);
    audio.play('recover');
  },
  onWeakDestroyed: () => {
    hud.banner('WEAK POINT DESTROYED', 'weak', 1.4);
    audio.play('shatter');
    gainOD(OD.gain.destroy);
    hitstop(0.18);
    rig.shake(0.5);
    post.pulse(0.9);
  },
  // HP hit the phase threshold: cinematic while the boss transforms.
  onPhaseEnd: (phase) => {
    fight.cine = { kind: 'transform', t: 0, from: phase, base: Math.atan2(player.pos.x, player.pos.z) + 0.5 };
    fight.witch = 0;
    setCinematic(true);
    hitstop(0.3);
    rig.shake(0.8);
    post.pulse(1.2);
    hud.flash('#ffffff', 0.6);
    hud.banner(`PHASE ${phase} CLEAR`, 'gold', 1.6);
    waves.clear();
    playMusic(null, 0.8);
    audio.play('phaseClear');
    fight.rumble = audio.play('rumble');
    boss.getCorePos(_v);
    fx.ring(_v, { color: 0xffffff, from: 2, to: 26, life: 0.8, normal: camNormal });
  },
  onTransformFlash: (phase) => {
    fight.rumble?.stop(0.1);
    audio.play('transform', { phase });
    hud.flash(phase === 3 ? '#ff4060' : '#ffffff', 0.85);
    rig.shake(1);
    post.pulse(1.5);
    setTimeout(() => hud.banner(...PHASE_TITLES[phase].slice(0, 1), phase === 3 ? 'bad' : 'gold', 2.4), 900);
  },
  // New phase begins: checkpoint, player placed on solid ground. HP carries over.
  onPhaseStart: (phase) => {
    fight.cine = null;
    setCinematic(false);
    fight.checkpoint = phase;
    fight.stats.phase = phase;
    hud.setBossPhase(phase, boss.name);
    hud.banner(PHASE_TITLES[phase][1], phase === 3 ? 'bad' : 'perfect', 1.8);
    playMusic(`phase${phase}`, 0.3);
    const hp = player.hp;
    player.respawn();
    player.hp = hp;
    rig.snap(player);
    rig.lookIdle = 99;
  },
  onFinisherReady: () => {
    fight.finisher = { t: 0 };
    hud.banner('FINISH IT!', 'gold', 1.8);
    hud.showFinisher(true);
    hitstop(0.25);
    rig.shake(0.6);
    waves.clear();
    playMusic(null, 1.5);
    audio.play('heartbeat');
    fight.heartbeat = 1.1;
  },
  onDefeated: () => endFight(true),
  onIntroDone: () => {},
});

boss.ctx = {
  scene, fx, world, boss, player, camNormal,
  hitPlayer,
  shake: (a) => rig.shake(a),
  shockwave: (pos, o) => post.shockwave(pos, o),
  banner: (text, cls, d) => hud.banner(text, cls, d),
  flash: (c, a) => hud.flash(c, a),
  impactFlash: (dist) => { if (dist < 25) hud.flash('#ffd8a0', 0.25); },
  // Phase 3 blast: thrown away from her, no damage.
  knockPlayer: (from, o) => {
    if (game.state !== 'playing' || fight.ending || fight.cine || fight.finisher || player.dead) return;
    player.knockback(from, o);
    hitstop(0.1);
    fx.burst(player.center, { count: 24, color: 0xffd0dc, speed: 10, life: 0.4, size: 0.4 });
  },
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
rig.lockTarget = () => (['dormant', 'dying', 'dead'].includes(boss.state) ? null : boss.getCorePos(_lock));

// Boss attack reaches the player. Returns 'hit' | 'perfect' | 'ignored'.
function hitPlayer(dmg, from, source) {
  if (game.state !== 'playing' || fight.ending || fight.cine || fight.finisher) return 'ignored';
  const r = player.takeDamage(dmg, from);
  if (r === 'perfect') {
    if (!fight.perfected.has(source)) {
      fight.perfected.add(source);
      perfectDodge();
    }
  } else if (r === 'hit') {
    fight.stats.damageTaken += dmg;
    audio.play('hurt');
    audio.duckMusic(0.5, 0.5);
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
  audio.play('perfect');
  gainOD(OD.gain.perfect);
  fx.ring(player.center, { color: 0x46e6ff, from: 0.5, to: 7, life: 0.45, normal: camNormal });
  fx.burst(player.center, { count: 30, color: 0x9ff4ff, speed: 14, life: 0.5, size: 0.35 });
  post.pulse(0.6);
  post.shockwave(player.center, { strength: 0.9, speed: 1.1, life: 0.5 });
  hitstop(0.05);
}

// ---------- Fight flow ----------
function newStats(fromPhase = 1) {
  return {
    start: game.time, time: 0, dealt: 0, damageTaken: 0, perfects: 0, maxCombo: 0, reflects: 0, breaks: 0, overdrives: 0,
    phase: fromPhase, fromPhase, difficulty: settings.get('difficulty'),
  };
}

function setState(state) {
  game.state = state;
  input.enabled = state === 'playing';
  menus.setState(state);
  audio.setPaused(state === 'paused');
  hud.show(state === 'playing' || state === 'paused');
  hud.showBoss(state === 'playing' || state === 'paused');
}

function setCinematic(on, skippable = false) {
  document.body.classList.toggle('cinematic', on);
  document.body.classList.toggle('skippable', on && skippable);
}

// Difficulty preset: player HP, dodge window, boss pacing.
function applyDifficulty() {
  const d = DIFFICULTY[settings.get('difficulty')] || DIFFICULTY.hard;
  PLAYER.maxHp = d.maxHp;
  PLAYER.dashIFrames = d.iframes;
  boss.idleMult = d.idleMult;
  hud.setMaxHp(d.maxHp);
}

function resetFight(phase) {
  applyDifficulty();
  player.respawn(true);
  waves.clear();
  fight.rumble?.stop();
  boss.reset(phase);
  rig.snap(player);
  Object.assign(fight, {
    hitstop: 0, witch: 0, ending: null, combo: 0, comboT: 0, stats: newStats(phase), perfected: new WeakSet(),
    cine: null, skipReq: false, finisher: null, checkpoint: phase, rumble: null, heartbeat: 0,
  });
  game.timeScale = 1;
  hud.resetBoss();
  hud.setBossPhase(phase, boss.name);
  hud.showFinisher(false);
  hud.combo(0);
}

function start() {
  resetFight(1);
  playMusic(null, 0.6);
  fight.cine = { kind: 'intro', t: 0 };
  resume();
  setCinematic(true, true);
}

// Retry from the start of the phase you died in (checkpoint).
function continueFromCheckpoint() {
  const phase = fight.checkpoint;
  resetFight(phase);
  boss.start(1.2);
  setCinematic(false);
  resume();
  hud.banner(PHASE_TITLES[phase][1], phase === 3 ? 'bad' : 'perfect', 1.8);
  playMusic(`phase${phase}`, 0.3);
}

// Boss reveal finished (or skipped): hand the camera back to the player.
function endIntro() {
  const c = fight.cine;
  if (!c.bossStarted) {
    boss.start();
    hud.banner(BOSS_NAME, 'gold', 2.2);
    audio.play('bossAwake');
    playMusic('phase1', 0.3);
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
  } else if (c.kind === 'transform') {
    // Orbit the boss while it changes form; push in once the angel appears.
    const a = c.base + c.t * 0.3;
    const r = c.from === 1 ? (c.t < 1.6 ? 46 : 46 - Math.min(1, (c.t - 1.6) / 2) * 20) : 24;
    camera.position.set(core.x + Math.sin(a) * r, core.y + (c.from === 1 ? 4 : 2), core.z + Math.cos(a) * r);
    camera.lookAt(core);
    fov = 50;
  } else if (c.kind === 'finale') {
    // Behind the player as they dive into her heart, then a slow orbit as she fades.
    if (c.t < c.dive) {
      _cam.copy(player.pos).sub(c.heart).setY(0).normalize();
      camera.position.copy(player.pos).addScaledVector(_cam, 5).add(_v.set(0, 2.2, 0));
      camera.lookAt(c.heart);
      fov = 70;
    } else {
      const a = c.base + (c.t - c.dive) * 0.25;
      camera.position.set(core.x + Math.sin(a) * 16, core.y + 1.5, core.z + Math.cos(a) * 16);
      camera.lookAt(core);
      fov = 48;
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
  waves.clear();
  fight.rumble?.stop();
  playMusic('title');
  showBest();
  boss.reset();
  fight.cine = null;
  setCinematic(false);
  setState('title');
}

// Win (phase cleared) or lose: slow-motion beat, then the result screen.
function endFight(win) {
  if (fight.ending) return;
  fight.stats.time = (game.time - fight.stats.start);
  fight.ending = { win, t: win ? 3.2 : 2.0 };
  hud.showFinisher(false);
  game.timeScale = win ? 0.3 : 0.25;
  fight.witch = 0;
  fight.cine = { kind: win ? 'clear' : 'dead', t: 0, base: Math.atan2(player.pos.x, player.pos.z) + 0.6 };
  setCinematic(true);
  if (win) {
    hud.banner('VICTORY', 'gold', 2.6);
    hud.flash('#ffffff', 0.8);
    rig.shake(0.9);
    post.pulse(1.5);
    playMusic('victory', 0.5);
    boss.getCorePos(_v);
    fx.burst(_v, { count: 120, color: 0xffc061, speed: 30, life: 1.2, size: 0.8 });
    fx.ring(_v, { color: 0xffffff, from: 2, to: 30, life: 0.9, normal: camNormal });
  } else {
    hud.banner('DEFEATED', 'bad', 1.8);
    hud.flash('#ff2d55', 0.6);
    post.pulse(1.5);
    boss.cancelHazards();
    waves.clear();
    player.odT = 0;
    audio.play('defeat');
    playMusic('defeat', 0.8);
  }
}

function rankFor(s) {
  // Tuned for a full run of all three phases (roughly 6-10 minutes).
  const score = 100 - s.time / 12 - s.damageTaken * 5 + s.perfects * 2 + Math.min(10, s.maxCombo / 4) + s.breaks * 2;
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
  const bossLeft = Math.round((boss.hp / BOSS.maxHp) * 100);
  const rows = [
    ['Time', `${m}:${sec}`],
    ['Damage taken', `${s.damageTaken}`],
    ['Perfect dodges', `${s.perfects}`],
    ['Max combo', `${s.maxCombo}`],
    ['Breaks', `${s.breaks}`],
    ['Overdrives', `${s.overdrives}`],
    ['Difficulty', DIFFICULTY[s.difficulty]?.label ?? 'HARD'],
  ];
  if (!win) rows.push(['Reached', `Phase ${s.phase} · boss HP ${bossLeft}%`]);
  if (win && s.fromPhase > 1) rows.push(['Started from', `Phase ${s.fromPhase}`]);
  fight.cine = null;
  setCinematic(false);
  const rank = win ? rankFor(s) : '—';
  const record = win && s.fromPhase === 1 && saveBest(rank, s.time, s.difficulty);
  if (record) rows.push(['', 'NEW BEST!']);
  menus.showResult({
    win,
    title: win ? 'VICTORY' : 'DEFEATED',
    rank,
    rows,
    checkpoint: !win && fight.checkpoint > 1 ? fight.checkpoint : 0,
  });
  input.exitLock();
  input.releaseAll();
  setState('result');
}

// ---------- Best record (full runs only) ----------
const BEST_KEY = 'aether-breaker:best';
const RANKS = ['D', 'C', 'B', 'A', 'S'];
const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
function loadBest() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY) || 'null'); } catch { return null; }
}
// Keeps one record per difficulty; better rank wins, then faster time. Returns true on a new record.
function saveBest(rank, time, difficulty) {
  const all = loadBest() || {};
  const old = all[difficulty];
  const better = !old || RANKS.indexOf(rank) > RANKS.indexOf(old.rank) || (rank === old.rank && time < old.time);
  if (!better) return false;
  all[difficulty] = { rank, time };
  try { localStorage.setItem(BEST_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
  return true;
}
function showBest() {
  const el = document.getElementById('best');
  const all = loadBest() || {};
  const parts = ['hard', 'normal'].filter((d) => all[d]).map((d) => `${DIFFICULTY[d].label} ${all[d].rank} · ${fmtTime(all[d].time)}`);
  el.hidden = !parts.length;
  el.textContent = parts.length ? `BEST  ${parts.join('   ')}` : '';
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
  onCheckpoint: continueFromCheckpoint,
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
    post.autoRes = settings.get('autoRes');
    audio.setVolumes({ master: settings.get('masterVol'), music: settings.get('musicVol'), sfx: settings.get('sfxVol') });
    if (mode === 'mobile') input.exitLock();
  },
});
setState('title');
showBest();
playMusic('title');

// Gamepad: Start pauses / resumes, A confirms the main button of the open screen.
input.onGamepadStart = () => {
  if (game.state === 'playing') pause();
  else if (game.state === 'paused') resume();
  else if (game.state === 'title') start();
};
input.onGamepadConfirm = () => {
  if (!document.getElementById('settings-screen').hidden) return;
  if (game.state === 'title') start();
  else if (game.state === 'paused') resume();
  else if (game.state === 'result') {
    const cp = document.getElementById('btn-checkpoint');
    if (!cp.hidden) continueFromCheckpoint(); else start();
  }
};

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
  audio.setSlowmo(playing && fight.witch > 0);
  game.time += bossDt;

  camera.getWorldDirection(camNormal).negate();
  world.update(bossDt, game.time, camera);
  boss.update(bossDt, game.time, playing ? player : null);

  // Finisher: wait for the attack button (or a few seconds), then dive into her heart.
  if (playing && fight.finisher && !fight.cine) {
    fight.finisher.t += rawDt;
    fight.heartbeat -= rawDt;
    if (fight.heartbeat <= 0) { fight.heartbeat = 1.1; audio.play('heartbeat'); }
    if (input.attackPressed || fight.finisher.t > 6) {
      hud.showFinisher(false);
      fight.finisher = null;
      const heart = boss.weakPoints[0].anchor.pos.clone();
      fight.cine = { kind: 'finale', t: 0, dive: 1.1, from: player.pos.clone(), heart, base: Math.atan2(player.pos.x - heart.x, player.pos.z - heart.z) };
      setCinematic(true);
      hud.banner('', '', 0.1);
    }
  }

  const cine = playing ? fight.cine : null;
  if (cine) {
    cine.t += rawDt;
    if (cine.kind === 'finale') {
      if (cine.t < cine.dive) {
        // Swoop along an arc into the heart jewel.
        const k = cine.t / cine.dive;
        const e = k * k;
        player.pos.lerpVectors(cine.from, cine.heart, e);
        player.pos.y += Math.sin(k * Math.PI) * 4 - 1.0 * e;
        player.vel.set(0, 0, 0);
        player.facing = Math.atan2(cine.heart.x - player.pos.x, cine.heart.z - player.pos.z);
        player.combat.active = { plunge: true, dur: 9, hitStart: 0, hitEnd: 9 };
        if (Math.random() < 0.8) fx.afterimage({ color: 0x46e6ff, life: 0.3, alpha: 0.5 });
      } else if (!cine.hit) {
        cine.hit = true;
        player.combat.active = null;
        hitstop(0.35);
        hud.flash('#ffffff', 1);
        rig.shake(1);
        post.pulse(1.5);
        post.shockwave(cine.heart, { strength: 2.4, speed: 0.6, life: 1.2 });
        fx.ring(cine.heart, { color: 0xffffff, from: 1, to: 30, life: 0.8, normal: camNormal });
        fx.burst(cine.heart, { count: 120, color: 0xfff0c8, speed: 30, life: 1, size: 0.7 });
        boss.beginDissolve();
        audio.play('finale');
        // The player drops onto the nearest platform below.
        player.respawn();
      }
    }
    if (cine.kind === 'intro') {
      if (cine.t >= 1.5 && !cine.bossStarted) {
        cine.bossStarted = true;
        boss.start();
        hud.banner(BOSS_NAME, 'gold', 2.6);
        audio.play('bossAwake');
        playMusic('phase1', 0.3);
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
      audio.play('ui');
    }
    if (input.overdrivePressed && player.od >= 1 && !player.overdrive && !player.dead
        && !fight.cine && !fight.finisher && !fight.ending && boss.active) activateOverdrive();
    const frozen = ['intro', 'transform', 'finale'].includes(fight.cine?.kind);
    if (!player.dead && !frozen) player.update(dt, input, rig, camera, settings.controlMode);
    else if (frozen) player.updateVisuals(dt, 0); // hold still during cinematics
    if (fight.cine) cinematicCamera(fight.cine);
    else rig.update(dt, player, input);
    if (waves.any) waves.update(dt, fight.cine || fight.ending ? [] : boss.getTargets([]), onWaveHit);
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
  else if (playing && player.overdrive) { grade = 'overdrive'; rays = 0.12; }
  else if (boss.broken) { grade = 'break'; rays = 0.3; }
  else if (boss.phase === 2) { grade = 'phase2'; rays = 0.12; }
  else if (boss.phase === 3) { grade = 'phase3'; rays = 0.12; }
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
  audio.setListener(camera);
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
  if (game.state === 'playing') post.adapt(rawDt);
  post.render();
}
requestAnimationFrame(frame);

// Debugging / automated tests from the console. sim() fast-forwards without rendering.
window.__game = {
  game, fight, player, boss, rig, world, settings, input, audio, post, waves,
  step,
  activateOverdrive,
  sim(seconds, dt = 1 / 60) { for (let t = 0; t < seconds; t += dt) step(dt); },
};
