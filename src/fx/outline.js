import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Readability helpers: dark silhouette outlines and a fresnel rim light.

// Hull geometry with averaged normals, so the outline has no cracks at hard edges.
const hullCache = new WeakMap();
function hullGeometry(geo) {
  let hull = hullCache.get(geo);
  if (!hull) {
    const g = geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    hull = mergeVertices(g, 1e-3);
    hull.computeVertexNormals();
    hullCache.set(geo, hull);
  }
  return hull;
}

const materials = new Map();
function outlineMaterial(color, thickness) {
  const key = `${color}:${thickness}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uColor: { value: new THREE.Color(color) }, uThickness: { value: thickness } },
      ]),
      vertexShader: /* glsl */ `
        uniform float uThickness;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal);
          // Push out along the normal by an amount that grows with distance,
          // so the line keeps roughly the same width on screen.
          mvPosition.xyz += n * uThickness * max(1.5, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        #include <fog_pars_fragment>
        void main() {
          gl_FragColor = vec4(uColor, 1.0);
          #include <fog_fragment>
        }`,
    });
    materials.set(key, m);
  }
  return m;
}

// Adds an outline hull to every mesh under `root`. Returns the hull meshes.
export function addOutline(root, { color = 0x05040c, thickness = 0.004, filter = null } = {}) {
  const hulls = [];
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !o.userData.isOutline && (!filter || filter(o))) meshes.push(o); });
  for (const mesh of meshes) {
    const hull = new THREE.Mesh(hullGeometry(mesh.geometry), outlineMaterial(color, thickness));
    hull.userData.isOutline = true;
    hull.raycast = () => {};
    hull.renderOrder = -1;
    mesh.add(hull);
    hulls.push(hull);
  }
  return hulls;
}

// Fresnel rim light added to a standard material's emissive term.
export function addRim(material, color, strength = 1, power = 2.5) {
  const rimColor = new THREE.Color(color).multiplyScalar(strength);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRimPower = { value: power };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPower;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), uRimPower);
        totalEmissiveRadiance += uRimColor * rim;`,
      );
  };
  material.customProgramCacheKey = () => `rim-${color}-${strength}-${power}`;
  material.needsUpdate = true;
  return material;
}
