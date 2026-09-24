/* Pixelfork Car Physics v0.9.0 · needs three@0.186.0 and crashcat@0.0.5 from the import map · © 2026 Pixelfork, see LICENSE */

// src/detect.js
var RAW = { UP: 1 };
function detectWheels(root, o = {}) {
  const notes = [];
  const meshes = collect(root);
  if (!meshes.length) return fail("the model has no meshes", notes);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = m.pos[i + k];
    if (v < mn[k]) mn[k] = v;
    if (v > mx[k]) mx[k] = v;
  }
  const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const diag = Math.hypot(ext[0], ext[1], ext[2]);
  if (!(diag > 0)) return fail("the model is empty (zero size)", notes);
  const LONG = ext[0] > ext[2] ? 0 : 2, LAT = LONG === 0 ? 2 : 0;
  const length = ext[LONG], width = ext[LAT], height = ext[RAW.UP];
  const latMid = (mn[LAT] + mx[LAT]) / 2;
  const latAxis = [0, 0, 0];
  latAxis[LAT] = 1;
  const islands = [];
  for (const m of meshes) splitIslands(m, mn, diag * 1e-5, islands);
  const cands = [];
  for (const isl of islands) {
    isl.stats = stats(isl);
    const c = isl.stats;
    const size = Math.max(c.size[0], c.size[1], c.size[2]);
    if (isl.tris.length < 8 || size < 0.02 * length || size > 0.5 * length) continue;
    if (c.center[RAW.UP] > mn[RAW.UP] + 0.6 * height) continue;
    if (Math.abs(c.center[LAT] - latMid) < 0.25 * width / 2) continue;
    const round = roundness(isl, c, latAxis);
    if (round) cands.push({ isl, ...round });
  }
  if (!cands.length) return fail("no round wheel-shaped parts found (the wheels may be merged into the body)", notes, islands.length);
  cands.sort((a, b) => b.radius - a.radius);
  let wheels = [];
  for (const c of cands) {
    const w = wheels.find((w2) => {
      const { axial, radial } = offset(c.center, w2);
      return radial < 0.25 * w2.radius && axial < w2.width / 2 + 0.6 * w2.radius && c.radius <= w2.radius * 1.05;
    });
    if (w) {
      w.spin.push(c.isl);
      continue;
    }
    wheels.push({ center: c.center, axle: c.axle, radius: c.radius, width: c.width, spin: [c.isl], knuckle: [], tyre: c.isl });
  }
  const maxR = Math.max(...wheels.map((w) => w.radius));
  wheels = wheels.filter((w) => w.radius >= 0.55 * maxR);
  const bottom = (w) => w.center[RAW.UP] - w.radius;
  const lowest = Math.min(...wheels.map(bottom));
  wheels = wheels.filter((w) => bottom(w) <= lowest + 0.35 * maxR);
  const lefts = wheels.filter((w) => w.center[LAT] > latMid), rights = wheels.filter((w) => w.center[LAT] <= latMid);
  const axles = [];
  for (const l of lefts) {
    let best = null, bd = Infinity;
    for (const r of rights) {
      if (r.paired) continue;
      const d = Math.abs(r.center[LONG] - l.center[LONG]);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    if (best && bd < 0.5 * Math.max(l.radius, best.radius)) {
      best.paired = true;
      axles.push([l, best]);
    } else notes.push(`a wheel without a partner on the other side was ignored (at ${fmt(l.center)})`);
  }
  for (const r of rights) if (!r.paired) notes.push(`a wheel without a partner on the other side was ignored (at ${fmt(r.center)})`);
  if (axles.length < 2) return fail(`found ${wheels.length} wheel(s) but not two axles (need 4 wheels in left/right pairs)`, notes, islands.length, cands.length);
  if (axles.length > 4) {
    notes.push(`${axles.length} axles found; only the 4 lowest-and-largest are used`);
    axles.length = 4;
  }
  const used = new Set(axles.flat().flatMap((w) => w.spin));
  for (const isl of islands) {
    if (used.has(isl)) continue;
    const c = isl.stats;
    for (const w of axles.flat()) {
      if (!inside(isl, w)) continue;
      const { radial } = offset(c.center, w);
      const size = Math.max(c.size[0], c.size[1], c.size[2]);
      if (radial < 0.15 * w.radius || size < 0.25 * w.radius) w.spin.push(isl);
      else w.knuckle.push(isl);
      used.add(isl);
      break;
    }
  }
  const facing = guessForward(o.forward, axles, islands, used, { LONG, LAT, mn, mx, length, height }, notes);
  const fwd = [0, 0, 0];
  fwd[LONG] = facing.sign;
  const left = [fwd[2], 0, -fwd[0]];
  const along = (p) => p[LONG] * facing.sign;
  axles.sort((a, b) => along(b[0].center) - along(a[0].center));
  const unitScale = o.length > 0 ? o.length / length : guessUnits(length, notes);
  const out = [];
  axles.forEach((pair, ai) => {
    for (const w of pair) {
      const isLeft = (w.center[0] - (mn[0] + mx[0]) / 2) * left[0] + (w.center[2] - (mn[2] + mx[2]) / 2) * left[2] > 0;
      out.push({ center: w.center, axle: w.axle, radius: w.radius, width: w.width, axleIndex: ai, left: isLeft, spin: w.spin, knuckle: w.knuckle });
    }
  });
  out.sort((a, b) => a.axleIndex - b.axleIndex || (b.left ? 1 : 0) - (a.left ? 1 : 0));
  const owner = new Map(meshes.map((m) => [m.object, new Int32Array(m.triCount).fill(-1)]));
  out.forEach((w, i) => {
    for (const isl of w.spin) {
      const a = owner.get(isl.mesh.object);
      for (const t of isl.tris) a[t] = i;
    }
    for (const isl of w.knuckle) {
      const a = owner.get(isl.mesh.object);
      for (const t of isl.tris) a[t] = -(i + 2);
    }
  });
  return {
    ok: true,
    reason: "",
    up: [0, 1, 0],
    forward: fwd,
    left,
    unitScale,
    frontConfidence: facing.confidence,
    size: { length, width, height },
    wheels: out.map(({ spin, knuckle, ...w }) => ({ ...w, parts: spin.length, steerOnlyParts: knuckle.length })),
    owner,
    notes,
    counts: { meshes: meshes.length, islands: islands.length, candidates: cands.length }
  };
}
function fail(reason, notes, islands = 0, candidates = 0) {
  return { ok: false, reason, notes, wheels: [], counts: { islands, candidates } };
}
var fmt = (p) => p.map((v) => +v.toFixed(2)).join(", ");
function collect(root) {
  root.updateMatrixWorld(true);
  const list = [];
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry || !obj.geometry.attributes.position) return;
    if (obj.isSkinnedMesh) return;
    const g = obj.geometry, a = g.attributes.position, e = obj.matrixWorld.elements;
    const n = a.count, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      pos[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    const index = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: n - n % 3 }, (_, i) => i);
    list.push({ object: obj, pos, index, triCount: index.length / 3 | 0 });
  });
  return list;
}
function splitIslands(m, mn, q, out) {
  const n = m.pos.length / 3;
  const B = 131072, weld = new Int32Array(n), seen = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.round((m.pos[i * 3] - mn[0]) / q) + Math.round((m.pos[i * 3 + 1] - mn[1]) / q) * B + Math.round((m.pos[i * 3 + 2] - mn[2]) / q) * B * B;
    let id = seen.get(key);
    if (id === void 0) {
      id = i;
      seen.set(key, i);
    }
    weld[i] = id;
  }
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const I = m.index;
  for (let t = 0; t < I.length - 2; t += 3) {
    const a = find(weld[I[t]]), b = find(weld[I[t + 1]]), c = find(weld[I[t + 2]]);
    if (a !== b) parent[a] = b;
    const b2 = find(b);
    if (find(c) !== b2) parent[find(c)] = b2;
  }
  const byRoot = /* @__PURE__ */ new Map();
  for (let t = 0; t < m.triCount; t++) {
    const r = find(weld[I[t * 3]]);
    let isl = byRoot.get(r);
    if (!isl) {
      isl = { mesh: m, tris: [] };
      byRoot.set(r, isl);
      out.push(isl);
    }
    isl.tris.push(t);
  }
}
function* corners(isl) {
  const { pos, index } = isl.mesh;
  for (const t of isl.tris) for (let k = 0; k < 3; k++) yield index[t * 3 + k] * 3;
}
function stats(isl) {
  const pos = isl.mesh.pos;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], mean = [0, 0, 0];
  let n = 0;
  for (const i of corners(isl)) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
      mean[k] += v;
    }
    n++;
  }
  for (let k = 0; k < 3; k++) mean[k] /= n;
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const i of corners(isl)) {
    const d = [pos[i] - mean[0], pos[i + 1] - mean[1], pos[i + 2] - mean[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r * 3 + c] += d[r] * d[c];
  }
  return { min: mn, max: mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]], center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], mean, cov };
}
function roundness(isl, s, latAxis) {
  const eig = jacobi(s.cov);
  let axle = eig.vectors[eig.order[0]];
  if (Math.abs(dot(axle, latAxis)) < Math.cos(35 * Math.PI / 180)) axle = latAxis;
  if (dot(axle, latAxis) < 0) axle = axle.map((v2) => -v2);
  axle[1] = 0;
  const al = Math.hypot(axle[0], axle[2]);
  axle = [axle[0] / al, 0, axle[2] / al];
  const u = [0, 1, 0], v = cross(axle, u);
  const dirs = [];
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 8;
    dirs.push([u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)]);
  }
  const lo = new Array(8).fill(Infinity), hi = new Array(8).fill(-Infinity);
  let alo = Infinity, ahi = -Infinity;
  const pos = isl.mesh.pos;
  for (const i of corners(isl)) {
    const p = [pos[i], pos[i + 1], pos[i + 2]];
    for (let k = 0; k < 8; k++) {
      const d = dot(p, dirs[k]);
      if (d < lo[k]) lo[k] = d;
      if (d > hi[k]) hi[k] = d;
    }
    const a = dot(p, axle);
    if (a < alo) alo = a;
    if (a > ahi) ahi = a;
  }
  const spans = hi.map((h, k) => h - lo[k]);
  const smin = Math.min(...spans), smax = Math.max(...spans);
  if (!(smax > 0) || smin / smax < 0.88) return null;
  const radius = (smin + smax) / 4, width = ahi - alo;
  if (width > 1.1 * 2 * radius) return null;
  const cu = (lo[0] + hi[0]) / 2, cv = (lo[4] + hi[4]) / 2, ca = (alo + ahi) / 2;
  const center = [0, 1, 2].map((k) => u[k] * cu + v[k] * cv + axle[k] * ca);
  return { axle, center, radius, width };
}
function offset(p, w) {
  const d = [p[0] - w.center[0], p[1] - w.center[1], p[2] - w.center[2]];
  const axial = dot(d, w.axle);
  const radial = Math.hypot(d[0] - axial * w.axle[0], d[1] - axial * w.axle[1], d[2] - axial * w.axle[2]);
  return { axial: Math.abs(axial), radial };
}
function inside(isl, w) {
  const s = isl.stats, R = w.radius * 1.03, half = w.width / 2 + 0.5 * w.radius;
  for (let k = 0; k < 3; k++) if (s.min[k] < w.center[k] - Math.max(R, half) - 1e-9 || s.max[k] > w.center[k] + Math.max(R, half) + 1e-9) return false;
  const pos = isl.mesh.pos;
  for (const i of corners(isl)) {
    const d = [pos[i] - w.center[0], pos[i + 1] - w.center[1], pos[i + 2] - w.center[2]];
    const a = dot(d, w.axle);
    if (Math.abs(a) > half) return false;
    if (Math.hypot(d[0] - a * w.axle[0], d[1] - a * w.axle[1], d[2] - a * w.axle[2]) > R) return false;
  }
  return true;
}
function guessForward(forced, axles, islands, used, box3, notes) {
  const { LONG } = box3;
  if (typeof forced === "string") {
    const m = /^([+-])([xz])$/i.exec(forced.trim());
    if (m && "xz".indexOf(m[2].toLowerCase()) * 2 === LONG) return { sign: m[1] === "-" ? -1 : 1, confidence: 1 };
    if (m) notes.push(`forward "${forced}" is across the car, not along it; guessed instead`);
    else notes.push(`forward "${forced}" is not one of +x -x +z -z; guessed instead`);
  }
  const mid = (axles[0][0].center[LONG] + axles[axles.length - 1][0].center[LONG]) / 2;
  let score = 0;
  const why = [];
  for (const pair of axles) {
    const turn = Math.max(...pair.map((w) => Math.abs(w.axle[LONG])));
    if (turn > Math.sin(3 * Math.PI / 180)) {
      score += 3 * Math.sign(pair[0].center[LONG] - mid);
      why.push("turned wheels");
    }
  }
  let sum = 0, n = 0;
  const roofY = box3.mn[1] + 0.85 * box3.height;
  for (const isl of islands) {
    if (used.has(isl)) continue;
    const pos = isl.mesh.pos;
    for (const i of corners(isl)) if (pos[i + 1] > roofY) {
      sum += pos[i + LONG];
      n++;
    }
  }
  if (n) {
    const shift = (sum / n - mid) / box3.length;
    score += -Math.sign(shift) * Math.min(1, Math.abs(shift) / 0.05);
    why.push(`roof ${shift > 0 ? "+" : "-"}${Math.abs(shift * 100).toFixed(0)}%`);
  }
  const sign = score >= 0 ? 1 : -1;
  const confidence = Math.min(1, Math.abs(score) / 2);
  if (confidence < 0.5) notes.push(`not sure which end is the front (${why.join(", ") || "no clues"}); pass forward: '+z' etc. to be sure`);
  return { sign, confidence };
}
function guessUnits(length, notes) {
  for (const [s, name] of [[1, "metres"], [0.01, "centimetres"], [1e-3, "millimetres"], [0.1, "decimetres"], [0.0254, "inches"]]) {
    const L = length * s;
    if (L >= 2.5 && L <= 12) return s;
    void name;
  }
  notes.push(`the model's units are unclear (length ${length.toFixed(2)}); scaled to 4.4 m long`);
  return 4.4 / length;
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function jacobi(m) {
  const a = m.slice(), v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]);
    if (off < 1e-12 * (Math.abs(a[0]) + Math.abs(a[4]) + Math.abs(a[8]) + 1e-30)) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-30) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p], akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k], aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p], vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const vals = [a[0], a[4], a[8]];
  const vectors = [0, 1, 2].map((c) => [v[c], v[3 + c], v[6 + c]]);
  const order = [0, 1, 2].sort((x, y) => vals[x] - vals[y]);
  return { values: vals, vectors, order };
}

// src/rig.js
import { Group, Mesh, Matrix4, Quaternion, Vector3, BufferGeometry } from "three";
function buildRig(model, det) {
  model.updateMatrixWorld(true);
  const s = det.unitScale, L = det.left, U = det.up, F = det.forward;
  const origin = groundCentre(det);
  const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const M = new Matrix4().set(
    s * L[0],
    s * L[1],
    s * L[2],
    -s * d(L, origin),
    s * U[0],
    s * U[1],
    s * U[2],
    -s * d(U, origin),
    s * F[0],
    s * F[1],
    s * F[2],
    -s * d(F, origin),
    0,
    0,
    0,
    1
  );
  const toCar = (p) => new Vector3(p[0], p[1], p[2]).applyMatrix4(M);
  const car = new Group();
  car.name = "car";
  const wheels = det.wheels.map((w, i) => {
    const centre = toCar(w.center);
    const axle = new Vector3(d(L, w.axle), d(U, w.axle), d(F, w.axle)).normalize();
    const straight = new Quaternion().setFromUnitVectors(axle, new Vector3(Math.sign(axle.x) || 1, 0, 0));
    const intoWheel = new Matrix4().makeRotationFromQuaternion(straight).multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
    const mount = new Group(), steer = new Group(), spin = new Group();
    mount.name = `wheel${i}`;
    steer.name = `wheel${i}.steer`;
    spin.name = `wheel${i}.spin`;
    mount.position.copy(centre);
    mount.add(steer);
    steer.add(spin);
    car.add(mount);
    return {
      index: i,
      mount,
      steer,
      spin,
      intoWheel,
      rest: centre.clone(),
      radius: w.radius * s,
      width: w.width * s,
      axle: w.axleIndex,
      left: w.left
    };
  });
  const bodyPoints = [];
  for (const [obj, owner] of det.owner) {
    const base = new Matrix4().multiplyMatrices(M, obj.matrixWorld);
    const parts = splitGeometry(obj.geometry, owner);
    for (const [key, geometry] of parts) {
      const mesh = new Mesh(geometry, obj.material);
      mesh.name = obj.name;
      mesh.castShadow = obj.castShadow;
      mesh.receiveShadow = obj.receiveShadow;
      mesh.renderOrder = obj.renderOrder;
      mesh.visible = obj.visible;
      mesh.frustumCulled = obj.frustumCulled;
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
  const box3 = bounds(bodyPoints);
  const axles = [...new Set(wheels.map((w) => w.axle))].map((a) => wheels.filter((w) => w.axle === a));
  const z = axles.map((ws) => ws.reduce((t, w) => t + w.rest.z, 0) / ws.length);
  return {
    object: car,
    wheels,
    bodyPoints,
    size: { length: box3.max[2] - box3.min[2], width: box3.max[0] - box3.min[0], height: box3.max[1] - box3.min[1] },
    box: box3,
    wheelbase: z[0] - z[z.length - 1],
    track: Math.abs(axles[0][0].rest.x - (axles[0][1] || axles[0][0]).rest.x)
  };
}
function groundCentre(det) {
  const c = [0, 0, 0];
  for (const w of det.wheels) for (let k = 0; k < 3; k++) c[k] += w.center[k] / det.wheels.length;
  const bottom = Math.min(...det.wheels.map((w) => w.center[1] - w.radius));
  c[1] = bottom;
  return c;
}
function splitGeometry(g, owner) {
  const index = g.index ? g.index.array : null;
  const groups = g.groups && g.groups.length ? g.groups : [{ start: 0, count: index ? index.length : g.attributes.position.count, materialIndex: 0 }];
  const out = /* @__PURE__ */ new Map();
  for (const gr of groups) {
    for (let i = gr.start; i < gr.start + gr.count - 2; i += 3) {
      const t = i / 3 | 0, key = owner[t] ?? -1;
      let byMat = out.get(key);
      if (!byMat) out.set(key, byMat = /* @__PURE__ */ new Map());
      let list = byMat.get(gr.materialIndex ?? 0);
      if (!list) byMat.set(gr.materialIndex ?? 0, list = []);
      if (index) list.push(index[i], index[i + 1], index[i + 2]);
      else list.push(i, i + 1, i + 2);
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
  const p = geo.attributes.position, idx = geo.index.array, v = new Vector3(), seen = /* @__PURE__ */ new Set();
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

// src/vehicle.js
import {
  rigidBody,
  castRay,
  createClosestCastRayCollector,
  createDefaultCastRaySettings,
  castShape,
  createClosestCastShapeCollector,
  createDefaultCastShapeSettings,
  filter as filterNs,
  convexHull,
  box,
  cylinder,
  offsetCenterOfMass,
  massProperties,
  motionProperties,
  MotionType
} from "crashcat";
var PRESETS = {
  car: { mass: 1400, power: 230, topSpeed: 210, drive: "awd", grip: 1.3, steer: 36, steerSpeed: 1, stiffness: 1.3, damping: 0.72, antiRoll: 0.45, travel: 0.26, engineBrake: 0.8, redline: 6800, gears: 6, shiftTime: 0.2, assist: 1, handbrakeGrip: 0.5 },
  sport: { mass: 1450, power: 420, topSpeed: 290, drive: "rwd", grip: 1.45, steer: 34, steerSpeed: 1.1, stiffness: 1.55, damping: 0.75, antiRoll: 0.6, travel: 0.24, engineBrake: 0.7, redline: 8e3, gears: 7, shiftTime: 0.12, assist: 1, handbrakeGrip: 0.45 },
  classic: { mass: 1100, power: 100, topSpeed: 160, drive: "rwd", grip: 1.1, steer: 38, steerSpeed: 0.9, stiffness: 1.1, damping: 0.78, antiRoll: 0.35, travel: 0.28, engineBrake: 1, redline: 6e3, gears: 4, shiftTime: 0.35, assist: 1, handbrakeGrip: 0.5 },
  offroad: { mass: 2100, power: 290, topSpeed: 175, drive: "awd", grip: 1.2, steer: 36, steerSpeed: 0.9, stiffness: 1, damping: 0.72, antiRoll: 0.55, travel: 0.4, engineBrake: 1.1, redline: 5500, gears: 5, shiftTime: 0.3, assist: 1, handbrakeGrip: 0.55 }
};
var TUNING = {
  mass: [500, 5e3, "kg"],
  power: [20, 1200, "kW"],
  topSpeed: [60, 420, "km/h"],
  grip: [0.4, 3, "tyre friction"],
  steer: [10, 55, "\xB0 full lock at a standstill"],
  steerSpeed: [0.3, 3, "how fast the wheel turns"],
  stiffness: [0.5, 3.5, "Hz spring"],
  damping: [0.2, 1.6, "\xD7 critical"],
  antiRoll: [0, 2, "anti-roll bars"],
  travel: [0.08, 0.6, "m suspension travel"],
  engineBrake: [0, 3, "slowing when you lift"],
  redline: [3e3, 11e3, "rpm"],
  gears: [1, 9, "forward gears"],
  shiftTime: [0.02, 1, "s per gear change"],
  assist: [0, 1, "traction + stability help"],
  handbrakeGrip: [0.1, 1, "rear grip with the handbrake"]
};
var G = 9.81;
var TO_RPM = 60 / (2 * Math.PI);
function createVehicle(physics, shape, o = {}) {
  const P = { ...PRESETS.car, ...PRESETS[o.preset] || {}, ...pick(o) };
  const { world } = physics;
  const wheels = shape.wheels.map((w) => ({ ...w, rest: [w.rest.x, w.rest.y, w.rest.z] }));
  const n = wheels.length;
  const axleCount = Math.max(...wheels.map((w) => w.axle)) + 1;
  const rMin = Math.min(...wheels.map((w) => w.radius));
  const clearance = rMin * 0.65;
  const pts = [];
  const stride = Math.max(1, Math.ceil(shape.bodyPoints.length / 3 / 3e3));
  for (let i = 0; i < shape.bodyPoints.length; i += 3 * stride) {
    pts.push(shape.bodyPoints[i], Math.max(clearance, shape.bodyPoints[i + 1]), shape.bodyPoints[i + 2]);
  }
  let hull;
  try {
    hull = convexHull.create({ positions: pts, convexRadius: 0.03 });
  } catch {
    hull = null;
  }
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
    allowSleeping: false
  });
  const driven = (w) => P.drive === "awd" || (P.drive === "fwd" ? w.axle === 0 : w.axle === axleCount - 1);
  const steers = (w) => w.axle === 0;
  const rearZ = avg(wheels.filter((w) => w.axle === axleCount - 1).map((w) => w.rest[2]));
  const wheelbase = Math.max(0.5, avg(wheels.filter((w) => w.axle === 0).map((w) => w.rest[2])) - rearZ);
  for (const w of wheels) {
    w.probe = cylinder.create({ halfHeight: Math.max(0.04, w.width * 0.45), radius: w.radius, convexRadius: Math.min(0.05, w.radius * 0.2) });
    w.grounded = false;
    w.load = 0;
    w.steer = 0;
    w.spin = 0;
    w.omega = 0;
    w.slip = 0;
    w.skid = 0;
    w.alpha = 0;
    w.slide = 0;
    w.spinSlip = 0;
    w.lock = 0;
    w.contact = [0, 0, 0];
    w.normal = [0, 1, 0];
    w.hitBody = null;
  }
  const D = {};
  function derive() {
    D.corner = P.mass / n;
    D.k = D.corner * (2 * Math.PI * P.stiffness) ** 2;
    D.cBump = 2 * P.damping * 0.65 * Math.sqrt(D.k * D.corner);
    D.cRebound = 2 * P.damping * 1.35 * Math.sqrt(D.k * D.corner);
    D.bump = Math.max(0.12, P.travel * 0.5);
    D.travel = Math.max(P.travel, D.bump + 0.06);
    D.sag = D.corner * G / D.k;
    for (const w of wheels) {
      w.sMax = D.travel;
      w.free = D.bump + D.sag;
    }
    D.N0 = D.corner * G;
    D.I = { pitch: P.mass * (bh * bh + bl * bl) / 12, yaw: P.mass * (bl * bl + bw * bw) / 12, roll: P.mass * (bh * bh + bw * bw) / 12 };
    const gearsN = Math.round(P.gears);
    const top = gearsN >= 5 ? 0.78 : gearsN === 4 ? 1 : 1.2, first = gearsN === 1 ? top : 3.4;
    D.ratios = Array.from({ length: gearsN }, (_, i) => gearsN === 1 ? first : first * (top / first) ** (i / (gearsN - 1)));
    D.rDrive = avg(wheels.filter(driven).map((w) => w.radius)) || rMin;
    D.vTop = P.topSpeed / 3.6;
    D.redW = P.redline / TO_RPM;
    D.final = D.redW * D.rDrive / (D.ratios[gearsN - 1] * D.vTop * 1.04);
    let best = 0;
    for (let x = 0.1; x <= 1; x += 0.01) best = Math.max(best, torqueCurve(x) * x);
    D.Tpeak = P.power * 1e3 / (best * D.redW);
    D.idle = Math.min(1e3, P.redline * 0.14);
    D.launch = P.redline * 0.45;
    const xTop = 1 / 1.04;
    D.drag = D.Tpeak * torqueCurve(xTop) * xTop * D.redW * 0.92 / D.vTop ** 3;
    if (state.gear > gearsN) state.gear = gearsN;
  }
  function torqueCurve(x) {
    if (x < 0.15) return 0.55;
    if (x < 0.6) return 0.55 + 0.45 * smooth((x - 0.15) / 0.45);
    if (x < 0.85) return 1;
    return 1 - 0.3 * Math.min(1, (x - 0.85) / 0.15);
  }
  const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  const state = { steer: 0, throttle: 0, brake: 0, speed: 0, reversing: false, grounded: 0, assist: 1, gear: 1, rpm: 800, shift: 0, impact: 0, limiter: false, donut: 0 };
  derive();
  for (const w of wheels) {
    w.s = D.bump;
    w.sPrev = D.bump;
    w.sDraw = D.bump;
  }
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
  const toWorld = (out, local) => {
    rotate(out, body.quaternion, local);
    out[0] += body.position[0];
    out[1] += body.position[1];
    out[2] += body.position[2];
    return out;
  };
  const damper = (vs) => {
    const cc = vs < 0 ? D.cBump : D.cRebound, a = Math.abs(vs), knee = 0.25;
    return -Math.sign(vs) * cc * (a < knee ? a : knee + (a - knee) * 0.3);
  };
  function step(dt) {
    const q = body.quaternion;
    rotate(R, q, [1, 0, 0]);
    rotate(U, q, [0, 1, 0]);
    rotate(F, q, [0, 0, 1]);
    const bv = body.motionProperties.linearVelocity, av = body.motionProperties.angularVelocity;
    const vF = dot2(bv, F), vL = dot2(bv, R);
    state.speed = vF;
    state.impact *= Math.exp(-dt * 5);
    const tIn = clamp(input.throttle, 0, 1), bIn = clamp(input.brake, 0, 1);
    if (state.reversing) {
      if (tIn > 0.05 && vF > -0.5) {
        state.reversing = false;
        state.gear = 1;
      }
    } else if (bIn > 0.05 && vF < 0.5 && tIn < 0.05) {
      state.reversing = true;
    }
    const demandIn = state.reversing ? bIn : tIn, brakeIn = state.reversing ? tIn : bIn;
    state.throttle += clamp(demandIn - state.throttle, -dt * 10, dt * 5);
    state.brake += clamp(brakeIn - state.brake, -dt * 12, dt * 7);
    const demand = state.throttle, brake = state.brake;
    const hand = !!input.handbrake;
    const donutWanted = hand && tIn > 0.5 && Math.abs(input.steer) > 0.5 && !state.reversing && state.grounded >= 3 && Math.abs(vF) < (state.donut > 0.2 ? 14 : 9);
    state.donut = clamp(state.donut + (donutWanted ? dt / 0.3 : -dt / 0.3), 0, 1);
    const donut = state.donut;
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
      if (!steers(w)) {
        w.steer = 0;
        continue;
      }
      const wb = w.rest[2] - rearZ;
      w.steer = Math.abs(delta) < 1e-4 || wb <= 0 ? delta : Math.atan(wb / (wb / Math.tan(delta) - w.rest[0]));
    }
    let grounded = 0;
    for (const w of wheels) {
      const mount = toWorld(w.mountWorld || (w.mountWorld = v3()), [w.rest[0], w.rest[1] + D.bump, w.rest[2]]);
      w.sPrev = w.s;
      if (!sweep(w, mount) && !ray(w, mount)) {
        w.s = w.sMax;
        w.grounded = false;
        w.hitBody = null;
        continue;
      }
      w.grounded = true;
      grounded++;
    }
    state.grounded = grounded;
    const stop = D.bump * 0.25;
    for (const w of wheels) {
      if (!w.grounded) {
        w.load = 0;
        continue;
      }
      const vs = clamp((w.s - w.sPrev) / dt, -6, 6);
      let f = D.k * (w.free - w.s) + damper(vs);
      if (w.s < stop) {
        const d = Math.min(2, (stop - w.s) / stop);
        f += D.k * 4 * d * d * stop + (vs < 0 ? -D.cBump * 0.5 * Math.max(vs, -1) : 0);
      }
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
    const drivenGrounded = wheels.filter((w) => driven(w) && w.grounded);
    const gearsN = D.ratios.length;
    if (state.reversing) state.gear = -1;
    else if (state.gear < 1) state.gear = 1;
    const ratio = state.gear === -1 ? D.ratios[0] : D.ratios[state.gear - 1];
    const wheelW = drivenGrounded.length ? Math.abs(avg(drivenGrounded.map((w) => w.vl || 0))) / D.rDrive : Math.abs(avg(wheels.filter(driven).map((w) => w.omega)));
    const rpmWheels = wheelW * ratio * D.final * TO_RPM;
    let rpmTarget = Math.max(D.idle, rpmWheels);
    if (rpmWheels < D.launch && demand > 0.05) rpmTarget = Math.max(rpmWheels, D.idle + demand * (D.launch - D.idle));
    if (!grounded && demand > 0.05) rpmTarget = Math.max(rpmTarget, P.redline * (0.6 + 0.4 * demand));
    if (donut > 0) rpmTarget = Math.max(rpmTarget, D.idle + donut * demand * (P.redline * 0.78 - D.idle));
    state.rpm += (Math.min(rpmTarget, P.redline * 1.02) - state.rpm) * Math.min(1, dt * (state.shift > 0 ? 8 : 20));
    const x = state.rpm / P.redline;
    let torque = 0;
    state.limiter = false;
    if (state.shift > 0) state.shift -= dt;
    else if (demand > 0.02) {
      torque = demand * D.Tpeak * torqueCurve(x);
      if (rpmWheels >= P.redline) {
        torque = 0;
        state.limiter = true;
      }
      if (state.gear === -1 && vF < -11) torque = 0;
    } else if (rpmWheels > D.idle * 1.2) {
      torque = -P.engineBrake * D.Tpeak * (0.1 + 0.3 * x);
    }
    const driveForce = torque * ratio * D.final * 0.9 / D.rDrive * (state.gear === -1 ? -1 : 1);
    if (state.gear >= 1 && state.shift <= 0 && grounded >= 2) {
      const xw = rpmWheels / P.redline;
      if (state.gear < gearsN && xw > (demand > 0.3 ? 0.92 : 0.55)) {
        state.gear++;
        state.shift = P.shiftTime;
      } else if (state.gear > 1) {
        const xLow = xw * (D.ratios[state.gear - 2] / D.ratios[state.gear - 1]);
        if (xLow < 0.85 && (xw < 0.33 || demand > 0.8 && xw < 0.55)) {
          state.gear--;
          state.shift = P.shiftTime * 0.6;
        }
      }
      if (Math.abs(vF) < 1 && state.gear > 1) state.gear = 1;
    }
    const stopping = demand < 0.05 && brake < 0.05 && Math.abs(vF) < 0.6 && tIn < 0.05 && bIn < 0.05;
    const kill = D.corner / dt;
    for (const w of wheels) {
      if (!w.grounded) {
        w.omega *= Math.exp(-0.6 * dt);
        if (driven(w)) w.omega += (state.gear === -1 ? -1 : 1) * demand * 60 * dt;
        w.omega = clamp(w.omega, -D.redW / (ratio * D.final), D.redW / (ratio * D.final));
        w.spin += w.omega * dt;
        w.skid = 0;
        w.vl = 0;
        w.slide = 0;
        w.spinSlip = 0;
        w.lock = 0;
        continue;
      }
      const N = w.load;
      const centre = toWorld(v3(), [w.rest[0], w.rest[1] + D.bump - w.s, w.rest[2]]);
      addForce(scale(tmp, U, N), centre);
      const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
      const fw = [F[0] * cs + R[0] * sn, F[1] * cs + R[1] * sn, F[2] * cs + R[2] * sn];
      const nrm = w.normal, fd = dot2(fw, nrm);
      const fg = normalize([fw[0] - nrm[0] * fd, fw[1] - nrm[1] * fd, fw[2] - nrm[2] * fd]);
      const lg = cross2(nrm, fg);
      rigidBody.getVelocityAtPoint(vel, body, w.contact);
      if (w.hitBody && w.hitBody.motionType !== MotionType.STATIC) {
        const gv = rigidBody.getVelocityAtPoint(v3(), w.hitBody, w.contact);
        vel[0] -= gv[0];
        vel[1] -= gv[1];
        vel[2] -= gv[2];
      }
      const vl = dot2(vel, fg), vt = dot2(vel, lg);
      w.vl = vl;
      const rear = w.axle === axleCount - 1 && axleCount > 1;
      const locked = hand && rear && donut < 0.5;
      const donutRear = rear && donut > 0;
      const loadFactor = clamp(1 - 0.12 * (N / D.N0 - 1), 0.7, 1.12);
      const limit = P.grip * (locked ? P.handbrakeGrip : 1) * N * loadFactor;
      const alphaT = Math.atan2(vt, Math.abs(vl) + 0.5);
      w.alpha += (alphaT - w.alpha) * Math.min(1, Math.hypot(vl, vt) * dt / 0.25 + 0.15);
      const a = Math.abs(w.alpha);
      const curve = Math.sin(1.3 * Math.atan(20 * a));
      let fy = -Math.sign(w.alpha) * Math.min(limit * curve, Math.abs(vt) * kill * 0.5);
      if (donutRear) fy *= 1 - 0.8 * donut;
      const left = Math.sqrt(Math.max(0, limit * limit - fy * fy)) + (1 - P.assist) * limit;
      let fx = 0, excess = 0;
      if (driven(w) && drivenGrounded.length) {
        const want = driveForce / drivenGrounded.length * (1 - 0.9 * donut);
        fx += clamp(want, -left, left);
        excess = Math.max(0, Math.abs(want) - left) / (limit + 1);
      }
      if (brake > 0) fx -= Math.sign(vl) * Math.min(brake * limit, left, Math.abs(vl) * kill * 0.5);
      if (locked) fx -= Math.sign(vl) * Math.min(0.8 * limit, Math.abs(vl) * kill * 0.5);
      if (stopping) fx = -vl * kill * 0.5;
      else fx -= Math.sign(vl) * Math.min(0.015 * N, Math.abs(vl) * kill);
      const total = Math.hypot(fx, fy);
      if (total > limit && total > 0) {
        fx *= limit / total;
        fy *= limit / total;
      }
      w.slip = Math.max(total > limit ? 1 - limit / total : 0, Math.min(1, excess));
      const lift = comY * 0.2;
      addForce(
        [fg[0] * fx + lg[0] * fy, fg[1] * fx + lg[1] * fy, fg[2] * fx + lg[2] * fy],
        [w.contact[0] + U[0] * lift, w.contact[1] + U[1] * lift, w.contact[2] + U[2] * lift]
      );
      const spinUp = Math.max(driven(w) ? Math.min(1, excess * 2) : 0, donutRear ? donut * demand : 0);
      w.omega = locked ? 0 : vl / w.radius + spinUp * (donutRear ? 45 : 25) * Math.sign(driveForce || 1);
      w.spin += w.omega * dt;
      const speed = Math.hypot(vl, vt);
      const moving = clamp((speed - 1) / 4, 0, 1);
      w.slide = clamp((a - 0.12) * 5, 0, 1) * moving;
      w.spinSlip = spinUp;
      w.lock = locked && Math.abs(vl) > 2 ? 0.8 * moving : 0;
      w.skid = clamp(Math.max((a - 0.12) * 5, spinUp, locked && Math.abs(vl) > 2 ? 0.8 : 0), 0, 1) * moving;
    }
    state.assist = hand ? 0 : Math.min(1, state.assist + dt / 0.8);
    if (grounded >= 2 && P.assist > 0) {
      const maxRate = P.grip * G / Math.max(Math.abs(vF), 3);
      const want = clamp(vF * Math.tan(state.steer * maxSteer) / wheelbase, -maxRate, maxRate);
      const err = dot2(av, U) - want;
      const band = 0.08 * Math.abs(want) + 0.05;
      const over = err - clamp(err, -band, band);
      const cap = P.mass * G * wheelbase * 0.3;
      const torque2 = clamp(-over * D.I.yaw * 8 * P.assist * state.assist * (grounded / n), -cap, cap);
      rigidBody.addTorque(world, body, scale(tmp, U, torque2), true);
    }
    if (donut > 0 && grounded >= 2) {
      const dir = -Math.sign(input.steer);
      const yawNow = dot2(av, U);
      const want = dir * (2.3 + 0.7 * demand) * donut;
      const tq = clamp((want - yawNow) * D.I.yaw / 0.25, -P.mass * G * wheelbase * 0.6, P.mass * G * wheelbase * 0.6);
      rigidBody.addTorque(world, body, scale(tmp, U, tq), true);
      const dz = rearZ + wheelbase - com[2];
      const wantL = -yawNow * dz, wantF = 0;
      const k = P.mass / 0.3 * donut, cap = P.mass * G * P.grip * 0.8;
      const fF = clamp((wantF - vF) * k, -cap, cap), fL = clamp((wantL - vL) * k, -cap, cap);
      addForce([F[0] * fF + R[0] * fL, F[1] * fF + R[1] * fL, F[2] * fF + R[2] * fL], null);
    }
    if (grounded === 0 && P.assist > 0) {
      const sp2 = Math.hypot(bv[0], bv[1], bv[2]);
      let pitchErr = 0;
      if (sp2 > 4 && Math.abs(vF) > 2) {
        const s = Math.sign(vF);
        pitchErr = clamp(dot2(cross2(F, [bv[0] / sp2 * s, bv[1] / sp2 * s, bv[2] / sp2 * s]), R), -0.6, 0.6);
      }
      const rollErr = clamp(R[1], -0.8, 0.8);
      const kk = 3 * P.assist, d = 2.2;
      const pitch = (pitchErr * kk * kk - dot2(av, R) * d) * D.I.pitch;
      const roll = (-rollErr * kk * kk - dot2(av, F) * d) * D.I.roll;
      rigidBody.addTorque(world, body, [R[0] * pitch + F[0] * roll, R[1] * pitch + F[1] * roll, R[2] * pitch + F[2] * roll], true);
    }
    const sp = Math.hypot(bv[0], bv[1], bv[2]);
    if (sp > 0.01) addForce([-bv[0] * sp * D.drag, -bv[1] * sp * D.drag, -bv[2] * sp * D.drag], null);
    if (grounded) addForce(scale(tmp, U, -D.drag * sp * sp), null);
  }
  const qTmp = [0, 0, 0, 1];
  function sweep(w, mount) {
    const hs = Math.sin(w.steer / 2), hc = Math.cos(w.steer / 2), r2 = Math.SQRT1_2;
    qmul(qTmp, body.quaternion, qmul([0, 0, 0, 1], [0, hs, 0, hc], [0, 0, r2, r2]));
    shapeHit.reset();
    castShape(world, shapeHit, shapeSet, w.probe, mount, qTmp, ONE, [-U[0] * w.sMax, -U[1] * w.sMax, -U[2] * w.sMax], rayFilter);
    const h = shapeHit.hit;
    if (h.status !== 1) return false;
    const nh = h.normal;
    if (dot2(nh, U) < 0.35) return false;
    w.s = h.fraction > 0 ? h.fraction * w.sMax : -Math.min(h.penetrationDepth, w.sMax);
    const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
    const ax = [R[0] * cs - F[0] * sn, R[1] * cs - F[1] * sn, R[2] * cs - F[2] * sn];
    const na = dot2(nh, ax);
    const nn = normalize([nh[0] - ax[0] * na, nh[1] - ax[1] * na, nh[2] - ax[2] * na]);
    w.normal[0] = nn[0];
    w.normal[1] = nn[1];
    w.normal[2] = nn[2];
    const cx = mount[0] - U[0] * w.s, cy = mount[1] - U[1] * w.s, cz = mount[2] - U[2] * w.s;
    w.contact[0] = cx - nn[0] * w.radius;
    w.contact[1] = cy - nn[1] * w.radius;
    w.contact[2] = cz - nn[2] * w.radius;
    w.hitBody = rigidBody.get(world, h.bodyIdB) || null;
    return true;
  }
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
    if (dot2(w.normal, U) < 0.2) {
      w.normal[0] = U[0];
      w.normal[1] = U[1];
      w.normal[2] = U[2];
    }
    return true;
  }
  function addForce(f, at) {
    if (at) rigidBody.addForceAtPosition(world, body, [f[0], f[1], f[2]], at, true);
    else rigidBody.addForce(world, body, [f[0], f[1], f[2]], true);
  }
  function reset(position, yawAngle) {
    const p = position || [body.position[0], body.position[1] + 1, body.position[2]];
    let a = yawAngle;
    if (a === void 0) {
      rotate(F, body.quaternion, [0, 0, 1]);
      a = Math.atan2(F[0], F[2]);
    }
    rigidBody.setTransform(world, body, p, [0, Math.sin(a / 2), 0, Math.cos(a / 2)], true);
    rigidBody.setLinearVelocity(world, body, [0, 0, 0]);
    rigidBody.setAngularVelocity(world, body, [0, 0, 0]);
    Object.assign(state, { steer: 0, throttle: 0, brake: 0, reversing: false, gear: 1, shift: 0, rpm: D.idle });
    for (const w of wheels) {
      w.s = D.bump;
      w.sPrev = D.bump;
      w.sDraw = D.bump;
      w.omega = 0;
      w.alpha = 0;
      w.skid = 0;
      w.slide = 0;
      w.spinSlip = 0;
      w.lock = 0;
    }
  }
  function tune(o2 = {}) {
    const next = pick(o2);
    const massChanged = next.mass !== void 0 && next.mass !== P.mass;
    Object.assign(P, next);
    if (massChanged) motionProperties.scaleToMass(body.motionProperties, P.mass);
    derive();
    return { ...P };
  }
  function remove() {
    rigidBody.remove(world, body);
  }
  return {
    body,
    wheels,
    input,
    state,
    params: P,
    step,
    reset,
    remove,
    tune,
    com,
    /** engine / gearbox for the HUD and sound */
    get engine() {
      return { rpm: state.rpm, gear: state.reversing ? -1 : state.gear, gears: D.ratios.length, redline: P.redline, throttle: state.throttle, shifting: state.shift > 0, limiter: state.limiter };
    },
    /** the wheel centre's height in the car frame (for drawing) */
    wheelY: (w) => w.rest[1] + D.bump - w.sDraw,
    /** after a step: the drawn wheel follows the physics one, dropping with some weight when it leaves the ground */
    settleDraw(dt) {
      for (const w of wheels) {
        const s = clamp(w.s, 0, w.sMax);
        w.sDraw = s < w.sDraw ? s : Math.min(s, w.sDraw + 3 * dt);
      }
    }
  };
}
function pick(o) {
  const out = {};
  for (const key in TUNING) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = clamp(v, TUNING[key][0], TUNING[key][1]);
  }
  if (out.gears !== void 0) out.gears = Math.round(out.gears);
  if (["awd", "rwd", "fwd"].includes(o.drive)) out.drive = o.drive;
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
function dot2(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross2(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function scale(out, a, s) {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function avg(a) {
  return a.length ? a.reduce((t, v) => t + v, 0) / a.length : 0;
}
function smooth(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

// src/physics.js
import { addBroadphaseLayer, addObjectLayer, createWorld, createWorldSettings, enableCollision, registerAll, rigidBody as rigidBody2, updateWorld, box as box2, MotionType as MotionType2 } from "crashcat";
var registered = false;
function createPhysics(o = {}) {
  if (!registered) {
    registerAll();
    registered = true;
  }
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
    listener: void 0,
    step(dt) {
      if (dt > 0) updateWorld(world, physics.listener, dt);
    },
    sync() {
    }
  };
  if (o.floor) {
    const h = Math.max(1, Number(o.floor) || 400) / 2;
    rigidBody2.create(world, { shape: box2.create({ halfExtents: [h, 0.5, h] }), motionType: MotionType2.STATIC, objectLayer: still, position: [0, -0.5, 0], friction: 0.9 });
  }
  return physics;
}

// src/camera.js
import { Vector3 as Vector32 } from "three";
function createChaseCamera(camera, car, o = {}) {
  const opt = { fov: 58, fovBoost: 14, distance: 1, height: 1, stiffness: 1, shake: 1, returnDelay: 1.5, ...o };
  let len = car.report.size.length, tall = car.report.size.height;
  const s = { yaw: 0, yawVel: 0, orbitYaw: 0, orbitPitch: 0, zoom: 1, idle: 99, y: 0, yVel: 0, x: 0, z: 0, vx: 0, vz: 0, spd: 0, fov: opt.fov, t: 0, init: false, mode: "chase", bob: 0, bobVel: 0 };
  const target = new Vector32(), look = new Vector32(), fwd = new Vector32();
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
    if (s.mode === "hood") {
      camera.position.set(0, tall * 0.78, len * 0.12).applyMatrix4(obj.matrixWorld);
      look.set(0, tall * 0.7, len * 0.12 + 20).applyMatrix4(obj.matrixWorld);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
      setFov(opt.fov + 6 + opt.fovBoost * Math.min(1, speed / 55), dt);
      return;
    }
    let want = carYaw;
    if (!s.init) {
      s.yaw = carYaw;
      s.y = p.y;
      s.yVel = 0;
      s.x = p.x;
      s.z = p.z;
      s.vx = v[0];
      s.vz = v[2];
      s.spd = speed;
      s.bob = 0;
      s.bobVel = 0;
      s.init = true;
    }
    const sv = Math.hypot(s.vx, s.vz);
    if (sv > 4 && car.speed > -3) want = carYaw + 0.45 * wrap(Math.atan2(s.vx, s.vz) - carYaw);
    const w = (3.2 + Math.min(s.spd, 50) * 0.05) * opt.stiffness;
    const diff = wrap(want - s.yaw);
    s.yawVel += (w * w * diff - 2 * w * s.yawVel) * dt;
    s.yaw = wrap(s.yaw + s.yawVel * dt);
    const wp = 7;
    s.vx += (wp * wp * (p.x - s.x) + 2 * wp * (v[0] - s.vx)) * dt;
    s.vz += (wp * wp * (p.z - s.z) + 2 * wp * (v[2] - s.vz)) * dt;
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    s.spd += (speed - s.spd) * Math.min(1, dt * 2.5);
    const wy = 4.5;
    s.yVel += (wy * wy * (p.y - s.y) - 2 * wy * s.yVel) * dt;
    s.y += s.yVel * dt;
    const imp = car.impact || 0;
    if (imp > 0.35 && imp > (s.lastImpact || 0) + 0.1) s.bobVel -= (imp - 0.35) / 0.65 * 0.6 * opt.shake;
    s.lastImpact = imp;
    const wb = 9;
    s.bobVel += (-wb * wb * s.bob - 2 * 0.35 * wb * s.bobVel) * dt;
    s.bob += s.bobVel * dt;
    if (s.idle > opt.returnDelay && speed > 2) {
      const k = Math.min(1, dt * 2.2);
      s.orbitYaw -= wrap(s.orbitYaw) * k;
      s.orbitPitch -= s.orbitPitch * k;
    }
    const far = s.mode === "far" ? 1.8 : 1;
    const dist = (len * 1.1 + 2.6) * opt.distance * s.zoom * far * (1 + Math.min(s.spd, 60) / 60 * 0.18);
    const pitch = Math.max(-0.15, Math.min(1.35, Math.atan2((tall * 0.9 + 0.7) * opt.height * (s.mode === "far" ? 1.6 : 1), dist) + s.orbitPitch));
    const yaw = s.yaw + s.orbitYaw;
    target.set(s.x, s.y + tall * 0.55, s.z);
    camera.position.set(
      target.x - Math.sin(yaw) * Math.cos(pitch) * dist,
      target.y + Math.sin(pitch) * dist,
      target.z - Math.cos(yaw) * Math.cos(pitch) * dist
    );
    if (camera.position.y < s.y + 0.3) camera.position.y = s.y + 0.3;
    const ahead = s.orbitYaw === 0 && s.orbitPitch === 0 ? 1.5 + Math.min(s.spd, 50) * 0.05 : 0.5;
    look.set(target.x + Math.sin(s.yaw) * ahead, target.y, target.z + Math.cos(s.yaw) * ahead);
    const drift = opt.shake * Math.max(0, s.spd - 45) / 40 * 6e-3;
    camera.position.y += Math.max(-0.08, Math.min(0.08, s.bob)) + drift * Math.sin(s.t * 6.3);
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    setFov(opt.fov + opt.fovBoost * Math.min(1, s.spd / 55), dt);
  }
  function setFov(f, dt) {
    s.fov += (f - s.fov) * Math.min(1, dt * 3);
    if (Math.abs(camera.fov - s.fov) > 0.01) {
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
    }
  }
  return {
    update,
    /** turn the camera around the car: pixels of mouse / finger movement */
    orbit(dx, dy) {
      s.orbitYaw = wrap(s.orbitYaw - dx * 6e-3);
      s.orbitPitch = Math.max(-0.45, Math.min(1.1, s.orbitPitch + dy * 4e-3));
      s.idle = 0;
    },
    /** move in (< 1) or out (> 1) */
    zoom(f) {
      s.zoom = Math.max(0.45, Math.min(3, s.zoom * f));
    },
    /** 'chase' (default) · 'far' · 'hood' */
    setMode(m) {
      if (["chase", "far", "hood"].includes(m)) s.mode = m;
    },
    get mode() {
      return s.mode;
    },
    /** snap behind the car (after a reset or a new car) */
    reset() {
      s.init = false;
      s.orbitYaw = 0;
      s.orbitPitch = 0;
      s.yawVel = 0;
    },
    /** follow another car */
    setCar(c) {
      car = c;
      len = c.report.size.length;
      tall = c.report.size.height;
      s.init = false;
    },
    options: opt
  };
}

// src/default-car.js
import { Group as Group2, Mesh as Mesh2, BoxGeometry, CylinderGeometry, MeshStandardMaterial, Color } from "three";
function createDefaultCar(o = {}) {
  const paint = new MeshStandardMaterial({ color: new Color(o.color ?? "#e8412c"), roughness: 0.35, metalness: 0.3 });
  const glass = new MeshStandardMaterial({ color: "#1b2430", roughness: 0.1, metalness: 0.6 });
  const dark = new MeshStandardMaterial({ color: "#202226", roughness: 0.8 });
  const tyre = new MeshStandardMaterial({ color: "#17181a", roughness: 0.9 });
  const rim = new MeshStandardMaterial({ color: "#c9ccd1", roughness: 0.3, metalness: 0.8 });
  const head = new MeshStandardMaterial({ color: "#fff6d8", emissive: "#fff1c0", emissiveIntensity: 0.6 });
  const tail = new MeshStandardMaterial({ color: "#b3121a", emissive: "#ff1a1a", emissiveIntensity: 0.5 });
  const car = new Group2();
  car.name = "default-car";
  const box3 = (w, h, l, x, y, z, m) => {
    const b = new Mesh2(new BoxGeometry(w, h, l), m);
    b.position.set(x, y, z);
    car.add(b);
    return b;
  };
  box3(1.7, 0.5, 4.1, 0, 0.62, 0, paint);
  box3(1.5, 0.46, 2, 0, 1.1, -0.25, glass);
  box3(1.56, 0.06, 1.9, 0, 1.35, -0.25, paint);
  box3(1.8, 0.2, 0.16, 0, 0.42, 2.07, dark);
  box3(1.8, 0.2, 0.16, 0, 0.42, -2.07, dark);
  for (const s of [-1, 1]) {
    box3(0.34, 0.1, 0.04, s * 0.62, 0.72, 2.06, head);
    box3(0.3, 0.1, 0.04, s * 0.64, 0.72, -2.06, tail);
  }
  const R = 0.34, W = 0.24;
  const tyreGeo = new CylinderGeometry(R, R, W, 28).rotateZ(Math.PI / 2);
  const rimGeo = new CylinderGeometry(R * 0.62, R * 0.62, 0.04, 20).rotateZ(Math.PI / 2);
  for (const z of [1.3, -1.3]) for (const s of [-1, 1]) {
    const t = new Mesh2(tyreGeo, tyre);
    t.position.set(s * 0.8, R, z);
    car.add(t);
    const r = new Mesh2(rimGeo, rim);
    r.position.set(s * (0.8 + W / 2 + 5e-3), R, z);
    car.add(r);
  }
  return car;
}

// src/index.js
import { updateWorld as updateWorld2 } from "crashcat";
var VERSION = "0.9.0";
var HOOK = /* @__PURE__ */ Symbol.for("car.hook");
var warned = /* @__PURE__ */ new Set();
function warnOnce(msg) {
  if (!warned.has(msg)) {
    warned.add(msg);
    console.warn(`[car] ${msg}`);
  }
}
function create(o = {}) {
  const { scene, physics } = o;
  if (!physics || !physics.world || !physics.layers) {
    warnOnce("create() needs physics: CAR.createPhysics() makes one");
    return null;
  }
  let model = o.model && !o.model.isObject3D && o.model.scene?.isObject3D ? o.model.scene : o.model;
  let forward = o.forward, length = o.length;
  if (model == null) {
    model = createDefaultCar({ color: o.color });
    forward = "+z";
    length = void 0;
  }
  if (!model.isObject3D) {
    warnOnce("create() needs model: a three.js object (gltf.scene), or no model for the built-in car");
    return null;
  }
  if (o.preset !== void 0 && !PRESETS[o.preset]) warnOnce(`unknown preset "${o.preset}"; using "car" (${Object.keys(PRESETS).join(", ")})`);
  const report = detectWheels(model, { forward, length });
  if (!report.ok) {
    warnOnce(`no wheels found: ${report.reason}`);
    return null;
  }
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
      for (const k of ["throttle", "brake", "steer"]) if (Number.isFinite(i[k])) vehicle.input[k] = i[k];
      if (i.handbrake !== void 0) vehicle.input.handbrake = !!i.handbrake;
      return car;
    },
    /** forward speed in km/h (negative when reversing) */
    get speed() {
      return vehicle.state.speed * 3.6;
    },
    /** how many wheels touch the ground */
    get grounded() {
      return vehicle.state.grounded;
    },
    /** { rpm, gear (-1 = reverse), gears, redline, throttle, shifting, limiter } for a HUD or engine sound */
    get engine() {
      return vehicle.engine;
    },
    /** 0..1: how hard the suspension was just hit (landings, kerbs); fades out. For camera shake / thump sounds */
    get impact() {
      return vehicle.state.impact;
    },
    /** 0..1: how much the tyres are sliding or spinning (the most of any wheel). For tyre screech */
    get skid() {
      return Math.max(0, ...vehicle.wheels.map((w) => w.grounded ? w.skid : 0));
    },
    /** change handling numbers live, e.g. car.tune({ grip: 1.6, steer: 30 }); returns the params in use */
    tune(p) {
      const r = vehicle.tune(p);
      Object.assign(car.params, r);
      return r;
    },
    /** put the car back on its wheels (here, or at [x, y, z] facing yaw) */
    reset(position, yaw) {
      vehicle.reset(position, yaw);
      prev.p = Array.from(body.position);
      prev.q = Array.from(body.quaternion);
      return car;
    },
    /** take the car out of the scene and the world */
    remove() {
      hooks(physics).delete(car);
      vehicle.remove();
      rig.object.removeFromParent();
    },
    /** what was found in the model: wheels, size, which way it faced, notes */
    report: summary(report, rig),
    /** the physics numbers in use (preset + overrides) */
    params: vehicle.params,
    /** the wheels (for debug views): contact, load, slip, steer, grounded */
    wheels: vehicle.wheels,
    /** internal: runs inside physics.step / physics.sync */
    substeps: Math.max(1, Math.min(8, Math.round(Number(o.substeps) || 2))),
    _begin() {
      prev.p = Array.from(body.position);
      prev.q = Array.from(body.quaternion);
    },
    _before(dt) {
      vehicle.step(dt);
      vehicle.settleDraw(dt);
    },
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
    }
  };
  hooks(physics).add(car);
  car._draw(1);
  return car;
}
function hooks(physics) {
  if (physics[HOOK]) return physics[HOOK];
  const cars = /* @__PURE__ */ new Set();
  const step = physics.step.bind(physics), sync = typeof physics.sync === "function" ? physics.sync.bind(physics) : null;
  physics.step = (dt, ...rest) => {
    if (!cars.size || !(dt > 0)) return step(dt, ...rest);
    let k = 1;
    for (const c of cars) {
      c._begin();
      k = Math.max(k, c.substeps);
    }
    for (const c of cars) c._before(dt / k);
    const r = step(dt / k, ...rest);
    for (let i = 1; i < k; i++) {
      for (const c of cars) c._before(dt / k);
      updateWorld2(physics.world, physics.listener, dt / k);
    }
    return r;
  };
  physics.sync = (alpha = 1, ...rest) => {
    const r = sync ? sync(alpha, ...rest) : void 0;
    for (const c of cars) c._draw(alpha);
    return r;
  };
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
    notes: r.notes
  };
}
function inspect(model, o = {}) {
  const r = detectWheels(model, o);
  const { owner, ...rest } = r;
  return rest;
}
function createCamera(camera, car, o) {
  return createChaseCamera(camera, car, o);
}
var CAR = Object.freeze({ version: VERSION, create, createPhysics, createCamera, inspect, presets: Object.keys(PRESETS), tuning: TUNING });
var index_default = CAR;
export {
  PRESETS,
  TUNING,
  create,
  createCamera,
  createPhysics,
  index_default as default,
  inspect
};
