/** Per-satellite tracking table: C/N0 and Doppler with inline sparklines,
 * pseudorange, TOW, and TLM/cycle-slip flags. Rows are created on demand as
 * satellites first appear in FeedState - a real feed's channel set is
 * dynamic (GNSS-SDR reports whatever it's currently tracking), unlike the
 * simulation's fixed 8. Double-click C/N₀ or Doppler to pop out its graph
 * (dedupes against an already-open one). */
import { createWindow } from './windowManager';
import { drawSparkline, openOrFocusGraph } from './graphs';
import { cssVar } from '../utils/canvas';
import { HistoryStore, satKey } from '../data/history';
import type { FeedState } from '../types';

interface TrackingWindow {
  update(state: FeedState, history: HistoryStore, selectedPrn: string): void;
}

export function buildTrackingWindow(onSelectPrn: (prn: string) => void): TrackingWindow {
  const { el: winEl, body } = createWindow({ id: 'win-tracking', title: 'Tracking · 0 CH', x: -1, y: 14, w: 460, h: 280, dock: 'tr' });
  body.innerHTML = `
    <table class="sat-table">
      <thead><tr>
        <th>SV</th><th>SYS</th><th class="num">CH</th><th class="num">EL</th>
        <th>C/N₀</th><th>Doppler</th><th class="num">Pseudorange</th><th class="num">TOW</th><th>TLM</th>
      </tr></thead>
      <tbody id="sat-table-body"></tbody>
    </table>
    <div class="label">Dbl-click C/N₀ or Doppler to open its graph</div>`;

  const titleEl = winEl.querySelector<HTMLElement>('.win-title')!;
  const tbody = body.querySelector<HTMLTableSectionElement>('#sat-table-body')!;
  const rows = new Map<string, HTMLTableRowElement>();

  function getOrCreateRow(prn: string): HTMLTableRowElement {
    let tr = rows.get(prn);
    if (tr) return tr;

    tr = document.createElement('tr');
    tr.dataset.prn = prn;
    tr.innerHTML = `
      <td class="prn">${prn}</td>
      <td data-f="sys"></td>
      <td class="num tnum" data-f="ch"></td>
      <td class="num tnum" data-f="el"></td>
      <td data-f="cn0cell"><span class="lock-pip" data-f="cn0pip"></span><span class="tnum" data-f="cn0val"></span><canvas class="spark" width="46" height="14" data-f="cn0spark"></canvas></td>
      <td data-f="dopcell"><span class="tnum" data-f="dopval"></span><canvas class="spark" width="46" height="14" data-f="dopspark"></canvas></td>
      <td class="num tnum" data-f="pr"></td>
      <td class="num tnum" data-f="tow"></td>
      <td data-f="tlm"></td>`;
    tr.addEventListener('click', () => onSelectPrn(prn));
    tr.querySelector('[data-f="cn0cell"]')!.addEventListener('dblclick', () => openOrFocusGraph('cn0', prn));
    tr.querySelector('[data-f="dopcell"]')!.addEventListener('dblclick', () => openOrFocusGraph('dop', prn));
    tbody.appendChild(tr);
    rows.set(prn, tr);
    titleEl.textContent = `Tracking · ${rows.size} CH`;
    return tr;
  }

  return {
    update(state, history, selectedPrn) {
      for (const reading of state.satellites) {
        const tr = getOrCreateRow(reading.prn);
        tr.classList.toggle('selected', reading.prn === selectedPrn);
        tr.querySelector('[data-f="sys"]')!.textContent = reading.system ? `${reading.system}/${reading.signal ?? '—'}` : '—';
        tr.querySelector('[data-f="ch"]')!.textContent = reading.channelId !== undefined ? String(reading.channelId) : '—';
        tr.querySelector('[data-f="el"]')!.textContent = reading.el !== undefined ? `${reading.el.toFixed(1)}°` : '—';
        tr.querySelector('[data-f="cn0pip"]')!.classList.toggle('off', !reading.locked);
        tr.querySelector('[data-f="cn0val"]')!.textContent = reading.cn0DbHz.toFixed(1);
        tr.querySelector('[data-f="dopval"]')!.textContent = `${reading.dopplerHz >= 0 ? '+' : ''}${reading.dopplerHz.toFixed(0)}`;
        tr.querySelector('[data-f="pr"]')!.textContent = `${(reading.pseudorangeM / 1000).toFixed(1)} km`;
        tr.querySelector('[data-f="tow"]')!.textContent = reading.towMs !== undefined ? (reading.towMs / 1000).toFixed(1) : '—';
        const tlmClasses = ['lock-pip'];
        if (!reading.tlmValid) tlmClasses.push('off');
        tr.querySelector('[data-f="tlm"]')!.innerHTML =
          `<span class="${tlmClasses.join(' ')}" title="TLM valid"></span>` +
          (reading.flagCycleSlip ? '<span class="lock-pip off" title="Cycle slip"></span>' : '');
        drawSparkline(
          tr.querySelector('[data-f="cn0spark"]')!,
          history
            .get(satKey(reading.prn, 'cn0'))
            .slice(-46)
            .map((s) => s.v),
          reading.locked ? cssVar('--ink-dim') : cssVar('--crit'),
        );
        drawSparkline(
          tr.querySelector('[data-f="dopspark"]')!,
          history
            .get(satKey(reading.prn, 'dop'))
            .slice(-46)
            .map((s) => s.v),
          cssVar('--ink-dim'),
        );
      }
    },
  };
}
