#!/usr/bin/env node
/* THE HOST GATE (part of npm test): the library inside a game that brings its own crashcat world object.
   The game's physics here is written the way game engines usually write it: step(dt) notes where its linked objects
   are, then does exactly one world step; sync(alpha) draws them between the last two steps. Checks:
   - the game's step runs once per frame while cars substep (else its linked objects stutter)
   - a linked object draws from where it was at the start of the frame
   - the game's contact listener still hears every substep
   - a car drives the same in the game's world as in CAR.createPhysics()
   - the built-in car (no model) works, and a gltf passed as model works like its scene */
import { Scene, Object3D } from 'three';
import { addBroadphaseLayer, addObjectLayer, createWorld, createWorldSettings, enableCollision, registerAll, rigidBody, updateWorld, box, sphere, MotionType } from 'crashcat';
import CAR from '../src/index.js';
import { loadGLB } from './load-glb.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DT = 1 / 60;
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log(`   FAIL ${msg}`); } };

function gamePhysics() {
  registerAll();
  const settings = createWorldSettings();
  const moving = addObjectLayer(settings, addBroadphaseLayer(settings));
  const still = addObjectLayer(settings, addBroadphaseLayer(settings));
  enableCollision(settings, moving, still);
  enableCollision(settings, moving, moving);
  const world = createWorld(settings);
  world.settings.gravity = [0, -9.81, 0];
  rigidBody.create(world, { shape: box.create({ halfExtents: [200, 0.5, 200] }), motionType: MotionType.STATIC, objectLayer: still, position: [0, -0.5, 0], friction: 0.9 });
  const links = new Map();
  const api = {
    world, layers: { moving, static: still }, listener: undefined, steps: 0,
    step(dt) {
      api.steps++;
      for (const l of links.values()) { l.p = Array.from(l.body.position); }
      updateWorld(world, api.listener, dt);
    },
    link(object, body) { links.set(object, { body, p: Array.from(body.position) }); },
    sync(alpha) { for (const [o, l] of links) o.position.set(...l.p.map((v, i) => v + (l.body.position[i] - v) * alpha)); },
    links,
  };
  return api;
}

/* 1. the game's step once per frame, links drawn from the frame start, listener hears substeps */
{
  const physics = gamePhysics();
  const car = CAR.create({ scene: new Scene(), physics });
  check(car && car.substeps === 2, 'built-in car made, 2 substeps');
  const ball = rigidBody.create(physics.world, { shape: sphere.create({ radius: 0.3 }), motionType: MotionType.DYNAMIC, objectLayer: physics.layers.moving, position: [5, 10, 0] });
  const mesh = new Object3D();
  physics.link(mesh, ball);
  let heard = 0;
  physics.listener = { onContactAdded() { heard++; }, onContactPersisted() { heard++; } };
  let worstStart = 0;
  for (let i = 0; i < 150; i++) {
    const before = ball.position[1];
    physics.steps = 0;
    physics.step(DT);
    if (physics.steps !== 1) { check(false, `the game's step ran ${physics.steps} times in one frame`); break; }
    physics.sync(0);
    worstStart = Math.max(worstStart, Math.abs(mesh.position.y - before));
  }
  check(worstStart < 1e-9, `a linked object draws from the frame start (off by ${worstStart.toExponential(1)} m)`);
  check(heard > 30, `the game's contact listener heard the substeps (${heard} callbacks)`);
  console.log(`game world: one game step per frame · linked objects from the frame start · listener ${heard} callbacks`);
}

/* 2. same driving in the game's world and in CAR.createPhysics() */
{
  const drive = (physics) => {
    const car = CAR.create({ scene: new Scene(), physics });
    for (let i = 0; i < 120; i++) { physics.step(DT); physics.sync(1); }
    car.drive({ throttle: 1, steer: 0.3 });
    for (let i = 0; i < 300; i++) { physics.step(DT); physics.sync(1); }
    return { speed: car.speed, x: car.body.position[0], z: car.body.position[2], grounded: car.grounded };
  };
  const a = drive(gamePhysics()), b = drive(CAR.createPhysics({ floor: 400 }));
  const d = Math.hypot(a.x - b.x, a.z - b.z);
  check(d < 0.05 && Math.abs(a.speed - b.speed) < 0.5, `drives differently in a game's world (${d.toFixed(3)} m apart)`);
  check(a.grounded === 4, 'built-in car on its wheels');
  console.log(`built-in car: ${a.speed.toFixed(0)} km/h after 5 s turning · same path in both worlds (${(d * 1000).toFixed(1)} mm apart)`);
}

/* 3. a gltf passed as the model */
{
  const gltf = await loadGLB(join(ROOT, 'assets/models/test/cyberpunk_car.glb'));
  const physics = CAR.createPhysics({ floor: 100 });
  const car = CAR.create({ physics, model: gltf });
  check(car && car.report.wheels.length === 4, 'a gltf (not its scene) as model');
  console.log(`gltf as model: ${car ? car.report.wheels.length : 0} wheels`);
}

console.log(failed ? `\n${failed} FAILED` : '\nhost checks passed');
process.exit(failed ? 1 : 0);
