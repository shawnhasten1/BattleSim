import { describe, expect, it } from "vitest";
import {
  applyCondition,
  BASE_FORM_ID,
  createEngineState,
  getDefinition,
  getExecutableActions,
  resolveTransformAction,
  sampleEncounter,
  takeAutomatedTurn,
  type CreatureDefinition
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
