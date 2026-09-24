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
export {
  createEngineFx
};
