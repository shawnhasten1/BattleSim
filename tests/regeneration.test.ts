import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  activeFactions, applyRegeneration, createEngineState, isTargetable, resolveAttack, runAutomatedEncounter, runDownedTurn, runTurnStart, sampleEncounter,
  type CombatantState, type CreatureDefinition, type DamageType, type EncounterSnapshot, type FeatureEffect
} from "@/engine";

/** Regeneration, Undead Fortitude, Relentless and massive damage — the "won't stay down" rules. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const hitter = (damage: string, damageType: DamageType, extra: Record<string, unknown> = {}): CreatureDefinition => ({
  id: "def-hitter", name: "Hitter", size: "medium", armorClass: 10, maxHp: 500, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  actions: [{ kind: "attack", id: "hit", name: "Hit", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: damage, damageType }], automationSupport: "full", ...extra } as CreatureDefinition["actions"][number]]
});

const withEffects = (name: string, maxHp: number, effects: FeatureEffect[], resources?: Record<string, number>): CreatureDefinition => ({
  ...fighter, id: "def-target", name, maxHp, armorClass: 1, saves: { con: -20 },
  traits: [{ id: "t", name, category: "trait", automationSupport: "full", effects }], ...(resources ? { resources } : {})
});

function scene(target: CreatureDefinition, attacker: CreatureDefinition, options: { hp?: number; seed?: string; massive?: boolean } = {}): EncounterSnapshot {
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: id === "target" ? options.hp ?? definition.maxHp : definition.maxHp,
    tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced", resources: definition.resources ? { ...definition.resources } : undefined
  });
  const base = structuredClone(sampleEncounter);
  return {
    ...base, seed: options.seed ?? "regen", rules: { ...base.rules, massiveDamage: options.massive ?? true },
    map: { ...base.map, walls: [], terrain: [] }, definitions: [target, attacker],
    combatants: [token("target", target, "enemy", 4), token("attacker", attacker, "party", 5)]
  };
}
const strike = (state: ReturnType<typeof createEngineState>) => {
  const attacker = state.snapshot.combatants.find((entry) => entry.id === "attacker")!;
  attacker.actionEconomy = undefined;
  resolveAttack(state, "attacker", "target", "hit");
};
const target = (state: ReturnType<typeof createEngineState>) => state.snapshot.combatants.find((entry) => entry.id === "target")!;
const logged = (state: ReturnType<typeof createEngineState>, type: string) => state.log.filter((entry) => entry.type === type);

describe("massive damage", () => {
  const plain = withEffects("Plain", 20, []);

  it("kills outright when what's left after 0 HP is at least the maximum", () => {
    const state = createEngineState(scene(plain, hitter("45", "slashing"), { hp: 10 })); // 35 past 0 ≥ 20
    strike(state);
    expect(target(state).state).toBe("defeated");
    expect(logged(state, "MassiveDamage")).toHaveLength(1);
  });

  it("an ordinary overkill just downs it", () => {
    const state = createEngineState(scene({ ...plain, faction: undefined } as CreatureDefinition, hitter("15", "slashing"), { hp: 10 }));
    strike(state);
    expect(target(state).currentHp).toBe(0);
    expect(logged(state, "MassiveDamage")).toHaveLength(0);
  });

  it("is off for encounters without the rule", () => {
    const state = createEngineState(scene(plain, hitter("45", "slashing"), { hp: 10, massive: false }));
    strike(state);
    expect(logged(state, "MassiveDamage")).toHaveLength(0);
  });
});

describe("Undead Fortitude", () => {
  const zombie = (con = 50) => withEffects("Undead Fortitude", 22, [{ kind: "survive-lethal", save: { ability: "con", dcBase: 5 }, excludedDamageTypes: ["radiant"], excludeCritical: true }]);
  const withCon = (con: number) => ({ ...zombie(), saves: { con } });

  it("a made save leaves it at 1 HP", () => {
    const state = createEngineState(scene(withCon(60), hitter("10", "slashing"), { hp: 5 }));
    strike(state);
    expect(target(state).currentHp).toBe(1);
    expect(target(state).state).toBe("active");
    expect(logged(state, "SurvivedLethal")).toHaveLength(1);
  });

  it("a failed save (DC 5 + damage) drops it", () => {
    const state = createEngineState(scene(withCon(-20), hitter("10", "slashing"), { hp: 5 }));
    strike(state);
    expect(target(state).state).toBe("defeated");
  });

  it("radiant damage isn't survived, however good the save", () => {
    const state = createEngineState(scene(withCon(60), hitter("10", "radiant"), { hp: 5 }));
    strike(state);
    expect(target(state).state).toBe("defeated");
    expect(logged(state, "SurvivedLethal")).toHaveLength(0);
  });

  it("a critical hit isn't survived", () => {
    // A natural 20 always hits and crits; try seeds until one lands.
    let crits = 0;
    for (const seed of Array.from({ length: 100 }, (_, index) => `crit-${index}`)) {
      const state = createEngineState(scene(withCon(60), hitter("10", "slashing"), { hp: 5, seed }));
      strike(state);
      const critical = state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.critical === true);
      if (critical) {
        crits += 1;
        expect(target(state).state, seed).toBe("defeated");
      }
    }
    expect(crits).toBeGreaterThan(0);
  });
});

describe("Relentless", () => {
  const boar = withEffects("Relentless", 30, [{ kind: "survive-lethal", maxDamage: 7, resourceId: "relentless" }], { relentless: 1 });

  it("survives a small killing blow once", () => {
    const state = createEngineState(scene(boar, hitter("6", "piercing"), { hp: 3 }));
    strike(state);
    expect(target(state).currentHp).toBe(1);
    expect(target(state).resources?.relentless).toBe(0);
    strike(state);
    expect(target(state).state).toBe("defeated"); // used up
  });

  it("doesn't cover a bigger hit", () => {
    const state = createEngineState(scene(boar, hitter("8", "piercing"), { hp: 3 }));
    strike(state);
    expect(target(state).state).toBe("defeated");
    expect(target(state).resources?.relentless).toBe(1);
  });
});

describe("Regeneration", () => {
  const oni = withEffects("Regeneration", 100, [{ kind: "hp-regen", amount: 10 }]);
  const troll = withEffects("Regeneration", 84, [{ kind: "hp-regen", amount: 10, worksAtZero: true, suppressedByDamageTypes: ["acid", "fire"] }]);

  it("heals at the start of the turn and never past the maximum", () => {
    const state = createEngineState(scene(oni, hitter("1", "slashing"), { hp: 50 }));
    runTurnStart(state, target(state));
    expect(target(state).currentHp).toBe(60);
    target(state).currentHp = 95;
    runTurnStart(state, target(state));
    expect(target(state).currentHp).toBe(100);
  });

  it("needs at least 1 HP unless it works at zero", () => {
    const state = createEngineState(scene(oni, hitter("1", "slashing"), { hp: 50 }));
    target(state).currentHp = 0;
    applyRegeneration(state, target(state));
    expect(target(state).currentHp).toBe(0);
  });

  it("acid or fire switches it off for exactly one turn", () => {
    const state = createEngineState(scene(troll, hitter("5", "fire"), { hp: 50 }));
    strike(state);
    expect(target(state).currentHp).toBe(45);
    runTurnStart(state, target(state));
    expect(target(state).currentHp).toBe(45); // suppressed
    expect(logged(state, "Regenerated").some((entry) => entry.data?.suppressed)).toBe(true);
    runTurnStart(state, target(state));
    expect(target(state).currentHp).toBe(55); // back on
  });

  it("a different damage type doesn't stop it", () => {
    const state = createEngineState(scene(troll, hitter("5", "slashing"), { hp: 50 }));
    strike(state);
    runTurnStart(state, target(state));
    expect(target(state).currentHp).toBe(55);
  });

  describe("a troll at 0 HP", () => {
    it("is down but not dead, can still be attacked, and keeps its side in the fight", () => {
      const state = createEngineState(scene(troll, hitter("20", "slashing"), { hp: 10 }));
      strike(state);
      expect(target(state).state).toBe("downed");
      expect(target(state).downedRegen).toBe(true);
      expect(target(state).deathSaves).toBeUndefined();
      expect(isTargetable(target(state))).toBe(true);
      expect(activeFactions(state.snapshot).has("enemy")).toBe(true);
    });

    it("stands up on its turn and regenerates", () => {
      const state = createEngineState(scene(troll, hitter("20", "slashing"), { hp: 10 }));
      strike(state);
      expect(runDownedTurn(state, target(state))).toBe("recovered");
      expect(target(state).state).toBe("active");
      runTurnStart(state, target(state));
      expect(target(state).currentHp).toBe(10);
      expect(target(state).conditions?.some((condition) => condition.name === "unconscious")).toBeFalsy();
    });

    it("dies if the blow that dropped it was acid or fire", () => {
      const state = createEngineState(scene(troll, hitter("20", "fire"), { hp: 10 }));
      strike(state);
      expect(target(state).state).toBe("defeated");
    });

    it("dies if acid or fire hits it while it's down", () => {
      const state = createEngineState(scene(troll, hitter("20", "slashing"), { hp: 10 }));
      strike(state);
      state.snapshot.definitions[1] = hitter("1", "acid");
      strike(state);
      expect(target(state).state).toBe("defeated");
    });

    it("dies to massive damage", () => {
      const state = createEngineState(scene(troll, hitter("20", "slashing"), { hp: 10 }));
      strike(state);
      state.snapshot.definitions[1] = hitter("100", "slashing");
      strike(state);
      expect(target(state).state).toBe("defeated");
      expect(logged(state, "MassiveDamage")).toHaveLength(1);
    });
  });
});

describe("SRD data", () => {
  const chunkDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
  const monsters = readdirSync(chunkDir).flatMap((file) => (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions);
  const effectOf = (name: string, kind: string) => monsters.find((monster) => monster.name === name)!.traits?.flatMap((trait) => trait.effects ?? []).find((effect) => effect.kind === kind);

  it("carries the regeneration rules of each SRD regenerator", () => {
    expect(effectOf("Troll", "hp-regen")).toEqual({ kind: "hp-regen", amount: 10, worksAtZero: true, suppressedByDamageTypes: ["acid", "fire"] });
    expect(effectOf("Oni", "hp-regen")).toEqual({ kind: "hp-regen", amount: 10 });
    expect(effectOf("Shield Guardian", "hp-regen")).toEqual({ kind: "hp-regen", amount: 10 });
    expect(effectOf("Vampire", "hp-regen")).toEqual({ kind: "hp-regen", amount: 20, suppressedByDamageTypes: ["radiant"] });
    expect(effectOf("Vampire Spawn", "hp-regen")).toEqual({ kind: "hp-regen", amount: 10, suppressedByDamageTypes: ["radiant"] });
  });

  it("carries Undead Fortitude and Relentless", () => {
    for (const name of ["Zombie", "Ogre Zombie"]) {
      expect(effectOf(name, "survive-lethal"), name).toMatchObject({ save: { ability: "con", dcBase: 5 }, excludedDamageTypes: ["radiant"], excludeCritical: true });
    }
    expect(effectOf("Boar", "survive-lethal")).toMatchObject({ maxDamage: 7, resourceId: "relentless" });
    expect(effectOf("Giant Boar", "survive-lethal")).toMatchObject({ maxDamage: 10 });
    expect(effectOf("Wereboar", "survive-lethal")).toMatchObject({ maxDamage: 14 });
    expect(monsters.find((monster) => monster.name === "Boar")!.resources?.relentless).toBe(1);
  });
});

describe("in a fight", () => {
  it("a troll keeps getting up until fire finishes it, and the fight ends", () => {
    const troll = monsters().find((monster) => monster.name === "Troll")!;
    const fire: CreatureDefinition = { ...fighter, id: "def-fire", name: "Torch", maxHp: 2000, armorClass: 30, actions: [{ kind: "attack", id: "torch", name: "Torch", actionType: "action", attackType: "melee", ability: "str", attackBonus: 8, range: 5, reach: 5, damage: [{ dice: "2d8+4", damageType: "fire" }], automationSupport: "full" }] };
    const result = runAutomatedEncounter(fightScene(troll, fire), 30);
    expect(result.outcome.completed).toBe(true);
    expect(result.log.some((entry) => entry.type === "Regenerated")).toBe(true);
  });
});

function monsters(): CreatureDefinition[] {
  const chunkDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
  return readdirSync(chunkDir).flatMap((file) => (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions);
}

function fightScene(troll: CreatureDefinition, hero: CreatureDefinition): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const party = (id: string, x: number): CombatantState => ({ id, definitionId: hero.id, displayName: id, faction: "party", position: { x, y: 3 + x }, currentHp: hero.maxHp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" });
  return {
    ...base, seed: "troll-fight", map: { ...base.map, walls: [], terrain: [] }, definitions: [hero, troll],
    combatants: [party("hero-1", 1), party("hero-2", 2), { id: "troll", definitionId: troll.id, displayName: "Troll", faction: "enemy", position: { x: 6, y: 4 }, currentHp: troll.maxHp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" }]
  };
}

describe("Auto Run and Step agree on a troll", () => {
  it("both regenerate, and neither rolls death saves for it", async () => {
    const { useEncounterStore } = await import("@/store/encounter-store");
    const pristine = useEncounterStore.getState();
    const store = () => useEncounterStore.getState();
    useEncounterStore.setState(pristine, true);
    store().updateGrid({ width: 14, height: 8 });
    await store().addSrdMonster("srd:monster:knight", "party", { x: 2, y: 4 });
    await store().addSrdMonster("srd:monster:troll", "enemy", { x: 6, y: 4 });
    const start = structuredClone(store().encounter);

    const auto = runAutomatedEncounter(start, 30);

    useEncounterStore.setState({ ...pristine, encounter: structuredClone(start), log: [], outcome: null, replayBase: null, replayIndex: null }, true);
    store().rollInitiativeNow();
    let steps = 0;
    while (store().outcome === null && steps < 2000) {
      store().advanceTurn();
      steps += 1;
    }
    for (const [mode, log] of [["auto", auto.log], ["step", store().log]] as const) {
      expect(log.some((entry) => entry.type === "Regenerated"), mode).toBe(true);
      expect(log.some((entry) => entry.type === "DeathSaveRolled" && /Troll/.test(entry.message)), mode).toBe(false);
      expect(log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message)), mode).toEqual([]);
    }
    expect(store().outcome, `step never finished after ${steps} steps`).not.toBeNull();
  }, 60_000);
});
