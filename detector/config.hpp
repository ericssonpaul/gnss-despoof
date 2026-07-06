#ifndef _DETECTOR_CONFIG_H
#define _DETECTOR_CONFIG_H

#include <cstdint>
#include <string>
#include <vector>

namespace detector {

// One GNSS-SDR instance to connect to. Mirrors
// gnss_sdr_wrapper::ReceiverLink::Config, kept separate so config.hpp doesn't
// need to include the wrapper header.
struct ReceiverConfig {
    std::string name;
    std::string host = "127.0.0.1";
    uint16_t synchro_udp_port = 1323;
    uint16_t pvt_udp_port = 1324;
    uint16_t telecommand_tcp_port = 1325;
};

struct AppConfig {
    uint16_t ws_port = 8080;
    std::string static_root = "frontend/dist";
    std::vector<ReceiverConfig> receivers;
};

// Throws std::runtime_error (wrapping yaml-cpp's own exception) if the file
// is missing, malformed, or lists zero receivers.
AppConfig load_config(const std::string& path);

}  // namespace detector

#endif
