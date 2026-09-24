/* Pixelfork Car Physics v0.9.1 · needs three@0.186.0 and crashcat@0.0.5 from the import map · © 2026 Pixelfork, see LICENSE */

// src/engine-fx.js
function createEngineFx(ctx, o = {}) {
  const opt = { pops: 1, turbo: 0.6, blowoff: 0.6, valve: "blowoff", volume: 1, ...o };
  const output = ctx.createGain();
  output.gain.value = opt.volume;
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 0.22), ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const t = i / ctx.sampleRate;
      const comb = 0.6 + 0.4 * Math.cos(2 * Math.PI * t / 9e-3);
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 26) * comb;
    }
    d[0] = 1;
  }
  const popBus = ctx.createGain();
  const pipe = ctx.createConvolver();
  pipe.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  const grit = ctx.createWaveShaper();
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) {
    const x = i / 1023.5 - 1;
    curve[i] = Math.tanh(3 * x) / Math.tanh(3);
  }
  grit.curve = curve;
  popBus.connect(grit);
  grit.connect(output);
  grit.connect(pipe).connect(wet).connect(output);
  function noiseSource(offset) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.loopStart = 0;
    s.loopEnd = noise.duration;
    return { s, offset: offset ?? Math.random() * (noise.duration - 0.5) };
  }
  function pop(t, size) {
    const vol = opt.pops * (0.25 + 0.75 * size);
    const { s, offset } = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 350 + Math.random() * 900 + size * 300;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    const len = 0.025 + size * 0.065 + Math.random() * 0.02;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * vol, t + 15e-4);
    g.gain.exponentialRampToValueAtTime(1e-3, t + len);
    s.connect(bp).connect(g).connect(popBus);
    s.start(t, offset);
    s.stop(t + len + 0.02);
    const th = ctx.createOscillator(), tg = ctx.createGain();
    th.type = "sine";
    th.frequency.setValueAtTime(95 + Math.random() * 40, t);
    th.frequency.exponentialRampToValueAtTime(42, t + 0.09 + size * 0.06);
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(0.8 * vol * (0.4 + size), t + 2e-3);
    tg.gain.exponentialRampToValueAtTime(1e-3, t + 0.1 + size * 0.08);
    th.connect(tg).connect(popBus);
    th.start(t);
    th.stop(t + 0.2 + size * 0.1);
    const c = noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2500;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.6 * vol, t);
    cg.gain.exponentialRampToValueAtTime(1e-3, t + 0.012 + size * 0.01);
    c.s.connect(hp).connect(cg).connect(popBus);
    c.s.start(t, c.offset);
    c.s.stop(t + 0.04);
    stats.pops++;
  }
  const tBus = ctx.createGain();
  const tLp = ctx.createBiquadFilter();
  tLp.type = "lowpass";
  tLp.frequency.value = 5e3;
  tLp.Q.value = 0.5;
  tBus.connect(tLp).connect(output);
  function valve(t, amount) {
    const { s, offset } = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    const vol = 0.08 * opt.blowoff * amount * amount;
    if (opt.valve === "flutter") {
      const len = 0.25 + amount * 0.3;
      bp.frequency.setValueAtTime(1e3, t);
      bp.frequency.exponentialRampToValueAtTime(500, t + len);
      g.gain.setValueAtTime(0, t);
      const rate = 19 + Math.random() * 5;
      for (let k = 0; k < len * rate; k++) {
        const tk = t + k / rate, a = vol * Math.exp(-k / (len * rate) * 2.2);
        g.gain.setValueAtTime(1e-4, tk);
        g.gain.linearRampToValueAtTime(a, tk + 6e-3);
        g.gain.exponentialRampToValueAtTime(1e-4, tk + 0.8 / rate);
      }
      s.connect(bp).connect(g).connect(tBus);
      s.start(t, offset);
      s.stop(t + len + 0.1);
    } else {
      const len = 0.25 + amount * 0.3;
      bp.frequency.setValueAtTime(1900, t);
      bp.frequency.exponentialRampToValueAtTime(550, t + len);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.035);
      g.gain.exponentialRampToValueAtTime(1e-3, t + len);
      s.connect(bp).connect(g).connect(tBus);
      s.start(t, offset);
      s.stop(t + len + 0.05);
    }
    stats.valves++;
  }
  const stats = { pops: 0, valves: 0 };
  const st = { boost: 0, shaft: 0, held: 0, lastValve: -99, overrun: 0, nextPop: 0, lastThrottle: 0, peakThrottle: 0, wasShifting: false, lastLimiter: 0, last: ctx.currentTime };
  function update(e) {
    const now = ctx.currentTime, dt = Math.min(0.1, Math.max(0, now - st.last));
    st.last = now;
    const x = Math.max(0, Math.min(1.1, e.rpm / e.redline)), thr = Math.max(0, Math.min(1, e.throttle || 0));
    if (opt.turbo > 0 || opt.blowoff > 0) {
      const target = thr ** 1.5 * Math.max(0, Math.min(1, (x - 0.22) / 0.35)) * (e.shifting ? 0.6 : 1);
      const up = target > st.boost;
      st.boost += (target - st.boost) * Math.min(1, dt * (up ? 1.6 : 5));
      st.shaft += (Math.max(st.boost, x * 0.3 * thr) - st.shaft) * Math.min(1, dt * (up ? 1.4 : 0.9));
      st.held = st.boost > 0.6 ? st.held + dt : Math.max(0, st.held - dt * 2);
      if (thr < 0.3 && st.lastThrottle >= 0.3) {
        if (st.boost > 0.55 && st.held > 0.6 && now - st.lastValve > 3 && opt.blowoff > 0) {
          valve(now + 0.01, st.boost);
          st.lastValve = now;
        }
        st.boost *= 0.3;
        st.held = 0;
      }
    } else {
      st.boost = 0;
      st.shaft = 0;
    }
    if (opt.pops > 0) {
      st.peakThrottle = Math.max(thr, st.peakThrottle - dt * 0.8);
      if (thr < 0.1 && st.lastThrottle >= 0.1 && x > 0.4 && st.peakThrottle > 0.5) st.overrun = 1;
      if (thr > 0.2 || x < 0.28) st.overrun = 0;
      st.overrun = Math.max(0, st.overrun - dt / 1.6);
      if (st.overrun > 0 && now >= st.nextPop) {
        const k = st.overrun;
        pop(now + Math.random() * 0.01, Math.random() < 0.12 * k ? 0.8 : 0.15 + 0.35 * Math.random() * k);
        st.nextPop = now + (0.03 + Math.random() * 0.14) / (0.4 + k);
      }
      if (e.shifting && !st.wasShifting && thr > 0.7 && x > 0.5) {
        pop(now + 0.01, 1);
        if (Math.random() < 0.5) pop(now + 0.06 + Math.random() * 0.04, 0.6);
      }
      if (e.limiter && now - st.lastLimiter > 0.06 + Math.random() * 0.08) {
        pop(now + 5e-3, 0.35 + Math.random() * 0.3);
        st.lastLimiter = now;
      }
    }
    st.wasShifting = !!e.shifting;
    st.lastThrottle = thr;
  }
  return {
    output,
    update,
    options: opt,
    stats,
    /** 0..1 turbo boost now (≈ 0–1 bar) */
    get boost() {
      return st.boost;
    },
    dispose() {
      output.disconnect();
    }
  };
}

// src/engine-sound.js
var decoded = /* @__PURE__ */ new WeakMap();
function loadEngineData(ctx, url, fetchFn = globalThis.fetch) {
  try {
    url = new URL(url, globalThis.location?.href).href;
  } catch {
  }
  let byUrl = decoded.get(ctx);
  if (!byUrl) {
    byUrl = /* @__PURE__ */ new Map();
    decoded.set(ctx, byUrl);
  }
  let p = byUrl.get(url);
  if (!p) {
    p = (async () => {
      const r = await fetchFn(url);
      if (!r.ok) throw new Error(`engine pack ${url}: ${r.status}`);
      const meta = await r.json();
      const dir = url.replace(/[^/]*$/, "");
      const get = async (u) => {
        const x = await fetchFn(u);
        if (!x.ok) throw new Error(`engine pack ${u}: ${x.status}`);
        return ctx.decodeAudioData(await x.arrayBuffer());
      };
      if (meta.file) {
        const all = await get(dir + meta.file);
        return { meta, buffers: meta.samples.map(() => all) };
      }
      return { meta, buffers: await Promise.all(meta.samples.map((s) => get(dir + meta.name + "/" + s.file))) };
    })();
    byUrl.set(url, p);
    p.catch(() => byUrl.delete(url));
  }
  return p;
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
    (layers[s.layer] ||= []).push({ rpm: s.rpm, loop: s.loop, start: (s.start || 0) + meta.pad, buffer: buffers[i], key: `${s.layer}:${s.rpm}` });
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
    src.loopStart = sample.start;
    src.loopEnd = sample.start + sample.loop;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(bus);
    src.start(0, sample.start + Math.random() * sample.loop);
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

// src/sound.js
var RECORDED_ENGINES = {
  f136: "Ferrari F136 V8",
  m52: "BMW M52B28 straight-6",
  vtec: "Honda B18C5 VTEC 4-cylinder",
  c454: "Chevrolet 454 V8 (truck)",
  "2jz": "Toyota 2JZ straight-6",
  ls: "GM LS V8",
  lfa: "Lexus LFA V10",
  ej25: "Subaru EJ25 boxer-4",
  i5: "Audi 2.3 inline-5",
  v6: "60\xB0 V6",
  f1v12: "Ferrari 412 T2 V12 (F1)",
  busa: "Suzuki Hayabusa inline-4 (bike)",
  harley: "Harley-Davidson V-twin (bike)"
};
var SYNTH = {
  "synth-inline4": { cylinders: 4, uneven: 0.16, resonance: 260, bright: 1.1 },
  "synth-inline6": { cylinders: 6, uneven: 0.07, resonance: 230, bright: 1 },
  "synth-v8": { cylinders: 8, uneven: 0.42, resonance: 150, bright: 0.8 },
  "synth-v12": { cylinders: 12, uneven: 0.05, resonance: 320, bright: 1.25 }
};
var SYNTH_ENGINES = Object.keys(SYNTH);
var DEFAULT_SOUNDS = (() => {
  try {
    return new URL("../assets/sounds/engines/", import.meta.url).href;
  } catch {
    return "/assets/sounds/engines/";
  }
})();
var DEFAULT_TYRES = (() => {
  try {
    return new URL("../assets/sounds/tyres/tyres.json", import.meta.url).href;
  } catch {
    return "/assets/sounds/tyres/tyres.json";
  }
})();
var masters = /* @__PURE__ */ new WeakMap();
var shared = null;
function audioContext() {
  if (shared) return shared;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  shared = AC ? new AC() : null;
  return shared;
}
function masterOf(ctx) {
  let m = masters.get(ctx);
  if (!m) {
    m = ctx.createDynamicsCompressor();
    m.threshold.value = -18;
    m.knee.value = 10;
    m.ratio.value = 4;
    m.attack.value = 5e-3;
    m.release.value = 0.25;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    m.connect(gain).connect(ctx.destination);
    masters.set(ctx, m);
  }
  return m;
}
function resumeOnGesture(ctx) {
  if (ctx.state !== "suspended" || typeof addEventListener !== "function") return;
  const go = () => {
    ctx.resume();
    for (const t of ["pointerdown", "keydown", "touchstart"]) removeEventListener(t, go, true);
  };
  for (const t of ["pointerdown", "keydown", "touchstart"]) addEventListener(t, go, true);
}
var warned = /* @__PURE__ */ new Set();
var warnOnce = (m) => {
  if (!warned.has(m)) {
    warned.add(m);
    console.warn(`[car/sound] ${m}`);
  }
};
function guessEngine(p) {
  if (p.mass >= 1900) return "c454";
  if (p.power >= 300 && p.redline >= 7500) return "f136";
  if (p.power >= 300) return "ls";
  if (p.power < 160 || p.redline >= 7600) return "vtec";
  return "m52";
}
var synthFor = (name) => name === "f1v12" || name === "lfa" ? "synth-v12" : ["f136", "c454", "ls", "harley"].includes(name) ? "synth-v8" : ["vtec", "ej25", "busa"].includes(name) ? "synth-inline4" : "synth-inline6";
function createCarSound(car, o = {}) {
  const known = (name) => !!name && (name in RECORDED_ENGINES || name in SYNTH);
  if (o.engine && !known(o.engine)) warnOnce(`unknown engine "${o.engine}"; engines: ${[...Object.keys(RECORDED_ENGINES), ...SYNTH_ENGINES].join(", ")}`);
  const opt = {
    engine: known(o.engine) ? o.engine : guessEngine(car.params),
    volume: o.volume ?? 1,
    engineVolume: o.engineVolume ?? 1,
    pops: o.pops ?? 0.6,
    turbo: o.turbo ?? 0,
    blowoff: o.blowoff ?? (o.turbo ? 0.5 : 0),
    valve: o.valve === "flutter" ? "flutter" : "blowoff",
    tyres: o.tyres ?? 1,
    crashes: o.crashes ?? 1
  };
  const sounds = (o.sounds || DEFAULT_SOUNDS).replace(/\/?$/, "/");
  const tyreUrl = o.tyreSounds === false ? null : o.tyreSounds || DEFAULT_TYRES;
  let listener = o.listener || null;
  let ctx = null, n = null, eng = null, muted = false, disposed = false;
  const st = { lastImpact: 0, v: null, p: [0, 0, 0], t: 0, crashAt: -1, thumpAt: -1 };
  const stats = { crashes: 0, thumps: 0 };
  let markReady;
  const ready = new Promise((r) => {
    markReady = r;
  });
  function build() {
    ctx = o.context || audioContext();
    if (!ctx) return false;
    resumeOnGesture(ctx);
    const out = ctx.createGain();
    out.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) out.connect(pan).connect(masterOf(ctx));
    else out.connect(masterOf(ctx));
    const engineBus = ctx.createGain();
    engineBus.connect(out);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const tyreBp = ctx.createBiquadFilter();
    tyreBp.type = "bandpass";
    tyreBp.frequency.value = 1150;
    tyreBp.Q.value = 4;
    const tyre = ctx.createGain();
    tyre.gain.value = 0;
    noise.connect(tyreBp).connect(tyre).connect(out);
    noise.start();
    const fx = createEngineFx(ctx, { pops: opt.pops, turbo: opt.turbo, blowoff: opt.blowoff });
    fx.output.connect(out);
    n = { out, pan, engineBus, noise, buf, tyre, tyreBp, fx, tyres: null };
    startEngine();
    startTyres();
    return true;
  }
  const GRAIN = 0.3, WINDOW = new Float32Array(64).map((_, i) => Math.sin(Math.PI * i / 63));
  function grainLayer(regions, bus) {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(bus);
    const layer = {
      level: 0,
      rate: 1,
      next: 0,
      set(level, rate, t) {
        layer.level = level;
        layer.rate = rate;
        out.gain.setTargetAtTime(level, t, 0.05);
      },
      schedule(t) {
        if (layer.level < 3e-3) {
          layer.next = t;
          return;
        }
        if (layer.next < t) layer.next = t;
        while (layer.next < t + 0.12) {
          const r = regions[Math.floor(Math.random() * regions.length)];
          const rate = layer.rate * (0.95 + Math.random() * 0.1);
          const span = GRAIN * rate;
          const at = r.start + Math.random() * Math.max(0, r.length - span);
          const src = ctx.createBufferSource(), g = ctx.createGain();
          src.buffer = r.buffer;
          src.playbackRate.value = rate;
          g.gain.value = 0;
          g.gain.setValueCurveAtTime(WINDOW, layer.next, GRAIN);
          src.connect(g).connect(out);
          src.start(layer.next, at, span + 0.01);
          src.stop(layer.next + GRAIN + 0.02);
          layer.next += GRAIN / 2;
        }
      },
      stop() {
        out.disconnect();
      }
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
        if (smp.kind === "chirp") {
          chirps.push({ buffer: buffers[i], start: smp.start + meta.pad, length: smp.length });
          return;
        }
        if (regions[smp.kind]) regions[smp.kind].push({ buffer: buffers[i], start: smp.start + meta.pad, length: smp.loop });
      });
      for (const k of ["spin", "lock"]) if (!regions[k].length) regions[k] = regions.slide;
      if (!regions.slide.length) return;
      const layers = { spin: grainLayer(regions.spin, bus), lock: grainLayer(regions.lock, bus) };
      const wheels = car.wheels.map((w) => {
        const wbus = ctx.createGain();
        const chatter = ctx.createGain();
        chatter.gain.value = 1;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 8 + Math.random() * 4;
        const depth = ctx.createGain();
        depth.gain.value = 0;
        lfo.connect(depth).connect(chatter.gain);
        lfo.start();
        const side = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (side) {
          side.pan.value = w.left ? -0.3 : 0.3;
          wbus.connect(chatter).connect(side).connect(bus);
        } else wbus.connect(chatter).connect(bus);
        const shelf = ctx.createBiquadFilter();
        shelf.type = "highshelf";
        shelf.frequency.value = 2500;
        shelf.gain.value = 5;
        shelf.connect(wbus);
        const scrubBp = ctx.createBiquadFilter();
        scrubBp.type = "bandpass";
        scrubBp.frequency.value = 600;
        scrubBp.Q.value = 1.1;
        const scrub = ctx.createGain();
        scrub.gain.value = 0;
        n.noise.connect(scrubBp).connect(scrub).connect(wbus);
        return {
          squeal: grainLayer(regions.slide, wbus),
          screech: grainLayer([...regions.lock, ...regions.slide], shelf),
          scrub,
          scrubBp,
          lfo,
          depth,
          /* its own pitch (±4%), a slow random walk of pitch and loudness, a burst on bumps, how long it's held */
          offset: 0.96 + Math.random() * 0.08,
          pw: 0,
          aw: 0,
          burst: 0,
          held: 0,
          quiet: 0,
          prevLoad: 0
        };
      });
      n.tyres = { bus, layers, wheels, chirps, lastChirp: -1, prev: 0, prevT: 0, lastT: ctx.currentTime };
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
    src.buffer = c.buffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    g.gain.value = 0.45 * strength * opt.tyres;
    src.connect(g).connect(n.tyres.bus);
    src.start(t, c.start, c.length);
    src.stop(t + c.length / 0.85 + 0.05);
  }
  function startEngine() {
    const name = opt.engine;
    if (name in SYNTH) {
      eng = synthEngine(SYNTH[name]);
      markReady(true);
      return;
    }
    const mine = { name, player: null, dispose() {
      if (this.player) this.player.dispose();
    }, update(e) {
      if (this.player) this.player.update(e);
    } };
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
  function synthEngine(spec) {
    const H = 96, re = new Float32Array(H + 1), im = new Float32Array(H + 1);
    let seed = spec.cylinders * 7919;
    const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    for (let k = 1; k <= H; k++) {
      const a = (k % spec.cylinders === 0 ? 1 : spec.uneven * (0.35 + rnd())) / Math.pow(k / spec.cylinders + 0.4, 1.05);
      const ph = rnd() * Math.PI * 2;
      re[k] = a * Math.cos(ph);
      im[k] = a * Math.sin(ph);
    }
    const wave = ctx.createPeriodicWave(re, im);
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    const osc2 = ctx.createOscillator();
    osc2.setPeriodicWave(wave);
    osc2.detune.value = 7;
    const drive = ctx.createGain(), g2 = ctx.createGain();
    g2.gain.value = 0.35;
    osc.connect(drive);
    osc2.connect(g2).connect(drive);
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(1.6 * (i / 1023.5 - 1));
    shaper.curve = curve;
    const reso = ctx.createBiquadFilter();
    reso.type = "peaking";
    reso.frequency.value = spec.resonance;
    reso.Q.value = 1.4;
    reso.gain.value = 7;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    drive.connect(shaper).connect(reso).connect(lp).connect(gain).connect(n.engineBus);
    osc.start();
    osc2.start();
    return {
      name: "synth",
      update(e) {
        const t = ctx.currentTime, x = Math.max(0, Math.min(1.1, e.rpm / e.redline)), thr = e.throttle;
        const f = Math.max(3, e.rpm / 120);
        osc.frequency.setTargetAtTime(f, t, 0.02);
        osc2.frequency.setTargetAtTime(f, t, 0.02);
        lp.frequency.setTargetAtTime((250 + 2200 * x * (0.35 + 0.65 * thr)) * spec.bright, t, 0.04);
        drive.gain.setTargetAtTime(0.8 + 2.2 * thr * (0.4 + x), t, 0.04);
        let g = 0.13 + 0.14 * thr + 0.07 * x;
        if (e.shifting) g *= 0.5;
        if (e.limiter) g *= Math.sin(t * 95) > 0 ? 1 : 0.35;
        gain.gain.setTargetAtTime(g, t, 0.025);
      },
      dispose() {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        setTimeout(() => {
          osc.stop();
          osc2.stop();
          gain.disconnect();
        }, 100);
      }
    };
  }
  function thump(strength) {
    stats.thumps++;
    const t = ctx.currentTime;
    const s = ctx.createOscillator(), g = ctx.createGain();
    s.frequency.setValueAtTime(90, t);
    s.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    g.gain.setValueAtTime(0.5 * strength, t);
    g.gain.exponentialRampToValueAtTime(1e-3, t + 0.3);
    s.connect(g).connect(n.out);
    s.start(t);
    s.stop(t + 0.32);
  }
  function crash(strength) {
    stats.crashes++;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = n.buf;
    src.playbackRate.value = 0.7 + Math.random() * 0.3;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + 900 * strength;
    bp.Q.value = 0.7;
    const g = ctx.createGain(), len = 0.18 + 0.35 * strength;
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(0.7 * strength + 1e-3, t + 5e-3);
    g.gain.exponentialRampToValueAtTime(1e-4, t + len);
    src.connect(bp).connect(g).connect(n.out);
    src.start(t, Math.random());
    src.stop(t + len + 0.02);
    for (const [f, a] of [[310, 1], [523, 0.7], [847, 0.5], [1290, 0.35]]) {
      const s = ctx.createOscillator();
      s.type = "square";
      s.frequency.value = f * (0.9 + Math.random() * 0.2);
      const sg = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2400;
      sg.gain.setValueAtTime(1e-4, t);
      sg.gain.exponentialRampToValueAtTime(0.06 * a * strength + 1e-4, t + 4e-3);
      sg.gain.exponentialRampToValueAtTime(1e-4, t + 0.12 + 0.2 * strength * a);
      s.connect(lp).connect(sg).connect(n.out);
      s.start(t);
      s.stop(t + 0.4);
    }
    thump(Math.min(1, 0.4 + strength));
  }
  const P = [0, 0, 0], R = [0, 0, 0];
  function update() {
    if (disposed) return;
    if (!n && !build()) return;
    const t = ctx.currentTime, e = car.engine;
    if (eng) eng.update(e);
    const fo = n.fx.options;
    fo.pops = opt.pops;
    fo.turbo = opt.turbo;
    fo.blowoff = opt.blowoff;
    fo.valve = opt.valve;
    n.engineBus.gain.setTargetAtTime(opt.engineVolume, t, 0.05);
    n.fx.update(e);
    const sp = Math.abs(car.speed) / 3.6, onGround = car.grounded / Math.max(1, car.wheels.length);
    const ty = n.tyres;
    if (ty) {
      const tdt = Math.min(0.1, Math.max(0, t - ty.lastT));
      ty.lastT = t;
      let slide = 0, spin = 0, lock = 0;
      for (const w of car.wheels) {
        if (!w.grounded) continue;
        slide = Math.max(slide, w.slide || 0);
        spin = Math.max(spin, w.spinSlip || 0);
        lock = Math.max(lock, w.lock || 0);
      }
      const vol = opt.tyres, speedUp = Math.min(1, sp / 40);
      const knee = (x, lo, hi) => {
        const u = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
        return u * u * (3 - 2 * u);
      };
      const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
      const audible = (st.level ?? 1) > 0.03;
      car.wheels.forEach((w, i) => {
        const v2 = ty.wheels[i];
        if (!v2) return;
        const s0 = w.grounded && audible ? w.slide || 0 : 0;
        const scrubL = knee(s0, 0.08, 0.35) * (1 - 0.55 * knee(s0, 0.5, 0.9));
        const squealL = knee(s0, 0.25, 0.65) * (1 - 0.45 * knee(s0, 0.75, 1));
        const screechL = knee(s0, 0.65, 1);
        v2.pw += -v2.pw * tdt / 0.7 + gauss() * Math.sqrt(tdt) * 0.035;
        v2.aw += -v2.aw * tdt / 0.5 + gauss() * Math.sqrt(tdt) * 0.18;
        v2.pw = Math.max(-0.05, Math.min(0.05, v2.pw));
        v2.aw = Math.max(-0.25, Math.min(0.25, v2.aw));
        const load = w.load || 0;
        if (s0 > 0.3 && v2.prevLoad > 0 && Math.abs(load - v2.prevLoad) / v2.prevLoad > 0.25) v2.burst = 1;
        v2.prevLoad = load;
        v2.burst = Math.max(0, v2.burst - tdt / 0.18);
        if (s0 > 0.3) {
          v2.held += tdt;
          v2.quiet = 0;
        } else if (s0 < 0.15) {
          v2.quiet += tdt;
          if (v2.quiet > 0.35) v2.held = 0;
        }
        const settle = 0.7 + 0.3 * Math.exp(-v2.held / 1.2);
        const amp = 0.4 * vol * settle * (1 + v2.aw) * (1 + 0.45 * v2.burst);
        const rate = v2.offset * (1 + v2.pw) * (1 + 0.03 * v2.burst) * (0.92 + 0.14 * s0 + 0.08 * speedUp);
        v2.squeal.set(amp * squealL, rate, t);
        v2.screech.set(amp * screechL * 0.85, rate * 1.05, t);
        v2.scrub.gain.setTargetAtTime(amp * scrubL * 0.5, t, 0.05);
        v2.scrubBp.frequency.setTargetAtTime(450 + 600 * s0 + 4 * sp, t, 0.1);
        v2.depth.gain.setTargetAtTime(s0 > 0.1 ? 0.1 + 0.12 * s0 : 0, t, 0.1);
        v2.lfo.frequency.setTargetAtTime(8 + 6 * s0 + 0.08 * sp, t, 0.2);
        v2.squeal.schedule(t);
        v2.screech.schedule(t);
      });
      const spinHeard = audible ? knee(spin, 0.35, 0.95) * Math.max(0, 1 - sp / 14) : 0;
      const lockHeard = audible ? knee(lock, 0.2, 0.7) : 0;
      ty.layers.spin.set(0.5 * vol * spinHeard, 0.85 + 0.25 * spin + 0.1 * speedUp, t);
      ty.layers.lock.set(0.55 * vol * lockHeard, 0.95 + 0.08 * speedUp, t);
      for (const k in ty.layers) ty.layers[k].schedule(t);
      const now = Math.max(slide, lock);
      if (ty.chirps.length && now > 0.6 && ty.prev < 0.2 && t - ty.prevT < 0.2 && t - ty.lastChirp > 1.5) {
        chirp(Math.min(1, now));
        ty.lastChirp = t;
      }
      if (now < 0.2) {
        ty.prev = now;
        ty.prevT = t;
      }
    } else {
      const skid = car.skid * Math.min(1, sp / 4) * (onGround > 0 ? 1 : 0) * opt.tyres;
      n.tyre.gain.setTargetAtTime(Math.min(0.4, skid * 0.4), t, 0.05);
      n.tyreBp.frequency.setTargetAtTime(950 + skid * 500, t, 0.1);
    }
    if (car.impact > st.lastImpact + 0.2 && t - st.thumpAt > 0.15) {
      thump(Math.min(1, car.impact));
      st.thumpAt = t;
    }
    st.lastImpact = car.impact;
    const v = car.body.motionProperties.linearVelocity, bp = car.body.position;
    if (st.v) {
      const dt = Math.max(1e-3, t - st.t);
      const dv = Math.hypot(v[0] - st.v[0], v[2] - st.v[2]);
      const jumped = Math.hypot(bp[0] - st.p[0], bp[2] - st.p[2]) > Math.hypot(st.v[0], st.v[2]) * Math.max(dt, 1 / 30) * 2 + 1.5;
      if (opt.crashes > 0 && !jumped && dv > 2.5 && dv / Math.max(dt, 1 / 60) > 35 && t - st.crashAt > 0.3) {
        crash(Math.min(1, (dv - 1.5) / 12) * opt.crashes);
        st.crashAt = t;
      }
    }
    st.v = [v[0], v[1], v[2]];
    st.p = [bp[0], bp[1], bp[2]];
    st.t = t;
    let level = opt.volume;
    if (listener && listener.matrixWorld) {
      const m = listener.matrixWorld.elements, p = car.object.position;
      P[0] = p.x - m[12];
      P[1] = p.y - m[13];
      P[2] = p.z - m[14];
      const dist = Math.hypot(P[0], P[1], P[2]);
      level *= Math.min(1, 12 / Math.max(12, dist));
      R[0] = m[0];
      R[1] = m[1];
      R[2] = m[2];
      if (n.pan) n.pan.pan.setTargetAtTime(dist > 1 ? 0.8 * (P[0] * R[0] + P[1] * R[1] + P[2] * R[2]) / dist : 0, t, 0.05);
    }
    n.out.gain.setTargetAtTime(muted ? 0 : level, t, 0.05);
    st.level = muted ? 0 : level;
  }
  return {
    update,
    /** start now (from a key or click handler); otherwise it starts on the first key or tap by itself */
    start() {
      if (!n) build();
      if (ctx && ctx.state === "suspended") ctx.resume();
    },
    /** true once the recorded engine plays (false: it could not load and the synthesised one plays) */
    ready,
    /** the options in use; change them live: volume, engineVolume, pops, turbo, blowoff, valve, tyres, crashes (engine: setEngine) */
    options: opt,
    /** switch the engine: a recorded one ("f136", "m52", …) or a synthesised one ("synth-v8", …) */
    setEngine(name) {
      if (!known(name)) {
        warnOnce(`unknown engine "${name}"`);
        return;
      }
      if (name === opt.engine) return;
      opt.engine = name;
      if (n) {
        eng.dispose();
        startEngine();
      }
    },
    /** where the player hears from (the camera): cars further away are quieter and panned */
    setListener(obj) {
      listener = obj || null;
    },
    get muted() {
      return muted;
    },
    set muted(m) {
      muted = !!m;
    },
    /** the audio context (made on first use) */
    get context() {
      return ctx;
    },
    /** this car's sound (a GainNode, after the first update): connect it to an analyser or recorder too */
    get output() {
      return n ? n.out : null;
    },
    /** how many crash and thump sounds have played */
    stats,
    /** 0..1 turbo boost (with turbo on) */
    get boost() {
      return n ? n.fx.boost : 0;
    },
    /** stop and free everything (call with car.remove()) */
    dispose() {
      disposed = true;
      if (!n) return;
      const old = n;
      if (eng) eng.dispose();
      old.out.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      setTimeout(() => {
        old.noise.stop();
        old.fx.dispose();
        old.out.disconnect();
        if (old.tyres) {
          for (const k in old.tyres.layers) old.tyres.layers[k].stop();
          for (const v of old.tyres.wheels) {
            v.squeal.stop();
            v.screech.stop();
            v.lfo.stop();
            v.scrub.disconnect();
          }
        }
      }, 120);
      n = null;
    }
  };
}
export {
  RECORDED_ENGINES,
  SYNTH_ENGINES,
  createCarSound
};
