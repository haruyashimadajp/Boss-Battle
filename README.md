# AETHER BREAKER

A browser 3D boss-battle action game (Three.js, no build step).
Design document: [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)

**Current state: Prototype 04 — the full three-phase fight.** Phase 1: the machine-seraph.
Phases 2–3: Seraphina, the angel who hatches from its core. Ends with a finisher cinematic. Floating sky arena, full movement kit,
sword combat, and Phase 1 of the Seraph fight (laser sweeps, homing orbs, wing slams).
PC and mobile controls.

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
    Tab / R / MMB lock-on camera on/off
    Esc           pause

Mobile: left side virtual stick, drag on the right side to look, ATK / JUMP / DASH / HOOK
buttons, LOCK toggle at the top right.

Tips:
- Dash *through* an attack for a PERFECT DODGE: the boss slows down for 1.5 s.
- Slash the homing orbs to send them back into the core.
- The pink orbs on the wings are weak points (and grapple targets). Destroying them fills the
  break gauge fast. A full gauge makes the boss crash down: 2.5x damage for 6 s.
- Jump during a dash to keep its momentum (dash-jump). Grappling refills your dash charges
  and double jump. The dark circle under you shows where you'll land.
- You have 6 HP. Falling into the void costs 1.
- Settings → "Screen shake & flashes: REDUCED" tones down shake, flashes and distortion.
- Phase 2: break the 4 jewels on her wings. Phase 3: hit the heart jewel on her chest.
- Annihilation beam ("TAKE COVER"): get a pillar or platform between you and her, or perfect-dodge.
- Dying in Phase 2 or 3 lets you continue from the start of that phase.

## Code layout

    index.html, style.css
    src/main.js            bootstrap, game states, main loop
    src/config.js          gameplay tuning values
    src/settings.js        persisted settings (controls, quality, sensitivity…)
    src/input/input.js     keyboard/mouse + touch → unified input state
    src/camera.js          third-person camera (lock-on, collision, FOV kick, shake)
    src/player/            character controller, sword combat and model
    src/boss/              boss state machine (3 phases), angel model, attacks (hazards*.js)
    src/world/             arena builder and collision
    src/fx/                particles/rings/afterimages, post-processing
    src/ui/                HUD and menus
