/**
 * The SRD's simulated item for one carried for reference (ITEMS_PLAN.md §7): an Open5e Potion of Healing, imported as
 * its text, is offered the library's, which the simulator runs. Offered, never applied by itself, as the SRD's upcasting
 * is; two same-named items from different source documents each get their own offer, and stay apart until it's taken.
 */
import type { CreatureDefinition, ItemDefinition } from "@/engine";
import { SRD_ITEMS, SRD_SPELL_SCROLLS } from "@/data/srd";
import { editionOf } from "@/lib/editions";

export interface ItemOffer {
  itemId: string;
  name: string;
  /** Where the item came from: its source document, for telling same-named items apart. */
  from?: string;
  srdId: string;
  /** "The SRD's Potion of Healing is simulated.", naming its edition when it isn't the item's ("The SRD's 2014 …"). */
  text: string;
}

/** An item's name as the library would file it: "Acid (vial)" and "Vial of Acid" are the same thing. */
export function itemNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((word) => word && word !== "of" && word !== "the" && word !== "a" && word !== "an")
    .sort().join(" ");
}

const SIMULATED = [...SRD_ITEMS, ...SRD_SPELL_SCROLLS].filter((item) => item.automationSupport === "full" || item.automationSupport === "partial");

/** The library item an Open5e reference item could be, by name, when the simulator runs the library's. */
export function srdItemOffer(item: ItemDefinition): ItemOffer | undefined {
  if (item.source?.provider !== "open5e") return undefined;
  if (item.automationSupport !== "manual-only" && item.automationSupport !== "unsupported") return undefined;
  const key = itemNameKey(item.name);
  const twin = SIMULATED.find((candidate) => itemNameKey(candidate.name) === key);
  if (!twin) return undefined;
  // The library's items are the 2014 ones: a 2024 item is offered its 2014 namesake, and the offer says so.
  const edition = editionOf(twin);
  return {
    itemId: item.id,
    name: item.name,
    ...(item.source.documentName || item.source.documentKey ? { from: item.source.documentName ?? item.source.documentKey } : {}),
    srdId: twin.id,
    text: `The SRD's ${edition && edition !== editionOf(item) ? `${edition} ` : ""}${twin.name} is simulated.`
  };
}

/** Every item on the creature the library's simulated item is offered for. */
export function srdItemOffers(definition: Pick<CreatureDefinition, "items">): ItemOffer[] {
  return (definition.items ?? []).flatMap((item) => {
    const offer = srdItemOffer(item);
    return offer ? [offer] : [];
  });
}
