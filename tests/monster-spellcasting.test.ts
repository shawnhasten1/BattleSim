import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngineState, getExecutableActions, runAutomatedEncounter, sampleEncounter, takeAutomatedTurn, type CombatantState, type CreatureDefinition, type EncounterSnapshot } from "@/engine";
import { parseSpellcasting } from "../scripts/srd-monsters/spellcasting";

/** Monsters cast the spells the library can run, with the statblock's own DC, attack bonus and slots. */
const chunkDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
const monsters = readdirSync(chunkDir).flatMap((file) => (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions);
const of = (name: string) => monsters.find((monster) => monster.name === name)!;
const spell = (monster: string, name: string) => of(monster).spells!.find((entry) => entry.name === name)!;
const entry = (name: string, desc: string) => ({ name, desc } as never);

describe("parsing a spellcasting trait", () => {
  const mage = parseSpellcasting(entry("Spellcasting", "The mage is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 14, +6 to hit with spell attacks). The mage has the following wizard spells prepared:\n\n* Cantrips (at will): fire bolt, light, mage hand\n* 1st level (4 slots): detect magic, magic missile, shield\n* 3rd level (3 slots): counterspell, fireball, fly"), "mage");

  it("reads level, slots, and separates modelled, utility and missing spells", () => {
    expect(mage.level).toBe(9);
    expect(mage.resources).toEqual({ "slot-1": 4, "slot-3": 3 });
    expect(mage.modelled).toEqual(["fire bolt", "magic missile", "shield", "counterspell", "fireball", "fly"]);
    expect(mage.utility).toEqual(["light", "mage hand", "detect magic"]);
    expect(mage.missing).toEqual([]);
  });

  it("uses the statblock's DC and attack bonus, not the formula", () => {
    const fireball = mage.spells.find((entry) => entry.name === "Fireball")!.action as { dc?: number; dcFormula?: unknown };
    expect(fireball.dc).toBe(14);
    expect(fireball.dcFormula).toBeUndefined();
    const bolt = mage.spells.find((entry) => entry.name === "Fire Bolt")!.action as { attackBonus?: number; attackBonusFormula?: unknown };
    expect(bolt.attackBonus).toBe(6);
    expect(bolt.attackBonusFormula).toBeUndefined();
  });

  it("slot spells cost their slot, cantrips and at-will spells nothing, N/day spells a limited pool", () => {
    expect(mage.spells.find((entry) => entry.name === "Magic Missile")!.resourceCost).toEqual({ resourceId: "slot-1", amount: 1 });
    expect(mage.spells.find((entry) => entry.name === "Fire Bolt")!.resourceCost).toBeUndefined();
    const innate = parseSpellcasting(entry("Innate Spellcasting", "The fiend's spellcasting ability is Charisma (spell save DC 21). It can innately cast:\n\nAt will: detect magic, fireball\n3/day each: hold monster, wall of fire"), "fiend");
    const fireball = innate.spells.find((entry) => entry.name === "Fireball")!;
    expect(fireball.resourceCost).toBeUndefined();
    expect(fireball.upcast).toBeUndefined();
    const hold = innate.spells.find((entry) => entry.name === "Hold Monster")!;
    expect(hold.resourceCost).toEqual({ resourceId: "usage:fiend:spell:hold-monster", amount: 1 });
    expect(innate.resources["usage:fiend:spell:hold-monster"]).toBe(3);
    expect(innate.missing).toEqual(["wall of fire"]);
  });

  it("reads 'can cast X at will' and a mephit's single innate spell with its per-day count", () => {
    const archmage = parseSpellcasting(entry("Spellcasting", "The archmage can cast disguise self and invisibility at will and has the following wizard spells prepared:\n* Cantrips (at will): fire bolt"), "archmage");
    expect(archmage.utility).toEqual(expect.arrayContaining(["disguise self", "invisibility"]));
    const mephit = parseSpellcasting(entry("Innate Spellcasting (1/Day)", "The mephit can innately cast _blur_, requiring no material components."), "mephit", 1);
    expect(mephit.modelled).toEqual(["blur"]);
  });
});

describe("generated monsters", () => {
  it("a Mage casts with DC 14 and +6, 4/3/3/3/1 slots and caster level 9", () => {
    const mage = of("Mage");
    expect(mage.character?.level).toBe(9);
    expect(["slot-1", "slot-2", "slot-3", "slot-4", "slot-5"].map((slot) => mage.resources?.[slot])).toEqual([4, 3, 3, 3, 1]);
    expect((spell("Mage", "Fireball").action as { dc?: number }).dc).toBe(14);
    expect((spell("Mage", "Fire Bolt").action as { attackBonus?: number }).attackBonus).toBe(6);
  });

  it("the compiled spells are executable actions", () => {
    const ids = getExecutableActions(of("Lich")).map((action) => action.name);
    expect(ids).toEqual(expect.arrayContaining(["Fireball", "Blight", "Finger of Death", "Ray of Frost"]));
  });

  it("the lich's legendary Cantrip is its ray of frost", () => {
    const cantrip = of("Lich").legendary!.actions.find((entry) => entry.name === "Cantrip")!;
    expect(cantrip.actionId).toBe("lich:spell:ray-of-frost:action");
  });

  it("innate casters keep at-will spells free and daily ones limited", () => {
    expect(spell("Pit Fiend", "Fireball").resourceCost).toBeUndefined();
    expect(spell("Pit Fiend", "Hold Monster").resourceCost?.resourceId).toBe("usage:pit-fiend:spell:hold-monster");
    expect(of("Pit Fiend").resources?.["usage:pit-fiend:spell:hold-monster"]).toBe(3);
  });

  it("what isn't modelled is still there as text on the trait", () => {
    const trait = of("Mage").traits!.find((entry) => entry.name === "Spellcasting")!;
    expect(trait.description).toMatch(/detect magic/);
    expect(trait.automationSupport).toBe("partial"); // fly is a combat spell the library does not have yet
    expect(of("Archmage").traits!.find((entry) => entry.name === "Spellcasting")).toBeDefined();
  });
});

function duel(caster: CreatureDefinition, seed: string): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const fighter = { ...base.definitions.find((definition) => definition.id === "def-fighter")!, maxHp: 400, armorClass: 8 };
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: definition.defaultTactics ?? "controller", resourceStance: "balanced", resources: definition.resources ? { ...definition.resources } : undefined
  });
  return { ...base, seed, rules: { ...base.rules, requireLineOfEffect: false }, map: { ...base.map, walls: [], terrain: [] }, definitions: [fighter, caster], combatants: [token("hero", fighter, "party", 3), token("caster", caster, "enemy", 8)] };
}

describe("in a fight", () => {
  it("a mage casts real spells, spends slots and never goes over", () => {
    const result = runAutomatedEncounter(duel(of("Mage"), "mage-duel"), 8);
    const casts = result.log.filter((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "caster");
    const spellNames = new Set(casts.map((entry) => String(entry.data?.actionName)));
    expect([...spellNames].some((name) => /^(Fireball|Cone of Cold|Ice Storm|Magic Missile|Fire Bolt)/.test(name))).toBe(true);
    expect(result.log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message))).toEqual([]);
    const caster = result.snapshot.combatants.find((entry) => entry.id === "caster")!;
    for (const value of Object.values(caster.resources ?? {})) expect(value).toBeGreaterThanOrEqual(0);
    const bigSlots = ["slot-3", "slot-4", "slot-5"].reduce((sum, slot) => sum + (caster.resources?.[slot] ?? 0), 0);
    expect(bigSlots).toBeLessThan(7); // it used some of them
  });

  it("a lich holds the field with a real spell list", () => {
    const result = runAutomatedEncounter(duel(of("Lich"), "lich-duel"), 6);
    expect(result.log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message))).toEqual([]);
    expect(result.log.some((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "caster")).toBe(true);
  });

  it("a caster's turn takes a spell action, not a lost turn", () => {
    const state = createEngineState(duel(of("Archmage"), "arch"));
    const actor = state.snapshot.combatants.find((entry) => entry.id === "caster")!;
    expect(takeAutomatedTurn(state, actor)).toBeUndefined();
    expect(state.log.some((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "caster")).toBe(true);
  });
});
