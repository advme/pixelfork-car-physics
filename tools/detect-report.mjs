#!/usr/bin/env node
/* What the wheel detector finds in each model:   node tools/detect-report.mjs [file.glb ...]
   (no files: every model in assets/models/test/) */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGLB } from './load-glb.mjs';
import { detectWheels } from '../src/detect.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEST = join(ROOT, 'assets/models/test');
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(TEST).filter((f) => f.endsWith('.glb')).map((f) => join(TEST, f));
const r2 = (v) => +v.toFixed(2);

for (const f of files) {
  const t0 = performance.now();
  const gltf = await loadGLB(f);
  const d = detectWheels(gltf.scene);
  const ms = performance.now() - t0;
  console.log(`\n== ${f.split('/').pop()}  (${ms.toFixed(0)} ms)  ${d.ok ? 'OK' : 'FAILED: ' + d.reason}`);
  console.log(`   islands ${d.counts.islands}, round candidates ${d.counts.candidates}`);
  if (d.ok) {
    const s = d.unitScale;
    console.log(`   size ${r2(d.size.length * s)} × ${r2(d.size.width * s)} × ${r2(d.size.height * s)} m (unit scale ${s}), forward [${d.forward}] confidence ${r2(d.frontConfidence)}`);
    for (const w of d.wheels) {
      console.log(`   axle ${w.axleIndex} ${w.left ? 'left ' : 'right'}  ⌀ ${r2(2 * w.radius * s)} m  width ${r2(w.width * s)} m  at [${w.center.map((v) => r2(v * s))}]  axle [${w.axle.map(r2)}]  parts ${w.parts} + steer-only ${w.steerOnlyParts}`);
    }
  }
  for (const n of d.notes) console.log('   note:', n);
}
