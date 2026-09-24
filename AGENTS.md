# AGENTS.md — start here (for every AI agent)

Several AI agents take turns on this project. You have no memory of earlier sessions: everything is in this repo.

## 1. Before you do anything
1. Read `STATUS.md` (local only, not published): what is done, in progress, and the **next task**.
2. Read the last 3 entries of `CHANGELOG.md` (local only).
3. Skim `src/index.js` (the public API) and the header comment of each file in `src/`.

The owner wants short, plain-language explanations. Work in small steps, one task at a time.
End every reply with exactly one "Next task: …" line.

### Public repo, local-only material
Local-only (git-ignored): `_local/`, `STATUS.md`, `CHANGELOG.md`, `CLAUDE.md`, `.env`. Never `git add -f` them, never
`git push --all` / `--mirror`, never commit secrets. Commit messages, code, comments and docs describe this library
only: no other products, projects or folders of the owner.

## 2. The project
Any car model (GLB) → a car that drives. A game-writing AI should write `CAR.create({ scene, physics, model })` and get
a car whose wheels turn and roll, with full vehicle physics. This is a **library other AIs call**: every choice must
make it easier to use correctly on the first try.

## 3. Where things are
```
src/index.js       THE PUBLIC API (default export CAR): create, createPhysics, createCamera, inspect, presets, tuning
src/types.d.ts     the types ("car", "car/sound", "car/engine-fx", "car/engine-sound"); the build checks them against the code
src/default-car.js the built-in low-poly car (no model given); goes through the same wheel detection
AI-GUIDE.md        what game-writing AIs read (keep ≤ 180 lines; the build checks every tuning number is in it)
llms.txt           one-screen summary for LLMs
dist/              BUILT, committed: car.module.js, car-sound.module.js, car-engine-fx.module.js, car-engine-sound.module.js, types.d.ts,
                   registry.json (npm run build; never edit by hand)
tools/build.mjs    the build: types vs code, bundles, refuses eval / network / workers in the core, registry, guide
tools/test-host.mjs  the library inside a game's own crashcat world (part of npm test): the game's step runs once
                   per frame, linked objects draw from the frame start, same driving as CAR.createPhysics()
tools/test-compressed.mjs  meshopt-compressed test models (gltfpack): same wheels, physics gate passes
demo/minimal.html  the smallest complete game, on dist/ (proves the bundle works in a browser)
src/detect.js      wheel detection from shape alone (three.js only for the scene graph; runs in Node)
src/rig.js         splits the model into body / wheels, builds pivots (mount → steer → spin); never changes the model
src/vehicle.js     raycast vehicle on crashcat, no three.js: suspension, tyres, engine, brakes, steering; PRESETS
src/physics.js     createPhysics(): a ready crashcat world for games without one
src/sound.js       OPTIONAL "car/sound": the car's sound — a recorded engine (./engine-sound.js, files found at
                   ../assets/sounds/engines/ from the module, or o.sounds), pops/turbo (engine-fx), tyres, road, wind,
                   thumps, crashes; distance + pan from a listener; a synthesised engine only as the fallback
src/engine-fx.js   OPTIONAL: exhaust pops & bangs + turbo (whine, whoosh, blow-off / flutter), synthesised
src/engine-sound.js OPTIONAL: the recorded engine player (loads a pack once per audio context, shared by all cars)
src/camera.js      createCamera(): GTA-style chase camera (spring follow, slide look, FOV at speed, shake, orbit)
demo/playground.*  the 3D test scene (import map like a game's); window.playground for automated checks
demo/sound.js      the playground / race sound for your car: recorded engines + engine-fx (AI cars use car/sound)
demo/quality.js    phone-friendly rendering for the demos: pixel ratio ≤ 1.5 + cheaper shadows on touch devices,
                   resolution steps down by itself when frames get slow
demo/effects.js    skid marks + tyre smoke from the wheels' contact / skid
demo/race.*        the race page (menu, lights, HUD, minimap, results); demo/track.js the City Circuit (layout →
                   centreline, walls (physics), road, kerbs, scenery, racing line); demo/race-ai.js lap tracker, AI
                   drivers (speed profile + pure pursuit + passing), slipstream; demo/race-cars.js the 3 balanced cars
tools/test-race.mjs  a whole 8-car AI race headless (npm run test:race): all finish, few resets, overtakes happen
demo/course.js     the course (smooth extruded ramps, bumps, hills, kerbs), shared by the playground and npm test
tools/test-car.mjs THE PHYSICS GATE (npm test): every test model detected, rigged, driven headless in Node
tools/detect-report.mjs  what the detector finds per model (npm run detect)
tools/load-glb.mjs three's GLTFLoader in Node (textures skipped)
tools/serve.mjs    local no-cache server, port 8770 (npm run serve:lan: port 8771 on the Wi-Fi, for a phone); POST /__shot saves playground screenshots to _local/shots/
assets/models/test/  the test cars (CC-BY, see CREDITS.md)
assets/sounds/engines/  engine sound packs recorded from Engine Simulator (MIT, see CREDITS.md): <name>.json + ONE
                   <name>.mp3 each (all loops, offsets in the json); games load them from here (keep the layout)
tools/tyre-sound-pack.mjs  tyre recordings → assets/sounds/tyres/tyres.json + .mp3 (loops + chirps, from a cuts.json);
                   that folder is git-ignored until recordings cleared for publishing are chosen
tools/engine-render/   C++ recorder (links Engine Simulator's core) + README; tools/engine-sound-pack.mjs loops them
```

## 4. Design rules
- **One call, no setup.** `CAR.create({ scene, physics, model })` must give a working car with defaults.
- **Never throw at a game.** Bad input warns once and returns `null` or falls back to a default.
- **Never change the caller's model.** New meshes share its materials and vertex buffers.
- **The game calls no update of ours.** Cars run inside `physics.step(dt)` / `physics.sync(alpha)` (wrapped once).
- **No bundled engines.** three and crashcat come from the import map. No WASM, eval, network, workers.
  The sound modules may fetch() their own recordings (same-origin files next to the library), nothing else.
- **Plain arrays at the edge** like crashcat: `[x, y, z]`, `[x, y, z, w]`.
- **Car frame:** +Z forward, +Y up, +X left, metres, origin between the wheels at the tyres' bottom.
- Run `npm test` after ANY change to detection, rig or vehicle; look at the result in the playground.
- Run `npm run build` after ANY change in `src/` and commit `dist/` with it (games load the built files).
- Change the public API → change `src/types.d.ts` and `AI-GUIDE.md` in the same commit (the build refuses a mismatch).

## 5. crashcat notes (0.0.5)
- Read `node_modules/crashcat/dist/src/**/*.d.ts` before using an API; do not write crashcat from memory.
- Forces added with `rigidBody.addForce*` last one step (cleared after `updateWorld`).
- `offsetCenterOfMass.create({ shape, offset })`: centre of mass = the shape's own + offset.
- Wheels are cylinder sweeps (`castShape`). A flat cylinder on flat ground touches along a line and the hit point /
  normal come from one end of it: use the normal without its axle component and the point under the wheel centre,
  or the car pulls sideways (npm test catches it: "drifted … sideways going straight").

## 6. Versions
`vMAJOR.MINOR.PATCH-<LETTER>` · A = Claude · B = Codex / GPT. `package.json` holds the number without the letter.
After every task: update `STATUS.md` + `CHANGELOG.md`, `npm test`, `npm run build`, commit, tag (`v0.8.0-A`).
Game engines pin a tag and download `dist/` files from it: never move or delete a pushed tag.
