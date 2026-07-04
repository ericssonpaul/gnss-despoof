cmake_minimum_required(VERSION 3.20)
project(gnss-despoof VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

option(BUILD_TESTS    "Build unit tests"                  OFF)
option(BUILD_FRONTEND "Build/bundle the web frontend"     ON)

add_subdirectory(external)   # git submodules (gps-sdr-sim, vendored libs)
add_subdirectory(scripts)    # IQ generation custom targets
add_subdirectory(detector)   # detection engine + backend server

if(BUILD_FRONTEND)
  add_subdirectory(frontend) # web UI, built via npm, hosted by the backend
endif()