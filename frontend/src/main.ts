import './style.css';
import { SimulatedFeed, WebSocketFeed } from './data/feed';
import { HistoryStore, satKey } from './data/history';
import { SAT_GEOMETRY } from './data/scenarios';
import { buildStatusWindow } from './ui/statusWindow';
import { buildTrackingWindow } from './ui/trackingWindow';
import { buildEventLogWindow } from './ui/eventLogWindow';
import { buildGraphLauncherWindow } from './ui/graphLauncherWindow';
import { openGraph, updateOpenGraphs } from './ui/graphs';
import { buildMap } from './ui/map';
import { buildOnboarding } from './ui/onboarding';
import { keepWindowsOnScreen } from './ui/windowManager';
import type { Feed } from './types';

// WebSocketFeed talks to a real detector_core by default. Append ?sim to
// the URL to fall back to SimulatedFeed for UI work with no backend
// running - nothing past this point knows or cares which one it's talking
// to, since both only ever produce FeedState.
const feed: Feed = new URLSearchParams(window.location.search).has('sim') ? new SimulatedFeed() : new WebSocketFeed();

const history = new HistoryStore();
let selectedPrn = SAT_GEOMETRY[0]!.prn;
let prevFeedLabel = '';
let hasCenteredMap = false;

const statusWindow = buildStatusWindow();
const trackingWindow = buildTrackingWindow((prn) => {
  selectedPrn = prn;
});
const eventLogWindow = buildEventLogWindow();
const map = buildMap();
buildGraphLauncherWindow();
buildOnboarding();

// A couple of graphs open by default so the console isn't empty on load.
openGraph('pos', null);
openGraph('cn0', SAT_GEOMETRY[0]!.prn);

feed.subscribe((state) => {
  if (state.feedLabel !== prevFeedLabel) {
    prevFeedLabel = state.feedLabel;
    history.reset();
    hasCenteredMap = false; // new session - wait for a real fix before touching the map again
  }

  const t = state.simTimeS;
  if (state.hasFix) {
    history.record('pos', t, state.posErrM);
    history.record('alt', t, state.position.alt);
    history.record('clk', t, state.clockOffsetUs);
    history.record('dop.gdop', t, state.dop.gdop);
    history.record('dop.pdop', t, state.dop.pdop);
    history.record('dop.hdop', t, state.dop.hdop);
    history.record('dop.vdop', t, state.dop.vdop);
  }
  for (const sat of state.satellites) {
    history.record(satKey(sat.prn, 'cn0'), t, sat.cn0DbHz);
    history.record(satKey(sat.prn, 'dop'), t, sat.dopplerHz);
    history.record(satKey(sat.prn, 'pr'), t, sat.pseudorangeM);
  }

  statusWindow.update(state);
  trackingWindow.update(state, history, selectedPrn);
  eventLogWindow.append(state.newEvents);
  if (state.hasFix) {
    if (!hasCenteredMap) {
      hasCenteredMap = true;
      map.resetTrail(state.initialFix);
    }
    map.update(state, state.initialFix);
  }
  updateOpenGraphs(state, history, selectedPrn);
});

feed.start();

window.addEventListener('resize', keepWindowsOnScreen);
