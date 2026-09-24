/* Wheel detection: finds the wheels of a car model from its shape alone (no names, no AI needed).

   How: every mesh is split into its connected pieces ("islands"). A piece is a wheel part when it is round around an
   axle that points sideways (±35°, so wheels modelled already steered still count), sits low, and is off the car's
   centre line. Round pieces sharing an axle are one wheel (tyre, rim, hub cap, brake disc); small pieces inside a
   wheel spin with it (wheel nuts); bigger off-axis pieces inside a wheel only steer (brake calipers).
   The wheels touching the ground are paired left/right into axles.

   Works on the model's world space as loaded ("raw" space). Only uses three.js for the scene graph and matrices,
   so it runs in Node too. Returns a report; src/rig.js turns it into a drivable car. */

const RAW = { UP: 1 };

/**
 * @param {import('three').Object3D} root the loaded model (gltf.scene)
 * @param {{ forward?: string, length?: number }} [o] forward: '+x' | '-x' | '+z' | '-z' to skip the guess ·
 *   length: the car's real length in metres (default: worked out from the model's units)
 */
export function detectWheels(root, o = {}) {
  const notes = [];
  const meshes = collect(root);
  if (!meshes.length) return fail('the model has no meshes', notes);

  /* the whole model's box (raw units) */
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = m.pos[i + k];
    if (v < mn[k]) mn[k] = v;
    if (v > mx[k]) mx[k] = v;
  }
  const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const diag = Math.hypot(ext[0], ext[1], ext[2]);
  if (!(diag > 0)) return fail('the model is empty (zero size)', notes);
  /* Y is up (glTF). The longer ground axis is the car's length. */
  const LONG = ext[0] > ext[2] ? 0 : 2, LAT = LONG === 0 ? 2 : 0;
  const length = ext[LONG], width = ext[LAT], height = ext[RAW.UP];
  const latMid = (mn[LAT] + mx[LAT]) / 2;
  const latAxis = [0, 0, 0]; latAxis[LAT] = 1;

  /* 1. islands */
  const islands = [];
  for (const m of meshes) splitIslands(m, mn, diag * 1e-5, islands);

  /* 2. round, low, sideways-axle pieces */
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
  if (!cands.length) return fail('no round wheel-shaped parts found (the wheels may be merged into the body)', notes, islands.length);

  /* 3. round pieces sharing an axle make one wheel; the biggest is the tyre */
  cands.sort((a, b) => b.radius - a.radius);
  let wheels = [];
  for (const c of cands) {
    const w = wheels.find((w) => {
      const { axial, radial } = offset(c.center, w);
      return radial < 0.25 * w.radius && axial < w.width / 2 + 0.6 * w.radius && c.radius <= w.radius * 1.05;
    });
    if (w) { w.spin.push(c.isl); continue; }
    wheels.push({ center: c.center, axle: c.axle, radius: c.radius, width: c.width, spin: [c.isl], knuckle: [], tyre: c.isl });
  }

  /* 4. keep the wheels that stand on the ground: similar size, lowest */
  const maxR = Math.max(...wheels.map((w) => w.radius));
  wheels = wheels.filter((w) => w.radius >= 0.55 * maxR);
  const bottom = (w) => w.center[RAW.UP] - w.radius;
  const lowest = Math.min(...wheels.map(bottom));
  wheels = wheels.filter((w) => bottom(w) <= lowest + 0.35 * maxR);

  /* 5. pair left / right into axles (wheels at the same place along the car, opposite sides) */
  const lefts = wheels.filter((w) => w.center[LAT] > latMid), rights = wheels.filter((w) => w.center[LAT] <= latMid);
  const axles = [];
  for (const l of lefts) {
    let best = null, bd = Infinity;
    for (const r of rights) {
      if (r.paired) continue;
      const d = Math.abs(r.center[LONG] - l.center[LONG]);
      if (d < bd) { bd = d; best = r; }
    }
    if (best && bd < 0.5 * Math.max(l.radius, best.radius)) { best.paired = true; axles.push([l, best]); }
    else notes.push(`a wheel without a partner on the other side was ignored (at ${fmt(l.center)})`);
  }
  for (const r of rights) if (!r.paired) notes.push(`a wheel without a partner on the other side was ignored (at ${fmt(r.center)})`);
  if (axles.length < 2) return fail(`found ${wheels.length} wheel(s) but not two axles (need 4 wheels in left/right pairs)`, notes, islands.length, cands.length);
  if (axles.length > 4) { notes.push(`${axles.length} axles found; only the 4 lowest-and-largest are used`); axles.length = 4; }

  /* 6. pieces inside a wheel that are not round themselves: small ones spin (nuts), bigger ones only steer (calipers) */
  const used = new Set(axles.flat().flatMap((w) => w.spin));
  for (const isl of islands) {
    if (used.has(isl)) continue;
    const c = isl.stats;
    for (const w of axles.flat()) {
      if (!inside(isl, w)) continue;
      const { radial } = offset(c.center, w);
      const size = Math.max(c.size[0], c.size[1], c.size[2]);
      if (radial < 0.15 * w.radius || size < 0.25 * w.radius) w.spin.push(isl); else w.knuckle.push(isl);
      used.add(isl);
      break;
    }
  }

  /* 7. which end is the front */
  const facing = guessForward(o.forward, axles, islands, used, { LONG, LAT, mn, mx, length, height }, notes);
  const fwd = [0, 0, 0]; fwd[LONG] = facing.sign;
  /* left = up × forward */
  const left = [fwd[2], 0, -fwd[0]];
  const along = (p) => p[LONG] * facing.sign;
  axles.sort((a, b) => along(b[0].center) - along(a[0].center));

  /* 8. units → metres */
  const unitScale = o.length > 0 ? o.length / length : guessUnits(length, notes);

  const out = [];
  axles.forEach((pair, ai) => {
    for (const w of pair) {
      const isLeft = (w.center[0] - (mn[0] + mx[0]) / 2) * left[0] + (w.center[2] - (mn[2] + mx[2]) / 2) * left[2] > 0;
      out.push({ center: w.center, axle: w.axle, radius: w.radius, width: w.width, axleIndex: ai, left: isLeft, spin: w.spin, knuckle: w.knuckle });
    }
  });
  out.sort((a, b) => a.axleIndex - b.axleIndex || (b.left ? 1 : 0) - (a.left ? 1 : 0));

  /* per mesh and triangle: -1 body, i spins with wheel i, -(i + 2) steers with wheel i */
  const owner = new Map(meshes.map((m) => [m.object, new Int32Array(m.triCount).fill(-1)]));
  out.forEach((w, i) => {
    for (const isl of w.spin) { const a = owner.get(isl.mesh.object); for (const t of isl.tris) a[t] = i; }
    for (const isl of w.knuckle) { const a = owner.get(isl.mesh.object); for (const t of isl.tris) a[t] = -(i + 2); }
  });

  return {
    ok: true,
    reason: '',
    up: [0, 1, 0],
    forward: fwd,
    left,
    unitScale,
    frontConfidence: facing.confidence,
    size: { length, width, height },
    wheels: out.map(({ spin, knuckle, ...w }) => ({ ...w, parts: spin.length, steerOnlyParts: knuckle.length })),
    owner,
    notes,
    counts: { meshes: meshes.length, islands: islands.length, candidates: cands.length },
  };
}

function fail(reason, notes, islands = 0, candidates = 0) {
  return { ok: false, reason, notes, wheels: [], counts: { islands, candidates } };
}

const fmt = (p) => p.map((v) => +v.toFixed(2)).join(', ');

/* ------------------------------------------------------------------ meshes → world-space triangles */

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
    const index = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: n - (n % 3) }, (_, i) => i);
    list.push({ object: obj, pos, index, triCount: (index.length / 3) | 0 });
  });
  return list;
}

/* connected pieces of one mesh. Vertices at the same place count as one (UV seams split them in the file). */
function splitIslands(m, mn, q, out) {
  const n = m.pos.length / 3;
  const B = 131072, weld = new Int32Array(n), seen = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.round((m.pos[i * 3] - mn[0]) / q) + Math.round((m.pos[i * 3 + 1] - mn[1]) / q) * B
      + Math.round((m.pos[i * 3 + 2] - mn[2]) / q) * B * B;
    let id = seen.get(key);
    if (id === undefined) { id = i; seen.set(key, i); }
    weld[i] = id;
  }
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const I = m.index;
  for (let t = 0; t < I.length - 2; t += 3) {
    const a = find(weld[I[t]]), b = find(weld[I[t + 1]]), c = find(weld[I[t + 2]]);
    if (a !== b) parent[a] = b;
    const b2 = find(b);
    if (find(c) !== b2) parent[find(c)] = b2;
  }
  const byRoot = new Map();
  for (let t = 0; t < m.triCount; t++) {
    const r = find(weld[I[t * 3]]);
    let isl = byRoot.get(r);
    if (!isl) { isl = { mesh: m, tris: [] }; byRoot.set(r, isl); out.push(isl); }
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
    for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; mean[k] += v; }
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

/* is this piece round around a sideways axle? → { axle, center, radius, width } or null */
function roundness(isl, s, latAxis) {
  const eig = jacobi(s.cov);
  /* the axle is the direction the piece is thinnest in (a disc, a tyre, a rim) */
  let axle = eig.vectors[eig.order[0]];
  if (Math.abs(dot(axle, latAxis)) < Math.cos(35 * Math.PI / 180)) axle = latAxis;
  if (dot(axle, latAxis) < 0) axle = axle.map((v) => -v);
  axle[1] = 0;
  const al = Math.hypot(axle[0], axle[2]);
  axle = [axle[0] / al, 0, axle[2] / al];
  const u = [0, 1, 0], v = cross(axle, u);
  /* extents across the axle in 8 directions: all equal for a circle, up to 41% apart for a square */
  const dirs = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 8;
    dirs.push([u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)]);
  }
  const lo = new Array(8).fill(Infinity), hi = new Array(8).fill(-Infinity);
  let alo = Infinity, ahi = -Infinity;
  const pos = isl.mesh.pos;
  for (const i of corners(isl)) {
    const p = [pos[i], pos[i + 1], pos[i + 2]];
    for (let k = 0; k < 8; k++) { const d = dot(p, dirs[k]); if (d < lo[k]) lo[k] = d; if (d > hi[k]) hi[k] = d; }
    const a = dot(p, axle);
    if (a < alo) alo = a;
    if (a > ahi) ahi = a;
  }
  const spans = hi.map((h, k) => h - lo[k]);
  const smin = Math.min(...spans), smax = Math.max(...spans);
  if (!(smax > 0) || smin / smax < 0.88) return null;
  const radius = (smin + smax) / 4, width = ahi - alo;
  if (width > 1.1 * 2 * radius) return null;
  /* centre: middle of the spans across (u, v = directions 0 and 4) and along the axle */
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

/* every vertex of the piece within the wheel's cylinder (a little wider on the inside, for brakes) */
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

/* ------------------------------------------------------------------ front / back, units */

function guessForward(forced, axles, islands, used, box, notes) {
  const { LONG } = box;
  if (typeof forced === 'string') {
    const m = /^([+-])([xz])$/i.exec(forced.trim());
    if (m && 'xz'.indexOf(m[2].toLowerCase()) * 2 === LONG) return { sign: m[1] === '-' ? -1 : 1, confidence: 1 };
    if (m) notes.push(`forward "${forced}" is across the car, not along it; guessed instead`);
    else notes.push(`forward "${forced}" is not one of +x -x +z -z; guessed instead`);
  }
  const mid = (axles[0][0].center[LONG] + axles[axles.length - 1][0].center[LONG]) / 2;
  let score = 0;
  const why = [];
  /* a) wheels modelled already turned: those are the front wheels (strong) */
  for (const pair of axles) {
    const turn = Math.max(...pair.map((w) => Math.abs(w.axle[LONG])));
    if (turn > Math.sin(3 * Math.PI / 180)) { score += 3 * Math.sign(pair[0].center[LONG] - mid); why.push('turned wheels'); }
  }
  /* b) the cabin (the roof) sits behind the middle on most cars: engine in front */
  let sum = 0, n = 0;
  const roofY = box.mn[1] + 0.85 * box.height;
  for (const isl of islands) {
    if (used.has(isl)) continue;
    const pos = isl.mesh.pos;
    for (const i of corners(isl)) if (pos[i + 1] > roofY) { sum += pos[i + LONG]; n++; }
  }
  if (n) {
    const shift = (sum / n - mid) / box.length;
    score += -Math.sign(shift) * Math.min(1, Math.abs(shift) / 0.05);
    why.push(`roof ${shift > 0 ? '+' : '-'}${Math.abs(shift * 100).toFixed(0)}%`);
  }
  const sign = score >= 0 ? 1 : -1;
  const confidence = Math.min(1, Math.abs(score) / 2);
  if (confidence < 0.5) notes.push(`not sure which end is the front (${why.join(', ') || 'no clues'}); pass forward: '+z' etc. to be sure`);
  return { sign, confidence };
}

function guessUnits(length, notes) {
  /* a car is 2.5–12 m long; models come in m, cm, mm or anything */
  for (const [s, name] of [[1, 'metres'], [0.01, 'centimetres'], [0.001, 'millimetres'], [0.1, 'decimetres'], [0.0254, 'inches']]) {
    const L = length * s;
    if (L >= 2.5 && L <= 12) return s;
    void name;
  }
  notes.push(`the model's units are unclear (length ${length.toFixed(2)}); scaled to 4.4 m long`);
  return 4.4 / length;
}

/* ------------------------------------------------------------------ small maths */

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

/* eigenvectors of a symmetric 3×3 (row-major); order = indices from smallest to largest eigenvalue */
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
        a[k * 3 + p] = c * akp - s * akq; a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k], aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk; a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p], vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq; v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const vals = [a[0], a[4], a[8]];
  const vectors = [0, 1, 2].map((c) => [v[c], v[3 + c], v[6 + c]]);
  const order = [0, 1, 2].sort((x, y) => vals[x] - vals[y]);
  return { values: vals, vectors, order };
}
