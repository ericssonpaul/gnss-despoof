"""User-motion CSV generation for gps-sdr-sim's -x (lat,lon,height) dynamic mode.

Port of the old prototype's drift.py, generalized to an arbitrary origin,
offset distance, and bearing instead of hardcoded constants.
"""

import math

EARTH_RADIUS_M = 6378137.0
MOTION_RATE_HZ = 10.0  # gps-sdr-sim requires -x motion files sampled at 10 Hz


def destination_point(lat, lon, bearing_deg, distance_m):
    """Flat-earth destination point. Fine for the offsets used here (<= a few km)."""
    bearing_rad = math.radians(bearing_deg)
    dnorth = distance_m * math.cos(bearing_rad)
    deast = distance_m * math.sin(bearing_rad)
    dlat = dnorth / EARTH_RADIUS_M
    dlon = deast / (EARTH_RADIUS_M * math.cos(math.radians(lat)))
    return lat + math.degrees(dlat), lon + math.degrees(dlon)


def _write_llh_csv(out_path, times, lats, lons, height):
    with open(out_path, "w") as f:
        for t, lat, lon in zip(times, lats, lons):
            f.write(f"{t:.1f},{lat:.7f},{lon:.7f},{height:.1f}\n")
    return out_path


def linear_drift(out_path, origin, offset_m, bearing_deg, duration_static_s, duration_drift_s,
                  dt=1.0 / MOTION_RATE_HZ):
    """Static hold at `origin` for duration_static_s, then a linear walk to the
    point `offset_m` away at `bearing_deg`, over duration_drift_s.

    Used both for the standalone `drift` scenario (legitimate motion) and for
    the drag-off phase of a `capture_dragoff` attack.
    """
    lat0, lon0, height = origin["lat"], origin["lon"], origin["height"]
    lat1, lon1 = destination_point(lat0, lon0, bearing_deg, offset_m)

    n_static = round(duration_static_s / dt)
    n_drift = round(duration_drift_s / dt)
    n_total = n_static + n_drift

    times = [round(i * dt, 1) for i in range(n_total)]
    lats = [lat0] * n_static
    lons = [lon0] * n_static
    if n_drift > 0:
        lats += [lat0 + (lat1 - lat0) * i / max(n_drift - 1, 1) for i in range(n_drift)]
        lons += [lon0 + (lon1 - lon0) * i / max(n_drift - 1, 1) for i in range(n_drift)]

    return _write_llh_csv(out_path, times, lats, lons, height)
