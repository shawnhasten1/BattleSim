"use client";

import { useMemo } from "react";
import { cliffEdges, groundHeightAt, MAX_STEP_HEIGHT_FT, planRamp, type BattleMapState, type Point } from "@/engine";
import { ELEVATION_STEP_FT, type ElevationMode } from "@/store/encounter-store";
import { feetLabel, heightFill } from "@/components/scene/elevation-style";

interface ElevationLayerProps {
  map: BattleMapState;
  /** True while the elevation tool is active: heights are written on the cells and the brush is shown. */
  editing: boolean;
  mode: ElevationMode;
  paintHeight: number;
  rampWidth: number;
  hoverCell: Point | null;
  rampDrag: { start: Point; end: Point } | null;
  paintStroke: Point[] | null;
}

/** What one cell would become if the brush landed on it. */
function brushResult(mode: ElevationMode, current: number, paintHeight: number): number {
  if (mode === "set") return paintHeight;
  if (mode === "raise") return current + ELEVATION_STEP_FT;
  if (mode === "lower") return current - ELEVATION_STEP_FT;
  return 0;
}

/**
 * Ground height on the map: every raised (or sunken) cell tinted by how high it is, a heavy line along every edge a
 * walker cannot cross, and — while editing — the height written on each cell, the brush under the cursor, and a live
 * preview of a ramp being dragged. Drawn beneath terrain so lava on a hill still reads as lava.
 */
export function ElevationLayer({ map, editing, mode, paintHeight, rampWidth, hoverCell, rampDrag, paintStroke }: ElevationLayerProps) {
  const cells = useMemo(
    () => Object.entries(map.elevation?.cells ?? {}).map(([key, height]) => {
      const [x, y] = key.split(",").map(Number) as [number, number];
      return { x, y, height };
    }),
    [map.elevation]
  );
  const edges = useMemo(() => cliffEdges(map), [map]);
  const ramp = useMemo(
    () => (rampDrag ? planRamp(map, rampDrag.start, rampDrag.end, rampWidth) : null),
    [map, rampDrag, rampWidth]
  );

  if (cells.length === 0 && !editing) return null;

  const hoverHeight = hoverCell ? groundHeightAt(map, hoverCell) : 0;
  const hoverNext = hoverCell ? brushResult(mode, hoverHeight, paintHeight) : 0;

  return (
    <g className="elevation-layer" aria-hidden="true">
      {cells.map(({ x, y, height }) => (
        <rect key={`h-${x}-${y}`} x={x} y={y} width="1" height="1" className="elevation-cell" style={{ fill: heightFill(height) }} />
      ))}

      {edges.map((edge, index) => (
        <line key={`edge-${index}`} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} className="cliff-edge" />
      ))}

      {editing
        ? cells.map(({ x, y, height }) => (
          <text key={`t-${x}-${y}`} x={x + 0.5} y={y + 0.5} className="elevation-label">{height}</text>
        ))
        : null}

      {editing && paintStroke
        ? paintStroke.map((cell) => (
          <g key={`p-${cell.x}-${cell.y}`} className="elevation-paint-preview">
            <rect x={cell.x} y={cell.y} width="1" height="1" />
            <text x={cell.x + 0.5} y={cell.y + 0.5} className="elevation-label preview">
              {brushResult(mode, groundHeightAt(map, cell), paintHeight)}
            </text>
          </g>
        ))
        : null}

      {editing && ramp && ramp.cells.length > 0
        ? (
          <g className={`ramp-preview ${ramp.walkable ? "walkable" : "steep"}`}>
            {ramp.cells.map(({ cell, height }) => (
              <g key={`r-${cell.x}-${cell.y}`}>
                <rect x={cell.x} y={cell.y} width="1" height="1" />
                <text x={cell.x + 0.5} y={cell.y + 0.5} className="elevation-label preview">{height}</text>
              </g>
            ))}
            {rampDrag ? (
              <text
                x={(Math.min(...ramp.cells.map((entry) => entry.cell.x)) + Math.max(...ramp.cells.map((entry) => entry.cell.x)) + 1) / 2}
                y={Math.min(...ramp.cells.map((entry) => entry.cell.y)) - 0.18}
                className="ramp-summary"
              >
                {ramp.walkable
                  ? `Ramp ${feetLabel(ramp.lowHeight)} → ${feetLabel(ramp.highHeight)} over ${ramp.squaresSpanned + 1} squares`
                  : `Too steep to walk: ${ramp.steepestStep} ft steps (max ${MAX_STEP_HEIGHT_FT}) — needs ${ramp.squaresNeeded} squares`}
              </text>
            ) : null}
          </g>
        )
        : null}

      {editing && hoverCell && !rampDrag && !paintStroke ? (
        <g className="elevation-hover">
          <rect x={hoverCell.x} y={hoverCell.y} width="1" height="1" />
          <text x={hoverCell.x + 0.5} y={hoverCell.y - 0.18} className="elevation-hover-label">
            {mode === "ramp"
              ? `${feetLabel(hoverHeight)} — drag to the other end`
              : hoverNext === hoverHeight ? feetLabel(hoverHeight) : `${feetLabel(hoverHeight)} → ${feetLabel(hoverNext)}`}
          </text>
        </g>
      ) : null}
    </g>
  );
}
