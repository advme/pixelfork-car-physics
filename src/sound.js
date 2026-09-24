/* Built-in car sound, made live with Web Audio: no files, nothing to load. Optional module ("car/sound").

     import { createCarSound } from 'car/sound';
     const sound = createCarSound(car, { listener: camera });   // listener: other cars get quieter with distance
     // every frame, after physics.sync():
     sound.update();

   Browsers only allow sound after the player presses a key or taps: it starts by itself on the first one.

   What you hear, all from the car's own numbers:
   - engine: one oscillator at the camshaft frequency (rpm / 120) whose harmonics are the engine's firing orders
     (cylinders per cam turn) plus weaker "uneven" orders between them. Few uneven orders = a smooth six, many = a
     burbling V8. Then a soft clipper driven by the throttle, an exhaust resonance, and a low-pass that opens with
     revs and throttle; combustion noise pulsing with the same wave. Gear changes dip, the limiter chops.
   - tyres: a squeal (two tones + narrow noise) from car.skid, only on the ground and above walking pace
   - road rumble with speed on the ground, wind with speed²
   - a thump when the suspension is hit hard (car.impact: kerbs, landings)
   - a crash (noise burst + metal clank + thump) when the body is stopped or knocked sideways faster than any
     braking could: from the change of its velocity between frames
   - optional exhaust pops & bangs and turbo (./engine-fx.js)
   Every car's sound goes to one shared compressor per audio context, so 8 cars don't clip. */
import { createEngineFx } from './engine-fx.js';

/* engine characters: cylinders; uneven = how strong the orders between the firing orders are (burble); tone = the
   exhaust resonance (Hz) and how bright the note is */
export const ENGINES = {
  inline4: { cylinders: 4, uneven: 0.16, resonance: 260, bright: 1.1 },
  inline6: { cylinders: 6, uneven: 0.07, resonance: 230, bright: 1 },
  v8: { cylinders: 8, uneven: 0.42, resonance: 150, bright: 0.8 },
  v12: { cylinders: 12, uneven: 0.05, resonance: 320, bright: 1.25 },
};

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
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    const gain = ctx.createGain(); gain.gain.value = 0.9;
    comp.connect(gain).connect(ctx.destination);
    m = comp;
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

/** which engine a car sounds like when none is given: from its power and redline */
function guessEngine(p) {
  if (p.power >= 400 && p.redline >= 8500) return 'v12';
  if (p.power >= 300 || p.mass >= 1900) return 'v8';
  if (p.power < 160 || p.redline >= 7600) return 'inline4';
  return 'inline6';
}

/**
 * @param {any} car from CAR.create()
 * @param {{ context?: BaseAudioContext, engine?: keyof ENGINES, volume?: number, listener?: import('three').Object3D,
 *   pops?: number, turbo?: number, blowoff?: number, tyres?: number, crashes?: number }} [o]
 */
export function createCarSound(car, o = {}) {
  const opt = {
    engine: o.engine && ENGINES[o.engine] ? o.engine : guessEngine(car.params),
    volume: o.volume ?? 1, pops: o.pops ?? 0.5, turbo: o.turbo ?? 0, blowoff: o.blowoff ?? (o.turbo ? 0.5 : 0),
    tyres: o.tyres ?? 1, crashes: o.crashes ?? 1,
  };
  let listener = o.listener || null;
  let ctx = null, n = null, muted = false, disposed = false;
  const st = { lastImpact: 0, v: null, p: [0, 0, 0], t: 0, crashAt: -1, thumpAt: -1, vib: 0 };
  const stats = { crashes: 0, thumps: 0 };

  function build() {
    ctx = o.context || audioContext();
    if (!ctx) return false;
    resumeOnGesture(ctx);
    const out = ctx.createGain(); out.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) out.connect(pan).connect(masterOf(ctx)); else out.connect(masterOf(ctx));

    /* ---- engine */
    const spec = ENGINES[opt.engine];
    const H = 96, re = new Float32Array(H + 1), im = new Float32Array(H + 1);
    let seed = spec.cylinders * 7919;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 1; k <= H; k++) {
      const firing = k % spec.cylinders === 0;
      const a = (firing ? 1 : spec.uneven * (0.35 + rnd())) / Math.pow(k / spec.cylinders + 0.4, 1.05);
      const ph = rnd() * Math.PI * 2;
      re[k] = a * Math.cos(ph); im[k] = a * Math.sin(ph);
    }
    const wave = ctx.createPeriodicWave(re, im);
    const osc = ctx.createOscillator(); osc.setPeriodicWave(wave);
    const osc2 = ctx.createOscillator(); osc2.setPeriodicWave(wave); osc2.detune.value = 7;
    const drive = ctx.createGain(); drive.gain.value = 1;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    osc.connect(drive); osc2.connect(g2).connect(drive);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) { const x = (i / 1023.5) - 1; curve[i] = Math.tanh(1.6 * x); }
    shaper.curve = curve;
    const reso = ctx.createBiquadFilter(); reso.type = 'peaking'; reso.frequency.value = spec.resonance; reso.Q.value = 1.4; reso.gain.value = 7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
    const engine = ctx.createGain(); engine.gain.value = 0;
    drive.connect(shaper).connect(reso).connect(lp).connect(engine).connect(out);

    /* noise: combustion texture (pulsed by the engine wave), tyres, road, wind, crashes */
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const combBp = ctx.createBiquadFilter(); combBp.type = 'bandpass'; combBp.Q.value = 0.8;
    const comb = ctx.createGain(); comb.gain.value = 0;
    const combAm = ctx.createGain(); combAm.gain.value = 0;
    osc.connect(combAm).connect(comb.gain);
    noise.connect(combBp).connect(comb).connect(lp);

    /* tyres: two squeal tones + narrow noise */
    const tyre = ctx.createGain(); tyre.gain.value = 0;
    const sq1 = ctx.createOscillator(); sq1.type = 'triangle'; sq1.frequency.value = 820;
    const sq2 = ctx.createOscillator(); sq2.type = 'triangle'; sq2.frequency.value = 1130;
    const sqG = ctx.createGain(); sqG.gain.value = 0.18;
    sq1.connect(sqG); sq2.connect(sqG); sqG.connect(tyre);
    const tyreBp = ctx.createBiquadFilter(); tyreBp.type = 'bandpass'; tyreBp.frequency.value = 1300; tyreBp.Q.value = 6;
    noise.connect(tyreBp).connect(tyre);
    tyre.connect(out);

    const roadLp = ctx.createBiquadFilter(); roadLp.type = 'lowpass'; roadLp.frequency.value = 200;
    const road = ctx.createGain(); road.gain.value = 0;
    noise.connect(roadLp).connect(road).connect(out);
    const windBp = ctx.createBiquadFilter(); windBp.type = 'bandpass'; windBp.frequency.value = 500; windBp.Q.value = 0.6;
    const wind = ctx.createGain(); wind.gain.value = 0;
    noise.connect(windBp).connect(wind).connect(out);

    const fx = createEngineFx(ctx, { pops: opt.pops, turbo: opt.turbo, blowoff: opt.blowoff, volume: 0.8 });
    fx.output.connect(out);

    const t = ctx.currentTime;
    for (const s of [osc, osc2, noise, sq1, sq2]) s.start(t);
    n = { out, pan, osc, osc2, drive, lp, engine, comb, combAm, combBp, tyre, tyreBp, sq1, sq2, road, roadLp, wind, windBp, fx, sources: [osc, osc2, noise, sq1, sq2], buf };
    return true;
  }

  /* one-off sounds: a low thump, a crash */
  function thump(strength) {
    stats.thumps++;
    const t = ctx.currentTime;
    const s = ctx.createOscillator(), g = ctx.createGain();
    s.frequency.setValueAtTime(95, t); s.frequency.exponentialRampToValueAtTime(40, t + 0.22);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6 * strength + 0.001, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    s.connect(g).connect(n.out); s.start(t); s.stop(t + 0.3);
  }
  function crash(strength) {
    stats.crashes++;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = n.buf; src.playbackRate.value = 0.7 + Math.random() * 0.3;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + 900 * strength; bp.Q.value = 0.7;
    const g = ctx.createGain();
    const len = 0.18 + 0.35 * strength;
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
    const x = Math.max(0, Math.min(1.1, e.rpm / e.redline)), thr = e.throttle;
    /* engine: pitch, tone, loudness */
    const fcam = Math.max(3, e.rpm / 120);
    n.osc.frequency.setTargetAtTime(fcam, t, 0.02);
    n.osc2.frequency.setTargetAtTime(fcam, t, 0.02);
    const bright = ENGINES[opt.engine].bright;
    n.lp.frequency.setTargetAtTime((250 + 2200 * x * (0.35 + 0.65 * thr)) * bright, t, 0.04);
    n.drive.gain.setTargetAtTime(0.8 + 2.2 * thr * (0.4 + x), t, 0.04);
    n.combBp.frequency.setTargetAtTime(fcam * ENGINES[opt.engine].cylinders * 3, t, 0.05);
    n.comb.gain.setTargetAtTime(0.02 + 0.05 * thr, t, 0.05);
    n.combAm.gain.setTargetAtTime(0.05 + 0.12 * thr, t, 0.05);
    let g = 0.13 + 0.14 * thr + 0.07 * x;
    if (e.shifting) g *= 0.5;
    if (e.limiter) g *= Math.sin(t * 95) > 0 ? 1 : 0.35;
    n.engine.gain.setTargetAtTime(g, t, 0.025);
    const fo = n.fx.options;
    fo.pops = opt.pops; fo.turbo = opt.turbo; fo.blowoff = opt.blowoff;
    n.fx.update(e);

    /* tyres, road, wind */
    const sp = Math.abs(car.speed) / 3.6, onGround = car.grounded / Math.max(1, car.wheels.length);
    const skid = car.skid * Math.min(1, sp / 4) * (onGround > 0 ? 1 : 0) * opt.tyres;
    st.vib += 0.37;
    n.tyre.gain.setTargetAtTime(Math.min(0.32, skid * 0.34), t, 0.04);
    n.sq1.frequency.setTargetAtTime(760 + 160 * skid + 18 * Math.sin(st.vib), t, 0.03);
    n.sq2.frequency.setTargetAtTime(1080 + 200 * skid + 25 * Math.sin(st.vib * 1.3), t, 0.03);
    n.tyreBp.frequency.setTargetAtTime(1100 + 600 * skid, t, 0.06);
    n.road.gain.setTargetAtTime(0.12 * Math.min(1, sp / 25) * onGround, t, 0.1);
    n.roadLp.frequency.setTargetAtTime(160 + sp * 6, t, 0.2);
    n.wind.gain.setTargetAtTime(Math.min(0.2, (sp / 65) ** 2 * 0.2), t, 0.2);

    /* knocks: suspension hits, and the body stopped or shoved faster than braking can */
    if (car.impact > st.lastImpact + 0.2 && t - st.thumpAt > 0.15) { thump(Math.min(1, car.impact)); st.thumpAt = t; }
    st.lastImpact = car.impact;
    const v = car.body.motionProperties.linearVelocity, bp = car.body.position;
    if (st.v) {
      const dt = Math.max(1e-3, t - st.t);
      const dv = Math.hypot(v[0] - st.v[0], v[2] - st.v[2]);
      const a = dv / Math.max(dt, 1 / 60);
      /* a reset / teleport also changes the velocity at once: not a crash */
      const jumped = Math.hypot(bp[0] - st.p[0], bp[2] - st.p[2]) > Math.hypot(st.v[0], st.v[2]) * Math.max(dt, 1 / 30) * 2 + 1.5;
      if (opt.crashes > 0 && !jumped && dv > 2.5 && a > 35 && t - st.crashAt > 0.3) { crash(Math.min(1, (dv - 1.5) / 12) * opt.crashes); st.crashAt = t; }
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
    /** the options in use; change them live: engine, volume, pops, turbo, blowoff, tyres, crashes */
    options: opt,
    /** switch the engine character: "inline4" | "inline6" | "v8" | "v12" */
    setEngine(name) { if (!ENGINES[name] || name === opt.engine) return; opt.engine = name; if (n) { stopAll(); n = null; } },
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
    dispose() { disposed = true; if (n) stopAll(); n = null; },
  };

  function stopAll() {
    const t = ctx.currentTime;
    n.out.gain.setTargetAtTime(0, t, 0.02);
    const old = n;
    setTimeout(() => { for (const s of old.sources) { try { s.stop(); } catch { /* already stopped */ } } old.fx.dispose(); old.out.disconnect(); }, 120);
  }
}
