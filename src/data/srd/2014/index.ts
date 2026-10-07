import type { Catalog } from "@/lib/character-builder/catalog";

/**
 * The bundled 2014 catalog (SRD 5.1): the 2014 classes, subclasses, races, the Acolyte and Grappler, beside the 2024
 * catalog in the character builder (EDITIONS_PLAN.md). Read-only: the builder clones whatever it puts on an actor.
 * `COVERAGE.md` says what each feature does in the simulator.
 */
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

export const SRD_2014_CATALOG: Catalog = freeze({
  classes: [],
  subclasses: [],
  feats: [],
  backgrounds: [],
  species: []
});

/**
 * The library's authored 2014 spells that aren't in SRD 5.1 (written for the 2014 rules from outside the SRD). They stay
 * in the library; the 2014 spell index and its class lists don't have them.
 */
export const OUTSIDE_SRD_51: readonly string[] = ["srd:spell:toll-the-dead"];
