/* The playground's and race's sound for your car: the library's own car/sound (so what you hear here is what a game
   gets), wrapped for the demo UI: pick an engine, pops / turbo / engine volume from the Tune panel, mute.
   One audio context for the page (the race's AI cars share it, and with it the decoded recordings).
   Browsers only start audio after a key or click: call start() from one. */
import { createCarSound as createLibrarySound, RECORDED_ENGINES } from 'car/sound';

/** which recorded engine each preset uses */
export const ENGINE_FOR_PRESET = { sport: 'f136', car: 'm52', classic: 'vtec', offroad: 'c454' };

export function createCarSound() {
  let ctx = null, snd = null, sndCar = null, muted = false, want = null, ready = false;
  const fxOptions = { pops: 1, turbo: 0.6, blowoff: 0.6, valve: 'blowoff' };
  let engineVolume = 1;

  function start() {
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }
  function track(s) { ready = false; s.ready.then(() => { if (snd === s) ready = true; }); }

  /** every frame: car = the object from CAR.create() */
  function update(car) {
    if (!ctx || !car) return;
    if (sndCar !== car) {
      if (snd) snd.dispose();
      snd = createLibrarySound(car, { context: ctx, engine: want || undefined, ...fxOptions, engineVolume });
      sndCar = car;
      track(snd);
    }
    Object.assign(snd.options, fxOptions, { engineVolume });
    snd.muted = muted;
    snd.update();
  }

  return {
    start, update,
    /** switch the engine: a recorded one ('f136', 'm52', …) or a synthesised fallback ('synth-v8', …) */
    useEngine(name) { want = name; if (snd && snd.options.engine !== name) { snd.setEngine(name); track(snd); } },
    get engine() {
      if (!snd || !ready) return null;
      const e = snd.options.engine;
      return RECORDED_ENGINES[e] || `synthesised ${e.slice(6)}`;
    },
    get muted() { return muted; },
    setMuted(m) { muted = !!m; },
    /** pops & turbo: { pops: 0..1, turbo: 0..1, blowoff: 0..1, valve: 'blowoff' | 'flutter' } (live) */
    setFx(o2) { Object.assign(fxOptions, o2); },
    /** recorded engine loudness 0..2 */
    setEngineVolume(v) { engineVolume = v; },
    /** for the boost gauge: { boost } */
    get fx() { return snd; },
    /** the audio context (after start()) */
    get context() { return ctx; },
  };
}
