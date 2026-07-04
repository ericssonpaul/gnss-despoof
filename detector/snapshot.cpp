#include "snapshot.hpp"

#include <nlohmann/json.hpp>

namespace detector {

std::string to_json(const Snapshot& snap)
{
    nlohmann::json j;

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

    auto events = nlohmann::json::array();
    for (const auto& e : snap.events) {
        events.push_back({{"text", e.text}, {"alert", e.alert}});
    }
    j["detector"] = {
        {"posture",
         {{"d1", snap.posture.d1}, {"d2", snap.posture.d2}, {"d3", snap.posture.d3}, {"d4", snap.posture.d4}}},
        {"events", std::move(events)},
    };

    return j.dump();
}

}  // namespace detector
