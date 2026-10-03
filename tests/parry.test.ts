import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngineState, resolveAttack, runTurnStart, sampleEncounter, type CombatantState, type CreatureDefinition, type EncounterSnapshot, type RandomSource } from "@/engine";

/**
 * Parry: +N AC against one melee attack that would hit. Taken once the roll is known and it hits, only when the bonus
 * makes it miss, never against a critical hit, and good for that attack only.
 */
const chunkDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
const monsters = readdirSync(chunkDir).flatMap((file) => (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions);
const byName = (name: string) => monsters.find((monster) => monster.name === name)!;
const knight = byName("Knight");

const swing = (attackType: "melee" | "ranged", bonus: number): CreatureDefinition => ({
  id: "def-swinger", name: "Swinger", size: "medium", armorClass: 10, maxHp: 100, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  actions: [{ kind: "attack", id: "hit", name: "Hit", actionType: "action", attackType, ability: "str", attackBonus: bonus, range: attackType === "melee" ? 5 : 60, reach: attackType === "melee" ? 5 : undefined, damage: [{ dice: "1", damageType: "slashing" }], automationSupport: "full" } as CreatureDefinition["actions"][number]]
});

function scene(defender: CreatureDefinition, attacker: CreatureDefinition): EncounterSnapshot {
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
  });
  const base = structuredClone(sampleEncounter);
  return { ...base, seed: "parry", map: { ...base.map, walls: [], terrain: [] }, definitions: [defender, attacker], combatants: [token("knight", defender, "party", 4), token("swinger", attacker, "enemy", 5)] };
}

/** The d20s the attacks roll, in order; other dice roll their lowest. */
function d20s(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({
    next: () => 0,
    nextInt: (min: number, max: number) => (max === 20 ? values[index++] ?? min : min),
    fork: make
  });
  return make();
}

const parried = (state: ReturnType<typeof createEngineState>) =>
  state.log.filter((entry) => entry.type === "ActionDeclared" && entry.data?.actionName === "Parry").length;
const attacks = (state: ReturnType<typeof createEngineState>) => state.log.filter((entry) => entry.type === "AttackRolled");
const again = (state: ReturnType<typeof createEngineState>) => {
  state.snapshot.combatants.find((entry) => entry.id === "swinger")!.actionEconomy = undefined;
  resolveAttack(state, "swinger", "knight", "hit");
};

describe("Parry", () => {
  it("is generated as a melee-only reaction for an attack that would hit, good for that attack, with the creature's bonus", () => {
    for (const [name, bonus] of [["Knight", 2], ["Bandit Captain", 2], ["Gladiator", 3], ["Erinyes", 4], ["Marilith", 5], ["Noble", 2]] as const) {
      const reaction = byName(name).reactions?.find((action) => action.name === "Parry");
      expect(reaction, name).toMatchObject({
        kind: "activate-feature", actionType: "reaction", automationSupport: "full",
        reaction: { trigger: { kind: "would-be-hit", meleeOnly: true }, lastsFor: "triggering-attack" },
        condition: { modifiers: { armorClass: bonus } }
      });
    }
  });

  it("turns a melee hit into a miss when +2 is enough", () => {
    // +5 vs AC 18: a 14 (19) hits, and +2 makes it a miss.
    const state = createEngineState(scene(knight, swing("melee", 5)));
    state.rng = d20s(14);
    resolveAttack(state, "swinger", "knight", "hit");
    expect(parried(state)).toBe(1);
    expect(attacks(state)[0]!.data).toMatchObject({ hit: false, targetAc: knight.armorClass + 2, total: 19 });
  });

  it("isn't spent on a hit it can't turn into a miss, on a miss, or on a critical hit", () => {
    for (const roll of [18, 5, 20]) {
      const state = createEngineState(scene(knight, swing("melee", 5)));
      state.rng = d20s(roll);
      resolveAttack(state, "swinger", "knight", "hit");
      expect(parried(state), `rolled ${roll}`).toBe(0);
    }
  });

  it("doesn't fire against a ranged attack", () => {
    const state = createEngineState(scene(knight, swing("ranged", 5)));
    state.rng = d20s(14);
    resolveAttack(state, "swinger", "knight", "hit");
    expect(parried(state)).toBe(0);
  });

  it("is good for that attack only, once a round, and comes back at the knight's turn", () => {
    const state = createEngineState(scene(knight, swing("melee", 5)));
    state.rng = d20s(14, 14, 14);
    resolveAttack(state, "swinger", "knight", "hit");
    expect(parried(state)).toBe(1);
    expect(state.snapshot.combatants.find((entry) => entry.id === "knight")!.conditions ?? []).toEqual([]);
    expect(state.log.some((entry) => entry.type === "ConditionExpired" && entry.data?.reason === "triggering-attack-resolved")).toBe(true);
    // The next swing meets the knight's own AC, and its reaction is spent.
    again(state);
    expect(parried(state)).toBe(1);
    expect(attacks(state)[1]!.data).toMatchObject({ hit: true, targetAc: knight.armorClass });
    runTurnStart(state, state.snapshot.combatants.find((entry) => entry.id === "knight")!);
    again(state);
    expect(parried(state)).toBe(2);
  });
});
