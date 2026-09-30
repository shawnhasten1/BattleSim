import { groundHeightAt } from "./geometry";
import { MAX_STEP_HEIGHT_FT, type BattleMapState, type MapElevation, type Point } from "./types";

/** A planned ramp: the height each cell of the band gets, and whether a walker could actually use it. */
export interface RampPlan {
  cells: Array<{ cell: Point; height: number }>;
  /** The biggest rise or drop between two neighbouring cells of the ramp, in feet. */
  steepestStep: number;
  /** True when no step is taller than a walker takes in stride. */
  walkable: boolean;
  /** How many squares long the ramp must be for a walker to climb it (one per `MAX_STEP_HEIGHT_FT` of rise). */
  squaresNeeded: number;
  /** Squares the ramp actually spans, end to end. */
  squaresSpanned: number;
  lowHeight: number;
  highHeight: number;
}

const EMPTY_RAMP: RampPlan = { cells: [], steepestStep: 0, walkable: true, squaresNeeded: 0, squaresSpanned: 0, lowHeight: 0, highHeight: 0 };

/**
 * A ramp or stair between two cells: every cell of a band `width` squares wide along the line from `start` to `end`
 * takes a height interpolated between the heights of those two cells. Drag from the low end to the high end (or the
 * other way); the ends keep the heights they have and the steps fill in between. `walkable` says whether the
 * result is gentle enough for a walker (no step over `MAX_STEP_HEIGHT_FT`), so the editor can warn.
 */
export function planRamp(map: BattleMapState, start: Point, end: Point, width = 1): RampPlan {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return EMPTY_RAMP;

  const startHeight = groundHeightAt(map, start);
  const endHeight = groundHeightAt(map, end);
  const ux = dx / length;
  const uy = dy / length;
  const band = Math.max(1, Math.round(width));
  const reach = Math.ceil(band / 2) + 1;
  const epsilon = 1e-9;

  const cells: RampPlan["cells"] = [];
  for (let y = Math.min(start.y, end.y) - reach; y <= Math.max(start.y, end.y) + reach; y += 1) {
    for (let x = Math.min(start.x, end.x) - reach; x <= Math.max(start.x, end.x) + reach; x += 1) {
      if (x < 0 || y < 0 || x >= map.grid.width || y >= map.grid.height) continue;
      const rx = x - start.x;
      const ry = y - start.y;
      const along = rx * ux + ry * uy;
      const across = -rx * uy + ry * ux;
      if (along < -0.5 + epsilon || along > length + 0.5 - epsilon) continue;
      if (across < -band / 2 - epsilon || across >= band / 2 - epsilon) continue;
      const t = Math.min(1, Math.max(0, along / length));
      cells.push({ cell: { x, y }, height: Math.round(startHeight + (endHeight - startHeight) * t) });
    }
  }

  const byKey = new Map(cells.map((entry) => [`${entry.cell.x},${entry.cell.y}`, entry.height]));
  let steepestStep = 0;
  for (const { cell, height } of cells) {
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (ox === 0 && oy === 0) continue;
        const neighbour = byKey.get(`${cell.x + ox},${cell.y + oy}`);
        if (neighbour !== undefined) steepestStep = Math.max(steepestStep, Math.abs(height - neighbour));
      }
    }
  }
  const rise = Math.abs(endHeight - startHeight);
  return {
    cells,
    steepestStep,
    walkable: steepestStep <= MAX_STEP_HEIGHT_FT,
    squaresNeeded: Math.ceil(rise / MAX_STEP_HEIGHT_FT),
    squaresSpanned: Math.max(Math.abs(dx), Math.abs(dy)),
    lowHeight: Math.min(startHeight, endHeight),
    highHeight: Math.max(startHeight, endHeight)
  };
}

/** The elevation layer with these heights written in. A height of 0 is the datum, so it is dropped; nothing left means no layer. */
export function withGroundHeights(elevation: MapElevation | undefined, updates: Array<{ cell: Point; height: number }>): MapElevation | undefined {
  const cells = { ...(elevation?.cells ?? {}) };
  for (const { cell, height } of updates) {
    const key = `${cell.x},${cell.y}`;
    if (height === 0) delete cells[key];
    else cells[key] = height;
  }
  return Object.keys(cells).length > 0 ? { cells } : undefined;
}

/** A border between two neighbouring cells too far apart in height for a walker to cross, as grid-unit endpoints. */
export interface CliffEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** How far apart the two sides are, in feet. */
  drop: number;
}

/** Every cliff edge on the map, each once — for drawing where walkers are stopped. */
export function cliffEdges(map: Pick<BattleMapState, "elevation" | "grid">): CliffEdge[] {
  const cells = map.elevation?.cells;
  if (!cells) return [];
  const { width, height } = map.grid;
  const heightAt = (x: number, y: number) => cells[`${x},${y}`] ?? 0;
  const edges: CliffEdge[] = [];
  const seen = new Set<string>();
  const consider = (x: number, y: number, nx: number, ny: number) => {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
    const drop = Math.abs(heightAt(x, y) - heightAt(nx, ny));
    if (drop <= MAX_STEP_HEIGHT_FT) return;
    const key = x < nx || y < ny ? `${x},${y}|${nx},${ny}` : `${nx},${ny}|${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    // The shared border: vertical when the neighbour is left/right, horizontal when above/below.
    if (nx !== x) {
      const gx = Math.max(x, nx);
      edges.push({ x1: gx, y1: y, x2: gx, y2: y + 1, drop });
    } else {
      const gy = Math.max(y, ny);
      edges.push({ x1: x, y1: gy, x2: x + 1, y2: gy, drop });
    }
  };
  for (const key of Object.keys(cells)) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    consider(x, y, x + 1, y);
    consider(x, y, x - 1, y);
    consider(x, y, x, y + 1);
    consider(x, y, x, y - 1);
  }
  return edges;
}
