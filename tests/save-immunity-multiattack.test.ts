import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createEngineState, isImmuneAfterSave, resolveAreaSaveAction, resolveMultiattackAction, resolveSaveAction, runRepeatedSaves, sampleEncounter,
  type CombatantState, type CreatureDefinition, type EncounterSnapshot
} from "@/engine";

/** Frightful Presence: immune once you save, and a save step can open a multiattack. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const presence = {
  kind: "area-save", id: "presence", name: "Frightful Presence", actionType: "action", saveAbility: "wis", dc: 40, range: 60,
  area: { type: "circle", size: 60 }, targeting: { origin: "self", aimedFromSelf: false, range: 60 }, damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
  affects: "hostile", immuneAfterSave: true,
  riders: [{ kind: "condition", when: "on-save-fail", condition: "frightened", duration: { kind: "save-ends", saveAt: "turn-end" } }], automationSupport: "full"
};
const bite = { kind: "attack", id: "bite", name: "Bite", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "5", damageType: "piercing" }], automationSupport: "full" };
const dragon: CreatureDefinition = {
  id: "def-dragon", name: "Dragon", size: "large", armorClass: 10, maxHp: 300, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  actions: [presence, bite, { kind: "multiattack", id: "multiattack", name: "Multiattack", actionType: "action", attacks: [{ actionId: "presence", count: 1 }, { actionId: "bite", count: 2 }], automationSupport: "full" }] as unknown as CreatureDefinition["actions"]
};
const hero = (wisSave: number): CreatureDefinition => ({ ...fighter, id: "def-hero", maxHp: 5000, armorClass: 1, saves: { wis: wisSave } });

function scene(wisSave: number): EncounterSnapshot {
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
  });
  const base = structuredClone(sampleEncounter);
  const h = hero(wisSave);
  return { ...base, seed: "imm", map: { ...base.map, walls: [], terrain: [] }, definitions: [h, dragon], combatants: [token("hero", h, "party", 4), token("dragon", dragon, "enemy", 5)] };
}
const hero_ = (state: ReturnType<typeof createEngineState>) => state.snapshot.combatants.find((entry) => entry.id === "hero")!;
const frightened = (state: ReturnType<typeof createEngineState>) => hero_(state).conditions?.some((condition) => condition.name === "frightened");
const fresh = (state: ReturnType<typeof createEngineState>) => { state.snapshot.combatants.find((entry) => entry.id === "dragon")!.actionEconomy = undefined; };

describe("immune after a successful save", () => {
  it("a creature that makes the save can't be affected again", () => {
    const state = createEngineState(scene(60));
    resolveAreaSaveAction(state, "dragon", { x: 5, y: 4 }, "presence");
    expect(hero_(state).savedAgainst).toEqual(["dragon:presence"]);
    fresh(state);
    const rollsBefore = state.log.filter((entry) => entry.type === "SaveRolled").length;
    resolveAreaSaveAction(state, "dragon", { x: 5, y: 4 }, "presence");
    expect(state.log.filter((entry) => entry.type === "SaveRolled").length).toBe(rollsBefore); // no second roll
  });

  it("a creature that fails is affected, and isn't immune", () => {
    const state = createEngineState(scene(-30));
    resolveAreaSaveAction(state, "dragon", { x: 5, y: 4 }, "presence");
    expect(frightened(state)).toBe(true);
    expect(hero_(state).savedAgainst).toBeUndefined();
  });

  it("shaking the effect off with a repeated save earns immunity too", () => {
    const state = createEngineState(scene(-30));
    resolveAreaSaveAction(state, "dragon", { x: 5, y: 4 }, "presence");
    expect(frightened(state)).toBe(true);
    state.snapshot.definitions[0] = hero(60);
    for (const condition of hero_(state).conditions ?? []) if (condition.repeatSave) condition.repeatSave = { ...condition.repeatSave, dc: 1 };
    runRepeatedSaves(state, "hero", "turn-end");
    expect(frightened(state)).toBeFalsy();
    expect(hero_(state).savedAgainst).toContain("dragon:presence");
  });

  it("isImmuneAfterSave needs the flag and the record", () => {
    const target = { savedAgainst: ["dragon:presence"] } as CombatantState;
    expect(isImmuneAfterSave({ id: "dragon" }, target, { id: "presence", immuneAfterSave: true })).toBe(true);
    expect(isImmuneAfterSave({ id: "dragon" }, target, { id: "presence" })).toBe(false);
    expect(isImmuneAfterSave({ id: "other" }, target, { id: "presence", immuneAfterSave: true })).toBe(false);
  });

  it("a single-target save is skipped for someone already immune", () => {
    const gaze = { kind: "save", id: "gaze", name: "Gaze", actionType: "action", saveAbility: "wis", dc: 40, range: 30, damage: [], halfDamageOnSuccess: false, onSuccess: "negates", immuneAfterSave: true, riders: [{ kind: "condition", when: "on-save-fail", condition: "frightened", duration: { kind: "rounds", rounds: 3 } }], automationSupport: "full" };
    const snapshot = scene(60);
    snapshot.definitions[1] = { ...dragon, actions: [gaze] as unknown as CreatureDefinition["actions"] };
    const state = createEngineState(snapshot);
    resolveSaveAction(state, "dragon", "hero", "gaze");
    fresh(state);
    resolveSaveAction(state, "dragon", "hero", "gaze");
    expect(state.log.filter((entry) => entry.type === "SaveRolled")).toHaveLength(1);
    expect(state.log.some((entry) => entry.type === "ConditionResisted" && /immune to/.test(entry.message))).toBe(true);
  });
});

describe("a save step in a multiattack", () => {
  it("is taken first, then the attacks follow, all on one action", () => {
    const state = createEngineState(scene(-30));
    resolveMultiattackAction(state, "dragon", "hero", "multiattack");
    const declared = state.log.filter((entry) => entry.type === "ActionDeclared").map((entry) => entry.data?.actionName);
    expect(declared).toEqual(["Multiattack", "Frightful Presence"]);
    expect(frightened(state)).toBe(true);
    expect(state.log.filter((entry) => entry.type === "AttackRolled")).toHaveLength(2);
  });

  it("is skipped when everyone in range has already saved against it", () => {
    const state = createEngineState(scene(60));
    resolveAreaSaveAction(state, "dragon", { x: 5, y: 4 }, "presence");
    fresh(state);
    state.log.length = 0;
    resolveMultiattackAction(state, "dragon", "hero", "multiattack");
    expect(state.log.filter((entry) => entry.type === "ActionDeclared").map((entry) => entry.data?.actionName)).toEqual(["Multiattack"]);
    expect(state.log.filter((entry) => entry.type === "AttackRolled")).toHaveLength(2);
  });

  it("is skipped when the target is already frightened by it", () => {
    const state = createEngineState(scene(-30));
    resolveMultiattackAction(state, "dragon", "hero", "multiattack");
    fresh(state);
    state.log.length = 0;
    resolveMultiattackAction(state, "dragon", "hero", "multiattack");
    expect(state.log.filter((entry) => entry.type === "ActionDeclared").map((entry) => entry.data?.actionName)).toEqual(["Multiattack"]);
  });
});

describe("SRD data", () => {
  const chunkDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
  const monsters = readdirSync(chunkDir).flatMap((file) => (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions);
  const byName = (name: string) => monsters.find((monster) => monster.name === name)!;

  it("dragons open their multiattack with Frightful Presence, which grants immunity", () => {
    for (const name of ["Adult Red Dragon", "Ancient Silver Dragon", "Tarrasque"]) {
      const monster = byName(name);
      const multi = monster.actions.find((action) => action.kind === "multiattack") as { attacks: Array<{ actionId: string }> };
      expect(multi.attacks[0]!.actionId, name).toBe("frightful-presence");
      const presenceAction = monster.actions.find((action) => action.id === "frightful-presence") as { immuneAfterSave?: boolean };
      expect(presenceAction.immuneAfterSave, name).toBe(true);
    }
  });

  it("mummies open with Dreadful Glare", () => {
    const multi = byName("Mummy").actions.find((action) => action.kind === "multiattack") as { attacks: Array<{ actionId: string }> };
    expect(multi.attacks[0]!.actionId).toBe("dreadful-glare");
  });
});
