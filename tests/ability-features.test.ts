import { beforeAll, describe, expect, it } from "vitest";
import {
  featureSources,
  type ActionDefinition,
  type CreatureDefinition,
  type FeatureDefinition,
  type FeatureEffect
} from "@/engine";
import { SRD_FEATURES, findSrdFeature, findSrdSpell } from "@/data/srd";
import { SRD_MONSTER_INDEX, loadSrdMonster } from "@/data/srd/monsters";
import {
  EFFECT_KINDS,
  EFFECT_SPECS,
  THEMES,
  effectCards,
  expandCard,
  modifierCards,
  whenOf,
  withCardReplaced,
  withModifierCard,
  withWhen
} from "@/lib/ability-editor/effects";
import {
  activationOf,
  effectGroupsOf,
  followUpFrom,
  grantedAbilities,
  grantedUtilities,
  groupForNew,
  newGrantedId,
  withActivated,
  withGroupEffects,
  withGrantedUtility
} from "@/lib/ability-editor/features";
import { withReplacedAbility } from "@/lib/ability-editor/records";
import { sectionsFor } from "@/lib/ability-editor/sections";
import { FEATURE_TEMPLATES, blankFeature } from "@/lib/ability-editor/templates";
import { abilityWarnings } from "@/lib/ability-editor/validate";
import { deepEqual } from "@/lib/deep-equal";
import { featureStatblock } from "@/lib/statblock";

/** Phase 4's model: the effect registry, "When", cards, a feature's activation, what it grants, warnings, and round trips. */

const creature = (overrides: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id: "c", name: "C", size: "medium", armorClass: 14, maxHp: 30, speed: 30, proficiencyBonus: 2,
  abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 14 }, actions: [], ...overrides
});
const bite: Extract<ActionDefinition, { kind: "attack" }> = {
  kind: "attack", id: "bite", name: "Bite", actionType: "action", attackType: "melee", ability: "str", range: 5, reach: 5,
  damage: [{ dice: "1d10", damageType: "piercing", abilityModifier: "str" }], automationSupport: "full"
};
const library = (id: string): FeatureDefinition => structuredClone(findSrdFeature(`srd:feature:${id}`)!);

/** Every feature and trait the SRD monsters carry, with the creature it's on. */
let monsterFeatures: Array<{ definition: CreatureDefinition; feature: FeatureDefinition; list: "features" | "traits" }> = [];
beforeAll(async () => {
  const definitions = (await Promise.all(SRD_MONSTER_INDEX.map((entry) => loadSrdMonster(entry.id)))).filter((d): d is CreatureDefinition => Boolean(d));
  monsterFeatures = definitions.flatMap((definition) => [
    ...(definition.features ?? []).map((feature) => ({ definition, feature, list: "features" as const })),
    ...(definition.traits ?? []).map((feature) => ({ definition, feature, list: "traits" as const }))
  ]);
});

describe("the effect registry", () => {
  it("covers every kind once, each in a theme, each blank its own kind", () => {
    const kinds = EFFECT_KINDS.map((spec) => spec.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toHaveLength(38);
    for (const spec of EFFECT_KINDS) {
      expect(spec.blank().kind).toBe(spec.kind);
      expect(THEMES.map((theme) => theme.theme)).toContain(spec.theme);
    }
  });

  it("offers every kind an SRD monster or the library uses", () => {
    const used = new Set([...SRD_FEATURES, ...monsterFeatures.map((entry) => entry.feature)].flatMap((feature) => [
      ...(feature.effects ?? []),
      ...(activationOf(feature)?.condition?.effects ?? [])
    ]).map((effect) => effect.kind));
    for (const kind of used) expect(EFFECT_SPECS[kind], kind).toBeDefined();
  });

  it("asks only effects the engine checks on an attack about the attack and its target", () => {
    expect(EFFECT_SPECS["damage-bonus"].when).toBe("attack");
    expect(EFFECT_SPECS["apply-condition-on-hit"].when).toBe("attack");
    // Checked on the creature alone: only "bloodied" means anything.
    expect(EFFECT_SPECS["damage-adjustment"].when).toBe("self");
    expect(EFFECT_SPECS["save-advantage"].when).toBe("self");
    expect(EFFECT_SPECS["armor-class-bonus"].when).toBe(false);
  });
});

describe("When", () => {
  it("reads one condition, several of which any will do, or all of them", () => {
    expect(whenOf({ kind: "attack-advantage", condition: "ally-adjacent-to-target" })).toMatchObject({ conditions: ["ally-adjacent-to-target"] });
    const sneak = library("sneak-attack").effects![0]!;
    expect(whenOf(sneak)).toMatchObject({ conditions: ["attack-has-advantage", "ally-adjacent-to-target"], mode: "any" });
    expect(whenOf({ kind: "damage-bonus", damage: [], allConditions: ["charged", "target-bloodied"], chargeFeet: 30 }))
      .toEqual({ conditions: ["charged", "target-bloodied"], mode: "all", chargeFeet: 30 });
  });

  it("writes one condition plainly, several as any or all, and a charge's distance only with a charge", () => {
    const blank: FeatureEffect = { kind: "damage-bonus", condition: "always", damage: [{ dice: "1d6", damageType: "same-as-attack" }] };
    expect(withWhen(blank, { conditions: ["self-bloodied"], mode: "all" })).toMatchObject({ condition: "self-bloodied" });
    expect(withWhen(blank, { conditions: ["attack-has-advantage", "ally-adjacent-to-target"], mode: "any" }))
      .toMatchObject({ condition: "always", anyConditions: ["attack-has-advantage", "ally-adjacent-to-target"] });
    expect(withWhen(blank, { conditions: [], mode: "all", chargeFeet: 30 })).toEqual(blank);
    expect(withWhen(blank, { conditions: ["charged"], mode: "all", chargeFeet: 30 })).toMatchObject({ condition: "charged", chargeFeet: 30 });
  });

  it("reads back what it wrote for every SRD effect", () => {
    const effects = monsterFeatures.flatMap((entry) => entry.feature.effects ?? []);
    expect(effects.length).toBeGreaterThan(150);
    for (const effect of effects) {
      expect(whenOf(withWhen(effect, whenOf(effect)))).toEqual(whenOf(effect));
    }
  });
});

describe("cards", () => {
  it("folds Rage's three resistances into one card, and expands them back in place", () => {
    const effects = activationOf(library("rage"))!.condition!.effects!;
    const cards = effectCards(effects);
    expect(cards.map((card) => card.effect.kind)).toEqual(["damage-bonus", "damage-adjustment", "save-advantage"]);
    expect(cards[1]!.damageTypes).toEqual(["bludgeoning", "piercing", "slashing"]);
    const withFire = withCardReplaced(effects, cards[1]!, expandCard(cards[1]!.effect, ["bludgeoning", "piercing", "slashing", "fire"]));
    expect(withFire.map((effect) => (effect.kind === "damage-adjustment" ? effect.adjustment.damageType : effect.kind)))
      .toEqual(["damage-bonus", "bludgeoning", "piercing", "slashing", "fire", "save-advantage"]);
  });

  it("keeps a new resistance a card of its own while it's edited", () => {
    const effects = [...activationOf(library("rage"))!.condition!.effects!, { kind: "damage-adjustment" as const, condition: "always" as const, adjustment: { type: "resistance" as const, damageType: "fire" as const } }];
    expect(effectCards(effects)).toHaveLength(3);
    const apart = effectCards(effects, { from: 5, count: 1 });
    expect(apart).toHaveLength(4);
    expect(apart[3]!.damageTypes).toEqual(["fire"]);
  });

  it("gives back every SRD effect list unchanged when each card is put back as it is", () => {
    for (const { feature } of monsterFeatures) {
      for (const list of [feature.effects ?? [], activationOf(feature)?.condition?.effects ?? []]) {
        let next = list;
        for (const card of effectCards(list)) next = withCardReplaced(next, card, expandCard(card.effect, card.damageTypes));
        expect(next).toEqual(list);
      }
    }
  });

  it("shows a condition's modifiers as cards, and writes their edits back", () => {
    const shield = findSrdSpell("srd:spell:shield")!.action as Extract<ActionDefinition, { kind: "activate-feature" }>;
    const [ac] = modifierCards(shield.condition!.modifiers);
    expect(ac).toMatchObject({ key: "armorClass", effect: { kind: "armor-class-bonus", bonus: { base: 5 } } });
    expect(withModifierCard(shield.condition!.modifiers, ac!, { effect: { kind: "armor-class-bonus", bonus: { base: 4 } } })).toEqual({ armorClass: 4 });
    expect(withModifierCard(shield.condition!.modifiers, ac!, undefined)).toBeUndefined();

    const bless = { savingThrows: { str: 2, dex: 2, con: 2, int: 2, wis: 2, cha: 2 }, attackRoll: 2 };
    const cards = modifierCards(bless);
    expect(cards.map((card) => card.key)).toEqual(["attackRoll", "savingThrows"]);
    expect(cards[1]!.abilities).toHaveLength(6);
    expect(withModifierCard(bless, cards[1]!, { effect: cards[1]!.effect!, abilities: ["wis", "cha"] }))
      .toEqual({ attackRoll: 2, savingThrows: { wis: 2, cha: 2 } });

    const stone = { damageAdjustments: [{ type: "resistance" as const, damageType: "bludgeoning" as const, nonMagicalOnly: true }, { type: "resistance" as const, damageType: "piercing" as const, nonMagicalOnly: true }], deniesReactions: true };
    const stoneCards = modifierCards(stone);
    expect(stoneCards.map((card) => card.key)).toEqual(["damageAdjustments", "deniesReactions"]);
    expect(stoneCards[0]!.damageTypes).toEqual(["bludgeoning", "piercing"]);
    expect(stoneCards[1]!.effect).toBeUndefined();
    const fire = withModifierCard(stone, stoneCards[0]!, { effect: stoneCards[0]!.effect!, damageTypes: ["bludgeoning", "piercing", "slashing"] });
    expect(fire?.damageAdjustments?.map((adjustment) => adjustment.damageType)).toEqual(["bludgeoning", "piercing", "slashing"]);
    expect(withModifierCard(stone, stoneCards[1]!, undefined)).toEqual({ damageAdjustments: stone.damageAdjustments });
  });

  it("gives back every condition's modifiers unchanged when each card is put back as it is", () => {
    const conditions = [
      ...monsterFeatures.flatMap((entry) => [...(entry.definition.reactions ?? []), ...entry.definition.actions]),
      ...[findSrdSpell("srd:spell:shield")!, findSrdSpell("srd:spell:bless")!, findSrdSpell("srd:spell:stoneskin")!].map((spell) => spell?.action)
    ].flatMap((action) => (action?.kind === "activate-feature" ? [action.condition?.modifiers] : action?.kind === "buff" ? [action.appliedCondition.modifiers] : []))
      .filter((modifiers): modifiers is NonNullable<typeof modifiers> => Boolean(modifiers));
    expect(conditions.length).toBeGreaterThan(3);
    for (const modifiers of conditions) {
      let next: typeof modifiers | undefined = modifiers;
      for (const card of modifierCards(modifiers)) {
        if (!card.effect) continue;
        next = withModifierCard(next, modifierCards(next).find((candidate) => candidate.key === card.key && deepEqual(candidate.effect, card.effect))!, { effect: card.effect, abilities: card.abilities, damageTypes: card.damageTypes });
      }
      expect(deepEqual(next, modifiers)).toBe(true);
    }
  });
});

describe("a feature that's switched on", () => {
  it("moves what's always on into the activation, and back, restoring the old activation", () => {
    const pack = library("pack-tactics");
    const on = withActivated(pack, true);
    const activation = activationOf(on.feature)!;
    expect(activation).toMatchObject({ kind: "activate-feature", actionType: "bonus", name: "Pack Tactics", condition: { durationRounds: 10, effects: pack.effects } });
    expect(on.feature.effects).toBeUndefined();
    const off = withActivated(on.feature, false);
    expect(off.feature).toEqual(pack);
    expect(withActivated(off.feature, true, off.parked).feature).toEqual(on.feature);
  });

  it("keeps Action Surge's extra action on the feature, and turns Reckless Attack's modifier into an effect when it's always on", () => {
    const surge = library("action-surge");
    expect(effectGroupsOf(surge).map((group) => [group.id, group.effects.length])).toEqual([["on-activate", 1], ["while-active", 0]]);
    expect(groupForNew(surge, { kind: "extra-action", slot: "bonus" })).toBe("on-activate");
    expect(groupForNew(surge, { kind: "evasion" })).toBe("while-active");

    const reckless = withActivated(library("reckless-attack"), false).feature;
    expect(reckless.effects).toEqual([
      { kind: "attack-advantage", condition: "always", attackTypes: ["melee"], abilities: ["str"] },
      { kind: "incoming-attack-modifier", condition: "always", amount: 5 }
    ]);
  });

  it("writes each group's effects back where the engine reads them", () => {
    const rage = library("rage");
    const effects = effectGroupsOf(rage).find((group) => group.id === "while-active")!.effects;
    const next = withGroupEffects(rage, "while-active", [...effects, { kind: "evasion" }]);
    expect(activationOf(next)!.condition!.effects).toHaveLength(effects.length + 1);
    const surge = withGroupEffects(library("action-surge"), "on-activate", [{ kind: "extra-action", slot: "action" }, { kind: "extra-action", slot: "bonus" }]);
    expect(surge.effects).toHaveLength(2);
  });
});

describe("what it grants", () => {
  it("adds Dash, Disengage and Hide as bonus actions, and takes them away", () => {
    const cunning = library("cunning-action");
    expect(grantedUtilities(cunning)).toEqual(["dash", "disengage", "hide"]);
    expect(grantedAbilities(cunning)).toEqual([]);
    const fresh = withGrantedUtility(withGrantedUtility(blankFeature(), "dash", true), "disengage", true);
    expect(fresh.grantedActions?.map((action) => action.kind === "utility" && action.mode)).toEqual(["dash", "disengage"]);
    expect(withGrantedUtility(withGrantedUtility(fresh, "dash", false), "disengage", false).grantedActions).toBeUndefined();
  });

  it("makes Pounce's and Rampage's follow-ups from one of its attacks", () => {
    expect(followUpFrom(bite, "Pounce", "charge-hit", "p")).toMatchObject({ id: "p", name: "Bite (Pounce)", actionType: "bonus", onlyAfter: "charge-hit", requiresTargetCondition: "prone" });
    expect(followUpFrom(bite, "Rampage", "dropped-creature", "r")).toMatchObject({ name: "Bite (Rampage)", onlyAfter: "dropped-creature", grantsMovementFeet: 15 });
  });

  it("names a new granted ability as a save would", () => {
    expect(newGrantedId({ id: "", grantedActions: [] })).toBe("granted-1");
    expect(newGrantedId({ id: "feat", grantedActions: [{ ...bite, id: "feat-granted-1" }] })).toBe("feat-granted-2");
  });
});

describe("recipes", () => {
  it("builds every feature recipe the simulator uses, with a sentence for it", () => {
    const fighter = creature({ actions: [bite] });
    for (const template of FEATURE_TEMPLATES) {
      const record = template.record([bite]);
      expect(record.automationSupport, template.label).toBe("full");
      expect(featureStatblock(record, fighter).text.length, template.label).toBeGreaterThan(10);
    }
    const pounce = FEATURE_TEMPLATES.find((template) => template.label === "Pounce")!.record([bite]);
    expect(pounce.grantedActions?.[0]).toMatchObject({ name: "Bite (Pounce)", onlyAfter: "charge-hit" });
  });

  it("matches the library where both have a feature", () => {
    const rage = FEATURE_TEMPLATES.find((template) => template.label === "Rage")!.record([]);
    expect(activationOf(rage)!.condition!.effects).toEqual(activationOf(library("rage"))!.condition!.effects);
    expect(FEATURE_TEMPLATES.find((template) => template.label === "Pack Tactics")!.record([]).effects).toEqual(library("pack-tactics").effects);
  });
});

describe("warnings for features", () => {
  const ids = (record: FeatureDefinition, definition = creature()) => abilityWarnings(definition, record.category === "trait" ? "traits" : "features", record).map((warning) => warning.id);

  it("says nothing about the library's simulated features but Action Surge's and Reckless Attack's switch", () => {
    for (const feature of SRD_FEATURES.filter((candidate) => candidate.automationSupport === "full")) {
      const expected = ["action-surge", "reckless-attack"].some((id) => feature.id.endsWith(id)) ? ["activation-never-automatic"]
        // This creature has no weapon attack for Extra Attack's swings to make.
        : feature.id.endsWith("extra-attack") ? ["generic-step-empty"] : [];
      expect(ids(feature), feature.name).toEqual(expected);
    }
  });

  it("warns about a switch that does nothing, or that the AI never takes", () => {
    const on = withActivated(blankFeature(), true).feature;
    expect(ids(on)).toContain("activation-does-nothing");
    expect(ids(on)).toContain("activation-not-worth-it");
    const guarded = withGroupEffects(on, "while-active", [{ kind: "incoming-attack-modifier", condition: "always", amount: -5 }]);
    expect(ids(guarded)).toEqual(["activation-not-worth-it"]);
    const parry: FeatureDefinition = {
      ...blankFeature(), name: "Parry",
      grantedActions: [{
        kind: "activate-feature", id: "a", name: "Parry", actionType: "reaction", featureId: "", automationSupport: "full",
        reaction: { trigger: { kind: "targeted-by-attack" } }, condition: { name: "custom", durationRounds: 1, modifiers: { armorClass: 3 } }
      }]
    };
    expect(ids(parry)).toEqual(["reaction-never-taken"]);
  });

  it("warns about effects that can't work where they are", () => {
    expect(ids({ ...blankFeature(), effects: [{ kind: "extra-action", slot: "action" }] })).toEqual(["needs-activation"]);
    expect(ids({ ...blankFeature(), effects: [{ kind: "incoming-hit-damage", condition: "always", damage: [{ dice: "1d6", damageType: "fire" }] }] })).toEqual(["needs-duration"]);
    // While it's switched on, a mark on itself is fine.
    const on = withGroupEffects(withActivated(blankFeature(), true).feature, "while-active", [{ kind: "incoming-hit-damage", condition: "always", damage: [{ dice: "1d6", damageType: "fire" }] }]);
    expect(ids(on)).not.toContain("needs-duration");
  });

  it("warns about an aura that shares nothing it can, and one that harms nothing", () => {
    expect(ids({ ...library("pack-tactics"), aura: { range: 10, affects: "allies" } })).toEqual(["aura-shares-nothing"]);
    expect(ids(library("aura-of-protection"))).toEqual([]);
    expect(ids({ ...blankFeature(), emanation: { range: 10, timing: "target-turn-start", affects: "all" } })).toEqual(["emanation-does-nothing"]);
  });
});

describe("the simulator and features kept for reference", () => {
  it("applies a feature's effects only while it's simulated", () => {
    const tough = (patch: Partial<FeatureDefinition>): CreatureDefinition => creature({
      traits: [{ id: "t", name: "Stone Skin", category: "trait", automationSupport: "full", effects: [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "fire" } }], ...patch }]
    });
    expect(featureSources(tough({}))).toHaveLength(1);
    expect(featureSources(tough({ automationSupport: "manual-only" }))).toHaveLength(0);
    expect(featureSources(tough({ informational: true }))).toHaveLength(0);
    expect(featureSources(tough({ automationSupport: "partial" }))).toHaveLength(1);
  });

  it("changes nothing for the SRD: no feature it keeps for reference does anything", () => {
    for (const { feature } of monsterFeatures) {
      if (feature.automationSupport === "manual-only" || feature.automationSupport === "unsupported" || feature.informational) {
        expect(Boolean(feature.effects?.length || feature.aura || feature.emanation), feature.name).toBe(false);
      }
    }
  });
});

describe("round trips", () => {
  it("puts every SRD and library feature back unchanged", () => {
    const entries = [
      ...monsterFeatures,
      ...SRD_FEATURES.map((feature) => {
        const list = feature.category === "trait" ? "traits" as const : "features" as const;
        const definition = creature({ [list]: [structuredClone(feature)] });
        return { definition, feature: definition[list]![0]!, list };
      })
    ];
    for (const { definition, feature, list } of entries) {
      const replaced = withReplacedAbility(definition, { list, id: feature.id }, structuredClone(feature));
      expect(replaced, feature.name).toBeDefined();
      const back = (replaced!.definition[list] ?? []).find((candidate) => candidate.id === feature.id);
      expect(deepEqual(back, feature), `${definition.name}: ${feature.name}`).toBe(true);
      // Its sections all have something to say.
      for (const section of sectionsFor({ ref: { list, id: feature.id }, record: feature, definition })) {
        expect(section.summary.length, `${feature.name} ${section.id}`).toBeGreaterThan(0);
      }
    }
  });
});
