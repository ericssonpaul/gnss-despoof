/**
 * Generic floating window chrome: drag, resize, corner-dock, collapse,
 * optional close. Every panel in src/ui/*Window.ts is built on top of this;
 * none of them reimplement dragging/resizing themselves.
 */

export type DockCorner = 'tl' | 'tr' | 'bl' | 'br';

export interface WindowOptions {
  id?: string;
  title: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  minW?: number;
  minH?: number;
  /** Snap to this corner on creation (and again after a drag near an edge). */
  dock?: DockCorner;
  closable?: boolean;
  onClose?: () => void;
}

export interface ManagedWindow {
  el: HTMLDivElement;
  body: HTMLDivElement;
}

let layer: HTMLElement | null = null;
let zTop = 20;

function getLayer(): HTMLElement {
  if (!layer) {
    const found = document.getElementById('windows-layer');
    if (!found) throw new Error('#windows-layer not found in index.html');
    layer = found;
  }
  return layer;
}

function bringToFront(el: HTMLElement): void {
  el.style.zIndex = String(++zTop);
}

function snapToEdges(el: HTMLElement, forceCorner?: DockCorner): void {
  const MARGIN = 12;
  const THRESHOLD = 60;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = el.getBoundingClientRect();

  let nearLeft = r.left < THRESHOLD;
  let nearRight = vw - r.right < THRESHOLD;
  let nearTop = r.top < THRESHOLD;
  let nearBottom = vh - r.bottom < THRESHOLD;
  if (forceCorner) {
    nearLeft = forceCorner.includes('l');
    nearRight = forceCorner.includes('r');
    nearTop = forceCorner.includes('t');
    nearBottom = forceCorner.includes('b');
  }
  if (nearLeft && !nearRight) el.style.left = `${MARGIN}px`;
  if (nearRight && !nearLeft) el.style.left = `${vw - r.width - MARGIN}px`;
  if (nearTop && !nearBottom) el.style.top = `${MARGIN}px`;
  if (nearBottom && !nearTop) el.style.top = `${vh - r.height - MARGIN}px`;
}

export function createWindow(opts: WindowOptions): ManagedWindow {
  const el = document.createElement('div');
  el.className = 'win';
  if (opts.id) el.id = opts.id;
  el.style.left = `${opts.x}px`;
  el.style.top = `${opts.y}px`;
  if (opts.w) el.style.width = `${opts.w}px`;
  if (opts.h) el.style.height = `${opts.h}px`;

  el.innerHTML = `
    <div class="win-head">
      <span class="win-title">${opts.title}</span>
      <span class="win-head-right">
        <button class="win-min" title="Collapse" type="button">–</button>
        ${opts.closable ? '<button class="win-close" title="Close" type="button">×</button>' : ''}
      </span>
    </div>
    <div class="win-body"></div>
    <div class="win-resize"></div>`;
  getLayer().appendChild(el);

  const head = el.querySelector<HTMLDivElement>('.win-head')!;
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.win-min, .win-close')) return;
    bringToFront(el);
    const startX = e.clientX;
    const startY = e.clientY;
    const origLeft = el.offsetLeft;
    const origTop = el.offsetTop;
    head.setPointerCapture(e.pointerId);
    const onMove = (e2: PointerEvent) => {
      el.style.left = `${origLeft + e2.clientX - startX}px`;
      el.style.top = `${origTop + e2.clientY - startY}px`;
    };
    const onUp = () => {
      head.removeEventListener('pointermove', onMove);
      head.removeEventListener('pointerup', onUp);
      snapToEdges(el);
    };
    head.addEventListener('pointermove', onMove);
    head.addEventListener('pointerup', onUp);
  });

  el.querySelector<HTMLButtonElement>('.win-min')!.addEventListener('click', () => {
    el.classList.toggle('collapsed');
  });
  const closeBtn = el.querySelector<HTMLButtonElement>('.win-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      el.remove();
      opts.onClose?.();
    });
  }

  const grip = el.querySelector<HTMLDivElement>('.win-resize')!;
  grip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    bringToFront(el);
    const startX = e.clientX;
    const startY = e.clientY;
    const origW = el.offsetWidth;
    const origH = el.offsetHeight;
    grip.setPointerCapture(e.pointerId);
    const onMove = (e2: PointerEvent) => {
      el.style.width = `${Math.max(opts.minW ?? 180, origW + e2.clientX - startX)}px`;
      el.style.height = `${Math.max(opts.minH ?? 100, origH + e2.clientY - startY)}px`;
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
  });

  el.addEventListener('pointerdown', () => bringToFront(el));
  if (opts.dock) requestAnimationFrame(() => snapToEdges(el, opts.dock));

  return { el, body: el.querySelector<HTMLDivElement>('.win-body')! };
}

export function keepWindowsOnScreen(): void {
  document.querySelectorAll<HTMLElement>('.win').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) el.style.left = `${Math.max(8, window.innerWidth - r.width - 12)}px`;
    if (r.bottom > window.innerHeight) el.style.top = `${Math.max(8, window.innerHeight - r.height - 12)}px`;
  });
}

export { bringToFront };
