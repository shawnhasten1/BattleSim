import { beforeAll, describe, expect, it } from "vitest";
import { normalizeActionDefinition, type ActionDefinition, type CreatureDefinition, type SpellDefinition } from "@/engine";
import { findSrdFeature, findSrdSpell, findSrdWeapon } from "@/data/srd";
import { loadSrdMonster } from "@/data/srd/monsters";
import { conversionTargets, convertAction } from "@/lib/ability-editor/conversions";
import { findAbility, type AbilityRef } from "@/lib/ability-editor/refs";
import { sectionsFor, type SectionId } from "@/lib/ability-editor/sections";
import { abilityWarnings } from "@/lib/ability-editor/validate";

/** The ability editor's model: which sections an ability gets, switching its kind, and the warnings under the preview. */

let dragon: CreatureDefinition;
let wolf: CreatureDefinition;
beforeAll(async () => {
  dragon = (await loadSrdMonster("srd:monster:adult-red-dragon"))!;
  wolf = (await loadSrdMonster("srd:monster:wolf"))!;
});

const summaries = (definition: CreatureDefinition, ref: AbilityRef) =>
  Object.fromEntries(sectionsFor({ ref, record: findAbility(definition, ref)!, definition }).map((section) => [section.id, section.summary])) as Partial<Record<SectionId, string>>;
const refNamed = (definition: CreatureDefinition, name: string): AbilityRef => {
  const action = [...definition.actions, ...(definition.bonusActions ?? []), ...(definition.reactions ?? [])].find((candidate) => candidate.name === name)!;
  return { list: action.actionType === "bonus" ? "bonusActions" : action.actionType === "reaction" ? "reactions" : "actions", id: action.id };
};

describe("sections", () => {
  it("gives an area save its use, target, roll, damage and lingering area, with statblock summaries", () => {
    expect(summaries(dragon, refNamed(dragon, "Fire Breath"))).toEqual({
      basics: "Fire Breath · area",
      use: "Action · Recharge 5–6",
      target: "60-ft cone · everyone in it",
      roll: "Dexterity save · DC 21 (as printed) · half on a success",
      damage: "63 (18d6) fire",
      effects: "none",
      lingering: "off",
      notes: "simulated"
    });
  });

  it("gives a multiattack its sequence, and no target or roll", () => {
    const sections = summaries(dragon, refNamed(dragon, "Multiattack"));
    expect(sections.sequence).toBe("Frightful Presence, Bite, 2 × Claw");
    expect(sections).not.toHaveProperty("target");
    expect(sections).not.toHaveProperty("roll");
  });

  it("leaves Use & cost off a passive trait, and on an activated feature", () => {
    const pack = wolf.traits!.find((trait) => trait.name === "Pack Tactics")!;
    const packSections = summaries(wolf, { list: "traits", id: pack.id });
    expect(packSections).not.toHaveProperty("use");
    expect(packSections["while-active"]).toBe("advantage on attacks with an ally next to the target");

    const rage = findSrdFeature("srd:feature:rage")!;
    const barbarian: CreatureDefinition = { ...wolf, features: [rage], resources: { rage: 3 } };
    const rageSections = summaries(barbarian, { list: "features", id: rage.id });
    expect(rageSections.use).toBe("Bonus action · 1 rage");
    expect(rageSections["while-active"]).toContain("resists bludgeoning, piercing, and slashing");
  });

  it("shows a weapon's roll, damage, effects and what it grants", () => {
    const sword = findSrdWeapon("srd:weapon:fear-sword")!;
    const knight: CreatureDefinition = { ...wolf, weapons: [sword] };
    const sections = summaries(knight, { list: "weapons", id: sword.id });
    expect(sections.effects).toContain("frightened");
    expect(sections.grants).toBe("1 charge");
    expect(sections).toHaveProperty("roll");
  });

  it("counts reference text on attacks and weapons, and a note as partly simulated", () => {
    const bite = wolf.actions.find((action) => action.name === "Bite")!;
    const noted = { ...bite, description: "A savage bite.", riders: [{ kind: "note" as const, text: "It drags the target." }] } as ActionDefinition;
    const creature = { ...wolf, actions: [noted] };
    expect(summaries(creature, { list: "actions", id: bite.id }).notes).toBe("reference text · partly simulated");
  });

  it("counts a legendary action that borrows an action as simulated", () => {
    const tail = dragon.legendary!.actions.findIndex((entry) => entry.name === "Tail Attack");
    expect(summaries(dragon, { list: "legendary", index: tail }).notes).toBe("reference text · simulated");
  });
});

describe("conversions", () => {
  type Attack = Extract<ActionDefinition, { kind: "attack" }>;
  const bite = (): Attack => structuredClone(wolf.actions.find((action) => action.name === "Bite")) as Attack;

  it("turns an attack into a save, a hit's effects into a failed save's, keeping name, damage and range", () => {
    const { action, parked } = convertAction(bite(), "save");
    expect(action).toMatchObject({ kind: "save", name: "Bite", range: 5, damage: bite().damage, saveAbility: "dex" });
    expect(action).not.toHaveProperty("attackType");
    expect(action.kind === "save" && action.riders?.[0]?.kind !== "note" && action.riders?.[0]?.when).toBe("on-save-fail");
    expect(parked.attack).toEqual(bite());
  });

  it("brings back the old values when switching back, with shared edits kept", () => {
    const first = convertAction(bite(), "save");
    const renamed = { ...first.action, name: "Savage Bite" };
    const back = convertAction(renamed, "attack", first.parked);
    expect(back.action).toEqual({ ...bite(), name: "Savage Bite" });
  });

  it("keeps the save when a single target becomes an area, and the area when it goes back", () => {
    const frightful = structuredClone(dragon.actions.find((action) => action.name === "Frightful Presence")!);
    const single = convertAction(frightful, "save");
    expect(single.action).toMatchObject({ kind: "save", saveAbility: "wis", dc: 19 });
    const area = convertAction(single.action, "area-save", single.parked);
    expect(area.action).toEqual(frightful);
  });

  it("parks a recharge a kind can't carry, and restores it", () => {
    const breath = structuredClone(dragon.actions.find((action) => action.name === "Fire Breath")!);
    const buff = convertAction(breath, "buff");
    expect(buff.action).not.toHaveProperty("usage");
    expect(buff.action).not.toHaveProperty("resourceCost");
    expect(convertAction(buff.action, "area-save", buff.parked).action).toEqual(breath);
  });

  it("restores effects the kind in between couldn't hold", () => {
    const heal = convertAction(bite(), "healing");
    expect(heal.action).not.toHaveProperty("riders");
    expect(convertAction(heal.action, "attack", heal.parked).action).toEqual(bite());
  });

  it("makes records the normalizer accepts as the new kind", () => {
    for (const to of conversionTargets(bite())) {
      const { action } = convertAction(bite(), to);
      expect(normalizeActionDefinition(action, "action").kind).toBe(to);
    }
  });

  it("doesn't convert summons, multiattacks and the like", () => {
    expect(conversionTargets(dragon.actions.find((action) => action.kind === "multiattack")!)).toEqual([]);
  });
});

describe("warnings", () => {
  const creature = (overrides: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
    id: "c", name: "C", size: "medium", armorClass: 14, maxHp: 30, speed: 30, proficiencyBonus: 2,
    abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, actions: [], ...overrides
  });
  const strike: ActionDefinition = {
    kind: "attack", id: "strike", name: "Strike", actionType: "action", attackType: "melee", ability: "str", range: 5, reach: 5,
    damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }], automationSupport: "full"
  };
  const ids = (definition: CreatureDefinition, where: Parameters<typeof abilityWarnings>[1], record: Parameters<typeof abilityWarnings>[2]) =>
    abilityWarnings(definition, where, record).map((warning) => warning.id);

  it("says nothing about an ordinary attack", () => {
    expect(ids(creature(), "actions", strike)).toEqual([]);
  });

  it("warns about a leveled spell that costs nothing, on a creature with slots", () => {
    const fireball = findSrdSpell("srd:spell:fireball")!;
    const free: SpellDefinition = { ...fireball, action: { ...fireball.action!, resourceCost: undefined } as ActionDefinition };
    expect(ids(creature({ resources: { "slot-3": 2 } }), "spells", free)).toContain("free-leveled-spell");
    expect(ids(creature({ resources: { "slot-3": 2 } }), "spells", fireball)).not.toContain("free-leveled-spell");
  });

  it("warns about a pool the creature doesn't have", () => {
    const warnings = abilityWarnings(creature(), "actions", { ...strike, resourceCost: { resourceId: "ki", amount: 1 } });
    expect(warnings.find((warning) => warning.id === "missing-pool")?.message).toBe("Never usable: this creature has no ki.");
    // A higher slot will do for a spell that upcasts.
    expect(ids(creature({ resources: { "slot-4": 1 } }), "spells", findSrdSpell("srd:spell:fireball")!)).not.toContain("missing-pool");
  });

  it("warns about damage adding a different ability than a calculated roll", () => {
    const mismatched = { ...strike, damage: [{ dice: "1d8", damageType: "slashing" as const, abilityModifier: "int" as const }] };
    expect(abilityWarnings(creature(), "actions", mismatched).map((warning) => warning.message)).toContain("The damage adds INT on a STR attack.");
    expect(ids(creature(), "actions", { ...mismatched, attackBonus: 5 })).not.toContain("damage-ability-mismatch");
  });

  it("warns about a lingering area with no triggers", () => {
    const web = findSrdSpell("srd:spell:web")!;
    const action = web.action as Extract<ActionDefinition, { kind: "area-save" }>;
    const inert: SpellDefinition = { ...web, action: { ...action, zone: { ...(action.zone ?? web.zone!), trigger: [], applyOnCast: false, movementDamage: undefined } } };
    expect(ids(creature({ resources: { "slot-2": 1 } }), "spells", inert)).toContain("inert-lingering-area");
  });

  it("warns about a reaction that never fires on its own, once", () => {
    const riposte: ActionDefinition = { ...strike, actionType: "reaction", reaction: { trigger: { kind: "manual", note: "A creature misses it" } } };
    expect(ids(creature(), "reactions", riposte)).toEqual(["manual-reaction"]);
  });

  it("says what a partly simulated ability leaves out, and when one is reference only", () => {
    const noted: ActionDefinition = { ...strike, riders: [{ kind: "note", text: "The target's armor corrodes." }] };
    expect(abilityWarnings(creature(), "actions", noted).find((warning) => warning.id === "partly-simulated")?.message).toContain("The target's armor corrodes.");
    expect(ids(creature(), "actions", { kind: "unsupported", id: "u", name: "Change Shape", actionType: "action", automationSupport: "unsupported" })).toEqual(["reference-only"]);
  });

  it("warns about a multiattack step whose ability is gone", () => {
    const multi: ActionDefinition = { kind: "multiattack", id: "m", name: "Multiattack", actionType: "action", attacks: [{ actionId: "strike", count: 2 }, { actionId: "gone", count: 1 }], automationSupport: "full" };
    expect(ids(creature({ actions: [strike] }), "actions", multi)).toEqual(["missing-step"]);
  });
});
