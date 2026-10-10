// Procedural soundtrack: a small step sequencer with synthesized instruments.
// Tracks are written as 16-step bars; music.play(name) crossfades between them.
//
// Note names: 'C4', 'F#3', 'Bb2'. In note strings '.' is a rest and '-' holds the previous note.

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return null;
  return NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// "A4 . - C5" -> [{ step, midi, len }]
function parseLine(str) {
  const tokens = str.trim().split(/\s+/);
  const out = [];
  tokens.forEach((tok, i) => {
    if (tok === '.') return;
    if (tok === '-') { if (out.length) out[out.length - 1].len++; return; }
    out.push({ step: i, midi: midi(tok), len: 1 });
  });
  return out;
}
const hits = (pattern) => [...pattern.replace(/\s/g, '')].map((ch) => (ch === 'x' ? 1 : ch === 'o' ? 0.55 : 0));

// ---------- Tracks ----------
// chords: one per bar (root first). bass: semitone offsets from the bar's root per step (null = rest).
// arp: indices into the chord (+12 per wrap). lead/bells: per-bar note strings (loop length = lines).
const TRACKS = {
  title: {
    bpm: 76,
    chords: [['A2', 'C4', 'E4', 'A4'], ['F2', 'A3', 'C4', 'F4'], ['C3', 'E4', 'G4', 'C5'], ['G2', 'B3', 'D4', 'G4']],
    pad: { wave: 'triangle', vol: 0.1, cutoff: 1400 },
    bell: [
      'A5 . . . E5 . . . C6 . . . B5 . . .',
      'A5 . . . F5 . . . C6 . . . A5 . . .',
      'G5 . . . E5 . . . C6 . . . D6 . . .',
      'B5 . . . G5 . . . D5 . . . . . . .',
    ],
  },
  phase1: {
    bpm: 136,
    chords: [['D2', 'D4', 'F4', 'A4'], ['A#1', 'D4', 'F4', 'A#4'], ['C2', 'C4', 'E4', 'G4'], ['A1', 'C#4', 'E4', 'A4']],
    kick: ['x...x...x...x...', 'x...x...x...x...', 'x...x...x...x...', 'x...x...x.x.x.xx'],
    snare: ['....x.......x...', '....x.......x...', '....x.......x...', '....x.......x.oo'],
    hat: 'o.x.o.x.o.x.o.xo',
    bass: [0, null, 0, 12, 0, null, 0, 12, 0, null, 0, 12, 0, null, 7, 10],
    bassTone: { cutoff: 900, drive: 0 },
    arp: { steps: [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2], vol: 0.045, octave: 12, from: 4 },
    pad: { wave: 'sawtooth', vol: 0.028, cutoff: 1100 },
    lead: [
      '. . . . . . . . . . . . . . . .',
      '. . . . . . . . . . . . . . . .',
      '. . . . . . . . . . . . . . . .',
      '. . . . . . . . . . . . . . . .',
      'D5 - - - A4 - - - F5 - - - E5 - D5 -',
      'D5 - - - F5 - - - A#5 - - - A5 - - -',
      'G5 - - - E5 - - - C5 - - - E5 - G5 -',
      'A5 - - - - - - - C#5 - - - E5 - - -',
    ],
    leadTone: { wave: 'square', vol: 0.05 },
  },
  phase2: {
    bpm: 144,
    chords: [['B1', 'B3', 'D4', 'F#4'], ['G1', 'B3', 'D4', 'G4'], ['D2', 'A3', 'D4', 'F#4'], ['A1', 'A3', 'C#4', 'E4']],
    kick: ['x.......x.x.....', 'x.......x.......', 'x.......x.x.....', 'x.......x...x.x.'],
    snare: ['....x.......x...', '....x.......x...', '....x.......x...', '....x.......x.ox'],
    hat: 'x.o.x.o.x.o.x.oo',
    bass: [0, null, null, 0, null, null, 0, null, 0, null, null, 12, null, null, 0, null],
    bassTone: { cutoff: 700, drive: 0 },
    pad: { wave: 'triangle', vol: 0.05, cutoff: 2200, choir: true },
    bell: [
      'F#5 . . . B5 . . . C#6 . . . D6 . C#6 .',
      'B5 . . . D6 . . . G6 . . . F#6 . D6 .',
      'A5 . . . D6 . . . F#6 . . . E6 . D6 .',
      'C#6 . . . E6 . . . A5 . . . . . . .',
      'F#6 . E6 . D6 . C#6 . B5 . . . F#5 . . .',
      'G5 . A5 . B5 . D6 . G6 . . . F#6 . . .',
      'F#6 . E6 . D6 . A5 . D6 . . . F#6 . A6 .',
      'G#6 . . . E6 . . . C#6 . . . E6 . . .',
    ],
  },
  phase3: {
    bpm: 168,
    chords: [['C2', 'C4', 'D#4', 'G4'], ['G#1', 'C4', 'D#4', 'G#4'], ['A#1', 'A#3', 'D4', 'F4'], ['G1', 'B3', 'D4', 'G4']],
    kick: ['x..x..x.x..x..x.', 'x..x..x.x..x..x.', 'x..x..x.x..x..x.', 'x..x..x.x.x.xxxx'],
    snare: ['....x.......x...', '....x.......x...', '....x.......x...', '....x..o.ox.xoxx'],
    hat: 'xoxoxoxoxoxoxoxo',
    crash: true,
    bass: [0, 0, 12, 0, 0, 12, 0, 0, 0, 0, 12, 0, 10, 0, 7, 0],
    bassTone: { cutoff: 1300, drive: 1 },
    arp: { steps: [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 2, 1, 0], vol: 0.04, octave: 12, from: 0 },
    pad: { wave: 'sawtooth', vol: 0.026, cutoff: 1500 },
    lead: [
      'C5 - - G4 - - C5 - D#5 - - D5 - - C5 -',
      'G#4 - - C5 - - D#5 - G#5 - - G5 - - D#5 -',
      'F5 - - D5 - - A#4 - D5 - - F5 - - A#5 -',
      'B5 - - - G5 - - - D5 - - - B4 - - -',
    ],
    leadTone: { wave: 'sawtooth', vol: 0.045 },
  },
  victory: {
    bpm: 96,
    chords: [['C2', 'C4', 'E4', 'G4'], ['G1', 'B3', 'D4', 'G4'], ['A1', 'C4', 'E4', 'A4'], ['F1', 'C4', 'F4', 'A4']],
    hat: '..o...o...o...o.',
    bass: [0, null, null, null, null, null, null, null, 12, null, null, null, null, null, null, null],
    bassTone: { cutoff: 600, drive: 0 },
    pad: { wave: 'triangle', vol: 0.11, cutoff: 2400, choir: true },
    bell: [
      'C6 . G5 . E6 . . . D6 . C6 . G5 . . .',
      'B5 . G5 . D6 . . . B5 . . . G5 . . .',
      'A5 . C6 . E6 . . . D6 . C6 . E6 . . .',
      'F6 . E6 . C6 . A5 . C6 . . . . . . .',
    ],
  },
  defeat: {
    bpm: 60,
    chords: [['D2', 'D4', 'F4', 'A4'], ['A#1', 'D4', 'F4', 'A#4'], ['G1', 'D4', 'G4', 'A#4'], ['A1', 'C#4', 'E4', 'A4']],
    pad: { wave: 'triangle', vol: 0.1, cutoff: 900 },
    bell: [
      'A5 . . . . . . . F5 . . . . . . .',
      'D5 . . . . . . . . . . . . . . .',
      'G5 . . . . . . . D5 . . . . . . .',
      'E5 . . . . . . . C#5 . . . . . . .',
    ],
  },
};
for (const t of Object.values(TRACKS)) {
  t.chordMidi = t.chords.map((c) => c.map(midi));
  if (t.lead) t.leadNotes = t.lead.map(parseLine);
  if (t.bell) t.bellNotes = t.bell.map(parseLine);
  for (const k of ['kick', 'snare']) if (t[k]) t[k + 'Hits'] = t[k].map(hits);
  if (t.hat) t.hatHits = hits(t.hat);
}

export class Music {
  constructor(engine) {
    this.e = engine;
    this.ctx = engine.ctx;
    this.current = null;
    this.timer = setInterval(() => this.schedule(), 25);
    // Music reverb send.
    this.wet = this.ctx.createGain();
    this.wet.gain.value = 0.35;
    this.wet.connect(engine.verb);
    // Soft-clip curve for the Phase 3 bass.
    this.curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) this.curve[i] = Math.tanh(((i / 1023) * 2 - 1) * 3);
  }

  // Crossfade to a track (or silence with null).
  play(name, fade = 1.2) {
    if (this.current?.name === name) return;
    const c = this.ctx;
    const t = c.currentTime;
    if (this.current) {
      const old = this.current;
      old.out.gain.cancelScheduledValues(t);
      old.out.gain.setValueAtTime(old.out.gain.value, t);
      old.out.gain.linearRampToValueAtTime(0, t + fade);
      setTimeout(() => old.out.disconnect(), (fade + 3) * 1000);
      this.current = null;
    }
    const song = name && TRACKS[name];
    if (!song) return;
    const out = c.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + Math.min(fade, 0.6));
    out.connect(this.e.musicBus);
    out.connect(this.wet);
    const shaper = c.createWaveShaper();
    shaper.curve = this.curve;
    shaper.connect(out);
    this.current = { name, song, out, shaper, step: 0, bar: 0, next: t + 0.08 };
  }

  schedule() {
    const cur = this.current;
    if (!cur || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // Coming back from a throttled background tab: don't fire a burst of late notes.
    if (cur.next < now - 0.2) cur.next = now + 0.05;
    const stepLen = 60 / cur.song.bpm / 4;
    while (cur.next < now + 0.12) {
      this.playStep(cur, cur.next, stepLen);
      cur.next += stepLen;
      cur.step++;
      if (cur.step >= 16) { cur.step = 0; cur.bar++; }
    }
  }

  playStep(cur, t, stepLen) {
    const s = cur.song;
    const i = cur.step;
    const chord = s.chordMidi[cur.bar % s.chordMidi.length];
    const out = cur.out;
    const bar4 = cur.bar % 4;

    if (s.kickHits?.[bar4][i]) this.kick(out, t, s.kickHits[bar4][i]);
    if (s.snareHits?.[bar4][i]) this.snare(out, t, s.snareHits[bar4][i]);
    if (s.hatHits?.[i]) this.hat(out, t, s.hatHits[i]);
    if (s.crash && i === 0 && cur.bar % 8 === 0) this.crash(out, t);
    if (s.bass) {
      const off = s.bass[i];
      if (off !== null && off !== undefined) this.bass(s.bassTone?.drive ? cur.shaper : out, t, chord[0] + off, stepLen * 1.6, s.bassTone);
    }
    if (s.pad && i === 0) this.pad(out, t, chord.slice(1), stepLen * 16, s.pad);
    if (s.arp && cur.bar >= (s.arp.from ?? 0)) {
      const notes = chord.slice(1);
      const k = s.arp.steps[i];
      this.pluck(out, t, notes[k % notes.length] + s.arp.octave + Math.floor(k / notes.length) * 12, stepLen * 0.9, s.arp.vol);
    }
    const lead = s.leadNotes?.[cur.bar % s.leadNotes.length];
    if (lead) for (const n of lead) if (n.step === i) this.lead(out, t, n.midi, n.len * stepLen, s.leadTone);
    const bell = s.bellNotes?.[cur.bar % s.bellNotes.length];
    if (bell) for (const n of bell) if (n.step === i) this.bell(out, t, n.midi, Math.max(0.8, n.len * stepLen * 2));
  }

  // ---------- Instruments ----------
  env(t, a, peak, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  osc(type, f, t, dur, dest, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noise(t, dur, dest, type, f, q = 0.7) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.e.noise;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    flt.Q.value = q;
    src.connect(flt).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  kick(out, t, v) {
    const g = this.env(t, 0.002, 0.9 * v, 0.32);
    g.connect(out);
    const o = this.osc('sine', 150, t, 0.32, g);
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  }

  snare(out, t, v) {
    const g = this.env(t, 0.002, 0.32 * v, 0.17);
    g.connect(out);
    this.noise(t, 0.17, g, 'bandpass', 1900);
    const g2 = this.env(t, 0.002, 0.18 * v, 0.1);
    g2.connect(out);
    this.osc('triangle', 185, t, 0.1, g2);
  }

  hat(out, t, v) {
    const g = this.env(t, 0.001, 0.09 * v, 0.04);
    g.connect(out);
    this.noise(t, 0.04, g, 'highpass', 8000);
  }

  crash(out, t) {
    const g = this.env(t, 0.003, 0.12, 1.4);
    g.connect(out);
    this.noise(t, 1.4, g, 'highpass', 5000);
  }

  bass(out, t, m, dur, { cutoff = 900, drive = 0 } = {}) {
    const c = this.ctx;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 5;
    flt.frequency.setValueAtTime(cutoff * 2, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.25), t + dur);
    const g = this.env(t, 0.004, drive ? 0.13 : 0.2, dur);
    flt.connect(g).connect(out);
    const f = hz(m);
    this.osc('sawtooth', f, t, dur, flt, -7);
    this.osc('sawtooth', f, t, dur, flt, 7);
  }

  pad(out, t, notes, dur, { wave = 'sawtooth', vol = 0.03, cutoff = 1200, choir = false } = {}) {
    const c = this.ctx;
    const flt = c.createBiquadFilter();
    flt.type = choir ? 'bandpass' : 'lowpass';
    flt.frequency.value = cutoff;
    flt.Q.value = choir ? 0.6 : 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.25);
    g.gain.setValueAtTime(vol, t + dur * 0.75);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.02);
    flt.connect(g).connect(out);
    for (const m of notes) {
      const f = hz(m);
      this.osc(wave, f, t, dur * 1.05, flt, -9);
      this.osc(wave, f, t, dur * 1.05, flt, 9);
    }
  }

  pluck(out, t, m, dur, vol = 0.04) {
    const c = this.ctx;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 3;
    flt.frequency.setValueAtTime(4000, t);
    flt.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = this.env(t, 0.003, vol, dur);
    flt.connect(g).connect(out);
    this.osc('sawtooth', hz(m), t, dur, flt);
  }

  lead(out, t, m, dur, { wave = 'square', vol = 0.05 } = {}) {
    const c = this.ctx;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 2600;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.setValueAtTime(vol, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    flt.connect(g).connect(out);
    g.connect(this.wet);
    const f = hz(m);
    const a = this.osc(wave, f, t, dur + 0.1, flt, -5);
    const b = this.osc('sawtooth', f, t, dur + 0.1, flt, 6);
    // Delayed vibrato on held notes.
    if (dur > 0.25) {
      const lfo = c.createOscillator();
      lfo.frequency.value = 5.5;
      const amt = c.createGain();
      amt.gain.setValueAtTime(0, t);
      amt.gain.linearRampToValueAtTime(14, t + dur);
      lfo.connect(amt);
      amt.connect(a.detune);
      amt.connect(b.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
    }
  }

  // FM bell: a sine carrier with an inharmonic modulator whose depth decays.
  bell(out, t, m, dur) {
    const c = this.ctx;
    const f = hz(m);
    const g = this.env(t, 0.003, 0.07, dur);
    g.connect(out);
    g.connect(this.wet);
    const car = this.osc('sine', f, t, dur, g);
    const mod = c.createOscillator();
    mod.frequency.value = f * 3.5;
    const idx = c.createGain();
    idx.gain.setValueAtTime(f * 2.2, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.6);
    mod.connect(idx).connect(car.frequency);
    mod.start(t);
    mod.stop(t + dur + 0.05);
  }
}
