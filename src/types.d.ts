/* Types for Pixelfork Car Physics (import names "car", "car/sound", "car/engine-fx", "car/engine-sound").
   tools/build.mjs checks that these list what the code really has, and copies them to dist/types.d.ts. */

declare module "car" {
  import type { Object3D, PerspectiveCamera, ColorRepresentation } from "three";

  export type Vec3 = [number, number, number];
  /** how it drives: an everyday AWD car, a RWD sports car, a slow old RWD car, a heavy AWD off-roader */
  export type PresetName = "car" | "sport" | "classic" | "offroad";
  export type DriveName = "awd" | "rwd" | "fwd";

  /** the crashcat world object a game has (or CAR.createPhysics() makes): step(dt) = exactly one world step */
  export interface Physics {
    world: any;
    layers: { moving: number; static: number };
    step(dt: number): void;
    sync(alpha?: number): void;
    listener?: any;
  }

  /** handling numbers: any of them in create() or car.tune(); out-of-range values are clamped (see CAR.tuning) */
  export interface Tuning {
    /** kg (500..5000) */ mass?: number;
    /** kW (20..1200) */ power?: number;
    /** km/h (60..420) */ topSpeed?: number;
    /** tyre friction (0.4..3) */ grip?: number;
    /** degrees of full lock at a standstill (10..55) */ steer?: number;
    /** how fast the wheel turns (0.3..3) */ steerSpeed?: number;
    /** suspension spring, Hz (0.5..3.5) */ stiffness?: number;
    /** × critical damping (0.2..1.6) */ damping?: number;
    /** anti-roll bars (0..2) */ antiRoll?: number;
    /** metres of suspension travel (0.08..0.6) */ travel?: number;
    /** slowing when you lift off (0..3) */ engineBrake?: number;
    /** rpm (3000..11000) */ redline?: number;
    /** forward gears (1..9) */ gears?: number;
    /** seconds per gear change (0.02..1) */ shiftTime?: number;
    /** traction + stability help (0..1) */ assist?: number;
    /** rear grip with the handbrake (0.1..1) */ handbrakeGrip?: number;
    drive?: DriveName;
  }

  export interface CreateOptions extends Tuning {
    /** the game's crashcat world object, or CAR.createPhysics() */
    physics: Physics;
    /** where it is drawn (without it: simulated, not drawn; add car.object yourself) */
    scene?: Object3D;
    /** the loaded car model (gltf.scene or the gltf); it is not changed. Leave out for the built-in low-poly car */
    model?: Object3D | { scene: Object3D };
    /** paints the built-in car (ignored with a model) */
    color?: ColorRepresentation;
    /** default "car" */
    preset?: PresetName;
    /** [x, y, z]: y = the ground under it. Default [0, 0, 0] */
    position?: Vec3;
    /** radians, 0 = facing +z */
    yaw?: number;
    /** the model's front, if the automatic guess is wrong */
    forward?: "+z" | "-z" | "+x" | "-x";
    /** the car's real length in metres, if the model's units are odd */
    length?: number;
    /** physics steps per physics.step() (default 2; 1 = off) */
    substeps?: number;
  }

  export interface DriveInput {
    /** 0..1 */ throttle?: number;
    /** 0..1; held at a standstill it reverses */ brake?: number;
    /** -1 (left) .. 1 (right) */ steer?: number;
    handbrake?: boolean;
  }

  export interface EngineState {
    rpm: number;
    /** -1 = reverse, 1.. forward */
    gear: number;
    gears: number;
    redline: number;
    /** 0..1 */
    throttle: number;
    shifting: boolean;
    limiter: boolean;
  }

  export interface WheelReport {
    /** 0 = front */ axle: number;
    left: boolean;
    radius: number;
    width: number;
    position: Vec3;
  }

  export interface CarReport {
    wheels: WheelReport[];
    size: { length: number; width: number; height: number };
    wheelbase: number;
    track: number;
    forward: Vec3;
    frontConfidence: number;
    unitScale: number;
    notes: string[];
  }

  export interface Wheel {
    grounded: boolean;
    load: number;
    steer: number;
    spin: number;
    slip: number;
    /** 0..1: how much the tyre scrubs (the most of slide, spinSlip, lock) */
    skid: number;
    /** 0..1: sliding sideways (cornering at the limit, drifting) */
    slide: number;
    /** 0..1: spinning faster than the road (wheelspin, burnouts; also at a standstill) */
    spinSlip: number;
    /** 0..1: locked (handbrake) while moving */
    lock: number;
    contact: Vec3;
    normal: Vec3;
    [k: string]: any;
  }

  export interface Car {
    /** the three.js object that is drawn (moved by the physics) */
    readonly object: Object3D;
    /** the crashcat body */
    readonly body: any;
    /** the controls in use */
    readonly input: { throttle: number; brake: number; steer: number; handbrake: boolean };
    /** set the controls (every frame, or when they change); missing fields keep their value */
    drive(input: DriveInput): Car;
    /** forward speed in km/h (negative when reversing) */
    readonly speed: number;
    /** how many wheels touch the ground */
    readonly grounded: number;
    /** engine and gearbox, for a HUD or engine sound */
    readonly engine: EngineState;
    /** 0..1: how hard the suspension was just hit (landings, kerbs); fades out */
    readonly impact: number;
    /** 0..1: how much the tyres slide or spin (for tyre screech, skid marks) */
    readonly skid: number;
    /** change handling live; returns the numbers in use */
    tune(p: Tuning): Required<Tuning>;
    /** back on its wheels, standing still: here (1 m up), or at [x, y, z] (y = ground) facing yaw */
    reset(position?: Vec3, yaw?: number): Car;
    /** take it out of the scene and the world */
    remove(): void;
    /** what was found in the model */
    readonly report: CarReport;
    /** the handling numbers in use */
    readonly params: Required<Tuning>;
    readonly wheels: Wheel[];
    readonly substeps: number;
  }

  export type CameraMode = "chase" | "far" | "hood";
  export interface CameraOptions {
    /** degrees (58) */ fov?: number;
    /** extra degrees at speed (14) */ fovBoost?: number;
    /** multiplier (1) */ distance?: number;
    /** multiplier (1) */ height?: number;
    /** how tightly it follows (1) */ stiffness?: number;
    /** landing bob (1; 0 = off) */ shake?: number;
    /** seconds after a drag before it swings back (1.5) */ returnDelay?: number;
  }
  export interface ChaseCamera {
    /** every frame, after physics.sync() */
    update(dt: number): void;
    /** turn around the car by pixels of mouse / finger movement */
    orbit(dx: number, dy: number): void;
    /** move in (< 1) or out (> 1) */
    zoom(factor: number): void;
    setMode(mode: CameraMode): void;
    readonly mode: CameraMode;
    /** snap behind the car */
    reset(): void;
    /** follow another car */
    setCar(car: Car): void;
    options: Required<CameraOptions>;
  }

  export interface InspectResult {
    ok: boolean;
    reason?: string;
    wheels: { center: Vec3; axle: Vec3; radius: number; width: number; axleIndex: number; left: boolean }[];
    forward: Vec3;
    unitScale: number;
    frontConfidence: number;
    notes: string[];
    [k: string]: any;
  }

  export interface CarLibrary {
    readonly version: string;
    /** the built-in car (no model): always a car */
    create(options: Omit<CreateOptions, "model"> & { model?: undefined }): Car;
    /** a drivable car from a model (null, with a console warning, when no wheels are found) */
    create(options: CreateOptions): Car | null;
    /** a crashcat world object for pages that have none; floor: size in metres of a static floor with its top at y = 0 */
    createPhysics(options?: { gravity?: Vec3; floor?: number | false }): Physics;
    /** a GTA-style chase camera for a car */
    createCamera(camera: PerspectiveCamera, car: Car, options?: CameraOptions): ChaseCamera;
    /** what the wheel finder sees in a model, without making a car */
    inspect(model: Object3D, options?: { forward?: "+z" | "-z" | "+x" | "-x"; length?: number }): InspectResult;
    readonly presets: PresetName[];
    /** every tuning number: [min, max, unit] */
    readonly tuning: Record<Exclude<keyof Tuning, "drive">, [number, number, string]>;
  }

  const CAR: CarLibrary;
  export default CAR;
  export const create: CarLibrary["create"];
  export const createPhysics: CarLibrary["createPhysics"];
  export const createCamera: CarLibrary["createCamera"];
  export const inspect: CarLibrary["inspect"];
  export const PRESETS: Record<PresetName, Required<Tuning>>;
  export const TUNING: CarLibrary["tuning"];
}

declare module "car/sound" {
  import type { Object3D } from "three";
  import type { Car } from "car";
  /** a recorded engine (real sound, ~0.45 MB each, downloaded once when first used) */
  export type RecordedEngineName = "f136" | "m52" | "vtec" | "c454" | "2jz" | "ls" | "lfa" | "ej25" | "i5" | "v6" | "f1v12" | "busa" | "harley";
  /** a synthesised engine (no download; also the stand-in when a recording can't load) */
  export type SynthEngineName = "synth-inline4" | "synth-inline6" | "synth-v8" | "synth-v12";
  export type EngineName = RecordedEngineName | SynthEngineName;
  export interface CarSoundOptions {
    /** default: picked from the car's power, redline and mass */ engine?: EngineName;
    /** the folder with the recordings (default: assets/sounds/engines/ next to the library's folder) */ sounds?: string;
    /** the tyre recordings' .json (default: assets/sounds/tyres/tyres.json next to the library's folder); false: synthesised */ tyreSounds?: string | false;
    /** 0..2 (1) */ volume?: number;
    /** the engine alone, 0..2 (1) */ engineVolume?: number;
    /** where the player hears from, usually the camera: further cars are quieter and panned */ listener?: Object3D;
    /** exhaust pops & bangs 0..1 (0.6) */ pops?: number;
    /** > 0: a turbo (its blow-off valve, fx boost); 0 = none (0) */ turbo?: number;
    /** blow-off valve 0..1 (0.5 with a turbo) */ blowoff?: number;
    /** "blowoff" (a short psssh, default) or "flutter" (compressor surge) */ valve?: "blowoff" | "flutter";
    /** tyre screech 0..1 (1) */ tyres?: number;
    /** crash sounds 0..1 (1) */ crashes?: number;
    /** an audio context to use (default: one shared by every car sound) */ context?: BaseAudioContext;
  }
  export interface CarSound {
    /** every frame, after physics.sync() */
    update(): void;
    /** start now, from a key or click handler (otherwise it starts on the first key or tap by itself) */
    start(): void;
    /** true once the recorded engine plays; false if it could not load (the synthesised one plays) */
    ready: Promise<boolean>;
    /** change live: volume, engineVolume, pops, turbo, blowoff, valve, tyres, crashes (the engine with setEngine) */
    options: { engine: EngineName; volume: number; engineVolume: number; pops: number; turbo: number; blowoff: number; valve: "blowoff" | "flutter"; tyres: number; crashes: number };
    setEngine(name: EngineName): void;
    setListener(listener: Object3D | null): void;
    muted: boolean;
    readonly context: BaseAudioContext | null;
    /** this car's sound after the first update (connect an analyser or recorder) */
    readonly output: GainNode | null;
    /** how many crash and thump sounds have played */
    stats: { crashes: number; thumps: number };
    /** 0..1 turbo boost */
    readonly boost: number;
    /** stop and free it (with car.remove()) */
    dispose(): void;
  }
  /** name → title of every recorded engine */
  export const RECORDED_ENGINES: Record<RecordedEngineName, string>;
  export const SYNTH_ENGINES: SynthEngineName[];
  /** the car's whole sound: a real recorded engine, pops, turbo, tyres, road, wind, bumps, crashes */
  export function createCarSound(car: Car, options?: CarSoundOptions): CarSound;
}

declare module "car/engine-fx" {
  export interface EngineFxOptions {
    /** 0..1 loudness (1) */ pops?: number;
    /** > 0: the car has a turbo (boost for a gauge, the blow-off valve); 0 = none (0.6) */ turbo?: number;
    /** 0..1 the valve (0.6) */ blowoff?: number;
    valve?: "blowoff" | "flutter";
    /** everything (1) */ volume?: number;
  }
  export interface EngineFx {
    /** connect it: fx.output.connect(ctx.destination) */
    output: GainNode;
    /** every frame with car.engine */
    update(engine: { rpm: number; redline: number; throttle: number; shifting?: boolean; limiter?: boolean }): void;
    /** change live */
    options: Required<EngineFxOptions>;
    stats: { pops: number; valves: number };
    /** 0..1 turbo boost now */
    readonly boost: number;
    dispose(): void;
  }
  /** exhaust pops & bangs and turbo sounds, synthesised (no files) */
  export function createEngineFx(ctx: BaseAudioContext, options?: EngineFxOptions): EngineFx;
}

declare module "car/engine-sound" {
  export interface EnginePackMeta {
    name: string;
    samples: { rpm: number; layer: string; loop: number; file: string }[];
    redline: number;
    idle: number;
    pad: number;
    [k: string]: any;
  }
  export interface EngineSound {
    output: GainNode;
    /** every frame with car.engine */
    update(engine: { rpm: number; redline: number; throttle: number; shifting?: boolean; limiter?: boolean }): void;
    stop(): void;
    dispose(): void;
    meta: EnginePackMeta;
    options: { volume: number; offBoost: number };
    readonly voices: number;
  }
  /** load a recorded engine pack (its .json; the loops sit in a folder of the same name next to it) */
  export function loadEngineSound(ctx: BaseAudioContext, url: string, fetchFn?: typeof fetch): Promise<EngineSound>;
  export function createEngineSound(ctx: BaseAudioContext, meta: EnginePackMeta, buffers: AudioBuffer[], options?: { volume?: number; offBoost?: number }): EngineSound;
}
