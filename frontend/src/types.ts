/**
 * Shared types. `FeedState` is the important one: it's the contract every
 * `Feed` implementation (simulated today, a real WebSocket client later)
 * must produce once per tick. Every UI module reads `FeedState` and nothing
 * else — none of them know or care where it came from.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Location extends LatLon {
  alt: number;
}

export type LocationId = 'castle' | 'globe' | 'kings_garden';

export interface SatGeometry {
  prn: string;
  /** Elevation in degrees. Azimuth isn't modeled yet - see README. */
  el: number;
  /** Range in meters, captured from a real gps-sdr-sim run. */
  range: number;
}

export type DetectorId = 'd1' | 'd2' | 'd3' | 'd4';
/** 0 = inactive/no attack, 1 = low, 2 = mid, 3 = high. */
export type DetectorSeverity = 0 | 1 | 2 | 3;
export type Posture = Record<DetectorId, DetectorSeverity>;

export interface DetectorInfo {
  id: DetectorId;
  name: string;
}

/** One tracked satellite's latest reading. No history here - see history.ts. */
export interface SatelliteReading {
  prn: string;
  /** Elevation in degrees. Only the simulated feed can supply this - see README. */
  el?: number;
  /** GNSS constellation ("G"/"R"/"S"/"E"/"C") - real feed only. */
  system?: string;
  /** Signal identifier ("1C", "L5", ...) - real feed only. */
  signal?: string;
  /** GNSS-SDR's tracking channel index - real feed only. */
  channelId?: number;
  cn0DbHz: number;
  dopplerHz: number;
  pseudorangeM: number;
  /** C/N0 above the tracking threshold. */
  locked: boolean;
  /** Telemetry decoder validity - distinct from `locked`. */
  tlmValid: boolean;
  /** Carrier cycle slip flag - real feed only. */
  flagCycleSlip?: boolean;
  /** Time of week of this reading, ms - real feed only. */
  towMs?: number;
}

export interface DopReading {
  gdop: number;
  pdop: number;
  hdop: number;
  vdop: number;
}

export interface LogEvent {
  simTimeS: number;
  text: string;
  alert: boolean;
}

/** Velocity in ECEF, m/s - what the real PVT solution actually provides
 * (no local ENU velocity on the wire). Real feed only. */
export interface EcefVelocity {
  x: number;
  y: number;
  z: number;
}

/** Everything the UI needs to render one tick. Produced by a `Feed`. */
export interface FeedState {
  simTimeS: number;
  feedLabel: string;
  phase: string;
  /** The reference position this session is anchored to (unmoving). */
  initialFix: Location;
  position: Location;
  clockOffsetUs: number;
  /** Horizontal distance in meters from the initial/true fix. */
  posErrM: number;
  /** 0..1, drives the "flagged" visual state on the map and I/Q plot. */
  distortion: number;
  posture: Posture;
  satellites: SatelliteReading[];
  dop: DopReading;
  /** Events new since the previous tick, if any (usually empty). */
  newEvents: LogEvent[];

  /** False until at least one real position fix has been seen this session
   * - before that, `position`/`initialFix` are meaningless placeholders
   * (WebSocketFeed has nothing real to report yet), not an actual 0,0 fix.
   * Always true for SimulatedFeed, which has a position from t=0. */
  hasFix: boolean;
  /** UTC-equivalent instant (epoch ms) of the receiver's own GPS time
   * solution - distinct from the wall clock this browser is running on.
   * Real feed only; the simulation has no real GPS week/TOW to derive it from. */
  gnssTimeMs?: number;
  velocity?: EcefVelocity;
  /** RTKLIB solution status/type, and satellite count in the solution - real feed only. */
  solutionStatus?: number;
  solutionType?: number;
  validSats?: number;
  /** False while a WebSocketFeed is disconnected/reconnecting. Always true
   * for SimulatedFeed, which can't fail. */
  connected?: boolean;
}

export type Unsubscribe = () => void;

/** Where FeedState comes from. Implement this once for the real backend. */
export interface Feed {
  subscribe(listener: (state: FeedState) => void): Unsubscribe;
  start(): void;
  stop(): void;
}

export interface GraphKindInfo {
  id: string;
  label: string;
  perSat: boolean;
}
