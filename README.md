# Football Career

A football career game for the browser: play a footballer's life from academy youngster to
retirement, on and off the pitch. Matches are played in 3D on top of a TypeScript port of the
match engine of [GameplayFootball](https://github.com/BazkieBumpercar/GameplayFootball) by
[Bastiaan Konings Schuiling](http://www.properlydecent.com/) (also the base of
[Google Research Football](https://github.com/google-research/football)).

The game is HTML5 (TypeScript + [Three.js](https://threejs.org/), built with [Vite](https://vite.dev/)),
so it runs on desktop and mobile browsers without installing anything, and can be wrapped for
app stores later (Tauri/Electron/Capacitor).

## Playing

```bash
npm install
npm run dev          # http://localhost:5173
```

- **Career**: create your footballer and live his career (see below).
- **Quick match**: pick two clubs, kits and controllers and play a match.
- **Settings**: graphics quality, audio, camera, gameplay and key bindings.

Controls (keyboard, rebindable): arrows move · S short pass · W through pass · A high pass/cross ·
D shot · E sprint · C dribble · Q switch player · Esc pause. Without the ball: S pressure,
A sliding tackle, W keeper rush, D team pressure. Gamepads (standard mapping) and on-screen touch
controls are supported.

## Career mode

You start at 15–16 in a club's youth academy in the city you choose and play until you retire:

- **Football**: training sessions (fitness, technique, tactics, recovery…) that develop your
  22 attributes along a realistic age curve, squad selection by the coach, league and cup
  seasons, contracts, transfers and loans, injuries, national team call-ups.
- **Matches**: play them yourself in 3D ("be a pro": you control only your player and the camera
  keeps you in view) or simulate them; your rating and stats feed your form, reputation and
  market value.
- **Life outside the pitch**: living in a city (housing, transport, lifestyle), money,
  family, friends, relationships, agent, media and social media, sponsors, education and
  narrative events with choices.
- **Retirement**: a legacy summary of the whole career and a hall of fame.

Careers are saved in the browser (several slots, export/import).

## Project layout

```
src/
  blunted/     engine layer (port of the original "Blunted2" engine): math, scene graph,
               resource loading (.ase models, .object scenes), Three.js renderer, Web Audio
  game/        port of the GameplayFootball game code: match, ball, teams, AI, players,
               humanoid animation system, referee, data (teams/players), input devices
  app/         match sessions (asset loading, running a match, stats and ratings), boot
  ui/          menus and in-match overlays (plain TypeScript + DOM + CSS)
  career/      career mode: world, simulation, life systems, screens
public/data/   the original game data (animations, models, textures, sounds, fonts, database)
legacy/        the original C++ sources, kept for reference while the port evolves
docs/          PORTING.md: conventions used to port the C++ code
tests/         vitest unit and simulation tests
```

The C++ → TypeScript port is deliberately faithful: class, method and member names match the
original so any TypeScript file can be compared side by side with its `legacy/src` counterpart.
See [docs/PORTING.md](docs/PORTING.md) for the conventions.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm run build` | typecheck + production build into `dist/` (static files, host anywhere) |
| `npm run preview` | serve the production build |
| `npm test` | unit and simulation tests (vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run assets` | regenerate `public/data/manifest.json` and the JSON database after changing data files |

`render-test.html` is a standalone renderer test scene (stadium, players, ball) with camera
presets (`?view=tv|close|goal|overview`).

## Data and modding

Teams and players come from `public/data/databases/default/database.json`, generated from the
original `database.sqlite` by `scripts/convert-database.py`; see
`public/data/databases/modding.txt` for how player stats work. After adding or changing files
under `public/data`, run `npm run assets` so the game's asset manifest is up to date.

## Deployment

The build is a static site. `.github/workflows/ci.yml` typechecks, tests and builds every push
and deploys the default branch to GitHub Pages (enable it once under
*Settings → Pages → Source: GitHub Actions*).

## Credits

- GameplayFootball: Bastiaan Konings Schuiling (2008–2015), released as public domain.
- Google Research Football changes: Google Brain team (Apache 2.0).
- Cross-platform fork of the C++ game: [vi3itor/GameplayFootball](https://github.com/vi3itor/GameplayFootball)
  and contributors.

Licensed under the Apache License 2.0 (see [LICENSE](LICENSE)).

If you want to thank Bastiaan for his great work, consider a donation to his Bitcoin address
1JHnTe2QQj8RL281fXFiyvK9igj2VhPh2t
