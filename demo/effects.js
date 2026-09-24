/* Skid marks and tyre smoke for the playground, from the car's per-wheel data (contact point, ground normal, skid
   0..1). Plain three.js: one mesh for all skid marks (a ring buffer of quads, oldest overwritten), one Points
   object for the smoke. */
import * as THREE from 'three';

export function createEffects(scene) {
  /* ---------------------------------------------------------------- skid marks */
  const MAX = 4000;
  const pos = new Float32Array(MAX * 4 * 3), alpha = new Float32Array(MAX * 4);
  const index = new Uint32Array(MAX * 6);
  for (let i = 0; i < MAX; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setDrawRange(0, 0);
  const markMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.06, 0.06, 0.07, vA); }',
  });
  const marks = new THREE.Mesh(geo, markMat);
  marks.frustumCulled = false;
  marks.renderOrder = 1;
  scene.add(marks);
  let next = 0, count = 0;
  const trails = new Map();

  function addQuad(a, b, n, width, strength) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const side = new THREE.Vector3().crossVectors(n, dir).normalize().multiplyScalar(width / 2);
    const i = next;
    const pts = [a.clone().add(side), a.clone().sub(side), b.clone().add(side), b.clone().sub(side)];
    pts.forEach((p, k) => { pos.set([p.x, p.y, p.z], (i * 4 + k) * 3); alpha[i * 4 + k] = 0.42 * strength; });
    next = (next + 1) % MAX;
    count = Math.min(MAX, count + 1);
    geo.setDrawRange(0, count * 6);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- smoke */
  const SMOKE = 500;
  const sPos = new Float32Array(SMOKE * 3), sSize = new Float32Array(SMOKE), sAlpha = new Float32Array(SMOKE);
  const parts = Array.from({ length: SMOKE }, () => ({ life: 0, age: 1, v: new THREE.Vector3(), p: new THREE.Vector3(), size: 1 }));
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  sGeo.setAttribute('size', new THREE.BufferAttribute(sSize, 1).setUsage(THREE.DynamicDrawUsage));
  sGeo.setAttribute('alpha', new THREE.BufferAttribute(sAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  const puff = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const smokeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { map: { value: puff }, scale: { value: 600 } },
    vertexShader: 'attribute float size; attribute float alpha; varying float vA; uniform float scale; void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vec3(0.86), t.a * vA); }',
  });
  const smoke = new THREE.Points(sGeo, smokeMat);
  smoke.frustumCulled = false;
  scene.add(smoke);
  let sNext = 0;
  const carry = new Map();

  function emit(at, vel) {
    const q = parts[sNext];
    sNext = (sNext + 1) % SMOKE;
    q.p.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.15, (Math.random() - 0.5) * 0.3));
    q.v.set((Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8).addScaledVector(vel, 0.25);
    q.age = 0; q.life = 1.4 + Math.random() * 1.2; q.size = 0.5 + Math.random() * 0.4;
  }

  const a = new THREE.Vector3(), nrm = new THREE.Vector3(), cv = new THREE.Vector3();
  /** every frame, after physics.sync(): cars = one car from CAR.create(), or an array of them */
  function update(cars, dt) {
    for (const car of [].concat(cars || [])) {
      const v = car.body.motionProperties.linearVelocity;
      cv.set(v[0], v[1], v[2]);
      car.wheels.forEach((w, i) => {
        const key = `${car.body.id}:${i}`;
        /* a mark starts at 0.3 of skid and keeps going down to 0.12, so it doesn't break into dashes */
        if (!w.grounded || w.skid < (trails.has(key) ? 0.12 : 0.3)) { trails.delete(key); return; }
        nrm.set(w.normal[0], w.normal[1], w.normal[2]);
        a.set(w.contact[0], w.contact[1], w.contact[2]).addScaledVector(nrm, 0.012);
        const last = trails.get(key);
        if (!last) trails.set(key, a.clone());
        else if (last.distanceToSquared(a) > 0.04) { addQuad(last, a, nrm, (w.width || 0.22) * 0.8, Math.min(1, 0.3 + w.skid)); last.copy(a); }
        if (w.skid > 0.35) {
          const c = (carry.get(key) || 0) + dt * 45 * w.skid;
          let k = Math.floor(c);
          carry.set(key, c - k);
          while (k-- > 0) emit(a, cv);
        }
      });
    }
    ageSmoke(dt);
  }
  function ageSmoke(dt) {
    for (let i = 0; i < SMOKE; i++) {
      const q = parts[i];
      if (q.age >= q.life) { sAlpha[i] = 0; continue; }
      q.age += dt;
      q.v.multiplyScalar(Math.exp(-dt * 1.2));
      q.p.addScaledVector(q.v, dt);
      const t = q.age / q.life;
      sPos.set([q.p.x, q.p.y, q.p.z], i * 3);
      sSize[i] = q.size * (1 + t * 4);
      sAlpha[i] = 0.32 * Math.min(1, t * 6) * (1 - t);
    }
    sGeo.attributes.position.needsUpdate = true;
    sGeo.attributes.size.needsUpdate = true;
    sGeo.attributes.alpha.needsUpdate = true;
  }

  function clear() { count = 0; next = 0; geo.setDrawRange(0, 0); trails.clear(); for (const q of parts) q.age = q.life; }
  /** smoke puff size in pixels per metre at 1 m: drawing-buffer height / (2 tan(fov / 2)) */
  function setScale(v) { smokeMat.uniforms.scale.value = v; }
  return { update, clear, setScale };
}
