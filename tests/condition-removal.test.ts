import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveHealingAction,
  runTurnEnd,
  sampleEncounter,
  takeAutomatedTurn,
  type ConditionInstance,
  type ConditionName,
  type CreatureDefinition
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { actionStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7z: ending conditions. Lay On Hands spends 5 of its pool per condition it ends (Poisoned;
 * Restoring Touch adds more), the worst first, then heals with what's left; Self-Restoration ends one of Charmed,
 * Frightened or Poisoned on the monk at the end of each of its turns.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const built = (classId: string, level: number) => actor(quickBuild(sources, { classId: `srd:class:${classId}`, level }));

const condition = (name: ConditionName): ConditionInstance => ({ id: `test-${name}`, name, sourceId: "test", startedRound: 1 });

/** This character in the fighter's place, the archer beside it (with these conditions, and hurt by `hurt`), on its turn. */
function scene(definition: CreatureDefinition, archer: { conditions: ConditionName[]; hurt?: number }) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.round = 1;
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  const archerMax = snapshot.definitions.find((entry) => entry.id === "def-archer")!.maxHp;
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") { token.position = { x: 3, y: 4 }; token.conditions = archer.conditions.map(condition); token.currentHp = archerMax - (archer.hurt ?? 0); }
    if (token.id.startsWith("enemy-")) token.position = { x: 14, y: token.id.endsWith("1") ? 1 : 9 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const lay = getExecutableActions(definition).find((entry) => entry.name === "Lay On Hands")!;
  return { state, find, lay, archerMax };
}

describe("Lay On Hands", () => {
  it("ends Poisoned for 5 of the pool, then heals with what's left", () => {
    const { state, find, lay, archerMax } = scene(built("paladin", 2), { conditions: ["poisoned"], hurt: 20 });
    resolveHealingAction(state, "pc-fighter", "pc-archer", lay.id);
    expect(find("pc-archer").conditions ?? []).toEqual([]);
    // A pool of 10: 5 to end Poisoned, 5 healed.
    expect(find("pc-archer").currentHp).toBe(archerMax - 15);
    expect(find("pc-fighter").resources?.["lay-on-hands"]).toBe(0);
  });

  it("can't end Stunned before Restoring Touch", () => {
    const { state, find, lay } = scene(built("paladin", 5), { conditions: ["stunned"] });
    resolveHealingAction(state, "pc-fighter", "pc-archer", lay.id);
    expect(find("pc-archer").conditions?.map((entry) => entry.name)).toEqual(["stunned"]);
  });

  it("Restoring Touch: the worst first, as far as the pool goes", () => {
    const definition = built("paladin", 14);
    const { state, find, lay } = scene(definition, { conditions: ["poisoned", "stunned", "frightened"] });
    find("pc-fighter").resources!["lay-on-hands"] = 10;
    resolveHealingAction(state, "pc-fighter", "pc-archer", lay.id);
    expect(find("pc-archer").conditions?.map((entry) => entry.name)).toEqual(["poisoned"]);
    expect(actionStatblock(lay, definition).text).toContain("First, for 5 of the pool each, it ends poisoned, blinded, charmed, deafened, frightened, paralyzed, or stunned on the creature (the worst first).");
  });

  it("the AI frees a stunned ally at full health", () => {
    const { state, find } = scene(built("paladin", 14), { conditions: ["stunned"] });
    takeAutomatedTurn(state, find("pc-fighter"));
    expect(state.log.some((entry) => entry.type === "ActionDeclared" && entry.message.includes("Lay On Hands on Archer"))).toBe(true);
    expect(find("pc-archer").conditions ?? []).toEqual([]);
  });
});

describe("Self-Restoration", () => {
  it("ends the worst of Charmed, Frightened or Poisoned on the monk at the end of its turn", () => {
    const monk = built("monk", 10);
    const { state, find } = scene(monk, { conditions: [] });
    find("pc-fighter").conditions = [condition("poisoned"), condition("frightened")];
    runTurnEnd(state, "pc-fighter");
    expect(find("pc-fighter").conditions?.map((entry) => entry.name)).toEqual(["poisoned"]);
    runTurnEnd(state, "pc-fighter");
    expect(find("pc-fighter").conditions ?? []).toEqual([]);
  });
});

describe("Divine Intervention (7ax)", () => {
  it("any running Cleric spell of levels 1-5 as an action without a slot, sharing one use", () => {
    const cleric = rebuildActor(blankCharacter("def-fighter", "PC"), quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:cleric", level: 10 }), SRD_BUILD_SOURCES).definition;
    const casts = getExecutableActions(cleric).filter((action) => action.name.endsWith("(Divine Intervention)"));
    expect(casts.map((action) => action.name)).toEqual(expect.arrayContaining(["Flame Strike (Divine Intervention)", "Healing Word (Divine Intervention)"]));
    for (const cast of casts) expect(cast).toMatchObject({ actionType: "action", resourceCost: { resourceId: "divine-intervention", amount: 1 } });
    expect(cleric.resources?.["divine-intervention"]).toBe(1);
    expect(getExecutableActions(rebuildActor(blankCharacter("def-fighter", "PC"), quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:cleric", level: 9 }), SRD_BUILD_SOURCES).definition)
      .some((action) => action.name.endsWith("(Divine Intervention)"))).toBe(false);
  });
});
