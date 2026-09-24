// Offline engine-sound renderer built on Engine Simulator by AngeTheGreat (Ange Yaghi), MIT license.
// Loads one engine script, holds the crankshaft at fixed rpm on the simulator's dynamometer, and records the
// synthesizer's audio for each rpm, once at full throttle ("on") and once with the throttle shut ("off", overrun).
//
//   engine-render --assets <engine-sim>/assets --script engines/bmw/M52B28.mr [--node M52B28] --out <dir>
//                 [--name m52] [--from 1000] [--to 7000] [--step 500 | --rpms 900,1100,…] [--layers on:1,off:0]
//                 [--seconds 2.5] [--warmup 1.5] [--rate 44100]
//
// Writes <out>/<name>_<rpm>_<on|off>.wav (16-bit mono) and <out>/<name>.json (what was recorded).
// The simulator's automatic volume leveller is replaced by one fixed gain per engine (found by a quick first pass
// at the loudest points), so loud and quiet recordings keep their real difference and nothing clips.
// --node: the script only defines an engine node (no `main`); a vehicle and a transmission are supplied here
// (they don't change the sound: the transmission stays in neutral and the dyno holds the speed).

#include "compiler.h"
#include "engine_sim.h"
#include "units.h"

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

static std::map<std::string, std::string> parseArgs(int argc, char **argv) {
    std::map<std::string, std::string> a;
    for (int i = 1; i + 1 < argc; i += 2) {
        std::string k = argv[i];
        if (k.rfind("--", 0) == 0) a[k.substr(2)] = argv[i + 1];
    }
    return a;
}

static bool writeWav(const fs::path &path, const std::vector<int16_t> &pcm, int rate) {
    std::ofstream f(path, std::ios::binary);
    if (!f) return false;
    auto u32 = [&](uint32_t v) { f.write(reinterpret_cast<const char *>(&v), 4); };
    auto u16 = [&](uint16_t v) { f.write(reinterpret_cast<const char *>(&v), 2); };
    const uint32_t bytes = static_cast<uint32_t>(pcm.size() * 2);
    f.write("RIFF", 4); u32(36 + bytes); f.write("WAVE", 4);
    f.write("fmt ", 4); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16);
    f.write("data", 4); u32(bytes);
    f.write(reinterpret_cast<const char *>(pcm.data()), bytes);
    return true;
}

// Minimal WAV reader for the impulse responses: PCM 16/24/32-bit or float 32, any channel count (first channel),
// resampled linearly to `rate`.
static bool readWavMono16(const fs::path &path, int rate, std::vector<int16_t> &out) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    std::vector<char> d((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    if (d.size() < 44 || std::memcmp(d.data(), "RIFF", 4) || std::memcmp(d.data() + 8, "WAVE", 4)) return false;
    uint16_t fmt = 0, ch = 0, bits = 0; uint32_t sr = 0; const char *data = nullptr; uint32_t dataLen = 0;
    size_t p = 12;
    while (p + 8 <= d.size()) {
        uint32_t len; std::memcpy(&len, d.data() + p + 4, 4);
        if (!std::memcmp(d.data() + p, "fmt ", 4)) {
            std::memcpy(&fmt, d.data() + p + 8, 2); std::memcpy(&ch, d.data() + p + 10, 2);
            std::memcpy(&sr, d.data() + p + 12, 4); std::memcpy(&bits, d.data() + p + 22, 2);
            if (fmt == 0xFFFE) std::memcpy(&fmt, d.data() + p + 32, 2);
        } else if (!std::memcmp(d.data() + p, "data", 4)) {
            data = d.data() + p + 8; dataLen = std::min<uint32_t>(len, static_cast<uint32_t>(d.size() - p - 8));
        }
        p += 8 + len + (len & 1);
    }
    if (!data || !ch || !sr || !bits) return false;
    const int bps = bits / 8, frames = static_cast<int>(dataLen / (bps * ch));
    std::vector<double> src(frames);
    for (int i = 0; i < frames; ++i) {
        const char *s = data + static_cast<size_t>(i) * bps * ch;
        double v = 0;
        if (fmt == 3 && bits == 32) { float x; std::memcpy(&x, s, 4); v = x; }
        else if (bits == 16) { int16_t x; std::memcpy(&x, s, 2); v = x / 32768.0; }
        else if (bits == 24) { int32_t x = (uint8_t)s[0] | ((uint8_t)s[1] << 8) | ((int8_t)s[2] << 16); v = x / 8388608.0; }
        else if (bits == 32) { int32_t x; std::memcpy(&x, s, 4); v = x / 2147483648.0; }
        src[i] = v;
    }
    const double ratio = static_cast<double>(sr) / rate;
    const int n = static_cast<int>(frames / ratio);
    out.resize(n);
    for (int i = 0; i < n; ++i) {
        const double x = i * ratio; const int i0 = static_cast<int>(x); const double t = x - i0;
        const double v = src[std::min(i0, frames - 1)] * (1 - t) + src[std::min(i0 + 1, frames - 1)] * t;
        out[i] = static_cast<int16_t>(std::max(-1.0, std::min(1.0, v)) * 32767);
    }
    return true;
}

int main(int argc, char **argv) {
    auto a = parseArgs(argc, argv);
    if (!a.count("assets") || !a.count("script") || !a.count("out")) {
        std::cerr << "usage: engine-render --assets <dir> --script <rel.mr> [--node NAME] --out <dir> [--name n] "
                     "[--from rpm] [--to rpm] [--step rpm] [--seconds s] [--warmup s] [--rate hz]\n";
        return 2;
    }
    const fs::path assets = fs::absolute(a["assets"]);
    const fs::path script = assets / a["script"];
    const fs::path outDir = fs::absolute(a["out"]);
    const std::string name = a.count("name") ? a["name"] : script.stem().string();
    const int rate = a.count("rate") ? std::stoi(a["rate"]) : 44100;
    const double seconds = a.count("seconds") ? std::stod(a["seconds"]) : 2.5;
    const double warmup = a.count("warmup") ? std::stod(a["warmup"]) : 1.5;
    fs::create_directories(outDir);

    // an entry script: the engine file, plus main() (and a vehicle + transmission for engine-only files)
    const fs::path entry = fs::temp_directory_path() / ("engine-render-" + name + ".mr");
    {
        std::ofstream e(entry);
        e << "import \"engine_sim.mr\"\nimport \"" << script.generic_string() << "\"\n\n";
        if (a.count("node")) {
            e << "units er_units()\n"
                 "private node er_vehicle {\n  alias output __out: vehicle(mass: 1400 * er_units.kg, drag_coefficient: 0.3,\n"
                 "    cross_sectional_area: (72 * er_units.inch) * (50 * er_units.inch), diff_ratio: 3.42,\n"
                 "    tire_radius: 12 * er_units.inch, rolling_resistance: 200 * er_units.N);\n}\n"
                 "private node er_transmission {\n  alias output __out: transmission(max_clutch_torque: 500 * er_units.lb_ft)\n"
                 "    .add_gear(3.2).add_gear(2.1).add_gear(1.5).add_gear(1.15).add_gear(0.92);\n}\n"
                 "public node er_main {\n  set_engine(" << a["node"] << "())\n  set_vehicle(er_vehicle())\n"
                 "  set_transmission(er_transmission())\n}\ner_main()\n";
        } else {
            e << "main()\n";
        }
    }

    es_script::Compiler compiler;
    compiler.initialize(assets.string());
    if (!compiler.compile(entry.string())) {
        std::cerr << "script failed to compile:\n" << compiler.getLastErrorText() << "\n";
        return 1;
    }
    const es_script::Compiler::Output output = compiler.execute();
    compiler.destroy();
    fs::remove(entry);
    Engine *engine = output.engine;
    if (!engine || !output.vehicle || !output.transmission) { std::cerr << "script made no engine/vehicle/transmission\n"; return 1; }

    Simulator *sim = engine->createSimulator(output.vehicle, output.transmission, rate);
    engine->calculateDisplacement();
    sim->setSimulationFrequency(engine->getSimulationFrequency());
    sim->setTargetSynthesizerLatency(0.05);
    sim->setSynthesizerLatencyCorrectionEnabled(false);
    sim->setMaximumSynthesizerInputLatency(10.0);
    for (int i = 0; i < engine->getExhaustSystemCount(); ++i) {
        ImpulseResponse *ir = engine->getExhaustSystem(i)->getImpulseResponse();
        if (!ir) continue;
        std::vector<int16_t> pcm;
        bool ok = false;
        for (const fs::path &p : { fs::path(ir->getFilename()), assets / ir->getFilename(),
                                   assets / "es" / "sound-library" / ir->getFilename() }) {
            if (fs::exists(p) && readWavMono16(p, rate, pcm)) { ok = true; break; }
        }
        if (ok) sim->synthesizer().initializeImpulseResponse(pcm.data(), static_cast<unsigned>(pcm.size()), ir->getVolume(), i);
        else std::cerr << "warning: impulse response not found: " << ir->getFilename() << "\n";
    }
    sim->startAudioRenderingThread();
    engine->getIgnitionModule()->m_enabled = true;

    const double redline = units::toRpm(engine->getRedline());
    const int from = a.count("from") ? std::stoi(a["from"]) : 1000;
    const int to = a.count("to") ? std::stoi(a["to"]) : static_cast<int>(std::floor(redline / 250) * 250);
    const int step = a.count("step") ? std::stoi(a["step"]) : 500;
    const double dt = 1.0 / 60.0;
    /* layers: name → throttle (speed control 0..1); default on = 1, off = 0. --layers "on:1,half:0.5,off:0" */
    std::vector<std::pair<std::string, double>> layers = { { "on", 1.0 }, { "off", 0.0 } };
    if (a.count("layers")) {
        layers.clear();
        std::stringstream ls(a["layers"]);
        std::string item;
        while (std::getline(ls, item, ',')) {
            const auto c = item.find(':');
            if (c != std::string::npos) layers.emplace_back(item.substr(0, c), std::stod(item.substr(c + 1)));
        }
    }

    std::vector<int16_t> scratch(4096);
    /* the dyno speed ramps to its target (snapping a running engine from idle to a far rpm can make the
       simulation blow up) */
    double dynoTarget = 0, dynoSpeed = 0;
    const double dynoRamp = units::rpm(5000);
    auto goTo = [&](int rpm) { dynoTarget = units::rpm(rpm); };
    // one frame of simulation, then collect exactly the audio it produced
    auto frame = [&](std::vector<int16_t> *keep) {
        if (sim->m_dyno.m_enabled) {
            dynoSpeed += std::max(-dynoRamp * dt, std::min(dynoRamp * dt, dynoTarget - dynoSpeed));
            sim->m_dyno.m_rotationSpeed = dynoSpeed;
        }
        sim->startFrame(dt);
        while (sim->simulateStep()) {}
        sim->endFrame();
        const int expect = static_cast<int>(std::lround(sim->getSynthesizerInputLatency() * rate));
        int got = 0;
        const auto t0 = std::chrono::steady_clock::now();
        while (got < expect) {
            const int n = sim->readAudioOutput(std::min(4096, expect - got), scratch.data());
            if (n > 0) { if (keep) keep->insert(keep->end(), scratch.begin(), scratch.begin() + n); got += n; continue; }
            if (std::chrono::steady_clock::now() - t0 > std::chrono::seconds(2)) break;
            std::this_thread::sleep_for(std::chrono::microseconds(100));
        }
    };

    /* start it like a driver: the starter turns it the right way until it runs, then the dyno takes over (a dyno
       spinning a stopped engine can turn it backwards: then the valves and sparks never line up and it never fires) */
    engine->setSpeedControl(0.1);
    sim->m_starterMotor.m_enabled = true;
    for (int i = 0; i < 90; ++i) frame(nullptr);
    sim->m_starterMotor.m_enabled = false;
    for (int i = 0; i < 60; ++i) frame(nullptr);
    std::printf("%s: started, idling at %.0f rpm (%s)\n", name.c_str(), engine->getRpm(), engine->isSpinningCw() ? "cw" : "ccw");
    dynoSpeed = units::rpm(engine->getRpm());
    dynoTarget = dynoSpeed;
    sim->m_dyno.m_enabled = true;
    sim->m_dyno.m_hold = true;

    /* --rpms "900,1100,…" overrides from / to / step */
    std::vector<int> rpms;
    if (a.count("rpms")) {
        std::stringstream rs(a["rpms"]);
        std::string item;
        while (std::getline(rs, item, ',')) rpms.push_back(std::stoi(item));
    } else {
        for (int r = from; r <= to; r += step) rpms.push_back(r);
    }
    /* fixed gain: leveller min = max = gain. First pass at a low gain finds the loudest peak. */
    auto setGain = [&](float g) {
        Synthesizer::AudioParameters p = sim->synthesizer().getAudioParameters();
        p.levelerMinGain = g; p.levelerMaxGain = g;
        sim->synthesizer().setAudioParameters(p);
    };
    /* probe at 5 rpm points, both throttle ends; lower the probe gain until nothing clips, then leave ~12 dB of
       headroom (points between the probes can be louder; the pack is normalised afterwards) */
    const int lo = rpms.front(), hi = rpms.back();
    float probe = 0.02f;
    double loudest = 0;
    for (int attempt = 0; attempt < 6; ++attempt) {
        setGain(probe);
        loudest = 0;
        for (int k = 0; k <= 4; ++k) {
            const int rpm = lo + (hi - lo) * k / 4;
            for (double throttle : { 1.0, 0.0 }) {
                goTo(rpm);
                engine->setSpeedControl(throttle);
                for (int i = 0; i < static_cast<int>(warmup / dt) || std::abs(dynoSpeed - dynoTarget) > 1e-6; ++i) frame(nullptr);
                std::vector<int16_t> pcm;
                for (int i = 0; i < 45; ++i) frame(&pcm);
                for (int16_t v : pcm) loudest = std::max(loudest, std::abs(v / 32768.0));
            }
        }
        if (loudest < 0.5) break;
        probe /= 8;
    }
    const float gain = loudest > 0 ? static_cast<float>(probe * 0.25 / loudest) : 1.0f;
    setGain(gain);
    std::printf("%s: fixed gain %.4f (loudest probe peak %.3f at gain %.2f)\n", name.c_str(), gain, loudest, probe);

    std::ostringstream meta;
    meta << "{\n  \"name\": \"" << name << "\",\n  \"engine\": \"" << engine->getName() << "\",\n  \"script\": \""
         << a["script"] << "\",\n  \"redline\": " << std::lround(redline) << ",\n  \"rate\": " << rate
         << ",\n  \"cylinders\": " << engine->getCylinderCount() << ",\n  \"gain\": " << gain << ",\n  \"samples\": [";
    bool first = true;
    for (int rpm : rpms) {
        for (const auto &[layer, throttle] : layers) {
            goTo(rpm);
            engine->setSpeedControl(throttle);
            for (int i = 0; i < static_cast<int>(warmup / dt) || std::abs(dynoSpeed - dynoTarget) > 1e-6; ++i) frame(nullptr);
            std::vector<int16_t> pcm;
            for (int i = 0; i < static_cast<int>(seconds / dt); ++i) frame(&pcm);
            const double measured = engine->getRpm();
            if (!std::isfinite(measured) || std::abs(measured - rpm) > 0.05 * rpm) {
                std::fprintf(stderr, "%s: the simulation went unstable at %d rpm %s (measured %g); stopping\n", name.c_str(), rpm, layer.c_str(), measured);
                return 1;
            }
            const fs::path file = outDir / (name + "_" + std::to_string(rpm) + "_" + layer + ".wav");
            writeWav(file, pcm, rate);
            double peak = 0, sum = 0;
            int clipped = 0;
            for (int16_t s : pcm) {
                peak = std::max(peak, std::abs(s / 32768.0)); sum += (s / 32768.0) * (s / 32768.0);
                if (s >= 32766 || s <= -32767) ++clipped;
            }
            const double rms = pcm.empty() ? 0 : std::sqrt(sum / pcm.size());
            std::printf("%s %5d rpm %-4s  measured %5.0f rpm  %5.2f s  rms %.3f peak %.3f clipped %d  dyno %6.1f Nm  plate %.3f\n", name.c_str(), rpm,
                        layer.c_str(), engine->getRpm(), pcm.size() / static_cast<double>(rate), rms, peak, clipped,
                        sim->getFilteredDynoTorque(), engine->getThrottle());
            std::fflush(stdout);
            meta << (first ? "" : ",") << "\n    { \"rpm\": " << rpm << ", \"layer\": \"" << layer << "\", \"file\": \""
                 << file.filename().string() << "\", \"rms\": " << rms << ", \"measuredRpm\": " << std::lround(engine->getRpm()) << " }";
            first = false;
        }
    }
    meta << "\n  ]\n}\n";
    std::ofstream(outDir / (name + ".json")) << meta.str();

    sim->endAudioRenderingThread();
    sim->releaseSimulation();
    return 0;
}
