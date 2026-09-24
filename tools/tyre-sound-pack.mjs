#!/usr/bin/env node
/* Cut tyre recordings into the tyre sound pack car/sound plays:
     node tools/tyre-sound-pack.mjs <cuts.json> <out dir>
   cuts.json: { "name": "tyres", "cuts": [{ "file": "a.wav", "from": 12.57, "to": 13.68, "kind": "slide" }, ...] }
   (file relative to cuts.json; times in seconds; kind: "slide" (cornering / drift squeal), "spin" (wheelspin),
   "lock" (locked wheels), or "chirp" (a short one-shot, played as it is)).
   Loops: the cut becomes a seamless loop (its head crossfaded with what follows its end), levelled to the same
   loudness as the others, and stored like the engine packs: every sound in ONE mp3 (<name>.mp3), each in a segment
   of PAD + loop + PAD whose pads continue the loop, offsets in <name>.json. Needs ffmpeg (libmp3lame). */
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const [spec, outDir] = process.argv.slice(2);
if (!spec || !outDir) { console.error('usage: node tools/tyre-sound-pack.mjs <cuts.json> <out dir>'); process.exit(2); }
const RATE = 44100, PAD = 0.1, FADE = 0.12, TARGET_RMS = 0.12;
const cfg = JSON.parse(readFileSync(spec, 'utf8'));
const base = dirname(resolve(spec));
const decoded = new Map();
function decode(file) {
  if (!decoded.has(file)) {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', join(base, file), '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
    decoded.set(file, new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4));
  }
  return decoded.get(file);
}
function writeWav(file, pcm) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2);
  writeFileSync(file, b);
}
const rmsOf = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

const parts = [], samples = [];
let at = 0;
const P = Math.round(PAD * RATE);
for (const c of cfg.cuts) {
  const x = decode(c.file);
  const a = Math.round(c.from * RATE), e = Math.round(c.to * RATE);
  let seg;
  if (c.kind === 'chirp') {
    /* a one-shot: short fades so it starts and ends cleanly */
    const L = e - a, f = Math.round(0.01 * RATE);
    const shot = new Float32Array(L);
    for (let i = 0; i < L; i++) shot[i] = x[a + i] * Math.min(1, i / f, (L - 1 - i) / f);
    let pk = 0;
    for (const v of shot) pk = Math.max(pk, Math.abs(v));
    for (let i = 0; i < L; i++) shot[i] *= 0.7 / Math.max(1e-6, pk);
    seg = new Float32Array(P + L + P);
    seg.set(shot, P);
    samples.push({ kind: c.kind, start: +(at / RATE).toFixed(6), length: +(L / RATE).toFixed(6), source: c.label || undefined });
  } else {
    /* a loop: [a, e - X) with its head crossfaded from what follows its end */
    const X = Math.round(FADE * RATE), L = e - a - X;
    if (L < 0.3 * RATE) throw new Error(`cut ${c.file} ${c.from}-${c.to}: too short for a loop (needs ${(0.3 + FADE).toFixed(2)} s)`);
    const loop = new Float32Array(L);
    for (let i = 0; i < L; i++) loop[i] = x[a + i];
    for (let i = 0; i < X; i++) { const w = Math.sin((i / X) * Math.PI / 2) ** 2; loop[i] = x[a + i] * w + x[a + L + i] * (1 - w); }
    const g = TARGET_RMS / Math.max(1e-6, rmsOf(loop));
    for (let i = 0; i < L; i++) loop[i] *= g;
    seg = new Float32Array(P + L + P);
    for (let i = 0; i < seg.length; i++) seg[i] = loop[((i - P) % L + L) % L];
    samples.push({ kind: c.kind, start: +(at / RATE).toFixed(6), loop: +(L / RATE).toFixed(6), source: c.label || undefined });
  }
  parts.push(seg);
  at += seg.length;
}
let peak = 0;
for (const s of parts) for (const v of s) peak = Math.max(peak, Math.abs(v));
const all = new Float32Array(at);
let o = 0;
for (const s of parts) { all.set(s, o); o += s.length; }
if (peak > 0.97) for (let i = 0; i < all.length; i++) all[i] *= 0.97 / peak;
mkdirSync(outDir, { recursive: true });
const name = cfg.name || 'tyres';
const wav = join(outDir, `${name}.wav`), mp3 = join(outDir, `${name}.mp3`);
writeWav(wav, all);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '112k', '-ac', '1', mp3]);
rmSync(wav);
const pack = { name, kind: 'tyres', file: `${name}.mp3`, pad: PAD, seconds: +(at / RATE).toFixed(2), credits: cfg.credits || '', samples };
writeFileSync(join(outDir, `${name}.json`), JSON.stringify(pack, null, 1) + '\n');
const count = (k) => samples.filter((s) => s.kind === k).length;
console.log(`${name}: ${samples.length} sounds (slide ${count('slide')}, spin ${count('spin')}, lock ${count('lock')}, chirp ${count('chirp')}), ${(statSync(mp3).size / 1024).toFixed(0)} KB, ${pack.seconds} s`);
