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
      // the same UI columns render meaningfully in both modes; this is a
      // GPS-only simulation so system/signal are constant.
      return {
        prn: s.prn,
        el: s.el,
        system: 'G',
        signal: '1C',
        channelId: index,
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
interface DetectorSnapshotWire {
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
  detector: {
    posture: Posture;
    events: Array<{ text: string; alert: boolean }>;
  };
}

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
        const wire = JSON.parse(event.data as string) as DetectorSnapshotWire;
        this.emit(this.map(wire));
      } catch (err) {
        console.error('WebSocketFeed: failed to parse snapshot', err);
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
    const newEvents: LogEvent[] = wire.detector.events.map((e) => ({
      simTimeS: wire.receiver.sessionTimeS,
      text: e.text,
      alert: e.alert,
    }));
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
      posture: wire.detector.posture,
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
