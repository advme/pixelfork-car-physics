/* Pixelfork Car Physics v0.8.0 · needs three@0.186.0 and crashcat@0.0.5 from the import map · © 2026 Pixelfork, see LICENSE */

// src/engine-sound.js
async function loadEngineSound(ctx, url, fetchFn = globalThis.fetch) {
  const meta = await (await fetchFn(url)).json();
  const base = url.replace(/[^/]*$/, "") + meta.name + "/";
  const buffers = await Promise.all(meta.samples.map(async (s) => ctx.decodeAudioData(await (await fetchFn(base + s.file)).arrayBuffer())));
  return createEngineSound(ctx, meta, buffers);
}
function createEngineSound(ctx, meta, buffers, o = {}) {
  const opt = { volume: 1, offBoost: 2.5, ...o };
  const output = ctx.createGain();
  output.gain.value = opt.volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -26;
  comp.knee.value = 12;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.01;
  comp.release.value = 0.2;
  const bus = ctx.createGain();
  bus.connect(comp).connect(output);
  const layers = {};
  meta.samples.forEach((s, i) => {
    (layers[s.layer] ||= []).push({ rpm: s.rpm, loop: s.loop, buffer: buffers[i], key: `${s.layer}:${s.rpm}` });
  });
  for (const k in layers) layers[k].sort((a, b) => a.rpm - b.rpm);
  const voices = /* @__PURE__ */ new Map();
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
  function update(e) {
    const now = ctx.currentTime, dt = Math.min(0.1, Math.max(0, now - last));
    last = now;
    const carIdle = Math.min(1e3, e.redline * 0.14);
    const f = (e.rpm - carIdle) / Math.max(1, e.redline - carIdle);
    const rpm = Math.max(meta.idle * 0.8, meta.idle + f * (meta.redline - meta.idle));
    load += ((e.throttle || 0) - load) * Math.min(1, dt * 12);
    let on = Math.pow(Math.max(0, load), 0.7), off = Math.pow(Math.max(0, 1 - load), 0.7) * opt.offBoost;
    if (e.limiter) on *= Math.sin(now * 2 * Math.PI * 18) > 0 ? 1 : 0.15;
    if (e.shifting) on *= 0.35;
    const wanted = /* @__PURE__ */ new Map();
    for (const [name, gain] of [["on", on], ["off", off]]) {
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
    for (const [key, v] of voices) {
      if (wanted.has(key)) continue;
      v.gain.gain.setTargetAtTime(0, now, 0.04);
      if (now - v.used > 0.4) {
        v.src.stop();
        v.src.disconnect();
        v.gain.disconnect();
        voices.delete(key);
      }
    }
  }
  function stop() {
    for (const v of voices.values()) {
      v.src.stop();
      v.src.disconnect();
      v.gain.disconnect();
    }
    voices.clear();
  }
  function dispose() {
    stop();
    output.disconnect();
  }
  return { output, update, stop, dispose, meta, options: opt, get voices() {
    return voices.size;
  } };
}
export {
  createEngineSound,
  loadEngineSound
};
