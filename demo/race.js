/* City Circuit race: you + 7 AI drivers, three car choices. Uses the car library's public API (CAR.create,
   CAR.createCamera), the track (./track.js), race logic + AI (./race-ai.js), sound (./sound.js) and effects. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import CAR from 'car';
import { buildTrack } from './track.js';
import { RACE_CARS, RIVALS } from './race-cars.js';
import { createTracker, createDriver, standings, slipstream } from './race-ai.js';
import { createCarSound } from './sound.js';
import { createEffects } from './effects.js';

const $ = (id) => document.getElementById(id);
const STEP = 1 / 60;

/* ------------------------------------------------------------------ renderer, scene, light */
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9c4dc);
scene.fog = new THREE.Fog(0xa9c4dc, 250, 1400);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 3000);
scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x6a5a44, 1.0));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
scene.add(sun, sun.target);

const physics = CAR.createPhysics({ floor: 5000 });
const track = buildTrack(scene, physics);
const sound = createCarSound();
const fx = createEffects(scene);

/* ------------------------------------------------------------------ models */
const loader = new GLTFLoader();
const models = {};
await Promise.all(RACE_CARS.map(async (c) => {
  const g = await loader.loadAsync(c.file);
  g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  models[c.id] = g.scene;
}));
$('loading').remove();

/* ------------------------------------------------------------------ menu */
let choice = RACE_CARS[0].id;
function stat(label, v) { return `<div class="bar"><span>${label}</span><i style="width:${Math.round(v * 100)}%"></i></div>`; }
const STATS = { cyber: [0.95, 0.75, 0.8], vaz: [0.8, 0.8, 0.95], dirty: [0.85, 0.95, 0.8] };
$('cars').innerHTML = RACE_CARS.map((c) => `<div class="card" data-id="${c.id}"><b>${c.name}</b><small>${c.blurb}</small>
  <div class="bars">${stat('top speed', STATS[c.id][0])}${stat('accel', STATS[c.id][1])}${stat('grip', STATS[c.id][2])}</div></div>`).join('');
const pick = (id) => { choice = id; for (const el of document.querySelectorAll('.card')) el.classList.toggle('sel', el.dataset.id === id); };
for (const el of document.querySelectorAll('.card')) el.onclick = () => pick(el.dataset.id);
pick(choice);
$('menu').classList.add('on');
$('start').onclick = () => { sound.start(); startRace(); };
$('again').onclick = () => { sound.start(); startRace(); };
$('menuBtn').onclick = () => { $('results').classList.remove('on'); $('menu').classList.add('on'); };

/* ------------------------------------------------------------------ the race */
let field = [], player = null, cam = null, race = null;

function tint(car, color) {
  const c = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25);
  car.object.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    for (const m of [].concat(o.material)) if (m.color) m.color.multiply(c);
  });
}

function startRace() {
  $('menu').classList.remove('on'); $('results').classList.remove('on');
  for (const e of field) e.car.remove();
  field = [];
  fx.clear();
  const laps = Number($('laps').value) || 3, mySlot = Number($('slot').value) || 0;
  const mySpec = RACE_CARS.find((c) => c.id === choice);
  /* the AI get the other seven slots: every model at least twice, shuffled each race */
  const specs = [...RACE_CARS, ...RACE_CARS, RACE_CARS[Math.floor(Math.random() * 3)]].sort(() => Math.random() - 0.5);
  const rivals = [...RIVALS].sort(() => Math.random() - 0.5);
  let ai = 0;
  for (let k = 0; k < 8; k++) {
    const me = k === mySlot, spec = me ? mySpec : specs[ai];
    const slot = track.grid(k);
    const car = CAR.create({ scene, physics, model: models[spec.id], preset: spec.preset, ...spec.tune, position: slot.position, yaw: slot.yaw });
    const tracker = createTracker(track, car);
    const e = { car, tracker, spec, me, name: me ? 'You' : rivals[ai].name, color: me ? 0xffffff : rivals[ai].color };
    if (!me) {
      tint(car, e.color);
      e.driver = createDriver(car, track, tracker, 0.9 + Math.random() * 0.09);
      ai++;
    } else player = e;
    field.push(e);
  }
  sound.useEngine(mySpec.engine);
  sound.setFx({ turbo: mySpec.turbo ? 0.6 : 0, blowoff: mySpec.turbo ? 0.6 : 0, pops: 1 });
  if (!cam) cam = CAR.createCamera(camera, player.car); else cam.setCar(player.car);
  cam.reset();
  race = { laps, time: 0, phase: 'lights', lightsAt: 0, goAt: 3.2 + 0.4 + Math.random() * 0.8, finishedAt: null, done: false };
  $('hud').classList.add('on');
  mapLayout();
  $('lights').classList.add('on');
  banner('');
}

/* ------------------------------------------------------------------ input */
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT') return;
  sound.start();
  keys.add(e.code);
  if (e.code === 'KeyR' && player && race && race.phase === 'racing') backOnTrack(player);
  if (e.code === 'KeyC' && cam) cam.setMode({ chase: 'far', far: 'hood', hood: 'chase' }[cam.mode]);
  if (e.code === 'KeyM') sound.setMuted(!sound.muted);
  if (e.code === 'Escape') { $('menu').classList.toggle('on'); }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
let drag = null;
canvas.addEventListener('pointerdown', (e) => { sound.start(); drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id && cam) { cam.orbit(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; } });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam?.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
const touch = { l: 0, r: 0, g: 0, b: 0 };
if (matchMedia('(pointer: coarse)').matches) $('touch').classList.add('on');
for (const k of Object.keys(touch)) {
  const el = document.querySelector(`#touch .${k}`);
  el.onpointerdown = (e) => { sound.start(); touch[k] = 1; el.setPointerCapture(e.pointerId); };
  el.onpointerup = el.onpointercancel = () => { touch[k] = 0; };
}
function readInput() {
  const k = (...c) => c.some((x) => keys.has(x));
  let throttle = k('KeyW', 'ArrowUp') || touch.g ? 1 : 0, brake = k('KeyS', 'ArrowDown') || touch.b ? 1 : 0;
  let steer = (k('KeyD', 'ArrowRight') || touch.r ? 1 : 0) - (k('KeyA', 'ArrowLeft') || touch.l ? 1 : 0);
  let handbrake = k('Space');
  const pad = navigator.getGamepads?.().find((p) => p && p.connected);
  if (pad) {
    const ax = pad.axes[0] || 0;
    if (Math.abs(ax) > 0.12) steer = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88) ** 1.4;
    throttle = Math.max(throttle, pad.buttons[7]?.value || 0); brake = Math.max(brake, pad.buttons[6]?.value || 0);
    handbrake = handbrake || !!pad.buttons[0]?.pressed;
  }
  return { throttle, brake, steer, handbrake };
}

function backOnTrack(e) {
  let i = track.wrap(e.tracker.index - 4);
  for (let t = 0; t < 20; t++) {
    const pt = track.point(i, 0);
    if (!field.some((o) => o !== e && Math.hypot(o.car.body.position[0] - pt[0], o.car.body.position[2] - pt[1]) < 7)) break;
    i = track.wrap(i - 5);
  }
  const r = track.resetAt(i);
  e.car.reset(r.position, r.yaw);
  e.tracker.index = i;
  cam?.reset();
}

/* ------------------------------------------------------------------ HUD */
let bannerTimer = 0;
function banner(text, ms = 0, warn = false) {
  const b = $('banner');
  b.textContent = text; b.classList.toggle('on', !!text); b.classList.toggle('warn', warn);
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => b.classList.remove('on'), ms);
}
const fmtTime = (t) => (t == null ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`);
const hex = (c) => `#${new THREE.Color(c).getHexString()}`;

const mapCtx = $('map').getContext('2d');
let mapScale = 1, mapOff = [0, 0];
function mapLayout() {
  const c = $('map'), r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio);
  c.width = r.width * dpr; c.height = r.height * dpr;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const q of track.samples) { x0 = Math.min(x0, q.p[0]); x1 = Math.max(x1, q.p[0]); z0 = Math.min(z0, q.p[1]); z1 = Math.max(z1, q.p[1]); }
  mapScale = Math.min((c.width - 20) / (x1 - x0), (c.height - 20) / (z1 - z0));
  mapOff = [(c.width - (x1 - x0) * mapScale) / 2 - x0 * mapScale, (c.height - (z1 - z0) * mapScale) / 2 - z0 * mapScale];
}
function drawMap() {
  const c = $('map'), g = mapCtx, dpr = Math.min(2, devicePixelRatio);
  g.clearRect(0, 0, c.width, c.height);
  g.lineWidth = 5 * dpr; g.strokeStyle = '#ffffff55'; g.lineJoin = 'round';
  g.beginPath();
  track.samples.forEach((q, i) => { const x = q.p[0] * mapScale + mapOff[0], y = q.p[1] * mapScale + mapOff[1]; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
  g.closePath(); g.stroke();
  const s0 = track.samples[0];
  g.fillStyle = '#fff'; g.fillRect(s0.p[0] * mapScale + mapOff[0] - 1.5 * dpr, s0.p[1] * mapScale + mapOff[1] - 5 * dpr, 3 * dpr, 10 * dpr);
  for (const e of [...field].sort((a) => (a.me ? 1 : -1))) {
    const p = e.car.body.position;
    g.fillStyle = e.me ? '#ff7a3d' : hex(e.color);
    g.beginPath(); g.arc(p[0] * mapScale + mapOff[0], p[2] * mapScale + mapOff[1], (e.me ? 5 : 3.5) * dpr, 0, Math.PI * 2); g.fill();
    if (e.me) { g.strokeStyle = '#fff'; g.lineWidth = 1.5 * dpr; g.stroke(); }
  }
}

function drawHud() {
  if (!race || !player) return;
  const order = standings(field.map((e) => e.tracker));
  const myPos = order.indexOf(player.tracker) + 1, t = player.tracker;
  const lapNow = Math.min(race.laps, Math.max(1, t.lap));
  $('pos').innerHTML = `<div class="p">P${myPos}<small>/8</small></div><div class="lap">Lap ${lapNow}/${race.laps}</div>
    <div class="t">Time ${fmtTime(race.phase === 'racing' && t.lap > 0 && t.finished === null ? race.time - t.lapStart : t.lastLap)}<br>Last ${fmtTime(t.lastLap)} · Best ${fmtTime(t.bestLap)}</div>`;
  const leader = order[0];
  $('board').innerHTML = order.map((tr, k) => {
    const e = field.find((f) => f.tracker === tr);
    let gap = '';
    if (k > 0) {
      if (tr.finished !== null && leader.finished !== null) gap = `+${(tr.finished - leader.finished).toFixed(1)}`;
      else { const d = leader.total - tr.total; gap = d > track.length ? `+${Math.floor(d / track.length)} lap` : `+${(d / Math.max(15, e.car.speed / 3.6)).toFixed(1)}`; }
    }
    return `<div class="${e.me ? 'me' : ''}"><span>${k + 1}</span><i style="background:${e.me ? '#ff7a3d' : hex(e.color)}"></i><span>${e.name}</span><span>${gap}</span></div>`;
  }).join('');
  const en = player.car.engine;
  $('spd').innerHTML = `${Math.abs(player.car.speed).toFixed(0)}<small>km/h</small>`;
  $('gear').textContent = en.gear === -1 ? 'R' : String(en.gear);
  document.querySelector('#rpm i').style.width = `${Math.min(100, (en.rpm / en.redline) * 100).toFixed(1)}%`;
  const draft = player.draft > 0.15 ? ' · slipstream' : '';
  const boost = sound.fx && player.spec.turbo ? ` · boost ${(sound.fx.boost * 1.2).toFixed(1)} bar` : '';
  $('extra').textContent = `${player.spec.name}${boost}${draft}`;
  drawMap();
}

/* ------------------------------------------------------------------ loop */
let acc = 0, last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (race && !race.done) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) { tick(STEP); acc -= STEP; n++; }
    if (n === 5) acc = 0;
  }
  physics.sync(acc / STEP);
  if (cam && player) {
    cam.update(dt);
    sun.position.copy(player.car.object.position).add(new THREE.Vector3(40, 70, 25));
    sun.target.position.copy(player.car.object.position);
  }
  fx.update(field.map((e) => e.car), dt);
  if (player) sound.update(player.car);
  drawHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function tick(dt) {
  race.time += dt;
  const go = race.phase === 'racing';
  /* start lights: one more every 0.8 s, then out at a random moment */
  if (race.phase === 'lights') {
    const lit = Math.min(5, Math.floor(race.time / 0.8) + 1);
    document.querySelectorAll('#lights i').forEach((el, k) => el.classList.toggle('lit', k < lit));
    if (race.time >= race.goAt) {
      race.phase = 'racing';
      document.querySelectorAll('#lights i').forEach((el) => el.classList.remove('lit'));
      setTimeout(() => $('lights').classList.remove('on'), 600);
      banner('GO!', 900);
    }
  }
  for (const e of field) {
    if (e.me) {
      /* braking at a standstill reverses (arcade controls): before the start and after the finish the car's own
         standstill hold keeps it still instead */
      if (e.tracker.finished !== null) e.car.drive({ throttle: 0, brake: e.car.speed > 3 ? 0.4 : 0, steer: 0, handbrake: false });
      else if (!go) e.car.drive({ ...readInput(), throttle: 0, brake: 0, handbrake: false });
      else if (window.race.auto) window.race.auto.update(dt, field, go);
      else e.car.drive(readInput());
    } else if (e.tracker.finished !== null) e.car.drive({ throttle: 0, brake: e.car.speed > 3 ? 0.5 : 0, steer: 0 });
    else e.driver.update(dt, field, go);
  }
  if (go) slipstream(field, track, physics.world);
  physics.step(dt);
  for (const e of field) {
    const lapped = e.tracker.update(race.time);
    if (lapped && e.tracker.lap > race.laps && e.tracker.finished === null) {
      e.tracker.finished = race.time;
      if (e.me) finishPlayer();
    } else if (lapped && e.me && e.tracker.lap === race.laps && race.laps > 1) banner('FINAL LAP', 1600);
    else if (lapped && e.me && e.tracker.lap > 1) banner(`LAP ${e.tracker.lap}`, 1200);
  }
  /* wrong way */
  if (go && player.tracker.finished === null && player.tracker.wrongWay > 60 && Math.abs(player.car.speed) > 5) banner('WRONG WAY', 600, true);
  /* the race ends when everyone is home, or 25 s after you finish */
  if (race.finishedAt !== null && (field.every((e) => e.tracker.finished !== null) || race.time - race.finishedAt > 25)) showResults();
}

function finishPlayer() {
  race.finishedAt = race.time;
  const pos = standings(field.map((e) => e.tracker)).indexOf(player.tracker) + 1;
  banner(pos === 1 ? 'YOU WIN!' : `FINISHED P${pos}`, 4000);
}

function showResults() {
  race.done = true;
  const order = standings(field.map((e) => e.tracker));
  const winner = order[0].finished;
  $('resBody').innerHTML = order.map((t, k) => {
    const e = field.find((f) => f.tracker === t);
    const time = t.finished === null ? 'DNF' : k === 0 ? fmtTime(t.finished - race.goAt) : `+${(t.finished - winner).toFixed(2)} s`;
    return `<tr class="${e.me ? 'me' : ''}"><td>${k + 1}</td><td>${e.name}</td><td>${e.spec.name}</td><td>${time}</td><td>${fmtTime(t.bestLap)}</td></tr>`;
  }).join('');
  $('results').classList.add('on');
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  fx.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan((camera.fov * Math.PI) / 360)));
  mapLayout();
}
addEventListener('resize', resize);
resize();

/* the view behind the menu: high over the start straight, looking along it toward the city */
{
  const q = track.samples[0];
  camera.position.set(q.p[0] + q.t[0] * -60 + q.n[0] * -25, 45, q.p[1] + q.t[1] * -60 + q.n[1] * -25);
  camera.lookAt(q.p[0] + q.t[0] * 200, 0, q.p[1] + q.t[1] * 200);
}
requestAnimationFrame(frame);

/* for automated checks */
window.race = { get field() { return field; }, get player() { return player; }, get state() { return race; }, track, camera, sound, start: startRace, pick,
  async shot(name, width = 1000) {
    renderer.render(scene, camera);
    const c = document.createElement('canvas');
    c.width = width; c.height = Math.round(width * canvas.height / canvas.width);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return (await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob })).text();
  },
  /** testing: an AI driver for your car (window.race.autopilot()) */
  auto: null,
  async autopilot(on = true) {
    const { createDriver } = await import('./race-ai.js');
    this.auto = on ? createDriver(player.car, track, player.tracker, 1) : null;
  },
};
