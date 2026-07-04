"""Post-processing of raw int8 I/Q captures into spoofed composites.

Port of the old prototype's iq-combine.py, generalized into three primitives
used by the `open_loop_jump`, `capture_dragoff`, and `meaconing` scenario
types in generate_iq_samples.py:

  concat()           - hard splice of independent captures (A2: open-loop)
  capture_dragoff()  - phase-matched gain ramp + drag-off (A3: RX/SP, no SCER)
  meacon()           - delayed rebroadcast, fixed or growing delay (A1)

All I/O is raw interleaved int8 I/Q (matches gps-sdr-sim's `-b 8`).
"""

import os
import numpy as np

BYTES_PER_SAMPLE = 2  # int8 I + int8 Q


def _to_complex(raw_int8):
    raw_int8 = raw_int8[: len(raw_int8) & ~1]
    return raw_int8[0::2].astype(np.float32) + 1j * raw_int8[1::2].astype(np.float32)


def _to_int8_bytes(complex_samples):
    out = np.empty(2 * len(complex_samples), dtype=np.int8)
    out[0::2] = np.clip(np.round(complex_samples.real), -127, 127)
    out[1::2] = np.clip(np.round(complex_samples.imag), -127, 127)
    return out.tobytes()


def _sample_count(path):
    return os.path.getsize(path) // BYTES_PER_SAMPLE


def _read_window(f, total_samples, start_sample, n_samples):
    """Read n_samples starting at start_sample; out-of-[0,total) range is zero-filled."""
    out = np.zeros(n_samples, dtype=np.complex64)
    read_start = max(start_sample, 0)
    read_end = min(start_sample + n_samples, total_samples)
    if read_end > read_start:
        f.seek(read_start * BYTES_PER_SAMPLE)
        raw = np.frombuffer(f.read((read_end - read_start) * BYTES_PER_SAMPLE), dtype=np.int8)
        c = _to_complex(raw)
        offset = read_start - start_sample
        out[offset : offset + len(c)] = c
    return out


def concat(parts, out_path, sample_rate, chunk_bytes=4_000_000):
    """Splice captures back-to-back with no ramp or phase relation.

    `parts` is a list of (path, duration_s) tuples; duration_s=None takes the
    whole file. Models an open-loop attack: an abrupt, non-phase-matched
    switch that forces the receiver to drop lock and reacquire.
    """
    with open(out_path, "wb") as fo:
        for path, duration_s in parts:
            n_bytes = None if duration_s is None else round(duration_s * sample_rate) * BYTES_PER_SAMPLE
            with open(path, "rb") as fp:
                written = 0
                while n_bytes is None or written < n_bytes:
                    to_read = chunk_bytes if n_bytes is None else min(chunk_bytes, n_bytes - written)
                    buf = fp.read(to_read)
                    if not buf:
                        break
                    fo.write(buf)
                    written += len(buf)
    return out_path


def capture_dragoff(truth_path, spoof_path, out_path, sample_rate, lock_time_s, ramp_s, gain_db,
                     chunk_samples=1_000_000):
    """Fig 1 of the spoofing survey: baseline lock, phase-matched power ramp
    that captures the tracking loop, then a drag-off with the truth silenced.

    truth_path: full-duration truth capture (lock_time_s + ramp_s + dragoff_s).
    spoof_path: capture beginning at the moment capture starts (same location
        as truth at t=0, drag-off motion baked in after ramp_s) - length
        ramp_s + dragoff_s. Its samples line up with truth's [lock_time_s:] tail.
    """
    gain_linear = 10 ** (gain_db / 20)
    # Global scale keeps the worst case (truth + full-gain spoof, at the ramp's
    # end) within int8 range without per-chunk rescaling, which would
    # introduce audible level discontinuities.
    scale = 100.0 / (127.0 * (1.0 + gain_linear))

    n_lock = round(lock_time_s * sample_rate)
    n_ramp = round(ramp_s * sample_rate)
    n_total = _sample_count(truth_path)
    spoof_total = _sample_count(spoof_path)

    with open(truth_path, "rb") as ft, open(spoof_path, "rb") as fs, open(out_path, "wb") as fo:
        sample_idx = 0
        while sample_idx < n_total:
            n = min(chunk_samples, n_total - sample_idx)

            truth_c = _read_window(ft, n_total, sample_idx, n)
            spoof_c = _read_window(fs, spoof_total, sample_idx - n_lock, n)

            idx = np.arange(sample_idx, sample_idx + n)
            ramp_pos = idx - n_lock  # samples since capture (ramp) began

            truth_env = np.where(ramp_pos < n_ramp, 1.0, 0.0).astype(np.float32)
            gain_env = np.clip(ramp_pos / max(n_ramp, 1), 0.0, 1.0).astype(np.float32) * gain_linear
            gain_env = np.where(ramp_pos < 0, 0.0, gain_env)

            composite = (truth_env * truth_c + gain_env * spoof_c) * scale
            fo.write(_to_int8_bytes(composite))
            sample_idx += n
    return out_path


def _delay_at(t_s, lock_time_s, duration_s, delay_s):
    if t_s < lock_time_s:
        return 0.0
    frac = min(max((t_s - lock_time_s) / duration_s, 0.0), 1.0) if duration_s > 0 else 1.0
    d0, d1 = delay_s if isinstance(delay_s, (list, tuple)) else (delay_s, delay_s)
    return d0 + (d1 - d0) * frac


def meacon(truth_path, out_path, sample_rate, lock_time_s, delay_s, duration_s, chunk_samples=1_000_000):
    """Delayed rebroadcast of `truth_path`: passthrough for lock_time_s, then a
    receding read pointer (per-chunk constant delay) for duration_s. `delay_s`
    is a scalar (fixed relay) or [start, end] (linear walk-off ramp).
    """
    total = _sample_count(truth_path)
    n_total = min(round((lock_time_s + duration_s) * sample_rate), total)

    with open(truth_path, "rb") as ft, open(out_path, "wb") as fo:
        sample_idx = 0
        while sample_idx < n_total:
            n = min(chunk_samples, n_total - sample_idx)
            t_mid = (sample_idx + n / 2) / sample_rate
            delay_samples = round(_delay_at(t_mid, lock_time_s, duration_s, delay_s) * sample_rate)

            window = _read_window(ft, total, sample_idx - delay_samples, n)
            fo.write(_to_int8_bytes(window))
            sample_idx += n
    return out_path
