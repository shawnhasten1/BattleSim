import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createEngineState,
  runAutomatedEncounter,
  sampleEncounter,
  takeAutomatedTurn,
  type CombatLogEvent,
  type CombatantState,
  type CreatureDefinition,
  type EncounterSnapshot,
  type WeaponDefinition
} from "@/engine";

/**
 * Phase 5's "done when", fought out with the generated SRD creatures: routines with options, generic steps, step rules,
 * per-swing reach and movement between swings. Distances count from each creature's top-left square (the engine's
 * reach rule), so the big creatures' targets stand off their top-left corner.
 */
const chunkDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
const library = readdirSync(chunkDir).flatMap((file) => (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions);
const srd = (slug: string) => {
  const found = library.find((monster) => monster.id === `srd:monster:${slug}`);
  if (!found) throw new Error(`no SRD monster ${slug}`);
  return found;
};

const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number, y: number, patch: Partial<CombatantState> = {}): CombatantState => ({
  id, definitionId: definition.id, displayName: id, faction, position: { x, y }, currentHp: definition.maxHp, tempHp: 0, state: "active",
  tacticsProfile: definition.defaultTactics ?? "basic-melee", resourceStance: "balanced", ...patch
});

function encounter(seed: string, combatants: Array<[CombatantState, CreatureDefinition]>): EncounterSnapshot {
  return {
    ...structuredClone(sampleEncounter),
    seed,
    rules: { ...sampleEncounter.rules, requireLineOfEffect: false },
    map: { ...structuredClone(sampleEncounter.map), walls: [], terrain: [] },
    definitions: [...new Map(combatants.map(([, definition]) => [definition.id, definition])).values()],
    combatants: combatants.map(([combatant]) => combatant)
  };
}

interface Swing { target: string; action: string; hit: boolean }

/** Each routine `attackerId` used, as its swings in order (one entry per multiattack it declared). */
function routines(log: CombatLogEvent[], attackerId: string): Array<{ name: string; swings: Swing[] }> {
  const out: Array<{ name: string; swings: Swing[] }> = [];
  for (const entry of log) {
    if (entry.type === "ActionDeclared" && entry.data?.actorId === attackerId) {
      out.push({ name: entry.data?.actionName as string, swings: [] });
    } else if (entry.type === "AttackRolled" && entry.data?.attackerId === attackerId && entry.data?.parentActionId && out.length) {
      out[out.length - 1]!.swings.push({ target: entry.data.targetId as string, action: entry.data.actionId as string, hit: entry.data.hit as boolean });
    }
  }
  return out.filter((routine) => routine.swings.length > 0);
}

const seeds = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);

describe("Phase 5 routines in seeded fights", { timeout: 60000 }, () => {
  it("a fighter with Extra Attack, a longsword, a longbow and Great Weapon Master power-attacks one swing and not the other", () => {
    const longsword: WeaponDefinition = {
      id: "longsword", name: "Longsword", attackType: "melee", ability: "str", range: 5, reach: 5, grip: "versatile", powerAttack: true,
      actionId: "longsword-attack", damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }]
    };
    const longbow: WeaponDefinition = {
      id: "longbow", name: "Longbow", attackType: "ranged", ability: "dex", range: 150, longRange: 600, grip: "two-handed",
      actionId: "longbow-attack", damage: [{ dice: "1d8", damageType: "piercing", abilityModifier: "dex" }]
    };
    const fighter: CreatureDefinition = {
      id: "fighter", name: "Fighter", size: "medium", armorClass: 18, maxHp: 44, speed: 30, proficiencyBonus: 3,
      abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 }, weapons: [longsword, longbow],
      actions: [{ kind: "multiattack", id: "extra-attack", name: "Extra Attack", actionType: "action", attacks: [{ any: "weapon", count: 2 }], automationSupport: "full" }]
    };
    const zombie = srd("zombie");
    const scout = srd("scout");
    let both = 0;
    for (const seed of seeds("fighter", 8)) {
      // A zombie beside it that a power attack drops; a scout 30 ft off that only the longbow reaches.
      const state = createEngineState(encounter(seed, [
        [token("fighter", fighter, "party", 2, 2), fighter],
        [token("zombie", zombie, "enemy", 3, 2, { currentHp: 12 }), zombie],
        [token("scout", scout, "enemy", 8, 2), scout]
      ]));
      takeAutomatedTurn(state, state.snapshot.combatants[0]!);
      const [routine] = routines(state.log, "fighter");
      expect(routine?.name, seed).toBe("Extra Attack");
      const [first, second] = routine!.swings;
      expect(first, seed).toMatchObject({ target: "zombie", action: "longsword-attack:power" });
      if (first!.hit && state.snapshot.combatants.find((combatant) => combatant.id === "zombie")!.state !== "active") {
        // The zombie went down, so the second swing is a plain longbow shot at the scout: one Attack, two weapons.
        expect(second, seed).toMatchObject({ target: "scout", action: "longbow-attack" });
        both += 1;
      }
    }
    expect(both).toBeGreaterThan(0);
  });

  it("a Scout makes two melee attacks beside its foe and two longbow shots at range", () => {
    const scout = srd("scout");
    const guard = srd("guard");
    const chosen = (x: number, seed: string) => {
      const state = createEngineState(encounter(seed, [[token("scout", scout, "party", 1, 1), scout], [token("guard", guard, "enemy", x, 1, { currentHp: 200 }), guard]]));
      takeAutomatedTurn(state, state.snapshot.combatants[0]!);
      return routines(state.log, "scout")[0];
    };
    for (const seed of seeds("scout", 4)) {
      const close = chosen(2, seed);
      expect(close?.name, seed).toBe("Multiattack");
      expect(close?.swings.map((swing) => swing.action), seed).toEqual(["shortsword", "shortsword"]);
      const far = chosen(14, seed);
      expect(far?.name, seed).toBe("Multiattack (Ranged)");
      expect(far?.swings.map((swing) => swing.action), seed).toEqual(["longbow", "longbow"]);
    }
  });

  it("an Adult Red Dragon opens with Frightful Presence, then bites a creature 10 ft away and claws the one beside it", () => {
    const dragon = srd("adult-red-dragon");
    const knight = srd("knight");
    for (const seed of seeds("dragon", 4)) {
      const state = createEngineState(encounter(seed, [
        // Its breath is spent, so this turn is the Multiattack.
        [token("dragon", dragon, "enemy", 3, 3, { resources: { ...dragon.resources, "usage:fire-breath": 0 } }), dragon],
        [token("near", knight, "party", 2, 4, { currentHp: 20 }), knight],
        [token("far", knight, "party", 4, 1), knight]
      ]));
      takeAutomatedTurn(state, state.snapshot.combatants[0]!);
      const firstSave = state.log.findIndex((entry) => entry.type === "SaveRolled" && entry.data?.actionId === "frightful-presence");
      const firstSwing = state.log.findIndex((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "dragon");
      expect(firstSave, seed).toBeGreaterThanOrEqual(0);
      expect(firstSave, seed).toBeLessThan(firstSwing);
      const [routine] = routines(state.log, "dragon");
      expect(routine?.swings.find((swing) => swing.action === "bite")?.target, seed).toBe("far");
      expect(routine?.swings.find((swing) => swing.action === "claw")?.target, seed).toBe("near");
    }
  });

  it("a Brown Bear that drops its first target walks to the next and finishes its routine there", () => {
    const bear = srd("brown-bear");
    const commoner = srd("commoner");
    let walked = 0;
    for (const seed of seeds("bear", 8)) {
      const state = createEngineState(encounter(seed, [
        [token("bear", bear, "enemy", 1, 1), bear],
        [token("first", commoner, "party", 0, 1, { currentHp: 1 }), commoner],
        [token("second", commoner, "party", 6, 1), commoner]
      ]));
      takeAutomatedTurn(state, state.snapshot.combatants[0]!);
      const [routine] = routines(state.log, "bear");
      const [bite, claws] = routine!.swings;
      expect(bite, seed).toMatchObject({ target: "first", action: "bite" });
      if (bite!.hit) {
        expect(claws, seed).toMatchObject({ target: "second", action: "claws" });
        expect(state.log.some((entry) => entry.type === "AiDecision" && entry.data?.reason === "multiattack-move"), seed).toBe(true);
        walked += 1;
      } else {
        expect(claws?.target, seed).toBe("first");
      }
    }
    expect(walked).toBeGreaterThan(0);
  });

  it("a Wight uses Life Drain in place of one longsword attack when its sword won't bite, and not otherwise", () => {
    const wight = srd("wight");
    for (const [foeSlug, expected] of [["werewolf", "Multiattack (Life Drain)"], ["guard", "Multiattack"]] as const) {
      const foe = srd(foeSlug);
      for (const seed of seeds(`wight-${foeSlug}`, 4)) {
        // A werewolf shrugs off its nonmagical longsword; Life Drain's necrotic still lands.
        const state = createEngineState(encounter(seed, [[token("wight", wight, "enemy", 1, 1), wight], [token("foe", foe, "party", 2, 1, { currentHp: 200 }), foe]]));
        takeAutomatedTurn(state, state.snapshot.combatants[0]!);
        const [routine] = routines(state.log, "wight");
        expect(routine?.name, `${foeSlug} ${seed}`).toBe(expected);
        expect(routine?.swings.map((swing) => swing.action), `${foeSlug} ${seed}`)
          .toEqual(expected === "Multiattack" ? ["longsword", "longsword"] : ["longsword", "life-drain"]);
      }
    }
  });

  it("a Tyrannosaurus never puts both attacks on one creature", () => {
    const rex = srd("tyrannosaurus-rex");
    const guard = srd("guard");
    let pairs = 0;
    for (const seed of seeds("rex", 5)) {
      const result = runAutomatedEncounter(encounter(seed, [
        [token("rex", rex, "enemy", 4, 3), rex],
        [token("a", guard, "party", 2, 3), guard],
        [token("b", guard, "party", 4, 1), guard],
        [token("c", guard, "party", 9, 6), guard]
      ]), 8);
      for (const routine of routines(result.log, "rex")) {
        const targets = routine.swings.map((swing) => swing.target);
        expect(new Set(targets).size, `${seed}: ${targets.join(", ")}`).toBe(targets.length);
        if (targets.length === 2) pairs += 1;
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it("a Grick bites only after a tentacle hit, and only that creature", () => {
    const grick = srd("grick");
    const guard = srd("guard");
    const seen = { bit: 0, held: 0 };
    for (const seed of seeds("grick", 5)) {
      const result = runAutomatedEncounter(encounter(seed, [
        [token("grick", grick, "enemy", 3, 3), grick],
        [token("a", guard, "party", 4, 3), guard],
        [token("b", guard, "party", 3, 4), guard]
      ]), 10);
      for (const routine of routines(result.log, "grick")) {
        const [tentacles, beak, ...rest] = routine.swings;
        expect(tentacles?.action, seed).toBe("tentacles");
        expect(rest, seed).toEqual([]);
        if (tentacles!.hit) {
          // The beak follows a hit — unless the tentacles dropped the creature.
          if (beak) {
            expect(beak, seed).toMatchObject({ action: "beak", target: tentacles!.target });
            seen.bit += 1;
          }
        } else {
          expect(beak, seed).toBeUndefined();
          seen.held += 1;
        }
      }
    }
    expect(seen.bit).toBeGreaterThan(0);
    expect(seen.held).toBeGreaterThan(0);
  });
});
