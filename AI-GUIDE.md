# Pixelfork Car Physics — AI guide (pixelfork-car@0.9.0-A)

**You never build a car. You create one and drive it.**
Give it any car model (a GLB with the wheels modelled in) — or no model for a built-in low-poly car. The wheels are
found automatically, split out and made to roll and steer, and the car drives with real vehicle physics: suspension,
tyre grip, engine, gearbox, brakes, handbrake. It handles kerbs, ramps, jumps and bumps. 3D (three.js + crashcat) only.
Units: metres, seconds, km/h for speeds you read. A car at `yaw: 0` faces +z. `position` y is the ground under it.

## 1. Load
One three.js and one crashcat on the page, shared through an import map with the names `"three"`, `"crashcat"` and
`"car"` (a game engine may write this map for you; `"car/sound"` for §7). Never bundle or load a second three.js.
```js
import CAR from "car";
```

## 2. In a game that already has a physics world
If the game has a crashcat world object of this shape — `{ world, layers: { moving, static }, step(dt), sync(alpha) }`,
where `step(dt)` does exactly one world step at a fixed 1/60 s and `sync(alpha)` runs before drawing — pass it:
```js
const car = CAR.create({ scene, physics, position: [0, 0, 0], yaw: 0 });          // built-in car
const car2 = CAR.create({ scene, physics, model: gltf.scene, preset: "sport" });  // your model
const cam = CAR.createCamera(camera, car);                                          // GTA-style chase camera
/* every fixed update, BEFORE physics.step(dt): */
car.drive({ throttle: up ? 1 : 0, brake: down ? 1 : 0, steer: (right ? 1 : 0) - (left ? 1 : 0), handbrake: space });
/* every frame, AFTER physics.sync(alpha): */
cam.update(frameDt);
```
Nothing else runs per frame: the car lives inside `physics.step()` (it adds its own substeps) and draws inside
`physics.sync(alpha)`. Ground, walls, ramps and props are ordinary crashcat bodies; the wheels drive on all of them.

## 3. In any other three.js page
```js
import * as THREE from "three";
import CAR from "car";
const physics = CAR.createPhysics({ floor: 400 });   // gravity -9.81, a 400 m static floor with its top at y = 0
const car = CAR.create({ scene, physics });
const cam = CAR.createCamera(camera, car);
let last = performance.now(), acc = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; acc += dt;
  while (acc >= 1 / 60) { car.drive(readKeys()); physics.step(1 / 60); acc -= 1 / 60; }   // fixed step
  physics.sync(acc * 60);                                                                 // draw between steps
  cam.update(dt);
  renderer.render(scene, camera);
});
```
Your own things go in with crashcat: `rigidBody.create(physics.world, { shape: box.create({ halfExtents: [2, 0.5, 4] }),
motionType: MotionType.STATIC, objectLayer: physics.layers.static, position: [0, 0.5, 20] })`.
A runnable example: `demo/minimal.html`.

## 4. Your own car model
```js
const gltf = await new GLTFLoader().loadAsync("car.glb");   // or the model your engine's loader gives you
const car = CAR.create({ scene, physics, model: gltf.scene });
if (!car) { /* no wheels found: see the console warning; fall back to CAR.create({ scene, physics }) */ }
```
- Any car whose round wheels are modelled as their own parts works: Sketchfab downloads, low-poly, cm or mm
  units, meshopt-compressed files. The model is not changed; one loaded model makes any number of cars.
- `car.report` says what was found (wheels, size, notes). Driving backwards? Pass `forward: "-z"` (or `"+x"`, …).
  Tiny or huge? Pass `length: 4.5` (the real length in metres).
- `CAR.inspect(model)` checks a model without making a car: `{ ok, reason, wheels, notes }`.

## 5. Controls, camera, reading the car
- `car.drive({ throttle, brake, steer, handbrake })`: throttle and brake 0..1, steer -1 (left) .. 1 (right). Holding
  brake at a standstill reverses. Missing fields keep their value. Touch: map buttons or a stick to the same numbers.
  Donut: `throttle: 1` + `handbrake: true` + full `steer` below ~30 km/h spins the car on the spot round its front
  wheels, rear tyres spinning and smoking; release the handbrake to drive off.
- Camera: `cam.orbit(dxPixels, dyPixels)` on mouse / finger drag (it swings back behind after 1.5 s),
  `cam.zoom(1.1)` on the wheel, `cam.setMode("chase" | "far" | "hood")`, `cam.setCar(otherCar)`, `cam.reset()`.
- Read: `car.speed` (km/h, negative reversing) · `car.engine` `{ rpm, gear (-1 = R), gears, redline, throttle,
  shifting, limiter }` · `car.skid` 0..1 (tyre screech, skid marks) · `car.impact` 0..1 (landings, knocks: thump
  sound) · `car.grounded` (wheels on the ground) · `car.object` (the three.js object to follow or attach things to).
- Stuck or upside down: `car.reset()` (1 m up, same heading) or `car.reset([x, y, z], yaw)` to a checkpoint.
  Upside down test: `new THREE.Vector3(0, 1, 0).applyQuaternion(car.object.quaternion).y < 0.3`.
- `car.remove()` takes it out of the scene and the world.

## 6. How it drives
Presets: `"car"` (default: everyday AWD, 230 kW), `"sport"` (RWD, 420 kW, 290 km/h), `"classic"` (old RWD, 100 kW),
`"offroad"` (heavy AWD, long suspension). Any number below can be passed to `create()` or changed live with
`car.tune({ ... })`; out-of-range values are clamped. `drive`: `"awd"`, `"rwd"` or `"fwd"`.

| Number | Range | What |
|---|---|---|
| `mass` | 500–5000 kg | heavier: slower to speed up and stop |
| `power` | 20–1200 kW | engine power |
| `topSpeed` | 60–420 km/h | where the gearing tops out |
| `grip` | 0.4–3 | tyre friction; 1.3 road car, 1.6+ racing, 0.6 ice / dirt feel |
| `steer` | 10–55° | full lock at a standstill (less at speed, automatically) |
| `steerSpeed` | 0.3–3 | how fast the wheels turn to the input |
| `stiffness` | 0.5–3.5 Hz | suspension spring: low = soft and wallowy, high = race car |
| `damping` | 0.2–1.6 | suspension damping (× critical); lower = bouncier |
| `antiRoll` | 0–2 | less body roll in corners |
| `travel` | 0.08–0.6 m | suspension travel (off-road: long) |
| `engineBrake` | 0–3 | slowing when you lift off |
| `redline` | 3000–11000 rpm | engine speed range |
| `gears` | 1–9 | forward gears (automatic) |
| `shiftTime` | 0.02–1 s | per gear change |
| `assist` | 0–1 | traction control + stability help (0 = drift-happy) |
| `handbrakeGrip` | 0.1–1 | rear grip with the handbrake (low = easy handbrake turns) |

Arcade feel: `grip: 1.8, assist: 1`. Drifty: `drive: "rwd", assist: 0.3, handbrakeGrip: 0.3`. Monster truck:
`preset: "offroad", travel: 0.55, stiffness: 0.9`. Kart: `mass: 600, steer: 30, stiffness: 2.5`.

## 7. Sound (optional module)
Map `"car/sound"` too. One call gives the car its sound: a REAL recorded engine (pitch and tone follow the revs and
throttle, gear changes, rev limiter), exhaust pops, turbo blow-off, tyre squeal, bumps, crashes into walls.
```js
import { createCarSound } from "car/sound";
const sound = createCarSound(car, { engine: "f136", listener: camera });   // one per car; far cars are quieter
/* every frame, after physics.sync(): */ sound.update();
```
It starts by itself on the player's first key or tap (browsers block sound before that). Engines: `"f136"` Ferrari
V8 · `"ls"` muscle V8 · `"c454"` truck V8 · `"m52"` BMW six · `"2jz"` Toyota six · `"vtec"` Honda four · `"ej25"`
Subaru boxer · `"i5"` Audi five · `"v6"` · `"lfa"` Lexus V10 · `"f1v12"` F1 V12 · `"busa"` superbike · `"harley"`
V-twin. Leave `engine` out to pick one from the car. Each engine downloads once (~0.45 MB) when first used; the
library finds the files itself. Options (live in `sound.options`): `volume` 0..2 (1), `pops` 0..1 (0.6), `turbo` 0..1
(0 = none), `tyres`, `crashes` 0..1 (1). `sound.setEngine("ls")`, `sound.muted = true`, `sound.dispose()` with
`car.remove()`. Your own sounds instead? Read `car.engine`, `car.skid` and `car.impact`.

## 8. Several cars, races, AI
- Every car is independent: make as many as you need, from one model or several (the demo races 8).
- Cars collide with each other and with anything dynamic. Wheels drive on every body except sensors.
- An AI driver is only `car.drive()` from your own code: steer toward a point 10–40 m ahead on your track line, slow
  down before corners. Steering toward a point (tx, tz):
```js
const p = car.object.position, f = new THREE.Vector3(0, 0, 1).applyQuaternion(car.object.quaternion);
const dx = tx - p.x, dz = tz - p.z, a = Math.atan2(f.x * dz - f.z * dx, f.x * dx + f.z * dz);
car.drive({ throttle: 0.8, steer: Math.max(-1, Math.min(1, a / 0.5)) });
```
- Walls: static boxes or triangle meshes along the track edge, about 1 m high. Kerbs up to ~16 cm are climbed.

## 9. Pitfalls
- `drive()` before `physics.step()`, `cam.update()` after `physics.sync()`. Never move `car.object` yourself:
  the physics does; use `car.reset(position, yaw)` to teleport.
- Never scale or re-parent `car.object`, and never add `gltf.scene` to the scene as well (the car is a copy of it).
- `physics.step(dt)` once per fixed update with the same dt (1/60). A variable dt makes the suspension jitter.
- `CAR.create()` returns `null` if the model has no findable wheels: always handle it.
- A flat ground with its top at y = 0 means `position: [x, 0, z]`; the car settles onto its suspension by itself.
- The camera expects a `THREE.PerspectiveCamera`; it sets the camera's position, rotation and fov every update.
