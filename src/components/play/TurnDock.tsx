"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { actionProblem, findActionDefinition, getDefinition, getExecutableActions, type EncounterSnapshot, type MovePreview, type UtilityActionDefinition } from "@/engine";
import { makePlayMove, usePlayMovePlan, type PlayMoveView } from "@/hooks/usePlayMove";
import { useEncounterStore } from "@/store/encounter-store";
import { usePlayUiStore } from "@/store/play-ui-store";
import styles from "./play.module.css";

/** The actions about moving, in the order they're offered. */
const MOVE_ACTIONS: UtilityActionDefinition["mode"][] = ["dash", "disengage", "dodge", "escape"];
const MODE_LABEL: Partial<Record<UtilityActionDefinition["mode"], string>> = { dash: "Dash", disengage: "Disengage", dodge: "Dodge", escape: "Escape" };
const ALTITUDE_STEP = 5;

/** What a move sets off, in words: the opportunity attacks it draws and the hazards on the way. */
export function moveWarnings(board: EncounterSnapshot, preview: MovePreview): string[] {
  const attacks = preview.opportunityAttacks.map((threat) => {
    const reactor = board.combatants.find((combatant) => combatant.id === threat.reactorId);
    const weapon = reactor ? findActionDefinition(getDefinition(board, reactor), threat.actionId)?.name : undefined;
    return `${reactor?.displayName ?? "Someone"}${weapon ? ` (${weapon})` : ""}`;
  });
  const hazards = [...new Set(preview.hazards.map((hazard) => hazard.name))];
  return [
    ...(attacks.length ? [`Opportunity ${attacks.length === 1 ? "attack" : "attacks"} from ${listOf(attacks)}.`] : []),
    ...(hazards.length ? [`On the way: ${listOf(hazards)}.`] : [])
  ];
}

function listOf(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The bottom of the map on a person's turn: the creature, what's left of its turn (action, bonus action, reaction,
 * movement), the height it flies at, the stops planned, and the actions about moving — Dash, Disengage, Dodge, and
 * Escape while it's grappled. The hotbar grows from this (Phase 5).
 */
export function TurnDock({ move }: { move?: PlayMoveView | null }) {
  const plan = usePlayMovePlan();
  const encounter = useEncounterStore((state) => state.encounter);
  const playCommand = useEncounterStore((state) => state.playCommand);
  const setAltitude = usePlayUiStore((state) => state.setAltitude);
  const popWaypoint = usePlayUiStore((state) => state.popWaypoint);
  const clearPlan = usePlayUiStore((state) => state.clearPlan);
  if (!plan) return null;

  const { actor } = plan;
  const definition = getDefinition(encounter, actor);
  const economy = actor.actionEconomy ?? { action: true, bonus: true, reaction: true };
  const preview = move?.plan.planKey === plan.planKey ? move.preview : null;
  const afterFeet = preview?.reachable ? preview.remainingFeet : plan.leftFeet;
  const share = (feet: number) => `${plan.totalFeet > 0 ? Math.min(100, Math.max(0, (feet / plan.totalFeet) * 100)) : 0}%`;
  const altitudeNow = actor.altitude ?? 0;
  const altitudeNext = plan.altitude ?? altitudeNow;
  const grappled = (actor.conditions ?? []).some((condition) => condition.hold);
  const actions = getExecutableActions(definition)
    .filter((action): action is UtilityActionDefinition => action.kind === "utility" && MOVE_ACTIONS.includes(action.mode))
    .filter((action) => action.mode !== "escape" || grappled)
    .sort((a, b) => MOVE_ACTIONS.indexOf(a.mode) - MOVE_ACTIONS.indexOf(b.mode) || Number(a.actionType === "bonus") - Number(b.actionType === "bonus"));
  const stops = plan.waypoints.length > 0
    ? `${plan.waypoints.length} ${plan.waypoints.length === 1 ? "stop" : "stops"} planned. Esc or right-click takes back the last.`
    : "Click a square to move there. Shift-click to stop on the way.";
  const warnings = preview && !preview.problem ? moveWarnings(encounter, preview) : [];
  const hint = preview?.problem ?? [...warnings, ...(warnings.length && plan.waypoints.length === 0 ? [] : [stops])].join(" ");

  return (
    <section className={styles.dock} aria-label={`${actor.displayName}'s turn`}>
      <div className={styles.dockWho}>
        <strong>{actor.displayName}</strong>
        <span>{`HP ${actor.currentHp}/${definition.maxHp}${actor.tempHp ? ` +${actor.tempHp}` : ""} · AC ${definition.armorClass}`}</span>
      </div>
      <div className={styles.dockEconomy} role="list" aria-label="What's left of the turn">
        <span role="listitem" data-spent={economy.action === false} title={economy.action === false ? "Action used" : "Action"}>Action</span>
        <span role="listitem" data-spent={economy.bonus === false} title={economy.bonus === false ? "Bonus action used" : "Bonus action"}>Bonus</span>
        <span role="listitem" data-spent={economy.reaction === false} title={economy.reaction === false ? "Reaction used" : "Reaction"}>Reaction</span>
      </div>
      <div className={styles.dockMove}>
        <div className={styles.moveBar} aria-hidden="true">
          <i style={{ width: share(plan.leftFeet) }} data-part="cost" />
          <i style={{ width: share(afterFeet) }} data-part="left" />
        </div>
        <span className={styles.moveText}>
          <span>{`${plan.leftFeet} of ${plan.totalFeet} ft`}</span>
          {actor.turnFlags?.dashed ? <em>Dashed</em> : null}
          {actor.turnFlags?.disengaged ? <em>Disengaged</em> : null}
        </span>
        {plan.flies ? (
          <span className={styles.altitude} role="group" aria-label="Height to fly at">
            <button type="button" aria-label="Lower" disabled={altitudeNext <= 0} onClick={() => setAltitude(plan.planKey, Math.max(0, altitudeNext - ALTITUDE_STEP))}>
              <ChevronDown size={13} />
            </button>
            <span>{altitudeNext === altitudeNow ? `${altitudeNow} ft up` : `${altitudeNow} → ${altitudeNext} ft`}</span>
            <button type="button" aria-label="Higher" onClick={() => setAltitude(plan.planKey, altitudeNext + ALTITUDE_STEP)}>
              <ChevronUp size={13} />
            </button>
            {altitudeNext !== altitudeNow ? (
              <button type="button" className={styles.dockLink} onClick={() => makePlayMove(actor.position)}>
                {altitudeNext > altitudeNow ? "Rise here" : altitudeNext === 0 ? "Land here" : "Drop here"}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className={styles.dockActions}>
        {actions.map((action) => {
          const problem = actionProblem(encounter, actor.id, action.id);
          return (
            <button
              key={action.id}
              type="button"
              className={styles.button}
              disabled={Boolean(problem)}
              title={problem ?? action.name}
              onClick={() => playCommand({ kind: "use", actorId: actor.id, actionId: action.id })}
            >
              {MODE_LABEL[action.mode] ?? action.name}
              {action.actionType === "bonus" ? <small>bonus</small> : null}
            </button>
          );
        })}
      </div>
      <p className={styles.dockHint} data-problem={Boolean(preview?.problem)} data-warning={warnings.length > 0}>
        <span>{hint}</span>
        {plan.waypoints.length > 0 ? (
          <>
            <button type="button" className={styles.dockLink} onClick={() => popWaypoint(plan.planKey)}>Take back the last stop</button>
            <button type="button" className={styles.dockLink} onClick={clearPlan} aria-label="Clear the plan"><X size={12} /></button>
          </>
        ) : null}
      </p>
    </section>
  );
}
