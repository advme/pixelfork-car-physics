/* Car sounds for the playground (Web Audio):
   - engine: a real engine recorded from Engine Simulator (assets/sounds/engines, played by src/engine-sound.js);
     until its pack has loaded, a simple synthesised engine stands in
   - exhaust pops & bangs and turbo (whine, whoosh, blow-off / flutter): src/engine-fx.js
   - tyre screech from the car's skid value, wind with speed, a thump on hard landings (synthesised)
   - or, for an engine named "synth:v8" etc., the library's built-in sound (car/sound) does everything instead
   Browsers only start audio after a key or click: call start() from one. */
import { loadEngineSound } from 'car/engine-sound';
import { createEngineFx } from 'car/engine-fx';
import { createCarSound as createBuiltInSound } from 'car/sound';

/** which recorded engine each preset uses */
export const ENGINE_FOR_PRESET = { sport: 'f136', car: 'm52', classic: 'vtec', offroad: 'c454' };

export function createCarSound(packBase = '/assets/sounds/engines/') {
  let ctx = null, n = null, muted = false, lastImpact = 0;
  let wantEngine = 'm52', engine = null, loading = null, fx = null;
  const fxOptions = { pops: 1, turbo: 0.6, blowoff: 0.6, valve: 'blowoff' };
  let engineVolume = 1, engineBus = null;
  const packs = new Map();
  /* the built-in sound (car/sound) when the engine is "synth:<name>" */
  let synthName = null, synth = null;

  /* load (once) and switch to a recorded engine */
  async function useEngine(name) {
    synthName = name.startsWith('synth:') ? name.slice(6) : null;
    if (!synthName && synth) { synth.s.dispose(); synth = null; }
    if (synthName) { wantEngine = name; if (engine) { engine.stop(); engine.output.disconnect(); engine = null; } loading = null; return; }
    wantEngine = name;
    if (!ctx) return;
    if (engine && engine.meta.name !== name) { engine.stop(); engine.output.disconnect(); engine = null; }
    if (!packs.has(name)) packs.set(name, loadEngineSound(ctx, `${packBase}${name}.json`).catch((e) => { console.warn('[sound] engine pack', name, e); return null; }));
    loading = name;
    const pack = await packs.get(name);
    if (wantEngine !== name || !pack) return;
    if (engine === pack) { loading = null; return; }
    engine = pack;
    engine.output.connect(engineBus);
    loading = null;
  }

  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);

    /* engine: three detuned oscillators through a soft clipper and a low-pass that opens with throttle */
    const eGain = ctx.createGain(); eGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(2.2 * x); }
    shaper.curve = curve;
    const oscs = [['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['sawtooth', 2.01, 0.18]].map(([type, mul, vol]) => {
      const o = ctx.createOscillator(); o.type = type;
      const g = ctx.createGain(); g.gain.value = vol;
      o.connect(g).connect(shaper);
      o.start();
      return { o, mul };
    });
    shaper.connect(lp).connect(eGain).connect(master);

    /* noise for tyres and wind */
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true; noise.start();
    const tyreBp = ctx.createBiquadFilter(); tyreBp.type = 'bandpass'; tyreBp.frequency.value = 1150; tyreBp.Q.value = 4;
    const tyreGain = ctx.createGain(); tyreGain.gain.value = 0;
    noise.connect(tyreBp).connect(tyreGain).connect(master);
    const windLp = ctx.createBiquadFilter(); windLp.type = 'lowpass'; windLp.frequency.value = 420;
    const windGain = ctx.createGain(); windGain.gain.value = 0;
    noise.connect(windLp).connect(windGain).connect(master);
    n = { master, eGain, lp, oscs, tyreGain, tyreBp, windGain };
    engineBus = ctx.createGain();
    engineBus.gain.value = engineVolume;
    engineBus.connect(master);
    fx = createEngineFx(ctx, fxOptions);
    fx.output.connect(master);
    if (!wantEngine.startsWith('synth:')) useEngine(wantEngine);
  }

  function thump(strength) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    g.gain.setValueAtTime(0.5 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(n.master);
    o.start(t); o.stop(t + 0.32);
  }

  /** every frame: car = the object from CAR.create() */
  function update(car) {
    if (!ctx || !n || !car) return;
    if (synthName) {
      if (!synth || synth.car !== car || synth.name !== synthName) {
        if (synth) synth.s.dispose();
        synth = { car, name: synthName, s: createBuiltInSound(car, { engine: synthName, context: ctx }) };
      }
      Object.assign(synth.s.options, { pops: fxOptions.pops, turbo: fxOptions.turbo, blowoff: fxOptions.blowoff, volume: engineVolume });
      synth.s.muted = muted;
      synth.s.update();
      const t0 = ctx.currentTime;
      for (const g0 of [n.eGain, n.tyreGain, n.windGain, fx.output]) g0.gain.setTargetAtTime(0, t0, 0.03);
      lastImpact = car.impact;
      return;
    }
    fx.output.gain.setTargetAtTime(1, ctx.currentTime, 0.03);
    const t = ctx.currentTime, e = car.engine, x = e.rpm / e.redline;
    /* a 4-stroke 4-cylinder fires twice per turn */
    const f = Math.max(20, (e.rpm / 60) * 2);
    for (const { o, mul } of n.oscs) o.frequency.setTargetAtTime(f * mul, t, 0.025);
    n.lp.frequency.setTargetAtTime(280 + 1400 * x + 2600 * e.throttle * x, t, 0.05);
    let g = 0.05 + 0.1 * e.throttle + 0.05 * x;
    if (e.shifting) g *= 0.45;
    if (e.limiter) g *= 0.6 + 0.4 * Math.sin(t * 90);
    /* the recorded engine replaces the synthesised one once it has loaded */
    if (engine && !loading) { engine.update(e); g = 0; }
    fx.update(e);
    n.eGain.gain.setTargetAtTime(g, t, 0.03);
    const sp = Math.abs(car.speed) / 3.6;
    n.tyreGain.gain.setTargetAtTime(Math.min(0.4, car.skid * 0.4), t, 0.05);
    n.tyreBp.frequency.setTargetAtTime(950 + car.skid * 500, t, 0.1);
    n.windGain.gain.setTargetAtTime(Math.min(0.3, (sp / 60) ** 2 * 0.3), t, 0.2);
    if (car.impact > lastImpact + 0.2) thump(Math.min(1, car.impact));
    lastImpact = car.impact;
  }

  return {
    start, update,
    /** switch the recorded engine: 'f136' | 'm52' | 'vtec' | 'c454' (see ENGINE_FOR_PRESET) */
    useEngine,
    get engine() { return synthName ? `built-in ${synthName}` : engine && !loading ? engine.meta.title : null; },
    get muted() { return muted; },
    /** pops & turbo: { pops: 0..1, turbo: 0..1, valve: 'blowoff' | 'flutter' } (live) */
    setFx(o2) { Object.assign(fxOptions, o2); if (fx) Object.assign(fx.options, o2); },
    /** recorded engine loudness 0..2 */
    setEngineVolume(v) { engineVolume = v; if (engineBus) engineBus.gain.setTargetAtTime(v, ctx.currentTime, 0.05); },
    get fx() { return synth ? synth.s : fx; },
    setMuted(m) { muted = !!m; if (n) n.master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.05); },
  };
}
