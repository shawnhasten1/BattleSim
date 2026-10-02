import { getExecutableActions, type ActionDefinition, type CombatantState, type CreatureDefinition, type EncounterSnapshot } from "@/engine";
import { isSrdMonsterId } from "@/data/srd/monsters";

/** The tokens showing a creature: those in its form now (a werewolf in hybrid form shows the hybrid). */
export function tokensOf(encounter: Pick<EncounterSnapshot, "combatants">, definitionId: string): CombatantState[] {
  return encounter.combatants.filter((combatant) => (combatant.activeForm?.definitionId ?? combatant.definitionId) === definitionId);
}

/** Where a scene's creature stands with the DM's library: what saving it from the sheet does. */
export type LibraryStatus = "saved" | "template" | "srd" | "scene";

export function libraryStatus(definition: Pick<CreatureDefinition, "id">, library: Pick<CreatureDefinition, "id">[], templateIds: string[]): LibraryStatus {
  if (templateIds.includes(definition.id)) return "template";
  if (library.some((saved) => saved.id === definition.id)) return "saved";
  return isSrdMonsterId(definition.id) ? "srd" : "scene";
}

const LIBRARY_NOTES: Record<LibraryStatus, string> = {
  saved: "Your library copy only changes when you update it (⋯).",
  template: "The template itself never changes: copy it to your library from ⋯.",
  srd: "The SRD monster itself never changes: save a copy to your library from ⋯.",
  scene: "It isn't in your library: save it there from ⋯."
};

/** "Ogre, Goblin 1 and Goblin 2", with a long list cut short. */
function names(tokens: CombatantState[]): string {
  const shown = tokens.slice(0, 6).map((token) => token.displayName);
  const more = tokens.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0] ?? "";
}

/**
 * What the creature tabs change, for their caption: "2 tokens in this scene" or "its only token", and, on hover, which
 * tokens and what happens to the library's copy.
 */
export function creatureScope(encounter: Pick<EncounterSnapshot, "combatants">, definition: Pick<CreatureDefinition, "id" | "name">, status: LibraryStatus) {
  const tokens = tokensOf(encounter, definition.id);
  const reach = tokens.length > 1
    ? `Changes here apply to every ${definition.name} in this scene: ${names(tokens)}.`
    : `${tokens[0]?.displayName ?? "This token"} is the only ${definition.name} in this scene, so changes here reach only it.`;
  return {
    caption: tokens.length > 1 ? `${tokens.length} tokens in this scene` : "its only token",
    help: `${reach} ${LIBRARY_NOTES[status]}`
  };
}

/** Every action a creature can take, with what its optional rules grant (switched on later, they name creatures too). */
function everyAction(definition: CreatureDefinition): ActionDefinition[] {
  const optionalGrants = [...(definition.features ?? []), ...(definition.traits ?? [])].flatMap((feature) => feature.grantedActions ?? []);
  return [...getExecutableActions(definition), ...optionalGrants];
}

/**
 * Why this token can't be made its own creature (the sheet's ⋯ menu), or undefined when it can: it's a shapechanger or
 * one of its forms, which change into each other by id (checked first: a form is shared by every token that takes it,
 * however many show it now); it's already the only token of its creature; or a summon or a shapechange names its
 * creature (its own Summon Mephits, a Balor's Summon Demon), and would go on naming the original.
 */
export function ownCreatureBlock(
  encounter: Pick<EncounterSnapshot, "combatants" | "definitions">,
  combatant: CombatantState,
  definition: CreatureDefinition
): string | undefined {
  const name = definition.name;
  if (combatant.activeForm || definition.formOf || definition.defaultActiveForm || everyAction(definition).some((action) => action.kind === "transform")) {
    return "A shapechanger and its forms change into each other by name, so one can't be split off.";
  }
  if (tokensOf(encounter, definition.id).length <= 1) return `It's the only ${name} in the scene, so changes to ${name} reach only it already.`;
  for (const owner of encounter.definitions) {
    for (const action of everyAction(owner)) {
      const named = action.kind === "summon" ? action.options.some((option) => option.definitionId === definition.id)
        : action.kind === "transform" ? action.forms.some((form) => form.definitionId === definition.id)
          : false;
      if (!named) continue;
      const whose = owner.id === definition.id ? `Its own ${action.name}` : `${owner.name}'s ${action.name}`;
      return `${whose} ${action.kind === "summon" ? "summons" : "changes into"} ${name} by name, and would go on making the original.`;
    }
  }
  return undefined;
}
