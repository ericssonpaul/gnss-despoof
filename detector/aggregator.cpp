#include "aggregator.hpp"

#include <utility>

namespace detector {

Aggregator::Aggregator(std::string receiver_name, std::string session_id)
    : receiver_name_(std::move(receiver_name)),
      session_id_(std::move(session_id)),
      session_start_(std::chrono::steady_clock::now())
{
}

void Aggregator::on_publish(PublishCallback callback)
{
    std::lock_guard<std::mutex> lock(mutex_);
    publish_callback_ = std::move(callback);
}

void Aggregator::on_pvt(const PVT_State& pvt)
{
    std::lock_guard<std::mutex> lock(mutex_);
    latest_pvt_ = pvt;
    has_pvt_ = true;
    publish_locked();
}

void Aggregator::on_synchro(uint32_t channel_id, const SYNCRO_State& synchro)
{
    std::lock_guard<std::mutex> lock(mutex_);
    latest_synchro_[channel_id] = synchro;
    publish_locked();
}

Snapshot Aggregator::build_snapshot_locked() const
{
    Snapshot snap;
    snap.receiver_name = receiver_name_;
    snap.session_id = session_id_;
    snap.session_time_s = std::chrono::duration<double>(std::chrono::steady_clock::now() - session_start_).count();

    if (has_pvt_) {
        snap.has_pvt = true;
        snap.latitude = latest_pvt_.latitude;
        snap.longitude = latest_pvt_.longitude;
        snap.height = latest_pvt_.height;
        snap.vel_x = latest_pvt_.vel_x;
        snap.vel_y = latest_pvt_.vel_y;
        snap.vel_z = latest_pvt_.vel_z;
        snap.clock_offset_s = latest_pvt_.user_clk_offset;
        snap.gps_week = latest_pvt_.week;
        snap.gps_tow_s = latest_pvt_.rx_time3;
        snap.gdop = latest_pvt_.gdop;
        snap.pdop = latest_pvt_.pdop;
        snap.hdop = latest_pvt_.hdop;
        snap.vdop = latest_pvt_.vdop;
        snap.solution_status = latest_pvt_.solution_status;
        snap.solution_type = latest_pvt_.solution_type;
        snap.valid_sats = latest_pvt_.valid_sats;
    }

    snap.satellites.reserve(latest_synchro_.size());
    for (const auto& kv : latest_synchro_) {
        const SYNCRO_State& s = kv.second;
        SatelliteObservable obs;
        obs.system = s.system;
        obs.signal = s.signal;
        obs.prn = s.prn;
        obs.channel_id = s.channel_id;
        obs.cn0_db_hz = s.cn0_db_hz;
        obs.doppler_hz = s.carrier_doppler_hz;
        obs.pseudorange_m = s.pseudorange_m;
        obs.flag_valid_pseudorange = s.flag_valid_pseudorange;
        obs.flag_valid_word = s.flag_valid_word;
        obs.flag_cycle_slip = s.flag_cycle_slip;
        obs.tow_ms = s.tow_at_current_symbol_ms;
        snap.satellites.push_back(std::move(obs));
    }

    return snap;
}

void Aggregator::publish_locked()
{
    if (!publish_callback_) return;
    publish_callback_(build_snapshot_locked());
}

}  // namespace detector
