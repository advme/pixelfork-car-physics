# engine-render: real engine sound packs from Engine Simulator

The engine sounds in `assets/sounds/engines/` are recorded from **Engine Simulator** by AngeTheGreat (MIT), through
the cross-platform community fork [Open Engine Simulator](https://github.com/josemaarcos90-lgtm/open-engine-sim).
`render.cpp` links the simulator's core (no window, no audio device), starts the engine with its starter motor,
then holds it at each rpm on the simulator's dynamometer at full and closed throttle and records the audio.
`tools/engine-sound-pack.mjs` turns the recordings into seamless MP3 loops + a `.json` that `src/engine-sound.js`
plays (two nearest loops per throttle layer, pitched to the exact rpm, crossfaded).

## Build (macOS arm64; Linux works the same)

```bash
brew install cmake boost bison flex ffmpeg
git clone --depth 1 https://github.com/josemaarcos90-lgtm/open-engine-sim.git _local/engine-sim
git -C _local/engine-sim submodule update --init --depth 1
cmake -S tools/engine-render -B _local/engine-render-build -DCMAKE_BUILD_TYPE=Release
cmake --build _local/engine-render-build -j
```

## Record an engine and make its pack

```bash
_local/engine-render-build/engine-render --assets _local/engine-sim/assets \
  --script engines/atg-video-2/08_ferrari_f136_v8.mr --name f136 --out _local/renders/pack \
  --rpms 900,1050,1250,1500,1750,2050,2400,2850,3350,3950,4650,5500,6500,7650,9000 --seconds 2.2 --warmup 1.2
node tools/engine-sound-pack.mjs _local/renders/pack assets/sounds/engines f136
```

- Engine files that only define an engine node (no `main`) need `--node <node name>`, e.g.
  `--script engines/bmw/M52B28.mr --node M52B28`.
- Space the rpms ~18% apart (constant pitch step) up to the engine's redline (`redline:` in its `.mr`).
- The log line per recording shows the dyno torque (positive = the engine is really firing) and `clipped` (must be 0).
- Any engine in `_local/engine-sim/assets/engines/` works (2JZ, GM LS, LFA V10, Subaru boxer, Audi I5, …).
