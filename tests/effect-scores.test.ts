import { describe, expect, it } from "vitest";
import {
  createEngineState,
  effectiveDefinition,
  getDefinition,
  hitPointParts,
  movementProfileOf,
  resolveAttackBonus,
  sampleEncounter,
  scoreParts,
  scoresWith,
  type AttackActionDefinition,
  type CreatureDefinition,
  type FeatureEffect,
  type ItemDefinition
} from "@/engine";
import { findSrdItem } from "@/data/srd";
import { hitPointsReadout, scoresReadout } from "@/lib/actor-sheet/summaries";
import { effectSentence } from "@/lib/statblock";

/** EFFECTS_PLAN.md, Phase 3: ability scores its effects set or raise, and everything that follows them. */

type Score = Extract<FeatureEffect, { kind: "ability-score" }>;

const creature = (overrides: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id: "c", name: "C", size: "medium", armorClass: 12, maxHp: 30, speed: 30, proficiencyBonus: 2,
  abilities: { str: 13, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, actions: [], ...overrides
});
const library = (slug: string): ItemDefinition => structuredClone(findSrdItem(`srd:item:${slug}`)!);
const sources = (...effects: Score[]) => effects.map((effect, index) => ({ label: `S${index + 1}`, effect }));

describe("working out scores", () => {
  it("takes the highest 'at least', then each bonus up to its maximum", () => {
    const base = creature().abilities;
    expect(scoresWith(base, sources({ kind: "ability-score", ability: "str", setTo: 19 })).abilities.str).toBe(19);
    expect(scoresWith(base, sources({ kind: "ability-score", ability: "str", setTo: 19 }, { kind: "ability-score", ability: "str", setTo: 21 })).abilities.str).toBe(21);
    // Already higher: no change.
    expect(scoresWith({ ...base, str: 20 }, sources({ kind: "ability-score", ability: "str", setTo: 19 })).abilities.str).toBe(20);
    expect(scoresWith(base, sources({ kind: "ability-score", ability: "con", bonus: 2, max: 20 })).abilities.con).toBe(16);
    expect(scoresWith({ ...base, con: 19 }, sources({ kind: "ability-score", ability: "con", bonus: 2, max: 20 })).abilities.con).toBe(20);
    expect(scoresWith({ ...base, con: 21 }, sources({ kind: "ability-score", ability: "con", bonus: 2, max: 20 })).abilities.con).toBe(21);
    const both = scoresWith(base, sources({ kind: "ability-score", ability: "con", setTo: 19 }, { kind: "ability-score", ability: "con", bonus: 2, max: 20 }));
    expect(both.abilities.con).toBe(20);
    expect(both.parts.con).toEqual([{ label: "base", value: 14 }, { label: "S1", value: 5 }, { label: "S2", value: 1 }]);
  });
});

describe("the creature its scores make", () => {
  it("Gauntlets of Ogre Power: Strength 19, and its attacks, saves and skills follow", () => {
    const sword: AttackActionDefinition = {
      kind: "attack", id: "sword", name: "Sword", actionType: "action", attackType: "melee", ability: "str", range: 5, reach: 5,
      attackBonusFormula: { ability: "str", proficiency: true }, damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }], automationSupport: "full"
    };
    const fixed: AttackActionDefinition = { ...sword, id: "claw", name: "Claw", attackBonusFormula: undefined, attackBonus: 5 };
    const fighter = creature({ items: [library("gauntlets-of-ogre-power")], actions: [sword, fixed], saves: { str: 3 }, skills: { athletics: 3, acrobatics: 1 } });
    const actual = effectiveDefinition(fighter);
    expect(actual.abilities.str).toBe(19);
    expect(resolveAttackBonus(sword, actual)).toBe(6);
    expect(resolveAttackBonus(fixed, actual)).toBe(5);
    expect(actual.saves).toEqual({ str: 6 });
    expect(actual.skills).toEqual({ athletics: 6, acrobatics: 1 });
    expect(fighter.abilities.str).toBe(13);
    expect(scoreParts(fighter)).toEqual({ str: [{ label: "base", value: 13 }, { label: "Gauntlets of Ogre Power", value: 6 }] });
    expect(scoresReadout(fighter)).toBe("STR 19 (13 base, Gauntlets of Ogre Power +6)");
  });

  it("an item that isn't attuned does nothing", () => {
    const gauntlets = { ...library("gauntlets-of-ogre-power"), attunement: { attuned: false } };
    expect(effectiveDefinition(creature({ items: [gauntlets] })).abilities.str).toBe(13);
  });

  it("Strength 19 lifts heavy armor's slowdown", () => {
    const plate: ItemDefinition = { id: "plate", name: "Plate", type: "armor", armor: { category: "heavy", ac: 18, strength: 15 }, automationSupport: "full" };
    expect(movementProfileOf(effectiveDefinition(creature({ items: [plate] }))).walk).toBe(20);
    expect(movementProfileOf(effectiveDefinition(creature({ items: [plate, library("gauntlets-of-ogre-power")] }))).walk).toBe(30);
  });

  it("Amulet of Health: a character's hit points follow its Constitution (D4); a monster's don't", () => {
    const character = creature({ maxHp: 44, character: { level: 5, classes: [{ name: "Fighter", level: 5 }] }, items: [library("amulet-of-health")] });
    // CON 14 (+2) → 19 (+4): 2 more for each of 5 levels.
    expect(effectiveDefinition(character).maxHp).toBe(54);
    expect(hitPointParts(character)).toEqual([{ label: "base", value: 44 }, { label: "Amulet of Health (Constitution)", value: 10 }]);
    expect(hitPointsReadout(character)).toBe("54: 44 base, Amulet of Health (Constitution) +10");
    const monster = creature({ maxHp: 44, items: [library("amulet-of-health")] });
    expect(effectiveDefinition(monster)).toMatchObject({ maxHp: 44, abilities: { con: 19 } });
  });

  it("Potion of Giant Strength: Strength 21 for an hour, from the condition its drink gives", () => {
    const snapshot = structuredClone(sampleEncounter);
    const state = createEngineState(snapshot);
    const fighter = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    const drink = library("potion-of-giant-strength").grantedActions![0] as Extract<NonNullable<ItemDefinition["grantedActions"]>[number], { kind: "buff" }>;
    fighter.conditions = [{ id: "giant", name: "custom", sourceName: "Potion of Giant Strength", startedRound: 1, effects: drink.appliedCondition.effects }];
    expect(getDefinition(state.snapshot, fighter).abilities.str).toBe(21);
  });

  it("the belts and the headband", () => {
    expect(effectiveDefinition(creature({ items: [library("belt-of-storm-giant-strength")] })).abilities.str).toBe(29);
    expect(effectiveDefinition(creature({ items: [library("belt-of-hill-giant-strength")] })).abilities.str).toBe(21);
    expect(effectiveDefinition(creature({ items: [library("headband-of-intellect")] })).abilities.int).toBe(19);
  });

  it("says what it does", () => {
    const definition = creature();
    expect(effectSentence({ kind: "ability-score", ability: "str", setTo: 19 }, definition)).toBe("Its Strength score is at least 19.");
    expect(effectSentence({ kind: "ability-score", ability: "con", bonus: 2, max: 20 }, definition)).toBe("Its Constitution score increases by 2, to a maximum of 20.");
  });
});
