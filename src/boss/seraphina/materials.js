import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Seraphina's shading: anime cel shading with tinted shadows, a thin rim light, optional toon
// specular, an "angel ring" hair highlight, wind sway for hair and cloth, the finale dissolve and
// a hit flash. The key light is camera-relative (upper left, near the viewer), so she reads cleanly
// from any angle the player sees her from.

// Uniforms shared by every Seraphina material.
export const shared = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector3() }, // object-space push on hair and cloth from her movement
  uDissolve: { value: 0 },
  uEdgeColor: { value: new THREE.Color(3.2, 2.4, 1.4) },
  uFlash: { value: 0 },
  uLight: { value: new THREE.Vector3(-0.38, 0.62, 0.7).normalize() },
};
const fogUniforms = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

// Sway displacement. Every geometry drawn with these materials carries a `sway` attribute
// (0 = pinned, 1 = free tip).
const SWAY = /* glsl */ `
attribute float sway;
uniform float uTime;
uniform vec3 uWind;
uniform vec4 uSway; // amplitude, speed, wave length along y, constant drift backward
uniform float uWindScale;
vec3 swayOffset(vec3 p, float w) {
  if (w <= 0.0) return vec3(0.0);
  float ph = uTime * uSway.y + p.y * uSway.z;
  vec3 o = vec3(sin(ph + p.z * 0.9), 0.0, 0.7 * sin(ph * 0.83 + 1.7 + p.x * 0.7)) * uSway.x;
  o.z -= uSway.w;
  o += uWind * uWindScale;
  return o * w;
}`;

const NOISE = /* glsl */ `
float dh(vec3 p) { return fract(sin(dot(p, vec3(17.1, 31.7, 11.3))) * 43758.5453); }
float dn(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dh(i), dh(i + vec3(1, 0, 0)), f.x), mix(dh(i + vec3(0, 1, 0)), dh(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dh(i + vec3(0, 0, 1)), dh(i + vec3(1, 0, 1)), f.x), mix(dh(i + vec3(0, 1, 1)), dh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float dissolveValue(vec3 wp) { return dn(wp * 0.8) * 0.7 + dn(wp * 2.3) * 0.3; }`;

const celVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${SWAY}
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vWPos;
varying vec3 vObj;
varying vec2 vUv;
varying float vSway;
void main() {
  vec3 p = position + swayOffset(position, sway);
  vObj = position;
  vUv = uv;
  vSway = sway;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  vViewPos = mvPosition.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const celFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform vec3 uShade;      // shadow colour multiplier
uniform float uShadeTh;   // N.L threshold of the shadow line
uniform vec3 uRim;
uniform float uRimWidth;
uniform vec3 uEmissive;
uniform float uFlash;
uniform float uDissolve;
uniform vec3 uEdgeColor;
uniform vec3 uLight;
#ifdef USE_TEX
uniform sampler2D uMap;
#endif
#ifdef USE_SPEC
uniform vec3 uSpec;
uniform float uSpecTh;
#endif
#ifdef USE_TIP
uniform vec3 uTip;
#endif
#ifdef HAIR_RING
uniform vec3 uRingColor;
#endif
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vWPos;
varying vec3 vObj;
varying vec2 vUv;
varying float vSway;
${NOISE}
void main() {
  float dv = dissolveValue(vWPos);
  if (dv < uDissolve) discard;
  vec3 base = uColor;
  #ifdef USE_TIP
  base = mix(base, uTip, smoothstep(0.25, 1.0, vSway));
  #endif
  #ifdef USE_TEX
  vec4 tx = texture2D(uMap, vUv);
  #ifdef ALPHA_TEST
  if (tx.a < 0.45) discard;
  #endif
  base *= tx.rgb;
  #endif
  vec3 n = normalize(vNormalV) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 v = normalize(-vViewPos);
  float ndl = dot(n, uLight);
  float lit = smoothstep(uShadeTh - 0.035, uShadeTh + 0.035, ndl);
  vec3 col = mix(base * uShade, base, lit);
  #ifdef USE_SPEC
  vec3 h = normalize(uLight + v);
  col += uSpec * smoothstep(uSpecTh, uSpecTh + 0.025, dot(n, h)) * lit;
  #endif
  #ifdef HAIR_RING
  // Anime "angel ring": a broken band of light around the crown, facing the viewer.
  vec3 hp = normalize(vObj);
  float az = atan(hp.x, hp.z);
  float lo = 0.36 + 0.035 * sin(az * 19.0) + 0.02 * sin(az * 7.0 + 1.3);
  float hi = 0.5 + 0.03 * sin(az * 23.0 + 0.7);
  float band = smoothstep(lo, lo + 0.025, hp.y) * (1.0 - smoothstep(hi - 0.025, hi, hp.y));
  band *= step(0.0, sin(az * 31.0) + 0.55) * smoothstep(0.25, 0.55, dot(n, v)) * step(abs(az), 2.1);
  col = mix(col, uRingColor, band * 0.85);
  #endif
  float fres = 1.0 - clamp(dot(n, v), 0.0, 1.0);
  col += uRim * smoothstep(1.0 - uRimWidth, 1.0 - uRimWidth * 0.55, fres);
  col += uEmissive;
  col += vec3(uFlash * 0.55);
  float dEdge = (1.0 - smoothstep(0.0, 0.07, dv - uDissolve)) * step(0.001, uDissolve);
  col += uEdgeColor * dEdge * 1.4;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const C = (c) => (c instanceof THREE.Color ? c.clone() : new THREE.Color(c));

// Cel material. Colours are linear; `shade` multiplies the base colour on the shadow side.
export function cel({
  color = 0xffffff, shade = [0.75, 0.75, 0.9], shadeTh = 0.0, rim = 0xffffff, rimStrength = 0.25, rimWidth = 0.3,
  emissive = 0x000000, map = null, alphaTest = false, spec = null, specTh = 0.96, tip = null, hairRing = null,
  sway = [0, 1, 0, 0], windScale = 0, side = THREE.FrontSide,
} = {}) {
  const defines = {};
  const uniforms = {
    ...shared,
    ...fogUniforms,
    uColor: { value: C(color) },
    uShade: { value: new THREE.Color(...shade) },
    uShadeTh: { value: shadeTh },
    uRim: { value: C(rim).multiplyScalar(rimStrength) },
    uRimWidth: { value: rimWidth },
    uEmissive: { value: C(emissive) },
    uSway: { value: new THREE.Vector4(...sway) },
    uWindScale: { value: windScale },
  };
  if (map) { defines.USE_TEX = ''; uniforms.uMap = { value: map }; }
  if (alphaTest) defines.ALPHA_TEST = '';
  if (spec) { defines.USE_SPEC = ''; uniforms.uSpec = { value: C(spec) }; uniforms.uSpecTh = { value: specTh }; }
  if (tip) { defines.USE_TIP = ''; uniforms.uTip = { value: C(tip) }; }
  if (hairRing) { defines.HAIR_RING = ''; uniforms.uRingColor = { value: C(hairRing) }; }
  const m = new THREE.ShaderMaterial({ uniforms, defines, vertexShader: celVertex, fragmentShader: celFragment, side, fog: true });
  m.userData.cel = true;
  return m;
}

// ---------- Outlines ----------
const outlineVertex = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${SWAY}
uniform float uThickness;
void main() {
  vec3 p = position + swayOffset(position, sway);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  // Constant on-screen width: push out further the further away it is.
  mvPosition.xyz += n * uThickness * max(1.5, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const outlineFragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
  #include <fog_fragment>
}`;

// One outline material per cel material, sharing its sway uniforms so the hull moves with it.
const outlineMats = new WeakMap();
function outlineMaterial(mat, color, thickness) {
  let byKey = outlineMats.get(mat);
  if (!byKey) { byKey = new Map(); outlineMats.set(mat, byKey); }
  const key = `${color}:${thickness}`;
  let m = byKey.get(key);
  if (!m) {
    const u = mat.uniforms;
    m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      fog: true,
      uniforms: {
        ...fogUniforms,
        uTime: shared.uTime,
        uWind: shared.uWind,
        uSway: u.uSway,
        uWindScale: u.uWindScale,
        uColor: { value: new THREE.Color(color) },
        uThickness: { value: thickness },
      },
      vertexShader: outlineVertex,
      fragmentShader: outlineFragment,
    });
    byKey.set(key, m);
  }
  return m;
}

// Hull with averaged normals (no cracks at hard edges or UV seams). Keeps the sway weights.
const hulls = new WeakMap();
function hullGeometry(geo) {
  let hull = hulls.get(geo);
  if (!hull) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.getAttribute('position'));
    g.setAttribute('sway', geo.getAttribute('sway'));
    if (geo.index) g.setIndex(geo.index);
    hull = mergeVertices(g, 1e-3);
    hull.computeVertexNormals();
    hulls.set(geo, hull);
  }
  return hull;
}

// Adds an outline hull to `mesh`. Returns the hull.
export function outline(mesh, color = 0x1d1428, thickness = 0.003) {
  const hull = new THREE.Mesh(hullGeometry(mesh.geometry), outlineMaterial(mesh.material, color, thickness));
  hull.userData.isOutline = true;
  hull.raycast = () => {};
  hull.renderOrder = -1;
  mesh.add(hull);
  return hull;
}

// ---------- Face ----------
// The face is a decal over the front of the head. Features come from a 4x4 atlas of 256 px tiles,
// each tile covering 0.5 x 0.5 m of face. Eyes, brows and blush are drawn for her left side
// (+x) and mirrored. The atlas is premultiplied and sRGB-encoded; the shader decodes it.
const faceVertex = /* glsl */ `
attribute vec2 fpos;
varying vec2 vF;
varying vec3 vWPos;
void main() {
  vF = fpos;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const faceFragment = /* glsl */ `
#include <common>
uniform sampler2D uAtlas;
uniform vec4 uTiles;  // eye white, eye lines, brows, mouth (-1 = none)
uniform float uIris;
uniform vec2 uGaze;
uniform float uGlow;
uniform vec2 uEyeC;
uniform vec2 uBrowC;
uniform vec2 uMouthC;
uniform vec2 uBlushC;
uniform float uBlush;
uniform float uDissolve;
uniform float uFlash;
varying vec2 vF;
varying vec3 vWPos;
${NOISE}
vec4 tile(float idx, vec2 uv) {
  if (idx < 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  float col = mod(idx, 4.0);
  float row = floor(idx / 4.0 + 0.01);
  vec4 s = texture2D(uAtlas, vec2((col + uv.x) * 0.25, (3.0 - row + uv.y) * 0.25));
  if (s.a > 0.0) s.rgb = pow(s.rgb / s.a, vec3(2.2)) * s.a;
  return s;
}
void over(inout vec4 dst, vec4 src) {
  dst.rgb = src.rgb + dst.rgb * (1.0 - src.a);
  dst.a = src.a + dst.a * (1.0 - src.a);
}
void main() {
  if (dissolveValue(vWPos) < uDissolve) discard;
  vec2 f = vec2(abs(vF.x), vF.y);
  vec4 c = tile(15.0, (f - uBlushC) * 2.0 + 0.5) * uBlush;
  vec2 euv = (f - uEyeC) * 2.0 + 0.5;
  vec4 white = tile(uTiles.x, euv);
  over(c, white);
  vec2 g = vec2(vF.x < 0.0 ? -uGaze.x : uGaze.x, uGaze.y);
  vec4 iris = tile(uIris, (f - uEyeC - g) * 2.0 + 0.5) * white.a;
  iris.rgb *= uGlow;
  over(c, iris);
  over(c, tile(uTiles.y, euv));
  over(c, tile(uTiles.z, (f - uBrowC) * 2.0 + 0.5));
  over(c, tile(uTiles.w, (vF - uMouthC) * 2.0 + 0.5));
  if (c.a < 0.004) discard;
  c.rgb += vec3(uFlash * 0.55) * c.a; // same hit flash as the body
  gl_FragColor = c;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function faceMaterial(atlas) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uDissolve: shared.uDissolve,
      uFlash: shared.uFlash,
      uAtlas: { value: atlas },
      uTiles: { value: new THREE.Vector4(0, 1, 10, 12) },
      uIris: { value: 8 },
      uGaze: { value: new THREE.Vector2() },
      uGlow: { value: 1.35 },
      uEyeC: { value: new THREE.Vector2(0.3, -0.2) },
      uBrowC: { value: new THREE.Vector2(0.3, 0.07) },
      uMouthC: { value: new THREE.Vector2(0, -0.6) },
      uBlushC: { value: new THREE.Vector2(0.43, -0.47) },
      uBlush: { value: 1 },
    },
    vertexShader: faceVertex,
    fragmentShader: faceFragment,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

// Glowing parts (jewels, halo, staff crystal): flat HDR colour with the dissolve.
export function glow(color, intensity = 1) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uDissolve: shared.uDissolve,
      uColor: { value: C(color).multiplyScalar(intensity) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWPos;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vV = -mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      uniform vec3 uColor;
      uniform float uDissolve;
      varying vec3 vWPos;
      varying vec3 vN;
      varying vec3 vV;
      ${NOISE}
      void main() {
        if (dissolveValue(vWPos) < uDissolve) discard;
        // Brighter facing the viewer, deeper at the edges: reads as a gem, not a blob.
        float f = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        gl_FragColor = vec4(uColor * (0.45 + 0.75 * f * f), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return m;
}
