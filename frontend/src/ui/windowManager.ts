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
  /** Remember position/size/collapsed state across reloads under `id`.
   * Only meaningful for windows with a stable id whose content is the same
   * every session (the core panels) - graph windows get a fresh sequential
   * id every load, so persisting those wouldn't reattach to anything real. */
  persist?: boolean;
}

interface StoredLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
}

function layoutKey(id: string): string {
  return `gnss-despoof:win-layout:${id}`;
}

function loadLayout(id: string): StoredLayout | null {
  try {
    const raw = localStorage.getItem(layoutKey(id));
    return raw ? (JSON.parse(raw) as StoredLayout) : null;
  } catch {
    return null;
  }
}

function saveLayout(el: HTMLElement, id: string): void {
  try {
    const layout: StoredLayout = {
      x: el.offsetLeft,
      y: el.offsetTop,
      w: el.offsetWidth,
      h: parseFloat(el.style.height) || el.offsetHeight,
      collapsed: el.classList.contains('collapsed'),
    };
    localStorage.setItem(layoutKey(id), JSON.stringify(layout));
  } catch {
    // localStorage unavailable (private mode, quota) - layout just won't persist.
  }
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
  const stored = opts.persist && opts.id ? loadLayout(opts.id) : null;

  const el = document.createElement('div');
  el.className = 'win';
  if (opts.id) el.id = opts.id;
  el.style.left = `${stored?.x ?? opts.x}px`;
  el.style.top = `${stored?.y ?? opts.y}px`;
  const w = stored?.w ?? opts.w;
  const h = stored?.h ?? opts.h;
  if (w) el.style.width = `${w}px`;
  if (h) el.style.height = `${h}px`;
  if (stored?.collapsed) el.classList.add('collapsed');

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
      if (opts.persist && opts.id) saveLayout(el, opts.id);
    };
    head.addEventListener('pointermove', onMove);
    head.addEventListener('pointerup', onUp);
  });

  el.querySelector<HTMLButtonElement>('.win-min')!.addEventListener('click', () => {
    el.classList.toggle('collapsed');
    if (opts.persist && opts.id) saveLayout(el, opts.id);
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
      if (opts.persist && opts.id) saveLayout(el, opts.id);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
  });

  el.addEventListener('pointerdown', () => bringToFront(el));
  if (opts.dock && !stored) requestAnimationFrame(() => snapToEdges(el, opts.dock));

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
