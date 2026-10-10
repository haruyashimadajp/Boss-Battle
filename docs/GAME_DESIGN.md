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

Controls (keyboard + mouse; gamepad and touch also supported):

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

### Phase 2 — ECLIPSE (60–25 %) — Seraphina
The Seraph's core cracks open and **Seraphina** hatches from it: a ~9.5 m angel girl in a
detailed anime style: delicate face with glowing blue eyes and pink cheeks, long flowing silver
hair, a golden halo, a white-and-gold priestess dress with lace and frills, one pair of large
white feathered wings and a winged gold staff. The center platform crumbles; the arena slowly orbits.
- Halo blades: her halo splits into a spinning ring of blades with gaps (slip through / jump / dash)
- Spiral barrage: rotating arms of light bullets aimed through your height
- Gravity well: black star at your position pulls you in, then bursts (dash or grapple out)
- Lance dash: aims her staff (red line) and charges through your position
- Also reuses the laser sweep and homing orbs; layered combos below 45 %
- Weak points: 4 wing jewels, two on each wing (grapple targets). Grapple points on her wing tips

### Phase 3 — SUPERNOVA (25–0 %)
Crimson wings, red eyes, angry face; sky turns crimson, arena orbits faster, shorter pauses.
- Meteor rain with ground markers (half of them around you)
- Annihilation beam: long charge, red cylinder shows the line; platforms and pillars block it
- Faster blades / spiral / lance; frequent combos, near-constant below 10 %
- Weak point: heart jewel on her chest
- Finisher: at 0 HP she is dazed → "FINISH IT" → press attack → slow-motion dive into her heart,
  white flash, she smiles and dissolves into light → VICTORY + rank

Checkpoints at the start of Phases 2 and 3 (result screen offers "FROM PHASE N").
Each new phase restores 3 HP.

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
4. ✅ Phases 2–3, transitions, finisher, HUD, title/result screens
   (Seraphina angel-girl form, 6 new attacks, orbiting arena, transform cinematics,
   checkpoints, dissolve finale)
5. ✅ Audio, balance, quality settings, polish
   (synthesized SFX for every action and attack, procedural soundtrack per phase, Overdrive,
   NORMAL / HARD, bot-measured balance pass, auto resolution, gamepad, best records)

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
- Phases 2–3 boss is a humanoid angel girl (user request), kept cute and wholesome.
- **Seraphina's model** (rebuilt in detail after v1.0, user request), all procedural, no asset files:
  - Cel shader with tinted shadows (rosy on skin, lavender on cloth), a thin rim light and a
    camera-relative key light, so she reads well from wherever the player is. Lit whites stay under
    the bloom threshold, so she doesn't glow.
  - Face: a decal painted on canvas (4x4 atlas: eyes, glowing irises, brows, mouths, blush).
    Six expressions (calm, angry, blink, happy, dizzy, plus angry blink); irises follow the player.
  - Silver hair from tapered strands (fringe, side locks, a long back curtain draped over the
    skirt), an anime "angel ring" highlight, and sway in a vertex shader that also reacts to her
    movement. The outlines use the same sway, so they stay attached.
  - Priestess dress: bodice, gold collar plate, heart jewel in a gold sunburst, bell sleeves,
    layered skirt with folds, ruffles, lace (alpha-tested), embroidered gold borders and a front panel.
  - Wings: three segments each (arm, forearm, hand) so a beat ripples to the tips; about 70
    shaped feathers per wing in six rows (flight feathers and three rows of coverts).
  - Budget: ~160k triangles and ~100 draw calls, about half of each for the outline hulls.
- **Overdrive** (step 5): gauge from hits (+2 %), weak hits (+3.5 %), reflects (+5 %), perfect
  dodges (+25 %), weak-point kills (+10 %) and breaks (+15 %). 8 s of 1.3x swing speed, 1.4x damage,
  free dashes and sword waves (35 % damage, aimed at the target in front, 3 on a heavy hit).
  Activation blast clears boss projectiles within 12 m. Colour: violet-white (not used by the boss).
- **Difficulty**: HARD (default, the intended experience: 6 HP, 3 HP back per phase) and NORMAL
  (9 HP, 4 back, 35 % longer pauses between attacks, slightly longer dash invincibility).
- **Balance pass** (step 5), measured with a scripted bot glued to the boss and swinging nonstop:
  - Before: Phase 2 died in ~3 s of uptime, because one swing popped several clustered wing jewels
    and every destroy paid a 400 bonus.
  - Changes: one weak point per swing / wave / plunge landing; destroy bonus 400 → 200; break
    damage 2.5x → 2x; boss HP 10 000 → 16 000; rank time penalty eased to match.
  - After: ~40 s of nonstop uptime for the whole fight, ~2.2 min at 30 % uptime. Expected real
    fight: roughly 4–7 minutes.
- **Audio**: everything is synthesized at runtime (no files). Boss attacks have a rising charge-up
  sound and a distinct release, panned toward the attack and never quieter than 35 %, so sound
  is a second telegraph. Perfect-dodge slow-mo muffles the mix; pause mutes effects.
  Music: title, Phase 1 (D minor, 136 BPM), Phase 2 (bells and choir, 144 BPM), Phase 3
  (C minor, 168 BPM, driven bass), victory, defeat; crossfades on phase changes.
- Graphics presets: LOW (no post-processing), MEDIUM (bloom, mobile default), HIGH (bloom + shadows).
  Auto resolution (default on) steps the render scale between 50 % and 100 % to hold ~50+ fps.

- **Readability rules** (after playtest feedback):
  - World is cool and low-saturation (blue-violet night); boss attacks own the warm red/orange range.
  - Player, platforms and boss get dark outlines; player has a cyan rim light.
  - Every attack shows its full danger area before it hits: laser = red sweep fan,
    slam = dark-red zone + pillar + shockwave reach ring, shockwave = visible wall at hit height.
  - Off-screen threats get red arrows on the screen edge.

## 9. Open questions

- Art direction: neon-celestial (current) vs. dark fantasy vs. sci-fi mecha
- Weapon: sword only (current assumption), or sword + gun hybrid
