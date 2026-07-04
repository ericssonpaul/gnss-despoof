#include "ws_server.hpp"

#include <App.h>

#include <fstream>
#include <iostream>
#include <sstream>
#include <string_view>
#include <utility>

namespace detector {

namespace {

constexpr std::string_view kSnapshotTopic = "snapshot";

struct PerSocketData {};

std::string_view mime_type_for(std::string_view path)
{
    auto ends_with = [&](std::string_view suffix) {
        return path.size() >= suffix.size() && path.substr(path.size() - suffix.size()) == suffix;
    };
    if (ends_with(".html")) return "text/html; charset=utf-8";
    if (ends_with(".js")) return "text/javascript; charset=utf-8";
    if (ends_with(".css")) return "text/css; charset=utf-8";
    if (ends_with(".json")) return "application/json; charset=utf-8";
    if (ends_with(".svg")) return "image/svg+xml";
    if (ends_with(".png")) return "image/png";
    if (ends_with(".woff2")) return "font/woff2";
    if (ends_with(".woff")) return "font/woff";
    return "application/octet-stream";
}

// Reads a whole file into memory. Fine at this project's scale (a small
// dev static build) - not meant to scale to large files or heavy concurrent
// load; a real deployment would front this with nginx or similar.
bool read_file(const std::string& path, std::string& out)
{
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    std::ostringstream ss;
    ss << f.rdbuf();
    out = ss.str();
    return true;
}

}  // namespace

struct WsServer::Impl {
    uint16_t port;
    std::string static_root;
    uWS::App app;
    uWS::Loop* loop = nullptr;  // set once run() starts listening; used for cross-thread publish()

    Impl(uint16_t port_, std::string static_root_) : port(port_), static_root(std::move(static_root_)) {}
};

WsServer::WsServer(uint16_t port, std::string static_root) : impl_(std::make_unique<Impl>(port, std::move(static_root)))
{
    impl_->app.ws<PerSocketData>("/ws", {
                                             .compression = uWS::DISABLED,
                                             .maxPayloadLength = 16 * 1024,
                                             .idleTimeout = 30,
                                             .open = [](auto* ws) { ws->subscribe(kSnapshotTopic); },
                                         });

    impl_->app.get("/*", [this](auto* res, auto* req) {
        std::string path(req->getUrl());
        if (path.empty() || path == "/") path = "/index.html";

        std::string body;
        if (!read_file(impl_->static_root + path, body)) {
            // Not a request for a real static asset - fall back to
            // index.html rather than a bare 404. This app has no
            // client-side routing today, but doesn't hurt to be lenient.
            if (!read_file(impl_->static_root + "/index.html", body)) {
                res->writeStatus("404 Not Found")->end("frontend/dist not built - run `npm run build` in frontend/");
                return;
            }
            path = "/index.html";
        }
        res->writeHeader("Content-Type", mime_type_for(path))->end(body);
    });
}

WsServer::~WsServer() = default;

void WsServer::publish(const Snapshot& snapshot)
{
    if (impl_->loop == nullptr) return;  // run() hasn't started listening yet
    std::string payload = to_json(snapshot);
    impl_->loop->defer([this, payload = std::move(payload)]() mutable {
        impl_->app.publish(kSnapshotTopic, payload, uWS::OpCode::TEXT, false);
    });
}

void WsServer::run()
{
    impl_->app.listen(impl_->port, [this](auto* listen_socket) {
        impl_->loop = uWS::Loop::get();
        if (listen_socket) {
            std::cout << "detector_core listening on port " << impl_->port << std::endl;
        } else {
            std::cerr << "detector_core failed to listen on port " << impl_->port << std::endl;
        }
    });
    impl_->app.run();
}

}  // namespace detector
