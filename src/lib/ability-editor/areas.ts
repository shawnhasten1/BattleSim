/**
 * An area as the editor offers it: a sphere, cone, line or cube, and where it starts. Each maps onto the engine's
 * template (`AreaTemplate`) and placement (`AreaTargeting`) the way the SRD writes them:
 *
 * | Shape  | Around itself            | At a point in range     | Out from itself (aimed)        |
 * |--------|--------------------------|-------------------------|--------------------------------|
 * | sphere | circle, origin self      | circle, origin point    | —                              |
 * | cone   | —                        | —                       | cone, origin self, aimed       |
 * | line   | —                        | —                       | line (length × width), aimed   |
 * | cube   | square, origin self      | square, origin point    | rectangle size × size, aimed   |
 *
 * A record that places a shape some other way keeps it: its start is offered alongside the usual ones.
 */
import type { AreaTemplate } from "@/engine";
import type { Target } from "./bindings";

export type AreaShape = "sphere" | "cone" | "line" | "cube";
/** Around itself, at a point it chooses in range, or out from itself toward a point. */
export type AreaStart = "self" | "point" | "front";

export type AreaTarget = Extract<Target, { kind: "area" }>;

export function areaShapeOf(area: AreaTemplate): AreaShape {
  switch (area.type) {
    case "circle": return "sphere";
    case "cone": return "cone";
    case "line": return "line";
    case "square": return "cube";
    case "rectangle": return (area.width ?? 5) === area.size ? "cube" : "line";
  }
}

const directional = (area: AreaTemplate) => area.type === "cone" || area.type === "line" || area.type === "rectangle";

export function areaStartOf(target: AreaTarget): AreaStart {
  if (target.origin === "point") return "point";
  return directional(target.area) ? "front" : "self";
}

/** Where each shape can start, with the target's own start kept when it's unusual. */
export function areaStarts(shape: AreaShape, current?: AreaStart): AreaStart[] {
  const usual: AreaStart[] = shape === "sphere" ? ["self", "point"] : shape === "cube" ? ["point", "self", "front"] : ["front"];
  return current && !usual.includes(current) ? [...usual, current] : usual;
}

/** A new shape, keeping the size; it starts where that shape usually does (a sphere keeps where it was). */
export function withAreaShape(target: AreaTarget, shape: AreaShape): AreaTarget {
  if (shape === areaShapeOf(target.area)) return target;
  const size = target.area.size;
  const atPoint = target.origin === "point";
  switch (shape) {
    case "sphere":
      return { kind: "area", area: { type: "circle", size }, origin: atPoint ? "point" : "self", range: atPoint ? target.range : size };
    case "cone":
      return { kind: "area", area: { type: "cone", size }, origin: "self", range: size, aimedFromSelf: true };
    case "line":
      return { kind: "area", area: { type: "line", size, width: 5 }, origin: "self", range: size, aimedFromSelf: true };
    case "cube":
      return { kind: "area", area: { type: "square", size }, origin: "point", range: atPoint ? target.range : 60 };
  }
}

/** The same shape starting somewhere else: a point in range (60 ft to begin with), around itself, or out from it. */
export function withAreaStart(target: AreaTarget, start: AreaStart): AreaTarget {
  if (start === areaStartOf(target)) return target;
  const { area } = target;
  const size = area.size;
  const cube = areaShapeOf(area) === "cube";
  switch (start) {
    case "point":
      return {
        kind: "area",
        area: cube ? { type: "square", size } : area,
        origin: "point",
        range: target.origin === "point" ? target.range : 60,
        ...(directional(area) && !cube ? { aimedFromSelf: true } : {})
      };
    case "self":
      return { kind: "area", area: cube ? { type: "square", size } : area, origin: "self", range: size };
    case "front":
      return { kind: "area", area: cube ? { type: "rectangle", size, width: size } : area, origin: "self", range: size, aimedFromSelf: true };
  }
}

/** A new size: a cube out from itself stays a cube (its width follows), a line keeps its width. */
export function withAreaSize(target: AreaTarget, size: number): AreaTarget {
  const { area } = target;
  const cubeOut = area.type === "rectangle" && (area.width ?? 5) === area.size;
  return { ...target, area: { ...area, size, ...(cubeOut ? { width: size } : {}) } };
}

/** A line's width. */
export function withAreaWidth(target: AreaTarget, width: number): AreaTarget {
  return { ...target, area: { ...target.area, width } };
}

/** "Radius", "Length" or "Side" for the shape's size. */
export function sizeWord(shape: AreaShape): string {
  return shape === "sphere" ? "Radius" : shape === "cube" ? "Side" : "Length";
}
