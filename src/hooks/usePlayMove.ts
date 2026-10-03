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
  type EncounterSnapshot,
  type Id,
  type MovePreview,
  type Point,
  type SwingRequest,
  type TurnOptionRequest
} from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import type { PlaySession } from "@/store/play-slice";
import { armedFor, planFor, swingFor, usePlayUiStore } from "@/store/play-ui-store";

/* ─── Moving by hand in Play (PLAY_MODE_PLAN.md §2.3) ─────────────────────────────
 * On a person's creature's turn the map shows where it can go and what a move costs before it's made: the squares it
 * can reach, and for the square under the cursor the route the engine would take, its cost, the squares that cost
 * more, what goes off on the way and who gets an opportunity attack. Everything comes from `previewMove` and
 * `reachableCells`, the routes `moveCombatant` walks, so what the map shows is what happens. The same goes for a move
 * before a multiattack's next swing, on the board as it stands between swings.
 */

type PlayState = { play: PlaySession | null; tool: string; replayIndex: number | null };

/** Whose turn a person is playing right now: their creature's turn is open, and nothing (a question, a playback) is in the way. */
export function yourTurnActorId(state: { play: PlaySession | null }): string | null {
  const play = state.play;
  if (!play || play.pending || play.playback || play.status.kind !== "your-turn") return null;
  return play.status.actorId;
}

/** The creature a person can move right now by clicking the map: theirs, its turn open, the Select tool in hand. */
export function movingActorId(state: PlayState): string | null {
  if (state.tool !== "select" || state.replayIndex != null) return null;
  return yourTurnActorId(state);
}

/** A multiattack's next swing a person is aiming: its question, and the board it came up on. */
export function swingQuestion(state: { play: PlaySession | null }): { request: SwingRequest; board: EncounterSnapshot } | null {
  const play = state.play;
  if (!play || play.playback || !play.pending || play.pending.request.kind !== "multiattack-swing") return null;
  return { request: play.pending.request, board: play.pending.board };
}

/** A legendary or lair action a person is choosing: its question, and the board it came up on. */
export function turnOptionQuestion(state: { play: PlaySession | null }): { request: TurnOptionRequest; board: EncounterSnapshot } | null {
  const play = state.play;
  const request = play && !play.playback ? play.pending?.request : undefined;
  return request && (request.kind === "legendary-action" || request.kind === "lair-action") ? { request, board: play!.pending!.board } : null;
}

/** `turnOptionQuestion`, for a component: the same object until the question changes. */
export function useTurnOptionQuestion(): { request: TurnOptionRequest; board: EncounterSnapshot } | null {
  const pending = useEncounterStore((state) => (state.play && !state.play.playback ? state.play.pending : undefined));
  return useMemo(() => (pending && (pending.request.kind === "legendary-action" || pending.request.kind === "lair-action")
    ? { request: pending.request, board: pending.board }
    : null), [pending]);
}

/** The plan key of an ability armed to answer a question (a legendary or lair action), rather than on a turn. */
export function questionPlanKey(requestKey: string): string {
  return `question:${requestKey}`;
}

/** `swingQuestion`, for a component: the same object until the question changes. */
export function useSwingQuestion(): { request: SwingRequest; board: EncounterSnapshot } | null {
  const pending = useEncounterStore((state) => (state.play && !state.play.playback ? state.play.pending : undefined));
  return useMemo(() => (pending?.request.kind === "multiattack-swing" ? { request: pending.request, board: pending.board } : null), [pending]);
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

/** The creature standing on `cell`, if any (a big one over any of its squares). */
export function combatantAt(board: EncounterSnapshot, cell: Point, states: CombatantState["state"][] = ["active", "downed"]): CombatantState | undefined {
  return board.combatants.find((combatant) => {
    if (!states.includes(combatant.state)) return false;
    const size = sizeFootprint(getDefinition(board, combatant).size);
    return cell.x >= combatant.position.x && cell.x < combatant.position.x + size && cell.y >= combatant.position.y && cell.y < combatant.position.y + size;
  });
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

/** The creature whose turn a person is playing, and the plan for its next move; null when it isn't a person's turn. */
export function usePlayMovePlan(): PlayMovePlan | null {
  const actorId = useEncounterStore(yourTurnActorId);
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
  /** The board the move is planned on: the live one, or the one between a multiattack's swings. */
  board: EncounterSnapshot;
  actorId: Id;
  planKey: string;
  footprint: number;
  /** Stops planned on the way. */
  waypoints: Point[];
  /** Squares the cursor can be on for a move the creature can make now (each its standing square plus the cursor offset). */
  reach: Point[];
  /** Where the creature would stand for the square pointed at — hovered, or under a dragged token — and that move. */
  destination: Point | null;
  preview: MovePreview | null;
  /** A move before a multiattack's next swing, rather than one of the turn's own. */
  swing: boolean;
}

/**
 * What the map shows of a move being planned: the reachable squares, and the move to the square pointed at. Nothing
 * while an ability is armed (the cursor aims it instead), or over another creature.
 */
export function usePlayMoveView(): PlayMoveView | null {
  const plan = usePlayMovePlan();
  const selectTool = useEncounterStore((state) => state.tool === "select" && state.replayIndex == null);
  const swingAsked = useSwingQuestion();
  const hover = usePlayUiStore((state) => state.hover);
  const dragAnchor = usePlayUiStore((state) => state.dragAnchor);
  const armed = usePlayUiStore((state) => (plan ? armedFor(state, plan.planKey) : null));
  const swingAim = usePlayUiStore((state) => (swingAsked ? swingFor(state, swingAsked.request.key) : null));
  const encounter = useEncounterStore((state) => state.encounter);

  // What's being moved, on which board: the turn's creature, or a swinging one that hasn't picked a square yet.
  const context = useMemo(() => {
    if (!selectTool) return null;
    if (plan && !armed) {
      return { board: encounter, actor: plan.actor, planKey: plan.planKey, footprint: plan.footprint, waypoints: plan.waypoints, altitude: plan.altitude, flies: plan.flies, swing: false };
    }
    if (swingAsked && !swingAim?.moveTo) {
      const actor = swingAsked.board.combatants.find((combatant) => combatant.id === swingAsked.request.attackerId);
      if (!actor) return null;
      return { board: swingAsked.board, actor, planKey: `swing:${swingAsked.request.key}`, footprint: sizeFootprint(getDefinition(swingAsked.board, actor).size), waypoints: [] as Point[], altitude: null, flies: false, swing: true };
    }
    return null;
  }, [selectTool, plan, armed, swingAsked, swingAim, encounter]);

  const reach = useMemo((): Point[] => {
    if (!context) return [];
    const { board, actor } = context;
    // What's left once the stops planned so far, and the climb or drop, are paid for.
    let budget = remainingMovementBudget(board, actor);
    let from = actor.position;
    if (context.waypoints.length > 0) {
      const sofar = previewMove(board, actor.id, context.waypoints);
      if (!sofar.reachable) return [];
      budget -= sofar.cost;
      from = context.waypoints[context.waypoints.length - 1]!;
    }
    if (context.altitude !== null && context.flies) {
      budget -= altitudeMoveCost(board, getDefinition(board, actor), Math.abs(context.altitude - (actor.altitude ?? 0)));
    }
    if (budget < 0) return [];
    const offset = cursorOffset(context.footprint);
    return reachableCells(board, actor.id, { from, budget })
      .filter(({ cell }) => cell.x !== from.x || cell.y !== from.y)
      .map(({ cell }) => ({ x: cell.x + offset, y: cell.y + offset }));
  }, [context]);

  const destination = useMemo((): Point | null => {
    if (!context) return null;
    if (dragAnchor && !context.swing) return dragAnchor;
    if (!hover) return null;
    // Over another creature, the cursor points at it, not at a square to move to.
    const there = combatantAt(context.board, hover, ["active"]);
    if (there && there.id !== context.actor.id) return null;
    return standingSquare(hover, context.footprint, context.board.map.grid);
  }, [context, hover, dragAnchor]);

  const preview = useMemo((): MovePreview | null => {
    if (!context || !destination) return null;
    const { actor } = context;
    // Pointing at where it stands, with nothing planned, isn't a move.
    if (context.waypoints.length === 0 && context.altitude === null && destination.x === actor.position.x && destination.y === actor.position.y) return null;
    return previewMove(context.board, actor.id, [...context.waypoints, destination], context.altitude ?? undefined);
  }, [context, destination]);

  return context
    ? { board: context.board, actorId: context.actor.id, planKey: context.planKey, footprint: context.footprint, waypoints: context.waypoints, reach, destination, preview, swing: context.swing }
    : null;
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
