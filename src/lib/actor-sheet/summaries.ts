import { abilityModifier, actualMaxHp, armorClassOf, effectiveDefinition, hitPointParts, movementProfileOf, scoreParts, speedParts, type Ability, type CombatantState, type CreatureDefinition, type DamageAdjustment } from "@/engine";
import { RESOURCE_STANCES } from "@/lib/resource-stances";
import { formatChallengeRating } from "@/lib/srd-monster-tree";
import { TACTICS_PROFILES } from "@/lib/tactics-profiles";
import { formatBonus, tokenVisualsFor } from "@/lib/ui-helpers";
import { characterLevel, proficiencyOf, SKILLS, skillName } from "./edits";
import { imageSource, isSurprised, prepBuffs } from "./token";

/** Speed as a statblock prints it: "40 ft, climb 40 ft, fly 80 ft (hover)". */
export function speedLine(definition: Pick<CreatureDefinition, "speed" | "movement">): string {
  const profile = movementProfileOf(definition);
  const modes = (["burrow", "climb", "fly", "swim"] as const)
    .filter((mode) => (profile[mode] ?? 0) > 0)
    .map((mode) => `${mode} ${profile[mode]} ft${mode === "fly" && profile.hover ? " (hover)" : ""}`);
  return [`${profile.walk} ft`, ...modes].join(", ");
}

/**
 * What its effects make its speed, for the sheet beside the base it edits (EFFECTS_PLAN.md): "40 ft: 30 base, Fast
 * Movement +10; fly 40 ft". Undefined when nothing changes it. An effect that needs an activation (Rage) counts once
 * it's used, so it isn't here.
 */
export function speedReadout(definition: CreatureDefinition, combatant?: CombatantState): string | undefined {
  const parts = speedParts(definition, combatant);
  if (!parts.length) return undefined;
  const actual = movementProfileOf(effectiveDefinition(definition, combatant));
  const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value)}`;
  const walk = parts.length > 1 || parts[0]!.value !== actual.walk
    ? [`${actual.walk} ft: ${parts.map((part, index) => (index === 0 ? `${part.value} ${part.label}` : `${part.label} ${signed(part.value)}`)).join(", ")}`]
    : [];
  const modes = (["burrow", "climb", "fly", "swim"] as const)
    .filter((mode) => (actual[mode] ?? 0) > (definition.movement?.[mode] ?? 0))
    .map((mode) => `${mode} ${actual[mode]} ft${mode === "fly" && actual.hover && !definition.movement?.hover ? " (hover)" : ""}`);
  const text = [...walk, ...modes].join("; ");
  return text || undefined;
}

/**
 * What its effects make its hit point maximum, for the sheet beside the base it edits: "77: 65 base, Tough +12".
 * Undefined when nothing changes it.
 */
export function hitPointsReadout(definition: CreatureDefinition, combatant?: CombatantState): string | undefined {
  const parts = hitPointParts(definition, combatant);
  if (!parts.length) return undefined;
  const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value)}`;
  const total = effectiveDefinition(definition, combatant).maxHp;
  return `${total}: ${parts.map((part, index) => (index === 0 ? `${part.value} ${part.label}` : `${part.label} ${signed(part.value)}`)).join(", ")}`;
}

/**
 * What its effects make its ability scores, for the sheet beside the scores it edits: "STR 19 (18 base, Gauntlets of
 * Ogre Power +1)". Undefined when nothing changes them.
 */
export function scoresReadout(definition: CreatureDefinition, combatant?: CombatantState): string | undefined {
  const parts = scoreParts(definition, combatant);
  const actual = effectiveDefinition(definition, combatant).abilities;
  const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value)}`;
  const text = (["str", "dex", "con", "int", "wis", "cha"] as Ability[])
    .filter((ability) => parts[ability])
    .map((ability) => `${ability.toUpperCase()} ${actual[ability]} (${parts[ability]!.map((part, index) => (index === 0 ? `${part.value} ${part.label}` : `${part.label} ${signed(part.value)}`)).join(", ")})`)
    .join("; ");
  return text || undefined;
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

// ── The Token tab's folded lines (plan §3.4) ──

/** This fight: "on the board · Mage Armor up", "arrives round 2 · surprised", "30 ft in the air · in its lair". */
export function fightLine(definition: CreatureDefinition, combatant: CombatantState): string {
  const parts = [combatant.arrivesRound && combatant.arrivesRound > 1 ? `arrives round ${combatant.arrivesRound}` : "on the board"];
  if (isSurprised(combatant)) parts.push("surprised");
  const up = prepBuffs(definition, combatant).filter((buff) => buff.active).map((buff) => buff.action.name);
  if (up.length) parts.push(`${joinList(up)} up`);
  if ((combatant.altitude ?? 0) > 0) parts.push(`${combatant.altitude} ft in the air`);
  if (combatant.inLair && definition.lairActions?.length) parts.push("in its lair");
  return parts.join(" · ");
}

/** Its tactics: "Controller · Balanced · targeted normally", with " · protected" when allies guard it. */
export function tacticsLine(combatant: Pick<CombatantState, "tacticsProfile" | "resourceStance" | "tags">): string {
  const profile = TACTICS_PROFILES.find((option) => option.value === combatant.tacticsProfile)?.label ?? combatant.tacticsProfile;
  const stance = RESOURCE_STANCES.find((option) => option.value === combatant.resourceStance)?.label ?? combatant.resourceStance;
  const tags = combatant.tags ?? [];
  const first = tags.includes("high-priority");
  const last = tags.includes("low-priority");
  // Both tags can be on from before; their weights mostly cancel out.
  const targeted = first && last ? "both target priorities set" : first ? "targeted first" : last ? "targeted last" : "targeted normally";
  return [profile, stance, targeted, ...(tags.includes("protected") ? ["protected"] : [])].join(" · ");
}

const IMAGE_LABELS: Record<NonNullable<ReturnType<typeof imageSource>>, (name: string) => string> = {
  token: () => "image (this token)",
  creature: (name) => `image (every ${name})`,
  device: () => "your token art (this device)",
  placeholder: () => "SRD token"
};

/** How it looks on the map: "image (every Goblin) · white border", or "initials · custom border · nameplate". */
export function appearanceLine(definition: CreatureDefinition, combatant: CombatantState, deviceImages?: Readonly<Record<string, string>>): string {
  const visuals = tokenVisualsFor(definition, combatant, deviceImages);
  const source = imageSource(definition, combatant, deviceImages);
  const parts = [source ? IMAGE_LABELS[source](definition.name) : "initials"];
  parts.push(visuals.borderColor ? "custom border" : "white border");
  if (source) {
    // Scale and glow only change an image (plan §3.4).
    if ((visuals.scale ?? 1) !== 1) parts.push(`image at ${Math.round((visuals.scale ?? 1) * 100)}%`);
    if (visuals.tint) parts.push("glow");
  }
  if (visuals.showNameplate) parts.push("nameplate");
  return parts.join(" · ");
}

const STATES: Record<Exclude<CombatantState["state"], "reserve">, string> = {
  active: "Active", downed: "Downed", defeated: "Defeated", dead: "Dead", fled: "Fled"
};

/** Its state and square: "Active · square 2, 8", or "Arrives round 2 · square 2, 8" for a reinforcement. */
export function statusLine(combatant: Pick<CombatantState, "state" | "arrivesRound" | "position">): string {
  const state = combatant.state === "reserve" ? `Arrives round ${combatant.arrivesRound ?? "?"}` : STATES[combatant.state];
  return `${state} · square ${combatant.position.x}, ${combatant.position.y}`;
}

/**
 * An actor's line in the Actors tab (ACTORS_TAB_PLAN.md, Phase 4): "Level 5 Fighter · HP 44 · AC 18" for a character,
 * "CR 1 · HP 21 · AC 17" for a monster, and "×2 on map" when it has tokens here.
 */
export function directoryLine(definition: CreatureDefinition, tokensHere = 0): string {
  const classes = (definition.character?.classes ?? []).filter((entry) => entry.name.trim());
  const what = classes.length
    ? `Level ${definition.character?.level ?? classes.reduce((sum, entry) => sum + entry.level, 0)} ${classes.map((entry) => entry.name).join(" / ")}`
    : definition.character ? `Level ${characterLevel(definition)}`
      : definition.challengeRating !== undefined ? `CR ${formatChallengeRating(definition.challengeRating)}` : "";
  return [what, `HP ${actualMaxHp(definition)}`, `AC ${armorClassOf(definition).total}`, tokensHere ? `×${tokensHere} on map` : ""]
    .filter(Boolean)
    .join(" · ");
}

/** Whether a search in the Actors tab finds this actor: by its name, type, classes or source. */
export function matchesActorQuery(definition: CreatureDefinition, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    definition.name,
    definition.type,
    definition.size,
    ...(definition.character?.classes ?? []).map((entry) => entry.name),
    definition.source?.documentName,
    definition.source?.provider
  ].filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}
