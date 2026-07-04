# GNSS-DESPOOF console

The web UI: a read-only tactical console for the detector. Vite + TypeScript,
no framework. `WebSocketFeed` (`src/data/feed.ts`) connects to a real
`detector_core` process by default — see [Architecture](#architecture).

## Running it

```sh
npm install
npm run dev       # dev server with hot reload, proxies /ws -> :8080 (see vite.config.ts)
npm run build     # production build -> dist/, served by detector_core
```

`npm run dev` needs a `detector_core` process running and reachable on
`ws://127.0.0.1:8080` (the port `vite.config.ts`'s proxy targets) - build it
from the repo root with `cmake --build build --target detector_core` and run
`./build/detector/detector_core`. It needs GNSS-SDR actually feeding it (see
`config/gnss-sdr/*.conf`) to have anything real to show.

No detector running? Append `?sim` to the dev server URL
(`http://localhost:5173/?sim`) to fall back to `SimulatedFeed` - useful for
UI work with no backend at all.

## Architecture

- `src/data/` — where data comes from. `Feed` (`types.ts`) is the interface
  everything else depends on. `SimulatedFeed` (`feed.ts`) runs the scenario
  physics in `simulation.ts`, standing in for a live detector.
  `WebSocketFeed` (also `feed.ts`) connects to `detector_core`'s `/ws` route
  and maps its wire `Snapshot` JSON (mirrors `detector/snapshot.hpp`) into
  `FeedState`. `main.ts` picks one based on the `?sim` query param — no UI
  code needs to change either way.
- `src/ui/` — one module per floating panel (`statusWindow.ts`,
  `trackingWindow.ts`, `eventLogWindow.ts`, `graphLauncherWindow.ts`), plus
  `windowManager.ts` (the generic drag/resize/dock/close window chrome they
  all use) and `graphs.ts` (canvas drawing helpers + the open-graph registry).
  `map.ts` owns the Leaflet map. `trackingWindow.ts`'s rows are created on
  demand as satellites first appear in `FeedState` - a real feed's channel
  set is dynamic, unlike the simulation's fixed 8.
- `src/main.ts` — wires a `Feed` to the UI modules and runs the render loop.
- `src/types.ts` — shared types, most importantly `FeedState`, the shape
  every `Feed` implementation must produce each tick. Several fields are
  optional and only populated by one feed or the other (documented inline;
  e.g. satellite elevation is simulation-only, ECEF velocity is real-feed-only).

Each `src/ui/*Window.ts` module only reads `FeedState` and calls into
`windowManager`/`graphs` — it doesn't know or care whether the state came
from the simulation or a real receiver.
