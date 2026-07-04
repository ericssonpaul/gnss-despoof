#ifndef GNSS_SDR_PROTOBUF_WRAPPER_H
#define GNSS_SDR_PROTOBUF_WRAPPER_H

// Reads GNSS-SDR's three live interfaces and hands back plain detector::
// structs, so the rest of the detector program never touches protobuf,
// sockets, or threads directly:
//
//   - Observables (per-channel GnssSynchro) over UDP  -- Monitor.udp_port
//   - MonitorPvt over UDP                             -- PVT.monitor_udp_port
//   - the line-based telecommand interface over TCP    -- GNSS-SDR.telecommand_tcp_port
//
// Wire framing, confirmed from upstream gnss-sdr sources (not boost::asio,
// which upstream uses but this module deliberately avoids):
//   - gnss_synchro_udp_sink.cc / monitor_pvt_udp_sink.cc: each write is one
//     serialized protobuf message in a single UDP send_to() call, so a UDP
//     datagram *is* a message - no length prefix to parse.
//   - tcp_cmd_interface.cc: a persistent TCP connection, one newline-
//     terminated command per line in, a text response back. The response
//     itself has no explicit terminator in the protocol (the server just
//     write_some()s whatever the command handler built), so send_command()
//     collects bytes until a quiet period elapses.
//
// Everything here is POSIX sockets + std::thread; no boost.

#include "detector.hpp"
#include "gnss_synchro.pb.h"
#include "monitor_pvt.pb.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace gnss_sdr_wrapper {

// Binds a UDP socket and decodes one `Message` protobuf object per received
// datagram on a dedicated background thread, invoking `callback` for each.
// stop()/destruction is responsive (bounded by the socket receive timeout)
// rather than blocking forever in recv().
template <typename Message>
class UdpProtoStream
{
public:
    using Callback = std::function<void(const Message&)>;

    UdpProtoStream(std::string bind_addr, uint16_t port, Callback callback);
    ~UdpProtoStream();

    UdpProtoStream(const UdpProtoStream&) = delete;
    UdpProtoStream& operator=(const UdpProtoStream&) = delete;

    // Opens the socket and starts the reader thread. Throws std::runtime_error
    // on socket/bind failure.
    void start();
    // Idempotent; safe to call from any thread, including from within the
    // callback itself.
    void stop();

private:
    void run();

    std::string bind_addr_;
    uint16_t port_;
    Callback callback_;
    int sock_ = -1;
    std::thread thread_;
    std::atomic<bool> running_{false};
};

// Blocking client for GNSS-SDR's line-based TCP telecommand interface.
// One TelecommandClient per connection; not thread-safe on its own
// (ReceiverLink serializes access with its own mutex).
class TelecommandClient
{
public:
    TelecommandClient(std::string host, uint16_t port);
    ~TelecommandClient();

    TelecommandClient(const TelecommandClient&) = delete;
    TelecommandClient& operator=(const TelecommandClient&) = delete;

    bool connect();
    void disconnect();
    bool connected() const { return sock_ >= 0; }

    // Sends "<cmd>\n" and reads back whatever the server writes within
    // response_timeout of the last received byte (see framing note above).
    // Returns an empty string on any I/O failure.
    std::string send_command(const std::string& cmd,
        std::chrono::milliseconds response_timeout = std::chrono::milliseconds(200));

private:
    std::string host_;
    uint16_t port_;
    int sock_ = -1;
};

// Ties one GNSS-SDR instance's three interfaces together for a single
// logical receiver session. Register callbacks, call start(); parsed data
// arrives as plain detector:: structs on the UDP reader threads.
//
// Routing the resulting structs into a detector::GNSS_SDR_Server (which
// constellation vector, PVT history, etc.) is left to the caller - this
// class's job stops at "read the wire, hand back a struct".
class ReceiverLink
{
public:
    struct Config
    {
        std::string host = "127.0.0.1";
        uint16_t synchro_udp_port = 1323;      // Monitor.udp_port
        uint16_t pvt_udp_port = 1324;          // PVT.monitor_udp_port
        uint16_t telecommand_tcp_port = 1325;  // GNSS-SDR.telecommand_tcp_port
    };

    // channel_id comes straight from GnssSynchro.channel_id (int32 on the
    // wire; GNSS_channels keys on uint32_t, so callers get both forms).
    using SynchroCallback = std::function<void(uint32_t channel_id, const detector::SYNCRO_State&)>;
    using PvtCallback = std::function<void(const detector::PVT_State&)>;

    explicit ReceiverLink(Config cfg);
    ~ReceiverLink();

    ReceiverLink(const ReceiverLink&) = delete;
    ReceiverLink& operator=(const ReceiverLink&) = delete;

    // Register before start(); callbacks run on the corresponding UDP
    // reader thread, not the caller's thread - marshal to your own queue
    // if you need delivery on a specific thread.
    void on_synchro(SynchroCallback cb);
    void on_pvt(PvtCallback cb);

    void start();
    void stop();

    // Synchronous, on demand. Opens the TCP connection lazily on first use
    // and keeps it open across calls; reconnects if the peer dropped it.
    std::string send_telecommand(const std::string& cmd);

private:
    static detector::SYNCRO_State to_state(const gnss_sdr::GnssSynchro& g);
    static detector::PVT_State to_state(const gnss_sdr::MonitorPvt& p);

    Config cfg_;

    std::mutex cb_mutex_;
    SynchroCallback synchro_cb_;
    PvtCallback pvt_cb_;

    std::unique_ptr<UdpProtoStream<gnss_sdr::Observables>> synchro_stream_;
    std::unique_ptr<UdpProtoStream<gnss_sdr::MonitorPvt>> pvt_stream_;

    std::mutex telecommand_mutex_;
    std::unique_ptr<TelecommandClient> telecommand_;
};

}  // namespace gnss_sdr_wrapper

#endif  // GNSS_SDR_PROTOBUF_WRAPPER_H
