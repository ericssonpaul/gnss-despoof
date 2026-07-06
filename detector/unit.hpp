#ifndef _DETECTOR_UNIT_H
#define _DETECTOR_UNIT_H

#include "receiver_history.hpp"

#include <string>
#include <vector>

namespace detector {

// 0 = inactive/no attack. Keep this scale in sync with frontend's
// DetectorSeverity (frontend/src/types.ts) if it changes.
enum class Severity : int { None = 0, Low = 1, Mid = 2, High = 3 };

// One detection method's output for one DetectionEngine cycle. `method` is
// a stable id (e.g. "raim") - this is what the frontend keys its detector
// list on, replacing the old fixed d1..d4 slots. `receivers` names which
// receiver(s) this concerns: empty means fleet-wide (e.g. "no receivers
// connected"), one entry means a single-receiver-only check, more than one
// means a genuine cross-receiver comparison.
struct Finding {
    std::string method;
    Severity severity = Severity::None;
    std::string detail;
    std::vector<std::string> receivers;
};

// A detection method, run once per DetectionEngine cycle against every
// currently-connected receiver's history. Implementations decide for
// themselves whether that means looping per-receiver (classic RAIM checks
// one receiver's own satellite geometry) or comparing across receivers (do
// two receivers' fixes agree) - both are valid uses of the same interface.
//
// Takes pointers rather than the vector<GNSS_SDR_Server> originally
// sketched in detector.hpp: ReceiverHistory holds a std::mutex internally
// (see receiver_history.hpp) so it can't be stored by value in a vector;
// DetectionEngine owns receivers as std::unique_ptr<ReceiverHistory> and
// hands out a vector of raw pointers built fresh each cycle instead.
//
// Return {} for "nothing to report" - don't return a Finding with
// Severity::None just to signal "checked, all clear". DetectionEngine only
// carries forward what's actually reported.
class Unit {
public:
    virtual ~Unit() = default;
    virtual std::string name() const = 0;
    virtual std::vector<Finding> exec(const std::vector<const ReceiverHistory*>& receivers) = 0;
};

}  // namespace detector

#endif
