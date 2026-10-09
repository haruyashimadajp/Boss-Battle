// Lightweight collision for a kinematic character.
// The player is a vertical cylinder (feet at pos.y). World shapes:
//   { type: 'cyl', x, z, r, yMin, yMax, dx, dy, dz }  vertical cylinder (platforms, pillars)
//   { type: 'sphere', x, y, z, r }                     (boss body)
// dx/dy/dz is how far a moving collider travelled this frame (used to carry the player).

export function makeCyl(x, z, r, yMin, yMax) {
  return { type: 'cyl', x, z, r, yMin, yMax, dx: 0, dy: 0, dz: 0 };
}

export function makeSphere(x, y, z, r) {
  return { type: 'sphere', x, y, z, r, dx: 0, dy: 0, dz: 0 };
}

// Pushes the player out of every overlapping collider. `prev` is the position before
// this sub-step, used to decide whether we landed, bumped our head, or hit a side.
export function resolve(pos, prev, vel, radius, height, colliders) {
  for (const c of colliders) {
    if (c.type === 'cyl') resolveCyl(pos, prev, vel, radius, height, c);
    else resolveSphere(pos, vel, radius, height, c);
  }
}

function resolveCyl(pos, prev, vel, radius, height, c) {
  const dx = pos.x - c.x;
  const dz = pos.z - c.z;
  const R = c.r + radius;
  const d2 = dx * dx + dz * dz;
  if (d2 >= R * R) return;
  if (pos.y >= c.yMax || pos.y + height <= c.yMin) return;

  const rise = Math.max(0, c.dy);
  if (prev.y >= c.yMax - 0.05 - rise) {
    pos.y = c.yMax;
    if (vel.y < 0) vel.y = 0;
  } else if (prev.y + height <= c.yMin + 0.05) {
    pos.y = c.yMin - height;
    if (vel.y > 0) vel.y = 0;
  } else {
    const d = Math.sqrt(d2);
    const nx = d > 1e-4 ? dx / d : 1;
    const nz = d > 1e-4 ? dz / d : 0;
    pos.x = c.x + nx * R;
    pos.z = c.z + nz * R;
    const vn = vel.x * nx + vel.z * nz;
    if (vn < 0) {
      vel.x -= vn * nx;
      vel.z -= vn * nz;
    }
  }
}

function resolveSphere(pos, vel, radius, height, c) {
  // Treat the player as a sphere around the body center for this test.
  const pr = Math.max(radius, height * 0.4);
  const cy = pos.y + height * 0.5;
  const dx = pos.x - c.x;
  const dy = cy - c.y;
  const dz = pos.z - c.z;
  const R = c.r + pr;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= R * R) return;
  const d = Math.sqrt(d2) || 1e-4;
  const nx = dx / d;
  const ny = dy / d;
  const nz = dz / d;
  pos.x = c.x + nx * R;
  pos.y = c.y + ny * R - height * 0.5;
  pos.z = c.z + nz * R;
  const vn = vel.x * nx + vel.y * ny + vel.z * nz;
  if (vn < 0) {
    vel.x -= vn * nx;
    vel.y -= vn * ny;
    vel.z -= vn * nz;
  }
}

// Finds a platform top directly under the feet. `below` is how far down we search
// (larger when we were grounded last frame, so we stick to descending platforms).
export function probeGround(pos, radius, colliders, below) {
  let best = null;
  for (const c of colliders) {
    if (c.type !== 'cyl') continue;
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const R = c.r + radius;
    if (dx * dx + dz * dz >= R * R) continue;
    const gap = pos.y - c.yMax;
    if (gap < -0.08 || gap > below) continue;
    if (!best || c.yMax > best.yMax) best = c;
  }
  return best;
}

// Highest platform top below a point (for the drop shadow marker).
export function groundHeightBelow(x, y, z, colliders) {
  let best = -Infinity;
  for (const c of colliders) {
    if (c.type !== 'cyl') continue;
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz >= c.r * c.r) continue;
    if (c.yMax <= y + 0.05 && c.yMax > best) best = c.yMax;
  }
  return best;
}
