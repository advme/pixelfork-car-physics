#!/usr/bin/env node
/* THE EFFECTS GATE (part of npm test): car/effects headless, with the built-in car on a flat floor. Checks:
   - gentle driving and cruising leave no marks and no smoke; wheelspin at speed (traction control) neither
   - a handbrake turn and a donut leave marks and smoke; the marks lie on the ground, under the wheels
   - nothing new while the physics is paused, or after car.remove() (the old smoke fades away)
   - a teleport (car.reset) mid-slide starts a new mark instead of drawing one across
   - the ring keeps options.marks pieces; options change live; an array of cars is read every update
   - clear() / dispose() / bad input never throw; the time it takes per frame for 8 cars */
import { Scene } from 'three';
import CAR from '../src/index.js';
import { createCarEffects } from '../src/effects.js';

const DT = 1 / 60;
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed++; console.log(`   FAIL ${msg}`); } };

function world(n = 1, o = {}) {
  const scene = new Scene();
  const physics = CAR.createPhysics({ floor: 1000 });
  const cars = Array.from({ length: n }, (_, k) => CAR.create({ scene, physics, position: [k * 12, 0, 0], ...o }));
  return { scene, physics, cars, car: cars[0] };
}
/* drive for some seconds: step, draw, effects (like a game's frame) */
function run(w, fx, seconds, input, { step = true, alpha = 1, each } = {}) {
  for (const c of w.cars) c.drive({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...input });
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    if (step) w.physics.step(DT);
    w.physics.sync(alpha);
    fx.update(DT);
    if (each) each(i);
  }
}
const upTo = (w, fx, kmh) => { for (let i = 0; i < 900 && w.car.speed < kmh; i++) run(w, fx, DT, { throttle: 1 }); };
/* every mark piece: its four corners and its length */
function pieces(fx) {
  const mesh = fx.object.getObjectByName('skid-marks'), out = [];
  if (!mesh) return out;
  const p = mesh.geometry.attributes.position.array;
  for (let i = 0; i < fx.stats.marks; i++) {
    const o = i * 12, c = (k) => [p[o + k * 3], p[o + k * 3 + 1], p[o + k * 3 + 2]];
    const a = [(p[o] + p[o + 3]) / 2, (p[o + 1] + p[o + 4]) / 2, (p[o + 2] + p[o + 5]) / 2];
    const b = [(p[o + 6] + p[o + 9]) / 2, (p[o + 7] + p[o + 10]) / 2, (p[o + 8] + p[o + 11]) / 2];
    out.push({ corners: [c(0), c(1), c(2), c(3)], length: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), end: b });
  }
  return out;
}

/* 1. gentle driving: nothing; a handbrake turn: marks + smoke, on the ground under the wheels */
{
  const w = world();
  const fx = createCarEffects(w.scene, w.car, { marks: 3000, smoke: 1 });
  check(fx.object.parent === w.scene && fx.object.children.length === 2, 'the effects are in the scene (marks + smoke)');
  run(w, fx, 1, {});
  run(w, fx, 5, { throttle: 0.3 });
  run(w, fx, 3, { throttle: 0.5 });
  check(fx.stats.marks === 0 && fx.stats.smoke === 0, `gentle driving left ${fx.stats.marks} marks, ${fx.stats.smoke} puffs`);
  upTo(w, fx, 60);
  let smoke = 0;
  run(w, fx, 1.5, { steer: 1, handbrake: true }, { each: () => { smoke = Math.max(smoke, fx.stats.smoke); } });
  const marks = pieces(fx);
  check(marks.length > 20, `handbrake turn: only ${marks.length} mark pieces`);
  check(smoke > 20, `handbrake turn: only ${smoke} smoke puffs`);
  const heights = marks.flatMap((m) => m.corners.map((c) => c[1]));
  check(Math.min(...heights) > 0 && Math.max(...heights) < 0.05, `marks off the ground (y ${Math.min(...heights).toFixed(3)}..${Math.max(...heights).toFixed(3)} m)`);
  const last = marks[marks.length - 1].end;
  const near = Math.min(...w.car.wheels.map((wh) => Math.hypot(wh.contact[0] - last[0], wh.contact[2] - last[2])));
  check(near < 1, `the newest mark is ${near.toFixed(2)} m from the nearest wheel`);
  console.log(`handbrake turn: ${marks.length} mark pieces (y ${Math.min(...heights).toFixed(3)}..${Math.max(...heights).toFixed(3)} m, newest ${near.toFixed(2)} m from a wheel), ${smoke} puffs at most · gentle driving: none`);
  fx.dispose();
}

/* 2. wheelspin at speed (an 800 kW car's traction control lets the tyres slip up to ~130 km/h): no marks, no smoke */
{
  const w = world(1, { preset: 'sport', power: 800 });
  const fx = createCarEffects(w.scene, w.car, { marks: 3000, smoke: 1 });
  run(w, fx, 1, {});
  upTo(w, fx, 90);
  fx.clear();
  let spin = 0;
  run(w, fx, 3, { throttle: 1 }, { each: () => { spin = Math.max(spin, ...w.car.wheels.map((wh) => wh.spinSlip || 0)); } });
  check(fx.stats.marks === 0 && fx.stats.smoke === 0, `full throttle from 90 km/h: ${fx.stats.marks} marks, ${fx.stats.smoke} puffs`);
  check(spin > 0.9, `the test needs wheelspin at speed (got ${spin.toFixed(2)})`);
  console.log(`full throttle from 90 km/h (800 kW, wheelspin up to ${spin.toFixed(2)}): ${fx.stats.marks} marks, ${fx.stats.smoke} puffs`);
  fx.dispose();
}

/* 3. donut; then paused physics; then car.remove(): nothing new, the smoke fades away */
{
  const w = world();
  const fx = createCarEffects(w.scene, [w.car], { marks: 3000, smoke: 1 });
  run(w, fx, 1, {});
  let smoke = 0;
  run(w, fx, 5, { throttle: 1, steer: 1, handbrake: true }, { each: () => { smoke = Math.max(smoke, fx.stats.smoke); } });
  const m0 = fx.stats.marks;
  check(m0 > 40 && smoke > 60, `donut: ${m0} mark pieces, ${smoke} puffs at most`);
  run(w, fx, 3, { throttle: 1, steer: 1, handbrake: true }, { step: false });
  check(fx.stats.marks === m0 && fx.stats.smoke === 0, `paused mid-donut: marks ${m0} → ${fx.stats.marks}, ${fx.stats.smoke} puffs after 3 s`);
  run(w, fx, 1, { throttle: 1, steer: 1, handbrake: true });
  const m1 = fx.stats.marks;
  check(m1 > m0 && fx.stats.smoke > 0, 'the donut carries on after the pause');
  w.car.remove();
  run(w, fx, 3, {});
  check(fx.stats.marks === m1 && fx.stats.smoke === 0, `after car.remove(): marks ${m1} → ${fx.stats.marks}, ${fx.stats.smoke} puffs after 3 s`);
  console.log(`donut: ${m0} mark pieces in 5 s, ${smoke} puffs at most · paused / removed: nothing new, smoke gone in 3 s`);
  fx.dispose();
}

/* 4. a teleport mid-slide: no mark across it */
{
  const w = world();
  const fx = createCarEffects(w.scene, w.car, { marks: 3000, smoke: 1 });
  run(w, fx, 1, {});
  upTo(w, fx, 60);
  run(w, fx, 0.6, { steer: 1, handbrake: true });
  w.car.reset([80, 0, 80], 1);
  run(w, fx, 0.5, {});
  upTo(w, fx, 60);
  run(w, fx, 0.6, { steer: -1, handbrake: true });
  const longest = Math.max(...pieces(fx).map((m) => m.length));
  check(longest < 1.2, `a mark piece ${longest.toFixed(1)} m long (across the teleport?)`);
  console.log(`teleport mid-slide: longest mark piece ${longest.toFixed(2)} m`);
  fx.dispose();
}

/* 5. the ring, live options, an array read every update, clear / dispose / bad input */
{
  const w = world();
  const list = [];
  const fx = createCarEffects(w.scene, list, { marks: 40, smoke: 1 });
  run(w, fx, 1, {});
  list.push(w.car);
  run(w, fx, 5, { throttle: 1, steer: 1, handbrake: true });
  check(fx.stats.marks === 40, `ring of 40: holds ${fx.stats.marks}`);
  fx.options.marks = 100;
  run(w, fx, 5, { throttle: 1, steer: 1, handbrake: true });
  check(fx.stats.marks > 40 && fx.stats.marks <= 100, `options.marks = 100 live: holds ${fx.stats.marks}`);
  fx.options.smoke = 0;
  run(w, fx, 3, { throttle: 1, steer: 1, handbrake: true });
  check(fx.stats.smoke === 0, `options.smoke = 0 live: ${fx.stats.smoke} puffs`);
  fx.clear();
  check(fx.stats.marks === 0 && fx.stats.smoke === 0, 'clear() wipes everything');
  fx.dispose();
  check(fx.object.parent === null, 'dispose() takes it out of the scene');
  let threw = null;
  try {
    fx.update(DT); fx.clear(); fx.dispose();
    const warn = console.warn; console.warn = () => {};
    const bad = [createCarEffects(null, w.car), createCarEffects(w.scene, [null, {}, 5]), createCarEffects(w.scene, undefined, null)];
    for (const b of bad) { b.update(); b.update(NaN); b.update(-1); b.setCars(null); b.update(DT); b.dispose(); }
    console.warn = warn;
  } catch (e) { threw = e; }
  check(!threw, `threw: ${threw && threw.message}`);
  console.log('ring of 40 → 100 live · smoke 0 live · array read every update · clear / dispose / bad input: no throw');
}

/* 6. time per frame: 8 cars doing donuts (JS only; the GPU draws two meshes whatever the number of cars) */
{
  const w = world(8);
  const fx = createCarEffects(w.scene, w.cars, { marks: 3000, smoke: 1 });
  run(w, fx, 1, {});
  run(w, fx, 2, { throttle: 1, steer: 1, handbrake: true });
  let spent = 0, frames = 0;
  for (const c of w.cars) c.drive({ throttle: 1, steer: 1, handbrake: true });
  for (let i = 0; i < 240; i++) {
    w.physics.step(DT); w.physics.sync(1);
    const t0 = performance.now(); fx.update(DT); spent += performance.now() - t0; frames++;
  }
  const ms = spent / frames;
  check(ms < 1, `update() takes ${ms.toFixed(2)} ms per frame for 8 cars`);
  console.log(`8 cars in donuts: update() ${ms.toFixed(3)} ms per frame · ${fx.stats.marks} mark pieces, ${fx.stats.smoke} puffs`);
  fx.dispose();
}

console.log(failed ? `\n${failed} FAILED` : '\neffects checks passed');
process.exit(failed ? 1 : 0);
