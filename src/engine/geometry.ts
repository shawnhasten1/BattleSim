import type { BattleMapState, GridConfig, Point, SizeCategory, TerrainZone, WallSegment } from "./types";

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
        : wall.blocksProjectiles;
    return blocks && segmentIntersects(from, to, wall.start, wall.end);
  });
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
