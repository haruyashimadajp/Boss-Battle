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
  dashIFrames: 0.15,
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
