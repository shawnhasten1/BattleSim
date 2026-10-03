"use client";

import type { CombatantState, CreatureDefinition } from "@/engine";
import { tokenVisualsFor } from "@/lib/ui-helpers";
import { useDeviceTokenImages } from "@/store/token-pack-store";
import styles from "./ActorThumbnail.module.css";

interface ActorThumbnailProps {
  /** Only the name, token art and source are needed, so a library index row can stand in for a full definition. */
  definition: Pick<CreatureDefinition, "name" | "tokenVisuals" | "source">;
  combatant?: CombatantState;
}

/** Square token/portrait chip: custom art if set, else an SRD monster's token, else the name initials. */
export function ActorThumbnail({ definition, combatant }: ActorThumbnailProps) {
  const deviceImages = useDeviceTokenImages();
  const visuals = tokenVisualsFor(definition, combatant, deviceImages);
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
