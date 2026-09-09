import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { anchoredZoom, clamp, INITIAL_VIEWPORT, MAX_ZOOM, MIN_ZOOM, type ViewportState } from "@/components/scene/coords";
import { readJson, writeJson } from "@/lib/persist";

const STORAGE_KEY = "viewport";

interface PanStart {
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  pointerId: number;
}

export interface UseViewportResult {
  viewport: ViewportState;
  /** Transform string for the `.battlemap` element. */
  transform: string;
  /** True while a middle-drag or space-drag pan is in progress. */
  isPanning: boolean;
  /** Synchronous mirror of `isPanning` for use inside event handler guards. */
  isPanningRef: RefObject<boolean>;
  /** True while Space is held (pre-drag grab affordance). */
  spacePanning: boolean;
  /** Attach to the outer stage element. Also wires a non-passive wheel listener. */
  stageRef: RefObject<HTMLElement | null>;
  /** Spread onto the outer stage element. */
  stageProps: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  };
  zoomBy: (factor: number) => void;
  resetViewport: () => void;
}

/**
 * Pan/zoom viewport for the scene stage. Wheel zoom is cursor-anchored;
 * panning is middle-mouse or Space+left-drag. No dependency on encounter state.
 */
export function useViewport(): UseViewportResult {
  const [viewport, setViewport] = useState<ViewportState>(INITIAL_VIEWPORT);
  const [isPanning, setIsPanning] = useState(false);
  const [spacePanning, setSpacePanning] = useState(false);
  const stageRef = useRef<HTMLElement | null>(null);
  const panStartRef = useRef<PanStart | null>(null);
  const isPanningRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);

  // Restore from localStorage after mount (not during render — avoids an SSR
  // hydration mismatch), then persist changes, coalesced. The `hydrated` gate
  // keeps the persist effect from clobbering the stored value before the
  // restore has flushed.
  useEffect(() => {
    const saved = readJson<ViewportState | null>(STORAGE_KEY, null);
    if (saved) setViewport(saved);
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => writeJson(STORAGE_KEY, viewport), 300);
    return () => clearTimeout(timer);
  }, [hydrated, viewport]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.code === "Space" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        setSpacePanning(true);
      }
    }
    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") {
        setSpacePanning(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // React attaches `wheel` as a passive listener, so `preventDefault()` in an
  // onWheel prop is ignored (and warns). Bind it ourselves, non-passively.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      setViewport((current) =>
        anchoredZoom(current, current.zoom * factor, stage!.getBoundingClientRect(), {
          x: event.clientX,
          y: event.clientY
        })
      );
    }
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, []);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 1 && !(event.button === 0 && spacePanning)) {
      return;
    }
    event.preventDefault();
    panStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      x: viewport.x,
      y: viewport.y,
      pointerId: event.pointerId
    };
    isPanningRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const panStart = panStartRef.current;
    if (!panStart) {
      return;
    }
    event.preventDefault();
    setViewport((current) => ({
      ...current,
      x: panStart.x + event.clientX - panStart.clientX,
      y: panStart.y + event.clientY - panStart.clientY
    }));
  }

  function endPanning(event: PointerEvent<HTMLElement>) {
    const panStart = panStartRef.current;
    if (!panStart) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(panStart.pointerId)) {
      event.currentTarget.releasePointerCapture(panStart.pointerId);
    }
    panStartRef.current = null;
    isPanningRef.current = false;
    setIsPanning(false);
  }

  return {
    viewport,
    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    isPanning,
    isPanningRef,
    spacePanning,
    stageRef,
    stageProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPanning,
      onPointerCancel: endPanning
    },
    zoomBy: (factor: number) =>
      setViewport((current) => ({ ...current, zoom: clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM) })),
    resetViewport: () => setViewport(INITIAL_VIEWPORT)
  };
}
