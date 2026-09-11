import type { BattleMapState, CoverLevel, GridConfig, Point, SizeCategory, TerrainZone, WallSegment } from "./types";

export interface PathResult {
  reachable: boolean;
  cost: number;
  cells: Point[];
}

export interface ReachableCell {
  cell: Point;
  cost: number;
  cells: Point[];
}

export interface OccupancyMovementOptions {
  allowOccupiedTransit?: boolean;
  occupiedMovementMultiplier?: number;
}

const epsilon = 1e-9;

export function sizeFootprint(size: SizeCategory): number {
  switch (size) {
    case "tiny":
    case "small":
    case "medium":
      return 1;
    case "large":
      return 2;
    case "huge":
      return 3;
    case "gargantuan":
      return 4;
  }
}

export function gridDistance(a: Point, b: Point, grid: GridConfig): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  if (grid.diagonalMode === "standard") {
    return Math.max(dx, dy) * grid.distancePerSquare;
  }

  const diagonals = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diagonals;
  const diagonalSquares = Math.floor(diagonals / 2) * 3 + (diagonals % 2);
  return (straight + diagonalSquares) * grid.distancePerSquare;
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i]?.x ?? 0;
    const yi = polygon[i]?.y ?? 0;
    const xj = polygon[j]?.x ?? 0;
    const yj = polygon[j]?.y ?? 0;
    const intersects = yi > point.y !== yj > point.y
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + epsilon) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function segmentIntersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  return (o1 === 0 && onSegment(a, c, b))
    || (o2 === 0 && onSegment(a, d, b))
    || (o3 === 0 && onSegment(c, a, d))
    || (o4 === 0 && onSegment(c, b, d));
}

export function lineBlocked(
  from: Point,
  to: Point,
  walls: WallSegment[],
  mode: "movement" | "sight" | "projectile"
): boolean {
  return walls.some((wall) => {
    if (wall.doorState === "open" || wall.doorState === "destroyed") {
      return false;
    }
    const blocks = mode === "movement"
      ? wall.blocksMovement
      : mode === "sight"
        ? wall.blocksSight
        // Line of effect: the wall's own flag, or total cover (which always blocks).
        : wall.blocksProjectiles || wallCover(wall) === "total";
    return blocks && segmentIntersects(from, to, wall.start, wall.end);
  });
}

/* ============================================================
 * Cover (5e) — how much an obstacle shields a creature behind it.
 * ============================================================ */

const COVER_RANK: Record<CoverLevel, number> = { none: 0, half: 1, "three-quarters": 2, total: 3 };
/** AC / Dex-save bonus per level. `total` keeps +5 so a "soft" (no line-of-effect) rules profile still shields. */
const COVER_BONUS: Record<CoverLevel, number> = { none: 0, half: 2, "three-quarters": 5, total: 5 };
const COVER_LABEL: Record<CoverLevel, string> = {
  none: "",
  half: "low wall",
  "three-quarters": "cover wall",
  total: "wall"
};

export interface CoverResult {
  level: CoverLevel;
  /** AC bonus vs ranged attacks (0 when targeting is blocked and line-of-effect is enforced). */
  acBonus: number;
  /** Bonus to Dex saving throws (e.g. vs an area effect). */
  dexSaveBonus: number;
  /** True only for `total` cover — the target cannot be targeted through it. */
  blocksTargeting: boolean;
  /** Short labels for the obstacles granting cover, for the log / inspector. */
  sources: string[];
}

function noCover(): CoverResult {
  return { level: "none", acBonus: 0, dexSaveBonus: 0, blocksTargeting: false, sources: [] };
}

/** The cover a wall segment currently grants (open / destroyed doors grant none). */
export function wallCover(wall: WallSegment): CoverLevel {
  if (wall.doorState === "open" || wall.doorState === "destroyed") {
    return "none";
  }
  return wall.cover ?? (wall.blocksProjectiles ? "total" : "none");
}

function footprintBox(cell: Point, footprint: number): { min: Point; max: Point } {
  return { min: { x: cell.x, y: cell.y }, max: { x: cell.x + footprint, y: cell.y + footprint } };
}

/** Attacker centre → the target box's 4 (inset) corners + centre. */
function probeLines(from: Point, fromFootprint: number, to: Point, toFootprint: number): Array<[Point, Point]> {
  const origin = { x: from.x + fromFootprint / 2, y: from.y + fromFootprint / 2 };
  const box = footprintBox(to, toFootprint);
  const inset = 0.12;
  const targets: Point[] = [
    { x: box.min.x + inset, y: box.min.y + inset },
    { x: box.max.x - inset, y: box.min.y + inset },
    { x: box.min.x + inset, y: box.max.y - inset },
    { x: box.max.x - inset, y: box.max.y - inset },
    { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 }
  ];
  return targets.map((point) => [origin, point] as [Point, Point]);
}

/** An intervening body the caller wants considered for creature-granted half cover. */
export interface CoverBlocker {
  position: Point;
  footprint: number;
}

/**
 * Cover the creature at `to` has from an attacker / effect origin at `from`.
 *
 * Samples ~5 lines from the attacker's centre to the target square's corners +
 * centre. For each line the strongest obstacle is recorded — a cover wall, or
 * an `opts.blockers` body (→ half) — then:
 * - every line blocked by `total` cover ⇒ `total` (blocks targeting);
 * - otherwise the level scales with the fraction of lines obstructed and the
 *   strongest obstacle: mostly-covered behind a strong wall ⇒ three-quarters;
 *   a strong wall clipping only a corner, or any half wall ⇒ half.
 *
 * `opts.blockers` is caller-resolved (position + footprint) so this stays free
 * of creature-definition lookups; pass `[]` (or omit) to ignore creature cover.
 */
export function coverBetween(
  map: BattleMapState,
  from: Point,
  fromFootprint: number,
  to: Point,
  toFootprint: number,
  opts: { blockers?: CoverBlocker[] } = {}
): CoverResult {
  const coverWalls = map.walls.filter((wall) => wallCover(wall) !== "none");
  const blockers = opts.blockers ?? [];
  if (coverWalls.length === 0 && blockers.length === 0) {
    return noCover();
  }

  const lines = probeLines(from, fromFootprint, to, toFootprint);
  const sources = new Set<string>();
  let obstructed = 0;
  let blockedByTotal = 0;
  let strongestRank = 0;

  for (const [a, b] of lines) {
    let lineRank = 0;
    for (const wall of coverWalls) {
      if (!segmentIntersects(a, b, wall.start, wall.end)) continue;
      const level = wallCover(wall);
      if (COVER_RANK[level] > lineRank) lineRank = COVER_RANK[level];
      sources.add(COVER_LABEL[level]);
    }
    for (const blocker of blockers) {
      if (blocker.footprint <= 0) continue;
      const box = footprintBox(blocker.position, blocker.footprint);
      const crossesBox = segmentIntersects(a, b, box.min, box.max)
        || segmentIntersects(a, b, { x: box.min.x, y: box.max.y }, { x: box.max.x, y: box.min.y });
      if (crossesBox) {
        sources.add("a creature");
        if (COVER_RANK.half > lineRank) lineRank = COVER_RANK.half;
      }
    }
    if (lineRank > 0) obstructed += 1;
    if (lineRank >= COVER_RANK.total) blockedByTotal += 1;
    if (lineRank > strongestRank) strongestRank = lineRank;
  }

  if (obstructed === 0) return noCover();
  if (blockedByTotal === lines.length) {
    return { level: "total", acBonus: 0, dexSaveBonus: 0, blocksTargeting: true, sources: [...sources].filter(Boolean) };
  }

  const fraction = obstructed / lines.length;
  const level: CoverLevel = strongestRank >= COVER_RANK["three-quarters"]
    ? (fraction >= 0.5 ? "three-quarters" : "half")
    : "half";

  return {
    level,
    acBonus: COVER_BONUS[level],
    dexSaveBonus: COVER_BONUS[level],
    blocksTargeting: false,
    sources: [...sources].filter(Boolean)
  };
}

export function footprintCells(position: Point, footprint: number): Point[] {
  const cells: Point[] = [];
  for (let y = 0; y < footprint; y += 1) {
    for (let x = 0; x < footprint; x += 1) {
      cells.push({ x: position.x + x, y: position.y + y });
    }
  }
  return cells;
}

export function isFootprintLegal(
  map: BattleMapState,
  position: Point,
  footprint: number,
  occupied: Point[] = []
): boolean {
  const cells = footprintCells(position, footprint);
  return cells.every((cell) => {
    const inBounds = cell.x >= 0
      && cell.y >= 0
      && cell.x < map.grid.width
      && cell.y < map.grid.height;
    const occupiedByOther = occupied.some((other) => other.x === cell.x && other.y === cell.y);
    return inBounds && !occupiedByOther && terrainAtCell(map.terrain, cell)?.type !== "impassable";
  });
}

export function movementCostForCell(terrain: TerrainZone[], cell: Point): number {
  const zone = terrainAtCell(terrain, cell);
  if (!zone) {
    return 1;
  }
  if (zone.type === "impassable") {
    return Number.POSITIVE_INFINITY;
  }
  if (zone.type === "difficult") {
    return zone.movementMultiplier ?? 2;
  }
  return zone.movementMultiplier ?? 1;
}

export function terrainAtCell(terrain: TerrainZone[], cell: Point): TerrainZone | undefined {
  const center = { x: cell.x + 0.5, y: cell.y + 0.5 };
  return terrain.find((zone) => pointInPolygon(center, zone.polygon));
}

export function findPath(
  map: BattleMapState,
  start: Point,
  goal: Point,
  footprint: number,
  occupied: Point[] = [],
  options: OccupancyMovementOptions = {}
): PathResult {
  if (!isTransitFootprintLegal(map, start, footprint, occupied, options) || !isFootprintLegal(map, goal, footprint, occupied)) {
    return { reachable: false, cost: Number.POSITIVE_INFINITY, cells: [] };
  }

  const startKey = key(start);
  const goalKey = key(goal);
  const open = new Set<string>([startKey]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, heuristic(start, goal)]]);

  while (open.size > 0) {
    const currentKey = [...open].sort((a, b) => (fScore.get(a) ?? Infinity) - (fScore.get(b) ?? Infinity))[0];
    if (!currentKey) {
      break;
    }
    const current = parseKey(currentKey);
    if (currentKey === goalKey) {
      return {
        reachable: true,
        cost: gScore.get(currentKey) ?? 0,
        cells: reconstructPath(cameFrom, currentKey).map(parseKey)
      };
    }

    open.delete(currentKey);
    for (const next of neighbors(current)) {
      if (!isTransitFootprintLegal(map, next, footprint, occupied, options) || movementBlockedBetween(map.walls, current, next, footprint)) {
        continue;
      }
      const stepCost = stepDistance(current, next) * footprintMovementCost(map, next, footprint, occupied, options);
      const tentative = (gScore.get(currentKey) ?? Infinity) + stepCost;
      const nextKey = key(next);
      if (tentative < (gScore.get(nextKey) ?? Infinity)) {
        cameFrom.set(nextKey, currentKey);
        gScore.set(nextKey, tentative);
        fScore.set(nextKey, tentative + heuristic(next, goal));
        open.add(nextKey);
      }
    }
  }

  return { reachable: false, cost: Number.POSITIVE_INFINITY, cells: [] };
}

export function findReachableCells(
  map: BattleMapState,
  start: Point,
  footprint: number,
  movementBudget: number,
  occupied: Point[] = [],
  options: OccupancyMovementOptions = {}
): ReachableCell[] {
  if (!isTransitFootprintLegal(map, start, footprint, occupied, options)) {
    return [];
  }

  const open = new Set<string>([key(start)]);
  const costs = new Map<string, number>([[key(start), 0]]);
  const cameFrom = new Map<string, string>();

  while (open.size > 0) {
    const currentKey = [...open].sort((a, b) => (costs.get(a) ?? Infinity) - (costs.get(b) ?? Infinity))[0];
    if (!currentKey) {
      break;
    }
    open.delete(currentKey);
    const current = parseKey(currentKey);
    const currentCost = costs.get(currentKey) ?? 0;

    for (const next of neighbors(current)) {
      if (!isTransitFootprintLegal(map, next, footprint, occupied, options) || movementBlockedBetween(map.walls, current, next, footprint)) {
        continue;
      }
      const nextCost = currentCost + stepDistance(current, next) * footprintMovementCost(map, next, footprint, occupied, options);
      if (nextCost > movementBudget || nextCost >= (costs.get(key(next)) ?? Infinity)) {
        continue;
      }
      const nextKey = key(next);
      cameFrom.set(nextKey, currentKey);
      costs.set(nextKey, nextCost);
      open.add(nextKey);
    }
  }

  return [...costs.entries()]
    .map(([cell, cost]) => ({ cell: parseKey(cell), cost, cells: reconstructPath(cameFrom, cell).map(parseKey) }))
    .filter(({ cell }) => isFootprintLegal(map, cell, footprint, occupied));
}

/**
 * Legal-move path cost from `origin` to every cell it can reach (default:
 * unbounded — the whole connected map), respecting walls, terrain, and
 * occupancy exactly like `findReachableCells`. Movement cost is symmetric, so
 * this doubles as "path distance back to `origin`" for any of those cells —
 * use it to rank candidate cells by real route length (around walls, through
 * doors) instead of straight-line distance, e.g. when nothing is reachable
 * within a target's range this turn and the AI just wants to close the gap
 * intelligently. Keyed by `"x,y"`.
 */
export function pathCostField(
  map: BattleMapState,
  origin: Point,
  footprint: number,
  occupied: Point[] = [],
  options: OccupancyMovementOptions = {},
  maxCost = Number.POSITIVE_INFINITY
): Map<string, number> {
  const field = new Map<string, number>();
  for (const { cell, cost } of findReachableCells(map, origin, footprint, maxCost, occupied, options)) {
    field.set(`${cell.x},${cell.y}`, cost);
  }
  return field;
}

export function movementBlockedBetween(
  walls: WallSegment[],
  from: Point,
  to: Point,
  footprint: number
): boolean {
  return footprintCells(from, footprint).some((fromCell) => {
    const delta = { x: to.x - from.x, y: to.y - from.y };
    const toCell = { x: fromCell.x + delta.x, y: fromCell.y + delta.y };
    return lineBlocked(cellCenter(fromCell), cellCenter(toCell), walls, "movement");
  });
}

export function lineOfEffect(map: BattleMapState, from: Point, to: Point): boolean {
  return !lineBlocked(cellCenter(from), cellCenter(to), map.walls, "projectile");
}

export function lineOfSight(map: BattleMapState, from: Point, to: Point): boolean {
  return !lineBlocked(cellCenter(from), cellCenter(to), map.walls, "sight");
}

function footprintMovementCost(
  map: BattleMapState,
  position: Point,
  footprint: number,
  occupied: Point[],
  options: OccupancyMovementOptions
): number {
  const terrainCost = Math.max(...footprintCells(position, footprint).map((cell) => movementCostForCell(map.terrain, cell)));
  if (!options.allowOccupiedTransit || !footprintOverlapsOccupied(position, footprint, occupied)) {
    return terrainCost;
  }
  return terrainCost * (options.occupiedMovementMultiplier ?? 2);
}

function isTransitFootprintLegal(
  map: BattleMapState,
  position: Point,
  footprint: number,
  occupied: Point[],
  options: OccupancyMovementOptions
): boolean {
  if (!options.allowOccupiedTransit) {
    return isFootprintLegal(map, position, footprint, occupied);
  }
  return footprintCells(position, footprint).every((cell) => {
    return cell.x >= 0
      && cell.y >= 0
      && cell.x < map.grid.width
      && cell.y < map.grid.height
      && terrainAtCell(map.terrain, cell)?.type !== "impassable";
  });
}

function footprintOverlapsOccupied(position: Point, footprint: number, occupied: Point[]): boolean {
  return footprintCells(position, footprint)
    .some((cell) => occupied.some((other) => other.x === cell.x && other.y === cell.y));
}

function cellCenter(cell: Point): Point {
  return { x: cell.x + 0.5, y: cell.y + 0.5 };
}

function neighbors(cell: Point): Point[] {
  const cells: Point[] = [];
  for (let y = -1; y <= 1; y += 1) {
    for (let x = -1; x <= 1; x += 1) {
      if (x !== 0 || y !== 0) {
        cells.push({ x: cell.x + x, y: cell.y + y });
      }
    }
  }
  return cells;
}

function stepDistance(a: Point, b: Point): number {
  return a.x !== b.x && a.y !== b.y ? 1.5 : 1;
}

function heuristic(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function key(point: Point): string {
  return `${point.x},${point.y}`;
}

function parseKey(value: string): Point {
  const [x, y] = value.split(",").map(Number);
  return { x, y };
}

function reconstructPath(cameFrom: Map<string, string>, currentKey: string): string[] {
  const total = [currentKey];
  let current = currentKey;
  while (cameFrom.has(current)) {
    current = cameFrom.get(current) as string;
    total.unshift(current);
  }
  return total;
}

function orientation(a: Point, b: Point, c: Point): 0 | 1 | 2 {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < epsilon) {
    return 0;
  }
  return value > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return b.x <= Math.max(a.x, c.x) + epsilon
    && b.x + epsilon >= Math.min(a.x, c.x)
    && b.y <= Math.max(a.y, c.y) + epsilon
    && b.y + epsilon >= Math.min(a.y, c.y);
}
