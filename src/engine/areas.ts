import { footprintCells } from "./geometry";
import type { AreaTemplate, BattleMapState, CombatantState, CreatureDefinition, Point } from "./types";

export function cellsInArea(map: BattleMapState, origin: Point, template: AreaTemplate): Point[] {
  const cells: Point[] = [];
  for (let y = 0; y < map.grid.height; y += 1) {
    for (let x = 0; x < map.grid.width; x += 1) {
      const cell = { x, y };
      if (cellIntersectsArea(cell, origin, template, map.grid.distancePerSquare)) {
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
  definitionsById: Map<string, CreatureDefinition>
): CombatantState[] {
  const areaCellKeys = new Set(cellsInArea(map, origin, template).map(cellKey));
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
  distancePerSquare: number
): boolean {
  const dx = (cell.x + 0.5) - (origin.x + 0.5);
  const dy = (cell.y + 0.5) - (origin.y + 0.5);
  const sizeSquares = template.size / distancePerSquare;

  switch (template.type) {
    case "circle":
      return Math.hypot(dx, dy) <= sizeSquares;
    case "square":
      return Math.abs(dx) <= sizeSquares / 2 && Math.abs(dy) <= sizeSquares / 2;
    case "line": {
      const direction = template.direction ?? "east";
      const widthSquares = (template.width ?? distancePerSquare) / distancePerSquare;
      if (direction === "east") return dx >= 0 && dx <= sizeSquares && Math.abs(dy) < widthSquares / 2;
      if (direction === "west") return dx <= 0 && Math.abs(dx) <= sizeSquares && Math.abs(dy) < widthSquares / 2;
      if (direction === "south") return dy >= 0 && dy <= sizeSquares && Math.abs(dx) < widthSquares / 2;
      return dy <= 0 && Math.abs(dy) <= sizeSquares && Math.abs(dx) < widthSquares / 2;
    }
    case "cone": {
      const direction = template.direction ?? "east";
      const forward = direction === "east" ? dx : direction === "west" ? -dx : direction === "south" ? dy : -dy;
      const lateral = direction === "east" || direction === "west" ? Math.abs(dy) : Math.abs(dx);
      return forward >= 0 && forward <= sizeSquares && lateral <= forward;
    }
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
