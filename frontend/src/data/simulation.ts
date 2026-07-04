/**
 * The physics/behavior side of a scenario: given a scenario and a time
 * offset, what's the receiver's local-frame offset and detector posture?
 * Ported from the standalone console prototype's stateAt()/posture logic.
 *
 * This whole module is a stand-in for real detector output and should be
 * deleted once `WebSocketFeed` (see feed.ts) is wired to a live backend -
 * nothing outside `data/` should import from here directly.
 */
import type { Location, Posture } from '../types';
import type { Scenario } from './scenarios';

export interface LocalState {
  /** Meters east of the initial fix. */
  x: number;
  /** Meters north of the initial fix. */
  y: number;
  /** Meters above the location's nominal altitude. */
  altOffset: number;
  clockOffsetUs: number;
  phase: string;
  /** 0..1 signal/correlation distortion, peaks during an active drag-off. */
  distortion: number;
}

const NONE_POSTURE: Posture = { d1: 0, d2: 0, d3: 0, d4: 0 };
const LOCK_STATE: LocalState = { x: 0, y: 0, altOffset: 0, clockOffsetUs: 0, phase: 'LOCK', distortion: 0 };

export function bearingOffset(bearingDeg: number, distM: number): { x: number; y: number } {
  const r = (bearingDeg * Math.PI) / 180;
  return { x: distM * Math.sin(r), y: distM * Math.cos(r) };
}

/** Flat-earth approximation, matching scripts/motion_profiles.py's math. */
export function metersToLatLon(loc: Location, x: number, y: number): { lat: number; lon: number } {
  const R = 6378137;
  const dLat = y / R;
  const dLon = x / (R * Math.cos((loc.lat * Math.PI) / 180));
  return { lat: loc.lat + (dLat * 180) / Math.PI, lon: loc.lon + (dLon * 180) / Math.PI };
}

export function stateAt(sc: Scenario, t: number): LocalState {
  switch (sc.kind) {
    case 'clean':
      return LOCK_STATE;

    case 'drift': {
      if (t < sc.staticS) return LOCK_STATE;
      const frac = Math.min((t - sc.staticS) / sc.driftS, 1);
      const off = bearingOffset(sc.bearingDeg, sc.offsetM * frac);
      return { x: off.x, y: off.y, altOffset: frac * 2.2, clockOffsetUs: 0, phase: 'MOVING', distortion: 0 };
    }

    case 'meaconing': {
      if (t < sc.lock) return LOCK_STATE;
      const frac = Math.min((t - sc.lock) / (sc.duration - sc.lock), 1);
      const clockOffsetUs = sc.delay[0] + (sc.delay[1] - sc.delay[0]) * frac;
      return { x: 0, y: 0, altOffset: 0, clockOffsetUs, phase: 'MEACON', distortion: 0 };
    }

    case 'open_loop_jump': {
      if (t < sc.lock) return LOCK_STATE;
      const off = bearingOffset(sc.bearingDeg, sc.offsetM);
      const distortion = t - sc.lock < 3 ? 1 : 0.15; // brief reacquisition transient
      return { x: off.x, y: off.y, altOffset: -6.5, clockOffsetUs: 0, phase: 'JUMPED', distortion };
    }

    case 'capture_dragoff': {
      if (t < sc.lock) return LOCK_STATE;
      const rampT = t - sc.lock;
      if (rampT < sc.ramp) {
        return { x: 0, y: 0, altOffset: 0, clockOffsetUs: 0, phase: 'CAPTURE', distortion: (rampT / sc.ramp) * 0.3 };
      }
      const frac = Math.min((rampT - sc.ramp) / sc.dragoff, 1);
      const off = bearingOffset(sc.bearingDeg, sc.offsetM * frac);
      const altOffset = frac * (sc.gainDb > 5 ? 4.5 : 1.4);
      // Correlation distortion (D3) flares as the drag-off begins and fades
      // as the spoofed and true signals separate too far to interact.
      const distortion = frac < 0.35 ? (1 - frac / 0.35) * 0.9 + 0.1 : 0.08;
      return { x: off.x, y: off.y, altOffset, clockOffsetUs: 0, phase: 'DRAG-OFF', distortion };
    }
  }
}

export function postureAt(sc: Scenario, t: number): Posture {
  switch (sc.kind) {
    case 'clean':
    case 'drift':
      return NONE_POSTURE;

    case 'meaconing':
      return t < sc.lock ? NONE_POSTURE : { d1: 1, d2: 2, d3: 1, d4: 3 };

    case 'open_loop_jump':
      return t < sc.lock ? NONE_POSTURE : { d1: 1, d2: 3, d3: 2, d4: 3 };

    case 'capture_dragoff': {
      if (t < sc.lock) return NONE_POSTURE;
      const rampT = t - sc.lock;
      if (rampT < sc.ramp) return { d1: 1, d2: sc.gainDb > 5 ? 2 : 1, d3: 1, d4: 1 };
      const frac = Math.min((rampT - sc.ramp) / sc.dragoff, 1);
      const isAggressive = sc.gainDb > 5;
      const d3 = frac < 0.35 ? (isAggressive ? 3 : 2) : 1;
      return { d1: 1, d2: isAggressive ? 2 : 1, d3, d4: isAggressive ? 3 : 1 };
    }
  }
}
