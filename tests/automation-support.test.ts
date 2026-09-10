import { describe, expect, it } from "vitest";
import { effectiveAutomationSupport, getExecutableActions, type ActionDefinition, type CreatureDefinition } from "@/engine";
import { spellAutomation, weaponAutomation } from "@/lib/sheet";
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

describe("lib/sheet automation helpers", () => {
  it("weaponAutomation flags a note / custom on-hit rider", () => {
    expect(weaponAutomation({ id: "w", name: "Sword", attackType: "melee", ability: "str", range: 5, damage: [{ dice: "1d8", damageType: "slashing" }] })).toBe("full");
    expect(weaponAutomation({
      id: "w2", name: "Net", attackType: "ranged", ability: "dex", range: 5,
      damage: [{ dice: "0", damageType: "bludgeoning" }],
      onHit: [{ kind: "note", text: "restrained" }]
    })).toBe("partial");
  });

  it("spellAutomation downgrades Faerie Fire (note rider) and keeps Fireball full", () => {
    expect(spellAutomation(findSrdSpell("srd:spell:faerie-fire")!)).toBe("partial");
    expect(spellAutomation(findSrdSpell("srd:spell:fireball")!)).toBe("full");
    expect(spellAutomation(findSrdSpell("srd:spell:counterspell")!)).toBe("full");
  });
});
