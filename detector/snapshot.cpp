#include "snapshot.hpp"

#include <nlohmann/json.hpp>

namespace detector {

std::string to_json(const Snapshot& snap)
{
    nlohmann::json j;

    // Snapshot and DetectionResult land on the same WebSocket connection
    // (different uWS pub/sub topics, but topics aren't visible to the
    // client) - this tag is how WebSocketFeed on the frontend tells the two
    // apart. See detection_engine.cpp's to_json for the other side.
    j["type"] = "snapshot";

    j["receiver"] = {
        {"name", snap.receiver_name},
        {"sessionId", snap.session_id},
        {"sessionTimeS", snap.session_time_s},
    };

    if (snap.has_pvt) {
        j["pvt"] = {
            {"latitude", snap.latitude},
            {"longitude", snap.longitude},
            {"height", snap.height},
            {"velX", snap.vel_x},
            {"velY", snap.vel_y},
            {"velZ", snap.vel_z},
            {"clockOffsetS", snap.clock_offset_s},
            {"gpsWeek", snap.gps_week},
            {"gpsTowS", snap.gps_tow_s},
            {"gdop", snap.gdop},
            {"pdop", snap.pdop},
            {"hdop", snap.hdop},
            {"vdop", snap.vdop},
            {"solutionStatus", snap.solution_status},
            {"solutionType", snap.solution_type},
            {"validSats", snap.valid_sats},
        };
    } else {
        j["pvt"] = nullptr;
    }

    auto sats = nlohmann::json::array();
    for (const auto& s : snap.satellites) {
        sats.push_back({
            {"system", s.system},
            {"signal", s.signal},
            {"prn", s.prn},
            {"channelId", s.channel_id},
            {"cn0DbHz", s.cn0_db_hz},
            {"dopplerHz", s.doppler_hz},
            {"pseudorangeM", s.pseudorange_m},
            {"flagValidPseudorange", s.flag_valid_pseudorange},
            {"flagValidWord", s.flag_valid_word},
            {"flagCycleSlip", s.flag_cycle_slip},
            {"towMs", s.tow_ms},
        });
    }
    j["satellites"] = std::move(sats);

    return j.dump();
}

}  // namespace detector
