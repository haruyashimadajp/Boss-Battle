// Gameplay tuning. Units: meters, seconds, radians.

export const PLAYER = {
  radius: 0.45,
  height: 1.8,

  runSpeed: 11,
  groundAccel: 90,
  groundFriction: 70,
  airAccel: 30,
  airFriction: 3,
  overspeedDecay: 10, // how fast speed above runSpeed bleeds off in the air

  gravity: 34,
  fallGravityMult: 1.45,
  maxFallSpeed: 52,
  jumpVelocity: 13.5,
  doubleJumpVelocity: 12.5,
  jumpCutMult: 0.45,
  coyoteTime: 0.1,
  jumpBuffer: 0.13,
  airJumps: 1,

  dashSpeed: 32,
  dashDuration: 0.17,
  dashCharges: 2,
  dashExitSpeed: 13,
  dashIFrames: 0.2,
  dashCooldown: 0.1,
  dashGroundRecharge: 0.35,

  grappleRange: 55,
  grappleConeDeg: 20,
  grappleConeDegTouch: 32,
  grappleFireTime: 0.09,
  grappleAccel: 115,
  grappleMaxSpeed: 40,
  grappleReleaseDist: 2.4,
  grappleEndPop: 11,
  grappleMaxTime: 2.5,
  grappleCooldown: 0.2,

  killY: -45,

  // Hard difficulty: few hit points, long-ish recovery after a hit.
  maxHp: 6,
  hurtIFrames: 1.0,
  hurtStun: 0.3,
  fallDamage: 1,
};

// Sword attacks. Times in seconds from the start of the swing.
// roll: orientation of the slash arc (0 = horizontal, PI/2 = vertical).
export const COMBAT = {
  ground: [
    { dur: 0.3, hitStart: 0.07, hitEnd: 0.15, cancel: 0.2, dmg: 60, lunge: 10, reach: 1.9, roll: -0.25, flip: false, hitstop: 0.06, shake: 0.12 },
    { dur: 0.32, hitStart: 0.08, hitEnd: 0.16, cancel: 0.22, dmg: 70, lunge: 10, reach: 1.9, roll: 0.35, flip: true, hitstop: 0.06, shake: 0.14 },
    { dur: 0.5, hitStart: 0.13, hitEnd: 0.24, cancel: 0.38, dmg: 130, lunge: 15, reach: 2.4, roll: 1.35, flip: false, hitstop: 0.11, shake: 0.3, heavy: true },
  ],
  air: [
    { dur: 0.3, hitStart: 0.07, hitEnd: 0.15, cancel: 0.2, dmg: 60, lunge: 12, reach: 2.0, roll: 0.2, flip: false, hitstop: 0.06, shake: 0.12 },
    { dur: 0.32, hitStart: 0.08, hitEnd: 0.16, cancel: 0.22, dmg: 70, lunge: 12, reach: 2.0, roll: -0.4, flip: true, hitstop: 0.06, shake: 0.14 },
    // Plunge: dives straight down, hitting everything on the way and on landing.
    { plunge: true, dmg: 150, reach: 2.2, landDmg: 120, landRadius: 4.5, hitstop: 0.12, shake: 0.45, heavy: true },
  ],
  comboReset: 0.4, // time after a swing before the combo starts over
  assistRange: 8, // auto-aim / lunge range (to the target's surface)
  plungeSpeed: 40,
  airHover: 2.5, // upward speed given by an air swing, so combos keep you aloft
};

export const BOSS = {
  maxHp: 10000,
  phase1End: 0.6, // fraction of HP where Phase 1 ends
  phase2End: 0.25, // fraction of HP where Phase 2 ends (Phase 3 runs to 0)
  angelWeakHp: 320, // wing jewels in Phase 2
  phaseHeal: 3, // HP restored to the player when a new phase begins
  hoverY: 30,
  coreRadius: 6,
  brokenY: 10,
  breakDuration: 6,
  brokenMult: 2.5,
  weakMult: 1.5,
  weakHp: 350,
  weakDestroyBonus: 400,
  breakPerWeakHit: 0.07,
  breakPerCoreHit: 0.015,
  breakPerWeakDestroy: 0.3,
  breakPerReflect: 0.08,
  reflectDmg: 150,
  idleMin: 0.9,
  idleMax: 1.6,
  perfectSlowmo: 1.5, // seconds of slowed boss time after a perfect dodge
  perfectScale: 0.25,
  dmg: { laser: 2, orb: 1, slam: 2, shockwave: 1 },
};

export const CAMERA = {
  distance: 7.5,
  minDistance: 1.4,
  height: 1.55,
  pitchMin: -0.9,
  pitchMax: 1.3,
  fov: 68,
  fovBoost: 16,
  mouseSens: 0.0022,
  touchSens: 0.0055,
};
