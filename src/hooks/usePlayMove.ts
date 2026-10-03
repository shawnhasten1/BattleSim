"use client";

import { useMemo } from "react";
import {
  altitudeMoveCost,
  getDefinition,
  movementProfileOf,
  previewMove,
  reachableCells,
  remainingMovementBudget,
  sizeFootprint,
  turnMovementBudget,
  type CombatantState,
  type MovePreview,
  type Point
} from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import type { PlaySession } from "@/store/play-slice";
import { planFor, usePlayUiStore } from "@/store/play-ui-store";

/* ─── Moving by hand in Play (PLAY_MODE_PLAN.md §2.3) ─────────────────────────────
 * On a person's creature's turn the map shows where it can go and what a move costs before it's made: the squares it
 * can reach, and for the square under the cursor the route the engine would take, its cost, the squares that cost
 * more, what goes off on the way and who gets an opportunity attack. Everything comes from `previewMove` and
 * `reachableCells`, the routes `moveCombatant` walks, so what the map shows is what happens.
 */

/** The creature a person can move right now: theirs, its turn open, nothing in the way (a question, a playback), the Select tool in hand. */
export function movingActorId(state: { play: PlaySession | null; tool: string; replayIndex: number | null }): string | null {
  const play = state.play;
  if (!play || play.pending || play.playback || play.status.kind !== "your-turn") return null;
  if (state.tool !== "select" || state.replayIndex != null) return null;
  return play.status.actorId;
}

/** Squares from the cursor back to a creature's top-left square: a big creature stands centred on the cursor. */
export function cursorOffset(footprint: number): number {
  return Math.floor((footprint - 1) / 2);
}

/** The square a creature of `footprint` stands on (its top-left) for a cursor on `cell`, kept on the map. */
export function standingSquare(cell: Point, footprint: number, grid: { width: number; height: number }): Point {
  const offset = cursorOffset(footprint);
  return {
    x: Math.min(Math.max(0, cell.x - offset), Math.max(0, grid.width - footprint)),
    y: Math.min(Math.max(0, cell.y - offset), Math.max(0, grid.height - footprint))
  };
}

/** Which board a plan was made on: the creature, and how long the log was. */
export function planKeyOf(actorId: string, logLength: number): string {
  return `${actorId}:${logLength}`;
}

function feet(squares: number, perSquare: number): number {
  return Math.round(squares * perSquare * 10) / 10;
}

export interface PlayMovePlan {
  actor: CombatantState;
  planKey: string;
  footprint: number;
  /** Stops planned on the way. */
  waypoints: Point[];
  /** The height set for after the next move; null keeps the one it has. */
  altitude: number | null;
  flies: boolean;
  /** The turn's whole movement, and what's left of it, in feet. */
  totalFeet: number;
  leftFeet: number;
}

/** The creature being moved and the plan for its next move, or null when nothing can be moved by hand. */
export function usePlayMovePlan(): PlayMovePlan | null {
  const actorId = useEncounterStore(movingActorId);
  const encounter = useEncounterStore((state) => state.encounter);
  const logLength = useEncounterStore((state) => state.log.length);
  const storedKey = usePlayUiStore((state) => state.planKey);
  const storedWaypoints = usePlayUiStore((state) => state.waypoints);
  const storedAltitude = usePlayUiStore((state) => state.altitude);

  return useMemo(() => {
    if (!actorId) return null;
    const actor = encounter.combatants.find((combatant) => combatant.id === actorId);
    if (!actor) return null;
    const definition = getDefinition(encounter, actor);
    const planKey = planKeyOf(actorId, logLength);
    const plan = planFor({ planKey: storedKey, waypoints: storedWaypoints, altitude: storedAltitude }, planKey);
    const per = encounter.map.grid.distancePerSquare;
    return {
      actor,
      planKey,
      footprint: sizeFootprint(definition.size),
      waypoints: plan.waypoints,
      altitude: plan.altitude,
      flies: Boolean(movementProfileOf(definition).fly),
      totalFeet: feet(turnMovementBudget(encounter, actor), per),
      leftFeet: feet(remainingMovementBudget(encounter, actor), per)
    };
  }, [actorId, encounter, logLength, storedKey, storedWaypoints, storedAltitude]);
}

export interface PlayMoveView {
  plan: PlayMovePlan;
  /** Squares the cursor can be on for a move the creature can make now (each its standing square plus the cursor offset). */
  reach: Point[];
  /** Where the creature would stand for the square pointed at — hovered, or under a dragged token — and that move. */
  destination: Point | null;
  preview: MovePreview | null;
}

/** What the map shows of a move being planned: the reachable squares, and the move to the square pointed at. */
export function usePlayMoveView(): PlayMoveView | null {
  const plan = usePlayMovePlan();
  const encounter = useEncounterStore((state) => state.encounter);
  const hover = usePlayUiStore((state) => state.hover);
  const dragAnchor = usePlayUiStore((state) => state.dragAnchor);

  const reach = useMemo((): Point[] => {
    if (!plan) return [];
    const { actor } = plan;
    // What's left once the stops planned so far, and the climb or drop, are paid for.
    let budget = remainingMovementBudget(encounter, actor);
    let from = actor.position;
    if (plan.waypoints.length > 0) {
      const sofar = previewMove(encounter, actor.id, plan.waypoints);
      if (!sofar.reachable) return [];
      budget -= sofar.cost;
      from = plan.waypoints[plan.waypoints.length - 1]!;
    }
    if (plan.altitude !== null && plan.flies) {
      budget -= altitudeMoveCost(encounter, getDefinition(encounter, actor), Math.abs(plan.altitude - (actor.altitude ?? 0)));
    }
    if (budget < 0) return [];
    const offset = cursorOffset(plan.footprint);
    return reachableCells(encounter, actor.id, { from, budget })
      .filter(({ cell }) => cell.x !== from.x || cell.y !== from.y)
      .map(({ cell }) => ({ x: cell.x + offset, y: cell.y + offset }));
  }, [plan, encounter]);

  const destination = useMemo((): Point | null => {
    if (!plan) return null;
    if (dragAnchor) return dragAnchor;
    return hover ? standingSquare(hover, plan.footprint, encounter.map.grid) : null;
  }, [plan, hover, dragAnchor, encounter.map.grid]);

  const preview = useMemo((): MovePreview | null => {
    if (!plan || !destination) return null;
    const { actor } = plan;
    // Pointing at where it stands, with nothing planned, isn't a move.
    if (plan.waypoints.length === 0 && plan.altitude === null && destination.x === actor.position.x && destination.y === actor.position.y) return null;
    return previewMove(encounter, actor.id, [...plan.waypoints, destination], plan.altitude ?? undefined);
  }, [plan, destination, encounter]);

  return plan ? { plan, reach, destination, preview } : null;
}

/**
 * Make the planned move, through its stops, to `destination` (the square the creature will stand on). Spends the plan
 * once the move is made; a move refused (too far, no way through) leaves it, with the reason shown.
 */
export function makePlayMove(destination: Point): void {
  const state = useEncounterStore.getState();
  const actorId = movingActorId(state);
  if (!actorId) return;
  const plan = planFor(usePlayUiStore.getState(), planKeyOf(actorId, state.log.length));
  const before = state.log.length;
  state.playCommand({
    kind: "move",
    actorId,
    waypoints: [...plan.waypoints, destination],
    ...(plan.altitude !== null ? { altitude: plan.altitude } : {})
  });
  const after = useEncounterStore.getState();
  if (after.log.length !== before || after.play?.pending) usePlayUiStore.getState().clearPlan();
}
