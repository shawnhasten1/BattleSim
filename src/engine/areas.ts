import { footprintCells } from "./geometry";
import type { AreaTemplate, BattleMapState, CombatantState, CreatureDefinition, Point } from "./types";

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
  aimVector?: AimVector
): CombatantState[] {
  const areaCellKeys = new Set(cellsInArea(map, origin, template, aimVector).map(cellKey));
  return combatants.filter((combatant) => {
    const definition = definitionsById.get(combatant.definitionId);
    if (!definition || combatant.state !== "active") {
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
  const dx = (cell.x + 0.5) - (origin.x + 0.5);
  const dy = (cell.y + 0.5) - (origin.y + 0.5);
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
