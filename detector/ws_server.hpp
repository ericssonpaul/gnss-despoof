#ifndef _DETECTOR_WS_SERVER_H
#define _DETECTOR_WS_SERVER_H

#include <cstdint>
#include <memory>
#include <string>

#include "detection_engine.hpp"
#include "snapshot.hpp"

namespace detector {

// Owns the uWS::App: the WebSocket route browsers subscribe to for
// snapshot/detection pushes, and a hand-rolled static-file route serving
// the frontend's build output from the same port.
//
// uWS types are hidden behind a pimpl so nothing outside this .cpp needs
// to include the (heavy, template-based) uWS headers.
class WsServer {
public:
    WsServer(uint16_t port, std::string static_root);
    ~WsServer();

    WsServer(const WsServer&) = delete;
    WsServer& operator=(const WsServer&) = delete;

    // Publishes a receiver's raw telemetry to every connected browser
    // client. Safe to call from ANY thread - internally hands off to the
    // event-loop thread via uWS::Loop::defer(), since uWS requires all
    // socket writes to happen there. This is what makes Aggregator's "push
    // immediately on every fresh PVT/synchro update" model safe.
    void publish(const Snapshot& snapshot);

    // Publishes one DetectionEngine cycle's consolidated verdict, on its
    // own topic (separate from publish() above) so the frontend can tell
    // "one receiver's telemetry" apart from "fleet-wide detection result"
    // without needing a type tag in every message. Same thread-safety as
    // publish().
    void publish_detection(const DetectionResult& result);

    // Starts listening and blocks running the event loop. Call this last,
    // from whichever thread should own the server for its lifetime.
    void run();

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace detector

#endif
