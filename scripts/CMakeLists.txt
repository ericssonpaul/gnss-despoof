# Custom targets wrapping the Python IQ-generation scripts.
# Nothing here compiles; these targets just orchestrate gps-sdr-sim,
# motion_profiles.py, and combine_iq.py to produce test fixtures under
# ${CMAKE_BINARY_DIR}/iq_samples.

find_package(Python3 COMPONENTS Interpreter REQUIRED)

set(SCRIPTS_DIR ${CMAKE_CURRENT_SOURCE_DIR})
set(IQ_OUTPUT_DIR ${CMAKE_BINARY_DIR}/iq_samples)
file(MAKE_DIRECTORY ${IQ_OUTPUT_DIR})

add_custom_target(generate_iq_samples
    COMMAND ${Python3_EXECUTABLE} ${SCRIPTS_DIR}/generate_iq_samples.py
            --output-dir ${IQ_OUTPUT_DIR}
            --gps-sdr-sim-bin ${GPS_SDR_SIM_BIN}
    DEPENDS gps_sdr_sim
    COMMENT "Generates IQ samples for testing"
    VERBATIM
)