/* The test course, shared by the playground and the Node test gate (tools/test-car.mjs). Plain three.js + crashcat.
   Smooth shapes are extruded side profiles (a triangle mesh in physics, the same triangles drawn), so a ramp starts
   exactly at ground level: no lip for the tyres or the bumper to hit.

   The car starts at the origin facing +Z. Lanes (x): kicker jump -14 · table-top 0 · rounded bumps 14 · rolling hills 30
   · kerbs -30 (sharp 8 / 12 / 16 cm steps: the tyres must roll up them). */
import * as THREE from 'three';
import { rigidBody, box, triangleMesh, MotionType } from 'crashcat';

/** where things are, for tests: { lane x, first z } */
export const COURSE = {
  tableTop: { x: 0, z: 25 },
  kicker: { x: -14, z: 25 },
  bumps: { x: 14, z: 15 },
  hills: { x: 32, z: 10 },
  kerbs: { x: -30, z: 12, heights: [0.08, 0.12, 0.16] },
};

/**
 * @param {THREE.Scene | null} scene draw into this (null: physics only)
 * @param {{ world: any, layers: { static: number, moving: number } }} physics
 * @returns {{ dynamic: { b: any, m: THREE.Mesh }[] }} bodies whose meshes must follow them each frame
 */
export function buildCourse(scene, physics) {
  const dynamic = [];
  const add = (mesh) => { if (scene) { mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh); } };
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });

  /* a static triangle-mesh body from a three.js geometry (already in world space) */
  function solid(geometry, color) {
    const pos = geometry.attributes.position.array;
    const index = geometry.index ? Array.from(geometry.index.array) : Array.from({ length: pos.length / 3 }, (_, i) => i);
    rigidBody.create(physics.world, {
      shape: triangleMesh.create({ positions: Array.from(pos), indices: index }),
      motionType: MotionType.STATIC, objectLayer: physics.layers.static, position: [0, 0, 0], friction: 0.9,
    });
    add(new THREE.Mesh(geometry, mat(color)));
  }

  /* a side profile [[z, y], ...] (z from 0, y ≥ 0) extruded `width` wide, centred on x, starting at z0 */
  function profile(points, width, x, z0, color) {
    /* closed outline along the ground and over the profile, without repeated points (they break triangulation) */
    const outline = [[points[0][0], 0], ...points, [points[points.length - 1][0], 0]];
    const clean = outline.filter((p, i) => i === 0 || Math.hypot(p[0] - outline[i - 1][0], p[1] - outline[i - 1][1]) > 1e-4);
    if (Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) < 1e-4) clean.pop();
    const shape = new THREE.Shape();
    shape.moveTo(clean[0][0], clean[0][1]);
    for (const [z, y] of clean.slice(1)) shape.lineTo(z, y);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
    /* shape x → world z, extrusion → world -x */
    g.rotateY(-Math.PI / 2);
    g.translate(x + width / 2, 0, z0);
    g.computeVertexNormals();
    solid(g, color);
  }
  const curve = (n, len, f) => Array.from({ length: n + 1 }, (_, i) => [(i / n) * len, Math.max(0, f(i / n))]);
  const smooth = (t) => t * t * (3 - 2 * t);

  /* table-top: smooth up 12 m to 1.4 m, flat 5 m, smooth down 12 m */
  {
    const { x, z } = COURSE.tableTop, h = 1.4;
    const pts = [...curve(40, 12, (t) => h * smooth(t)), ...curve(40, 12, (t) => h * smooth(1 - t)).map(([zz, y]) => [zz + 17, y])];
    profile(pts, 8, x, z, 0xd88a3c);
  }
  /* kicker: eases up to 1.3 m over 10 m and ends in a lip; a smooth landing ramp 14 m further on */
  {
    const { x, z } = COURSE.kicker, h = 1.3;
    profile(curve(40, 10, (t) => h * t * t), 8, x, z, 0x3c8ad8);
    profile([[0, 0.02], [0.4, h], ...curve(40, 14, (t) => h * smooth(1 - t)).map(([zz, y]) => [zz + 0.4, y])], 10, x, z + 24, 0x3c8ad8);
  }
  /* rounded speed bumps: 10 cm high, 1.2 m long */
  {
    const { x, z } = COURSE.bumps;
    for (let i = 0; i < 6; i++) profile(curve(16, 1.2, (t) => 0.1 * Math.sin(Math.PI * t) ** 2), 7, x, z + i * 7, 0xe0c040);
  }
  /* rolling hills: 16 × 60 m, waves up to 0.45 m every ~8.6 m, easing to flat over the outer 3 m of each side */
  {
    const { x, z } = COURSE.hills, W = 16, L = 60;
    const g = new THREE.PlaneGeometry(W, L, 32, 150);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / W + 0.5, v = p.getZ(i) / L + 0.5;
      const side = Math.min(1, Math.min(u, 1 - u) * W / 3);
      const edge = smooth(side) * Math.min(1, Math.sin(Math.PI * v) * 3);
      const wave = 0.45 * Math.sin(Math.PI * v * 7) ** 2 * (0.7 + 0.3 * Math.sin(u * 5 + v * 20));
      p.setY(i, Math.max(0, wave * edge));
    }
    g.translate(x, 0, z + L / 2);
    g.computeVertexNormals();
    solid(g, 0x6f9a5a);
  }
  /* kerbs: sharp steps the tyres must climb (flat top 3 m, then back down) */
  {
    const { x, z, heights } = COURSE.kerbs;
    heights.forEach((h, i) => {
      rigidBody.create(physics.world, { shape: box.create({ halfExtents: [4, h / 2, 1.5] }), motionType: MotionType.STATIC, objectLayer: physics.layers.static, position: [x, h / 2, z + i * 10 + 1.5], friction: 0.9 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(8, h, 3), mat(0xc9ccd2));
      m.position.set(x, h / 2, z + i * 10 + 1.5);
      add(m);
    });
  }
  /* things to push: a crate wall, a slalom of cones, a long wall */
  function crate(size, pos, color, mass) {
    const b = rigidBody.create(physics.world, {
      shape: box.create({ halfExtents: size.map((v) => v / 2) }), motionType: mass ? MotionType.DYNAMIC : MotionType.STATIC,
      objectLayer: mass ? physics.layers.moving : physics.layers.static, position: pos, friction: 0.8, ...(mass ? { mass } : {}),
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat(color));
    m.position.set(...pos);
    add(m);
    if (mass) dynamic.push({ b, m });
  }
  for (let y = 0; y < 3; y++) for (let i = 0; i < 5; i++) crate([0.9, 0.9, 0.9], [-12 + i * 0.95 + (y % 2) * 0.45, 0.45 + y * 0.92, -30], 0xb07a4a, 40);
  for (let i = 0; i < 8; i++) crate([0.4, 0.8, 0.4], [((i % 2) * 2 - 1) * 2.5 + 20, 0.4, -20 - i * 9], 0xff6a2a, 6);
  crate([60, 1.5, 1], [0, 0.75, -80], 0x8a8f99, 0);
  return { dynamic };
}
