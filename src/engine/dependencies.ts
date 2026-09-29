import { getExecutableActions } from "./combat";
import type { CreatureDefinition, EncounterSnapshot, Id } from "./types";

/**
 * A creature can name other creatures: what it summons, the shapes it changes into, the shape it starts in. The
 * engine only ever sees `snapshot.definitions`, so every creature named here has to be embedded in the encounter
 * (even with no token on the map) or the summon/transform fails at the table.
 */
export function collectDependencies(definition: CreatureDefinition): Id[] {
  const ids = new Set<Id>();
  if (definition.defaultActiveForm) ids.add(definition.defaultActiveForm);
  // Actions a not-yet-enabled optional rule would grant count too: switching it on later must find its targets.
  const optionalGrants = [...(definition.features ?? []), ...(definition.traits ?? [])].flatMap((feature) => feature.grantedActions ?? []);
  for (const action of [...getExecutableActions(definition), ...optionalGrants]) {
    if (action.kind === "summon") for (const option of action.options) ids.add(option.definitionId);
    if (action.kind === "transform") for (const form of action.forms) ids.add(form.definitionId);
  }
  ids.delete(definition.id);
  return [...ids];
}

/** Ids the encounter's creatures name but the encounter doesn't contain (recursively through what it does contain). */
export function missingDependencies(snapshot: Pick<EncounterSnapshot, "definitions">): Id[] {
  const have = new Set(snapshot.definitions.map((definition) => definition.id));
  const missing = new Set<Id>();
  for (const definition of snapshot.definitions) {
    for (const id of collectDependencies(definition)) if (!have.has(id)) missing.add(id);
  }
  return [...missing];
}

/**
 * A chain of summons that leads back to itself (A summons B, B summons A), as the ids along the loop, or
 * `undefined`. Transform forms are not followed: a shapechanger's forms name each other by design. The runtime
 * has its own guards (a generation cap and an encounter-wide combatant cap); this is the authoring-time check.
 */
export function findSummonCycle(definitions: CreatureDefinition[], rootId: Id): Id[] | undefined {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const summonTargets = (id: Id): Id[] => {
    const definition = byId.get(id);
    if (!definition) return [];
    return [...new Set(getExecutableActions(definition).flatMap((action) => (action.kind === "summon" ? action.options.map((option) => option.definitionId) : [])))];
  };
  const walk = (id: Id, path: Id[]): Id[] | undefined => {
    if (path.includes(id)) return [...path.slice(path.indexOf(id)), id];
    for (const next of summonTargets(id)) {
      const loop = walk(next, [...path, id]);
      if (loop) return loop;
    }
    return undefined;
  };
  return walk(rootId, []);
}
