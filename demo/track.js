/* City Circuit: a street circuit inspired by Baku's city circuit (not a replica): a very long flat-out run along
   the sea with gentle kinks, 90° city-block corners, a narrow twisty old-town section under stone walls, fast
   sweepers back onto the straight. Anti-clockwise, ~3.4 km. Plain three.js + crashcat; works without a scene
   (physics only) so the Node race test uses the same track.

   The layout is a list of corners [x, y, radius, width] in driving order (metres before SCALE; y = north). Each
   corner is filleted with its radius, straights join them. The centreline is sampled every STEP m; everything
   (road, kerbs, walls, racing line, grid, minimap) comes from those samples. World: x = east, z = -north. */
import * as THREE from 'three';
import { rigidBody, triangleMesh, MotionType } from 'crashcat';

const SCALE = 0.75;
const STEP = 2;
const WALL_GAP = 1.3, WALL_H = 1.1, WALL_T = 0.6;

/* [x, y, corner radius, track width]; the first point is the start / finish line */
export const LAYOUT = [
  [500, 800, 0, 16],     // start / finish, heading west along the sea
  [0, 800, 24, 14],      // T1 left
  [0, 640, 22, 14],      // T2 left
  [220, 640, 22, 14],    // T3 right
  [220, 470, 24, 14],    // T4 right
  [60, 470, 20, 13],     // T5 left
  [60, 400, 20, 13],     // T6 right
  [-80, 400, 18, 11],    // T7 left, into the old town
  [-80, 330, 16, 8.5],   // T8 castle section: narrow, twisty
  [-40, 295, 16, 8.5],
  [-10, 245, 18, 9],     // T9
  [-20, 200, 22, 10],    // T10
  [30, 140, 45, 13],     // T11
  [160, 90, 100, 14],    // T12 fast
  [700, 60, 24, 14],     // T13 left
  [700, 350, 26, 14],    // T14 right
  [900, 350, 26, 14],    // T15 left
  [900, 650, 28, 14],    // T16 right
  [1320, 660, 150, 15],  // flat-out left sweep onto the straight
  [1420, 800, 160, 16],
  [1000, 815, 500, 16],  // kinks on the straight
  [700, 795, 500, 16],
];

/**
 * @param {THREE.Scene | null} scene draw into it (null: physics + data only)
 * @param {{ world: any, layers: { static: number } }} physics
 */
export function buildTrack(scene, physics) {
  const samples = centreline();
  const N = samples.length, length = samples[N - 1].s + dist(samples[N - 1].p, samples[0].p);
  const racing = racingLine(samples);

  /* physics: the walls (the ground is the physics floor) */
  for (const side of [1, -1]) {
    const geo = wallGeometry(samples, side);
    rigidBody.create(physics.world, {
      shape: triangleMesh.create({ positions: Array.from(geo.attributes.position.array), indices: Array.from(geo.index.array) }),
      motionType: MotionType.STATIC, objectLayer: physics.layers.static, position: [0, 0, 0], friction: 0.4, restitution: 0.1,
    });
    if (scene) {
      const m = new THREE.Mesh(geo, wallMaterial());
      m.receiveShadow = true; m.castShadow = true;
      scene.add(m);
    }
  }
  if (scene) scenery(scene, samples, length);

  const wrap = (i) => ((i % N) + N) % N;
  const track = {
    samples, length, racing,
    /** index of the sample nearest to world [x, z]; hint = last index (searches around it), else searches all */
    nearest(x, z, hint) {
      let best = -1, bd = Infinity;
      const scan = (i) => { const q = samples[i].p, d = (q[0] - x) ** 2 + (q[1] - z) ** 2; if (d < bd) { bd = d; best = i; } };
      if (hint === undefined || hint < 0) for (let i = 0; i < N; i++) scan(i);
      else { for (let k = -40; k <= 40; k++) scan(wrap(hint + k)); if (bd > 30 * 30) for (let i = 0; i < N; i++) scan(i); }
      const q = samples[best];
      const lateral = (x - q.p[0]) * q.n[0] + (z - q.p[1]) * q.n[1];
      return { i: best, s: q.s, lateral, dist: Math.sqrt(bd) };
    },
    /** world point at sample i, `offset` metres to the left of the centreline */
    point(i, offset = 0) { const q = samples[wrap(i)]; return [q.p[0] + q.n[0] * offset, q.p[1] + q.n[1] * offset]; },
    wrap,
    /** grid slot k (0 = pole): { position: [x, y, z], yaw } */
    grid(k) {
      const back = Math.round((12 + k * 8) / STEP);
      const i = wrap(-back);
      const q = samples[i], side = k % 2 === 0 ? 1 : -1;
      const x = q.p[0] + q.n[0] * 3.3 * side, z = q.p[1] + q.n[1] * 3.3 * side;
      return { position: [x, 0.05, z], yaw: Math.atan2(q.t[0], q.t[1]), index: i };
    },
    /** a safe place to put a car back on the track near sample i: { position, yaw } */
    resetAt(i) {
      const q = samples[wrap(i)];
      return { position: [q.p[0], 0.3, q.p[1]], yaw: Math.atan2(q.t[0], q.t[1]) };
    },
  };
  return track;
}

/* ------------------------------------------------------------------ geometry of the layout */

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

function centreline() {
  const V = LAYOUT.map(([x, y, r, w]) => ({ p: [x * SCALE, -y * SCALE], r: r * SCALE, w }));
  const n = V.length;
  /* fillet each corner: tangent points a (in) and b (out) and the arc between */
  for (let i = 0; i < n; i++) {
    const prev = V[(i - 1 + n) % n].p, cur = V[i].p, next = V[(i + 1) % n].p;
    const d0 = norm([cur[0] - prev[0], cur[1] - prev[1]]), d1 = norm([next[0] - cur[0], next[1] - cur[1]]);
    const turn = Math.acos(Math.max(-1, Math.min(1, d0[0] * d1[0] + d0[1] * d1[1])));
    const v = V[i];
    if (turn < 1e-3 || v.r <= 0) { v.a = cur; v.b = cur; v.arc = null; continue; }
    let t = v.r * Math.tan(turn / 2);
    t = Math.min(t, 0.45 * dist(prev, cur), 0.45 * dist(cur, next));
    const r = t / Math.tan(turn / 2);
    /* left of a heading (tx, tz) in x/z with y up is (tz, -tx) */
    const left0 = [d0[1], -d0[0]];
    const isLeft = d1[0] * left0[0] + d1[1] * left0[1] > 0;
    const a = [cur[0] - d0[0] * t, cur[1] - d0[1] * t], b = [cur[0] + d1[0] * t, cur[1] + d1[1] * t];
    const c = [a[0] + left0[0] * r * (isLeft ? 1 : -1), a[1] + left0[1] * r * (isLeft ? 1 : -1)];
    v.a = a; v.b = b; v.arc = { c, r, turn, isLeft };
  }
  const pts = [];
  for (let i = 0; i < n; i++) {
    const v = V[i], next = V[(i + 1) % n];
    /* the arc of this corner, then the straight to the next corner */
    if (v.arc) {
      const { c, r, turn } = v.arc;
      const a0 = Math.atan2(v.a[1] - c[1], v.a[0] - c[0]), b0 = Math.atan2(v.b[1] - c[1], v.b[0] - c[0]);
      let sweep = b0 - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      void turn;
      const k = Math.max(2, Math.ceil((Math.abs(sweep) * r) / STEP));
      for (let j = 0; j < k; j++) { const ang = a0 + (sweep * j) / k; pts.push({ p: [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)], w: v.w }); }
    }
    const from = v.b, to = next.a, L = dist(from, to);
    const k = Math.max(1, Math.round(L / STEP));
    for (let j = 0; j < k; j++) {
      const f = j / k;
      pts.push({ p: [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f], w: v.w + (next.w - v.w) * smooth(f) });
    }
  }
  /* arc length, tangent, left normal, curvature */
  const N = pts.length;
  let s = 0;
  for (let i = 0; i < N; i++) {
    if (i) s += dist(pts[i].p, pts[i - 1].p);
    pts[i].s = s;
  }
  for (let i = 0; i < N; i++) {
    const a = pts[(i - 1 + N) % N].p, b = pts[(i + 1) % N].p;
    const t = norm([b[0] - a[0], b[1] - a[1]]);
    pts[i].t = t;
    pts[i].n = [t[1], -t[0]];
  }
  for (let i = 0; i < N; i++) pts[i].k = curvature(pts[(i - 3 + N) % N].p, pts[i].p, pts[(i + 3) % N].p);
  return pts;
}

/* signed curvature through three points (+ = turning left) */
function curvature(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1]], bc = [c[0] - b[0], c[1] - b[1]], ac = [c[0] - a[0], c[1] - a[1]];
  const cross = ab[0] * bc[1] - ab[1] * bc[0];
  const d = Math.hypot(...ab) * Math.hypot(...bc) * Math.hypot(...ac);
  /* in x/z with y up, a left turn has a negative 2D cross product */
  return d > 1e-9 ? (-2 * cross) / d : 0;
}

/* a racing line: offsets from the centreline that straighten the path within the track (relaxation toward the
   midpoint of the neighbours, clamped to the track minus a margin) → outside-apex-outside through corners */
function racingLine(S) {
  const N = S.length, off = new Float32Array(N), K = 7, margin = 2.2;
  const pos = (i) => { const q = S[i]; return [q.p[0] + q.n[0] * off[i], q.p[1] + q.n[1] * off[i]]; };
  for (let it = 0; it < 500; it++) {
    for (let i = 0; i < N; i++) {
      const a = pos((i - K + N) % N), b = pos((i + K) % N), q = S[i];
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const want = (m[0] - q.p[0]) * q.n[0] + (m[1] - q.p[1]) * q.n[1];
      const lim = Math.max(0, q.w / 2 - margin);
      off[i] = Math.max(-lim, Math.min(lim, off[i] + (want - off[i]) * 0.5));
    }
  }
  const pts = Array.from({ length: N }, (_, i) => pos(i));
  const k = pts.map((p, i) => curvature(pts[(i - 4 + N) % N], p, pts[(i + 4) % N]));
  return { offset: off, points: pts, curvature: k };
}

function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
function smooth(t) { return t * t * (3 - 2 * t); }

/* a concrete barrier along one side (side 1 = left): track face, top, back face; UV u along the wall (m) */
function wallGeometry(S, side) {
  const N = S.length, pos = [], uv = [], idx = [];
  const line = (q, extra) => { const d = side * (q.w / 2 + WALL_GAP + extra); return [q.p[0] + q.n[0] * d, q.p[1] + q.n[1] * d]; };
  /* adverts read left-to-right from the track side on both walls, and from behind */
  const u = (s, back) => (side > 0 === back ? -s : s) / 8;
  for (let i = 0; i <= N; i++) {
    const q = S[i % N], s = i === N ? S[N - 1].s + dist(S[N - 1].p, S[0].p) : q.s;
    const a = line(q, 0), b = line(q, WALL_T);
    /* 6 vertices per step: bottom-in, top-in, top-out, bottom-out, and top-out / bottom-out again for the back face */
    pos.push(a[0], 0, a[1], a[0], WALL_H, a[1], b[0], WALL_H, b[1], b[0], 0, b[1], b[0], WALL_H, b[1], b[0], 0, b[1]);
    uv.push(u(s, false), 0, u(s, false), 1, u(s, false), 1, u(s, false), 0, u(s, true), 1, u(s, true), 0);
  }
  for (let i = 0; i < N; i++) {
    const o = i * 6, p = o + 6;
    const quad = (a, b, c, d) => { if (side > 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); };
    quad(o, p, p + 1, o + 1);           // track face
    quad(o + 1, p + 1, p + 2, o + 2);   // top
    quad(o + 4, p + 4, p + 5, o + 5);   // back
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ looks (browser only) */

function canvasTexture(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

let wallMat = null;
function wallMaterial() {
  if (wallMat) return wallMat;
  const words = ['CITY GP', 'SPEED', 'CASPIAN', 'OLD TOWN', 'NIGHT RUN', 'FAST LANE'];
  const map = canvasTexture(1024, 128, (g, w, h) => {
    g.fillStyle = '#d9dbe0'; g.fillRect(0, 0, w, h);
    const colors = ['#1f4fbf', '#d8262d', '#11141c', '#f2a900', '#0f8a5f', '#6a2fbf'];
    for (let k = 0; k < 4; k++) {
      g.fillStyle = colors[k % colors.length]; g.fillRect(k * 256 + 6, 18, 244, 92);
      g.fillStyle = '#fff'; g.font = 'bold 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(words[k % words.length], k * 256 + 128, 66);
    }
    g.fillStyle = '#b8bcc4'; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);
  });
  map.repeat.set(0.25, 1);
  wallMat = new THREE.MeshStandardMaterial({ map, roughness: 0.8 });
  return wallMat;
}

function scenery(scene, S, length) {
  const N = S.length;
  /* ground (city pavement) and the sea to the north */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x8f8a7e, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true;
  scene.add(ground);
  const seaZ = -800 * SCALE - 60;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 1500), new THREE.MeshStandardMaterial({ color: 0x2a6f9a, roughness: 0.25, metalness: 0.1 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(500, -0.01, seaZ - 750);
  scene.add(sea);

  /* road: asphalt with white edge lines */
  const asphalt = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3b3d42'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 50 + Math.random() * 30; g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    g.fillStyle = '#e9e9e9'; g.fillRect(0, 6, w, 7); g.fillRect(0, h - 13, w, 7);
  });
  asphalt.repeat.set(1, 1);
  const rp = [], ruv = [], ri = [];
  for (let i = 0; i <= N; i++) {
    const q = S[i % N], s = i === N ? length : q.s, h = q.w / 2;
    rp.push(q.p[0] + q.n[0] * h, 0.02, q.p[1] + q.n[1] * h, q.p[0] - q.n[0] * h, 0.02, q.p[1] - q.n[1] * h);
    ruv.push(s / 12, 0, s / 12, 1);
    if (i < N) { const o = i * 2; ri.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const road = new THREE.Mesh(geometry(rp, ruv, ri), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }));
  road.receiveShadow = true;
  scene.add(road);

  /* kerbs where it bends: red / white stripes just outside both edges */
  const kerbTex = canvasTexture(64, 16, (g) => { g.fillStyle = '#d42a2a'; g.fillRect(0, 0, 32, 16); g.fillStyle = '#f2f2f2'; g.fillRect(32, 0, 32, 16); });
  const kp = [], kuv = [], ki = [];
  for (const side of [1, -1]) {
    let open = false;
    for (let i = 0; i <= N; i++) {
      const q = S[i % N];
      const bend = Math.abs(q.k) > 1 / 180;
      if (!bend) { open = false; continue; }
      const a = side * q.w / 2, b = side * (q.w / 2 + 1.1);
      const base = kp.length / 3;
      kp.push(q.p[0] + q.n[0] * a, 0.03, q.p[1] + q.n[1] * a, q.p[0] + q.n[0] * b, 0.03, q.p[1] + q.n[1] * b);
      kuv.push(q.s / 2, 0, q.s / 2, 1);
      if (open) { const o = base - 2; if (side > 0) ki.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); else ki.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      open = true;
    }
  }
  const kerbs = new THREE.Mesh(geometry(kp, kuv, ki), new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
  kerbs.receiveShadow = true;
  scene.add(kerbs);

  /* start / finish: a chequered band, and the grid boxes */
  const cheq = canvasTexture(128, 16, (g) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); } }, false);
  const q0 = S[0];
  const line = new THREE.Mesh(new THREE.PlaneGeometry(q0.w, 2), new THREE.MeshStandardMaterial({ map: cheq, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3 }));
  line.rotation.x = -Math.PI / 2; line.rotation.z = Math.atan2(q0.n[0], q0.n[1]) + Math.PI / 2;
  line.position.set(q0.p[0], 0.04, q0.p[1]);
  scene.add(line);
  const boxMat = new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -3 });
  for (let k = 0; k < 8; k++) {
    const back = Math.round((12 + k * 8) / STEP) - 2, q = S[(N - back) % N], side = k % 2 === 0 ? 1 : -1;
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.25), boxMat);
    bar.rotation.x = -Math.PI / 2; bar.rotation.z = Math.atan2(q.n[0], q.n[1]) + Math.PI / 2;
    bar.position.set(q.p[0] + q.n[0] * 3.3 * side, 0.04, q.p[1] + q.n[1] * 3.3 * side);
    scene.add(bar);
  }

  /* where the track is: for keeping buildings off it */
  const cell = 20, occ = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const q of S) occ.set(key(q.p[0], q.p[1]), Math.max(occ.get(key(q.p[0], q.p[1])) || 0, q.w / 2 + WALL_GAP + WALL_T));
  const clear = (x, z, r) => {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const cx = Math.floor(x / cell) + dx, cz = Math.floor(z / cell) + dz;
      if (!occ.has(`${cx},${cz}`)) continue;
      for (const q of S) {
        if (Math.floor(q.p[0] / cell) !== cx || Math.floor(q.p[1] / cell) !== cz) continue;
        if (Math.hypot(q.p[0] - x, q.p[1] - z) < q.w / 2 + WALL_GAP + WALL_T + r) return false;
      }
    }
    return true;
  };

  /* city blocks: sandstone and glass buildings along the outside of the walls */
  const windows = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#e8e2d4'; g.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 24) for (let x = 8; x < w; x += 20) { g.fillStyle = Math.random() < 0.25 ? '#f5d68a' : '#48607a'; g.fillRect(x, y, 11, 14); }
  });
  const boxes = [];
  for (let i = 0; i < N; i += 14) {
    const q = S[i];
    for (const side of [1, -1]) {
      const depth = 12 + Math.random() * 16, width = 14 + Math.random() * 14, height = 10 + Math.random() * 38;
      const d = side * (q.w / 2 + WALL_GAP + 6 + depth / 2);
      const x = q.p[0] + q.n[0] * d, z = q.p[1] + q.n[1] * d;
      if (z < seaZ + 40) continue;
      if (!clear(x, z, Math.max(depth, width) / 2 + 2)) continue;
      boxes.push({ x, z, depth, width, height, yaw: Math.atan2(q.t[0], q.t[1]) });
    }
  }
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  bGeo.translate(0, 0.5, 0);
  const bMat = new THREE.MeshStandardMaterial({ map: windows, roughness: 0.85 });
  const inst = new THREE.InstancedMesh(bGeo, bMat, boxes.length);
  const m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), col = new THREE.Color();
  const tones = [0xefe3c8, 0xe0cfa9, 0xd6c7a6, 0xcfd6dc, 0xf1ebe0, 0xc9b28a];
  boxes.forEach((b, k) => {
    qn.setFromEuler(new THREE.Euler(0, b.yaw, 0));
    m4.compose(new THREE.Vector3(b.x, 0, b.z), qn, new THREE.Vector3(b.width, b.height, b.depth));
    inst.setMatrixAt(k, m4);
    inst.setColorAt(k, col.setHex(tones[k % tones.length]));
  });
  inst.castShadow = true; inst.receiveShadow = true;
  scene.add(inst);

  /* the old town walls along the narrow section (outside of corners 8–10) */
  const stone = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#b89b6e'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8e7550'; g.lineWidth = 2;
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 0 : -16; x < w; x += 32) g.strokeRect(x, y, 32, 16);
  });
  stone.repeat.set(1, 1);
  const castle = S.filter((q) => q.w < 10.5);
  const wp = [], wuv = [], wi = [];
  castle.forEach((q, k) => {
    const d = -(q.w / 2 + WALL_GAP + WALL_T + 2.5);
    const x = q.p[0] + q.n[0] * d, z = q.p[1] + q.n[1] * d;
    wp.push(x, 0, z, x, 7, z);
    wuv.push(k * 0.25, 0, k * 0.25, 1.5);
    /* one winding only: the material is double-sided (both windings would cancel the normals → black) */
    if (k) { const o = (k - 1) * 2; wi.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
  });
  if (castle.length > 1) {
    const cw = new THREE.Mesh(geometry(wp, wuv, wi), new THREE.MeshStandardMaterial({ map: stone, roughness: 1, side: THREE.DoubleSide }));
    cw.castShadow = true;
    scene.add(cw);
  }

  /* three flame-shaped towers on the hill behind the old town */
  const flame = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    flame.push(new THREE.Vector2(Math.max(0.3, 16 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.55)), t * 170));
  }
  const flameGeo = new THREE.LatheGeometry(flame, 40);
  const glass = new THREE.MeshStandardMaterial({ color: 0x4c8fd6, metalness: 0.6, roughness: 0.18, emissive: 0x0b2244, emissiveIntensity: 0.4 });
  [[-420, 60, 1], [-470, 10, 0.85], [-380, -20, 0.8]].forEach(([x, y, s]) => {
    const t = new THREE.Mesh(flameGeo, glass);
    t.position.set(x * SCALE, 0, -y * SCALE + 0); t.scale.set(s, s, s * 0.7);
    t.castShadow = true;
    scene.add(t);
  });

  /* grandstand on the inside of the start / finish straight */
  const seats = canvasTexture(64, 64, (g) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = ['#c0392b', '#2e86de', '#f1c40f', '#ecf0f1'][(x * 7 + y * 3) % 4]; g.fillRect(x * 8, y * 8, 7, 7); } });
  const standMat = new THREE.MeshStandardMaterial({ map: seats, roughness: 0.9 });
  const sq = S[Math.round(40 / STEP)];
  for (let row = 0; row < 5; row++) {
    const d = -(sq.w / 2 + WALL_GAP + WALL_T + 3 + row * 2.2);
    const st = new THREE.Mesh(new THREE.BoxGeometry(90, 1.5 + row * 1.5, 2.2), standMat);
    st.position.set(sq.p[0] + sq.n[0] * d, (1.5 + row * 1.5) / 2, sq.p[1] + sq.n[1] * d);
    st.rotation.y = Math.atan2(sq.t[0], sq.t[1]) + Math.PI / 2;
    st.castShadow = true; st.receiveShadow = true;
    scene.add(st);
  }

  /* palm trees along the seafront promenade */
  const trunk = new THREE.CylinderGeometry(0.25, 0.4, 7, 6);
  trunk.translate(0, 3.5, 0);
  const crown = new THREE.ConeGeometry(2.6, 2.2, 7);
  crown.translate(0, 7.6, 0);
  const trees = [];
  for (let i = 0; i < N; i += 6) {
    const q = S[i];
    if (Math.abs(q.p[1] - (-800 * SCALE)) > 25) continue;
    const d = q.n[1] < 0 ? 1 : -1;
    const off = d * (q.w / 2 + WALL_GAP + WALL_T + 7);
    trees.push([q.p[0] + q.n[0] * off, q.p[1] + q.n[1] * off]);
  }
  const tI = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x7a5a3a }), trees.length);
  const cI = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0x2f7a3a }), trees.length);
  trees.forEach(([x, z], k) => { m4.makeTranslation(x, 0, z); tI.setMatrixAt(k, m4); cI.setMatrixAt(k, m4); });
  tI.castShadow = cI.castShadow = true;
  scene.add(tI, cI);
}

function geometry(pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
