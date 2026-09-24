# Offline engine-sound renderer: records Engine Simulator (AngeTheGreat, MIT) engines held at fixed rpm on its dyno.
#   cmake -S tools/engine-render -B _local/engine-render-build -DENGINE_SIM_DIR=<engine-sim checkout> -DCMAKE_BUILD_TYPE=Release
#   cmake --build _local/engine-render-build -j
# See tools/engine-render/README.md.
cmake_minimum_required(VERSION 3.24)
project(engine_render LANGUAGES CXX)

set(ENGINE_SIM_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../_local/engine-sim" CACHE PATH "Engine Simulator source checkout")
set(ENGINE_SIM_BUILD_SCRIPTING ON CACHE BOOL "" FORCE)
set(ENGINE_SIM_BUILD_DESKTOP OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
add_subdirectory("${ENGINE_SIM_DIR}" engine-sim EXCLUDE_FROM_ALL)

add_executable(engine-render render.cpp)
target_link_libraries(engine-render PRIVATE engine-sim::scripting)
target_compile_features(engine-render PRIVATE cxx_std_17)
