/* Pixelfork Car Physics v0.9.2 · needs three@0.186.0 and crashcat@0.0.5 from the import map · © 2026 Pixelfork, see LICENSE */

// src/effects.js
import {
  Group,
  Mesh,
  BufferGeometry,
  BufferAttribute,
  InstancedBufferGeometry,
  InstancedBufferAttribute,
  ShaderMaterial,
  DataTexture,
  Color,
  UniformsLib,
  UniformsUtils,
  DoubleSide,
  DynamicDrawUsage,
  LinearFilter,
  LinearMipmapLinearFilter,
  Sphere,
  Vector3
} from "three";
import { MotionType } from "crashcat";
var PHONE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
var MAX_MARKS = 16e3;
var POOL = PHONE ? 160 : 400;
var PUFFS_PER_M = 2.5;
var LIFT = 0.012;
var STRIDE = 13;
var ZERO = [0, 0, 0];
var warned = /* @__PURE__ */ new Set();
var warnOnce = (m) => {
  if (!warned.has(m)) {
    warned.add(m);
    console.warn(`[car/effects] ${m}`);
  }
};
var clamp = (v, a, b) => v < a ? a : v > b ? b : v;
var knee = (x, lo, hi) => {
  const u = clamp((x - lo) / (hi - lo), 0, 1);
  return u * u * (3 - 2 * u);
};
var MARK_VERTEX = (
  /* glsl */
  `
attribute float alpha;
uniform float head, capacity, fade;
varying float vAlpha, vSide;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  /* the oldest pieces of the ring (the next to be reused) fade out */
  float age = mod(head - 1.0 - float(gl_VertexID / 4) + capacity, capacity);
  vAlpha = alpha * clamp((capacity - 1.0 - age) / fade, 0.0, 1.0);
  vSide = float(gl_VertexID % 2) * 2.0 - 1.0;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`
);
var MARK_FRAGMENT = (
  /* glsl */
  `
uniform vec3 color;
varying float vAlpha, vSide;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  /* soft sides, faint tread lines along the mark */
  float a = vAlpha * (1.0 - smoothstep(0.55, 1.0, abs(vSide))) * (0.8 + 0.2 * cos(vSide * 17.0));
  if (a < 0.003) discard;
  gl_FragColor = vec4(color, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`
);
var SMOKE_VERTEX = (
  /* glsl */
  `
attribute vec4 puff;   // centre xyz, size in metres
attribute vec3 look;   // alpha, angle, shade
varying vec2 vUv;
varying float vAlpha, vShade;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(puff.xyz, 1.0);
  /* right in front of the camera: faded, and gone (no pixels to fill) within 0.6 m */
  float near = clamp((-mvPosition.z - 0.6) / 2.4, 0.0, 1.0);
  float c = cos(look.y), s = sin(look.y);
  mvPosition.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * puff.w * 0.5 * step(0.001, near);
  vUv = position.xy * 0.5 + 0.5;
  vAlpha = look.x * near;
  vShade = look.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`
);
var SMOKE_FRAGMENT = (
  /* glsl */
  `
uniform sampler2D map;
uniform vec3 color;
varying vec2 vUv;
varying float vAlpha, vShade;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float a = texture2D(map, vUv).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(color * vShade, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`
);
function puffTexture() {
  const N = 64, data = new Uint8Array(N * N * 4);
  let seed = 11;
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const blobs = Array.from({ length: 8 }, () => {
    const a = rnd() * Math.PI * 2, r = 0.06 + rnd() * 0.16;
    return [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, 0.14 + rnd() * 0.12];
  });
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, v = (y + 0.5) / N;
      let d = 0;
      for (const [bx, by, br] of blobs) d += Math.exp(-((u - bx) ** 2 + (v - by) ** 2) / (br * br));
      const edge = knee(1 - Math.hypot(u - 0.5, v - 0.5) * 2, 0, 0.6);
      const k = (y * N + x) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(clamp(d * 0.6, 0, 1) * edge * 255);
    }
  }
  const t = new DataTexture(data, N, N);
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
function ringUploads(attr, stride, capacity) {
  const d = { start: 0, count: 0 };
  attr.onUploadCallback = () => {
    d.count = 0;
  };
  return {
    wrote(slot) {
      if (d.count === 0) d.start = slot;
      d.count = Math.min(capacity, d.count + 1);
    },
    reset() {
      d.count = 0;
    },
    flush() {
      if (!d.count) return;
      attr.clearUpdateRanges();
      if (d.count < capacity && d.start + d.count <= capacity) attr.addUpdateRange(d.start * stride, d.count * stride);
      else if (d.count < capacity) {
        attr.addUpdateRange(d.start * stride, (capacity - d.start) * stride);
        attr.addUpdateRange(0, (d.start + d.count - capacity) * stride);
      }
      attr.needsUpdate = true;
    }
  };
}
function qmul(out, ax, ay, az, aw, bx, by, bz, bw) {
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}
function rotate(out, q, vx, vy, vz) {
  const [x, y, z, w] = q;
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  out[0] = ix * w + iw * -x + iy * -z - iz * -y;
  out[1] = iy * w + iw * -y + iz * -x - ix * -z;
  out[2] = iz * w + iw * -z + ix * -y - iy * -x;
  return out;
}
function createCarEffects(scene, cars, o) {
  o = o || {};
  const opt = {
    marks: o.marks ?? (PHONE ? 1500 : 3e3),
    smoke: o.smoke ?? (PHONE ? 0.6 : 1),
    markColor: o.markColor ?? "#141416",
    smokeColor: o.smokeColor ?? "#d9d9d9"
  };
  let source = cars;
  let disposed = false, generation = 0, lastT = 0;
  const group = new Group();
  group.name = "car-effects";
  group.matrixAutoUpdate = false;
  if (scene && typeof scene.add === "function") scene.add(group);
  else warnOnce("createCarEffects(scene, car) needs the scene the cars are drawn in; add fx.object to it yourself");
  const markMat = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { color: { value: new Color() }, head: { value: 0 }, capacity: { value: 1 }, fade: { value: 1 } }]),
    vertexShader: MARK_VERTEX,
    fragmentShader: MARK_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4
  });
  let marks = null;
  function buildMarks(capacity) {
    if (marks) {
      marks.mesh.removeFromParent();
      marks.geo.dispose();
      marks = null;
    }
    if (!capacity) return;
    const geo = new BufferGeometry();
    const pos = new Float32Array(capacity * 12), alpha = new Float32Array(capacity * 4);
    const index = capacity * 4 > 65535 ? new Uint32Array(capacity * 6) : new Uint16Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      const v = i * 4;
      index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    const posAttr = new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage), alphaAttr = new BufferAttribute(alpha, 1).setUsage(DynamicDrawUsage);
    geo.setAttribute("position", posAttr);
    geo.setAttribute("alpha", alphaAttr);
    geo.setIndex(new BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new Sphere(new Vector3(), Infinity);
    const mesh = new Mesh(geo, markMat);
    mesh.name = "skid-marks";
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.renderOrder = -1;
    group.add(mesh);
    markMat.uniforms.capacity.value = capacity;
    markMat.uniforms.fade.value = Math.max(8, Math.round(capacity * 0.12));
    marks = { mesh, geo, pos, alpha, capacity, next: 0, count: 0, up: [ringUploads(posAttr, 12, capacity), ringUploads(alphaAttr, 4, capacity)] };
  }
  function addQuad(L0, R0, L12, R12, a0, a1) {
    const m = marks, i = m.next, p = m.pos, o3 = i * 12, o1 = i * 4;
    p[o3] = L0[0];
    p[o3 + 1] = L0[1];
    p[o3 + 2] = L0[2];
    p[o3 + 3] = R0[0];
    p[o3 + 4] = R0[1];
    p[o3 + 5] = R0[2];
    p[o3 + 6] = L12[0];
    p[o3 + 7] = L12[1];
    p[o3 + 8] = L12[2];
    p[o3 + 9] = R12[0];
    p[o3 + 10] = R12[1];
    p[o3 + 11] = R12[2];
    m.alpha[o1] = m.alpha[o1 + 1] = a0;
    m.alpha[o1 + 2] = m.alpha[o1 + 3] = a1;
    for (const u of m.up) u.wrote(i);
    m.next = (i + 1) % m.capacity;
    m.count = Math.min(m.capacity, m.count + 1);
  }
  const texture = puffTexture();
  const smokeMat = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { color: { value: new Color() }, map: { value: null } }]),
    vertexShader: SMOKE_VERTEX,
    fragmentShader: SMOKE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: true
  });
  smokeMat.uniforms.map.value = texture;
  const smokeGeo = new InstancedBufferGeometry();
  smokeGeo.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
  smokeGeo.setIndex([0, 1, 2, 2, 1, 3]);
  const puffAttr = new InstancedBufferAttribute(new Float32Array(POOL * 4), 4).setUsage(DynamicDrawUsage);
  const lookAttr = new InstancedBufferAttribute(new Float32Array(POOL * 3), 3).setUsage(DynamicDrawUsage);
  smokeGeo.setAttribute("puff", puffAttr);
  smokeGeo.setAttribute("look", lookAttr);
  smokeGeo.instanceCount = 0;
  smokeGeo.boundingSphere = new Sphere(new Vector3(), Infinity);
  const smokeMesh = new Mesh(smokeGeo, smokeMat);
  smokeMesh.name = "tyre-smoke";
  smokeMesh.frustumCulled = false;
  smokeMesh.matrixAutoUpdate = false;
  smokeMesh.visible = false;
  smokeMesh.renderOrder = 1;
  group.add(smokeMesh);
  const P = new Float32Array(POOL * STRIDE);
  for (let i = 0; i < POOL; i++) P[i * STRIDE + 7] = -1;
  let pNext = 0, live = 0;
  function emit(x, y, z, vx, vy, vz, level) {
    const o2 = pNext * STRIDE;
    pNext = (pNext + 1) % POOL;
    P[o2] = x + (Math.random() - 0.5) * 0.3;
    P[o2 + 1] = y;
    P[o2 + 2] = z + (Math.random() - 0.5) * 0.3;
    P[o2 + 3] = vx + (Math.random() - 0.5) * 0.7;
    P[o2 + 4] = vy;
    P[o2 + 5] = vz + (Math.random() - 0.5) * 0.7;
    P[o2 + 6] = 0;
    P[o2 + 7] = 1.4 + Math.random() * 1.1;
    P[o2 + 8] = 0.45 + Math.random() * 0.3;
    P[o2 + 9] = 0.28 + 0.12 * level;
    P[o2 + 10] = Math.random() * Math.PI * 2;
    P[o2 + 11] = (Math.random() - 0.5) * 1.2;
    P[o2 + 12] = 0.9 + Math.random() * 0.14;
  }
  function ageSmoke(dt) {
    const puff = puffAttr.array, look = lookAttr.array, drag = Math.exp(-1.4 * dt);
    live = 0;
    for (let i = 0; i < POOL; i++) {
      const o2 = i * STRIDE;
      if (!(P[o2 + 6] < P[o2 + 7])) continue;
      const age = P[o2 + 6] += dt;
      if (age >= P[o2 + 7]) continue;
      P[o2 + 3] *= drag;
      P[o2 + 4] = P[o2 + 4] * drag + 0.25 * dt;
      P[o2 + 5] *= drag;
      P[o2] += P[o2 + 3] * dt;
      P[o2 + 1] += P[o2 + 4] * dt;
      P[o2 + 2] += P[o2 + 5] * dt;
      const t = age / P[o2 + 7], j = live * 4, k = live * 3;
      puff[j] = P[o2];
      puff[j + 1] = P[o2 + 1];
      puff[j + 2] = P[o2 + 2];
      puff[j + 3] = P[o2 + 8] * (1 + 2.4 * t);
      look[k] = P[o2 + 9] * Math.min(1, t * 10) * (1 - t) ** 1.5;
      look[k + 1] = P[o2 + 10] + P[o2 + 11] * age;
      look[k + 2] = P[o2 + 12];
      live++;
    }
    smokeGeo.instanceCount = live;
    smokeMesh.visible = live > 0;
    if (!live) return;
    for (const a of [puffAttr, lookAttr]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, live * a.itemSize);
      a.needsUpdate = true;
    }
  }
  const state = /* @__PURE__ */ new WeakMap();
  const qd = [0, 0, 0, 1], D = [0, 0, 0], N = [0, 0, 0], F = [0, 0, 0], L1 = [0, 0, 0], R1 = [0, 0, 0];
  const isCar = (c) => !!c && !!c.body && !!c.object && Array.isArray(c.wheels);
  function follow(car, dt) {
    let s = state.get(car);
    if (!s || s.gen !== generation) {
      s = { gen: generation, wheels: [] };
      state.set(car, s);
    }
    const pb = car.body.position, qb = car.body.quaternion, po = car.object.position, qo = car.object.quaternion;
    qmul(qd, qo.x, qo.y, qo.z, qo.w, -qb[0], -qb[1], -qb[2], qb[3]);
    const v = car.body.motionProperties?.linearVelocity || ZERO;
    const speed = Math.hypot(v[0], v[1], v[2]);
    const reach = speed * (dt + 0.05) + 1;
    const spinFade = 1 - knee(speed, 8, 22);
    const smoke = clamp(Number(opt.smoke) || 0, 0, 2);
    for (let i = 0; i < car.wheels.length; i++) {
      const w = car.wheels[i];
      const ws = s.wheels[i] || (s.wheels[i] = { c: [0, 0, 0], spin: 0, p: [0, 0, 0], seen: false, trail: null, carry: Math.random() });
      if (!w.grounded || !w.contact || !w.normal) {
        ws.seen = false;
        ws.trail = null;
        continue;
      }
      const c = w.contact, r = w.radius || 0.33, spinNow = w.spin || 0;
      const dx = c[0] - ws.c[0], dy = c[1] - ws.c[1], dz = c[2] - ws.c[2], dspin = spinNow - ws.spin;
      const jumped = !ws.seen || Math.hypot(dx, dy, dz) > reach || Math.abs(dspin) * r > 60 * (dt + 0.05) + 1;
      ws.c[0] = c[0];
      ws.c[1] = c[1];
      ws.c[2] = c[2];
      ws.spin = spinNow;
      ws.seen = true;
      rotate(D, qd, c[0] - pb[0], c[1] - pb[1], c[2] - pb[2]);
      D[0] += po.x;
      D[1] += po.y;
      D[2] += po.z;
      rotate(N, qd, w.normal[0], w.normal[1], w.normal[2]);
      if (jumped) {
        ws.trail = null;
        ws.p[0] = D[0];
        ws.p[1] = D[1];
        ws.p[2] = D[2];
        continue;
      }
      const spin = (w.spinSlip ?? 0) * spinFade, lock = w.lock ?? 0, slide = w.slide ?? w.skid ?? 0;
      if (marks) mark(ws, w, Math.max(slide, lock, spin), speed);
      const level = Math.max(knee(spin, 0.25, 0.7), 0.8 * knee(lock, 0.15, 0.6), 0.4 * knee(slide, 0.55, 1));
      if (smoke > 0 && level > 0.01) {
        rotate(F, qb, Math.sin(w.steer || 0), 0, Math.cos(w.steer || 0));
        const roll = dspin * r;
        const sx = dx - F[0] * roll, sy = dy - F[1] * roll, sz = dz - F[2] * roll, slip = Math.hypot(sx, sy, sz);
        ws.carry += smoke * PUFFS_PER_M * level * Math.min(slip, 2);
        const n = Math.min(5, Math.floor(ws.carry));
        ws.carry = Math.min(1, ws.carry - n);
        if (n > 0) {
          const dtE = Math.max(dt, 1 / 120), sv = slip / dtE, k = sv > 0 ? Math.min(0.25, 3 / sv) / dtE : 0;
          const vx = v[0] * 0.1 + sx * k, vy = v[1] * 0.1 + sy * k, vz = v[2] * 0.1 + sz * k;
          for (let j = 0; j < n; j++) {
            const f = (j + Math.random()) / n, up = 0.35 + Math.random() * 0.35;
            emit(
              ws.p[0] + (D[0] - ws.p[0]) * f + N[0] * 0.35,
              ws.p[1] + (D[1] - ws.p[1]) * f + N[1] * 0.35,
              ws.p[2] + (D[2] - ws.p[2]) * f + N[2] * 0.35,
              vx + N[0] * up,
              vy + N[1] * up,
              vz + N[2] * up,
              level
            );
          }
        }
      }
      ws.p[0] = D[0];
      ws.p[1] = D[1];
      ws.p[2] = D[2];
    }
  }
  function mark(ws, w, level, speed) {
    const ground = !w.hitBody || w.hitBody.motionType === MotionType.STATIC;
    const t = ws.trail;
    const px = D[0] + N[0] * LIFT, py = D[1] + N[1] * LIFT, pz = D[2] + N[2] * LIFT;
    if (!ground || level < (t ? 0.12 : 0.3)) {
      if (t && ground) piece(t, w, px, py, pz, 0, 0.05);
      ws.trail = null;
      return;
    }
    const a = 0.55 * Math.min(1, 0.35 + level);
    if (!t) {
      ws.trail = { p: [px, py, pz], L: [0, 0, 0], R: [0, 0, 0], dir: [0, 0, 0], a: 0, joined: false };
      return;
    }
    piece(t, w, px, py, pz, a, clamp(speed * 0.025, 0.25, 0.8));
  }
  function piece(t, w, px, py, pz, a, minLength) {
    const dx = px - t.p[0], dy = py - t.p[1], dz = pz - t.p[2], d = Math.hypot(dx, dy, dz);
    if (d < minLength) return;
    let sx = N[1] * dz - N[2] * dy, sy = N[2] * dx - N[0] * dz, sz = N[0] * dy - N[1] * dx;
    const sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-6) return;
    const half = (w.width || 0.22) * 0.42 / sl;
    sx *= half;
    sy *= half;
    sz *= half;
    L1[0] = px + sx;
    L1[1] = py + sy;
    L1[2] = pz + sz;
    R1[0] = px - sx;
    R1[1] = py - sy;
    R1[2] = pz - sz;
    const joined = t.joined && (dx * t.dir[0] + dy * t.dir[1] + dz * t.dir[2]) / d > 0.5;
    if (!joined) {
      t.L[0] = t.p[0] + sx;
      t.L[1] = t.p[1] + sy;
      t.L[2] = t.p[2] + sz;
      t.R[0] = t.p[0] - sx;
      t.R[1] = t.p[1] - sy;
      t.R[2] = t.p[2] - sz;
    }
    addQuad(t.L, t.R, L1, R1, t.a, a);
    t.p[0] = px;
    t.p[1] = py;
    t.p[2] = pz;
    t.L[0] = L1[0];
    t.L[1] = L1[1];
    t.L[2] = L1[2];
    t.R[0] = R1[0];
    t.R[1] = R1[1];
    t.R[2] = R1[2];
    t.dir[0] = dx / d;
    t.dir[1] = dy / d;
    t.dir[2] = dz / d;
    t.a = a;
    t.joined = true;
  }
  function update(dt) {
    if (disposed) return;
    if (!(dt >= 0)) {
      const now = (globalThis.performance || Date).now() / 1e3;
      dt = lastT ? now - lastT : 1 / 60;
      lastT = now;
    }
    dt = Math.min(0.1, dt);
    const capacity = Math.round(clamp(Number(opt.marks) || 0, 0, MAX_MARKS));
    if (capacity !== (marks ? marks.capacity : 0)) {
      buildMarks(capacity);
      generation++;
    }
    markMat.uniforms.color.value.set(opt.markColor);
    smokeMat.uniforms.color.value.set(opt.smokeColor);
    const list = Array.isArray(source) ? source : source ? [source] : [];
    for (const car of list) {
      if (isCar(car)) follow(car, dt);
      else if (car) warnOnce("createCarEffects: pass cars made by CAR.create() (one, or an array)");
    }
    ageSmoke(dt);
    if (marks) {
      for (const u of marks.up) u.flush();
      marks.geo.setDrawRange(0, marks.count * 6);
      marks.mesh.visible = marks.count > 0;
      markMat.uniforms.head.value = marks.next;
    }
  }
  function clear() {
    generation++;
    if (marks) {
      marks.next = 0;
      marks.count = 0;
      for (const u of marks.up) u.reset();
      marks.geo.setDrawRange(0, 0);
      marks.mesh.visible = false;
    }
    for (let i = 0; i < POOL; i++) P[i * STRIDE + 7] = -1;
    live = 0;
    smokeGeo.instanceCount = 0;
    smokeMesh.visible = false;
  }
  buildMarks(Math.round(clamp(Number(opt.marks) || 0, 0, MAX_MARKS)));
  return {
    update,
    /** follow other cars: a car, an array (read every update), or null */
    setCars(c) {
      source = c;
    },
    /** wipe every mark and puff (a new race, a restart) */
    clear,
    /** take it out of the scene and free its GPU memory */
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      if (marks) marks.geo.dispose();
      markMat.dispose();
      smokeGeo.dispose();
      smokeMat.dispose();
      texture.dispose();
    },
    /** the options in use; change them live: marks, smoke, markColor, smokeColor */
    options: opt,
    /** the three.js group with the marks and the smoke (fx.object.visible = false hides them) */
    object: group,
    /** how many mark pieces and smoke puffs there are now */
    get stats() {
      return { marks: marks ? marks.count : 0, smoke: live };
    }
  };
}
export {
  createCarEffects
};
