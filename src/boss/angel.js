import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { cel, glow, faceMaterial, outline, shared } from './seraphina/materials.js';
import { faceAtlas, laceTexture, bandTexture, featherTexture, stoleTexture, FACE } from './seraphina/textures.js';
import {
  prep, merge, place, surface, loft, strand, feather, tube, ringPoints, scaleUV, mirrorX, setSway, orient, smooth,
} from './seraphina/geometry.js';

// Seraphina: the angel who hatches from the Seraph's core for Phases 2-3.
// Anime look: cel shading with tinted shadows, a painted face with glowing blue eyes, long silver
// hair, a white-and-gold priestess dress with frills and lace, a pair of large feathered wings and
// a golden halo. Origin is at her chest; she is about 9.5 m tall and faces +Z.

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const { lerp, clamp } = THREE.MathUtils;

// ---------- Proportions (torso space: origin at the chest, metres) ----------
const HEAD_POS = V(0, 2.74, 0.02);
const HEAD_R = 0.9;
const WAIST_Y = -0.45;
const HEM_Y = -5.0;
const OVER_Y = -3.9; // overskirt hem
// Body cross-sections [y, rx, rz] from the collar down: bodice, then the bell of the underskirt.
const BODY = [
  [1.62, 0.21, 0.2], [1.45, 0.42, 0.3], [1.25, 0.6, 0.4], [1.0, 0.67, 0.46], [0.7, 0.69, 0.5],
  [0.4, 0.65, 0.5], [0.1, 0.57, 0.44], [-0.2, 0.5, 0.39], [WAIST_Y, 0.48, 0.37],
  [-0.8, 0.66, 0.54], [-1.4, 0.98, 0.86], [-2.2, 1.4, 1.28], [-3.1, 1.85, 1.74], [-4.0, 2.25, 2.14],
  [-4.6, 2.48, 2.36], [HEM_Y, 2.6, 2.48],
];

const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
// [rx, rz] of the body or underskirt at height y (smooth through the table).
function bodyAt(y) {
  const n = BODY.length;
  let i = 0;
  while (i < n - 2 && y < BODY[i + 1][0]) i++;
  const a = BODY[Math.max(0, i - 1)];
  const b = BODY[i];
  const c = BODY[i + 1];
  const d = BODY[Math.min(n - 1, i + 2)];
  const k = clamp((y - b[0]) / (c[0] - b[0]), 0, 1);
  return [cr(a[1], b[1], c[1], d[1], k), cr(a[2], b[2], c[2], d[2], k)];
}

// Cloth sway: pinned at the waist, freest at the hem and below it.
const skirtV = (y) => clamp((WAIST_Y - y) / (WAIST_Y - HEM_Y), 0, 1);
const clothSway = (y) => (y >= HEM_Y ? 0.6 * skirtV(y) ** 2 : 0.6 + (HEM_Y - y) * 0.5);
const underFold = (phi, v) => 1 + 0.035 * v ** 1.3 * Math.sin(phi * 12 + 0.6);
function underPoint(y, phi, extra = 0, out = V()) {
  const [rx, rz] = bodyAt(y);
  const r = underFold(phi, skirtV(y));
  return out.set(Math.sin(phi) * (rx * r + extra), y, Math.cos(phi) * (rz * r + extra));
}
// Overskirt: open at the front, the opening widening toward its hem.
const overOpen = (v) => 0.2 + 0.55 * v;
function overPoint(u, v, extra = 0, out = V()) {
  const y = lerp(WAIST_Y - 0.05, OVER_Y, v);
  const o = overOpen(v);
  const phi = lerp(o, TAU - o, u);
  const [rx, rz] = bodyAt(y);
  const r = 1 + 0.05 * v ** 1.2 * Math.sin(phi * 9 + 1.0);
  const e = 0.03 + 0.2 * v + extra;
  return out.set(Math.sin(phi) * (rx * r + e), y, Math.cos(phi) * (rz * r + e));
}

// ---------- Head shape (head space: origin at the centre of the skull) ----------
// Unit direction -> point on the head: round skull, flat face, tapered jaw, soft pointed chin.
function headShape(d, out) {
  let { x, y, z } = d;
  const front = smooth(z, -0.2, 0.75);
  const low = smooth(-y, 0.3, 1.05); // full cheeks down to below the eyes, then a rounded jaw
  const l2 = low * low;
  x *= 1 - l2 * (0.5 * front + 0.14);
  y -= l2 * 0.1 * front;
  z += low * 0.04 * front;
  z *= z > 0 ? 1 - 0.1 * front * (1 - low) : 1.05;
  const nape = smooth(-z, 0, 0.8) * low;
  x *= 1 - nape * 0.2;
  z *= 1 - nape * 0.22;
  return out.set(x * HEAD_R, y * HEAD_R, z * HEAD_R);
}
const _hd = V();
// Point `lift` times out from the head surface. theta from the crown, phi from the face toward +x.
function headPt(theta, phi, lift = 1, out = V()) {
  _hd.set(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi));
  return headShape(_hd, out).multiplyScalar(lift);
}

// Ruffle hanging from an edge: pleated, flaring outward. edge(u, out) gives the top edge,
// phiOf(u) its angle around the body. Returns the geometry and its bottom edge.
function ruffle(edge, { height = 0.4, flare = 0.25, pleats = 40, amp = 0.07, nu = 132, nv = 3, wrap = true, phiOf = (u) => u * TAU, swayFn = null } = {}) {
  const top = V();
  const dir = V();
  const at = (u, v, out) => {
    edge(u, top);
    const phi = phiOf(u);
    dir.set(Math.sin(phi), 0, Math.cos(phi));
    const w = Math.sin(phi * pleats);
    out.copy(top).addScaledVector(dir, (flare + amp * w) * v);
    out.y -= height * v - amp * 0.35 * v * Math.cos(phi * pleats);
    return out;
  };
  const geo = surface(at, nu, nv, { wrap });
  if (swayFn) setSway(geo, swayFn);
  return { geo, bottom: (u, out) => at(u, 1, out) };
}

// Strip hanging below an edge (lace), texture repeated `rep` times along it.
function band(edge, { height = 0.2, flare = 0.05, nu = 160, wrap = true, phiOf = (u) => u * TAU, rep = 24, swayFn = null } = {}) {
  const top = V();
  const geo = surface((u, v, out) => {
    edge(u, top);
    const phi = phiOf(u);
    return out.set(top.x + Math.sin(phi) * flare * v, top.y - height * v, top.z + Math.cos(phi) * flare * v);
  }, nu, 1, { wrap });
  scaleUV(geo, rep, 1);
  if (swayFn) setSway(geo, swayFn);
  return geo;
}

// ---------- Poses: [shoulder x, shoulder z, elbow x] per arm ----------
const POSES = {
  idle: { R: [-0.25, 0.35, -0.9], L: [0.1, -0.3, -0.4] },
  cast: { R: [-2.7, 0.25, -0.2], L: [-0.6, -0.5, -0.3] },
  point: { R: [-0.25, 0.35, -0.9], L: [-1.45, -0.05, -0.05] },
  charge: { R: [-2.9, 0.45, -0.1], L: [-2.9, -0.45, -0.1] },
  lance: { R: [-1.45, -0.05, -0.15], L: [0.3, -0.5, -0.4] },
  dizzy: { R: [0.25, 0.15, -0.2], L: [0.25, -0.15, -0.2] },
  peace: { R: [-0.8, 0.5, -1.6], L: [-0.8, -0.5, -1.6] },
};

// Expressions: [eye white, eye lines, brows, mouth].
const FACES = {
  calm: [FACE.white, FACE.lines, FACE.brow, FACE.smile],
  calmBlink: [-1, FACE.closed, FACE.brow, FACE.smile],
  angry: [FACE.whiteAngry, FACE.linesAngry, FACE.browAngry, FACE.frown],
  angryBlink: [-1, FACE.closedAngry, FACE.browAngry, FACE.frown],
  peace: [-1, FACE.happy, FACE.brow, FACE.smile],
  dizzy: [-1, FACE.dizzy, FACE.brow, FACE.wavy],
};

const OUTLINE = { skin: 0x6a3440, hair: 0x4a4a7c, dress: 0x2c2848, gold: 0x4a2c0a, ribbon: 0x1c2a5c, feather: 0x56557e };

export function buildAngel() {
  const tex = { lace: laceTexture(), band: bandTexture(), feather: featherTexture(), stole: stoleTexture(), face: faceAtlas() };
  const SW = { hair: [0.16, 1.25, -0.45, 0], cloth: [0.08, 1.1, 0.6, 0], ribbon: [0.12, 2.0, 0.9, 0], feather: [0.06, 2.6, 0.5, 0] };
  const dress = { color: 0xe8e8f2, shade: [0.78, 0.78, 0.95], rim: 0xe8f0ff, rimStrength: 0.12, sway: SW.cloth, windScale: 0.5, side: THREE.DoubleSide };
  const M = {
    skin: cel({ color: 0xffe2d4, shade: [0.97, 0.76, 0.78], shadeTh: -0.25, rim: 0xffd6cc, rimStrength: 0.12 }),
    neck: cel({ color: 0xecbdb0, shade: [0.95, 0.8, 0.82], shadeTh: -0.25, rim: 0xffd6cc, rimStrength: 0.1 }),
    hair: cel({ color: 0xcdd1ea, shade: [0.6, 0.62, 0.88], shadeTh: 0.05, tip: 0xa9b7ea, hairRing: 0xe8eeff, rim: 0xe0eaff, rimStrength: 0.2, sway: SW.hair, windScale: 1 }),
    dress: cel(dress),
    band: cel({ ...dress, map: tex.band }),
    tabard: cel({ ...dress, map: tex.stole }),
    lace: cel({ ...dress, map: tex.lace, alphaTest: true }),
    gold: cel({ color: 0xffc44e, shade: [0.62, 0.42, 0.3], shadeTh: -0.05, spec: 0xfff2c8, specTh: 0.955, rim: 0xffe0a0, rimStrength: 0.3 }),
    goldCloth: cel({ color: 0xffc44e, shade: [0.62, 0.42, 0.3], shadeTh: -0.05, spec: 0xfff2c8, specTh: 0.955, rim: 0xffe0a0, rimStrength: 0.3, sway: SW.cloth, windScale: 0.5 }),
    ribbon: cel({ color: 0x86baff, shade: [0.6, 0.64, 0.9], rim: 0xd8ecff, rimStrength: 0.25, sway: SW.ribbon, windScale: 0.8, side: THREE.DoubleSide }),
    stocking: cel({ color: 0xe6e4f0, shade: [0.8, 0.78, 0.94] }),
    feather: cel({ color: 0xe6e8f5, map: tex.feather, shade: [0.74, 0.76, 0.96], shadeTh: -0.1, rim: 0xdfefff, rimStrength: 0.16, sway: SW.feather }),
    halo: glow(0xffc35a, 1.2),
    gem: glow(0x7fd8ff, 1.15),
    staffGlow: glow(0x9ff4ff, 1.35),
    // Standard material so the boss can drive its emissive like the wing jewels.
    jewel: new THREE.MeshStandardMaterial({ color: 0x400018, emissive: 0xff3d7e, emissiveIntensity: 1.5 }),
  };

  const root = new THREE.Group();
  const outlines = [];
  const mesh = (parent, geo, mat, line = null, order = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = order;
    parent.add(m);
    if (line !== null) outlines.push(outline(m, line, 0.0028));
    return m;
  };

  // ======================= Torso and dress =======================
  const torso = new THREE.Group();
  root.add(torso);
  const D = { dress: [], gold: [], goldCloth: [], lace: [], band: [], tabard: [], ribbon: [], stocking: [] };
  const _p = V();

  // Bodice from the collar to below the waist (the skirt hides the bottom).
  D.dress.push(loft(BODY.slice(0, 10).map(([y, rx, rz]) => ({ y, rx, rz })), { segs: 40, nv: 24 }));
  // Standing collar with a gold edge and a lace frill.
  D.dress.push(loft([{ y: 1.98, rx: 0.215, rz: 0.21 }, { y: 1.75, rx: 0.225, rz: 0.22 }, { y: 1.5, rx: 0.31, rz: 0.28 }], { segs: 40, nv: 8 }));
  D.gold.push(tube(ringPoints(1.97, 0.222, 0.217, 40), 0.028, { closed: true, segs: 80 }));
  D.lace.push(surface((u, v, out) => {
    const phi = u * TAU + Math.PI;
    const r = 0.224 + 0.07 * v + 0.02 * v * Math.sin(phi * 24);
    return out.set(Math.sin(phi) * r, 1.97 + 0.1 * v, Math.cos(phi) * r * 0.97);
  }, 96, 2, { wrap: true }));
  scaleUV(D.lace[D.lace.length - 1], 10, 1);
  // Gold collar plate over the shoulders, dipping to a point at the front.
  D.gold.push(surface((u, v, out) => {
    const phi = lerp(-1.8, 1.8, u);
    const tip = Math.max(0, Math.cos(phi)) ** 8;
    const y = lerp(1.52, 1.2 - 0.26 * tip, v);
    const [rx, rz] = bodyAt(y);
    return out.set(Math.sin(phi) * (rx + 0.04), y, Math.cos(phi) * (rz + 0.04));
  }, 56, 6));
  D.gold.push(tube(Array.from({ length: 41 }, (_, i) => {
    const phi = lerp(-1.8, 1.8, i / 40);
    const y = 1.2 - 0.26 * Math.max(0, Math.cos(phi)) ** 8;
    const [rx, rz] = bodyAt(y);
    return V(Math.sin(phi) * (rx + 0.05), y, Math.cos(phi) * (rz + 0.05));
  }), 0.03, { segs: 120 }));
  // Heart jewel in a gold sunburst mount: the Phase 3 weak point.
  const heartY = 0.6;
  const heartZ = bodyAt(heartY)[1] + 0.09;
  D.gold.push(place(new THREE.TorusGeometry(0.31, 0.05, 8, 36), [0, heartY, heartZ - 0.04]));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    const len = k % 2 ? 0.16 : 0.3;
    D.gold.push(orient(new THREE.ConeGeometry(k % 2 ? 0.035 : 0.055, len, 4), V(Math.sin(a) * (0.36 + len / 2), heartY + Math.cos(a) * (0.36 + len / 2), heartZ - 0.06), V(Math.sin(a), Math.cos(a), 0)));
  }
  D.gold.push(tube([V(0, 0.94, bodyAt(0.94)[1] + 0.05), V(0, 0.92, heartZ - 0.02)], 0.025));
  const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.27, 0), M.jewel);
  heart.scale.set(1, 1.3, 0.6);
  heart.position.set(0, heartY, heartZ);
  torso.add(heart);
  // Collar bow and its tails.
  const bow = V(0, 1.55, 0.33);
  for (const s of [-1, 1]) {
    D.ribbon.push(place(new THREE.TorusGeometry(0.13, 0.05, 8, 20), [bow.x + s * 0.15, bow.y + 0.01, bow.z], [0, 0, s * 0.3], [1, 0.62, 0.5]));
    D.ribbon.push(strand([V(s * 0.04, bow.y - 0.02, bow.z + 0.04), V(s * 0.1, 1.32, 0.5), V(s * 0.13, 1.08, 0.56), V(s * 0.17, 0.9, 0.58)], {
      width: (t) => 0.075 + 0.02 * t, thick: () => 0.018, segs: 10, radial: 6, up: () => V(0, 0, 1), sway: (t) => t * 0.8,
    }));
  }
  D.ribbon.push(place(new THREE.SphereGeometry(0.075, 10, 8), [bow.x, bow.y, bow.z + 0.03]));

  // Gold belt over the top of the overskirt.
  D.gold.push(tube(ringPoints(-0.5, 0.545, 0.43, 48), 0.055, { closed: true, segs: 72 }));
  D.gold.push(orient(new THREE.OctahedronGeometry(0.11, 0), V(0, -0.5, 0.49), V(0, 1, 0), [1, 1.3, 0.5]));

  // Underskirt: a long bell with soft folds. The seam is at the back.
  const under = surface((u, v, out) => underPoint(lerp(WAIST_Y + 0.02, HEM_Y, v), u * TAU + Math.PI, 0, out), 72, 26, { wrap: true });
  D.dress.push(setSway(under, (x, y) => clothSway(y)));
  // Embroidered border above the hem.
  D.band.push(setSway(scaleUV(surface((u, v, out) => underPoint(lerp(-4.4, -4.95, v), u * TAU + Math.PI, 0.012, out), 128, 4, { wrap: true }), 18, 1), (x, y) => clothSway(y)));
  // Hem ruffle and lace below it.
  const hemEdge = (u, out) => underPoint(HEM_Y, u * TAU + Math.PI, 0, out);
  const hemPhi = (u) => u * TAU + Math.PI;
  const hemRuffle = ruffle(hemEdge, { height: 0.42, flare: 0.3, pleats: 44, amp: 0.07, phiOf: hemPhi, swayFn: (x, y) => clothSway(y) });
  D.dress.push(hemRuffle.geo);
  D.goldCloth.push(setSway(tube(Array.from({ length: 96 }, (_, i) => hemEdge(i / 96, V()).add(V(0, 0.01, 0))), 0.035, { closed: true, segs: 168, radial: 5 }), (x, y) => clothSway(y)));
  D.lace.push(band(hemRuffle.bottom, { height: 0.24, flare: 0.06, phiOf: hemPhi, rep: 36, swayFn: (x, y) => clothSway(y) }));
  // Petticoat frill inside the hem, seen from below.
  D.dress.push(ruffle((u, out) => underPoint(-4.55, u * TAU + Math.PI, -0.12, out), { height: 0.5, flare: 0.1, pleats: 36, amp: 0.06, phiOf: hemPhi, swayFn: (x, y) => clothSway(y) }).geo);

  // Front panel of the underskirt, framed by the overskirt's opening.
  D.tabard.push(setSway(surface((u, v, out) => {
    const y = lerp(WAIST_Y - 0.1, -4.38, v);
    const half = lerp(0.2, 0.5, v) / bodyAt(y)[0];
    return underPoint(y, lerp(-half, half, u), 0.014, out);
  }, 8, 32), (x, y) => clothSway(y)));

  // Overskirt with gold-trimmed edges, ruffled hem and lace.
  D.dress.push(setSway(surface((u, v, out) => overPoint(u, v, 0, out), 60, 22), (x, y) => clothSway(y)));
  D.band.push(setSway(scaleUV(surface((u, v, out) => overPoint(u, lerp(0.87, 0.99, v), 0.014, out), 96, 2), 12, 1), (x, y) => clothSway(y)));
  const o1 = overOpen(1);
  const overPhi = (u) => lerp(o1, TAU - o1, u);
  const overHem = ruffle((u, out) => overPoint(u, 1, 0, out), { height: 0.36, flare: 0.22, pleats: 30, amp: 0.06, nu: 120, wrap: false, phiOf: overPhi, swayFn: (x, y) => clothSway(y) });
  D.dress.push(overHem.geo);
  D.lace.push(band(overHem.bottom, { height: 0.2, flare: 0.05, nu: 120, wrap: false, phiOf: overPhi, rep: 26, swayFn: (x, y) => clothSway(y) }));
  const trim = (fn, n) => tube(Array.from({ length: n + 1 }, (_, i) => fn(i / n, V())), 0.035, { segs: n * 2, radial: 5 });
  D.goldCloth.push(setSway(trim((k, out) => overPoint(k, 1, 0.02, out), 60), (x, y) => clothSway(y)));
  D.goldCloth.push(setSway(trim((k, out) => overPoint(0, k, 0.02, out), 24), (x, y) => clothSway(y)));
  D.goldCloth.push(setSway(trim((k, out) => overPoint(1, k, 0.02, out), 24), (x, y) => clothSway(y)));

  // Legs inside the skirt, for the view from below.
  for (const s of [-1, 1]) {
    D.stocking.push(loft([{ y: -0.9, rx: 0.24, rz: 0.24 }, { y: -2.6, rx: 0.2, rz: 0.2 }, { y: -4.4, rx: 0.13, rz: 0.13 }, { y: -5.1, rx: 0.1, rz: 0.12 }], { segs: 14, nv: 8 }).translate(s * 0.3, 0, -0.05));
    D.gold.push(place(new THREE.CapsuleGeometry(0.085, 0.22, 4, 10), [s * 0.27, -5.18, 0.04], [0.35, 0, 0]));
  }

  mesh(torso, prep(new THREE.CylinderGeometry(0.17, 0.2, 1.3, 18, 1, true).translate(0, 1.97, -0.05)), M.neck, OUTLINE.skin);
  mesh(torso, merge(D.dress), M.dress, OUTLINE.dress);
  mesh(torso, merge(D.gold), M.gold, OUTLINE.gold);
  mesh(torso, merge(D.goldCloth), M.goldCloth, OUTLINE.gold);
  mesh(torso, merge(D.band), M.band);
  mesh(torso, merge(D.tabard), M.tabard);
  mesh(torso, merge(D.lace), M.lace);
  mesh(torso, merge(D.ribbon), M.ribbon, OUTLINE.ribbon);
  mesh(torso, merge(D.stocking), M.stocking, OUTLINE.dress);

  // ======================= Head =======================
  const head = new THREE.Group();
  head.position.copy(HEAD_POS);
  head.rotation.order = 'YXZ';
  torso.add(head);
  const headGeo = (() => {
    const g = new THREE.SphereGeometry(1, 54, 42);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const p = g.attributes.position;
    const d = V();
    for (let i = 0; i < p.count; i++) {
      d.fromBufferAttribute(p, i).normalize();
      headShape(d, _p);
      p.setXYZ(i, _p.x, _p.y, _p.z);
    }
    const w = mergeVertices(g, 1e-4);
    w.computeVertexNormals();
    return prep(w);
  })();
  mesh(head, headGeo, M.skin, OUTLINE.skin);
  // Face decal: the front of the head with planar face coordinates.
  const faceGeo = (() => {
    const P = headGeo.attributes.position;
    const N = headGeo.attributes.normal;
    const idx = headGeo.index.array;
    const inFace = (i) => P.getZ(i) > 0.1 && P.getY(i) < 0.42 && P.getY(i) > -1.2;
    const pos = [];
    const fp = [];
    for (let t = 0; t < idx.length; t += 3) {
      if (!inFace(idx[t]) || !inFace(idx[t + 1]) || !inFace(idx[t + 2])) continue;
      for (let k = 0; k < 3; k++) {
        const i = idx[t + k];
        pos.push(P.getX(i) + N.getX(i) * 0.004, P.getY(i) + N.getY(i) * 0.004, P.getZ(i) + N.getZ(i) * 0.004);
        fp.push(P.getX(i), P.getY(i));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('fpos', new THREE.Float32BufferAttribute(fp, 2));
    return g;
  })();
  const face = mesh(head, faceGeo, faceMaterial(tex.face), null, 2);

  // ======================= Hair =======================
  const H = { head: [], back: [], lockL: [], lockR: [], gold: [] };
  const fromHead = (t, P) => V().copy(P);
  const fromAxis = (t, P) => V(P.x, 0, P.z);
  const lock = (pts, w, th, swayMax, { up = fromAxis, taper = 1.6, swayPow = 1.4, segs = 20 } = {}) => strand(pts, {
    width: (t) => w * (1 - Math.pow(t, taper)) * (0.72 + 0.28 * Math.min(1, t * 4)),
    thick: (t) => th * (1 - 0.7 * t),
    segs,
    radial: 6,
    up,
    sway: (t) => swayMax * Math.pow(t, swayPow),
  });

  // Cap over the skull, open for the face; the fringe covers its front edge.
  const capMax = (phi) => lerp(0.5, 2.3, smooth(Math.abs(phi), 0.3, 2.3));
  H.head.push(surface((u, v, out) => {
    const phi = -Math.PI + u * TAU;
    return headPt(v * capMax(phi), phi, 1.075, out);
  }, 56, 20, { wrap: true }));
  // Fringe: pointed locks over the forehead, longer at the sides.
  for (let i = 0; i < 13; i++) {
    const k = i / 12 - 0.5;
    const phi = k * 2.15;
    const mid = 1 - Math.abs(k) * 2;
    const side = Math.abs(k) > 0.36;
    const tip = 1.34 + 0.1 * mid + [0, 0.1, 0.04, 0.13][i % 4] + (side ? 0.45 : 0);
    // Tips curl in toward the middle of the face.
    const curl = -Math.sign(k) * (side ? 0.1 : 0.05);
    H.head.push(lock([
      headPt(0.16, phi * 0.45, 1.06), headPt(0.6, phi * 0.82, 1.115), headPt(1.0, phi * 0.98, 1.11),
      headPt(tip - 0.24, phi + curl * 0.4, 1.095), headPt(tip, phi + curl, 1.07),
    ], 0.26 + 0.05 * mid, 0.06, side ? 0.2 : 0.1, { up: fromHead, taper: 1.3, swayPow: 2, segs: 14 }));
  }
  // Ahoge.
  H.head.push(lock([headPt(0.12, 0.4, 1.06), headPt(0.05, 0.4, 1.3), V(0.08, 1.32, 0.12), V(0.16, 1.32, -0.1)], 0.07, 0.03, 0.3, { up: () => V(1, 0, 0), taper: 1.0, segs: 10 }));

  // Long back hair hanging over her back like a curtain, fanning out lower down.
  // It hangs from a pivot at the nape that only follows part of the head's turn.
  const nape = V(0, -0.55, -0.62);
  const curtain = (c, yT, k, out = V()) => {
    const spread = lerp(0.95, 1.5, clamp((1.45 - yT) / 4, 0, 1));
    const psi = Math.PI - c * spread;
    let [rx, rz] = bodyAt(yT);
    if (yT < WAIST_Y) {
      const v = clamp((WAIST_Y - yT) / (WAIST_Y - OVER_Y), 0, 1);
      rx += 0.09 + 0.22 * v;
      rz += 0.09 + 0.22 * v;
    }
    const m = (yT > 0.9 ? 0.34 : 0.24) + (k % 2) * 0.06;
    // A gentle wave so the locks don't hang dead straight.
    const wave = 0.1 * Math.sin(yT * 1.4 + k * 1.7) * clamp((1.2 - yT) / 2, 0, 1);
    return out.set(Math.sin(psi + wave) * (rx + m), yT, Math.cos(psi + wave) * (rz + m)).sub(HEAD_POS);
  };
  const N_BACK = 22;
  for (let k = 0; k < N_BACK; k++) {
    const c = 1 - 2 * (k + 0.5) / N_BACK; // +1 at her left (+x), -1 at her right
    const phiRoot = Math.PI - c * 1.5;
    const len = clamp(0.92 + 0.08 * Math.cos(c * 1.6) - 0.06 * ((k * 7) % 3) / 2, 0, 1);
    const tipY = 0.9 - 4.9 * len;
    const pts = [headPt(1.2, phiRoot, 1.0), headPt(1.75, phiRoot, 1.1), headPt(2.25, Math.PI - c * 1.3, 1.15)];
    for (const yT of [1.45, 0.55, -0.55, -1.6, -2.6, -3.4]) {
      if (yT <= tipY + 0.4) break;
      pts.push(curtain(c, yT, k));
    }
    pts.push(curtain(c, tipY, k));
    H.back.push(lock(pts, 0.46 + 0.06 * (k % 3), 0.08, 1.0, { segs: 22, taper: 2.2 }));
  }
  // Shorter outer layer for volume.
  for (let k = 0; k < 7; k++) {
    const c = 1 - 2 * (k + 0.5) / 7;
    const tipY = -0.2 - 0.6 * Math.cos(c * 1.3);
    H.back.push(lock([
      headPt(0.85, Math.PI - c * 1.4, 1.06), headPt(1.6, Math.PI - c * 1.45, 1.16), headPt(2.2, Math.PI - c * 1.3, 1.22),
      curtain(c, 1.4, 1).add(V(0, 0, -0.08)), curtain(c, 0.5, 1).add(V(0, 0, -0.1)), curtain(c, tipY, 1).add(V(0, 0, -0.12)),
    ], 0.5, 0.09, 0.7, { segs: 20 }));
  }
  // Locks in front of the shoulders, framing the face; they hang from pivots at the temples.
  const temples = { L: V(0.8, -0.25, 0.15), R: V(-0.8, -0.25, 0.15) };
  for (const s of [-1, 1]) {
    const list = s > 0 ? H.lockL : H.lockR;
    list.push(lock([
      headPt(0.95, s * 1.12, 1.07), headPt(1.6, s * 1.22, 1.13),
      V(s * 0.85, -0.95, 0.32), V(s * 0.93, -1.75, 0.52), V(s * 0.9, -2.55, 0.58), V(s * 0.8, -3.15, 0.52),
    ], 0.24, 0.075, 0.55, { segs: 22 }));
    list.push(lock([
      headPt(1.0, s * 1.42, 1.06), headPt(1.7, s * 1.48, 1.12),
      V(s * 0.98, -1.0, 0.06), V(s * 1.12, -1.8, 0.26), V(s * 1.07, -2.45, 0.3), V(s * 0.98, -2.85, 0.28),
    ], 0.22, 0.07, 0.5, { segs: 20 }));
  }
  // Gold wing clips at the temples, with a small blue gem.
  const gems = [];
  for (const s of [-1, 1]) {
    const at = headPt(1.12, s * 1.3, 1.13);
    for (let f = 0; f < 3; f++) {
      const g = feather({ length: 0.42 - f * 0.08, width: 0.13, thick: 0.035, curl: 0.1, cup: 0.01, round: 0.6, segL: 6, segW: 2, flutter: 0 });
      g.rotateX(Math.PI); // point up from the clip
      g.rotateZ(-s * (0.35 + f * 0.42));
      g.rotateY(s * 1.25);
      g.translate(at.x, at.y, at.z);
      H.gold.push(g);
    }
    gems.push(place(new THREE.OctahedronGeometry(0.075, 0), [at.x * 1.02, at.y, at.z * 1.02], [0, 0, 0], [1, 1.3, 0.8]));
  }

  mesh(head, merge(H.head), M.hair, OUTLINE.hair);
  mesh(head, merge(H.gold), M.gold, OUTLINE.gold);
  mesh(head, merge(gems), M.gem);
  const hairPivots = [];
  const pivoted = (geos, at) => {
    const g = new THREE.Group();
    g.position.copy(at);
    head.add(g);
    mesh(g, merge(geos).translate(-at.x, -at.y, -at.z), M.hair, OUTLINE.hair);
    hairPivots.push(g);
    return g;
  };
  pivoted(H.back, nape);
  pivoted(H.lockL, temples.L);
  pivoted(H.lockR, temples.R);

  // ======================= Halo =======================
  const halo = new THREE.Group();
  halo.position.set(0, 1.3, -0.18);
  halo.rotation.x = -0.32;
  head.add(halo);
  const haloSpin = new THREE.Group();
  halo.add(haloSpin);
  const HG = [
    new THREE.TorusGeometry(0.82, 0.05, 8, 64).rotateX(Math.PI / 2),
    new THREE.TorusGeometry(0.68, 0.018, 5, 48).rotateX(Math.PI / 2),
  ];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    const len = k % 4 === 0 ? 0.36 : k % 2 === 0 ? 0.22 : 0.13;
    const dir = V(Math.sin(a), 0, Math.cos(a));
    HG.push(orient(new THREE.ConeGeometry(k % 4 === 0 ? 0.05 : 0.03, len, 4), dir.clone().multiplyScalar(0.86 + len / 2), dir));
  }
  mesh(haloSpin, merge(HG), M.halo);

  // ======================= Arms =======================
  const arms = {};
  for (const s of [-1, 1]) {
    const A = { dress: [], gold: [], lace: [], band: [], skin: [] };
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.66, 1.17, -0.02);
    torso.add(shoulder);
    // Puffed sleeve with a gold band and a little lace.
    A.dress.push(loft([
      { y: 0.24, rx: 0.12, rz: 0.12 }, { y: 0.14, rx: 0.3, rz: 0.29 }, { y: -0.06, rx: 0.37, rz: 0.35 },
      { y: -0.28, rx: 0.31, rz: 0.3 }, { y: -0.4, rx: 0.17, rz: 0.17 },
    ], { segs: 32, nv: 16, ripple: (u, v, phi) => 1 + 0.05 * Math.sin(v * Math.PI) * Math.cos(phi * 10) }).translate(s * 0.08, 0, 0));
    A.gold.push(tube(ringPoints(-0.38, 0.19, 0.19, 28).map((p) => p.add(V(s * 0.08, 0, 0))), 0.035, { closed: true, segs: 56 }));
    A.lace.push(band((u, out) => out.set(s * 0.08 + Math.sin(u * TAU) * 0.2, -0.39, Math.cos(u * TAU) * 0.2), { height: 0.14, flare: 0.07, nu: 48, rep: 5 }));
    // Upper arm in a fitted sleeve.
    A.dress.push(prep(new THREE.CapsuleGeometry(0.11, 0.8, 4, 12).translate(0, -0.62, 0)));
    const elbow = new THREE.Group();
    elbow.position.y = -1.08;
    shoulder.add(elbow);
    const E = { dress: [], gold: [], lace: [], band: [] };
    E.dress.push(prep(new THREE.CapsuleGeometry(0.095, 0.72, 4, 12).translate(0, -0.48, 0)));
    // Bell sleeve flaring from the elbow, gold-bordered with a lace cuff.
    E.dress.push(loft([
      { y: 0.06, rx: 0.13, rz: 0.13 }, { y: -0.3, rx: 0.18, rz: 0.18 }, { y: -0.7, rx: 0.31, rz: 0.29 },
      { y: -1.02, rx: 0.46, rz: 0.43 }, { y: -1.2, rx: 0.53, rz: 0.5 },
    ], { segs: 36, nv: 20, ripple: (u, v, phi) => 1 + 0.06 * v * Math.sin(phi * 8), sway: (u, v) => v * v * 0.3 }));
    E.band.push(scaleUV(surface((u, v, out) => {
      const y = lerp(-0.98, -1.18, v);
      const k = (y + 1.02) / -0.18;
      const rx = lerp(0.46, 0.53, clamp(k, 0, 1)) * (1 + 0.06 * Math.sin(u * TAU * 8)) + 0.012;
      const rz = lerp(0.43, 0.5, clamp(k, 0, 1)) * (1 + 0.06 * Math.sin(u * TAU * 8)) + 0.012;
      return out.set(Math.sin(u * TAU) * rx, y, Math.cos(u * TAU) * rz);
    }, 48, 2, { wrap: true, sway: (u, v) => 0.25 }), 4, 1));
    const cuff = (u, out) => out.set(Math.sin(u * TAU) * 0.53 * (1 + 0.06 * Math.sin(u * TAU * 8)), -1.2, Math.cos(u * TAU) * 0.5 * (1 + 0.06 * Math.sin(u * TAU * 8)));
    E.gold.push(tube(Array.from({ length: 48 }, (_, i) => cuff(i / 48, V())), 0.03, { closed: true, segs: 96 }));
    E.lace.push(band(cuff, { height: 0.2, flare: 0.08, nu: 64, rep: 8, swayFn: () => 0.35 }));
    const hand = new THREE.Group();
    hand.position.y = -1.12;
    elbow.add(hand);
    const HS = [
      place(new THREE.SphereGeometry(0.11, 12, 10), [0, -0.13, 0], [0, 0, 0], [0.9, 1.25, 0.55]),
      place(new THREE.CapsuleGeometry(0.05, 0.13, 4, 8), [0, -0.3, 0.01], [0, 0, 0], [1.6, 1, 0.8]),
      place(new THREE.CapsuleGeometry(0.035, 0.1, 4, 8), [s * -0.08, -0.17, 0.06], [0.4, 0, s * 0.5]),
    ];
    mesh(shoulder, merge(A.dress), M.dress, OUTLINE.dress);
    mesh(shoulder, merge(A.gold), M.gold, OUTLINE.gold);
    mesh(shoulder, merge(A.lace), M.lace);
    mesh(elbow, merge(E.dress), M.dress, OUTLINE.dress);
    mesh(elbow, merge(E.gold), M.goldCloth, OUTLINE.gold);
    mesh(elbow, merge(E.band), M.band);
    mesh(elbow, merge(E.lace), M.lace);
    mesh(hand, merge(HS), M.skin, OUTLINE.skin);
    arms[s < 0 ? 'L' : 'R'] = { shoulder, elbow, hand, side: s };
  }

  // ======================= Staff =======================
  const staff = new THREE.Group();
  arms.R.hand.add(staff);
  staff.position.y = -0.22;
  staff.rotation.x = Math.PI / 2; // upright when the forearm points forward
  const HEAD_AT = 4.2;
  const SG = [prep(new THREE.CylinderGeometry(0.055, 0.055, 5.9, 10).translate(0, 0.75, 0))];
  for (const y of [-2.2, 0.3, 2.2, 3.55]) SG.push(prep(new THREE.TorusGeometry(0.085, 0.035, 6, 16).rotateX(Math.PI / 2).translate(0, y, 0)));
  SG.push(prep(new THREE.SphereGeometry(0.1, 10, 8).translate(0, -2.25, 0)));
  const staffHead = new THREE.Group();
  staffHead.position.y = HEAD_AT;
  staff.add(staffHead);
  SG.push(prep(new THREE.TorusGeometry(0.5, 0.055, 8, 40).translate(0, HEAD_AT, 0)));
  SG.push(prep(new THREE.ConeGeometry(0.09, 0.4, 6).translate(0, HEAD_AT + 0.7, 0)));
  for (const s of [-1, 1]) {
    for (let f = 0; f < 3; f++) {
      const g = feather({ length: 0.75 - f * 0.15, width: 0.2, thick: 0.04, curl: 0.05, cup: 0.01, round: 0.5, segL: 6, segW: 2, flutter: 0 });
      g.rotateX(Math.PI);
      g.rotateZ(-s * (0.6 + f * 0.35));
      g.translate(s * 0.48, HEAD_AT - f * 0.05, 0);
      SG.push(g);
    }
  }
  mesh(staff, merge(SG), M.gold, OUTLINE.gold);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), M.staffGlow);
  crystal.scale.set(0.6, 1.5, 0.6);
  staffHead.add(crystal);
  const staffTip = new THREE.Object3D();
  staffHead.add(staffTip);
  // Where the staff points in each pose (torso space), whatever the arm is doing.
  const STAFF_DIR = {
    idle: V(0.14, 1, 0.2), point: V(0.14, 1, 0.2), peace: V(0.08, 1, 0.25), dizzy: V(0.35, 0.9, 0.3),
    cast: V(0.05, 1, 0.12), charge: V(0, 1, 0.1), lance: V(0, -0.08, 1),
  };
  for (const d of Object.values(STAFF_DIR)) d.normalize();

  // ======================= Wings =======================
  // One large pair. Each wing is three segments (arm, forearm, hand) so a flap ripples outward.
  // Built for her left wing (+x) and mirrored.
  const J = [V(0, 0, 0), V(1.7, 0.8, -0.25), V(3.8, 1.9, -0.6), V(5.0, 1.7, -0.85)];
  const segLen = [J[1].distanceTo(J[0]), J[2].distanceTo(J[1]), J[3].distanceTo(J[2])];
  const total = segLen[0] + segLen[1] + segLen[2];
  const tJ1 = segLen[0] / total;
  const tJ2 = (segLen[0] + segLen[1]) / total;
  const along = (t, out = V()) => {
    const d = t * total;
    if (d <= segLen[0]) return out.lerpVectors(J[0], J[1], d / segLen[0]);
    if (d <= segLen[0] + segLen[1]) return out.lerpVectors(J[1], J[2], (d - segLen[0]) / segLen[1]);
    return out.lerpVectors(J[2], J[3], Math.min(1, (d - segLen[0] - segLen[1]) / segLen[2]));
  };
  // Hang angle of the flight feathers along the wing (0 = straight down, + = outward).
  const hang = (t) => (t < tJ1 ? lerp(-0.12, 0.14, t / tJ1) : t < tJ2 ? lerp(0.14, 0.9, (t - tJ1) / (tJ2 - tJ1)) : lerp(0.9, 1.85, (t - tJ2) / (1 - tJ2)));
  const downAt = (t) => {
    const a = along(Math.max(0, t - 0.02));
    const b = along(Math.min(1, t + 0.02));
    const d = b.sub(a);
    return V(d.y, -d.x, 0).normalize();
  };
  const segOf = (t) => (t < tJ1 ? 0 : t < tJ2 ? 1 : 2);
  const WF = [[], [], []];
  const WG = [[], [], []];
  const addFeather = (t, base, angle, opts, z) => {
    const g = feather({ thick: 0.07, curl: -0.2, cup: 0.04, segL: 8, segW: 3, flutter: 0.14, ...opts });
    g.rotateZ(angle);
    g.translate(base.x, base.y, base.z + z);
    WF[segOf(t)].push(g);
  };
  // Primaries on the hand, fanning from outward-up to down.
  const primLen = [3.6, 4.0, 3.95, 3.8, 3.65, 3.5, 3.35, 3.2, 3.05, 2.9];
  for (let i = 0; i < 10; i++) {
    const k = i / 9;
    const base = V().lerpVectors(J[3], J[2], k * 0.92);
    const t = lerp(1, tJ2 + 0.01, k);
    addFeather(t, base, lerp(1.88, 0.98, k), { length: primLen[i] * 1.05, width: 0.6, asym: 0.35, round: 0.32 }, -0.02 * i);
  }
  // Secondaries along the forearm.
  for (let i = 0; i < 12; i++) {
    const k = i / 11;
    const t = lerp(tJ2 - 0.01, tJ1 + 0.01, k);
    const base = along(t).addScaledVector(downAt(t), 0.12);
    addFeather(t, base, lerp(0.88, 0.16, k), { length: lerp(3.0, 2.7, k), width: 0.64, asym: 0.08, round: 0.7 }, -0.012 * i);
  }
  // Tertials near the root.
  for (let i = 0; i < 4; i++) {
    const k = i / 3;
    const t = lerp(tJ1 - 0.01, 0.02, k);
    const base = along(t).addScaledVector(downAt(t), 0.1);
    addFeather(t, base, lerp(0.1, -0.12, k), { length: lerp(2.5, 1.9, k), width: 0.6, round: 0.85 }, -0.01 * i);
  }
  // Coverts in three rows, smaller and further forward toward the leading edge.
  const rows = [
    { n: 18, down: 0.42, len: [1.4, 1.8], width: 0.52, round: 0.75, z: 0.13 },
    { n: 15, down: 0.22, len: [0.9, 1.1], width: 0.45, round: 0.9, z: 0.24 },
    { n: 14, down: 0.04, len: [0.52, 0.62], width: 0.39, round: 1, z: 0.33 },
  ];
  for (const r of rows) {
    for (let i = 0; i < r.n; i++) {
      const t = 0.03 + (i / (r.n - 1)) * 0.95;
      const base = along(t).addScaledVector(downAt(t), r.down);
      const jitter = 1 + 0.08 * Math.sin(i * 2.7 + r.n);
      addFeather(t, base, hang(t) * 0.92 + 0.05 * Math.sin(i * 1.9), { length: lerp(r.len[0], r.len[1], t) * jitter, width: r.width, round: r.round, thick: 0.06, curl: -0.1, segL: 6, segW: 2 }, r.z + (i % 2) * 0.012);
    }
  }
  // Leading edge.
  WF[0].push(strand([J[0].clone().add(V(-0.2, -0.1, 0.1)), J[0].clone().lerp(J[1], 0.5).add(V(0, 0.08, 0.2)), J[1].clone().add(V(0, 0.05, 0.2))], { width: (t) => lerp(0.26, 0.2, t), thick: () => 0.14, segs: 8, radial: 8, up: () => V(0, 0, 1), sway: () => 0 }));
  WF[1].push(strand([J[1].clone().add(V(0, 0.05, 0.2)), J[1].clone().lerp(J[2], 0.5).add(V(0, 0.06, 0.2)), J[2].clone().add(V(0, 0.05, 0.18))], { width: (t) => lerp(0.2, 0.15, t), thick: () => 0.12, segs: 8, radial: 8, up: () => V(0, 0, 1), sway: () => 0 }));
  WF[2].push(strand([J[2].clone().add(V(0, 0.05, 0.18)), J[2].clone().lerp(J[3], 0.5).add(V(0, 0.04, 0.12)), J[3].clone().add(V(0.25, 0, 0.05))], { width: (t) => lerp(0.15, 0.04, t), thick: () => 0.1, segs: 8, radial: 8, up: () => V(0, 0, 1), sway: () => 0 }));
  // Gold mounts for the jewels (the Phase 2 weak points), two per wing.
  const spots = [
    { seg: 1, pos: V().lerpVectors(J[1], J[2], 0.32).add(V(0.3, -0.7, 0.5)) },
    { seg: 2, pos: J[2].clone().add(V(0.35, -0.55, 0.5)) },
  ];
  for (const sp of spots) {
    WG[sp.seg].push(prep(new THREE.TorusGeometry(0.42, 0.06, 8, 32).translate(sp.pos.x, sp.pos.y, sp.pos.z - 0.06)));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      const dir = V(Math.sin(a), Math.cos(a), 0);
      WG[sp.seg].push(orient(new THREE.ConeGeometry(0.05, 0.26, 4), sp.pos.clone().addScaledVector(dir, 0.55).add(V(0, 0, -0.08)), dir));
    }
  }
  const wingFeathers = WF.map((list, i) => merge(list).translate(-J[i].x, -J[i].y, -J[i].z));
  const wingGold = WG.map((list, i) => (list.length ? merge(list).translate(-J[i].x, -J[i].y, -J[i].z) : null));

  const wings = [];
  const wingJewelSpots = [];
  const wingTips = [];
  for (const s of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.32, 0.9, -0.72);
    pivot.rotation.y = s * 0.3;
    torso.add(pivot);
    const segs = [];
    let parent = pivot;
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      if (i > 0) g.position.set(s * (J[i].x - J[i - 1].x), J[i].y - J[i - 1].y, J[i].z - J[i - 1].z);
      parent.add(g);
      mesh(g, s > 0 ? wingFeathers[i] : mirrorX(wingFeathers[i]), M.feather, OUTLINE.feather);
      if (wingGold[i]) mesh(g, s > 0 ? wingGold[i] : mirrorX(wingGold[i]), M.gold, OUTLINE.gold);
      segs.push(g);
      parent = g;
    }
    for (const sp of spots) {
      const p = sp.pos.clone().sub(J[sp.seg]);
      wingJewelSpots.push({ parent: segs[sp.seg], pos: V(s * p.x, p.y, p.z) });
    }
    const tip = J[3].clone().add(V(0.55, 0.6, 0)).sub(J[2]);
    wingTips.push({ parent: segs[2], pos: V(s * tip.x, tip.y, tip.z) });
    wings.push({ pivot, segs, side: s });
  }

  // ======================= Animation state =======================
  const state = { pose: 'idle', mood: 'calm', flap: 1, flapPh: 0, blinkT: 2, blink: 0, prev: V(), hasPrev: false };
  const wind = V();
  const _w = V();
  const _q = new THREE.Quaternion();
  const _qi = new THREE.Quaternion();
  const _l = V();
  const IDQ = new THREE.Quaternion();
  const Y_UP = V(0, 1, 0);
  const look = { yaw: 0, pitch: 0 };

  const api = {
    root, torso, head, halo, staff, staffTip, heart, wings, outlines, M, wingJewelSpots, wingTips, state,
    // Collision / sword spheres (torso space).
    hitParts: [
      { off: V(0, 2.75, 0), r: 1.25 },
      { off: V(0, 0.55, 0), r: 1.05 },
      { off: V(0, -1.6, 0), r: 1.35 },
      { off: V(0, -3.8, 0), r: 2.25 },
    ],
    // Where the heart weak point sits (torso space).
    heartSpot: V(0, heartY, heartZ + 0.12),
    lookTarget: null,
    setPose(p) { state.pose = p; },
    setMood(m) { state.mood = m; },
    setFlash(v) { shared.uFlash.value = v; },
    setDissolve(v) {
      shared.uDissolve.value = v;
      for (const o of outlines) o.visible = v <= 0;
      halo.visible = v < 0.3;
      heart.visible = v < 0.4;
    },
    // Phase 3: crimson-tinted wings, red eyes and ribbons, a red-gold halo.
    setPalette(phase) {
      const p3 = phase >= 3;
      const f = M.feather.uniforms;
      f.uColor.value.set(p3 ? 0xf2b4c2 : 0xe6e8f5);
      f.uEmissive.value.set(p3 ? 0x1c0006 : 0x000000);
      f.uRim.value.set(p3 ? 0xff5a7a : 0xdfefff).multiplyScalar(p3 ? 0.4 : 0.16);
      M.hair.uniforms.uRim.value.set(p3 ? 0xffa0b4 : 0xe0eaff).multiplyScalar(0.2);
      face.material.uniforms.uIris.value = p3 ? FACE.irisRed : FACE.irisBlue;
      M.ribbon.uniforms.uColor.value.set(p3 ? 0xd8284e : 0x86baff);
      M.halo.uniforms.uColor.value.set(p3 ? 0xff4058 : 0xffc35a).multiplyScalar(1.2);
      M.gem.uniforms.uColor.value.set(p3 ? 0xff5a70 : 0x7fd8ff).multiplyScalar(1.15);
      M.staffGlow.uniforms.uColor.value.set(p3 ? 0xff5070 : 0x9ff4ff).multiplyScalar(1.35);
      M.jewel.emissiveIntensity = p3 ? 2.6 : 1.5;
    },
    update(dt, t) {
      shared.uTime.value = t;
      // Hair and cloth trail behind her when she moves.
      root.updateMatrixWorld();
      _w.setFromMatrixPosition(root.matrixWorld);
      if (state.hasPrev && dt > 0) {
        _l.subVectors(_w, state.prev).divideScalar(Math.max(dt, 1 / 120));
        _l.applyQuaternion(_qi.copy(root.quaternion).invert());
        _l.multiplyScalar(-0.05).clampLength(0, 1.2);
        wind.lerp(_l, Math.min(1, dt * 4));
      }
      state.prev.copy(_w);
      state.hasPrev = true;
      shared.uWind.value.copy(wind);

      // Look at the target with the head, then the eyes.
      let yaw = 0;
      let pitch = 0;
      if (api.lookTarget) {
        torso.updateMatrixWorld();
        _l.copy(api.lookTarget);
        torso.worldToLocal(_l).sub(HEAD_POS);
        yaw = Math.atan2(_l.x, _l.z);
        pitch = Math.atan2(-_l.y, Math.hypot(_l.x, _l.z));
      }
      const dizzy = state.mood === 'dizzy';
      const k = Math.min(1, dt * 4);
      look.yaw += (clamp(yaw, -0.7, 0.7) * 0.45 - look.yaw) * k;
      look.pitch += (clamp(pitch, -0.2, 0.7) * 0.4 - look.pitch) * k;
      head.rotation.y = dizzy ? 0 : look.yaw;
      head.rotation.x += ((dizzy ? 0.25 : look.pitch) - head.rotation.x) * k;
      const tilt = dizzy ? Math.sin(t * 3) * 0.2 : Math.sin(t * 0.9) * 0.05;
      head.rotation.z += (tilt - head.rotation.z) * Math.min(1, dt * 5);
      // Long hair follows only a quarter of the head's turn.
      _qi.copy(head.quaternion).invert();
      _q.copy(IDQ).slerp(_qi, 0.75);
      for (const p of hairPivots) p.quaternion.copy(_q);
      const fu = face.material.uniforms;
      fu.uGaze.value.set(
        clamp((yaw - head.rotation.y) * 0.08, -0.045, 0.045),
        clamp(-(pitch - head.rotation.x) * 0.07, -0.035, 0.02),
      );

      // Expression and blinking.
      state.blinkT -= dt;
      if (state.blinkT <= 0) { state.blink = 0.13; state.blinkT = 2.5 + Math.random() * 3; }
      state.blink = Math.max(0, state.blink - dt);
      const angry = state.mood === 'angry';
      let expr = angry ? 'angry' : 'calm';
      if (state.mood === 'peace') expr = 'peace';
      else if (dizzy) expr = 'dizzy';
      else if (state.blink > 0) expr += 'Blink';
      fu.uTiles.value.set(...FACES[expr]);

      // Wings: slow, majestic beats that ripple out to the tips.
      state.flapPh += dt * 1.7 * state.flap;
      const ph = state.flapPh;
      for (const w of wings) {
        w.segs[0].rotation.z = w.side * (0.05 + Math.sin(ph) * 0.16);
        w.segs[1].rotation.z = w.side * Math.sin(ph - 0.6) * 0.1;
        w.segs[2].rotation.z = w.side * Math.sin(ph - 1.2) * 0.13;
        w.pivot.rotation.x = Math.sin(ph) * 0.03;
      }
      haloSpin.rotation.y += dt * 0.5;
      staffHead.rotation.y += dt * 1.5;

      // Arm poses.
      const pose = POSES[state.pose] || POSES.idle;
      const ka = Math.min(1, dt * 7);
      for (const key of ['L', 'R']) {
        const a = arms[key];
        const [rx, rz, ex] = pose[key];
        a.shoulder.rotation.x += (rx - a.shoulder.rotation.x) * ka;
        a.shoulder.rotation.z += (rz - a.shoulder.rotation.z) * ka;
        a.elbow.rotation.x += (ex - a.elbow.rotation.x) * ka;
      }
      const R = arms.R;
      _qi.copy(R.shoulder.quaternion).multiply(R.elbow.quaternion).multiply(R.hand.quaternion).invert();
      _q.setFromUnitVectors(Y_UP, STAFF_DIR[state.pose] || STAFF_DIR.idle).premultiply(_qi);
      staff.quaternion.slerp(_q, Math.min(1, dt * 10));
    },
  };
  api.setPalette(2);
  return api;
}
