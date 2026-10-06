import { describe, expect, it } from "vitest";
import {
  actionProblem,
  createEngineState,
  getExecutableActions,
  resolveHealingAction,
  resolveHealingBurstAction,
  sampleEncounter,
  takeAutomatedTurn,
  type CreatureDefinition
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { actionStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7k: healing by any amount. Lay on Hands heals what a creature is missing from a pool of five
 * times the paladin level; Preserve Life shares five times the cleric level among bloodied creatures, none past half.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;

/** This character in the fighter's place, the archer next to it, on its turn. */
function withAlly(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 3, y: 4 };
  }
  snapshot.round = 1;
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  return { state, find, use: (name: string) => getExecutableActions(definition).find((entry) => entry.name === name)! };
}

describe("Lay On Hands", () => {
  const paladin = () => actor(quickBuild(sources, { classId: "srd:class:paladin", level: 3 }));

  it("heals what a creature is missing, as far as the pool goes, and is gone when it's empty", () => {
    const definition = paladin();
    const { state, find, use } = withAlly(definition);
    const lay = use("Lay On Hands");
    expect(find("pc-fighter").resources?.["lay-on-hands"]).toBe(15);
    find("pc-archer").currentHp = 14; // 10 missing
    resolveHealingAction(state, "pc-fighter", "pc-archer", lay.id);
    expect(find("pc-archer").currentHp).toBe(24);
    expect(find("pc-fighter").resources?.["lay-on-hands"]).toBe(5);
    find("pc-archer").currentHp = 14;
    find("pc-fighter").actionEconomy = undefined;
    resolveHealingAction(state, "pc-fighter", "pc-archer", lay.id);
    expect(find("pc-archer").currentHp).toBe(19);
    expect(find("pc-fighter").resources?.["lay-on-hands"]).toBe(0);
    find("pc-fighter").actionEconomy = undefined;
    expect(actionProblem(state.snapshot, "pc-fighter", lay.id)).toBeDefined();
  });

  it("the AI lays hands on a downed ally", () => {
    const { state, find } = withAlly(paladin());
    const archer = find("pc-archer");
    archer.currentHp = 0;
    archer.state = "downed";
    takeAutomatedTurn(state, find("pc-fighter"));
    expect(archer.state).toBe("active");
    expect(archer.currentHp).toBeGreaterThan(0);
  });

  it("reads as healing from its pool", () => {
    const definition = paladin();
    expect(actionStatblock(getExecutableActions(definition).find((entry) => entry.name === "Lay On Hands")!, definition).text)
      .toBe("A creature it touches regains the hit points it's missing, as many as are left in its Lay On Hands pool, which spends them.");
  });
});

describe("Preserve Life", () => {
  const lifeCleric = () => actor(withSuggestions(withChoice(quickBuild(sources, { classId: "srd:class:cleric", level: 3 }), { kind: "level", index: 2 }, ["subclass"], "srd:subclass:life-domain"), sources));

  it("shares five times the cleric level among bloodied creatures, the most hurt first, none past half", () => {
    const definition = lifeCleric();
    const preserve = getExecutableActions(definition).find((entry) => entry.name === "Preserve Life")!;
    expect(preserve).toMatchObject({ divided: { total: 15, upToHalf: true, bloodiedOnly: true }, resourceCost: { resourceId: "channel-divinity" } });
    const { state, find } = withAlly(definition);
    const me = find("pc-fighter");
    const archer = find("pc-archer");
    me.currentHp = Math.floor(definition.maxHp / 2) - 1; // bloodied, 1 short of half
    archer.currentHp = 2; // 24 max: 10 short of half
    const result = resolveHealingBurstAction(state, "pc-fighter", preserve.id, ["pc-fighter", "pc-archer"]);
    expect(archer.currentHp).toBe(12);
    expect(me.currentHp).toBe(Math.floor(definition.maxHp / 2));
    expect(result.healingApplied).toBe(11);
  });
});
