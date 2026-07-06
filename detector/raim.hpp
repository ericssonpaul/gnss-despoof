#ifndef _DETECTOR_RAIM_H
#define _DETECTOR_RAIM_H

#include "unit.hpp"

namespace detector {

// Receiver Autonomous Integrity Monitoring. Classically a per-receiver
// satellite-geometry consistency check (does the position solution shift
// more than measurement noise should allow when one satellite is dropped),
// but exec()'s signature also hands it every other connected receiver's
// history, so a cross-receiver position/clock agreement check can live
// here too - or split out as its own Unit later if that gets unwieldy.
class RAIM : public Unit {
public:
    std::string name() const override { return "raim"; }
    std::vector<Finding> exec(const std::vector<const ReceiverHistory*>& receivers) override;
};

}  // namespace detector

#endif
