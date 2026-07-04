#!/usr/bin/env python3
"""Generate IQ capture fixtures from config/iq-sample-config.yaml.

Orchestrates gps-sdr-sim plus motion_profiles.py / combine_iq.py to produce
one .bin per scenario: clean/drift captures come straight from gps-sdr-sim,
while meaconing/open_loop_jump/capture_dragoff scenarios generate one or two
intermediate captures and post-process them into a spoofed composite.
"""

import argparse
import datetime as dt
import os
import subprocess
import sys
from pathlib import Path

import yaml

import combine_iq
import motion_profiles

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = REPO_ROOT / "config" / "iq-sample-config.yaml"
TIME_FORMAT = "%Y/%m/%d,%H:%M:%S"


def resolve_path(path_str, base=REPO_ROOT):
    p = Path(path_str)
    return p if p.is_absolute() else (base / p)


def offset_start_time(start_time, seconds):
    if not seconds:
        return start_time
    t = dt.datetime.strptime(start_time, TIME_FORMAT) + dt.timedelta(seconds=seconds)
    return t.strftime(TIME_FORMAT)


def run_gps_sdr_sim(binary, ephemeris, out_path, sample_rate_hz, iq_bits, start_time,
                     location=None, motion_csv=None, duration_s=None, verbose=False):
    # gpssim.c copies -e/-x/-o argv strings into fixed 100-byte buffers with an
    # unbounded strcpy (char navfile/umfile/outfile[MAX_CHAR], gpssim.c:1766-67,
    # 1823-55) - no bounds check, so anything past 100 chars is a stack buffer
    # overflow ("stack smashing detected", intermittent depending on what it
    # clobbers). Our absolute paths + descriptive scenario names blow past that.
    # Fix: run from the output file's directory and pass short relative paths.
    work_dir = out_path.resolve().parent
    out_name = out_path.name
    ephemeris_arg = os.path.relpath(Path(ephemeris).resolve(), work_dir)

    args = [str(Path(binary).resolve()), "-e", ephemeris_arg, "-t", start_time,
            "-s", str(sample_rate_hz), "-b", str(iq_bits), "-o", out_name]
    if motion_csv is not None:
        args += ["-x", os.path.relpath(Path(motion_csv).resolve(), work_dir)]
    else:
        args += ["-l", f"{location['lat']},{location['lon']},{location['height']}"]
        if duration_s is not None:
            args += ["-d", str(duration_s)]

    result = subprocess.run(args, capture_output=True, text=True, cwd=work_dir)
    if verbose:
        print(result.stdout)
    if result.returncode != 0:
        raise RuntimeError(f"gps-sdr-sim failed for {out_path}:\n{result.stdout}\n{result.stderr}\n{args}")


class ScenarioContext:
    def __init__(self, args, cfg):
        self.args = args
        self.locations = cfg["locations"]
        defaults = cfg["gps_sdr_sim"]
        self.ephemeris = resolve_path(defaults["ephemeris"])
        self.sample_rate = defaults["sample_rate_hz"]
        self.iq_bits = defaults["iq_bits"]
        self.default_start = defaults["start_time"]

        self.output_dir = args.output_dir
        self.intermediate_dir = self.output_dir / "_intermediate"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.intermediate_dir.mkdir(parents=True, exist_ok=True)

    def start_time_for(self, scenario, offset_s=0.0):
        base = scenario.get("start_time", self.default_start)
        return offset_start_time(base, offset_s)

    def run_sim(self, out_path, **kwargs):
        run_gps_sdr_sim(self.args.gps_sdr_sim_bin, self.ephemeris, out_path,
                         self.sample_rate, self.iq_bits, verbose=self.args.verbose, **kwargs)


def generate_clean(ctx, sc, out_path):
    ctx.run_sim(out_path, start_time=ctx.start_time_for(sc),
                location=ctx.locations[sc["location"]], duration_s=sc["duration_s"])


def generate_drift(ctx, sc, out_path):
    csv_path = ctx.intermediate_dir / f"{sc['name']}_motion.csv"
    motion_profiles.linear_drift(csv_path, ctx.locations[sc["origin"]], sc["offset_m"], sc["bearing_deg"],
                                  sc["duration_static_s"], sc["duration_drift_s"])
    ctx.run_sim(out_path, start_time=ctx.start_time_for(sc), motion_csv=csv_path)


def generate_meaconing(ctx, sc, out_path):
    lock_time_s, duration_s = sc["lock_time_s"], sc["duration_s"]

    truth_path = ctx.intermediate_dir / f"{sc['name']}_truth.bin"
    ctx.run_sim(truth_path, start_time=ctx.start_time_for(sc), location=ctx.locations[sc["location"]],
                duration_s=lock_time_s + duration_s)

    combine_iq.meacon(truth_path, out_path, ctx.sample_rate, lock_time_s, sc["delay_s"], duration_s)


def generate_open_loop_jump(ctx, sc, out_path):
    lock_time_s, duration_s = sc["lock_time_s"], sc["duration_s"]
    location = ctx.locations[sc["location"]]

    truth_path = ctx.intermediate_dir / f"{sc['name']}_truth.bin"
    ctx.run_sim(truth_path, start_time=ctx.start_time_for(sc), location=location, duration_s=lock_time_s)

    jump_lat, jump_lon = motion_profiles.destination_point(location["lat"], location["lon"],
                                                             sc["jump_bearing_deg"], sc["jump_offset_m"])
    jump_location = {"lat": jump_lat, "lon": jump_lon, "height": location["height"]}
    jump_path = ctx.intermediate_dir / f"{sc['name']}_jump.bin"
    ctx.run_sim(jump_path, start_time=ctx.start_time_for(sc, offset_s=lock_time_s),
                location=jump_location, duration_s=duration_s)

    combine_iq.concat([(truth_path, lock_time_s), (jump_path, None)], out_path, ctx.sample_rate)


def generate_capture_dragoff(ctx, sc, out_path):
    lock_time_s, ramp_s, dragoff_s = sc["lock_time_s"], sc["ramp_s"], sc["dragoff_s"]
    location = ctx.locations[sc["location"]]

    truth_path = ctx.intermediate_dir / f"{sc['name']}_truth.bin"
    ctx.run_sim(truth_path, start_time=ctx.start_time_for(sc), location=location,
                duration_s=lock_time_s + ramp_s + dragoff_s)

    csv_path = ctx.intermediate_dir / f"{sc['name']}_motion.csv"
    motion_profiles.linear_drift(csv_path, location, sc["offset_m"], sc["bearing_deg"], ramp_s, dragoff_s)
    spoof_path = ctx.intermediate_dir / f"{sc['name']}_spoof.bin"
    ctx.run_sim(spoof_path, start_time=ctx.start_time_for(sc, offset_s=lock_time_s), motion_csv=csv_path)

    combine_iq.capture_dragoff(truth_path, spoof_path, out_path, ctx.sample_rate, lock_time_s, ramp_s,
                                sc["gain_db"])


GENERATORS = {
    "clean": generate_clean,
    "drift": generate_drift,
    "meaconing": generate_meaconing,
    "open_loop_jump": generate_open_loop_jump,
    "capture_dragoff": generate_capture_dragoff,
}


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output-dir", type=Path,
                         default=Path(os.environ.get("IQ_OUTPUT_DIR", REPO_ROOT / "iq_samples")))
    parser.add_argument("--gps-sdr-sim-bin", type=Path,
                         default=Path(os.environ.get("GPS_SDR_SIM_BIN",
                                                      REPO_ROOT / "external" / "gps-sdr-sim" / "gps-sdr-sim")))
    parser.add_argument("--scenario", nargs="*", help="Only generate these scenario names")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()

    if not args.gps_sdr_sim_bin.exists():
        sys.exit(f"gps-sdr-sim binary not found at {args.gps_sdr_sim_bin} "
                  f"(build it first, e.g. `cmake --build build --target gps_sdr_sim`)")

    with open(args.config) as f:
        cfg = yaml.safe_load(f)

    scenarios = cfg["scenarios"]
    if args.scenario:
        wanted = set(args.scenario)
        scenarios = [s for s in scenarios if s["name"] in wanted]
        missing = wanted - {s["name"] for s in scenarios}
        if missing:
            sys.exit(f"Unknown scenario(s): {', '.join(sorted(missing))}")

    ctx = ScenarioContext(args, cfg)

    results = []
    for sc in scenarios:
        generator = GENERATORS.get(sc["type"])
        if generator is None:
            sys.exit(f"Unknown scenario type '{sc['type']}' for scenario '{sc['name']}'")
        out_path = ctx.output_dir / f"{sc['name']}.bin"
        print(f"[{sc['name']}] generating ({sc['type']})...")
        generator(ctx, sc, out_path)
        results.append((sc["name"], sc["type"], out_path, out_path.stat().st_size))

    print("\nGenerated IQ samples:")
    for name, type_, path, size in results:
        print(f"  {name:<38} {type_:<16} {size / 1e6:8.1f} MB  {path}")


if __name__ == "__main__":
    main()
