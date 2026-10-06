"use client";

import type { CombatantState, CreatureDefinition } from "@/engine";
import { tokenVisualsFor } from "@/lib/ui-helpers";
import { useDeviceTokenImages } from "@/store/token-pack-store";
import styles from "./codex.module.css";

/** A gilt corner flourish for the hero panel: a curling stroke ending in an ember bead. */
export function Filigree({ corner }: { corner: "top-left" | "bottom-right" }) {
  return (
    <svg className={`${styles.filigree} ${corner === "top-left" ? styles.filigreeTopLeft : styles.filigreeBottomRight}`} viewBox="0 0 60 60" aria-hidden="true">
      <path d="M4 56 C6 34 18 16 52 6" />
      <path d="M14 46 C20 40 26 38 32 39" />
      <path d="M22 30 C28 22 34 20 40 21" />
      <path d="M4 56 C10 52 12 46 10 40" />
      <circle cx="52" cy="6" r="2.4" />
    </svg>
  );
}

/**
 * The token's portrait in a gilded ring with twelve ticks, like an initiative dial (the Faerie Codex's fairy ring, made
 * to fit a battle sheet). The ring flares once whenever it mounts; the Codex remounts it when the name's first letter
 * changes, as the original did for its initial.
 */
export function PortraitRing({ definition, combatant }: { definition: CreatureDefinition; combatant: CombatantState }) {
  const deviceImages = useDeviceTokenImages();
  const visuals = tokenVisualsFor(definition, combatant, deviceImages);
  const initials = (combatant.displayName || definition.name).slice(0, 2);
  const ticks = Array.from({ length: 12 }, (_, index) => index * 30);
  return (
    <div className={`${styles.ring} ${styles.flare}`} aria-hidden="true">
      <svg className={styles.ringTicks} viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="56" />
        {ticks.map((angle) => (
          <line key={angle} x1="60" y1="2" x2="60" y2={angle % 90 === 0 ? 11 : 8} transform={`rotate(${angle} 60 60)`} />
        ))}
      </svg>
      <div className={styles.portrait} style={visuals.borderColor ? { boxShadow: `0 0 0 2px ${visuals.borderColor}, 0 0 26px var(--gild-glow)` } : undefined}>
        {visuals.imageUrl ? <img src={visuals.imageUrl} alt="" draggable={false} /> : <span>{initials}</span>}
      </div>
    </div>
  );
}

/** A heater-shield crest behind an ability score (the original's leaf). */
export function Crest() {
  return (
    <svg viewBox="0 0 100 112" aria-hidden="true">
      <path className={styles.crestOutline} d="M8 6 H92 V52 C92 80 72 98 50 108 C28 98 8 80 8 52 Z" />
      <path className={styles.crestInner} d="M16 14 H84 V52 C84 75 68 90 50 99 C32 90 16 75 16 52 Z" />
    </svg>
  );
}
