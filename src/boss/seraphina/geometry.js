import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Geometry builders for Seraphina. Every geometry carries position, normal, uv and `sway`
// (0 = pinned, 1 = free) and is indexed, so parts merge into a few meshes.

const ATTRS = ['position', 'normal', 'uv', 'sway'];
const smooth = THREE.MathUtils.smoothstep;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export function prep(geo, sway = 0) {
  const n = geo.attributes.position.count;
  if (!geo.index) geo.setIndex([...Array(n).keys()]);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.attributes.sway) {
    const s = new Float32Array(n);
    if (typeof sway === 'function') {
      const p = geo.attributes.position;
      for (let i = 0; i < n; i++) s[i] = sway(p.getX(i), p.getY(i), p.getZ(i));
    } else {
      s.fill(sway);
    }
    geo.setAttribute('sway', new THREE.BufferAttribute(s, 1));
  }
  for (const k of Object.keys(geo.attributes)) if (!ATTRS.includes(k)) geo.deleteAttribute(k);
  geo.morphAttributes = {};
  return geo;
}

export function merge(list) {
  return mergeGeometries(list.map((g) => prep(g)));
}

// Place a geometry: position, Euler rotation, scale.
export function place(geo, [x = 0, y = 0, z = 0] = [], [rx = 0, ry = 0, rz = 0] = [], s = 1) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s),
  );
  return geo.applyMatrix4(m);
}

// Parametric sheet: fn(u, v, out) fills a point. Winding (a, c, b) faces outward for a surface
// whose u runs around via (sin, cos) and whose v runs downward.
export function surface(fn, nu, nv, { wrap = false, flip = false, sway = null } = {}) {
  const pos = [];
  const uv = [];
  const sw = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      fn(u, v, p);
      pos.push(p.x, p.y, p.z);
      uv.push(u, 1 - v);
      sw.push(sway ? sway(u, v) : 0);
    }
  }
  const idx = [];
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      if (flip) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sw, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (wrap) {
    // Average normals across the u seam so the shading has no line there.
    const n = g.attributes.normal;
    for (let j = 0; j <= nv; j++) {
      const a = j * row;
      const b = a + nu;
      p.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, p.x, p.y, p.z);
      n.setXYZ(b, p.x, p.y, p.z);
    }
  }
  return g;
}

// Elliptical loft: rings [{ y, rx, rz, z }] from top to bottom, optionally only part of the way
// around (phi measured from the front, +z). ripple(u, v) scales the radius for folds.
export function loft(rings, { segs = 48, phi0 = 0, phi1 = Math.PI * 2, ripple = null, sway = null, nv = null } = {}) {
  const n = rings.length - 1;
  const steps = nv ?? n * 4;
  // Smooth interpolation of each ring property (uniform Catmull-Rom).
  const prop = (k) => new THREE.CatmullRomCurve3(rings.map((r, i) => new THREE.Vector3(i / n, r[k] ?? 0, 0)), false, 'catmullrom', 0.5);
  const cy = prop('y');
  const crx = prop('rx');
  const crz = prop('rz');
  const cz = prop('z');
  const full = phi1 - phi0 >= Math.PI * 2 - 1e-6;
  return surface((u, v, out) => {
    const phi = phi0 + (phi1 - phi0) * u;
    const r = ripple ? ripple(u, v, phi) : 1;
    out.set(
      Math.sin(phi) * crx.getPoint(v).y * r,
      cy.getPoint(v).y,
      Math.cos(phi) * crz.getPoint(v).y * r + cz.getPoint(v).y,
    );
  }, segs, steps, { wrap: full, sway });
}

// Tapered strand along a smooth path (hair locks, ribbon tails). The cross-section is an ellipse:
// width along `side`, thickness along the outward normal. up(t) gives the direction the flat side
// faces (e.g. away from the head).
export function strand(points, {
  width = (t) => 0.2 * (1 - t), thick = (t) => 0.05 * (1 - t * 0.8), segs = 20, radial = 8,
  up = () => new THREE.Vector3(0, 0, 1), sway = (t) => t, twist = 0,
} = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const pos = [];
  const uv = [];
  const sw = [];
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const S = new THREE.Vector3();
  const N = new THREE.Vector3();
  const U = new THREE.Vector3();
  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    U.copy(up(t, P)).normalize();
    S.crossVectors(T, U);
    if (S.lengthSq() < 1e-4) S.crossVectors(T, Math.abs(T.y) < 0.9 ? Y_AXIS : Z_AXIS);
    S.normalize();
    N.crossVectors(S, T).normalize();
    if (twist) { S.applyAxisAngle(T, twist * t); N.applyAxisAngle(T, twist * t); }
    const w = Math.max(width(t), 0.0005);
    const h = Math.max(thick(t), 0.0005);
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      // Lens-shaped section: flat, with sharp-ish side edges.
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(
        P.x + S.x * c * w + N.x * s * h,
        P.y + S.y * c * w + N.y * s * h,
        P.z + S.z * c * w + N.z * s * h,
      );
      uv.push(i / radial, t);
      sw.push(sway(t));
    }
  }
  const idx = [];
  const row = radial + 1;
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Root cap.
  const center = pos.length / 3;
  curve.getPointAt(0, P);
  pos.push(P.x, P.y, P.z);
  uv.push(0.5, 0);
  sw.push(sway(0));
  for (let i = 0; i < radial; i++) idx.push(center, i, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sw, 1));
  g.setIndex(idx);
  // Smooth normals across the section seam (duplicate vertices at a = 0 / 2PI).
  const welded = weldNormals(g);
  return welded;
}

// Compute normals as if seam vertices were shared, keeping the UV seam.
export function weldNormals(g) {
  const tmp = new THREE.BufferGeometry();
  tmp.setAttribute('position', g.attributes.position);
  tmp.setIndex(g.index);
  const merged = mergeVertices(tmp, 1e-5);
  merged.computeVertexNormals();
  // Map merged normals back by position.
  const key = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const map = new Map();
  const mp = merged.attributes.position;
  const mn = merged.attributes.normal;
  for (let i = 0; i < mp.count; i++) map.set(key(mp.getX(i), mp.getY(i), mp.getZ(i)), i);
  const p = g.attributes.position;
  const normals = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = map.get(key(p.getX(i), p.getY(i), p.getZ(i)));
    if (k === undefined) continue;
    normals[i * 3] = mn.getX(k);
    normals[i * 3 + 1] = mn.getY(k);
    normals[i * 3 + 2] = mn.getZ(k);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return g;
}

// Feather: a thin closed lens in the x-y plane hanging down -y from its quill at the origin,
// thickness along z. Curls back (+z) toward the tip and cups across the vane.
// asym > 0 narrows the leading (+x) vane, like a flight feather.
export function feather({ length = 2, width = 0.4, thick = 0.06, curl = 0.25, cup = 0.05, asym = 0, round = 0.5, segL = 10, segW = 4, flutter = 0.1 } = {}) {
  const pos = [];
  const uv = [];
  const sw = [];
  const rows = segL;
  const cols = segW * 2; // across, -1..1
  // Swells quickly from the quill, then tapers to a rounded (round = 1) or pointed (0) tip.
  const tipStart = 1 - (0.3 + round * 0.3);
  const profile = (t) => {
    const rise = Math.sin(Math.min(1, t / 0.2) * Math.PI / 2);
    const k = t <= tipStart ? 0 : (t - tipStart) / (1 - tipStart);
    const w = (1 - round) * (1 - k) + round * Math.sqrt(Math.max(0, 1 - k * k));
    return (0.15 + 0.85 * rise) * w;
  };
  for (const face of [1, -1]) {
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const w = width * profile(t);
      for (let i = 0; i <= cols; i++) {
        const s = (i / cols) * 2 - 1; // -1..1 across
        const side = s >= 0 ? 1 - asym : 1 + asym * 0.6;
        const x = s * w * 0.5 * side;
        const y = -t * length;
        const lens = Math.sqrt(Math.max(0, 1 - s * s));
        const z = curl * t * t * length * 0.25 + cup * s * s + face * thick * 0.5 * lens * (1 - t * 0.6);
        pos.push(x, y, z);
        uv.push(face > 0 ? (s + 1) / 2 : 1 - (s + 1) / 2, t);
        sw.push(flutter * t * t);
      }
    }
  }
  const idx = [];
  const row = cols + 1;
  const half = (rows + 1) * row;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      // Front faces +z, back faces -z.
      idx.push(a, c, b, b, c, d);
      idx.push(half + a, half + b, half + c, half + b, half + d, half + c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sw, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Repeat a texture along u (and v).
export function scaleUV(geo, su = 1, sv = 1) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

// Mirror across x = 0, keeping faces pointing outward.
export function mirrorX(geo) {
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  g.index.needsUpdate = true;
  return g;
}

// Tube along points (gold trims, piping). Closed loops pass closed = true.
export function tube(points, radius = 0.04, { closed = false, segs = null, radial = 6, sway = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  const g = new THREE.TubeGeometry(curve, segs ?? points.length * 4, radius, radial, closed);
  return prep(g, sway);
}

// Ring of points around an elliptical section at height y, with optional ripple.
export function ringPoints(y, rx, rz, n = 48, { z = 0, ripple = null, phi0 = 0, phi1 = Math.PI * 2, dy = null } = {}) {
  const pts = [];
  const full = phi1 - phi0 >= Math.PI * 2 - 1e-6;
  const count = full ? n : n + 1;
  for (let i = 0; i < count; i++) {
    const phi = phi0 + ((phi1 - phi0) * i) / n;
    const r = ripple ? ripple(phi) : 1;
    pts.push(new THREE.Vector3(Math.sin(phi) * rx * r, y + (dy ? dy(phi) : 0), Math.cos(phi) * rz * r + z));
  }
  return pts;
}

export { smooth };

// Overwrite the sway weights from vertex positions.
export function setSway(geo, fn) {
  const p = geo.attributes.position;
  const s = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) s[i] = fn(p.getX(i), p.getY(i), p.getZ(i));
  geo.setAttribute('sway', new THREE.BufferAttribute(s, 1));
  return geo;
}

// Orient a geometry so its +y axis points along `dir`, then move it to `pos`.
export function orient(geo, pos, dir, scale = 1) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : Array.isArray(scale) ? new THREE.Vector3(...scale) : scale;
  return geo.applyMatrix4(new THREE.Matrix4().compose(pos, q, s));
}
