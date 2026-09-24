/* Race logic for the City Circuit: lap / position tracking for every car, and AI drivers. No three.js, no DOM:
   the Node race test runs the same code.

   AI driver, per step:
   - where am I: nearest racing-line sample (searched around the last one)
   - how fast may I go: a speed profile along the racing line, made once per car from its grip, top speed and
     braking (corner speed √(a·r), then a backward pass so it brakes in time), times the driver's skill
   - where do I steer: pure pursuit to a point on the racing line (plus an overtaking offset) a speed-dependent
     distance ahead, converted to the car's steering input
   - traffic: a car close ahead on my line → move over to the side with room and pass; no room → follow it
   - trouble: stuck, flipped or facing the wrong way for a while → put back on the track */

import { rigidBody } from 'crashcat';

const G = 9.81;

/**
 * Slipstream: a car close behind another at speed gets pulled along (less drag): up to ~1.6 m/s² when right behind,
 * nothing past 40 m. Call before each physics step for every car (player too). field: [{ car, tracker }]
 */
export function slipstream(field, track, world) {
  for (const me of field) {
    const v = me.car.speed / 3.6;
    if (v < 20) { me.draft = 0; continue; }
    let best = 0;
    for (const o of field) {
      if (o === me) continue;
      const gap = (o.tracker.s - me.tracker.s + track.length) % track.length;
      if (gap < 4 || gap > 40) continue;
      if (Math.abs((o.tracker.lateral ?? 0) - (me.tracker.lateral ?? 0)) > 2.2) continue;
      best = Math.max(best, 1 - (gap - 4) / 36);
    }
    me.draft = best;
    if (best <= 0) continue;
    const q = me.car.body.quaternion, f = [2 * (q[0] * q[2] + q[3] * q[1]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])];
    const push = me.car.params.mass * 1.6 * best;
    rigidBody.addForce(world, me.car.body, [f[0] * push, 0, f[1] * push], true);
  }
}

/** progress of one car around the track: laps, position along it, lap times */
export function createTracker(track, car) {
  const L = track.length;
  /* cars start behind the line: crossing it at the start begins lap 1 (halfway is armed for that) */
  const t = { car, index: -1, s: 0, lap: 0, total: 0, halfway: true, lapStart: 0, lastLap: null, bestLap: null, finished: null, wrongWay: 0 };
  /** call every step with the race clock; returns true when a lap was completed */
  t.update = (time) => {
    const p = car.body.position;
    const n = track.nearest(p[0], p[2], t.index);
    const prevS = t.s;
    t.index = n.i; t.s = n.s; t.lateral = n.lateral; t.offTrack = n.dist > track.samples[n.i].w / 2 + 1;
    let lapped = false;
    /* crossing the line forward: s jumps from near L to near 0 */
    if (prevS > L * 0.8 && t.s < L * 0.2) {
      if (t.halfway) {
        if (t.lap > 0) { const lt = time - t.lapStart; t.lastLap = lt; t.bestLap = t.bestLap === null ? lt : Math.min(t.bestLap, lt); }
        t.lap++; t.lapStart = time; t.halfway = false; lapped = true;
      }
    } else if (prevS < L * 0.2 && t.s > L * 0.8 && t.lap > 0 && !t.halfway) {
      /* backwards over the line */
      t.lap--; t.halfway = true;
    }
    if (t.s > L * 0.45 && t.s < L * 0.55) t.halfway = true;
    t.total = t.lap * L + t.s;
    /* facing against the track direction while moving */
    const q = car.body.quaternion, f = [2 * (q[0] * q[2] + q[3] * q[1]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])];
    const tg = track.samples[t.index].t;
    t.wrongWay = f[0] * tg[0] + f[1] * tg[1] < -0.2 ? t.wrongWay + 1 : 0;
    return lapped;
  };
  return t;
}

/** order cars: finished first (by finish time), then by distance covered */
export function standings(trackers) {
  return [...trackers].sort((a, b) => {
    if (a.finished !== null || b.finished !== null) {
      if (a.finished === null) return 1;
      if (b.finished === null) return -1;
      return a.finished - b.finished;
    }
    return b.total - a.total;
  });
}

/**
 * An AI driver for `car` (from CAR.create). skill 0.88..1: how close to the limit it drives.
 * @param {ReturnType<import('./track.js').buildTrack>} track
 */
export function createDriver(car, track, tracker, skill = 0.95, o = {}) {
  /* how hard the cars can corner and brake, as fractions of grip × g (found with hot laps: _local/hotlap.mjs) */
  const LAT = o.lat ?? 0.92, BRAKE = o.brake ?? 0.75;
  const S = track.samples, N = S.length, R = track.racing;
  const P = car.params;
  const wb = car.report.wheelbase || 2.6;
  /* speed profile along the racing line */
  const profile = new Float32Array(N);
  const aLat = P.grip * G * LAT * skill;
  const vTop = (P.topSpeed / 3.6) * 0.97;
  const aBrake = Math.min(12, P.grip * G * BRAKE) * skill;
  for (let i = 0; i < N; i++) profile[i] = Math.min(vTop, Math.sqrt(aLat / Math.max(1e-4, Math.abs(R.curvature[i]))));
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 2 * N; k > 0; k--) {
      const i = k % N, j = (i + 1) % N;
      const ds = Math.hypot(R.points[j][0] - R.points[i][0], R.points[j][1] - R.points[i][1]);
      profile[i] = Math.min(profile[i], Math.sqrt(profile[j] * profile[j] + 2 * aBrake * ds));
    }
  }

  const d = { car, tracker, skill, profile, offset: 0, offsetTarget: 0, passTimer: 0, passSide: 0, stuck: 0, flipped: 0, resets: 0 };

  /**
   * @param {number} dt seconds
   * @param {Array<{ tracker: any, car: any }>} field every car in the race (for traffic)
   * @param {boolean} go the race has started (before: hold the brakes)
   */
  d.update = (dt, field, go) => {
    const i = tracker.index < 0 ? track.nearest(car.body.position[0], car.body.position[2]).i : tracker.index;
    const v = car.speed / 3.6;
    /* before the start: no input (the car holds itself still; braking at a standstill would reverse) */
    if (!go) { car.drive({ throttle: 0, brake: 0, steer: 0, handbrake: false }); return; }

    /* ---- traffic: the nearest car ahead within 35 m */
    let ahead = null, gap = Infinity;
    for (const o of field) {
      if (o.car === car) continue;
      const ds = (o.tracker.s - tracker.s + track.length) % track.length;
      if (ds > 0.5 && ds < 35 && ds < gap) { gap = ds; ahead = o; }
    }
    let targetV = profile[track.wrap(i + Math.round((v * 0.3) / 2))];
    const myLat = tracker.lateral ?? 0;
    if (ahead) {
      const theirLat = ahead.tracker.lateral ?? 0;
      const vo = ahead.car.speed / 3.6;
      const overlap = Math.abs(theirLat - myLat) < 2.3;
      const faster = targetV > vo + 0.5 || v > vo + 0.5;
      const half = S[i].w / 2 - 1.8;
      /* commit to a pass: the inside of the next corner if there is room there, else the side with more room */
      if (overlap && faster && gap < 30 && d.passTimer <= 0) {
        let bend = 0;
        for (let k = 5; k < 40; k++) bend += R.curvature[track.wrap(i + k)];
        const room = (side) => (side > 0 ? half - theirLat : theirLat + half);
        const inside = bend >= 0 ? 1 : -1;
        const side = room(inside) > 3 ? inside : room(-inside) > 3 ? -inside : 0;
        if (side) { d.passSide = side; d.passTimer = 3.5; }
      }
      if (d.passTimer > 0 && d.passSide) {
        d.offsetTarget = Math.max(-half, Math.min(half, theirLat + d.passSide * 3)) - R.offset[i];
      }
      /* right behind with no way past: follow */
      if (overlap && !(d.passTimer > 0 && d.passSide) && gap < 8 + v * 0.3) targetV = Math.min(targetV, vo - 0.5);
    }
    d.passTimer -= dt;
    if (d.passTimer <= 0) { d.offsetTarget = 0; d.passSide = 0; }
    d.offset += Math.max(-3 * dt, Math.min(3 * dt, d.offsetTarget - d.offset));
    /* stay inside the track wherever the offset ends up */
    const lineAt = (j) => Math.max(-(S[j].w / 2 - 1.6), Math.min(S[j].w / 2 - 1.6, R.offset[j] + d.offset));

    /* ---- speed */
    const err = targetV - v;
    let throttle = 0, brake = 0;
    if (err > 1.2) throttle = 1;
    else if (err > -0.4) throttle = Math.max(0, Math.min(1, 0.35 + err * 0.4));
    else if (v > 1) brake = Math.max(0, Math.min(1, -err * 0.28));

    /* ---- steering: pure pursuit */
    const look = Math.max(7, Math.min(42, 5 + v * 0.45));
    const j = track.wrap(i + Math.round(look / 2));
    const tp = track.point(j, lineAt(j));
    const p = car.body.position, q = car.body.quaternion;
    const f = [2 * (q[0] * q[2] + q[3] * q[1]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])];
    const lf = [f[1], -f[0]];
    const rx = tp[0] - p[0], rz = tp[1] - p[2];
    const alpha = Math.atan2(rx * lf[0] + rz * lf[1], rx * f[0] + rz * f[1]);
    const delta = Math.atan2(2 * wb * Math.sin(alpha), look);
    const maxSteer = (P.steer * Math.PI / 180) / (1 + Math.abs(v) / 14);
    let steer = Math.max(-1, Math.min(1, -delta / maxSteer));

    /* ---- trouble: stuck, flipped, facing backwards → back on the track */
    const up = 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
    d.flipped = up < 0.35 ? d.flipped + dt : 0;
    d.stuck = v < 1.5 ? d.stuck + dt : 0;
    if (d.flipped > 1.5 || d.stuck > 3 || tracker.wrongWay > 150) {
      put(field);
      return;
    }
    car.drive({ throttle, brake, steer, handbrake: false });
  };

  /* back on the track a little behind where it was, in a gap */
  function put(field) {
    let i = track.wrap(tracker.index - 8);
    for (let tries = 0; tries < 20; tries++) {
      const pt = track.point(i, 0);
      const busy = field.some((o) => o.car !== car && Math.hypot(o.car.body.position[0] - pt[0], o.car.body.position[2] - pt[1]) < 7);
      if (!busy) break;
      i = track.wrap(i - 5);
    }
    const r = track.resetAt(i);
    car.reset(r.position, r.yaw);
    tracker.index = i;
    d.stuck = 0; d.flipped = 0; tracker.wrongWay = 0; d.offset = 0; d.offsetTarget = 0;
    d.resets++;
  }
  d.reset = put;
  return d;
}
