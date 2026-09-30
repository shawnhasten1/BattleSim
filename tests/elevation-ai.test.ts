import { describe, expect, it } from "vitest";
import {
  createEngineState, runAutomatedEncounter, sampleEncounter, takeAutomatedTurn,
  type ActionDefinition, type CombatantState, type CreatureDefinition, type EncounterSnapshot, type MovementProfile, type TacticsProfile
} from "@/engine";

/** The AI and height: melee fliers come down to fight, ranged fliers climb out of reach, walkers route up ramps. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const spear: ActionDefinition = { kind: "attack", id: "spear", name: "Spear", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "1d6", damageType: "piercing" }], automationSupport: "full" };
const bow: ActionDefinition = { kind: "attack", id: "bow", name: "Bow", actionType: "action", attackType: "ranged", ability: "dex", attackBonus: 100, range: 60, longRange: 240, damage: [{ dice: "1d6", damageType: "piercing" }], automationSupport: "full" };

const creature = (id: string, actions: ActionDefinition[], extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  ...fighter, id, name: id, maxHp: 30, armorClass: 10, bonusActions: undefined, reactions: undefined, features: undefined, actions, ...extra
});
const flying = (movement: MovementProfile = { walk: 30, fly: 60 }): Partial<CreatureDefinition> => ({ speed: movement.walk, movement });

type Token = { id: string; def: string; faction: "party" | "enemy"; x: number; y?: number; altitude?: number; tactics?: TacticsProfile };
function scene(defs: CreatureDefinition[], tokens: Token[], elevation?: Record<string, number>, seed = "elevation-ai"): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  return {
    ...base, seed,
    map: { ...base.map, grid: { ...base.map.grid, width: 24, height: 10 }, walls: [], terrain: [], elevation: elevation ? { cells: elevation } : undefined },
    definitions: defs,
    combatants: tokens.map((token): CombatantState => {
      const definition = defs.find((candidate) => candidate.id === token.def)!;
      return {
        id: token.id, definitionId: token.def, displayName: token.id, faction: token.faction, position: { x: token.x, y: token.y ?? 4 },
        altitude: token.altitude, currentHp: definition.maxHp, tempHp: 0, state: "active", tacticsProfile: token.tactics ?? "basic-melee", resourceStance: "balanced"
      };
    })
  };
}
const get = (state: ReturnType<typeof createEngineState>, id: string) => state.snapshot.combatants.find((entry) => entry.id === id)!;
const noFailures = (log: { type: string; message: string }[]) => log.filter((entry) => entry.type === "AutomationWarning" && /failed|could not/.test(entry.message));

describe("melee fliers", () => {
  const defs = [creature("hero", [spear]), creature("gryphon", [spear], flying())];

  it("a melee flier high above its target comes down to reach it, and attacks the same turn", () => {
    const state = createEngineState(scene(defs, [
      { id: "hero", def: "hero", faction: "party", x: 6 },
      { id: "gryphon", def: "gryphon", faction: "enemy", x: 6, y: 5, altitude: 40 }
    ]));
    takeAutomatedTurn(state, get(state, "gryphon"));
    expect(get(state, "gryphon").altitude ?? 0).toBeLessThanOrEqual(5);
    expect(state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "gryphon")).toBe(true);
  });

  it("stays airborne when its target is airborne too", () => {
    const state = createEngineState(scene([creature("hero", [bow], flying()), creature("gryphon", [spear], flying())], [
      { id: "hero", def: "hero", faction: "party", x: 6, altitude: 30 },
      { id: "gryphon", def: "gryphon", faction: "enemy", x: 6, y: 5, altitude: 30 }
    ]));
    takeAutomatedTurn(state, get(state, "gryphon"));
    expect(get(state, "gryphon").altitude).toBe(30);
    expect(state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "gryphon")).toBe(true);
  });

  it("a ground fighter facing a flier it can't reach doesn't crash the fight, which still finishes", () => {
    const result = runAutomatedEncounter(scene(defs, [
      { id: "hero", def: "hero", faction: "party", x: 4 },
      { id: "gryphon", def: "gryphon", faction: "enemy", x: 12, altitude: 30 }
    ]), 30);
    expect(noFailures(result.log)).toEqual([]);
    expect(result.outcome.completed).toBe(true);
  });
});

describe("ranged fliers", () => {
  const defs = [creature("hero", [spear]), creature("archer", [bow], flying())];

  it("climbs out of a ground fighter's reach after shooting", () => {
    const state = createEngineState(scene(defs, [
      { id: "hero", def: "hero", faction: "party", x: 6 },
      { id: "archer", def: "archer", faction: "enemy", x: 8, tactics: "basic-ranged" }
    ]));
    takeAutomatedTurn(state, get(state, "archer"));
    expect(get(state, "archer").altitude).toBeGreaterThanOrEqual(10);
    expect(state.log.some((entry) => entry.type === "CombatantMoved" && /climbs to/.test(entry.message))).toBe(true);
  });

  it("and then the ground fighter can't reach it — the log says why, plainly — but the fight still ends", () => {
    const result = runAutomatedEncounter(scene(defs, [
      { id: "hero", def: "hero", faction: "party", x: 6 },
      { id: "archer", def: "archer", faction: "enemy", x: 10, tactics: "basic-ranged" }
    ]), 40);
    expect(noFailures(result.log)).toEqual([]);
    expect(result.outcome.completed).toBe(true);
    expect(result.log.some((entry) => entry.type === "AiDecision" && /can't reach archer with Spear: archer is \d+ ft up/.test(entry.message))).toBe(true);
  });

  it("doesn't bother climbing when the foe can fly too", () => {
    const state = createEngineState(scene([creature("hero", [spear], flying()), creature("archer", [bow], flying())], [
      { id: "hero", def: "hero", faction: "party", x: 6 },
      { id: "archer", def: "archer", faction: "enemy", x: 8, tactics: "basic-ranged" }
    ]));
    takeAutomatedTurn(state, get(state, "archer"));
    expect(get(state, "archer").altitude ?? 0).toBe(0);
  });
});

describe("walkers and heights", () => {
  it("a walker takes the ramp up to a raised shelf instead of trying to climb the cliff", () => {
    const cells: Record<string, number> = {};
    for (let y = 0; y < 10; y += 1) for (let x = 8; x < 24; x += 1) cells[`${x},${y}`] = 10; // a 10 ft shelf along column 8+
    cells["7,0"] = 5; // ...with a 5 ft step up at the top edge, forming the only stair
    const defs = [creature("hero", [spear]), creature("brute", [spear])];
    const state = createEngineState(scene(defs, [
      { id: "hero", def: "hero", faction: "party", x: 12, y: 5 },
      { id: "brute", def: "brute", faction: "enemy", x: 4, y: 5 }
    ], cells));
    for (let turn = 0; turn < 6 && !state.log.some((entry) => entry.type === "AttackRolled"); turn += 1) {
      state.snapshot.turnIndex = 0;
      get(state, "brute").turnFlags = undefined;
      get(state, "brute").actionEconomy = undefined;
      takeAutomatedTurn(state, get(state, "brute"));
    }
    // It has walked around to the stair at the top edge rather than getting stuck at the cliff face.
    const path = state.log.filter((entry) => entry.type === "CombatantMoved" && entry.data?.combatantId === "brute").flatMap((entry) => (entry.data?.cells as Array<{ x: number; y: number }>) ?? []);
    expect(path.some((cell) => cell.x === 7 && cell.y === 0)).toBe(true);
  });

  it("the same seed gives the same fight, with heights and fliers in play", () => {
    const build = () => scene([creature("hero", [spear]), creature("gryphon", [spear], flying()), creature("archer", [bow], flying())], [
      { id: "hero", def: "hero", faction: "party", x: 4 },
      { id: "gryphon", def: "gryphon", faction: "enemy", x: 12, altitude: 20 },
      { id: "archer", def: "archer", faction: "enemy", x: 14, tactics: "basic-ranged" }
    ], { "6,4": 10, "7,4": 10 }, "replayable");
    const first = runAutomatedEncounter(build(), 30);
    const second = runAutomatedEncounter(build(), 30);
    expect(second.log.map((entry) => entry.message)).toEqual(first.log.map((entry) => entry.message));
    expect(second.outcome).toEqual(first.outcome);
  });
});
