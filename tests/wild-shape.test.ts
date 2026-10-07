import { describe, expect, it } from "vitest";
import {
  applyCondition,
  BASE_FORM_ID,
  createEngineState,
  getDefinition,
  getExecutableActions,
  resolveAttack,
  resolveTransformAction,
  sampleEncounter,
  takeAutomatedTurn,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { loadSrdMonster } from "@/data/srd/monsters";
import { blankCharacter, buildCharacter, quickBuild, rebuildActor } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { replayTo } from "@/lib/replay";

/**
 * PC builder plan, Phase 7av: Wild Shape. Known Beast forms picked by level; shifting is the beast's body with what the
 * druid keeps of itself (hit points, mental scores, class features, feats, save proficiencies), temporary hit points
 * equal to its level, no spells; back for free, or when incapacitated.
 */

const sources = SRD_BUILD_SOURCES;
const druid = (level: number): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), quickBuild(sources, { classId: "srd:class:druid", level }), sources).definition;

async function scene(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.round = 1;
  const shape = getExecutableActions(definition).find((action) => action.kind === "transform")!;
  const beasts = await Promise.all(shape.kind === "transform" ? shape.forms.map((form) => loadSrdMonster(form.definitionId)) : []);
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }, ...beasts.filter((beast): beast is CreatureDefinition => Boolean(beast))];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") token.position = { x: 4, y: 3 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
  return { state, me, shape };
}

describe("Wild Shape", () => {
  it("knows four forms at 2nd level (CR 1/4, no flyers), six at 4th, eight at 8th", () => {
    const slot = buildCharacter(quickBuild(sources, { classId: "srd:class:druid", level: 2 }), sources).choices.find((entry) => entry.path[0] === "wild-shape-forms")!;
    expect(slot.count).toBe(4);
    expect(slot.options.find((option) => option.id === "brown-bear")).toMatchObject({ taken: true });
    for (const [level, count] of [[2, 4], [4, 6], [8, 8]] as const) {
      const shape = getExecutableActions(druid(level)).find((action) => action.kind === "transform");
      expect(shape?.kind === "transform" && shape.forms.length, `level ${level}`).toBe(count);
      expect(shape).toMatchObject({ actionType: "bonus", wildShape: { tempHp: level }, resourceCost: { resourceId: "wild-shape", amount: 1 } });
    }
  });

  it("the beast's body with the druid's hit points, mind, features and saves; its level in temporary hit points", async () => {
    const definition = druid(8);
    const { state, me, shape } = await scene(definition);
    const uses = me().resources?.["wild-shape"] ?? 0;
    resolveTransformAction(state, "pc-fighter", shape.id, "brown-bear");
    const form = getDefinition(state.snapshot, me());
    const bear = state.snapshot.definitions.find((entry) => entry.id === "srd:monster:brown-bear")!;
    expect(form).toMatchObject({ name: `${definition.name} (Brown Bear)`, maxHp: definition.maxHp, size: bear.size, armorClass: bear.armorClass, spells: [] });
    expect(form.abilities).toEqual({ ...bear.abilities, int: definition.abilities.int, wis: definition.abilities.wis, cha: definition.abilities.cha });
    expect(form.saves?.wis).toBe(definition.saves?.wis);
    expect(getExecutableActions(form).some((action) => action.kind === "transform")).toBe(true);
    expect(me()).toMatchObject({ tempHp: 8, currentHp: definition.maxHp });
    expect(me().resources?.["wild-shape"]).toBe(uses - 1);
    // Back for free, with a later bonus action.
    me().actionEconomy = { action: true, bonus: true, reaction: true };
    resolveTransformAction(state, "pc-fighter", shape.id, BASE_FORM_ID);
    expect(me().activeForm).toBeUndefined();
    expect(me().resources?.["wild-shape"]).toBe(uses - 1);
  });

  it("ends when the druid is incapacitated, and replays", async () => {
    const { state, me, shape } = await scene(druid(4));
    const before = structuredClone(state.snapshot);
    resolveTransformAction(state, "pc-fighter", shape.id, "black-bear");
    const replayed = replayTo(before, state.log, state.log.length);
    expect(replayed.definitions.some((entry) => entry.id === me().activeForm?.definitionId)).toBe(true);
    applyCondition(state, "pc-fighter", { id: "stun", name: "stunned", startedRound: 1 });
    expect(me().activeForm).toBeUndefined();
  });

  it("the AI shifts when it has no spell left to cast and a form fights better", async () => {
    const definition = druid(4);
    const { state, me } = await scene(definition);
    // Its slots and its feat's free cast spent.
    me().resources = Object.fromEntries(Object.entries(me().resources ?? {}).map(([id, count]) => [id, id === "wild-shape" ? count : 0]));
    takeAutomatedTurn(state, me());
    expect(state.log.some((entry) => entry.type === "AiDecision" && entry.data?.reason === "wild-shape")).toBe(true);
    expect(me().activeForm).toBeDefined();
  });
});

/**
 * EDITIONS_PLAN.md Phase 9b: the 2014 Wild Shape (`wildShape.hp: "form"`). The druid takes the beast's own hit points,
 * keeping its own to go back to; a form at 0 goes back with what's left of the damage carried into the druid's.
 */
describe("the 2014 Wild Shape: the beast's own hit points", () => {
  const druid2014 = (level: number): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), quickBuild(sources, { classId: "srd:class:druid-2014", level }), sources).definition;
  /** Every d20 rolls `d20`; every other die its highest. */
  const rolling = (d20: number): RandomSource => {
    const source: RandomSource = { next: () => 0.99, nextInt: (_min, max) => (max === 20 ? d20 : max), fork: () => source };
    return source;
  };
  const scimitar = (state: Awaited<ReturnType<typeof scene>>["state"]) => getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-goblin")!)
    .find((action) => action.kind === "attack" && action.attackType === "melee")!;

  it("an action, twice a rest; forms of challenge rating 1/4 with no swimming or flying speed at 2nd level", () => {
    const shape = getExecutableActions(druid2014(2)).find((action) => action.kind === "transform");
    expect(shape).toMatchObject({ actionType: "action", wildShape: { hp: "form" }, resourceCost: { resourceId: "wild-shape", amount: 1 } });
    const slot = buildCharacter(quickBuild(sources, { classId: "srd:class:druid-2014", level: 2 }), sources).choices.find((entry) => entry.path[0] === "wild-shape-forms")!;
    // A constrictor snake (CR 1/4) swims: not before 4th level.
    expect(slot.options.find((option) => option.id === "constrictor-snake")).toMatchObject({ taken: true, detail: "from 4th level" });
    expect(slot.options.find((option) => option.id === "wolf")?.taken).toBeFalsy();
    expect(druid2014(2).resources).toMatchObject({ "wild-shape": 2 });
    expect(druid2014(20).resources).toMatchObject({ "wild-shape": 99 });
  });

  it("takes the beast's hit points and gives back its own when it changes back", async () => {
    const definition = druid2014(2);
    const { state, me, shape } = await scene(definition);
    me().currentHp = definition.maxHp - 3;
    resolveTransformAction(state, "pc-fighter", shape.id, "wolf");
    const wolf = state.snapshot.definitions.find((entry) => entry.id === "srd:monster:wolf")!;
    expect(getDefinition(state.snapshot, me()).maxHp).toBe(wolf.maxHp);
    expect(me()).toMatchObject({ currentHp: wolf.maxHp, tempHp: 0, activeForm: { ownHp: definition.maxHp - 3 } });
    me().currentHp = 2;
    me().actionEconomy = { action: true, bonus: true, reaction: true };
    resolveTransformAction(state, "pc-fighter", shape.id, BASE_FORM_ID);
    expect(me().activeForm).toBeUndefined();
    expect(me().currentHp).toBe(definition.maxHp - 3);
  });

  it("dropped to 0, goes back with the rest of the damage carried over, and replays", async () => {
    const definition = druid2014(2);
    const { state, me, shape } = await scene(definition);
    const before = structuredClone(state.snapshot);
    resolveTransformAction(state, "pc-fighter", shape.id, "wolf");
    me().currentHp = 2;
    // The goblin's scimitar at its highest: 1d6 + 2 = 8, so 6 past the wolf's 2.
    state.rng = rolling(19);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", scimitar(state).id);
    expect(me().activeForm).toBeUndefined();
    expect(me().state).toBe("active");
    expect(me().currentHp).toBe(definition.maxHp - 6);
    expect(state.log.some((entry) => entry.type === "Transformed" && entry.data?.carriedOver === 6)).toBe(true);
    const replayed = replayTo(before, state.log, state.log.length).combatants.find((token) => token.id === "pc-fighter")!;
    expect(replayed.currentHp).toBe(definition.maxHp - 6);
    expect(replayed.activeForm).toBeUndefined();
  });

  it("goes down when the damage left over is more than its own hit points", async () => {
    const definition = druid2014(2);
    const { state, me, shape } = await scene(definition);
    me().currentHp = 3;
    resolveTransformAction(state, "pc-fighter", shape.id, "wolf");
    me().currentHp = 1;
    state.rng = rolling(19);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", scimitar(state).id);
    expect(me().activeForm).toBeUndefined();
    expect(me().currentHp).toBe(0);
    expect(me().state).not.toBe("active");
  });

  it("ends, with its own hit points back, when the druid is incapacitated", async () => {
    const definition = druid2014(2);
    const { state, me, shape } = await scene(definition);
    resolveTransformAction(state, "pc-fighter", shape.id, "wolf");
    me().currentHp = 4;
    applyCondition(state, "pc-fighter", { id: "stun", name: "stunned", startedRound: 1 });
    expect(me().activeForm).toBeUndefined();
    expect(me().currentHp).toBe(definition.maxHp);
  });
});
