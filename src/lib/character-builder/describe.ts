import type { Ability, Edition, FeatureDefinition, SourceMetadata, SpellDefinition, WeaponDefinition } from "@/engine";
import { SKILLS } from "@/lib/actor-sheet/edits";
import { SRD_2024_REFERENCE } from "@/data/srd/2024/reference";
import { srd2024SpellEntry } from "@/data/srd/2024/spells";
import { srd2014SpellEntry } from "@/data/srd/2014/spells";
import { MASTERY_TEXT, SKILL_TEXT_2014, SKILL_TEXT_2024 } from "@/data/srd/rules-text";
import type { BuildSources, BuiltBreakdown, ChoiceOption, ChoiceSlot } from "./build";
import type { BackgroundDefinition, ClassDefinition, FeatDefinition, PickOption, SpeciesDefinition, SubclassDefinition } from "./catalog";

/**
 * What the builder's rules cards say (CHARACTER_BUILDER_UX_PLAN.md D3, D5): a class, subclass, species, background,
 * feat, pick, skill, weapon mastery, spell or feature, in words. What a background or species gives is worked out from
 * the same fields the builder applies, per edition, so a card can't disagree with the character it makes. Pure: the UI
 * renders an entry, it doesn't work one out.
 */

export type RulesKind = "class" | "subclass" | "species" | "background" | "feat" | "pick" | "skill" | "mastery" | "spell" | "feature" | "ability" | "item";

/** Whether the simulator runs it: in full, in part, not at all (the DM runs it), or it plays no part in a fight. */
export type Support = "full" | "partial" | "manual" | "info";

export interface RulesEntry {
  kind: RulesKind;
  id: string;
  title: string;
  edition?: Edition;
  /** Where a homebrew or imported one comes from ("Homebrew"); none for the SRD's. */
  source?: string;
  /** The line under the title: "3rd-level evocation", "Background", "Wizard subclass · from level 3". */
  subtitle?: string;
  /** Short facts, shown as chips: a spell's casting time, range, components and duration. */
  facts: string[];
  /** One bold line: "DEX save · 8d6 fire · 20-ft sphere". */
  effect?: string;
  /** What it gives, a label and its value each. */
  gives: Array<{ label: string; value: string }>;
  /** The rules text, markdown. */
  text: string;
  /** Its first paragraph, plain: the one line a list shows. */
  summary: string;
  higherLevels?: string;
  support?: Support;
  /** What the simulator doesn't run of it, when it runs only part ("Not simulated: …" in its text). */
  notSimulated?: string;
  /** Why it can't be chosen here: taken, a prerequisite, a full choice. */
  blocked?: string;
  /** A spell's element (its first damage type) or school: the colour of its tile and card. */
  tone?: string;
}

const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"
};
export const ABILITY_ABBREVIATIONS: Record<Ability, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
const CASTER_WORDS = { full: "Full caster", half: "Half caster", third: "Third caster", pact: "Pact magic" } as const;
const FEAT_CATEGORY_WORDS = { origin: "Origin feat", general: "General feat", "fighting-style": "Fighting style", "epic-boon": "Epic boon" } as const;
const CASTING_WORDS: Record<string, string> = { action: "Action", bonus: "Bonus action", reaction: "Reaction" };
const PHYSICAL = new Set(["bludgeoning", "piercing", "slashing"]);

const capitalize = (text: string) => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const skillOf = (id: string) => SKILLS.find((skill) => skill.id === id);
const skillLabel = (id: string) => skillOf(id)?.name ?? capitalize(id.replace(/[_-]+/g, " "));
const sizeWords = (sizes: readonly string[]) => capitalize(sizes.join(" or "));

/** Markdown as plain text: no emphasis, headings or table pipes. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/^#+\s*/gm, "")
    .replace(/^\|?\s*:?-{2,}.*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/\*\*|__/g, "")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s.,;:)!?]|$)/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** The first paragraph of some markdown, plain. */
export function firstParagraph(markdown: string | undefined): string {
  const paragraphs = (markdown ?? "").replace(/\r\n/g, "\n").split(/\n\s*\n/).map(plainText).filter(Boolean);
  // "You gain the following benefits." says nothing on its own: the paragraph after it does.
  return (paragraphs[0] === "You gain the following benefits." ? paragraphs[1] : paragraphs[0]) ?? "";
}

/** A feature's text, split from the "Not simulated: …" note its authoring adds. */
function splitText(description: string | undefined): { text: string; notSimulated?: string } {
  const text = (description ?? "").replace(/\r\n/g, "\n");
  const at = text.lastIndexOf("\n\nNot simulated:");
  if (at < 0) return { text };
  return { text: text.slice(0, at), notSimulated: text.slice(at + "\n\nNot simulated:".length).trim() };
}

/** Whether the simulator runs a feature. */
export function supportOf(feature: Pick<FeatureDefinition, "automationSupport" | "informational">): Support {
  if (feature.informational) return "info";
  if (feature.automationSupport === "full") return "full";
  if (feature.automationSupport === "partial") return "partial";
  return "manual";
}

function sourceOf(source: SourceMetadata | undefined): string | undefined {
  if (!source || source.provider === "srd") return undefined;
  return source.documentName ?? (source.provider === "homebrew" ? "Homebrew" : "Open5e");
}

function entry(kind: RulesKind, id: string, title: string, fields: Partial<RulesEntry>): RulesEntry {
  const text = fields.text ?? "";
  return { kind, id, title, facts: [], gives: [], ...fields, text, summary: fields.summary ?? firstParagraph(text) };
}

const featureOf = (grant: { feature?: string | FeatureDefinition } | undefined, sources?: BuildSources): FeatureDefinition | undefined =>
  !grant?.feature ? undefined : typeof grant.feature === "string" ? sources?.library.feature(grant.feature) : grant.feature;

/* ── classes and subclasses ───────────────────────────────────────────────────────────────────────────────────── */

export function describeClass(definition: ClassDefinition): RulesEntry {
  const skills = definition.skills.from === "any"
    ? `Choose ${definition.skills.count} of any`
    : `Choose ${definition.skills.count}: ${definition.skills.from.map(skillLabel).join(", ")}`;
  return entry("class", definition.id, definition.name, {
    edition: definition.edition,
    source: sourceOf(definition.source),
    subtitle: "Class",
    gives: [
      { label: "Hit die", value: `d${definition.hitDie}` },
      { label: "Primary ability", value: definition.primaryAbilities.map((ability) => ABILITY_NAMES[ability]).join(definition.primaryAbilityAny ? " or " : " and ") },
      { label: "Saving throws", value: definition.saves.map((ability) => ABILITY_NAMES[ability]).join(", ") },
      { label: "Skills", value: skills },
      { label: "Armor training", value: definition.armorTraining.length ? definition.armorTraining.map(capitalize).join(", ") : "None" },
      { label: "Weapons", value: definition.weaponProficiency.length ? definition.weaponProficiency.map(capitalize).join(", ") : "None" },
      ...(definition.spellcasting
        ? [{ label: "Spellcasting", value: `${CASTER_WORDS[definition.spellcasting.kind]} (${ABILITY_NAMES[definition.spellcasting.ability]})` }]
        : []),
      { label: definition.subclassLabel || "Subclass", value: `At level ${definition.subclassLevel}` }
    ],
    text: definition.description ?? ""
  });
}

export function describeSubclass(subclass: SubclassDefinition, sources: BuildSources): RulesEntry {
  const owner = sources.catalog.classes.find((entry) => entry.id === subclass.classId);
  const gives = [...subclass.levels].sort((a, b) => a.level - b.level).flatMap((level) => {
    const names = level.grants.map((grant) => featureOf(grant, sources)?.name).filter((name): name is string => Boolean(name));
    for (const choice of level.choices ?? []) if ("label" in choice && choice.label) names.push(choice.label.split(":")[0]!);
    return names.length ? [{ label: `Level ${level.level}`, value: names.join(", ") }] : [];
  });
  const first = subclass.levels.flatMap((level) => level.grants).map((grant) => featureOf(grant, sources)).find(Boolean);
  return entry("subclass", subclass.id, subclass.name, {
    edition: subclass.edition,
    source: sourceOf(subclass.source),
    subtitle: `${owner?.name ?? "Class"} subclass${owner ? ` · from level ${owner.subclassLevel}` : ""}`,
    gives,
    text: subclass.description ?? splitText(first?.description).text,
    summary: subclass.description ? firstParagraph(subclass.description) : gives.map((give) => `${give.label}: ${give.value}`).join(" · ")
  });
}

/* ── species and backgrounds: what they give, per edition (D5) ─────────────────────────────────────────────────── */

function increasesWords(increases: Partial<Record<Ability, number>> | undefined): string {
  return Object.entries(increases ?? {}).filter(([, amount]) => (amount ?? 0) > 0)
    .map(([ability, amount]) => `+${amount} ${ABILITY_ABBREVIATIONS[ability as Ability]}`).join(", ");
}

export function describeSpecies(species: SpeciesDefinition, sources?: BuildSources): RulesEntry {
  const word = species.edition === "2014" ? "Race" : "Species";
  const traits = [...species.levels].sort((a, b) => a.level - b.level).flatMap((level) =>
    level.grants.map((grant) => featureOf(grant, sources)?.name).filter((name): name is string => Boolean(name))
      .map((name) => (level.level > 1 ? `${name} (level ${level.level})` : name)));
  const picks = species.levels.flatMap((level) => (level.choices ?? []).flatMap((choice) =>
    choice.kind === "pick" && !/spellcasting ability/i.test(choice.label)
      ? [{ label: choice.label, value: choice.options.map((option) => `${option.name}${option.abilities ? ` (${increasesWords(option.abilities)})` : ""}`).join(", ") }]
      : []));
  const gives: RulesEntry["gives"] = [];
  if (species.edition === "2014") {
    const own = increasesWords(species.abilities);
    const chosen = species.abilityChoice ? `+${species.abilityChoice.amount} to ${species.abilityChoice.count} others of your choice` : "";
    gives.push({ label: "Ability scores", value: [own, chosen].filter(Boolean).join(", ") || "None" });
  }
  gives.push({ label: "Creature", value: `${capitalize(species.type)} · ${sizeWords(species.sizes)}` });
  gives.push({ label: "Speed", value: `${species.speed} ft` });
  const senses = Object.entries(species.senses ?? {}).filter(([, range]) => range).map(([sense, range]) => `${capitalize(sense)} ${range} ft`);
  gives.push({ label: "Senses", value: senses.join(", ") || "None" });
  if (species.skills?.length) gives.push({ label: "Skills", value: species.skills.map(skillLabel).join(", ") });
  if (traits.length) gives.push({ label: "Traits", value: traits.join(", ") });
  gives.push(...picks);
  if (species.edition === "2024") gives.push({ label: "Ability scores", value: "None: under the 2024 rules they come from your background" });
  return entry("species", species.id, species.name, {
    edition: species.edition, source: sourceOf(species.source), subtitle: word, gives, text: species.description ?? ""
  });
}

export function describeBackground(background: BackgroundDefinition, sources: BuildSources): RulesEntry {
  const feat = background.feat ? sources.catalog.feats.find((entry) => entry.id === background.feat) : undefined;
  const list = (background.featChoices as { list?: string[] } | undefined)?.list?.[0];
  const featName = feat ? `${feat.name}${list ? ` (${capitalize(list)})` : ""}` : undefined;
  const feature = (background.grants ?? []).map((grant) => featureOf(grant, sources)).find(Boolean);
  const equipment = (background.equipment ?? []).map((pack) => `${pack.id}: ${pack.label}`).join("; or ");
  const abilityWords = background.abilities?.length
    ? `${background.abilities.map((ability) => ABILITY_ABBREVIATIONS[ability]).join(", ")}: +2 and +1, or +1 to all three`
    : undefined;
  const gives: RulesEntry["gives"] = [];
  if (background.edition === "2024" || background.abilities?.length) {
    gives.push({ label: "Ability scores", value: abilityWords ?? "+2 and +1, or +1 to three: any abilities" });
  }
  if (featName) gives.push({ label: "Origin feat", value: featName });
  if (feature) gives.push({ label: "Feature", value: feature.name });
  gives.push({ label: "Skills", value: background.skills.map(skillLabel).join(", ") || "None" });
  if (background.tool) gives.push({ label: "Tool", value: background.tool });
  if (equipment) gives.push({ label: "Equipment", value: equipment });
  if (background.edition === "2014" && !background.abilities?.length) {
    gives.push({ label: "Ability scores", value: "None: under the 2014 rules they come from your race" });
  }
  const text = [background.description, feat ? `**${featName}.** ${firstParagraph(featText(feat, sources))}` : "", feature ? splitText(feature.description).text : ""]
    .filter(Boolean).join("\n\n");
  return entry("background", background.id, background.name, {
    edition: background.edition, source: sourceOf(background.source), subtitle: "Background", gives, text
  });
}

/* ── feats and picks ──────────────────────────────────────────────────────────────────────────────────────────── */

function featText(feat: FeatDefinition, sources?: BuildSources): string {
  const own = featureOf(feat.grants[0], sources);
  return splitText(own?.description).text || feat.description || "";
}

export function prerequisiteWords(feat: FeatDefinition): string | undefined {
  const prerequisite = feat.prerequisite;
  if (!prerequisite) return undefined;
  if (prerequisite.text) return prerequisite.text;
  const parts: string[] = [];
  if (prerequisite.level) parts.push(`Level ${prerequisite.level}+`);
  const scores = Object.entries(prerequisite.abilities ?? {}).map(([ability, score]) => `${ABILITY_ABBREVIATIONS[ability as Ability]} ${score}`);
  if (scores.length) parts.push(scores.join(prerequisite.anyOf ? " or " : " and "));
  if (prerequisite.feature) parts.push(prerequisite.feature);
  return parts.join(", ") || undefined;
}

export function describeFeat(feat: FeatDefinition, sources?: BuildSources): RulesEntry {
  const prerequisite = prerequisiteWords(feat);
  const own = featureOf(feat.grants[0], sources);
  const { text, notSimulated } = splitText(own?.description ?? feat.description);
  return entry("feat", feat.id, feat.name, {
    edition: feat.edition,
    source: sourceOf(feat.source),
    subtitle: FEAT_CATEGORY_WORDS[feat.category],
    facts: [...(prerequisite ? [`Prerequisite: ${prerequisite}`] : []), ...(feat.repeatable ? ["Repeatable"] : [])],
    text,
    ...(own ? { support: supportOf(own) } : {}),
    ...(notSimulated ? { notSimulated } : {})
  });
}

export function describePick(option: PickOption, label: string, sources?: BuildSources): RulesEntry {
  if (option.feat) {
    const feat = sources?.catalog.feats.find((entry) => entry.id === option.feat);
    if (feat) return { ...describeFeat(feat, sources), id: option.id, subtitle: label };
  }
  const feature = option.grants.map((grant) => featureOf(grant, sources)).find(Boolean);
  const { text, notSimulated } = splitText(feature?.description);
  const facts: string[] = [];
  if (option.prerequisite?.level) facts.push(`From level ${option.prerequisite.level}`);
  if (option.prerequisite?.options?.length) facts.push(`Needs ${option.prerequisite.options.join(", ")}`);
  const description = option.description && !text.startsWith(option.description) ? option.description : "";
  // A spellcasting-ability pick (Magic Initiate's, a lineage's) has no text of its own: say what it decides.
  const ability = option.id in ABILITY_NAMES ? (option.id as Ability) : undefined;
  const fallback = !description && !text && ability
    ? `${ABILITY_NAMES[ability]} becomes the ability these spells are cast with: it sets their save DC and spell attack bonus.`
    : "";
  return entry("pick", option.id, option.name, {
    subtitle: label,
    facts,
    gives: option.abilities ? [{ label: "Ability scores", value: increasesWords(option.abilities) }] : [],
    text: [description, text, fallback].filter(Boolean).join("\n\n"),
    ...(feature ? { support: supportOf(feature) } : {}),
    ...(notSimulated ? { notSimulated } : {})
  });
}

/* ── skills, masteries, abilities ─────────────────────────────────────────────────────────────────────────────── */

export function describeSkill(id: string, edition: Edition = "2024"): RulesEntry {
  const skill = skillOf(id);
  const ability = skill?.ability ?? "int";
  const text = (edition === "2014" ? SKILL_TEXT_2014[id] : SKILL_TEXT_2024[id]) ?? SKILL_TEXT_2024[id] ?? "";
  return entry("skill", id, skillLabel(id), {
    edition, subtitle: `${ABILITY_NAMES[ability]} skill`, facts: [ABILITY_ABBREVIATIONS[ability]], text
  });
}

/** A weapon kind and the mastery property Weapon Mastery gives with it. */
export function describeMastery(kind: string, sources?: BuildSources): RulesEntry {
  const weapon = SRD_2024_REFERENCE.weapons.find((candidate) => candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === kind);
  const about = sources?.library.weaponKind?.(kind);
  const mastery = weapon?.mastery ?? about?.mastery ?? "";
  const facts = weapon ? [`${weapon.damage} ${weapon.damageType.toLowerCase()}`.trim(), ...weapon.properties] : [];
  return entry("mastery", kind, weapon?.name ?? about?.name ?? capitalize(kind), {
    edition: "2024",
    subtitle: weapon ? `${capitalize(weapon.category)} weapon` : "Weapon",
    facts: facts.filter(Boolean),
    gives: mastery ? [{ label: "Mastery", value: mastery }] : [],
    text: mastery ? `**${mastery}.** ${MASTERY_TEXT[mastery.toLowerCase()] ?? ""}`.trim() : "",
    summary: mastery ? `${mastery}: ${MASTERY_TEXT[mastery.toLowerCase()] ?? ""}`.trim() : ""
  });
}

/** A weapon's damage in words: "1d8 slashing", "2d6 slashing (versatile 2d8)". */
function damageWords(weapon: WeaponDefinition): string {
  const first = weapon.damage[0];
  if (!first) return "";
  return `${first.dice} ${first.damageType === "same-as-attack" ? "" : first.damageType}`.trim();
}

const ARMOR_WORDS = { light: "Light armor", medium: "Medium armor", heavy: "Heavy armor", shield: "Shield" } as const;

/**
 * The card for a starting package's weapon or armor (CHARACTER_BUILDER_UX_PLAN.md §3.5): a weapon's damage, properties
 * and mastery; armor's AC, the Dexterity it adds, the Strength it needs and its Stealth. Undefined for anything else (a
 * package's other gear doesn't reach the sheet).
 */
export function describeEquipment(ref: string, sources: BuildSources): RulesEntry | undefined {
  const weapon = sources.library.weapon(ref);
  if (weapon) {
    const mastery = weapon.mastery ? capitalize(weapon.mastery) : undefined;
    return entry("item", ref, weapon.name, {
      subtitle: weapon.category ? `${capitalize(weapon.category)} weapon` : "Weapon",
      facts: [damageWords(weapon), ...(weapon.properties ?? [])].filter(Boolean),
      gives: [
        ...(weapon.attackType === "ranged" || weapon.range > 5 ? [{ label: weapon.attackType === "ranged" ? "Range" : "Reach", value: `${weapon.range} ft` }] : []),
        ...(mastery ? [{ label: "Mastery", value: mastery }] : [])
      ],
      text: mastery ? `**${mastery}.** ${MASTERY_TEXT[mastery.toLowerCase()] ?? ""}`.trim() : "",
      summary: [damageWords(weapon), ...(weapon.properties ?? [])].filter(Boolean).join(" · ")
    });
  }
  const item = sources.library.item(ref);
  if (!item?.armor) return undefined;
  const armor = item.armor;
  const dex = armor.category === "shield" ? undefined
    : armor.category === "heavy" ? "no Dexterity"
      : armor.maxDex !== undefined || armor.category === "medium" ? `+ Dexterity (at most +${armor.maxDex ?? 2})` : "+ Dexterity";
  const ac = armor.category === "shield" ? `+${armor.ac + (armor.magicBonus ?? 0)}` : `${armor.ac + (armor.magicBonus ?? 0)}${dex ? ` ${dex}` : ""}`;
  return entry("item", ref, item.name, {
    subtitle: ARMOR_WORDS[armor.category as keyof typeof ARMOR_WORDS] ?? "Armor",
    facts: [...(armor.strength ? [`Strength ${armor.strength}`] : []), ...(armor.stealthDisadvantage ? ["Stealth disadvantage"] : [])],
    gives: [{ label: "Armor class", value: ac }],
    text: item.description ?? "",
    summary: `AC ${ac}`
  });
}

export function describeAbility(ability: Ability, score?: string): RulesEntry {
  return entry("ability", ability, ABILITY_NAMES[ability], {
    subtitle: "Ability score", facts: [ABILITY_ABBREVIATIONS[ability]], gives: score ? [{ label: "Score now", value: score }] : []
  });
}

/* ── spells ───────────────────────────────────────────────────────────────────────────────────────────────────── */

/** What a spell tile shows and the grids filter by: worked out once per spell. */
export interface SpellFacts {
  name: string;
  level: number;
  school: string;
  /** `action`, `bonus`, `reaction`, or `longer` (a minute or more). */
  cost: "action" | "bonus" | "reaction" | "longer";
  concentration: boolean;
  ritual: boolean;
  tone: string;
  support: Support;
  edition?: Edition;
}

const FACTS = new Map<string, SpellFacts | null>();

function spellEntryOf(id: string) {
  return srd2024SpellEntry(id) ?? srd2014SpellEntry(id);
}

function supportOfSpell(spell: SpellDefinition | undefined, reference: boolean | undefined): Support {
  if (reference) return "manual";
  if (!spell) return "manual";
  if (spell.automationSupport === "partial") return "partial";
  return spell.automationSupport === "manual-only" || spell.automationSupport === "unsupported" ? "manual" : "full";
}

function toneOf(damageTypes: readonly string[] | undefined, school: string): string {
  const first = (damageTypes ?? []).map((type) => type.toLowerCase())[0];
  if (first) return PHYSICAL.has(first) ? "physical" : first;
  return school.toLowerCase();
}

/** A spell's facts for its tile, or undefined for one the library doesn't have. Cached. */
export function spellFacts(id: string, sources: BuildSources): SpellFacts | undefined {
  let facts = FACTS.get(id);
  if (facts !== undefined) return facts ?? undefined;
  const reference = spellEntryOf(id);
  const spell = sources.library.spell?.(id);
  if (!reference && !spell) {
    FACTS.set(id, null);
    return undefined;
  }
  const school = (reference?.school ?? spell?.school ?? "").toLowerCase();
  const castingTime = (reference?.castingTime ?? spell?.castingTime ?? "action").toLowerCase();
  facts = {
    name: reference?.name ?? spell!.name,
    level: reference?.level ?? spell!.level,
    school,
    cost: castingTime === "action" || castingTime === "bonus" || castingTime === "reaction" ? castingTime : "longer",
    concentration: reference?.concentration ?? spell?.concentration ?? false,
    ritual: reference?.ritual ?? spell?.ritual ?? false,
    tone: toneOf(reference?.damageTypes, school),
    support: supportOfSpell(spell, spell ? undefined : true),
    ...(id.endsWith("-2024") ? { edition: "2024" as const } : reference ? { edition: "2014" as const } : {})
  };
  FACTS.set(id, facts);
  return facts;
}

export function describeSpell(id: string, sources: BuildSources, referenceOnly?: boolean): RulesEntry {
  const reference = spellEntryOf(id);
  const spell = sources.library.spell?.(id);
  const facts = spellFacts(id, sources);
  const level = facts?.level ?? 0;
  const school = facts?.school ?? "";
  const subtitle = level ? `${ordinal(level)}-level ${school}` : `${capitalize(school)} cantrip`;
  const chips = reference
    ? [CASTING_WORDS[reference.castingTime] ?? capitalize(reference.castingTime), reference.range, reference.components.replace(/\s*\(.*\)\s*$/, ""), capitalize(reference.duration)]
    : spell ? [CASTING_WORDS[spell.castingTime] ?? spell.castingTime, typeof spell.range === "number" ? `${spell.range} feet` : capitalize(spell.range)] : [];
  if (facts?.concentration) chips.push("Concentration");
  if (facts?.ritual) chips.push("Ritual");
  const effect = reference
    ? [
      reference.save ? `${ABILITY_ABBREVIATIONS[reference.save]} save` : "",
      reference.damage ? `${reference.damage}${reference.damageTypes[0] && !PHYSICAL.has(reference.damageTypes[0].toLowerCase()) ? ` ${reference.damageTypes[0].toLowerCase()}` : ""}` : "",
      reference.area ? `${reference.area.size}-ft ${reference.area.shape.toLowerCase()}` : ""
    ].filter(Boolean).join(" · ")
    : "";
  const support = referenceOnly ? "manual" : supportOfSpell(spell, referenceOnly);
  const { text, notSimulated } = splitText(reference?.text ?? spell?.description);
  return entry("spell", id, facts?.name ?? spell?.name ?? id, {
    ...(facts?.edition ? { edition: facts.edition } : {}),
    subtitle,
    facts: chips.filter(Boolean),
    ...(effect ? { effect } : {}),
    text,
    ...(reference?.higherLevel ? { higherLevels: plainText(reference.higherLevel) } : {}),
    support,
    ...(notSimulated ? { notSimulated } : {}),
    tone: facts?.tone ?? school
  });
}

/* ── features ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export function describeFeature(feature: FeatureDefinition, context: { owner?: string; level?: number; edition?: Edition } = {}): RulesEntry {
  const { text, notSimulated } = splitText(feature.description);
  const where = [context.owner, context.level ? `level ${context.level}` : ""].filter(Boolean).join(" · ");
  return entry("feature", feature.id, feature.name, {
    ...(context.edition ? { edition: context.edition } : {}),
    ...(where ? { subtitle: where } : {}),
    text,
    support: supportOf(feature),
    ...(notSimulated ? { notSimulated } : {})
  });
}

/* ── any option in a choice ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * The card for one option of a choice the builder asks for: a subclass, a feat, a skill, a weapon to master, a spell, a
 * pick (a Fighting Style, an invocation, a lineage) or an ability. `edition` is the character's, for a skill's wording.
 * An option that can't be taken says why.
 */
export function describeOption(slot: ChoiceSlot, option: ChoiceOption, sources: BuildSources, edition?: Edition): RulesEntry {
  const spec = slot.spec;
  let described: RulesEntry;
  switch (spec.kind) {
    case "subclass": {
      const subclass = sources.catalog.subclasses.find((entry) => entry.id === option.id);
      described = subclass ? describeSubclass(subclass, sources) : entry("subclass", option.id, option.name, {});
      break;
    }
    case "feat": {
      const feat = sources.catalog.feats.find((entry) => entry.id === option.id);
      const extra = spec.extraOptions?.find((entry) => entry.id === option.id);
      described = feat ? describeFeat(feat, sources) : extra ? describePick(extra, spec.label ?? "Feat", sources) : entry("feat", option.id, option.name, {});
      break;
    }
    case "skills":
    case "expertise":
      described = describeSkill(option.id, edition);
      break;
    case "weapon-mastery":
      described = describeMastery(option.id, sources);
      break;
    case "spells":
      described = describeSpell(option.id, sources, option.reference);
      break;
    case "pick": {
      const pick = spec.options.find((entry) => entry.id === option.id);
      described = pick ? describePick(pick, spec.label, sources) : entry("pick", option.id, option.name, {});
      break;
    }
    case "abilities":
      described = describeAbility(option.id as Ability, option.detail);
      break;
  }
  return option.taken ? { ...described, blocked: capitalize(option.detail ?? "Already chosen") } : described;
}

/* ── breakdowns ───────────────────────────────────────────────────────────────────────────────────────────────── */

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** How a character's hit point maximum adds up, as card rows: runs of identical levels together. */
export function hitPointRows(breakdown: BuiltBreakdown, maxHp: number): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const levels = breakdown.hitPoints.levels;
  for (let index = 0; index < levels.length;) {
    const level = levels[index]!;
    let end = index;
    while (
      end + 1 < levels.length && index > 0 && !levels[end + 1]!.rolled && !level.rolled
      && levels[end + 1]!.className === level.className && levels[end + 1]!.gained === level.gained
    ) end += 1;
    const span = end > index ? `Levels ${level.level}–${levels[end]!.level}` : `Level ${level.level}`;
    const how = index === 0 ? `d${level.die} at its most, ${level.die}` : level.rolled ? `rolled ${level.roll}` : `d${level.die} average, ${level.roll}`;
    rows.push({ label: `${span} (${level.className})`, value: `${how}, CON ${signed(level.conMod)} = ${level.gained}${end > index ? " each" : ""}` });
    index = end + 1;
  }
  for (const bonus of breakdown.hitPoints.bonuses) rows.push({ label: bonus.name, value: signed(bonus.amount) });
  if (breakdown.hitPoints.adjust) rows.push({ label: "Changed by hand", value: signed(breakdown.hitPoints.adjust) });
  rows.push({ label: "Maximum", value: String(maxHp) });
  return rows;
}

/** How one score adds up, as card rows: the base, each increase and what gave it, the score and its modifier. */
export function scoreRows(ability: Ability, base: number, breakdown: BuiltBreakdown, score: number): Array<{ label: string; value: string }> {
  const rows = [{ label: "Base", value: String(base) }];
  for (const part of breakdown.abilities.filter((entry) => entry.ability === ability)) rows.push({ label: part.source, value: signed(part.amount) });
  rows.push({ label: "Score", value: String(score) });
  rows.push({ label: "Modifier", value: signed(Math.floor((score - 10) / 2)) });
  return rows;
}
