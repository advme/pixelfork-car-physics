#!/usr/bin/env node
/**
 * Build everything games load, after ANY change:   npm run build
 *
 *   1. checks that src/types.d.ts lists what the code really has (a car made in Node, CAR's functions, the tuning
 *      numbers, the presets) and that the version in src/index.js is package.json's
 *   2. bundles (ES modules; three and crashcat stay external = the game's import map):
 *        src/index.js        → dist/car.module.js              import name "car"
 *        src/sound.js        → dist/car-sound.module.js        import name "car/sound"        (optional: built-in sound, no files)
 *        src/engine-fx.js    → dist/car-engine-fx.module.js    import name "car/engine-fx"    (optional)
 *        src/engine-sound.js → dist/car-engine-sound.module.js import name "car/engine-sound" (optional, loads files)
 *   3. refuses code a strict game host would refuse (eval, new Function, network, workers) in all but engine-sound
 *   4. writes dist/types.d.ts and dist/registry.json (version, needs, modules, presets, tuning ranges)
 *   5. stamps the version into AI-GUIDE.md and warns when the guide gets long (game-writing AIs read it in every prompt)
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const at = (p) => join(ROOT, p);
const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8'));
const VERSION = pkg.version;
const THREE = pkg.peerDependencies.three, CRASHCAT = pkg.peerDependencies.crashcat;
const EXTERNAL = ['three', 'three/*', 'crashcat', 'crashcat/*'];
const GUIDE_MAX_LINES = 180;
const MODULES = [
  { name: 'car', src: 'src/index.js', out: 'car.module.js', strict: true },
  { name: 'car/sound', src: 'src/sound.js', out: 'car-sound.module.js', strict: true },
  { name: 'car/engine-fx', src: 'src/engine-fx.js', out: 'car-engine-fx.module.js', strict: true },
  { name: 'car/engine-sound', src: 'src/engine-sound.js', out: 'car-engine-sound.module.js', strict: false },
];

const errors = [];
const fail = (m) => errors.push(m);
const refuse = () => { if (errors.length) { console.error('build refused:\n  ' + errors.join('\n  ')); process.exit(1); } };

/* ---------------------------------------------------------------- 1. the types match the code */
const types = readFileSync(at('src/types.d.ts'), 'utf8');
const block = (name) => {
  const m = types.match(new RegExp(`export interface ${name}(?: extends [^{]+)? \\{([\\s\\S]*?)\\n  \\}`));
  if (!m) { fail(`src/types.d.ts: no interface ${name}`); return []; }
  return [...m[1].matchAll(/^\s*(?:\/\*\*[^*]*\*\/\s*)?(?:readonly\s+)?([a-zA-Z_]\w*)\??[:(]/gm)].map((x) => x[1]);
};
const lib = await import(pathToFileURL(at('src/index.js')).href);
const CAR = lib.default;
if (CAR.version !== VERSION) fail(`src/index.js VERSION is ${CAR.version} but package.json says ${VERSION}`);
{
  const warn = console.warn; console.warn = () => {};
  const physics = CAR.createPhysics({ floor: 50 });
  const car = CAR.create({ physics });
  console.warn = warn;
  if (!car) fail('the built-in car could not be made');
  else {
    const have = Object.keys(car).filter((k) => !k.startsWith('_'));
    const listed = block('Car');
    for (const k of have) if (!listed.includes(k)) fail(`the car has "${k}" but src/types.d.ts interface Car does not list it`);
    for (const k of listed) if (!have.includes(k)) fail(`src/types.d.ts interface Car lists "${k}" but the car has no such thing`);
    const camKeys = Object.keys(CAR.createCamera({ fov: 50, position: { set() {} }, lookAt() {}, updateProjectionMatrix() {} }, car));
    const camListed = block('ChaseCamera');
    for (const k of camKeys) if (!camListed.includes(k)) fail(`the camera has "${k}" but interface ChaseCamera does not list it`);
    for (const k of camListed) if (!camKeys.includes(k)) fail(`interface ChaseCamera lists "${k}" but the camera has no such thing`);
    car.remove();
  }
  const libListed = block('CarLibrary');
  for (const k of Object.keys(CAR)) if (!libListed.includes(k)) fail(`CAR.${k} is not in src/types.d.ts interface CarLibrary`);
  for (const k of libListed) if (!(k in CAR)) fail(`interface CarLibrary lists "${k}" but CAR has no such thing`);
  const tuning = block('Tuning');
  for (const k of Object.keys(CAR.tuning)) if (!tuning.includes(k)) fail(`tuning "${k}" is not in src/types.d.ts interface Tuning`);
  for (const k of tuning) if (k !== 'drive' && !(k in CAR.tuning)) fail(`interface Tuning lists "${k}" but CAR.tuning has no such number`);
  const presets = types.match(/export type PresetName =([^;]+);/)?.[1].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)).sort().join(',');
  if (presets !== [...CAR.presets].sort().join(',')) fail('src/types.d.ts PresetName does not match CAR.presets');
  {
    const { createCarSound, ENGINES } = await import(pathToFileURL(at('src/sound.js')).href);
    const warn = console.warn; console.warn = () => {};
    const car = CAR.create({ physics: CAR.createPhysics({ floor: 50 }) });
    console.warn = warn;
    const have = Object.keys(createCarSound(car));
    const listed = block('CarSound');
    for (const k of have) if (!listed.includes(k)) fail(`the car sound has "${k}" but src/types.d.ts interface CarSound does not list it`);
    for (const k of listed) if (!have.includes(k)) fail(`interface CarSound lists "${k}" but the car sound has no such thing`);
    const names = types.match(/export type EngineName =([^;]+);/)?.[1].match(/"([^"]+)"/g)?.map((x) => x.slice(1, -1)).sort().join(',');
    if (names !== Object.keys(ENGINES).sort().join(',')) fail('src/types.d.ts EngineName does not match ENGINES in src/sound.js');
    car.remove();
  }
  const fxKeys = block('EngineFx');
  for (const k of ['output', 'update', 'options', 'stats', 'boost', 'dispose']) if (!fxKeys.includes(k)) fail(`interface EngineFx is missing "${k}"`);
}
refuse();

/* ---------------------------------------------------------------- 2. bundle */
mkdirSync(at('dist'), { recursive: true });
const banner = `/* Pixelfork Car Physics v${VERSION} · needs three@${THREE} and crashcat@${CRASHCAT} from the import map · © 2026 Pixelfork, see LICENSE */`;
for (const m of MODULES) {
  await esbuild.build({
    entryPoints: [at(m.src)], outfile: at(`dist/${m.out}`),
    bundle: true, format: 'esm', target: 'es2022', platform: 'browser',
    external: EXTERNAL, banner: { js: banner }, legalComments: 'none', logLevel: 'warning',
  });
}

/* ---------------------------------------------------------------- 3. what strict game hosts refuse */
const banned = [
  [/\beval\s*\(/, 'eval()'], [/\bnew\s+Function\b/, 'new Function'], [/\bfetch\s*\(/, 'fetch()'],
  [/\bnew\s+(WebSocket|XMLHttpRequest|EventSource|Worker|SharedWorker)\b/, 'network or worker'],
  [/\bimport\s*\(/, 'import()'], [/from\s*["']https?:/, 'an import from the internet'],
];
for (const m of MODULES) {
  const code = readFileSync(at(`dist/${m.out}`), 'utf8');
  if (m.strict) for (const [re, what] of banned) if (re.test(code)) fail(`dist/${m.out} contains ${what}: a strict game host would refuse it`);
  for (const x of code.matchAll(/^import\s[\s\S]*?from\s*["']([^"']+)["']/gm)) {
    if (!/^(three|crashcat)(\/|$)/.test(x[1])) fail(`dist/${m.out} imports "${x[1]}": only three and crashcat may come from outside`);
  }
}
refuse();

/* ---------------------------------------------------------------- 4. types + registry */
writeFileSync(at('dist/types.d.ts'), types);
const registry = {
  name: 'pixelfork-car',
  version: VERSION,
  needs: { three: THREE, crashcat: CRASHCAT },
  module: 'car.module.js',
  importMap: Object.fromEntries(MODULES.map((m) => [m.name, m.out])),
  optional: { 'car/sound': 'built-in car sound: engine, tyres, road, wind, bumps, crashes, pops, turbo; synthesised (no files)', 'car/engine-fx': 'exhaust pops & bangs + turbo, synthesised (no files)', 'car/engine-sound': 'recorded engine sound packs (loads audio files)' },
  presets: Object.fromEntries(Object.entries(lib.PRESETS)),
  tuning: Object.fromEntries(Object.entries(CAR.tuning).map(([k, [min, max, unit]]) => [k, { min, max, unit }])),
  controls: { throttle: '0..1', brake: '0..1 (held at a standstill: reverse)', steer: '-1 left .. 1 right', handbrake: 'boolean' },
};
writeFileSync(at('dist/registry.json'), JSON.stringify(registry, null, 2) + '\n');

/* ---------------------------------------------------------------- 5. the AI guide */
const guidePath = at('AI-GUIDE.md');
let guide = readFileSync(guidePath, 'utf8');
guide = guide.replace(/pixelfork-car@[0-9.]+-[A-Z]/g, `pixelfork-car@${VERSION}-A`);
writeFileSync(guidePath, guide);
for (const k of Object.keys(CAR.tuning)) if (!guide.includes(`\`${k}\``)) fail(`AI-GUIDE.md does not mention the tuning number \`${k}\``);
refuse();

/* ---------------------------------------------------------------- report */
const sizes = MODULES.map((m) => {
  const code = readFileSync(at(`dist/${m.out}`));
  return `dist/${m.out} ${(statSync(at(`dist/${m.out}`)).size / 1024).toFixed(1)} KB (${(gzipSync(code).length / 1024).toFixed(1)} KB gz)`;
});
const lines = guide.split('\n').length;
console.log(`built v${VERSION}:\n  ${sizes.join('\n  ')}\n  dist/types.d.ts · dist/registry.json · AI-GUIDE ${lines} lines`);
if (lines > GUIDE_MAX_LINES) console.warn(`warning: AI-GUIDE.md is ${lines} lines (budget ${GUIDE_MAX_LINES}): game-writing AIs read it in every prompt, keep it short`);
