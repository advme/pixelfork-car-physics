/* The car's sound, one call ("car/sound", optional module):

     import { createCarSound } from 'car/sound';
     const sound = createCarSound(car, { engine: 'f136', listener: camera });   // listener: far cars are quieter
     // every frame, after physics.sync():
     sound.update();

   Browsers only allow sound after the player presses a key or taps: it starts by itself on the first one.

   - engine: a REAL engine, recorded from Engine Simulator (13 engines, assets/sounds/engines, one ~0.45 MB mp3 each,
     played by ./engine-sound.js: the loops nearest the revs, pitched to the exact rpm, throttle on / off layers).
     Only the engine a car uses is downloaded, once per page, shared by every car with it. Default: picked from the
     car's preset-like numbers (power, redline, mass). The files are found next to the library
     (`../assets/sounds/engines/` from the module file, the repo's own layout); `sounds: '<folder url>/'` elsewhere.
     If the recording can't load, a synthesised engine plays instead (a console warning says why); you can also ask
     for that one on purpose (engine 'synth-inline4' | 'synth-inline6' | 'synth-v8' | 'synth-v12': no download).
   - exhaust pops & bangs, turbo (./engine-fx.js)
   - tyres: recordings (assets/sounds/tyres/tyres.json + .mp3, or o.tyreSounds) played as a stream of short random
     grains (never a repeating loop), driven per wheel by how much it really slides sideways (squeal), spins (burnouts
     and launches only) or is locked (handbrake), pitched with slip and speed, plus a short chirp when a slide starts
     suddenly; without the recordings, a synthesised screech from car.skid
   - road rumble and wind with speed, a thump on hard suspension hits (car.impact)
   - a crash (noise burst + metal clank + thump) when the body is stopped or knocked sideways faster than any
     braking could (from the change of its velocity between frames; resets / teleports don't count)
   Every car's sound goes to one shared compressor per audio context, so 8 cars don't clip. */
import { createEngineFx } from './engine-fx.js';
import { loadEngineData, createEngineSound } from './engine-sound.js';

/** the recorded engines (assets/sounds/engines/<name>.json + .mp3) */
export const RECORDED_ENGINES = {
  f136: 'Ferrari F136 V8', m52: 'BMW M52B28 straight-6', vtec: 'Honda B18C5 VTEC 4-cylinder', c454: 'Chevrolet 454 V8 (truck)',
  '2jz': 'Toyota 2JZ straight-6', ls: 'GM LS V8', lfa: 'Lexus LFA V10', ej25: 'Subaru EJ25 boxer-4', i5: 'Audi 2.3 inline-5',
  v6: '60° V6', f1v12: 'Ferrari 412 T2 V12 (F1)', busa: 'Suzuki Hayabusa inline-4 (bike)', harley: 'Harley-Davidson V-twin (bike)',
};
/* the synthesised stand-ins: cylinders; uneven = strength of the orders between the firing orders (burble);
   the exhaust resonance (Hz) and how bright the note is */
const SYNTH = {
  'synth-inline4': { cylinders: 4, uneven: 0.16, resonance: 260, bright: 1.1 },
  'synth-inline6': { cylinders: 6, uneven: 0.07, resonance: 230, bright: 1 },
  'synth-v8': { cylinders: 8, uneven: 0.42, resonance: 150, bright: 0.8 },
  'synth-v12': { cylinders: 12, uneven: 0.05, resonance: 320, bright: 1.25 },
};
export const SYNTH_ENGINES = Object.keys(SYNTH);

/* where the recordings are: the repo's layout, from src/ or dist/ (a game engine's pack keeps the same layout) */
const DEFAULT_SOUNDS = (() => { try { return new URL('../assets/sounds/engines/', import.meta.url).href; } catch { return '/assets/sounds/engines/'; } })();

const DEFAULT_TYRES = (() => { try { return new URL('../assets/sounds/tyres/tyres.json', import.meta.url).href; } catch { return '/assets/sounds/tyres/tyres.json'; } })();

const masters = new WeakMap();
let shared = null;
function audioContext() {
  if (shared) return shared;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  shared = AC ? new AC() : null;
  return shared;
}
/* one compressor per context: every car sound goes through it */
function masterOf(ctx) {
  let m = masters.get(ctx);
  if (!m) {
    m = ctx.createDynamicsCompressor();
    m.threshold.value = -18; m.knee.value = 10; m.ratio.value = 4; m.attack.value = 0.005; m.release.value = 0.25;
    const gain = ctx.createGain(); gain.gain.value = 0.9;
    m.connect(gain).connect(ctx.destination);
    masters.set(ctx, m);
  }
  return m;
}
/* browsers keep a new context suspended until a key or tap: resume on the first one */
function resumeOnGesture(ctx) {
  if (ctx.state !== 'suspended' || typeof addEventListener !== 'function') return;
  const go = () => { ctx.resume(); for (const t of ['pointerdown', 'keydown', 'touchstart']) removeEventListener(t, go, true); };
  for (const t of ['pointerdown', 'keydown', 'touchstart']) addEventListener(t, go, true);
}
const warned = new Set();
const warnOnce = (m) => { if (!warned.has(m)) { warned.add(m); console.warn(`[car/sound] ${m}`); } };

/** which recorded engine a car sounds like when none is given */
function guessEngine(p) {
  if (p.mass >= 1900) return 'c454';
  if (p.power >= 300 && p.redline >= 7500) return 'f136';
  if (p.power >= 300) return 'ls';
  if (p.power < 160 || p.redline >= 7600) return 'vtec';
  return 'm52';
}
/** which synthesised engine stands in for a recorded one */
const synthFor = (name) => (name === 'f1v12' || name === 'lfa' ? 'synth-v12' : ['f136', 'c454', 'ls', 'harley'].includes(name) ? 'synth-v8'
  : ['vtec', 'ej25', 'busa'].includes(name) ? 'synth-inline4' : 'synth-inline6');

/**
 * @param {any} car from CAR.create()
 * @param {{ context?: BaseAudioContext, engine?: string, sounds?: string, tyreSounds?: string | false, volume?: number, listener?: import('three').Object3D,
 *   engineVolume?: number, pops?: number, turbo?: number, blowoff?: number, valve?: 'blowoff' | 'flutter', tyres?: number, crashes?: number }} [o]
 */
export function createCarSound(car, o = {}) {
  const known = (name) => !!name && (name in RECORDED_ENGINES || name in SYNTH);
  if (o.engine && !known(o.engine)) warnOnce(`unknown engine "${o.engine}"; engines: ${[...Object.keys(RECORDED_ENGINES), ...SYNTH_ENGINES].join(', ')}`);
  const opt = {
    engine: known(o.engine) ? o.engine : guessEngine(car.params),
    volume: o.volume ?? 1, engineVolume: o.engineVolume ?? 1, pops: o.pops ?? 0.6, turbo: o.turbo ?? 0,
    blowoff: o.blowoff ?? (o.turbo ? 0.5 : 0), valve: o.valve === 'flutter' ? 'flutter' : 'blowoff',
    tyres: o.tyres ?? 1, crashes: o.crashes ?? 1,
  };
  const sounds = (o.sounds || DEFAULT_SOUNDS).replace(/\/?$/, '/');
  const tyreUrl = o.tyreSounds === false ? null : o.tyreSounds || DEFAULT_TYRES;
  let listener = o.listener || null;
  let ctx = null, n = null, eng = null, muted = false, disposed = false;
  const st = { lastImpact: 0, v: null, p: [0, 0, 0], t: 0, crashAt: -1, thumpAt: -1 };
  const stats = { crashes: 0, thumps: 0 };
  let markReady;
  const ready = new Promise((r) => { markReady = r; });

  function build() {
    ctx = o.context || audioContext();
    if (!ctx) return false;
    resumeOnGesture(ctx);
    const out = ctx.createGain(); out.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) out.connect(pan).connect(masterOf(ctx)); else out.connect(masterOf(ctx));
    const engineBus = ctx.createGain();
    engineBus.connect(out);

    /* noise for tyres, road, wind and crashes */
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const tyreBp = ctx.createBiquadFilter(); tyreBp.type = 'bandpass'; tyreBp.frequency.value = 1150; tyreBp.Q.value = 4;
    const tyre = ctx.createGain(); tyre.gain.value = 0;
    noise.connect(tyreBp).connect(tyre).connect(out);
    const roadLp = ctx.createBiquadFilter(); roadLp.type = 'lowpass'; roadLp.frequency.value = 180;
    const road = ctx.createGain(); road.gain.value = 0;
    noise.connect(roadLp).connect(road).connect(out);
    const windLp = ctx.createBiquadFilter(); windLp.type = 'lowpass'; windLp.frequency.value = 420;
    const wind = ctx.createGain(); wind.gain.value = 0;
    noise.connect(windLp).connect(wind).connect(out);
    noise.start();

    const fx = createEngineFx(ctx, { pops: opt.pops, turbo: opt.turbo, blowoff: opt.blowoff });
    fx.output.connect(out);
    n = { out, pan, engineBus, noise, buf, tyre, tyreBp, road, roadLp, wind, fx, tyres: null };
    startEngine();
    startTyres();
    return true;
  }

  /* ---- recorded tyres, played as grains: a steady stream of short overlapping pieces (0.3 s, half overlapped,
     equal-power window), each from a random point of the recordings of its kind and slightly detuned. Short
     recordings then never repeat as a pattern (a looped second of squeal is heard as the same wobble over and over). */
  const GRAIN = 0.3, WINDOW = new Float32Array(64).map((_, i) => Math.sin((Math.PI * i) / 63));
  function grainLayer(regions, bus) {
    const out = ctx.createGain(); out.gain.value = 0; out.connect(bus);
    const layer = {
      level: 0, rate: 1, next: 0,
      set(level, rate, t) { layer.level = level; layer.rate = rate; out.gain.setTargetAtTime(level, t, 0.05); },
      schedule(t) {
        if (layer.level < 0.003) { layer.next = t; return; }
        if (layer.next < t) layer.next = t;
        while (layer.next < t + 0.12) {
          const r = regions[Math.floor(Math.random() * regions.length)];
          const rate = layer.rate * (0.95 + Math.random() * 0.1);
          const span = GRAIN * rate;
          const at = r.start + Math.random() * Math.max(0, r.length - span);
          const src = ctx.createBufferSource(), g = ctx.createGain();
          src.buffer = r.buffer; src.playbackRate.value = rate;
          g.gain.value = 0;
          g.gain.setValueCurveAtTime(WINDOW, layer.next, GRAIN);
          src.connect(g).connect(out);
          src.start(layer.next, at, span + 0.01); src.stop(layer.next + GRAIN + 0.02);
          layer.next += GRAIN / 2;
        }
      },
      stop() { out.disconnect(); },
    };
    return layer;
  }
  function startTyres() {
    if (!tyreUrl) return;
    loadEngineData(ctx, tyreUrl).then(({ meta, buffers }) => {
      if (disposed || !n) return;
      const bus = ctx.createGain();
      bus.connect(n.out);
      const regions = { slide: [], spin: [], lock: [] }, chirps = [];
      meta.samples.forEach((smp, i) => {
        if (smp.kind === 'chirp') { chirps.push({ buffer: buffers[i], start: smp.start + meta.pad, length: smp.length }); return; }
        if (regions[smp.kind]) regions[smp.kind].push({ buffer: buffers[i], start: smp.start + meta.pad, length: smp.loop });
      });
      /* a kind with no recording borrows the slide ones */
      for (const k of ['spin', 'lock']) if (!regions[k].length) regions[k] = regions.slide;
      if (!regions.slide.length) return;
      const layers = { slide: grainLayer(regions.slide, bus), spin: grainLayer(regions.spin, bus), lock: grainLayer(regions.lock, bus) };
      n.tyres = { bus, layers, chirps, lastChirp: -1, prev: 0, prevT: 0 };
      n.tyre.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    }, (err) => {
      if (o.tyreSounds) warnOnce(`tyre sounds could not load from ${tyreUrl} (${err && err.message}); using the synthesised screech`);
    });
  }
  function chirp(strength) {
    const c = n.tyres.chirps[Math.floor(Math.random() * n.tyres.chirps.length)];
    if (!c) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = c.buffer; src.playbackRate.value = 0.9 + Math.random() * 0.2;
    g.gain.value = 0.45 * strength * opt.tyres;
    src.connect(g).connect(n.tyres.bus);
    src.start(t, c.start, c.length); src.stop(t + c.length / 0.85 + 0.05);
  }

  /* ---- the engine: a recording (loaded once per page) or the synthesised stand-in */
  function startEngine() {
    const name = opt.engine;
    if (name in SYNTH) { eng = synthEngine(SYNTH[name]); markReady(true); return; }
    const mine = { name, player: null, dispose() { if (this.player) this.player.dispose(); }, update(e) { if (this.player) this.player.update(e); } };
    eng = mine;
    loadEngineData(ctx, `${sounds}${name}.json`).then(({ meta, buffers }) => {
      if (eng !== mine || disposed) return;
      mine.player = createEngineSound(ctx, meta, buffers);
      mine.player.output.connect(n.engineBus);
      markReady(true);
    }, (err) => {
      if (eng !== mine || disposed) return;
      warnOnce(`engine "${name}" could not load from ${sounds} (${err && err.message}); playing a synthesised engine instead. Pass sounds: '<folder with ${name}.json>/'.`);
      eng = synthEngine(SYNTH[synthFor(name)]);
      markReady(false);
    });
  }

  /* one oscillator at the camshaft frequency (rpm / 120) whose harmonics are the firing orders plus weaker uneven
     orders; soft clipping with the throttle, an exhaust resonance, a low-pass opening with revs and throttle */
  function synthEngine(spec) {
    const H = 96, re = new Float32Array(H + 1), im = new Float32Array(H + 1);
    let seed = spec.cylinders * 7919;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 1; k <= H; k++) {
      const a = (k % spec.cylinders === 0 ? 1 : spec.uneven * (0.35 + rnd())) / Math.pow(k / spec.cylinders + 0.4, 1.05);
      const ph = rnd() * Math.PI * 2;
      re[k] = a * Math.cos(ph); im[k] = a * Math.sin(ph);
    }
    const wave = ctx.createPeriodicWave(re, im);
    const osc = ctx.createOscillator(); osc.setPeriodicWave(wave);
    const osc2 = ctx.createOscillator(); osc2.setPeriodicWave(wave); osc2.detune.value = 7;
    const drive = ctx.createGain(), g2 = ctx.createGain(); g2.gain.value = 0.35;
    osc.connect(drive); osc2.connect(g2).connect(drive);
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(1.6 * ((i / 1023.5) - 1));
    shaper.curve = curve;
    const reso = ctx.createBiquadFilter(); reso.type = 'peaking'; reso.frequency.value = spec.resonance; reso.Q.value = 1.4; reso.gain.value = 7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
    const gain = ctx.createGain(); gain.gain.value = 0;
    drive.connect(shaper).connect(reso).connect(lp).connect(gain).connect(n.engineBus);
    osc.start(); osc2.start();
    return {
      name: 'synth',
      update(e) {
        const t = ctx.currentTime, x = Math.max(0, Math.min(1.1, e.rpm / e.redline)), thr = e.throttle;
        const f = Math.max(3, e.rpm / 120);
        osc.frequency.setTargetAtTime(f, t, 0.02); osc2.frequency.setTargetAtTime(f, t, 0.02);
        lp.frequency.setTargetAtTime((250 + 2200 * x * (0.35 + 0.65 * thr)) * spec.bright, t, 0.04);
        drive.gain.setTargetAtTime(0.8 + 2.2 * thr * (0.4 + x), t, 0.04);
        let g = 0.13 + 0.14 * thr + 0.07 * x;
        if (e.shifting) g *= 0.5;
        if (e.limiter) g *= Math.sin(t * 95) > 0 ? 1 : 0.35;
        gain.gain.setTargetAtTime(g, t, 0.025);
      },
      dispose() { gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02); setTimeout(() => { osc.stop(); osc2.stop(); gain.disconnect(); }, 100); },
    };
  }

  /* one-off sounds: a low thump, a crash */
  function thump(strength) {
    stats.thumps++;
    const t = ctx.currentTime;
    const s = ctx.createOscillator(), g = ctx.createGain();
    s.frequency.setValueAtTime(90, t); s.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    g.gain.setValueAtTime(0.5 * strength, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    s.connect(g).connect(n.out); s.start(t); s.stop(t + 0.32);
  }
  function crash(strength) {
    stats.crashes++;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = n.buf; src.playbackRate.value = 0.7 + Math.random() * 0.3;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + 900 * strength; bp.Q.value = 0.7;
    const g = ctx.createGain(), len = 0.18 + 0.35 * strength;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7 * strength + 0.001, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(bp).connect(g).connect(n.out); src.start(t, Math.random()); src.stop(t + len + 0.02);
    /* metal: inharmonic partials ringing briefly */
    for (const [f, a] of [[310, 1], [523, 0.7], [847, 0.5], [1290, 0.35]]) {
      const s = ctx.createOscillator(); s.type = 'square'; s.frequency.value = f * (0.9 + Math.random() * 0.2);
      const sg = ctx.createGain(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.06 * a * strength + 0.0001, t + 0.004); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 + 0.2 * strength * a);
      s.connect(lp).connect(sg).connect(n.out); s.start(t); s.stop(t + 0.4);
    }
    thump(Math.min(1, 0.4 + strength));
  }

  const P = [0, 0, 0], R = [0, 0, 0];
  /** every frame, after physics.sync() */
  function update() {
    if (disposed) return;
    if (!n && !build()) return;
    const t = ctx.currentTime, e = car.engine;
    if (eng) eng.update(e);
    const fo = n.fx.options;
    fo.pops = opt.pops; fo.turbo = opt.turbo; fo.blowoff = opt.blowoff; fo.valve = opt.valve;
    n.engineBus.gain.setTargetAtTime(opt.engineVolume, t, 0.05);
    n.fx.update(e);

    /* tyres, road, wind */
    const sp = Math.abs(car.speed) / 3.6, onGround = car.grounded / Math.max(1, car.wheels.length);
    const ty = n.tyres;
    if (ty) {
      /* per wheel: the most any grounded wheel slides / spins / locks, plus a little for every other one doing it */
      let slide = 0, spin = 0, lock = 0, sSum = 0;
      for (const w of car.wheels) {
        if (!w.grounded) continue;
        slide = Math.max(slide, w.slide || 0); spin = Math.max(spin, w.spinSlip || 0); lock = Math.max(lock, w.lock || 0); sSum += w.slide || 0;
      }
      slide = Math.min(1, slide + 0.15 * Math.max(0, sSum - slide));
      const vol = opt.tyres, speedUp = Math.min(1, sp / 40);
      /* heard only when the tyres really let go: a soft threshold, not the first hint of slip */
      const knee = (x, lo, hi) => { const u = Math.max(0, Math.min(1, (x - lo) / (hi - lo))); return u * u * (3 - 2 * u); };
      const slideHeard = knee(slide, 0.2, 0.85);
      /* wheelspin: burnouts and launches only. A powerful car's traction control lets some spin through all the
         time; that isn't heard as a squeal, so it fades out completely by ~50 km/h */
      const spinHeard = knee(spin, 0.35, 0.95) * Math.max(0, 1 - sp / 14);
      const lockHeard = knee(lock, 0.2, 0.7);
      ty.layers.slide.set(0.55 * vol * slideHeard, 0.92 + 0.14 * slide + 0.08 * speedUp, t);
      ty.layers.spin.set(0.5 * vol * spinHeard, 0.85 + 0.25 * spin + 0.1 * speedUp, t);
      ty.layers.lock.set(0.55 * vol * lockHeard, 0.95 + 0.08 * speedUp, t);
      for (const k in ty.layers) ty.layers[k].schedule(t);
      /* a slide or lock that starts suddenly gets a short chirp */
      const now = Math.max(slide, lock);
      if (ty.chirps.length && now > 0.6 && ty.prev < 0.2 && t - ty.prevT < 0.2 && t - ty.lastChirp > 1.5) { chirp(Math.min(1, now)); ty.lastChirp = t; }
      if (now < 0.2) { ty.prev = now; ty.prevT = t; }
    } else {
      const skid = car.skid * Math.min(1, sp / 4) * (onGround > 0 ? 1 : 0) * opt.tyres;
      n.tyre.gain.setTargetAtTime(Math.min(0.4, skid * 0.4), t, 0.05);
      n.tyreBp.frequency.setTargetAtTime(950 + skid * 500, t, 0.1);
    }
    n.road.gain.setTargetAtTime(0.08 * Math.min(1, sp / 25) * onGround, t, 0.1);
    n.roadLp.frequency.setTargetAtTime(140 + sp * 5, t, 0.2);
    n.wind.gain.setTargetAtTime(Math.min(0.3, (sp / 60) ** 2 * 0.3), t, 0.2);

    /* knocks: suspension hits, and the body stopped or shoved faster than braking can */
    if (car.impact > st.lastImpact + 0.2 && t - st.thumpAt > 0.15) { thump(Math.min(1, car.impact)); st.thumpAt = t; }
    st.lastImpact = car.impact;
    const v = car.body.motionProperties.linearVelocity, bp = car.body.position;
    if (st.v) {
      const dt = Math.max(1e-3, t - st.t);
      const dv = Math.hypot(v[0] - st.v[0], v[2] - st.v[2]);
      const jumped = Math.hypot(bp[0] - st.p[0], bp[2] - st.p[2]) > Math.hypot(st.v[0], st.v[2]) * Math.max(dt, 1 / 30) * 2 + 1.5;
      if (opt.crashes > 0 && !jumped && dv > 2.5 && dv / Math.max(dt, 1 / 60) > 35 && t - st.crashAt > 0.3) { crash(Math.min(1, (dv - 1.5) / 12) * opt.crashes); st.crashAt = t; }
    }
    st.v = [v[0], v[1], v[2]]; st.p = [bp[0], bp[1], bp[2]]; st.t = t;

    /* distance and side, from the listener (usually the camera) */
    let level = opt.volume;
    if (listener && listener.matrixWorld) {
      const m = listener.matrixWorld.elements, p = car.object.position;
      P[0] = p.x - m[12]; P[1] = p.y - m[13]; P[2] = p.z - m[14];
      const dist = Math.hypot(P[0], P[1], P[2]);
      level *= Math.min(1, 12 / Math.max(12, dist));
      R[0] = m[0]; R[1] = m[1]; R[2] = m[2];
      if (n.pan) n.pan.pan.setTargetAtTime(dist > 1 ? 0.8 * (P[0] * R[0] + P[1] * R[1] + P[2] * R[2]) / dist : 0, t, 0.05);
    }
    n.out.gain.setTargetAtTime(muted ? 0 : level, t, 0.05);
  }

  return {
    update,
    /** start now (from a key or click handler); otherwise it starts on the first key or tap by itself */
    start() { if (!n) build(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    /** true once the recorded engine plays (false: it could not load and the synthesised one plays) */
    ready,
    /** the options in use; change them live: volume, engineVolume, pops, turbo, blowoff, valve, tyres, crashes (engine: setEngine) */
    options: opt,
    /** switch the engine: a recorded one ("f136", "m52", …) or a synthesised one ("synth-v8", …) */
    setEngine(name) {
      if (!known(name)) { warnOnce(`unknown engine "${name}"`); return; }
      if (name === opt.engine) return;
      opt.engine = name;
      if (n) { eng.dispose(); startEngine(); }
    },
    /** where the player hears from (the camera): cars further away are quieter and panned */
    setListener(obj) { listener = obj || null; },
    get muted() { return muted; },
    set muted(m) { muted = !!m; },
    /** the audio context (made on first use) */
    get context() { return ctx; },
    /** this car's sound (a GainNode, after the first update): connect it to an analyser or recorder too */
    get output() { return n ? n.out : null; },
    /** how many crash and thump sounds have played */
    stats,
    /** 0..1 turbo boost (with turbo on) */
    get boost() { return n ? n.fx.boost : 0; },
    /** stop and free everything (call with car.remove()) */
    dispose() {
      disposed = true;
      if (!n) return;
      const old = n;
      if (eng) eng.dispose();
      old.out.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      setTimeout(() => {
        old.noise.stop(); old.fx.dispose(); old.out.disconnect();
        if (old.tyres) for (const k in old.tyres.layers) old.tyres.layers[k].stop();
      }, 120);
      n = null;
    },
  };
}
