/* Phone-friendly rendering for the demos. On touch devices: a lower pixel ratio (≤ 1.5) and cheaper shadows (1024,
   plain PCF). Everywhere: when frames get slow (under ~42 fps for 2 s) the resolution steps down by itself, to a
   pixel ratio of 1 at the lowest, and steps back up when there's room again. */
import { PCFShadowMap } from 'three';

/** @param {import('three').WebGLRenderer} renderer @param {import('three').DirectionalLight} [sun] */
export function createQuality(renderer, sun) {
  const phone = matchMedia('(pointer: coarse)').matches;
  const cap = Math.min(devicePixelRatio || 1, phone ? 1.5 : 2);
  let ratio = cap, sum = 0, n = 0, good = 0, warm = 0;
  renderer.setPixelRatio(ratio);
  if (phone && sun) { renderer.shadowMap.type = PCFShadowMap; sun.shadow.mapSize.set(1024, 1024); }
  return {
    phone,
    get ratio() { return ratio; },
    /** every frame, with the frame's real duration in seconds */
    frame(dt) {
      warm += dt;
      /* the first seconds (loading, compiling) and frames from a hidden tab don't count */
      if (warm < 3 || dt > 0.09) return;
      sum += dt; n++;
      if (sum < 2) return;
      const avg = sum / n;
      sum = 0; n = 0;
      if (avg > 1 / 42 && ratio > 1) { ratio = Math.max(1, ratio - 0.25); renderer.setPixelRatio(ratio); good = 0; }
      else if (avg < 1 / 55 && ratio < cap && ++good >= 3) { ratio = Math.min(cap, ratio + 0.25); renderer.setPixelRatio(ratio); good = 0; }
    },
  };
}
