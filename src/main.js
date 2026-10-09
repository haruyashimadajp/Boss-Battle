import * as THREE from 'three';
import { Settings } from './settings.js';
import { Input } from './input/input.js';
import { buildWorld } from './world/arena.js';
import { Player } from './player/player.js';
import { CameraRig } from './camera.js';
import { FX } from './fx/fx.js';
import { Post } from './fx/post.js';
import { HUD } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { CAMERA } from './config.js';

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
const player = new Player(scene, world, fx, {
  shake: (a) => rig.shake(a),
  flash: (c, a) => hud.flash(c, a),
});
const post = new Post(renderer, scene, camera, world);
const input = new Input(canvas, settings);

const game = { state: 'title', time: 0, timeScale: 1 };
let menus = null;

function setState(state) {
  game.state = state;
  input.enabled = state === 'playing';
  menus.setState(state);
  hud.show(state !== 'title');
}

function start() {
  player.respawn(true);
  rig.snap(player);
  resume();
}

function resume() {
  setState('playing');
  if (settings.controlMode === 'pc') input.requestLock();
  else {
    try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {}); } catch { /* optional */ }
  }
}

function pause() {
  if (game.state !== 'playing') return;
  input.releaseAll();
  setState('paused');
  input.exitLock();
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
  onRespawn: () => player.respawn(),
  onQuit: () => { input.exitLock(); setState('title'); },
  onApply: (mode) => {
    const q = settings.get('quality');
    if (q !== currentQuality) {
      currentQuality = q;
      post.setQuality(q);
    }
    hud.showFps(settings.get('showFps'));
    if (mode === 'mobile') input.exitLock();
  },
});
setState('title');

window.addEventListener('resize', () => post.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- Main loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.min((now - last) / 1000, 1 / 20);
  last = now;

  input.update();
  const running = game.state !== 'paused';
  const dt = running ? rawDt * game.timeScale : 0;
  game.time += dt;

  world.update(dt, game.time, camera);

  if (game.state === 'playing') {
    player.update(dt, input, rig, camera, settings.controlMode);
    rig.update(dt, player, input);
    // Fade the player out when the camera is pushed right up against them.
    player.model.setOpacity(Math.min(1, Math.max(0.15, (rig.dist - 1.4) / 1.8)));
    // Keep the shadow camera centred on the player.
    const moon = world.lights.moon;
    moon.position.set(player.pos.x - 15, player.pos.y + 40, player.pos.z + 12);
    moon.target.position.copy(player.pos);
  } else if (game.state === 'title') {
    rig.updateTitle(rawDt, game.time);
  }

  fx.update(dt);
  hud.update(rawDt, player, camera);
  post.render();
  input.endFrame();
}
requestAnimationFrame(frame);

// Handy for debugging from the console.
window.__game = { game, player, rig, world, settings, input };
