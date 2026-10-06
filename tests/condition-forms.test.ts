import { describe, expect, it } from "vitest";
import {
  actionProblem,
  createEngineState,
  getDefinition,
  getExecutableActions,
  movementProfileOf,
  resolveActivateFeatureAction,
  sampleEncounter,
  sizeFootprint,
  takeAutomatedTurn,
  type CreatureDefinition
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/**
 * PC builder plan, Phase 7as: a creature its conditions change for a while. Draconic Flight and Dragon Wings (a fly
 * speed), Large Form (Large, 10 ft faster): `getDefinition` returns the changed definition while the condition lasts.
 */

const sources = SRD_BUILD_SOURCES;
const build = (classId: string, level: number, speciesId: string): CreatureDefinition =>
  rebuildActor(blankCharacter("def-fighter", "PC"), quickBuild(sources, { classId: `srd:class:${classId}`, level, speciesId: `srd:species:${speciesId}` }), sources).definition;

function scene(definition: CreatureDefinition, crowded = false) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.round = 1;
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = crowded ? { x: 4, y: 4 } : { x: 3, y: 9 };
    if (token.id === "enemy-goblin-1") token.position = { x: 8, y: 3 };
    if (token.id === "enemy-goblin-2") token.position = { x: 16, y: 1 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
  const use = (name: string) => resolveActivateFeatureAction(state, "pc-fighter", getExecutableActions({ ...definition, id: "def-fighter" }).find((action) => action.name === name)!.id);
  return { state, me, use };
}

describe("a creature its conditions change", () => {
  it("Draconic Flight: a fly speed equal to its speed, one definition while it lasts", () => {
    const { state, me, use } = scene(build("fighter", 5, "dragonborn"));
    expect(movementProfileOf(getDefinition(state.snapshot, me())).fly ?? 0).toBe(0);
    use("Draconic Flight");
    const flying = getDefinition(state.snapshot, me());
    expect(movementProfileOf(flying).fly).toBe(flying.speed);
    expect(getDefinition(state.snapshot, me())).toBe(flying);
    expect(me().resources?.["draconic-flight"]).toBe(0);
  });

  it("Dragon Wings: a fly speed of 60 ft", () => {
    const { state, me, use } = scene(build("sorcerer", 14, "human"));
    use("Dragon Wings");
    expect(movementProfileOf(getDefinition(state.snapshot, me())).fly).toBe(60);
  });

  it("Large Form: Large and 10 ft faster, only with room to grow", () => {
    const goliath = build("fighter", 5, "goliath");
    const crowded = scene(goliath, true);
    const large = getExecutableActions({ ...goliath, id: "def-fighter" }).find((action) => action.name === "Large Form")!;
    expect(actionProblem(crowded.state.snapshot, "pc-fighter", large.id)).toBe("There's no room to grow here");
    const { state, me, use } = scene(goliath);
    const before = getDefinition(state.snapshot, me()).speed;
    use("Large Form");
    const grown = getDefinition(state.snapshot, me());
    expect(sizeFootprint(grown.size)).toBe(2);
    expect(grown.speed).toBe(before + 10);
  });

  it("the AI takes flight with its bonus action", () => {
    const { state, me } = scene(build("fighter", 5, "dragonborn"));
    takeAutomatedTurn(state, me());
    expect(state.log.some((entry) => entry.type === "ActionDeclared" && entry.data?.actionName === "Draconic Flight")).toBe(true);
  });
});
