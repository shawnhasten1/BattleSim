"use client";

import { findActionDefinition, getDefinition, type EncounterSnapshot, type SwingRequest } from "@/engine";
import { swingWeapon } from "@/hooks/usePlayAim";
import { useEncounterStore } from "@/store/encounter-store";
import { swingFor, usePlayUiStore } from "@/store/play-ui-store";
import styles from "./play.module.css";

/**
 * A multiattack's next swing, asked of a person (PLAY_MODE_PLAN.md §2.4): which attack to swing with (where the
 * routine allows a choice), then a creature clicked on the map — or first a square to step to, with the movement left.
 * It sits at the bottom of the map, where the hotbar was, so the board stays in view.
 */
export function SwingCard({ request, board }: { request: SwingRequest; board: EncounterSnapshot }) {
  const answerPrompt = useEncounterStore((state) => state.answerPrompt);
  const aim = usePlayUiStore((state) => swingFor(state, request.key));
  const setSwing = usePlayUiStore((state) => state.setSwing);
  const note = usePlayUiStore((state) => state.note);
  const attacker = board.combatants.find((combatant) => combatant.id === request.attackerId);
  if (!attacker) return null;
  const definition = getDefinition(board, attacker);
  const nameOf = (id: string) => findActionDefinition(definition, id)?.name ?? id;
  const routine = nameOf(request.actionId);
  const weapon = swingWeapon(request, aim);
  const previous = request.previous;
  const previousTarget = previous ? board.combatants.find((combatant) => combatant.id === previous.targetId) : undefined;

  return (
    <section className={styles.swingCard} role="dialog" aria-label={`${routine}: swing ${request.swing} of ${request.of}`}>
      <span className={styles.promptWho}>{`${attacker.displayName} · ${routine}`}</span>
      <p className={styles.promptTitle}>
        {`Swing ${request.swing} of ${request.of}`}
        {previous && previousTarget ? <small>{` · the last one ${previous.hit ? "hit" : "missed"} ${previousTarget.displayName}`}</small> : null}
      </p>
      {request.candidates.length > 1 ? (
        <div className={styles.segmented} role="radiogroup" aria-label="Swing with">
          {request.candidates.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={id === weapon}
              onClick={() => setSwing({ requestKey: request.key, actionId: id, moveTo: aim?.moveTo })}
            >
              {nameOf(id)}
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.promptAsk}>{`With ${nameOf(weapon)}.`}</p>
      )}
      <p className={styles.promptAsk}>
        {aim?.moveTo
          ? "Stepping to the square marked first. Click a creature to swing at it; Esc takes the step back."
          : "Click a creature to swing at it, or a square to step to first."}
      </p>
      {note ? <p className={styles.promptNote} role="alert">{note}</p> : null}
      <div className={styles.buttons}>
        <button type="button" className={styles.button} onClick={() => answerPrompt({ kind: "multiattack-swing", skip: true })}>
          Skip this swing
        </button>
      </div>
    </section>
  );
}
