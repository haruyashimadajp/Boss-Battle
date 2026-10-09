import * as THREE from 'three';

// Stylised armoured knight built from primitives. Faces +Z, feet at the origin.
export function buildPlayerModel() {
  const armor = new THREE.MeshStandardMaterial({ color: 0x1b2340, metalness: 0.75, roughness: 0.32 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xc9d6ff, metalness: 0.9, roughness: 0.25 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x46e6ff, emissiveIntensity: 2.6 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  add(body, new THREE.CapsuleGeometry(0.28, 0.48, 4, 12), armor, 0, 1.15, 0);
  add(body, new THREE.SphereGeometry(0.22, 16, 12), armor, 0, 1.68, 0);
  add(body, new THREE.BoxGeometry(0.3, 0.07, 0.12), glow, 0, 1.7, 0.17);
  add(body, new THREE.OctahedronGeometry(0.09), glow, 0, 1.27, 0.27);
  const crest = add(body, new THREE.ConeGeometry(0.06, 0.34, 4), trim, 0, 1.92, -0.06);
  crest.rotation.x = -0.5;

  for (const side of [-1, 1]) {
    const pad = add(body, new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), trim, side * 0.36, 1.43, 0);
    pad.scale.set(1.1, 0.8, 1.1);
  }

  // Sword sheathed on the back (drawn in step 2).
  const sword = new THREE.Group();
  sword.position.set(0, 1.2, -0.3);
  sword.rotation.z = 0.7;
  add(sword, new THREE.BoxGeometry(0.07, 1.15, 0.03), glow, 0, 0.25, 0);
  add(sword, new THREE.BoxGeometry(0.28, 0.05, 0.06), trim, 0, -0.35, 0);
  add(sword, new THREE.CylinderGeometry(0.03, 0.03, 0.25, 6), armor, 0, -0.5, 0);
  body.add(sword);

  const limb = (x, y, len, r) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    add(pivot, new THREE.CapsuleGeometry(r, len, 4, 8), armor, 0, -len / 2 - r, 0);
    body.add(pivot);
    return pivot;
  };
  const legL = limb(-0.14, 0.85, 0.52, 0.1);
  const legR = limb(0.14, 0.85, 0.52, 0.1);
  const armL = limb(-0.4, 1.42, 0.42, 0.08);
  const armR = limb(0.4, 1.42, 0.42, 0.08);
  for (const leg of [legL, legR]) add(leg, new THREE.BoxGeometry(0.16, 0.05, 0.08), glow, 0, -0.55, 0.06);

  const hand = new THREE.Object3D();
  hand.position.set(0, -0.62, 0);
  armR.add(hand);

  // Drawn sword, shown while attacking. The blade continues past the hand along the arm.
  const handSword = new THREE.Group();
  handSword.position.set(0, -0.62, 0.05);
  handSword.rotation.x = -Math.PI / 2; // blade points forward when the arm hangs down
  add(handSword, new THREE.BoxGeometry(0.07, 1.25, 0.03), glow, 0, 0.75, 0);
  add(handSword, new THREE.BoxGeometry(0.3, 0.05, 0.07), trim, 0, 0.1, 0);
  handSword.visible = false;
  armR.add(handSword);

  const materials = [armor, trim, glow];
  let opacity = 1;
  const setOpacity = (o) => {
    if (o > 0.98) o = 1;
    if (o === opacity || (o < 1 && Math.abs(o - opacity) < 0.01)) return;
    opacity = o;
    for (const m of materials) {
      const fade = o < 0.999;
      if (m.transparent !== fade) { m.transparent = fade; m.needsUpdate = true; }
      m.opacity = o;
      m.depthWrite = !fade;
    }
  };

  return { root, body, legL, legR, armL, armR, hand, glow, setOpacity, backSword: sword, handSword };
}
