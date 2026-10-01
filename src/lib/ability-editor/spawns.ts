/**
 * Summons and shapechanges name other creatures, and the encounter has to contain them for the ability to work at the
 * table. The library's are fetched while the DM picks them and embedded when the ability is saved (one undo step), and
 * a creature's shapechange is copied onto each of its forms, so a creature that has changed can change again, or back.
 */
import { collectDependencies, findSummonCycle, type CreatureDefinition, type TransformActionDefinition } from "@/engine";
import { isSrdMonsterId, loadSrdMonster } from "@/data/srd/monsters";

/**
 * The library creatures among `ids`, and every creature they name in turn, that `known` doesn't have. Anything else (a
 * scene actor that was deleted) can't be fetched and is left out; the engine reports it when the ability is used.
 */
export async function loadCreatures(ids: readonly string[], known: readonly CreatureDefinition[]): Promise<CreatureDefinition[]> {
  const seen = new Set(known.map((candidate) => candidate.id));
  const loaded: CreatureDefinition[] = [];
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!isSrdMonsterId(id)) continue;
    try {
      const creature = await loadSrdMonster(id);
      if (!creature) continue;
      loaded.push(creature);
      queue.push(...collectDependencies(creature));
    } catch { /* an unloadable chunk just leaves that creature out */ }
  }
  return loaded;
}

/** Every creature `definition` names (what it summons, what it changes into), and what those name, that `known` lacks. */
export function loadDependencies(definition: CreatureDefinition, known: readonly CreatureDefinition[]): Promise<CreatureDefinition[]> {
  return loadCreatures(collectDependencies(definition), [...known, definition]);
}

/** The library creatures `definition` names that neither the scene nor `fetched` has, and that haven't `failed` to load. */
export function creaturesToFetch(definition: CreatureDefinition, scene: readonly CreatureDefinition[], fetched: readonly CreatureDefinition[], failed: readonly string[]): string[] {
  const have = new Set([...scene, ...fetched].map((candidate) => candidate.id));
  return collectDependencies(definition).filter((id) => isSrdMonsterId(id) && !have.has(id) && !failed.includes(id));
}

/** A summon loop that saving `owner` would make (one the scene already has doesn't count): the ids along it. */
export function newSummonLoop(scene: readonly CreatureDefinition[], owner: CreatureDefinition): string[] | undefined {
  if (findSummonCycle([...scene], owner.id)) return undefined;
  const others = scene.filter((candidate) => candidate.id !== owner.id);
  return findSummonCycle([...others, owner], owner.id);
}

/** The shapechanges a creature takes as actions of its own. */
function ownTransforms(definition: CreatureDefinition): TransformActionDefinition[] {
  return [...definition.actions, ...(definition.bonusActions ?? []), ...(definition.reactions ?? [])]
    .filter((action): action is TransformActionDefinition => action.kind === "transform");
}

/**
 * The scene's creatures once `owner` is saved: the ones it names that weren't there (`embed`) are added, and each of
 * its forms has its shapechanges (the same action, by id). Unchanged when there's nothing to do.
 */
export function withSpawnsSettled(scene: CreatureDefinition[], owner: CreatureDefinition, embed: readonly CreatureDefinition[] = []): CreatureDefinition[] {
  const have = new Set(scene.map((candidate) => candidate.id));
  const added = embed.filter((candidate) => !have.has(candidate.id) && candidate.id !== owner.id);
  const all = added.length ? [...scene, ...added] : scene;
  const transforms = ownTransforms(owner);
  if (!transforms.length) return all;
  return all.map((candidate) => {
    if (candidate.id === owner.id) return candidate;
    const mine = transforms.filter((transform) => transform.forms.some((form) => form.definitionId === candidate.id));
    if (!mine.length) return candidate;
    let actions = candidate.actions;
    for (const transform of mine) {
      actions = actions.some((existing) => existing.id === transform.id)
        ? actions.map((existing) => (existing.id === transform.id ? transform : existing))
        : [...actions, transform];
    }
    return { ...candidate, actions };
  });
}
