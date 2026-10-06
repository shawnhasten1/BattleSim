import { describe, expect, it } from "vitest";
import {
  armorClassOf,
  createEngineState,
  effectiveDefinition,
  getExecutableActions,
  resolveActivateFeatureAction,
  resolveAttack,
  resolveMultiattackAction,
  sampleEncounter,
  SeededRandom,
  type CreatureDefinition,
  type FeatureDefinition,
  type RandomSource
} from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";
import { SRD_2024_REFERENCE } from "@/data/srd/2024/reference";
import { blankCharacter, quickBuild, rebuildActor } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/** PC builder plan, Phase 4: the Barbarian (Path of the Berserker) and the Monk (Warrior of the Open Hand). */

const built = (classId: string, level: number): CreatureDefinition =>
  rebuildActor(blankCharacter(`def-${classId}-${level}`, "PC"), quickBuild(SRD_BUILD_SOURCES, { classId: `srd:class:${classId}`, level }), SRD_BUILD_SOURCES).definition;

const feature = (definition: CreatureDefinition, id: string): FeatureDefinition => {
  const found = definition.features?.find((entry) => entry.id === id);
  if (!found) throw new Error(`no ${id}: ${(definition.features ?? []).map((entry) => entry.id).join(", ")}`);
  return found;
};

const column = (classKey: string, id: string) =>
  SRD_2024_REFERENCE.classes.find((entry) => entry.key === `srd-2024_${classKey}`)!.columns.find((entry) => entry.id === id)!.values;

function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("martials");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** The sample fight with this character in the fighter's place, the first goblin next to it. */
function fightWith(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 40; }
    if (token.id === "enemy-goblin-2") token.position = { x: 9, y: 9 };
  }
  snapshot.definitions.find((entry) => entry.id === "def-goblin")!.maxHp = 40;
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  return createEngineState(snapshot);
}

describe("the Barbarian", () => {
  it("rages as often, and for as much, as its table says", () => {
    const rages = column("barbarian", "rages");
    const damage = column("barbarian", "rage-damage");
    for (const level of [1, 3, 9, 16, 20]) {
      const barbarian = built("barbarian", level);
      expect(barbarian.resources?.rage, `level ${level}`).toBe(rages[level - 1]);
      const activation = feature(barbarian, "barbarian-rage").grantedActions?.[0];
      expect(activation && activation.kind === "activate-feature" ? activation.condition?.effects?.[0] : undefined, `level ${level}`)
        .toMatchObject({ kind: "damage-bonus", abilities: ["str"], damage: [{ dice: String(damage[level - 1]) }] });
    }
  });

  it("has AC 10 + Dex + Con without armor, is faster from 5th, and a primal champion at 20th", () => {
    const first = built("barbarian", 1);
    const mod = (score: number) => Math.floor((score - 10) / 2);
    expect(armorClassOf(first).total).toBe(10 + mod(first.abilities.dex) + mod(first.abilities.con));
    // Fast Movement is an effect now (EFFECTS_PLAN.md D6): the base stays 30, the barbarian moves 40, not in heavy armor.
    expect(effectiveDefinition(built("barbarian", 4)).speed).toBe(30);
    expect(built("barbarian", 5).speed).toBe(30);
    expect(effectiveDefinition(built("barbarian", 5)).speed).toBe(40);
    const plate = { id: "plate", name: "Plate", type: "armor" as const, armor: { category: "heavy" as const, ac: 18, strength: 15 }, automationSupport: "full" as const };
    expect(effectiveDefinition({ ...built("barbarian", 5), items: [plate] }).speed).toBe(30);
    const twentieth = built("barbarian", 20);
    expect(twentieth.abilities.str).toBeGreaterThan(20);
    expect(twentieth.abilities.str).toBeLessThanOrEqual(25);
    expect(twentieth.abilities.con).toBeLessThanOrEqual(25);
  });

  it("Frenzy: the extra d6s only while raging and reckless, once a turn", () => {
    const berserker = built("barbarian", 9);
    expect(feature(berserker, "path-of-the-berserker-frenzy").effects?.[0]).toMatchObject({
      whileCondition: "rage-active", whileConditions: ["reckless-attack-active"], damage: [{ dice: "3d6" }]
    });
    const greataxe = berserker.weapons!.find((weapon) => weapon.name === "Greataxe")!;
    const state = fightWith(berserker);
    const hp = () => state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!.currentHp;
    // Not raging, with advantage: no Frenzy. (The Soldier's Savage Attacker rolls the axe again on the turn's first hit: a 1.)
    state.rng = scripted([18, 18, 6, 1]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", greataxe.actionId!, { advantage: true });
    const unraged = 40 - hp();
    // Raging (a bonus action) with advantage, but not reckless: only Rage's +3.
    state.snapshot.combatants.find((token) => token.id === "pc-fighter")!.actionEconomy = undefined;
    const actions = getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-fighter")!);
    resolveActivateFeatureAction(state, "pc-fighter", actions.find((action) => action.name === "Rage")!.id);
    let before = hp();
    state.rng = scripted([18, 18, 6]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", greataxe.actionId!, { advantage: true });
    expect(before - hp()).toBe(unraged + 3);
    // Raging and reckless: 3d6 more on the first hit. (A second swing this turn, as Extra Attack gives.)
    state.snapshot.combatants.find((token) => token.id === "pc-fighter")!.actionEconomy = { action: true, bonus: false, reaction: true };
    resolveActivateFeatureAction(state, "pc-fighter", actions.find((action) => action.name === "Reckless Attack")!.id);
    state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!.currentHp = 40;
    before = hp();
    state.rng = scripted([18, 18, 6, 4, 4, 4]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", greataxe.actionId!);
    expect(before - hp()).toBe(unraged + 3 + 12); // rage damage +3 and 4 + 4 + 4
  });

  it("Intimidating Presence frightens the enemies around it, not its allies", () => {
    const berserker = built("barbarian", 14);
    const presence = getExecutableActions(berserker).find((action) => action.name === "Intimidating Presence");
    expect(presence).toMatchObject({ kind: "area-save", actionType: "bonus", affects: "hostile", saveAbility: "wis" });
    expect(berserker.resources?.["intimidating-presence"]).toBe(1);
  });

  it("rages and swings in a fight the AI runs", () => {
    const state = fightWith(built("barbarian", 5));
    const result = runAutomatedEncounter({ ...state.snapshot, seed: "barbarian", round: 0, turnIndex: 0 }, 20);
    expect(result.log.some((entry) => entry.type === "ActionDeclared" && entry.data?.actionName === "Rage")).toBe(true);
    expect(result.outcome.completed).toBe(true);
  });
});

describe("the Monk", () => {
  it("strikes unarmed with the Martial Arts die, force damage from 6th level, also as a bonus action", () => {
    const dice = column("monk", "martial-arts");
    for (const level of [1, 5, 6, 11, 17]) {
      const unarmed = built("monk", level).weapons!.find((weapon) => weapon.id === "monk-martial-arts")!;
      expect(unarmed.damage[0], `level ${level}`).toMatchObject({ dice: dice[level - 1], damageType: level >= 6 ? "force" : "bludgeoning" });
      expect(unarmed.ability).toBe("finesse");
      expect(unarmed.usableAs).toEqual(["action", "bonus", "reaction"]);
    }
  });

  it("has focus points by level, Flurry of Blows of two (three from 10th), and moves faster", () => {
    expect(built("monk", 1).resources?.["focus-points"]).toBeUndefined();
    expect(built("monk", 5).resources?.["focus-points"]).toBe(5);
    const flurry = (level: number) => getExecutableActions(built("monk", level)).find((action) => action.name === "Flurry of Blows");
    expect(flurry(2)).toMatchObject({ kind: "multiattack", actionType: "bonus", attacks: [{ actionId: "monk-martial-arts:bonus", count: 2 }], resourceCost: { resourceId: "focus-points", amount: 1 } });
    expect(flurry(10)).toMatchObject({ attacks: [{ count: 3 }] });
    // Unarmored Movement is an effect now, scaled by the table: none in armor or with a shield.
    expect(effectiveDefinition(built("monk", 1)).speed).toBe(30);
    expect(built("monk", 2).speed).toBe(30);
    expect(effectiveDefinition(built("monk", 2)).speed).toBe(40);
    expect(effectiveDefinition(built("monk", 6)).speed).toBe(45);
    expect(effectiveDefinition(built("monk", 18)).speed).toBe(60);
    const shield = { id: "shield", name: "Shield", type: "shield" as const, armor: { category: "shield" as const, ac: 2 }, automationSupport: "full" as const };
    expect(effectiveDefinition({ ...built("monk", 6), items: [shield] }).speed).toBe(30);
  });

  it("Stunning Strike from 5th level: an optional upgrade of the Unarmed Strike that spends a focus point", () => {
    expect(built("monk", 4).weapons!.find((weapon) => weapon.id === "monk-martial-arts")!.onHit ?? []).toEqual([]);
    const monk = built("monk", 5);
    const stunned = getExecutableActions(monk).find((action) => action.name === "Unarmed Strike (1 focus point)");
    expect(stunned).toMatchObject({ resourceCost: { resourceId: "focus-points", amount: 1 } });
    expect(stunned && "riders" in stunned ? stunned.riders?.[0] : undefined).toMatchObject({
      kind: "condition", condition: "stunned", duration: { kind: "until-source-turn", timing: "start" },
      save: { ability: "con", dcFormula: { base: 8, ability: "wis", proficiency: true } }
    });
  });

  it("Open Hand Technique knocks a creature its Flurry hits prone, on a failed Dexterity save", () => {
    const monk = built("monk", 3);
    const state = fightWith(monk);
    state.rng = scripted([19, 4, 1]);
    // Phase 7aa: Topple is one of Flurry of Blows' strikes, not the plain bonus one.
    const topple = getExecutableActions(monk).find((action) => action.name.includes("Open Hand: Topple"))!;
    const flurry = getExecutableActions(monk).find((action) => action.name === "Flurry of Blows")!;
    resolveMultiattackAction(state, "pc-fighter", ["enemy-goblin-1"], flurry.id, { attackActionIds: [topple.id, topple.id] });
    expect(state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!.conditions?.some((condition) => condition.name === "prone")).toBe(true);
  });

  it("Wholeness of Body heals the Martial Arts die + Wis, Wis-modifier times", () => {
    const monk = built("monk", 6);
    const heal = getExecutableActions(monk).find((action) => action.name === "Wholeness of Body");
    expect(heal).toMatchObject({ kind: "healing", actionType: "bonus", healing: [{ dice: "1d8", abilityModifier: "wis" }] });
    expect(monk.resources?.["wholeness-of-body"]).toBe(Math.max(1, Math.floor((monk.abilities.wis - 10) / 2)));
  });

  it("is proficient in every save from 14th level", () => {
    expect(Object.keys(built("monk", 13).saves ?? {}).sort()).toEqual(["dex", "str"]);
    expect(Object.keys(built("monk", 14).saves ?? {}).sort()).toEqual(["cha", "con", "dex", "int", "str", "wis"]);
  });

  it("uses Flurry of Blows in a fight the AI runs", () => {
    const state = fightWith(built("monk", 5));
    const result = runAutomatedEncounter({ ...state.snapshot, seed: "monk", round: 0, turnIndex: 0 }, 20);
    expect(result.log.some((entry) => entry.type === "ActionDeclared" && entry.data?.actionName === "Flurry of Blows")).toBe(true);
    expect(result.outcome.completed).toBe(true);
  });
});
