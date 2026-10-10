import * as THREE from 'three';

// Canvas-painted textures for Seraphina: the face atlas, lace, gold embroidery and feathers.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(tex, { srgb = true, repeat = false } = {}) {
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  if (repeat) tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ---------- Face atlas ----------
// 4x4 tiles of 256 px; a tile covers 0.5 x 0.5 m of face. Eye, brow and blush tiles are drawn for
// her left side (+x, the viewer's right), so the inner corner is on the tile's left.
//   0 eye white      1 eye lines       2 eye white (angry)  3 eye lines (angry)
//   4 closed         5 closed (angry)  6 happy ^            7 dizzy @
//   8 iris blue      9 iris crimson   10 brow              11 brow (angry)
//  12 mouth smile   13 mouth angry    14 mouth wavy        15 blush
export const FACE = {
  white: 0, lines: 1, whiteAngry: 2, linesAngry: 3, closed: 4, closedAngry: 5, happy: 6, dizzy: 7,
  irisBlue: 8, irisRed: 9, brow: 10, browAngry: 11, smile: 12, frown: 13, wavy: 14, blush: 15,
};

const INK = '#2a1a30';

const EYE = {
  // Upper lid (lower edge of the lash line), inner corner to outer corner.
  calm: {
    lid: [[40, 138], [52, 84, 96, 56, 132, 54], [172, 52, 206, 74, 224, 112]],
    top: [[36, 138], [48, 80, 94, 48, 132, 46], [176, 44, 214, 62, 236, 100]],
    low: [[226, 128], [214, 184, 176, 214, 128, 214], [84, 214, 52, 184, 40, 138]],
  },
  angry: {
    lid: [[46, 150], [70, 108, 110, 84, 140, 80], [180, 76, 210, 88, 226, 114]],
    top: [[42, 150], [66, 98, 106, 70, 140, 68], [184, 64, 216, 76, 238, 104]],
    low: [[228, 128], [214, 178, 176, 204, 130, 206], [86, 206, 58, 186, 46, 150]],
  },
};

function curve(ctx, pts, move = true) {
  const [s, ...cs] = pts;
  if (move) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
  for (const c of cs) ctx.bezierCurveTo(...c);
}
function reverse(pts) {
  // Reverse a [start, c1, c2...] cubic chain.
  const out = [];
  let end = pts[pts.length - 1];
  out.push([end[4], end[5]]);
  for (let i = pts.length - 1; i >= 1; i--) {
    const c = pts[i];
    const prev = i === 1 ? pts[0] : [pts[i - 1][4], pts[i - 1][5]];
    out.push([c[2], c[3], c[0], c[1], prev[0], prev[1]]);
  }
  return out;
}

function eyeWhite(ctx, e) {
  ctx.beginPath();
  curve(ctx, e.lid);
  curve(ctx, e.low, false);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 50, 0, 214);
  g.addColorStop(0, '#9aa6dc');
  g.addColorStop(0.28, '#e9edff');
  g.addColorStop(1, '#ffffff');
  ctx.fillStyle = g;
  ctx.fill();
}

function eyeLines(ctx, e, angry) {
  // Lash line: thin at the inner corner, heavy toward the outer corner.
  ctx.fillStyle = INK;
  ctx.beginPath();
  curve(ctx, e.top);
  const t = e.top[e.top.length - 1];
  const l = e.lid[e.lid.length - 1];
  ctx.quadraticCurveTo(t[4] + 6, t[5] - 2, t[4] + 12, t[5] - 9); // flick out past the corner
  ctx.quadraticCurveTo(t[4] + 4, t[5] + 8, l[4] + 2, l[5] + 6);
  curve(ctx, reverse(e.lid), false);
  ctx.closePath();
  ctx.fill();
  // A few lashes fanning out of the outer half.
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  for (const [x, y, dx, dy, w] of [[196, angry ? 68 : 58, 16, -12, 3.5], [214, angry ? 78 : 70, 18, -8, 3]]) {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    ctx.quadraticCurveTo(x + dx * 0.3, y - 4, x + dx, y + dy);
    ctx.stroke();
  }
  // Double-eyelid crease.
  ctx.strokeStyle = 'rgba(122, 72, 96, 0.55)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (angry) { ctx.moveTo(84, 60); ctx.bezierCurveTo(120, 42, 184, 44, 222, 76); }
  else { ctx.moveTo(72, 40); ctx.bezierCurveTo(110, 20, 180, 22, 222, 60); }
  ctx.stroke();
  // Lower lid: outer half only, soft.
  ctx.strokeStyle = 'rgba(96, 52, 74, 0.8)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const lo = e.low[1];
  ctx.moveTo(e.low[0][0] - 3, e.low[0][1] + 12);
  ctx.quadraticCurveTo(lo[0] - 4, lo[1] - 2, lo[4] + 8, lo[5]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(96, 52, 74, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(62, angry ? 176 : 182);
  ctx.quadraticCurveTo(80, angry ? 198 : 204, 112, angry ? 205 : 212);
  ctx.stroke();
  // Inner corner.
  ctx.strokeStyle = 'rgba(110, 50, 70, 0.65)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  const s = e.lid[0];
  ctx.moveTo(s[0], s[1]);
  ctx.quadraticCurveTo(s[0] + 3, s[1] + 12, s[0] + 13, s[1] + 16);
  ctx.stroke();
}

function iris(ctx, [top, mid, low, bottom], ring, glint) {
  const cx = 132;
  const cy = 132;
  const rx = 64;
  const ry = 82;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
  g.addColorStop(0, top);
  g.addColorStop(0.3, top);
  g.addColorStop(0.55, mid);
  g.addColorStop(0.8, low);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  // Radial fibres.
  ctx.strokeStyle = glint;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 2;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * rx * 0.38, cy + 6 + Math.sin(a) * ry * 0.38);
    ctx.lineTo(cx + Math.cos(a) * rx * 0.95, cy + 6 + Math.sin(a) * ry * 0.95);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Glow pooling in the lower half.
  const lg = ctx.createRadialGradient(cx, cy + ry * 0.62, 4, cx, cy + ry * 0.62, rx * 0.95);
  lg.addColorStop(0, glint);
  lg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalAlpha = 1;
  // Shadow from the upper lid.
  const sg = ctx.createLinearGradient(0, cy - ry, 0, cy - ry * 0.2);
  sg.addColorStop(0, 'rgba(4, 6, 24, 0.75)');
  sg.addColorStop(1, 'rgba(4, 6, 24, 0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, 256, 256);
  // Pupil.
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 6, 25, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Rim.
  ctx.strokeStyle = ring;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx - 2, ry - 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Catchlights.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(cx - 27, cy - 36, 18, 23, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + 30, cy + 40, 10, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 34, cy - 24, 5, 0, Math.PI * 2);
  ctx.fill();
}

function stroke(ctx, w, color, draw) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  draw();
  ctx.stroke();
}

function lashFlick(ctx, x, y) {
  stroke(ctx, 4, INK, () => { ctx.moveTo(x - 6, y + 2); ctx.quadraticCurveTo(x + 6, y - 2, x + 14, y - 12); });
  stroke(ctx, 3, INK, () => { ctx.moveTo(x - 10, y + 4); ctx.quadraticCurveTo(x + 2, y + 4, x + 12, y); });
}

const TILES = [
  (ctx) => eyeWhite(ctx, EYE.calm),
  (ctx) => eyeLines(ctx, EYE.calm, false),
  (ctx) => eyeWhite(ctx, EYE.angry),
  (ctx) => eyeLines(ctx, EYE.angry, true),
  (ctx) => { // closed, gentle
    stroke(ctx, 7, INK, () => { ctx.moveTo(42, 150); ctx.bezierCurveTo(84, 186, 172, 188, 226, 142); });
    lashFlick(ctx, 222, 144);
  },
  (ctx) => { // closed, tense
    stroke(ctx, 8, INK, () => { ctx.moveTo(46, 152); ctx.bezierCurveTo(92, 164, 172, 150, 228, 126); });
    lashFlick(ctx, 224, 128);
  },
  (ctx) => { // happy ^
    stroke(ctx, 9, INK, () => { ctx.moveTo(50, 176); ctx.bezierCurveTo(78, 98, 180, 96, 212, 168); });
  },
  (ctx) => { // dizzy spiral
    stroke(ctx, 6, INK, () => {
      for (let i = 0; i <= 120; i++) {
        const k = i / 120;
        const a = k * Math.PI * 2 * 2.6;
        const r = 6 + k * 58;
        const x = 132 + Math.cos(a) * r;
        const y = 140 + Math.sin(a) * r * 0.92;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    });
  },
  (ctx) => iris(ctx, ['#0a1546', '#1d4fc4', '#3aa6ff', '#b4f4ff'], '#071036', '#a8f2ff'),
  (ctx) => iris(ctx, ['#3a0414', '#b0123a', '#ff4a66', '#ffd0c8'], '#2a0210', '#ffc0b8'),
  (ctx) => { // brow
    ctx.fillStyle = '#8c8aae';
    ctx.beginPath();
    ctx.moveTo(50, 148);
    ctx.bezierCurveTo(92, 122, 160, 112, 214, 128);
    ctx.bezierCurveTo(160, 120, 94, 130, 54, 156);
    ctx.closePath();
    ctx.fill();
  },
  (ctx) => { // brow, angry
    ctx.fillStyle = '#6e6c92';
    ctx.beginPath();
    ctx.moveTo(52, 166);
    ctx.bezierCurveTo(98, 146, 160, 112, 216, 98);
    ctx.bezierCurveTo(162, 122, 100, 160, 58, 178);
    ctx.closePath();
    ctx.fill();
  },
  (ctx) => { // nose + small open smile
    stroke(ctx, 3, 'rgba(196, 126, 118, 0.8)', () => { ctx.moveTo(125, 40); ctx.lineTo(129, 50); });
    ctx.fillStyle = '#b4405a';
    ctx.beginPath();
    ctx.moveTo(112, 163);
    ctx.quadraticCurveTo(128, 167, 144, 163);
    ctx.quadraticCurveTo(140, 184, 128, 185);
    ctx.quadraticCurveTo(116, 184, 112, 163);
    ctx.fill();
    ctx.fillStyle = '#f08a9e';
    ctx.beginPath();
    ctx.ellipse(128, 178, 8, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    stroke(ctx, 2.5, '#6a2638', () => { ctx.moveTo(110, 162); ctx.quadraticCurveTo(128, 168, 146, 162); });
  },
  (ctx) => { // nose + determined frown
    stroke(ctx, 3, 'rgba(196, 126, 118, 0.8)', () => { ctx.moveTo(125, 40); ctx.lineTo(129, 50); });
    stroke(ctx, 4, '#7a2c40', () => { ctx.moveTo(112, 172); ctx.quadraticCurveTo(128, 162, 144, 172); });
  },
  (ctx) => { // nose + wavy
    stroke(ctx, 3, 'rgba(196, 126, 118, 0.8)', () => { ctx.moveTo(125, 40); ctx.lineTo(129, 50); });
    stroke(ctx, 3.5, '#7a2c40', () => {
      ctx.moveTo(104, 170);
      for (let i = 0; i < 4; i++) ctx.quadraticCurveTo(110 + i * 12, i % 2 ? 178 : 160, 116 + i * 12, 170);
    });
  },
  (ctx) => { // blush with hatching
    ctx.save();
    ctx.scale(1, 0.45);
    const g = ctx.createRadialGradient(128, 128 / 0.45, 4, 128, 128 / 0.45, 80);
    g.addColorStop(0, 'rgba(255, 112, 146, 0.6)');
    g.addColorStop(0.55, 'rgba(255, 128, 160, 0.35)');
    g.addColorStop(1, 'rgba(255, 140, 170, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(128, 128 / 0.45, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    for (let i = 0; i < 4; i++) {
      stroke(ctx, 3.5, 'rgba(232, 84, 116, 0.75)', () => { ctx.moveTo(92 + i * 20, 142); ctx.lineTo(104 + i * 20, 114); });
    }
  },
];

export function faceAtlas() {
  const [c, ctx] = canvas(1024, 1024);
  TILES.forEach((draw, i) => {
    ctx.save();
    ctx.translate((i % 4) * 256, Math.floor(i / 4) * 256);
    ctx.beginPath();
    ctx.rect(4, 4, 248, 248);
    ctx.clip();
    draw(ctx);
    ctx.restore();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.premultiplyAlpha = true;
  return finish(tex, { srgb: false });
}

// ---------- Lace trim (alpha) ----------
// 256 x 64, tiles along u. Top edge sewn on, scalloped loops hanging below.
export function laceTexture() {
  const [c, ctx] = canvas(256, 64);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 12);
  for (let k = 0; k < 8; k++) {
    const x = 16 + k * 32;
    ctx.beginPath();
    ctx.arc(x, 30, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, 50, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 16; k++) {
    ctx.beginPath();
    ctx.arc(8 + k * 16, 6, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let k = 0; k < 8; k++) {
    const x = 16 + k * 32;
    ctx.beginPath();
    ctx.arc(x, 30, 8.5, 0, Math.PI * 2);
    ctx.fill();
    for (let j = 0; j < 5; j++) {
      const a = Math.PI * (0.15 + j * 0.175);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 13.5, 30 + Math.sin(a) * 13.5 + 14, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  return finish(new THREE.CanvasTexture(c), { repeat: true });
}

// ---------- Gold embroidered border on white cloth ----------
// 512 x 128, tiles along u.
export function bandTexture() {
  const [c, ctx] = canvas(512, 128);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 128);
  const gold = '#d9a238';
  const deep = '#b5781e';
  ctx.fillStyle = gold;
  ctx.fillRect(0, 6, 512, 7);
  ctx.fillRect(0, 115, 512, 7);
  ctx.fillStyle = deep;
  ctx.fillRect(0, 19, 512, 2.5);
  ctx.fillRect(0, 106, 512, 2.5);
  // Running scroll.
  ctx.strokeStyle = gold;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let x = 0; x <= 512; x += 4) {
    const y = 64 + 22 * Math.sin((x / 128) * Math.PI * 2);
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.lineWidth = 3.5;
  for (let k = 0; k < 4; k++) {
    for (const up of [1, -1]) {
      const x0 = k * 128 + (up > 0 ? 32 : 96);
      const y0 = 64 - up * 22;
      // Curl off each crest.
      ctx.beginPath();
      for (let i = 0; i <= 30; i++) {
        const a = (i / 30) * Math.PI * 1.6;
        const r = 16 * (1 - i / 40);
        const x = x0 + 12 + Math.sin(a) * r;
        const y = y0 + up * (r - Math.cos(a) * r) * 0.9;
        if (i === 0) ctx.moveTo(x0, y0); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Leaf.
      ctx.fillStyle = deep;
      ctx.beginPath();
      ctx.ellipse(x0 - 14, y0 + up * 12, 9, 4, up * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // Diamond studs between the curls.
    ctx.fillStyle = gold;
    const dx = k * 128 + 64;
    ctx.beginPath();
    ctx.moveTo(dx, 52); ctx.lineTo(dx + 8, 64); ctx.lineTo(dx, 76); ctx.lineTo(dx - 8, 64);
    ctx.closePath();
    ctx.fill();
  }
  return finish(new THREE.CanvasTexture(c), { repeat: true });
}

// ---------- Feather ----------
// 128 x 512. u across the vane, v from the base (0) to the tip (1).
export function featherTexture() {
  const [c, ctx] = canvas(128, 512);
  const g = ctx.createLinearGradient(0, 512, 0, 0);
  g.addColorStop(0, '#d9d6ec');
  g.addColorStop(0.25, '#f6f6ff');
  g.addColorStop(0.85, '#ffffff');
  g.addColorStop(1, '#eef4ff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 512);
  // Barbs sweeping toward the tip.
  ctx.strokeStyle = 'rgba(150, 146, 196, 0.32)';
  ctx.lineWidth = 1.6;
  for (let y = 520; y > 20; y -= 13) {
    ctx.beginPath();
    ctx.moveTo(64, y);
    ctx.quadraticCurveTo(30, y - 14, 0, y - 44);
    ctx.moveTo(64, y);
    ctx.quadraticCurveTo(98, y - 14, 128, y - 44);
    ctx.stroke();
  }
  // Soft edge shading.
  const e = ctx.createLinearGradient(0, 0, 128, 0);
  e.addColorStop(0, 'rgba(170, 166, 214, 0.35)');
  e.addColorStop(0.12, 'rgba(170, 166, 214, 0)');
  e.addColorStop(0.88, 'rgba(170, 166, 214, 0)');
  e.addColorStop(1, 'rgba(170, 166, 214, 0.35)');
  ctx.fillStyle = e;
  ctx.fillRect(0, 0, 128, 512);
  // Shaft.
  ctx.fillStyle = '#c9c3dd';
  ctx.beginPath();
  ctx.moveTo(60, 512);
  ctx.lineTo(68, 512);
  ctx.lineTo(65, 40);
  ctx.lineTo(63, 40);
  ctx.closePath();
  ctx.fill();
  return finish(new THREE.CanvasTexture(c));
}

// ---------- Stole ----------
// 128 x 1024. u across, v from the bottom end (0) to the shoulder (1): gold borders, a repeated
// cross motif and a large sun-cross near the end.
export function stoleTexture() {
  const [c, ctx] = canvas(128, 1024);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 1024);
  const gold = '#d9a238';
  const deep = '#b5781e';
  ctx.fillStyle = gold;
  ctx.fillRect(4, 0, 9, 1024);
  ctx.fillRect(115, 0, 9, 1024);
  ctx.fillStyle = deep;
  ctx.fillRect(18, 0, 2.5, 1024);
  ctx.fillRect(107.5, 0, 2.5, 1024);
  const cross = (y, s) => {
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.moveTo(64, y - 22 * s); ctx.lineTo(64 + 6 * s, y - 6 * s);
    ctx.lineTo(64 + 22 * s, y); ctx.lineTo(64 + 6 * s, y + 6 * s);
    ctx.lineTo(64, y + 22 * s); ctx.lineTo(64 - 6 * s, y + 6 * s);
    ctx.lineTo(64 - 22 * s, y); ctx.lineTo(64 - 6 * s, y - 6 * s);
    ctx.closePath();
    ctx.fill();
  };
  for (let y = 80; y < 760; y += 110) cross(y, 1);
  // Sun-cross emblem near the bottom end (canvas bottom = v 0).
  const ey = 900;
  ctx.strokeStyle = gold;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, ey, 32, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = deep;
  ctx.beginPath();
  ctx.arc(64, ey, 22, 0, Math.PI * 2);
  ctx.stroke();
  cross(ey, 2.1);
  ctx.fillStyle = gold;
  for (let x = 10; x < 128; x += 12) ctx.fillRect(x, 1000, 5, 24);
  return finish(new THREE.CanvasTexture(c));
}
