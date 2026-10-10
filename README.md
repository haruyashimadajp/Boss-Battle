# AETHER BREAKER

A browser 3D boss-battle action game (Three.js, no build step).
Design document: [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)

**Current state: v1.0 — all five milestones done.** A three-phase boss fight in a floating sky
arena: the machine-seraph, then Seraphina, the angel who hatches from its core, ending with a
finisher cinematic. Full movement kit, sword combat, Overdrive ultimate, synthesized sound effects
and music, NORMAL / HARD difficulty. PC (keyboard + mouse or gamepad) and mobile controls.

## Run locally

ES modules need an HTTP server (opening `index.html` via `file://` will not work):

    python3 -m http.server 8000
    # or: npx serve .

Then open http://localhost:8000. To play on a phone, host it on GitHub Pages
(Settings → Pages → deploy from branch) or open your PC's LAN address from the phone.

## Single-file build (claude.ai Artifact)

    node tools/build-artifact.mjs

Bundles everything into `dist/aether-breaker.html` (Three.js still loads from the CDN).
That one file is what gets published as the playable Artifact, and it also runs when
opened straight from disk.

## Controls

Switch between PC and mobile in **Settings → Controls** (AUTO / PC / MOBILE).

PC:

    WASD          move
    Mouse         camera (click the game to lock the pointer)
    Space         jump / double jump (hold for higher jumps)
    Shift         air dash (2 charges, brief invincibility)
    Q / E / RMB   grapple (hold to reel in, release to slingshot)
    LMB / J       attack (3-hit combo; in the air the 3rd hit is a plunge)
    F             Overdrive (when the OD gauge is full)
    Tab / R / MMB lock-on camera on/off
    Esc           pause

Gamepad (standard layout): left stick move, right stick camera, A jump, B / RB dash,
X / RT attack, LB / LT grapple, Y Overdrive, R3 lock-on, Start pause. A confirms on menus.

Mobile: left side virtual stick, drag on the right side to look, ATK / JUMP / DASH / HOOK
buttons, OD (lights up when the gauge is full), LOCK toggle at the top right.

Tips:
- Dash *through* an attack for a PERFECT DODGE: the boss slows down for 1.5 s.
- Slash the homing orbs to send them back into the core.
- The pink orbs on the wings are weak points (and grapple targets). Destroying them fills the
  break gauge fast. A full gauge makes the boss crash down: 2x damage for 6 s.
- Each swing damages at most one weak point, so aim for them one at a time.
- **Overdrive**: hits, reflects, perfect dodges and breaks fill the OD gauge. Press F (Y / OD) for
  8 s of faster, stronger swings that launch sword waves at the boss, free dashes, and a
  blast that wipes out nearby orbs and bullets. A perfect dodge fills a quarter of the gauge.
- Jump during a dash to keep its momentum (dash-jump). Grappling refills your dash charges
  and double jump. The dark circle under you shows where you'll land.
- You have 6 HP on HARD (9 on NORMAL, which also slows the boss down). Falling into the void costs 1.
- Settings has volume sliders (master / music / effects) and Auto resolution, which lowers the
  render resolution when the frame rate drops.
- Settings → "Screen shake & flashes: REDUCED" tones down shake, flashes and distortion.
- Phase 2: break the 4 jewels on her wings. Phase 3: hit the heart jewel on her chest.
- Annihilation beam ("TAKE COVER"): get a pillar or platform between you and her, or perfect-dodge.
- Judgement (Phase 3, every quarter of its HP): she blasts you away, then light pillars strike
  the marked circles and nova rings sweep out at your height. Jump over the rings or dash through.
- Dying in Phase 2 or 3 lets you continue from the start of that phase.

## Code layout

    index.html, style.css
    src/main.js            bootstrap, game states, main loop
    src/config.js          gameplay tuning values
    src/settings.js        persisted settings (controls, quality, difficulty, volume…)
    src/input/input.js     keyboard/mouse + touch + gamepad → unified input state
    src/audio/             Web Audio synthesized effects (audio.js) and procedural music (music.js)
    src/camera.js          third-person camera (lock-on, collision, FOV kick, shake)
    src/player/            character controller, sword combat, Overdrive waves and model
    src/boss/              boss state machine (3 phases), angel model, attacks (hazards*.js)
    src/boss/seraphina/    angel shading, painted textures (face, lace, embroidery), geometry builders
    src/world/             arena builder and collision
    src/fx/                particles/rings/afterimages, post-processing
    src/ui/                HUD and menus
