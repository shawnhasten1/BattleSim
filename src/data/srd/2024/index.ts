import type { Catalog } from "@/lib/character-builder/catalog";
import { SRD_2024_BACKGROUNDS } from "./backgrounds";
import { BARBARIAN, BERSERKER } from "./classes/barbarian";
import { CHAMPION, FIGHTER } from "./classes/fighter";
import { MONK, OPEN_HAND } from "./classes/monk";
import { ROGUE, THIEF } from "./classes/rogue";
import { SRD_2024_FEATS } from "./feats";

/**
 * The bundled 2024 catalog (SRD 5.2): what the character builder builds from. Read-only: the builder clones whatever it
 * puts on an actor. See PC_BUILDER_PLAN.md; `COVERAGE.md` says what each feature does in the simulator.
 */
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

export const SRD_2024_CATALOG: Catalog = freeze({
  classes: [BARBARIAN, FIGHTER, MONK, ROGUE],
  subclasses: [BERSERKER, CHAMPION, OPEN_HAND, THIEF],
  feats: SRD_2024_FEATS,
  backgrounds: SRD_2024_BACKGROUNDS,
  species: []
});
