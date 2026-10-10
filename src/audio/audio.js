import * as THREE from 'three';
import { Music } from './music.js';

// Procedural sound: every effect is synthesized with the Web Audio API, no asset files.
//
//   audio.unlock()                 call from a user gesture (browsers start audio suspended)
//   audio.play(name, { pos, vol }) one-shot or sustained effect; returns a handle with stop()
//   audio.music.play(track)        crossfades the procedural soundtrack (see music.js)
//
// Graph: sfx bus + music bus (with duck) -> slow-mo lowpass -> compressor -> master -> out.
// Music and big effects also feed a generated-impulse reverb.

const _d = new THREE.Vector3();

// Helpers that schedule one voice. `out` is the per-sound gain node.
function tone(e, out, { type = 'sine', f, f2 = null, t = 0, dur = 0.2, vol = 0.3, a = 0.005, sustain = false, curve = 'exp', detune = 0 }) {
  const c = e.ctx;
  const t0 = c.currentTime + t;
  const o = c.createOscillator();
  o.type = type;
  o.detune.value = detune;
  o.frequency.setValueAtTime(f, t0);
  if (f2) {
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    else o.frequency.linearRampToValueAtTime(f2, t0 + dur);
  }
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + a);
  if (!sustain) g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, a + 0.01));
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + (sustain ? 12 : dur + 0.05));
  return o;
}

function hiss(e, out, { t = 0, dur = 0.2, vol = 0.3, filter = 'bandpass', f = 1000, f2 = null, q = 1, a = 0.005, sustain = false }) {
  const c = e.ctx;
  const t0 = c.currentTime + t;
  const src = c.createBufferSource();
  src.buffer = e.noise;
  src.loop = true;
  const flt = c.createBiquadFilter();
  flt.type = filter;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f, t0);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + a);
  if (!sustain) g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, a + 0.01));
  src.connect(flt).connect(g).connect(out);
  src.start(t0, Math.random() * 1.5);
  src.stop(t0 + (sustain ? 12 : dur + 0.05));
  return src;
}

// Amplitude wobble (tremolo) on a node: returns the gain to connect through.
function tremolo(e, out, rate, depth) {
  const c = e.ctx;
  const g = c.createGain();
  g.gain.value = 1 - depth;
  const lfo = c.createOscillator();
  lfo.frequency.value = rate;
  const amt = c.createGain();
  amt.gain.value = depth;
  lfo.connect(amt).connect(g.gain);
  lfo.start();
  lfo.stop(c.currentTime + 12);
  g.connect(out);
  return g;
}

function lowpass(e, out, f, q = 0.7) {
  const flt = e.ctx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.value = f;
  flt.Q.value = q;
  flt.connect(out);
  return flt;
}

// Low boom used by impacts.
const boom = (e, o, { f = 110, f2 = 32, dur = 0.6, vol = 0.9, t = 0 } = {}) => tone(e, o, { f, f2, dur, vol, t, a: 0.004 });

const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

// Each recipe: (engine, out, opts). `gap` = minimum seconds between two plays (stops pile-ups).
// `gain` evens out loudness between recipes (filtered noise comes out much quieter than tones).
// `verb` = reverb send amount. Sustained sounds keep going until handle.stop().
const SFX = {
  // ---- Player ----
  swing: { gain: 2.8, gap: 0.04, play(e, o) {
    const p = rnd(0.85, 1.2);
    hiss(e, o, { f: 700 * p, f2: 2600 * p, q: 1.4, dur: 0.15, vol: 0.32 });
    tone(e, o, { f: 320 * p, f2: 140, dur: 0.08, vol: 0.05 });
  } },
  swingHeavy: { gain: 2.2, gap: 0.05, verb: 0.15, play(e, o) {
    hiss(e, o, { f: 300, f2: 2000, q: 1.2, dur: 0.26, vol: 0.45 });
    tone(e, o, { f: 180, f2: 60, dur: 0.22, vol: 0.16 });
  } },
  hit: { gap: 0.03, play(e, o, { vol = 1 }) {
    boom(e, o, { f: 190, f2: 55, dur: 0.16, vol: 0.55 * vol });
    hiss(e, o, { f: 3200, q: 0.8, dur: 0.07, vol: 0.4 * vol });
    tone(e, o, { type: 'square', f: rnd(850, 1000), f2: 260, dur: 0.05, vol: 0.06 * vol });
  } },
  hitWeak: { gap: 0.03, verb: 0.2, play(e, o) {
    SFX.hit.play(e, o, { vol: 0.9 });
    tone(e, o, { f: 1760, dur: 0.45, vol: 0.14 });
    tone(e, o, { f: 2637, dur: 0.32, vol: 0.09, t: 0.01 });
  } },
  crit: { gap: 0.03, verb: 0.25, play(e, o) {
    SFX.hit.play(e, o, { vol: 1.1 });
    boom(e, o, { f: 95, f2: 36, dur: 0.4, vol: 0.6 });
    tone(e, o, { type: 'triangle', f: 2200, f2: 1700, dur: 0.35, vol: 0.08 });
  } },
  reflect: { gain: 1.6, gap: 0.04, verb: 0.2, play(e, o) {
    tone(e, o, { f: 880, f2: 1760, dur: 0.14, vol: 0.18 });
    tone(e, o, { f: 1318, dur: 0.35, vol: 0.1, t: 0.05 });
  } },
  jump: { gain: 2, gap: 0.05, play(e, o) {
    tone(e, o, { f: 300, f2: 620, dur: 0.1, vol: 0.1 });
    hiss(e, o, { f: 1500, dur: 0.08, vol: 0.07 });
  } },
  jump2: { gain: 2, gap: 0.05, play(e, o) {
    tone(e, o, { type: 'triangle', f: 520, f2: 1040, dur: 0.14, vol: 0.12 });
    hiss(e, o, { f: 2000, f2: 4200, dur: 0.15, vol: 0.09 });
  } },
  dash: { gain: 2.5, gap: 0.05, play(e, o) {
    hiss(e, o, { f: 450, f2: 3200, q: 2, dur: 0.22, vol: 0.42 });
    tone(e, o, { f: 220, f2: 80, dur: 0.12, vol: 0.1 });
  } },
  hookFire: { gain: 1.5, gap: 0.05, play(e, o) {
    tone(e, o, { type: 'square', f: 1300, f2: 320, dur: 0.09, vol: 0.05 });
    hiss(e, o, { filter: 'highpass', f: 4000, dur: 0.09, vol: 0.14 });
  } },
  hookHit: { gap: 0.05, play(e, o) {
    tone(e, o, { type: 'square', f: 220, dur: 0.07, vol: 0.08 });
    tone(e, o, { f: 1500, dur: 0.16, vol: 0.1 });
    tone(e, o, { f: 2250, dur: 0.1, vol: 0.06 });
  } },
  hookPop: { gain: 2, gap: 0.05, play(e, o) {
    tone(e, o, { f: 420, f2: 940, dur: 0.12, vol: 0.1 });
    hiss(e, o, { f: 1800, dur: 0.1, vol: 0.1 });
  } },
  land: { gap: 0.08, play(e, o, { vol = 1 }) {
    hiss(e, o, { filter: 'lowpass', f: 900, dur: 0.14, vol: 0.32 * vol });
    boom(e, o, { f: 130, f2: 50, dur: 0.14, vol: 0.4 * vol });
  } },
  plunge: { gain: 1.8, gap: 0.1, play(e, o) {
    hiss(e, o, { f: 2400, f2: 500, q: 1.5, dur: 0.35, vol: 0.3 });
    tone(e, o, { f: 700, f2: 200, dur: 0.3, vol: 0.06 });
  } },
  plungeLand: { gap: 0.1, verb: 0.3, play(e, o) {
    boom(e, o, { f: 120, f2: 28, dur: 0.7, vol: 1 });
    hiss(e, o, { filter: 'lowpass', f: 1600, f2: 200, dur: 0.5, vol: 0.55 });
    tone(e, o, { type: 'square', f: 85, dur: 0.1, vol: 0.12 });
  } },
  hurt: { gap: 0.1, play(e, o) {
    tone(e, lowpass(e, o, 1400), { type: 'sawtooth', f: 320, f2: 80, dur: 0.28, vol: 0.3 });
    hiss(e, o, { f: 1100, dur: 0.16, vol: 0.32 });
    boom(e, o, { f: 100, f2: 40, dur: 0.25, vol: 0.5 });
  } },
  fall: { gap: 0.3, play(e, o) {
    tone(e, o, { f: 900, f2: 110, dur: 0.6, vol: 0.15 });
    hiss(e, o, { f: 1800, f2: 300, dur: 0.6, vol: 0.18 });
  } },
  perfect: { gap: 0.1, verb: 0.5, play(e, o) {
    hiss(e, o, { f: 500, f2: 7000, q: 1.5, dur: 0.25, vol: 0.25, a: 0.2 });
    [1318.5, 1975.5, 2637].forEach((f, i) => tone(e, o, { f, dur: 0.9, vol: 0.11, t: 0.06 + i * 0.05 }));
  } },
  overdrive: { gap: 0.3, verb: 0.5, play(e, o) {
    boom(e, o, { f: 140, f2: 30, dur: 0.9, vol: 1 });
    const lp = lowpass(e, o, 2200, 3);
    for (const f of [110, 164.8, 220, 329.6]) {
      tone(e, lp, { type: 'sawtooth', f: f * 0.5, f2: f, dur: 0.9, vol: 0.07, a: 0.05, detune: rnd(-8, 8) });
    }
    hiss(e, o, { f: 300, f2: 9000, dur: 0.5, vol: 0.25, a: 0.3 });
  } },
  odReady: { gain: 1.4, gap: 0.5, verb: 0.4, play(e, o) {
    tone(e, o, { type: 'triangle', f: 1046.5, dur: 0.25, vol: 0.12 });
    tone(e, o, { type: 'triangle', f: 1568, dur: 0.5, vol: 0.12, t: 0.09 });
  } },
  wave: { gain: 2.5, gap: 0.04, play(e, o) {
    hiss(e, o, { f: 1200, f2: 4000, q: 2, dur: 0.25, vol: 0.3 });
    tone(e, o, { type: 'triangle', f: 900, f2: 1500, dur: 0.18, vol: 0.06 });
  } },
  ui: { gap: 0.03, play(e, o) { tone(e, o, { type: 'triangle', f: 1250, dur: 0.05, vol: 0.08 }); } },

  // ---- Boss events ----
  break: { gap: 0.3, verb: 0.5, play(e, o) {
    boom(e, o, { f: 90, f2: 26, dur: 1, vol: 1 });
    hiss(e, o, { f: 3500, q: 0.6, dur: 0.7, vol: 0.4 });
    for (let i = 0; i < 10; i++) tone(e, o, { f: rnd(2000, 6500), dur: rnd(0.2, 0.7), vol: 0.05, t: rnd(0, 0.15) });
  } },
  shatter: { gap: 0.2, verb: 0.4, play(e, o) {
    boom(e, o, { f: 140, f2: 40, dur: 0.5, vol: 0.7 });
    hiss(e, o, { f: 4500, q: 0.7, dur: 0.45, vol: 0.32 });
    for (let i = 0; i < 7; i++) tone(e, o, { f: rnd(1800, 5200), dur: rnd(0.2, 0.5), vol: 0.06, t: rnd(0, 0.1) });
  } },
  recover: { gap: 0.3, play(e, o) {
    tone(e, lowpass(e, o, 900), { type: 'sawtooth', f: 90, f2: 220, dur: 0.6, vol: 0.18 });
  } },
  bossAwake: { gap: 1, verb: 0.6, play(e, o) {
    boom(e, o, { f: 70, f2: 24, dur: 1.8, vol: 1 });
    const lp = lowpass(e, o, 1600);
    for (const f of [146.8, 220, 293.7, 349.2]) tone(e, lp, { type: 'sawtooth', f, dur: 2.2, vol: 0.05, a: 0.6, detune: rnd(-10, 10) });
  } },
  rumble: { gain: 0.7, gap: 1, sustain: true, play(e, o) {
    const tr = tremolo(e, o, 9, 0.5);
    tone(e, lowpass(e, tr, 300), { type: 'sawtooth', f: 38, f2: 70, dur: 1.6, vol: 0.5, a: 0.3, sustain: true, curve: 'lin' });
    hiss(e, o, { f: 200, f2: 6000, dur: 1.6, vol: 0.2, a: 1.4, sustain: true });
  } },
  transform: { gap: 1, verb: 0.7, play(e, o, { phase = 2 }) {
    boom(e, o, { f: 100, f2: 22, dur: 1.6, vol: 1 });
    hiss(e, o, { f: 6000, f2: 400, q: 0.5, dur: 1.2, vol: 0.4 });
    const chord = phase === 3 ? [261.6, 311.1, 392, 523.3] : [293.7, 370, 440, 587.3];
    for (const f of chord) {
      tone(e, o, { type: 'triangle', f, dur: 2.6, vol: 0.06, a: 0.25 });
      tone(e, o, { type: 'sine', f: f * 2, dur: 2.2, vol: 0.04, a: 0.3, t: 0.1 });
    }
  } },
  phaseClear: { gap: 1, verb: 0.5, play(e, o) {
    boom(e, o, { f: 110, f2: 30, dur: 1, vol: 0.9 });
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(e, o, { type: 'triangle', f, dur: 1.2, vol: 0.09, t: i * 0.07 }));
  } },
  heartbeat: { gap: 0.5, play(e, o) {
    boom(e, o, { f: 70, f2: 35, dur: 0.22, vol: 0.9 });
    boom(e, o, { f: 65, f2: 32, dur: 0.25, vol: 0.7, t: 0.24 });
  } },
  finale: { gap: 1, verb: 0.8, play(e, o) {
    boom(e, o, { f: 120, f2: 20, dur: 2.2, vol: 1 });
    hiss(e, o, { f: 8000, f2: 300, q: 0.4, dur: 1.6, vol: 0.45 });
    for (const f of [523.3, 659.3, 784, 1046.5, 1318.5]) tone(e, o, { type: 'sine', f, dur: 3, vol: 0.06, a: 0.05 });
  } },
  defeat: { gap: 1, verb: 0.6, play(e, o) {
    boom(e, o, { f: 90, f2: 25, dur: 1.4, vol: 0.9 });
    tone(e, lowpass(e, o, 900), { type: 'sawtooth', f: 220, f2: 55, dur: 1.6, vol: 0.18 });
  } },

  // ---- Boss attacks: charge-ups rise in pitch, then a distinct release sound ----
  laserCharge: { gain: 0.75, gap: 0.2, sustain: true, play(e, o, { dur = 1 }) {
    tone(e, lowpass(e, o, 2400), { type: 'sawtooth', f: 90, f2: 420, dur, vol: 0.16, a: 0.1, sustain: true });
    tone(e, o, { f: 220, f2: 1100, dur, vol: 0.08, sustain: true });
  } },
  laserFire: { gap: 0.2, sustain: true, verb: 0.2, play(e, o) {
    boom(e, o, { f: 160, f2: 40, dur: 0.4, vol: 0.7 });
    const tr = tremolo(e, o, 28, 0.35);
    const lp = lowpass(e, tr, 1300, 2);
    tone(e, lp, { type: 'sawtooth', f: 72, vol: 0.28, a: 0.02, sustain: true });
    tone(e, lp, { type: 'sawtooth', f: 73.5, vol: 0.22, a: 0.02, sustain: true });
    tone(e, lp, { type: 'square', f: 145, vol: 0.08, a: 0.02, sustain: true });
    hiss(e, o, { f: 1600, q: 0.8, vol: 0.18, a: 0.02, sustain: true });
  } },
  orbCharge: { gain: 1.6, gap: 0.2, verb: 0.3, play(e, o) {
    tone(e, o, { f: 220, f2: 880, dur: 0.45, vol: 0.14 });
    tone(e, o, { type: 'triangle', f: 660, f2: 1760, dur: 0.45, vol: 0.06 });
  } },
  orbLaunch: { gain: 2, gap: 0.15, play(e, o) {
    tone(e, o, { type: 'triangle', f: 700, f2: 280, dur: 0.22, vol: 0.12 });
    hiss(e, o, { f: 2400, f2: 900, dur: 0.2, vol: 0.12 });
  } },
  orbPop: { gain: 2, gap: 0.05, play(e, o) {
    hiss(e, o, { f: 1800, dur: 0.1, vol: 0.18 });
    tone(e, o, { f: 520, f2: 200, dur: 0.09, vol: 0.12 });
  } },
  slamCharge: { gain: 0.6, gap: 0.2, sustain: true, play(e, o, { dur = 1.1 }) {
    tone(e, lowpass(e, o, 500), { type: 'sawtooth', f: 48, f2: 95, dur, vol: 0.32, a: 0.1, sustain: true });
    tone(e, o, { f: 600, f2: 1300, dur, vol: 0.05, sustain: true });
  } },
  slamFall: { gain: 3, gap: 0.2, play(e, o) { hiss(e, o, { f: 600, f2: 3500, q: 1.5, dur: 0.15, vol: 0.4 }); } },
  slamImpact: { gap: 0.2, verb: 0.5, play(e, o) {
    boom(e, o, { f: 85, f2: 24, dur: 1.1, vol: 1 });
    hiss(e, o, { filter: 'lowpass', f: 2400, f2: 250, dur: 0.8, vol: 0.7 });
    tone(e, o, { type: 'square', f: 70, dur: 0.12, vol: 0.15 });
  } },
  bladesCharge: { gap: 0.2, verb: 0.3, play(e, o) {
    tone(e, o, { f: 330, f2: 660, dur: 0.9, vol: 0.12 });
    tone(e, o, { f: 1245, dur: 0.9, vol: 0.06, a: 0.3 });
  } },
  bladesSpin: { gap: 0.2, sustain: true, play(e, o) {
    const tr = tremolo(e, o, 11, 0.7);
    tone(e, lowpass(e, tr, 1800), { type: 'sawtooth', f: 190, vol: 0.18, a: 0.05, sustain: true });
    hiss(e, tr, { filter: 'highpass', f: 3500, vol: 0.12, a: 0.05, sustain: true });
  } },
  spiralCharge: { gain: 2, gap: 0.2, play(e, o) { tone(e, o, { type: 'triangle', f: 400, f2: 1300, dur: 0.6, vol: 0.12 }); } },
  spiral: { gap: 0.2, sustain: true, play(e, o) {
    // Rapid-fire pulses: a square LFO chops a bright tone.
    const tr = tremolo(e, o, 13, 0.9);
    tone(e, tr, { type: 'triangle', f: 1180, vol: 0.09, a: 0.02, sustain: true });
    hiss(e, tr, { f: 2600, q: 2, vol: 0.12, a: 0.02, sustain: true });
  } },
  wellForm: { gain: 0.7, gap: 0.2, sustain: true, play(e, o) {
    const tr = tremolo(e, o, 5, 0.5);
    tone(e, tr, { f: 320, f2: 55, dur: 2.6, vol: 0.28, a: 0.2, sustain: true });
    hiss(e, lowpass(e, tr, 600), { filter: 'lowpass', f: 900, vol: 0.3, a: 0.4, sustain: true });
  } },
  wellBurst: { gap: 0.2, verb: 0.5, play(e, o) {
    boom(e, o, { f: 70, f2: 25, dur: 0.9, vol: 1 });
    hiss(e, o, { f: 5000, f2: 250, q: 0.6, dur: 0.5, vol: 0.5 });
  } },
  lanceCharge: { gap: 0.2, sustain: true, play(e, o, { dur = 1 }) {
    tone(e, o, { f: 200, f2: 1000, dur, vol: 0.1, a: 0.05, sustain: true });
    hiss(e, o, { f: 800, f2: 5000, dur, vol: 0.1, a: dur * 0.8, sustain: true });
  } },
  lanceDash: { gap: 0.2, play(e, o) {
    hiss(e, o, { f: 3500, f2: 500, q: 1.2, dur: 0.45, vol: 0.6 });
    tone(e, o, { f: 600, f2: 150, dur: 0.4, vol: 0.12 });
    boom(e, o, { f: 120, f2: 40, dur: 0.3, vol: 0.4, t: 0.3 });
  } },
  meteorFall: { gain: 1.5, gap: 0.15, play(e, o) {
    tone(e, o, { f: 1900, f2: 500, dur: 1.2, vol: 0.05 });
    hiss(e, o, { filter: 'lowpass', f: 3000, f2: 700, dur: 1.2, vol: 0.12, a: 0.6 });
  } },
  meteorImpact: { gap: 0.06, verb: 0.3, play(e, o) {
    boom(e, o, { f: 105, f2: 34, dur: 0.5, vol: 0.75 });
    hiss(e, o, { filter: 'lowpass', f: 2000, f2: 300, dur: 0.35, vol: 0.4 });
  } },
  beamCharge: { gain: 0.75, gap: 0.3, sustain: true, verb: 0.3, play(e, o, { dur = 2.4 }) {
    tone(e, lowpass(e, o, 1800), { type: 'sawtooth', f: 40, f2: 160, dur, vol: 0.32, a: 0.2, sustain: true });
    tone(e, o, { f: 110, f2: 990, dur, vol: 0.08, a: 0.3, sustain: true });
    hiss(e, o, { f: 300, f2: 4000, dur, vol: 0.2, a: dur * 0.9, sustain: true });
  } },
  beamFire: { gap: 0.3, sustain: true, verb: 0.4, play(e, o) {
    boom(e, o, { f: 120, f2: 22, dur: 1.2, vol: 1 });
    const tr = tremolo(e, o, 22, 0.3);
    const lp = lowpass(e, tr, 900, 2);
    for (const f of [48, 49.3, 97]) tone(e, lp, { type: 'sawtooth', f, vol: 0.3, a: 0.03, sustain: true });
    hiss(e, o, { f: 900, q: 0.5, vol: 0.35, a: 0.03, sustain: true });
  } },
};

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, music: 0.6, sfx: 0.9 };
    this.last = new Map();
    this.listenerPos = new THREE.Vector3();
    this.listenerRight = new THREE.Vector3(1, 0, 0);
    this.music = null;
    this.paused = false;
    this.slow = false;
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  // Must run inside a user gesture the first time.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      const c = this.ctx;
      this.master = c.createGain();
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -16;
      this.comp.knee.value = 12;
      this.comp.ratio.value = 5;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.2;
      this.slowFilter = c.createBiquadFilter();
      this.slowFilter.type = 'lowpass';
      this.slowFilter.frequency.value = 20000;
      this.sfxBus = c.createGain();
      this.musicBus = c.createGain();
      this.duck = c.createGain();
      this.musicBus.connect(this.duck).connect(this.slowFilter);
      this.sfxBus.connect(this.slowFilter);
      this.slowFilter.connect(this.comp).connect(this.master).connect(c.destination);

      // Shared white noise and a synthetic reverb impulse (decaying stereo noise).
      const len = c.sampleRate * 2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const nd = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
      const irLen = Math.floor(c.sampleRate * 2.4);
      const ir = c.createBuffer(2, irLen, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / irLen) ** 3;
      }
      this.verb = c.createConvolver();
      this.verb.buffer = ir;
      this.verbSfx = c.createGain();
      this.verbSfx.gain.value = 0.5;
      this.verb.connect(this.verbSfx).connect(this.slowFilter);

      this.music = new Music(this);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setVolumes({ master, music, sfx }) {
    Object.assign(this.vol, { master, music, sfx });
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sq = (v) => v * v; // perceptual curve
    this.master.gain.setTargetAtTime(sq(this.vol.master), t, 0.05);
    this.musicBus.gain.setTargetAtTime(sq(this.vol.music) * 0.55 * (this.paused ? 0.45 : 1), t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.paused ? 0 : sq(this.vol.sfx), t, 0.05);
  }

  // Pause mutes effects (sustained sounds keep their place) and softens the music.
  setPaused(on) {
    if (this.paused === on) return;
    this.paused = on;
    this.applyVolumes();
  }

  // Perfect-dodge slow-mo: muffle everything.
  setSlowmo(on) {
    if (!this.ctx || this.slow === on) return;
    this.slow = on;
    this.slowFilter.frequency.setTargetAtTime(on ? 750 : 20000, this.ctx.currentTime, on ? 0.04 : 0.25);
  }

  // Briefly lower the music under a big impact.
  duckMusic(amount = 0.5, time = 0.4) {
    if (!this.ctx) return;
    const g = this.duck.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1 - amount, t);
    g.linearRampToValueAtTime(1, t + time);
  }

  setListener(camera) {
    camera.getWorldPosition(this.listenerPos);
    this.listenerRight.setFromMatrixColumn(camera.matrixWorld, 0);
  }

  // Plays a named effect. opts: { pos (world, for pan + distance), vol, ...recipe options }.
  // Returns { stop() } (a no-op handle if audio is off).
  play(name, opts = {}) {
    const r = SFX[name];
    if (!r || !this.ctx || this.ctx.state !== 'running') return NOOP;
    const now = this.ctx.currentTime;
    if (r.gap && now - (this.last.get(name) ?? -1) < r.gap) return NOOP;
    this.last.set(name, now);

    const c = this.ctx;
    const out = c.createGain();
    let vol = opts.vol ?? 1;
    let pan = 0;
    if (opts.pos) {
      _d.subVectors(opts.pos, this.listenerPos);
      const dist = _d.length();
      if (dist > 0.01) pan = THREE.MathUtils.clamp(_d.dot(this.listenerRight) / dist, -1, 1) * 0.75;
      // Gentle falloff that never drops below 35 %: boss tells must stay audible.
      vol *= Math.max(0.35, 1 / (1 + Math.max(0, dist - 12) / 30));
    }
    out.gain.value = vol * (r.gain ?? 1);
    let node = out;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      node = p;
    }
    node.connect(this.sfxBus);
    if (r.verb) {
      const send = c.createGain();
      send.gain.value = r.verb;
      node.connect(send).connect(this.verb);
    }
    r.play(this, out, opts);

    // Safety stop for sustained sounds whose owner forgets them.
    let stopped = false;
    const stop = (fade = 0.15) => {
      if (stopped) return;
      stopped = true;
      const t = c.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + fade);
      setTimeout(() => out.disconnect(), (fade + 0.1) * 1000);
    };
    if (r.sustain) setTimeout(() => stop(0.3), 10000);
    else setTimeout(() => { stopped = true; out.disconnect(); }, 4000);
    return { stop };
  }
}

const NOOP = { stop() {} };

export const audio = new SoundEngine();
