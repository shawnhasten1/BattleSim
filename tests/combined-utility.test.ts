import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveUtilityAction,
  sampleEncounter,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { actionStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7y: two standard actions in one, and temporary hit points with them. Patient Defense and Step
 * of the Wind for a Focus Point, Heightened Focus's temporary hit points, Adrenaline Rush's.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;

/** Every die its highest. */
const highest: RandomSource = { next: () => 0.999, nextInt: (_min, max) => max, fork: () => highest };

function turn(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.round = 1;
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  state.rng = highest;
  const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
  const use = (name: string) => {
    const found = getExecutableActions(definition).find((entry) => entry.name === name);
    if (!found) throw new Error(`no ${name}`);
    resolveUtilityAction(state, "pc-fighter", found.id);
  };
  return { state, me, use, definition };
}

describe("Monk's Focus", () => {
  it("Patient Defense for a point: Disengage and Dodge in one bonus action", () => {
    const { me, use } = turn(actor(quickBuild(sources, { classId: "srd:class:monk", level: 2 })));
    const points = me().resources?.["focus-points"] ?? 0;
    use("Patient Defense: Disengage and Dodge");
    expect(me().turnFlags?.disengaged).toBe(true);
    expect(me().conditions?.some((condition) => condition.sourceName === "Dodge")).toBe(true);
    expect(me().resources?.["focus-points"]).toBe(points - 1);
    expect(me().actionEconomy).toMatchObject({ action: true, bonus: false });
    expect(me().tempHp).toBe(0);
  });

  it("Step of the Wind for a point: Dash and Disengage", () => {
    const { me, use } = turn(actor(quickBuild(sources, { classId: "srd:class:monk", level: 2 })));
    use("Step of the Wind: Dash and Disengage");
    expect(me().turnFlags).toMatchObject({ dashed: true, disengaged: true });
  });

  it("Heightened Focus: two Martial Arts dice of temporary hit points with Patient Defense's point", () => {
    const { me, use, definition } = turn(actor(quickBuild(sources, { classId: "srd:class:monk", level: 10 })));
    use("Patient Defense: Disengage and Dodge");
    // The Martial Arts die is a d8 at 10th level: 16 at most.
    expect(me().tempHp).toBe(16);
    const patient = getExecutableActions(definition).find((entry) => entry.name === "Patient Defense: Disengage and Dodge")!;
    expect(actionStatblock(patient, definition).text).toBe("It takes the Disengage and Dodge actions and gains 9 (1d8 + 1d8) temporary hit points. Uses 1 focus point.");
  });
});

describe("Adrenaline Rush", () => {
  it("Dash, and as many temporary hit points as the proficiency bonus", () => {
    const orc = actor(quickBuild(sources, { classId: "srd:class:fighter", level: 5, speciesId: "srd:species:orc" }));
    const { me, use } = turn(orc);
    use("Adrenaline Rush");
    expect(me().turnFlags?.dashed).toBe(true);
    expect(me().tempHp).toBe(3);
  });
});
