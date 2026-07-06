// Entry point. Deliberately thin: this file only reads the config, wires
// ReceiverLink -> {Aggregator, DetectionEngine} -> WsServer together per
// configured receiver, registers Units with the DetectionEngine, and runs
// the event loop. Real logic lives in aggregator.cpp/detection_engine.cpp/
// ws_server.cpp/snapshot.cpp/config.cpp - see the comms protocol plan for
// why.
//
// Usage: detector_core [config_path]
//   config_path  default "config/detector.yaml", relative to the working directory

#include <chrono>
#include <cstdint>
#include <exception>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#include "aggregator.hpp"
#include "config.hpp"
#include "cycle_slip.hpp"
#include "detection_engine.hpp"
#include "gnss-sdr-protobuf-wrapper.hpp"
#include "raim.hpp"
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
    std::string config_path = argc > 1 ? argv[1] : "config/detector.yaml";

    detector::AppConfig config;
    try {
        config = detector::load_config(config_path);
    } catch (const std::exception& e) {
        std::cerr << "detector_core: " << e.what() << std::endl;
        return 1;
    }

    detector::WsServer ws_server(config.ws_port, config.static_root);

    detector::DetectionEngine engine;
    engine.add_unit(std::make_unique<detector::RAIM>());
    engine.add_unit(std::make_unique<detector::CycleSlip>());
    engine.on_result([&ws_server](const detector::DetectionResult& result) { ws_server.publish_detection(result); });

    // Kept alive for the process lifetime: Aggregator's on_publish callback
    // and ReceiverLink's on_pvt/on_synchro callbacks hold raw pointers into
    // these, and both keep running in the background until ws_server.run()
    // returns.
    std::vector<std::unique_ptr<detector::Aggregator>> aggregators;
    std::vector<std::unique_ptr<gnss_sdr_wrapper::ReceiverLink>> links;

    for (const auto& r : config.receivers) {
        auto aggregator = std::make_unique<detector::Aggregator>(r.name, make_session_id());
        aggregator->on_publish([&ws_server](const detector::Snapshot& snapshot) { ws_server.publish(snapshot); });

        // Registered with the engine (not just the aggregator above) so
        // Units get a rolling history for this receiver - see
        // receiver_history.hpp for why this is a separate cache from
        // Aggregator's latest-value-only one.
        detector::ReceiverHistory& history = engine.add_receiver(r.name);

        gnss_sdr_wrapper::ReceiverLink::Config link_config{};
        link_config.host = r.host;
        link_config.synchro_udp_port = r.synchro_udp_port;
        link_config.pvt_udp_port = r.pvt_udp_port;
        link_config.telecommand_tcp_port = r.telecommand_tcp_port;

        auto link = std::make_unique<gnss_sdr_wrapper::ReceiverLink>(link_config);
        detector::Aggregator* agg = aggregator.get();
        link->on_pvt([agg, &history](const detector::PVT_State& pvt) {
            agg->on_pvt(pvt);
            history.push_pvt(pvt);
        });
        link->on_synchro([agg, &history](uint32_t channel_id, const detector::SYNCRO_State& synchro) {
            agg->on_synchro(channel_id, synchro);
            history.push_synchro(channel_id, synchro);
        });

        std::cout << "detector_core: connecting to GNSS-SDR '" << r.name << "' at " << r.host
                  << " (synchro:" << r.synchro_udp_port << " pvt:" << r.pvt_udp_port
                  << " telecommand:" << r.telecommand_tcp_port << ")" << std::endl;
        link->start();

        aggregators.push_back(std::move(aggregator));
        links.push_back(std::move(link));
    }

    engine.start();
    ws_server.run();  // blocks

    engine.stop();
    for (auto& link : links) link->stop();
    return 0;
}
