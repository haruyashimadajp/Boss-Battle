import * as THREE from 'three';
import { makeCyl } from './collision.js';
import { addOutline, addRim } from '../fx/outline.js';

// Builds the sky arena: floating platforms, grapple anchors,
// sky, cloud sea and ambient particles. Everything is procedural (no asset files).

const TAU = Math.PI * 2;

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic per-position noise so duplicated seam vertices move together.
function hash3(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function jitterGeometry(geo, amount, keepTopY = Infinity) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (y >= keepTopY - 1e-3) continue;
    const kx = Math.round(x * 100) / 100;
    const ky = Math.round(y * 100) / 100;
    const kz = Math.round(z * 100) / 100;
    p.setXYZ(
      i,
      x + (hash3(kx, ky, kz) - 0.5) * amount,
      y + (hash3(ky, kz, kx) - 0.5) * amount,
      z + (hash3(kz, kx, ky) - 0.5) * amount,
    );
  }
  geo.computeVertexNormals();
  return geo;
}

const MAT = {
  rock: new THREE.MeshStandardMaterial({ color: 0x2a2638, roughness: 0.92, metalness: 0.05, flatShading: true }),
  slab: new THREE.MeshStandardMaterial({ color: 0x6c6a8c, roughness: 0.75, metalness: 0.15, flatShading: true }),
  rune: new THREE.MeshStandardMaterial({ color: 0x0a2a33, emissive: 0x3fd8ff, emissiveIntensity: 0.9 }),
  pillar: new THREE.MeshStandardMaterial({ color: 0x3b3554, roughness: 0.6, metalness: 0.3, flatShading: true }),
  pillarBand: new THREE.MeshStandardMaterial({ color: 0x220b12, emissive: 0xff9a3c, emissiveIntensity: 1.2 }),
  crystal: new THREE.MeshStandardMaterial({ color: 0x2a0f40, emissive: 0xb77dff, emissiveIntensity: 1.3, flatShading: true }),
  crystalRing: new THREE.MeshBasicMaterial({ color: 0xd9b8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }),
};
// Cool rim light so platform silhouettes separate from the sky.
addRim(MAT.slab, 0x8fb8ff, 0.12, 3.0); // weak: platform tops are seen at grazing angles
addRim(MAT.rock, 0x5a74c8, 0.45, 2.0);
addRim(MAT.pillar, 0x8fb8ff, 0.4, 2.2);
const OUTLINE = { color: 0x04030a, thickness: 0.0032 };

export function buildWorld(scene) {
  const world = {
    colliders: [],
    anchors: [],
    solids: [], // meshes the camera should not clip through
    platforms: [],
    phase: 1,
    orbitSpeed: 0, // whole-arena rotation speed (rad/s), raised in Phases 2-3
    orbitAngle: 0,
    spawn: new THREE.Vector3(0, 0, 57),
    spawnCollider: null,
    lights: {},
    update: null,
  };
  const rand = mulberry32(7);

  scene.background = new THREE.Color(0x07051a);
  scene.fog = new THREE.FogExp2(0x161b36, 0.0042);

  const sky = buildSky();
  scene.add(sky.mesh, sky.stars);
  const clouds = buildCloudSea();
  scene.add(clouds);
  const embers = buildEmbers(rand);
  scene.add(embers);

  // ---------- Lights ----------
  const hemi = new THREE.HemisphereLight(0xa8b8ff, 0x2c2848, 1.25);
  const moon = new THREE.DirectionalLight(0xd4e0ff, 2.0);
  moon.position.set(-30, 60, 20);
  moon.shadow.mapSize.set(1024, 1024);
  const sc = moon.shadow.camera;
  sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 120;
  moon.shadow.bias = -0.0008;
  moon.shadow.normalBias = 0.03;
  scene.add(hemi, moon, moon.target);
  world.lights.moon = moon;

  // ---------- Platforms ----------
  function platform(x, y, z, r, opts = {}) {
    const group = new THREE.Group();
    const top = new THREE.Mesh(jitterGeometry(new THREE.CylinderGeometry(r, r * 0.97, 1.0, 14, 1), 0.12, 0.5), MAT.slab);
    top.position.y = -0.5;
    const depth = r * (1.3 + rand() * 0.6);
    // Tapered cylinder rather than ConeGeometry: a multi-segment cone has holes in r169.
    const coneGeo = new THREE.CylinderGeometry(r * 0.96, 0.05, depth, 12, 4);
    coneGeo.translate(0, -depth / 2, 0);
    jitterGeometry(coneGeo, r * 0.14, 0);
    const under = new THREE.Mesh(coneGeo, MAT.rock);
    under.position.y = -1.0;
    const rune = new THREE.Mesh(new THREE.TorusGeometry(r - 0.25, 0.05, 6, 48), MAT.rune);
    rune.rotation.x = Math.PI / 2;
    rune.position.y = 0.02;
    group.add(top, under, rune);
    addOutline(group, { ...OUTLINE, filter: (o) => o !== rune });
    group.position.set(x, y, z);
    group.rotation.y = rand() * TAU;
    for (const m of [top, under]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    scene.add(group);
    world.solids.push(top, under);

    const cols = [makeCyl(x, z, r, y - 1.2, y), makeCyl(x, z, r * 0.55, y - 1.2 - depth * 0.5, y - 1.2)];
    world.colliders.push(...cols);

    const p = {
      group, cols, x, y, z, r, depth, attached: [],
      motion: opts.motion || null,
      // Polar placement, so Phases 2-3 can set the whole arena orbiting the boss.
      R: Math.hypot(x, z), a0: Math.atan2(x, z), dir: 1, crumble: null,
    };
    for (const c of cols) { c.ox = 0; c.oz = 0; c.top0 = c.yMax - y; c.bot0 = c.yMin - y; }
    world.platforms.push(p);
    return p;
  }

  // A pillar standing on platform p (moves with it).
  function pillar(p, px, z, baseY, h, r = 1.1) {
    const geo = jitterGeometry(new THREE.CylinderGeometry(r * 0.85, r, h, 7, 3), 0.15);
    const m = new THREE.Mesh(geo, MAT.pillar);
    m.position.set(px, baseY + h / 2, z);
    m.castShadow = m.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.95, 0.08, 6, 24), MAT.pillarBand);
    band.rotation.x = Math.PI / 2;
    band.position.y = h * 0.3;
    m.add(band);
    addOutline(m, { ...OUTLINE, filter: (o) => o === m });
    scene.add(m);
    world.solids.push(m);
    const col = makeCyl(px, z, r, baseY, baseY + h);
    col.ox = px - p.x; col.oz = z - p.z; col.top0 = baseY + h - p.y; col.bot0 = baseY - p.y;
    world.colliders.push(col);
    p.cols.push(col);
    p.attached.push({ mesh: m, ox: px - p.x, oz: z - p.z, oy: baseY + h / 2 - p.y });
  }

  const polar = (R, a) => [R * Math.sin(a), R * Math.cos(a)];

  // Start platform (south side, facing the boss).
  const start = platform(0, 0, 57, 9.5);
  world.spawnCollider = start.cols[0];

  // Center platform beneath the boss (crumbles when Phase 2 begins).
  world.center = platform(0, 3, 0, 13);

  // Outer ring.
  const outerH = [0, 2, 5, 1, 7, 3, 9, 4, 6, 2];
  for (let i = 1; i < 10; i++) {
    const a = (i / 10) * TAU;
    const [x, z] = polar(54, a);
    const r = 7 + rand() * 2;
    const p = platform(x, outerH[i], z, r);
    if (i % 3 === 0) {
      const [ox, oz] = polar(r * 0.45, a + 1.2);
      pillar(p, x + ox, z + oz, outerH[i], 9 + rand() * 4);
    }
  }

  // Stepping stones between outer platforms.
  for (let i = 0; i < 10; i += 2) {
    const a = ((i + 0.5) / 10) * TAU;
    const [x, z] = polar(54, a);
    platform(x, (outerH[i] + outerH[(i + 1) % 10]) / 2 + 2.5, z, 3);
  }

  // Inward stepping stone from the start platform.
  platform(0, 3, 43, 4);

  // Inner ring: two of them move.
  const innerH = [6, 10, 8, 12, 9, 11];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const [x, z] = polar(30, a);
    let motion = null;
    if (i === 1) motion = { type: 'bob', amp: 3, speed: 0.9 };
    if (i === 4) motion = { type: 'orbit', radius: 30, angle: a, speed: 0.1, y: innerH[i] };
    platform(x, innerH[i], z, 5.5, { motion }).dir = -1;
  }

  // High perches, reached by grappling.
  for (const deg of [30, 150, 270]) {
    const [x, z] = polar(40, (deg * Math.PI) / 180);
    platform(x, 22, z, 5.5).dir = -1;
  }

  // ---------- Grapple anchors ----------
  const crystalGeo = new THREE.OctahedronGeometry(0.75, 0);
  crystalGeo.scale(1, 1.5, 1);
  const ringGeo = new THREE.TorusGeometry(1.35, 0.04, 6, 40);

  // kind 'crystal' = plain grapple point; the boss adds 'weak' anchors (its weak points).
  function anchor(parent, x, y, z, { kind = 'crystal', crystal = null, ring = null } = {}) {
    const group = new THREE.Group();
    crystal = crystal || new THREE.Mesh(crystalGeo, MAT.crystal);
    ring = ring || new THREE.Mesh(ringGeo, MAT.crystalRing);
    group.add(crystal, ring);
    group.position.set(x, y, z);
    parent.add(group);
    const a = { group, crystal, ring, kind, active: true, pos: new THREE.Vector3(), targeted: false, phase: rand() * TAU };
    world.anchors.push(a);
    return a;
  }
  world.addAnchor = anchor;

  for (let i = 0; i < 6; i++) {
    const [x, z] = polar(38, ((i + 0.5) / 6) * TAU);
    anchor(scene, x, 20, z);
  }
  for (const deg of [0, 120, 240]) {
    const [x, z] = polar(48, (deg * Math.PI) / 180);
    anchor(scene, x, 31, z);
  }
  anchor(scene, 0, 12, 49);

  // ---------- Floating debris ----------
  const debrisCount = 70;
  const debris = new THREE.InstancedMesh(jitterGeometry(new THREE.DodecahedronGeometry(1, 0), 0.3), MAT.rock, debrisCount);
  const debrisData = [];
  for (let i = 0; i < debrisCount; i++) {
    const a = rand() * TAU;
    const R = 100 + rand() * 80;
    debrisData.push({
      x: Math.sin(a) * R,
      y: -25 + rand() * 75,
      z: Math.cos(a) * R,
      s: 0.6 + rand() * 2.8,
      rx: rand() * TAU,
      ry: rand() * TAU,
      spin: (rand() - 0.5) * 0.4,
      bob: rand() * TAU,
    });
  }
  scene.add(debris);
  const dummy = new THREE.Object3D();

  // ---------- Per-frame update ----------
  world.update = (dt, t, camera) => {
    sky.mesh.position.copy(camera.position);
    sky.stars.position.copy(camera.position);
    clouds.material.uniforms.uTime.value = t;
    embers.material.uniforms.uTime.value = t;

    // Arena rotation (Phases 2-3) eases toward its target speed.
    world.orbitSpeed += ((world.orbitTarget || 0) - world.orbitSpeed) * Math.min(1, dt * 0.5);
    world.orbitAngle += world.orbitSpeed * dt;
    for (const p of world.platforms) {
      const m = p.motion;
      let ang = p.a0 + world.orbitAngle * p.dir;
      let ny = p.y;
      if (m?.type === 'bob') ny += Math.sin(t * m.speed) * m.amp;
      if (m?.type === 'orbit') ang += t * m.speed;
      if (p.crumble) {
        p.crumble.t += dt;
        p.crumble.v += 14 * dt;
        p.crumble.y -= p.crumble.v * dt;
        ny = p.y + p.crumble.y;
        p.group.rotation.x += dt * 0.3;
        p.group.rotation.z += dt * 0.2;
        if (p.crumble.t > 6) p.group.visible = false;
      }
      const nx = p.R > 0.01 ? Math.sin(ang) * p.R : p.x;
      const nz = p.R > 0.01 ? Math.cos(ang) * p.R : p.z;
      const prev = p.group.position;
      const ddx = nx - prev.x;
      const ddy = ny - prev.y;
      const ddz = nz - prev.z;
      if (ddx === 0 && ddy === 0 && ddz === 0) {
        for (const c of p.cols) c.dx = c.dy = c.dz = 0;
        continue;
      }
      p.group.position.set(nx, ny, nz);
      for (const c of p.cols) {
        c.x = nx + c.ox;
        c.z = nz + c.oz;
        c.yMax = p.crumble ? -1e4 : ny + c.top0;
        c.yMin = p.crumble ? -1e4 - 1 : ny + c.bot0;
        c.dx = ddx;
        c.dy = ddy;
        c.dz = ddz;
      }
      for (const at of p.attached) {
        at.mesh.position.set(nx + at.ox, ny + at.oy, nz + at.oz);
        at.mesh.updateMatrixWorld();
      }
      // Keep matrices current for camera raycasts within this frame.
      p.group.updateMatrixWorld();
    }

    // Phase colour shift for sky and clouds.
    const tint = world.tintTarget;
    for (const u of [sky.mesh.material.uniforms.uTint, clouds.material.uniforms.uTint]) {
      u.value.lerp(tint, Math.min(1, dt * 0.8));
    }

    for (const a of world.anchors) {
      if (!a.active) continue;
      a.crystal.rotation.y += dt * 1.4;
      a.ring.rotation.x = Math.sin(t * 0.8 + a.phase) * 0.6 + Math.PI / 2;
      a.ring.rotation.y += dt * 0.9;
      const target = a.targeted ? 1.35 : 1;
      const s = a.group.scale.x + (target - a.group.scale.x) * Math.min(1, dt * 12);
      a.group.scale.setScalar(s);
      a.group.getWorldPosition(a.pos);
    }

    for (let i = 0; i < debrisCount; i++) {
      const d = debrisData[i];
      d.rx += d.spin * dt;
      d.ry += d.spin * 0.7 * dt;
      dummy.position.set(d.x, d.y + Math.sin(t * 0.4 + d.bob) * 1.2, d.z);
      dummy.rotation.set(d.rx, d.ry, 0);
      dummy.scale.setScalar(d.s);
      dummy.updateMatrix();
      debris.setMatrixAt(i, dummy.matrix);
    }
    debris.instanceMatrix.needsUpdate = true;
  };

  // Phase 2: center platform falls away and the arena starts to orbit. Phase 3: faster, crimson sky.
  world.tintTarget = new THREE.Vector3(1, 1, 1);
  world.setPhase = (phase, instant = false) => {
    world.phase = phase;
    world.orbitTarget = phase === 1 ? 0 : phase === 2 ? 0.05 : 0.085;
    world.tintTarget.set(...(phase === 1 ? [1, 1, 1] : phase === 2 ? [1.25, 0.85, 1.45] : [1.7, 0.55, 0.65]));
    const c = world.center;
    if (phase >= 2 && !c.crumble) {
      c.crumble = { t: instant ? 99 : 0, y: instant ? -400 : 0, v: 0 };
    }
    if (phase === 1) {
      c.crumble = null;
      c.group.visible = true;
      c.group.rotation.set(0, c.group.rotation.y, 0);
      world.orbitAngle = 0;
      world.orbitSpeed = 0;
    }
    if (instant) {
      world.orbitSpeed = world.orbitTarget;
      sky.mesh.material.uniforms.uTint.value.copy(world.tintTarget);
      clouds.material.uniforms.uTint.value.copy(world.tintTarget);
    }
  };

  return world;
}

// ---------- Sky ----------
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTint: { value: new THREE.Vector3(1, 1, 1) } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        // Cool, low-saturation night sky so the warm boss attacks stand out.
        vec3 top = vec3(0.008, 0.01, 0.035);
        vec3 mid = vec3(0.04, 0.05, 0.14);
        vec3 hor = vec3(0.17, 0.17, 0.33);
        vec3 low = vec3(0.03, 0.035, 0.09);
        vec3 col = h > 0.0
          ? mix(mix(hor, mid, smoothstep(0.0, 0.18, h)), top, smoothstep(0.18, 0.8, h))
          : mix(hor, low, smoothstep(0.0, 0.25, -h));
        // Warm glow band on the horizon.
        col += vec3(0.32, 0.2, 0.28) * exp(-abs(h) * 22.0) * 0.35;
        gl_FragColor = vec4(col * uTint, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;

  const n = 1600;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random();
    const v = Math.random() * 0.9 + 0.08;
    const th = u * TAU;
    const y = v;
    const r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(th) * r * 850, y * 850, Math.sin(th) * r * 850], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
  stars.renderOrder = -9;
  stars.frustumCulled = false;
  return { mesh, stars };
}

// ---------- Cloud sea far below the arena ----------
function buildCloudSea() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTint;
      varying vec3 vWorld;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vWorld.xz * 0.012;
        float n = fbm(p + vec2(uTime * 0.012, uTime * 0.006));
        n = fbm(p + n * 1.6 - vec2(uTime * 0.008, 0.0));
        float dist = length(vWorld.xz);
        vec3 deep = vec3(0.025, 0.03, 0.08);
        vec3 lit = vec3(0.24, 0.27, 0.45);
        vec3 core = vec3(0.7, 0.45, 0.22);
        vec3 col = mix(deep, lit, smoothstep(0.35, 0.8, n));
        col += core * smoothstep(0.45, 0.9, n) * exp(-dist * 0.012) * 1.2;
        float alpha = smoothstep(0.25, 0.6, n) * (1.0 - smoothstep(300.0, 850.0, dist));
        gl_FragColor = vec4(col * uTint, alpha * 0.95);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -70;
  mesh.renderOrder = -5;
  return mesh;
}

// ---------- Rising embers (animated entirely on the GPU) ----------
function buildEmbers(rand) {
  const n = 600;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rand() * TAU;
    const R = Math.sqrt(rand()) * 115;
    pos.set([Math.sin(a) * R, rand() * 90 - 30, Math.cos(a) * R], i * 3);
    seed[i] = rand();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float seed;
      varying float vFade;
      void main() {
        vec3 p = position;
        float speed = 1.0 + seed * 2.5;
        p.y = mod(p.y + uTime * speed + 30.0, 90.0) - 30.0;
        p.x += sin(uTime * 0.6 + seed * 40.0) * 1.5;
        p.z += cos(uTime * 0.5 + seed * 30.0) * 1.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (2.0 + seed * 3.0) * (60.0 / -mv.z);
        float yNorm = (p.y + 30.0) / 90.0;
        vFade = smoothstep(0.0, 0.15, yNorm) * (1.0 - smoothstep(0.75, 1.0, yNorm)) * (0.5 + 0.5 * sin(uTime * 3.0 + seed * 50.0));
      }`,
    fragmentShader: /* glsl */ `
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.75, 0.45) * 1.4, a * vFade * 0.6);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}
