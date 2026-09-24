/* Real engine sound from a recorded sound pack (Web Audio). Optional: not part of the core bundle (it loads audio
   files); a game that wants it imports this module.

     import { loadEngineSound } from 'car/engine-sound';
     const engine = await loadEngineSound(audioContext, '/assets/sounds/engines/f136.json');
     engine.output.connect(audioContext.destination);
     // every frame:
     engine.update(car.engine);          // { rpm, redline, throttle, limiter, shifting } from CAR.create()

   A pack (tools/engine-render + tools/engine-sound-pack.mjs) is a set of seamless loops recorded from Engine
   Simulator at fixed rpm, at full throttle ("on") and with the throttle shut ("off"). Playing it, like racing games
   do: for each layer, the two loops nearest the engine speed play, each pitched to the exact rpm (playbackRate =
   rpm / recorded rpm) and crossfaded with equal power; the throttle crossfades the layers. The car's rev range is
   mapped onto the recorded engine's (idle → idle, redline → redline). Only the 4 loops in use run at a time. */

/**
 * Fetch and decode a pack. fetchFn defaults to globalThis.fetch.
 * @param {BaseAudioContext} ctx
 * @param {string} url the pack's .json (its loops are in a folder of the same name next to it)
 */
export async function loadEngineSound(ctx, url, fetchFn = globalThis.fetch) {
  const meta = await (await fetchFn(url)).json();
  const base = url.replace(/[^/]*$/, '') + meta.name + '/';
  const buffers = await Promise.all(meta.samples.map(async (s) => ctx.decodeAudioData(await (await fetchFn(base + s.file)).arrayBuffer())));
  return createEngineSound(ctx, meta, buffers);
}

/**
 * @param {BaseAudioContext} ctx
 * @param {{ samples: { rpm: number, layer: string, loop: number }[], redline: number, idle: number, pad: number }} meta
 * @param {AudioBuffer[]} buffers decoded loops, in meta.samples order
 * @param {{ volume?: number, offBoost?: number }} [o] volume (default 1) · offBoost: how loud the throttle-shut layer
 *   plays relative to the recording (default 2.5; closed-throttle engines are ~20 dB quieter than at full throttle)
 */
export function createEngineSound(ctx, meta, buffers, o = {}) {
  const opt = { volume: 1, offBoost: 2.5, ...o };
  const output = ctx.createGain();
  output.gain.value = opt.volume;
  /* a gentle compressor: idle stays audible next to full throttle, as in a game mix */
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -26; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.01; comp.release.value = 0.2;
  const bus = ctx.createGain();
  bus.connect(comp).connect(output);

  const layers = {};
  meta.samples.forEach((s, i) => {
    (layers[s.layer] ||= []).push({ rpm: s.rpm, loop: s.loop, buffer: buffers[i], key: `${s.layer}:${s.rpm}` });
  });
  for (const k in layers) layers[k].sort((a, b) => a.rpm - b.rpm);
  const voices = new Map();
  let load = 0, last = ctx.currentTime;

  function voice(sample) {
    let v = voices.get(sample.key);
    if (v) return v;
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.loop = true;
    src.loopStart = meta.pad;
    src.loopEnd = meta.pad + sample.loop;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(bus);
    src.start(0, meta.pad + Math.random() * sample.loop);
    v = { src, gain, sample, used: 0 };
    voices.set(sample.key, v);
    return v;
  }

  /** every frame: { rpm, redline, throttle 0..1, limiter, shifting } (car.engine) */
  function update(e) {
    const now = ctx.currentTime, dt = Math.min(0.1, Math.max(0, now - last));
    last = now;
    /* the car's rev range onto the recorded engine's */
    const carIdle = Math.min(1000, e.redline * 0.14);
    const f = (e.rpm - carIdle) / Math.max(1, e.redline - carIdle);
    const rpm = Math.max(meta.idle * 0.8, meta.idle + f * (meta.redline - meta.idle));
    load += ((e.throttle || 0) - load) * Math.min(1, dt * 12);
    let on = Math.pow(Math.max(0, load), 0.7), off = Math.pow(Math.max(0, 1 - load), 0.7) * opt.offBoost;
    /* limiter bounce: the throttle layer cuts in and out ~20 times a second; a gear change dips it */
    if (e.limiter) on *= Math.sin(now * 2 * Math.PI * 18) > 0 ? 1 : 0.15;
    if (e.shifting) on *= 0.35;

    const wanted = new Map();
    for (const [name, gain] of [['on', on], ['off', off]]) {
      const list = layers[name];
      if (!list || gain <= 1e-4) continue;
      let i = 0;
      while (i < list.length - 2 && list[i + 1].rpm < rpm) i++;
      const a = list[i], b = list[Math.min(i + 1, list.length - 1)];
      const t = a === b ? 0 : Math.max(0, Math.min(1, Math.log(rpm / a.rpm) / Math.log(b.rpm / a.rpm)));
      wanted.set(a.key, { s: a, g: gain * Math.cos(t * Math.PI / 2) });
      if (b !== a) wanted.set(b.key, { s: b, g: gain * Math.sin(t * Math.PI / 2) });
    }
    for (const [key, w] of wanted) {
      const v = voice(w.s);
      v.used = now;
      v.gain.gain.setTargetAtTime(w.g, now, 0.03);
      v.src.playbackRate.setTargetAtTime(Math.max(0.5, Math.min(2, rpm / w.s.rpm)), now, 0.02);
      void key;
    }
    /* voices no longer needed fade out and stop */
    for (const [key, v] of voices) {
      if (wanted.has(key)) continue;
      v.gain.gain.setTargetAtTime(0, now, 0.04);
      if (now - v.used > 0.4) { v.src.stop(); v.src.disconnect(); v.gain.disconnect(); voices.delete(key); }
    }
  }

  /** stop every playing loop (they start again on the next update) */
  function stop() {
    for (const v of voices.values()) { v.src.stop(); v.src.disconnect(); v.gain.disconnect(); }
    voices.clear();
  }
  function dispose() { stop(); output.disconnect(); }

  return { output, update, stop, dispose, meta, options: opt, get voices() { return voices.size; } };
}
