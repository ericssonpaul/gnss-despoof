#ifndef _DETECTOR_H
#define _DETECTOR_H

#include <string>
#include <vector>
#include <map>
#include <cinttypes>

namespace detector {

struct PVT_State {
    uint32_t tow_at_current_symbol_ms;  // Time of week of the current symbol, in ms
    uint32_t week;  // PVT GPS week
    double rx_time3;  // PVT GPS time
    double user_clk_offset;  // User clock offset, in s

    double pos_x;  // Position X component in ECEF, expressed in m
    double pos_y;  // Position Y component in ECEF, expressed in m
    double pos_z;  // Position Z component in ECEF, expressed in m
    double vel_x;  // Velocity X component in ECEF, in m/s
    double vel_y;  // Velocity Y component in ECEF, in m/s
    double vel_z;  // Velocity Z component in ECEF, in m/s

    double cov_xx;  // Position variance in the Y component, in m2
    double cov_yy;  // Position variance in the Y component, in m2
    double cov_zz;  // Position variance in the Z component, in m2
    double cov_xy;  // Position XY covariance, in m2
    double cov_yz;  // Position YZ covariance, in m2
    double cov_zx;  // Position ZX covariance, in m2

    double latitude;  // Latitude, in deg. Positive: North
    double longitude;  // Longitude, in deg. Positive: East
    double height;  // Height, in m

    uint32_t valid_sats;  // Number of valid satellites
    uint32_t solution_status;  // RTKLIB solution status
    uint32_t solution_type;  // RTKLIB solution type (0: xyz-ecef, 1: enu-baseline)
    float ar_ratio_factor;  // Ambiguity resolution ratio factor for validation
    float ar_ratio_threshold;  // Ambiguity resolution ratio threshold for validation

    double gdop;  // Geometric Dilution of Precision
    double pdop;  // Position (3D) Dilution of Precision
    double hdop;  // Horizontal Dilution of Precision
    double vdop;  // Vertical Dilution of Precision
};
struct SYNCRO_State {
    std::string system; // GNSS constellation: "G" for GPS, "R" for Glonass, "S" for SBAS, "E" for Galileo and "C" for Beidou.
    std::string signal; // GNSS signal: "1C" for GPS L1 C/A, "1B" for Galileo E1b/c, "1G" for Glonass L1 C/A, "2S" for GPS L2 L2C(M), "2G" for Glonass L2 C/A, "L5" for GPS L5 and "5X" for Galileo E5a

    uint32_t prn; // PRN number
    int32_t channel_id; // Channel number

    double   acq_delay_samples; // Coarse code delay estimation, in samples
    double   acq_doppler_hz;    // Coarse Doppler estimation in each channel, in Hz
    uint64_t acq_samplestamp_samples; // Number of samples at signal SampleStamp
    uint32_t acq_doppler_step; // Step of the frequency bin in the search grid, in Hz
    bool     flag_valid_acquisition; // Acquisition status

    int64_t     fs;             // Sampling frequency, in samples per second
    double      prompt_i;        // In-phase (real) component of the prompt correlator output
    double      prompt_q;        // Quadrature (imaginary) component of the prompt correlator output
    double      cn0_db_hz;       // Carrier-to-Noise density ratio, in dB-Hz
    double      carrier_doppler_hz;  // Doppler estimation, in [Hz].
    double      carrier_phase_rads;  // Carrier phase estimation, in rad
    double      code_phase_samples;  // Code phase in samples
    uint64_t    tracking_sample_counter;  // Sample counter indicating the number of processed samples
    bool        flag_valid_symbol_output;  // Indicates the validity of signal tracking
    int32_t     correlation_length_ms;  // Time duration of coherent correlation integration, in ms

    bool        flag_valid_word;  // Indicates the validity of the decoded navigation message word
    bool        flag_cycle_slip;  // Carrier cycle slip detection flag
    uint32_t    tow_at_current_symbol_ms;  // Time of week of the current symbol, in ms

    double      pseudorange_m;  // Pseudorange computation, in m
    double      rx_time;  // Receiving time after the start of the week, in s
    bool        flag_valid_pseudorange;  // Pseudorange computation status
    double      interp_tow_ms;  // Interpolated time of week, in ms
};
// GNSS_SDR_Server/Unit/RAIM used to be sketched here. Moved out and fleshed
// out as receiver_history.hpp (GNSS_SDR_Server -> ReceiverHistory),
// unit.hpp (Unit, now taking a vector of ReceiverHistory pointers instead
// of by-value GNSS_SDR_Server - see that header for why it changed), and
// raim.hpp - see detection_engine.hpp for how they're run together.

}

#endif