import { isSrdMonsterId } from "@/data/srd/monsters";
import type { EncounterSnapshot } from "@/engine";

/**
 * The bench (ACTORS_TAB_PLAN.md, Phase 2): a sheet opened for a creature with no token in the scene puts the creature
 * into the scene's definitions, with no token, as a summon's creature rides along. The sheet edits it with the same
 * store actions as any other, undo included. The bench is the store's `benchIds`: never saved with the scene, and
 * emptied when its window closes or the scene changes.
 */

/** Whether a token in `encounter` shows the creature, in its own shape or as a form. */
export function hasToken(encounter: Pick<EncounterSnapshot, "combatants">, definitionId: string): boolean {
  return encounter.combatants.some((combatant) => combatant.definitionId === definitionId || combatant.activeForm?.definitionId === definitionId);
}

/** The scene as it's saved: without the creatures on the bench (a token placed takes one off it first). */
export function withoutBench<T extends Pick<EncounterSnapshot, "combatants" | "definitions">>(encounter: T, benchIds: readonly string[]): T {
  if (benchIds.length === 0) return encounter;
  const bench = new Set(benchIds);
  const definitions = encounter.definitions.filter((definition) => !bench.has(definition.id) || hasToken(encounter, definition.id));
  return definitions.length === encounter.definitions.length ? encounter : { ...encounter, definitions };
}

/**
 * A snapshot undo or redo restores, with the bench as it is now. A creature on the bench that the snapshot lacks comes
 * back as `current` has it, so undoing a token's move doesn't close an open sheet. A creature that was benched and
 * whose sheet has closed goes, unless a token shows it there, so undo can't bring back a stale copy (which Phase 1
 * would then save to the library).
 */
export function withBenchKept(
  restored: EncounterSnapshot,
  current: Pick<EncounterSnapshot, "definitions">,
  benchIds: readonly string[],
  closed: ReadonlySet<string>
): EncounterSnapshot {
  if (benchIds.length === 0 && closed.size === 0) return restored;
  const have = new Set(restored.definitions.map((definition) => definition.id));
  const missing = current.definitions.filter((definition) => benchIds.includes(definition.id) && !have.has(definition.id));
  const kept = restored.definitions.filter((definition) => !closed.has(definition.id) || benchIds.includes(definition.id) || hasToken(restored, definition.id));
  if (missing.length === 0 && kept.length === restored.definitions.length) return restored;
  return { ...restored, definitions: [...kept, ...missing] };
}

/** A creature that can't be changed from its sheet: an SRD monster or a shared template, while it's on the bench. */
export function isLockedOnBench(definitionId: string, benchIds: readonly string[], templateIds: readonly string[]): boolean {
  return benchIds.includes(definitionId) && (isSrdMonsterId(definitionId) || templateIds.includes(definitionId));
}

const lockedListeners = new Set<(definitionId: string) => void>();

/** Told when an edit to a locked creature was refused, so its sheet can say why. Returns the unsubscribe. */
export function onLockedEdit(listener: (definitionId: string) => void): () => void {
  lockedListeners.add(listener);
  return () => lockedListeners.delete(listener);
}

export function notifyLockedEdit(definitionId: string) {
  for (const listener of lockedListeners) listener(definitionId);
}
