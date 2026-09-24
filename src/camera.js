/* A GTA-style chase camera. three.js only.

     const cam = CAR.createCamera(camera, car);
     // every frame, after physics.sync():
     cam.update(dt);
     // mouse / touch drag: cam.orbit(dxPixels, dyPixels) · wheel: cam.zoom(1.1) · cam.setMode('chase' | 'far' | 'hood')

   What makes it feel right:
   - it swings after the car on a spring instead of being bolted to it (small yaw wobbles don't shake the view),
     and in a slide it looks partly where the car is GOING, not only where it points
   - it follows a smoothed copy of the car (moved by the car's velocity, then eased toward the real position), and
     its height rides on a soft spring: kerbs, bumps and knocks against barriers don't jolt the picture; it never
     tilts with the car's roll
   - it pulls back and widens the field of view with speed; only really hard hits (big landings) give a small, slow
     bob; where it looks never shakes
   - drag the mouse to look around the car; a moment after you let go (while driving) it swings back behind */
import { Vector3 } from 'three';

/**
 * @param {import('three').PerspectiveCamera} camera
 * @param {{ object: import('three').Object3D, body: any, report: any, speed: number, impact: number }} car
 * @param {{ fov?: number, fovBoost?: number, distance?: number, height?: number, stiffness?: number, shake?: number,
 *   returnDelay?: number }} [o] fov (default 58°) · fovBoost at speed (+14°) · distance / height multipliers (1) ·
 *   stiffness of the follow (1) · shake (1) · returnDelay: seconds after a drag before it swings back (1.5)
 */
export function createChaseCamera(camera, car, o = {}) {
  const opt = { fov: 58, fovBoost: 14, distance: 1, height: 1, stiffness: 1, shake: 1, returnDelay: 1.5, ...o };
  let len = car.report.size.length, tall = car.report.size.height;
  const s = { yaw: 0, yawVel: 0, orbitYaw: 0, orbitPitch: 0, zoom: 1, idle: 99, y: 0, yVel: 0, x: 0, z: 0, vx: 0, vz: 0, spd: 0, fov: opt.fov, t: 0, init: false, mode: 'chase', bob: 0, bobVel: 0 };
  const target = new Vector3(), look = new Vector3(), fwd = new Vector3();

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function update(dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    s.t += dt;
    s.idle += dt;
    const obj = car.object, p = obj.position;
    fwd.set(0, 0, 1).applyQuaternion(obj.quaternion);
    const carYaw = Math.atan2(fwd.x, fwd.z);
    const v = car.body.motionProperties.linearVelocity;
    const speed = Math.hypot(v[0], v[2]);

    if (s.mode === 'hood') {
      camera.position.set(0, tall * 0.78, len * 0.12).applyMatrix4(obj.matrixWorld);
      look.set(0, tall * 0.7, len * 0.12 + 20).applyMatrix4(obj.matrixWorld);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
      setFov(opt.fov + 6 + opt.fovBoost * Math.min(1, speed / 55), dt);
      return;
    }

    /* where the camera wants to face: the car's heading, pulled toward the travel direction in a slide */
    let want = carYaw;
    if (!s.init) { s.yaw = carYaw; s.y = p.y; s.yVel = 0; s.x = p.x; s.z = p.z; s.vx = v[0]; s.vz = v[2]; s.spd = speed; s.bob = 0; s.bobVel = 0; s.init = true; }
    /* the travel direction from the camera's smoothed velocity: a bounce off a wall flips the car's velocity at
       once, the camera's turns over a moment */
    const sv = Math.hypot(s.vx, s.vz);
    if (sv > 4 && car.speed > -3) want = carYaw + 0.45 * wrap(Math.atan2(s.vx, s.vz) - carYaw);
    const w = (3.2 + Math.min(s.spd, 50) * 0.05) * opt.stiffness;
    const diff = wrap(want - s.yaw);
    s.yawVel += (w * w * diff - 2 * w * s.yawVel) * dt;
    s.yaw = wrap(s.yaw + s.yawVel * dt);
    /* position: a critically damped spring that also matches the car's velocity: no lag at a steady speed, and when
       the car is knocked or stops dead against a wall the camera eases to it over ~0.3 s instead of jumping */
    const wp = 7;
    s.vx += (wp * wp * (p.x - s.x) + 2 * wp * (v[0] - s.vx)) * dt;
    s.vz += (wp * wp * (p.z - s.z) + 2 * wp * (v[2] - s.vz)) * dt;
    s.x += s.vx * dt; s.z += s.vz * dt;
    /* the speed that sets distance and field of view changes smoothly too */
    s.spd += (speed - s.spd) * Math.min(1, dt * 2.5);
    /* height: a critically damped spring (bumps and kerbs are soaked up) */
    const wy = 4.5;
    s.yVel += (wy * wy * (p.y - s.y) - 2 * wy * s.yVel) * dt;
    s.y += s.yVel * dt;
    /* a hard hit (impact > 0.35: big landings) kicks a slow, small vertical bob */
    const imp = car.impact || 0;
    if (imp > 0.35 && imp > (s.lastImpact || 0) + 0.1) s.bobVel -= ((imp - 0.35) / 0.65) * 0.6 * opt.shake;
    s.lastImpact = imp;
    const wb = 9;
    s.bobVel += (-wb * wb * s.bob - 2 * 0.35 * wb * s.bobVel) * dt;
    s.bob += s.bobVel * dt;

    /* orbit from the mouse; swings back behind once you've let go for a moment and the car is moving */
    if (s.idle > opt.returnDelay && speed > 2) {
      const k = Math.min(1, dt * 2.2);
      s.orbitYaw -= wrap(s.orbitYaw) * k;
      s.orbitPitch -= s.orbitPitch * k;
    }

    const far = s.mode === 'far' ? 1.8 : 1;
    const dist = (len * 1.1 + 2.6) * opt.distance * s.zoom * far * (1 + Math.min(s.spd, 60) / 60 * 0.18);
    const pitch = Math.max(-0.15, Math.min(1.35, Math.atan2((tall * 0.9 + 0.7) * opt.height * (s.mode === 'far' ? 1.6 : 1), dist) + s.orbitPitch));
    const yaw = s.yaw + s.orbitYaw;
    target.set(s.x, s.y + tall * 0.55, s.z);
    camera.position.set(
      target.x - Math.sin(yaw) * Math.cos(pitch) * dist,
      target.y + Math.sin(pitch) * dist,
      target.z - Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    if (camera.position.y < s.y + 0.3) camera.position.y = s.y + 0.3;
    const ahead = s.orbitYaw === 0 && s.orbitPitch === 0 ? 1.5 + Math.min(s.spd, 50) * 0.05 : 0.5;
    look.set(target.x + Math.sin(s.yaw) * ahead, target.y, target.z + Math.cos(s.yaw) * ahead);

    /* the bob moves the camera only (not where it looks), plus a faint slow float at very high speed */
    const drift = opt.shake * Math.max(0, s.spd - 45) / 40 * 0.006;
    camera.position.y += Math.max(-0.08, Math.min(0.08, s.bob)) + drift * Math.sin(s.t * 6.3);
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    setFov(opt.fov + opt.fovBoost * Math.min(1, s.spd / 55), dt);
  }

  function setFov(f, dt) {
    s.fov += (f - s.fov) * Math.min(1, dt * 3);
    if (Math.abs(camera.fov - s.fov) > 0.01) { camera.fov = s.fov; camera.updateProjectionMatrix(); }
  }

  return {
    update,
    /** turn the camera around the car: pixels of mouse / finger movement */
    orbit(dx, dy) {
      s.orbitYaw = wrap(s.orbitYaw - dx * 0.006);
      s.orbitPitch = Math.max(-0.45, Math.min(1.1, s.orbitPitch + dy * 0.004));
      s.idle = 0;
    },
    /** move in (< 1) or out (> 1) */
    zoom(f) { s.zoom = Math.max(0.45, Math.min(3, s.zoom * f)); },
    /** 'chase' (default) · 'far' · 'hood' */
    setMode(m) { if (['chase', 'far', 'hood'].includes(m)) s.mode = m; },
    get mode() { return s.mode; },
    /** snap behind the car (after a reset or a new car) */
    reset() { s.init = false; s.orbitYaw = 0; s.orbitPitch = 0; s.yawVel = 0; },
    /** follow another car */
    setCar(c) { car = c; len = c.report.size.length; tall = c.report.size.height; s.init = false; },
    options: opt,
  };
}
