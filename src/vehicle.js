/* The car's physics: a raycast vehicle on crashcat. No three.js (runs in Node).

   One rigid body (the chassis: a convex hull of the body, centre of mass lowered). Each wheel is not a body: every
   step a cylinder the size of the tyre is swept down from its suspension mount (like Jolt's cylinder vehicle tester),
   so a tyre meets a kerb or a ramp edge with its front and rolls up it instead of snapping on top.
     suspension  spring + damper along the car's up: soft on bump (the wheel soaks up the hit), firm on rebound (no
                 bouncing), digressive (a sharp hit can't launch the car); progressive bump stop; anti-roll bars
     tyre        grip from the load on it, less per kg the more it carries (load sensitivity: why real cars are
                 stable), a Pacejka-like curve across (peak at ~7° of slip, easing to ~90% past it: slides are
                 catchable) that builds up over ~25 cm of rolling (relaxation length), one friction circle per tyre.
                 Cornering grip comes first: traction control and ABS use only the grip that is left
     engine      revs + torque curve + automatic gearbox (shift pauses, kick-down), engine braking when you lift,
                 rev limiter, launch revs; wheelspin when the drive asks for more than the tyres give
     brakes      ABS-like; braking at a standstill reverses; handbrake locks the rear
     steering    input smoothed (quick to centre, slower at speed), much less lock at speed, Ackermann
     donut       gas + handbrake + full lock below ~30 km/h: spins on the spot round the front axle (rear tyres spinning)
     assist      (like GTA) automatic countersteer when the rear slides, stability control only past a dead band
                 (normal cornering is all tyres), off while the handbrake is held; in the air the nose follows the
                 flight path and the car levels itself, so jumps land on the wheels
   Car frame: +Z forward, +Y up, +X left, metres; the body's origin is between the wheels at the tyres' bottom. */
import { rigidBody, castRay, createClosestCastRayCollector, createDefaultCastRaySettings, castShape, createClosestCastShapeCollector,
  createDefaultCastShapeSettings, filter as filterNs, convexHull, box, cylinder, offsetCenterOfMass, massProperties,
  motionProperties, MotionType } from 'crashcat';

/** Presets: what kind of car. Every number can be overridden in create({ ... }) or live with car.tune({ ... }). */
export const PRESETS = {
  car: { mass: 1400, power: 230, topSpeed: 210, drive: 'awd', grip: 1.3, steer: 36, steerSpeed: 1, stiffness: 1.3, damping: 0.72, antiRoll: 0.45, travel: 0.26, engineBrake: 0.8, redline: 6800, gears: 6, shiftTime: 0.2, assist: 1, handbrakeGrip: 0.5 },
  sport: { mass: 1450, power: 420, topSpeed: 290, drive: 'rwd', grip: 1.45, steer: 34, steerSpeed: 1.1, stiffness: 1.55, damping: 0.75, antiRoll: 0.6, travel: 0.24, engineBrake: 0.7, redline: 8000, gears: 7, shiftTime: 0.12, assist: 1, handbrakeGrip: 0.45 },
  classic: { mass: 1100, power: 100, topSpeed: 160, drive: 'rwd', grip: 1.1, steer: 38, steerSpeed: 0.9, stiffness: 1.1, damping: 0.78, antiRoll: 0.35, travel: 0.28, engineBrake: 1, redline: 6000, gears: 4, shiftTime: 0.35, assist: 1, handbrakeGrip: 0.5 },
  offroad: { mass: 2100, power: 290, topSpeed: 175, drive: 'awd', grip: 1.2, steer: 36, steerSpeed: 0.9, stiffness: 1.0, damping: 0.72, antiRoll: 0.55, travel: 0.4, engineBrake: 1.1, redline: 5500, gears: 5, shiftTime: 0.3, assist: 1, handbrakeGrip: 0.55 },
};

/** What can be tuned and its sane range: [min, max, unit / meaning] */
export const TUNING = {
  mass: [500, 5000, 'kg'],
  power: [20, 1200, 'kW'],
  topSpeed: [60, 420, 'km/h'],
  grip: [0.4, 3, 'tyre friction'],
  steer: [10, 55, '° full lock at a standstill'],
  steerSpeed: [0.3, 3, 'how fast the wheel turns'],
  stiffness: [0.5, 3.5, 'Hz spring'],
  damping: [0.2, 1.6, '× critical'],
  antiRoll: [0, 2, 'anti-roll bars'],
  travel: [0.08, 0.6, 'm suspension travel'],
  engineBrake: [0, 3, 'slowing when you lift'],
  redline: [3000, 11000, 'rpm'],
  gears: [1, 9, 'forward gears'],
  shiftTime: [0.02, 1, 's per gear change'],
  assist: [0, 1, 'traction + stability help'],
  handbrakeGrip: [0.1, 1, 'rear grip with the handbrake'],
};

const G = 9.81;
const TO_RPM = 60 / (2 * Math.PI);

/**
 * @param {{ world: any, layers: { moving: number } }} physics
 * @param {{ wheels: { rest: {x:number,y:number,z:number}, radius: number, width: number, axle: number, left: boolean }[],
 *   bodyPoints: number[], size: { length: number, width: number, height: number } }} shape the car in the car frame (rig)
 * @param {object} o preset name + overrides, position [x,y,z], yaw (radians)
 */
export function createVehicle(physics, shape, o = {}) {
  const P = { ...PRESETS.car, ...(PRESETS[o.preset] || {}), ...pick(o) };
  const { world } = physics;
  const wheels = shape.wheels.map((w) => ({ ...w, rest: [w.rest.x, w.rest.y, w.rest.z] }));
  const n = wheels.length;
  const axleCount = Math.max(...wheels.map((w) => w.axle)) + 1;
  const rMin = Math.min(...wheels.map((w) => w.radius));

  /* ----------------------------------------------------------------- chassis body */
  const clearance = rMin * 0.65;
  const pts = [];
  const stride = Math.max(1, Math.ceil(shape.bodyPoints.length / 3 / 3000));
  for (let i = 0; i < shape.bodyPoints.length; i += 3 * stride) {
    pts.push(shape.bodyPoints[i], Math.max(clearance, shape.bodyPoints[i + 1]), shape.bodyPoints[i + 2]);
  }
  let hull;
  try { hull = convexHull.create({ positions: pts, convexRadius: 0.03 }); } catch { hull = null; }
  if (!hull) {
    const s = shape.size;
    hull = box.create({ halfExtents: [s.width / 2, (s.height - clearance) / 2, s.length / 2] });
  }
  const zMid = wheels.reduce((t, w) => t + w.rest[2], 0) / n;
  const comY = rMin + 0.12;
  const com = [0, comY, zMid];
  const shapeWithCom = offsetCenterOfMass.create({ shape: hull, offset: [com[0] - hull.centerOfMass[0], com[1] - hull.centerOfMass[1], com[2] - hull.centerOfMass[2]] });
  const bw = shape.size.width, bh = shape.size.height * 0.6, bl = shape.size.length;
  const mp = massProperties.create();
  massProperties.setMassAndInertiaOfSolidBox(mp, [bw, bh, bl], 1);
  massProperties.scaleToMass(mp, P.mass);

  const yaw = Number(o.yaw) || 0;
  const pos = Array.isArray(o.position) ? o.position.map(Number) : [0, 0, 0];
  const body = rigidBody.create(world, {
    shape: shapeWithCom,
    objectLayer: physics.layers.moving,
    motionType: MotionType.DYNAMIC,
    position: [pos[0], pos[1] + 0.05, pos[2]],
    quaternion: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    massPropertiesOverride: mp,
    friction: 0.35,
    restitution: 0.05,
    linearDamping: 0.02,
    angularDamping: 0.1,
    allowSleeping: false,
  });

  const driven = (w) => P.drive === 'awd' || (P.drive === 'fwd' ? w.axle === 0 : w.axle === axleCount - 1);
  const steers = (w) => w.axle === 0;
  const rearZ = avg(wheels.filter((w) => w.axle === axleCount - 1).map((w) => w.rest[2]));
  const wheelbase = Math.max(0.5, avg(wheels.filter((w) => w.axle === 0).map((w) => w.rest[2])) - rearZ);
  for (const w of wheels) {
    w.probe = cylinder.create({ halfHeight: Math.max(0.04, w.width * 0.45), radius: w.radius, convexRadius: Math.min(0.05, w.radius * 0.2) });
    w.grounded = false; w.load = 0; w.steer = 0; w.spin = 0; w.omega = 0; w.slip = 0; w.skid = 0; w.alpha = 0; w.slide = 0; w.spinSlip = 0; w.lock = 0;
    w.contact = [0, 0, 0]; w.normal = [0, 1, 0]; w.hitBody = null;
  }

  /* ----------------------------------------------------------------- numbers derived from P (again on tune) */
  const D = {};
  function derive() {
    D.corner = P.mass / n;
    D.k = D.corner * (2 * Math.PI * P.stiffness) ** 2;
    D.cBump = 2 * P.damping * 0.65 * Math.sqrt(D.k * D.corner);
    D.cRebound = 2 * P.damping * 1.35 * Math.sqrt(D.k * D.corner);
    /* travel up from rest (at least 12 cm: a speed bump must not reach the bump stop) */
    D.bump = Math.max(0.12, P.travel * 0.5);
    D.travel = Math.max(P.travel, D.bump + 0.06);
    D.sag = (D.corner * G) / D.k;
    for (const w of wheels) { w.sMax = D.travel; w.free = D.bump + D.sag; }
    D.N0 = D.corner * G;
    D.I = { pitch: P.mass * (bh * bh + bl * bl) / 12, yaw: P.mass * (bl * bl + bw * bw) / 12, roll: P.mass * (bh * bh + bw * bw) / 12 };

    /* engine: torque curve scaled so its peak power is `power`; gears geometric from 1st to top; final drive puts
       the top speed just under the redline in top gear */
    const gearsN = Math.round(P.gears);
    const top = gearsN >= 5 ? 0.78 : gearsN === 4 ? 1 : 1.2, first = gearsN === 1 ? top : 3.4;
    D.ratios = Array.from({ length: gearsN }, (_, i) => (gearsN === 1 ? first : first * (top / first) ** (i / (gearsN - 1))));
    D.rDrive = avg(wheels.filter(driven).map((w) => w.radius)) || rMin;
    D.vTop = P.topSpeed / 3.6;
    D.redW = P.redline / TO_RPM;
    D.final = (D.redW * D.rDrive) / (D.ratios[gearsN - 1] * D.vTop * 1.04);
    let best = 0;
    for (let x = 0.1; x <= 1; x += 0.01) best = Math.max(best, torqueCurve(x) * x);
    D.Tpeak = (P.power * 1000) / (best * D.redW);
    D.idle = Math.min(1000, P.redline * 0.14);
    D.launch = P.redline * 0.45;
    /* air drag: balances the engine at top speed in top gear */
    const xTop = 1 / 1.04;
    D.drag = (D.Tpeak * torqueCurve(xTop) * xTop * D.redW * 0.92) / D.vTop ** 3;
    if (state.gear > gearsN) state.gear = gearsN;
  }
  function torqueCurve(x) {
    if (x < 0.15) return 0.55;
    if (x < 0.6) return 0.55 + 0.45 * smooth((x - 0.15) / 0.45);
    if (x < 0.85) return 1;
    return 1 - 0.3 * Math.min(1, (x - 0.85) / 0.15);
  }

  /* ----------------------------------------------------------------- state */
  const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  const state = { steer: 0, throttle: 0, brake: 0, speed: 0, reversing: false, grounded: 0, assist: 1, gear: 1, rpm: 800, shift: 0, impact: 0, limiter: false, donut: 0, donutSpin: 0 };
  derive();
  for (const w of wheels) { w.s = D.bump; w.sPrev = D.bump; w.sDraw = D.bump; }

  const rayHit = createClosestCastRayCollector(), raySet = createDefaultCastRaySettings();
  const shapeHit = createClosestCastShapeCollector(), shapeSet = createDefaultCastShapeSettings();
  shapeSet.returnDeepestPoint = true;
  const rayFilter = filterNs.forWorld(world);
  rayFilter.bodyFilter = (b) => b.id !== body.id && !b.sensor;
  const ONE = [1, 1, 1];
  const v3 = () => [0, 0, 0];
  const R = v3(), U = v3(), F = v3(), tmp = v3(), vel = v3();

  function rotate(out, q, v) {
    const [x, y, z, w] = q, [vx, vy, vz] = v;
    const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
    out[0] = ix * w + iw * -x + iy * -z - iz * -y;
    out[1] = iy * w + iw * -y + iz * -x - ix * -z;
    out[2] = iz * w + iw * -z + ix * -y - iy * -x;
    return out;
  }
  const toWorld = (out, local) => { rotate(out, body.quaternion, local); out[0] += body.position[0]; out[1] += body.position[1]; out[2] += body.position[2]; return out; };
  const damper = (vs) => {
    const cc = vs < 0 ? D.cBump : D.cRebound, a = Math.abs(vs), knee = 0.25;
    return -Math.sign(vs) * cc * (a < knee ? a : knee + (a - knee) * 0.3);
  };

  /** one physics step (dt: 1/60 or a substep of it): call before the world steps */
  function step(dt) {
    const q = body.quaternion;
    rotate(R, q, [1, 0, 0]); rotate(U, q, [0, 1, 0]); rotate(F, q, [0, 0, 1]);
    const bv = body.motionProperties.linearVelocity, av = body.motionProperties.angularVelocity;
    const vF = dot(bv, F), vL = dot(bv, R);
    state.speed = vF;
    state.impact *= Math.exp(-dt * 5);

    /* ---- pedals: smoothed so a key press eases the weight over instead of jerking it */
    const tIn = clamp(input.throttle, 0, 1), bIn = clamp(input.brake, 0, 1);
    if (state.reversing) { if (tIn > 0.05 && vF > -0.5) { state.reversing = false; state.gear = 1; } }
    else if (bIn > 0.05 && vF < 0.5 && tIn < 0.05) { state.reversing = true; }
    const demandIn = state.reversing ? bIn : tIn, brakeIn = state.reversing ? tIn : bIn;
    state.throttle += clamp(demandIn - state.throttle, -dt * 10, dt * 5);
    state.brake += clamp(brakeIn - state.brake, -dt * 12, dt * 7);
    const demand = state.throttle, brake = state.brake;
    const hand = !!input.handbrake;
    /* ---- donut: gas + handbrake + full steering at low speed → the car spins on the spot around its front wheels,
       the rear wheels spinning and sliding (blends in / out over ~0.3 s; let go of the handbrake to drive off) */
    const donutWanted = hand && tIn > 0.5 && Math.abs(input.steer) > 0.5 && !state.reversing && state.grounded >= 3
      && Math.abs(vF) < (state.donut > 0.2 ? 14 : 9);
    state.donut = clamp(state.donut + (donutWanted ? dt / 0.6 : -dt / 0.35), 0, 1);
    const donut = state.donut;
    /* the rotation itself builds up more slowly, like a real car breaking traction: ~2 s to full speed */
    state.donutSpin = clamp((state.donutSpin || 0) + (donutWanted ? dt / 2 : -dt / 0.35), 0, 1);
    const donutSpin = state.donutSpin * state.donutSpin * (3 - 2 * state.donutSpin);

    /* ---- steering: input rate (quick back to centre, slower at speed), lock shrinks with speed, then the
       automatic countersteer (GTA): when the rear slides past ~3°, the wheels turn into the slide */
    const target = clamp(-input.steer, -1, 1);
    const back = Math.abs(target) < Math.abs(state.steer) || Math.sign(target) !== Math.sign(state.steer);
    const rate = (back ? 7 : 5 / (1 + Math.abs(vF) / 25)) * P.steerSpeed;
    state.steer += clamp(target - state.steer, -rate * dt, rate * dt);
    const lock = P.steer * Math.PI / 180;
    const maxSteer = lock / (1 + Math.abs(vF) / 14);
    let delta = state.steer * maxSteer;
    const beta = Math.abs(vF) > 3 ? Math.atan2(vL, Math.abs(vF)) : 0;
    const slide = beta - clamp(beta, -0.05, 0.05);
    if (state.grounded >= 2) delta += P.assist * 0.8 * clamp(slide, -0.5, 0.5) * (hand ? 0.4 : 1) * (1 - donut) * Math.sign(vF || 1);
    delta = clamp(delta, -lock, lock);
    for (const w of wheels) {
      if (!steers(w)) { w.steer = 0; continue; }
      const wb = w.rest[2] - rearZ;
      w.steer = Math.abs(delta) < 1e-4 || wb <= 0 ? delta : Math.atan(wb / (wb / Math.tan(delta) - w.rest[0]));
    }

    /* ---- suspension: sweep each tyre down from its mount (the wheel centre at full bump) */
    let grounded = 0;
    for (const w of wheels) {
      const mount = toWorld(w.mountWorld || (w.mountWorld = v3()), [w.rest[0], w.rest[1] + D.bump, w.rest[2]]);
      w.sPrev = w.s;
      if (!sweep(w, mount) && !ray(w, mount)) { w.s = w.sMax; w.grounded = false; w.hitBody = null; continue; }
      w.grounded = true;
      grounded++;
    }
    state.grounded = grounded;

    const stop = D.bump * 0.25;
    for (const w of wheels) {
      if (!w.grounded) { w.load = 0; continue; }
      const vs = clamp((w.s - w.sPrev) / dt, -6, 6);
      let f = D.k * (w.free - w.s) + damper(vs);
      if (w.s < stop) { const d = Math.min(2, (stop - w.s) / stop); f += D.k * 4 * d * d * stop + (vs < 0 ? -D.cBump * 0.5 * Math.max(vs, -1) : 0); }
      w.load = Math.max(0, f);
      if (vs < -1.2) state.impact = Math.max(state.impact, Math.min(1, (-vs - 1.2) / 3));
    }
    for (let a = 0; a < axleCount; a++) {
      const pair = wheels.filter((w) => w.axle === a);
      if (pair.length !== 2 || !pair[0].grounded || !pair[1].grounded) continue;
      const f = D.k * P.antiRoll * (pair[1].s - pair[0].s);
      pair[0].load = Math.max(0, pair[0].load + f);
      pair[1].load = Math.max(0, pair[1].load - f);
    }

    /* ---- engine + gearbox → drive force at the driven wheels (signed along the car) */
    const drivenGrounded = wheels.filter((w) => driven(w) && w.grounded);
    const gearsN = D.ratios.length;
    if (state.reversing) state.gear = -1;
    else if (state.gear < 1) state.gear = 1;
    const ratio = state.gear === -1 ? D.ratios[0] : D.ratios[state.gear - 1];
    const wheelW = drivenGrounded.length
      ? Math.abs(avg(drivenGrounded.map((w) => w.vl || 0))) / D.rDrive
      : Math.abs(avg(wheels.filter(driven).map((w) => w.omega)));
    const rpmWheels = wheelW * ratio * D.final * TO_RPM;
    let rpmTarget = Math.max(D.idle, rpmWheels);
    /* clutch slipping at a launch: revs rise with the pedal until the wheels catch up */
    if (rpmWheels < D.launch && demand > 0.05) rpmTarget = Math.max(rpmWheels, D.idle + demand * (D.launch - D.idle));
    if (!grounded && demand > 0.05) rpmTarget = Math.max(rpmTarget, P.redline * (0.6 + 0.4 * demand));
    /* in a donut the rear wheels spin freely: the revs rise with the pedal */
    if (donut > 0) rpmTarget = Math.max(rpmTarget, D.idle + (0.5 + 0.5 * donutSpin) * donut * demand * (P.redline * 0.72 - D.idle));
    state.rpm += (Math.min(rpmTarget, P.redline * 1.02) - state.rpm) * Math.min(1, dt * (state.shift > 0 ? 8 : 20));
    const x = state.rpm / P.redline;
    let torque = 0;
    state.limiter = false;
    if (state.shift > 0) state.shift -= dt;
    else if (demand > 0.02) {
      torque = demand * D.Tpeak * torqueCurve(x);
      if (rpmWheels >= P.redline) { torque = 0; state.limiter = true; }
      /* reverse tops out at 40 km/h */
      if (state.gear === -1 && vF < -11) torque = 0;
    } else if (rpmWheels > D.idle * 1.2) {
      /* engine braking: the engine holds the car back when you lift, more at high revs */
      torque = -P.engineBrake * D.Tpeak * (0.1 + 0.3 * x);
    }
    const driveForce = (torque * ratio * D.final * 0.9) / D.rDrive * (state.gear === -1 ? -1 : 1);

    /* automatic gearbox: up near the redline (early when cruising), down when the revs fall (kick-down) */
    if (state.gear >= 1 && state.shift <= 0 && grounded >= 2) {
      const xw = rpmWheels / P.redline;
      if (state.gear < gearsN && xw > (demand > 0.3 ? 0.92 : 0.55)) { state.gear++; state.shift = P.shiftTime; }
      else if (state.gear > 1) {
        const xLow = xw * (D.ratios[state.gear - 2] / D.ratios[state.gear - 1]);
        if (xLow < 0.85 && (xw < 0.33 || (demand > 0.8 && xw < 0.55))) { state.gear--; state.shift = P.shiftTime * 0.6; }
      }
      if (Math.abs(vF) < 1 && state.gear > 1) state.gear = 1;
    }

    /* ---- tyres */
    const stopping = demand < 0.05 && brake < 0.05 && Math.abs(vF) < 0.6 && tIn < 0.05 && bIn < 0.05;
    const kill = D.corner / dt;
    for (const w of wheels) {
      if (!w.grounded) {
        w.omega *= Math.exp(-0.6 * dt);
        if (driven(w)) w.omega += (state.gear === -1 ? -1 : 1) * demand * 60 * dt;
        w.omega = clamp(w.omega, -D.redW / (ratio * D.final), D.redW / (ratio * D.final));
        w.spin += w.omega * dt;
        w.skid = 0; w.vl = 0; w.slide = 0; w.spinSlip = 0; w.lock = 0;
        continue;
      }
      const N = w.load;
      const centre = toWorld(v3(), [w.rest[0], w.rest[1] + D.bump - w.s, w.rest[2]]);
      addForce(scale(tmp, U, N), centre);

      /* the tyre's forward and sideways directions on the ground */
      const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
      const fw = [F[0] * cs + R[0] * sn, F[1] * cs + R[1] * sn, F[2] * cs + R[2] * sn];
      const nrm = w.normal, fd = dot(fw, nrm);
      const fg = normalize([fw[0] - nrm[0] * fd, fw[1] - nrm[1] * fd, fw[2] - nrm[2] * fd]);
      const lg = cross(nrm, fg);
      rigidBody.getVelocityAtPoint(vel, body, w.contact);
      if (w.hitBody && w.hitBody.motionType !== MotionType.STATIC) {
        const gv = rigidBody.getVelocityAtPoint(v3(), w.hitBody, w.contact);
        vel[0] -= gv[0]; vel[1] -= gv[1]; vel[2] -= gv[2];
      }
      const vl = dot(vel, fg), vt = dot(vel, lg);
      w.vl = vl;
      const rear = w.axle === axleCount - 1 && axleCount > 1;
      const locked = hand && rear && donut < 0.5;
      const donutRear = rear && donut > 0;
      /* grip: friction × load, less per kg as the load grows */
      const loadFactor = clamp(1 - 0.12 * (N / D.N0 - 1), 0.7, 1.12);
      const limit = P.grip * (locked ? P.handbrakeGrip : 1) * N * loadFactor;

      /* across: slip angle builds up over ~25 cm of rolling, then the curve */
      const alphaT = Math.atan2(vt, Math.abs(vl) + 0.5);
      w.alpha += (alphaT - w.alpha) * Math.min(1, (Math.hypot(vl, vt) * dt) / 0.25 + 0.15);
      const a = Math.abs(w.alpha);
      const curve = Math.sin(1.3 * Math.atan(20 * a));
      let fy = -Math.sign(w.alpha) * Math.min(limit * curve, Math.abs(vt) * kill * 0.5);
      /* a spinning tyre has little grip sideways: in a donut the rear swings round */
      if (donutRear) fy *= 1 - 0.8 * donut;

      /* along: cornering grip first; traction control / ABS use what is left (less so with less assist) */
      const left = Math.sqrt(Math.max(0, limit * limit - fy * fy)) + (1 - P.assist) * limit;
      let fx = 0, excess = 0;
      if (driven(w) && drivenGrounded.length) {
        /* in a donut the power goes into spinning the tyres, not into pushing the car along */
        const want = (driveForce / drivenGrounded.length) * (1 - 0.9 * donut);
        fx += clamp(want, -left, left);
        excess = Math.max(0, Math.abs(want) - left) / (limit + 1);
      }
      if (brake > 0) fx -= Math.sign(vl) * Math.min(brake * limit, left, Math.abs(vl) * kill * 0.5);
      if (locked) fx -= Math.sign(vl) * Math.min(0.8 * limit, Math.abs(vl) * kill * 0.5);
      if (stopping) fx = -vl * kill * 0.5;
      else fx -= Math.sign(vl) * Math.min(0.015 * N, Math.abs(vl) * kill);

      const total = Math.hypot(fx, fy);
      if (total > limit && total > 0) { fx *= limit / total; fy *= limit / total; }
      w.slip = Math.max(total > limit ? 1 - limit / total : 0, Math.min(1, excess));

      /* push a little above the contact: the body leans and dips like a real car, but can't be tipped over */
      const lift = comY * 0.2;
      addForce([fg[0] * fx + lg[0] * fy, fg[1] * fx + lg[1] * fy, fg[2] * fx + lg[2] * fy],
        [w.contact[0] + U[0] * lift, w.contact[1] + U[1] * lift, w.contact[2] + U[2] * lift]);

      /* for drawing, sound and skid marks: rolls with the ground, locked by the handbrake, spins up on wheelspin */
      const spinUp = Math.max(driven(w) ? Math.min(1, excess * 2) : 0, donutRear ? donut * demand * (0.6 + 0.4 * donutSpin) : 0);
      w.omega = locked ? 0 : vl / w.radius + spinUp * (donutRear ? 45 : 25) * Math.sign(driveForce || 1);
      w.spin += w.omega * dt;
      const speed = Math.hypot(vl, vt);
      const moving = clamp((speed - 1) / 4, 0, 1);
      /* the three ways a tyre scrubs, 0..1 each (for sound): sliding sideways, spinning, locked */
      w.slide = clamp((a - 0.12) * 5, 0, 1) * moving;
      w.spinSlip = spinUp;
      w.lock = locked && Math.abs(vl) > 2 ? 0.8 * moving : 0;
      w.skid = clamp(Math.max((a - 0.12) * 5, spinUp, locked && Math.abs(vl) > 2 ? 0.8 : 0), 0, 1) * moving;
    }

    /* ---- stability control, only past a dead band: normal cornering is all tyres; it catches spins. Off while
       the handbrake is held, fading back in over ~0.8 s after */
    state.assist = hand ? 0 : Math.min(1, state.assist + dt / 0.8);
    if (grounded >= 2 && P.assist > 0) {
      const maxRate = (P.grip * G) / Math.max(Math.abs(vF), 3);
      const want = clamp((vF * Math.tan(state.steer * maxSteer)) / wheelbase, -maxRate, maxRate);
      const err = dot(av, U) - want;
      const band = 0.08 * Math.abs(want) + 0.05;
      const over = err - clamp(err, -band, band);
      const cap = P.mass * G * wheelbase * 0.3;
      const torque2 = clamp(-over * D.I.yaw * 8 * P.assist * state.assist * (grounded / n), -cap, cap);
      rigidBody.addTorque(world, body, scale(tmp, U, torque2), true);
    }
    /* ---- donut: turn about the front axle, building up over ~2 s to ~70–75°/s (one turn in ~5 s). A yaw
       torque drives the rotation; a force keeps the centre of mass on its circle round the front axle, so the car
       stays in its place */
    if (donut > 0 && grounded >= 2) {
      const dir = -Math.sign(input.steer);
      const yawNow = dot(av, U);
      const want = dir * (1.2 + 0.4 * demand) * donutSpin;
      const tq = clamp((want - yawNow) * D.I.yaw / 0.2, -P.mass * G * wheelbase * 0.7, P.mass * G * wheelbase * 0.7);
      rigidBody.addTorque(world, body, scale(tmp, U, tq), true);
      /* where the centre of mass should be going: round the front axle (behind it by dz), not forward */
      const dz = rearZ + wheelbase - com[2];
      const wantL = -yawNow * dz, wantF = 0;
      const k = P.mass / 0.3 * donut, cap = P.mass * G * P.grip * 0.8;
      const fF = clamp((wantF - vF) * k, -cap, cap), fL = clamp((wantL - vL) * k, -cap, cap);
      addForce([F[0] * fF + R[0] * fL, F[1] * fF + R[1] * fL, F[2] * fF + R[2] * fL], null);
    }

    /* ---- in the air: the nose follows the flight path and the roll levels (holding the gas in the air, as
       players do, must not tip it over) */
    if (grounded === 0 && P.assist > 0) {
      const sp = Math.hypot(bv[0], bv[1], bv[2]);
      let pitchErr = 0;
      if (sp > 4 && Math.abs(vF) > 2) {
        const s = Math.sign(vF);
        pitchErr = clamp(dot(cross(F, [bv[0] / sp * s, bv[1] / sp * s, bv[2] / sp * s]), R), -0.6, 0.6);
      }
      const rollErr = clamp(R[1], -0.8, 0.8);
      const kk = 3 * P.assist, d = 2.2;
      const pitch = (pitchErr * kk * kk - dot(av, R) * d) * D.I.pitch;
      const roll = (-rollErr * kk * kk - dot(av, F) * d) * D.I.roll;
      rigidBody.addTorque(world, body, [R[0] * pitch + F[0] * roll, R[1] * pitch + F[1] * roll, R[2] * pitch + F[2] * roll], true);
    }

    /* ---- air drag (sets the top speed) and a little downforce */
    const sp = Math.hypot(bv[0], bv[1], bv[2]);
    if (sp > 0.01) addForce([-bv[0] * sp * D.drag, -bv[1] * sp * D.drag, -bv[2] * sp * D.drag], null);
    if (grounded) addForce(scale(tmp, U, -D.drag * sp * sp), null);
  }

  /* the tyre cylinder swept down: first touch → suspension length, contact point, ground normal */
  const qTmp = [0, 0, 0, 1];
  function sweep(w, mount) {
    const hs = Math.sin(w.steer / 2), hc = Math.cos(w.steer / 2), r2 = Math.SQRT1_2;
    qmul(qTmp, body.quaternion, qmul([0, 0, 0, 1], [0, hs, 0, hc], [0, 0, r2, r2]));
    shapeHit.reset();
    castShape(world, shapeHit, shapeSet, w.probe, mount, qTmp, ONE, [-U[0] * w.sMax, -U[1] * w.sMax, -U[2] * w.sMax], rayFilter);
    const h = shapeHit.hit;
    if (h.status !== 1) return false;
    const nh = h.normal;
    /* a wall or the side of a kerb touching the tyre's side is not ground: let the ray decide */
    if (dot(nh, U) < 0.35) return false;
    w.s = h.fraction > 0 ? h.fraction * w.sMax : -Math.min(h.penetrationDepth, w.sMax);
    /* a flat tyre on flat ground touches along a line and the cast reports one end of it, slightly tilted: take the
       normal in the wheel's plane and the contact under the wheel centre, so both sides are pushed the same */
    const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
    const ax = [R[0] * cs - F[0] * sn, R[1] * cs - F[1] * sn, R[2] * cs - F[2] * sn];
    const na = dot(nh, ax);
    const nn = normalize([nh[0] - ax[0] * na, nh[1] - ax[1] * na, nh[2] - ax[2] * na]);
    w.normal[0] = nn[0]; w.normal[1] = nn[1]; w.normal[2] = nn[2];
    const cx = mount[0] - U[0] * w.s, cy = mount[1] - U[1] * w.s, cz = mount[2] - U[2] * w.s;
    w.contact[0] = cx - nn[0] * w.radius; w.contact[1] = cy - nn[1] * w.radius; w.contact[2] = cz - nn[2] * w.radius;
    w.hitBody = rigidBody.get(world, h.bodyIdB) || null;
    return true;
  }
  /* fallback: a ray straight down under the wheel centre */
  function ray(w, mount) {
    const len = w.sMax + w.radius;
    rayHit.reset();
    castRay(world, rayHit, raySet, mount, [-U[0], -U[1], -U[2]], len, rayFilter);
    if (rayHit.hit.status !== 1) return false;
    const d = rayHit.hit.fraction * len;
    w.s = d - w.radius;
    for (let k2 = 0; k2 < 3; k2++) w.contact[k2] = mount[k2] - U[k2] * d;
    w.hitBody = rigidBody.get(world, rayHit.hit.bodyIdB) || null;
    if (w.hitBody) rigidBody.getSurfaceNormal(w.normal, w.hitBody, w.contact, rayHit.hit.subShapeId);
    if (dot(w.normal, U) < 0.2) { w.normal[0] = U[0]; w.normal[1] = U[1]; w.normal[2] = U[2]; }
    return true;
  }

  function addForce(f, at) {
    if (at) rigidBody.addForceAtPosition(world, body, [f[0], f[1], f[2]], at, true);
    else rigidBody.addForce(world, body, [f[0], f[1], f[2]], true);
  }

  /** put the car back on its wheels here (or at a position), still */
  function reset(position, yawAngle) {
    const p = position || [body.position[0], body.position[1] + 1, body.position[2]];
    let a = yawAngle;
    if (a === undefined) { rotate(F, body.quaternion, [0, 0, 1]); a = Math.atan2(F[0], F[2]); }
    rigidBody.setTransform(world, body, p, [0, Math.sin(a / 2), 0, Math.cos(a / 2)], true);
    rigidBody.setLinearVelocity(world, body, [0, 0, 0]);
    rigidBody.setAngularVelocity(world, body, [0, 0, 0]);
    Object.assign(state, { steer: 0, throttle: 0, brake: 0, reversing: false, gear: 1, shift: 0, rpm: D.idle });
    for (const w of wheels) { w.s = D.bump; w.sPrev = D.bump; w.sDraw = D.bump; w.omega = 0; w.alpha = 0; w.skid = 0; w.slide = 0; w.spinSlip = 0; w.lock = 0; }
    state.donut = 0; state.donutSpin = 0;
  }

  /** change numbers live (see TUNING); returns the params in use */
  function tune(o2 = {}) {
    const next = pick(o2);
    const massChanged = next.mass !== undefined && next.mass !== P.mass;
    Object.assign(P, next);
    if (massChanged) motionProperties.scaleToMass(body.motionProperties, P.mass);
    derive();
    return { ...P };
  }

  function remove() { rigidBody.remove(world, body); }

  return {
    body, wheels, input, state, params: P, step, reset, remove, tune, com,
    /** engine / gearbox for the HUD and sound */
    get engine() { return { rpm: state.rpm, gear: state.reversing ? -1 : state.gear, gears: D.ratios.length, redline: P.redline, throttle: state.throttle, shifting: state.shift > 0, limiter: state.limiter }; },
    /** the wheel centre's height in the car frame (for drawing) */
    wheelY: (w) => w.rest[1] + D.bump - w.sDraw,
    /** after a step: the drawn wheel follows the physics one, dropping with some weight when it leaves the ground */
    settleDraw(dt) {
      for (const w of wheels) {
        const s = clamp(w.s, 0, w.sMax);
        w.sDraw = s < w.sDraw ? s : Math.min(s, w.sDraw + 3 * dt);
      }
    },
  };
}

function pick(o) {
  const out = {};
  for (const key in TUNING) {
    const v = o[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = clamp(v, TUNING[key][0], TUNING[key][1]);
  }
  if (out.gears !== undefined) out.gears = Math.round(out.gears);
  if (['awd', 'rwd', 'fwd'].includes(o.drive)) out.drive = o.drive;
  return out;
}

function qmul(out, a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function scale(out, a, s) { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function avg(a) { return a.length ? a.reduce((t, v) => t + v, 0) / a.length : 0; }
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
