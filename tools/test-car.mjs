#!/usr/bin/env node
/* THE PHYSICS GATE, headless in Node (npm test): every test model is detected, rigged and driven on a flat floor.
   Checks: 4 wheels found · settles level on its wheels · no bouncing after a drop · accelerates straight · brakes to a
   stop · turns without rolling over · no spin-out (> 15° slide) at full throttle + full lock from 100 km/h · reverses.
   Then on the course (demo/course.js): climbs 8 / 12 / 16 cm kerbs at 15 km/h without hopping · rounded bumps at
   40 km/h with the wheels (not the body) taking them · table-top at 60 · hills at 50 · kicker jump at 70, landing
   upright. Prints one line per car; exits 1 on any failure. */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Scene } from 'three';
import { loadGLB } from './load-glb.mjs';
import CAR from '../src/index.js';
import { buildCourse, COURSE } from '../demo/course.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEST = join(ROOT, 'assets/models/test');
const DT = 1 / 60;
let failed = 0;
const fail = (car, msg) => { failed++; console.log(`   FAIL ${car}: ${msg}`); };

function run(physics, car, seconds, input) {
  car.drive({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...input });
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { physics.step(DT); physics.sync(1); }
}
const up = (car) => { const q = car.body.quaternion; return 1 - 2 * (q[0] * q[0] + q[2] * q[2]); };
/* body slip angle (°): how far the car's travel is from where it points */
const slipDeg = (car) => {
  const q = car.body.quaternion, v = car.body.motionProperties.linearVelocity;
  const f = [2 * (q[0] * q[2] + q[3] * q[1]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])];
  const vf = v[0] * f[0] + v[2] * f[1], vl = v[0] * f[1] - v[2] * f[0];
  return Math.abs(vf) > 1 ? Math.abs(Math.atan2(vl, Math.abs(vf))) * 180 / Math.PI : 0;
};
const yaw = (car) => { const q = car.body.quaternion; return Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0])); };

const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(TEST).filter((f) => f.endsWith('.glb')).map((f) => join(TEST, f));
for (const file of files) {
  const name = file.split('/').pop();
  const gltf = await loadGLB(file);
  const physics = CAR.createPhysics({ floor: 2000 });
  const car = CAR.create({ scene: new Scene(), physics, model: gltf.scene, preset: process.env.PRESET });
  if (!car) { fail(name, 'no car'); continue; }
  const r = car.report;
  if (r.wheels.length !== 4) fail(name, `${r.wheels.length} wheels`);

  /* settle */
  run(physics, car, 3, {});
  const v = car.body.motionProperties.linearVelocity;
  const rest = { y: car.body.position[1], up: up(car), speed: Math.hypot(...v), grounded: car.grounded };
  if (rest.grounded !== 4) fail(name, `only ${rest.grounded} wheels on the ground at rest`);
  if (rest.up < Math.cos(2 * Math.PI / 180)) fail(name, `not level at rest (${(Math.acos(rest.up) * 180 / Math.PI).toFixed(1)}°)`);
  if (Math.abs(rest.y) > 0.05) fail(name, `rests ${rest.y.toFixed(3)} m off its modelled height`);
  if (rest.speed > 0.05) fail(name, `still moving at rest (${rest.speed.toFixed(3)} m/s)`);

  /* drop 0.3 m: the suspension must settle, not bounce (at most one crossing of the rest height) */
  car.reset([car.body.position[0], 0.3, car.body.position[2]], 0);
  let prevY = null, crossings = 0;
  for (let i = 0; i < 240; i++) {
    physics.step(DT); physics.sync(1);
    const y = car.body.position[1] - rest.y;
    if (prevY !== null && Math.sign(y) !== Math.sign(prevY) && Math.abs(y) > 0.005) crossings++;
    prevY = y;
  }
  if (crossings > 1) fail(name, `bounces after a 0.3 m drop (${crossings} crossings of the rest height)`);

  /* accelerate 0 → 100 km/h and 6 s of full throttle, straight */
  const start = [...car.body.position];
  let t100 = null;
  car.drive({ throttle: 1 });
  for (let i = 0; i < 360; i++) { physics.step(DT); physics.sync(1); if (t100 === null && car.speed >= 100) t100 = (i + 1) * DT; }
  const vmax6 = car.speed;
  const side = Math.abs(car.body.position[0] - start[0]);
  if (vmax6 < 60) fail(name, `only ${vmax6.toFixed(0)} km/h after 6 s`);
  if (side > 0.5) fail(name, `drifted ${side.toFixed(2)} m sideways going straight`);

  /* brake to a stop */
  const b0 = [...car.body.position];
  let tStop = null;
  car.drive({ throttle: 0, brake: 1 });
  for (let i = 0; i < 600 && tStop === null; i++) { physics.step(DT); physics.sync(1); if (car.speed < 1) tStop = (i + 1) * DT; }
  const dStop = Math.hypot(car.body.position[0] - b0[0], car.body.position[2] - b0[2]);
  if (tStop === null) fail(name, 'did not stop within 10 s of braking');
  run(physics, car, 1, {});

  /* turn: half throttle, full lock, 6 s */
  const y0 = yaw(car);
  let minUp = 1, turned = 0, last = y0;
  car.drive({ throttle: 0.6, steer: -1 });
  for (let i = 0; i < 360; i++) {
    physics.step(DT); physics.sync(1);
    minUp = Math.min(minUp, up(car));
    let d = yaw(car) - last; d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; turned += d; last = yaw(car);
  }
  const turnSpeed = car.speed;
  if (minUp < 0.8) fail(name, `rolled ${(Math.acos(minUp) * 180 / Math.PI).toFixed(0)}° in the turn`);
  if (turned < 1.5) fail(name, `turned only ${(turned * 180 / Math.PI).toFixed(0)}° left in 6 s (steer -1 = left)`);

  /* spin-out: 100 km/h, then full throttle + full lock for 3 s; a controlled power slide is fine (GTA), a spin is
     not: the body must stay within 15° of its travel */
  run(physics, car, 5, { brake: 1 });
  car.reset([car.body.position[0], 0.1, car.body.position[2]], 0);
  car.drive({ throttle: 1, brake: 0, steer: 0 });
  for (let i = 0; i < 900 && car.speed < 100; i++) { physics.step(DT); physics.sync(1); }
  if (car.speed < 95) fail(name, `spin-out test: only reached ${car.speed.toFixed(0)} km/h`);
  let maxSlip = 0;
  car.drive({ throttle: 1, steer: 1 });
  for (let i = 0; i < 180; i++) { physics.step(DT); physics.sync(1); maxSlip = Math.max(maxSlip, slipDeg(car)); }
  if (maxSlip > 15) fail(name, `spins out: ${maxSlip.toFixed(0)}° body slip at full throttle + full lock`);

  /* stop, then reverse */
  run(physics, car, 4, { brake: 1 });
  run(physics, car, 0.5, {});
  run(physics, car, 3, { brake: 1 });
  const rev = car.speed;
  if (rev > -5) fail(name, `reversing: only ${rev.toFixed(1)} km/h`);

  /* ---------------- the course */
  const cw = CAR.createPhysics({ floor: 2000 });
  buildCourse(null, cw);
  const cc = CAR.create({ scene: new Scene(), physics: cw, model: gltf.scene, preset: process.env.PRESET });
  const lane = (x, kmh, untilZ, seconds) => {
    cc.reset([x, 0.05, -6], 0);
    for (let i = 0; i < 30; i++) { cw.step(DT); cw.sync(1); }
    const m = { air: 0, maxAir: 0, pitch: 0, roll: 0, minUp: 1, travel: [Infinity, -Infinity], z: 0 };
    let air = 0;
    for (let i = 0; i < seconds / DT && cc.body.position[2] < untilZ; i++) {
      cc.drive({ throttle: cc.speed < kmh - 2 ? 1 : cc.speed < kmh ? 0.3 : 0, brake: cc.speed > kmh + 6 ? 0.3 : 0, steer: Math.max(-1, Math.min(1, (cc.body.position[0] - x) * 0.25)) });
      cw.step(DT); cw.sync(1);
      const q = cc.body.quaternion;
      m.minUp = Math.min(m.minUp, up(cc));
      m.pitch = Math.max(m.pitch, Math.abs(Math.asin(Math.max(-1, Math.min(1, 2 * (q[1] * q[2] - q[3] * q[0])))) * 180 / Math.PI));
      air = cc.grounded === 0 ? air + 1 : 0;
      m.maxAir = Math.max(m.maxAir, air);
      for (const w of cc.wheels) { m.travel[0] = Math.min(m.travel[0], w.sDraw); m.travel[1] = Math.max(m.travel[1], w.sDraw); }
    }
    m.z = cc.body.position[2];
    return m;
  };
  const K = COURSE.kerbs, kerbEnd = K.z + (K.heights.length - 1) * 10 + 3;
  const kerb = lane(K.x, 15, kerbEnd + 4, 20);
  if (kerb.z < kerbEnd + 3) fail(name, `stuck at the kerbs (z ${kerb.z.toFixed(1)}, needs ${kerbEnd + 3})`);
  if (kerb.maxAir > 2) fail(name, `hops over the kerbs (${kerb.maxAir} steps with no wheel down)`);
  const bumps = lane(COURSE.bumps.x, 40, COURSE.bumps.z + 45, 20);
  const wheelTravel = bumps.travel[1] - bumps.travel[0];
  if (bumps.maxAir > 3) fail(name, `jumps on the speed bumps (${bumps.maxAir} steps airborne)`);
  if (bumps.pitch > 6) fail(name, `pitches ${bumps.pitch.toFixed(1)}° over 10 cm bumps at 40 km/h`);
  if (wheelTravel < 0.04) fail(name, `the wheels hardly move over the bumps (${(wheelTravel * 100).toFixed(1)} cm): no visible suspension`);
  const table = lane(COURSE.tableTop.x, 60, COURSE.tableTop.z + 40, 20);
  if (table.minUp < 0.85 || up(cc) < 0.97) fail(name, 'table-top at 60 km/h: not upright');
  const hills = lane(COURSE.hills.x, 50, COURSE.hills.z + 62, 20);
  if (hills.minUp < 0.85 || up(cc) < 0.95) fail(name, 'hills at 50 km/h: not upright');
  const jump = lane(COURSE.kicker.x, 70, COURSE.kicker.z + 45, 20);
  for (let i = 0; i < 90; i++) { cc.drive({ throttle: 0, brake: 0.5, steer: 0 }); cw.step(DT); cw.sync(1); }
  if (up(cc) < 0.97 || cc.grounded < 4) fail(name, `kicker jump at 70 km/h: did not land on its wheels (up ${up(cc).toFixed(2)})`);

  console.log(`${name.padEnd(20)} kerbs ok (air ${kerb.maxAir}) · bumps: pitch ${bumps.pitch.toFixed(1)}°, wheel travel ${(wheelTravel * 100).toFixed(0)} cm, air ${bumps.maxAir} · table-top min up ${table.minUp.toFixed(2)} · hills ${hills.minUp.toFixed(2)} · jump air ${jump.maxAir} steps`);
  console.log(`${name.padEnd(20)} rest ${rest.y.toFixed(3)} m · 0-100 ${t100 ? t100.toFixed(1) + ' s' : '—'} · 6 s ${vmax6.toFixed(0)} km/h · stop ${dStop.toFixed(0)} m / ${tStop ? tStop.toFixed(1) : '—'} s · turn ${(turned * 180 / Math.PI).toFixed(0)}° at ${turnSpeed.toFixed(0)} km/h, min up ${minUp.toFixed(2)} · slip ${maxSlip.toFixed(1)}° · bounce ${crossings} · reverse ${rev.toFixed(0)} km/h`);
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
