# Space Shooter 🚀

A retro 2D space shooter built with pure **HTML5 Canvas + Vanilla JavaScript** — no install, no build step, just open and play.

## Play

Open `index.html` through a local server (required for Web Audio):

```bash
# Python (built-in)
python -m http.server 8080

# Node.js
npx serve .
```

Then visit `http://localhost:8080`.

> **Or** play directly via GitHub Pages if enabled for this repo.

## Controls

| Action | Input |
|--------|-------|
| Move   | Mouse (smooth follow) or WASD / Arrow keys |
| Shoot  | Hold Left Click or hold Space |

## Features

- 3 enemy types — Scout, Fighter (weaving), Dreadnought (5 HP)
- Level progression: faster spawns & enemies every 300 points
- 3 lives with invincibility frames after each hit
- Particle explosion effects
- Web Audio API sound effects (shoot / explode / level-up)
- High score tracked per session

## File Structure

```
index.html   — page layout, HUD, game-over overlay
style.css    — dark tech theme, centered layout
game.js      — all game logic (player, bullets, enemies, collisions, loop)
```

## Tech

Pure browser APIs only — no frameworks, no dependencies.
