"use client";

import { useMemo } from "react";
import {
  cellsInArea,
  effectiveFaction,
  findActionDefinition,
  getDefinition,
  getExecutableActions,
  previewArea,
  previewHealingArea,
  previewMove,
  sizeFootprint,
  spatialDistance,
  spatialDistanceToPoint,
  swingProblem,
  targetProblem,
  zoneMoveProblem,
  type AttackActionDefinition,
  type CombatantState,
  type EncounterSnapshot,
  type Id,
  type Point,
  type SwingRequest,
  type UseTarget
} from "@/engine";
import { aimForAction, type Aim, type HotbarButton, type HotbarVariant } from "@/lib/play/hotbar";
import { targetLine, type TargetLine } from "@/lib/play/targeting";
import { useEncounterStore } from "@/store/encounter-store";
import { armedFor, swingFor, usePlayUiStore, type ArmedAbility, type SwingAim } from "@/store/play-ui-store";
import {
  combatantAt,
  planKeyOf,
  questionPlanKey,
  standingSquare,
  swingQuestion,
  turnOptionQuestion,
  useSwingQuestion,
  useTurnOptionQuestion,
  yourTurnActorId
} from "./usePlayMove";
import type { TurnOption } from "@/engine";

/* ─── Aiming in Play (PLAY_MODE_PLAN.md §2.4) ───────────────────────────────────────
 * An ability armed from the hotbar, or a multiattack's next swing, is aimed on the map. At creatures: the map shows
 * the ability's range, rings the creatures it can be aimed at, and over each says what it would do there — the chance
 * to hit or to fail the save, the damage — or why it can't. An area follows the cursor and shows who it catches, foes
 * and friends alike, with each one's chance to fail. A teleport shows where it lands; a zone, where it moves to. All of
 * it comes from the engine's previews, so what the map shows is what happens.
 */

/** An area where the cursor puts it: the squares, and who it catches. */
export interface AreaShape {
  cells: Point[];
  origin: Point;
  /** Foes and friends it catches, with what it does to each ("62%": the chance to fail the save; "+9": the healing). */
  caught: Array<{ id: Id; hostile: boolean; label: string }>;
  problem?: string;
  /** It settles as a lasting zone without hitting anyone now. */
  settlesOnly?: boolean;
  heals?: boolean;
}

/** Where a teleport lands its mover (its squares), or the squares a moved zone would cover; and why it can't. */
export interface PlaceShape {
  cells: Point[];
  problem?: string;
}

export interface AimView {
  /** The board aimed on: the live one, or the one between a multiattack's swings (with the attacker where it plans to step). */
  board: EncounterSnapshot;
  actorId: Id;
  /** The ability, or the swing's attack. */
  actionId: Id;
  name: string;
  /** What's being aimed: creatures (or a routine's first target), an area, a place, a zone, or a swing. */
  kind: Aim["kind"] | "swing";
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
  area?: AreaShape;
  place?: PlaceShape;
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

const percent = (chance: number) => `${Math.round(chance * 100)}%`;

/** The middle square of a creature: where an area clicked on it is put. */
function middleOf(board: EncounterSnapshot, combatant: CombatantState): Point {
  const size = sizeFootprint(getDefinition(board, combatant).size);
  const half = Math.floor((size - 1) / 2);
  return { x: combatant.position.x + half, y: combatant.position.y + half };
}

/** An area put at `at` for `actionId`: a saving-throw area, or a healing one. */
export function areaShapeFor(board: EncounterSnapshot, actorId: Id, actionId: Id, at: Point): AreaShape | undefined {
  const actor = board.combatants.find((combatant) => combatant.id === actorId);
  const action = actor ? findActionDefinition(getDefinition(board, actor), actionId) : undefined;
  if (!action) return undefined;
  if (action.kind === "area-save") {
    const preview = previewArea(board, actorId, actionId, at);
    return {
      cells: preview.cells,
      origin: preview.origin,
      problem: preview.problem,
      settlesOnly: preview.settlesOnly,
      caught: preview.caught.map((caught) => ({ id: caught.id, hostile: caught.hostile, label: preview.settlesOnly ? "in it" : percent(caught.failChance) }))
    };
  }
  if (action.kind === "healing" && action.targeting?.target === "area") {
    const preview = previewHealingArea(board, actorId, actionId, at);
    return {
      cells: preview.cells,
      origin: preview.origin,
      problem: preview.problem,
      heals: true,
      caught: preview.healed.map((id) => ({ id, hostile: false, label: `+${Math.round(preview.healing)}` }))
    };
  }
  return undefined;
}

/** Where a teleport puts its mover for a cursor on `cell`, and why it can't. */
function placeShapeFor(board: EncounterSnapshot, actorId: Id, armed: ArmedAbility, cell: Point): PlaceShape & { destination: Point; moverId: Id } {
  const moverId = armed.aim.kind === "place" && armed.aim.moves === "other" ? armed.picked[0] ?? actorId : actorId;
  const mover = board.combatants.find((combatant) => combatant.id === moverId)!;
  const size = sizeFootprint(getDefinition(board, mover).size);
  const destination = standingSquare(cell, size, board.map.grid);
  const cells: Point[] = [];
  for (let dy = 0; dy < size; dy += 1) for (let dx = 0; dx < size; dx += 1) cells.push({ x: destination.x + dx, y: destination.y + dy });
  const target: UseTarget = moverId === actorId ? { destination } : { destination, moverId };
  return { cells, destination, moverId, problem: targetProblem(board, actorId, armed.actionId, target) };
}

/** What's being aimed and at whom, or null when nothing is. */
export function usePlayAimView(): AimView | null {
  const actorId = useEncounterStore(yourTurnActorId);
  const encounter = useEncounterStore((state) => state.encounter);
  const logLength = useEncounterStore((state) => state.log.length);
  const selectTool = useEncounterStore((state) => state.tool === "select" && state.replayIndex == null);
  const swingAsked = useSwingQuestion();
  const turnAsked = useTurnOptionQuestion();
  const turnArmed = usePlayUiStore((state) => (turnAsked ? armedFor(state, questionPlanKey(turnAsked.request.key)) : null));
  const yourArmed = usePlayUiStore((state) => (actorId ? armedFor(state, planKeyOf(actorId, logLength)) : null));
  // A legendary or lair action being aimed answers its question, on the board it came up on; otherwise it's the turn's.
  const armed = turnArmed ?? yourArmed;
  const aimingFor = useMemo(
    () => (turnAsked && turnArmed ? { actorId: turnAsked.request.combatantId, board: turnAsked.board } : actorId ? { actorId, board: encounter } : null),
    [turnAsked, turnArmed, actorId, encounter]
  );
  const swingAim = usePlayUiStore((state) => (swingAsked ? swingFor(state, swingAsked.request.key) : null));
  const hover = usePlayUiStore((state) => state.hover);

  const base = useMemo(() => {
    if (!selectTool) return null;
    if (aimingFor && armed && armed.aim.kind !== "none" && armed.aim.kind !== "option") {
      const { actorId: aimerId, board } = aimingFor;
      const actor = board.combatants.find((combatant) => combatant.id === aimerId);
      const action = actor ? getExecutableActions(getDefinition(board, actor)).find((candidate) => candidate.id === armed.actionId) : undefined;
      const aim = armed.aim;
      const zone = aim.kind === "zone" ? board.activeZones?.find((candidate) => candidate.id === aim.zoneId) : undefined;
      const range = aim.kind === "creatures" || aim.kind === "routine" ? aim.range
        : aim.kind === "zone" ? aim.maxFeet
          : action && "areaTargeting" in action && action.areaTargeting?.range != null ? action.areaTargeting.range
            : action && action.kind === "area-save" && action.targeting?.range != null ? action.targeting.range
              : action && "range" in action ? action.range : 0;
      return {
        board,
        actorId: aimerId,
        actionId: armed.actionId,
        name: zone ? `Move ${zone.name}` : action?.name ?? armed.actionId,
        kind: aim.kind,
        range,
        picked: armed.picked,
        count: aim.kind === "creatures" ? aim.count : 1,
        repeat: aim.kind === "creatures" && aim.repeat,
        who: aim.kind === "creatures" ? aim.who : aim.kind === "place" ? "any" as const : "foes" as const,
        mode: "ability" as const,
        armed
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
        kind: "swing" as const,
        range: weapon?.kind === "attack" ? attackRange(weapon) : 5,
        picked: [] as Id[],
        count: 1,
        repeat: false,
        who: "foes" as const,
        mode: "swing" as const,
        step,
        armed: null
      };
    }
    return null;
  }, [selectTool, aimingFor, armed, swingAsked, swingAim]);

  const rangeCells = useMemo((): Point[] => {
    if (!base) return [];
    const actor = base.board.combatants.find((combatant) => combatant.id === base.actorId);
    if (!actor) return [];
    const { width, height } = base.board.map.grid;
    // A zone moves from where it is, as far as it can go; anything else reaches from its user.
    const zoneAim = base.armed?.aim.kind === "zone" ? base.armed.aim : undefined;
    const zone = zoneAim ? base.board.activeZones?.find((candidate) => candidate.id === zoneAim.zoneId) : undefined;
    const per = base.board.map.grid.distancePerSquare;
    const cells: Point[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const within = zone
          ? Math.hypot(x - zone.origin.x, y - zone.origin.y) * per <= base.range + 1e-6
          : spatialDistanceToPoint(base.board, actor, { x, y }) <= base.range;
        if (within) cells.push({ x, y });
      }
    }
    return cells;
  }, [base]);

  const lines = useMemo((): Map<Id, TargetLine> => {
    const out = new Map<Id, TargetLine>();
    if (!base) return out;
    const actor = base.board.combatants.find((combatant) => combatant.id === base.actorId);
    if (!actor) return out;
    if (base.kind === "creatures" || base.kind === "routine" || base.kind === "swing") {
      const swing = base.armed?.swing;
      for (const combatant of base.board.combatants) {
        if (combatant.state !== "active" && combatant.state !== "downed") continue;
        // A foe's ability isn't aimed at itself; a friend's can be (a heal, Bless).
        if (combatant.id === base.actorId && base.who === "foes") continue;
        const line = targetLine(base.board, base.actorId, base.actionId, combatant.id);
        // A swing of a routine: its rule too (a tyrannosaurus's tail not at the bite's target).
        const ruled = line.ok && swing ? swingProblem(base.board, base.actorId, base.actionId, { targetIds: [combatant.id] }, swing.routineId) : undefined;
        out.set(combatant.id, ruled ? { ok: false, text: ruled } : line);
      }
    } else if (base.kind === "place" && base.armed?.aim.kind === "place" && base.armed.aim.moves === "other" && base.picked.length === 0) {
      // A teleport that moves someone else: first, who (within its range).
      for (const combatant of base.board.combatants) {
        if (combatant.state !== "active") continue;
        const distance = spatialDistance(base.board, actor, combatant);
        out.set(combatant.id, distance <= base.range
          ? { ok: true, text: `Move ${combatant.displayName}` }
          : { ok: false, text: `${combatant.displayName} is ${distance} ft. away, beyond ${base.range} ft. range` });
      }
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
      if (base.who === "any" || (base.who === "allies" ? friend : !friend)) out.add(combatant.id);
    }
    return out;
  }, [base]);

  // An area, a teleport's landing or a zone's new spot, where the cursor is (an area from itself doesn't need it).
  const shapes = useMemo((): { area?: AreaShape; place?: PlaceShape } => {
    if (!base?.armed) return {};
    const actor = base.board.combatants.find((combatant) => combatant.id === base.actorId);
    if (!actor) return {};
    const aim = base.armed.aim;
    if (aim.kind === "area") {
      const area = areaShapeFor(base.board, base.actorId, base.actionId, hover ?? actor.position);
      return area ? { area } : {};
    }
    if (aim.kind === "place" && hover && (aim.moves === "self" || base.picked.length > 0)) {
      const { cells, problem } = placeShapeFor(base.board, base.actorId, base.armed, hover);
      return { place: { cells, problem } };
    }
    if (aim.kind === "zone" && hover) {
      const zone = base.board.activeZones?.find((candidate) => candidate.id === aim.zoneId);
      if (!zone) return {};
      return { place: { cells: cellsInArea(base.board.map, hover, zone.area), problem: zoneMoveProblem(base.board, actor, zone.id, hover) } };
    }
    return {};
  }, [base, hover]);

  const hovered = useMemo(() => {
    if (!base || !hover) return null;
    const combatant = combatantAt(base.board, hover);
    const line = combatant ? lines.get(combatant.id) : undefined;
    return combatant && line ? { combatant, line } : null;
  }, [base, hover, lines]);

  if (!base) return null;
  const { armed: _armed, who: _who, ...view } = base;
  return { ...view, rangeCells, lines, meantFor, hovered, ...shapes };
}

/** Use an ability now, aimed as `target` says (a swing of a routine as one); whatever was armed is put away. */
function commitUse(actorId: Id, actionId: Id, byHand: boolean, target: UseTarget = {}, swing?: { routineId?: Id }): void {
  const store = useEncounterStore.getState();
  usePlayUiStore.getState().disarm();
  const targetIds = target.targetIds ?? [];
  const aimed = Object.keys(target).length ? { target } : {};
  store.playCommand(byHand
    ? { kind: "use-by-hand", actorId, actionId, ...(targetIds.length ? { targetIds } : {}) }
    : swing
      ? { kind: "swing", actorId, actionId, ...aimed, ...(swing.routineId ? { routineId: swing.routineId } : {}) }
      : { kind: "use", actorId, actionId, ...aimed });
}

/**
 * What's armed and being aimed right now: an ability on a person's turn, or a legendary or lair action picked from a
 * question — who aims it, on which board, and what using it does (the turn's command, or the question's answer).
 */
function armedNow(): { actorId: Id; armed: ArmedAbility; board: EncounterSnapshot; commit: (target: UseTarget) => void } | null {
  const state = useEncounterStore.getState();
  const ui = usePlayUiStore.getState();
  const question = turnOptionQuestion(state);
  if (question) {
    const armed = armedFor(ui, questionPlanKey(question.request.key));
    if (!armed) return null;
    return {
      actorId: question.request.combatantId,
      armed,
      board: question.board,
      commit: (target) => {
        usePlayUiStore.getState().disarm();
        state.answerPrompt({ kind: question.request.kind, pick: { actionId: armed.actionId, ...target } });
      }
    };
  }
  const actorId = yourTurnActorId(state);
  const armed = actorId ? armedFor(ui, planKeyOf(actorId, state.log.length)) : null;
  return actorId && armed ? { actorId, armed, board: state.encounter, commit: (target) => commitUse(actorId, armed.actionId, false, target, armed.swing) } : null;
}

/**
 * One of a legendary or lair action's options picked from its question: taken at once if it needs no aiming (or is
 * taken by hand), else armed to be aimed on the map — Esc comes back to the question.
 */
export function pickTurnOption(option: TurnOption): void {
  const state = useEncounterStore.getState();
  const question = turnOptionQuestion(state);
  if (!question) return;
  const aim = option.byHand ? { kind: "none" as const } : aimForAction(question.board, question.request.combatantId, option.actionId);
  if (aim.kind === "none") {
    state.answerPrompt({ kind: question.request.kind, pick: { actionId: option.actionId } });
    return;
  }
  usePlayUiStore.getState().arm({ planKey: questionPlanKey(question.request.key), key: option.actionId, actionId: option.actionId, aim });
}

/**
 * A hotbar button (or one of its variants) pressed: used at once if it needs no aiming (or is used by hand), else armed
 * for aiming on the map (or, for a choice, in the hotbar). Pressing what's already armed puts it away.
 */
export function pressHotbar(button: HotbarButton, variant: HotbarVariant = button.variants[button.defaultVariant]!): void {
  const state = useEncounterStore.getState();
  const actorId = yourTurnActorId(state);
  if (!actorId || variant.problem) return;
  const ui = usePlayUiStore.getState();
  const planKey = planKeyOf(actorId, state.log.length);
  const armed = armedFor(ui, planKey);
  // The same press again (Flurry's first strike and Unarmed Strike are one attack: told apart by the routine).
  if (armed?.actionId === variant.actionId && armed.swing?.routineId === variant.swing?.routineId) {
    ui.disarm();
    return;
  }
  if (button.automation === "by-hand" || variant.aim.kind === "none") {
    commitUse(actorId, variant.actionId, button.automation === "by-hand", {}, variant.swing);
    return;
  }
  ui.arm({ planKey, key: button.key, actionId: variant.actionId, aim: variant.aim, ...(variant.swing ? { swing: variant.swing } : {}) });
}

/** One of the choices of the armed ability (a creature to summon, a form to take): use it with that. */
export function chooseOption(optionId: Id): boolean {
  const now = armedNow();
  if (!now || now.armed.aim.kind !== "option") return false;
  now.commit({ optionId });
  return true;
}

/** Enter while aiming at several creatures: use it on those picked so far. */
export function finishAiming(): boolean {
  const now = armedNow();
  if (!now || now.armed.aim.kind !== "creatures" || now.armed.picked.length === 0) return false;
  now.commit({ targetIds: now.armed.picked });
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
  if (!armedNow()) return false;
  if (!ui.unpick()) ui.disarm();
  return true;
}

/**
 * A square clicked while aiming: where an area goes, where a teleport lands, where a zone moves. Refused with the reason
 * when it can't go there. True when aiming took the click (an ability aimed at creatures ignores the ground).
 */
export function aimAtSquare(cell: Point): boolean {
  const now = armedNow();
  if (!now) return false;
  const { actorId, armed, board } = now;
  const state = useEncounterStore.getState();
  const ui = usePlayUiStore.getState();
  switch (armed.aim.kind) {
    case "area": {
      const area = areaShapeFor(board, actorId, armed.actionId, cell);
      if (area?.problem) ui.setNote(area.problem);
      else now.commit({ aim: cell });
      return true;
    }
    case "place": {
      if (armed.aim.moves === "other" && armed.picked.length === 0) {
        ui.setNote("First pick who it moves");
        return true;
      }
      const place = placeShapeFor(board, actorId, armed, cell);
      if (place.problem) ui.setNote(place.problem);
      else now.commit(place.moverId === actorId ? { destination: place.destination } : { destination: place.destination, moverId: place.moverId });
      return true;
    }
    case "zone": {
      const actor = board.combatants.find((combatant) => combatant.id === actorId)!;
      const problem = zoneMoveProblem(board, actor, armed.aim.zoneId, cell);
      if (problem) {
        ui.setNote(problem);
        return true;
      }
      ui.disarm();
      state.playCommand({ kind: "move-zone", actorId, zoneId: armed.aim.zoneId, destination: cell });
      return true;
    }
    default:
      return true;
  }
}

/**
 * A creature clicked while aiming. For a swing: swing at it (from the square planned, if one was). For an ability aimed
 * at creatures: pick it, and use the ability once it has all it takes (one creature, or the last of several). An area
 * or a zone is put on it; a teleport that moves another picks it as the one moved. A creature it can't be aimed at is
 * refused with the reason. False when nothing is being aimed.
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
  const now = armedNow();
  if (!now) return false;
  const { actorId, armed, board } = now;
  const clicked = board.combatants.find((combatant) => combatant.id === combatantId);
  if (!clicked) return true;
  if (armed.aim.kind === "area" || armed.aim.kind === "zone") return aimAtSquare(middleOf(board, clicked));
  if (armed.aim.kind === "place") {
    if (armed.aim.moves === "other" && armed.picked.length === 0) {
      const actor = board.combatants.find((combatant) => combatant.id === actorId)!;
      const action = findActionDefinition(getDefinition(board, actor), armed.actionId);
      const range = action && "range" in action ? action.range : 0;
      const distance = spatialDistance(board, actor, clicked);
      if (clicked.state !== "active" || distance > range) ui.setNote(`${clicked.displayName} is ${distance} ft. away, beyond ${range} ft. range`);
      else ui.setPicked([combatantId]);
      return true;
    }
    ui.setNote(`${clicked.displayName} is there`);
    return true;
  }
  if (armed.aim.kind !== "creatures" && armed.aim.kind !== "routine") return true;
  const line = targetLine(board, actorId, armed.actionId, combatantId);
  // A swing of a routine: its rule too (not at the bite's target; the beak at the tentacles').
  const ruled = line.ok && armed.swing ? swingProblem(board, actorId, armed.actionId, { targetIds: [combatantId] }, armed.swing.routineId) : undefined;
  if (!line.ok || ruled) {
    ui.setNote(ruled ?? line.text);
    return true;
  }
  if (armed.aim.kind === "routine") {
    now.commit({ targetIds: [combatantId] });
    return true;
  }
  ui.pick(combatantId);
  const after = armedFor(usePlayUiStore.getState(), armed.planKey);
  if (after && after.picked.length >= armed.aim.count) {
    now.commit({ targetIds: after.picked });
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
