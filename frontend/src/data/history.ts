/**
 * Rolling time-series buffers for graphs and sparklines.
 *
 * A `Feed` only ever emits the *current* reading each tick (that's what a
 * real WebSocket push would look like too - there's no reason to ship a
 * whole history array over the wire every tick). Anything that wants a
 * series over time - the tracking-table sparklines, the graph windows -
 * asks this store to remember samples for it instead of keeping its own
 * ad-hoc arrays.
 *
 * Samples are timestamped with the feed's own `simTimeS`, not wall-clock
 * time, so graphs can be windowed/panned by "seconds ago" regardless of
 * playback speed or a real feed's actual push rate.
 */

export interface Sample {
  t: number;
  v: number;
}

// Generous rather than tight - the point of retaining full history is being
// able to scroll all the way back for a session, not just the last minute.
const MAX_SAMPLES = 50_000;

export class HistoryStore {
  private series = new Map<string, Sample[]>();

  record(key: string, t: number, value: number): void {
    let arr = this.series.get(key);
    if (!arr) {
      arr = [];
      this.series.set(key, arr);
    }
    arr.push({ t, v: value });
    if (arr.length > MAX_SAMPLES) arr.shift();
  }

  get(key: string): readonly Sample[] {
    return this.series.get(key) ?? [];
  }

  /** Samples with t in [fromT, toT], plus the one sample immediately before
   * fromT if any (so a line drawn from the window's samples doesn't start
   * with a visible gap at the left edge). */
  getWindow(key: string, fromT: number, toT: number): Sample[] {
    const all = this.series.get(key);
    if (!all || all.length === 0) return [];
    let startIdx = all.findIndex((s) => s.t >= fromT);
    if (startIdx === -1) return [];
    if (startIdx > 0) startIdx -= 1;
    const endIdx = all.findIndex((s) => s.t > toT);
    return all.slice(startIdx, endIdx === -1 ? undefined : endIdx + 1);
  }

  last(key: string): number {
    const arr = this.series.get(key);
    return arr && arr.length > 0 ? arr[arr.length - 1]!.v : 0;
  }

  /** Earliest retained timestamp, or `null` if nothing recorded yet. */
  earliest(key: string): number | null {
    const arr = this.series.get(key);
    return arr && arr.length > 0 ? arr[0]!.t : null;
  }

  reset(): void {
    this.series.clear();
  }
}

export function satKey(prn: string, field: 'cn0' | 'dop' | 'pr'): string {
  return `sat.${prn}.${field}`;
}
