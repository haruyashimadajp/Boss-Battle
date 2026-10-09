const KEY = 'aether-breaker:settings';

const isTouchDevice = () =>
  matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;

const DEFAULTS = {
  controls: 'auto', // auto | pc | mobile
  quality: isTouchDevice() ? 'medium' : 'high', // low | medium | high
  sensitivity: 1,
  invertY: false,
  showFps: false,
};

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      Object.assign(this.values, saved);
    } catch { /* storage unavailable */ }
    this.listeners = new Set();
  }

  get(key) { return this.values[key]; }

  set(key, value) {
    this.values[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* ignore */ }
    for (const fn of this.listeners) fn(key, value);
  }

  onChange(fn) { this.listeners.add(fn); }

  // Resolved control scheme: 'pc' or 'mobile'.
  get controlMode() {
    const c = this.values.controls;
    if (c === 'pc' || c === 'mobile') return c;
    return isTouchDevice() ? 'mobile' : 'pc';
  }
}
