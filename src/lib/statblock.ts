/**
 * Abilities in 5e statblock phrasing, with averages: what the ability editor's preview, its list rows and its effect
 * cards say. Every number comes from the engine's own resolvers (attack bonus, save DC, dice averages), so the text
 * states what the simulator rolls, whatever the source printed.
 */
import {
  abilityModifier,
  dexCapOf,
  isArmorItem,
  formulaAbility,
  getExecutableActions,
  fullHealing,
  healsMoreInFull,
  isDrinkUse,
  ITEM_POOL_PREFIX,
  multiattackRoutines,
  parseDiceExpression,
  proficiencyFromDefinition,
  resolveAttackBonus,
  resolveBeamCount,
  resolveNumericFormula,
  resolveSaveDc,
  resolveScaledDamage,
  spellSlotLevel,
  withSpellcastingAttackAbility,
  type Ability,
  type ActionDefinition,
  type ActionRider,
  type ActionUsage,
  type ConditionInstance,
  type ConditionName,
  type CreatureDefinition,
  type DamageAdjustment,
  type DamageComponent,
  type DeathEffectDefinition,
  type FeatureCondition,
  type FeatureDefinition,
  type FeatureEffect,
  type HealingComponent,
  type ItemDefinition,
  type ItemType,
  type LegendaryActionRef,
  type MultiattackStep,
  type NumericFormula,
  type OnHitOption,
  type ReactionTrigger,
  type ResourceCost,
  type RiderDuration,
  type SpellDefinition,
  type TraitEmanation,
  type WeaponDefinition,
  type ZonePersistence
} from "@/engine";
import { findAbility, type AbilityRef } from "@/lib/ability-editor/refs";

export interface StatblockEntry {
  /** "Claws", "Fire Breath (Recharge 5–6)", "Wing Attack (Costs 2 Actions)". */
  title: string;
  /** As a statblock would print it: "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 11 (2d6 + 4) slashing damage." */
  text: string;
  /** Its key numbers on one line, for a list row: "+6 to hit, reach 5 ft · 11 (2d6 + 4) slashing". */
  short: string;
  /**
   * `"simulated"`: `text` is what the simulator does. `"reference"`: `text` is source text the simulator doesn't run.
   * `"no-effect"`: there's nothing to simulate (Keen Smell).
   */
  support: "simulated" | "reference" | "no-effect";
  /** Parts of a simulated ability the simulator doesn't run (a note rider, a described trigger), shown apart from `text`. */
  notSimulated: string[];
}

type AttackAction = Extract<ActionDefinition, { kind: "attack" }>;
type SaveAction = Extract<ActionDefinition, { kind: "save" }>;
type AreaAction = Extract<ActionDefinition, { kind: "area-save" }>;
type ActivateAction = Extract<ActionDefinition, { kind: "activate-feature" }>;
type ConditionRider = Extract<ActionRider, { kind: "condition" }>;
type ConditionModifiers = NonNullable<ConditionInstance["modifiers"]>;

/* ─── words and numbers ──────────────────────────────────────────────────── */

const ABILITY_NAME: Record<Ability, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"
};
const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

const countWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);
const signed = (n: number): string => (n < 0 ? `-${-n}` : `+${n}`);
const capitalize = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text);
const uncapitalize = (text: string): string => (text ? text[0]!.toLowerCase() + text.slice(1) : text);
const plural = (n: number, word: string): string => `${word}${n === 1 ? "" : "s"}`;

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}

/** "a" or "an" before a number or word: "an 8th-level slot", "an 11th-level slot". */
const article = (next: string): string => (/^(8|11|18|[aeiou])/i.test(next) ? "an" : "a");

function joinList(items: string[], conjunction = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

export function roundsText(rounds: number): string {
  if (rounds % 600 === 0) return rounds === 600 ? "1 hour" : `${rounds / 600} hours`;
  if (rounds % 10 === 0) return rounds === 10 ? "1 minute" : `${rounds / 10} minutes`;
  return `${rounds} ${plural(rounds, "round")}`;
}

/** A sentence with a duration folded in before its full stop. */
const withDuration = (sentence: string, duration: string): string => (duration ? sentence.replace(/\.$/, `${duration}.`) : sentence);

/**
 * A resource id as a thing you spend: "3rd-level slot", "rage", "fear sword charges". An item's pool is named after the
 * item when the creature (or the editor's preview of it) is given: "Potion of Healing", "charges".
 */
export function poolName(resourceId: string, amount = 1, definition?: Pick<CreatureDefinition, "items">): string {
  const slot = spellSlotLevel(resourceId);
  if (slot !== undefined) return `${ordinal(slot)}-level ${plural(amount, "slot")}`;
  const item = definition?.items?.find((candidate) => candidate.supply?.id === resourceId);
  if (item) return item.supply?.unit === "charges" ? plural(amount, "charge") : item.name;
  if (resourceId.startsWith(ITEM_POOL_PREFIX) || resourceId === "supply") return plural(amount, "use");
  const bare = resourceId.includes(":") ? resourceId.slice(resourceId.lastIndexOf(":") + 1) : resourceId;
  const words = bare.replace(/[-_]+/g, " ").trim();
  // "1 charge", "2 ki points": one of a plural-named pool drops its "s"; more than one gains it. Ki and dice don't.
  if (/(^|\s)(ki|psi)$|dice$/.test(words)) return words;
  if (amount === 1) return words.endsWith("s") && !words.endsWith("ss") ? words.slice(0, -1) : words;
  return words.endsWith("s") ? words : `${words}s`;
}

/** "a 1st-level slot", "2 ki points", "1 Potion of Healing" — what spending `cost` takes. */
export function costText(cost: ResourceCost, definition?: Pick<CreatureDefinition, "items">): string {
  const name = poolName(cost.resourceId, cost.amount, definition);
  return cost.amount === 1 && spellSlotLevel(cost.resourceId) !== undefined ? `${article(name)} ${name}` : `${cost.amount} ${name}`;
}

/**
 * How often a limited ability can be used, as a list row or summary says it: "Recharge 5–6", "3/encounter" (the
 * simulator refreshes uses each fight), "(shared)" when it shares the pool with other abilities.
 */
export function usageLabel(usage: ActionUsage | undefined): string {
  if (!usage) return "";
  const shared = usage.poolId ? " (shared)" : "";
  if (usage.kind === "recharge") return `${usageSuffix(usage).trim().replace(/^\(|\)$/g, "")}${shared}`;
  return `${usage.uses ?? 1}/encounter${shared}`;
}

/** " (Recharge 5–6)", " (3/Day)": the title suffix a printed statblock uses. */
export function usageSuffix(usage: ActionUsage | undefined): string {
  if (!usage) return "";
  if (usage.kind === "recharge") {
    const min = usage.recharge?.min ?? 6;
    const die = usage.recharge?.die ?? 6;
    return ` (Recharge ${min >= die ? die : `${min}–${die}`})`;
  }
  return ` (${usage.uses ?? 1}/Day)`;
}

/** Who a sentence is about: the creature itself, the target of its attack, or everyone an effect reaches. */
interface Who {
  subject: string;
  possessive: string;
  object: string;
}
const IT: Who = { subject: "it", possessive: "its", object: "it" };
const THE_TARGET: Who = { subject: "the target", possessive: "the target's", object: "the target" };
const EACH_TARGET: Who = { subject: "each target", possessive: "each target's", object: "each target" };
const A_CREATURE: Who = { subject: "a creature", possessive: "a creature's", object: "a creature" };
const EACH: Who = { subject: "each", possessive: "each one's", object: "each of them" };

/* ─── dice ───────────────────────────────────────────────────────────────── */

interface Rolled {
  average: number;
  /** "2d6 + 4"; absent for a flat amount. */
  expression?: string;
}

/** A component's average and dice, the way the engine rolls it: its dice (cantrip-scaled) plus its ability modifier and bonus formula. */
function rolled(component: DamageComponent | HealingComponent, definition: CreatureDefinition): Rolled {
  const scaling = "scaling" in component ? component.scaling : undefined;
  let parsed: ReturnType<typeof parseDiceExpression>;
  try {
    parsed = parseDiceExpression(resolveScaledDamage(component.dice, scaling, { casterLevel: definition.character?.level ?? 1 }));
  } catch {
    return { average: 0, expression: component.dice };
  }
  const ability = component.abilityModifier ? abilityModifier(definition.abilities[component.abilityModifier]) : 0;
  const formula = "bonusFormula" in component ? resolveNumericFormula(component.bonusFormula, definition) : 0;
  const flat = parsed.modifier + ability + formula;
  const diceAverage = parsed.terms.reduce((sum, term) => sum + (term.sign * term.count * (term.sides + 1)) / 2, 0);
  const average = Math.max(0, Math.floor(diceAverage + flat));
  if (parsed.terms.length === 0) return { average };
  const dice = parsed.terms
    .map((term, index) => `${index === 0 ? (term.sign < 0 ? "-" : "") : term.sign < 0 ? " - " : " + "}${term.count}d${term.sides}`)
    .join("");
  return { average, expression: flat ? `${dice} ${flat > 0 ? "+" : "-"} ${Math.abs(flat)}` : dice };
}

const rolledText = (roll: Rolled): string => (roll.expression ? `${roll.average} (${roll.expression})` : String(roll.average));

function damageTypeText(component: DamageComponent): string {
  if (component.damageTypeOptions?.length) return joinList(component.damageTypeOptions, "or");
  return component.damageType === "same-as-attack" ? "" : component.damageType;
}

/** "19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage". */
function damageText(components: DamageComponent[], definition: CreatureDefinition): string {
  return components.map((component) => {
    const type = damageTypeText(component);
    return `${rolledText(rolled(component, definition))}${type ? ` ${type}` : ""} damage`;
  }).join(" plus ");
}

/** "19 (2d10 + 8) piercing + 7 (2d6) fire". */
export function damageShort(components: DamageComponent[], definition: CreatureDefinition): string {
  return components.map((component) => {
    const type = damageTypeText(component);
    return `${rolledText(rolled(component, definition))}${type ? ` ${type}` : ""}`;
  }).join(" + ");
}

function healingText(components: HealingComponent[], definition: CreatureDefinition): string {
  return components.map((component) => rolledText(rolled(component, definition))).join(" plus ");
}

/** "9 (1d8 + 4)": how much a heal restores, the way the engine rolls it. */
export function healingShort(components: HealingComponent[], definition: CreatureDefinition): string {
  return healingText(components, definition);
}

/** "+3", or "+3 (its Charisma modifier)" when the number is just an ability modifier. */
function formulaText(formula: NumericFormula, definition: CreatureDefinition): string {
  const value = signed(resolveNumericFormula(formula, definition));
  const ability = formulaAbility(formula.ability, definition);
  return ability && !formula.base && !formula.proficiency && (formula.multiplier ?? 1) === 1
    ? `${value} (its ${formula.ability === "spellcasting" ? "spellcasting ability" : ABILITY_NAME[ability]} modifier)`
    : value;
}

/** "a +2 bonus to AC", "a -2 penalty to attack rolls". */
function bonusPhrase(amount: number | string, to: string): string {
  if (typeof amount === "string") return `a ${amount} bonus to ${to}`;
  return amount < 0 ? `a -${-amount} penalty to ${to}` : `a +${amount} bonus to ${to}`;
}

/** Saving throw bonuses as phrases: one for all six when they match ("a +2 bonus to saving throws"). */
function saveBonusPhrases(saves: Partial<Record<Ability, number>> | undefined): string[] {
  const entries = ABILITIES.flatMap((ability) => (saves?.[ability] ? [[ability, saves[ability]!] as const] : []));
  if (entries.length === 6 && entries.every(([, value]) => value === entries[0]![1])) return [bonusPhrase(entries[0]![1], "saving throws")];
  // Saves with the same bonus read as one phrase: "a +2 bonus to Wisdom and Charisma saving throws".
  const byValue = new Map<number, Ability[]>();
  for (const [ability, value] of entries) byValue.set(value, [...(byValue.get(value) ?? []), ability]);
  return [...byValue].map(([value, abilities]) => bonusPhrase(value, `${joinList(abilities.map((ability) => ABILITY_NAME[ability]))} saving throws`));
}

/* ─── conditions, durations, saves ───────────────────────────────────────── */

/** A condition's name as a reader says it: a custom one's id-like name ("spirit-guardians-slowed") gets spaces. */
function conditionName(condition: ConditionName | { custom: string }): string {
  return typeof condition === "string" ? condition : condition.custom.replace(/[-_]+/g, " ").trim();
}

/** A custom condition's name with what it does: "slowed (speed ×0.5)". A standard condition's name says it all. */
function conditionLabel(rider: ConditionPhrase, definition?: CreatureDefinition): string {
  const name = conditionName(rider.condition);
  const effects = typeof rider.condition === "string" ? [] : [
    ...modifierShorts(rider.modifiers),
    ...(definition ? effectShorts(rider.effects, definition) : [])
  ];
  return effects.length ? `${name} (${effects.join(", ")})` : name;
}

function durationText(duration: RiderDuration | undefined, condition?: ConditionName | { custom: string }): string {
  if (!duration) return "";
  // Prone has no duration: standing up ends it (the engine ends it when the creature's next turn starts).
  if (condition && conditionName(condition) === "prone" && duration.kind === "until-start-of-next-turn") return "";
  if (duration.kind === "rounds") return ` for ${roundsText(duration.rounds)}`;
  if (duration.kind === "until-start-of-next-turn") return " until the start of its next turn";
  if (duration.kind === "concentration") return " (concentration)";
  return "";
}

type ConditionPhrase = Pick<ConditionRider, "condition" | "duration"> & Partial<Pick<ConditionRider, "modifiers" | "effects">>;

/** "be knocked prone", "be paralyzed for 1 minute". */
function beCondition(rider: ConditionPhrase, definition?: CreatureDefinition): string {
  const name = conditionName(rider.condition);
  return `${name === "prone" ? "be knocked prone" : `be ${conditionLabel(rider, definition)}`}${durationText(rider.duration, rider.condition)}`;
}

/** "is knocked prone", "is poisoned for 1 minute". */
function isCondition(rider: ConditionPhrase, definition?: CreatureDefinition): string {
  const name = conditionName(rider.condition);
  return `${name === "prone" ? "is knocked prone" : `is ${conditionLabel(rider, definition)}`}${durationText(rider.duration, rider.condition)}`;
}

/** " The target can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success." */
function repeatSaveText(duration: RiderDuration | undefined, who: Who): string {
  const at = duration?.kind === "save-ends" ? duration.saveAt : duration?.kind === "rounds" ? duration.repeatSaveAt : undefined;
  return at ? ` ${capitalize(who.subject)} can repeat the saving throw at the ${at === "turn-start" ? "start" : "end"} of each of its turns, ending the effect on itself on a success.` : "";
}

function riderQualifiers(rider: ActionRider): string {
  if (rider.kind === "note") return "";
  const parts: string[] = [];
  if (rider.oncePerTurn) parts.push("once per turn");
  if (rider.resourceCost) parts.push(`${rider.activation === "optional" ? "optional, uses" : "uses"} ${costText(rider.resourceCost)}`);
  if (rider.restrictToCreatureTypes?.length) parts.push(`${joinList(rider.restrictToCreatureTypes, "or")} only`);
  return parts.length ? ` (${parts.join("; ")})` : "";
}

/** A rider's save DC, falling back to `fallbackDc` the way the engine does. */
function riderDc(save: NonNullable<ConditionRider["save"]>, definition: CreatureDefinition, fallbackDc: number): number {
  return save.dc ?? (save.dcFormula ? resolveNumericFormula(save.dcFormula, definition) : fallbackDc);
}

/**
 * A rider as its own sentence about `who`. A condition rider only rolls its own save in an attack's context
 * (`rollsOwnSave`); in a save's context the action's save already gated it. `fallbackDc` is the DC a rider save without
 * its own uses.
 */
function riderSentence(rider: ActionRider, definition: CreatureDefinition, fallbackDc: number, rollsOwnSave: boolean, who: Who): string {
  const qualifiers = riderQualifiers(rider);
  const S = capitalize(who.subject);
  switch (rider.kind) {
    case "condition": {
      if (onlyDeniesReactions(rider)) {
        const lasts = durationText(rider.duration);
        return rider.save && rollsOwnSave
          ? `${S} must succeed on a DC ${riderDc(rider.save, definition, fallbackDc)} ${ABILITY_NAME[rider.save.ability]} saving throw or be unable to take reactions${lasts}${qualifiers}.`
          : `${S} can't take reactions${lasts}${qualifiers}.`;
      }
      if (rider.save && rollsOwnSave) {
        return `${S} must succeed on a DC ${riderDc(rider.save, definition, fallbackDc)} ${ABILITY_NAME[rider.save.ability]} saving throw or ${beCondition(rider, definition)}${qualifiers}.${repeatSaveText(rider.duration, who)}`;
      }
      return `${S} ${isCondition(rider, definition)}${qualifiers}.${repeatSaveText(rider.duration, who)}`;
    }
    case "damage":
      return `${S} takes an extra ${damageText(rider.components, definition)}${qualifiers}.`;
    case "healing":
      return `${rider.target === "self" ? "It" : S} regains ${healingText(rider.components, definition)} hit points${qualifiers}.`;
    case "push":
      return `${S} is pushed up to ${rider.distance} feet away${qualifiers}.`;
    case "hold": {
      const size = rider.maxSize ? ` if it is ${rider.maxSize} or smaller` : "";
      return `${S} is grappled (escape DC ${rider.escapeDc})${size}${qualifiers}.`
        + (rider.restrained ? ` Until this grapple ends, ${who.subject} is restrained.` : "")
        + (rider.recurringDamage?.length ? ` While grappled, it takes ${damageText(rider.recurringDamage, definition)} at the start of each of its turns.` : "")
        + ((rider.limit ?? 1) > 1 ? ` It can grapple up to ${countWord(rider.limit!)} creatures this way.` : "");
    }
    case "swallow": {
      const size = rider.maxSize ? ` if it is ${rider.maxSize} or smaller` : "";
      const save = rider.save ? `, unless it succeeds on a DC ${rider.save.dc} ${ABILITY_NAME[rider.save.ability]} saving throw` : "";
      return `It swallows ${who.object}${rider.requiresHeld ? " it is grappling" : ""}${size}${save}${qualifiers}.`
        + " A swallowed creature is blinded and restrained, and can attack only the creature that swallowed it."
        + (rider.damage?.length ? ` It takes ${damageText(rider.damage, definition)} at the start of each of the swallower's turns.` : "")
        // The engine rolls the save as soon as the damage adds up, and puts them down prone in the nearest free space.
        + (rider.regurgitate
          ? ` If the swallower takes ${rider.regurgitate.damage} damage or more on a single turn from a creature inside it, it must succeed on a DC ${rider.regurgitate.dc} Constitution saving throw or regurgitate all swallowed creatures, which fall prone in a space near it.`
          : "");
    }
    case "note":
      return "";
  }
}

/** A custom condition whose only effect is taking away reactions (Shocking Grasp): said as that, not by its name. */
function onlyDeniesReactions(rider: ConditionRider): boolean {
  const modifiers = rider.modifiers ?? {};
  return typeof rider.condition !== "string" && modifiers.deniesReactions === true
    && Object.keys(modifiers).every((key) => key === "deniesReactions") && !rider.effects?.length;
}

/** A rider's gist for a list row: "DC 11 STR or prone", "grappled (DC 16)". */
export function riderShort(rider: ActionRider, definition: CreatureDefinition, fallbackDc: number, rollsOwnSave: boolean): string {
  const short = riderShortOf(rider, definition, fallbackDc, rollsOwnSave);
  // Only some creatures take it (holy water: fiends and undead).
  const only = rider.kind !== "note" && rider.restrictToCreatureTypes?.length ? ` (${joinList(rider.restrictToCreatureTypes, "or")} only)` : "";
  return short && only ? `${short}${only}` : short;
}

function riderShortOf(rider: ActionRider, definition: CreatureDefinition, fallbackDc: number, rollsOwnSave: boolean): string {
  switch (rider.kind) {
    case "condition": {
      const name = onlyDeniesReactions(rider) ? "no reactions" : conditionName(rider.condition);
      if (rider.save && rollsOwnSave) return `DC ${riderDc(rider.save, definition, fallbackDc)} ${rider.save.ability.toUpperCase()} or ${name}`;
      return name;
    }
    case "damage": return `+${damageShort(rider.components, definition)}`;
    case "healing": return `heals ${healingText(rider.components, definition)}`;
    case "push": return `push ${rider.distance} ft`;
    case "hold": return `grappled${rider.restrained ? " and restrained" : ""} (DC ${rider.escapeDc})`;
    case "swallow": return "swallows";
    case "note": return "";
  }
}

function notesOf(riders: ActionRider[] | undefined): string[] {
  return (riders ?? []).flatMap((rider) => (rider.kind === "note" && rider.text.trim() ? [rider.text.trim()] : []));
}

/** The DC a rider's save uses when it doesn't set its own: 8 + the attack's ability modifier + proficiency. */
export function riderFallbackDc(action: Pick<AttackAction, "ability">, definition: CreatureDefinition): number {
  return 8 + abilityModifier(definition.abilities[action.ability]) + (definition.proficiencyBonus ?? proficiencyFromDefinition(definition));
}

/**
 * What an effect card's effect follows: an attack (a rider save rolls on its own, its DC from the attack's ability), a
 * saving throw (the save already decided it; repeats use `dc`), or no roll (a heal's extra effect).
 */
export type EffectContext =
  | { kind: "attack"; ability: Ability }
  | { kind: "save"; dc: number }
  | { kind: "automatic" };

/** An effect as the sentence its card shows: "The target must succeed on a DC 11 Strength saving throw or be knocked prone." */
export function effectCardText(rider: ActionRider, definition: CreatureDefinition, context: EffectContext): string {
  if (rider.kind === "note") return rider.text.trim() || "A note for the DM.";
  if (context.kind === "save") return riderSentence(rider, definition, context.dc, false, THE_TARGET);
  const fallbackDc = context.kind === "attack"
    ? riderFallbackDc(context, definition)
    : 8 + (definition.proficiencyBonus ?? proficiencyFromDefinition(definition));
  return riderSentence(rider, definition, fallbackDc, true, THE_TARGET);
}

/** A damage or healing line's average, the way the engine rolls it (dice, ability modifier and bonus formula). */
export function componentAverage(component: DamageComponent | HealingComponent, definition: CreatureDefinition): number {
  return rolled(component, definition).average;
}

/* ─── modifiers and feature effects ──────────────────────────────────────── */

function incomingText(amount: number, who: Who, gate = ""): string {
  const against = `Attack rolls against ${who.object}`;
  if (amount >= 5) return `${against} have advantage${gate}.`;
  if (amount <= -5) return `${against} have disadvantage${gate}.`;
  return `${against} ${amount < 0 ? `take a -${-amount} penalty` : `gain a +${amount} bonus`}${gate}.`;
}

function adjustmentQualifier(adjustment: DamageAdjustment): string {
  return (adjustment.nonMagicalOnly ? " from nonmagical attacks" : "")
    + (adjustment.exceptMaterials?.length ? ` that aren't ${joinList(adjustment.exceptMaterials, "or")}` : "");
}

/** Damage adjustments grouped into sentences: "It has resistance to bludgeoning, piercing, and slashing damage from nonmagical attacks." */
function adjustmentSentences(adjustments: DamageAdjustment[], who: Who, gate = ""): string[] {
  const groups = new Map<string, { adjustment: DamageAdjustment; types: string[] }>();
  for (const adjustment of adjustments) {
    const key = `${adjustment.type}|${adjustmentQualifier(adjustment)}`;
    const group = groups.get(key) ?? { adjustment, types: [] };
    group.types.push(adjustment.damageType);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ adjustment, types }) => adjustment.type === "absorb"
    ? `${capitalize(joinList(types, "or"))} damage heals ${who.object} instead of harming ${who.object === "it" ? "it" : "them"}${gate}.`
    : `${capitalize(who.subject)} has ${adjustment.type} to ${joinList(types)} damage${adjustmentQualifier(adjustment)}${gate}.`);
}

/** A condition's modifiers as sentences about `who`. */
function modifierSentences(modifiers: ConditionModifiers | undefined, who: Who): string[] {
  if (!modifiers) return [];
  const S = capitalize(who.subject);
  const sentences: string[] = [];
  const bonuses = [
    ...(modifiers.armorClass ? [bonusPhrase(modifiers.armorClass, "AC")] : []),
    ...(modifiers.attackRoll ? [bonusPhrase(modifiers.attackRoll, "attack rolls")] : []),
    ...saveBonusPhrases(modifiers.savingThrows)
  ];
  if (bonuses.length) sentences.push(`${S} ${bonuses.every((phrase) => phrase.includes("penalty")) ? "takes" : "gains"} ${joinList(bonuses)}.`);
  // The engine divides speed by the multiplier (2 halves it, 999 stops it) and ignores anything below 1.
  const speed = modifiers.movementMultiplier;
  if (speed !== undefined && speed > 1) {
    const P = capitalize(who.possessive);
    sentences.push(speed >= 999 ? `${S} can't move.` : speed === 2 ? `${P} speed is halved.` : `${P} speed is divided by ${speed}.`);
  }
  if (modifiers.damageAdjustments?.length) sentences.push(...adjustmentSentences(modifiers.damageAdjustments, who));
  const denied = [
    ...(modifiers.deniesActions ? ["actions"] : []),
    ...(modifiers.deniesBonusActions ? ["bonus actions"] : []),
    ...(modifiers.deniesReactions ? ["reactions"] : [])
  ];
  if (denied.length) sentences.push(`${S} can't take ${joinList(denied, "or")}.`);
  if (modifiers.incomingAttackRoll) sentences.push(incomingText(modifiers.incomingAttackRoll, who));
  if (modifiers.forcesRandomAction) sentences.push(`${S} acts at random on its turns.`);
  return sentences;
}

const GATE_TEXT: Record<Exclude<FeatureCondition, "always" | "charged">, string> = {
  "self-bloodied": "while it has half its hit points or fewer",
  "target-bloodied": "against a creature that has half its hit points or fewer",
  "attack-has-advantage": "when it has advantage on the attack roll",
  "attack-has-no-disadvantage": "when it doesn't have disadvantage on the attack roll",
  "ally-adjacent-to-target": "if an ally is within 5 feet of the target",
  "target-injured": "against a creature that is missing any hit points",
  "target-surprised": "against a surprised creature",
  "target-grappled-by-self": "against a creature it is grappling"
};

function gateOne(condition: FeatureCondition, chargeFeet: number | undefined): string {
  if (condition === "always") return "";
  if (condition === "charged") return `after it moves at least ${chargeFeet ?? 20} feet straight toward the target`;
  return GATE_TEXT[condition];
}

/** " if an ally is within 5 feet of the target", " when it has advantage on the attack roll or if an ally …". */
function gateText(effect: FeatureEffect): string {
  const gates = effect as { condition?: FeatureCondition; allConditions?: FeatureCondition[]; anyConditions?: FeatureCondition[]; chargeFeet?: number; targetMarked?: string };
  const parts: string[] = [];
  if (gates.targetMarked) parts.push("against the creature it has marked");
  if (gates.condition) parts.push(gateOne(gates.condition, gates.chargeFeet));
  if (gates.allConditions?.length) parts.push(joinList(gates.allConditions.map((c) => gateOne(c, gates.chargeFeet)).filter(Boolean)));
  if (gates.anyConditions?.length) parts.push(joinList(gates.anyConditions.map((c) => gateOne(c, gates.chargeFeet)).filter(Boolean), "or"));
  const text = joinList(parts.filter(Boolean));
  return text ? ` ${text}` : "";
}

/** "melee ", "melee or ranged ", "spell ", "Tail Stinger " for an effect on named actions, "" for any attack. */
function attackScope(effect: FeatureEffect, definition: CreatureDefinition): string {
  const scope = effect as { attackTypes?: string[]; spellsOnly?: boolean; actionIds?: string[] };
  if (scope.actionIds?.length) {
    const names = new Map(getExecutableActions(definition).map((action) => [action.id, action.name]));
    return `${joinList(scope.actionIds.map((id) => names.get(id) ?? id), "or")} `;
  }
  if (scope.spellsOnly) return "spell ";
  return scope.attackTypes?.length ? `${joinList(scope.attackTypes, "or")} ` : "";
}

/** " using Strength", " that deal fire damage". */
function usingText(effect: FeatureEffect): string {
  const scope = effect as { abilities?: Ability[]; damageTypes?: string[] };
  return (scope.abilities?.length ? ` using ${joinList(scope.abilities.map((ability) => ABILITY_NAME[ability]), "or")}` : "")
    + (scope.damageTypes?.length ? ` that deal ${joinList(scope.damageTypes, "or")} damage` : "");
}

/** "When it fails a saving throw, it can reroll the d20 and use the new roll, adding 9, by spending 1 Indomitable." */
function d20ChangeSentence(effect: Extract<FeatureEffect, { kind: "d20-change" }>, definition: CreatureDefinition, who: Who): string {
  const when = effect.onNatural1
    ? `rolls a 1 on the d20 of ${joinList(effect.rolls.map((roll) => (roll === "save" ? "a saving throw" : "an attack roll")), "or")}`
    : joinList(effect.rolls.map((roll) => (roll === "save" ? "fails a saving throw" : "misses with an attack roll")), "or");
  const does = effect.change === "reroll" ? `reroll the d20 and use the new roll${effect.bonus ? `, adding ${formulaText(effect.bonus, definition).replace(/^\+/, "")}` : ""}`
    : effect.change === "add" ? `add ${effect.dice ?? "1d4"} to the roll`
      : effect.change === "twenty" ? "treat the d20 as a 20"
        : "hit instead";
  const cost = effect.resourceCost ? `, spending ${costText(effect.resourceCost, definition)}` : "";
  return `When ${who.subject} ${when}, ${who.subject} can ${does}${cost}${effect.oncePerTurn ? " (once until the start of its next turn)" : ""}.`;
}

/** One feature effect as a sentence about `who` (the creature that has it, unless an aura or a buff says otherwise). */
export function effectSentence(effect: FeatureEffect, definition: CreatureDefinition, who: Who = IT): string {
  const gate = gateText(effect);
  const S = capitalize(who.subject);
  const P = capitalize(who.possessive);
  switch (effect.kind) {
    case "attack-advantage":
      return `${S} has ${effect.mode ?? "advantage"} on ${attackScope(effect, definition)}attack rolls${usingText(effect)}${gate}.`;
    case "attack-bonus":
      return `${S} gains ${bonusPhrase(formulaText(effect.bonus, definition), `${attackScope(effect, definition)}attack rolls`)}${usingText(effect)}${gate}.`;
    case "d20-change":
      return d20ChangeSentence(effect, definition, who);
    case "initiative": {
      const parts = [
        ...(effect.advantage ? ["has advantage on Initiative rolls"] : []),
        ...(effect.bonus ? [`gains ${bonusPhrase(formulaText(effect.bonus, definition), effect.advantage ? "them" : "Initiative rolls")}`] : [])
      ];
      return `${S} ${parts.length ? joinList(parts) : "rolls Initiative as usual"}.`;
    }
    case "critical-range":
      return `${P} ${attackScope(effect, definition)}attack rolls${usingText(effect)} score a critical hit on a roll of ${effect.minimum === 20 ? "20" : `${effect.minimum}–20`}${gate}.`;
    case "incoming-attack-modifier":
      return incomingText(effect.amount, who, gate);
    case "damage-bonus":
      // `critical` only says whether the dice double on a critical hit (they do by default): every hit deals it.
      return `${effect.oncePerTurn ? `Once per turn, ${who.possessive}` : P} ${attackScope(effect, definition)}hits${usingText(effect)} deal an extra ${damageText(effect.damage, definition)}${gate}.`;
    case "save-gated-damage":
      return `${effect.oncePerTurn ? `Once per turn, ${who.possessive}` : P} ${attackScope(effect, definition)}hits${usingText(effect)} deal an extra ${damageText(effect.damage, definition)}${gate}, unless the target succeeds on a ${effect.save.dc ? `DC ${effect.save.dc} ` : ""}${ABILITY_NAME[effect.save.ability]} saving throw${effect.save.halfDamageOnSuccess ? " (half as much on a success)" : ""}.`;
    case "apply-condition-on-hit": {
      const applied = effect.appliedCondition;
      // A condition of its own (a mark) reads by what it does: "marked (hitting it: +7 necrotic)".
      const own = !applied.name || applied.name === "custom";
      const condition = {
        condition: own ? { custom: applied.effects?.length || applied.modifiers ? "marked" : "affected" } : applied.name!,
        duration: applied.durationRounds ? ({ kind: "rounds", rounds: applied.durationRounds } as RiderDuration) : undefined,
        modifiers: applied.modifiers,
        effects: applied.effects
      } as ConditionPhrase;
      const whom = effect.target === "self" ? who.subject : "the target";
      const outcome = effect.save
        ? `${whom} must succeed on a ${effect.save.dc ? `DC ${effect.save.dc} ` : ""}${ABILITY_NAME[effect.save.ability]} saving throw or ${beCondition(condition, definition)}`
        : `${whom} ${isCondition(condition, definition)}`;
      return `When ${who.subject} hits with ${article(attackScope(effect, definition) || "attack")} ${attackScope(effect, definition)}attack${gate}, ${outcome}${effect.oncePerTurn ? " (once per turn)" : ""}.`;
    }
    case "incoming-hit-damage":
      // Read from a condition on the creature that's hit: the hit itself deals more (a hunter's mark), and by default
      // the first such hit ends the condition.
      return `${effect.onlyFromSource ? "The marker's hits" : "Hits"} against ${who.object} deal an extra ${damageText(effect.damage, definition)}${gate}.${(effect.consumeCondition ?? true) ? " The first such hit ends this." : ""}`;
    case "damage-adjustment":
      return adjustmentSentences([effect.adjustment], who, gate)[0]!;
    case "save-advantage": {
      const abilities = [...(effect.ability ? [effect.ability] : []), ...(effect.abilities ?? [])];
      const against = [
        effect.against?.source === "spell" ? "spells" : effect.against?.source === "magical" ? "spells and other magical effects" : "",
        effect.against?.conditions?.length ? `being ${joinList(effect.against.conditions, "or")}` : ""
      ].filter(Boolean);
      return `${S} has advantage on ${abilities.length ? `${joinList(abilities.map((ability) => ABILITY_NAME[ability]))} ` : ""}saving throws${against.length ? ` against ${joinList(against)}` : ""}${gate}.`;
    }
    case "hp-regen":
      return `${S} regains ${effect.amount} hit points at the start of its turn${effect.worksAtZero ? ", even at 0 hit points" : " if it has at least 1 hit point"}.`
        + (effect.suppressedByDamageTypes?.length ? ` If it takes ${joinList(effect.suppressedByDamageTypes, "or")} damage, this doesn't work at the start of its next turn.` : "");
    case "survive-lethal": {
      const unless = [
        effect.excludedDamageTypes?.length ? `the damage is ${joinList(effect.excludedDamageTypes, "or")}` : "",
        effect.excludeCritical ? "it's from a critical hit" : ""
      ].filter(Boolean);
      const how = effect.save
        ? `${who.subject} makes a ${ABILITY_NAME[effect.save.ability]} saving throw with a DC of ${effect.save.dcBase} + the damage taken, and on a success it drops`
        : `${who.subject} drops`;
      return `If damage reduces ${who.object} to 0 hit points, ${how} to 1 hit point instead`
        + `${effect.maxDamage ? ` (only for ${effect.maxDamage} damage or less)` : ""}${unless.length ? `, unless ${joinList(unless, "or")}` : ""}`
        + `${effect.resourceId ? ` (uses 1 ${poolName(effect.resourceId)})` : ""}.`;
    }
    case "auto-succeed-save": {
      const against = effect.against?.source === "spell" ? " against a spell" : effect.against?.source === "magical" ? " against magic" : "";
      return `If ${who.subject} fails a saving throw${against}, it can choose to succeed instead (uses 1 ${poolName(effect.resourceId)}).`;
    }
    case "split-on-damage":
      return `When ${who.subject} takes ${joinList(effect.triggerDamageTypes, "or")} damage and has at least ${effect.minHp} hit points, it splits into two creatures, each with half its hit points.`;
    case "swarm-damage":
      return `${P} ${attackScope(effect, definition)}attacks deal ${damageText(effect.fullHpDamage, definition)}${effect.bloodiedDamage?.length ? `, or ${damageText(effect.bloodiedDamage, definition)} while it has half its hit points or fewer` : ""}.`;
    case "armor-class-bonus":
      return `${S} gains ${bonusPhrase(formulaText(effect.bonus, definition), "AC")}${effect.unarmoredOnly ? " while it wears no armor and no shield" : ""}.`;
    case "unarmored-ac":
      return `While ${who.subject} wears no armor${effect.noShield ? " and no shield" : ""}, ${who.possessive} AC is ${unarmoredFormulaText(effect)}.`;
    case "save-bonus":
      return `${S} gains ${bonusPhrase(formulaText(effect.bonus, definition), `${effect.ability ? `${ABILITY_NAME[effect.ability]} ` : ""}saving throws`)}.`;
    case "save-dc-bonus":
      return `The DCs of ${who.possessive} ${effect.spellsOnly ? "spells" : "saving throw effects"} increase by ${resolveNumericFormula(effect.bonus, definition)}.`;
    case "resource-regain": {
      const amount = resolveNumericFormula(effect.amount, definition);
      const when = effect.timing === "on-activate" ? "when it activates this" : effect.timing === "turn-start" ? "at the start of its turn" : "at the end of its turn";
      return `${S} regains ${amount} ${poolName(effect.resourceId, amount)} ${when}${effect.max ? ` (up to ${effect.max})` : ""}.`;
    }
    case "extra-action":
      return `${S} can take one additional ${effect.slot === "bonus" ? "bonus action" : effect.slot}${gate}.`;
    case "avoids-opportunity-attacks":
      return `${S} doesn't provoke opportunity attacks when it moves${gate}.`;
    case "melee-retaliation":
      return `A creature that hits ${who.object} with a melee attack while within ${effect.withinFt ?? 5} feet of ${who.object} takes ${damageText(effect.damage, definition)}.`;
    case "evasion":
      return `When ${who.subject} makes a Dexterity saving throw to take half damage, it takes no damage on a success and half on a failure.`;
    case "no-critical-hits":
      return `Any critical hit against ${who.object} becomes a normal hit.`;
    case "weapon-mastery":
      return effect.weapons === "all"
        ? `${S} can use the mastery property of every weapon.`
        : `${S} can use the mastery properties of ${joinList(effect.weapons.map((kind) => kind.replace(/-/g, " ")))}.`;
    case "on-hit-option":
      return onHitOptionSentence(effect.option, definition, who);
  }
}

/** "When it hits with a melee weapon attack, it can spend a level 1 spell slot (and its bonus action) to deal an extra 2d8 radiant damage." */
export function onHitOptionSentence(option: OnHitOption, definition: CreatureDefinition, who: Who = IT): string {
  const types = option.attackTypes?.length ? `${joinList(option.attackTypes, "or")} ` : "";
  const what = option.weaponOnly ? `a ${types}weapon attack` : `a ${types}attack`;
  const cost = [option.resourceCost ? costText(option.resourceCost) : "", option.bonusAction ? "its bonus action" : ""].filter(Boolean);
  const spend = cost.length ? ` spend ${cost.join(" and ")} to` : "";
  const effects = option.riders.map((rider) => riderShort(rider, definition, 10, true)).filter(Boolean);
  const once = option.oncePerTurn ? " Once per turn." : "";
  const higher = option.upcast ? ` A higher slot adds ${option.upcast.damageDice} per level.` : "";
  return `When ${who.subject} hits with ${what}, ${who.subject} can${spend} add: ${effects.join(", ")}.${once}${higher}`;
}

const GATE_SHORT: Record<Exclude<FeatureCondition, "always" | "charged">, string> = {
  "self-bloodied": "while bloodied",
  "target-bloodied": "vs bloodied targets",
  "attack-has-advantage": "with advantage",
  "attack-has-no-disadvantage": "without disadvantage",
  "ally-adjacent-to-target": "with an ally next to the target",
  "target-injured": "vs wounded targets",
  "target-surprised": "vs surprised targets",
  "target-grappled-by-self": "vs creatures it grapples"
};

function gateShort(effect: FeatureEffect): string {
  const gates = effect as { condition?: FeatureCondition; allConditions?: FeatureCondition[]; anyConditions?: FeatureCondition[]; chargeFeet?: number };
  const one = (condition: FeatureCondition) => condition === "always" ? "" : condition === "charged" ? `after a ${gates.chargeFeet ?? 20} ft charge` : GATE_SHORT[condition];
  const parts = [
    "targetMarked" in effect && effect.targetMarked ? "vs its mark" : "",
    gates.condition ? one(gates.condition) : "",
    joinList((gates.allConditions ?? []).map(one).filter(Boolean)),
    joinList((gates.anyConditions ?? []).map(one).filter(Boolean), "or")
  ].filter(Boolean);
  return parts.length ? ` ${parts.join(", ")}` : "";
}

/** A feature effect's gist for a list row: "advantage on attacks with an ally next to the target", "resists fire". */
function effectShort(effect: FeatureEffect, definition: CreatureDefinition): string {
  const gate = gateShort(effect);
  const scope = attackScope(effect, definition);
  switch (effect.kind) {
    case "attack-advantage": return `${effect.mode ?? "advantage"} on ${scope}attacks${gate}`;
    case "attack-bonus": return `${formulaText(effect.bonus, definition).replace(/ \(.*\)$/, "")} to hit${gate}`;
    case "critical-range": return `${scope}crits on ${effect.minimum}–20${gate}`;
    case "d20-change": {
      const failed = effect.onNatural1 ? "a 1" : joinList(effect.rolls.map((roll) => (roll === "save" ? "a failed save" : "a miss")), "or");
      const does = effect.change === "reroll" ? `reroll${effect.bonus ? ` +${formulaText(effect.bonus, definition).replace(/ \(.*\)$/, "").replace(/^\+/, "")}` : ""}`
        : effect.change === "add" ? `+${effect.dice ?? "1d4"}` : effect.change === "twenty" ? "a 20" : "a hit";
      return `${does} on ${failed}${effect.resourceCost ? ` (${costText(effect.resourceCost, definition)})` : ""}${effect.oncePerTurn ? ", once a turn" : ""}`;
    }
    case "initiative": return joinList([...(effect.advantage ? ["advantage on Initiative"] : []), ...(effect.bonus ? [`${formulaText(effect.bonus, definition).replace(/ \(.*\)$/, "")} to Initiative`] : [])]) || "Initiative";
    case "incoming-attack-modifier": return `${effect.amount >= 5 ? "attackers have advantage" : effect.amount <= -5 ? "attackers have disadvantage" : `attackers ${signed(effect.amount)}`}${gate}`;
    case "damage-bonus": return `+${damageShort(effect.damage, definition)} on ${scope}hits${effect.oncePerTurn ? " once a turn" : ""}${gate}`;
    case "save-gated-damage": return `+${damageShort(effect.damage, definition)} on ${scope}hits${gate}, DC${effect.save.dc ? ` ${effect.save.dc}` : ""} ${effect.save.ability.toUpperCase()} ${effect.save.halfDamageOnSuccess ? "halves" : "negates"}`;
    case "apply-condition-on-hit": {
      const applied = effect.appliedCondition;
      const name = applied.name && applied.name !== "custom" ? applied.name : applied.effects?.length || applied.modifiers ? "marked" : "a condition";
      return `hits: ${effect.save ? `DC${effect.save.dc ? ` ${effect.save.dc}` : ""} ${effect.save.ability.toUpperCase()} or ` : ""}${name}${gate}`;
    }
    case "incoming-hit-damage": return `${effect.onlyFromSource ? "the marker " : ""}hitting it: ${damageShort(effect.damage, definition)}`;
    case "damage-adjustment":
      return `${adjustmentShorts([effect.adjustment])[0]}${effect.adjustment.nonMagicalOnly ? " (nonmagical)" : ""}${gate}`;
    case "save-advantage": return `advantage on ${effect.ability ? `${effect.ability.toUpperCase()} ` : ""}saves${effect.against?.source ? ` vs ${effect.against.source === "spell" ? "spells" : "magic"}` : effect.against?.conditions?.length ? ` vs ${joinList(effect.against.conditions, "or")}` : ""}${gate}`;
    case "hp-regen": return `regains ${effect.amount} HP a turn${effect.suppressedByDamageTypes?.length ? ` (not after ${joinList(effect.suppressedByDamageTypes, "or")})` : ""}`;
    case "survive-lethal": return "drops to 1 HP instead of 0";
    case "auto-succeed-save": return "can turn a failed save into a success";
    case "split-on-damage": return `splits when hit by ${joinList(effect.triggerDamageTypes, "or")}`;
    case "swarm-damage": return "less damage when bloodied";
    case "armor-class-bonus": return `${formulaText(effect.bonus, definition).replace(/ \(.*\)$/, "")} AC${effect.unarmoredOnly ? " (no armor or shield)" : ""}`;
    case "unarmored-ac": return `AC ${unarmoredFormulaText(effect, true)} without armor${effect.noShield ? " or shield" : ""}`;
    case "save-bonus": return `${formulaText(effect.bonus, definition).replace(/ \(.*\)$/, "")} ${effect.ability ? `${effect.ability.toUpperCase()} ` : ""}saves`;
    case "save-dc-bonus": return `${signed(resolveNumericFormula(effect.bonus, definition))} save DCs`;
    case "resource-regain": return `regains ${poolName(effect.resourceId)}`;
    case "extra-action": return `one more ${effect.slot === "bonus" ? "bonus action" : effect.slot}`;
    case "avoids-opportunity-attacks": return `no opportunity attacks${gate}`;
    case "melee-retaliation": return `hitting it in melee: ${damageShort(effect.damage, definition)}`;
    case "evasion": return "evasion";
    case "no-critical-hits": return "no critical hits against it";
    case "weapon-mastery": return effect.weapons === "all" ? "masters every weapon" : `masters ${effect.weapons.map((kind) => kind.replace(/-/g, " ")).join(", ")}`;
    case "on-hit-option": return `on a hit: ${effect.option.name}`;
  }
}

/** "10 + its Dexterity modifier + its Constitution modifier"; short: "10 + DEX + CON". */
function unarmoredFormulaText(effect: Extract<FeatureEffect, { kind: "unarmored-ac" }>, short = false): string {
  return [String(effect.base), ...effect.abilities.map((ability) => (short ? ability.toUpperCase() : `its ${ABILITY_NAME[ability]} modifier`))].join(" + ");
}

/** "resists bludgeoning, piercing, and slashing", "immune to poison". */
function adjustmentShorts(adjustments: DamageAdjustment[]): string[] {
  const byType = new Map<DamageAdjustment["type"], string[]>();
  for (const adjustment of adjustments) byType.set(adjustment.type, [...(byType.get(adjustment.type) ?? []), adjustment.damageType]);
  return [...byType].map(([type, types]) => type === "absorb" ? `${joinList(types, "or")} heals it`
    : `${type === "resistance" ? "resists" : type === "immunity" ? "immune to" : "vulnerable to"} ${joinList(types)}`);
}

/** Feature effects as list-row phrases, with ungated damage adjustments folded together. */
export function effectShorts(effects: FeatureEffect[] | undefined, definition: CreatureDefinition): string[] {
  const plain = (effects ?? []).filter((effect): effect is Extract<FeatureEffect, { kind: "damage-adjustment" }> => effect.kind === "damage-adjustment" && !gateShort(effect));
  return [
    ...(effects ?? []).filter((effect) => !plain.includes(effect as never)).map((effect) => effectShort(effect, definition)),
    ...adjustmentShorts(plain.map((effect) => effect.adjustment))
  ];
}

/** A condition's modifiers as list-row phrases: "+5 AC", "speed ×2", "resists fire". */
export function modifierShorts(modifiers: ConditionModifiers | undefined): string[] {
  if (!modifiers) return [];
  const saves = saveBonusPhrases(modifiers.savingThrows).map((phrase) => phrase.replace(/^an? ([+-]\d+) (bonus|penalty) to /, "$1 ").replace("saving throws", "saves"));
  return [
    ...(modifiers.armorClass ? [`${signed(modifiers.armorClass)} AC`] : []),
    ...(modifiers.attackRoll ? [`${signed(modifiers.attackRoll)} to hit`] : []),
    ...saves,
    // Speed is divided by the multiplier (see `modifierSentences`).
    ...(modifiers.movementMultiplier !== undefined && modifiers.movementMultiplier > 1
      ? [modifiers.movementMultiplier >= 999 ? "can't move" : modifiers.movementMultiplier === 2 ? "half speed" : `speed ÷${modifiers.movementMultiplier}`]
      : []),
    ...adjustmentShorts(modifiers.damageAdjustments ?? []),
    ...(modifiers.deniesActions || modifiers.deniesBonusActions || modifiers.deniesReactions
      ? [`no ${joinList([modifiers.deniesActions ? "actions" : "", modifiers.deniesBonusActions ? "bonus actions" : "", modifiers.deniesReactions ? "reactions" : ""].filter(Boolean), "or")}`]
      : []),
    ...(modifiers.incomingAttackRoll ? [modifiers.incomingAttackRoll >= 5 ? "attackers have advantage" : modifiers.incomingAttackRoll <= -5 ? "attackers have disadvantage" : `attackers ${signed(modifiers.incomingAttackRoll)}`] : []),
    ...(modifiers.forcesRandomAction ? ["acts at random"] : [])
  ];
}

/** Feature effects as sentences, with damage adjustments that share a kind folded into one. */
function effectSentences(effects: FeatureEffect[] | undefined, definition: CreatureDefinition, who: Who = IT): string[] {
  const sentences: string[] = [];
  const adjustments: DamageAdjustment[] = [];
  const flush = () => {
    if (adjustments.length) sentences.push(...adjustmentSentences(adjustments.splice(0), who));
  };
  for (const effect of effects ?? []) {
    if (effect.kind === "damage-adjustment" && !gateText(effect)) {
      adjustments.push(effect.adjustment);
      continue;
    }
    flush();
    sentences.push(effectSentence(effect, definition, who));
  }
  flush();
  return sentences;
}

/** One editor card's sentence: a folded resistance card says all its damage types at once. */
export function effectCardSentence(effect: FeatureEffect, definition: CreatureDefinition, damageTypes?: DamageAdjustment["damageType"][]): string {
  if (effect.kind === "damage-adjustment" && damageTypes && damageTypes.length > 1) {
    return adjustmentSentences(damageTypes.map((damageType) => ({ ...effect.adjustment, damageType })), IT, gateText(effect))[0]!;
  }
  return effectSentence(effect, definition);
}

/** A condition's modifiers as sentences about the creature that has it ("It gains a +5 bonus to AC."). */
export function modifiersSentence(modifiers: ConditionModifiers | undefined): string {
  return modifierSentences(modifiers, IT).join(" ");
}

/** Sentences as one run, the first word lowercased to follow a colon. */
const afterColon = (sentences: string[]): string => uncapitalize(sentences.join(" "));

/* ─── reactions ──────────────────────────────────────────────────────────── */

export function triggerText(trigger: ReactionTrigger): string {
  switch (trigger.kind) {
    case "enemy-leaves-reach": return "an enemy leaves its reach";
    case "targeted-by-attack": return `it is targeted by ${trigger.meleeOnly ? "a melee" : "an"} attack`;
    case "would-be-hit": return `${trigger.meleeOnly ? "a melee" : "an"} attack would hit it`;
    case "hit-by-attack": return `it is hit by ${trigger.meleeOnly ? "a melee" : "an"} attack`;
    case "would-take-damage":
      return `it would take ${trigger.damageTypes?.length ? `${joinList(trigger.damageTypes, "or")} ` : ""}damage${trigger.attackOnly ? " from an attack roll" : ""}`;
    case "ally-targeted-by-attack": return `an ally within ${trigger.withinFt} feet is targeted by an attack`;
    case "enemy-casts-spell": return `an enemy within ${trigger.withinFt} feet casts a spell${trigger.maxSpellLevel ? ` of ${ordinal(trigger.maxSpellLevel)} level or lower` : ""}`;
    case "manual": return trigger.note ? uncapitalize(trigger.note.replace(/\.$/, "")) : "something described happens";
  }
}

/** Who a single-target effect lands on: a reaction's triggering creature, or one creature in range. */
function singleSubject(action: ActionDefinition, range: number): string {
  const reaction = "reaction" in action && action.actionType === "reaction" ? action.reaction : undefined;
  if (reaction?.target === "self") return "It";
  if (reaction?.target === "trigger-target") return "The attack's target";
  if (reaction) return "The triggering creature";
  return range <= 5 ? "A creature it touches" : `One creature within ${range} feet`;
}

/* ─── actions ────────────────────────────────────────────────────────────── */

interface Body {
  text: string;
  short: string;
  notSimulated: string[];
}

function attackBody(action: AttackAction, definition: CreatureDefinition): Body {
  const bonus = resolveAttackBonus(action, definition);
  const melee = action.attackType === "melee" || (action.attackType === "spell" && action.range <= 5);
  const reach = action.attackType === "melee" ? action.reach ?? action.range : 5;
  const distance = melee ? `reach ${reach} ft.` : `range ${action.range}${action.longRange ? `/${action.longRange}` : ""} ft.`;
  const kind = `${melee ? "Melee" : "Ranged"} ${action.attackType === "spell" ? "Spell" : "Weapon"}`;
  const riders = action.riders ?? [];
  // A rider save with no DC of its own uses 8 + the attack's ability modifier + proficiency.
  const riderFallbackDc = 8 + abilityModifier(definition.abilities[action.ability]) + (definition.proficiencyBonus ?? proficiencyFromDefinition(definition));
  const beams = action.attackDelivery === "beams"
    ? resolveBeamCount(action, definition.character?.level ?? 1, spellSlotLevel(action.resourceCost?.resourceId))
    : 1;

  // Extra damage on every hit reads as part of the hit; anything qualified (once per turn, a charge) gets its own sentence.
  const plainDamageRider = (rider: ActionRider): rider is Extract<ActionRider, { kind: "damage" }> =>
    rider.kind === "damage" && rider.when === "on-hit" && !riderQualifiers(rider);
  const hitDamage = [...action.damage, ...riders.filter(plainDamageRider).flatMap((rider) => rider.components)]
    .filter((component) => rolled(component, definition).expression || rolled(component, definition).average > 0);
  const onHit = riders.filter((rider) => rider.kind !== "note" && !plainDamageRider(rider) && (rider.when === "on-hit" || rider.when === "always"));
  const later = riders.filter((rider): rider is Exclude<ActionRider, { kind: "note" }> => rider.kind !== "note" && (rider.when === "on-crit" || rider.when === "on-miss"));

  let head: string;
  if (action.autoHit) {
    head = beams === 1
      ? `A dart hits a creature of its choice within ${action.range} feet automatically.`
      : `${capitalize(countWord(beams))} darts each hit a creature of its choice within ${action.range} feet automatically.`;
  } else if (beams > 1) {
    head = `It makes ${countWord(beams)} ${kind.toLowerCase()} attacks: ${signed(bonus)} to hit, ${distance}, one target each.`;
  } else {
    head = `${kind} Attack: ${signed(bonus)} to hit, ${distance}, one target.`;
  }
  const hitSentences = onHit.map((rider) => riderSentence(rider, definition, riderFallbackDc, true, THE_TARGET)).filter(Boolean);
  let hit = "";
  if (hitDamage.length) {
    hit = ` ${action.autoHit ? "Each deals" : "Hit:"} ${damageText(hitDamage, definition)}.${hitSentences.length ? ` ${hitSentences.join(" ")}` : ""}`;
  } else if (hitSentences.length) {
    hit = ` Hit: ${hitSentences.join(" ")}`;
  } else if (!action.autoHit) {
    hit = " Hit: no damage.";
  }
  const extra = later.map((rider) => {
    const sentence = riderSentence(rider, definition, riderFallbackDc, true, THE_TARGET);
    return ` ${rider.when === "on-crit" ? "On a critical hit" : "On a miss"}, ${uncapitalize(sentence)}`;
  }).join("");

  const shortParts = [
    action.autoHit ? `${beams} auto-${plural(beams, "hit")}, ${action.range} ft` : `${beams > 1 ? `${beams} × ` : ""}${signed(bonus)} to hit, ${distance.replace(/\.$/, "")}`,
    hitDamage.length ? damageShort(hitDamage, definition) : "",
    ...onHit.map((rider) => riderShort(rider, definition, riderFallbackDc, true))
  ].filter(Boolean);
  const required = action.requiresTargetCondition ? ` that is ${action.requiresTargetCondition}` : "";
  const limit = (action.onlyAfter === "charge-hit" ? ` It can target only a creature its charge hit this turn${required}.` : required ? ` It can target only a creature${required}.` : "")
    + (action.onlyAfter === "dropped-creature" ? " It can be used only after it reduces a creature to 0 hit points this turn." : "");
  return { text: `${head}${hit}${extra}${limit}`, short: shortParts.join(" · "), notSimulated: notesOf(riders) };
}

/** The area as a thing: "a 20-foot-radius sphere centered on a point within 150 feet", "a 60-foot cone". */
function areaShape(action: AreaAction): string {
  const { area } = action;
  const self = (action.targeting?.origin ?? "point") === "self";
  const fromSelf = self || action.targeting?.aimedFromSelf;
  const range = action.targeting?.range ?? action.range;
  switch (area.type) {
    case "circle": return self ? `the area within ${area.size} feet of it` : `a ${area.size}-foot-radius sphere centered on a point within ${range} feet`;
    case "square": return self ? `a ${area.size}-foot cube around it` : `a ${area.size}-foot cube within ${range} feet`;
    case "cone": return `a ${area.size}-foot cone`;
    case "line": return `a ${area.size}-foot line that is ${area.width ?? 5} feet wide`;
    case "rectangle": {
      const width = area.width ?? 5;
      if (width !== area.size) return `a ${area.size}-foot line that is ${width} feet wide`;
      return fromSelf ? `a ${area.size}-foot cube originating from it` : `a ${area.size}-foot cube within ${range} feet`;
    }
  }
}

/** Where "each creature" is: "within 10 feet of it", "in a 60-foot cone". */
function areaWhere(action: AreaAction): string {
  const self = (action.targeting?.origin ?? "point") === "self";
  return action.area.type === "circle" && self ? `within ${action.area.size} feet of it` : `in ${areaShape(action)}`;
}

export function areaShort(action: AreaAction): string {
  const { area } = action;
  const self = (action.targeting?.origin ?? "point") === "self";
  switch (area.type) {
    case "circle": return self ? `${area.size} ft around it` : `${area.size}-ft sphere within ${action.targeting?.range ?? action.range} ft`;
    case "square": return `${area.size}-ft cube`;
    case "cone": return `${area.size}-ft cone`;
    case "line": return `${area.size}-ft line`;
    case "rectangle": return (area.width ?? 5) === area.size ? `${area.size}-ft cube` : `${area.size}-ft line`;
  }
}

/**
 * "must make a DC 21 Dexterity saving throw, taking 63 (18d6) fire damage on a failed save, or half as much damage on a
 * successful one." `lead` is who makes it ("Each creature in a 60-foot cone"); `who` is how later sentences refer to
 * one of them.
 */
function saveClause(action: SaveAction | AreaAction, definition: CreatureDefinition, lead: string, who: Who): { text: string; short: string } {
  const dc = resolveSaveDc(action, definition);
  const ability = ABILITY_NAME[action.saveAbility];
  const onSuccess = action.onSuccess ?? (action.halfDamageOnSuccess ? "half" : "none");
  const riders = action.riders ?? [];
  const failConditions = riders.filter((rider): rider is ConditionRider => rider.kind === "condition" && rider.when === "on-save-fail");
  const failDamage = riders.flatMap((rider) => (rider.kind === "damage" && rider.when === "on-save-fail" && !riderQualifiers(rider) ? rider.components : []));
  const folded = new Set<ActionRider>([...failConditions, ...riders.filter((rider) => rider.kind === "damage" && rider.when === "on-save-fail" && !riderQualifiers(rider))]);
  const damage = [...action.damage, ...failDamage];
  const conditions = joinList(failConditions.map((rider) => `${beCondition(rider, definition)}${riderQualifiers(rider)}`));

  let text: string;
  if (damage.length && onSuccess === "half") {
    // "On a failed save, a creature is also poisoned for 1 minute."
    const alsoIs = joinList(failConditions.map((rider) => `${isCondition(rider, definition)}${riderQualifiers(rider)}`)).replace(/^is /, "is also ");
    text = `must make a DC ${dc} ${ability} saving throw, taking ${damageText(damage, definition)} on a failed save, or half as much damage on a successful one.`
      + (failConditions.length ? ` On a failed save, ${who.subject} ${alsoIs}.` : "");
  } else if (damage.length) {
    text = `must succeed on a DC ${dc} ${ability} saving throw or take ${damageText(damage, definition)}${failConditions.length ? ` and ${conditions}` : ""}.`;
  } else if (failConditions.length) {
    text = `must succeed on a DC ${dc} ${ability} saving throw or ${conditions}.`;
  } else {
    text = `must make a DC ${dc} ${ability} saving throw.`;
  }
  const repeat = failConditions.map((rider) => repeatSaveText(rider.duration, who)).find(Boolean) ?? "";
  const unfolded = riders.filter((rider) => rider.kind !== "note" && !folded.has(rider));
  const others = unfolded
    .map((rider) => {
      const sentence = riderSentence(rider, definition, dc, false, who);
      const when = rider.kind === "note" ? "always" : rider.when;
      return when === "on-save-fail" ? ` On a failed save, ${uncapitalize(sentence)}`
        : when === "on-save-success" ? ` On a successful save, ${uncapitalize(sentence)}`
          : ` ${sentence}`;
    })
    .join("");
  const immune = action.immuneAfterSave ? " A creature that succeeds is immune to this for the rest of the fight." : "";

  const consequences = [
    damage.length ? `${damageShort(damage, definition)}${onSuccess === "half" ? ", half on save" : ""}` : "",
    failConditions.length ? failConditions.map((rider) => conditionName(rider.condition)).join(", ") : "",
    ...unfolded.map((rider) => riderShort(rider, definition, dc, false))
  ].filter(Boolean);
  const short = consequences.length ? [`DC ${dc} ${action.saveAbility.toUpperCase()}`, ...consequences].join(" · ") : "";
  return { text: `${lead} ${text}${repeat}${others}${immune}`, short };
}

function zoneLasts(zone: ZonePersistence): string {
  return zone.duration.kind === "rounds" ? `for ${roundsText(zone.duration.rounds)}` : zone.duration.kind === "concentration" ? "while it concentrates" : "until the fight ends";
}

function zoneTriggers(zone: ZonePersistence): string[] {
  return zone.trigger.map((trigger) => (trigger === "on-enter" ? "enters the area" : trigger === "start-of-turn-in-zone" ? "starts its turn there" : "ends its turn there"));
}

/** What a standing area does besides its save: moving damage, terrain, drift. */
function zoneExtras(zone: ZonePersistence, definition: CreatureDefinition): string {
  return (zone.movementDamage ? ` A creature takes ${damageText([{ dice: zone.movementDamage.dice, damageType: zone.movementDamage.damageType }], definition)} for every 5 feet it moves in the area.` : "")
    + (zone.terrain ? ` The area is ${zone.terrain.type === "impassable" ? "impassable" : "difficult terrain"}.` : "")
    + (zone.blocksSight ? " The area is heavily obscured." : "")
    + (zone.anchor === "self" ? " The area moves with it." : "")
    + (zone.movement ? ` At the start of each of its turns, the area moves ${zone.movement.driftFeetPerCasterTurn} feet away from it.` : "")
    + (zone.repositionable ? ` As a bonus action, it can move the area up to ${zone.repositionable.maxFeetPerCasterTurn} feet.` : "");
}

function areaBody(action: AreaAction, definition: CreatureDefinition): Body {
  const who = action.affects === "hostile" ? "enemy" : "creature";
  const zone = action.zone;
  const notSimulated = notesOf(action.riders);
  if (!zone) {
    const clause = saveClause(action, definition, `Each ${who} ${areaWhere(action)}`, A_CREATURE);
    return { text: clause.text, short: [areaShort(action), clause.short || `DC ${resolveSaveDc(action, definition)} ${action.saveAbility.toUpperCase()}`].join(" · "), notSimulated };
  }
  const triggers = zoneTriggers(zone);
  const affected = `${who === "enemy" ? "An enemy" : "A creature"} that ${joinList(triggers, "or")}`;
  let text: string;
  if (zone.applyOnCast) {
    const clause = saveClause(action, definition, `Each ${who} ${areaWhere(action)}`, A_CREATURE);
    text = `${clause.text} The area remains ${zoneLasts(zone)}.`
      + (triggers.length ? ` ${affected} makes the same saving throw.` : "");
  } else {
    const clause = saveClause(action, definition, affected, A_CREATURE);
    text = `It fills ${areaShape(action)} ${zoneLasts(zone)}.${triggers.length ? ` ${clause.text}` : ""}`;
  }
  const short = [
    `${areaShort(action)}, lingering`,
    triggers.length || zone.applyOnCast ? saveClause(action, definition, "", A_CREATURE).short : "",
    zone.movementDamage ? `${rolledText(rolled({ dice: zone.movementDamage.dice, damageType: zone.movementDamage.damageType }, definition))} ${zone.movementDamage.damageType} per 5 ft moved` : ""
  ].filter(Boolean).join(" · ");
  return { text: text + zoneExtras(zone, definition), short, notSimulated };
}

function saveBody(action: SaveAction, definition: CreatureDefinition): Body {
  const self = action.targeting?.target === "self";
  const clause = saveClause(action, definition, self ? "It" : singleSubject(action, action.range), self ? IT : THE_TARGET);
  return { text: clause.text, short: clause.short || `DC ${resolveSaveDc(action, definition)} ${action.saveAbility.toUpperCase()}`, notSimulated: notesOf(action.riders) };
}

function healingBody(action: Extract<ActionDefinition, { kind: "healing" }>, definition: CreatureDefinition): Body {
  const amount = healingText(action.healing, definition);
  const mode = action.targeting?.target ?? "single";
  let text: string;
  if (mode === "self") text = `It regains ${amount} hit points.`;
  else if (mode === "chosen") text = `Up to ${countWord(action.targeting?.count ?? 1)} creatures within ${action.range} feet each regain ${amount} hit points.`;
  else if (mode === "area" && action.area) {
    const size = action.area.type === "circle" ? `${action.area.size}-foot-radius sphere` : `${action.area.size}-foot ${action.area.type}`;
    text = `Each ally in a ${size} within ${action.areaTargeting?.range ?? action.range} feet regains ${amount} hit points.`;
  } else text = `${singleSubject(action, action.range)} regains ${amount} hit points.`;
  const riders = (action.riders ?? []).filter((rider) => rider.kind !== "note");
  if (riders.length) {
    const fallbackDc = 8 + (definition.proficiencyBonus ?? proficiencyFromDefinition(definition));
    text += ` ${riders.map((rider) => riderSentence(rider, definition, fallbackDc, true, mode === "chosen" ? EACH_TARGET : THE_TARGET)).join(" ")}`;
  }
  const who = mode === "self" ? "self" : mode === "chosen" ? `up to ${action.targeting?.count ?? 1}` : mode === "area" ? "area" : `${action.range} ft`;
  return { text, short: `heals ${amount} · ${who}`, notSimulated: notesOf(action.riders) };
}

/** A mark (Hunter's Mark, Hex), or the action that moves one. */
function markBody(action: Extract<ActionDefinition, { kind: "buff" }>, definition: CreatureDefinition, inSpell: boolean): Body {
  const mark = action.mark!;
  if (mark.moving) {
    return { text: `It moves its mark from a creature that has dropped to another within ${action.range} feet.`, short: `move the mark · ${action.range} ft`, notSimulated: [] };
  }
  const damage = (action.appliedCondition.effects ?? []).flatMap((effect) => (effect.kind === "incoming-hit-damage" ? effect.damage : []));
  const lasts = action.appliedCondition.durationRounds ? ` for ${roundsText(action.appliedCondition.durationRounds)}` : "";
  const text = `It marks one creature within ${action.range} feet${lasts}${damage.length ? `: its hits on that creature deal an extra ${damageText(damage, definition)}` : ""}.`
    + ` If the creature drops, ${mark.moveWith === "action" ? "an action" : "a bonus action"} moves the mark to another.`
    + (action.concentration && !inSpell ? " Concentration." : "")
    + (mark.keepsConcentrationOnDamage ? " Taking damage doesn't break concentration on it." : "");
  const short = [damage.length ? `+${damageShort(damage, definition)} on its hits` : "mark", `${action.range} ft`].join(" · ");
  return { text, short, notSimulated: [] };
}

function buffBody(action: Extract<ActionDefinition, { kind: "buff" }>, definition: CreatureDefinition, inSpell: boolean): Body {
  if (action.mark) return markBody(action, definition, inSpell);
  const condition = action.appliedCondition;
  const mode = action.targeting?.target ?? "single";
  const chosen = mode === "chosen";
  const lead = mode === "self" ? "It" : chosen ? `Up to ${countWord(action.targeting?.count ?? 1)} creatures within ${action.range} feet` : singleSubject(action, action.range);
  const verb = chosen ? "each gain" : "gains";
  const lasts = condition.durationRounds ? ` for ${roundsText(condition.durationRounds)}` : "";
  const modifiers = condition.modifiers ?? {};
  // Plain bonuses read as one "gains …" phrase; anything else gets sentences.
  const gains = [
    ...(modifiers.armorClass ? [bonusPhrase(modifiers.armorClass, "AC")] : []),
    ...(modifiers.attackRoll ? [bonusPhrase(modifiers.attackRoll, "attack rolls")] : []),
    ...saveBonusPhrases(modifiers.savingThrows),
    ...(action.tempHp?.length ? [`${healingText(action.tempHp, definition)} temporary hit points`] : [])
  ];
  const who = mode === "self" ? IT : chosen ? EACH_TARGET : THE_TARGET;
  const others = [
    ...modifierSentences({ ...modifiers, armorClass: undefined, attackRoll: undefined, savingThrows: undefined }, who),
    ...effectSentences(condition.effects, definition, who)
  ];
  let text: string;
  if (!others.length) text = `${lead} ${verb} ${gains.length ? joinList(gains) : "a benefit"}${lasts}.`;
  else if (mode === "self" && !gains.length && others.length === 1) text = withDuration(others[0]!, lasts);
  else {
    const benefits = [...(gains.length ? [`${capitalize(who.subject)} gains ${joinList(gains)}.`] : []), ...others];
    text = `${lead} ${verb} these benefits${lasts}: ${afterColon(benefits)}`;
  }
  text += (action.concentration && !inSpell ? " Concentration." : "") + (action.prepOnly ? " Cast before combat." : "");
  const summary = [
    ...modifierShorts(modifiers),
    ...(action.tempHp?.length ? [`${healingText(action.tempHp, definition)} temp HP`] : []),
    ...effectShorts(condition.effects, definition)
  ];
  const short = [
    summary.join(", ") || "buff",
    mode === "self" ? "self" : chosen ? `up to ${action.targeting?.count ?? 1} creatures` : `${action.range} ft`,
    condition.durationRounds ? roundsText(condition.durationRounds) : ""
  ].filter(Boolean).join(" · ");
  return { text, short, notSimulated: [] };
}

/** The feature an activation belongs to, wherever it lives. */
function featureById(definition: CreatureDefinition, featureId: string): FeatureDefinition | undefined {
  return [...(definition.features ?? []), ...(definition.traits ?? [])].find((feature) => feature.id === featureId);
}

/** What happening the moment a feature activates does: "take one additional action", "regain 2 ki points". */
function onActivatePhrases(feature: FeatureDefinition | undefined, definition: CreatureDefinition): string[] {
  return (feature?.effects ?? []).flatMap((effect) => {
    if (effect.kind === "extra-action") return [`take one additional ${effect.slot === "bonus" ? "bonus action" : effect.slot}`];
    if (effect.kind === "resource-regain" && effect.timing === "on-activate") {
      const amount = resolveNumericFormula(effect.amount, definition);
      return [`regain ${amount} ${poolName(effect.resourceId, amount)}`];
    }
    return [];
  });
}

/** What a damage-cutting reaction does to the damage (Uncanny Dodge, Deflect Attacks, Superior Hunter's Defense). */
function damageCutText(cut: NonNullable<ActivateAction["damageCut"]>): { text: string; short: string } {
  if (cut.kind === "halve") return { text: "It halves the damage.", short: "halves the damage" };
  if (cut.kind === "resist") {
    return { text: "It has resistance to that damage, and any other of its type, until the end of the turn.", short: "resists it this turn" };
  }
  const roll = [cut.dice, ...(cut.abilityModifier ? [`its ${ABILITY_NAME[cut.abilityModifier]} modifier`] : []), ...(cut.bonus ? [String(cut.bonus)] : [])].join(" + ");
  return { text: `It reduces the damage by ${roll}.`, short: `−${[cut.dice, ...(cut.abilityModifier ? [cut.abilityModifier.toUpperCase()] : []), ...(cut.bonus ? [String(cut.bonus)] : [])].join("+")} damage` };
}

/** What an activation does: its immediate effect and the state it puts the creature in. */
function activationText(action: ActivateAction, definition: CreatureDefinition, feature = featureById(definition, action.featureId)): { text: string; short: string } {
  if (action.damageCut) return damageCutText(action.damageCut);
  const now = onActivatePhrases(feature, definition);
  const lasting = [...modifierSentences(action.condition?.modifiers, IT), ...effectSentences(action.condition?.effects, definition, IT)];
  // A reaction's own "lasts for" (a Parry's one attack, Shield's until its next turn) wins over the condition's rounds.
  const lastsFor = action.actionType === "reaction" ? action.reaction?.lastsFor : undefined;
  const lasts = lastsFor === "triggering-attack" ? " against that attack"
    : lastsFor === "until-start-of-next-turn" ? " until the start of its next turn"
      : action.condition?.durationRounds ? ` for ${roundsText(action.condition.durationRounds)}` : "";
  const nowText = now.length ? `It can ${joinList(now)}.` : "";
  if (!lasting.length) {
    return { text: nowText || "It activates this.", short: now.length ? joinList(now) : "activates" };
  }
  const state = lasting.length === 1 ? withDuration(lasting[0]!, lasts) : `It gains these benefits${lasts}: ${afterColon(lasting)}`;
  const shorts = [...modifierShorts(action.condition?.modifiers), ...effectShorts(action.condition?.effects, definition)];
  return {
    text: [nowText, state].filter(Boolean).join(" "),
    short: [...now, `${shorts.join(", ")}${lasts}`].join(" · ")
  };
}

type MultiattackAction = Extract<ActionDefinition, { kind: "multiattack" }>;

/** "Claws", "Dagger (Melee)" → "claws", "dagger": an attack as a statblock names it inside a sentence. */
function attackWord(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*/g, " ").trim().toLowerCase();
}

/** Weapons a creature carries one of: "two with its longsword" (where claws and tentacles come in pairs). */
const CARRIED_WEAPON = /\b(?:axe|battleaxe|blowgun|bow|club|crossbow|dagger|dart|flail|fork|glaive|greataxe|greatclub|greatsword|halberd|hammer|handaxe|harpoon|javelin|lance|longbow|longsword|mace|maul|morningstar|net|pick|pike|quarterstaff|rapier|scimitar|scythe|shield|shortbow|shortsword|sickle|sling|spear|staff|sword|trident|warhammer|whip)$/;

/** Attacks a statblock names with a verb: "one to constrict", "use its Swallow". */
const VERB_ATTACK = /^(?:constrict|engulf|fling|reel|swallow)$/;

/** "claw" → "claws" for two of them; a name already plural ("claws", "tentacles") and a carried weapon stay. */
function pluralWord(word: string, count: number): string {
  if (count === 1 || /s$/.test(word) || CARRIED_WEAPON.test(word)) return word;
  if (/(ch|sh|x)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** Once, twice, three times. */
const timesWord = (n: number): string => (n === 1 ? "once" : n === 2 ? "twice" : `${countWord(n)} times`);

const GENERIC_WORDS: Record<NonNullable<MultiattackStep["any"]>, string> = { melee: "melee", ranged: "ranged", weapon: "weapon" };

/** How a routine's step reads: a kind of attack ("melee"), an ability it uses (Hurl Flame, Swallow), or an attack it makes. */
type StepReading =
  | { kind: "generic"; any: NonNullable<MultiattackStep["any"]> }
  | { kind: "used"; name: string }
  | { kind: "verb"; word: string }
  | { kind: "attack"; word: string; ranged: boolean };

function readStep(step: MultiattackStep, byId: Map<string, ActionDefinition>): StepReading {
  if (step.any) return { kind: "generic", any: step.any };
  const action = byId.get(step.actionId!);
  const name = action?.name ?? step.actionId!;
  const word = attackWord(name);
  if (action && (action.kind !== "attack" || action.attackType === "spell")) return { kind: "used", name };
  if (VERB_ATTACK.test(word)) return { kind: "verb", word };
  return { kind: "attack", word, ranged: action?.kind === "attack" && action.attackType === "ranged" };
}

/**
 * One step on its own: "makes two melee attacks", "makes three attacks", "makes two scimitar attacks", "makes one attack
 * with its tentacles", "uses its Hurl Flame twice". `rangedQualifier` says "ranged" for a ranged attack offered beside
 * melee ones ("or two ranged attacks with its longbow").
 */
function stepPhrase(step: MultiattackStep, byId: Map<string, ActionDefinition>, rangedQualifier = false): string {
  const reading = readStep(step, byId);
  const n = step.count;
  switch (reading.kind) {
    case "generic": return `makes ${countWord(n)} ${reading.any === "weapon" ? "" : `${GENERIC_WORDS[reading.any]} `}${plural(n, "attack")}`;
    case "used": return `uses its ${reading.name}${n > 1 ? ` ${timesWord(n)}` : ""}`;
    case "verb": return n > 1 ? `makes ${countWord(n)} ${reading.word} attacks` : `uses its ${capitalize(reading.word)}`;
    case "attack":
      if (rangedQualifier && reading.ranged) return `makes ${countWord(n)} ranged ${plural(n, "attack")} with its ${pluralWord(reading.word, n)}`;
      // "one tentacles attack" doesn't read: a plural name says what it attacks with.
      return /s$/.test(reading.word)
        ? `makes ${countWord(n)} ${plural(n, "attack")} with its ${reading.word}`
        : `makes ${countWord(n)} ${reading.word} ${plural(n, "attack")}`;
  }
}

/** One step inside a listed routine: "two with its claws", "one to constrict", "two melee attacks", "one with its Hurl Flame". */
function listedPhrase(step: MultiattackStep, byId: Map<string, ActionDefinition>): string {
  const reading = readStep(step, byId);
  const n = countWord(step.count);
  switch (reading.kind) {
    case "generic": return `${n} ${GENERIC_WORDS[reading.any]} ${plural(step.count, "attack")}`;
    case "used": return `${n} with its ${reading.name}`;
    case "verb": return `${n} to ${reading.word}`;
    case "attack": return `${n} with its ${pluralWord(reading.word, step.count)}`;
  }
}

/** A step as a noun, for rules and replacements: "bite attack", "two claw attacks", "melee attack". */
function stepNoun(step: MultiattackStep, count: number, byId: Map<string, ActionDefinition>): string {
  const reading = readStep(step, byId);
  const word = reading.kind === "generic" ? GENERIC_WORDS[reading.any] : reading.kind === "used" ? reading.name : reading.word;
  return `${word} ${plural(count, "attack")}`;
}

/** "makes two melee attacks", "makes two scimitar attacks", "makes three attacks: one with its bite and two with its claws". */
function attacksPhrase(steps: MultiattackStep[], byId: Map<string, ActionDefinition>): { text: string; listed: boolean } {
  if (steps.length === 1) return { text: stepPhrase(steps[0]!, byId), listed: false };
  const total = steps.reduce((sum, step) => sum + step.count, 0);
  return { text: `makes ${countWord(total)} attacks: ${joinList(steps.map((step) => listedPhrase(step, byId)))}`, listed: true };
}

/**
 * A routine read the way a statblock prints it: the abilities it opens with, its attacks, the abilities it uses after
 * them, attacks that follow a hit, and its target rules ("It can't make both attacks against the same target.").
 */
function routineSentences(steps: MultiattackStep[], byId: Map<string, ActionDefinition>): {
  opening: string[]; attacks?: string; listed: boolean; closing: string[]; after: string[];
} {
  const isAbility = (step: MultiattackStep) => Boolean(step.actionId) && byId.get(step.actionId!)?.kind !== undefined && byId.get(step.actionId!)?.kind !== "attack";
  const conditional = (step: MultiattackStep) => step.requiresPreviousHit || step.target === "same-as-previous";
  const firstAttack = steps.findIndex((step) => !isAbility(step));
  // Abilities before its first attack open the routine ("can use its Frightful Presence. It then…"); later ones close it.
  const opening = steps.filter((step, index) => isAbility(step) && (firstAttack < 0 || index < firstAttack));
  const closing = steps.filter((step, index) => isAbility(step) && firstAttack >= 0 && index > firstAttack);
  const attackSteps = steps.filter((step) => !isAbility(step));
  const firstConditional = attackSteps.findIndex(conditional);
  const plain = firstConditional < 0 ? attackSteps : attackSteps.slice(0, firstConditional);
  const following = firstConditional < 0 ? [] : attackSteps.slice(firstConditional);
  const after: string[] = [];
  for (const step of following) {
    const what = `${countWord(step.count)} ${stepNoun(step, step.count, byId)}${step.target === "same-as-previous" ? " against the same target" : ""}`;
    after.push(step.requiresPreviousHit ? `If that attack hits, it can make ${what}.` : `It then makes ${what}.`);
  }
  const total = plain.reduce((sum, step) => sum + step.count, 0);
  const different = attackSteps.filter((step) => step.target === "different");
  if (different.length) {
    after.push(total === 2 && attackSteps.length === 2
      ? "It can't make both attacks against the same target."
      : `${capitalize(joinList(different.map((step) => `its ${stepNoun(step, step.count, byId)}`)))} can't target a creature its other attacks target.`);
  }
  const nameOf = (step: MultiattackStep) => byId.get(step.actionId!)?.name ?? step.actionId!;
  const phrase = plain.length ? attacksPhrase(plain, byId) : undefined;
  return { opening: opening.map(nameOf), attacks: phrase?.text, listed: phrase?.listed ?? false, closing: closing.map(nameOf), after };
}

/** How many swings a routine makes with each ability, keyed by what the step names (or its generic kind). */
function swingCounts(steps: MultiattackStep[]): Map<string, { step: MultiattackStep; count: number }> {
  const counts = new Map<string, { step: MultiattackStep; count: number }>();
  for (const step of steps) {
    const key = step.actionId ?? `any:${step.any}`;
    const entry = counts.get(key);
    if (entry) entry.count += step.count;
    else counts.set(key, { step, count: step.count });
  }
  return counts;
}

/**
 * An option that's another routine with some swings swapped ("It can use its Life Drain in place of one longsword
 * attack"), as `{ added, removed }` phrases; undefined when it's a different routine altogether ("…or two ranged
 * attacks").
 */
function replacementOf(base: MultiattackStep[], option: MultiattackStep[], byId: Map<string, ActionDefinition>): { added: string; removed: string } | undefined {
  const before = swingCounts(base);
  const after = swingCounts(option);
  const removed = [...before].flatMap(([key, entry]) => {
    const left = entry.count - (after.get(key)?.count ?? 0);
    return left > 0 ? [{ ...entry, count: left, all: left === entry.count }] : [];
  });
  const added = [...after].flatMap(([key, entry]) => {
    const extra = entry.count - (before.get(key)?.count ?? 0);
    return extra > 0 ? [{ ...entry, count: extra }] : [];
  });
  const kept = [...before.values()].reduce((sum, entry) => sum + entry.count, 0) - removed.reduce((sum, entry) => sum + entry.count, 0);
  if (!removed.length || !added.length || kept <= 0) return undefined;
  const addedPhrases = added.map(({ step, count }) => {
    const reading = readStep(step, byId);
    const action = step.actionId ? byId.get(step.actionId) : undefined;
    // A named ability (Life Drain, Fire Breath, Swallow) is used; a body part or weapon (Tail) makes an attack.
    const named = reading.kind === "used" || reading.kind === "verb"
      || (reading.kind === "attack" && /\s/.test(reading.word) && !CARRIED_WEAPON.test(reading.word));
    if (named) return `use its ${action?.name ?? step.actionId}${count > 1 ? ` ${timesWord(count)}` : ""}`;
    return `make ${countWord(count)} ${stepNoun(step, count, byId)}`;
  });
  // "in place of its bite attack" (its only one), "in place of its two claw attacks", "in place of one longsword attack".
  const removedPhrases = removed.map(({ step, count, all }) => {
    const reading = readStep(step, byId);
    if (!all && reading.kind === "attack" && /s$/.test(reading.word)) return `${countWord(count)} ${plural(count, "attack")} with its ${reading.word}`;
    return `${all ? `its ${count > 1 ? `${countWord(count)} ` : ""}` : `${countWord(count)} `}${stepNoun(step, count, byId)}`;
  });
  return { added: joinList(addedPhrases), removed: joinList(removedPhrases) };
}

function multiattackBody(action: MultiattackAction, definition: CreatureDefinition): Body {
  const byId = new Map(getExecutableActions(definition).map((candidate) => [candidate.id, candidate]));
  const [main, ...options] = multiattackRoutines(action);
  const routine = routineSentences(main!.attacks, byId);
  // An option that swaps some swings of the routine (or of an earlier alternative) reads as a replacement; the rest are
  // alternatives ("…or two ranged attacks").
  const bases: MultiattackStep[][] = [main!.attacks];
  const alternatives: MultiattackStep[][] = [];
  const replacements = new Map<string, string[]>();
  for (const option of options) {
    const swap = bases.map((base) => replacementOf(base, option.attacks, byId)).find((found) => found);
    if (swap) {
      const removed = replacements.get(swap.added) ?? [];
      if (!removed.includes(swap.removed)) replacements.set(swap.added, [...removed, swap.removed]);
      continue;
    }
    alternatives.push(option.attacks);
    bases.push(option.attacks);
  }

  // After a listed routine, an alternative of one kind of attack joins the list ("…, or two ranged attacks with its
  // longbow"); anything else gets its own sentence.
  const meleeRoutine = !main!.attacks.some((step) => {
    const reading = readStep(step, byId);
    return reading.kind === "attack" && reading.ranged;
  });
  const joined: string[] = [];
  const separate: string[] = [];
  for (const steps of alternatives) {
    const sentences = routineSentences(steps, byId);
    const opening = sentences.opening.length ? `uses its ${joinList(sentences.opening)}${sentences.attacks ? " and " : ""}` : "";
    const single = steps.length === 1 && !sentences.opening.length && sentences.attacks;
    const phrase = single ? stepPhrase(steps[0]!, byId, routine.listed && meleeRoutine) : `${opening}${sentences.attacks ?? ""}`;
    if (!phrase) continue;
    if (routine.attacks && (!routine.listed || (single && !phrase.startsWith("uses ")))) joined.push(phrase.replace(/^makes /, ""));
    else separate.push(routine.attacks ? `Alternatively, it ${phrase}.` : `Or it ${phrase}.`);
  }

  const opening = routine.opening.length
    ? routine.attacks ? [`It can use its ${joinList(routine.opening)}.`] : [`It uses its ${joinList(routine.opening)}.`]
    : [];
  const closing = routine.closing.length ? ` and can then use its ${joinList(routine.closing)}` : "";
  const choices = joined.length ? `${routine.listed ? "," : ""} or ${joinList(joined, "or")}` : "";
  const attacks = routine.attacks ? [`It ${routine.opening.length ? "then " : ""}${routine.attacks}${closing}${choices}.`] : [];
  const swaps = [...replacements].map(([added, removed]) => `It can ${added} in place of ${joinList(removed, "or")}.`);
  // Every routine is held to one weapon, so it's said when any of them picks its weapon swing by swing.
  const oneWeapon = action.oneWeapon && [main!, ...options].some((routine) => routine.attacks.some((step) => step.any)) ? ["It makes them all with the same weapon."] : [];
  const unsimulated = action.unsimulated ?? [];
  const text = [...opening, ...attacks, ...separate, ...routine.after, ...swaps, ...oneWeapon, ...unsimulated].join(" ");

  const shortOf = (steps: MultiattackStep[]) => steps
    .map((step) => `${step.count > 1 ? `${step.count} × ` : ""}${step.any ? `any ${GENERIC_WORDS[step.any]} attack` : byId.get(step.actionId!)?.name ?? step.actionId}`)
    .join(", ");
  const short = [shortOf(main!.attacks), ...options.map((option) => `or ${option.label ?? shortOf(option.attacks)}`)].join(" · ");
  return { text, short, notSimulated: [...unsimulated] };
}

function actionBody(action: ActionDefinition, definition: CreatureDefinition, inSpell: boolean): Body {
  switch (action.kind) {
    case "attack": return attackBody(action, definition);
    case "save": return saveBody(action, definition);
    case "area-save": return areaBody(action, definition);
    case "healing": return healingBody(action, definition);
    case "buff": return buffBody(action, definition, inSpell);
    case "multiattack": return multiattackBody(action, definition);
    case "activate-feature": return { ...activationText(action, definition), notSimulated: [] };
    case "reposition": {
      const who = action.targeting?.target === "single" ? `One creature within ${action.range} feet teleports` : "It teleports";
      return { text: `${who} up to ${action.range} feet to an unoccupied space${action.requiresLineOfEffect ? " it can see" : ""}.`, short: `teleport ${action.range} ft`, notSimulated: [] };
    }
    case "utility": {
      const verb = action.mode === "escape" ? "tries to escape a grapple" : `takes the ${capitalize(action.mode)} action`;
      return { text: `It ${verb}.`, short: action.mode, notSimulated: action.automationSupport === "partial" ? [`${capitalize(action.mode)} is only partly simulated.`] : [] };
    }
    case "summon": {
      const options = action.options.map((option) => `${typeof option.count === "number" ? countWord(option.count) : option.count.dice} ${option.label}`);
      const text = `It summons ${joinList(options, "or")}${action.options.length > 1 ? (action.choice === "random" ? ", chosen at random" : ", its choice") : ""}`
        + `${action.chance !== undefined ? ` (${action.chance}% chance)` : ""}`
        + `${action.durationRounds ? `, for ${roundsText(action.durationRounds)}` : ""}${action.concentration ? " (concentration)" : ""}.`;
      return { text, short: `summons ${joinList(options, "or")}`, notSimulated: [] };
    }
    case "transform": {
      const forms = joinList(action.forms.map((form) => form.label), "or");
      return { text: `It changes into ${forms}${action.canRevert ? ", or back into its true form" : ""}.`, short: `becomes ${forms}`, notSimulated: [] };
    }
    case "unsupported":
      return { text: action.description?.trim() || "Not simulated.", short: "reference only", notSimulated: [] };
  }
}

/** Text that follows a colon: a sentence's first word drops its capital, a heading ("Melee Weapon Attack:") keeps it. */
function continueSentence(text: string): string {
  return /^(It|Its|The|Each|A|An|One|Up|Three|Two) /.test(text) ? uncapitalize(text) : text;
}

/** What a reaction the simulator never takes on its own says about itself: a described trigger, or one set to manual. */
export const MANUAL_REACTION_NOTES = [
  "Its trigger is described, not simulated: the simulator never takes this reaction on its own.",
  "Set to manual: the simulator never takes this reaction on its own."
];

export interface ActionStatblockOptions {
  /** Shown instead of the action's own name (a weapon's, a legendary action's). */
  title?: string;
  /** Rendered under a spell's header, which already says the slot it uses and whether it needs concentration. */
  inSpell?: boolean;
}

/** Any action, as a statblock entry. */
export function actionStatblock(action: ActionDefinition, definition: CreatureDefinition, options: ActionStatblockOptions = {}): StatblockEntry {
  const reaction = "reaction" in action && action.actionType === "reaction" ? action.reaction : undefined;
  // Two reaction triggers resolve the same way whatever the action holds: Counterspell and Protection.
  const body: Body = reaction?.trigger.kind === "enemy-casts-spell"
    ? { text: "It counters the spell.", short: "counters the spell", notSimulated: [] }
    : reaction?.trigger.kind === "ally-targeted-by-attack"
      ? { text: "The attack roll has disadvantage.", short: "imposes disadvantage", notSimulated: [] }
      : actionBody(action, definition, Boolean(options.inSpell));
  const prefix = reaction ? `When ${triggerText(reaction.trigger)} (reaction): ` : "";
  // A recharge or per-day ability spends its own pool; the title's "(Recharge 5–6)" already says so.
  const ownPool = "usage" in action && action.usage && "resourceCost" in action && action.resourceCost?.resourceId.startsWith("usage:");
  const cost = "resourceCost" in action && action.resourceCost && !options.inSpell && !ownPool ? action.resourceCost : undefined;
  const reference = action.kind === "unsupported" || action.automationSupport === "manual-only" || action.automationSupport === "unsupported";
  const notSimulated = [
    ...body.notSimulated,
    ...(reaction?.trigger.kind === "manual" ? [MANUAL_REACTION_NOTES[0]] : []),
    ...(reaction && reaction.trigger.kind !== "manual" && reaction.priority === "manual" ? [MANUAL_REACTION_NOTES[1]] : [])
  ];
  return {
    title: `${options.title ?? action.name}${"usage" in action ? usageSuffix(action.usage) : ""}`,
    text: `${prefix}${prefix ? continueSentence(body.text) : body.text}${cost ? ` Uses ${costText(cost, definition)}.` : ""}`,
    short: [
      "usage" in action ? usageLabel(action.usage) : "",
      reaction ? `reaction: ${triggerText(reaction.trigger)}` : "",
      body.short,
      cost ? costText(cost, definition) : ""
    ].filter(Boolean).join(" · "),
    support: reference ? "reference" : "simulated",
    notSimulated
  };
}

/* ─── records ────────────────────────────────────────────────────────────── */

/** The first sentence (or line) of a text, capped for a list row. */
function firstSentence(text: string, max = 100): string {
  const line = text.split(/\n/)[0]!.trim();
  const sentence = /^(.+?[.!?])(\s|$)/.exec(line)?.[1] ?? line;
  const trimmed = sentence.replace(/[.:!?]$/, "");
  const cut = trimmed.length > max ? `${trimmed.slice(0, max).replace(/\s+\S*$/, "")}…` : trimmed;
  return cut.length < text.trim().replace(/[.!?]$/, "").length && !cut.endsWith("…") ? `${cut}…` : cut;
}

function activationLead(action: ActivateAction): string {
  if (action.actionType === "bonus") return "As a bonus action";
  if (action.actionType === "reaction") return `As a reaction when ${action.reaction ? triggerText(action.reaction.trigger) : "triggered"}`;
  if (action.actionType === "free") return "Without using an action";
  return "As an action";
}

/** The effects an aura passes on to creatures near it (`auraSources` reads only these). */
const AURA_SHARED_KINDS = new Set<FeatureEffect["kind"]>(["save-bonus", "save-advantage", "armor-class-bonus"]);

export function featureStatblock(feature: FeatureDefinition, definition: CreatureDefinition): StatblockEntry {
  const granted = feature.grantedActions ?? [];
  const activation = granted.find((action): action is ActivateAction => action.kind === "activate-feature");
  const utilities = granted.filter((action): action is Extract<ActionDefinition, { kind: "utility" }> => action.kind === "utility");
  const followUps = granted.filter((action): action is AttackAction => action.kind === "attack" && Boolean(action.onlyAfter));
  const others = granted.filter((action) => action !== activation && !utilities.includes(action as never) && !followUps.includes(action as never));
  const sentences: string[] = [];
  const shorts: string[] = [];

  const modifiers = feature.modifiers;
  if (modifiers) {
    const bonuses: Array<[NumericFormula, string, string]> = [
      ...(modifiers.armorClass ? [[modifiers.armorClass, "AC", "AC"] as [NumericFormula, string, string]] : []),
      ...(modifiers.attackRoll ? [[modifiers.attackRoll, "attack rolls", "to hit"] as [NumericFormula, string, string]] : []),
      ...ABILITIES.flatMap((ability) => (modifiers.savingThrows?.[ability]
        ? [[modifiers.savingThrows[ability]!, `${ABILITY_NAME[ability]} saving throws`, `${ability.toUpperCase()} saves`] as [NumericFormula, string, string]]
        : []))
    ];
    if (bonuses.length) sentences.push(`It gains ${joinList(bonuses.map(([formula, to]) => bonusPhrase(formulaText(formula, definition), to)))}.`);
    shorts.push(...bonuses.map(([formula, , short]) => `${signed(resolveNumericFormula(formula, definition))} ${short}`));
  }

  // Effects that fire when the feature activates belong to the activation, not to the always-on list.
  const firesOnActivate = (effect: FeatureEffect) => Boolean(activation) && (effect.kind === "extra-action" || (effect.kind === "resource-regain" && effect.timing === "on-activate"));
  const passive = (feature.effects ?? []).filter((effect) => !firesOnActivate(effect));
  // An aura passes on only what the simulator shares with other creatures (save bonuses, advantage on saves, AC), and
  // only while the creature is conscious; anything else stays its own.
  const shared = feature.aura ? passive.filter((effect) => AURA_SHARED_KINDS.has(effect.kind)) : [];
  const own = passive.filter((effect) => !shared.includes(effect));
  if (feature.aura && shared.length) {
    const reach = feature.aura.affects === "allies" ? "it and its allies" : feature.aura.affects === "hostile" ? "its enemies" : "it and all other creatures";
    const lead = `${reach} within ${feature.aura.range} feet of it gain these benefits while it is conscious`;
    sentences.push(`${capitalize(lead)}: ${afterColon(effectSentences(shared, definition, EACH))}`);
    shorts.push(`aura ${feature.aura.range} ft: ${effectShorts(shared, definition).join(", ")}`);
  }
  sentences.push(...effectSentences(own, definition));
  shorts.push(...effectShorts(own, definition));

  if (activation) {
    const cost = activation.resourceCost ? costText(activation.resourceCost) : "";
    const { text, short } = activationText(activation, definition, feature);
    sentences.push(`${activationLead(activation)}${cost ? ` (uses ${cost})` : ""}, ${uncapitalize(text)}`);
    const slot = activation.actionType === "bonus" ? "bonus action" : activation.actionType === "reaction" ? "reaction" : activation.actionType === "free" ? "free" : "action";
    shorts.push(`${slot}: ${short}${cost ? ` (${cost})` : ""}`);
  }
  if (utilities.length) {
    const bonus = utilities.every((action) => action.actionType === "bonus");
    sentences.push(`It can take the ${joinList(utilities.map((action) => capitalize(action.mode)), "or")} action${bonus ? " as a bonus action" : ""}.`);
    shorts.push(`${bonus ? "bonus action: " : ""}${joinList(utilities.map((action) => action.mode), "or")}`);
  }
  for (const followUp of followUps) {
    const name = followUp.name.replace(/\s*\(.*\)$/, "");
    sentences.push(followUp.onlyAfter === "charge-hit"
      ? `If a charge hits a creature${followUp.requiresTargetCondition ? ` and leaves it ${followUp.requiresTargetCondition}` : ""}, it can make one ${name} attack against it as a bonus action.`
      : `When it reduces a creature to 0 hit points with a melee attack, it can ${followUp.grantsMovementFeet ? `move up to ${followUp.grantsMovementFeet} feet and ` : ""}make one ${name} attack as a bonus action.`);
    shorts.push(followUp.onlyAfter === "charge-hit" ? `after a charge hit${followUp.requiresTargetCondition ? ` (target ${followUp.requiresTargetCondition})` : ""}: bonus ${name}` : `after a kill: bonus ${name}${followUp.grantsMovementFeet ? ` (moves ${followUp.grantsMovementFeet} ft first)` : ""}`);
  }
  for (const action of others) {
    const entry = actionStatblock(action, definition);
    const slot = action.actionType === "bonus" ? "a bonus action" : action.actionType === "reaction" ? "a reaction" : action.actionType === "free" ? "no action" : "an action";
    sentences.push(`It can use ${entry.title} (${slot}): ${uncapitalize(entry.text)}`);
    shorts.push(`${entry.title}: ${entry.short}`);
  }
  if (feature.emanation) {
    sentences.push(emanationText(feature.emanation, definition));
    shorts.push(emanationShort(feature.emanation, definition));
  }

  const optional = feature.optional ? ` Optional rule, ${feature.enabled ? "on" : "off"}.` : "";
  const optionalShort = feature.optional ? `optional (${feature.enabled ? "on" : "off"}) · ` : "";
  const description = feature.description?.trim() ?? "";
  if (sentences.length === 0) {
    if (feature.informational) return { title: feature.name, text: `${description || "No combat effect."}${optional}`, short: `${optionalShort}no combat effect`, support: "no-effect", notSimulated: [] };
    return {
      title: feature.name,
      text: `${description || "Not simulated."}${optional}`,
      short: `${optionalShort}${description ? firstSentence(description) : "reference only"}`,
      support: "reference",
      notSimulated: []
    };
  }
  return {
    title: feature.name,
    text: `${sentences.join(" ")}${optional}`,
    short: `${optionalShort}${shorts.join(" · ")}`,
    support: feature.automationSupport === "manual-only" || feature.automationSupport === "unsupported" ? "reference" : "simulated",
    notSimulated: []
  };
}

export function emanationShort(emanation: TraitEmanation, definition: CreatureDefinition): string {
  const what = [
    emanation.save ? `DC ${emanation.save.dc} ${emanation.save.ability.toUpperCase()}${emanation.condition ? ` or ${emanation.condition}` : ""}` : "",
    emanation.damage?.length ? `${damageShort(emanation.damage, definition)}${emanation.save && emanation.halfOnSave ? ", half on save" : ""}` : "",
    !emanation.save && emanation.condition ? emanation.condition : ""
  ].filter(Boolean).join(", ");
  return `aura ${emanation.range} ft: ${what}${emanation.timing === "bearer-turn-start" ? " (on its turn)" : ""}`;
}

function emanationText(emanation: TraitEmanation, definition: CreatureDefinition): string {
  const who = emanation.affects === "hostile" ? "enemy" : "creature";
  const damage = emanation.damage?.length ? damageText(emanation.damage, definition) : "";
  const condition = emanation.condition ? { condition: emanation.condition, duration: { kind: "until-start-of-next-turn" } as RiderDuration } : undefined;
  let outcome: string;
  if (emanation.save) {
    const save = `a DC ${emanation.save.dc} ${ABILITY_NAME[emanation.save.ability]} saving throw`;
    outcome = damage && emanation.halfOnSave
      ? `must make ${save}, taking ${damage} on a failed save, or half as much damage on a successful one${condition ? `, and must ${beCondition(condition)} on a failed save` : ""}.`
      : `must succeed on ${save} or ${[damage ? `take ${damage}` : "", condition ? beCondition(condition) : ""].filter(Boolean).join(" and ")}.`;
  } else {
    outcome = `${[damage ? `takes ${damage}` : "", condition ? isCondition(condition) : ""].filter(Boolean).join(" and ")}.`;
  }
  const lead = emanation.timing === "bearer-turn-start"
    ? `At the start of each of its turns, each ${who} within ${emanation.range} feet of it ${outcome}`
    : `${who === "enemy" ? "An enemy" : "A creature"} that starts its turn within ${emanation.range} feet of it ${outcome}`;
  return lead
    + (emanation.save && emanation.immuneOnSave ? " A creature that succeeds is immune to this for the rest of the fight." : "")
    + (emanation.suppressedWhenIncapacitated ? " This doesn't work while it is incapacitated." : "");
}

/**
 * The attack the engine compiles from a weapon on this creature (finesse, magic bonus and grip resolved): its main
 * attack, or, for a weapon it only swings as a bonus action or a reaction, that copy.
 */
export function compiledWeaponAttack(weapon: WeaponDefinition, definition: CreatureDefinition): AttackAction | undefined {
  if (weapon.attackType === "focus") return undefined;
  const onCreature = { ...definition, weapons: [...(definition.weapons ?? []).filter((candidate) => candidate.id !== weapon.id), weapon] };
  const base = weapon.actionId ?? `weapon:${weapon.id}`;
  const attacks = getExecutableActions(onCreature).filter((action): action is AttackAction => action.kind === "attack");
  return [base, `${base}:bonus`, `${base}:reaction`].map((id) => attacks.find((action) => action.id === id)).find(Boolean);
}

/** What a weapon's mastery property does for this creature, in one sentence (weapon mastery, PC_BUILDER_PLAN.md Phase 3). */
function masterySentence(attack: AttackAction, definition: CreatureDefinition): string {
  const modifier = abilityModifier(definition.abilities[attack.ability]);
  const damageType = attack.damage[0]?.damageType;
  const pb = definition.proficiencyBonus ?? proficiencyFromDefinition(definition);
  switch (attack.mastery) {
    case "graze": return `Graze (mastery): on a miss, the target takes ${Math.max(0, modifier)} ${damageType && damageType !== "same-as-attack" ? `${damageType} ` : ""}damage.`;
    case "push": return "Push (mastery): a hit pushes a Large or smaller target up to 10 feet away.";
    case "sap": return "Sap (mastery): a target it hits has disadvantage on its next attack roll before the start of its next turn.";
    case "slow": return "Slow (mastery): a target it hits is 10 feet slower until the start of its next turn (never more than 10 feet from Slow).";
    case "topple": return `Topple (mastery): a target it hits makes a DC ${8 + modifier + pb} Constitution saving throw or falls prone.`;
    case "vex": return "Vex (mastery): after a hit, its next attack roll against that target before the end of its next turn has advantage.";
    case "cleave": return "Cleave (mastery): once per turn, after a melee hit, it attacks a second creature within 5 feet of the first and in reach, adding no ability modifier to that damage.";
    case "nick": return "Nick (mastery): the extra attack of its other light weapon is part of the Attack action, not a bonus action.";
    default: return "";
  }
}

export function weaponStatblock(weapon: WeaponDefinition, definition: CreatureDefinition): StatblockEntry {
  const extras: string[] = [];
  if (weapon.charges) {
    const recharge = typeof weapon.charges.recharge === "string"
      ? ` and regains ${weapon.charges.max === 1 ? "it" : "them"} ${weapon.charges.recharge === "dawn" ? "at dawn" : `on a ${weapon.charges.recharge.replace(/-/g, " ")}`}`
      : "";
    extras.push(`It has ${weapon.charges.max} ${plural(weapon.charges.max, "charge")}${recharge}.`);
  }
  if (weapon.grantedActions?.length) {
    extras.push(`It grants ${joinList(weapon.grantedActions.map((action) => `${action.name}${"resourceCost" in action && action.resourceCost ? ` (${action.resourceCost.amount} ${plural(action.resourceCost.amount, "charge")})` : ""}`))}.`);
  }
  if (weapon.effects?.length) extras.push(`While carried: ${afterColon(effectSentences(weapon.effects, definition))}`);

  if (weapon.attackType === "focus") {
    return {
      title: weapon.name,
      text: extras.join(" ") || "A focus with nothing to use.",
      short: ["focus", weapon.charges ? `${weapon.charges.max} ${plural(weapon.charges.max, "charge")}` : ""].filter(Boolean).join(" · "),
      support: "simulated",
      notSimulated: []
    };
  }
  // Numbers from the attack the engine compiles (finesse, magic bonus, grip); on-hit effects as the weapon lists them,
  // so an optional charged effect shows too.
  const onDefinition = (definition.weapons ?? []).some((candidate) => candidate.id === weapon.id) ? definition : { ...definition, weapons: [...(definition.weapons ?? []), weapon] };
  const compiled = compiledWeaponAttack(weapon, onDefinition);
  if (!compiled) return { title: weapon.name, text: "Not simulated.", short: "reference only", support: "reference", notSimulated: [] };
  // An effect that spends the weapon's own charges says "charge", whatever the pool is called.
  const riders = weapon.onHit?.map((rider) => (rider.kind !== "note" && rider.resourceCost && rider.resourceCost.resourceId === weapon.charges?.id
    ? { ...rider, resourceCost: { ...rider.resourceCost, resourceId: "charges" } }
    : rider));
  const entry = actionStatblock({ ...compiled, riders }, onDefinition, { title: weapon.name });
  if (compiled.mastery) extras.push(masterySentence(compiled, onDefinition));
  if (weapon.usableAs?.includes("bonus")) extras.push(weapon.usableAs.includes("action") ? "It can also attack with it as a bonus action." : "It attacks with it as a bonus action.");
  if (weapon.powerAttack) extras.push("It can take a -5 penalty to hit for +10 damage.");
  const flags = [
    weapon.usableAs?.includes("bonus") ? (weapon.usableAs.includes("action") ? "bonus action too" : "bonus action") : "",
    weapon.powerAttack ? "power attack" : "",
    weapon.magical ? "magical" : "",
    weapon.charges ? `${weapon.charges.max} ${plural(weapon.charges.max, "charge")}` : ""
  ].filter(Boolean);
  return { ...entry, text: [entry.text, ...extras].join(" "), short: [entry.short, ...flags].join(" · ") };
}

export function spellStatblock(spell: SpellDefinition, definition: CreatureDefinition): StatblockEntry {
  const level = spell.level === 0 ? "Cantrip" : `${ordinal(spell.level)}-level spell`;
  const casting = spell.castingTime === "bonus" ? "1 bonus action" : spell.castingTime === "reaction" ? "1 reaction" : "1 action";
  const range = typeof spell.range === "number" ? (spell.range === 0 ? "self" : `${spell.range} feet`) : spell.range;
  // The spell's own zone and concentration reach its action the way the engine stamps them, and an attack that follows
  // the spellcasting ability rolls with it.
  const zoned = spell.action?.kind === "area-save" && spell.zone && !spell.action.zone ? { ...spell.action, zone: spell.zone } : spell.action;
  const action = zoned ? withSpellcastingAttackAbility(zoned, definition) : undefined;
  // What casting spends is its action's cost (the spell's own `resourceCost` is kept in step, but the engine doesn't
  // read it). Innate "3/Day" uses show in the title instead.
  const spent = action && "resourceCost" in action ? action.resourceCost : undefined;
  const ownPool = spent && action && "usage" in action && action.usage && spent.resourceId.startsWith("usage:");
  const header = `${level}, ${casting}, range ${range}${spell.concentration ? ", concentration" : ""}${spent && !ownPool ? `, uses ${costText(spent)}` : ""}.`;
  const effect = action ? actionStatblock(action, definition, { inSpell: true }) : undefined;
  const upcast = spell.upcast?.perSlotAboveBase ?? (action && "upcast" in action ? action.upcast?.perSlotAboveBase : undefined);
  const autoHit = action?.kind === "attack" && action.autoHit;
  const higher = [
    upcast?.damageDice ? `+${upcast.damageDice} ${action?.kind === "healing" ? "healing" : "damage"}` : "",
    upcast?.beams ? `${countWord(upcast.beams)} more ${plural(upcast.beams, autoHit ? "dart" : "attack")}` : "",
    upcast?.targets ? `${countWord(upcast.targets)} more ${plural(upcast.targets, "target")}` : ""
  ].filter(Boolean);
  const scaling = action && "damage" in action ? action.damage.find((component) => component.scaling?.mode === "cantrip-by-level")?.scaling : undefined;
  const reference = spell.automationSupport === "manual-only" || spell.automationSupport === "unsupported" || !effect;
  const text = [
    header,
    effect?.text ?? (spell.description?.trim() || "Not simulated."),
    higher.length ? `At higher levels: ${joinList(higher)} for each slot level above ${ordinal(spell.level)}.` : "",
    scaling?.mode === "cantrip-by-level" ? `Its damage grows to ${joinList(scaling.steps.map((step) => `${step.dice} at level ${step.atLevel}`))}.` : "",
    action?.kind === "attack" && action.beamCountByLevel?.length
      ? `It makes more attacks as it gains levels: ${joinList(action.beamCountByLevel.map((step) => `${step.count} at level ${step.atLevel}`))}.`
      : ""
  ].filter(Boolean).join(" ");
  return {
    title: `${spell.name}${effect && action && "usage" in action ? usageSuffix(action.usage) : ""}`,
    text,
    short: [
      spell.level === 0 ? "cantrip" : `level ${spell.level}`,
      spell.castingTime === "bonus" ? "bonus action" : spell.castingTime === "reaction" && !effect?.short.startsWith("reaction") ? "reaction" : "",
      spell.concentration ? "concentration" : "",
      effect?.short ?? "reference only"
    ].filter(Boolean).join(" · "),
    support: reference ? "reference" : "simulated",
    notSimulated: effect?.notSimulated ?? []
  };
}

export function deathEffectStatblock(effect: DeathEffectDefinition, definition: CreatureDefinition): StatblockEntry {
  const entry = actionStatblock(effect.action, definition, { title: effect.name });
  return { ...entry, text: `When it dies: ${entry.text}` };
}

export function legendaryStatblock(legendary: LegendaryActionRef, definition: CreatureDefinition): StatblockEntry {
  const title = `${legendary.name}${legendary.cost > 1 ? ` (Costs ${legendary.cost} Actions)` : ""}`;
  if (legendary.action) return { ...actionStatblock(legendary.action, definition), title };
  const referenced = legendary.actionId ? getExecutableActions(definition).find((action) => action.id === legendary.actionId) : undefined;
  if (referenced) {
    const entry = actionStatblock(referenced, definition);
    const spell = "spellLevel" in referenced && referenced.spellLevel !== undefined;
    // "It makes a tail attack", the way a statblock words it.
    const word = attackWord(referenced.name);
    const verb = spell ? `It casts ${referenced.name}.` : referenced.kind === "attack" ? `It makes ${article(word)} ${word} attack.` : `It uses its ${referenced.name}.`;
    return { ...entry, title, text: `${verb} ${entry.text}`, short: `${spell ? "casts" : "uses"} ${referenced.name} · ${entry.short}` };
  }
  const description = legendary.description?.trim() ?? "";
  return { title, text: description || "Not simulated.", short: "reference only", support: "reference", notSimulated: [] };
}

export const ITEM_TYPE_WORDS: Record<ItemType, string> = {
  potion: "potion", scroll: "scroll", wand: "wand", thrown: "thrown item", worn: "worn item", gear: "gear", armor: "armor", shield: "shield"
};

const slotPhrase = (actionType: ActionDefinition["actionType"]): string =>
  actionType === "bonus" ? "a bonus action" : actionType === "reaction" ? "a reaction" : actionType === "free" ? "no action" : "an action";
const slotShort = (actionType: ActionDefinition["actionType"]): string =>
  actionType === "bonus" ? "bonus action" : actionType === "reaction" ? "reaction" : actionType === "free" ? "free" : "action";

/**
 * What armor or a shield does for AC, as a statblock says it ("Heavy armor: worn, its wearer's AC is 18. A wearer with a
 * Strength score below 15 is 10 feet slower. It has disadvantage on Dexterity (Stealth) checks.") and as a row says it
 * ("AC 18 · heavy · Str 15 · stealth disadvantage").
 */
function armorText(item: ItemDefinition): { sentence: string; short: string } | undefined {
  if (!isArmorItem(item)) return undefined;
  const stats = item.armor;
  const magic = stats.magicBonus ?? 0;
  const carried = item.equipped === false;
  const magicWords = magic ? ` (${signed(magic)} magic)` : "";
  if (stats.category === "shield") {
    return {
      sentence: `Worn, it adds ${signed(stats.ac + magic)} to its wearer's AC${magicWords}.${carried ? " It's carried, not worn." : ""}`,
      short: [`${signed(stats.ac + magic)} AC`, carried ? "carried" : ""].filter(Boolean).join(" · ")
    };
  }
  const cap = dexCapOf(stats);
  const dexWords = cap === 0 ? "" : cap === undefined ? " + its Dexterity modifier" : ` + its Dexterity modifier (max ${cap})`;
  const dexShort = cap === 0 ? "" : cap === undefined ? " + Dex" : ` + Dex (max ${cap})`;
  return {
    sentence: [
      `${capitalize(stats.category)} armor: worn, its wearer's AC is ${stats.ac + magic}${dexWords}${magicWords}.`,
      stats.strength ? `A wearer with a Strength score below ${stats.strength} is 10 feet slower.` : "",
      stats.stealthDisadvantage ? "It has disadvantage on Dexterity (Stealth) checks." : "",
      carried ? "It's carried, not worn." : ""
    ].filter(Boolean).join(" "),
    short: [`AC ${stats.ac + magic}${dexShort}`, stats.category, stats.strength ? `Str ${stats.strength}` : "", stats.stealthDisadvantage ? "stealth disadvantage" : "", carried ? "carried" : ""]
      .filter(Boolean).join(" · ")
  };
}

/**
 * A wand's use cast a level higher for each extra charge (`upcast.byCharges`), in words: what each adds, and how far it
 * goes ("Each extra charge casts it a level higher, for 1d6 more damage, up to 7 (9th level).").
 */
function chargeTierText(use: ActionDefinition, item: ItemDefinition): { sentence: string; short: string } | undefined {
  const upcast = "upcast" in use ? use.upcast : undefined;
  const level = "spellLevel" in use ? use.spellLevel : undefined;
  const cost = "resourceCost" in use ? use.resourceCost : undefined;
  if (!upcast?.byCharges || level == null || !cost || !item.supply) return undefined;
  const most = Math.min(item.supply.size, cost.amount + 9 - level);
  if (most <= cost.amount) return undefined;
  const per = upcast.perSlotAboveBase;
  const adds = per?.damageDice ? `${per.damageDice.replace(/\+/g, " + ")} more ${use.kind === "healing" ? "healing" : "damage"}`
    : per?.beams ? (per.beams === 1 ? "one more dart" : `${per.beams} more darts`)
      : "no more effect";
  const unit = item.supply.unit === "charges" ? "charge" : "one";
  return {
    sentence: `Each extra ${unit} spent at once casts it a level higher, for ${adds}, up to ${most} (${ordinal(level + most - cost.amount)} level).`,
    short: `+${adds.replace(/ more /, " ")} per extra ${unit}, up to ${most}`
  };
}

/** What drinking a potion does, as a short: "7 (2d4 + 2) HP", "10 temp HP, +2 to hit · 1 hour". */
function drinkShort(drink: Extract<ActionDefinition, { kind: "healing" | "buff" }>, definition: CreatureDefinition): string {
  if (drink.kind === "healing") return `${healingShort(drink.healing, definition)} HP`;
  return actionStatblock({ ...drink, resourceCost: undefined }, definition).short.split(" · ").filter((part) => part !== "self").join(" · ");
}

/**
 * An item as a statblock would describe it: what drinking or giving a potion takes and does, what each other use does
 * and spends, its charges, what it gives while carried, and whether it's attuned. Its stack's count is the token's, not
 * the text's (the list row shows it).
 */
export function itemStatblock(item: ItemDefinition, definition: CreatureDefinition): StatblockEntry {
  // Its pools are named after it, also when it isn't on the creature yet (a library row, the editor's new item).
  const onCreature = (definition.items ?? []).some((candidate) => candidate.id === item.id && candidate === item)
    ? definition : { ...definition, items: [...(definition.items ?? []).filter((candidate) => candidate.id !== item.id), item] };
  const uses = item.grantedActions ?? [];
  const drinks = item.type === "potion" ? uses.filter(isDrinkUse) : [];
  const others = uses.filter((use) => !drinks.includes(use as never));
  const sentences: string[] = [];
  const shorts: string[] = [];
  const armor = armorText(item);
  if (armor) {
    sentences.push(armor.sentence);
    shorts.push(armor.short);
  }
  for (const drink of drinks) {
    const effect = actionStatblock({ ...drink, resourceCost: undefined } as ActionDefinition, onCreature);
    const give = item.give?.actionType;
    const lead = !give ? `Drinking it takes ${slotPhrase(drink.actionType)}`
      : give === drink.actionType ? `Drinking it, or giving it to a creature within 5 feet, takes ${slotPhrase(give)}`
        : `Drinking it takes ${slotPhrase(drink.actionType)}; giving it to a creature within 5 feet takes ${slotPhrase(give)}`;
    sentences.push(`${lead}. ${effect.text.replace(/^It /, "The drinker ")}`);
    // An action spent where a bonus action would do heals the full amount (the campaign's rule, or the potion's own).
    const fullDrink = item.fullWithAction && drink.kind === "healing" && healsMoreInFull(drink) ? fullHealing(drink) : undefined;
    const fullFor = fullDrink === undefined ? "" : drink.actionType === "bonus" && give === "bonus" ? "used" : drink.actionType === "bonus" ? "drunk" : give === "bonus" ? "given" : "";
    if (fullFor) sentences.push(`${capitalize(fullFor)} with an action instead of a bonus action, it heals the full ${fullDrink} hit points.`);
    shorts.push((!give ? `drink: ${drinkShort(drink, onCreature)} · ${slotShort(drink.actionType)}`
      : give === drink.actionType ? `drink or give (5 ft): ${drinkShort(drink, onCreature)} · ${slotShort(give)}`
        : `drink: ${drinkShort(drink, onCreature)} · ${slotShort(drink.actionType)} · give (5 ft): ${slotShort(give)}`)
      + (fullFor ? ` · ${fullFor === "used" ? "" : `${fullFor} `}with an action: the full ${fullDrink}` : ""));
  }
  for (const use of others) {
    const entry = actionStatblock(use, onCreature);
    const tiers = chargeTierText(use, item);
    sentences.push(`It can be used for ${entry.title} (${slotPhrase(use.actionType)}): ${uncapitalize(entry.text)}${tiers ? ` ${tiers.sentence}` : ""}`);
    shorts.push(`${entry.title === item.name ? entry.short : `${entry.title}: ${entry.short}`}${tiers ? ` · ${tiers.short}` : ""}`);
  }
  if (item.supply?.unit === "charges") {
    const { size, regains } = item.supply;
    const when = typeof regains === "string" ? ` and regains ${size === 1 ? "it" : "them"} ${regains === "dawn" ? "at dawn" : `on a ${regains.replace(/-/g, " ")}`}`
      : regains ? ` and regains ${regains.dice} at dawn` : "";
    sentences.push(`It has ${size} ${plural(size, "charge")}${when}.`);
  }
  if (item.effects?.length) {
    sentences.push(`While carried: ${afterColon(effectSentences(item.effects, onCreature))}`);
    shorts.push(...effectShorts(item.effects, onCreature));
  }
  if (item.attunement) {
    sentences.push(item.attunement.attuned ? "It requires attunement, and is attuned." : "It requires attunement and isn't attuned: it does nothing.");
    if (!item.attunement.attuned) shorts.unshift("not attuned");
  }
  const description = item.description?.trim() ?? "";
  if (item.automationSupport === "manual-only" || item.automationSupport === "unsupported") {
    return { title: item.name, text: description || "Not simulated.", short: description ? firstSentence(description) : "reference only", support: "reference", notSimulated: [] };
  }
  if (!uses.length && !item.effects?.length && !armor) {
    return { title: item.name, text: description || "No combat effect.", short: "no combat effect", support: "no-effect", notSimulated: [] };
  }
  return {
    title: item.name,
    text: sentences.join(" "),
    short: shorts.join(" · "),
    support: "simulated",
    notSimulated: [
      ...uses.flatMap((use) => actionStatblock(use, onCreature).notSimulated),
      ...(item.notSimulated?.trim() ? [`${capitalize(item.notSimulated.trim().replace(/\.$/, ""))}.`] : [])
    ]
  };
}

/** The statblock entry for any ability on a creature, or undefined when the ref points at nothing. */
export function statblockFor(definition: CreatureDefinition, ref: AbilityRef): StatblockEntry | undefined {
  const record = findAbility(definition, ref);
  if (!record) return undefined;
  switch (ref.list) {
    case "weapons": return weaponStatblock(record as WeaponDefinition, definition);
    case "items": return itemStatblock(record as ItemDefinition, definition);
    case "spells": return spellStatblock(record as SpellDefinition, definition);
    case "features":
    case "traits": return featureStatblock(record as FeatureDefinition, definition);
    case "deathEffects": return deathEffectStatblock(record as DeathEffectDefinition, definition);
    case "legendary": return legendaryStatblock(record as LegendaryActionRef, definition);
    default: return actionStatblock(record as ActionDefinition, definition);
  }
}
