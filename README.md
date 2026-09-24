# Pixelfork Car Physics

Drop in **any car model** (a `.glb`, e.g. downloaded from Sketchfab) — or none, for the built-in low-poly car — and
drive it. The wheels are found automatically from the model's shape, split out, given proper pivots, and a
raycast-vehicle simulation drives the car: suspension, tyre grip and sliding, steering, engine, brakes, handbrake.
Built on [three.js](https://threejs.org) and [crashcat](https://www.npmjs.com/package/crashcat) (both MIT), shared from
the page's import map. Made for game engines whose games are written by AI; usable in any three.js page.
No WASM, no network, no AI model needed at runtime.

```js
import CAR from 'car';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const physics = CAR.createPhysics({ floor: 400 });              // or your game's own crashcat world of the same shape
const gltf = await new GLTFLoader().loadAsync('my-car.glb');
const car = CAR.create({ scene, physics, model: gltf.scene, preset: 'sport' });   // no model: the built-in car

// every fixed update (1/60 s)
car.drive({ throttle: 1, brake: 0, steer: -0.3, handbrake: false });   // steer -1 left … +1 right
physics.step(1 / 60);
// every frame
physics.sync(alpha);
renderer.render(scene, camera);
```

| Read | For |
|---|---|
| [AI-GUIDE.md](AI-GUIDE.md) | using it in a game (the whole API, exact, checked against the code on every build) |
| [llms.txt](llms.txt) · `dist/registry.json` · `dist/types.d.ts` | LLMs and tools: summary, machine-readable API, types |
| [demo/minimal.html](demo/minimal.html) | the smallest complete game, on the built files |
| [AGENTS.md](AGENTS.md) | changing the library |

**Built files** (`npm run build`; three and crashcat stay external, nothing else is imported):

| Import name | File | |
|---|---|---|
| `car` | `dist/car.module.js` | the library (≈ 57 KB, 18 KB gzipped) |
| `car/sound` | `dist/car-sound.module.js` | optional: the car's sound, with real recorded engines (`assets/sounds/engines/`) |
| `car/engine-fx` | `dist/car-engine-fx.module.js` | optional: pops & bangs + turbo, synthesised |
| `car/engine-sound` | `dist/car-engine-sound.module.js` | optional: just the recorded engine player |

**In a game engine that already has a crashcat world** (`{ world, layers: { moving, static }, step(dt), sync(alpha) }`,
`step` = exactly one world step): pass it as `physics`. Cars add their own substeps inside `physics.step()` (the
engine's own step still runs once per frame, so its linked objects draw smoothly) and draw inside `physics.sync()`.
Models compressed with meshopt (gltfpack, gltf-transform) work the same: `npm run test:compressed` checks it.

`car.speed` (km/h) · `car.engine` ({ rpm, gear, redline, throttle, shifting }) · `car.skid` / `car.impact` (0..1, for
sounds and effects) · `car.tune({ grip: 1.6 })` (live) · `car.reset()` · `car.remove()` · `car.report` (what was found) ·
`CAR.inspect(model)` (detect only).

A GTA-style chase camera (lags behind, looks into slides, wider at speed, shakes on landings, orbit with the mouse):

```js
const cam = CAR.createCamera(camera, car);
cam.update(dt);                 // every frame, after physics.sync()
cam.orbit(dxPixels, dyPixels);  // mouse drag; swings back behind the car 1.5 s after you let go
cam.zoom(1.1); cam.setMode('chase' | 'far' | 'hood');
```

Presets: `car` (default, AWD), `sport` (RWD, fast), `classic` (old saloon), `offroad` (heavy, long travel). Any number in
`CAR.tuning` can be overridden: `CAR.create({ ..., mass: 1200, power: 200, topSpeed: 240, grip: 1.3, drive: 'rwd' })`.

What the physics does: tyre-shaped wheel probes (they roll up kerbs), soft-bump / firm-rebound dampers, load-sensitive
tyres with a slip curve and relaxation length, engine with revs, torque curve, automatic gearbox and engine braking,
traction control and ABS that keep cornering grip first, automatic countersteer, stability control that only steps in
when the car slides, landing assist in the air. Cars run at 120 Hz inside the game's 60 Hz `physics.step`.

## Car sound (optional): real recorded engines

```js
import { createCarSound } from 'car/sound';
const sound = createCarSound(car, { engine: 'f136', listener: camera });
sound.update();   // every frame; starts by itself on the first key or tap
```

The engine is **real**: recorded from **Engine Simulator** (AngeTheGreat, MIT), simulated combustion and exhaust,
not a synth. 13 engines ship in `assets/sounds/engines/`, one mp3 (~0.45 MB, 5.7 MB for all) + one json each; a game
downloads only the engines its cars use, once, shared by every car with that engine: Ferrari F136 V8 (`f136`) ·
BMW M52 straight-6 (`m52`) · Honda VTEC 4-cyl (`vtec`) · Chevrolet 454 V8 (`c454`) · Toyota 2JZ (`2jz`) · GM LS V8
(`ls`) · Lexus LFA V10 (`lfa`) · Subaru EJ25 boxer (`ej25`) · Audi inline-5 (`i5`) · 60° V6 (`v6`) · Ferrari 412 T2
V12 F1 (`f1v12`) · Suzuki Hayabusa (`busa`) · Harley-Davidson V-twin (`harley`). Without `engine` one is picked
from the car's power, redline and mass.

Around it: exhaust pops & bangs and optional turbo, tyres, road rumble, wind, suspension thumps and crashes into
walls. Tyres play recorded loops when `assets/sounds/tyres/tyres.json` (+ `.mp3`) is there, made from any tyre
recordings with `node tools/tyre-sound-pack.mjs <cuts.json> assets/sounds/tyres` — a squeal for sliding sideways,
one for wheelspin, one for locked wheels, short chirps — each driven by how much the wheels really slide, spin or
lock (`car.wheels[i].slide`, `.spinSlip`, `.lock`); without them, a synthesised screech. Cars further from the `listener` are quieter and panned. The recordings are found at
`../assets/sounds/engines/` from the module file (the repo layout: keep `dist/` and `assets/` side by side), or pass
`sounds: '/my/folder/'`. If a recording can't load, a synthesised engine plays instead and the console says why
(`sound.ready` resolves `false`); `engine: 'synth-v8'` (or `synth-inline4`, `synth-inline6`, `synth-v12`) asks for
that one on purpose.

Lower level, just the engine player:

```js
import { loadEngineSound } from 'car/engine-sound';
const engine = await loadEngineSound(audioContext, '/assets/sounds/engines/f136.json');
engine.output.connect(audioContext.destination);
engine.update(car.engine);   // every frame
```

Make more packs from any Engine Simulator engine: see [`tools/engine-render/README.md`](tools/engine-render/README.md).

Exhaust pops & bangs and turbo (whine, whoosh, blow-off valve or flutter), made live, no files (`src/engine-fx.js`):

```js
import { createEngineFx } from 'car/engine-fx';
const fx = createEngineFx(audioContext, { pops: 1, turbo: 0.6, blowoff: 0.6, valve: 'blowoff' });   // or 'flutter'
fx.output.connect(audioContext.destination);
fx.update(car.engine);   // every frame; fx.boost = 0..1 for a gauge
```

Pops crackle when you lift off at high revs, bang on full-throttle gear changes and crackle on the rev limiter.

## How the wheels are found

1. Every mesh is split into its connected pieces.
2. A piece is a wheel part when it is **round around a sideways axle**, sits low, and is off the centre line.
   Round pieces sharing an axle make one wheel (tyre + rim + hub cap + brake disc); small pieces inside it spin with it
   (wheel nuts), bigger off-axis ones only steer (brake calipers).
3. The wheels on the ground are paired left/right into axles. The front is guessed (wheels modelled already turned,
   where the cabin sits); pass `forward: '+z'` etc. if the guess is wrong.
4. Units are worked out from the car's length (metres, centimetres, millimetres…); pass `length: 4.5` to force.

The model you pass in is never changed.

**Needs:** the wheels must be separate pieces of geometry (they usually are, even when the whole car is one mesh).
A wheel welded into the body mesh cannot be found yet.

## Try it

```bash
npm install
npm run serve            # http://localhost:8770/  — the playground: pick a car or drop your own .glb
npm test                 # headless: detect + drive every test model; the library inside a game's own physics world
npm run test:compressed  # the same on meshopt-compressed copies of the test models
npm run build            # dist/ + types + registry (after any change in src/)
npm run detect           # what the detector finds in each test model
```

Race: `http://localhost:8770/demo/race.html` (or 🏁 Race in the playground): the **City Circuit**, a street circuit
inspired by Baku (long seafront straight, 90° city corners, a narrow old-town section, ~3.4 km), 8 cars (you + 7 AI),
three car choices balanced to within ~1.5 s a lap. `npm run test:race` runs a whole AI race headless.

Playground keys: W/↑ gas · S/↓ brake, reverse · A D / ← → steer · Space handbrake · R reset · drag the mouse to look
around, wheel to zoom · C camera · T tuning panel · M sound · B debug. Gamepad works too.

## Credits and licence

Test models: see [`assets/models/test/CREDITS.md`](assets/models/test/CREDITS.md) (CC-BY-4.0). Engine sound packs:
recorded with Engine Simulator, see [`assets/sounds/engines/CREDITS.md`](assets/sounds/engines/CREDITS.md) (MIT).
The library itself: see [LICENSE](LICENSE) (source-available, not open source; commercial use needs a licence).
