"use client";

import { useMemo } from "react";
import {
  effectiveFaction,
  findActionDefinition,
  getDefinition,
  getExecutableActions,
  previewMove,
  sizeFootprint,
  spatialDistanceToPoint,
  type AttackActionDefinition,
  type CombatantState,
  type EncounterSnapshot,
  type Id,
  type Point,
  type SwingRequest
} from "@/engine";
import type { HotbarButton, HotbarVariant } from "@/lib/play/hotbar";
import { targetLine, type TargetLine } from "@/lib/play/targeting";
import { useEncounterStore } from "@/store/encounter-store";
import { armedFor, swingFor, usePlayUiStore, type SwingAim } from "@/store/play-ui-store";
import { combatantAt, planKeyOf, swingQuestion, useSwingQuestion, yourTurnActorId } from "./usePlayMove";

/* ─── Aiming at creatures in Play (PLAY_MODE_PLAN.md §2.4) ─────────────────────────
 * An ability armed from the hotbar, or a multiattack's next swing, is aimed by clicking creatures on the map. While
 * aiming, the map shows the ability's range, rings the creatures it can be aimed at, and over each creature says what
 * it would do there — the chance to hit or to fail the save, the damage — or why it can't, from the engine's previews.
 */

export interface AimView {
  /** The board aimed on: the live one, or the one between a multiattack's swings (with the attacker where it plans to step). */
  board: EncounterSnapshot;
  actorId: Id;
  /** The ability, or the swing's attack. */
  actionId: Id;
  name: string;
  range: number;
  /** Squares within range, for the tint. */
  rangeCells: Point[];
  /** Each creature it could be aimed at, and what it would do there. */
  lines: Map<Id, TargetLine>;
  /** The creatures on the side it's meant for (foes for an attack, friends for a heal), which get a ring. */
  meantFor: Set<Id>;
  /** Creatures picked so far, and how many it takes. */
  picked: Id[];
  count: number;
  repeat: boolean;
  /** The creature under the cursor. */
  hovered: { combatant: CombatantState; line: TargetLine } | null;
  mode: "ability" | "swing";
  /** A swing's step planned before it: the route and where it ends. */
  step?: { cells: Point[]; to: Point; footprint: number };
}

/** The attack a swing is made with: the one chosen, else the one the swing before used (if it can be used again), else the first. */
export function swingWeapon(request: SwingRequest, aim: SwingAim | null): Id {
  if (aim?.actionId && request.candidates.includes(aim.actionId)) return aim.actionId;
  const previous = request.previous?.actionId;
  return previous && request.candidates.includes(previous) ? previous : request.candidates[0]!;
}

/** The board with `combatantId` standing on `position`: what a swing would be made from after stepping there. */
function standingAt(board: EncounterSnapshot, combatantId: Id, position: Point): EncounterSnapshot {
  return { ...board, combatants: board.combatants.map((combatant) => (combatant.id === combatantId ? { ...combatant, position: { ...position } } : combatant)) };
}

/** How far an attack reaches: a melee attack's reach, a ranged one's long range. */
function attackRange(action: AttackActionDefinition): number {
  return action.attackType === "melee" ? action.reach ?? action.range : action.longRange ?? action.range;
}

/** What's being aimed and at whom, or null when nothing is. */
export function usePlayAimView(): AimView | null {
  const actorId = useEncounterStore(yourTurnActorId);
  const encounter = useEncounterStore((state) => state.encounter);
  const logLength = useEncounterStore((state) => state.log.length);
  const selectTool = useEncounterStore((state) => state.tool === "select" && state.replayIndex == null);
  const swingAsked = useSwingQuestion();
  const armed = usePlayUiStore((state) => (actorId ? armedFor(state, planKeyOf(actorId, logLength)) : null));
  const swingAim = usePlayUiStore((state) => (swingAsked ? swingFor(state, swingAsked.request.key) : null));
  const hover = usePlayUiStore((state) => state.hover);

  const base = useMemo(() => {
    if (!selectTool) return null;
    if (actorId && armed && (armed.aim.kind === "creatures" || armed.aim.kind === "routine")) {
      const actor = encounter.combatants.find((combatant) => combatant.id === actorId);
      const action = actor ? getExecutableActions(getDefinition(encounter, actor)).find((candidate) => candidate.id === armed.actionId) : undefined;
      return {
        board: encounter,
        actorId,
        actionId: armed.actionId,
        name: action?.name ?? armed.actionId,
        range: armed.aim.range,
        picked: armed.picked,
        count: armed.aim.kind === "creatures" ? armed.aim.count : 1,
        repeat: armed.aim.kind === "creatures" && armed.aim.repeat,
        who: armed.aim.kind === "creatures" ? armed.aim.who : "foes",
        mode: "ability" as const
      };
    }
    if (swingAsked) {
      const { request } = swingAsked;
      const board = swingAim?.moveTo ? standingAt(swingAsked.board, request.attackerId, swingAim.moveTo) : swingAsked.board;
      const attacker = board.combatants.find((combatant) => combatant.id === request.attackerId);
      const weaponId = swingWeapon(request, swingAim);
      const weapon = attacker ? findActionDefinition(getDefinition(board, attacker), weaponId) : undefined;
      const step = swingAim?.moveTo && attacker
        ? { cells: previewMove(swingAsked.board, request.attackerId, [swingAim.moveTo]).cells, to: swingAim.moveTo, footprint: sizeFootprint(getDefinition(board, attacker).size) }
        : undefined;
      return {
        board,
        actorId: request.attackerId,
        actionId: weaponId,
        name: weapon?.name ?? weaponId,
        range: weapon?.kind === "attack" ? attackRange(weapon) : 5,
        picked: [] as Id[],
        count: 1,
        repeat: false,
        who: "foes" as const,
        mode: "swing" as const,
        step
      };
    }
    return null;
  }, [selectTool, actorId, armed, swingAsked, swingAim, encounter]);

  const rangeCells = useMemo((): Point[] => {
    if (!base) return [];
    const actor = base.board.combatants.find((combatant) => combatant.id === base.actorId);
    if (!actor) return [];
    const { width, height } = base.board.map.grid;
    const cells: Point[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (spatialDistanceToPoint(base.board, actor, { x, y }) <= base.range) cells.push({ x, y });
      }
    }
    return cells;
  }, [base]);

  const lines = useMemo((): Map<Id, TargetLine> => {
    const out = new Map<Id, TargetLine>();
    if (!base) return out;
    for (const combatant of base.board.combatants) {
      if (combatant.state !== "active" && combatant.state !== "downed") continue;
      // A foe's ability isn't aimed at itself; a friend's can be (a heal, Bless).
      if (combatant.id === base.actorId && base.who === "foes") continue;
      out.set(combatant.id, targetLine(base.board, base.actorId, base.actionId, combatant.id));
    }
    return out;
  }, [base]);

  const meantFor = useMemo((): Set<Id> => {
    const out = new Set<Id>();
    if (!base) return out;
    const actor = base.board.combatants.find((combatant) => combatant.id === base.actorId);
    if (!actor) return out;
    const side = effectiveFaction(base.board, actor);
    for (const combatant of base.board.combatants) {
      const friend = effectiveFaction(base.board, combatant) === side;
      if (base.who === "allies" ? friend : !friend) out.add(combatant.id);
    }
    return out;
  }, [base]);

  const hovered = useMemo(() => {
    if (!base || !hover) return null;
    const combatant = combatantAt(base.board, hover);
    const line = combatant ? lines.get(combatant.id) : undefined;
    return combatant && line ? { combatant, line } : null;
  }, [base, hover, lines]);

  return base ? { ...base, rangeCells, lines, meantFor, hovered } : null;
}

/** Use an ability now, aimed at `targetIds`; whatever was armed is put away. */
function commitUse(actorId: Id, actionId: Id, byHand: boolean, targetIds: Id[] = []): void {
  const store = useEncounterStore.getState();
  usePlayUiStore.getState().disarm();
  store.playCommand(byHand
    ? { kind: "use-by-hand", actorId, actionId, ...(targetIds.length ? { targetIds } : {}) }
    : { kind: "use", actorId, actionId, ...(targetIds.length ? { target: { targetIds } } : {}) });
}

/**
 * A hotbar button (or one of its variants) pressed: used at once if it needs no aiming (or is used by hand), else armed
 * for aiming on the map. Pressing what's already armed puts it away.
 */
export function pressHotbar(button: HotbarButton, variant: HotbarVariant = button.variants[button.defaultVariant]!): void {
  const state = useEncounterStore.getState();
  const actorId = yourTurnActorId(state);
  if (!actorId || variant.problem) return;
  const ui = usePlayUiStore.getState();
  const planKey = planKeyOf(actorId, state.log.length);
  const armed = armedFor(ui, planKey);
  if (armed?.actionId === variant.actionId) {
    ui.disarm();
    return;
  }
  if (button.automation === "by-hand" || variant.aim.kind === "none") {
    commitUse(actorId, variant.actionId, button.automation === "by-hand");
    return;
  }
  if (variant.aim.kind === "creatures" || variant.aim.kind === "routine") {
    ui.arm({ planKey, key: button.key, actionId: variant.actionId, aim: variant.aim });
    return;
  }
  ui.setNote(`${button.name} is aimed at a place or a choice: that comes with the next step of Play`);
}

/** Enter while aiming at several creatures: use it on those picked so far. */
export function finishAiming(): boolean {
  const state = useEncounterStore.getState();
  const actorId = yourTurnActorId(state);
  const armed = actorId ? armedFor(usePlayUiStore.getState(), planKeyOf(actorId, state.log.length)) : null;
  if (!actorId || !armed || armed.picked.length === 0) return false;
  commitUse(actorId, armed.actionId, false, armed.picked);
  return true;
}

/** Esc or right-click while aiming: take back the last pick, or the step planned before a swing, or put the ability away. */
export function backOutOfAiming(): boolean {
  const state = useEncounterStore.getState();
  const ui = usePlayUiStore.getState();
  const swing = swingQuestion(state);
  if (swing) {
    const aim = swingFor(ui, swing.request.key);
    if (aim?.moveTo) {
      ui.setSwing({ ...aim, moveTo: undefined });
      return true;
    }
    return false;
  }
  const actorId = yourTurnActorId(state);
  const armed = actorId ? armedFor(ui, planKeyOf(actorId, state.log.length)) : null;
  if (!armed) return false;
  if (!ui.unpick()) ui.disarm();
  return true;
}

/**
 * A creature clicked while aiming. For a swing: swing at it (from the square planned, if one was). For an armed
 * ability: pick it, and use the ability once it has all it takes (one creature, or the last of several). A creature it
 * can't be aimed at is refused with the reason. False when nothing is being aimed.
 */
export function aimAtCreature(combatantId: Id): boolean {
  const state = useEncounterStore.getState();
  const ui = usePlayUiStore.getState();
  const swing = swingQuestion(state);
  if (swing) {
    const aim = swingFor(ui, swing.request.key);
    const weapon = swingWeapon(swing.request, aim);
    const board = aim?.moveTo ? standingAt(swing.board, swing.request.attackerId, aim.moveTo) : swing.board;
    const line = targetLine(board, swing.request.attackerId, weapon, combatantId);
    if (!line.ok) {
      ui.setNote(line.text);
      return true;
    }
    ui.setSwing(null);
    state.answerPrompt({ kind: "multiattack-swing", targetId: combatantId, actionId: weapon, ...(aim?.moveTo ? { moveTo: aim.moveTo } : {}) });
    return true;
  }
  const actorId = yourTurnActorId(state);
  const armed = actorId ? armedFor(ui, planKeyOf(actorId, state.log.length)) : null;
  if (!actorId || !armed) return false;
  const line = targetLine(state.encounter, actorId, armed.actionId, combatantId);
  if (!line.ok) {
    ui.setNote(line.text);
    return true;
  }
  if (armed.aim.kind === "routine") {
    commitUse(actorId, armed.actionId, false, [combatantId]);
    return true;
  }
  ui.pick(combatantId);
  const after = armedFor(usePlayUiStore.getState(), planKeyOf(actorId, state.log.length));
  if (after && armed.aim.kind === "creatures" && after.picked.length >= armed.aim.count) {
    commitUse(actorId, after.actionId, false, after.picked);
  }
  return true;
}

/** A square clicked while a swing is being aimed: step there first (if it can), then swing. */
export function planSwingStep(square: Point, reachable: boolean, problem?: string): boolean {
  const state = useEncounterStore.getState();
  const swing = swingQuestion(state);
  if (!swing) return false;
  const ui = usePlayUiStore.getState();
  if (!reachable) {
    ui.setNote(problem ?? "It can't get there");
    return true;
  }
  const aim = swingFor(ui, swing.request.key);
  ui.setSwing({ requestKey: swing.request.key, actionId: aim?.actionId, moveTo: square });
  return true;
}

/** The token footprint of a creature on a board, in squares. */
export function footprintOf(board: EncounterSnapshot, combatant: CombatantState): number {
  return sizeFootprint(getDefinition(board, combatant).size);
}
