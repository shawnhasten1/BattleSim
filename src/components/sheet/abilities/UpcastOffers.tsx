"use client";

import { useState } from "react";
import type { CreatureDefinition } from "@/engine";
import { srdUpcastOffers, withSrdUpcasts, type UpcastOffer } from "@/lib/ability-editor/upcasting";
import { useEncounterStore } from "@/store/encounter-store";
import styles from "./abilities.module.css";

/**
 * Spells with an SRD spell's name that don't say what a higher slot does, while the SRD's do (a homebrew Blight that
 * never got its extra d8): each offered with the SRD's upcasting, never applied by itself. One edit, undoable.
 */
export function UpcastOffers({ definition }: { definition: CreatureDefinition }) {
  const updateCreatureDefinition = useEncounterStore((s) => s.updateCreatureDefinition);
  const [open, setOpen] = useState(false);
  const offers = srdUpcastOffers(definition);
  if (!offers.length) return null;
  const take = (chosen: UpcastOffer[]) => updateCreatureDefinition(definition.id, { spells: withSrdUpcasts(definition.spells ?? [], chosen) });
  return (
    <div className={styles.upcastOffers}>
      <p className={styles.footnote}>
        {offers.length === 1 ? "1 spell" : `${offers.length} spells`} could get stronger with a higher slot, as the SRD has{" "}
        {offers.length === 1 ? "it" : "them"}.{" "}
        <button type="button" className={styles.linkBtn} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "Review"}
        </button>
      </p>
      {open ? (
        <ul className={styles.upcastOfferList} aria-label="SRD upcasting offered">
          {offers.map((offer) => (
            <li key={offer.spellId}>
              <span>{offer.text}</span>{" "}
              <button type="button" className={styles.linkBtn} aria-label={`Use the SRD's upcasting for ${offer.name}`} onClick={() => take([offer])}>Use it</button>
            </li>
          ))}
          {offers.length > 1 ? (
            <li>
              <button type="button" className={styles.linkBtn} onClick={() => take(offers)}>Use all {offers.length}</button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
