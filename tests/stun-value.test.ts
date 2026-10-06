import { describe, expect, it } from "vitest";
import { createEngineState, getExecutableActions, sampleEncounter, takeAutomatedTurn, type CreatureDefinition } from "@/engine";
import { loadSrdMonster } from "@/data/srd/monsters";
import { findSrdItem } from "@/data/srd";
import { blankCharacter, quickBuild, rebuildActor } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/**
 * PC builder plan, Phase 7an: how much the AI values taking a foe's turn. A paid on-hit upgrade that stuns (Stunning
 * Strike) is worth what the target would deal in the turn it loses, so a monk under basic melee tactics spends focus on
 * an ogre, and not on a goblin its hit would likely drop anyway.
 */

const monk = rebuildActor(blankCharacter("def-fighter", "PC"), quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:monk", level: 5 }), SRD_BUILD_SOURCES).definition;

/** The monk's paid swings over a few seeded turns against `enemy`, beside it. */
function paidSwings(enemy: CreatureDefinition): { paid: number; swings: number } {
  let paid = 0;
  let swings = 0;
  for (const seed of ["a", "b", "c", "d"]) {
    const snapshot = structuredClone(sampleEncounter);
    snapshot.map.walls = [];
    snapshot.round = 1;
    snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"), { ...monk, id: "def-fighter" }, { ...enemy, id: "def-goblin" }];
    for (const token of snapshot.combatants) {
      if (token.id === "pc-fighter") { token.currentHp = monk.maxHp; token.resources = { ...(monk.resources ?? {}) }; token.position = { x: 3, y: 3 }; token.tacticsProfile = "basic-melee"; }
      if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = enemy.maxHp; }
      if (token.id === "enemy-goblin-2") token.position = { x: 16, y: 1 };
    }
    snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
    const state = createEngineState({ ...snapshot, seed });
    takeAutomatedTurn(state, state.snapshot.combatants.find((token) => token.id === "pc-fighter")!);
    const attacks = state.log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter");
    swings += attacks.length;
    paid += attacks.filter((entry) => /:charged$/.test(String(entry.data?.actionId))).length;
  }
  return { paid, swings };
}

describe("Stunning Strike's worth to the AI", () => {
  it("spent on an ogre, not on a goblin", async () => {
    const ogre = (await loadSrdMonster("srd:monster:ogre"))!;
    const goblin = sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!;
    expect(paidSwings(ogre).paid).toBeGreaterThan(0);
    const small = paidSwings(goblin);
    expect(small.swings).toBeGreaterThan(0);
    expect(small.paid).toBe(0);
  });
});

describe("Martial Arts on Monk weapons (7aw)", () => {
  it("a Monk weapon attacks with Dexterity and the Martial Arts die, and can carry Stunning Strike; not in armor", () => {
    const actions = getExecutableActions(monk);
    const spear = actions.find((action) => action.name === "Spear" && action.actionType === "action")!;
    expect(spear).toMatchObject({ ability: "dex", damage: [{ dice: "1d8" }] });
    expect(actions.some((action) => action.name === "Spear (1 focus point)")).toBe(true);
    const armored: CreatureDefinition = { ...monk, items: [...(monk.items ?? []), findSrdItem("srd:item:leather-armor")!] };
    expect(getExecutableActions(armored).find((action) => action.name === "Spear" && action.actionType === "action")).toMatchObject({ ability: "str", damage: [{ dice: "1d6" }] });
  });
});
