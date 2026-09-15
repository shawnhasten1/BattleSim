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

/**
 * Title-bar drag + minimize state for a floating (non-modal) window. When
 * `storageKey` is given the dragged position is remembered per viewer in
 * localStorage. Single-window today; a manager can layer z-order on top later
 * without touching this.
 */
export function useFloatingWindow(initial: Position, storageKey?: string): UseFloatingWindowResult {
  const [position, setPosition] = useState<Position>(() =>
    storageKey ? readJson<Position>(`win:${storageKey}`, initial) : initial
  );
  const [minimized, setMinimized] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (storageKey) writeJson(`win:${storageKey}`, position);
  }, [storageKey, position]);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
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
    setPosition({
      x: clamp(event.clientX - drag.offsetX, 8, window.innerWidth - 120),
      y: clamp(event.clientY - drag.offsetY, 0, window.innerHeight - 44)
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
