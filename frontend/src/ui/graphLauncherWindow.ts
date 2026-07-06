/** Pick a metric (and satellite, if applicable) and spawn a new graph
 * window. Lets several graphs from different sources be open at once. */
import { createWindow } from './windowManager';
import { openOrFocusGraph } from './graphs';
import { GRAPH_KINDS, SAT_GEOMETRY } from '../data/scenarios';

export function buildGraphLauncherWindow(): void {
  const { body } = createWindow({ id: 'win-launcher', title: 'Graphs', x: -1, y: -1, w: 280, h: 108, dock: 'br', persist: true });
  body.innerHTML = `
    <div class="picker-row">
      <select id="graph-kind-sel"></select>
      <select id="graph-prn-sel"></select>
    </div>
    <div class="picker-row"><button id="graph-open-btn" type="button" style="width:100%;">Open graph</button></div>
    <div class="label">Opens a new closable window</div>`;

  const kindSel = body.querySelector<HTMLSelectElement>('#graph-kind-sel')!;
  const prnSel = body.querySelector<HTMLSelectElement>('#graph-prn-sel')!;

  for (const k of GRAPH_KINDS) {
    const opt = document.createElement('option');
    opt.value = k.id;
    opt.textContent = k.label;
    kindSel.appendChild(opt);
  }
  for (const s of SAT_GEOMETRY) {
    const opt = document.createElement('option');
    opt.value = s.prn;
    opt.textContent = `SV${s.prn}`;
    prnSel.appendChild(opt);
  }

  function syncPrnVisibility() {
    const kind = GRAPH_KINDS.find((k) => k.id === kindSel.value);
    prnSel.style.visibility = kind?.perSat ? 'visible' : 'hidden';
  }
  kindSel.addEventListener('change', syncPrnVisibility);
  syncPrnVisibility();

  body.querySelector<HTMLButtonElement>('#graph-open-btn')!.addEventListener('click', () => {
    const kind = GRAPH_KINDS.find((k) => k.id === kindSel.value);
    if (!kind) return;
    openOrFocusGraph(kind.id, kind.perSat ? prnSel.value : null);
  });
}
