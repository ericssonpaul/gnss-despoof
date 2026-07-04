#ifndef _DETECTOR_WS_SERVER_H
#define _DETECTOR_WS_SERVER_H

#include <cstdint>
#include <memory>
#include <string>

#include "snapshot.hpp"

namespace detector {

// Owns the uWS::App: the WebSocket route browsers subscribe to for
// snapshot pushes, and a hand-rolled static-file route serving the
// frontend's build output from the same port.
//
// uWS types are hidden behind a pimpl so nothing outside this .cpp needs
// to include the (heavy, template-based) uWS headers.
class WsServer {
public:
    WsServer(uint16_t port, std::string static_root);
    ~WsServer();

    WsServer(const WsServer&) = delete;
    WsServer& operator=(const WsServer&) = delete;

    // Publishes a snapshot to every connected browser client. Safe to call
    // from ANY thread - internally hands off to the event-loop thread via
    // uWS::Loop::defer(), since uWS requires all socket writes to happen
    // there. This is what makes Aggregator's "push immediately on every
    // fresh PVT/synchro update" model safe.
    void publish(const Snapshot& snapshot);

    // Starts listening and blocks running the event loop. Call this last,
    // from whichever thread should own the server for its lifetime.
    void run();

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace detector

#endif
