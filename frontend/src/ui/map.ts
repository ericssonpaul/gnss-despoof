/**
 * The real map. CartoDB's free "dark matter" raster basemap - no API key,
 * matches the console's palette. That tile set is a free tier meant for
 * light/dev use; swap the tileLayer URL for self-hosted tiles before this
 * carries real production traffic (see the CartoDB attribution/ToS).
 */
import L from 'leaflet';
import type { FeedState, LatLon, Location } from '../types';

const DARK_TILES_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const DARK_TILES_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const MAX_TRAIL_POINTS = 600;

function diamondIcon(): L.DivIcon {
  return L.divIcon({ className: 'map-marker map-marker-init', iconSize: [10, 10] });
}
function dotIcon(flagged: boolean): L.DivIcon {
  return L.divIcon({ className: `map-marker map-marker-reported${flagged ? ' flagged' : ''}`, iconSize: [12, 12] });
}

export interface MapView {
  update(state: FeedState, initialFix: Location): void;
  /** Call once when the feed switches to a new scenario/location. */
  resetTrail(initialFix: Location): void;
}

export function buildMap(): MapView {
  const mapContainer = document.getElementById('map')!;
  const map = L.map(mapContainer, { zoomControl: false, attributionControl: true }).setView(
    [59.32683289715587, 18.071642383877435],
    15,
  );

  L.tileLayer(DARK_TILES_URL, { attribution: DARK_TILES_ATTRIBUTION, maxZoom: 20, subdomains: 'abcd' }).addTo(map);

  // Leaflet measures its container once at creation; if that doesn't match
  // the container's final laid-out size (e.g. because this runs before the
  // page has settled), tiles render into the wrong bounds - a stray gap
  // down the middle of the screen is the classic symptom. Re-measure once
  // after the next paint, and again on every resize.
  requestAnimationFrame(() => map.invalidateSize());
  new ResizeObserver(() => map.invalidateSize()).observe(mapContainer);

  const initMarker = L.marker([0, 0], { icon: diamondIcon(), interactive: false });
  const reportedMarker = L.marker([0, 0], { icon: dotIcon(false), interactive: false }).addTo(map);
  const trail = L.polyline([], { color: 'rgba(255,255,255,0.45)', weight: 2 }).addTo(map);
  let trailPoints: LatLon[] = [];

  let follow = false;
  let showPath = true;

  document.getElementById('show-path-chk')!.addEventListener('change', (e) => {
    showPath = (e.target as HTMLInputElement).checked;
    if (showPath) trail.addTo(map);
    else trail.remove();
  });
  document.getElementById('follow-chk')!.addEventListener('change', (e) => {
    follow = (e.target as HTMLInputElement).checked;
  });
  document.getElementById('zoom-in-btn')!.addEventListener('click', () => map.zoomIn());
  document.getElementById('zoom-out-btn')!.addEventListener('click', () => map.zoomOut());
  document.getElementById('recenter-btn')!.addEventListener('click', () => {
    follow = false;
    (document.getElementById('follow-chk') as HTMLInputElement).checked = false;
    map.setView(initMarker.getLatLng(), 15);
  });

  return {
    resetTrail(initialFix) {
      trailPoints = [];
      trail.setLatLngs([]);
      initMarker.setLatLng([initialFix.lat, initialFix.lon]);
      if (!map.hasLayer(initMarker)) initMarker.addTo(map);
      map.setView([initialFix.lat, initialFix.lon], 15);
    },

    update(state, _initialFix) {
      const reportedLatLng: L.LatLngExpression = [state.position.lat, state.position.lon];
      reportedMarker.setLatLng(reportedLatLng);
      reportedMarker.setIcon(dotIcon(state.distortion > 0.3));

      if (showPath) {
        trailPoints.push({ lat: state.position.lat, lon: state.position.lon });
        if (trailPoints.length > MAX_TRAIL_POINTS) trailPoints.shift();
        trail.setLatLngs(trailPoints.map((p) => [p.lat, p.lon]));
      }

      if (follow) map.panTo(reportedLatLng, { animate: false });
    },
  };
}
