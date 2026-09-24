/* The playground: drive any car model on a small course. Uses only the library's public API (the import map's "car")
   plus plain three.js + crashcat for the course, like a game would. Sound (demo/sound.js) and skid marks / smoke
   (demo/effects.js) read the car's public data. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import CAR from 'car';
import { buildCourse } from './course.js';
import { createCarSound, ENGINE_FOR_PRESET } from './sound.js';
import { createEffects } from './effects.js';

const MODELS = [
  { name: 'Cyberpunk car', file: '/assets/models/test/cyberpunk_car.glb', preset: 'sport' },
  { name: 'VAZ 2107', file: '/assets/models/test/vaz_2107.glb', preset: 'classic' },
  { name: 'Dirty car', file: '/assets/models/test/dirty_car.glb', preset: 'offroad' },
];
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ renderer, scene, light */
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb6c9);
scene.fog = new THREE.Fog(0x9fb6c9, 90, 360);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1000);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4436, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
scene.add(sun, sun.target);

/* ------------------------------------------------------------------ physics + course */
const physics = CAR.createPhysics({ floor: 800 });
const { dynamic } = buildCourse(scene, physics);

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5d6168'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#656970'; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128);
  g.strokeStyle = '#7a7e86'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(100, 100); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);

const sound = createCarSound();
const fx = createEffects(scene);
let cam = null;

/* ------------------------------------------------------------------ car loading */
const loader = new GLTFLoader();
let car = null, current = null;
const forwardOverride = {};
let overrides = {};
const cache = new Map();

async function loadModel(src) {
  if (cache.has(src.file || src.name)) return cache.get(src.file || src.name);
  const gltf = src.buffer ? await loader.parseAsync(src.buffer, '') : await loader.loadAsync(src.file);
  gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  cache.set(src.file || src.name, gltf);
  return gltf;
}

async function spawn(src, keepPlace = false) {
  message(`Loading ${src.name}…`);
  let gltf;
  try { gltf = await loadModel(src); } catch (e) { message(`Could not load ${src.name}: ${e.message || e}`, 4000); return; }
  const place = keepPlace && car ? [car.body.position[0], car.body.position[1] + 0.3, car.body.position[2]] : [0, 0, 0];
  const yaw = keepPlace && car ? headingOf(car) : 0;
  if (car) car.remove();
  current = src;
  const t0 = performance.now();
  car = CAR.create({ scene, physics, model: gltf.scene, preset: $('preset').value, position: place, yaw, forward: forwardOverride[src.name], ...overrides });
  const ms = performance.now() - t0;
  if (!car) { message(`No wheels found in ${src.name}. Automatic detection needs the wheels to be separate parts of the mesh.`, 6000); return; }
  message('');
  showReport(ms);
  const a = gltf.asset?.extras || {};
  $('credit').innerHTML = a.title ? `“${esc(a.title)}” by ${esc(String(a.author || '').replace(/\s*\(.*\)/, ''))} · ${esc(String(a.license || '').replace(/\s*\(.*\)/, ''))}${a.source ? ` · <a href="${esc(a.source)}" target="_blank" rel="noopener">source</a>` : ''}` : esc(src.name);
  sound.useEngine($('engine').value || ENGINE_FOR_PRESET[$('preset').value] || 'm52');
  if (!cam) cam = CAR.createCamera(camera, car); else cam.setCar(car);
  cam.reset();
  debugGroup.clear();
  if (debugOn) buildDebug();
  buildTune();
}

function showReport(ms) {
  const r = car.report;
  const lines = [
    `${current.name}  (${ms.toFixed(0)} ms to detect + rig)`,
    `size ${r.size.length} × ${r.size.width} × ${r.size.height} m · wheelbase ${r.wheelbase} m · track ${r.track} m`,
    `front: ${fmtAxis(r.forward)} (confidence ${(r.frontConfidence * 100).toFixed(0)}%) · units ×${r.unitScale}`,
    ...r.wheels.map((w, i) => `wheel ${i}: axle ${w.axle} ${w.left ? 'left ' : 'right'} ⌀ ${(w.radius * 2).toFixed(2)} m × ${w.width.toFixed(2)} m`),
    `preset ${$('preset').value}: ${car.params.power} kW · ${car.params.mass} kg · ${car.params.drive.toUpperCase()} · ${car.params.gears} gears · top ${car.params.topSpeed} km/h`,
    ...r.notes.map((n) => `note: ${n}`),
  ];
  $('report').textContent = lines.join('\n');
}
const fmtAxis = (f) => (f[0] ? (f[0] > 0 ? '+x' : '-x') : f[2] > 0 ? '+z' : '-z');
const headingOf = (c) => { const q = c.body.quaternion; return Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0])); };
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

let msgTimer = 0;
function message(text, ms = 0) {
  $('msg').textContent = text;
  $('msg').classList.toggle('on', !!text);
  clearTimeout(msgTimer);
  if (ms) msgTimer = setTimeout(() => $('msg').classList.remove('on'), ms);
}

/* ------------------------------------------------------------------ tuning panel (live: car.tune / camera options) */
const CAM_TUNING = { fov: [40, 90, '° field of view'], fovBoost: [0, 30, '° extra at speed'], distance: [0.5, 2.5, '× distance'], height: [0.4, 2.5, '× height'], stiffness: [0.3, 3, '× follow'], shake: [0, 3, '× shake'] };
const GROUPS = [
  ['Engine', ['power', 'topSpeed', 'redline', 'gears', 'shiftTime', 'engineBrake', 'mass']],
  ['Tyres & steering', ['grip', 'steer', 'steerSpeed', 'handbrakeGrip', 'assist']],
  ['Suspension', ['stiffness', 'damping', 'antiRoll', 'travel']],
];
function slider(key, [min, max, label], value, onInput) {
  const step = key === 'gears' ? 1 : max - min > 100 ? 10 : max - min > 10 ? 1 : 0.01;
  const el = document.createElement('label');
  el.innerHTML = `<span>${key} <small>(${label})</small></span><output>${fmt(value)}</output><input type="range" min="${min}" max="${max}" step="${step}" value="${value}">`;
  const input = el.querySelector('input'), out = el.querySelector('output');
  input.oninput = () => { const v = Number(input.value); out.textContent = fmt(v); onInput(v); };
  input.onkeydown = (e) => e.stopPropagation();
  return el;
}
const fmt = (v) => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
function buildTune() {
  const box = $('tune');
  box.innerHTML = '';
  if (!car) return;
  const drive = document.createElement('label');
  drive.innerHTML = `<span>drive</span><select><option value="awd">AWD</option><option value="rwd">RWD</option><option value="fwd">FWD</option></select>`;
  const sel = drive.querySelector('select');
  sel.value = car.params.drive;
  sel.onchange = () => { car.tune({ drive: sel.value }); overrides.drive = sel.value; };
  for (const [title, keys] of GROUPS) {
    const h = document.createElement('h3'); h.textContent = title; box.append(h);
    if (title === 'Engine') box.append(drive);
    for (const k of keys) box.append(slider(k, CAR.tuning[k], car.params[k], (v) => { overrides[k] = v; car.tune({ [k]: v }); }));
  }
  const hs = document.createElement('h3'); hs.textContent = 'Sound'; box.append(hs);
  const SOUND = { engine: [0, 2, 'recorded engine'], pops: [0, 1.5, 'pops & bangs'], turbo: [0, 1.5, 'turbo whine + whoosh'], blowoff: [0, 1.5, 'blow-off / flutter'] };
  for (const k in SOUND) box.append(slider(k, SOUND[k], mix[k], (v) => { mix[k] = v; applyMix(); }));
  const h = document.createElement('h3'); h.textContent = 'Camera'; box.append(h);
  for (const k in CAM_TUNING) box.append(slider(k, CAM_TUNING[k], cam.options[k], (v) => { cam.options[k] = v; }));
  const btns = document.createElement('div'); btns.className = 'btns';
  btns.innerHTML = '<button data-a="reset">Reset to preset</button><button data-a="copy">Copy settings</button>';
  btns.onclick = async (e) => {
    const a = e.target.dataset.a;
    if (a === 'reset') { overrides = {}; spawn(current, true); }
    if (a === 'copy') {
      const text = JSON.stringify({ preset: $('preset').value, ...overrides });
      try { await navigator.clipboard.writeText(text); message('Copied: pass these to CAR.create({ ... })', 2500); } catch { message(text, 6000); }
    }
  };
  box.append(btns);
}

/* ------------------------------------------------------------------ UI */
for (const m of MODELS) $('model').add(new Option(m.name, m.name));
for (const p of CAR.presets) $('preset').add(new Option(`preset: ${p}`, p));
$('model').onchange = () => { const m = MODELS.find((x) => x.name === $('model').value) || current; $('preset').value = m.preset || 'car'; overrides = {}; fx.clear(); spawn(m); };
$('preset').onchange = () => { overrides = {}; if (current) spawn(current, true); };
$('flip').onclick = () => {
  if (!car) return;
  const f = car.report.forward;
  forwardOverride[current.name] = (f[0] || f[2]) > 0 ? `-${f[0] ? 'x' : 'z'}` : `+${f[0] ? 'x' : 'z'}`;
  spawn(current, true);
};
$('open').onclick = () => $('file').click();
$('file').onchange = () => { const f = $('file').files[0]; if (f) openFile(f); $('file').value = ''; };
addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('on'); });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('drop').classList.remove('on'); });
addEventListener('drop', (e) => { e.preventDefault(); $('drop').classList.remove('on'); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
async function openFile(f) {
  if (!/\.glb$/i.test(f.name)) { message('Please use a .glb file (Sketchfab: Download → glTF → .glb).', 4000); return; }
  const src = { name: f.name.replace(/\.glb$/i, ''), buffer: await f.arrayBuffer(), preset: 'car' };
  $('model').add(new Option(src.name, src.name)); $('model').value = src.name;
  MODELS.push(src);
  $('preset').value = 'car';
  overrides = {};
  spawn(src);
}
let debugOn = false, infoOn = false, tuneOn = false;
const toggleDebug = () => { debugOn = !debugOn; $('debug').setAttribute('aria-pressed', debugOn); debugGroup.clear(); if (debugOn) buildDebug(); };
const toggleInfo = () => { infoOn = !infoOn; $('info').setAttribute('aria-pressed', infoOn); $('report').classList.toggle('on', infoOn); };
const toggleTune = () => { tuneOn = !tuneOn; $('tuneBtn').setAttribute('aria-pressed', tuneOn); $('tune').classList.toggle('on', tuneOn); };
const CAM_MODES = ['chase', 'far', 'hood'];
const cycleCam = () => { if (!cam) return; cam.setMode(CAM_MODES[(CAM_MODES.indexOf(cam.mode) + 1) % 3]); $('cam').textContent = `Camera: ${cam.mode}`; };
const toggleMute = () => { sound.start(); sound.setMuted(!sound.muted); $('mute').setAttribute('aria-pressed', sound.muted); $('mute').textContent = sound.muted ? 'Sound: off' : 'Sound'; };
/* every recorded engine (assets/sounds/engines/index.json); "by preset" follows the preset */
for (const [k, t] of [['v8', 'V8'], ['inline6', 'straight-6'], ['inline4', '4-cylinder'], ['v12', 'V12']]) $('engine').add(new Option(`built-in (no files): ${t}`, `synth:${k}`));
fetch('/assets/sounds/engines/index.json').then((r) => r.json()).then((list) => {
  for (const e of list) $('engine').add(new Option(`engine: ${e.title}`, e.name));
}).catch(() => {});
$('engine').onchange = () => { sound.start(); sound.useEngine($('engine').value || ENGINE_FOR_PRESET[$('preset').value] || 'm52'); $('engine').blur(); };
/* sound mix: levels from the Tune panel's Sound sliders; the Pops / Turbo buttons switch them on and off */
const mix = { engine: 1, pops: 1, turbo: 0.6, blowoff: 0.6 };
let popsOn = true, turboMode = 0;
const TURBO = [['blow-off', 'blowoff'], ['flutter', 'flutter'], ['off', null]];
function applyMix() {
  const on = TURBO[turboMode][1] !== null;
  sound.setFx({ pops: popsOn ? mix.pops : 0, turbo: on ? mix.turbo : 0, blowoff: on ? mix.blowoff : 0, valve: TURBO[turboMode][1] || 'blowoff' });
  sound.setEngineVolume(mix.engine);
}
const togglePops = () => { popsOn = !popsOn; applyMix(); $('pops').setAttribute('aria-pressed', popsOn); };
const cycleTurbo = () => { turboMode = (turboMode + 1) % 3; applyMix(); $('turbo').textContent = `Turbo: ${TURBO[turboMode][0]}`; $('turbo').setAttribute('aria-pressed', turboMode !== 2); };
$('pops').onclick = togglePops;
$('turbo').onclick = cycleTurbo;
$('debug').onclick = toggleDebug;
$('info').onclick = toggleInfo;
$('tuneBtn').onclick = toggleTune;
$('cam').onclick = cycleCam;
$('mute').onclick = toggleMute;
for (const b of document.querySelectorAll('#panel button, #panel select')) b.addEventListener('keydown', (e) => { if (e.code === 'Space') e.preventDefault(); });

/* ------------------------------------------------------------------ controls: keyboard, touch, gamepad, mouse orbit */
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  sound.start();
  keys.add(e.code);
  if (e.code === 'KeyR' && car) { car.reset(); cam?.reset(); }
  if (e.code === 'KeyC') cycleCam();
  if (e.code === 'KeyB') toggleDebug();
  if (e.code === 'KeyI') toggleInfo();
  if (e.code === 'KeyT') toggleTune();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyP') togglePops();
  if (e.code === 'KeyO') cycleTurbo();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

/* drag on the view (mouse or one finger) orbits the camera around the car; the wheel zooms */
let drag = null;
canvas.addEventListener('pointerdown', (e) => { sound.start(); drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('drag'); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id || !cam) return;
  cam.orbit(e.clientX - drag.x, e.clientY - drag.y);
  drag.x = e.clientX; drag.y = e.clientY;
});
const endDrag = () => { drag = null; canvas.classList.remove('drag'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam?.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });

const touch = { l: 0, r: 0, g: 0, b: 0, h: 0 };
if (matchMedia('(pointer: coarse)').matches) $('touch').classList.add('on');
for (const k of Object.keys(touch)) {
  const el = document.querySelector(`#touch .${k}`);
  el.onpointerdown = (e) => { sound.start(); touch[k] = 1; el.setPointerCapture(e.pointerId); };
  el.onpointerup = el.onpointercancel = () => { touch[k] = 0; };
}
function readInput() {
  const k = (...c) => c.some((x) => keys.has(x));
  let throttle = k('KeyW', 'ArrowUp') || touch.g ? 1 : 0;
  let brake = k('KeyS', 'ArrowDown') || touch.b ? 1 : 0;
  let steer = (k('KeyD', 'ArrowRight') || touch.r ? 1 : 0) - (k('KeyA', 'ArrowLeft') || touch.l ? 1 : 0);
  let handbrake = k('Space') || !!touch.h;
  const pad = navigator.getGamepads?.().find((p) => p && p.connected);
  if (pad) {
    const ax = pad.axes[0] || 0;
    if (Math.abs(ax) > 0.12) steer = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88) ** 1.4;
    throttle = Math.max(throttle, pad.buttons[7]?.value || 0);
    brake = Math.max(brake, pad.buttons[6]?.value || 0);
    handbrake = handbrake || !!pad.buttons[0]?.pressed;
    const rx = pad.axes[2] || 0, ry = pad.axes[3] || 0;
    if (cam && Math.hypot(rx, ry) > 0.15) cam.orbit(rx * 12, ry * 8);
  }
  return { throttle, brake, steer, handbrake };
}

/* ------------------------------------------------------------------ debug view */
const debugGroup = new THREE.Group();
scene.add(debugGroup);
let debugLines = null, debugDots = [];
function buildDebug() {
  if (!car) return;
  const colors = [0xff4d4d, 0x4dff88, 0x4da6ff, 0xffd24d, 0xd24dff, 0x4dffff];
  car.report.wheels.forEach((w, i) => {
    const steer = car.object.getObjectByName(`wheel${i}.steer`);
    const g = new THREE.CylinderGeometry(w.radius, w.radius, w.width, 24, 1, true);
    g.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], wireframe: true, transparent: true, opacity: 0.6, depthTest: false }));
    m.userData.debug = true;
    steer?.add(m);
  });
  debugLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x00ffaa, depthTest: false }));
  debugLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(car.wheels.length * 6), 3));
  debugGroup.add(debugLines);
  debugDots = car.wheels.map(() => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.07), new THREE.MeshBasicMaterial({ color: 0xff2266, depthTest: false })); debugGroup.add(d); return d; });
}
const _clear = debugGroup.clear.bind(debugGroup);
debugGroup.clear = () => { car?.object.traverse((o) => { if (o.userData.debug) o.removeFromParent(); }); debugLines = null; debugDots = []; return _clear(); };
function drawDebug() {
  if (!debugOn || !debugLines || !car) return;
  const a = debugLines.geometry.attributes.position;
  car.wheels.forEach((w, i) => {
    const m = w.mountWorld || [0, 0, 0];
    a.setXYZ(i * 2, m[0], m[1], m[2]);
    const c = w.grounded ? w.contact : m;
    a.setXYZ(i * 2 + 1, c[0], c[1], c[2]);
    debugDots[i].position.set(c[0], c[1], c[2]);
    debugDots[i].visible = w.grounded;
    debugDots[i].scale.setScalar(0.5 + Math.min(2, w.load / (car.params.mass * 9.81 / 4)));
    debugDots[i].material.color.setHex(w.skid > 0.25 ? 0xffaa00 : 0xff2266);
  });
  a.needsUpdate = true;
}

/* ------------------------------------------------------------------ HUD */
function drawHud() {
  if (!car) return;
  const e = car.engine;
  $('spd').innerHTML = `${Math.abs(car.speed).toFixed(0)}<small>km/h</small>`;
  $('gear').textContent = e.gear === -1 ? 'R' : Math.abs(car.speed) < 1 && e.throttle < 0.05 ? 'N' : String(e.gear);
  const eng = sound.engine;
  const boost = sound.fx && turboMode !== 2 ? ` · boost ${(sound.fx.boost * 1.2).toFixed(1)} bar` : '';
  $('eng').textContent = eng ? `🔊 ${eng}${boost}` : sound.muted ? 'sound off' : 'click or press a key for sound';
  document.querySelector('#rpm i').style.width = `${Math.min(100, (e.rpm / e.redline) * 100).toFixed(1)}%`;
}

/* ------------------------------------------------------------------ loop: fixed 60 Hz physics (the car substeps to 120) */
const STEP = 1 / 60;
let acc = 0, last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (car && !window.playground.auto) car.drive(readInput());
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) { physics.step(STEP); acc -= STEP; n++; }
  if (n === 5) acc = 0;
  physics.sync(acc / STEP);
  for (const d of dynamic) { d.m.position.fromArray(d.b.position); d.m.quaternion.fromArray(d.b.quaternion); }
  if (car && cam) {
    cam.update(dt);
    sun.position.copy(car.object.position).add(new THREE.Vector3(18, 30, 12));
    sun.target.position.copy(car.object.position);
  }
  fx.update(car, dt);
  sound.update(car);
  drawHud();
  drawDebug();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  fx.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan((camera.fov * Math.PI) / 360)));
}
addEventListener('resize', resize);
resize();

/* for automated checks: window.playground.drive({ throttle: 1 }, 2) → drives 2 s with that input */
window.playground = {
  THREE, scene, physics, camera, renderer, sound,
  get car() { return car; },
  get cam() { return cam; },
  auto: false,
  async drive(input, seconds) {
    this.auto = true; car.drive({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...input });
    await new Promise((r) => setTimeout(r, seconds * 1000));
    this.auto = false;
  },
  load: (name) => { const m = MODELS.find((x) => x.name === name); $('model').value = name; $('preset').value = m.preset; overrides = {}; return spawn(m); },
  /** save the view as a PNG (dev server only): await playground.shot('name', 900) → '_local/shots/name.png' */
  async shot(name, width = 900) {
    renderer.render(scene, camera);
    const c = document.createElement('canvas');
    c.width = width; c.height = Math.round(width * canvas.height / canvas.width);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return (await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob })).text();
  },
};

$('preset').value = MODELS[0].preset;
spawn(MODELS[0]);
requestAnimationFrame(frame);
