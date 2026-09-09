"use client";

import type { CombatantState, CreatureDefinition } from "@/engine";
import { tokenVisualsFor } from "@/lib/ui-helpers";
import styles from "./ActorThumbnail.module.css";

interface ActorThumbnailProps {
  definition: CreatureDefinition;
  combatant?: CombatantState;
}

/** Square token/portrait chip: custom art if set, else the name initials. */
export function ActorThumbnail({ definition, combatant }: ActorThumbnailProps) {
  const visuals = tokenVisualsFor(definition, combatant);
  const label = combatant?.displayName ?? definition.name;
  return (
    <div className={styles.thumb} style={{ borderColor: visuals.borderColor ?? undefined }}>
      {visuals.imageUrl ? (
        <img src={visuals.imageUrl} alt="" draggable={false} />
      ) : (
        <span>{label.slice(0, 2)}</span>
      )}
    </div>
  );
}
