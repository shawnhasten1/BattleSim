import type { Ability, ActionDefinition, ConditionName, DamageComponent, FeatureDefinition } from "../../src/engine/types";
import type { GapCode } from "../../src/data/srd/monsters/gaps";
import type { MonsterContext, RawEntry } from "./context";
import { compactDice, GapLog, isDamageType, slugify } from "./util";
import { parseSaveAction } from "./saves";

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
    // "regains 10 hit points at the start of its turn [if it has at least 1 hit point]. If it takes acid or fire
    // damage, this trait doesn't function at the start of its next turn. It dies only if it starts its turn with 0 hit points"
    match: /^Regeneration$/i,
    build: (entry, ctx) => {
      const amount = Number(/regains (\d+) hit points/i.exec(entry.desc)?.[1]);
      if (!amount) return { automationSupport: "manual-only" };
      const worksAtZero = !/at least 1 hit/i.test(entry.desc);
      const suppressed = /acid or fire/i.test(entry.desc) ? ["acid", "fire"] as const
        : /radiant damage/i.test(entry.desc) ? ["radiant"] as const : undefined;
      const needsTerrain = /sunlight or running water/i.test(entry.desc);
      // Sunlight and running water have no terrain tag to check yet, so those regenerators stay "partial".
      if (needsTerrain) ctx.gaps.add("REGEN_TERRAIN", entry.name);
      return {
        automationSupport: needsTerrain ? "partial" : "full",
        effects: [{ kind: "hp-regen", amount, ...(worksAtZero ? { worksAtZero: true } : {}), ...(suppressed ? { suppressedByDamageTypes: [...suppressed] } : {}) }]
      };
    }
  },
  {
    // Undead Fortitude: Con save, DC 5 + damage taken, not against radiant or a critical hit.
    match: /^Undead Fortitude$/i,
    build: (entry) => {
      if (!/DC of 5\s*\+\s*the damage taken/i.test(entry.desc)) return { automationSupport: "manual-only" };
      return {
        automationSupport: "full",
        effects: [{ kind: "survive-lethal", save: { ability: "con", dcBase: 5 }, excludedDamageTypes: ["radiant"], excludeCritical: true }]
      };
    }
  },
  {
    // Relentless: "If it takes 7 damage or less that would reduce it to 0 hit points, it is reduced to 1 instead"; once per rest.
    match: /^Relentless$/i,
    build: (entry, ctx) => {
      const max = Number(/takes (\d+) damage or less/i.exec(entry.desc)?.[1]);
      if (!max) return { automationSupport: "manual-only" };
      ctx.resources["relentless"] = 1;
      return { automationSupport: "full", effects: [{ kind: "survive-lethal", maxDamage: max, resourceId: "relentless" }] };
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
  },
  // ── Phase 9: movement-conditioned damage. The named attack ("hits it with a tusk attack") is written as an
  // `@attack:<word>` placeholder; `resolveTraitReferences` (monster.ts) points it at the real action once the
  // creature's attacks exist.
  {
    // "If the boar moves at least 20 ft. straight toward a target and then hits it with a tusk attack on the same turn,
    // the target takes an extra 3 (1d6) slashing damage. …DC 11 Strength saving throw or be knocked prone."
    // Pounce / Trampling Charge add "If the target is prone, the lion can make one bite attack against it as a bonus action."
    match: /^(Charge|Trampling Charge|Pounce)$/i,
    build: (entry) => {
      const text = entry.desc.replace(/\s+/g, " ");
      const feet = Number(/moves at least (\d+) (?:ft\.?|feet) straight toward/i.exec(text)?.[1]);
      const word = (/hits it with an? ([a-z]+(?: [a-z]+)?) attack/i.exec(text) ?? /hits it with its ([a-z]+)/i.exec(text))?.[1]?.toLowerCase();
      if (!feet || !word) return { automationSupport: "manual-only" };
      const scope = { actionIds: [`@attack:${word}`], condition: "charged" as const, chargeFeet: feet };
      const effects: NonNullable<FeatureDefinition["effects"]> = [];
      const extra = /takes an extra \d+ \(([^)]+)\)(?: ([a-z]+))? damage/i.exec(text);
      if (extra) {
        const type = extra[2]?.toLowerCase();
        effects.push({ kind: "damage-bonus", ...scope, damage: [{ dice: compactDice(extra[1]!), damageType: type && isDamageType(type) ? type : "same-as-attack" }] });
      }
      const prone = /DC (\d+) Strength saving throw or be (pushed up to \d+ (?:feet|ft\.?) away and )?knocked prone/i.exec(text);
      if (prone) {
        effects.push({ kind: "apply-condition-on-hit", ...scope, appliedCondition: { name: "prone" }, save: { ability: "str", dc: Number(prone[1]) } });
      }
      const follow = /can make one ([a-z]+) attack against it as a bonus action|can make one attack with its ([a-z]+) against it as a bonus action/i.exec(text);
      const grantedActions = follow
        ? [{ id: `@follow:${(follow[1] ?? follow[2])!.toLowerCase()}`, onlyAfter: "charge-hit", requiresTargetCondition: "prone" } as unknown as ActionDefinition]
        : undefined;
      if (effects.length === 0) return { automationSupport: "manual-only" };
      // The minotaur's charge also pushes the target 10 ft; the shove isn't modelled.
      return { automationSupport: prone?.[2] ? "partial" : "full", effects, ...(grantedActions ? { grantedActions } : {}) };
    }
  },
  {
    // "When the gnoll reduces a creature to 0 hit points with a melee attack on its turn, the gnoll can take a bonus
    // action to move up to half its speed and make a bite attack."
    match: /^Rampage$/i,
    build: (entry) => {
      const word = /make an? ([a-z]+) attack/i.exec(entry.desc)?.[1]?.toLowerCase();
      if (!word) return { automationSupport: "manual-only" };
      // grantsMovementFeet -1 = "half its speed", filled in once the creature's speed is known.
      return { automationSupport: "full", grantedActions: [{ id: `@follow:${word}`, onlyAfter: "dropped-creature", grantsMovementFeet: -1 } as unknown as ActionDefinition] };
    }
  },
  {
    // "…advantage on melee attack rolls against any creature that doesn't have all its hit points."
    match: /^Blood Frenzy$/i,
    build: () => ({ automationSupport: "full", effects: [{ kind: "attack-advantage", condition: "target-injured", attackTypes: ["melee"] }] })
  },
  {
    // "If the bugbear surprises a creature and hits it with an attack during the first round of combat, the target
    // takes an extra 7 (2d6) damage from the attack."
    match: /^Surprise Attack$/i,
    build: (entry) => {
      const dice = /extra \d+ \(([^)]+)\) damage/i.exec(entry.desc)?.[1];
      if (!dice) return { automationSupport: "manual-only" };
      return { automationSupport: "full", effects: [{ kind: "damage-bonus", condition: "target-surprised", damage: [{ dice: compactDice(dice), damageType: "same-as-attack" }] }] };
    }
  },
  {
    // "…an extra 13 (4d6) damage when it hits a target with a weapon attack and has advantage on the attack roll, or when
    // the target is within 5 ft. of an ally … and the assassin doesn't have disadvantage on the attack roll." Once per turn.
    match: /^Sneak Attack$/i,
    build: (entry) => {
      const dice = /extra \d+ \(([^)]+)\) damage/i.exec(entry.desc)?.[1];
      if (!dice) return { automationSupport: "manual-only" };
      return {
        automationSupport: "full",
        effects: [{
          kind: "damage-bonus", oncePerTurn: true, attackTypes: ["melee", "ranged"],
          allConditions: ["attack-has-no-disadvantage"], anyConditions: ["attack-has-advantage", "ally-adjacent-to-target"],
          damage: [{ dice: compactDice(dice), damageType: "same-as-attack" }]
        }]
      };
    }
  },
  {
    // "Once per turn, the hobgoblin can deal an extra 7 (2d6) damage to a creature it hits with a weapon attack if that
    // creature is within 5 ft. of an ally of the hobgoblin that isn't incapacitated."
    match: /^Martial Advantage$/i,
    build: (entry) => {
      const dice = /extra \d+ \(([^)]+)\) damage/i.exec(entry.desc)?.[1];
      if (!dice) return { automationSupport: "manual-only" };
      return {
        automationSupport: "full",
        effects: [{ kind: "damage-bonus", oncePerTurn: true, attackTypes: ["melee", "ranged"], condition: "ally-adjacent-to-target", damage: [{ dice: compactDice(dice), damageType: "same-as-attack" }] }]
      };
    }
  },
  {
    // "At the start of its turn, the berserker can gain advantage on all melee weapon attack rolls during that turn, but
    // attack rolls against it have advantage until the start of its next turn." A monster always takes the offer here.
    match: /^Reckless$/i,
    build: () => ({
      automationSupport: "full",
      effects: [
        { kind: "attack-advantage", condition: "always", attackTypes: ["melee"] },
        { kind: "incoming-attack-modifier", condition: "always", amount: 5 }
      ]
    })
  },
  {
    // "As a bonus action, the orc can move up to its speed toward a hostile creature that it can see."
    match: /^Aggressive$/i,
    build: (_entry, ctx) => ({
      automationSupport: "full",
      grantedActions: [{ kind: "utility", id: `${ctx.slug}-aggressive`, name: "Aggressive (move toward a foe)", actionType: "bonus", mode: "dash", automationSupport: "full" }]
    })
  },
  {
    // "On each of its turns, the spy can use a bonus action to take the Dash, Disengage, or Hide action."
    match: /^Cunning Action$/i,
    build: (_entry, ctx) => ({
      automationSupport: "full",
      grantedActions: [
        { kind: "utility", id: `${ctx.slug}-cunning-dash`, name: "Cunning Action: Dash", actionType: "bonus", mode: "dash", automationSupport: "full" },
        { kind: "utility", id: `${ctx.slug}-cunning-disengage`, name: "Cunning Action: Disengage", actionType: "bonus", mode: "disengage", automationSupport: "full" },
        { kind: "utility", id: `${ctx.slug}-cunning-hide`, name: "Cunning Action: Hide", actionType: "bonus", mode: "hide", automationSupport: "partial" }
      ]
    })
  },
  {
    // "The mimic has advantage on attack rolls against any creature grappled by it."
    match: /^Grappler$/i,
    build: () => ({ automationSupport: "full", effects: [{ kind: "attack-advantage", condition: "target-grappled-by-self" }] })
  },
  {
    match: /^Evasion$/i,
    build: () => ({ automationSupport: "full", effects: [{ kind: "evasion" }] })
  },
  {
    // "The stalker is invisible." Attacks against it have disadvantage; its own have advantage.
    match: /^Invisibility$/i,
    build: (entry) => (/is invisible\.?$/i.test(entry.desc.trim())
      ? { automationSupport: "full", effects: [{ kind: "attack-advantage", condition: "always" }, { kind: "incoming-attack-modifier", condition: "always", amount: -5 }] }
      : { automationSupport: "manual-only" })
  },
  {
    // "A creature that touches the azer or hits it with a melee attack while within 5 ft. of it takes 5 (1d10) fire damage."
    // Corrosive Form also corrodes nonmagical weapons (not modelled); Fire Form also burns creatures it moves through.
    match: /^(Heated Body|Corrosive Form|Fire Form)$/i,
    build: (entry) => {
      const hit = /hits it with a melee attack while within (\d+) (?:ft\.?|feet) of it takes \d+ \(([^)]+)\) ([a-z]+) damage/i.exec(entry.desc.replace(/\s+/g, " "));
      const type = hit?.[3]?.toLowerCase();
      if (!hit || !type || !isDamageType(type)) return { automationSupport: "manual-only" };
      return {
        automationSupport: /^Heated Body$/i.test(entry.name) ? "full" : "partial",
        effects: [{ kind: "melee-retaliation", withinFt: Number(hit[1]), damage: [{ dice: compactDice(hit[2]!), damageType: type }] }]
      };
    }
  },
  {
    // "At the start of each of the balor's turns, each creature within 5 feet of it takes 10 (3d6) fire damage … A creature
    // that touches the balor or hits it with a melee attack while within 5 feet of it takes 10 (3d6) fire damage."
    match: /^Fire Aura$/i,
    build: (entry) => {
      const text = entry.desc.replace(/\s+/g, " ");
      const aura = /each creature within (\d+) (?:feet|ft\.?) of it takes \d+ \(([^)]+)\) ([a-z]+) damage/i.exec(text);
      const touch = /hits it with a melee attack while within (\d+) (?:feet|ft\.?) of it takes \d+ \(([^)]+)\) ([a-z]+) damage/i.exec(text);
      const type = aura?.[3]?.toLowerCase();
      if (!aura || !type || !isDamageType(type)) return { automationSupport: "manual-only" };
      const damage = [{ dice: compactDice(aura[2]!), damageType: type }];
      return {
        automationSupport: "full",
        emanation: { range: Number(aura[1]), timing: "bearer-turn-start", affects: "all", damage },
        ...(touch ? { effects: [{ kind: "melee-retaliation" as const, withinFt: Number(touch[1]), damage: [{ dice: compactDice(touch[2]!), damageType: type }] }] } : {})
      };
    }
  },
  {
    // "Any creature that starts its turn within 10 feet of the hezrou must succeed on a DC 14 Constitution saving throw or
    // be poisoned until the start of its next turn. On a successful saving throw, the creature is immune … for 24 hours."
    // "Any creature hostile to the pit fiend that starts its turn within 20 feet … DC 21 Wisdom saving throw, unless the
    // pit fiend is incapacitated. On a failed save, the creature is frightened until the start of its next turn."
    match: /^(Stench|Fear Aura)$/i,
    build: (entry) => {
      const text = entry.desc.replace(/\s+/g, " ");
      const range = Number(/starts its turn within (\d+) (?:feet|ft\.?)/i.exec(text)?.[1]);
      const save = /DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i.exec(text);
      const condition = /be (poisoned|frightened) until the start of its next turn|the creature is (poisoned|frightened) until the start of its next turn/i.exec(text);
      if (!range || !save || !condition) return { automationSupport: "manual-only" };
      return {
        automationSupport: "full",
        emanation: {
          range,
          timing: "target-turn-start",
          affects: /hostile to/i.test(text) ? "hostile" : "all",
          save: { ability: save[2]!.slice(0, 3).toLowerCase() as Ability, dc: Number(save[1]) },
          condition: (condition[1] ?? condition[2])!.toLowerCase() as ConditionName,
          immuneOnSave: /immune/i.test(text),
          ...(/unless the [\w -]+ is incapacitated/i.test(text) ? { suppressedWhenIncapacitated: true } : {})
        }
      };
    }
  },
  {
    // "When the mephit dies, it explodes in a burst of … Each creature within 5 ft. of it must …": a death effect.
    match: /^(Death Burst|Death Throes)$/i,
    build: (entry, ctx) => {
      const burst = parseSaveAction({ ...entry, usage_limits: null }, { ...ctx, gaps: new GapLog() });
      if (!burst || burst.kind !== "area-save") return { automationSupport: "manual-only" };
      ctx.deathEffects ??= [];
      ctx.deathEffects.push({
        id: `${ctx.slug}-death-${slugify(entry.name)}`, name: entry.name, description: entry.desc, automationSupport: "full",
        action: { ...burst, actionType: "action", affects: "all" }
      });
      return { automationSupport: "full", informational: true };
    }
  },
];

/** Reference text with no engine effect worth modelling (senses, flavour, environment). */
const INFORMATIONAL = new RegExp(
  "^(Keen (Hearing|Sight|Smell)|False Appearance|Amphibious|Water Breathing|Hold Breath|Devil.s Sight|Web Sense|"
  + "Echolocation|Stone Camouflage|Underwater Camouflage|Illumination|Inscrutable|Mimicry|Standing Leap|Siege Monster|"
  + "Immutable Form|Telepathic Bond|Limited Telepathy|Divine Awareness|Wakeful|Sunlight Sensitivity|Light Sensitivity|"
  + "Ambusher|Faultless Tracker|Blind Senses|Ethereal Sight|Speak with|Hag Coven|Hag Eye|Shared Spellcasting|"
  + "Turn Immunity|Turn Resistance|Turn Defiance|Brute|Magic Weapons|Swarm|Probing Telepathy|Read Thoughts|"
  + "Transparent|Sense Magic|Otherworldly|Rejuvenation|Spider Climb|Web Walker|Ice Walk|Earth Glide|Tunneler|Amorphous|"
  // Phase 9 sweep: senses, travel, flavour and out-of-combat rules — nothing a fight on this map would use.
  + "Keen Senses|Running Leap|Shielded Mind|Hellish Rejuvenation|Tail Spike Regrowth|Ephemeral|Elemental Demise|"
  + "Labyrinthine Recall|Iron Scent|Treasure Sense|Shark Telepathy|Beast of Burden|Night Hag Items|Snow Camouflage|"
  + "Limited Amphibiousness|Ignited Illumination|Variable Illumination|Confer Fire Resistance|Antimagic Susceptibility|"
  + "Mucous Cloud|Adhesive|Bound)",
  "i"
);

/** Traits whose mechanics belong to a later engine phase. */
const GAPS: Array<{ match: RegExp; code: GapCode }> = [
  { match: /^(Spellcasting|Innate Spellcasting)/i, code: "SPELLS" },
  { match: /^Shapechanger/i, code: "TRANSFORM" },
  { match: /^(Incorporeal Movement|Tree Stride)/i, code: "MOVE_TRAIT" }
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
    if (VARIANT_NO_COMBAT_IMPACT.test(entry.name)) feature.informational = true;
    else ctx.gaps.add("VARIANT", entry.name);
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
  if (INFORMATIONAL.test(base)) {
    feature.informational = true;
    return feature;
  }

  ctx.gaps.add("TRAIT_UNMODELED", entry.name);
  return feature;
}

/** Traits that say "weapon attacks are magical" — used to stamp `magical` on the creature's weapon damage. */
export function grantsMagicalWeapons(entry: RawEntry): boolean {
  return /Weapons$/i.test(entry.name.trim()) && /weapon attacks are magical/i.test(entry.desc);
}
