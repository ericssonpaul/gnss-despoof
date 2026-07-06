#ifndef _DETECTOR_RECEIVER_HISTORY_H
#define _DETECTOR_RECEIVER_HISTORY_H

#include "detector.hpp"

#include <cstddef>
#include <deque>
#include <map>
#include <mutex>
#include <string>

namespace detector {

// Per-receiver rolling history, read by Units during a DetectionEngine
// cycle. Unlike Aggregator (which only ever holds the latest value, for the
// immediate per-receiver wire Snapshot), this exists specifically so
// cross-receiver / time-series checks (RAIM, drift-monitor, ...) have
// something to look back over - see detection_engine.hpp for how the two
// caches coexist, fed from the same ReceiverLink callbacks.
//
// This replaces the GNSS_SDR_Server sketch that used to live in
// detector.hpp. Deliberately flattened relative to that sketch: one bounded
// deque per channel_id instead of separate gps/glonass/galileo/beidou
// vectors-of-snapshots, since SYNCRO_State::system already carries the
// constellation and the per-constellation split had no clear consumer yet.
// Reintroduce a constellation-keyed view here (or in a Unit) if one shows up.
class ReceiverHistory {
public:
    // max_history caps each deque (PVT and per-channel) independently - a
    // count of samples, not a time window, so pick it relative to whatever
    // rate GNSS-SDR is configured to emit at.
    explicit ReceiverHistory(std::string name, size_t max_history = 300);

    ReceiverHistory(const ReceiverHistory&) = delete;
    ReceiverHistory& operator=(const ReceiverHistory&) = delete;

    const std::string& name() const { return name_; }

    // Called directly from ReceiverLink's callbacks, same as Aggregator -
    // thread-safe, may be called from a background UDP-reader thread.
    void push_pvt(const PVT_State& pvt);
    void push_synchro(uint32_t channel_id, const SYNCRO_State& synchro);

    // Read-side snapshot for a DetectionEngine cycle - copies out under the
    // lock rather than returning a reference, so a Unit can take as long as
    // it needs without holding this receiver's mutex (and without racing a
    // concurrent push_pvt/push_synchro from the UDP reader threads).
    std::deque<PVT_State> pvt_history() const;
    std::map<uint32_t, std::deque<SYNCRO_State>> channel_history() const;

    // Set when this receiver's true position is known a priori (e.g. a
    // fixed reference/ground-truth station) - lets a Unit check absolute
    // position error, not just relative receiver-to-receiver agreement.
    // Leave static_pos false (the default) for a receiver whose truth
    // position is unknown, e.g. a moving field unit.
    bool static_pos = false;
    double lat = 0;
    double lon = 0;
    double height = 0;

private:
    std::string name_;
    size_t max_history_;

    mutable std::mutex mutex_;
    std::deque<PVT_State> pvt_history_;
    std::map<uint32_t, std::deque<SYNCRO_State>> channel_history_;
};

}  // namespace detector

#endif
