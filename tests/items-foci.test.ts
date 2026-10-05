import { beforeEach, describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  migrateDefinition,
  resolveAttack,
  resolveSaveDc,
  runAutomatedEncounter,
  sampleEncounter,
  type ActionDefinition,
  type CreatureDefinition,
  type EncounterSnapshot,
  type ItemDefinition,
  type SaveActionDefinition,
  type WeaponDefinition
} from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * ITEMS_PLAN.md §8, Phase 6: a focus or a wand was a weapon with no attack of its own; it's an item now. A saved creature
 * that has one carries it as a wand, its id, its pool's id and its uses' ids kept, so it plays the same.
 */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
const store = () => useEncounterStore.getState();

const BOLT: ActionDefinition = {
  kind: "attack", id: "wand-granted-1", name: "Fire Bolt", actionType: "action", attackType: "spell", ability: "int", attackBonus: 7,
  range: 120, damage: [{ dice: "4d10", damageType: "fire" }], resourceCost: { resourceId: "wand:charge", amount: 1 }, automationSupport: "full"
};

/** A focus as an attached one is saved: its pool namespaced to it (`wand:charge`), its use's id minted from it. */
const FOCUS: WeaponDefinition = {
  id: "wand", name: "Wand of Fire", description: "A wand of red wood.", attackType: "focus", ability: "int", range: 0, damage: [], magical: true,
  charges: { id: "wand:charge", max: 3, recharge: { dice: "1d3" } },
  grantedActions: [BOLT],
  effects: [{ kind: "attack-bonus", bonus: { base: 1 }, attackTypes: ["spell"] }]
};

function caster(weapons: WeaponDefinition[], items?: ItemDefinition[]): CreatureDefinition {
  return {
    id: "def-caster", name: "Caster", size: "medium", armorClass: 12, maxHp: 30, speed: 30, proficiencyBonus: 2,
    abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 }, actions: [], weapons, ...(items ? { items } : {}),
    resources: { "wand:charge": 3 }
  };
}

describe("a focus weapon, brought up to date", () => {
  it("is a wand: its charges its supply, its granted actions its uses, its effects what it gives while carried, its ids kept", () => {
    const dagger: WeaponDefinition = { id: "dagger", name: "Dagger", attackType: "melee", ability: "dex", range: 5, reach: 5, damage: [{ dice: "1d4", damageType: "piercing" }] };
    const migrated = migrateDefinition(caster([dagger, FOCUS]));
    expect(migrated.weapons?.map((weapon) => weapon.id)).toEqual(["dagger"]);
    expect(migrated.items).toEqual([{
      id: "wand", name: "Wand of Fire", description: "A wand of red wood.", type: "wand", magical: true,
      supply: { id: "wand:charge", size: 3, unit: "charges", regains: { dice: "1d3" } },
      grantedActions: [BOLT],
      effects: FOCUS.effects,
      automationSupport: "full"
    }]);
    expect(migrated.resources).toEqual({ "wand:charge": 3 });
    // Already current: the same object.
    expect(migrateDefinition(migrated)).toBe(migrated);
  });

  it("compiles the same uses under the same ids, now an item's", () => {
    const before = getExecutableActions(caster([FOCUS])).map((action) => action.id);
    const after = getExecutableActions(migrateDefinition(caster([FOCUS])));
    expect(after.map((action) => action.id)).toEqual(before);
    expect(after.find((action) => action.id === "wand-granted-1")?.item).toMatchObject({ id: "wand", type: "wand", consumes: false });
  });

  it("plays the same: the same seed rolls the same fight", () => {
    const encounter = structuredClone(sampleEncounter);
    encounter.seed = "foci";
    encounter.map.walls = [];
    const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
    fighter.weapons = [FOCUS];
    fighter.resources = { ...fighter.resources, "wand:charge": 3 };
    encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources = { "wand:charge": 3 };
    const migrated: EncounterSnapshot = { ...encounter, definitions: encounter.definitions.map(migrateDefinition) };
    const outcome = (snapshot: EncounterSnapshot) => {
      const result = runAutomatedEncounter(structuredClone(snapshot), 20);
      // What happened, not how the log words a declaration (an item's use says which item it is).
      const events = result.log.filter((entry) => entry.type !== "ActionDeclared" && entry.type !== "AiDecision")
        .map((entry) => [entry.type, entry.data?.attackRoll, entry.data?.total, entry.data?.amount, entry.data?.targetId]);
      const bolts = result.log.filter((entry) => entry.type === "ActionDeclared" && entry.data?.actionId === "wand-granted-1").length;
      return { events, outcome: result.outcome, bolts };
    };
    const old = outcome(encounter);
    const now = outcome(migrated);
    expect(now.outcome).toEqual(old.outcome);
    expect(now.events).toEqual(old.events);
    // The wand was used, as it was when it was a weapon.
    expect(old.bolts).toBeGreaterThan(0);
    expect(now.bolts).toBe(old.bolts);
  });
});

describe("in the store", () => {
  it("a saved encounter with a focus opens with it under Items, every token's count kept; an edit keeps its pool", () => {
    const encounter = structuredClone(sampleEncounter);
    const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
    fighter.weapons = [FOCUS];
    fighter.resources = { ...fighter.resources, "wand:charge": 3 };
    encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources = { "wand:charge": 1 };
    store().replaceEncounter(encounter);
    const loaded = () => store().encounter.definitions.find((definition) => definition.id === "def-fighter")!;
    expect(loaded().weapons ?? []).toEqual([]);
    expect(loaded().items?.[0]).toMatchObject({ id: "wand", type: "wand", supply: { id: "wand:charge", size: 3 } });
    expect(store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources?.["wand:charge"]).toBe(1);

    // Renamed in the editor, its pool and the token's count stay as they are.
    store().replaceAbilityRecord("def-fighter", { list: "items", id: "wand" }, { ...loaded().items![0]!, name: "Wand of Flame" });
    expect(loaded().items?.[0]).toMatchObject({ name: "Wand of Flame", supply: { id: "wand:charge" } });
    expect(store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources?.["wand:charge"]).toBe(1);
  });
});

describe("what a wand gives while carried (what a focus weapon's effects did)", () => {
  function baseEncounter(seed: string, item: ItemDefinition): EncounterSnapshot {
    const encounter = structuredClone(sampleEncounter);
    encounter.seed = seed;
    encounter.map.walls = [];
    encounter.definitions.find((definition) => definition.id === "def-fighter")!.items = [item];
    return encounter;
  }

  it("an attack bonus scoped to spell attacks applies to its own granted spell", () => {
    const encounter = baseEncounter("wand-attack-bonus", {
      id: "wand", name: "Wand", type: "wand",
      effects: [{ kind: "attack-bonus", bonus: { base: 5 }, attackTypes: ["spell"] }],
      grantedActions: [{
        kind: "attack", id: "wand-bolt", name: "Bolt", actionType: "action", attackType: "spell",
        ability: "int", range: 60, damage: [{ dice: "1d10", damageType: "force" }], automationSupport: "full"
      }],
      automationSupport: "full"
    });
    encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!.position = { x: 1, y: 0 };
    const state = createEngineState(encounter);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "wand-bolt");
    const rolled = state.log.find((entry) => entry.type === "AttackRolled");
    expect((rolled?.data?.appliedAttackEffects as string[] | undefined) ?? []).toContain("Wand");
  });

  it("a spells-only save DC bonus raises a spell's DC but not a breath's", () => {
    const encounter = baseEncounter("wand-save-dc-bonus", {
      id: "amulet", name: "Amulet of Spellcasting", type: "worn", effects: [{ kind: "save-dc-bonus", bonus: { base: 3 }, spellsOnly: true }], automationSupport: "full"
    });
    const definition = encounter.definitions.find((candidate) => candidate.id === "def-fighter")!;
    const spellSave: SaveActionDefinition = {
      kind: "save", id: "spell-save", name: "Hold Person", actionType: "action", saveAbility: "wis",
      dc: 13, range: 60, spellLevel: 2, damage: [], halfDamageOnSuccess: false, onSuccess: "negates", automationSupport: "full"
    };
    const breath: SaveActionDefinition = {
      kind: "save", id: "breath-save", name: "Breath Weapon", actionType: "action", saveAbility: "dex",
      dc: 13, range: 30, damage: [{ dice: "2d6", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half", automationSupport: "full"
    };
    expect(resolveSaveDc(spellSave, definition)).toBe(16);
    expect(resolveSaveDc(breath, definition)).toBe(13);
  });
});
