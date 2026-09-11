import { describe, expect, it } from "vitest";
import { createEngineState, getExecutableActions, resolveAttack, resolveSaveDc, sampleEncounter } from "@/engine";
import type { AttackActionDefinition, CreatureDefinition, EncounterSnapshot, SaveActionDefinition, WeaponDefinition } from "@/engine";

function creatureWith(...weapons: WeaponDefinition[]): CreatureDefinition {
  return {
    id: "def-focus",
    name: "Focus Tester",
    size: "medium",
    armorClass: 15,
    maxHp: 30,
    speed: 30,
    proficiencyBonus: 2,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    actions: [],
    weapons
  };
}

function attacks(definition: CreatureDefinition): AttackActionDefinition[] {
  return getExecutableActions(definition).filter((a): a is AttackActionDefinition => a.kind === "attack");
}

const dagger: WeaponDefinition = {
  id: "dagger", name: "Dagger", attackType: "melee", ability: "str", range: 5, reach: 5,
  damage: [{ dice: "1d4", damageType: "piercing", abilityModifier: "str" }],
  usableAs: ["action"]
};

describe("focus-kind weapons", () => {
  it("compiles no attack of its own", () => {
    const focus: WeaponDefinition = {
      id: "wand", name: "Wand of Fire", attackType: "focus", ability: "int", range: 0, damage: [],
      charges: { id: "charge", max: 3, recharge: "dawn" }
    };
    expect(attacks(creatureWith(focus))).toHaveLength(0);
  });

  it("compiles its grantedActions into the executable action list", () => {
    const focus: WeaponDefinition = {
      id: "wand", name: "Wand of Fire", attackType: "focus", ability: "int", range: 0, damage: [],
      charges: { id: "charge", max: 3, recharge: "dawn" },
      grantedActions: [
        {
          kind: "attack", id: "wand-firebolt", name: "Firebolt", actionType: "action", attackType: "spell",
          ability: "int", range: 120, damage: [{ dice: "1d10", damageType: "fire" }], automationSupport: "full"
        },
        {
          kind: "attack", id: "wand-fireball", name: "Fireball", actionType: "action", attackType: "spell",
          ability: "int", range: 120, damage: [{ dice: "8d6", damageType: "fire" }],
          resourceCost: { resourceId: "charge", amount: 3 }, automationSupport: "full"
        }
      ]
    };
    const ids = getExecutableActions(creatureWith(focus)).map((a) => a.id);
    expect(ids).toContain("wand-firebolt");
    expect(ids).toContain("wand-fireball");
  });

  it("a weapon can grant actions alongside its own attack", () => {
    const sword: WeaponDefinition = {
      ...dagger,
      id: "flame-tongue",
      charges: { id: "charge", max: 2, recharge: "dawn" },
      grantedActions: [{
        kind: "attack", id: "flame-tongue-burst", name: "Fire Burst", actionType: "action", attackType: "spell",
        ability: "int", range: 30, damage: [{ dice: "2d6", damageType: "fire" }],
        resourceCost: { resourceId: "charge", amount: 1 }, automationSupport: "full"
      }]
    };
    const ids = getExecutableActions(creatureWith(sword)).map((a) => a.id);
    expect(ids).toContain("weapon:flame-tongue");
    expect(ids).toContain("flame-tongue-burst");
  });
});

describe("optional-activation on-hit riders", () => {
  it("compiles a plain attack plus a separate 'spend charge' candidate", () => {
    const sword: WeaponDefinition = {
      ...dagger,
      id: "frost-dagger",
      charges: { id: "charge", max: 3, recharge: "dawn" },
      onHit: [{
        id: "frost-rider", kind: "damage", when: "on-hit", components: [{ dice: "1d6", damageType: "cold" }],
        resourceCost: { resourceId: "charge", amount: 1 }, activation: "optional"
      }]
    };
    const compiled = attacks(creatureWith(sword));
    const plain = compiled.find((a) => a.id === "weapon:frost-dagger");
    const charged = compiled.find((a) => a.id === "weapon:frost-dagger:charged");
    expect(plain?.riders ?? []).toHaveLength(0);
    expect(charged).toBeDefined();
    expect(charged?.resourceCost).toEqual({ resourceId: "charge", amount: 1 });
    expect(charged?.riders).toHaveLength(1);
  });

  it("an 'always' activation rider stays folded into the single compiled attack", () => {
    const sword: WeaponDefinition = {
      ...dagger,
      id: "fear-dagger",
      onHit: [{
        id: "fear-rider", kind: "condition", when: "on-hit", condition: "frightened",
        duration: { kind: "rounds", rounds: 1 }, resourceCost: { resourceId: "charge", amount: 1 }
      }]
    };
    const compiled = attacks(creatureWith(sword));
    expect(compiled).toHaveLength(1);
    expect(compiled[0]?.riders).toHaveLength(1);
    expect(compiled[0]?.resourceCost).toBeUndefined();
  });
});

describe("weapon-granted passive effects", () => {
  function baseEncounter(seed: string): EncounterSnapshot {
    const encounter = structuredClone(sampleEncounter);
    encounter.seed = seed;
    encounter.map.walls = [];
    return encounter;
  }

  it("a focus's attack-bonus effect (scoped to spell attacks) applies to its own granted spell", () => {
    const encounter = baseEncounter("focus-attack-bonus");
    const casterDef = encounter.definitions.find((d) => d.id === "def-fighter")!;
    casterDef.weapons = [{
      id: "wand", name: "Wand", attackType: "focus", ability: "int", range: 0, damage: [],
      effects: [{ kind: "attack-bonus", bonus: { base: 5 }, attackTypes: ["spell"] }],
      grantedActions: [{
        kind: "attack", id: "wand-bolt", name: "Bolt", actionType: "action", attackType: "spell",
        ability: "int", range: 60, damage: [{ dice: "1d10", damageType: "force" }], automationSupport: "full"
      }]
    }];
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 1, y: 0 };
    const state = createEngineState(encounter);
    const result = resolveAttack(state, "pc-fighter", "enemy-goblin-1", "wand-bolt");
    const rolled = state.log.find((e) => e.type === "AttackRolled");
    expect(result).toBeDefined();
    expect((rolled?.data?.appliedAttackEffects as string[] | undefined) ?? []).toContain("Wand");
  });

  it("a focus's spells-only save-dc-bonus effect raises a spell's save DC but not a non-spell save", () => {
    const encounter = baseEncounter("focus-save-dc-bonus");
    const casterDef = encounter.definitions.find((d) => d.id === "def-fighter")!;
    casterDef.weapons = [{
      id: "amulet", name: "Amulet of Spellcasting", attackType: "focus", ability: "int", range: 0, damage: [],
      effects: [{ kind: "save-dc-bonus", bonus: { base: 3 }, spellsOnly: true }]
    }];

    const spellSave: SaveActionDefinition = {
      kind: "save", id: "spell-save", name: "Hold Person", actionType: "action", saveAbility: "wis",
      dc: 13, range: 60, spellLevel: 2, damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
      automationSupport: "full"
    };
    const nonSpellSave: SaveActionDefinition = {
      kind: "save", id: "breath-save", name: "Breath Weapon", actionType: "action", saveAbility: "dex",
      dc: 13, range: 30, damage: [{ dice: "2d6", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half",
      automationSupport: "full"
    };

    expect(resolveSaveDc(spellSave, casterDef)).toBe(16);
    expect(resolveSaveDc(nonSpellSave, casterDef)).toBe(13);
  });
});
