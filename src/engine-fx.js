/* Exhaust pops & bangs and turbo sounds, made live with Web Audio (no files). Optional, like engine-sound.js.

     import { createEngineFx } from 'car/engine-fx';
     const fx = createEngineFx(audioContext, { pops: 1, turbo: 0.6, blowoff: 0.6, valve: 'blowoff' });
     fx.output.connect(audioContext.destination);
     // every frame:
     fx.update(car.engine);            // { rpm, redline, throttle, shifting, limiter } from CAR.create()
     fx.boost                          // 0..1 turbo boost (for a gauge)

   Pops & bangs: unburnt fuel lighting in a hot exhaust. When you lift off at high revs the exhaust crackles for
   ~1.5 s (random pops, fading); a gear change at full throttle (ignition cut) gives a sharp bang; the rev limiter
   crackles. Each pop = a low exhaust thump + a band-passed noise burst + a short high crack, through a small
   generated "exhaust pipe" echo.
   Turbo: boost builds with lag once the revs and throttle are up and falls when you lift; the shaft whines (pitch
   with shaft speed; no intake hiss, it only cluttered the engine). Mixed to sit UNDER the engine: the valve
   only vents after real boost has been held (> 60% for 0.6 s) and at most once every 3 s — a blow-off on every
   lift is tiring. 'blowoff' (a short falling psssh) or 'flutter' (compressor surge, stu-tu-tu). Sounds only: they
   don't change the physics. */

/**
 * @param {BaseAudioContext} ctx
 * @param {{ pops?: number, turbo?: number, blowoff?: number, valve?: 'blowoff' | 'flutter', volume?: number }} [o]
 *   loudness 0..1 each (0 = off): pops (default 1), turbo = the whine (0.6), blowoff = the valve (0.6, kept quiet) ·
 *   valve (default 'blowoff') · volume: everything (1). Change live through fx.options.
 */
export function createEngineFx(ctx, o = {}) {
  const opt = { pops: 1, turbo: 0.6, blowoff: 0.6, valve: 'blowoff', volume: 1, ...o };
  const output = ctx.createGain();
  output.gain.value = opt.volume;

  /* ---------------------------------------------------------------- shared noise + a short exhaust "pipe" echo */
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 0.22), ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const t = i / ctx.sampleRate;
      /* early reflections every ~9 ms (a pipe) under a fast decay */
      const comb = 0.6 + 0.4 * Math.cos((2 * Math.PI * t) / 0.009);
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 26) * comb;
    }
    d[0] = 1;
  }
  const popBus = ctx.createGain();
  const pipe = ctx.createConvolver();
  pipe.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.35;
  const grit = ctx.createWaveShaper();
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) { const x = (i / 1023.5) - 1; curve[i] = Math.tanh(3 * x) / Math.tanh(3); }
  grit.curve = curve;
  popBus.connect(grit);
  grit.connect(output);
  grit.connect(pipe).connect(wet).connect(output);

  function noiseSource(offset) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.loopStart = 0; s.loopEnd = noise.duration;
    return { s, offset: offset ?? Math.random() * (noise.duration - 0.5) };
  }

  /** one pop at time t; size 0..1 (1 = a bang) */
  function pop(t, size) {
    const vol = opt.pops * (0.25 + 0.75 * size);
    /* body: band-passed noise, 25–90 ms */
    const { s, offset } = noiseSource();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 350 + Math.random() * 900 + size * 300; bp.Q.value = 0.9;
    const g = ctx.createGain();
    const len = 0.025 + size * 0.065 + Math.random() * 0.02;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * vol, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    s.connect(bp).connect(g).connect(popBus);
    s.start(t, offset); s.stop(t + len + 0.02);
    /* thump: a falling low sine */
    const th = ctx.createOscillator(), tg = ctx.createGain();
    th.type = 'sine';
    th.frequency.setValueAtTime(95 + Math.random() * 40, t);
    th.frequency.exponentialRampToValueAtTime(42, t + 0.09 + size * 0.06);
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(0.8 * vol * (0.4 + size), t + 0.002);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.1 + size * 0.08);
    th.connect(tg).connect(popBus);
    th.start(t); th.stop(t + 0.2 + size * 0.1);
    /* crack: a few ms of bright noise */
    const c = noiseSource();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.6 * vol, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.012 + size * 0.01);
    c.s.connect(hp).connect(cg).connect(popBus);
    c.s.start(t, c.offset); c.s.stop(t + 0.04);
    stats.pops++;
  }

  /* ---------------------------------------------------------------- turbo: whine (always running) */
  const tBus = ctx.createGain();
  /* the turbo sits under the engine: nothing above ~5 kHz */
  const tLp = ctx.createBiquadFilter(); tLp.type = 'lowpass'; tLp.frequency.value = 5000; tLp.Q.value = 0.5;
  tBus.connect(tLp).connect(output);
  const whine = ctx.createOscillator(); whine.type = 'sine';
  const whine2 = ctx.createOscillator(); whine2.type = 'triangle';
  const whineGain = ctx.createGain(); whineGain.gain.value = 0;
  const whine2Gain = ctx.createGain(); whine2Gain.gain.value = 0.35;
  whine.connect(whineGain); whine2.connect(whine2Gain).connect(whineGain);
  whineGain.connect(tBus);
  whine.start(); whine2.start();

  function valve(t, amount) {
    const { s, offset } = noiseSource();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    const g = ctx.createGain();
    const vol = 0.08 * opt.blowoff * amount * amount;
    if (opt.valve === 'flutter') {
      /* compressor surge: ~20 chops a second, fading */
      const len = 0.25 + amount * 0.3;
      bp.frequency.setValueAtTime(1000, t);
      bp.frequency.exponentialRampToValueAtTime(500, t + len);
      g.gain.setValueAtTime(0, t);
      const rate = 19 + Math.random() * 5;
      for (let k = 0; k < len * rate; k++) {
        const tk = t + k / rate, a = vol * Math.exp(-k / (len * rate) * 2.2);
        g.gain.setValueAtTime(0.0001, tk);
        g.gain.linearRampToValueAtTime(a, tk + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, tk + 0.8 / rate);
      }
      s.connect(bp).connect(g).connect(tBus);
      s.start(t, offset); s.stop(t + len + 0.1);
    } else {
      /* blow-off: a short psssh falling in pitch, with a soft start (a hard edge is what interrupts) */
      const len = 0.25 + amount * 0.3;
      bp.frequency.setValueAtTime(1900, t);
      bp.frequency.exponentialRampToValueAtTime(550, t + len);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.035);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      s.connect(bp).connect(g).connect(tBus);
      s.start(t, offset); s.stop(t + len + 0.05);
    }
    stats.valves++;
  }

  /* ---------------------------------------------------------------- state */
  const stats = { pops: 0, valves: 0 };
  const st = { boost: 0, shaft: 0, held: 0, lastValve: -99, overrun: 0, nextPop: 0, lastThrottle: 0, peakThrottle: 0, wasShifting: false, lastLimiter: 0, last: ctx.currentTime };

  /** every frame: { rpm, redline, throttle 0..1, shifting, limiter } (car.engine) */
  function update(e) {
    const now = ctx.currentTime, dt = Math.min(0.1, Math.max(0, now - st.last));
    st.last = now;
    const x = Math.max(0, Math.min(1.1, e.rpm / e.redline)), thr = Math.max(0, Math.min(1, e.throttle || 0));

    /* ---- turbo: boost target from throttle and revs; builds with lag, dumps when you lift */
    if (opt.turbo > 0 || opt.blowoff > 0) {
      const target = thr ** 1.5 * Math.max(0, Math.min(1, (x - 0.22) / 0.35)) * (e.shifting ? 0.6 : 1);
      const up = target > st.boost;
      st.boost += (target - st.boost) * Math.min(1, dt * (up ? 1.6 : 5));
      /* the shaft keeps spinning a little after the boost is gone */
      st.shaft += (Math.max(st.boost, x * 0.3 * thr) - st.shaft) * Math.min(1, dt * (up ? 1.4 : 0.9));
      /* how long real boost has been held */
      st.held = st.boost > 0.6 ? st.held + dt : Math.max(0, st.held - dt * 2);
      /* the throttle closing past 30% after real boost (car.engine.throttle eases, so detect the crossing); at most
         once every 3 s */
      if (thr < 0.3 && st.lastThrottle >= 0.3) {
        if (st.boost > 0.55 && st.held > 0.6 && now - st.lastValve > 3 && opt.blowoff > 0) { valve(now + 0.01, st.boost); st.lastValve = now; }
        st.boost *= 0.3;
        st.held = 0;
      }
      whine.frequency.setTargetAtTime(1500 + 5000 * st.shaft, now, 0.05);
      whine2.frequency.setTargetAtTime((1500 + 5000 * st.shaft) * 2.01, now, 0.05);
      whineGain.gain.setTargetAtTime(opt.turbo * (0.002 + 0.012 * st.shaft * st.shaft), now, 0.08);
    } else {
      st.boost = 0; st.shaft = 0;
      whineGain.gain.setTargetAtTime(0, now, 0.05);
    }

    /* ---- pops & bangs */
    if (opt.pops > 0) {
      st.peakThrottle = Math.max(thr, st.peakThrottle - dt * 0.8);
      /* lifting at high revs after pulling hard → overrun crackle for ~1.5 s */
      if (thr < 0.1 && st.lastThrottle >= 0.1 && x > 0.4 && st.peakThrottle > 0.5) st.overrun = 1;
      if (thr > 0.2 || x < 0.28) st.overrun = 0;
      st.overrun = Math.max(0, st.overrun - dt / 1.6);
      if (st.overrun > 0 && now >= st.nextPop) {
        const k = st.overrun;
        pop(now + Math.random() * 0.01, Math.random() < 0.12 * k ? 0.8 : 0.15 + 0.35 * Math.random() * k);
        st.nextPop = now + (0.03 + Math.random() * 0.14) / (0.4 + k);
      }
      /* a gear change at full throttle: one or two sharp bangs */
      if (e.shifting && !st.wasShifting && thr > 0.7 && x > 0.5) {
        pop(now + 0.01, 1);
        if (Math.random() < 0.5) pop(now + 0.06 + Math.random() * 0.04, 0.6);
      }
      /* rev limiter crackle */
      if (e.limiter && now - st.lastLimiter > 0.06 + Math.random() * 0.08) { pop(now + 0.005, 0.35 + Math.random() * 0.3); st.lastLimiter = now; }
    }
    st.wasShifting = !!e.shifting;
    st.lastThrottle = thr;
  }

  return {
    output, update, options: opt, stats,
    /** 0..1 turbo boost now (≈ 0–1 bar) */
    get boost() { return st.boost; },
    dispose() { whine.stop(); whine2.stop(); output.disconnect(); },
  };
}
