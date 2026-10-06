import { beforeEach, describe, expect, it } from "vitest";
import {
  actualMaxHp,
  applyCondition,
  applyRegeneration,
  buildBattleReport,
  createEngineState,
  effectiveDefinition,
  expireConditions,
  getDefinition,
  hitPointParts,
  levelOf,
  resolveBuffAction,
  resolveNumericFormula,
  sampleEncounter,
  slotCopiesOf,
  type CombatantState,
  type ConditionInstance,
  type CreatureDefinition,
  type FeatureEffect
} from "@/engine";
import { findSrdFeature, findSrdSpell } from "@/data/srd";
import { replayTo } from "@/lib/replay";
import { hitPointsReadout } from "@/lib/actor-sheet/summaries";
import { effectSentence } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";

/** EFFECTS_PLAN.md, Phase 2: the hit point maximum effect, per-level formulas, Aid, and temporary hit points each turn. */

const creature = (overrides: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id: "c", name: "C", size: "medium", armorClass: 12, maxHp: 30, speed: 30, proficiencyBonus: 2,
  abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, actions: [], ...overrides
});
const trait = (name: string, effects: FeatureEffect[]) => ({ id: name, name, category: "feature" as const, effects, automationSupport: "full" as const });
const tough = trait("Tough", [{ kind: "hit-point-maximum", bonus: { perLevel: 2 } }]);
const barbarian = (level: number) => ({ character: { level, classes: [{ id: "barbarian", name: "Barbarian", level }] } });

describe("per-level formulas", () => {
  it("count its character level, or one class's", () => {
    const multiclass = creature({ character: { level: 7, classes: [{ name: "Fighter", level: 2 }, { id: "srd:class:sorcerer", name: "Sorcerer", level: 5 }] } });
    expect(levelOf(multiclass)).toBe(7);
    expect(levelOf(multiclass, "sorcerer")).toBe(5);
    expect(levelOf(multiclass, "Fighter")).toBe(2);
    expect(levelOf(multiclass, "wizard")).toBe(0);
    expect(levelOf(creature())).toBe(1);
    expect(resolveNumericFormula({ perLevel: 2 }, multiclass)).toBe(14);
    expect(resolveNumericFormula({ perLevel: 1, levelClass: "sorcerer" }, multiclass)).toBe(5);
  });
});

describe("the hit point maximum", () => {
  it("Tough: 2 for each level, on the creature its effects make", () => {
    const fighter = creature({ maxHp: 65, ...barbarian(6), features: [tough] });
    expect(effectiveDefinition(fighter).maxHp).toBe(77);
    expect(actualMaxHp(fighter)).toBe(77);
    expect(fighter.maxHp).toBe(65);
    expect(hitPointParts(fighter)).toEqual([{ label: "base", value: 65 }, { label: "Tough", value: 12 }]);
    expect(hitPointsReadout(fighter)).toBe("77: 65 base, Tough +12");
  });

  it("Draconic Resilience: 1 for each sorcerer level, from the library", () => {
    const sorcerer = creature({ maxHp: 20, character: { level: 4, classes: [{ name: "Sorcerer", level: 4 }] }, features: [structuredClone(findSrdFeature("srd:feature:draconic-resilience")!)] });
    expect(actualMaxHp(sorcerer)).toBe(24);
  });

  it("is never below 1, and nothing changes a creature without such effects", () => {
    expect(actualMaxHp(creature({ maxHp: 3, features: [trait("Frail", [{ kind: "hit-point-maximum", bonus: { base: -10 } }])] }))).toBe(1);
    const plain = creature();
    expect(effectiveDefinition(plain)).toBe(plain);
    expect(hitPointParts(plain)).toEqual([]);
  });

  it("says what it does", () => {
    const definition = creature(barbarian(6));
    expect(effectSentence({ kind: "hit-point-maximum", bonus: { perLevel: 2 } }, definition)).toBe("Its hit point maximum increases by 12 (2 for each of its levels).");
    expect(effectSentence({ kind: "hit-point-maximum", bonus: { perLevel: 1, levelClass: "barbarian" } }, definition)).toBe("Its hit point maximum increases by 6 (1 for each barbarian level).");
    expect(effectSentence({ kind: "hit-point-maximum", bonus: { base: 5 } }, definition)).toBe("Its hit point maximum increases by 5.");
  });
});

describe("a condition that raises the maximum", () => {
  function scene(definition: CreatureDefinition, hp?: number) {
    const snapshot = structuredClone(sampleEncounter);
    snapshot.map.walls = [];
    snapshot.definitions = snapshot.definitions.map((entry) => (entry.id === "def-fighter" ? { ...definition, id: "def-fighter" } : entry));
    const fighter = snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    fighter.currentHp = hp ?? definition.maxHp;
    if (hp === 0) fighter.state = "downed";
    const state = createEngineState(snapshot);
    const me = () => state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    return { state, me };
  }
  const aid = (extra: Partial<ConditionInstance> = {}): ConditionInstance => ({
    id: "aid", name: "custom", sourceName: "Aid", startedRound: 1, effects: [{ kind: "hit-point-maximum", bonus: { base: 5 } }], ...extra
  });

  it("raises its current hit points by as much when it lands", () => {
    const { state, me } = scene(creature({ maxHp: 30 }), 20);
    applyCondition(state, "pc-fighter", aid());
    expect(getDefinition(state.snapshot, me()).maxHp).toBe(35);
    expect(me().currentHp).toBe(25);
    expect(state.log.at(-1)).toMatchObject({ type: "HitPointMaximumChanged", data: { combatantId: "pc-fighter", from: 30, to: 35, currentHp: 25 } });
  });

  it("gets a creature at 0 up, as healing would", () => {
    const { state, me } = scene(creature({ maxHp: 30 }), 0);
    applyCondition(state, "pc-fighter", aid());
    expect(me()).toMatchObject({ currentHp: 5, state: "active" });
  });

  it("caps its hit points at the maximum again when it ends", () => {
    const { state, me } = scene(creature({ maxHp: 30 }), 30);
    applyCondition(state, "pc-fighter", aid({ expiresAt: { round: 0, turnIndex: 0, timing: "end" } }));
    expect(me().currentHp).toBe(35);
    expireConditions(state, "end");
    expect(me().currentHp).toBe(30);
    expect(state.log.at(-1)).toMatchObject({ type: "HitPointMaximumChanged", data: { currentHp: 30 } });
  });

  it("replays from the log", () => {
    const { state } = scene(creature({ maxHp: 30 }), 20);
    const start = structuredClone(state.snapshot);
    applyCondition(state, "pc-fighter", aid());
    const replayed = replayTo(start, state.log, state.log.length);
    expect(replayed.combatants.find((combatant) => combatant.id === "pc-fighter")!.currentHp).toBe(25);
  });
});

describe("Aid", () => {
  it("raises three creatures' maximum and current hit points by 5, and 5 more per slot level above 2nd", () => {
    // As the library attaches it: the slot it costs on its action.
    const spell = structuredClone(findSrdSpell("srd:spell:aid")!);
    spell.action = { ...spell.action!, resourceCost: spell.resourceCost } as typeof spell.action;
    const cleric = creature({
      maxHp: 30, spells: [spell], resources: { "slot-2": 1, "slot-3": 1 },
      abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 10 }
    });
    const snapshot = structuredClone(sampleEncounter);
    snapshot.map.walls = [];
    snapshot.definitions = snapshot.definitions.map((entry) => (entry.id === "def-fighter" ? { ...cleric, id: "def-fighter" } : entry));
    const fighter = snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    fighter.resources = { "slot-2": 1, "slot-3": 1 };
    fighter.currentHp = 30;
    const archer = snapshot.combatants.find((combatant) => combatant.id === "pc-archer")!;
    archer.position = { x: fighter.position.x + 1, y: fighter.position.y };
    const archerMax = getDefinition(snapshot, archer).maxHp;
    archer.currentHp = archerMax - 4;
    const state = createEngineState(snapshot);
    const copies = slotCopiesOf(getDefinition(state.snapshot, fighter), "srd:spell:aid:action");
    const third = copies.find((copy) => "resourceCost" in copy && copy.resourceCost?.resourceId === "slot-3")!;
    resolveBuffAction(state, "pc-fighter", third.id, ["pc-fighter", "pc-archer"]);
    const me = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    const them = state.snapshot.combatants.find((combatant) => combatant.id === "pc-archer")!;
    expect(getDefinition(state.snapshot, me).maxHp).toBe(40);
    expect(me.currentHp).toBe(40);
    expect(them.currentHp).toBe(archerMax + 6);
    expect(me.tempHp ?? 0).toBe(0);
  });
});

describe("temporary hit points each turn (Heroism)", () => {
  it("gives them at the start of its turn, replacing fewer", () => {
    const snapshot = structuredClone(sampleEncounter);
    const state = createEngineState(snapshot);
    const fighter = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    fighter.conditions = [{ id: "heroism", name: "custom", sourceName: "Heroism", startedRound: 1, effects: [{ kind: "hp-regen", amount: 3, temporary: true }] }];
    fighter.tempHp = 1;
    applyRegeneration(state, fighter);
    expect(fighter.tempHp).toBe(3);
    fighter.tempHp = 5;
    applyRegeneration(state, fighter);
    expect(fighter.tempHp).toBe(5);
    expect(effectSentence({ kind: "hp-regen", amount: 3, temporary: true }, creature())).toBe("It gains 3 temporary hit points at the start of its turn, if it has fewer.");
  });
});

describe("the report", () => {
  it("measures hit points against the actual maximum", () => {
    const snapshot = structuredClone(sampleEncounter);
    snapshot.definitions = snapshot.definitions.map((entry) => (entry.id === "def-fighter" ? { ...entry, ...barbarian(5), features: [tough] } : entry));
    const report = buildBattleReport(snapshot, []);
    const fighter = report.actors.find((actor) => actor.combatantId === "pc-fighter")!;
    expect(fighter.maxHp).toBe(32 + 10);
  });
});

describe("tokens and the store", () => {
  const pristine = useEncounterStore.getState();
  beforeEach(() => useEncounterStore.setState(pristine, true));
  const store = () => useEncounterStore.getState();
  const token = (id: string): CombatantState => store().encounter.combatants.find((combatant) => combatant.id === id)!;

  it("places a new token at its actual maximum", () => {
    store().addCreatureDefinition(creature({ id: "def-tough", name: "Tough Guy", maxHp: 40, ...barbarian(5), features: [tough] }), "enemy");
    const placed = store().encounter.combatants.find((combatant) => combatant.definitionId === "def-tough")!;
    expect(placed.currentHp).toBe(50);
  });

  it("takes full tokens to a new maximum when an ability adds hit points; a wounded one keeps its", () => {
    store().updateCreatureDefinition("def-fighter", barbarian(5));
    store().updateHp("pc-archer", 10);
    store().insertAbilityRecord("def-fighter", "features", { ...tough, id: "" });
    expect(actualMaxHp(store().encounter.definitions.find((d) => d.id === "def-fighter")!)).toBe(42);
    expect(token("pc-fighter").currentHp).toBe(42);
    store().insertAbilityRecord("def-fighter", "features", { ...tough, id: "", name: "Tough Again" });
    expect(token("pc-fighter").currentHp).toBe(52);
  });

  it("measures a typed maximum on the actual one", () => {
    store().updateCreatureDefinition("def-fighter", { ...barbarian(5), features: [tough] });
    expect(token("pc-fighter").currentHp).toBe(42);
    store().updateCreatureDefinition("def-fighter", { maxHp: 40 });
    expect(token("pc-fighter").currentHp).toBe(50);
  });

  it("restarts at the actual maximum", () => {
    store().updateCreatureDefinition("def-fighter", { ...barbarian(5), features: [tough] });
    store().updateHp("pc-fighter", 3);
    store().restartCombat();
    expect(token("pc-fighter").currentHp).toBe(42);
  });
});
