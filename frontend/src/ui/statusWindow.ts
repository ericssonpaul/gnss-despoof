/** Read-only summary of what the detector is currently streaming. */
import { createWindow } from './windowManager';
import type { FeedState } from '../types';

interface StatusWindow {
  update(state: FeedState): void;
}

function statusFor(state: FeedState): { alert: boolean; text: string } {
  if (state.connected === false) return { alert: true, text: 'DISCONNECTED' };
  const maxSev = Math.max(state.posture.d1, state.posture.d2, state.posture.d3, state.posture.d4);
  if (maxSev >= 3) return { alert: true, text: state.phase === 'MEACON' ? 'CLOCK ANOMALY — SPOOF DETECTED' : 'SPOOF DETECTED' };
  if (maxSev === 2) return { alert: false, text: 'ANOMALY — INVESTIGATING' };
  if (maxSev === 1) return { alert: false, text: 'MONITORING' };
  return { alert: false, text: 'NOMINAL' };
}

export function buildStatusWindow(): StatusWindow {
  const { body } = createWindow({ id: 'win-status', title: 'Status', x: 14, y: 14, w: 270, h: 280, dock: 'tl' });
  body.innerHTML = `
    <div class="status-line" id="status-line"><span class="pip"></span><span id="status-text">NOMINAL</span></div>
    <dl class="kv">
      <dt>Feed</dt><dd id="feed-val">—</dd>
      <dt>Phase</dt><dd class="tnum" id="phase-val">LOCK</dd>
      <dt>Sys clock</dt><dd class="tnum" id="clock-val">--:--:--Z</dd>
      <dt>GNSS time</dt><dd class="tnum" id="gnss-clock-val">—</dd>
      <dt>Lat</dt><dd class="tnum" id="lat-val">—</dd>
      <dt>Lon</dt><dd class="tnum" id="lon-val">—</dd>
      <dt>Height</dt><dd class="tnum" id="height-val">—</dd>
      <dt>Velocity (ECEF)</dt><dd class="tnum" id="vel-val">—</dd>
      <dt>Clock offset</dt><dd class="tnum" id="clk-off-val">—</dd>
      <dt>Solution</dt><dd class="tnum" id="soln-val">—</dd>
      <dt>Sats tracked</dt><dd class="tnum" id="sats-val">—</dd>
    </dl>`;

  const line = body.querySelector<HTMLElement>('#status-line')!;
  const els = {
    statusText: body.querySelector<HTMLElement>('#status-text')!,
    feed: body.querySelector<HTMLElement>('#feed-val')!,
    phase: body.querySelector<HTMLElement>('#phase-val')!,
    clock: body.querySelector<HTMLElement>('#clock-val')!,
    gnssClock: body.querySelector<HTMLElement>('#gnss-clock-val')!,
    lat: body.querySelector<HTMLElement>('#lat-val')!,
    lon: body.querySelector<HTMLElement>('#lon-val')!,
    height: body.querySelector<HTMLElement>('#height-val')!,
    vel: body.querySelector<HTMLElement>('#vel-val')!,
    clkOff: body.querySelector<HTMLElement>('#clk-off-val')!,
    soln: body.querySelector<HTMLElement>('#soln-val')!,
    sats: body.querySelector<HTMLElement>('#sats-val')!,
  };

  return {
    update(state) {
      const st = statusFor(state);
      line.classList.toggle('alert', st.alert);
      els.statusText.textContent = st.text;
      els.feed.textContent = state.feedLabel;
      els.phase.textContent = state.phase;
      els.clock.textContent = `${new Date().toISOString().substring(11, 19)}Z`;
      els.gnssClock.textContent =
        state.gnssTimeMs !== undefined ? `${new Date(state.gnssTimeMs).toISOString().substring(11, 19)}Z` : '—';
      els.lat.textContent = state.hasFix ? `${state.position.lat.toFixed(7)}°` : '—';
      els.lon.textContent = state.hasFix ? `${state.position.lon.toFixed(7)}°` : '—';
      els.height.textContent = state.hasFix ? `${state.position.alt.toFixed(1)} m` : '—';
      els.vel.textContent = state.velocity
        ? `${Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z).toFixed(2)} m/s`
        : '—';
      els.clkOff.textContent = `${state.clockOffsetUs.toFixed(2)} µs`;
      els.soln.textContent =
        state.solutionStatus !== undefined ? `status ${state.solutionStatus} · type ${state.solutionType}` : '—';
      const lockedCount = state.satellites.filter((s) => s.locked).length;
      els.sats.textContent =
        state.validSats !== undefined
          ? `${lockedCount} / ${state.satellites.length} (${state.validSats} in soln)`
          : `${lockedCount} / ${state.satellites.length}`;
    },
  };
}
