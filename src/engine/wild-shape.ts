import { abilityModifier } from "./dice";
import type { Ability, CreatureDefinition } from "./types";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/**
 * Wild Shape (SRD 5.2): a druid in a Beast form. The beast's stat block replaces its game statistics, but it keeps its
 * creature type, Hit Points, Intelligence, Wisdom and Charisma, class features and feats (its `features`), and its
 * saving throw proficiencies with its own Proficiency Bonus (the beast's modifier where that's higher). It can't cast
 * spells, and what it carries merges into the form. Species traits, gear and spells stay behind. Pure.
 */
export function wildShapeForm(shifter: CreatureDefinition, beast: CreatureDefinition, proficiencyBonus: number, id: string, keepsSpells = false): CreatureDefinition {
  const abilities = {
    str: beast.abilities.str, dex: beast.abilities.dex, con: beast.abilities.con,
    int: shifter.abilities.int, wis: shifter.abilities.wis, cha: shifter.abilities.cha
  };
  const saves: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES) {
    const own = shifter.saves?.[ability] !== undefined ? abilityModifier(abilities[ability]) + proficiencyBonus : undefined;
    const theirs = beast.saves?.[ability];
    const best = Math.max(own ?? Number.NEGATIVE_INFINITY, theirs ?? Number.NEGATIVE_INFINITY);
    if (Number.isFinite(best)) saves[ability] = best;
  }
  return {
    ...beast,
    id,
    name: `${shifter.name} (${beast.name})`,
    ...(shifter.source ? { source: shifter.source } : {}),
    ...(shifter.type ? { type: shifter.type } : {}),
    maxHp: shifter.maxHp,
    abilities,
    saves,
    proficiencyBonus,
    ...(shifter.character ? { character: shifter.character } : {}),
    features: shifter.features ?? [],
    traits: beast.traits ?? [],
    resources: shifter.resources,
    // Beast Spells: its spells come with it.
    spells: keepsSpells ? shifter.spells ?? [] : [],
    items: []
  };
}
