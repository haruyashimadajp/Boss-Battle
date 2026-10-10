// Title / pause / settings screens and control-mode switching.
import { audio } from '../audio/audio.js';
import { DIFFICULTY } from '../config.js';

const HELP = {
  pc: [
    ['WASD', 'Move'],
    ['MOUSE', 'Camera'],
    ['SPACE', 'Jump / double jump'],
    ['SHIFT', 'Air dash'],
    ['Q / RMB', 'Grapple (hold)'],
    ['LMB / J', 'Attack (air: 3rd hit plunges)'],
    ['F', 'Overdrive (full OD gauge)'],
    ['TAB / MMB', 'Lock-on camera on/off'],
    ['ESC', 'Pause'],
    ['PAD', 'Gamepad supported'],
  ],
  mobile: [
    ['LEFT', 'Move (virtual stick)'],
    ['RIGHT', 'Drag to look'],
    ['JUMP', 'Jump / double jump'],
    ['DASH', 'Air dash'],
    ['HOOK', 'Grapple (hold)'],
    ['ATK', 'Attack (air: 3rd hit plunges)'],
    ['OD', 'Overdrive (full gauge)'],
    ['LOCK', 'Lock-on camera on/off'],
  ],
};

export class Menus {
  constructor({ settings, input, onStart, onResume, onPause, onRespawn, onCheckpoint, onQuit, onApply }) {
    this.settings = settings;
    this.input = input;
    this.cb = { onStart, onResume, onPause, onRespawn, onCheckpoint, onQuit, onApply };
    this.el = {
      title: document.getElementById('title-screen'),
      result: document.getElementById('result-screen'),
      pause: document.getElementById('pause-screen'),
      settings: document.getElementById('settings-screen'),
      touch: document.getElementById('touch'),
      menuBtn: document.getElementById('btn-menu'),
      help: document.getElementById('controls-help'),
      sens: document.getElementById('sens'),
      sensOut: document.getElementById('sens-out'),
    };
    this.settingsReturn = null;

    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
    on('btn-start', () => this.cb.onStart());
    on('btn-title-settings', () => this.openSettings('title'));
    on('btn-resume', () => this.cb.onResume());
    on('btn-pause-settings', () => this.openSettings('pause'));
    on('btn-respawn', () => this.cb.onRespawn());
    on('btn-retry', () => this.cb.onStart());
    on('btn-checkpoint', () => this.cb.onCheckpoint());
    on('btn-result-title', () => this.cb.onQuit());
    on('btn-quit', () => this.cb.onQuit());
    on('btn-settings-back', () => this.closeSettings());
    this.el.menuBtn.addEventListener('click', () => this.cb.onPause());

    for (const seg of document.querySelectorAll('.seg')) {
      const key = seg.dataset.key;
      for (const b of seg.querySelectorAll('button')) {
        b.addEventListener('click', () => {
          const raw = b.dataset.value;
          this.settings.set(key, raw === 'true' ? true : raw === 'false' ? false : raw);
        });
      }
    }
    this.el.sens.addEventListener('input', () => this.settings.set('sensitivity', parseFloat(this.el.sens.value)));
    for (const r of document.querySelectorAll('[data-vol]')) {
      r.addEventListener('input', () => this.settings.set(r.dataset.vol, parseFloat(r.value)));
    }
    // Click feedback for every menu button.
    document.getElementById('ui').addEventListener('click', (e) => {
      if (e.target.closest('.btn, .seg button')) audio.play('ui');
    });

    settings.onChange(() => this.apply());
    this.apply();
  }

  // Reflect settings in the UI and notify the game.
  apply() {
    const s = this.settings;
    for (const seg of document.querySelectorAll('.seg')) {
      const v = String(s.get(seg.dataset.key));
      for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.value === v);
    }
    this.el.sens.value = s.get('sensitivity');
    this.el.sensOut.textContent = `${Number(s.get('sensitivity')).toFixed(1)}x`;
    for (const r of document.querySelectorAll('[data-vol]')) {
      r.value = s.get(r.dataset.vol);
      document.querySelector(`[data-out="${r.dataset.vol}"]`).textContent = `${Math.round(s.get(r.dataset.vol) * 100)}%`;
    }
    document.getElementById('diff-out').textContent = s.get('difficulty') === 'normal'
      ? `${DIFFICULTY.normal.maxHp} HP, slower boss` : `${DIFFICULTY.hard.maxHp} HP (intended)`;

    const mode = s.controlMode;
    document.body.classList.toggle('mobile', mode === 'mobile');
    this.el.help.innerHTML = HELP[mode].map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('');
    this.refreshControls();
    this.cb.onApply(mode);
  }

  setState(state) {
    this.state = state;
    this.el.title.hidden = state !== 'title';
    this.el.pause.hidden = state !== 'paused';
    this.el.result.hidden = state !== 'result';
    this.el.settings.hidden = true;
    this.refreshControls();
  }

  refreshControls() {
    const mobile = this.settings.controlMode === 'mobile';
    this.el.touch.hidden = !(this.state === 'playing' && mobile);
    this.el.menuBtn.hidden = this.state !== 'playing';
  }

  // { win, title, rank, rows: [[label, value], ...], checkpoint: phase to retry from (0 = none) }
  showResult({ win, title, rank, rows, checkpoint = 0 }) {
    const panel = this.el.result.querySelector('.panel');
    panel.classList.toggle('lose', !win);
    document.getElementById('result-title').textContent = title;
    const cp = document.getElementById('btn-checkpoint');
    cp.hidden = !checkpoint;
    cp.textContent = `FROM PHASE ${checkpoint}`;
    document.getElementById('btn-retry').classList.toggle('primary', !checkpoint);
    document.getElementById('btn-retry').textContent = checkpoint ? 'FULL RESTART' : 'RETRY';
    document.getElementById('result-rank').textContent = rank;
    document.getElementById('result-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }

  openSettings(from) {
    this.settingsReturn = from;
    this.el.title.hidden = true;
    this.el.pause.hidden = true;
    this.el.settings.hidden = false;
  }

  closeSettings() {
    this.el.settings.hidden = true;
    if (this.settingsReturn === 'title') this.el.title.hidden = false;
    else this.el.pause.hidden = false;
  }
}
