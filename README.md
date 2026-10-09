# AETHER BREAKER

A browser 3D boss-battle action game (Three.js, no build step).
Design document: [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)

**Current state: Prototype 01 — movement.** Floating sky arena, placeholder boss,
full movement kit, PC and mobile controls.

## Run locally

ES modules need an HTTP server (opening `index.html` via `file://` will not work):

    python3 -m http.server 8000
    # or: npx serve .

Then open http://localhost:8000. To play on a phone, host it on GitHub Pages
(Settings → Pages → deploy from branch) or open your PC's LAN address from the phone.

## Controls

Switch between PC and mobile in **Settings → Controls** (AUTO / PC / MOBILE).

PC:

    WASD          move
    Mouse         camera (click the game to lock the pointer)
    Space         jump / double jump (hold for higher jumps)
    Shift         air dash (2 charges, brief invincibility)
    Q / E / RMB   grapple (hold to reel in, release to slingshot)
    Esc           pause

Mobile: left side virtual stick, drag on the right side to look, JUMP / DASH / HOOK buttons.

Tips: jump during a dash to keep its momentum (dash-jump). Grappling refills
your dash charges and double jump. The dark circle under you shows where you'll land.

## Code layout

    index.html, style.css
    src/main.js            bootstrap, game states, main loop
    src/config.js          gameplay tuning values
    src/settings.js        persisted settings (controls, quality, sensitivity…)
    src/input/input.js     keyboard/mouse + touch → unified input state
    src/camera.js          third-person camera (collision, FOV kick, shake)
    src/player/            character controller and model
    src/world/             arena builder and collision
    src/fx/                particles/rings/afterimages, post-processing
    src/ui/                HUD and menus
