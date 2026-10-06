import { useEffect, useRef, useState, type PointerEvent } from "react";
import { clamp } from "@/components/scene/coords";
import { readJson, writeJson } from "@/lib/persist";

interface Position {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

export interface UseFloatingWindowResult {
  position: Position;
  minimized: boolean;
  toggleMinimize: () => void;
  /** Spread onto the window's title bar. Drags move the window; clamps to viewport. */
  titleBarProps: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  };
}

export interface UseFloatingWindowOptions {
  /**
   * Start at the remembered position (true, the default), or at `initial` while still remembering where it's dragged:
   * the sheet windows cascade each new window from the one in front.
   */
  restore?: boolean;
  /** Told each new position (the sheet windows note it for the next window's cascade). */
  onMove?: (position: Position) => void;
}

/**
 * Title-bar drag + minimize state for a floating (non-modal) window. When
 * `storageKey` is given the dragged position is remembered per viewer in
 * localStorage. Z-order belongs to whoever manages several windows (the sheet windows store).
 */
export function useFloatingWindow(initial: Position, storageKey?: string, options: UseFloatingWindowOptions = {}): UseFloatingWindowResult {
  const { restore = true, onMove } = options;
  const [position, setPosition] = useState<Position>(() =>
    storageKey && restore ? readJson<Position>(`win:${storageKey}`, initial) : initial
  );
  const [minimized, setMinimized] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  // Only a drag is remembered: a window opened at a cascaded spot mustn't move the next one's remembered start.
  const draggedRef = useRef(false);

  useEffect(() => {
    if (storageKey && (restore || draggedRef.current)) writeJson(`win:${storageKey}`, position);
    onMoveRef.current?.(position);
  }, [storageKey, restore, position]);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    // Not `instanceof Element`: a node in another window (a popped-out sheet) is another window's Element.
    const target = event.target as Partial<Element> | null;
    if (target && typeof target.closest === "function" && target.closest("button")) return;
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    draggedRef.current = true;
    const view = event.currentTarget.ownerDocument?.defaultView ?? window;
    setPosition({
      x: clamp(event.clientX - drag.offsetX, 8, view.innerWidth - 120),
      y: clamp(event.clientY - drag.offsetY, 0, view.innerHeight - 44)
    });
  }

  function onPointerUp(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (drag && event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }
    dragRef.current = null;
  }

  return {
    position,
    minimized,
    toggleMinimize: () => setMinimized((value) => !value),
    titleBarProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }
  };
}

export interface WindowSize {
  width: number;
  /** Absent until the window is first resized: it's as tall as its content, up to the CSS maximum. */
  height?: number;
}

export interface ResizeLimits {
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
}

interface ResizeState {
  pointerId: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

export interface UseWindowResizeResult {
  size: WindowSize;
  /** Spread onto the corner grip. Drags resize the window within its limits and the viewport. */
  gripProps: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  };
}

/** `size` kept within `limits` and the room left between the window's corner (`origin`) and the viewport's edge. */
export function clampSize(size: { width: number; height: number }, limits: ResizeLimits, origin: Position, viewport: { width: number; height: number }) {
  const roomX = Math.max(limits.minWidth, viewport.width - origin.x - 8);
  const roomY = Math.max(limits.minHeight, viewport.height - origin.y - 8);
  return {
    width: Math.round(clamp(size.width, limits.minWidth, Math.min(limits.maxWidth ?? Infinity, roomX))),
    height: Math.round(clamp(size.height, limits.minHeight, Math.min(limits.maxHeight ?? Infinity, roomY)))
  };
}

/**
 * A corner grip that resizes a floating window. The size is remembered per viewer under `storageKey`; until it's first
 * resized, a window keeps its starting width and is as tall as its content.
 */
export function useWindowResize(initialWidth: number, limits: ResizeLimits, position: Position, storageKey?: string): UseWindowResizeResult {
  const [size, setSize] = useState<WindowSize>(() =>
    storageKey ? readJson<WindowSize>(`winsize:${storageKey}`, { width: initialWidth }) : { width: initialWidth }
  );
  const resizeRef = useRef<ResizeState | null>(null);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = (event.currentTarget.parentElement ?? event.currentTarget).getBoundingClientRect();
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const resize = resizeRef.current;
    if (!resize) return;
    const view = event.currentTarget.ownerDocument.defaultView ?? window;
    setSize(clampSize(
      { width: resize.startWidth + event.clientX - resize.startX, height: resize.startHeight + event.clientY - resize.startY },
      limits,
      position,
      { width: view.innerWidth, height: view.innerHeight }
    ));
  }

  function onPointerUp(event: PointerEvent<HTMLElement>) {
    const resize = resizeRef.current;
    if (resize && event.currentTarget.hasPointerCapture(resize.pointerId)) {
      event.currentTarget.releasePointerCapture(resize.pointerId);
    }
    resizeRef.current = null;
  }

  useEffect(() => {
    if (storageKey && size.height !== undefined) writeJson(`winsize:${storageKey}`, size);
  }, [storageKey, size]);

  return { size, gripProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}
