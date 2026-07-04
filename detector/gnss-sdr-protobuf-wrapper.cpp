#include "gnss-sdr-protobuf-wrapper.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace gnss_sdr_wrapper {

namespace {

constexpr size_t kMaxUdpDatagram = 65536;  // above the 65507-byte UDP payload ceiling

void set_recv_timeout(int sock, std::chrono::milliseconds timeout)
{
    struct timeval tv{};
    tv.tv_sec = static_cast<time_t>(timeout.count() / 1000);
    tv.tv_usec = static_cast<suseconds_t>((timeout.count() % 1000) * 1000);
    ::setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
}

}  // namespace

// ================================================================ UdpProtoStream

template <typename Message>
UdpProtoStream<Message>::UdpProtoStream(std::string bind_addr, uint16_t port, Callback callback)
    : bind_addr_(std::move(bind_addr)), port_(port), callback_(std::move(callback))
{
}

template <typename Message>
UdpProtoStream<Message>::~UdpProtoStream()
{
    stop();
}

template <typename Message>
void UdpProtoStream<Message>::start()
{
    if (running_.load())
        {
            return;
        }

    sock_ = ::socket(AF_INET, SOCK_DGRAM, 0);
    if (sock_ < 0)
        {
            throw std::runtime_error("UdpProtoStream: socket() failed: " + std::string(std::strerror(errno)));
        }

    const int reuse = 1;
    ::setsockopt(sock_, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
    // Bounded so stop() never has to wait for a datagram that may never arrive.
    set_recv_timeout(sock_, std::chrono::milliseconds(200));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port_);
    if (::inet_pton(AF_INET, bind_addr_.c_str(), &addr.sin_addr) != 1)
        {
            ::close(sock_);
            sock_ = -1;
            throw std::runtime_error("UdpProtoStream: invalid bind address '" + bind_addr_ + "'");
        }

    if (::bind(sock_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0)
        {
            const std::string err = std::strerror(errno);
            ::close(sock_);
            sock_ = -1;
            throw std::runtime_error(
                "UdpProtoStream: bind() to " + bind_addr_ + ":" + std::to_string(port_) + " failed: " + err);
        }

    running_.store(true);
    thread_ = std::thread(&UdpProtoStream::run, this);
}

template <typename Message>
void UdpProtoStream<Message>::stop()
{
    if (!running_.exchange(false))
        {
            return;
        }
    if (thread_.joinable())
        {
            thread_.join();
        }
    if (sock_ >= 0)
        {
            ::close(sock_);
            sock_ = -1;
        }
}

template <typename Message>
void UdpProtoStream<Message>::run()
{
    std::vector<char> buf(kMaxUdpDatagram);
    while (running_.load())
        {
            const ssize_t n = ::recv(sock_, buf.data(), buf.size(), 0);
            if (n < 0)
                {
                    // EAGAIN/EWOULDBLOCK is just the receive timeout expiring so we
                    // can re-check running_ - not a real error.
                    if (errno != EAGAIN && errno != EWOULDBLOCK)
                        {
                            std::cerr << "UdpProtoStream: recv() error: " << std::strerror(errno) << '\n';
                        }
                    continue;
                }
            if (n == 0)
                {
                    continue;
                }

            Message message;
            if (message.ParseFromArray(buf.data(), static_cast<int>(n)))
                {
                    callback_(message);
                }
            else
                {
                    std::cerr << "UdpProtoStream: failed to parse " << n << "-byte datagram as "
                              << Message::descriptor()->full_name() << '\n';
                }
        }
}

// Only these two instantiations are needed anywhere in this program.
template class UdpProtoStream<gnss_sdr::Observables>;
template class UdpProtoStream<gnss_sdr::MonitorPvt>;

// ================================================================ TelecommandClient

TelecommandClient::TelecommandClient(std::string host, uint16_t port)
    : host_(std::move(host)), port_(port)
{
}

TelecommandClient::~TelecommandClient()
{
    disconnect();
}

bool TelecommandClient::connect()
{
    if (sock_ >= 0)
        {
            return true;
        }

    sock_ = ::socket(AF_INET, SOCK_STREAM, 0);
    if (sock_ < 0)
        {
            return false;
        }

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port_);
    if (::inet_pton(AF_INET, host_.c_str(), &addr.sin_addr) != 1)
        {
            ::close(sock_);
            sock_ = -1;
            return false;
        }

    if (::connect(sock_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0)
        {
            ::close(sock_);
            sock_ = -1;
            return false;
        }

    return true;
}

void TelecommandClient::disconnect()
{
    if (sock_ >= 0)
        {
            ::close(sock_);
            sock_ = -1;
        }
}

std::string TelecommandClient::send_command(const std::string& cmd, std::chrono::milliseconds response_timeout)
{
    if (sock_ < 0 && !connect())
        {
            return {};
        }

    const std::string line = cmd + "\n";
    if (::send(sock_, line.data(), line.size(), 0) < 0)
        {
            disconnect();
            return {};
        }

    set_recv_timeout(sock_, response_timeout);

    std::string response;
    char buf[4096];
    while (true)
        {
            const ssize_t n = ::recv(sock_, buf, sizeof(buf), 0);
            if (n > 0)
                {
                    response.append(buf, static_cast<size_t>(n));
                    continue;  // keep draining until the quiet-period timeout (see header)
                }
            if (n == 0)
                {
                    disconnect();  // peer closed the connection
                }
            break;  // n < 0: quiet-period timeout (EAGAIN/EWOULDBLOCK) or a real error
        }
    return response;
}

// ================================================================ ReceiverLink

ReceiverLink::ReceiverLink(Config cfg) : cfg_(std::move(cfg))
{
}

ReceiverLink::~ReceiverLink()
{
    stop();
}

void ReceiverLink::on_synchro(SynchroCallback cb)
{
    std::lock_guard<std::mutex> lock(cb_mutex_);
    synchro_cb_ = std::move(cb);
}

void ReceiverLink::on_pvt(PvtCallback cb)
{
    std::lock_guard<std::mutex> lock(cb_mutex_);
    pvt_cb_ = std::move(cb);
}

void ReceiverLink::start()
{
    synchro_stream_ = std::make_unique<UdpProtoStream<gnss_sdr::Observables>>(
        cfg_.host, cfg_.synchro_udp_port,
        [this](const gnss_sdr::Observables& obs)
        {
            SynchroCallback cb;
            {
                std::lock_guard<std::mutex> lock(cb_mutex_);
                cb = synchro_cb_;
            }
            if (!cb)
                {
                    return;
                }
            for (int i = 0; i < obs.observable_size(); ++i)
                {
                    const gnss_sdr::GnssSynchro& g = obs.observable(i);
                    cb(static_cast<uint32_t>(g.channel_id()), to_state(g));
                }
        });

    pvt_stream_ = std::make_unique<UdpProtoStream<gnss_sdr::MonitorPvt>>(
        cfg_.host, cfg_.pvt_udp_port,
        [this](const gnss_sdr::MonitorPvt& p)
        {
            PvtCallback cb;
            {
                std::lock_guard<std::mutex> lock(cb_mutex_);
                cb = pvt_cb_;
            }
            if (cb)
                {
                    cb(to_state(p));
                }
        });

    synchro_stream_->start();
    pvt_stream_->start();
}

void ReceiverLink::stop()
{
    if (synchro_stream_)
        {
            synchro_stream_->stop();
        }
    if (pvt_stream_)
        {
            pvt_stream_->stop();
        }
    std::lock_guard<std::mutex> lock(telecommand_mutex_);
    if (telecommand_)
        {
            telecommand_->disconnect();
        }
}

std::string ReceiverLink::send_telecommand(const std::string& cmd)
{
    std::lock_guard<std::mutex> lock(telecommand_mutex_);
    if (!telecommand_)
        {
            telecommand_ = std::make_unique<TelecommandClient>(cfg_.host, cfg_.telecommand_tcp_port);
        }
    return telecommand_->send_command(cmd);
}

detector::SYNCRO_State ReceiverLink::to_state(const gnss_sdr::GnssSynchro& g)
{
    detector::SYNCRO_State s{};
    s.system = g.system();
    s.signal = g.signal();
    s.prn = g.prn();
    s.channel_id = g.channel_id();
    s.acq_delay_samples = g.acq_delay_samples();
    s.acq_doppler_hz = g.acq_doppler_hz();
    s.acq_samplestamp_samples = g.acq_samplestamp_samples();
    s.acq_doppler_step = g.acq_doppler_step();
    s.flag_valid_acquisition = g.flag_valid_acquisition();
    s.fs = g.fs();
    s.prompt_i = g.prompt_i();
    s.prompt_q = g.prompt_q();
    s.cn0_db_hz = g.cn0_db_hz();
    s.carrier_doppler_hz = g.carrier_doppler_hz();
    s.carrier_phase_rads = g.carrier_phase_rads();
    s.code_phase_samples = g.code_phase_samples();
    s.tracking_sample_counter = g.tracking_sample_counter();
    s.flag_valid_symbol_output = g.flag_valid_symbol_output();
    s.correlation_length_ms = g.correlation_length_ms();
    s.flag_valid_word = g.flag_valid_word();
    s.flag_cycle_slip = g.flag_cycle_slip();
    s.tow_at_current_symbol_ms = g.tow_at_current_symbol_ms();
    s.pseudorange_m = g.pseudorange_m();
    s.rx_time = g.rx_time();
    s.flag_valid_pseudorange = g.flag_valid_pseudorange();
    s.interp_tow_ms = g.interp_tow_ms();
    // detector::SYNCRO_State still has no field for flag_PLL_180_deg_phase_locked
    // (present on the wire, dropped here) - not curated in for this pass, see
    // the comms-protocol plan for what's deliberately left out and why.
    return s;
}

detector::PVT_State ReceiverLink::to_state(const gnss_sdr::MonitorPvt& p)
{
    detector::PVT_State s{};
    s.tow_at_current_symbol_ms = p.tow_at_current_symbol_ms();
    s.week = p.week();
    s.rx_time3 = p.rx_time();  // detector::PVT_State names this field rx_time3
    s.user_clk_offset = p.user_clk_offset();
    s.pos_x = p.pos_x();
    s.pos_y = p.pos_y();
    s.pos_z = p.pos_z();
    s.vel_x = p.vel_x();
    s.vel_y = p.vel_y();
    s.vel_z = p.vel_z();
    s.cov_xx = p.cov_xx();
    s.cov_yy = p.cov_yy();
    s.cov_zz = p.cov_zz();
    s.cov_xy = p.cov_xy();
    s.cov_yz = p.cov_yz();
    s.cov_zx = p.cov_zx();
    s.latitude = p.latitude();
    s.longitude = p.longitude();
    s.height = p.height();
    s.valid_sats = p.valid_sats();
    s.solution_status = p.solution_status();
    s.solution_type = p.solution_type();
    s.ar_ratio_factor = p.ar_ratio_factor();
    s.ar_ratio_threshold = p.ar_ratio_threshold();
    s.gdop = p.gdop();
    s.pdop = p.pdop();
    s.hdop = p.hdop();
    s.vdop = p.vdop();
    // detector::PVT_State doesn't yet model user_clk_drift_ppm, utc_time,
    // vel_e/n/u, cog, galhas_status, or geohash - all present on the wire,
    // dropped here until the struct grows them.
    return s;
}

}  // namespace gnss_sdr_wrapper
