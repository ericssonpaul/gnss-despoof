#include "receiver_history.hpp"

#include <utility>

namespace detector {

ReceiverHistory::ReceiverHistory(std::string name, size_t max_history)
    : name_(std::move(name)), max_history_(max_history)
{
}

void ReceiverHistory::push_pvt(const PVT_State& pvt)
{
    std::lock_guard<std::mutex> lock(mutex_);
    pvt_history_.push_back(pvt);
    if (pvt_history_.size() > max_history_) pvt_history_.pop_front();
}

void ReceiverHistory::push_synchro(uint32_t channel_id, const SYNCRO_State& synchro)
{
    std::lock_guard<std::mutex> lock(mutex_);
    auto& channel = channel_history_[channel_id];
    channel.push_back(synchro);
    if (channel.size() > max_history_) channel.pop_front();
}

std::deque<PVT_State> ReceiverHistory::pvt_history() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return pvt_history_;
}

std::map<uint32_t, std::deque<SYNCRO_State>> ReceiverHistory::channel_history() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return channel_history_;
}

}  // namespace detector
