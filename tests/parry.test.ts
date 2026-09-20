import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngineState, resolveAttack, runTurnStart, sampleEncounter, type CombatantState, type CreatureDefinition, type EncounterSnapshot } from "@/engine";

/** Parry: a Shield-style reaction — +N AC against a melee attack. */
const chunkDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
const monsters = readdirSync(chunkDir).flatMap((file) => (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions);
const byName = (name: string) => monsters.find((monster) => monster.name === name)!;

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

describe("Parry", () => {
  it("is generated as a melee-only Shield-style reaction with the creature's bonus", () => {
    for (const [name, bonus] of [["Knight", 2], ["Bandit Captain", 2], ["Gladiator", 3], ["Erinyes", 4], ["Marilith", 5], ["Noble", 2]] as const) {
      const reaction = byName(name).reactions?.find((action) => action.name === "Parry");
      expect(reaction, name).toMatchObject({ kind: "activate-feature", actionType: "reaction", automationSupport: "full", reaction: { trigger: { kind: "targeted-by-attack", meleeOnly: true } }, condition: { modifiers: { armorClass: bonus } } });
    }
  });

  it("fires against a melee attack and raises AC until the knight's next turn", () => {
    const state = createEngineState(scene(byName("Knight"), swing("melee", 5)));
    resolveAttack(state, "swinger", "knight", "hit");
    expect(state.log.some((entry) => entry.type === "ActionDeclared" && entry.data?.actionName === "Parry")).toBe(true);
    const roll = state.log.find((entry) => entry.type === "AttackRolled")!;
    expect(roll.data?.targetAc).toBe(byName("Knight").armorClass + 2);
  });

  it("doesn't fire against a ranged attack", () => {
    const state = createEngineState(scene(byName("Knight"), swing("ranged", 5)));
    resolveAttack(state, "swinger", "knight", "hit");
    expect(state.log.some((entry) => entry.type === "ActionDeclared" && entry.data?.actionName === "Parry")).toBe(false);
  });

  it("is spent once a round and comes back at the knight's turn", () => {
    const state = createEngineState(scene(byName("Knight"), swing("melee", 5)));
    resolveAttack(state, "swinger", "knight", "hit");
    state.snapshot.combatants.find((entry) => entry.id === "swinger")!.actionEconomy = undefined;
    resolveAttack(state, "swinger", "knight", "hit");
    expect(state.log.filter((entry) => entry.type === "ActionDeclared" && entry.data?.actionName === "Parry")).toHaveLength(1);
    runTurnStart(state, state.snapshot.combatants.find((entry) => entry.id === "knight")!);
    state.snapshot.combatants.find((entry) => entry.id === "swinger")!.actionEconomy = undefined;
    resolveAttack(state, "swinger", "knight", "hit");
    expect(state.log.filter((entry) => entry.type === "ActionDeclared" && entry.data?.actionName === "Parry")).toHaveLength(2);
  });
});
