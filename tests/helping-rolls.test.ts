import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAttack,
  rollSavingThrow,
  sampleEncounter,
  type CreatureDefinition,
  type D20ChangeRequest,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { describeQuestion } from "@/lib/play/questions";

/**
 * PC builder plan, Phase 7ac: changing another creature's roll. Countercharm (a reaction: an ally's failed save against
 * being charmed or frightened rerolled with advantage) and Boon of Fate (2d4 on an ally's failed d20 roll).
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;

/** Every d20 rolls these values in turn, then 10; other dice their highest. */
function d20s(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({ next: () => 0.999, nextInt: (_min, max) => (max === 20 ? values[index++] ?? 10 : max), fork: make });
  return make();
}

/** The helper in the fighter's place, the archer `gap` squares off. */
function scene(definition: CreatureDefinition, gap = 2) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.round = 1;
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 3 + gap, y: 3 };
    if (token.id === "enemy-goblin-1") token.position = { x: 3 + gap + 1, y: 3 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id.startsWith("enemy-"));
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  return { state, find };
}

describe("Countercharm", () => {
  const bard = () => actor(quickBuild(sources, { classId: "srd:class:bard", level: 7 }));

  it("an ally's failed save against being frightened, rerolled with advantage, for the bard's reaction", () => {
    const { state, find } = scene(bard());
    state.rng = d20s(2, 3, 19);
    const save = rollSavingThrow(state, find("pc-archer"), { ability: "wis", dc: 15, kind: "feature", conditions: ["frightened"] });
    expect(save.success).toBe(true);
    const changed = state.log.find((entry) => entry.type === "RollChanged");
    expect(changed?.data).toMatchObject({ combatantId: "pc-fighter", rollerId: "pc-archer", feature: "Countercharm" });
    expect((changed?.data?.rolled as { rolls: unknown[] }).rolls).toHaveLength(2);
    expect(find("pc-fighter").actionEconomy?.reaction).toBe(false);
  });

  it("not a save against something else, nor an ally out of reach", () => {
    const poisoned = scene(bard());
    poisoned.state.rng = d20s(2, 19, 19);
    expect(rollSavingThrow(poisoned.state, poisoned.find("pc-archer"), { ability: "con", dc: 15, kind: "feature", conditions: ["poisoned"] }).success).toBe(false);
    const far = scene(bard(), 8);
    far.state.rng = d20s(2, 19, 19);
    expect(rollSavingThrow(far.state, far.find("pc-archer"), { ability: "wis", dc: 15, kind: "feature", conditions: ["frightened"] }).success).toBe(false);
  });

  it("asks whoever plays the bard, about the archer's roll", () => {
    const { state, find } = scene(bard());
    const asked: D20ChangeRequest[] = [];
    state.decide = (request) => {
      if (request.kind === "d20-change") asked.push(request);
      return undefined;
    };
    state.rng = d20s(2, 3, 19);
    rollSavingThrow(state, find("pc-archer"), { ability: "wis", dc: 15, kind: "feature", conditions: ["frightened"], label: "Fear" });
    expect(asked[0]).toMatchObject({ combatantId: "pc-fighter", rollerId: "pc-archer" });
    const text = describeQuestion(asked[0]!, state.snapshot);
    expect(text.title).toContain("Archer failed a DC 15 save against Fear");
    expect(text.ask).toBe("Change Archer's roll?");
  });
});

describe("Boon of Fate", () => {
  it("2d4 on an ally's missed attack, once a fight", () => {
    let build = quickBuild(sources, { classId: "srd:class:fighter", level: 19 });
    build = withSuggestions(withChoice(build, { kind: "level", index: 18 }, ["epic-boon"], { feat: "srd:feat:boon-of-fate" }), sources);
    const fighter = actor(build);
    expect(fighter.resources?.["boon-of-fate"]).toBe(1);
    const { state, find } = scene(fighter);
    state.snapshot.turnIndex = state.snapshot.combatants.findIndex((token) => token.id === "pc-archer");
    const archerAttack = getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-archer")!).find((entry) => entry.kind === "attack")!;
    // A miss by 1 or 2: the 2d4 (8, at most) turns it.
    state.rng = d20s(8);
    resolveAttack(state, "pc-archer", "enemy-goblin-1", archerAttack.id);
    const changed = state.log.find((entry) => entry.type === "RollChanged");
    expect(changed?.data).toMatchObject({ combatantId: "pc-fighter", rollerId: "pc-archer", feature: "Boon of Fate", change: "add" });
    expect(find("pc-fighter").resources?.["boon-of-fate"]).toBe(0);
  });
});
