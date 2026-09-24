#!/usr/bin/env node
/* THE COMPRESSION GATE:   npm run test:compressed
   Game hosts often compress uploaded models (meshopt, with the vertex data quantised to 16-bit and meshes merged).
   Every test model is compressed the way gltfpack does it (plain -cc, and -cc with the mesh simplified to half), into
   _local/compressed/. Then: the wheels found must match the original's (centre within 2 cm, radius within 1 cm), and
   the full physics gate (tools/test-car.mjs) must pass on every compressed file. */
import { readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadGLB } from './load-glb.mjs';
import { detectWheels } from '../src/detect.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEST = join(ROOT, 'assets/models/test'), OUT = join(ROOT, '_local/compressed');
const GLTFPACK = join(ROOT, 'node_modules/.bin/gltfpack');
const VARIANTS = [['cc', ['-cc']], ['cc-si50', ['-cc', '-si', '0.5']]];
mkdirSync(OUT, { recursive: true });

let failed = 0;
const wheelsOf = (d) => d.wheels.map((w) => ({ c: w.center.map((v) => v * d.unitScale), r: w.radius * d.unitScale }));
const made = [];
for (const f of readdirSync(TEST).filter((x) => x.endsWith('.glb'))) {
  const base = detectWheels((await loadGLB(join(TEST, f))).scene);
  const a = wheelsOf(base);
  for (const [tag, args] of VARIANTS) {
    const out = join(OUT, f.replace(/\.glb$/, `.${tag}.glb`));
    execFileSync(GLTFPACK, ['-i', join(TEST, f), '-o', out, ...args], { stdio: 'ignore' });
    made.push(out);
    const d = detectWheels((await loadGLB(out)).scene);
    const b = d.ok ? wheelsOf(d) : [];
    let worstC = 0, worstR = 0;
    if (b.length !== a.length) { failed++; console.log(`   FAIL ${f} ${tag}: ${b.length} wheels (original ${a.length})`); continue; }
    a.forEach((w, i) => {
      const m = b.reduce((best, x) => (Math.hypot(...x.c.map((v, k) => v - w.c[k])) < Math.hypot(...best.c.map((v, k) => v - w.c[k])) ? x : best));
      worstC = Math.max(worstC, Math.hypot(...m.c.map((v, k) => v - w.c[k])));
      worstR = Math.max(worstR, Math.abs(m.r - w.r));
    });
    const ok = worstC < 0.02 && worstR < 0.01;
    if (!ok) failed++;
    console.log(`${ok ? '' : '   FAIL '}${f} ${tag.padEnd(8)} wheels ${b.length} · centres within ${(worstC * 100).toFixed(1)} cm · radius within ${(worstR * 100).toFixed(1)} cm`);
  }
}
try { execFileSync('node', [join(ROOT, 'tools/test-car.mjs'), ...made], { stdio: 'inherit' }); } catch { failed++; }
console.log(failed ? `\ncompressed models FAILED` : '\ncompressed models: all passed');
process.exit(failed ? 1 : 0);
