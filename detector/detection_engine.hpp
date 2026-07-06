#ifndef _DETECTOR_DETECTION_ENGINE_H
#define _DETECTOR_DETECTION_ENGINE_H

#include "receiver_history.hpp"
#include "unit.hpp"

#include <atomic>
#include <chrono>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace detector {

// One consolidated verdict for a single DetectionEngine cycle - what
// actually reaches the wire (see WsServer::publish_detection), as opposed
// to the raw per-receiver telemetry Aggregator/Snapshot push immediately on
// every update. Deliberately separate from Snapshot: this is fleet-wide,
// Snapshot is one receiver's own data.
struct DetectionResult {
    double session_time_s = 0.0;
    std::vector<Finding> findings;
};

std::string to_json(const DetectionResult& result);

// Owns every connected receiver's ReceiverHistory plus the registered
// Units, and runs them all on a fixed timer - deliberately NOT event-driven
// like Aggregator, since a Unit sees every receiver at once and firing on
// every single UDP packet from any one of them would let it run against a
// mix of fresh and stale receiver states.
class DetectionEngine {
public:
    using ResultCallback = std::function<void(const DetectionResult&)>;

    explicit DetectionEngine(std::chrono::milliseconds cycle_period = std::chrono::milliseconds(1000));
    ~DetectionEngine();

    DetectionEngine(const DetectionEngine&) = delete;
    DetectionEngine& operator=(const DetectionEngine&) = delete;

    // Registers a receiver's history under this engine and returns a
    // reference stable for the engine's lifetime - wire the same
    // ReceiverLink callbacks that feed a receiver's Aggregator to also feed
    // this. Call before start().
    ReceiverHistory& add_receiver(std::string name, size_t max_history = 300);

    // Call before start().
    void add_unit(std::unique_ptr<Unit> unit);

    // Register where each cycle's consolidated DetectionResult should go -
    // wired to WsServer::publish_detection in main.cpp. Call before start().
    void on_result(ResultCallback callback);

    void start();
    // Blocks up to one cycle_period for the timer thread to notice and
    // exit - fine at this project's scale, but not instant.
    void stop();

private:
    void run();
    // Assumes mutex_ is already held.
    DetectionResult run_cycle_locked();

    std::chrono::milliseconds period_;
    std::chrono::steady_clock::time_point start_time_;

    std::mutex mutex_;
    std::vector<std::unique_ptr<ReceiverHistory>> receivers_;
    std::vector<std::unique_ptr<Unit>> units_;
    ResultCallback callback_;

    std::atomic<bool> running_{false};
    std::thread thread_;
};

}  // namespace detector

#endif
