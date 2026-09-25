/* THE PUBLIC API. Any car model (GLB) → a car that drives.

     import CAR from 'car';
     const physics = CAR.createPhysics({ floor: 400 });            // or the game's own crashcat world
     const gltf = await new GLTFLoader().loadAsync('my-car.glb');
     const car = CAR.create({ scene, physics, model: gltf.scene });
     car.drive({ throttle: 1, steer: -0.3 });                     // every frame, from keys / touch / AI
     physics.step(1 / 60); physics.sync(1);                        // the game's loop (cars run inside these)

   The wheels are found from the model's shape (src/detect.js), split out and given pivots (src/rig.js), and a
   raycast vehicle drives the body (src/vehicle.js). The model passed in is not changed. */
import { detectWheels } from './detect.js';
import { buildRig } from './rig.js';
import { createVehicle, PRESETS, TUNING } from './vehicle.js';
import { createPhysics } from './physics.js';
import { createChaseCamera } from './camera.js';
import { createDefaultCar } from './default-car.js';
import { updateWorld } from 'crashcat';

const VERSION = '0.9.2';
const HOOK = Symbol.for('car.hook');
const warned = new Set();
function warnOnce(msg) { if (!warned.has(msg)) { warned.add(msg); console.warn(`[car] ${msg}`); } }

/**
 * Make a drivable car from a model.
 * @param {object} o
 * @param {import('three').Object3D} o.scene where the car is drawn
 * @param {object} o.physics { world, layers, step, sync } (CAR.createPhysics() makes one)
 * @param {import('three').Object3D} [o.model] the loaded car (gltf.scene, or the gltf); it is not changed. Without it:
 *   the built-in low-poly car (o.color paints it)
 * @param {'car'|'sport'|'classic'|'offroad'} [o.preset] how it drives (default 'car')
 * @param {number[]} [o.position] [x, y, z] where it stands (y = ground under it)
 * @param {number} [o.yaw] which way it faces (radians, 0 = +Z)
 * @param {string} [o.forward] '+z' | '-z' | '+x' | '-x': the model's front, if the guess is wrong
 * @param {number} [o.length] the car's real length in metres, if the model's units are odd
 * @param {number} [o.substeps] physics steps per physics.step() call while cars exist (default 2 = 120 Hz at 1/60:
 *   smoother suspension and tyres; 1 to turn off)
 * Any number in CAR.tuning (grip, steer, power, …) can be passed too.
 */
function create(o = {}) {
  const { scene, physics } = o;
  if (!physics || !physics.world || !physics.layers) { warnOnce('create() needs physics: CAR.createPhysics() makes one'); return null; }
  /* a loaded gltf works as well as its scene; no model at all: the built-in car */
  let model = o.model && !o.model.isObject3D && o.model.scene?.isObject3D ? o.model.scene : o.model;
  let forward = o.forward, length = o.length;
  if (model == null) { model = createDefaultCar({ color: o.color }); forward = '+z'; length = undefined; }
  if (!model.isObject3D) { warnOnce('create() needs model: a three.js object (gltf.scene), or no model for the built-in car'); return null; }
  if (o.preset !== undefined && !PRESETS[o.preset]) warnOnce(`unknown preset "${o.preset}"; using "car" (${Object.keys(PRESETS).join(', ')})`);

  const report = detectWheels(model, { forward, length });
  if (!report.ok) { warnOnce(`no wheels found: ${report.reason}`); return null; }
  for (const n of report.notes) warnOnce(n);
  const rig = buildRig(model, report);
  const vehicle = createVehicle(physics, rig, o);
  if (scene) scene.add(rig.object);

  const body = vehicle.body;
  const prev = { p: Array.from(body.position), q: Array.from(body.quaternion) };
  const car = {
    /** the three.js object that is drawn (moved by the physics) */
    object: rig.object,
    /** the crashcat body */
    body,
    /** { throttle 0..1, brake 0..1, steer -1 (left)..1 (right), handbrake } — set with drive() */
    input: vehicle.input,
    /** set the controls; missing fields keep their value */
    drive(i = {}) {
      for (const k of ['throttle', 'brake', 'steer']) if (Number.isFinite(i[k])) vehicle.input[k] = i[k];
      if (i.handbrake !== undefined) vehicle.input.handbrake = !!i.handbrake;
      return car;
    },
    /** forward speed in km/h (negative when reversing) */
    get speed() { return vehicle.state.speed * 3.6; },
    /** how many wheels touch the ground */
    get grounded() { return vehicle.state.grounded; },
    /** { rpm, gear (-1 = reverse), gears, redline, throttle, shifting, limiter } for a HUD or engine sound */
    get engine() { return vehicle.engine; },
    /** 0..1: how hard the suspension was just hit (landings, kerbs); fades out. For camera shake / thump sounds */
    get impact() { return vehicle.state.impact; },
    /** 0..1: how much the tyres are sliding or spinning (the most of any wheel). For tyre screech */
    get skid() { return Math.max(0, ...vehicle.wheels.map((w) => (w.grounded ? w.skid : 0))); },
    /** change handling numbers live, e.g. car.tune({ grip: 1.6, steer: 30 }); returns the params in use */
    tune(p) { const r = vehicle.tune(p); Object.assign(car.params, r); return r; },
    /** put the car back on its wheels (here, or at [x, y, z] facing yaw) */
    reset(position, yaw) { vehicle.reset(position, yaw); prev.p = Array.from(body.position); prev.q = Array.from(body.quaternion); return car; },
    /** take the car out of the scene and the world */
    remove() { hooks(physics).delete(car); vehicle.remove(); rig.object.removeFromParent(); },
    /** what was found in the model: wheels, size, which way it faced, notes */
    report: summary(report, rig),
    /** the physics numbers in use (preset + overrides) */
    params: vehicle.params,
    /** the wheels (for debug views): contact, load, slip, steer, grounded */
    wheels: vehicle.wheels,
    /** internal: runs inside physics.step / physics.sync */
    substeps: Math.max(1, Math.min(8, Math.round(Number(o.substeps) || 2))),
    _begin() { prev.p = Array.from(body.position); prev.q = Array.from(body.quaternion); },
    _before(dt) { vehicle.step(dt); vehicle.settleDraw(dt); },
    _draw(alpha) {
      const t = Math.min(1, Math.max(0, alpha)), p = body.position, q = body.quaternion, a = prev.q;
      rig.object.position.set(prev.p[0] + (p[0] - prev.p[0]) * t, prev.p[1] + (p[1] - prev.p[1]) * t, prev.p[2] + (p[2] - prev.p[2]) * t);
      const sg = a[0] * q[0] + a[1] * q[1] + a[2] * q[2] + a[3] * q[3] < 0 ? -1 : 1;
      rig.object.quaternion.set(a[0] + (sg * q[0] - a[0]) * t, a[1] + (sg * q[1] - a[1]) * t, a[2] + (sg * q[2] - a[2]) * t, a[3] + (sg * q[3] - a[3]) * t).normalize();
      rig.wheels.forEach((w, i) => {
        const v = vehicle.wheels[i];
        w.mount.position.y = vehicle.wheelY(v);
        w.steer.rotation.y = v.steer;
        w.spin.rotation.x = v.spin % (Math.PI * 2);
      });
    },
  };
  hooks(physics).add(car);
  car._draw(1);
  return car;
}

/* cars run inside the game's physics.step / physics.sync: wrapped once per physics object. While cars exist, one
   physics.step(dt) runs `substeps` world steps of dt / substeps (the car forces are worked out before each).
   Only the first of them goes through the game's own step: a game's step often notes where its linked objects are
   before stepping (to draw between frames), and that must happen once per frame, not before every substep. The rest
   step the crashcat world directly, with the game's contact listener. */
function hooks(physics) {
  if (physics[HOOK]) return physics[HOOK];
  const cars = new Set();
  const step = physics.step.bind(physics), sync = typeof physics.sync === 'function' ? physics.sync.bind(physics) : null;
  physics.step = (dt, ...rest) => {
    if (!cars.size || !(dt > 0)) return step(dt, ...rest);
    let k = 1;
    for (const c of cars) { c._begin(); k = Math.max(k, c.substeps); }
    for (const c of cars) c._before(dt / k);
    const r = step(dt / k, ...rest);
    for (let i = 1; i < k; i++) { for (const c of cars) c._before(dt / k); updateWorld(physics.world, physics.listener, dt / k); }
    return r;
  };
  physics.sync = (alpha = 1, ...rest) => { const r = sync ? sync(alpha, ...rest) : undefined; for (const c of cars) c._draw(alpha); return r; };
  Object.defineProperty(physics, HOOK, { value: cars });
  return cars;
}

function summary(r, rig) {
  const s = r.unitScale;
  return {
    wheels: rig.wheels.map((w) => ({ axle: w.axle, left: w.left, radius: +w.radius.toFixed(3), width: +w.width.toFixed(3), position: w.rest.toArray().map((v) => +v.toFixed(3)) })),
    size: { length: +(r.size.length * s).toFixed(2), width: +(r.size.width * s).toFixed(2), height: +(r.size.height * s).toFixed(2) },
    wheelbase: +rig.wheelbase.toFixed(2),
    track: +rig.track.toFixed(2),
    forward: r.forward,
    frontConfidence: r.frontConfidence,
    unitScale: s,
    notes: r.notes,
  };
}

/** What the detector finds in a model, without building a car: { ok, reason, wheels, forward, unitScale, notes } */
function inspect(model, o = {}) {
  const r = detectWheels(model, o);
  const { owner, ...rest } = r;
  return rest;
}

/** A GTA-style chase camera for a car: const cam = CAR.createCamera(camera, car); every frame cam.update(dt).
    cam.orbit(dx, dy) turns it around the car (mouse drag, in pixels), cam.zoom(f) moves it in / out. */
function createCamera(camera, car, o) { return createChaseCamera(camera, car, o); }

const CAR = Object.freeze({ version: VERSION, create, createPhysics, createCamera, inspect, presets: Object.keys(PRESETS), tuning: TUNING });
export default CAR;
export { create, createPhysics, createCamera, inspect, PRESETS, TUNING };
