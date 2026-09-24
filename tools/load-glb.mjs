/* Load a .glb in Node with three.js's own GLTFLoader (the same code a game uses in the browser).
   Textures can't decode in Node and are skipped quietly; geometry, materials and the scene graph are exact.
   Meshopt-compressed models (gltfpack -cc, gltf-transform meshopt) load too, as they do in games. */
import { readFileSync } from 'node:fs';

globalThis.self ??= globalThis;
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
await MeshoptDecoder.ready;

/** @param {string} file path to a .glb → Promise<gltf> */
export function loadGLB(file) {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { warn, error } = console;
  const quiet = (f) => (...a) => { if (!String(a[0]).includes("Couldn't load texture")) f(...a); };
  console.warn = quiet(warn); console.error = quiet(error);
  const done = () => { console.warn = warn; console.error = error; };
  return new Promise((resolve, reject) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(ab, '', (g) => { setTimeout(done, 50); resolve(g); }, (e) => { done(); reject(e); }));
}
