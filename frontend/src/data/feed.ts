/**
 * Two `Feed` implementations:
 *   - `SimulatedFeed` runs the scenario simulation locally and auto-cycles
 *     through every scenario, standing in for a live detector.
 *   - `WebSocketFeed` connects to a real `detector_core` process and maps
 *     its wire `Snapshot` JSON (see detector/snapshot.hpp) into `FeedState`.
 * `main.ts` picks one; nothing in `src/ui/` needs to change either way,
 * since it only ever sees `FeedState`.
 */
import { DETECTORS, LOCATIONS, SAT_GEOMETRY, SCENARIOS } from './scenarios';
import { metersToLatLon, postureAt, stateAt } from './simulation';
import type {
  DopReading,
  Feed,
  FeedState,
  LatLon,
  LogEvent,
  Posture,
  SatelliteReading,
  Unsubscribe,
} from '../types';

const NONE_POSTURE: Posture = { d1: 0, d2: 0, d3: 0, d4: 0 };
const C_MPS_PER_US = 299.792458; // speed of light, meters per microsecond
const PLAYBACK_SPEED = 6; // simulated seconds per real second; fixed, not user-controlled

// SAT_GEOMETRY is real single-constellation GPS ephemeris (see scenarios.ts) -
// its range/el values stay untouched. But a real receiver tracks a mix of
// constellations/signals, and channel IDs come from the receiver's own slot
// allocation, not PRN order. Rotating a cosmetic system/signal label and a
// fixed shuffled channel id across the simulated satellites is purely so the
// Tracking table's SYS/CH columns demo the way they'd actually render against
// a live multi-GNSS feed, without claiming this specific recording was multi-GNSS.
const SIM_SIGNALS: Array<{ system: string; signal: string }> = [
  { system: 'G', signal: '1C' }, // GPS L1 C/A
  { system: 'R', signal: '1C' }, // GLONASS L1OF
  { system: 'E', signal: '1B' }, // Galileo E1B
  { system: 'C', signal: '2I' }, // BeiDou B1I
];
const SIM_CHANNEL_ORDER = [2, 5, 0, 7, 3, 1, 6, 4];

export class SimulatedFeed implements Feed {
  private listeners: Array<(state: FeedState) => void> = [];
  private scenarioIndex = 7; // start on the flagship capture/drag-off
  private simTimeS = 0;
  private prevPhase = 'LOCK';
  private prevPosture: Posture = NONE_POSTURE;
  private lastWallMs = 0;
  private rafId: number | null = null;
  private hasLoggedStart = false;

  subscribe(listener: (state: FeedState) => void): Unsubscribe {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  start(): void {
    this.lastWallMs = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private tick = (nowWallMs: number): void => {
    const dt = Math.min((nowWallMs - this.lastWallMs) / 1000, 0.25);
    this.lastWallMs = nowWallMs;
    this.simTimeS += dt * PLAYBACK_SPEED;

    const newEvents: LogEvent[] = [];
    let scenario = SCENARIOS[this.scenarioIndex]!;
    if (!this.hasLoggedStart) {
      this.hasLoggedStart = true;
      newEvents.push({ simTimeS: 0, text: `FEED → ${scenario.label}`, alert: false });
    }
    if (this.simTimeS >= scenario.duration) {
      this.scenarioIndex = (this.scenarioIndex + 1) % SCENARIOS.length;
      this.simTimeS = 0;
      this.prevPhase = 'LOCK';
      this.prevPosture = NONE_POSTURE;
      scenario = SCENARIOS[this.scenarioIndex]!;
      newEvents.push({ simTimeS: 0, text: `FEED → ${scenario.label}`, alert: false });
    }

    const local = stateAt(scenario, this.simTimeS);
    const posture = postureAt(scenario, this.simTimeS);

    if (local.phase !== this.prevPhase) {
      newEvents.push({ simTimeS: this.simTimeS, text: `PHASE → ${local.phase}`, alert: false });
      this.prevPhase = local.phase;
    }
    for (const d of DETECTORS) {
      const sev = posture[d.id];
      if (sev !== this.prevPosture[d.id] && sev > 0) {
        newEvents.push({
          simTimeS: this.simTimeS,
          text: `${d.id.toUpperCase()} ${d.name.toUpperCase()} → ${['—', 'LOW', 'MID', 'HIGH'][sev]}`,
          alert: sev >= 3,
        });
      }
    }
    this.prevPosture = posture;

    const posErrM = Math.hypot(local.x, local.y);
    const loc = LOCATIONS[scenario.location];
    const ll = metersToLatLon(loc, local.x, local.y);

    const satellites: SatelliteReading[] = SAT_GEOMETRY.map((s, index) => {
      const elFactor = Math.sin((s.el * Math.PI) / 180);
      let cn0DbHz = 33 + elFactor * 14 + Math.sin(this.simTimeS * 0.7 + s.el) * 0.6 + (Math.random() - 0.5) * 0.8;
      const dopplerHz = Math.sin(this.simTimeS * 0.05 + s.el * 0.02) * 2400 + (Math.random() - 0.5) * 40;
      if (local.distortion > 0.05) cn0DbHz -= local.distortion * 9;
      if (scenario.kind === 'meaconing') cn0DbHz += 1.2; // relay gain nudges power up slightly
      const locked = cn0DbHz > 28;
      const pseudorangeM = s.range + local.clockOffsetUs * C_MPS_PER_US + posErrM * 0.3 + (Math.random() - 0.5) * 2;
      // system/signal/channelId/towMs mirror what the real feed reports, so
      // the same UI columns render meaningfully in both modes - see
      // SIM_SIGNALS/SIM_CHANNEL_ORDER above for why they vary per satellite.
      const { system, signal } = SIM_SIGNALS[index % SIM_SIGNALS.length]!;
      return {
        prn: s.prn,
        el: s.el,
        system,
        signal,
        channelId: SIM_CHANNEL_ORDER[index % SIM_CHANNEL_ORDER.length]!,
        cn0DbHz,
        dopplerHz,
        pseudorangeM,
        locked,
        tlmValid: locked && local.distortion < 0.4,
        flagCycleSlip: local.distortion > 0.5 && Math.random() < 0.1,
        towMs: Math.round(this.simTimeS * 1000),
      };
    });

    const lockedCount = satellites.filter((s) => s.locked).length;
    const dopBase = 1 + (SAT_GEOMETRY.length - lockedCount) * 0.6 + local.distortion * 1.5;
    const dop: DopReading = {
      gdop: dopBase * 1.35 + (Math.random() - 0.5) * 0.05,
      pdop: dopBase * 1.05 + (Math.random() - 0.5) * 0.05,
      hdop: dopBase * 0.65 + (Math.random() - 0.5) * 0.03,
      vdop: dopBase * 0.85 + (Math.random() - 0.5) * 0.04,
    };

    const state: FeedState = {
      simTimeS: this.simTimeS,
      feedLabel: scenario.label,
      phase: local.phase,
      initialFix: loc,
      position: { lat: ll.lat, lon: ll.lon, alt: loc.alt + local.altOffset },
      clockOffsetUs: local.clockOffsetUs,
      posErrM,
      distortion: local.distortion,
      posture,
      satellites,
      dop,
      newEvents,
      // velocity is left unset here - it's genuinely ECEF on the real feed
      // and there's no honest way to fake that from this local ENU-ish
      // simulation, so the UI shows "-" rather than a made-up number.
      validSats: lockedCount,
      solutionStatus: lockedCount >= 4 ? 4 : 0,
      solutionType: 0,
      connected: true, // SimulatedFeed can't fail
      hasFix: true, // SimulatedFeed has a position from t=0
    };
    for (const listener of this.listeners) listener(state);

    this.rafId = requestAnimationFrame(this.tick);
  };
}

/* ============================================================
   WebSocketFeed
   ============================================================ */

// Mirrors detector/snapshot.hpp's to_json() shape exactly. Deliberately
// separate from FeedState: this is the wire contract, FeedState is the UI
// contract, and map() below is the one place that translates between them.
//
// One receiver's raw telemetry, pushed immediately on every PVT/synchro
// update. `type` is how these are told apart from DetectionResultWire below
// - both land on the same WebSocket connection (see detector/ws_server.cpp),
// so there's no other signal to dispatch on.
interface DetectorSnapshotWire {
  type: 'snapshot';
  receiver: { name: string; sessionId: string; sessionTimeS: number };
  pvt: {
    latitude: number;
    longitude: number;
    height: number;
    velX: number;
    velY: number;
    velZ: number;
    clockOffsetS: number;
    gpsWeek: number;
    gpsTowS: number;
    gdop: number;
    pdop: number;
    hdop: number;
    vdop: number;
    solutionStatus: number;
    solutionType: number;
    validSats: number;
  } | null;
  satellites: Array<{
    system: string;
    signal: string;
    prn: number;
    channelId: number;
    cn0DbHz: number;
    dopplerHz: number;
    pseudorangeM: number;
    flagValidPseudorange: boolean;
    flagValidWord: boolean;
    flagCycleSlip: boolean;
    towMs: number;
  }>;
}

// One DetectionEngine cycle's consolidated, fleet-wide verdict - mirrors
// detector/detection_engine.hpp's DetectionResult/Finding. Not tied to a
// single receiver, and NOT yet surfaced in FeedState: `findings` is a
// dynamic named list (Finding::method is a free-form id like "raim"), while
// FeedState.posture/Posture is still the old fixed d1..d4 shape - mapping
// one onto the other needs that type to change too, which is intentionally
// left open (see detector/unit.hpp's header comment) until a real Unit
// exists to inform what the mapping should look like.
interface DetectionResultWire {
  type: 'detection';
  sessionTimeS: number;
  findings: Array<{
    method: string;
    severity: 'none' | 'low' | 'mid' | 'high';
    detail: string;
    receivers: string[];
  }>;
}

type WireMessage = DetectorSnapshotWire | DetectionResultWire;

const RECONNECT_DELAY_MS = 2000;

const GPS_EPOCH_MS = Date.UTC(1980, 0, 6);
// GPS time has run 18s ahead of UTC since the last leap second (2016-12-31)
// and none has been added since - fine to hardcode for this project's scope.
const GPS_UTC_LEAP_S = 18;

function gpsTimeToUtcMs(week: number, towS: number): number {
  return GPS_EPOCH_MS + week * 7 * 86400 * 1000 + towS * 1000 - GPS_UTC_LEAP_S * 1000;
}

function distanceMeters(a: LatLon, b: LatLon): number {
  // Equirectangular approximation - fine at the sub-km scales this UI cares
  // about, matches the flat-earth math already used in simulation.ts.
  const R = 6378137;
  const avgLatRad = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLon = (b.lon - a.lon) * (Math.PI / 180) * Math.cos(avgLatRad);
  return Math.hypot(dLat, dLon) * R;
}

export class WebSocketFeed implements Feed {
  private listeners: Array<(state: FeedState) => void> = [];
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private stopped = false;

  private baseline: LatLon | null = null;
  private lastSessionId: string | null = null;
  private lastPhase: string | null = null;
  private lastPosition: LatLon & { alt: number } = { lat: 0, lon: 0, alt: 0 };
  private lastEmitted: FeedState | null = null;
  // Last severity reported per Finding::method - lets 'detection' messages
  // (one full, level-triggered verdict per DetectionEngine cycle, same as
  // Snapshot) turn into edge-triggered log lines instead of one duplicate
  // entry every cycle a condition stays active.
  private lastFindingSeverity = new Map<string, DetectionResultWire['findings'][number]['severity']>();

  constructor(private readonly url: string = WebSocketFeed.defaultUrl()) {}

  static defaultUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  subscribe(listener: (state: FeedState) => void): Unsubscribe {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    // No action needed on 'open' - the first real snapshot (which carries
    // connected: true) arrives almost immediately since the backend pushes
    // on every update, not on a poll/request cycle.
    ws.addEventListener('message', (event) => {
      try {
        const wire = JSON.parse(event.data as string) as WireMessage;
        if (wire.type === 'snapshot') {
          this.emit(this.map(wire));
        } else if (wire.type === 'detection') {
          this.handleDetection(wire);
        }
      } catch (err) {
        console.error('WebSocketFeed: failed to parse message', err);
      }
    });
    ws.addEventListener('close', () => this.scheduleReconnect());
    ws.addEventListener('error', () => ws.close());
  }

  private scheduleReconnect(): void {
    this.emitConnectivity(false);
    if (this.stopped || this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connect();
    }, RECONNECT_DELAY_MS);
  }

  // Fired on disconnect (and on connect, to clear it) so the UI can show a
  // real "disconnected" state instead of silently freezing on the last
  // frame - SimulatedFeed never needs this since it can't fail.
  private emitConnectivity(connected: boolean): void {
    for (const listener of this.listeners) {
      listener({ ...this.lastEmittedOrPlaceholder(), connected });
    }
  }

  private emit(state: FeedState): void {
    this.lastEmitted = state;
    for (const listener of this.listeners) listener(state);
  }

  // 'detection' messages arrive on their own ~1s DetectionEngine cycle,
  // decoupled from the snapshot stream - not every tick has one, so this
  // patches newEvents onto whatever FeedState was last emitted (same trick
  // as emitConnectivity) rather than waiting for the next snapshot.
  private handleDetection(wire: DetectionResultWire): void {
    console.debug('DEBUG handleDetection', wire.sessionTimeS, JSON.stringify(wire.findings), [...this.lastFindingSeverity]);
    const newEvents: LogEvent[] = [];
    const seenMethods = new Set<string>();

    for (const f of wire.findings) {
      seenMethods.add(f.method);
      const prevSeverity = this.lastFindingSeverity.get(f.method) ?? 'none';
      if (f.severity !== prevSeverity) {
        newEvents.push({
          simTimeS: wire.sessionTimeS,
          text: `${f.method.replace(/_/g, ' ').toUpperCase()} → ${f.severity.toUpperCase()}: ${f.detail}`,
          alert: f.severity === 'high',
        });
      }
      this.lastFindingSeverity.set(f.method, f.severity);
    }

    // Unit::exec returns {} for "nothing to report" (see unit.hpp) - a
    // method that was active and is simply absent from this cycle's
    // findings is itself the "cleared" signal, not a separate message type.
    for (const [method, prevSeverity] of this.lastFindingSeverity) {
      if (seenMethods.has(method) || prevSeverity === 'none') continue;
      newEvents.push({ simTimeS: wire.sessionTimeS, text: `${method.replace(/_/g, ' ').toUpperCase()} → CLEAR`, alert: false });
      this.lastFindingSeverity.set(method, 'none');
    }

    if (newEvents.length === 0) return;
    this.emit({ ...this.lastEmittedOrPlaceholder(), newEvents });
  }

  private lastEmittedOrPlaceholder(): FeedState {
    return (
      this.lastEmitted ?? {
        simTimeS: 0,
        feedLabel: 'Disconnected',
        phase: 'NO_FIX',
        initialFix: { lat: 0, lon: 0, alt: 0 },
        position: { lat: 0, lon: 0, alt: 0 },
        clockOffsetUs: 0,
        posErrM: 0,
        distortion: 0,
        posture: { d1: 0, d2: 0, d3: 0, d4: 0 },
        satellites: [],
        dop: { gdop: 0, pdop: 0, hdop: 0, vdop: 0 },
        newEvents: [],
        connected: false,
        hasFix: false,
      }
    );
  }

  private map(wire: DetectorSnapshotWire): FeedState {
    if (wire.receiver.sessionId !== this.lastSessionId) {
      this.lastSessionId = wire.receiver.sessionId;
      this.baseline = null; // new session (receiver reconnect/restart) - re-baseline posErrM
    }

    if (wire.pvt) {
      this.lastPosition = { lat: wire.pvt.latitude, lon: wire.pvt.longitude, alt: wire.pvt.height };
      if (!this.baseline) this.baseline = { lat: wire.pvt.latitude, lon: wire.pvt.longitude };
    }

    const satellites: SatelliteReading[] = wire.satellites.map((s) => ({
      prn: String(s.prn).padStart(2, '0'),
      system: s.system,
      signal: s.signal,
      channelId: s.channelId,
      cn0DbHz: s.cn0DbHz,
      dopplerHz: s.dopplerHz,
      pseudorangeM: s.pseudorangeM,
      locked: s.flagValidPseudorange,
      tlmValid: s.flagValidWord,
      flagCycleSlip: s.flagCycleSlip,
      towMs: s.towMs,
    }));

    const phase = wire.pvt ? 'FIX' : 'ACQUIRING';
    const newEvents: LogEvent[] = [];
    if (phase !== this.lastPhase) {
      newEvents.push({ simTimeS: wire.receiver.sessionTimeS, text: `PHASE → ${phase}`, alert: false });
      this.lastPhase = phase;
    }

    return {
      simTimeS: wire.receiver.sessionTimeS,
      feedLabel: `${wire.receiver.name} · ${wire.receiver.sessionId}`,
      phase,
      initialFix: { ...(this.baseline ?? this.lastPosition), alt: this.lastPosition.alt },
      position: this.lastPosition,
      clockOffsetUs: (wire.pvt?.clockOffsetS ?? 0) * 1e6,
      posErrM: this.baseline ? distanceMeters(this.baseline, this.lastPosition) : 0,
      // No correlation-distortion signal exists yet (see snapshot.hpp) - 0
      // is the same "nothing flagged" baseline the simulation uses at rest.
      distortion: 0,
      // Posture doesn't come from the per-receiver snapshot anymore - see
      // the DetectionResultWire/'detection' handling above.
      posture: NONE_POSTURE,
      satellites,
      dop: wire.pvt
        ? { gdop: wire.pvt.gdop, pdop: wire.pvt.pdop, hdop: wire.pvt.hdop, vdop: wire.pvt.vdop }
        : { gdop: 0, pdop: 0, hdop: 0, vdop: 0 },
      newEvents,
      velocity: wire.pvt ? { x: wire.pvt.velX, y: wire.pvt.velY, z: wire.pvt.velZ } : undefined,
      solutionStatus: wire.pvt?.solutionStatus,
      solutionType: wire.pvt?.solutionType,
      validSats: wire.pvt?.validSats,
      connected: true,
      hasFix: this.baseline !== null,
      gnssTimeMs: wire.pvt ? gpsTimeToUtcMs(wire.pvt.gpsWeek, wire.pvt.gpsTowS) : undefined,
    };
  }
}
