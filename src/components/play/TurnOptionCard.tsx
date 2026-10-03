"use client";

import { findActionDefinition, getDefinition, type EncounterSnapshot, type TurnOptionRequest } from "@/engine";
import { actionStatblock } from "@/lib/statblock";
import { pickTurnOption } from "@/hooks/usePlayAim";
import { questionPlanKey } from "@/hooks/usePlayMove";
import { useEncounterStore } from "@/store/encounter-store";
import { armedFor, usePlayUiStore } from "@/store/play-ui-store";
import styles from "./play.module.css";

/**
 * A legendary action after another creature's turn, or a lair action on initiative 20, for a creature a person plays
 * (PLAY_MODE_PLAN.md §2.6): every option it can afford with its cost and a line, and Pass. Picking one that needs
 * aiming aims it on the map (Esc comes back here); one the engine can't run is taken by hand, its cost spent and
 * logged. It sits at the bottom of the map, so the board stays in view.
 */
export function TurnOptionCard({ request, board }: { request: TurnOptionRequest; board: EncounterSnapshot }) {
  const answerPrompt = useEncounterStore((state) => state.answerPrompt);
  const armed = usePlayUiStore((state) => armedFor(state, questionPlanKey(request.key)));
  const disarm = usePlayUiStore((state) => state.disarm);
  const note = usePlayUiStore((state) => state.note);
  const creature = board.combatants.find((combatant) => combatant.id === request.combatantId);
  if (!creature) return null;
  const definition = getDefinition(board, creature);
  const name = (id: string | undefined) => board.combatants.find((combatant) => combatant.id === id)?.displayName ?? "someone";
  const legendary = request.kind === "legendary-action";
  const title = legendary
    ? `A legendary action after ${name(request.afterId)}'s turn (${request.pointsLeft} left)`
    : "Its lair acts, on initiative 20";
  const lineOf = (actionId: string, byHand?: boolean) => {
    if (byHand) {
      const index = Number(actionId.slice(actionId.lastIndexOf(":") + 1));
      const ref = definition.legendary?.actions[index];
      return ref?.description?.split(/(?<=\.)\s/)[0] ?? "Taken by hand: you apply what it does.";
    }
    const action = findActionDefinition(definition, actionId);
    // Its cost in points is already beside its name.
    return action ? actionStatblock(action, definition).short.replace(/ · \d+ legendary points?$/, "") : undefined;
  };
  const picked = armed ? request.options.find((option) => option.actionId === armed.actionId) : undefined;

  return (
    <section className={styles.swingCard} role="dialog" aria-label={`${creature.displayName}: ${legendary ? "legendary action" : "lair action"}`}>
      <span className={styles.promptWho}>{creature.displayName}</span>
      <p className={styles.promptTitle}>{title}</p>
      {picked ? (
        <>
          <p className={styles.promptAsk}>{`Aim ${picked.name} on the map. Esc goes back.`}</p>
          {note ? <p className={styles.promptNote} role="alert">{note}</p> : null}
          <div className={styles.buttons}>
            <button type="button" className={styles.button} onClick={disarm}>Back</button>
          </div>
        </>
      ) : (
        <div className={styles.promptOptions}>
          {request.options.map((option) => (
            <button key={option.actionId} type="button" className={styles.button} onClick={() => pickTurnOption(option)}>
              <span>
                {option.name}
                {legendary ? <small>{` · ${option.cost} ${option.cost === 1 ? "action" : "actions"}`}</small> : null}
                {option.byHand ? <small className={styles.hotDot} data-automation="by-hand">by hand</small> : null}
              </span>
              {lineOf(option.actionId, option.byHand) ? <small>{lineOf(option.actionId, option.byHand)}</small> : null}
            </button>
          ))}
          <button type="button" className={styles.primary} onClick={() => answerPrompt({ kind: request.kind, pick: null })}>Pass</button>
        </div>
      )}
    </section>
  );
}
