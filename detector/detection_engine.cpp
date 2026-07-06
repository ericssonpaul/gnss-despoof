#include "detection_engine.hpp"

#include <nlohmann/json.hpp>

#include <utility>

namespace detector {

namespace {

const char* to_string(Severity s)
{
    switch (s) {
        case Severity::None: return "none";
        case Severity::Low: return "low";
        case Severity::Mid: return "mid";
        case Severity::High: return "high";
    }
    return "none";
}

}  // namespace

std::string to_json(const DetectionResult& result)
{
    nlohmann::json j;
    j["type"] = "detection";  // see snapshot.cpp's to_json for the other side of this tag
    j["sessionTimeS"] = result.session_time_s;

    auto findings = nlohmann::json::array();
    for (const auto& f : result.findings) {
        findings.push_back({
            {"method", f.method},
            {"severity", to_string(f.severity)},
            {"detail", f.detail},
            {"receivers", f.receivers},
        });
    }
    j["findings"] = std::move(findings);

    return j.dump();
}

DetectionEngine::DetectionEngine(std::chrono::milliseconds cycle_period)
    : period_(cycle_period), start_time_(std::chrono::steady_clock::now())
{
}

DetectionEngine::~DetectionEngine()
{
    stop();
}

ReceiverHistory& DetectionEngine::add_receiver(std::string name, size_t max_history)
{
    std::lock_guard<std::mutex> lock(mutex_);
    receivers_.push_back(std::make_unique<ReceiverHistory>(std::move(name), max_history));
    return *receivers_.back();
}

void DetectionEngine::add_unit(std::unique_ptr<Unit> unit)
{
    std::lock_guard<std::mutex> lock(mutex_);
    units_.push_back(std::move(unit));
}

void DetectionEngine::on_result(ResultCallback callback)
{
    std::lock_guard<std::mutex> lock(mutex_);
    callback_ = std::move(callback);
}

void DetectionEngine::start()
{
    if (running_.exchange(true)) return;
    thread_ = std::thread([this] { run(); });
}

void DetectionEngine::stop()
{
    if (!running_.exchange(false)) return;
    if (thread_.joinable()) thread_.join();
}

void DetectionEngine::run()
{
    while (running_) {
        std::this_thread::sleep_for(period_);
        if (!running_) break;

        DetectionResult result;
        ResultCallback callback;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            result = run_cycle_locked();
            callback = callback_;
        }
        if (callback) callback(result);
    }
}

DetectionResult DetectionEngine::run_cycle_locked()
{
    std::vector<const ReceiverHistory*> receiver_ptrs;
    receiver_ptrs.reserve(receivers_.size());
    for (const auto& r : receivers_) receiver_ptrs.push_back(r.get());

    DetectionResult result;
    result.session_time_s = std::chrono::duration<double>(std::chrono::steady_clock::now() - start_time_).count();

    // TODO(you): this just concatenates every Unit's findings as-is. For
    // real fusion - deduplicating overlapping findings, weighting multiple
    // Units that agree, hysteresis so one noisy cycle can't flip severity -
    // do it here instead of a flat accumulate.
    for (const auto& unit : units_) {
        auto findings = unit->exec(receiver_ptrs);
        result.findings.insert(result.findings.end(), std::make_move_iterator(findings.begin()),
            std::make_move_iterator(findings.end()));
    }

    return result;
}

}  // namespace detector
