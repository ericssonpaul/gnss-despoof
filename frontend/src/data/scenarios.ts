/**
 * Scenario data, ported from ../../../config/iq-sample-config.yaml.
 * Pure data only - the physics/posture behavior per scenario kind lives in
 * simulation.ts, so a scenario is just "what", not "how".
 */
import type { DetectorInfo, GraphKindInfo, Location, LocationId, SatGeometry } from '../types';

interface ScenarioBase {
  id: string;
  label: string;
  location: LocationId;
  /** Total duration in seconds. */
  duration: number;
}
export interface CleanScenario extends ScenarioBase {
  kind: 'clean';
}
export interface DriftScenario extends ScenarioBase {
  kind: 'drift';
  offsetM: number;
  bearingDeg: number;
  staticS: number;
  driftS: number;
}
export interface MeaconingScenario extends ScenarioBase {
  kind: 'meaconing';
  lock: number;
  /** [start, end] delay in microseconds - equal for a fixed delay. */
  delay: [number, number];
}
export interface OpenLoopJumpScenario extends ScenarioBase {
  kind: 'open_loop_jump';
  lock: number;
  offsetM: number;
  bearingDeg: number;
}
export interface CaptureDragoffScenario extends ScenarioBase {
  kind: 'capture_dragoff';
  lock: number;
  ramp: number;
  dragoff: number;
  gainDb: number;
  offsetM: number;
  bearingDeg: number;
}
export type Scenario =
  | CleanScenario
  | DriftScenario
  | MeaconingScenario
  | OpenLoopJumpScenario
  | CaptureDragoffScenario;

export const LOCATIONS: Record<LocationId, Location> = {
  castle: { lat: 59.32683289715587, lon: 18.071642383877435, alt: 10.0 },
  globe: { lat: 59.29376605417365, lon: 18.0831867203329, alt: 100.0 },
  kings_garden: { lat: 59.3314457073141, lon: 18.071403601575426, alt: 10.0 },
};

/** Real satellite geometry captured from an actual gps-sdr-sim run against
 * data/ephemeris/brdc1810.26n. Azimuth isn't included - see README. */
export const SAT_GEOMETRY: SatGeometry[] = [
  { prn: '01', el: 51.1, range: 21329805.2 },
  { prn: '02', el: 24.9, range: 23621733.6 },
  { prn: '03', el: 84.2, range: 20039372.8 },
  { prn: '04', el: 30.6, range: 22838701.3 },
  { prn: '06', el: 15.2, range: 24175100.1 },
  { prn: '09', el: 2.1, range: 25605628.3 },
  { prn: '12', el: 10.3, range: 24459374.6 },
  { prn: '13', el: 10.6, range: 24601935.3 },
];

export const DETECTORS: DetectorInfo[] = [
  { id: 'd1', name: 'RAIM' },
  { id: 'd2', name: 'Observables / RPM' },
  { id: 'd3', name: 'Correlation distortion' },
  { id: 'd4', name: 'Clock / drift monitor' },
];

export const SCENARIOS: Scenario[] = [
  { id: 'clean_castle', label: 'Clean — Castle', kind: 'clean', location: 'castle', duration: 390 },
  { id: 'clean_globe', label: 'Clean — Globe', kind: 'clean', location: 'globe', duration: 390 },
  { id: 'clean_kings_garden', label: 'Clean — Kings Garden', kind: 'clean', location: 'kings_garden', duration: 390 },
  {
    id: 'drift_control_castle_to_globe', label: 'Drift control', kind: 'drift', location: 'castle', duration: 380,
    offsetM: 500, bearingDeg: 45, staticS: 50, driftS: 330,
  },
  {
    id: 'meaconing_kings_garden_fixed', label: 'Meaconing — fixed delay', kind: 'meaconing', location: 'kings_garden',
    duration: 360, lock: 60, delay: [6.67, 6.67],
  },
  {
    id: 'meaconing_globe_walkoff', label: 'Meaconing — walk-off', kind: 'meaconing', location: 'globe',
    duration: 360, lock: 60, delay: [0, 100],
  },
  {
    id: 'open_loop_jump_kings_garden', label: 'Open-loop jump', kind: 'open_loop_jump', location: 'kings_garden',
    duration: 360, lock: 60, offsetM: 4000, bearingDeg: 90,
  },
  {
    id: 'capture_dragoff_globe', label: 'Capture / drag-off', kind: 'capture_dragoff', location: 'globe',
    duration: 390, lock: 50, ramp: 80, dragoff: 260, gainDb: 10.0, offsetM: 500, bearingDeg: 45,
  },
  {
    id: 'capture_dragoff_stealthy_kings_garden', label: 'Capture / drag-off — stealthy', kind: 'capture_dragoff', location: 'kings_garden',
    duration: 380, lock: 40, ramp: 150, dragoff: 190, gainDb: 3.0, offsetM: 150, bearingDeg: 200,
  },
];

export const GRAPH_KINDS: GraphKindInfo[] = [
  { id: 'pos', label: 'Position error', perSat: false },
  { id: 'alt', label: 'Altitude', perSat: false },
  { id: 'clk', label: 'Clock offset', perSat: false },
  { id: 'dil', label: 'DOP', perSat: false },
  { id: 'cn0', label: 'C/N₀', perSat: true },
  { id: 'dop', label: 'Doppler', perSat: true },
  { id: 'iq', label: 'I/Q constellation', perSat: true },
];

export const DOP_SERIES = [
  { key: 'gdop', label: 'GDOP', color: '#f2f2f2' },
  { key: 'pdop', label: 'PDOP', color: '#9a9a9a' },
  { key: 'hdop', label: 'HDOP', color: '#6b6b6b' },
  { key: 'vdop', label: 'VDOP', color: '#e0e0e0' },
] as const;
