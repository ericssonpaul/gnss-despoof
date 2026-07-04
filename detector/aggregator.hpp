#ifndef _DETECTOR_AGGREGATOR_H
#define _DETECTOR_AGGREGATOR_H

#include <chrono>
#include <functional>
#include <map>
#include <mutex>
#include <string>

#include "detector.hpp"
#include "snapshot.hpp"

namespace detector {

// Owns the "current known state of the receiver" cache: the latest PVT fix
// and the latest reading per tracking channel. Fed directly by
// ReceiverLink's callbacks, which fire on its background UDP-reader
// threads - everything here is mutex-protected accordingly.
//
// Every update immediately builds a fresh Snapshot and hands it to
// on_publish's callback - nothing waits for a timer tick, so latency is
// bounded only by GNSS-SDR's own output rate, not a polling interval.
class Aggregator {
public:
    using PublishCallback = std::function<void(const Snapshot&)>;

    Aggregator(std::string receiver_name, std::string session_id);

    // Register where a fresh Snapshot should go once built - wired to
    // WsServer::publish in main.cpp. Call before on_pvt/on_synchro fire.
    void on_publish(PublishCallback callback);

    // Signatures match ReceiverLink::on_pvt/on_synchro exactly, so these
    // are registered directly with a ReceiverLink in main.cpp with no
    // adapter code needed.
    void on_pvt(const PVT_State& pvt);
    void on_synchro(uint32_t channel_id, const SYNCRO_State& synchro);

private:
    Snapshot build_snapshot_locked() const;
    void publish_locked();

    std::string receiver_name_;
    std::string session_id_;
    std::chrono::steady_clock::time_point session_start_;

    mutable std::mutex mutex_;
    bool has_pvt_ = false;
    PVT_State latest_pvt_{};
    std::map<uint32_t, SYNCRO_State> latest_synchro_;  // keyed by channel_id

    PublishCallback publish_callback_;
};

}  // namespace detector

#endif
