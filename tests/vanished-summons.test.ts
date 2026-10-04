import { beforeEach, describe, expect, it } from "vitest";
import { sampleEncounter, type CombatantState, type EncounterSnapshot } from "@/engine";
import { hasVanished, useEncounterStore } from "@/store/encounter-store";

/**
 * A summoned creature that goes (its summoner died, its duration ran out) is kept by the engine as `"fled"` for the
 * log and the report, but the board shouldn't show it: it used to stay on the map as a 0-HP token that never acted.
 */
function summoned(id: string, state: CombatantState["state"]): CombatantState {
  const goblin = sampleEncounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!;
  return {
    ...structuredClone(goblin),
    id,
    displayName: id,
    position: { x: 9, y: 9 },
    state,
    summon: { summonerId: "enemy-goblin-1", generation: 1 }
  };
}

function withSummons(): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.combatants.push(summoned("summon-here", "active"), summoned("summon-gone", "fled"));
  return encounter;
}

describe("vanished summons", () => {
  it("a summon that has fled has vanished; a fled creature of the setup, or a summon still here, hasn't", () => {
    expect(hasVanished(summoned("gone", "fled"))).toBe(true);
    expect(hasVanished(summoned("here", "active"))).toBe(false);
    expect(hasVanished(summoned("down", "defeated"))).toBe(false);
    expect(hasVanished({ state: "fled" })).toBe(false);
  });

  describe("restarting the fight", () => {
    beforeEach(() => {
      useEncounterStore.getState().replaceEncounter(withSummons());
    });

    it("takes away everything summoned during it, and keeps the setup's creatures", () => {
      useEncounterStore.getState().restartCombat();
      const ids = useEncounterStore.getState().encounter.combatants.map((combatant) => combatant.id);
      expect(ids).not.toContain("summon-here");
      expect(ids).not.toContain("summon-gone");
      expect(ids).toEqual(sampleEncounter.combatants.map((combatant) => combatant.id));
    });
  });
});
