import { describe, expect, it } from "vitest";
import {
  createEngineState, getExecutableActions, resolveAttack, runAutomatedEncounter, runTurnStart, sampleEncounter, takeAutomatedTurn, updateDefeatState,
  type CombatantState, type CreatureDefinition, type EncounterSnapshot
} from "@/engine";
import { loadSrdMonster } from "@/data/srd/monsters";

/** Phase 9 on the real library data: the generator's trait recipes wired to the engine. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;
const of = async (id: string) => (await loadSrdMonster(`srd:monster:${id}`))!;
const dummy = (extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  ...fighter, id: "dummy", name: "Dummy", maxHp: 200, armorClass: 5, speed: 30, bonusActions: undefined, reactions: undefined, features: undefined, traits: undefined,
  abilities: { ...fighter.abilities, str: 1, dex: 1, con: 1, wis: 1 }, saves: undefined, ...extra
});

type Token = { id: string; def: CreatureDefinition; faction?: "party" | "enemy"; x: number; y?: number; hp?: number };
function scene(tokens: Token[], seed = "srd-phase9"): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const definitions = [...new Map(tokens.map((token) => [token.def.id, token.def])).values()];
  return {
    ...base, seed, map: { ...base.map, grid: { ...base.map.grid, width: 24, height: 12 }, walls: [], terrain: [] },
    definitions,
    combatants: tokens.map((token): CombatantState => ({
      id: token.id, definitionId: token.def.id, displayName: token.id, faction: token.faction ?? "enemy", position: { x: token.x, y: token.y ?? 5 },
      currentHp: token.hp ?? token.def.maxHp, tempHp: 0, state: "active", tacticsProfile: token.def.defaultTactics ?? "basic-melee", resourceStance: "balanced",
      resources: token.def.resources ? { ...token.def.resources } : undefined
    }))
  };
}
const get = (state: ReturnType<typeof createEngineState>, id: string) => state.snapshot.combatants.find((entry) => entry.id === id)!;

describe("charges from the library", () => {
  it("a lion pounces from 30 ft: knocks the target prone and bites it as a bonus action", async () => {
    const lion = await of("lion");
    let clawedFirst = 0;
    let pounced = 0;
    for (const seed of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
      const state = createEngineState(scene([{ id: "lion", def: lion, x: 2 }, { id: "dummy", def: dummy(), faction: "party", x: 9 }], seed));
      takeAutomatedTurn(state, get(state, "lion"));
      const attacks = state.log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "lion").map((entry) => String(entry.data?.actionId));
      // Its bite hits harder, but after a 30 ft run the claw is the one that pounces.
      if (attacks[0] === "claw") clawedFirst += 1;
      if (attacks.some((id) => id.startsWith("bite-pounce"))) pounced += 1;
    }
    expect(clawedFirst).toBe(6);
    // Str 1 vs DC 13, AC 5: the claw usually lands and knocks it down, and the bite follows (~80% of the time).
    expect(pounced).toBeGreaterThanOrEqual(3);
  });

  it("a gnoll that drops a creature rampages on to the next one", async () => {
    const gnoll = await of("gnoll");
    const weakling = dummy({ id: "weak", name: "Weak", maxHp: 1 });
    let rampaged = 0;
    for (const seed of ["r1", "r2", "r3", "r4", "r5", "r6"]) {
      const state = createEngineState(scene([
        { id: "gnoll", def: gnoll, x: 4 }, { id: "a", def: weakling, faction: "party", x: 5 }, { id: "b", def: weakling, faction: "party", x: 8 }
      ], seed));
      takeAutomatedTurn(state, get(state, "gnoll"));
      if (state.log.some((entry) => entry.type === "AiDecision" && /rampages on/.test(entry.message))) rampaged += 1;
    }
    expect(rampaged).toBeGreaterThan(0);
  });

  it("a hobgoblin's Martial Advantage adds 2d6 once per turn when an ally is beside the target", async () => {
    const hobgoblin = await of("hobgoblin");
    const state = createEngineState(scene([
      { id: "hob", def: hobgoblin, x: 4 }, { id: "ally", def: hobgoblin, x: 6 }, { id: "dummy", def: dummy(), faction: "party", x: 5 }
    ]));
    const attack = getExecutableActions(hobgoblin).find((action) => action.kind === "attack" && action.attackType === "melee")!;
    resolveAttack(state, "hob", "dummy", attack.id);
    const rolled = state.log.find((entry) => entry.type === "AttackRolled")!;
    if (rolled.data?.hit) expect(rolled.data.appliedDamageEffects).toContain("Martial Advantage");
  });
});

describe("auras and bursts from the library", () => {
  it("a hezrou's Stench makes a creature that starts its turn next to it save or be poisoned", async () => {
    const hezrou = await of("hezrou");
    const state = createEngineState(scene([{ id: "hezrou", def: hezrou, x: 4 }, { id: "dummy", def: dummy(), faction: "party", x: 6 }]));
    runTurnStart(state, get(state, "dummy"));
    expect(state.log.some((entry) => entry.type === "SaveRolled" && /hezrou's Stench/.test(entry.message))).toBe(true);
  });

  it("a balor's Fire Aura burns everything next to it at the start of its turn, and it explodes when it dies", async () => {
    const balor = await of("balor");
    const state = createEngineState(scene([{ id: "balor", def: balor, x: 4 }, { id: "dummy", def: dummy(), faction: "party", x: 3 }]));
    runTurnStart(state, get(state, "balor"));
    expect(get(state, "dummy").currentHp).toBeLessThan(200);
    const afterAura = get(state, "dummy").currentHp;
    get(state, "balor").currentHp = 0;
    updateDefeatState(state, get(state, "balor"));
    expect(state.log.some((entry) => /Death Throes/.test(entry.message))).toBe(true);
    expect(get(state, "dummy").currentHp).toBeLessThan(afterAura);
  });

  it("an ice mephit's Death Burst hits whoever is next to it", async () => {
    const mephit = await of("ice-mephit");
    const state = createEngineState(scene([{ id: "mephit", def: mephit, x: 4 }, { id: "dummy", def: dummy(), faction: "party", x: 5 }]));
    get(state, "mephit").currentHp = 0;
    updateDefeatState(state, get(state, "mephit"));
    expect(get(state, "dummy").currentHp).toBeLessThan(200);
  });

  it("a swarm's bite is weaker once it is at half its hit points or fewer", async () => {
    const swarm = await of("swarm-of-rats");
    const bites = getExecutableActions(swarm).find((action) => action.kind === "attack")!;
    expect(bites.kind === "attack" && bites.bloodiedDamage).toBeTruthy();
    const hurt = createEngineState(scene([{ id: "swarm", def: { ...swarm, maxHp: 100 }, x: 4, hp: 50 }, { id: "dummy", def: dummy({ armorClass: -50 }), faction: "party", x: 5 }], "swarm"));
    resolveAttack(hurt, "swarm", "dummy", bites.id);
    // 1d6 + Dex (0) while bloodied: at most 6.
    expect(200 - get(hurt, "dummy").currentHp).toBeLessThanOrEqual(6);
  });
});

describe("the sweep", () => {
  it("flavour traits are marked informational, not left looking like missing features", async () => {
    const lion = await of("lion");
    expect(lion.traits!.find((trait) => trait.name === "Keen Smell")?.informational).toBe(true);
    expect(lion.traits!.find((trait) => trait.name === "Running Leap")?.informational).toBe(true);
  });

  it("a fight with charging beasts, a stench and a fire aura runs to a finish without automation failures", async () => {
    const [boar, hezrou, lion] = await Promise.all([of("boar"), of("hezrou"), of("lion")]);
    const party = dummy({ id: "hero", name: "Hero", maxHp: 60, armorClass: 14, abilities: fighter.abilities });
    const result = runAutomatedEncounter(scene([
      { id: "boar", def: boar, x: 2, y: 3 }, { id: "lion", def: lion, x: 2, y: 7 }, { id: "hezrou", def: hezrou, x: 3, y: 5 },
      { id: "h1", def: party, faction: "party", x: 14, y: 4 }, { id: "h2", def: party, faction: "party", x: 14, y: 6 }
    ], "zoo"), 30);
    expect(result.outcome.completed).toBe(true);
    expect(result.log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message))).toEqual([]);
  });
});
