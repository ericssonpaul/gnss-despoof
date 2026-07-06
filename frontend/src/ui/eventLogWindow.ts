/** Scrolling, timestamped list of detector events - replaces a static
 * "defense posture" panel with something that reads like a live stream. */
import { createWindow } from './windowManager';
import type { LogEvent } from '../types';

const MAX_ENTRIES = 200;
const MAX_RENDERED = 60;

interface EventLogWindow {
  append(events: LogEvent[]): void;
}

export function buildEventLogWindow(): EventLogWindow {
  const { body } = createWindow({ id: 'win-log', title: 'Event log', x: 14, y: -1, w: 300, h: 220, dock: 'bl', persist: true });
  body.innerHTML = `
    <label class="log-filter"><input type="checkbox" id="log-alerts-only" /> Alerts only</label>
    <div class="log-list" id="log-list"></div>`;
  const listEl = body.querySelector<HTMLElement>('#log-list')!;
  const alertsOnlyChk = body.querySelector<HTMLInputElement>('#log-alerts-only')!;

  const entries: LogEvent[] = [];

  function render() {
    listEl.innerHTML = '';
    const filtered = alertsOnlyChk.checked ? entries.filter((e) => e.alert) : entries;
    for (const e of filtered.slice(-MAX_RENDERED)) {
      const row = document.createElement('div');
      row.className = `log-row${e.alert ? ' alert' : ''}`;
      const t = document.createElement('span');
      t.className = 't tnum';
      t.textContent = `T+${e.simTimeS.toFixed(1).padStart(6, '0')}s`;
      const m = document.createElement('span');
      m.className = 'm';
      m.textContent = e.text;
      row.append(t, m);
      listEl.appendChild(row);
    }
  }
  alertsOnlyChk.addEventListener('change', render);

  return {
    append(events) {
      if (events.length === 0) return;
      entries.push(...events);
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      render();
    },
  };
}
