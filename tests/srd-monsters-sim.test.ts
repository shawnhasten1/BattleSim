import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngineState, resolveAttack, runAutomatedEncounter, sampleEncounter, type CombatantState, type CreatureDefinition, type EncounterSnapshot } from "@/engine";

/**
 * Schema validity doesn't prove the engine can *run* a creature. Put every one
 * of the 325 SRD monsters in a real automated fight and require that nothing
 * throws, no turn is lost to an automation failure, and any creature with a
 * runnable attack actually takes an action.
 */
const chunkDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
const monsters = readdirSync(chunkDir).flatMap((file) =>
  (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions
);
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;
const archer = sampleEncounter.definitions.find((definition) => definition.id === "def-archer")!;

const RUNNABLE = new Set(["attack", "save", "area-save", "multiattack", "healing", "reposition"]);

function duel(monster: CreatureDefinition, seed: string): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const party: CombatantState[] = [
    { id: "pc-fighter", definitionId: fighter.id, displayName: "Fighter", faction: "party", position: { x: 1, y: 3 }, currentHp: 32, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced", resources: { "second-wind": 1, "action-surge": 1 } },
    { id: "pc-archer", definitionId: archer.id, displayName: "Archer", faction: "party", position: { x: 1, y: 5 }, currentHp: 24, tempHp: 0, state: "active", tacticsProfile: "basic-ranged", resourceStance: "balanced" }
  ];
  const enemy: CombatantState = {
    id: "enemy-monster", definitionId: monster.id, displayName: monster.name, faction: "enemy", position: { x: 2, y: 4 },
    currentHp: monster.maxHp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced",
    resources: monster.resources ? { ...monster.resources } : undefined
  };
  return {
    ...base,
    seed,
    rules: { ...base.rules, requireLineOfEffect: false },
    map: { ...base.map, walls: [], terrain: [] },
    definitions: [fighter, archer, monster],
    combatants: [...party, enemy]
  };
}

describe("every SRD monster runs in the engine", () => {
  it("has all 325 to test", () => {
    expect(monsters).toHaveLength(325);
  });

  it("fights without crashing, losing turns to failures, or sitting idle when it has a runnable action", () => {
    const failures: string[] = [];
    for (const monster of monsters) {
      const result = runAutomatedEncounter(duel(monster, `srd-smoke:${monster.id}`), 8);
      const lostTurns = result.outcome.warnings.filter((warning) => /automated turn failed/.test(warning));
      if (lostTurns.length > 0) failures.push(`${monster.id}: ${lostTurns[0]}`);

      const runnable = monster.actions.some((action) => RUNNABLE.has(action.kind));
      const hadTurn = result.log.some((entry) => entry.type === "TurnStarted" && entry.data?.combatantId === "enemy-monster");
      const acted = result.log.some((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "enemy-monster" && RUNNABLE.has(String(entry.data?.actionKind)));
      // Placed next to the fighter, so a creature that got a turn and has a runnable action must use one.
      if (runnable && monster.speed > 0 && hadTurn && !acted) failures.push(`${monster.id}: took a turn with runnable actions but never used one`);
    }
    expect(failures).toEqual([]);
  });

  it("keeps a recharge / per-day ability to its interim single-use pool", () => {
    // Fire breath must not be fired every round: 1 use in a fight where nobody can rest.
    const dragon = monsters.find((definition) => definition.id === "srd:monster:adult-red-dragon")!;
    const result = runAutomatedEncounter(duel(dragon, "srd-breath-limit"), 8);
    const breaths = result.log.filter((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "enemy-monster" && entry.data?.actionName === "Fire Breath");
    expect(breaths.length).toBeLessThanOrEqual(1);
  });
});

describe("SRD defenses work in the engine", () => {
  const fighterDef = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;
  const monster = (slug: string) => monsters.find((definition) => definition.id === `srd:monster:${slug}`)!;

  /** One attack of `damageType` (20 flat damage, always hits) against an SRD creature; returns what happened. */
  function strike(slug: string, damageType: "slashing" | "lightning" | "fire", extra: Record<string, unknown> = {}, targetHp?: number) {
    const target = monster(slug);
    const attacker = {
      ...fighterDef, id: "def-tester", actions: [{
        kind: "attack" as const, id: "hit", name: "Hit", actionType: "action" as const, attackType: "melee" as const, ability: "str" as const,
        attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "20", damageType, ...extra }], automationSupport: "full" as const
      }]
    };
    const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number, hp: number): CombatantState => ({
      id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: hp, tempHp: 0, state: "active",
      tacticsProfile: "basic-melee", resourceStance: "balanced"
    });
    const base = structuredClone(sampleEncounter);
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const state = createEngineState({
        ...base, seed, map: { ...base.map, walls: [], terrain: [] }, definitions: [attacker, target],
        combatants: [token("attacker", attacker, "party", 3, 100), token("target", target, "enemy", 4, targetHp ?? target.maxHp)]
      });
      resolveAttack(state, "attacker", "target", "hit");
      const hit = state.log.find((entry) => entry.type === "DamageApplied");
      if (hit) return { applied: Number(hit.data?.totalApplied), absorbed: Number(hit.data?.absorbed ?? 0), hp: state.snapshot.combatants.find((entry) => entry.id === "target")!.currentHp, max: target.maxHp };
    }
    throw new Error("no hit");
  }

  it("a Werewolf ignores plain steel, but not silver (immune to nonmagical weapons not made with silver)", () => {
    expect(strike("werewolf", "slashing").applied).toBe(0);
    expect(strike("werewolf", "slashing", { material: "silvered" }).applied).toBe(20);
    expect(strike("werewolf", "slashing", { magical: true }).applied).toBe(20);
    expect(strike("werewolf", "slashing", { material: "adamantine" }).applied).toBe(0); // only silver counts for it
  });

  it("an Iron Golem (immune to nonmagical weapons not made with adamantine) is beaten by adamantine", () => {
    expect(strike("iron-golem", "slashing").applied).toBe(0);
    expect(strike("iron-golem", "slashing", { material: "adamantine" }).applied).toBe(20);
    expect(strike("iron-golem", "slashing", { material: "silvered" }).applied).toBe(0);
  });

  it("a Flesh Golem is healed by lightning instead of hurt (and capped at its maximum)", () => {
    const golem = monster("flesh-golem");
    expect(strike("flesh-golem", "lightning", {}, 50)).toMatchObject({ applied: 0, absorbed: 20, hp: 70 });
    expect(strike("flesh-golem", "lightning", {}, golem.maxHp - 5).hp).toBe(golem.maxHp);
    expect(strike("flesh-golem", "fire", { magical: true }, 50)).toMatchObject({ applied: 20, absorbed: 0, hp: 30 });
  });

  it("an Iron Golem absorbs fire, a Clay Golem absorbs acid, a Shambling Mound absorbs lightning", () => {
    expect(strike("iron-golem", "fire", {}, 100).hp).toBe(120);
    expect(strike("shambling-mound", "lightning", {}, 60).hp).toBe(80);
  });
});
