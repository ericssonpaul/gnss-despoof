#include "config.hpp"

#include <yaml-cpp/yaml.h>

#include <stdexcept>

namespace detector {

AppConfig load_config(const std::string& path)
{
    try {
        YAML::Node root = YAML::LoadFile(path);

        AppConfig cfg;
        if (const auto ws = root["ws"]) {
            cfg.ws_port = ws["port"].as<uint16_t>(cfg.ws_port);
            cfg.static_root = ws["static_root"].as<std::string>(cfg.static_root);
        }

        for (const auto& node : root["receivers"]) {
            ReceiverConfig r;
            r.name = node["name"].as<std::string>();  // required, no fallback
            r.host = node["host"].as<std::string>(r.host);
            r.synchro_udp_port = node["synchro_udp_port"].as<uint16_t>(r.synchro_udp_port);
            r.pvt_udp_port = node["pvt_udp_port"].as<uint16_t>(r.pvt_udp_port);
            r.telecommand_tcp_port = node["telecommand_tcp_port"].as<uint16_t>(r.telecommand_tcp_port);
            cfg.receivers.push_back(std::move(r));
        }

        if (cfg.receivers.empty()) {
            throw std::runtime_error("config: " + path + " lists no entries under 'receivers:'");
        }

        return cfg;
    } catch (const YAML::Exception& e) {
        throw std::runtime_error("config: failed to parse " + path + ": " + e.what());
    }
}

}  // namespace detector
