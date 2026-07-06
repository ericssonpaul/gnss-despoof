#ifndef _DETECTOR_CYCLE_SLIP_H
#define _DETECTOR_CYCLE_SLIP_H

#include "unit.hpp"

namespace detector {

// Flags a receiver-wide loss-of-lock event: several channels' carrier
// tracking losing and regaining lock together within a short window.
// Deliberately ignores isolated single-channel slips - those happen
// constantly from ordinary multipath/low-elevation noise and aren't evidence
// of anything by themselves. The correlated, whole-front-end disruption an
// open-loop splice attack causes (see combine_iq.py's concat()) is what this
// looks for instead.
class CycleSlip : public Unit {
public:
    std::string name() const override { return "cycle_slip"; }
    std::vector<Finding> exec(const std::vector<const ReceiverHistory*>& receivers) override;
};

}  // namespace detector

#endif
