"use client";

import { Swords, TriangleAlert } from "lucide-react";
import { findActionDefinition, getDefinition, sizeFootprint, type Point } from "@/engine";
import type { PlayMoveView } from "@/hooks/usePlayMove";

/** Size of the warning on a square where something goes off, in grid units. */
const HAZARD_SIZE = 0.36;

/** Roughly how wide a line of the map's bold label text runs, in grid units, at `fontSize`. */
function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58;
}

/** `x` moved in just enough for something `width` wide centred on it to stay on a map `gridWidth` across. */
function keepOnMap(x: number, width: number, gridWidth: number): number {
  const half = width / 2 + 0.05;
  return gridWidth <= width ? gridWidth / 2 : Math.min(Math.max(x, half), gridWidth - half);
}

/**
 * A move being planned in Play, on the ground (in grid units, inside the scene's SVG overlay, under the tokens): the
 * squares the creature can still reach, the route to the square pointed at and where it ends, and a dashed line from
 * each creature that gets an opportunity attack to where it gets it. The marks and labels go above the tokens, in
 * `PlayMoveMarks`.
 */
export function PlayMoveLayer({ view }: { view: PlayMoveView }) {
  const { board, footprint, reach, destination, preview } = view;
  const half = footprint / 2;
  const centre = (cell: Point) => `${cell.x + half},${cell.y + half}`;
  return (
    <g className="play-move" aria-hidden="true">
      {reach.map((cell) => (
        <rect key={`reach-${cell.x}-${cell.y}`} className="play-reach" x={cell.x} y={cell.y} width="1" height="1" />
      ))}
      {preview && preview.cells.length > 1 ? (
        <polyline className={preview.reachable ? "play-path" : "play-path blocked"} points={preview.cells.map(centre).join(" ")} />
      ) : null}
      {destination && preview ? (
        <rect
          className={preview.reachable ? "play-dest" : "play-dest blocked"}
          x={destination.x + 0.05}
          y={destination.y + 0.05}
          width={footprint - 0.1}
          height={footprint - 0.1}
          rx="0.12"
        />
      ) : null}
      {preview?.opportunityAttacks.map((threat) => {
        const reactor = board.combatants.find((combatant) => combatant.id === threat.reactorId);
        if (!reactor) return null;
        const size = sizeFootprint(getDefinition(board, reactor).size);
        const from = { x: reactor.position.x + size / 2, y: reactor.position.y + size / 2 };
        return (
          <g key={`oa-${threat.reactorId}`}>
            <circle className="play-oa-ring" cx={from.x} cy={from.y} r={size / 2 + 0.08} />
            <line className="play-oa-line" x1={from.x} y1={from.y} x2={threat.from.x + half} y2={threat.from.y + half} />
          </g>
        );
      })}
    </g>
  );
}

/**
 * The marks and labels of a move being planned, above the tokens (in its own SVG, over the health bars): the stops
 * planned, the squares on the route that cost more and what goes off there, where each opportunity attack comes and
 * with what, and what the move costs.
 */
export function PlayMoveMarks({ view }: { view: PlayMoveView }) {
  const { board, footprint, waypoints, destination, preview } = view;
  const half = footprint / 2;
  const gridWidth = board.map.grid.width;
  const label = !preview ? ""
    : preview.reachable ? `${preview.costFeet} ft`
      : preview.tooFar ? `${preview.costFeet} ft · too far`
        : "can't go there";
  return (
    <g className="play-move" aria-hidden="true">
      {waypoints.map((waypoint, index) => (
        <g key={`waypoint-${index}`}>
          <circle className="play-waypoint" cx={waypoint.x + half} cy={waypoint.y + half} r="0.2" />
          <text className="play-waypoint-label" x={waypoint.x + half} y={waypoint.y + half}>{index + 1}</text>
        </g>
      ))}
      {preview?.slowed.map(({ cell, multiplier }, index) => (
        <text key={`slowed-${cell.x}-${cell.y}-${index}`} className="play-slowed" x={cell.x + 0.8} y={cell.y + 0.82}>
          ×{Math.round(multiplier * 10) / 10}
        </text>
      ))}
      {preview?.hazards.map(({ cell }, index) => (
        <TriangleAlert
          key={`hazard-${cell.x}-${cell.y}-${index}`}
          x={cell.x + 0.5 - HAZARD_SIZE / 2}
          y={cell.y + 0.5 - HAZARD_SIZE / 2}
          width={HAZARD_SIZE}
          height={HAZARD_SIZE}
          strokeWidth={2.6}
          className="play-hazard"
        />
      ))}
      {preview?.opportunityAttacks.map((threat) => {
        const reactor = board.combatants.find((combatant) => combatant.id === threat.reactorId);
        if (!reactor) return null;
        const definition = getDefinition(board, reactor);
        const size = sizeFootprint(definition.size);
        const weapon = findActionDefinition(definition, threat.actionId)?.name ?? "Opportunity attack";
        // The weapon's name over the creature that swings it (under it, on the top row).
        const width = 0.3 + textWidth(weapon, 0.24);
        const left = keepOnMap(reactor.position.x + size / 2, width, gridWidth) - width / 2;
        const y = reactor.position.y > 0 ? reactor.position.y - 0.18 : reactor.position.y + size + 0.18;
        return (
          <g key={`oa-${threat.reactorId}`}>
            <circle className="play-oa-mark" cx={threat.from.x + half} cy={threat.from.y + half} r="0.3" />
            <Swords x={left} y={y - 0.13} width={0.26} height={0.26} strokeWidth={2.6} className="play-oa-icon" />
            <text className="play-oa-label" x={left + 0.3} y={y}>{weapon}</text>
          </g>
        );
      })}
      {destination && preview ? (
        <text
          className={preview.reachable ? "play-cost" : "play-cost blocked"}
          x={keepOnMap(destination.x + half, textWidth(label, 0.34), gridWidth)}
          y={destination.y + half}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}
