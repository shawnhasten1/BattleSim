import { describe, expect, it } from "vitest";
import {
  actionProblem,
  attackRollInputs,
  createEngineState,
  getExecutableActions,
  moveCombatant,
  resolveActivateFeatureAction,
  resolveAttack,
  rollSavingThrow,
  sampleEncounter,
  takeAutomatedTurn,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { normalizeWeaponDefinition } from "@/engine/import-normalize";
import { blankCharacter, quickBuild, rebuildActor, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7s: Brutal Strike. An on-hit option paid with the attack roll's advantage
 * (`forgoesAdvantage`): a variant of each Strength attack, once a turn while Reckless Attack is on, not with
 * disadvantage; a hit adds 1d10 (2d10 at 17th level) of the weapon's type and a blow's effects.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const barbarian = (level: number) => actor(quickBuild(sources, { classId: "srd:class:barbarian", level }));

/** d20s as listed, then 10s; every other die its lowest. */
function d20s(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({ next: () => 0, nextInt: (min, max) => (max === 20 ? values[index++] ?? 10 : min), fork: make });
  return make();
}

/** The barbarian in the fighter's place next to the first goblin (sturdy, AC `ac`), the archer beside it, on its turn. */
function fight(definition: CreatureDefinition, ac = 15) {
  const snapshot = structuredClone(sampleEncounter);
  const goblin = sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!;
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...goblin, maxHp: 300, armorClass: ac }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 5, y: 4 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 300; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 12, y: 1 }; token.currentHp = 300; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const use = (name: string) => {
    const found = getExecutableActions(definition).find((entry) => entry.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };
  const reckless = () => resolveActivateFeatureAction(state, "pc-fighter", use("Reckless Attack").id);
  return { state, find, use, reckless };
}

const forgone = (state: ReturnType<typeof fight>["state"]) => state.log.filter((entry) => entry.type === "FeatureEffectApplied" && entry.data?.forgoesAdvantage);

describe("Brutal Strike's variants", () => {
  it("at 9th level, Hamstring and Forceful Blows on each Strength attack", () => {
    const names = getExecutableActions(barbarian(9)).filter((entry) => entry.name.includes("Brutal Strike")).map((entry) => entry.name);
    expect(names).toContain("Greataxe (Brutal Strike: Hamstring Blow)");
    expect(names).toContain("Greataxe (Brutal Strike: Forceful Blow)");
    expect(names.some((name) => /Staggering|Sundering/.test(name))).toBe(false);
  });

  it("at 13th level all four, the one feature in Brutal Strike's place", () => {
    const definition = barbarian(13);
    const names = getExecutableActions(definition).filter((entry) => entry.name.startsWith("Greataxe (Brutal Strike")).map((entry) => entry.name);
    expect(names).toEqual(["Hamstring", "Forceful", "Staggering", "Sundering"].map((blow) => `Greataxe (Brutal Strike: ${blow} Blow)`));
    expect(definition.features?.some((feature) => feature.name === "Brutal Strike")).toBe(false);
  });

  it("at 17th level, two different blows each and 2d10", () => {
    const actions = getExecutableActions(barbarian(17)).filter((entry) => entry.name.startsWith("Greataxe (Brutal Strike"));
    expect(actions).toHaveLength(6);
    expect(actions.map((entry) => entry.name)).toContain("Greataxe (Brutal Strike: Hamstring + Sundering Blows)");
    const first = actions[0]!;
    expect(first.kind === "attack" && first.riders?.find((rider) => rider.kind === "damage")).toMatchObject({ components: [{ dice: "2d10" }] });
  });
});

describe("Brutal Strike", () => {
  it("needs Reckless Attack on; without it the swing is a plain one", () => {
    const definition = barbarian(9);
    const { state, find, use } = fight(definition);
    const hamstring = use("Greataxe (Brutal Strike: Hamstring Blow)");
    expect(actionProblem(state.snapshot, "pc-fighter", hamstring.id)).toBe("Brutal Strike: Hamstring Blow needs Reckless Attack first");
    state.rng = d20s(15);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", hamstring.id);
    expect(forgone(state)).toHaveLength(0);
    expect(find("enemy-goblin-1").conditions?.some((condition) => condition.sourceName === "Hamstring Blow") ?? false).toBe(false);
  });

  it("with Reckless Attack: the roll gives up its advantage, and a hit adds 1d10 of the weapon's type and the blow", () => {
    const definition = barbarian(9);
    // A bludgeoning greataxe, to see the extra die take the weapon's type.
    definition.weapons = definition.weapons?.map((weapon) => (weapon.name === "Greataxe" ? { ...weapon, damage: weapon.damage.map((component) => ({ ...component, damageType: "bludgeoning" as const })) } : weapon));
    const { state, find, use, reckless } = fight(definition);
    reckless();
    expect(actionProblem(state.snapshot, "pc-fighter", use("Greataxe (Brutal Strike: Hamstring Blow)").id)).toBeUndefined();
    state.rng = d20s(15);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", use("Greataxe (Brutal Strike: Hamstring Blow)").id);
    expect(forgone(state)).toHaveLength(1);
    expect(state.log.find((entry) => entry.type === "AttackRolled")?.data?.rollMode).toBe("normal");
    const extra = state.log.filter((entry) => entry.type === "DamageApplied").at(-1)!;
    expect(extra.data?.components).toMatchObject([{ damageType: "bludgeoning", roll: { expression: "1d10" } }]);
    const hamstrung = find("enemy-goblin-1").conditions?.find((condition) => condition.sourceName === "Hamstring Blow");
    expect(hamstrung?.modifiers?.speedPenaltyFt).toBe(15);
  });

  it("once a turn: a second keeps its advantage and adds nothing", () => {
    const { state, find, use, reckless } = fight(barbarian(9));
    reckless();
    state.rng = d20s(15, 15, 15);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", use("Greataxe (Brutal Strike: Hamstring Blow)").id);
    // A second swing of the turn (as Extra Attack's).
    find("pc-fighter").actionEconomy = { ...find("pc-fighter").actionEconomy!, action: true };
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", use("Greataxe (Brutal Strike: Forceful Blow)").id);
    expect(forgone(state)).toHaveLength(1);
    expect(state.log.filter((entry) => entry.type === "AttackRolled").map((entry) => entry.data?.rollMode)).toEqual(["normal", "advantage"]);
  });

  it("not on a roll with disadvantage", () => {
    const { state, find, use, reckless } = fight(barbarian(9));
    reckless();
    // Sap: disadvantage on its next attack roll.
    find("pc-fighter").conditions = [...(find("pc-fighter").conditions ?? []), { id: "sapped", name: "custom", sourceId: "x", startedRound: 1, nextAttack: { role: "made", mode: "disadvantage" } }];
    state.rng = d20s(15, 15);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", use("Greataxe (Brutal Strike: Hamstring Blow)").id);
    expect(forgone(state)).toHaveLength(0);
    expect(find("enemy-goblin-1").conditions?.some((condition) => condition.sourceName === "Hamstring Blow") ?? false).toBe(false);
  });

  it("Forceful Blow pushes it 15 ft and gives half its speed more, provoking nothing", () => {
    const { state, find, use, reckless } = fight(barbarian(9));
    reckless();
    state.rng = d20s(15);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", use("Greataxe (Brutal Strike: Forceful Blow)").id);
    expect(find("enemy-goblin-1").position).toEqual({ x: 7, y: 3 });
    expect(find("pc-fighter").turnFlags).toMatchObject({ disengaged: true });
    expect(find("pc-fighter").turnFlags?.bonusMovement).toBeGreaterThan(0);
  });
});

describe("Improved Brutal Strike", () => {
  it("Staggering Blow: disadvantage on its next save (used up by it), and no opportunity attacks", () => {
    const { state, find, use, reckless } = fight(barbarian(13));
    reckless();
    state.rng = d20s(15);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", use("Greataxe (Brutal Strike: Staggering Blow)").id);
    state.rng = d20s(18, 4, 18, 18);
    const first = rollSavingThrow(state, find("enemy-goblin-1"), { ability: "con", dc: 30, kind: "feature" });
    expect(first.roll.rolls.map((roll) => roll.value)).toEqual([18, 4]);
    const second = rollSavingThrow(state, find("enemy-goblin-1"), { ability: "con", dc: 30, kind: "feature" });
    expect(second.roll.rolls).toHaveLength(1);
    // The barbarian walks off: the staggered goblin can't take its opportunity attack.
    moveCombatant(state, "pc-fighter", { x: 1, y: 3 });
    expect(state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "enemy-goblin-1")).toBe(false);
  });

  it("Sundering Blow: +5 to the next attack roll against it by another creature, not the barbarian's", () => {
    const { state, find, use, reckless } = fight(barbarian(13));
    const archerAttack = getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-archer")!).find((entry) => entry.kind === "attack")!;
    const before = attackRollInputs(state, find("pc-archer"), find("enemy-goblin-1"), archerAttack as never).totalBonus;
    reckless();
    state.rng = d20s(15);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", use("Greataxe (Brutal Strike: Sundering Blow)").id);
    expect(attackRollInputs(state, find("pc-archer"), find("enemy-goblin-1"), archerAttack as never).totalBonus).toBe(before + 5);
    const greataxe = use("Greataxe");
    const own = attackRollInputs(state, find("pc-fighter"), find("enemy-goblin-1"), greataxe as never);
    expect(own.totalBonus).toBe(attackRollInputs(createEngineState(state.snapshot), find("pc-fighter"), find("enemy-goblin-1"), greataxe as never).totalBonus);
    expect(find("enemy-goblin-1").conditions?.find((condition) => condition.sourceName === "Sundering Blow")?.nextAttack).toMatchObject({ bonus: 5, notBy: "pc-fighter" });
  });

  it("keeps its rider fields through an import", () => {
    const weapon = normalizeWeaponDefinition({
      id: "w", name: "Maul", attackType: "melee", damage: [{ dice: "2d6", damageType: "bludgeoning" }],
      onHit: [
        { kind: "condition", when: "on-hit", condition: { custom: "Sundered" }, duration: { kind: "until-source-turn", timing: "start" }, nextAttack: { role: "against", bonus: 5, byOthers: true } },
        { kind: "condition", when: "on-hit", condition: { custom: "Staggered" }, duration: { kind: "permanent" }, nextSave: { mode: "disadvantage" } }
      ]
    });
    expect(weapon.onHit).toMatchObject([
      { nextAttack: { role: "against", bonus: 5, byOthers: true } },
      { nextSave: { mode: "disadvantage" } }
    ]);
  });
});

describe("the AI and Brutal Strike", () => {
  const swings = (ac: number) => {
    const { state, find } = fight(barbarian(9), ac);
    find("pc-fighter").tacticsProfile = "brute";
    takeAutomatedTurn(state, find("pc-fighter"));
    return {
      swung: state.log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter").map((entry) => entry.message),
      forgone: forgone(state).length
    };
  };

  it("against a low AC, gives up one swing's advantage for the die", () => {
    const { swung, forgone: count } = swings(12);
    expect(count).toBe(1);
    expect(swung[0]).toContain("Brutal Strike");
    expect(swung.slice(1).some((message) => message.includes("Brutal Strike"))).toBe(false);
  });

  it("against a high AC, keeps the advantage", () => {
    expect(swings(22).forgone).toBe(0);
  });
});

describe("Brutal Strike on the sheet", () => {
  it("reads as advantage given up while Reckless Attack is on", () => {
    const definition = barbarian(13);
    const feature = definition.features!.find((entry) => entry.name === "Improved Brutal Strike")!;
    const text = featureStatblock(feature, definition).text;
    expect(text).toContain("Brutal Strike: Hamstring Blow: once on each of its turns, while Reckless Attack is on, it can give up advantage on a Strength attack roll that doesn't have disadvantage; if it hits, +5 (1d10), Hamstrung (speed −15 ft).");
    expect(text).toContain("Sundered (+5 to the next attack roll against it by another creature)");
    expect(text).toContain("Staggered (disadvantage on its next save)");
  });
});
