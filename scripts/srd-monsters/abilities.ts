import type { SrdMonsterAbilityEntry } from "../../src/data/srd/monsters/types";
import type { CreatureDefinition } from "../../src/engine/types";
import { actionStatblock, featureStatblock } from "../../src/lib/statblock";

/**
 * The library monsters' abilities as one line each, for the sheet's Add search (plan §3.2, §5.3): the record itself
 * stays in its creature's chunk and is copied from there when chosen. What can't stand alone on another creature is left
 * out: multiattacks name the creature's own attacks, summons and shapechanges name its forms, a Spellcasting trait
 * holds its spells, and condition immunities are defenses. An ability several creatures share word for word is listed
 * once, under the first, with how many others have it.
 */
const LEFT_OUT_KINDS = new Set(["multiattack", "summon", "transform", "utility", "unsupported"]);
const LEFT_OUT_TRAITS = /^(?:Condition Immunit|Spellcasting|Innate Spellcasting|Shapechanger)/i;
const MAX_TEXT = 160;

export function monsterAbilities(definitions: CreatureDefinition[]): SrdMonsterAbilityEntry[] {
  const entries = new Map<string, SrdMonsterAbilityEntry>();
  for (const definition of definitions) {
    if (definition.hidden) continue;
    const add = (entry: Omit<SrdMonsterAbilityEntry, "monsterId" | "monster">) => {
      const text = entry.text.length > MAX_TEXT ? `${entry.text.slice(0, MAX_TEXT - 1).trimEnd()}…` : entry.text;
      const key = `${entry.name}|${text}`;
      const existing = entries.get(key);
      if (existing) {
        existing.others = (existing.others ?? 0) + 1;
        return;
      }
      entries.set(key, { monsterId: definition.id, monster: definition.name, ...entry, text });
    };
    for (const list of ["actions", "bonusActions", "reactions"] as const) {
      for (const action of definition[list] ?? []) {
        if (LEFT_OUT_KINDS.has(action.kind)) continue;
        add({ list, id: action.id, name: action.name, kind: action.kind, text: actionStatblock(action, definition).short });
      }
    }
    for (const list of ["traits", "features"] as const) {
      for (const feature of definition[list] ?? []) {
        if (feature.informational || LEFT_OUT_TRAITS.test(feature.name)) continue;
        add({ list, id: feature.id, name: feature.name, kind: feature.category, text: featureStatblock(feature, definition).short });
      }
    }
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.monster.localeCompare(b.monster));
}
