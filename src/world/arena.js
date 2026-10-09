import * as THREE from 'three';
import { makeCyl, makeSphere } from './collision.js';

// Builds the sky arena: floating platforms, grapple anchors, a placeholder boss,
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
  rock: new THREE.MeshStandardMaterial({ color: 0x2c2740, roughness: 0.92, metalness: 0.05, flatShading: true }),
  slab: new THREE.MeshStandardMaterial({ color: 0x575073, roughness: 0.75, metalness: 0.15, flatShading: true }),
  rune: new THREE.MeshStandardMaterial({ color: 0x0a2a33, emissive: 0x3fd8ff, emissiveIntensity: 1.6 }),
  pillar: new THREE.MeshStandardMaterial({ color: 0x3b3554, roughness: 0.6, metalness: 0.3, flatShading: true }),
  pillarBand: new THREE.MeshStandardMaterial({ color: 0x220b12, emissive: 0xff9a3c, emissiveIntensity: 2.2 }),
  crystal: new THREE.MeshStandardMaterial({ color: 0x2a0f40, emissive: 0xb77dff, emissiveIntensity: 2.4, flatShading: true }),
  crystalRing: new THREE.MeshBasicMaterial({ color: 0xd9b8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
};

export function buildWorld(scene) {
  const world = {
    colliders: [],
    anchors: [],
    solids: [], // meshes the camera should not clip through
    movers: [],
    spawn: new THREE.Vector3(0, 0, 42),
    spawnCollider: null,
    lights: {},
    update: null,
  };
  const rand = mulberry32(7);

  scene.background = new THREE.Color(0x07051a);
  scene.fog = new THREE.FogExp2(0x1d1236, 0.0058);

  const sky = buildSky();
  scene.add(sky.mesh, sky.stars);
  const clouds = buildCloudSea();
  scene.add(clouds);
  const embers = buildEmbers(rand);
  scene.add(embers);

  // ---------- Lights ----------
  const hemi = new THREE.HemisphereLight(0x8c7dff, 0x5a2440, 1.1); // warm bounce from the cloud sea
  const moon = new THREE.DirectionalLight(0xc4d6ff, 1.7);
  moon.position.set(-30, 60, 20);
  moon.shadow.mapSize.set(1024, 1024);
  const sc = moon.shadow.camera;
  sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 120;
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

    const p = { group, cols, x, y, z, r, depth };
    if (opts.motion) {
      p.motion = opts.motion;
      world.movers.push(p);
    }
    return p;
  }

  function pillar(px, z, baseY, h, r = 1.1) {
    const geo = jitterGeometry(new THREE.CylinderGeometry(r * 0.85, r, h, 7, 3), 0.15);
    const m = new THREE.Mesh(geo, MAT.pillar);
    m.position.set(px, baseY + h / 2, z);
    m.castShadow = m.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.95, 0.08, 6, 24), MAT.pillarBand);
    band.rotation.x = Math.PI / 2;
    band.position.y = h * 0.3;
    m.add(band);
    scene.add(m);
    world.solids.push(m);
    world.colliders.push(makeCyl(px, z, r, baseY, baseY + h));
  }

  const polar = (R, a) => [R * Math.sin(a), R * Math.cos(a)];

  // Start platform (south side, facing the boss).
  const start = platform(0, 0, 42, 7);
  world.spawnCollider = start.cols[0];

  // Center platform beneath the boss.
  platform(0, 3, 0, 9);

  // Outer ring.
  const outerH = [0, 2, 5, 1, 7, 3, 9, 4, 6, 2];
  for (let i = 1; i < 10; i++) {
    const a = (i / 10) * TAU;
    const [x, z] = polar(40, a);
    const r = 4.5 + rand() * 1.5;
    platform(x, outerH[i], z, r);
    if (i % 3 === 0) {
      const [ox, oz] = polar(r * 0.45, a + 1.2);
      pillar(x + ox, z + oz, outerH[i], 9 + rand() * 4);
    }
  }

  // Stepping stones between outer platforms.
  for (let i = 0; i < 10; i += 2) {
    const a = ((i + 0.5) / 10) * TAU;
    const [x, z] = polar(40, a);
    platform(x, (outerH[i] + outerH[(i + 1) % 10]) / 2 + 2.5, z, 1.7);
  }

  // Inward stepping stone from the start platform.
  platform(0, 3, 31, 2.5);

  // Inner ring: two of them move.
  const innerH = [6, 10, 8, 12, 9, 11];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const [x, z] = polar(22, a);
    let motion = null;
    if (i === 1) motion = { type: 'bob', amp: 3, speed: 0.9 };
    if (i === 4) motion = { type: 'orbit', radius: 22, angle: a, speed: 0.12, y: innerH[i] };
    platform(x, innerH[i], z, 3.5, { motion });
  }

  // High perches, reached by grappling.
  for (const deg of [30, 150, 270]) {
    const [x, z] = polar(33, (deg * Math.PI) / 180);
    platform(x, 22, z, 4);
  }

  // ---------- Grapple anchors ----------
  const crystalGeo = new THREE.OctahedronGeometry(0.75, 0);
  crystalGeo.scale(1, 1.5, 1);
  const ringGeo = new THREE.TorusGeometry(1.35, 0.04, 6, 40);

  function anchor(parent, x, y, z) {
    const group = new THREE.Group();
    const crystal = new THREE.Mesh(crystalGeo, MAT.crystal);
    const ring = new THREE.Mesh(ringGeo, MAT.crystalRing);
    group.add(crystal, ring);
    group.position.set(x, y, z);
    parent.add(group);
    const a = { group, crystal, ring, pos: new THREE.Vector3(), targeted: false, phase: rand() * TAU };
    world.anchors.push(a);
    return a;
  }

  for (let i = 0; i < 6; i++) {
    const [x, z] = polar(28, ((i + 0.5) / 6) * TAU);
    anchor(scene, x, 20, z);
  }
  for (const deg of [0, 120, 240]) {
    const [x, z] = polar(36, (deg * Math.PI) / 180);
    anchor(scene, x, 31, z);
  }
  anchor(scene, 0, 12, 36);

  // ---------- Placeholder boss (the real one comes in step 2) ----------
  const boss = new THREE.Group();
  boss.position.set(0, 30, 0);
  scene.add(boss);

  const coreMat = new THREE.MeshStandardMaterial({ color: 0x3a1a00, emissive: 0xffa53a, emissiveIntensity: 2.0 });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(6, 3), coreMat);
  boss.add(core);
  world.solids.push(core);
  const bossCol = makeSphere(0, 30, 0, 6);
  world.colliders.push(bossCol);

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(7.2, 1),
    new THREE.MeshBasicMaterial({ color: 0xffd38a, wireframe: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  boss.add(shell);

  const haloTilt = new THREE.Group();
  haloTilt.rotation.set(0.32, 0, 0.12);
  boss.add(haloTilt);
  const halo = new THREE.Group();
  haloTilt.add(halo);
  const haloGeo = new THREE.TorusGeometry(12.5, 0.38, 10, 120);
  haloGeo.rotateX(Math.PI / 2);
  halo.add(new THREE.Mesh(haloGeo, new THREE.MeshStandardMaterial({ color: 0x3a2400, emissive: 0xffc061, emissiveIntensity: 3 })));
  for (let i = 0; i < 4; i++) {
    const [x, z] = polar(12.5, (i / 4) * TAU + Math.PI / 4);
    anchor(halo, x, 1.6, z);
  }

  const wingMat = new THREE.MeshStandardMaterial({ color: 0x1c1830, emissive: 0xff7a2a, emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.3, flatShading: true });
  const wings = new THREE.Group();
  boss.add(wings);
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const upper = i < 2;
    const blade = new THREE.Mesh(new THREE.ConeGeometry(1.6, upper ? 20 : 14, 4), wingMat);
    blade.scale.z = 0.25;
    blade.position.set(side * (upper ? 11 : 9), upper ? 6 : -5, -3);
    blade.rotation.z = side * (upper ? -1.0 : -2.3);
    wings.add(blade);
  }

  const coreLight = new THREE.PointLight(0xffa64d, 1600, 0, 2);
  boss.add(coreLight);

  // Pillar of light falling from the core to the center platform.
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 3.5, 26, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.set(0, 16, 0);
  scene.add(beam);

  // ---------- Floating debris ----------
  const debrisCount = 70;
  const debris = new THREE.InstancedMesh(jitterGeometry(new THREE.DodecahedronGeometry(1, 0), 0.3), MAT.rock, debrisCount);
  const debrisData = [];
  for (let i = 0; i < debrisCount; i++) {
    const a = rand() * TAU;
    const R = 55 + rand() * 70;
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

    for (const p of world.movers) {
      const m = p.motion;
      let nx = p.x;
      let ny = p.y;
      let nz = p.z;
      if (m.type === 'bob') ny = p.y + Math.sin(t * m.speed) * m.amp;
      if (m.type === 'orbit') {
        const a = m.angle + t * m.speed;
        nx = Math.sin(a) * m.radius;
        nz = Math.cos(a) * m.radius;
      }
      const prev = p.group.position;
      const ddx = nx - prev.x;
      const ddy = ny - prev.y;
      const ddz = nz - prev.z;
      p.group.position.set(nx, ny, nz);
      p.cols[0].yMax = ny;
      p.cols[0].yMin = ny - 1.2;
      p.cols[1].yMax = ny - 1.2;
      p.cols[1].yMin = ny - 1.2 - p.depth * 0.5;
      for (const c of p.cols) {
        c.x = nx;
        c.z = nz;
        c.dx = ddx;
        c.dy = ddy;
        c.dz = ddz;
      }
    }

    boss.position.y = 30 + Math.sin(t * 0.5) * 0.6;
    bossCol.y = boss.position.y;
    core.rotation.y += dt * 0.15;
    shell.rotation.y -= dt * 0.25;
    shell.rotation.x += dt * 0.1;
    halo.rotation.y += dt * 0.22;
    wings.rotation.z = Math.sin(t * 0.7) * 0.05;
    coreMat.emissiveIntensity = 1.9 + Math.sin(t * 2.2) * 0.25;

    for (const a of world.anchors) {
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

  return world;
}

// ---------- Sky ----------
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 top = vec3(0.012, 0.01, 0.05);
        vec3 mid = vec3(0.10, 0.045, 0.22);
        vec3 hor = vec3(0.55, 0.20, 0.30);
        vec3 low = vec3(0.07, 0.03, 0.12);
        vec3 col = h > 0.0
          ? mix(mix(hor, mid, smoothstep(0.0, 0.18, h)), top, smoothstep(0.18, 0.8, h))
          : mix(hor, low, smoothstep(0.0, 0.25, -h));
        // Warm glow band on the horizon.
        col += vec3(0.5, 0.18, 0.08) * exp(-abs(h) * 22.0) * 0.6;
        gl_FragColor = vec4(col, 1.0);
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
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
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
        vec3 deep = vec3(0.06, 0.025, 0.12);
        vec3 lit = vec3(0.75, 0.32, 0.38);
        vec3 core = vec3(1.0, 0.62, 0.25);
        vec3 col = mix(deep, lit, smoothstep(0.35, 0.8, n));
        col += core * smoothstep(0.45, 0.9, n) * exp(-dist * 0.012) * 1.2;
        float alpha = smoothstep(0.25, 0.6, n) * (1.0 - smoothstep(300.0, 850.0, dist));
        gl_FragColor = vec4(col, alpha * 0.95);
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
    const R = Math.sqrt(rand()) * 90;
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
        gl_FragColor = vec4(vec3(1.0, 0.62, 0.28) * 2.0, a * vFade);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}
