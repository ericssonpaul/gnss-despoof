#include "cycle_slip.hpp"

#include <sstream>

namespace detector {

namespace {

// How far back (in GPS time-of-week ms) from a channel's own latest sample
// still counts as "recently recovered" - a time span rather than a sample
// count, since GNSS-SDR's per-channel dump rate isn't fixed by this
// codebase. tow_at_current_symbol_ms is uint32_t, so a week rollover makes
// the very first subtraction after it underflow to a huge value - which
// harmlessly looks like "too old" and just stops the scan a sample early;
// not worth special-casing for this project's scope.
constexpr uint32_t kRecentWindowMs = 2000;

// True if this channel lost lock (flag_cycle_slip, or flag_valid_symbol_output
// dropping) and has since recovered, within the last kRecentWindowMs. Only
// meaningful alongside currently-down channels below - on its own this is a
// weak, timing-sensitive signal: verified against a real open_loop_jump
// capture, a receiver configured with Channels.in_acquisition=1 (GNSS-SDR
// default) reacquires its channels one at a time rather than together, so
// "recovered within the same short window" only catches whichever two or
// three channels happened to land in the same slice of that serialized
// queue - not the fleet-wide event.
bool channel_recovered_recently(const std::deque<SYNCRO_State>& samples)
{
    if (samples.empty() || !samples.back().flag_valid_symbol_output) return false;

    uint32_t latest_tow = samples.back().tow_at_current_symbol_ms;
    for (auto it = samples.rbegin(); it != samples.rend(); ++it) {
        if (latest_tow - it->tow_at_current_symbol_ms > kRecentWindowMs) break;
        if (it->flag_cycle_slip || !it->flag_valid_symbol_output) return true;
    }
    return false;
}

}  // namespace

std::vector<Finding> CycleSlip::exec(const std::vector<const ReceiverHistory*>& receivers)
{
    std::vector<Finding> findings;

    for (const auto* receiver : receivers) {
        auto channels = receiver->channel_history();
        if (channels.empty()) continue;

        // "Currently down" is the robust, timing-independent half of this
        // check: several channels losing lock at literally the same moment
        // is what a whole-front-end disruption (jamming, an open-loop
        // splice) looks like, and isn't explained by ordinary per-satellite
        // elevation/multipath loss - those don't happen in unison. "Recently
        // recovered" only adds channels back in as they reacquire, however
        // staggered that turns out to be.
        // GNSS-SDR clears a channel's prn while it's down (unidentified
        // until it reacquires), so down channels are named by channel_id
        // instead - the only identifier still meaningful in that state.
        std::vector<uint32_t> down_now_channel_ids;
        std::vector<uint32_t> recovered_prns;
        for (const auto& [channel_id, samples] : channels) {
            if (samples.empty()) continue;
            if (!samples.back().flag_valid_symbol_output) {
                down_now_channel_ids.push_back(channel_id);
            } else if (channel_recovered_recently(samples)) {
                recovered_prns.push_back(samples.back().prn);
            }
        }

        size_t affected = down_now_channel_ids.size() + recovered_prns.size();
        if (affected < 2) continue;  // isolated slip/dropout - not attack-worthy

        double fraction = static_cast<double>(affected) / channels.size();
        Severity severity = fraction >= 0.5 ? Severity::High : Severity::Mid;

        std::ostringstream detail;
        detail << affected << "/" << channels.size() << " channels disrupted (" << down_now_channel_ids.size()
               << " down now, channels:";
        for (size_t i = 0; i < down_now_channel_ids.size(); ++i)
            detail << (i == 0 ? " " : ", ") << down_now_channel_ids[i];
        detail << "; " << recovered_prns.size() << " recovered within " << kRecentWindowMs << "ms, prns:";
        for (size_t i = 0; i < recovered_prns.size(); ++i) detail << (i == 0 ? " " : ", ") << recovered_prns[i];
        detail << ")";

        findings.push_back(Finding{name(), severity, detail.str(), {receiver->name()}});
    }

    return findings;
}

}  // namespace detector
