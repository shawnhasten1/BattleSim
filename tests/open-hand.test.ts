import { describe, expect, it } from "vitest";
import {
  actionProblem,
  createEngineState,
  getExecutableActions,
  resolveMultiattackAction,
  sampleEncounter,
  takeAutomatedTurn,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7aa: a choice of effect on each hit (Open Hand Technique). Addle, Push and Topple are on-hit
 * options on Flurry of Blows' strikes only (`routineOnly`), each swing choosing; Push allows a Strength save.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const openHand = () => actor(withSuggestions(withChoice(quickBuild(sources, { classId: "srd:class:monk", level: 3 }), { kind: "level", index: 2 }, ["subclass"], "srd:subclass:warrior-of-the-open-hand"), sources));

/** d20s as listed, then 10s; every other die its lowest. */
function d20s(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({ next: () => 0, nextInt: (min, max) => (max === 20 ? values[index++] ?? 10 : min), fork: make });
  return make();
}

function fight(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, maxHp: 200 }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 3, y: 9 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 14, y: 1 }; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const named = (name: string) => {
    const found = getExecutableActions(definition).find((entry) => entry.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };
  return { state, find, named };
}

describe("Open Hand Technique", () => {
  it("offers Addle, Push and Topple on Flurry's strikes only", () => {
    const definition = openHand();
    const { state, named } = fight(definition);
    const names = getExecutableActions(definition).filter((entry) => entry.name.includes("Open Hand")).map((entry) => entry.name);
    expect(names).toHaveLength(3);
    const topple = named(names.find((name) => name.includes("Topple"))!);
    expect(actionProblem(state.snapshot, "pc-fighter", topple.id)).toMatch(/only one of a routine's strikes/);
    expect(featureStatblock(definition.features!.find((entry) => entry.name === "Open Hand Technique")!, definition).text)
      .toContain("push 15 ft");
  });

  it("Push: a Strength save, or 15 ft away", () => {
    const definition = openHand();
    for (const [saveRoll, moved] of [[1, true], [20, false]] as const) {
      const { state, find, named } = fight(definition);
      const push = getExecutableActions(definition).find((entry) => entry.name.includes("Open Hand: Push"))!;
      state.rng = d20s(15, saveRoll, 1, 1);
      resolveMultiattackAction(state, "pc-fighter", ["enemy-goblin-1"], named("Flurry of Blows").id, { attackActionIds: [push.id, push.id] });
      expect(find("enemy-goblin-1").position.x > 4, `save ${saveRoll}`).toBe(moved);
    }
  });

  it("the AI topples with its Flurry", () => {
    const definition = openHand();
    const { state, find } = fight(definition);
    find("pc-fighter").tacticsProfile = "controller";
    state.rng = d20s(15, 1, 15, 1, 15, 1);
    takeAutomatedTurn(state, find("pc-fighter"));
    const swung = state.log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter").map((entry) => entry.message);
    expect(swung.some((message) => message.includes("Open Hand: Topple"))).toBe(true);
  });
});
