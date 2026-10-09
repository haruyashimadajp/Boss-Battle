import * as THREE from 'three';
import { addOutline } from '../fx/outline.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Seraphina: the angel who hatches from the Seraph's core for Phases 2-3.
// Stylised anime look built from primitives: toon shading, outlines, big eyes, twin tails.
// Origin is at her chest; she is about 9 m tall. She faces +Z.

const TAU = Math.PI * 2;

// 3-step toon ramp.
const ramp = (() => {
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

// Shared by every angel material: dissolve amount for the finale.
const dissolveU = {
  uDissolve: { value: 0 },
  uEdgeColor: { value: new THREE.Color(3.2, 2.4, 1.4) },
};

let matId = 0;
// Toon material with rim light and the dissolve effect.
function toon(color, { emissive = 0x000000, ei = 0, rim = 0xffffff, rimS = 0.4, rimP = 2.4, side = THREE.FrontSide } = {}) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp, emissive, emissiveIntensity: ei, side });
  const rimU = { uRimColor: { value: new THREE.Color(rim).multiplyScalar(rimS) }, uRimPower: { value: rimP } };
  m.userData.rim = rimU.uRimColor.value;
  const id = matId++;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, dissolveU, rimU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uDissolve;
        uniform vec3 uEdgeColor;
        uniform vec3 uRimColor;
        uniform float uRimPower;
        varying vec3 vWPos;
        float dh(vec3 p) { return fract(sin(dot(p, vec3(17.1, 31.7, 11.3))) * 43758.5453); }
        float dn(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dh(i), dh(i + vec3(1, 0, 0)), f.x), mix(dh(i + vec3(0, 1, 0)), dh(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(dh(i + vec3(0, 0, 1)), dh(i + vec3(1, 0, 1)), f.x), mix(dh(i + vec3(0, 1, 1)), dh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float dv = dn(vWPos * 0.8) * 0.7 + dn(vWPos * 2.3) * 0.3;
        if (dv < uDissolve) discard;
        float dEdge = (1.0 - smoothstep(0.0, 0.07, dv - uDissolve)) * step(0.001, uDissolve);
        float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), uRimPower);
        totalEmissiveRadiance += uRimColor * rimF + uEdgeColor * dEdge * 2.5;`);
  };
  m.customProgramCacheKey = () => `angel-toon-${id}`;
  return m;
}

const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });

export function buildAngel() {
  const M = {
    // Warm emissive lift so skin stays peachy under the cool night lighting.
    skin: toon(0xffe2d2, { emissive: 0x6a3a26, ei: 0.85, rim: 0xffc8b8, rimS: 0.25 }),
    hair: toon(0xffd27a, { rim: 0xfff4d0, rimS: 0.5, side: THREE.DoubleSide }),
    dress: toon(0xf2f4ff, { rim: 0xbfe6ff, rimS: 0.5, side: THREE.DoubleSide }),
    armor: toon(0xc4d4ff, { rim: 0xffffff, rimS: 0.55 }),
    gold: toon(0xffc35a, { emissive: 0x7a4a00, ei: 0.5, rim: 0xffe2a0, rimS: 0.6 }),
    ribbon: toon(0xff6fa0, { rim: 0xffd0e0, rimS: 0.45, side: THREE.DoubleSide }),
    wing: toon(0xffffff, { emissive: 0xa8dcff, ei: 0.18, rim: 0x9fdcff, rimS: 0.9, side: THREE.DoubleSide }),
    jewel: new THREE.MeshStandardMaterial({ color: 0x400018, emissive: 0xff3d7e, emissiveIntensity: 1.5 }),
    halo: new THREE.MeshStandardMaterial({ color: 0x3a2400, emissive: 0xffc861, emissiveIntensity: 1.3 }),
    staffGlow: new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x9ff4ff, emissiveIntensity: 1.6 }),
    eye: basic(0x1d2050),
    iris: basic(new THREE.Color(0.22, 0.62, 0.95)),
    shine: basic(0xffffff),
    blush: basic(0xff7a9a, { transparent: true, opacity: 0.55, depthWrite: false }),
    mouth: basic(0x8a2a40),
    brow: basic(0xc08a3a),
  };

  const root = new THREE.Group();
  const face = []; // small face parts (no outline)
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, opts = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (opts.noOutline) m.userData.noOutline = true;
    parent.add(m);
    return m;
  };

  // ---- Torso ----
  const torso = new THREE.Group();
  root.add(torso);
  add(torso, new THREE.SphereGeometry(1, 20, 16), M.dress, 0, 0.7, 0).scale.set(1, 1.15, 0.8);
  add(torso, new THREE.SphereGeometry(0.75, 20, 14), M.armor, 0, 0.9, 0.38).scale.set(1.2, 0.85, 0.6);
  add(torso, new THREE.CylinderGeometry(0.26, 0.3, 0.6, 12), M.skin, 0, 1.85, 0);
  add(torso, new THREE.TorusGeometry(0.5, 0.08, 8, 24), M.gold, 0, 1.62, 0).rotation.x = Math.PI / 2;
  // Ribbon bow at the collar.
  add(torso, new THREE.SphereGeometry(0.17, 10, 8), M.ribbon, 0, 1.38, 0.78);
  for (const s of [-1, 1]) {
    const loop = add(torso, new THREE.ConeGeometry(0.26, 0.6, 6), M.ribbon, s * 0.36, 1.38, 0.72);
    loop.rotation.z = s * Math.PI / 2;
    loop.scale.z = 0.5;
    const tail = add(torso, new THREE.BoxGeometry(0.14, 0.7, 0.04), M.ribbon, s * 0.14, 1.0, 0.84);
    tail.rotation.z = s * 0.25;
  }
  // Heart jewel: Phase 3 weak point and finisher target.
  const heart = add(torso, new THREE.OctahedronGeometry(0.42, 0), M.jewel, 0, 0.5, 0.92);
  heart.scale.set(1, 1.25, 0.6);
  // Belt and skirt.
  add(torso, new THREE.TorusGeometry(0.8, 0.09, 8, 28), M.gold, 0, -0.15, 0).rotation.x = Math.PI / 2;
  // Bell-shaped skirt.
  const skirtPts = [[0.8, -0.1], [0.95, -0.5], [1.35, -1.3], [2.05, -2.3], [2.85, -3.3], [3.35, -4.05], [3.5, -4.4]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  add(torso, new THREE.LatheGeometry(skirtPts, 36), M.dress);
  add(torso, new THREE.TorusGeometry(3.5, 0.1, 8, 56), M.gold, 0, -4.4, 0).rotation.x = Math.PI / 2;
  add(torso, new THREE.TorusGeometry(2.45, 0.06, 8, 48), M.gold, 0, -2.75, 0).rotation.x = Math.PI / 2;

  // ---- Head ----
  const head = new THREE.Group();
  head.position.set(0, 2.9, 0);
  torso.add(head);
  add(head, new THREE.SphereGeometry(1.25, 28, 20), M.skin).scale.set(1, 1.02, 0.98);
  // Hair: back/side shell (front left open for the face), crown cap and a soft fringe.
  add(head, new THREE.SphereGeometry(1.36, 28, 18, Math.PI / 2 + 0.85, TAU - 1.7, 0, Math.PI * 0.72), M.hair, 0, 0.08, -0.06).scale.set(1.06, 1.06, 1.05);
  add(head, new THREE.SphereGeometry(1.37, 28, 10, 0, TAU, 0, Math.PI * 0.3), M.hair, 0, 0.08, -0.04);
  add(head, new THREE.SphereGeometry(1.34, 28, 10, Math.PI / 2 - 1.0, 2.0, 0, Math.PI * 0.37), M.hair, 0, 0.06, 0.02);
  // Fringe strand tips just above the brows.
  for (let i = 0; i < 6; i++) {
    const u = (i / 5 - 0.5) * 1.7;
    const th = Math.PI * 0.37;
    const r = 1.32;
    const x = -Math.cos(Math.PI / 2 + u * 0.55) * Math.sin(th) * r;
    const z = Math.sin(Math.PI / 2 + u * 0.55) * Math.sin(th) * r;
    const len = 0.18 + (i % 2) * 0.12;
    const tip = add(head, new THREE.CapsuleGeometry(0.14, len, 4, 8), M.hair, x, 0.62 - len * 0.3, z + 0.02);
    tip.rotation.set(0.25, 0, -u * 0.25);
  }
  // Long side locks framing the face.
  for (const s of [-1, 1]) {
    const lock = add(head, new THREE.CapsuleGeometry(0.22, 2.0, 4, 8), M.hair, s * 1.12, -0.95, 0.5);
    lock.rotation.z = s * 0.06;
  }
  // Ahoge.
  const ahoge = add(head, new THREE.CapsuleGeometry(0.07, 0.7, 4, 6), M.hair, 0.15, 1.55, 0.2);
  ahoge.rotation.set(-0.6, 0, -0.7);
  // Twin tails: long tapered chains that hang and sway.
  const tails = [];
  for (const s of [-1, 1]) {
    let parent = new THREE.Group();
    parent.position.set(s * 1.25, 0.45, -0.35);
    head.add(parent);
    const rootG = parent;
    for (const dy of [0.22, -0.22]) {
      const bow = add(parent, new THREE.ConeGeometry(0.3, 0.7, 6), M.ribbon, s * 0.05, dy, 0.2);
      bow.rotation.z = dy > 0 ? Math.PI / 2 : -Math.PI / 2;
      bow.scale.z = 0.5;
    }
    const segs = [];
    // Bunch out below the ribbon, then taper to a point.
    const radii = [0.32, 0.52, 0.46, 0.3, 0.07];
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      if (i === 0) seg.rotation.z = s * 0.16;
      parent.add(seg);
      const len = 1.35;
      add(seg, new THREE.CylinderGeometry(radii[i], radii[i + 1], len, 12), M.hair, 0, -len / 2, 0);
      const next = new THREE.Group();
      next.position.y = -len;
      seg.add(next);
      segs.push(seg);
      parent = next;
    }
    tails.push({ side: s, root: rootG, segs });
  }
  // Face.
  const eyes = [];
  const brows = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(s * 0.45, -0.05, 1.07);
    head.add(eye);
    add(eye, new THREE.SphereGeometry(0.3, 16, 12), M.eye, 0, 0, 0, { noOutline: true }).scale.set(0.78, 1.15, 0.28);
    add(eye, new THREE.SphereGeometry(0.22, 16, 12), M.iris, 0, -0.04, 0.05, { noOutline: true }).scale.set(0.72, 1.0, 0.25);
    add(eye, new THREE.SphereGeometry(0.075, 8, 6), M.shine, -s * 0.07, 0.13, 0.1, { noOutline: true });
    add(eye, new THREE.SphereGeometry(0.04, 8, 6), M.shine, s * 0.06, -0.12, 0.1, { noOutline: true });
    const lash = add(eye, new THREE.TorusGeometry(0.27, 0.035, 4, 14, Math.PI), M.eye, 0, 0.06, 0.04, { noOutline: true });
    lash.scale.set(0.95, 1.2, 1);
    eyes.push(eye);
    const brow = add(head, new THREE.CapsuleGeometry(0.035, 0.3, 4, 6), M.brow, s * 0.45, 0.42, 1.12, { noOutline: true });
    brow.rotation.z = Math.PI / 2;
    brows.push({ mesh: brow, side: s });
    const blush = add(head, new THREE.CircleGeometry(0.2, 16), M.blush, s * 0.74, -0.38, 0.98, { noOutline: true });
    blush.rotation.y = s * 0.55;
    blush.scale.set(1.3, 0.75, 1);
  }
  const mouth = add(head, new THREE.TorusGeometry(0.12, 0.028, 4, 12, Math.PI), M.mouth, 0, -0.48, 1.19, { noOutline: true });
  mouth.rotation.z = Math.PI; // smile
  face.push(...eyes, mouth, ...brows.map((b) => b.mesh));
  // Halo.
  const halo = add(head, new THREE.TorusGeometry(1.15, 0.09, 8, 48), M.halo, 0, 1.75, -0.35, { noOutline: true });
  halo.rotation.x = Math.PI / 2 - 0.35;

  // ---- Arms ----
  const arms = {};
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 1.05, 1.35, 0);
    torso.add(shoulder);
    add(shoulder, new THREE.SphereGeometry(0.46, 14, 10), M.dress, s * 0.05, -0.05, 0); // puff sleeve
    add(shoulder, new THREE.CapsuleGeometry(0.24, 0.9, 4, 10), M.skin, 0, -0.75, 0);
    const elbow = new THREE.Group();
    elbow.position.y = -1.35;
    shoulder.add(elbow);
    add(elbow, new THREE.CapsuleGeometry(0.21, 0.8, 4, 10), M.skin, 0, -0.55, 0);
    add(elbow, new THREE.TorusGeometry(0.23, 0.06, 6, 16), M.gold, 0, -0.85, 0).rotation.x = Math.PI / 2;
    const hand = new THREE.Group();
    hand.position.y = -1.15;
    elbow.add(hand);
    add(hand, new THREE.SphereGeometry(0.27, 12, 10), M.skin);
    arms[s < 0 ? 'L' : 'R'] = { shoulder, elbow, hand, side: s, rx: 0, rz: 0, ex: 0 };
  }
  // Star staff in the right hand.
  const staff = new THREE.Group();
  arms.R.hand.add(staff);
  staff.rotation.x = Math.PI / 2; // held upright when the forearm points forward
  add(staff, new THREE.CylinderGeometry(0.09, 0.09, 7, 10), M.gold, 0, 1.2, 0);
  const staffHead = new THREE.Group();
  staffHead.position.y = 4.9;
  staff.add(staffHead);
  add(staffHead, new THREE.TorusGeometry(0.6, 0.07, 8, 32), M.gold);
  const star1 = add(staffHead, new THREE.OctahedronGeometry(0.42, 0), M.staffGlow, 0, 0, 0, { noOutline: true });
  star1.scale.set(0.6, 1.5, 0.35);
  const star2 = add(staffHead, new THREE.OctahedronGeometry(0.42, 0), M.staffGlow, 0, 0, 0, { noOutline: true });
  star2.scale.set(1.5, 0.6, 0.35);
  const staffTip = new THREE.Object3D();
  staffHead.add(staffTip);

  // ---- Wings ----
  // Each wing is an arm curving up and out; rounded feathers hang from it, longest at the tip.
  // Feathers are merged into one mesh per wing to keep draw calls low.
  const wings = [];
  const wingJewelSpots = [];
  const wingTips = [];
  const feather = new THREE.SphereGeometry(1, 10, 8).translate(0, -1, 0); // top at the origin
  const _fm = new THREE.Matrix4();
  const _fq = new THREE.Quaternion();
  const _fe = new THREE.Euler();
  for (const upper of [true, false]) {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.45, upper ? 1.25 : 0.35, -0.7);
      torso.add(pivot);
      const fan = new THREE.Group();
      fan.rotation.y = s * -0.35; // sweep back a little
      pivot.add(fan);
      const span = upper ? 5.6 : 3.6;
      const rise = upper ? 2.4 : -0.4;
      const arm = (u) => new THREE.Vector3(s * u * span, Math.sin(u * Math.PI * 0.85) * (upper ? 1.4 : 0.5) + u * rise, -u * 0.5);
      const parts = [];
      const N = upper ? 10 : 7;
      for (const row of [0, 1]) {
        for (let i = 0; i < N; i++) {
          const u = (i + 0.6) / N;
          const p = arm(u);
          const len = row === 0 ? (upper ? 1.6 + u * 3.6 : 1.2 + u * 2.2) : (upper ? 0.9 + u * 1.2 : 0.7 + u * 0.8);
          const width = row === 0 ? 0.42 : 0.5;
          // Hang down, fanning outward toward the tip.
          _fe.set(0, 0, s * (0.15 + u * (upper ? 0.9 : 0.7)));
          _fq.setFromEuler(_fe);
          _fm.compose(p.add(new THREE.Vector3(0, 0, row * 0.12)), _fq, new THREE.Vector3(width, len / 2, 0.12));
          parts.push(feather.clone().applyMatrix4(_fm));
        }
      }
      // The arm itself (a soft ridge of small feathers).
      for (let i = 0; i <= 8; i++) {
        const u = i / 8;
        _fm.compose(arm(u), _fq.identity(), new THREE.Vector3(0.38, 0.38, 0.22));
        parts.push(new THREE.SphereGeometry(1, 8, 6).applyMatrix4(_fm));
      }
      const mesh = add(fan, mergeGeometries(parts.map((g) => g.toNonIndexed())), M.wing);
      mesh.geometry.computeVertexNormals();
      wings.push({ pivot, fan, side: s, upper, mesh });
      wingJewelSpots.push({ parent: fan, pos: arm(0.42).add(new THREE.Vector3(0, -0.5, 0.35)) });
      if (upper) wingTips.push({ parent: fan, pos: arm(1).add(new THREE.Vector3(s * 0.4, 0.3, 0)) });
    }
  }

  // Outline everything except glows and face details.
  const outlines = addOutline(root, {
    color: 0x1a1020, thickness: 0.0035,
    filter: (o) => !o.userData.noOutline && o.material !== M.blush,
  });

  // ---- Poses ----
  const POSES = {
    idle: { R: [-0.25, 0.2, -0.9], L: [0.1, -0.3, -0.4] },
    cast: { R: [-2.7, 0.25, -0.2], L: [-0.6, -0.5, -0.3] },
    point: { R: [-0.25, 0.2, -0.9], L: [-1.45, -0.05, -0.05] },
    charge: { R: [-2.9, 0.45, -0.1], L: [-2.9, -0.45, -0.1] },
    lance: { R: [-1.45, -0.05, -0.15], L: [0.3, -0.5, -0.4] },
    dizzy: { R: [0.25, 0.15, -0.2], L: [0.25, -0.15, -0.2] },
    peace: { R: [-0.8, 0.5, -1.6], L: [-0.8, -0.5, -1.6] },
  };

  const state = { pose: 'idle', mood: 'calm', flap: 1, blinkT: 2, blink: 0, tilt: 0 };
  const api = {
    root, torso, head, halo, staff, staffTip, heart, wings, tails, eyes, outlines, M, wingJewelSpots, wingTips,
    state,
    setPose(p) { state.pose = p; },
    setMood(m) { state.mood = m; },
    setDissolve(v) {
      dissolveU.uDissolve.value = v;
      for (const o of outlines) o.visible = v <= 0;
      for (const f of face) f.visible = v < 0.45;
      halo.visible = v < 0.3;
    },
    // Phase 3: crimson wings and eyes, darker ribbons.
    setPalette(phase) {
      const p3 = phase >= 3;
      M.wing.color.set(p3 ? 0xff5a78 : 0xffffff);
      M.wing.emissive.set(p3 ? 0xff1f4a : 0xa8dcff);
      M.wing.emissiveIntensity = p3 ? 0.55 : 0.18;
      M.wing.userData.rim.set(p3 ? 0xff7090 : 0x9fdcff).multiplyScalar(0.9);
      M.iris.color.copy(p3 ? new THREE.Color(2.4, 0.3, 0.45) : new THREE.Color(0.45, 1.5, 2.0));
      M.ribbon.color.set(p3 ? 0xb0103a : 0xff6fa0);
      M.halo.emissive.set(p3 ? 0xff3050 : 0xffc861);
      M.staffGlow.emissive.set(p3 ? 0xff5070 : 0x9ff4ff);
      M.jewel.emissiveIntensity = p3 ? 2.6 : 1.5;
    },
    update(dt, t) {
      // Hair sway.
      for (const tail of tails) {
        tail.segs.forEach((seg, i) => {
          const w = Math.sin(t * 1.7 + i * 0.7 + tail.side) * (0.08 + i * 0.05);
          seg.rotation.x = (i === 0 ? 0.12 : 0.04) + w * 0.5;
          if (i > 0) seg.rotation.z = tail.side * (0.04 + Math.sin(t * 1.3 + i) * 0.06);
        });
      }
      // Wing flap.
      for (const w of wings) {
        const amp = w.upper ? 0.22 : 0.16;
        w.pivot.rotation.z = w.side * Math.sin(t * 2.2 * state.flap + (w.upper ? 0 : 0.8)) * amp;
        w.pivot.rotation.x = Math.sin(t * 2.2 * state.flap) * 0.05;
      }
      // Blink.
      state.blinkT -= dt;
      if (state.blinkT <= 0) { state.blink = 0.14; state.blinkT = 2.5 + Math.random() * 3; }
      state.blink = Math.max(0, state.blink - dt);
      const lid = state.mood === 'dizzy' ? 0.25 : state.mood === 'peace' ? 0.15 : state.blink > 0 ? 0.1 : 1;
      for (const e of eyes) e.scale.y += (lid - e.scale.y) * Math.min(1, dt * 30);
      // Brows / mouth by mood.
      const angry = state.mood === 'angry';
      for (const b of brows) {
        const want = Math.PI / 2 + (angry ? b.side * 0.45 : b.side * -0.12);
        b.mesh.rotation.z += (want - b.mesh.rotation.z) * Math.min(1, dt * 8);
        b.mesh.position.y = angry ? 0.36 : 0.42;
      }
      mouth.rotation.z = angry ? 0 : Math.PI;
      mouth.scale.set(angry ? 0.8 : 1, angry ? 0.6 : 1, 1);
      // Head tilt (cute idle / dizzy wobble).
      const tilt = state.mood === 'dizzy' ? Math.sin(t * 3) * 0.25 : Math.sin(t * 0.9) * 0.06;
      head.rotation.z += (tilt - head.rotation.z) * Math.min(1, dt * 5);
      head.rotation.x += ((state.mood === 'dizzy' ? 0.3 : 0) - head.rotation.x) * Math.min(1, dt * 5);
      halo.rotation.z += dt * 0.6;
      staffHead.rotation.y += dt * 1.5;
      // Arm poses.
      const pose = POSES[state.pose] || POSES.idle;
      const k = Math.min(1, dt * 7);
      for (const key of ['L', 'R']) {
        const a = arms[key];
        const [rx, rz, ex] = pose[key];
        a.shoulder.rotation.x += (rx - a.shoulder.rotation.x) * k;
        a.shoulder.rotation.z += (rz - a.shoulder.rotation.z) * k;
        a.elbow.rotation.x += (ex - a.elbow.rotation.x) * k;
      }
    },
  };
  api.setPalette(2);
  return api;
}
