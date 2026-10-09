# AETHER BREAKER — Game Design Proposal

A browser-playable 3D boss-battle action game. One player, one colossal boss,
a vertical arena in the sky. Short (6–10 min), intense, and flashy.

## 1. Concept

> Grapple, dash and fly around a 40 m celestial machine-angel, smash its
> weak points, break its guard, and finish it with a slow-motion dive into
> its core.

Pillars:

1. **Vertical movement is the core fun** — the boss is a mountain you climb
   mid-fight, not a target you stand in front of.
2. **Every hit feels heavy** — hitstop, shake, sparks, bloom on every
   connection.
3. **Readable spectacle** — huge effects, but every attack has a clear
   telegraph (color + sound + windup).

## 2. Player

Controls (keyboard + mouse, gamepad later):

- WASD: move / Mouse: camera (pointer lock)
- Space: jump, double jump
- Shift: air dash (8-way, short i-frames, afterimage trail). 2 charges, refill on landing/grapple
- Q / RMB hold: grapple hook to anchor crystals or boss weak points; release to slingshot
- LMB: 3-hit sword combo (ground) / 3-hit air combo (keeps you airborne)
- LMB while falling + aim down: plunge attack (shockwave on impact)
- F: Overdrive (ultimate, needs full gauge)

Key systems:

- **Perfect Dodge**: dashing through an attack in the last ~150 ms triggers
  1.5 s slow-mo (world at 30 %), blue screen tint, +Overdrive gauge.
- **Overdrive gauge**: filled by hits and perfect dodges. Activation = 8 s of
  boosted speed, glowing blade, slash waves.
- **Break gauge (boss)**: weak-point hits fill it. When full, the boss
  staggers and falls, core exposed → 6 s critical-damage window.

## 3. Boss — "Seraph of the Broken Sun"

A floating mechanical angel ~40 m tall: halo ring, 4 wings with glowing cores,
a central sun-core. Built entirely from procedural geometry + emissive shaders.

### Phase 1 — HALO (100–60 %)
Arena: ring of floating rock platforms around the boss.
- Laser sweep: horizontal beam, jump/dash over
- Homing orb volley: 12 slow orbs, dash to dodge or slash to reflect
- Wing slam: hits a platform, shockwave ring + platform cracks
- Weak points: 4 wing cores (reach them via grapple anchors on the wings)

### Phase 2 — ECLIPSE (60–25 %)
Transition cutscene: sky darkens, the sun goes eclipsed, platforms break apart
and start orbiting slowly. The floor becomes a void (falling = damage + respawn).
- Blade halo: the halo splits into 8 spinning blades sweeping the arena
- Spiral barrage: bullet-hell spiral of light shots
- Gravity well: pulls the player in, then explodes
- Ride mechanic: grapple onto the boss's rotating halo to reach the core

### Phase 3 — SUPERNOVA (25–0 %)
Boss armor shatters, red/black color grading, music intensifies.
- Meteor rain with ground markers
- Annihilation beam: screen-wide charge; hide behind a pillar or perfect-dodge
- Desperation combo: chains all previous attacks faster
- Finisher: at 0 HP → "BREAK" prompt → slow-mo dive into the core,
  white flash, boss dissolves into particles, result screen

## 4. Effects ("make it flashy")

Post-processing:
- Bloom (UnrealBloomPass) on all emissives
- Chromatic aberration pulse on heavy hits
- Radial blur during dash / grapple slingshot
- Vignette + color grading per phase (gold → violet → crimson)

Hit feedback:
- Hitstop 50–120 ms depending on hit weight
- Camera shake (trauma-based, decays smoothly)
- Spark bursts, slash-arc decals, floating damage numbers (crits big + gold)
- Brief white flash on the boss mesh

Particles / shaders:
- Sword trail ribbon (additive, gradient)
- Dash afterimages (ghost copies fading out)
- Shockwave rings with screen-space distortion
- Laser beams: scrolling noise shader + core glow + impact embers
- Boss death: dissolve shader with burning edges + thousands of GPU particles
- Ambient: drifting embers, clouds, god rays from the sun

Cinematics:
- Phase-transition camera cuts with letterbox bars
- Finisher slow-mo with a zoom-in and speed lines

## 5. HUD / Screens

- Boss HP bar (top, with phase markers) + Break gauge under it
- Player HP, dash charges, Overdrive gauge (bottom-left)
- Off-screen attack indicators
- Title screen → fight → result screen (time, damage taken, rank S–D)

## 6. Tech

- Three.js (ES modules via import map from a CDN) — no build step required,
  playable by opening `index.html` or via any static host (GitHub Pages)
- EffectComposer for post-processing; custom GLSL for beams, shockwaves, dissolve
- Custom kinematic character controller (capsule vs. simple colliders) for
  tight, tunable feel instead of a full physics engine
- Instanced meshes / pooled particle systems for performance
- Web Audio API with procedurally synthesized SFX (no asset files needed);
  music optional
- Target: 60 fps on a mid-range laptop; quality presets (Low / High)

Code layout (planned):

    index.html
    src/
      main.js          game loop, state machine (title / fight / result)
      input.js
      player/          controller, combat, grapple
      boss/            boss rig, phases, attack patterns
      fx/              particles, trails, shaders, postprocessing, camera shake
      ui/              HUD
      audio/

## 7. Milestones

1. ✅ Movement prototype: controller, camera, jump/dash/grapple on platforms, settings, PC/mobile controls
2. ✅ Combat + Phase 1 boss with hitstop / shake / sparks
   (sword combo with aim assist, plunge, orb reflect, perfect dodge slow-mo, break state,
   weak points, lock-on camera, HP / boss bar / damage numbers, result screen with rank)
3. ✅ Effects pass: post-processing, trails, beams, shockwaves
   (screen-space shockwave distortion, radial blur + speed lines, god rays from the core,
   per-state colour grading, sword ribbon trail, noise-shaded laser with scorch trails,
   debris/crystal shards, charge-up particles, letterboxed intro and phase-clear cinematics,
   REDUCED setting for shake / flashes / distortion)
4. Phases 2–3, transitions, finisher, HUD, title/result screens
5. Audio, balance, quality settings, polish

## 8. Decisions

- **Difficulty: hard.** Plan for the fight (step 2+):
  - Player HP is small (about 6 hits); boss attacks hit hard; no healing mid-fight
  - Falling into the void costs HP (in step 1 it only respawns you)
  - Perfect-dodge window stays tight (~150 ms); boss combos chain with little downtime in Phase 3
  - Checkpoint only at the start of each phase
- **Platforms: PC and mobile**, switchable in Settings → Controls (AUTO / PC / MOBILE).
  AUTO picks mobile on touch-first devices.
  - PC: keyboard + mouse with pointer lock (mouse-drag fallback if lock is blocked)
  - Mobile: floating virtual stick (left), drag-to-look (right), JUMP / DASH / HOOK buttons;
    grapple aim assist is wider on touch
- **Lock-on camera** is on by default (huge boss above the arena). Turning the camera by hand
  overrides it for ~0.7 s, so grappling elsewhere still works. Toggle: Tab / R / middle mouse / LOCK.
- Step 2 ends the fight when Phase 1 is cleared (boss at 60 % HP); Phases 2–3 come in step 4.
- Overdrive (ultimate) is deferred to the effects/polish steps.
- Graphics presets: LOW (no post-processing), MEDIUM (bloom, mobile default), HIGH (bloom + shadows)

- **Readability rules** (after playtest feedback):
  - World is cool and low-saturation (blue-violet night); boss attacks own the warm red/orange range.
  - Player, platforms and boss get dark outlines; player has a cyan rim light.
  - Every attack shows its full danger area before it hits: laser = red sweep fan,
    slam = dark-red zone + pillar + shockwave reach ring, shockwave = visible wall at hit height.
  - Off-screen threats get red arrows on the screen edge.

## 9. Open questions

- Art direction: neon-celestial (current) vs. dark fantasy vs. sci-fi mecha
- Weapon: sword only (current assumption), or sword + gun hybrid
