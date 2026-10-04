"use client";

import { Fragment } from "react";
import { controllerOf, getDefinition, LAIR_INITIATIVE } from "@/engine";
import { ActorThumbnail } from "@/components/ActorThumbnail";
import { useDisplayEncounter } from "@/hooks/useDisplayEncounter";
import { hasVanished, useEncounterStore } from "@/store/encounter-store";
import styles from "./play.module.css";

/**
 * The turn order across the top of the map while a fight is played: portraits in initiative order, the current one
 * raised, who plays each (You or AI), their HP, and where the lair acts on initiative 20. Clicking one selects it.
 */
export function TurnBar() {
  const board = useDisplayEncounter();
  const control = useEncounterStore((state) => state.play?.control);
  const selectCombatant = useEncounterStore((state) => state.selectCombatant);
  if (!control) return null;
  const currentId = board.round > 0 ? board.combatants[board.turnIndex]?.id : undefined;
  const hasLair = board.combatants.some((combatant) => combatant.inLair && combatant.state === "active"
    && (getDefinition(board, combatant).lairActions?.length ?? 0) > 0);
  const firstBelow20 = board.combatants.findIndex((combatant) => (combatant.initiative ?? Number.NEGATIVE_INFINITY) < LAIR_INITIATIVE);
  const lairIndex = !hasLair ? -1 : firstBelow20 < 0 ? board.combatants.length : firstBelow20;

  return (
    <nav className={styles.turnBar} aria-label="Turn order">
      {board.combatants.map((combatant, index) => {
        if (hasVanished(combatant)) {
          return index === lairIndex ? <span key={combatant.id} className={styles.lairSlot} title="Lair actions on initiative 20">20 lair</span> : null;
        }
        const definition = getDefinition(board, combatant);
        const controller = controllerOf(board, control, combatant);
        const out = combatant.state !== "active";
        const share = definition.maxHp > 0 ? Math.max(0, Math.min(1, combatant.currentHp / definition.maxHp)) : 0;
        return (
          <Fragment key={combatant.id}>
            {index === lairIndex ? <span className={styles.lairSlot} title="Lair actions on initiative 20">20 lair</span> : null}
            <button
              type="button"
              className={styles.portrait}
              data-current={combatant.id === currentId}
              data-out={out}
              data-faction={combatant.faction}
              onClick={() => selectCombatant(combatant.id)}
              title={`${combatant.displayName} · initiative ${combatant.initiative ?? "—"} · ${combatant.currentHp}/${definition.maxHp} HP · ${controller === "human" ? "you play it" : "the AI plays it"}${out ? ` · ${combatant.state}` : ""}`}
              aria-current={combatant.id === currentId ? "true" : undefined}
            >
              <ActorThumbnail definition={definition} combatant={combatant} />
              <span className={styles.portraitBadge} data-controller={controller}>{controller === "human" ? "YOU" : "AI"}</span>
              <span className={styles.portraitName}>{combatant.displayName}</span>
              <span className={styles.portraitHp} aria-hidden="true"><i style={{ width: `${Math.round(share * 100)}%` }} /></span>
            </button>
          </Fragment>
        );
      })}
      {lairIndex === board.combatants.length ? <span className={styles.lairSlot} title="Lair actions on initiative 20">20 lair</span> : null}
    </nav>
  );
}
