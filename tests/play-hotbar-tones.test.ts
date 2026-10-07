import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sampleEncounter, withItemPool, type CreatureDefinition, type EncounterSnapshot, type ItemDefinition } from "@/engine";
import { findSrdItem, findSrdSpell } from "@/data/srd";
import { HOTBAR_TONES, hotbarFor, type HotbarModel } from "@/lib/play/hotbar";

/** HOTBAR_REDESIGN_PLAN.md §2: the colour each hotbar button takes, and a style for every one. */

const SPELLS = ["fire-bolt", "fireball", "hold-person", "cure-wounds", "spiritual-weapon", "moonbeam", "mage-armor", "spike-growth"];

/** The sample fighter with these spells, a wand of web, a healing potion, and the slots and charges to use them. */
function board(): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")! as CreatureDefinition;
  fighter.spells = SPELLS.map((id) => structuredClone(findSrdSpell(`srd:spell:${id}`)!));
  const potion: ItemDefinition = {
    id: "potions", name: "Potion of Healing", type: "potion", supply: { id: "item:potions", size: 2, unit: "count" },
    grantedActions: [{
      kind: "healing", id: "drink", name: "Potion of Healing", actionType: "action", range: 0, healing: [{ dice: "2d4+2" }],
      targeting: { target: "self" }, resourceCost: { resourceId: "item:potions", amount: 1 }, automationSupport: "full"
    }],
    automationSupport: "full"
  };
  fighter.items = [withItemPool(structuredClone(findSrdItem("srd:item:wand-of-web")!) as ItemDefinition, "wand"), potion];
  const resources = { "slot-1": 4, "slot-2": 3, "slot-3": 2, "item:potions": 2, "item:wand": 7 };
  fighter.resources = { ...fighter.resources, ...resources };
  const token = encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;
  token.resources = { ...token.resources, ...resources };
  return encounter;
}

const tones = (model: HotbarModel) => Object.fromEntries(model.tabs.flatMap((tab) => tab.buttons).map((button) => [button.name, button.tone]));

describe("a hotbar button's colour", () => {
  it("says what it is; a spell takes its damage type, else healing, else its school", () => {
    expect(tones(hotbarFor(board(), "pc-fighter"))).toMatchObject({
      // Spells: the damage they deal (a zone's own damage for one that leaves it), healing, or their school.
      "Fire Bolt": "fire",
      Fireball: "fire",
      Moonbeam: "radiant",
      "Spiritual Weapon": "force",
      "Spike Growth": "physical",
      "Cure Wounds": "healing",
      "Hold Person": "enchantment",
      "Mage Armor": "abjuration",
      // The rest: what group they're in, whatever damage a weapon deals; an item's spell is an item.
      Longsword: "attacks",
      "Web (Wand of Web)": "items",
      "Potion of Healing": "items",
      "Second Wind": "features",
      "Action Surge": "features",
      Dash: "common"
    });
  });

  it("groups a spell used by hand with the spells, at its level and in its school's colour", () => {
    const encounter = board();
    const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")! as CreatureDefinition;
    // The engine doesn't run Hex: its action is reference text, with no level or school stamped on it.
    fighter.spells = [...(fighter.spells ?? []), {
      id: "hex", name: "Hex", level: 1, school: "enchantment", castingTime: "bonus", range: 90, concentration: true,
      action: { kind: "unsupported", id: "hex-action", name: "Hex", actionType: "bonus", description: "Curse a creature.", automationSupport: "unsupported" },
      automationSupport: "manual-only"
    } as never];
    const hex = hotbarFor(encounter, "pc-fighter").tabs.flatMap((tab) => tab.buttons).find((button) => button.name === "Hex")!;
    expect(hex).toMatchObject({ tab: "bonus", group: "spells", tone: "enchantment", spellLevel: 1, automation: "by-hand" });
  });

  it("has a style for every colour it can take", () => {
    const css = readFileSync("src/components/play/play.module.css", "utf8");
    for (const tone of HOTBAR_TONES) expect(css, tone).toContain(`[data-tone="${tone}"]`);
  });
});
