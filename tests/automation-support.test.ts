import { describe, expect, it } from "vitest";
import { effectiveAutomationSupport, getExecutableActions, type ActionDefinition, type CreatureDefinition } from "@/engine";
import { findSrdSpell } from "@/data/srd";

const baseSave: Extract<ActionDefinition, { kind: "save" }> = {
  kind: "save", id: "s", name: "Hex Bolt", actionType: "action", saveAbility: "wis",
  dc: 13, range: 60, damage: [{ dice: "2d6", damageType: "necrotic" }],
  halfDamageOnSuccess: false, onSuccess: "none", automationSupport: "full"
};

describe("effectiveAutomationSupport", () => {
  it("stays full for a plain action or supported condition rider", () => {
    expect(effectiveAutomationSupport(baseSave)).toBe("full");
    expect(effectiveAutomationSupport({
      ...baseSave,
      riders: [{ kind: "condition", when: "on-save-fail", condition: "frightened", duration: { kind: "rounds", rounds: 2 } }]
    })).toBe("full");
  });

  it("drops to partial for a note rider or a custom condition", () => {
    expect(effectiveAutomationSupport({ ...baseSave, riders: [{ kind: "note", text: "manual" }] })).toBe("partial");
    expect(effectiveAutomationSupport({
      ...baseSave,
      riders: [{ kind: "condition", when: "on-save-fail", condition: { custom: "hexed" }, duration: { kind: "permanent" } }]
    })).toBe("partial");
  });

  it("never raises an authored level", () => {
    expect(effectiveAutomationSupport({ ...baseSave, automationSupport: "manual-only" })).toBe("manual-only");
  });

  it("getExecutableActions reflects the effective level", () => {
    const definition: CreatureDefinition = {
      id: "d", name: "Caster", size: "medium", armorClass: 12, maxHp: 20, speed: 30,
      abilities: { str: 10, dex: 10, con: 10, int: 14, wis: 10, cha: 10 },
      actions: [{ ...baseSave, id: "noted", riders: [{ kind: "note", text: "x" }] }, { ...baseSave, id: "clean" }]
    };
    const actions = getExecutableActions(definition);
    expect(actions.find((a) => a.id === "noted")?.automationSupport).toBe("partial");
    expect(actions.find((a) => a.id === "clean")?.automationSupport).toBe("full");
  });
});

describe("weapons and spells, as the engine compiles them", () => {
  it("a weapon with a note on-hit rider is partly simulated; a plain one runs in full", () => {
    const definition: CreatureDefinition = {
      id: "d", name: "Netter", size: "medium", armorClass: 12, maxHp: 20, speed: 30,
      abilities: { str: 10, dex: 12, con: 10, int: 10, wis: 10, cha: 10 },
      actions: [],
      weapons: [
        { id: "sword", name: "Sword", attackType: "melee", ability: "str", range: 5, damage: [{ dice: "1d8", damageType: "slashing" }] },
        {
          id: "net", name: "Net", attackType: "ranged", ability: "dex", range: 5,
          damage: [{ dice: "0", damageType: "bludgeoning" }],
          onHit: [{ kind: "note", text: "restrained" }]
        }
      ]
    };
    const actions = getExecutableActions(definition);
    expect(actions.find((action) => action.name === "Sword")?.automationSupport).toBe("full");
    expect(actions.find((action) => action.name === "Net")?.automationSupport).toBe("partial");
  });

  it("Faerie Fire's note rider makes it partly simulated; Fireball and Counterspell run in full", () => {
    expect(effectiveAutomationSupport(findSrdSpell("srd:spell:faerie-fire")!.action!)).toBe("partial");
    expect(effectiveAutomationSupport(findSrdSpell("srd:spell:fireball")!.action!)).toBe("full");
    expect(effectiveAutomationSupport(findSrdSpell("srd:spell:counterspell")!.action!)).toBe("full");
  });
});
