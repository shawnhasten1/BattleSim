/**
 * Pure screen <-> grid coordinate math for the scene canvas.
 *
 * The `.battlemap` element carries the viewport transform
 * (`translate(...) scale(zoom)`), so its `getBoundingClientRect()` is already
 * the on-screen (scaled) box. `clientWidth / rect.width` recovers `1 / zoom`
 * without the caller passing viewport state — the DOM is the source of truth.
 * Keep these functions free of React and of `window`.
 */

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface GridPoint {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3;
export const INITIAL_VIEWPORT: ViewportState = { x: 80, y: 72, zoom: 1 };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Layout-space scale factors for a possibly `scale()`-transformed element. */
function domScale(element: Pick<HTMLElement, "clientWidth" | "clientHeight" | "getBoundingClientRect">) {
  const rect = element.getBoundingClientRect();
  return {
    rect,
    scaleX: element.clientWidth / Math.max(1, rect.width),
    scaleY: element.clientHeight / Math.max(1, rect.height)
  };
}

/** Screen point -> integer grid cell (floored). Zoom/pan-correct. */
export function getCellPoint(
  element: Pick<HTMLElement, "clientWidth" | "clientHeight" | "getBoundingClientRect">,
  clientX: number,
  clientY: number,
  cellSize: number
): GridPoint {
  const { rect, scaleX, scaleY } = domScale(element);
  return {
    x: Math.floor(((clientX - rect.left) * scaleX) / cellSize),
    y: Math.floor(((clientY - rect.top) * scaleY) / cellSize)
  };
}

/** Screen point -> nearest half-cell grid intersection, clamped to the grid. */
export function getSnappedWallPoint(
  element: Pick<HTMLElement, "clientWidth" | "clientHeight" | "getBoundingClientRect">,
  clientX: number,
  clientY: number,
  cellSize: number,
  width: number,
  height: number
): GridPoint {
  const { rect, scaleX, scaleY } = domScale(element);
  const x = ((clientX - rect.left) * scaleX) / cellSize;
  const y = ((clientY - rect.top) * scaleY) / cellSize;
  return {
    x: clamp(Math.round(x * 2) / 2, 0, width),
    y: clamp(Math.round(y * 2) / 2, 0, height)
  };
}

export function pointsMatch(a: GridPoint, b: GridPoint): boolean {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
}

export function uniqueWallNodes(
  walls: Array<{ start: GridPoint; end: GridPoint }>
): GridPoint[] {
  const nodes: GridPoint[] = [];
  for (const wall of walls) {
    for (const point of [wall.start, wall.end]) {
      if (!nodes.some((node) => pointsMatch(node, point))) {
        nodes.push(point);
      }
    }
  }
  return nodes;
}

/**
 * Zoom to `nextZoom` while keeping the world point under `anchor` fixed on
 * screen. `stageRect` is the untransformed outer stage box; pass `null` (or a
 * null anchor) to zoom without re-anchoring.
 */
export function anchoredZoom(
  current: ViewportState,
  nextZoom: number,
  stageRect: { left: number; top: number } | null,
  anchor: { x: number; y: number } | null
): ViewportState {
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  if (!stageRect || !anchor) {
    return { ...current, zoom };
  }
  const anchorX = anchor.x - stageRect.left;
  const anchorY = anchor.y - stageRect.top;
  const worldX = (anchorX - current.x) / current.zoom;
  const worldY = (anchorY - current.y) / current.zoom;
  return {
    zoom,
    x: anchorX - worldX * zoom,
    y: anchorY - worldY * zoom
  };
}
