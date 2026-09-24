/* The car used when a game gives no model: a simple low-poly hatchback built from boxes and cylinders, 4.1 m long,
   front +Z, tyres touching y = 0, in metres. It goes through the same wheel detection as any uploaded model (so it
   also keeps that path honest). */
import { Group, Mesh, BoxGeometry, CylinderGeometry, MeshStandardMaterial, Color } from 'three';

/** @param {{ color?: import('three').ColorRepresentation }} [o] */
export function createDefaultCar(o = {}) {
  const paint = new MeshStandardMaterial({ color: new Color(o.color ?? '#e8412c'), roughness: 0.35, metalness: 0.3 });
  const glass = new MeshStandardMaterial({ color: '#1b2430', roughness: 0.1, metalness: 0.6 });
  const dark = new MeshStandardMaterial({ color: '#202226', roughness: 0.8 });
  const tyre = new MeshStandardMaterial({ color: '#17181a', roughness: 0.9 });
  const rim = new MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.3, metalness: 0.8 });
  const head = new MeshStandardMaterial({ color: '#fff6d8', emissive: '#fff1c0', emissiveIntensity: 0.6 });
  const tail = new MeshStandardMaterial({ color: '#b3121a', emissive: '#ff1a1a', emissiveIntensity: 0.5 });

  const car = new Group();
  car.name = 'default-car';
  const box = (w, h, l, x, y, z, m) => { const b = new Mesh(new BoxGeometry(w, h, l), m); b.position.set(x, y, z); car.add(b); return b; };
  /* body, cabin, bumpers, lights */
  box(1.7, 0.5, 4.1, 0, 0.62, 0, paint);
  box(1.5, 0.46, 2.0, 0, 1.1, -0.25, glass);
  box(1.56, 0.06, 1.9, 0, 1.35, -0.25, paint);
  box(1.8, 0.2, 0.16, 0, 0.42, 2.07, dark);
  box(1.8, 0.2, 0.16, 0, 0.42, -2.07, dark);
  for (const s of [-1, 1]) {
    box(0.34, 0.1, 0.04, s * 0.62, 0.72, 2.06, head);
    box(0.3, 0.1, 0.04, s * 0.64, 0.72, -2.06, tail);
  }
  /* wheels: a tyre and a rim each, axle along X */
  const R = 0.34, W = 0.24;
  const tyreGeo = new CylinderGeometry(R, R, W, 28).rotateZ(Math.PI / 2);
  const rimGeo = new CylinderGeometry(R * 0.62, R * 0.62, 0.04, 20).rotateZ(Math.PI / 2);
  for (const z of [1.3, -1.3]) for (const s of [-1, 1]) {
    const t = new Mesh(tyreGeo, tyre); t.position.set(s * 0.8, R, z); car.add(t);
    const r = new Mesh(rimGeo, rim); r.position.set(s * (0.8 + W / 2 + 0.005), R, z); car.add(r);
  }
  return car;
}
