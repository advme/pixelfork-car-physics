#!/usr/bin/env node
/* A whole race, headless: 8 AI cars (the three race cars) on the City Circuit.
     node tools/test-race.mjs [laps=2]
   Prints lap times, resets, overtakes and the finishing order; exits 1 if a car doesn't finish, needed many resets,
   or the AI never overtakes. */
import { Scene } from 'three';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGLB } from './load-glb.mjs';
import CAR from '../src/index.js';
import { buildTrack } from '../demo/track.js';
import { RACE_CARS, RIVALS } from '../demo/race-cars.js';
import { createTracker, createDriver, standings, slipstream } from '../demo/race-ai.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LAPS = Number(process.argv[2]) || 2;
const DT = 1 / 60;
const physics = CAR.createPhysics({ floor: 5000 });
const track = buildTrack(null, physics);
const models = {};
for (const c of RACE_CARS) models[c.id] = (await loadGLB(join(ROOT, c.file))).scene;

const field = [];
for (let k = 0; k < 8; k++) {
  const spec = RACE_CARS[k % 3], slot = track.grid(k);
  const car = CAR.create({ scene: new Scene(), physics, model: models[spec.id], preset: spec.preset, ...spec.tune, position: slot.position, yaw: slot.yaw });
  const tracker = createTracker(track, car);
  const entry = { name: k < 7 ? RIVALS[k].name : 'AI 8', spec, car, tracker };
  entry.driver = createDriver(car, track, tracker, 0.9 + 0.08 * ((k * 37) % 7) / 6);
  field.push(entry);
}
const t0 = performance.now();
let time = 0, maxSpeed = 0, overtakes = 0, lastOrder = null;
for (let step = 0; step < 60 * (LAPS * 160 + 60); step++) {
  const go = time > 1;
  for (const e of field) {
    if (e.tracker.finished === null) e.driver.update(DT, field, go);
    else e.car.drive({ throttle: 0, brake: e.car.speed > 3 ? 1 : 0, steer: 0 });
  }
  slipstream(field, track, physics.world);
  physics.step(DT);
  physics.sync(1);
  time += DT;
  /* overtakes: changes in the running order, sampled every second */
  if (step % 60 === 0 && go) {
    const order = standings(field.map((e) => e.tracker)).map((t) => t.car);
    if (lastOrder) order.forEach((c, k) => { if (lastOrder.indexOf(c) > k) overtakes++; });
    lastOrder = order;
  }
  for (const e of field) {
    e.tracker.update(time);
    if (e.tracker.lap > LAPS && e.tracker.finished === null) e.tracker.finished = time;
    maxSpeed = Math.max(maxSpeed, e.car.speed);
  }
  if (field.every((e) => e.tracker.finished !== null)) break;
}
const ms = performance.now() - t0;
let bad = 0;
console.log(`race: ${LAPS} laps of ${track.length.toFixed(0)} m, ${time.toFixed(1)} s simulated in ${(ms / 1000).toFixed(1)} s, top speed ${maxSpeed.toFixed(0)} km/h`);
standings(field.map((e) => e.tracker)).forEach((t, pos) => {
  const e = field.find((f) => f.tracker === t);
  const fin = t.finished === null ? `DNF (lap ${t.lap}, ${t.s.toFixed(0)} m)` : `${t.finished.toFixed(2)} s`;
  if (t.finished === null) bad++;
  if (e.driver.resets > 2) bad++;
  console.log(`P${pos + 1} ${e.name.padEnd(10)} ${e.spec.name.padEnd(10)} skill ${e.driver.skill.toFixed(2)}  ${fin.padEnd(22)} best lap ${t.bestLap ? t.bestLap.toFixed(2) : '—'}  resets ${e.driver.resets}`);
});
console.log(`overtakes: ${overtakes}`);
if (overtakes < 3) { bad++; console.log('too few overtakes: the AI only follows'); }
console.log(bad ? `\n${bad} problem(s)` : '\nall cars finished cleanly');
process.exit(bad ? 1 : 0);
