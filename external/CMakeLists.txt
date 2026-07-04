# Git submodules live directly under external/<name>.
# Initialize with: git submodule update --init --recursive

set(EXTERNAL_DIR ${CMAKE_CURRENT_SOURCE_DIR})

# --- gps-sdr-sim: synthetic IQ generator -----------------------------------
# Ships a plain Makefile, no CMake support, so wrap it as a custom target
# instead of add_subdirectory().
set(GPS_SDR_SIM_DIR ${EXTERNAL_DIR}/gps-sdr-sim)
set(GPS_SDR_SIM_BIN ${GPS_SDR_SIM_DIR}/gps-sdr-sim)

# USER_MOTION_SIZE caps dynamic-mode (-x) motion files at that many 10Hz rows
# (default 3000 -> 300s). config/iq-sample-config.yaml's longest motion file
# is 340s; 10000 leaves headroom for longer ones later. Note gpssim.c has a
# separate stack-smashing bug (unrelated to this constant) past ~400s in any
# single invocation, static or dynamic - keep scenario durations under that.
add_custom_command(
  OUTPUT ${GPS_SDR_SIM_BIN}
  COMMAND make USER_MOTION_SIZE=10000
  WORKING_DIRECTORY ${GPS_SDR_SIM_DIR}
  COMMENT "Building gps-sdr-sim"
  VERBATIM
)
add_custom_target(gps_sdr_sim ALL DEPENDS ${GPS_SDR_SIM_BIN})

# --- GNSS-SDR: the software GNSS receiver -----------------------------------
# Vendored because most users won't have it installed. It's a full CMake
# project with its own heavy dependency chain (GNU Radio, VOLK, gflags,
# glog, armadillo, matio, Boost, protobuf) -- built out-of-tree via
# ExternalProject_Add rather than add_subdirectory() to avoid colliding
# with this project's own targets/variables. It's a separate runtime
# process (talks to detector_core over ZMQ), so nothing here links against it.
option(BUILD_GNSS_SDR "Build vendored GNSS-SDR from source" ON)

if(BUILD_GNSS_SDR)
  include(ExternalProject)
  ExternalProject_Add(gnss-sdr
    SOURCE_DIR ${EXTERNAL_DIR}/gnss-sdr
    CMAKE_ARGS
      -DCMAKE_BUILD_TYPE=Release
      -DENABLE_TESTS=OFF
      -DENABLE_GPERFTOOLS=OFF
    BUILD_ALWAYS OFF
    INSTALL_COMMAND ""   # run in-place from the build tree; no system install
  )
  # Its own dependencies (GNU Radio, VOLK, gflags, glog, armadillo, matio,
  # Boost) are NOT vendored here -- install those via your package manager;
  # ExternalProject_Add will fail fast with a clear CMake error if missing.
endif()

# --- uWebSockets: WebSocket push server used by detector/ws_server.cpp ----
# Header-only; its uSockets dependency ships a Makefile and is built directly
# in detector/CMakeLists.txt where the resulting static lib is consumed.

# Expose the binary path to sibling directories (scripts/, detector/)
set(GPS_SDR_SIM_BIN ${GPS_SDR_SIM_BIN} CACHE INTERNAL "gps-sdr-sim binary path")

# --- Optional vendored libs -------------------------------------------------
# Only pulled in if the submodule is present; otherwise detector/CMakeLists.txt
# falls back to find_package() against system-installed versions.
if(EXISTS ${EXTERNAL_DIR}/cppzmq/CMakeLists.txt)
  set(CPPZMQ_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  add_subdirectory(cppzmq)
endif()

if(EXISTS ${EXTERNAL_DIR}/yaml-cpp/CMakeLists.txt)
  set(YAML_CPP_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  add_subdirectory(yaml-cpp)
endif()
