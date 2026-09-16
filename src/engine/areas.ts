import { footprintCells } from "./geometry";
import type { ActiveZone, AreaTemplate, BattleMapState, CombatantState, CreatureDefinition, Point, TerrainZone } from "./types";

/** Unit vector the template points along. When omitted the template's cardinal `direction` is used. */
export type AimVector = { x: number; y: number };

export function cellsInArea(map: BattleMapState, origin: Point, template: AreaTemplate, aimVector?: AimVector): Point[] {
  const cells: Point[] = [];
  for (let y = 0; y < map.grid.height; y += 1) {
    for (let x = 0; x < map.grid.width; x += 1) {
      const cell = { x, y };
      if (cellIntersectsArea(cell, origin, template, map.grid.distancePerSquare, aimVector)) {
        cells.push(cell);
      }
    }
  }
  return cells;
}

export function combatantsInArea(
  map: BattleMapState,
  origin: Point,
  template: AreaTemplate,
  combatants: CombatantState[],
  definitionsById: Map<string, CreatureDefinition>,
  aimVector?: AimVector,
  options: { includeDowned?: boolean } = {}
): CombatantState[] {
  const areaCellKeys = new Set(cellsInArea(map, origin, template, aimVector).map(cellKey));
  return combatants.filter((combatant) => {
    const definition = definitionsById.get(combatant.definitionId);
    const eligible = combatant.state === "active" || (options.includeDowned && combatant.state === "downed");
    if (!definition || !eligible) {
      return false;
    }
    return footprintCells(combatant.position, footprintForSize(definition.size)).some((cell) => areaCellKeys.has(cellKey(cell)));
  });
}

export function cellIntersectsArea(
  cell: Point,
  origin: Point,
  template: AreaTemplate,
  distancePerSquare: number,
  aimVector?: AimVector
): boolean {
  return pointIntersectsArea({ x: cell.x + 0.5, y: cell.y + 0.5 }, origin, template, distancePerSquare, aimVector);
}

/** Same shape test as `cellIntersectsArea`, but for a continuous point (e.g. a sample along a sight line) instead of a grid cell. */
export function pointIntersectsArea(
  point: Point,
  origin: Point,
  template: AreaTemplate,
  distancePerSquare: number,
  aimVector?: AimVector
): boolean {
  const dx = point.x - (origin.x + 0.5);
  const dy = point.y - (origin.y + 0.5);
  const sizeSquares = template.size / distancePerSquare;

  switch (template.type) {
    case "circle":
      return Math.hypot(dx, dy) <= sizeSquares;
    case "square":
      return Math.abs(dx) <= sizeSquares / 2 && Math.abs(dy) <= sizeSquares / 2;
    case "rectangle": {
      // `size` is the length along the aim / direction axis; `width` is the full lateral span.
      const { along, lateral } = projectDirectional(dx, dy, template.direction, aimVector);
      const halfWidth = ((template.width ?? distancePerSquare) / distancePerSquare) / 2;
      return along >= 0 && along <= sizeSquares && Math.abs(lateral) <= halfWidth;
    }
    case "line": {
      const { along, lateral } = projectDirectional(dx, dy, template.direction, aimVector);
      const widthSquares = (template.width ?? distancePerSquare) / distancePerSquare;
      return along >= 0 && along <= sizeSquares && Math.abs(lateral) < widthSquares / 2;
    }
    case "cone": {
      const { along, lateral } = projectDirectional(dx, dy, template.direction, aimVector);
      // 90° cone: lateral spread never exceeds the forward distance.
      return along >= 0 && along <= sizeSquares && Math.abs(lateral) <= along;
    }
  }
}

/**
 * Resolve a cell offset into forward ("along" the template) and sideways
 * ("lateral") components. An `aimVector` rotates the axis toward an arbitrary
 * point; otherwise the cardinal `direction` (default east) is used.
 */
function projectDirectional(
  dx: number,
  dy: number,
  direction: AreaTemplate["direction"],
  aimVector?: AimVector
): { along: number; lateral: number } {
  if (aimVector) {
    const length = Math.hypot(aimVector.x, aimVector.y) || 1;
    const ax = aimVector.x / length;
    const ay = aimVector.y / length;
    return {
      along: dx * ax + dy * ay,
      // perpendicular (rotate the aim axis 90°)
      lateral: dx * -ay + dy * ax
    };
  }
  switch (direction ?? "east") {
    case "west": return { along: -dx, lateral: dy };
    case "north": return { along: -dy, lateral: dx };
    case "south": return { along: dy, lateral: dx };
    case "east":
    default: return { along: dx, lateral: dy };
  }
}

function footprintForSize(size: CreatureDefinition["size"]): number {
  switch (size) {
    case "large": return 2;
    case "huge": return 3;
    case "gargantuan": return 4;
    default: return 1;
  }
}

function cellKey(point: Point): string {
  return `${point.x},${point.y}`;
}

/* ─── Zone-imposed terrain / sight ────────────────────────────────────────────
 * A standing `ActiveZone` can carry `terrain` (Web, Spike Growth: difficult or
 * impassable ground) or `blocksSight` (a fog cloud). Pathfinding (geometry.ts)
 * only ever consults `BattleMapState.terrain`, a polygon list — so rather than
 * threading `ActiveZone[]` through every path-cost function, `zoneTerrainOverlay`
 * synthesises approximating `TerrainZone` polygons and merges them into a
 * throwaway map passed to `findPath` / `findReachableCells` / `pathCostField`
 * at the call site. Circle and square shapes are exact; cone/line/rectangle
 * fall back to a bounding circle (no zone-terrain spell uses those shapes yet,
 * and a fixed-anchor zone never persists the `aimVector` a precise cone/line
 * polygon would need anyway).
 */

function circlePolygon(origin: Point, radiusSquares: number, sides = 20): Point[] {
  const center = { x: origin.x + 0.5, y: origin.y + 0.5 };
  const points: Point[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2;
    points.push({ x: center.x + Math.cos(angle) * radiusSquares, y: center.y + Math.sin(angle) * radiusSquares });
  }
  return points;
}

function squarePolygon(origin: Point, halfSquares: number): Point[] {
  const center = { x: origin.x + 0.5, y: origin.y + 0.5 };
  return [
    { x: center.x - halfSquares, y: center.y - halfSquares },
    { x: center.x + halfSquares, y: center.y - halfSquares },
    { x: center.x + halfSquares, y: center.y + halfSquares },
    { x: center.x - halfSquares, y: center.y + halfSquares }
  ];
}

function areaPolygon(origin: Point, template: AreaTemplate, distancePerSquare: number): Point[] {
  const sizeSquares = template.size / distancePerSquare;
  if (template.type === "square") {
    return squarePolygon(origin, sizeSquares / 2);
  }
  return circlePolygon(origin, sizeSquares);
}

/**
 * `map` with every zone-imposed `terrain` effect layered on as an extra
 * `TerrainZone`. Returns `map` unchanged (no new object) when there's nothing
 * to add, so callers can pass the result straight into `findPath` /
 * `findReachableCells` / `pathCostField` / `isFootprintLegal` at zero cost
 * for the (common) case of no active zones.
 */
export function zoneTerrainOverlay(map: BattleMapState, zones: ActiveZone[] | undefined): BattleMapState {
  if (!zones?.length) {
    return map;
  }
  const distancePerSquare = map.grid.distancePerSquare;
  const zoneTerrain: TerrainZone[] = zones
    .filter((zone): zone is ActiveZone & { terrain: NonNullable<ActiveZone["terrain"]> } => Boolean(zone.terrain))
    .map((zone) => ({
      id: `zone-terrain-${zone.id}`,
      name: zone.name,
      type: zone.terrain.type,
      polygon: areaPolygon(zone.origin, zone.area, distancePerSquare),
      movementMultiplier: zone.terrain.movementMultiplier
    }));
  if (!zoneTerrain.length) {
    return map;
  }
  return { ...map, terrain: [...map.terrain, ...zoneTerrain] };
}

/**
 * A hazard tile's *real* movement cost is normal ground — only difficult/
 * impassable terrain slows anyone down — deliberately, so a creature can
 * choose to eat the risk without it also costing extra movement. But that
 * means plain pathfinding has no reason to route around one: it commits to
 * the single cheapest path through every cell it explores, so a hazard
 * sitting on the direct line gets baked into every route through that area
 * with nothing to prefer a detour.
 *
 * Feed this overlay's output into `findPath` / `findReachableCells` /
 * `pathCostField` to bias the *route those functions choose* toward
 * detouring around hazard tiles when a comparably-priced alternative
 * exists, without making a truly unavoidable crossing impossible — treat
 * the resulting `cost` as planning-only, never as the real movement spent;
 * recompute that separately (`pathCostAlong` in geometry.ts) against the
 * real map once a route is chosen. Returns `map` unchanged when there's no
 * hazard terrain to route around.
 */
export function hazardPathingOverlay(map: BattleMapState): BattleMapState {
  if (!map.terrain.some((tile) => tile.hazard)) {
    return map;
  }
  return {
    ...map,
    terrain: map.terrain.map((tile) => tile.hazard ? { ...tile, movementMultiplier: HAZARD_PATHING_MULTIPLIER } : tile)
  };
}

/** How many times pricier than open ground a hazard tile is treated as, for `hazardPathingOverlay`'s route-selection purposes only. */
const HAZARD_PATHING_MULTIPLIER = 10;

/** Whether the segment `from`→`to` (grid coordinates) passes through any `blocksSight` zone, sampled along its length. */
export function zoneBlocksSightBetween(zones: ActiveZone[] | undefined, from: Point, to: Point, distancePerSquare: number): boolean {
  const sightZones = zones?.filter((zone) => zone.blocksSight);
  if (!sightZones?.length) {
    return false;
  }
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (sightZones.some((zone) => pointIntersectsArea(point, zone.origin, zone.area, distancePerSquare))) {
      return true;
    }
  }
  return false;
}
