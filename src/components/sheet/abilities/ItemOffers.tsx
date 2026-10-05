"use client";

import type { CreatureDefinition } from "@/engine";
import { srdItemOffers } from "@/lib/ability-editor/item-offers";
import { useEncounterStore } from "@/store/encounter-store";
import styles from "./abilities.module.css";

/**
 * Items carried for reference (an Open5e import) that the library has a simulated version of: each offered the SRD's,
 * never swapped by itself. Taking one keeps the item's place, its pool and how many there are. One edit, undoable.
 */
export function ItemOffers({ definition }: { definition: CreatureDefinition }) {
  const swapInSrdItem = useEncounterStore((s) => s.swapInSrdItem);
  const offers = srdItemOffers(definition);
  if (!offers.length) return null;
  return (
    <div className={styles.upcastOffers}>
      <ul className={styles.upcastOfferList} aria-label="SRD items offered">
        {offers.map((offer) => (
          <li key={offer.itemId}>
            <span>
              {offer.name}{offer.from ? ` (${offer.from})` : ""} is carried for reference. {offer.text}
            </span>{" "}
            <button
              type="button" className={styles.linkBtn} aria-label={`Use the SRD's simulated item for ${offer.name}${offer.from ? ` (${offer.from})` : ""}`}
              onClick={() => swapInSrdItem(definition.id, offer.itemId, offer.srdId)}
            >
              Use it
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
