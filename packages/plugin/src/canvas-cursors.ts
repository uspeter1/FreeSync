// Live mouse-cursor overlay for Obsidian's built-in Canvas view.
//
// Publishes the local user's cursor position (in canvas world coords) into
// awareness while their mouse is over a canvas surface, and renders every
// remote awareness state that carries a canvasCursor + activeFile matching
// the currently visible canvas.
//
// Canvas has no public runtime API — canvas.d.ts only ships JSON types.
// We access the community-known internals via `(view as any).canvas`:
//   - wrapperEl          the pan/zoom surface
//   - posFromEvt(evt)    screen event -> world coords
//   - tx, ty, tZoom      pan/zoom transform (fallback for screen conversion)
// If any of these disappear on an Obsidian update we log once and no-op —
// text cursors, presence badges, and canvas sync all keep working.
//
// Awareness field added:
//   canvasCursor: { x: number; y: number; updatedAt: number } | null

import { App, Platform, WorkspaceLeaf } from 'obsidian';
import type { AwarenessRef } from './cursors';

interface CanvasCursorState {
  x: number;
  y: number;
  updatedAt: number;
}

interface RemoteUser {
  id: string;
  display_name: string;
  color: string;
}

interface CanvasInternal {
  wrapperEl?: HTMLElement;
  posFromEvt?: (evt: MouseEvent) => { x: number; y: number };
  tx?: number;
  ty?: number;
  tZoom?: number;
}

const THROTTLE_MS = 60;                  // ~16 Hz publish rate
const ARRIVAL_LABEL_MS = 2000;           // greeting label visibility on arrival
const IDLE_CURSOR_MS = 8000;             // hide remote cursors gone this long

export class CanvasCursorManager {
  private app: App;
  private ref: AwarenessRef;
  private started = false;
  private warnedNoApi = false;

  // Currently-attached canvas (publish side)
  private attachedLeaf: WorkspaceLeaf | null = null;
  private attachedCanvas: CanvasInternal | null = null;
  private attachedFilePath: string | null = null;
  private overlayEl: HTMLDivElement | null = null;
  private cursorEls = new Map<string, HTMLDivElement>();   // keyed by user.id
  private greeted = new Set<string>();
  private greetTimers = new Map<string, number>();
  private lastPublish = 0;
  private rafHandle: number | null = null;
  private awarenessOff: (() => void) | null = null;
  private leafOff: (() => void) | null = null;

  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseLeaveHandler: (() => void) | null = null;

  constructor(app: App, ref: AwarenessRef) {
    this.app = app;
    this.ref = ref;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    const handler = () => this.onLeafChange();
    this.app.workspace.on('active-leaf-change', handler);
    this.leafOff = () => this.app.workspace.off('active-leaf-change', handler);

    // Attach to whatever canvas may already be active at start-up.
    this.onLeafChange();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.detach();
    this.leafOff?.();
    this.leafOff = null;
  }

  private onLeafChange(): void {
    const leaf = this.app.workspace.activeLeaf;
    const view = leaf?.view;
    const isCanvas = view?.getViewType?.() === 'canvas';
    if (!isCanvas || !leaf) {
      this.detach();
      return;
    }
    if (leaf === this.attachedLeaf) return;
    this.detach();
    this.attach(leaf);
  }

  private attach(leaf: WorkspaceLeaf): void {
    const view = leaf.view as any;
    const canvas: CanvasInternal | undefined = view?.canvas;
    const wrapperEl = canvas?.wrapperEl;

    if (!canvas || !wrapperEl || typeof canvas.posFromEvt !== 'function') {
      if (!this.warnedNoApi) {
        console.warn(
          'FreeSync: Obsidian Canvas internal API not detected — remote cursors on canvases disabled.'
        );
        this.warnedNoApi = true;
      }
      return;
    }

    this.attachedLeaf = leaf;
    this.attachedCanvas = canvas;
    this.attachedFilePath = (view.file?.path ?? null) as string | null;

    // Overlay: absolutely positioned inside the wrapper. Non-interactive by
    // default; per-cursor elements set pointer-events: auto on their hit area.
    const overlay = document.createElement('div');
    overlay.className = 'freesync-canvas-cursors';
    overlay.style.cssText = [
      'position:absolute', 'inset:0',
      'pointer-events:none', 'z-index:100',
      'overflow:hidden',
    ].join(';');
    // Wrapper must be a positioning context; Obsidian usually leaves it
    // static. Force relative but preserve the existing value if already set.
    const prevPos = wrapperEl.style.position;
    if (!prevPos || prevPos === 'static') wrapperEl.style.position = 'relative';
    wrapperEl.appendChild(overlay);
    this.overlayEl = overlay;

    if (!Platform.isMobile) {
      this.mouseMoveHandler = (e: MouseEvent) => this.onMouseMove(e);
      this.mouseLeaveHandler = () => this.clearLocalCursor();
      wrapperEl.addEventListener('mousemove', this.mouseMoveHandler);
      wrapperEl.addEventListener('mouseleave', this.mouseLeaveHandler);
    }

    // Awareness re-render on any change
    const aw = this.ref.awareness;
    if (aw) {
      const handler = () => this.render();
      aw.on('change', handler);
      this.awarenessOff = () => aw.off('change', handler);
    }

    // Continuous re-render while at least one remote cursor is on this canvas,
    // so pan/zoom motion (which doesn't fire awareness) still moves the arrows.
    this.startRenderLoop();
    // Initial render (also handles the "canvas load with users already here"
    // greeting case).
    this.render();
  }

  private detach(): void {
    // Clear our published cursor so remote peers stop seeing it
    this.clearLocalCursor();

    if (this.attachedCanvas?.wrapperEl) {
      if (this.mouseMoveHandler) {
        this.attachedCanvas.wrapperEl.removeEventListener('mousemove', this.mouseMoveHandler);
      }
      if (this.mouseLeaveHandler) {
        this.attachedCanvas.wrapperEl.removeEventListener('mouseleave', this.mouseLeaveHandler);
      }
    }
    this.mouseMoveHandler = null;
    this.mouseLeaveHandler = null;

    this.awarenessOff?.();
    this.awarenessOff = null;

    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }

    for (const t of this.greetTimers.values()) window.clearTimeout(t);
    this.greetTimers.clear();
    this.greeted.clear();

    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    this.cursorEls.clear();

    this.attachedLeaf = null;
    this.attachedCanvas = null;
    this.attachedFilePath = null;
  }

  private onMouseMove(evt: MouseEvent): void {
    if (!this.ref.awareness || !this.attachedCanvas?.posFromEvt) return;
    const now = performance.now();
    if (now - this.lastPublish < THROTTLE_MS) return;
    this.lastPublish = now;

    let pos: { x: number; y: number };
    try {
      pos = this.attachedCanvas.posFromEvt(evt);
    } catch {
      return;  // undocumented API — swallow and skip this frame
    }
    this.ref.awareness.setLocalStateField('canvasCursor', {
      x: pos.x, y: pos.y, updatedAt: Date.now(),
    } as CanvasCursorState);
  }

  private clearLocalCursor(): void {
    this.ref.awareness?.setLocalStateField('canvasCursor', null);
  }

  private startRenderLoop(): void {
    const tick = () => {
      if (!this.attachedCanvas) return;
      this.render();
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  // World coord -> pixel coord inside wrapperEl. Self-calibrating: instead of
  // guessing Obsidian's internal pan/zoom storage (which is undocumented and
  // changes across versions), we invert canvas.posFromEvt() — that function
  // is our publish-side ground truth, so its inverse is always correct.
  //
  // The transform is affine, so two (screen, world) samples suffice to solve
  // for scale + origin. Both probes hit posFromEvt with plain objects; if the
  // implementation ever demands a real MouseEvent we fall back to the naive
  // tx/ty/zoom formula.
  private worldToScreen(x: number, y: number): { px: number; py: number } | null {
    const c = this.attachedCanvas as any;
    const wrap = c?.wrapperEl;
    const posFromEvt = c?.posFromEvt;
    if (!wrap || typeof posFromEvt !== 'function') return null;

    const rect = wrap.getBoundingClientRect();
    try {
      // Two probes 100px apart inside the wrap
      const p1 = posFromEvt.call(c, { clientX: rect.left, clientY: rect.top });
      const p2 = posFromEvt.call(c, { clientX: rect.left + 100, clientY: rect.top + 100 });
      const dwx = p2.x - p1.x;
      const dwy = p2.y - p1.y;
      // If the canvas isn't laid out yet, differences can be 0 — bail
      if (Math.abs(dwx) < 1e-9 || Math.abs(dwy) < 1e-9) return null;
      // world = screenRelToWrap / scale + origin
      // → scale = 100 / (p2 - p1);  origin = p1  (at screenRel = 0)
      const scaleX = 100 / dwx;
      const scaleY = 100 / dwy;
      const originX = p1.x;
      const originY = p1.y;
      // Invert: screenRel = (world - origin) * scale
      return { px: (x - originX) * scaleX, py: (y - originY) * scaleY };
    } catch {
      // Fall back to the naive formula
      const tx = c.tx ?? c.x ?? 0;
      const ty = c.ty ?? c.y ?? 0;
      const z = c.tZoom ?? c.zoom;
      if (typeof z !== 'number') return null;
      const zoomFactor = Math.pow(2, z);
      return { px: (x - tx) * zoomFactor, py: (y - ty) * zoomFactor };
    }
  }

  private render(): void {
    const aw = this.ref.awareness;
    const overlay = this.overlayEl;
    if (!aw || !overlay || !this.attachedFilePath) return;

    const now = Date.now();
    const seenUsers = new Set<string>();

    for (const [clientId, state] of aw.getStates()) {
      if (clientId === this.ref.localClientId) continue;
      const user = state?.user as RemoteUser | undefined;
      const cursor = state?.canvasCursor as CanvasCursorState | null | undefined;
      const activeFile = state?.activeFile as string | null | undefined;
      if (!user || !cursor || activeFile !== this.attachedFilePath) continue;
      if (now - cursor.updatedAt > IDLE_CURSOR_MS) continue;

      // Dedupe by user.id (same user on two devices = one arrow).
      if (seenUsers.has(user.id)) continue;
      seenUsers.add(user.id);

      const screen = this.worldToScreen(cursor.x, cursor.y);
      if (!screen) continue;

      const isSelf = this.ref.localUserId != null && user.id === this.ref.localUserId;
      const label = isSelf ? 'You' : user.display_name;

      let el = this.cursorEls.get(user.id);
      if (!el) {
        el = this.createCursorEl(user.color, label);
        overlay.appendChild(el);
        this.cursorEls.set(user.id, el);
        this.showGreeting(user.id, el);
      } else {
        this.updateCursorEl(el, user.color, label);
      }
      el.style.transform = `translate(${screen.px}px, ${screen.py}px)`;
    }

    // Remove elements for users no longer visible
    for (const [uid, el] of this.cursorEls) {
      if (!seenUsers.has(uid)) {
        el.remove();
        this.cursorEls.delete(uid);
        // Do NOT clear the greeted set on temporary disappearance — if the
        // same user comes right back we don't want to re-greet. It clears
        // on detach() (leaving the canvas).
      }
    }
  }

  private showGreeting(userId: string, el: HTMLDivElement): void {
    if (this.greeted.has(userId)) return;
    this.greeted.add(userId);
    const labelEl = el.querySelector<HTMLElement>('.freesync-canvas-cursor-label');
    if (!labelEl) return;
    labelEl.style.opacity = '1';
    const timer = window.setTimeout(() => {
      // Only hide if user isn't hovering (opacity handled by mouseenter/leave)
      if (!el.matches(':hover')) labelEl.style.opacity = '0';
      this.greetTimers.delete(userId);
    }, ARRIVAL_LABEL_MS);
    this.greetTimers.set(userId, timer);
  }

  private createCursorEl(color: string, labelText: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'freesync-canvas-cursor';
    // Position at 0,0; transform will move it to screen coords. Tip of the
    // arrow (SVG path starts at 0,0) is the "cursor point".
    el.style.cssText = [
      'position:absolute', 'top:0', 'left:0',
      'pointer-events:none',
      'will-change:transform',
      'transition:transform 60ms linear',
    ].join(';');

    // Hit area — invisible, wider than the arrow, so hover triggers easily.
    const hit = document.createElement('div');
    hit.className = 'freesync-canvas-cursor-hit';
    hit.style.cssText = [
      'position:absolute', 'left:-6px', 'top:-4px',
      'width:24px', 'height:24px',
      'pointer-events:auto',
    ].join(';');

    // Arrow SVG (Google-Docs-ish shape). Tip at (0,0).
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 14 18');
    svg.style.cssText = [
      'position:absolute', 'left:0', 'top:0',
      'pointer-events:none',
      'filter:drop-shadow(0 1px 1px rgba(0,0,0,0.35))',
    ].join(';');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M0,0 L0,15 L4,11 L7.5,17 L10,15.5 L6.5,10 L12,10 Z');
    path.setAttribute('fill', color);
    path.setAttribute('stroke', '#fff');
    path.setAttribute('stroke-width', '1');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);

    // Name label — matches cursors.ts styling.
    const label = document.createElement('div');
    label.className = 'freesync-canvas-cursor-label';
    label.textContent = labelText;
    label.style.cssText = [
      'position:absolute', 'left:12px', 'top:14px',
      'padding:2px 8px',
      `background:${color}`,
      'color:#fff',
      'font-size:11px', 'font-weight:600', 'line-height:1.5',
      'border-radius:0 4px 4px 4px',
      'white-space:nowrap',
      'pointer-events:none',
      'user-select:none',
      'opacity:0',
      'transition:opacity 0.12s',
      'z-index:1',
    ].join(';');

    hit.addEventListener('mouseenter', () => { label.style.opacity = '1'; });
    hit.addEventListener('mouseleave', () => { label.style.opacity = '0'; });

    el.appendChild(svg);
    el.appendChild(label);
    el.appendChild(hit);
    return el;
  }

  private updateCursorEl(el: HTMLDivElement, color: string, labelText: string): void {
    const path = el.querySelector('path');
    if (path && path.getAttribute('fill') !== color) path.setAttribute('fill', color);
    const label = el.querySelector<HTMLElement>('.freesync-canvas-cursor-label');
    if (label) {
      if (label.textContent !== labelText) label.textContent = labelText;
      if (label.style.background !== color) label.style.background = color;
    }
  }
}
