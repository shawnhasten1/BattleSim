import type { Ability, ConditionName, DamageComponent, FeatureDefinition } from "../../src/engine/types";
import type { GapCode } from "../../src/data/srd/monsters/gaps";
import type { MonsterContext, RawEntry } from "./context";
import { compactDice, isDamageType, slugify } from "./util";

/**
 * Trait recipes. A trait resolves, in order, to:
 *   1. a RECIPE  — compiled into real engine effects (automationSupport "full"),
 *   2. INFORMATIONAL — kept as reference text; no engine effect exists or matters,
 *   3. a GAP mapping — reference text tagged with the phase that will automate it,
 *   4. TRAIT_UNMODELED — reference text tagged for the long-tail sweep.
 * To cover a new trait: add one line here (and a test), never touch the parser.
 */

type Recipe = (entry: RawEntry, ctx: MonsterContext) => Partial<FeatureDefinition>;

type SaveAdvantage = Extract<NonNullable<FeatureDefinition["effects"]>[number], { kind: "save-advantage" }>;
const advantage = (effect: Omit<SaveAdvantage, "kind">): SaveAdvantage => ({ kind: "save-advantage", ...effect });
const conditionAdvantage = (conditions: ConditionName[], abilities?: Ability[]) => advantage({ abilities, against: { conditions } });

const RECIPES: Array<{ match: RegExp; build: Recipe }> = [
  {
    match: /^Pack Tactics$/i,
    build: () => ({
      automationSupport: "full",
      effects: [{ kind: "attack-advantage", condition: "ally-adjacent-to-target" }]
    })
  },
  {
    match: /^Nimble Escape$/i,
    build: (_entry, ctx) => ({
      automationSupport: "full",
      grantedActions: [
        { kind: "utility", id: `${ctx.slug}-nimble-escape-disengage`, name: "Nimble Escape: Disengage", actionType: "bonus", mode: "disengage", automationSupport: "full" },
        { kind: "utility", id: `${ctx.slug}-nimble-escape-hide`, name: "Nimble Escape: Hide", actionType: "bonus", mode: "hide", automationSupport: "partial" }
      ]
    })
  },
  {
    // Modelled as an `absorb` damage adjustment on the definition (see `parseAbsorption`); the trait is the label.
    match: /^(Acid|Cold|Fire|Force|Lightning|Necrotic|Poison|Psychic|Radiant|Thunder) Absorption$/i,
    build: () => ({ automationSupport: "full" })
  },
  {
    // "…advantage on saving throws against spells and other magical effects"
    match: /^Magic Resistance$/i,
    build: () => ({ automationSupport: "full", effects: [advantage({ against: { source: "magical" } })] })
  },
  {
    // "…advantage on saving throws against being charmed" (the drow's "magic can't put it to sleep" is not modelled)
    match: /^Fey Ancestry$/i,
    build: () => ({ automationSupport: "partial", effects: [conditionAdvantage(["charmed"])] })
  },
  {
    match: /^Brave$/i,
    build: () => ({ automationSupport: "full", effects: [conditionAdvantage(["frightened"])] })
  },
  {
    match: /^Dark Devotion$/i,
    build: () => ({ automationSupport: "full", effects: [conditionAdvantage(["charmed", "frightened"])] })
  },
  {
    // "…advantage on Intelligence, Wisdom, and Charisma saving throws against magic"
    match: /^Gnome Cunning$/i,
    build: () => ({ automationSupport: "full", effects: [advantage({ abilities: ["int", "wis", "cha"], against: { source: "magical" } })] })
  },
  {
    // "…advantage on Strength and Dexterity saving throws made against effects that would knock it prone"
    match: /^Sure-Footed$/i,
    build: () => ({ automationSupport: "full", effects: [conditionAdvantage(["prone"], ["str", "dex"])] })
  },
  {
    // "…advantage on saving throws against being blinded, charmed, deafened, frightened, stunned, and knocked unconscious"
    match: /^(Two-Headed|Two Heads|Multiple Heads)$/i,
    build: () => ({
      automationSupport: "full",
      effects: [conditionAdvantage(["blinded", "charmed", "deafened", "frightened", "stunned", "unconscious"])]
    })
  },
  {
    // "…advantage on saving throws against poison, spells, and illusions, as well as to resist being charmed or paralyzed"
    // Illusions that aren't spells are not modelled; poison covers the poisoned condition.
    match: /^Duergar Resilience$/i,
    build: () => ({
      automationSupport: "partial",
      effects: [advantage({ against: { source: "spell" } }), conditionAdvantage(["charmed", "paralyzed", "poisoned"])]
    })
  },
  {
    // "Legendary Resistance (3/Day). If the dragon fails a saving throw, it can choose to succeed instead."
    match: /^Legendary Resistance$/i,
    build: (entry, ctx) => {
      const uses = /(\d+)\/Day/i.exec(entry.name)?.[1];
      if (!uses) return { automationSupport: "manual-only" };
      ctx.resources["legendary-resistance"] = Number(uses);
      return { automationSupport: "full", effects: [{ kind: "auto-succeed-save", resourceId: "legendary-resistance" }] };
    }
  },
  {
    match: /^Flyby$/i,
    build: () => ({ automationSupport: "full", effects: [{ kind: "avoids-opportunity-attacks" }] })
  },
  {
    // "…deals an extra 4d8 radiant damage when it hits with any weapon"
    match: /^(Angelic|Heated|Hellish) Weapons$/i,
    build: (entry) => {
      const match = /extra\s+(\d+)\s*(?:\(([^)]+)\))?\s+([a-z]+)\s+damage/i.exec(entry.desc);
      const type = match?.[3]?.toLowerCase();
      if (!match || !type || !isDamageType(type)) return { automationSupport: "manual-only" };
      const damage: DamageComponent = { dice: compactDice(match[2] ?? match[1]!), damageType: type };
      return {
        automationSupport: "full",
        effects: [{ kind: "damage-bonus", condition: "always", attackTypes: ["melee", "ranged"], damage: [damage] }]
      };
    }
  }
];

/** Reference text with no engine effect worth modelling (senses, flavour, environment). */
const INFORMATIONAL = new RegExp(
  "^(Keen (Hearing|Sight|Smell)|False Appearance|Amphibious|Water Breathing|Hold Breath|Devil.s Sight|Web Sense|"
  + "Echolocation|Stone Camouflage|Underwater Camouflage|Illumination|Inscrutable|Mimicry|Standing Leap|Siege Monster|"
  + "Immutable Form|Telepathic Bond|Limited Telepathy|Divine Awareness|Wakeful|Sunlight Sensitivity|Light Sensitivity|"
  + "Ambusher|Faultless Tracker|Blind Senses|Ethereal Sight|Speak with|Hag Coven|Hag Eye|Shared Spellcasting|"
  + "Turn Immunity|Turn Resistance|Turn Defiance|Brute|Magic Weapons|Swarm|Probing Telepathy|Read Thoughts|"
  + "Transparent|Sense Magic|Otherworldly)",
  "i"
);

/** Traits whose mechanics belong to a later engine phase. */
const GAPS: Array<{ match: RegExp; code: GapCode }> = [
  { match: /^Regeneration/i, code: "REGEN" },
  { match: /^(Undead Fortitude|Relentless|Rejuvenation)/i, code: "SURVIVE_ZERO" },
  { match: /^(Spellcasting|Innate Spellcasting)/i, code: "SPELLS" },
  { match: /^Shapechanger/i, code: "TRANSFORM" },
  { match: /^(Charge|Trampling Charge|Pounce|Rampage|Blood Frenzy|Surprise Attack)/i, code: "CHARGE_TRAIT" },
  { match: /^(Spider Climb|Web Walker|Ice Walk|Earth Glide|Incorporeal Movement|Amorphous|Tree Stride|Tunneler)/i, code: "MOVE_TRAIT" }
];

/** Variants that change nothing in combat stay quiet; the rest are opt-in reference with a gap code. */
const VARIANT_NO_COMBAT_IMPACT = /^Variant: (Familiar|Hold Breath)/i;

export function parseTrait(entry: RawEntry, ctx: MonsterContext): FeatureDefinition {
  const id = `${ctx.slug}-trait-${slugify(entry.name)}`;
  const base = entry.name.replace(/\s*\(.*?\)\s*/g, " ").trim();
  const feature: FeatureDefinition = {
    id,
    name: entry.name,
    category: "trait",
    description: entry.desc,
    automationSupport: "manual-only"
  };

  if (/^Variant:/i.test(entry.name)) {
    feature.optional = true;
    if (!VARIANT_NO_COMBAT_IMPACT.test(entry.name)) ctx.gaps.add("VARIANT", entry.name);
    return feature;
  }

  const recipe = RECIPES.find((candidate) => candidate.match.test(base));
  if (recipe) {
    const built = recipe.build(entry, ctx);
    Object.assign(feature, built);
    if (feature.automationSupport !== "full") ctx.gaps.add("TRAIT_UNMODELED", entry.name);
    return feature;
  }

  const gap = GAPS.find((candidate) => candidate.match.test(base));
  if (gap) {
    ctx.gaps.add(gap.code, entry.name);
    return feature;
  }
  if (INFORMATIONAL.test(base)) return feature;

  ctx.gaps.add("TRAIT_UNMODELED", entry.name);
  return feature;
}

/** Traits that say "weapon attacks are magical" — used to stamp `magical` on the creature's weapon damage. */
export function grantsMagicalWeapons(entry: RawEntry): boolean {
  return /Weapons$/i.test(entry.name.trim()) && /weapon attacks are magical/i.test(entry.desc);
}
