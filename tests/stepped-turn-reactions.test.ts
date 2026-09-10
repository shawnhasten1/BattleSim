// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { useEncounterStore } from "@/store/encounter-store";
import { canAct, sampleEncounter } from "@/engine";
import type { CreatureDefinition, EncounterSnapshot } from "@/engine";

/**
 * Regression: stepping through turns with `advanceTurn` must not spend a
 * creature's reaction when its turn ends. A creature keeps its reaction from the
 * end of its turn until the start of its next one — that is the entire window in
 * which opportunity attacks (and Shield / Counterspell / Hellish Rebuke) fire.
 * `closeActionEconomy` used to zero all three slots, which silently disabled
 * every reaction in stepped play.
 */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));

const GOLEM_DEF: CreatureDefinition = {
  id: "def-test-golem",
  name: "Test Golem",
  source: { provider: "homebrew" },
  size: "medium",
  armorClass: 9,
  maxHp: 127,
  speed: 30,
  abilities: { str: 19, dex: 9, con: 18, int: 6, wis: 10, cha: 5 },
  actions: [
    {
      kind: "attack", id: "golem-slam", name: "Slam", actionType: "action", attackType: "melee",
      ability: "str", attackBonus: 7, range: 5, reach: 5,
      damage: [{ dice: "2d8+4", damageType: "bludgeoning" }], automationSupport: "full"
    }
  ]
};

function steppedEncounter(): EncounterSnapshot {
  const enc: EncounterSnapshot = structuredClone(sampleEncounter);
  enc.seed = "stepped-oa";
  enc.map.walls = [];
  enc.round = 0;
  enc.turnIndex = 0;
  enc.definitions = [...enc.definitions, structuredClone(GOLEM_DEF)];
  enc.combatants = [
    { id: "golem", definitionId: GOLEM_DEF.id, displayName: "Golem", faction: "enemy",
      position: { x: 4, y: 4 }, currentHp: 127, tempHp: 0, state: "active", tacticsProfile: "basic-melee", initiative: 20 },
    { id: "barb", definitionId: "def-fighter", displayName: "Barb", faction: "party",
      position: { x: 5, y: 4 }, currentHp: 40, tempHp: 0, state: "active", tacticsProfile: "basic-melee", initiative: 10 },
    { id: "gob", definitionId: "def-goblin", displayName: "Goblin", faction: "enemy",
      position: { x: 10, y: 4 }, currentHp: 3, tempHp: 0, state: "active", tacticsProfile: "basic-melee", initiative: 1 }
  ];
  return enc;
}

describe("stepped play keeps the reaction available between turns", () => {
  it("an opportunity attack fires when a later combatant leaves reach", () => {
    useEncounterStore.setState({ encounter: steppedEncounter(), log: [], replayBase: null, replayIndex: null });

    useEncounterStore.getState().advanceTurn(); // golem acts (Slam), turn ends
    useEncounterStore.getState().advanceTurn(); // barb walks toward the goblin, past the golem

    const kinds = useEncounterStore.getState().log.map((e) => e.type);
    expect(kinds).toContain("OpportunityAttackTriggered");
    const oa = useEncounterStore.getState().log.find((e) => e.type === "OpportunityAttackTriggered");
    expect(oa?.data?.reactorId).toBe("golem");
    // the golem spent its reaction on the OA
    expect(useEncounterStore.getState().encounter.combatants.find((c) => c.id === "golem")!.actionEconomy?.reaction).toBe(false);
  });

  it("closing a turn leaves the reaction open (but spends action + bonus)", () => {
    useEncounterStore.setState({ encounter: steppedEncounter(), log: [], replayBase: null, replayIndex: null });
    useEncounterStore.getState().advanceTurn(); // golem's turn ends

    const golem = useEncounterStore.getState().encounter.combatants.find((c) => c.id === "golem")!;
    expect(golem.actionEconomy).toEqual({ action: false, bonus: false, reaction: true });
    expect(canAct(golem, "reaction")).toBe(true);
    expect(canAct(golem, "action")).toBe(false);
  });
});
