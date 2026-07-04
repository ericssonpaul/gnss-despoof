// Entry point. Deliberately thin: this file only wires ReceiverLink ->
// Aggregator -> WsServer together and runs the event loop. Real logic
// lives in aggregator.cpp/ws_server.cpp/snapshot.cpp - see the comms
// protocol plan for why.
//
// Usage: detector_core [ws_port] [static_root]
//   ws_port      default 8080
//   static_root  default "frontend/dist", relative to the working directory

#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>

#include "aggregator.hpp"
#include "gnss-sdr-protobuf-wrapper.hpp"
#include "ws_server.hpp"

namespace {

std::string make_session_id()
{
    auto now = std::chrono::system_clock::now().time_since_epoch();
    return std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(now).count());
}

}  // namespace

int main(int argc, char** argv)
{
    uint16_t ws_port = argc > 1 ? static_cast<uint16_t>(std::atoi(argv[1])) : 8080;
    std::string static_root = argc > 2 ? argv[2] : "frontend/dist";

    detector::Aggregator aggregator("gnss-sdr-1", make_session_id());
    detector::WsServer ws_server(ws_port, static_root);
    aggregator.on_publish([&ws_server](const detector::Snapshot& snapshot) { ws_server.publish(snapshot); });

    gnss_sdr_wrapper::ReceiverLink::Config link_config{};
    gnss_sdr_wrapper::ReceiverLink link(link_config);
    link.on_pvt([&aggregator](const detector::PVT_State& pvt) { aggregator.on_pvt(pvt); });
    link.on_synchro([&aggregator](uint32_t channel_id, const detector::SYNCRO_State& synchro) {
        aggregator.on_synchro(channel_id, synchro);
    });

    std::cout << "detector_core: connecting to GNSS-SDR at " << link_config.host
              << " (synchro:" << link_config.synchro_udp_port << " pvt:" << link_config.pvt_udp_port
              << " telecommand:" << link_config.telecommand_tcp_port << ")" << std::endl;
    link.start();

    ws_server.run();  // blocks

    link.stop();
    return 0;
}
