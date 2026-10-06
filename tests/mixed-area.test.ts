import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAreaSaveAction,
  sampleEncounter,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { actionStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7ai: an area that harms foes and heals one ally (Land's Aid). The sphere's necrotic damage to
 * its foes, then the same dice of healing for the ally in it with the least of its hit points left, one at 0 first.
 */

const sources = SRD_BUILD_SOURCES;
const druid = (): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), quickBuild(sources, { classId: "srd:class:druid", level: 3 }), sources).definition;

/** Every d20 a 1, every other die its highest. */
const failing: RandomSource = { next: () => 0.999, nextInt: (min, max) => (max === 20 ? 1 : max), fork: () => failing };

/** The druid at (3, 3); the first goblin at (8, 3), the archer beside it (hurt), the second goblin far off. */
function scene(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") { token.position = { x: 8, y: 4 }; token.currentHp = 5; }
    if (token.id === "enemy-goblin-1") token.position = { x: 8, y: 3 };
    if (token.id === "enemy-goblin-2") token.position = { x: 16, y: 1 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  state.rng = failing;
  return { state, find: (id: string) => state.snapshot.combatants.find((token) => token.id === id)! };
}

describe("Land's Aid", () => {
  it("necrotic damage to the foes in the sphere, and healing for the ally in it", () => {
    const definition = druid();
    const aid = getExecutableActions(definition).find((action) => action.name === "Land's Aid")!;
    expect(aid).toMatchObject({ kind: "area-save", affects: "hostile", healsOneAlly: [{ dice: "2d6" }] });
    expect(actionStatblock(aid, definition).text).toContain("One creature of its choice in the area regains 7 (2d6) hit points.");
    const { state, find } = scene(definition);
    resolveAreaSaveAction(state, "pc-fighter", { x: 8, y: 3 }, aid.id);
    expect(find("enemy-goblin-1").currentHp).toBe(0);
    expect(find("pc-archer").currentHp).toBe(5 + 12);
    expect(state.log.find((entry) => entry.type === "HealingApplied")?.data).toMatchObject({ healerId: "pc-fighter", targetId: "pc-archer", healingApplied: 12 });
  });

  it("an ally at 0 first, back on its feet", () => {
    const definition = druid();
    const aid = getExecutableActions(definition).find((action) => action.name === "Land's Aid")!;
    const { state, find } = scene(definition);
    // The druid steps into the sphere too, hurt; the archer is down.
    find("pc-fighter").position = { x: 7, y: 3 };
    find("pc-fighter").currentHp = 1;
    find("pc-archer").currentHp = 0;
    find("pc-archer").state = "downed";
    resolveAreaSaveAction(state, "pc-fighter", { x: 9, y: 3 }, aid.id);
    expect(find("pc-archer")).toMatchObject({ state: "active", currentHp: 12 });
    expect(find("pc-fighter").currentHp).toBe(1);
  });

  it("nobody hurt in it: no healing", () => {
    const definition = druid();
    const aid = getExecutableActions(definition).find((action) => action.name === "Land's Aid")!;
    const { state, find } = scene(definition);
    find("pc-archer").currentHp = sampleEncounter.definitions.find((entry) => entry.id === "def-archer")!.maxHp;
    resolveAreaSaveAction(state, "pc-fighter", { x: 8, y: 3 }, aid.id);
    expect(state.log.some((entry) => entry.type === "HealingApplied")).toBe(false);
  });
});
