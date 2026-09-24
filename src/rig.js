/* Rig: turns a model + the detector's report into a car you can drive. three.js only, no physics.

   The model is never changed. New meshes share its materials and vertex buffers (only new triangle lists are made):
     car (Group)                     the car frame: +Z forward, +Y up, +X left, metres, y = 0 at the tyres' bottom
       body meshes                   everything that is not a wheel
       wheel mount i (Group)         the wheel centre; the suspension moves it up and down
         steer i (Group)             turns left / right (rotation.y)
           steer-only parts          brake calipers
           spin i (Group)            rolls (rotation.x; + rolls forward)
             wheel meshes            straightened: a wheel modelled already turned is turned straight

   Games normally never call this: create() does. */
import { Group, Mesh, Matrix4, Quaternion, Vector3, BufferGeometry } from 'three';

/**
 * @param {import('three').Object3D} model the loaded model (gltf.scene)
 * @param {ReturnType<import('./detect.js').detectWheels>} det an ok report
 */
export function buildRig(model, det) {
  model.updateMatrixWorld(true);
  const s = det.unitScale, L = det.left, U = det.up, F = det.forward;
  const origin = groundCentre(det);
  const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  /* raw world → car frame */
  const M = new Matrix4().set(
    s * L[0], s * L[1], s * L[2], -s * d(L, origin),
    s * U[0], s * U[1], s * U[2], -s * d(U, origin),
    s * F[0], s * F[1], s * F[2], -s * d(F, origin),
    0, 0, 0, 1,
  );
  const toCar = (p) => new Vector3(p[0], p[1], p[2]).applyMatrix4(M);

  const car = new Group();
  car.name = 'car';

  /* wheels: mount → steer → spin, and the matrix that moves a wheel's triangles from the car frame into its spin frame */
  const wheels = det.wheels.map((w, i) => {
    const centre = toCar(w.center);
    const axle = new Vector3(d(L, w.axle), d(U, w.axle), d(F, w.axle)).normalize();
    const straight = new Quaternion().setFromUnitVectors(axle, new Vector3(Math.sign(axle.x) || 1, 0, 0));
    const intoWheel = new Matrix4().makeRotationFromQuaternion(straight).multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
    const mount = new Group(), steer = new Group(), spin = new Group();
    mount.name = `wheel${i}`; steer.name = `wheel${i}.steer`; spin.name = `wheel${i}.spin`;
    mount.position.copy(centre);
    mount.add(steer); steer.add(spin); car.add(mount);
    return {
      index: i, mount, steer, spin, intoWheel, rest: centre.clone(),
      radius: w.radius * s, width: w.width * s, axle: w.axleIndex, left: w.left,
    };
  });

  /* split every mesh's triangles into body / wheel i / steer-only i */
  const bodyPoints = [];
  for (const [obj, owner] of det.owner) {
    const base = new Matrix4().multiplyMatrices(M, obj.matrixWorld);
    const parts = splitGeometry(obj.geometry, owner);
    for (const [key, geometry] of parts) {
      const mesh = new Mesh(geometry, obj.material);
      mesh.name = obj.name;
      mesh.castShadow = obj.castShadow; mesh.receiveShadow = obj.receiveShadow;
      mesh.renderOrder = obj.renderOrder; mesh.visible = obj.visible; mesh.frustumCulled = obj.frustumCulled;
      mesh.matrixAutoUpdate = false;
      if (key === -1) {
        mesh.matrix.copy(base);
        car.add(mesh);
        collectPoints(geometry, base, bodyPoints);
      } else {
        const w = wheels[key >= 0 ? key : -key - 2];
        mesh.matrix.multiplyMatrices(w.intoWheel, base);
        (key >= 0 ? w.spin : w.steer).add(mesh);
      }
    }
  }
  car.updateMatrixWorld(true);

  const box = bounds(bodyPoints);
  const axles = [...new Set(wheels.map((w) => w.axle))].map((a) => wheels.filter((w) => w.axle === a));
  const z = axles.map((ws) => ws.reduce((t, w) => t + w.rest.z, 0) / ws.length);
  return {
    object: car,
    wheels,
    bodyPoints,
    size: { length: box.max[2] - box.min[2], width: box.max[0] - box.min[0], height: box.max[1] - box.min[1] },
    box,
    wheelbase: z[0] - z[z.length - 1],
    track: Math.abs(axles[0][0].rest.x - (axles[0][1] || axles[0][0]).rest.x),
  };
}

/* the point between the wheels, at the tyres' bottom (raw units) */
function groundCentre(det) {
  const c = [0, 0, 0];
  for (const w of det.wheels) for (let k = 0; k < 3; k++) c[k] += w.center[k] / det.wheels.length;
  const bottom = Math.min(...det.wheels.map((w) => w.center[1] - w.radius));
  c[1] = bottom;
  return c;
}

/* one geometry per owner key; attributes are shared with the original, only the index is new */
function splitGeometry(g, owner) {
  const index = g.index ? g.index.array : null;
  const groups = g.groups && g.groups.length ? g.groups : [{ start: 0, count: index ? index.length : g.attributes.position.count, materialIndex: 0 }];
  /** @type {Map<number, Map<number, number[]>>} key → material → vertex indices */
  const out = new Map();
  for (const gr of groups) {
    for (let i = gr.start; i < gr.start + gr.count - 2; i += 3) {
      const t = (i / 3) | 0, key = owner[t] ?? -1;
      let byMat = out.get(key);
      if (!byMat) out.set(key, (byMat = new Map()));
      let list = byMat.get(gr.materialIndex ?? 0);
      if (!list) byMat.set(gr.materialIndex ?? 0, (list = []));
      if (index) list.push(index[i], index[i + 1], index[i + 2]); else list.push(i, i + 1, i + 2);
    }
  }
  const result = [];
  for (const [key, byMat] of out) {
    const geo = new BufferGeometry();
    for (const name in g.attributes) geo.setAttribute(name, g.attributes[name]);
    const all = [];
    for (const [mat, list] of byMat) {
      if (g.groups && g.groups.length) geo.addGroup(all.length, list.length, mat);
      for (const v of list) all.push(v);
    }
    geo.setIndex(all);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    result.push([key, geo]);
  }
  return result;
}

function collectPoints(geo, m, out) {
  const p = geo.attributes.position, idx = geo.index.array, v = new Vector3(), seen = new Set();
  for (let i = 0; i < idx.length; i++) {
    const k = idx[i];
    if (seen.has(k)) continue;
    seen.add(k);
    v.fromBufferAttribute(p, k).applyMatrix4(m);
    out.push(v.x, v.y, v.z);
  }
}

function bounds(pts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) for (let k = 0; k < 3; k++) {
    if (pts[i + k] < min[k]) min[k] = pts[i + k];
    if (pts[i + k] > max[k]) max[k] = pts[i + k];
  }
  return { min, max };
}
