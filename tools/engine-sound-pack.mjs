#!/usr/bin/env node
/* Turn engine-render recordings into a sound pack the game plays (src/engine-sound.js):
     node tools/engine-sound-pack.mjs <render dir> <out dir> [name …]
   For each engine: every recording becomes a seamless loop of a whole number of engine cycles (4-stroke: one
   cycle = 2 turns = 120 / rpm s), about 1.2 s long, crossfaded at the seam. All loops of an engine go into ONE mp3
   (<name>.mp3, one download) next to <name>.json, which says where each loop starts. Each loop sits in a segment of
   PAD + loop + PAD whose pads continue the loop (the audio is periodic across the whole segment), so the player can
   loop [start + PAD, start + PAD + loop] even if the mp3 decoder shifts everything by a few ms. One gain per engine
   (loudest peak → 0.9) keeps the real loud / quiet differences between recordings. Needs ffmpeg (libmp3lame). */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const [renderDir, outDir, ...only] = process.argv.slice(2);
if (!renderDir || !outDir) { console.error('usage: node tools/engine-sound-pack.mjs <render dir> <out dir> [name …]'); process.exit(2); }
const TITLES = {
  f136: 'Ferrari F136 V8', m52: 'BMW M52B28 straight-6', vtec: 'Honda B18C5 VTEC 4-cylinder', c454: 'Chevrolet 454 V8 (truck)',
  '2jz': 'Toyota 2JZ straight-6', ls: 'GM LS V8', lfa: 'Lexus LFA 1LR-GUE V10', ej25: 'Subaru EJ25 boxer-4 (unequal headers)',
  i5: 'Audi 2.3 inline-5', v6: '60° V6', f1v12: 'Ferrari 412 T2 V12 (F1)', busa: 'Suzuki Hayabusa inline-4 (bike)',
  harley: 'Harley-Davidson Shovelhead V-twin (bike)',
};
const LOOP = 1.2, FADE = 0.06, PAD = 0.1;

function readWav(file) {
  const b = readFileSync(file);
  let p = 12, rate = 44100, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(p + 12);
    if (id === 'data') data = b.subarray(p + 8, p + 8 + len);
    p += 8 + len + (len & 1);
  }
  const pcm = new Float32Array(data.length / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = data.readInt16LE(i * 2) / 32768;
  return { rate, pcm };
}
function writeWav(file, pcm, rate) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2);
  writeFileSync(file, b);
}

const metas = readdirSync(renderDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(renderDir, f), 'utf8')))
  .filter((m) => !only.length || only.includes(m.name));
mkdirSync(outDir, { recursive: true });
for (const m of metas) {
  for (const old of [join(outDir, m.name)]) if (existsSync(old)) rmSync(old, { recursive: true });
  const takes = m.samples.map((s) => ({ ...s, ...readWav(join(renderDir, s.file)) }));
  const rate = takes[0].rate;
  if (takes.some((t) => t.rate !== rate)) throw new Error(`${m.name}: recordings at different sample rates`);
  const peak = Math.max(...takes.map((t) => t.pcm.reduce((a, v) => Math.max(a, Math.abs(v)), 0)));
  const gain = 0.9 / peak;
  const P = Math.round(PAD * rate);
  const out = [], parts = [];
  let at = 0;
  for (const t of takes) {
    const cycle = 120 / t.rpm;
    const cycles = Math.max(1, Math.round(LOOP / cycle));
    const L = Math.round(cycles * cycle * t.rate), X = Math.round(FADE * t.rate);
    /* take the loop from the middle of the recording (the start still carries the step from the last rpm) */
    const a = Math.max(0, Math.floor((t.pcm.length - L - X) / 2));
    const loop = new Float32Array(L);
    for (let i = 0; i < L; i++) loop[i] = t.pcm[a + i] * gain;
    /* crossfade the seam: the head fades in from what follows the loop's end */
    for (let i = 0; i < X; i++) {
      const w = i / X;
      loop[i] = (t.pcm[a + i] * w + t.pcm[a + L + i] * (1 - w)) * gain;
    }
    const seg = new Float32Array(P + L + P);
    for (let i = 0; i < seg.length; i++) seg[i] = loop[((i - P) % L + L) % L];
    parts.push(seg);
    let rms = 0;
    for (const v of loop) rms += v * v;
    out.push({ rpm: t.rpm, layer: t.layer, start: +(at / rate).toFixed(6), loop: +(L / rate).toFixed(6), rms: +Math.sqrt(rms / L).toFixed(4) });
    at += seg.length;
  }
  const all = new Float32Array(at);
  let o = 0;
  for (const seg of parts) { all.set(seg, o); o += seg.length; }
  const wav = join(outDir, `${m.name}.wav`), mp3 = join(outDir, `${m.name}.mp3`);
  writeWav(wav, all, rate);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '96k', '-ac', '1', mp3]);
  rmSync(wav);
  const pack = {
    name: m.name, title: TITLES[m.name] || m.engine, engine: m.engine, cylinders: m.cylinders, redline: m.redline,
    idle: Math.min(...out.map((s) => s.rpm)), file: `${m.name}.mp3`, pad: PAD, seconds: +(at / rate).toFixed(2),
    layers: { on: 'full throttle', off: 'throttle shut (overrun)' },
    source: `Engine Simulator (AngeTheGreat, MIT) script ${m.script}, held at each rpm on its dynamometer`,
    samples: out,
  };
  writeFileSync(join(outDir, `${m.name}.json`), JSON.stringify(pack, null, 1) + '\n');
  console.log(`${m.name}: ${out.length} loops, ${(statSync(mp3).size / 1024).toFixed(0)} KB, ${pack.seconds} s, gain ${gain.toFixed(2)}`);
}
/* index.json: every pack in the folder, for pickers */
const all = readdirSync(outDir).filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => JSON.parse(readFileSync(join(outDir, f), 'utf8')))
  .map((p) => ({ name: p.name, title: p.title, cylinders: p.cylinders, redline: p.redline, file: `${p.name}.json` }))
  .sort((a, b) => a.title.localeCompare(b.title));
writeFileSync(join(outDir, 'index.json'), JSON.stringify(all, null, 1) + '\n');
console.log(`index.json: ${all.length} engines`);
if (!existsSync(join(outDir, 'CREDITS.md'))) console.log('note: add CREDITS.md (Engine Simulator MIT notice) to', outDir);
