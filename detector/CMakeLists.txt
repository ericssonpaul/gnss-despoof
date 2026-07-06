# Detection engine + backend server.

# gnss_sdr_protobuf_wrapper: reads GNSS-SDR's Observables/MonitorPvt UDP
# streams and telecommand TCP interface (see gnss-sdr-protobuf-wrapper.hpp)
# and converts them into detector:: structs. POSIX sockets + std::thread +
# protobuf only - no boost, unlike upstream gnss-sdr's own sinks.
find_package(Protobuf REQUIRED)
find_package(Threads REQUIRED)
find_package(ZLIB REQUIRED)  # uWS's permessage-deflate machinery needs it
                              # to link even when a route disables compression

set(WRAPPER_PROTO_FILES
    proto/gnss_synchro.proto
    proto/monitor_pvt.proto
)
protobuf_generate_cpp(WRAPPER_PROTO_SRCS WRAPPER_PROTO_HDRS ${WRAPPER_PROTO_FILES})

add_library(gnss_sdr_protobuf_wrapper STATIC
    gnss-sdr-protobuf-wrapper.cpp
    ${WRAPPER_PROTO_SRCS}
)
target_include_directories(gnss_sdr_protobuf_wrapper PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_BINARY_DIR}
)
target_link_libraries(gnss_sdr_protobuf_wrapper PUBLIC
    protobuf::libprotobuf
    Threads::Threads
)

# --- uSockets: uWebSockets' C dependency ------------------------------------
# Ships a plain Makefile (like gps-sdr-sim); its single consumer is
# ws_server.cpp, so unlike gps-sdr-sim's build step this lives here rather
# than in external/CMakeLists.txt. LIBUS_NO_SSL is the default (no TLS
# backend needed for local dev); WITH_LTO=0 because the resulting LLVM
# bitcode .a isn't linkable by plain `ld` outside a matching LTO pipeline.
set(USOCKETS_DIR ${CMAKE_SOURCE_DIR}/external/uWebSockets/uSockets)
set(USOCKETS_LIB ${USOCKETS_DIR}/uSockets.a)
add_custom_command(
    OUTPUT ${USOCKETS_LIB}
    COMMAND make WITH_LTO=0
    WORKING_DIRECTORY ${USOCKETS_DIR}
    COMMENT "Building uSockets"
    VERBATIM
)
add_custom_target(usockets DEPENDS ${USOCKETS_LIB})

# nlohmann/json: single header, vendored as a submodule (see external/).
set(NLOHMANN_JSON_INCLUDE_DIR ${CMAKE_SOURCE_DIR}/external/nlohmann-json/single_include)

# detector_core: the real backend executable. main.cpp is a thin skeleton -
# see its own header comment - the actual logic is these other sources.
add_executable(detector_core
    main.cpp
    aggregator.cpp
    config.cpp
    cycle_slip.cpp
    detection_engine.cpp
    raim.cpp
    receiver_history.cpp
    snapshot.cpp
    ws_server.cpp
)
add_dependencies(detector_core usockets)
target_include_directories(detector_core PRIVATE
    ${NLOHMANN_JSON_INCLUDE_DIR}
    ${CMAKE_SOURCE_DIR}/external/uWebSockets/src
    ${CMAKE_SOURCE_DIR}/external/uWebSockets/uSockets/src
)
target_link_libraries(detector_core PRIVATE
    gnss_sdr_protobuf_wrapper
    yaml-cpp::yaml-cpp
    ${USOCKETS_LIB}
    Threads::Threads
    ZLIB::ZLIB
)
