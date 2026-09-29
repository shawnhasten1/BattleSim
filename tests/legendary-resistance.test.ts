import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngineState, resolveSaveAction, rollSavingThrow, runTurnStart, sampleEncounter, type CombatantState, type CreatureDefinition, type EncounterSnapshot, type ResourceStance } from "@/engine";

/** Legendary Resistance: fail a save, spend a use, succeed instead — when the stance says it's worth it. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const boss: CreatureDefinition = {
  ...fighter, id: "def-boss", name: "Boss", maxHp: 200, armorClass: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 1, cha: 10 }, saves: { wis: -5, dex: -5 },
  traits: [{ id: "lr", name: "Legendary Resistance (3/Day)", category: "trait", automationSupport: "full", effects: [{ kind: "auto-succeed-save", resourceId: "legendary-resistance" }] }],
  resources: { "legendary-resistance": 3 }
};

const caster: CreatureDefinition = {
  id: "def-caster", name: "Caster", size: "medium", armorClass: 10, maxHp: 30, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  actions: [
    { kind: "save", id: "hold", name: "Hold Person", actionType: "action", spellLevel: 2, saveAbility: "wis", dc: 40, range: 30, damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
      riders: [{ kind: "condition", when: "on-save-fail", condition: "paralyzed", duration: { kind: "rounds", rounds: 3 } }], automationSupport: "full" },
    { kind: "save", id: "scare", name: "Scare", actionType: "action", saveAbility: "wis", dc: 40, range: 30, damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
      riders: [{ kind: "condition", when: "on-save-fail", condition: "charmed", duration: { kind: "rounds", rounds: 3 } }], automationSupport: "full" },
    { kind: "save", id: "sting", name: "Sting", actionType: "action", saveAbility: "dex", dc: 40, range: 30, damage: [{ dice: "1d4", damageType: "fire" }], halfDamageOnSuccess: false, onSuccess: "negates", automationSupport: "full" },
    { kind: "save", id: "blast", name: "Blast", actionType: "action", saveAbility: "dex", dc: 40, range: 30, damage: [{ dice: "20d6", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half", automationSupport: "full" }
  ]
};

function scene(stance: ResourceStance, target = boss): EncounterSnapshot {
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: stance, resources: definition.resources ? { ...definition.resources } : undefined
  });
  const base = structuredClone(sampleEncounter);
  return { ...base, seed: "lr", map: { ...base.map, walls: [], terrain: [] }, definitions: [target, caster], combatants: [token("boss", target, "party", 4), token("caster", caster, "enemy", 5)] };
}
const uses = (state: ReturnType<typeof createEngineState>) => state.snapshot.combatants.find((entry) => entry.id === "boss")!.resources?.["legendary-resistance"];
const spent = (state: ReturnType<typeof createEngineState>) => state.log.filter((entry) => entry.type === "LegendaryResistanceUsed");
const paralyzed = (state: ReturnType<typeof createEngineState>) => state.snapshot.combatants.find((entry) => entry.id === "boss")!.conditions?.some((condition) => condition.name === "paralyzed");

describe("Legendary Resistance", () => {
  it("turns a failed save into a success, spends a use and says so", () => {
    const state = createEngineState(scene("balanced"));
    resolveSaveAction(state, "caster", "boss", "hold");
    expect(paralyzed(state)).toBeFalsy();
    expect(uses(state)).toBe(2);
    expect(spent(state)).toHaveLength(1);
    expect(spent(state)[0]!.message).toMatch(/Legendary Resistance/);
  });

  it("runs out after its uses", () => {
    const state = createEngineState(scene("liberal"));
    for (let i = 0; i < 3; i += 1) {
      runTurnStart(state, state.snapshot.combatants.find((entry) => entry.id === "caster")!);
      resolveSaveAction(state, "caster", "boss", "hold");
    }
    runTurnStart(state, state.snapshot.combatants.find((entry) => entry.id === "caster")!);
    expect(uses(state)).toBe(0);
    expect(paralyzed(state)).toBeFalsy();
    resolveSaveAction(state, "caster", "boss", "hold");
    expect(paralyzed(state)).toBe(true);
    expect(spent(state)).toHaveLength(3);
  });

  it("does nothing when the save is made", () => {
    const strong = { ...boss, saves: { wis: 50 } };
    const state = createEngineState(scene("liberal", strong));
    resolveSaveAction(state, "caster", "boss", "hold");
    expect(spent(state)).toHaveLength(0);
    expect(uses(state)).toBe(3);
  });

  describe("by stance", () => {
    const tries = (stance: ResourceStance, action: string) => {
      const state = createEngineState(scene(stance));
      resolveSaveAction(state, "caster", "boss", action);
      return spent(state).length;
    };

    it("conservative saves its uses for a disabling effect or a big hit", () => {
      expect(tries("conservative", "hold")).toBe(1); // paralysis
      expect(tries("conservative", "scare")).toBe(0); // merely charmed
      expect(tries("conservative", "sting")).toBe(0); // ~2 damage
      expect(tries("conservative", "blast")).toBe(0); // ~70 of 200 HP: a third, under its 40% bar
    });

    it("balanced spends on real control or a quarter of its HP", () => {
      expect(tries("balanced", "hold")).toBe(1);
      expect(tries("balanced", "scare")).toBe(0);
      expect(tries("balanced", "sting")).toBe(0);
      expect(tries("balanced", "blast")).toBe(1);
    });

    it("liberal spends on anything", () => {
      expect(tries("liberal", "scare")).toBe(1);
      expect(tries("liberal", "sting")).toBe(1);
    });
  });

  it("is not spent on a concentration check", () => {
    const state = createEngineState(scene("liberal"));
    const boss_ = state.snapshot.combatants.find((entry) => entry.id === "boss")!;
    const result = rollSavingThrow(state, boss_, { ability: "con", dc: 99, kind: "concentration" });
    expect(result.legendaryResistance).toBeUndefined();
    expect(uses(state)).toBe(3);
  });

  it("can be limited to some saves", () => {
    const scoped: CreatureDefinition = {
      ...boss, traits: [{ id: "lr", name: "Legendary Resistance", category: "trait", automationSupport: "full", effects: [{ kind: "auto-succeed-save", resourceId: "legendary-resistance", against: { source: "magical" } }] }]
    };
    const spell = createEngineState(scene("liberal", scoped));
    resolveSaveAction(spell, "caster", "boss", "hold");
    expect(spent(spell)).toHaveLength(1);
    const breath = createEngineState(scene("liberal", scoped));
    resolveSaveAction(breath, "caster", "boss", "sting");
    expect(spent(breath)).toHaveLength(0);
  });
});

describe("SRD data", () => {
  const chunkDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
  const monsters = readdirSync(chunkDir).flatMap((file) => (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions);

  it("every creature with Legendary Resistance has the effect and a pool of uses", () => {
    const withTrait = monsters.filter((monster) => !monster.hidden && monster.traits?.some((trait) => /^Legendary Resistance/.test(trait.name)));
    expect(withTrait.length).toBe(23);
    for (const monster of withTrait) {
      expect(monster.traits!.some((trait) => trait.effects?.some((effect) => effect.kind === "auto-succeed-save")), monster.name).toBe(true);
      expect(monster.resources?.["legendary-resistance"], monster.name).toBeGreaterThanOrEqual(3);
    }
  });
});
