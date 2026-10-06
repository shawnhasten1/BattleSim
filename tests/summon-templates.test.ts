import { describe, expect, it } from "vitest";
import {
  collectDependencies,
  createEngineState,
  getExecutableActions,
  resolveSummonAction,
  sampleEncounter,
  type CreatureDefinition
} from "@/engine";
import { syncTurnOrder } from "@/engine/turns";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { replayTo } from "@/lib/replay";

/**
 * PC builder plan, Phase 7au: a spell's own stat block, made when it's summoned. Find Steed's Otherworldly Steed and
 * Summon Dragon's Draconic Spirit, from the caster's spellcasting and the slot's level (SRD 5.2), sharing the caster's
 * initiative and acting right after it.
 */

const sources = SRD_BUILD_SOURCES;
const mod = (score: number) => Math.floor((score - 10) / 2);

function scene(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  snapshot.round = 1;
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; }
    token.initiative = token.id === "pc-fighter" ? 12 : token.id === "pc-archer" ? 15 : 8;
  }
  const state = createEngineState(snapshot);
  state.snapshot.turnIndex = state.snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const free = (name: string) => getExecutableActions({ ...definition, id: "def-fighter" }).find((action) => action.name === name)!;
  return { state, free };
}

describe("Find Steed", () => {
  const paladin = rebuildActor(blankCharacter("def-fighter", "PC"), quickBuild(sources, { classId: "srd:class:paladin", level: 5 }), sources).definition;

  it("an Otherworldly Steed at the spell's level, its slam with the paladin's spell attack", () => {
    const { state, free } = scene(paladin);
    const [steed] = resolveSummonAction(state, "pc-fighter", free("Find Steed (free)").id, "celestial");
    const made = state.snapshot.definitions.find((entry) => entry.id === steed!.definitionId)!;
    const pb = 3;
    expect(made).toMatchObject({ name: "Otherworldly Steed (Celestial)", size: "large", type: "celestial", armorClass: 12, maxHp: 25, speed: 60 });
    expect(made.actions[0]).toMatchObject({ name: "Otherworldly Slam", attackBonus: mod(paladin.abilities.cha) + pb, damage: [{ dice: "1d8+2", damageType: "radiant" }] });
    expect(getExecutableActions(made).some((action) => action.name === "Healing Touch")).toBe(true);
    // Its turn right after the paladin's, on the same initiative.
    expect(steed).toMatchObject({ initiative: 12, summon: { followsSummoner: true } });
    const order = state.snapshot.combatants.map((token) => token.id);
    expect(order.indexOf(steed!.id)).toBe(order.indexOf("pc-fighter") + 1);
    expect(state.log.find((entry) => entry.type === "CombatantSpawned")?.data?.definition).toMatchObject({ id: made.id });
  });

  it("keeps its place after the paladin when the order is sorted again, and replays", () => {
    const { state, free } = scene(paladin);
    const before = structuredClone(state.snapshot);
    const [steed] = resolveSummonAction(state, "pc-fighter", free("Find Steed (free)").id, "fiend");
    syncTurnOrder(state);
    const order = state.snapshot.combatants.map((token) => token.id);
    expect(order.indexOf(steed!.id)).toBe(order.indexOf("pc-fighter") + 1);
    const replayed = replayTo(before, state.log, state.log.length);
    expect(replayed.definitions.some((entry) => entry.name === "Otherworldly Steed (Fiend)")).toBe(true);
    expect(replayed.combatants.some((token) => token.id === steed!.id)).toBe(true);
  });

  it("needs nothing embedded in the encounter", () => {
    expect(collectDependencies(paladin).some((id) => id.startsWith("template:"))).toBe(false);
  });
});

describe("Summon Dragon (Dragon Companion)", () => {
  it("a Draconic Spirit at 5th level: two Rends and its breath, and the sorcerer resists the breath's type", () => {
    let build = quickBuild(sources, { classId: "srd:class:sorcerer", level: 18 });
    build = withSuggestions(withChoice(build, { kind: "level", index: 2 }, ["subclass"], "srd:subclass:draconic-sorcery"), sources);
    const sorcerer = rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
    const { state, free } = scene(sorcerer);
    const [spirit] = resolveSummonAction(state, "pc-fighter", free("Summon Dragon (free)").id, "fire");
    const made = state.snapshot.definitions.find((entry) => entry.id === spirit!.definitionId)!;
    expect(made).toMatchObject({ name: "Draconic Spirit (Fire)", armorClass: 19, maxHp: 50 });
    expect(made.actions[0]).toMatchObject({ kind: "multiattack", attacks: [{ actionId: "breath-weapon", count: 1 }, { actionId: "rend", count: 2 }] });
    const me = state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    expect(me.conditions?.find((condition) => condition.sourceName === "Shared Resistances")?.modifiers?.damageAdjustments).toEqual([{ type: "resistance", damageType: "fire" }]);
  });
});
