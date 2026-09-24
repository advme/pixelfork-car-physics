/* A ready physics world, for games that don't have one. No three.js.

   CAR.create() needs `physics`: an object with { world, layers: { moving, static }, step(dt), sync(alpha) }.
   A game engine whose crashcat helper already makes that shape passes its own. Otherwise:

     const physics = CAR.createPhysics({ floor: 400 });   // gravity -9.81, a 400 m static floor at y = 0
     // every frame, with a fixed step:
     physics.step(1 / 60);  physics.sync(1);  renderer.render(scene, camera);

   Your own bodies go in with crashcat's API: rigidBody.create(physics.world, { ..., objectLayer: physics.layers.static }). */
import { addBroadphaseLayer, addObjectLayer, createWorld, createWorldSettings, enableCollision, registerAll, rigidBody, updateWorld, box, MotionType } from 'crashcat';

let registered = false;

/** @param {{ gravity?: number[], floor?: number | false }} [o] */
export function createPhysics(o = {}) {
  if (!registered) { registerAll(); registered = true; }
  const settings = createWorldSettings();
  const moving = addObjectLayer(settings, addBroadphaseLayer(settings));
  const still = addObjectLayer(settings, addBroadphaseLayer(settings));
  enableCollision(settings, moving, still);
  enableCollision(settings, moving, moving);
  const world = createWorld(settings);
  const g = Array.isArray(o.gravity) && o.gravity.length === 3 ? o.gravity : [0, -9.81, 0];
  world.settings.gravity = g.map((v) => Number(v) || 0);

  const physics = {
    world,
    layers: Object.freeze({ moving, static: still }),
    listener: undefined,
    step(dt) { if (dt > 0) updateWorld(world, physics.listener, dt); },
    sync() {},
  };
  if (o.floor) {
    const h = Math.max(1, Number(o.floor) || 400) / 2;
    rigidBody.create(world, { shape: box.create({ halfExtents: [h, 0.5, h] }), motionType: MotionType.STATIC, objectLayer: still, position: [0, -0.5, 0], friction: 0.9 });
  }
  return physics;
}
