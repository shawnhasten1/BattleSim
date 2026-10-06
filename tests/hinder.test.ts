import { describe, expect, it } from "vitest";
import {
  armorClassOf,
  createEngineState,
  getExecutableActions,
  resolveAttack,
  rollSavingThrow,
  sampleEncounter,
  type CreatureDefinition,
  type D20ChangeRequest,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { describeQuestion } from "@/lib/play/questions";

/**
 * PC builder plan, Phase 7am: a foe's success made to fail. Cutting Words (its reaction: a Bardic Inspiration die off a
 * foe's hit within 60 ft) and Boon of Fate's penalty (2d4 off a foe's hit or made save within 60 ft, once a fight).
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: ReturnType<typeof quickBuild>): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;

/** The d20s as listed (then 10), every other die its highest. */
function d20s(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({ next: () => 0.999, nextInt: (min, max) => (max === 20 ? values[index++] ?? 10 : max), fork: make });
  return make();
}

/** The character in the fighter's place at (3, 3); the archer at (5, 3) with the first goblin beside it; its turn. */
function scene(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.round = 1;
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 5, y: 3 };
    if (token.id === "enemy-goblin-1") token.position = { x: 6, y: 3 };
    if (token.id === "enemy-goblin-2") token.position = { x: 16, y: 1 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "enemy-goblin-1");
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const goblinAttack = getExecutableActions(snapshot.definitions.find((entry) => entry.id === "def-goblin")!).find((action) => action.kind === "attack" && action.attackType === "melee")!;
  return { state, find, goblinAttack };
}

describe("Cutting Words", () => {
  const bard = () => actor(quickBuild(sources, { classId: "srd:class:bard", level: 5 }));

  it("its reaction turns a goblin's narrow hit on an ally into a miss", () => {
    const { state, find, goblinAttack } = scene(bard());
    find("pc-archer").currentHp = 20;
    // A hit by 2 or 3: a d8 more likely than not takes it below the archer's AC.
    const archerAc = armorClassOf(state.snapshot.definitions.find((entry) => entry.id === "def-archer")!).total;
    state.rng = d20s(archerAc - 4 + 2);
    const before = find("pc-fighter").resources?.["bardic-inspiration"] ?? 0;
    resolveAttack(state, "enemy-goblin-1", "pc-archer", goblinAttack.id);
    const changed = state.log.find((entry) => entry.type === "RollChanged");
    expect(changed?.data).toMatchObject({ combatantId: "pc-fighter", rollerId: "enemy-goblin-1", feature: "Cutting Words", change: "subtract", success: false, hindered: true });
    expect(find("pc-archer").currentHp).toBe(20);
    expect(find("pc-fighter").actionEconomy?.reaction).toBe(false);
    expect(find("pc-fighter").resources?.["bardic-inspiration"]).toBe(before - 1);
  });

  it("not on a hit its die can't undo, nor a critical hit", () => {
    for (const roll of [19, 20]) {
      const { state, goblinAttack } = scene(bard());
      state.rng = d20s(roll);
      resolveAttack(state, "enemy-goblin-1", "pc-archer", goblinAttack.id);
      expect(state.log.some((entry) => entry.type === "RollChanged"), `d20 ${roll}`).toBe(false);
    }
  });

  it("asks whoever plays the bard about the goblin's hit", () => {
    const { state, find, goblinAttack } = scene(bard());
    const asked: D20ChangeRequest[] = [];
    state.decide = (request) => {
      if (request.kind === "d20-change") asked.push(request);
      return undefined;
    };
    state.rng = d20s(12);
    resolveAttack(state, "enemy-goblin-1", "pc-archer", goblinAttack.id);
    expect(asked[0]).toMatchObject({ combatantId: "pc-fighter", rollerId: "enemy-goblin-1", succeeded: true });
    const text = describeQuestion(asked[0]!, state.snapshot);
    expect(text.title).toMatch(/^Goblin 1 hit with .*: \d+ against AC \d+\.$/);
    expect(text.ask).toBe("Change Goblin 1's roll?");
    expect(text.options[0]!.detail).toContain("Subtract 1d8");
  });
});

describe("Boon of Fate's penalty", () => {
  it("2d4 off a foe's made save", () => {
    let build = quickBuild(sources, { classId: "srd:class:fighter", level: 19 });
    build = withSuggestions(withChoice(build, { kind: "level", index: 18 }, ["epic-boon"], { feat: "srd:feat:boon-of-fate" }), sources);
    const { state, find } = scene(actor(build));
    state.rng = d20s(14);
    const save = rollSavingThrow(state, find("enemy-goblin-1"), { ability: "wis", dc: 12, kind: "feature" });
    expect(save.success).toBe(false);
    expect(state.log.find((entry) => entry.type === "RollChanged")?.data).toMatchObject({ feature: "Boon of Fate", rollerId: "enemy-goblin-1", hindered: true });
    expect(find("pc-fighter").resources?.["boon-of-fate"]).toBe(0);
  });
});

describe("Cutting Words on a damage roll (7az)", () => {
  it("the bard's die off a goblin's damage that would drop the archer", () => {
    const bard = actor(quickBuild(sources, { classId: "srd:class:bard", level: 5 }));
    expect(getExecutableActions(bard).find((action) => action.name === "Cutting Words (damage)")).toMatchObject({ damageCut: { kind: "reduce", dice: "1d8" } });
    const { state, find, goblinAttack } = scene(bard);
    find("pc-archer").currentHp = 5;
    const before = find("pc-fighter").resources?.["bardic-inspiration"] ?? 0;
    // A sure hit (too far over the AC for the die to undo), at its highest damage.
    state.rng = d20s(19);
    resolveAttack(state, "enemy-goblin-1", "pc-archer", goblinAttack.id);
    const damage = state.log.find((entry) => entry.type === "DamageApplied" && entry.data?.targetId === "pc-archer");
    expect(damage?.data?.cutBy).toBe("Cutting Words (damage)");
    expect(find("pc-archer").currentHp).toBe(5);
    expect(find("pc-fighter").resources?.["bardic-inspiration"]).toBe(before - 1);
    expect(find("pc-fighter").actionEconomy?.reaction).toBe(false);
  });
});
