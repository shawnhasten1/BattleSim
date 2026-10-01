import { abilityModifier, movementProfileOf, type CreatureDefinition, type DamageAdjustment } from "@/engine";
import { formatChallengeRating } from "@/lib/srd-monster-tree";
import { formatBonus } from "@/lib/ui-helpers";
import { characterLevel, proficiencyOf, SKILLS, skillName } from "./edits";

/** Speed as a statblock prints it: "40 ft, climb 40 ft, fly 80 ft (hover)". */
export function speedLine(definition: Pick<CreatureDefinition, "speed" | "movement">): string {
  const profile = movementProfileOf(definition);
  const modes = (["burrow", "climb", "fly", "swim"] as const)
    .filter((mode) => (profile[mode] ?? 0) > 0)
    .map((mode) => `${mode} ${profile[mode]} ft${mode === "fly" && profile.hover ? " (hover)" : ""}`);
  return [`${profile.walk} ft`, ...modes].join(", ");
}

function joinList(items: string[], conjunction = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

const ORDINALS = ["0th", "1st", "2nd", "3rd"];
const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`;

/** Its skills in statblock order: "Perception +13, Stealth +6", or "none". */
export function skillsLine(definition: CreatureDefinition): string {
  const order = (id: string) => {
    const at = SKILLS.findIndex((skill) => skill.id === id);
    return at < 0 ? SKILLS.length : at;
  };
  const entries = Object.entries(definition.skills ?? {}).sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b));
  return entries.length ? entries.map(([id, value]) => `${skillName(id)} ${formatBonus(value)}`).join(", ") : "none";
}

/** 10 + its Perception bonus (or its Wisdom modifier). */
export function passivePerception(definition: CreatureDefinition): number {
  return 10 + (definition.skills?.perception ?? abilityModifier(definition.abilities.wis));
}

const ADJUSTMENT_WORDS: Record<DamageAdjustment["type"], string> = {
  vulnerability: "vulnerable to", resistance: "resists", immunity: "immune to", absorb: "absorbs"
};
const ADJUSTMENT_ORDER: DamageAdjustment["type"][] = ["vulnerability", "resistance", "immunity", "absorb"];

/**
 * Its damage and condition defenses on one line: "resists cold, lightning and necrotic; immune to bludgeoning, piercing
 * and slashing from nonmagical attacks · can't be charmed or frightened", or "none".
 */
export function defensesLine(definition: CreatureDefinition): string {
  const groups = new Map<string, { type: DamageAdjustment["type"]; types: string[]; qualifier: string }>();
  for (const adjustment of definition.damageAdjustments ?? []) {
    const except = adjustment.nonMagicalOnly && adjustment.exceptMaterials?.length ? ` that aren't ${joinList(adjustment.exceptMaterials, "or")}` : "";
    const qualifier = adjustment.nonMagicalOnly ? ` from nonmagical attacks${except}` : "";
    const key = `${adjustment.type}|${qualifier}`;
    const group = groups.get(key) ?? { type: adjustment.type, types: [], qualifier };
    group.types.push(adjustment.damageType);
    groups.set(key, group);
  }
  const damage = [...groups.values()]
    .sort((a, b) => ADJUSTMENT_ORDER.indexOf(a.type) - ADJUSTMENT_ORDER.indexOf(b.type) || a.qualifier.length - b.qualifier.length)
    .map((group) => `${ADJUSTMENT_WORDS[group.type]} ${joinList(group.types)}${group.qualifier}`);
  const conditions = (definition.conditionImmunities ?? []).map((condition) => (condition === "exhaustion" ? "exhausted" : condition));
  const parts = [damage.join("; "), conditions.length ? `can't be ${joinList(conditions, "or")}` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "none";
}

/** Its senses, passive Perception and languages: "darkvision 60 ft, passive Perception 9 · Common, Goblin". */
export function sensesLine(definition: CreatureDefinition): string {
  const senses = (["blindsight", "darkvision", "tremorsense", "truesight"] as const)
    .filter((sense) => (definition.senses?.[sense] ?? 0) > 0)
    .map((sense) => `${sense} ${definition.senses![sense]} ft`);
  const languages = definition.languages?.trim();
  return `${[...senses, `passive Perception ${passivePerception(definition)}`].join(", ")} · ${languages || "no languages"}`;
}

/**
 * Its level and challenge: "CR 17 · proficiency +6", "Level 6 Bard (College of Lore) · proficiency +3", or for a
 * monster that casts, "CR 6 · 9th-level spellcaster · proficiency +3".
 */
export function challengeLine(definition: CreatureDefinition): string {
  const classes = (definition.character?.classes ?? []).filter((entry) => entry.name.trim());
  const level = characterLevel(definition);
  const parts: string[] = [];
  if (classes.length) {
    const named = classes.map((entry) => `${entry.name}${classes.length > 1 ? ` ${entry.level}` : ""}${entry.subclass?.name ? ` (${entry.subclass.name})` : ""}`);
    parts.push(`Level ${level} ${named.join(" / ")}`);
  }
  if (definition.challengeRating !== undefined) parts.push(`CR ${formatChallengeRating(definition.challengeRating)}`);
  if (!classes.length && definition.spells?.length) parts.push(`${ordinal(level)}-level spellcaster`);
  else if (!classes.length && definition.challengeRating === undefined) parts.push(`Level ${level}`);
  parts.push(`proficiency ${formatBonus(proficiencyOf(definition))}`);
  return parts.join(" · ");
}
