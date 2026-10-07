import { sizeFootprint, type CreatureDefinition, type EncounterSnapshot } from "@/engine";
import { deepEqual } from "@/lib/deep-equal";

/**
 * Linked library actors (ACTORS_TAB_PLAN.md, Phase 1). A library actor you own is one creature wherever it's used: an
 * edit in any scene is saved to the library, and a scene picks up the library's version when it opens. Shared
 * templates (not yours), SRD monsters and creatures only in a scene aren't linked.
 */

/** The library actors that are yours: the library less the shared templates. */
export function ownedLibraryIds(library: Pick<CreatureDefinition, "id">[], templateIds: readonly string[]): Set<string> {
  const templates = new Set(templateIds);
  return new Set(library.map((definition) => definition.id).filter((id) => !templates.has(id)));
}

/**
 * The library actors an edit changed, to be saved: those in `after` that are yours, aren't the very object they were
 * in `before` (an action leaves an untouched creature as it was), and differ from the library's copy (so an edit put
 * back by undo, or a scene just synced, saves nothing).
 */
export function changedLibraryActors(
  before: readonly CreatureDefinition[],
  after: readonly CreatureDefinition[],
  library: readonly CreatureDefinition[],
  templateIds: readonly string[]
): CreatureDefinition[] {
  if (before === after || library.length === 0) return [];
  const owned = ownedLibraryIds(library as CreatureDefinition[], templateIds);
  const was = new Map(before.map((definition) => [definition.id, definition]));
  const saved = new Map(library.map((definition) => [definition.id, definition]));
  return after.filter((definition) =>
    owned.has(definition.id) && was.get(definition.id) !== definition && !deepEqual(definition, saved.get(definition.id)));
}

/**
 * The scene with each of your library actors in it replaced by the library's version where they differ, skipping
 * `skip` (actors with a save still on its way: the scene's copy is the newer one). Tokens of a creature that grew move
 * back onto the grid; hit points are left to the caller (the store's tokens-at-full-follow rule). The same object when
 * nothing changed.
 */
export function syncLibraryActors(
  encounter: EncounterSnapshot,
  library: readonly CreatureDefinition[],
  templateIds: readonly string[],
  skip: ReadonlySet<string> = new Set()
): EncounterSnapshot {
  if (library.length === 0) return encounter;
  const owned = ownedLibraryIds(library as CreatureDefinition[], templateIds);
  const saved = new Map(library.map((definition) => [definition.id, definition]));
  const grown = new Map<string, number>();
  let changed = false;
  const definitions = encounter.definitions.map((definition) => {
    const latest = saved.get(definition.id);
    if (!latest || !owned.has(definition.id) || skip.has(definition.id) || deepEqual(definition, latest)) return definition;
    changed = true;
    if (latest.size !== definition.size) grown.set(definition.id, sizeFootprint(latest.size));
    return structuredClone(latest);
  });
  if (!changed) return encounter;
  const { width, height } = encounter.map.grid;
  const combatants = grown.size === 0 ? encounter.combatants : encounter.combatants.map((combatant) => {
    const footprint = grown.get(combatant.activeForm?.definitionId ?? combatant.definitionId);
    if (footprint === undefined) return combatant;
    const x = Math.max(0, Math.min(combatant.position.x, width - footprint));
    const y = Math.max(0, Math.min(combatant.position.y, height - footprint));
    return x === combatant.position.x && y === combatant.position.y ? combatant : { ...combatant, position: { x, y } };
  });
  return { ...encounter, definitions, combatants };
}
