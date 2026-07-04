# Ephemeris data

`brdc1810.26n` is a RINEX 2 GPS broadcast navigation file for day-of-year 181,
2026 (2026-06-30), pulled from [CDDIS](https://cddis.nasa.gov/archive/gnss/data/daily/).
It's the ephemeris `gps-sdr-sim` reads to place satellites for simulation —
`scripts/generate_iq_samples.py` uses it as the default for every scenario in
`config/iq-sample-config.yaml` (`gps_sdr_sim.ephemeris`), and each scenario's
`start_time` must fall within the day this file covers.

To simulate a different day, download a fresh `brdc<doy>0.<yy>n` file from the
CDDIS daily archive (free registration required), drop it in this directory,
and point `gps_sdr_sim.ephemeris` (or a per-scenario override) at it — the
`start_time` values in the config need to move to match.
