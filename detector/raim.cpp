#include "raim.hpp"

namespace detector {

std::vector<Finding> RAIM::exec(const std::vector<const ReceiverHistory*>& receivers)
{
    // TODO(you): implement RAIM here. receivers[i]->pvt_history() and
    // ->channel_history() give bounded per-receiver time series to work
    // from (see receiver_history.hpp); receivers[i]->static_pos/lat/lon
    // gives ground truth for receivers that have it.
    (void)receivers;
    return {};
}

}  // namespace detector
