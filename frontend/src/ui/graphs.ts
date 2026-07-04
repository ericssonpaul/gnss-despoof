/**
 * Chart drawing primitives, plus the "open graph windows" registry that
 * backs the graph launcher: openGraph() spawns a new closable window for a
 * metric (optionally per-satellite), and updateOpenGraphs() redraws all of
 * them once per tick from the latest FeedState + HistoryStore.
 *
 * Every time-series graph shows a fixed-width window (default 60s) of the
 * full retained history, not just "however many samples happened to fit" -
 * drag or scroll-wheel on a graph to pan back through everything that's
 * been recorded this session; double-click to snap back to live.
 */
import { bringToFront, createWindow, type ManagedWindow } from './windowManager';
import { cssVar, fitCanvas } from '../utils/canvas';
import { DOP_SERIES, GRAPH_KINDS } from '../data/scenarios';
import { HistoryStore, satKey, type Sample } from '../data/history';
import type { FeedState } from '../types';

const DEFAULT_WINDOW_S = 60;
const WHEEL_STEP_S = 4;

const GRAPH_UNITS: Record<string, string> = {
  pos: 'm',
  alt: 'm',
  clk: 'µs',
  dil: '',
  cn0: 'dB·Hz',
  dop: 'Hz',
};

function formatAxisValue(v: number, unit: string): string {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${v.toFixed(digits)}${unit ? ' ' + unit : ''}`;
}

interface TimeWindow {
  startT: number;
  endT: number;
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  pad: { l: number; r: number; t: number; b: number },
  w: number,
  h: number,
  min: number,
  max: number,
  unit: string,
  panOffsetS: number,
  windowS: number,
): void {
  // Four corners, one label each, so nothing overlaps: Y-axis max/min on
  // the left (top/bottom), the window's time span on the right (top/bottom).
  ctx.fillStyle = cssVar('--ink-faint');
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(formatAxisValue(max, unit), pad.l + 2, pad.t + 1);
  ctx.textBaseline = 'bottom';
  ctx.fillText(formatAxisValue(min, unit), pad.l + 2, h - 1);

  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`-${Math.round(panOffsetS + windowS)}s`, w - pad.r, pad.t + 1);
  ctx.textBaseline = 'bottom';
  ctx.fillText(panOffsetS === 0 ? 'now' : `-${Math.round(panOffsetS)}s`, w - pad.r, h - 1);
  ctx.textAlign = 'left';
}

function drawSeriesInner(
  cv: HTMLCanvasElement,
  samples: readonly Sample[],
  view: TimeWindow,
  panOffsetS: number,
  opts: { min?: number; max?: number; color?: string; unit?: string } = {},
): void {
  const live = panOffsetS === 0;
  const ctx = fitCanvas(cv);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 2, r: 2, t: 11, b: 11 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const values = samples.map((s) => s.v);
  const min = opts.min ?? Math.min(0, ...values);
  const max = opts.max ?? Math.max(1, ...values);
  const span = max - min || 1;
  const tSpan = view.endT - view.startT || 1;

  ctx.strokeStyle = cssVar('--line-soft');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let g = 0; g <= 2; g++) {
    const gy = pad.t + ih * (g / 2);
    ctx.moveTo(pad.l, gy + 0.5);
    ctx.lineTo(w - pad.r, gy + 0.5);
  }
  ctx.stroke();

  drawAxes(ctx, pad, w, h, min, max, opts.unit ?? '', panOffsetS, view.endT - view.startT);

  if (samples.length < 2) return;
  const x = (t: number) => pad.l + iw * ((t - view.startT) / tSpan);
  const y = (v: number) => pad.t + ih * (1 - (v - min) / span);
  const color = opts.color ?? cssVar('--ink');

  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x(samples[0]!.t), y(samples[0]!.v));
  for (let i = 1; i < samples.length; i++) ctx.lineTo(x(samples[i]!.t), y(samples[i]!.v));
  ctx.lineTo(x(samples[samples.length - 1]!.t), pad.t + ih);
  ctx.lineTo(x(samples[0]!.t), pad.t + ih);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x(samples[0]!.t), y(samples[0]!.v));
  for (let i = 1; i < samples.length; i++) ctx.lineTo(x(samples[i]!.t), y(samples[i]!.v));
  ctx.stroke();

  // Emphasize the endpoint only when it's actually the live edge - panned
  // into history, the right edge isn't "the latest reading" so a dot there
  // would be misleading.
  if (live) {
    const last = samples[samples.length - 1]!;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x(last.t), y(last.v), 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMultiSeriesInner(
  cv: HTMLCanvasElement,
  seriesList: Array<{ data: readonly Sample[]; color: string }>,
  view: TimeWindow,
  panOffsetS: number,
  opts: { min?: number; max?: number; unit?: string } = {},
): void {
  const ctx = fitCanvas(cv);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 2, r: 2, t: 11, b: 11 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const all = seriesList.flatMap((s) => s.data.map((d) => d.v));
  const min = opts.min ?? Math.min(0, ...all);
  const max = opts.max ?? Math.max(1, ...all);
  const span = max - min || 1;
  const tSpan = view.endT - view.startT || 1;

  ctx.strokeStyle = cssVar('--line-soft');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let g = 0; g <= 2; g++) {
    const gy = pad.t + ih * (g / 2);
    ctx.moveTo(pad.l, gy + 0.5);
    ctx.lineTo(w - pad.r, gy + 0.5);
  }
  ctx.stroke();

  drawAxes(ctx, pad, w, h, min, max, opts.unit ?? '', panOffsetS, view.endT - view.startT);

  for (const s of seriesList) {
    if (s.data.length < 2) continue;
    const x = (t: number) => pad.l + iw * ((t - view.startT) / tSpan);
    const y = (v: number) => pad.t + ih * (1 - (v - min) / span);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x(s.data[0]!.t), y(s.data[0]!.v));
    for (let i = 1; i < s.data.length; i++) ctx.lineTo(x(s.data[i]!.t), y(s.data[i]!.v));
    ctx.stroke();
  }
}

export function drawSparkline(cv: HTMLCanvasElement, series: readonly number[], color: string): void {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const w = cv.width;
  const h = cv.height;
  ctx.clearRect(0, 0, w, h);
  if (series.length < 2) return;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const n = series.length;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const px = (i / (n - 1)) * w;
    const py = h - ((series[i]! - min) / span) * (h - 3) - 1.5;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

const iqPointsBySat = new Map<string, Array<{ i: number; q: number; age: number }>>();

/** Synthetic correlator I/Q scatter: two BPSK lobes, smeared by `distortion`.
 * Points fade from white (newest) to grey (oldest) as an explicit color
 * interpolation, not just alpha, so age reads clearly regardless of what's
 * under it - and a normalized amplitude scale on both axes. */
export function drawIq(cv: HTMLCanvasElement, distortion: number, prn: string): void {
  const ctx = fitCanvas(cv);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) / 2 - 14;
  ctx.strokeStyle = cssVar('--line-soft');
  ctx.beginPath();
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R);
  ctx.lineTo(cx, cy + R);
  ctx.stroke();

  ctx.fillStyle = cssVar('--ink-faint');
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('+1', cx + R - 16, cy + 2);
  ctx.fillText('-1', cx - R, cy + 2);
  ctx.fillText('+1Q', cx + 2, cy - R);
  ctx.textAlign = 'left';

  const MAX_AGE = 80;
  let pts = iqPointsBySat.get(prn) ?? [];
  const spread = 0.1 + distortion * 0.42;
  const rotate = distortion * 0.9;
  const lobeSep = 0.62 - distortion * 0.22;
  for (let i = 0; i < 5; i++) {
    const sign = Math.random() < 0.5 ? 1 : -1;
    const ii = sign * lobeSep + (Math.random() - 0.5) * spread;
    const qq = (Math.random() - 0.5) * spread * (1 + distortion * 1.6);
    const cr = Math.cos(rotate);
    const sr = Math.sin(rotate);
    pts.push({ i: ii * cr - qq * sr, q: ii * sr + qq * cr, age: 0 });
  }
  pts = pts.filter((p) => (p.age += 1) < MAX_AGE).slice(-320);
  iqPointsBySat.set(prn, pts);

  for (const p of pts) {
    const ageFrac = p.age / MAX_AGE; // 0 = new, 1 = about to expire
    if (distortion > 0.3) {
      ctx.fillStyle = `rgba(239,74,74,${(1 - ageFrac) * 0.85 + 0.1})`;
    } else {
      // White (new) -> mid-grey (old), full opacity throughout so age is
      // legible regardless of what's rendered underneath.
      const g = Math.round(242 - ageFrac * 130);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
    }
    ctx.beginPath();
    ctx.arc(cx + p.i * R, cy - p.q * R, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ---------- open-graph registry ---------- */

interface OpenGraph {
  id: string;
  kind: string;
  prn: string | null;
  canvas: HTMLCanvasElement;
  valueEl: HTMLElement | null;
  window: ManagedWindow;
  /** Seconds back from "now" the view is anchored; 0 = live/following. */
  panOffsetS: number;
}

const openGraphs: OpenGraph[] = [];
let graphSeq = 0;

// Cached so resize/pan interactions can redraw immediately without waiting
// for the next feed tick.
let lastState: FeedState | null = null;
let lastHistory: HistoryStore | null = null;
let lastSelectedPrn = '';

function dopColor(key: string): string {
  return DOP_SERIES.find((s) => s.key === key)?.color ?? cssVar('--ink');
}

function keysForKind(kind: string, prn: string | null): string[] {
  switch (kind) {
    case 'pos':
      return ['pos'];
    case 'alt':
      return ['alt'];
    case 'clk':
      return ['clk'];
    case 'dil':
      return DOP_SERIES.map((s) => `dop.${s.key}`);
    case 'cn0':
      return [satKey(prn!, 'cn0')];
    case 'dop':
      return [satKey(prn!, 'dop')];
    default:
      return [];
  }
}

/** Clamp panOffsetS so you can't pan into the future or before the
 * earliest sample retained for this graph's series. */
function clampPan(g: OpenGraph, history: HistoryStore, nowT: number): void {
  const keys = keysForKind(g.kind, g.prn);
  const earliestTimes = keys.map((k) => history.earliest(k)).filter((t): t is number => t !== null);
  const earliest = earliestTimes.length ? Math.min(...earliestTimes) : nowT;
  const maxPan = Math.max(0, nowT - earliest - DEFAULT_WINDOW_S * 0.25);
  g.panOffsetS = Math.min(Math.max(g.panOffsetS, 0), maxPan);
}

function redrawGraph(g: OpenGraph): void {
  if (!lastState || !lastHistory) return;
  const state = lastState;
  const history = lastHistory;
  const nowT = state.simTimeS;
  clampPan(g, history, nowT);
  const endT = nowT - g.panOffsetS;
  const startT = endT - DEFAULT_WINDOW_S;
  const view: TimeWindow = { startT, endT };

  switch (g.kind) {
    case 'pos':
      drawSeriesInner(g.canvas, history.getWindow('pos', startT, endT), view, g.panOffsetS, { min: 0, unit: GRAPH_UNITS.pos });
      if (g.valueEl) {
        g.valueEl.textContent = `${state.posErrM.toFixed(1)} m`;
        g.valueEl.className = `v tnum${state.posErrM > 50 ? ' crit' : ''}`;
      }
      break;
    case 'alt':
      drawSeriesInner(g.canvas, history.getWindow('alt', startT, endT), view, g.panOffsetS, { unit: GRAPH_UNITS.alt });
      if (g.valueEl) g.valueEl.textContent = `${state.position.alt.toFixed(1)} m`;
      break;
    case 'clk':
      drawSeriesInner(g.canvas, history.getWindow('clk', startT, endT), view, g.panOffsetS, {
        min: 0,
        unit: GRAPH_UNITS.clk,
        color: state.posture.d4 >= 3 ? cssVar('--crit') : cssVar('--ink'),
      });
      if (g.valueEl) {
        g.valueEl.textContent = `${state.clockOffsetUs.toFixed(2)} µs`;
        g.valueEl.className = `v tnum${state.clockOffsetUs > 1 ? ' crit' : ''}`;
      }
      break;
    case 'dil':
      drawMultiSeriesInner(
        g.canvas,
        DOP_SERIES.map((s) => ({ data: history.getWindow(`dop.${s.key}`, startT, endT), color: dopColor(s.key) })),
        view,
        g.panOffsetS,
        { min: 0, unit: GRAPH_UNITS.dil },
      );
      if (g.valueEl) g.valueEl.textContent = history.last('dop.pdop').toFixed(2);
      break;
    case 'cn0': {
      const prn = g.prn!;
      drawSeriesInner(g.canvas, history.getWindow(satKey(prn, 'cn0'), startT, endT), view, g.panOffsetS, {
        min: 20,
        max: 52,
        unit: GRAPH_UNITS.cn0,
      });
      if (g.valueEl) g.valueEl.textContent = `${history.last(satKey(prn, 'cn0')).toFixed(1)} dB·Hz`;
      break;
    }
    case 'dop': {
      const prn = g.prn!;
      drawSeriesInner(g.canvas, history.getWindow(satKey(prn, 'dop'), startT, endT), view, g.panOffsetS, { unit: GRAPH_UNITS.dop });
      if (g.valueEl) {
        const v = history.last(satKey(prn, 'dop'));
        g.valueEl.textContent = `${v >= 0 ? '+' : ''}${v.toFixed(0)} Hz`;
      }
      break;
    }
    case 'iq': {
      const prn = g.prn!;
      const distortion = prn === lastSelectedPrn ? state.distortion : state.distortion * 0.15;
      drawIq(g.canvas, distortion, prn);
      break;
    }
  }
}

function attachPanControls(g: OpenGraph): void {
  const cv = g.canvas;
  const isTimeSeries = g.kind !== 'iq';
  if (!isTimeSeries) return;

  cv.style.cursor = 'grab';
  cv.addEventListener('pointerdown', (e) => {
    const startX = e.clientX;
    const startPan = g.panOffsetS;
    const pxPerSecond = cv.clientWidth / DEFAULT_WINDOW_S;
    cv.style.cursor = 'grabbing';
    cv.setPointerCapture(e.pointerId);
    const onMove = (e2: PointerEvent) => {
      const dxS = (e2.clientX - startX) / pxPerSecond;
      g.panOffsetS = startPan - dxS; // drag right = look further back
      redrawGraph(g);
    };
    const onUp = () => {
      cv.style.cursor = 'grab';
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
    };
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
  });
  cv.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const dir = Math.sign(e.deltaY || e.deltaX);
      g.panOffsetS += dir * WHEEL_STEP_S;
      redrawGraph(g);
    },
    { passive: false },
  );
  cv.addEventListener('dblclick', () => {
    g.panOffsetS = 0;
    redrawGraph(g);
  });
}

export function openGraph(kindId: string, prn: string | null): void {
  const kind = GRAPH_KINDS.find((k) => k.id === kindId);
  if (!kind) throw new Error(`Unknown graph kind: ${kindId}`);
  const title = kind.perSat && prn ? `${kind.label} · SV${prn}` : kind.label;
  const gid = `graph${++graphSeq}`;
  const isIq = kindId === 'iq';
  const width = isIq ? 190 : kindId === 'dil' ? 320 : 260;

  const win = createWindow({
    id: gid,
    title,
    x: 340 + (graphSeq % 5) * 24,
    y: 40 + (graphSeq % 5) * 24,
    w: width,
    h: isIq ? 210 : 150,
    minW: 140,
    minH: 90,
    closable: true,
    onClose: () => {
      const idx = openGraphs.findIndex((g) => g.id === gid);
      if (idx >= 0) openGraphs.splice(idx, 1);
    },
  });

  if (isIq) {
    win.body.innerHTML = `<canvas id="${gid}-cv" style="width:100%;flex:1;"></canvas>`;
  } else if (kindId === 'dil') {
    const legend = DOP_SERIES.map((s) => `<span style="color:${s.color}">■ ${s.label}</span>`).join(' ');
    win.body.innerHTML = `<div class="gg-head"><span class="t label" style="display:flex;gap:8px;">${legend}</span><span class="v tnum" id="${gid}-val">—</span></div><canvas id="${gid}-cv" style="width:100%;flex:1;"></canvas>`;
  } else {
    win.body.innerHTML = `<div class="gg-head"><span class="t label">${kind.label}</span><span class="v tnum" id="${gid}-val">—</span></div><canvas id="${gid}-cv" style="width:100%;flex:1;"></canvas>`;
  }

  const g: OpenGraph = {
    id: gid,
    kind: kindId,
    prn,
    canvas: win.body.querySelector<HTMLCanvasElement>(`#${gid}-cv`)!,
    valueEl: win.body.querySelector<HTMLElement>(`#${gid}-val`),
    window: win,
    panOffsetS: 0,
  };
  openGraphs.push(g);
  attachPanControls(g);
  // Resizing a window doesn't otherwise trigger a redraw until the next
  // feed tick - for a slow real feed that reads as "stuck" mid-drag.
  new ResizeObserver(() => redrawGraph(g)).observe(g.canvas);
}

/** Opens a graph, or focuses an already-open one for the same kind+PRN. */
export function openOrFocusGraph(kindId: string, prn: string | null): void {
  const existing = openGraphs.find((g) => g.kind === kindId && g.prn === prn);
  if (existing) {
    bringToFront(existing.window.el);
    return;
  }
  openGraph(kindId, prn);
}

export function updateOpenGraphs(state: FeedState, history: HistoryStore, selectedPrn: string): void {
  lastState = state;
  lastHistory = history;
  lastSelectedPrn = selectedPrn;
  for (const g of openGraphs) redrawGraph(g);
}
