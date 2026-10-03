"use client";

import { getDefinition, sizeFootprint } from "@/engine";
import type { AimView } from "@/hooks/usePlayAim";

/**
 * An ability or a swing being aimed, on the ground (in grid units, inside the scene's SVG overlay, under the tokens):
 * the squares within its range.
 */
export function PlayAimLayer({ view }: { view: AimView }) {
  const step = view.step;
  const half = (step?.footprint ?? 1) / 2;
  return (
    <g className="play-aim" aria-hidden="true">
      {view.rangeCells.map((cell) => (
        <rect key={`range-${cell.x}-${cell.y}`} className="play-range" x={cell.x} y={cell.y} width="1" height="1" />
      ))}
      {step && step.cells.length > 1 ? (
        <>
          <polyline className="play-path" points={step.cells.map((cell) => `${cell.x + half},${cell.y + half}`).join(" ")} />
          <rect className="play-dest" x={step.to.x + 0.05} y={step.to.y + 0.05} width={step.footprint - 0.1} height={step.footprint - 0.1} rx="0.12" />
        </>
      ) : null}
    </g>
  );
}

/**
 * What's being aimed, above the tokens: a ring round each creature it can be aimed at (brighter under the cursor), and
 * a badge on each one picked with how many times.
 */
export function PlayAimMarks({ view }: { view: AimView }) {
  const counts = new Map<string, number>();
  for (const id of view.picked) counts.set(id, (counts.get(id) ?? 0) + 1);
  return (
    <g className="play-aim" aria-hidden="true">
      {view.board.combatants.map((combatant) => {
        const line = view.lines.get(combatant.id);
        if (!line) return null;
        const size = sizeFootprint(getDefinition(view.board, combatant).size);
        const cx = combatant.position.x + size / 2;
        const cy = combatant.position.y + size / 2;
        const hovered = view.hovered?.combatant.id === combatant.id;
        const times = counts.get(combatant.id) ?? 0;
        if (!hovered && !times && (!line.ok || !view.meantFor.has(combatant.id))) return null;
        return (
          <g key={combatant.id}>
            <circle className={`play-target${line.ok ? "" : " blocked"}${hovered ? " hovered" : ""}`} cx={cx} cy={cy} r={size / 2 + 0.08} />
            {times > 0 ? (
              <g>
                <circle className="play-pick" cx={combatant.position.x + size - 0.12} cy={combatant.position.y + 0.12} r="0.2" />
                <text className="play-pick-label" x={combatant.position.x + size - 0.12} y={combatant.position.y + 0.12}>
                  {view.repeat ? `×${times}` : view.picked.indexOf(combatant.id) + 1}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/** What it would do to the creature under the cursor (or why it can't), beside its token. In battlemap pixels. */
export function PlayAimTooltip({ view, cellSize }: { view: AimView; cellSize: number }) {
  const hovered = view.hovered;
  if (!hovered) return null;
  const { combatant, line } = hovered;
  const size = sizeFootprint(getDefinition(view.board, combatant).size);
  const right = (combatant.position.x + size) * cellSize + 8;
  // On the map's right-hand side it goes to the token's left instead.
  const flip = combatant.position.x + size > view.board.map.grid.width - 4;
  return (
    <div
      className="play-aim-tooltip"
      data-ok={line.ok}
      role="tooltip"
      style={flip
        ? { left: combatant.position.x * cellSize - 8, top: combatant.position.y * cellSize, transform: "translateX(-100%)" }
        : { left: right, top: combatant.position.y * cellSize }}
    >
      <strong>{`${view.name} → ${combatant.displayName}`}</strong>
      <span>{line.text}</span>
    </div>
  );
}
