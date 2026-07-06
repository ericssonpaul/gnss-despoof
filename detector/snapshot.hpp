#ifndef _DETECTOR_SNAPSHOT_H
#define _DETECTOR_SNAPSHOT_H

#include <cinttypes>
#include <string>
#include <vector>

namespace detector {

// One tracked channel's observables - the curated, flattened wire shape.
// See detector::SYNCRO_State for the fuller struct this is drawn from.
struct SatelliteObservable {
    std::string system;
    std::string signal;
    uint32_t prn = 0;
    int32_t channel_id = 0;
    double cn0_db_hz = 0;
    double doppler_hz = 0;
    double pseudorange_m = 0;
    bool flag_valid_pseudorange = false;
    bool flag_valid_word = false;
    bool flag_cycle_slip = false;
    uint32_t tow_ms = 0;
};

// The full wire payload: one JSON object per WebSocket frame, pushed
// immediately whenever fresh PVT or synchro data arrives (see Aggregator).
struct Snapshot {
    std::string receiver_name;
    std::string session_id;
    double session_time_s = 0.0;

    // False until the first PVT_State has arrived this session.
    bool has_pvt = false;
    double latitude = 0;
    double longitude = 0;
    double height = 0;
    double vel_x = 0;  // ECEF, m/s - PVT_State has no local ENU velocity
    double vel_y = 0;
    double vel_z = 0;
    double clock_offset_s = 0;
    uint32_t gps_week = 0;
    double gps_tow_s = 0;  // seconds since the start of gps_week
    double gdop = 0;
    double pdop = 0;
    double hdop = 0;
    double vdop = 0;
    uint32_t solution_status = 0;
    uint32_t solution_type = 0;
    uint32_t valid_sats = 0;

    std::vector<SatelliteObservable> satellites;

    // Detection posture/events used to live here. Moved to DetectionResult
    // (see detection_engine.hpp): that data is a fleet-wide verdict on the
    // engine's own cycle cadence, not one receiver's own telemetry pushed
    // immediately on every update like the rest of this struct.
};

std::string to_json(const Snapshot& snapshot);

}  // namespace detector

#endif
