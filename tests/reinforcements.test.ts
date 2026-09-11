// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  activeFactions,
  admitReinforcements,
  createEngineState,
  parseCombatantPackage,
  resolveAreaSaveAction,
  resolveAttack,
  runAutomatedEncounter,
  sampleEncounter
} from "@/engine";
import type { CreatureDefinition, EncounterSnapshot, RandomSource } from "@/engine";

const fixedRng: RandomSource = { next: () => 0, nextInt: () => 1, fork: () => fixedRng };

/**
 * Reinforcements: a combatant with `state: "reserve"` + `arrivesRound: N` is off
 * the board (no turns, untargetable, blocks nothing, drawn ghosted) until the
 * engine admits it at the start of round N. Its faction still counts as "in the
 * fight" while it waits, so combat doesn't end early.
 */

const WEAKLING: CreatureDefinition = {
  id: "def-weakling",
  name: "Weakling",
  source: { provider: "homebrew" },
  size: "medium",
  armorClass: 5,
  maxHp: 4,
  speed: 30,
  abilities: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
  actions: [
    {
      kind: "attack", id: "poke", name: "Poke", actionType: "action", attackType: "melee",
      ability: "str", attackBonus: 2, range: 5, reach: 5,
      damage: [{ dice: "1", damageType: "bludgeoning" }], automationSupport: "full"
    }
  ]
};

function base(seed: string): EncounterSnapshot {
  const enc: EncounterSnapshot = structuredClone(sampleEncounter);
  enc.seed = seed;
  enc.map.walls = [];
  enc.round = 0;
  enc.turnIndex = 0;
  enc.definitions = [...enc.definitions, structuredClone(WEAKLING)];
  return enc;
}

function reinforcedFight(seed: string): EncounterSnapshot {
  const enc = base(seed);
  enc.combatants = [
    { id: "hero", definitionId: "def-fighter", displayName: "Hero", faction: "party",
      position: { x: 2, y: 2 }, currentHp: 40, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced", initiative: 20 },
    { id: "vanguard", definitionId: "def-weakling", displayName: "Vanguard", faction: "enemy",
      position: { x: 3, y: 2 }, currentHp: 4, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced", initiative: 10 },
    { id: "reinforcement", definitionId: "def-weakling", displayName: "Reinforcement", faction: "enemy",
      position: { x: 8, y: 2 }, currentHp: 4, tempHp: 0, state: "reserve", arrivesRound: 3, tacticsProfile: "basic-melee", resourceStance: "balanced", initiative: 5 }
  ];
  return enc;
}

describe("reserve combatants — engine gates", () => {
  it("a reserve combatant cannot be targeted by an attack", () => {
    const state = createEngineState(reinforcedFight("reinf-target"));
    expect(() => resolveAttack(state, "hero", "reinforcement", "longsword")).toThrow();
  });

  it("a reserve combatant is not caught in an area save", () => {
    const enc = reinforcedFight("reinf-area");
    enc.combatants.find((c) => c.id === "reinforcement")!.position = { x: 3, y: 2 }; // right on top of the blast
    enc.definitions.find((d) => d.id === "def-fighter")!.actions.push({
      kind: "area-save", id: "blast", name: "Blast", actionType: "action", saveAbility: "dex",
      dc: 99, range: 60, area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 60 },
      damage: [{ dice: "6", damageType: "fire" }], halfDamageOnSuccess: false, onSuccess: "none",
      affects: "all", automationSupport: "full"
    });
    const state = createEngineState(enc);
    state.rng = fixedRng;
    const result = resolveAreaSaveAction(state, "hero", { x: 3, y: 2 }, "blast");
    expect(result.targets.map((t) => t.targetId)).not.toContain("reinforcement");
    expect(state.snapshot.combatants.find((c) => c.id === "reinforcement")!.currentHp).toBe(4);
  });

  it("a faction with only a pending reserve still counts as active", () => {
    const enc = reinforcedFight("reinf-factions");
    enc.combatants.find((c) => c.id === "vanguard")!.state = "dead";
    expect([...activeFactions(enc)].sort()).toEqual(["enemy", "party"]);
  });

  it("admitReinforcements flips a due reserve to active and logs it", () => {
    const state = createEngineState(reinforcedFight("reinf-admit"));
    state.snapshot.round = 2;
    expect(admitReinforcements(state)).toHaveLength(0);
    expect(state.snapshot.combatants.find((c) => c.id === "reinforcement")!.state).toBe("reserve");

    state.snapshot.round = 3;
    const arrived = admitReinforcements(state);
    expect(arrived.map((c) => c.id)).toEqual(["reinforcement"]);
    expect(state.snapshot.combatants.find((c) => c.id === "reinforcement")!.state).toBe("active");
    expect(state.log.some((e) => e.type === "ReinforcementArrived" && e.data?.combatantId === "reinforcement")).toBe(true);
  });
});

describe("reserve combatants — full automated encounter", () => {
  it("holds the fight open through the empty rounds, then the reinforcement joins and is defeated", () => {
    const result = runAutomatedEncounter(reinforcedFight("reinf-run"), 20);

    // combat did not end when the on-board enemy died before round 3
    const arrival = result.log.find((e) => e.type === "ReinforcementArrived");
    expect(arrival).toBeDefined();
    expect(arrival!.round).toBe(3);
    // the hero holds position quietly in the empty round(s) — no automation warning
    expect(result.log.some((e) => e.type === "AiDecision" && e.data?.reason === "awaiting-reinforcements")).toBe(true);
    expect(result.outcome.warnings).toHaveLength(0);
    // party still wins once the reinforcement is down
    expect(result.outcome.winner).toBe("party");
    expect(result.snapshot.combatants.find((c) => c.id === "reinforcement")!.currentHp).toBeLessThanOrEqual(0);
  });
});

describe("reserve combatants — stepped play (advanceTurn)", () => {
  it("stays benched until its round, then joins the initiative order", async () => {
    const { useEncounterStore } = await import("@/store/encounter-store");
    const pristine = useEncounterStore.getState();
    useEncounterStore.setState(pristine, true);

    const enc = reinforcedFight("reinf-stepped");
    // keep the vanguard alive so the fight never actually ends
    enc.combatants.find((c) => c.id === "vanguard")!.currentHp = 999;
    enc.combatants.find((c) => c.id === "hero")!.currentHp = 999;
    useEncounterStore.setState({ encounter: enc, log: [], replayBase: null, replayIndex: null });

    const round = () => useEncounterStore.getState().encounter.round;
    const reinf = () => useEncounterStore.getState().encounter.combatants.find((c) => c.id === "reinforcement")!;

    // step through until we reach round 3
    for (let i = 0; i < 40 && round() < 3; i += 1) {
      useEncounterStore.getState().advanceTurn();
      if (round() < 3) expect(reinf().state).toBe("reserve");
    }
    expect(round()).toBe(3);
    // it has entered play (it may already have been engaged the same round)
    expect(reinf().state).not.toBe("reserve");
    const arrival = useEncounterStore.getState().log.find((e) => e.type === "ReinforcementArrived");
    expect(arrival?.round).toBe(3);
    expect(arrival?.data?.combatantId).toBe("reinforcement");

    useEncounterStore.setState(pristine, true);
  });

  it("setArrivesRound benches / un-benches one or more tokens (pre-combat)", async () => {
    const { useEncounterStore } = await import("@/store/encounter-store");
    const pristine = useEncounterStore.getState();
    useEncounterStore.setState(pristine, true);

    const enc = reinforcedFight("reinf-set");
    enc.combatants.find((c) => c.id === "reinforcement")!.state = "active";
    enc.combatants.find((c) => c.id === "reinforcement")!.arrivesRound = undefined;
    useEncounterStore.setState({ encounter: enc, log: [], replayBase: null, replayIndex: null });

    const byId = (id: string) => useEncounterStore.getState().encounter.combatants.find((c) => c.id === id)!;

    // bench two tokens at once
    useEncounterStore.getState().setArrivesRound(["vanguard", "reinforcement"], 4);
    expect(byId("vanguard").state).toBe("reserve");
    expect(byId("vanguard").arrivesRound).toBe(4);
    expect(byId("reinforcement").state).toBe("reserve");

    // 1 (or below) clears it back onto the board
    useEncounterStore.getState().setArrivesRound(["vanguard"], 1);
    expect(byId("vanguard").state).toBe("active");
    expect(byId("vanguard").arrivesRound).toBeUndefined();

    // undefined also clears
    useEncounterStore.getState().setArrivesRound(["reinforcement"], undefined);
    expect(byId("reinforcement").state).toBe("active");
    expect(byId("reinforcement").arrivesRound).toBeUndefined();

    useEncounterStore.setState(pristine, true);
  });
});

describe("reserve combatants — import", () => {
  it("parseCombatantPackage benches a token with a future arrivesRound", () => {
    const pkg = parseCombatantPackage({ kind: "battle-sim-combatant", schemaVersion: 1,
      definition: {
        name: "Latecomer", size: "medium", armorClass: 12, maxHp: 20, speed: 30,
        abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, actions: []
      },
      combatant: { displayName: "Latecomer", faction: "enemy", arrivesRound: 4 }
    });
    expect(pkg.combatant?.state).toBe("reserve");
    expect(pkg.combatant?.arrivesRound).toBe(4);
  });

  it("arrivesRound of 1 (or absent) leaves the token on the board", () => {
    const pkg = parseCombatantPackage({ kind: "battle-sim-combatant", schemaVersion: 1,
      definition: {
        name: "OnTime", size: "medium", armorClass: 12, maxHp: 20, speed: 30,
        abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, actions: []
      },
      combatant: { displayName: "OnTime", faction: "enemy", arrivesRound: 1 }
    });
    expect(pkg.combatant?.state).toBe("active");
    expect(pkg.combatant?.arrivesRound).toBeUndefined();
  });
});
