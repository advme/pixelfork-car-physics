/* The three race cars, balanced to lap within a few tenths of each other on the City Circuit (each keeps its own
   character: the Cyberpunk car is rear-drive and fast on the straight, the VAZ is light and nimble, the Dirty car is
   heavy, four-wheel-drive and turbocharged). `tune` goes straight into CAR.create(); `engine` is the recorded engine sound (every car). */
export const RACE_CARS = [
  {
    id: 'cyber', name: 'Cyberpunk', file: '/assets/models/test/cyberpunk_car.glb', blurb: 'RWD · V8 · fastest on the straight',
    preset: 'sport', tune: { power: 360, mass: 1400, grip: 1.45, topSpeed: 290 }, engine: 'f136', turbo: false,
  },
  {
    id: 'vaz', name: 'VAZ 2107', file: '/assets/models/test/vaz_2107.glb', blurb: 'RWD · light · best in the old town',
    preset: 'classic', tune: { power: 320, mass: 1000, grip: 1.56, topSpeed: 285, gears: 5, redline: 7500, stiffness: 1.4, antiRoll: 0.5 }, engine: 'vtec', turbo: false,
  },
  {
    id: 'dirty', name: 'Dirty car', file: '/assets/models/test/dirty_car.glb', blurb: 'AWD · turbo · strong out of corners',
    preset: 'car', tune: { power: 380, mass: 1550, grip: 1.42, topSpeed: 280, drive: 'awd' }, engine: '2jz', turbo: true,
  },
];

/** AI drivers' names and colours (fictional) */
export const RIVALS = [
  { name: 'K. Nolan', color: 0xd8262d }, { name: 'A. Mirza', color: 0x1f4fbf }, { name: 'L. Varga', color: 0xf2c400 },
  { name: 'T. Okafor', color: 0x14a05a }, { name: 'S. Lind', color: 0xf5f5f5 }, { name: 'R. Duarte', color: 0xff7a1a },
  { name: 'E. Sato', color: 0x7a3fd0 },
];
