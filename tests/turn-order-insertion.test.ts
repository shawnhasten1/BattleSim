import { describe, expect, it } from "vitest";
import {
  compareInitiative, createEngineState, insertIntoTurnOrder, sampleEncounter,
  type CombatantState, type CreatureDefinition, type EncounterSnapshot
} from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * `insertIntoTurnOrder`: a summon/split rolls one shared initiative and splices into the sorted array. If that
 * position is ahead of whoever's currently acting, the group gets its turn later this round; otherwise it waits
 * for next round, and the current actor's own position stays consistent (no phantom double turn).
 */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;
const newcomer = (idSuffix: string, dex = 10): CreatureDefinition => ({
  ...fighter, id: `def-newcomer-${idSuffix}`, name: `Newcomer ${idSuffix}`, abilities: { ...fighter.abilities, dex }
});
const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", initiative: number): CombatantState => ({
  id, definitionId: definition.id, displayName: id, faction, position: { x: 1, y: 1 }, currentHp: definition.maxHp, tempHp: 0,
  state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced", initiative
});

function scene(seats: Array<{ id: string; initiative: number }>, seed = "insert"): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const combatants = seats.map((seat) => token(seat.id, fighter, "enemy", seat.initiative));
  return { ...base, seed, round: 1, turnIndex: 0, map: { ...base.map, walls: [], terrain: [] }, definitions: [fighter], combatants };
}

const idsOf = (state: ReturnType<typeof createEngineState>) => state.snapshot.combatants.map((combatant) => combatant.id);

describe("compareInitiative", () => {
  it("orders by initiative, then Dex modifier, then id — the one comparator every sort uses", () => {
    const snapshot = scene([]);
    const strong = { ...token("a", newcomer("hi-dex", 18), "enemy", 10) };
    const weak = { ...token("b", newcomer("lo-dex", 8), "enemy", 10) };
    snapshot.definitions.push(newcomer("hi-dex", 18), newcomer("lo-dex", 8));
    expect(compareInitiative(snapshot, strong, weak)).toBeLessThan(0); // higher Dex sorts first on a tie
    expect(compareInitiative(snapshot, weak, strong)).toBeGreaterThan(0);
    const sameEverything = { ...weak, id: "b" };
    expect(compareInitiative(snapshot, weak, sameEverything)).toBe(0);
  });
});

describe("insertIntoTurnOrder", () => {
  it("splices a single newcomer into its sorted slot and reports the roll", () => {
    const state = createEngineState(scene([{ id: "high", initiative: 20 }, { id: "low", initiative: 5 }]));
    const arriving = token("new", newcomer("a"), "enemy", 0);
    state.snapshot.definitions.push(newcomer("a"));
    const { initiative, insertIndex } = insertIntoTurnOrder(state, [arriving]);
    expect(arriving.initiative).toBe(initiative);
    expect(state.snapshot.combatants[insertIndex]!.id).toBe("new");
    // lands wherever its rolled initiative sorts among "high" (20) and "low" (5)
    expect(idsOf(state).indexOf("new")).toBe(insertIndex);
  });

  it("several combatants share one roll and are tie-broken deterministically among themselves", () => {
    const state = createEngineState(scene([{ id: "anchor", initiative: 10 }]));
    const a = token("goblin-a", newcomer("a", 14), "enemy", 0);
    const b = token("goblin-b", newcomer("b", 8), "enemy", 0);
    state.snapshot.definitions.push(newcomer("a", 14), newcomer("b", 8));
    insertIntoTurnOrder(state, [a, b]);
    expect(a.initiative).toBe(b.initiative); // one shared roll
    const order = idsOf(state);
    expect(order.indexOf("goblin-a")).toBeLessThan(order.indexOf("goblin-b")); // higher Dex first
  });

  it("is deterministic for a given seed", () => {
    const run = () => {
      const state = createEngineState(scene([{ id: "anchor", initiative: 10 }]));
      const arriving = token("new", newcomer("a"), "enemy", 0);
      state.snapshot.definitions.push(newcomer("a"));
      return insertIntoTurnOrder(state, [arriving]).initiative;
    };
    expect(run()).toBe(run());
  });

  describe("relative to the currently-acting combatant", () => {
    // Seats sorted desc: "a" 20, "b" 15, "c" 10, "d" 5 — "b" (index 1) is acting. A d20+0 roll of 11-14 sorts
    // strictly between "b" and "c": ahead of "b", so it joins this round's remaining queue undisturbed.
    it("ahead of the current turn: joins later this round, current actor's own index is untouched", () => {
      let found = false;
      for (const seed of ["ins-a", "ins-b", "ins-c", "ins-d", "ins-e", "ins-f", "ins-g", "ins-h"]) {
        const state = createEngineState(scene([{ id: "a", initiative: 20 }, { id: "b", initiative: 15 }, { id: "c", initiative: 10 }, { id: "d", initiative: 5 }], seed));
        state.snapshot.turnIndex = 1;
        const arriving = token("new", newcomer("mid"), "enemy", 0);
        state.snapshot.definitions.push(newcomer("mid"));
        const { initiative, insertIndex } = insertIntoTurnOrder(state, [arriving]);
        if (initiative < 15 && initiative > 10) {
          found = true;
          expect(insertIndex).toBe(2); // between "b" and "c"
          expect(state.snapshot.turnIndex).toBe(1); // "b" is still at its own index — no bump needed
          expect(state.snapshot.combatants[1]!.id).toBe("b");
          expect(idsOf(state)).toEqual(["a", "b", "new", "c", "d"]);
          break;
        }
      }
      expect(found, "no seed rolled 11-14 in range").toBe(true);
    });

    // A d20+0 roll of 16-20 sorts strictly ahead of "b" (15) — at or before the current index.
    it("at or before the current turn: current actor's index shifts with it, newcomer is skipped this pass", () => {
      let found = false;
      for (const seed of ["ins-a", "ins-b", "ins-c", "ins-d", "ins-e", "ins-f", "ins-g", "ins-h"]) {
        const state = createEngineState(scene([{ id: "a", initiative: 20 }, { id: "b", initiative: 15 }, { id: "c", initiative: 10 }], seed));
        state.snapshot.turnIndex = 1;
        const arriving = token("new", newcomer("hi"), "enemy", 0);
        state.snapshot.definitions.push(newcomer("hi"));
        const { initiative, insertIndex } = insertIntoTurnOrder(state, [arriving]);
        if (initiative > 15 && initiative < 20) {
          found = true;
          expect(insertIndex).toBe(1); // between "a" and "b"
          expect(state.snapshot.turnIndex).toBe(2); // bumped so it still points at "b"
          expect(state.snapshot.combatants[2]!.id).toBe("b");
          expect(idsOf(state)).toEqual(["a", "new", "b", "c"]);
          break;
        }
      }
      expect(found, "no seed rolled 16-19 in range").toBe(true);
    });
  });

  it("remaps existing conditions' expiresAt.turnIndex so an unrelated expiry isn't moved to the wrong turn", () => {
    const state = createEngineState(scene([{ id: "a", initiative: 20 }, { id: "b", initiative: 15 }, { id: "c", initiative: 10 }]));
    const bearer = state.snapshot.combatants.find((combatant) => combatant.id === "c")!;
    bearer.conditions = [{ id: "cond-1", name: "prone", startedRound: 1, expiresAt: { round: 1, turnIndex: 2, timing: "start" } }];
    const arriving = token("new", newcomer("mid", 12), "enemy", 0);
    state.snapshot.definitions.push(newcomer("mid", 12));
    const { insertIndex } = insertIntoTurnOrder(state, [arriving]);
    const after = bearer.conditions![0]!.expiresAt!.turnIndex;
    expect(after).toBe(insertIndex <= 2 ? 3 : 2); // shifted only if the splice landed at/before the condition's own slot
    // And "c" is still findable at whatever its new position is, still carrying its condition unshifted in content:
    expect(state.snapshot.combatants.find((combatant) => combatant.id === "c")!.conditions![0]!.name).toBe("prone");
  });
});

describe("Step mode picks up a mid-encounter arrival without any position math", () => {
  it("re-sorts on the next advanceTurn and finds the newcomer wherever it landed", async () => {
    const pristine = useEncounterStore.getState();
    const store = () => useEncounterStore.getState();
    useEncounterStore.setState(pristine, true);
    store().updateGrid({ width: 10, height: 8 });
    await store().addSrdMonster("srd:monster:goblin", "enemy", { x: 3, y: 3 });
    await store().addSrdMonster("srd:monster:wolf", "party", { x: 6, y: 3 });
    store().rollInitiativeNow();
    store().advanceTurn(); // establish a "current actor"

    const before = store().encounter.combatants.length;
    const engine = createEngineState(store().encounter);
    const goblinDef = engine.snapshot.definitions.find((definition) => definition.id.includes("goblin"))!;
    const arriving: CombatantState = {
      id: "combatant-arrival", definitionId: goblinDef.id, displayName: "Arrival", faction: "enemy",
      position: { x: 1, y: 1 }, currentHp: goblinDef.maxHp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
    };
    insertIntoTurnOrder(engine, [arriving]);
    useEncounterStore.setState({ encounter: engine.snapshot, log: engine.log });
    expect(store().encounter.combatants.length).toBe(before + 1);

    store().advanceTurn();
    // Step re-sorted and didn't lose or duplicate anyone.
    const ids = store().encounter.combatants.map((combatant) => combatant.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("combatant-arrival");
  });
});
