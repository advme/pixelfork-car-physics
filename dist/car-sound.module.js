/* Pixelfork Car Physics v0.9.0 · needs three@0.186.0 and crashcat@0.0.5 from the import map · © 2026 Pixelfork, see LICENSE */

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
  const whine = ctx.createOscillator();
  whine.type = "sine";
  const whine2 = ctx.createOscillator();
  whine2.type = "triangle";
  const whineGain = ctx.createGain();
  whineGain.gain.value = 0;
  const whine2Gain = ctx.createGain();
  whine2Gain.gain.value = 0.35;
  whine.connect(whineGain);
  whine2.connect(whine2Gain).connect(whineGain);
  whineGain.connect(tBus);
  whine.start();
  whine2.start();
  const hiss = noiseSource(0);
  const hissHp = ctx.createBiquadFilter();
  hissHp.type = "highpass";
  hissHp.frequency.value = 600;
  const hissBp = ctx.createBiquadFilter();
  hissBp.type = "lowpass";
  hissBp.frequency.value = 1800;
  hissBp.Q.value = 0.3;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0;
  hiss.s.connect(hissHp).connect(hissBp).connect(hissGain).connect(tBus);
  hiss.s.start(0, 0);
  function valve(t, amount) {
    const { s, offset } = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    const vol = 0.2 * opt.blowoff * amount * amount;
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
      whine.frequency.setTargetAtTime(1500 + 5e3 * st.shaft, now, 0.05);
      whine2.frequency.setTargetAtTime((1500 + 5e3 * st.shaft) * 2.01, now, 0.05);
      whineGain.gain.setTargetAtTime(opt.turbo * (2e-3 + 0.012 * st.shaft * st.shaft), now, 0.08);
      hissGain.gain.setTargetAtTime(opt.turbo * 0.035 * st.boost * st.boost * thr, now, 0.12);
    } else {
      st.boost = 0;
      st.shaft = 0;
      whineGain.gain.setTargetAtTime(0, now, 0.05);
      hissGain.gain.setTargetAtTime(0, now, 0.05);
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
      whine.stop();
      whine2.stop();
      hiss.s.stop();
      output.disconnect();
    }
  };
}

// src/sound.js
var ENGINES = {
  inline4: { cylinders: 4, uneven: 0.16, resonance: 260, bright: 1.1 },
  inline6: { cylinders: 6, uneven: 0.07, resonance: 230, bright: 1 },
  v8: { cylinders: 8, uneven: 0.42, resonance: 150, bright: 0.8 },
  v12: { cylinders: 12, uneven: 0.05, resonance: 320, bright: 1.25 }
};
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
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 5e-3;
    comp.release.value = 0.25;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    comp.connect(gain).connect(ctx.destination);
    m = comp;
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
function guessEngine(p) {
  if (p.power >= 400 && p.redline >= 8500) return "v12";
  if (p.power >= 300 || p.mass >= 1900) return "v8";
  if (p.power < 160 || p.redline >= 7600) return "inline4";
  return "inline6";
}
function createCarSound(car, o = {}) {
  const opt = {
    engine: o.engine && ENGINES[o.engine] ? o.engine : guessEngine(car.params),
    volume: o.volume ?? 1,
    pops: o.pops ?? 0.5,
    turbo: o.turbo ?? 0,
    blowoff: o.blowoff ?? (o.turbo ? 0.5 : 0),
    tyres: o.tyres ?? 1,
    crashes: o.crashes ?? 1
  };
  let listener = o.listener || null;
  let ctx = null, n = null, muted = false, disposed = false;
  const st = { lastImpact: 0, v: null, p: [0, 0, 0], t: 0, crashAt: -1, thumpAt: -1, vib: 0 };
  const stats = { crashes: 0, thumps: 0 };
  function build() {
    ctx = o.context || audioContext();
    if (!ctx) return false;
    resumeOnGesture(ctx);
    const out = ctx.createGain();
    out.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) out.connect(pan).connect(masterOf(ctx));
    else out.connect(masterOf(ctx));
    const spec = ENGINES[opt.engine];
    const H = 96, re = new Float32Array(H + 1), im = new Float32Array(H + 1);
    let seed = spec.cylinders * 7919;
    const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    for (let k = 1; k <= H; k++) {
      const firing = k % spec.cylinders === 0;
      const a = (firing ? 1 : spec.uneven * (0.35 + rnd())) / Math.pow(k / spec.cylinders + 0.4, 1.05);
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
    const drive = ctx.createGain();
    drive.gain.value = 1;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    osc.connect(drive);
    osc2.connect(g2).connect(drive);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = i / 1023.5 - 1;
      curve[i] = Math.tanh(1.6 * x);
    }
    shaper.curve = curve;
    const reso = ctx.createBiquadFilter();
    reso.type = "peaking";
    reso.frequency.value = spec.resonance;
    reso.Q.value = 1.4;
    reso.gain.value = 7;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.9;
    const engine = ctx.createGain();
    engine.gain.value = 0;
    drive.connect(shaper).connect(reso).connect(lp).connect(engine).connect(out);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const combBp = ctx.createBiquadFilter();
    combBp.type = "bandpass";
    combBp.Q.value = 0.8;
    const comb = ctx.createGain();
    comb.gain.value = 0;
    const combAm = ctx.createGain();
    combAm.gain.value = 0;
    osc.connect(combAm).connect(comb.gain);
    noise.connect(combBp).connect(comb).connect(lp);
    const tyre = ctx.createGain();
    tyre.gain.value = 0;
    const sq1 = ctx.createOscillator();
    sq1.type = "triangle";
    sq1.frequency.value = 820;
    const sq2 = ctx.createOscillator();
    sq2.type = "triangle";
    sq2.frequency.value = 1130;
    const sqG = ctx.createGain();
    sqG.gain.value = 0.18;
    sq1.connect(sqG);
    sq2.connect(sqG);
    sqG.connect(tyre);
    const tyreBp = ctx.createBiquadFilter();
    tyreBp.type = "bandpass";
    tyreBp.frequency.value = 1300;
    tyreBp.Q.value = 6;
    noise.connect(tyreBp).connect(tyre);
    tyre.connect(out);
    const roadLp = ctx.createBiquadFilter();
    roadLp.type = "lowpass";
    roadLp.frequency.value = 200;
    const road = ctx.createGain();
    road.gain.value = 0;
    noise.connect(roadLp).connect(road).connect(out);
    const windBp = ctx.createBiquadFilter();
    windBp.type = "bandpass";
    windBp.frequency.value = 500;
    windBp.Q.value = 0.6;
    const wind = ctx.createGain();
    wind.gain.value = 0;
    noise.connect(windBp).connect(wind).connect(out);
    const fx = createEngineFx(ctx, { pops: opt.pops, turbo: opt.turbo, blowoff: opt.blowoff, volume: 0.8 });
    fx.output.connect(out);
    const t = ctx.currentTime;
    for (const s of [osc, osc2, noise, sq1, sq2]) s.start(t);
    n = { out, pan, osc, osc2, drive, lp, engine, comb, combAm, combBp, tyre, tyreBp, sq1, sq2, road, roadLp, wind, windBp, fx, sources: [osc, osc2, noise, sq1, sq2], buf };
    return true;
  }
  function thump(strength) {
    stats.thumps++;
    const t = ctx.currentTime;
    const s = ctx.createOscillator(), g = ctx.createGain();
    s.frequency.setValueAtTime(95, t);
    s.frequency.exponentialRampToValueAtTime(40, t + 0.22);
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(0.6 * strength + 1e-3, t + 8e-3);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.28);
    s.connect(g).connect(n.out);
    s.start(t);
    s.stop(t + 0.3);
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
    const g = ctx.createGain();
    const len = 0.18 + 0.35 * strength;
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
    const x = Math.max(0, Math.min(1.1, e.rpm / e.redline)), thr = e.throttle;
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
    fo.pops = opt.pops;
    fo.turbo = opt.turbo;
    fo.blowoff = opt.blowoff;
    n.fx.update(e);
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
    if (car.impact > st.lastImpact + 0.2 && t - st.thumpAt > 0.15) {
      thump(Math.min(1, car.impact));
      st.thumpAt = t;
    }
    st.lastImpact = car.impact;
    const v = car.body.motionProperties.linearVelocity, bp = car.body.position;
    if (st.v) {
      const dt = Math.max(1e-3, t - st.t);
      const dv = Math.hypot(v[0] - st.v[0], v[2] - st.v[2]);
      const a = dv / Math.max(dt, 1 / 60);
      const jumped = Math.hypot(bp[0] - st.p[0], bp[2] - st.p[2]) > Math.hypot(st.v[0], st.v[2]) * Math.max(dt, 1 / 30) * 2 + 1.5;
      if (opt.crashes > 0 && !jumped && dv > 2.5 && a > 35 && t - st.crashAt > 0.3) {
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
  }
  return {
    update,
    /** start now (from a key or click handler); otherwise it starts on the first key or tap by itself */
    start() {
      if (!n) build();
      if (ctx && ctx.state === "suspended") ctx.resume();
    },
    /** the options in use; change them live: engine, volume, pops, turbo, blowoff, tyres, crashes */
    options: opt,
    /** switch the engine character: "inline4" | "inline6" | "v8" | "v12" */
    setEngine(name) {
      if (!ENGINES[name] || name === opt.engine) return;
      opt.engine = name;
      if (n) {
        stopAll();
        n = null;
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
      if (n) stopAll();
      n = null;
    }
  };
  function stopAll() {
    const t = ctx.currentTime;
    n.out.gain.setTargetAtTime(0, t, 0.02);
    const old = n;
    setTimeout(() => {
      for (const s of old.sources) {
        try {
          s.stop();
        } catch {
        }
      }
      old.fx.dispose();
      old.out.disconnect();
    }, 120);
  }
}
export {
  ENGINES,
  createCarSound
};
