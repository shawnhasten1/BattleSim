import { describe, expect, it } from "vitest";
import {
  actionProblem,
  createEngineState,
  genericBases,
  getExecutableActions,
  resolveAttack,
  resolveBuffAction,
  sampleEncounter,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { castWith } from "@/lib/ability-editor/spells";
import { familyKey, hotbarFor } from "@/lib/play/hotbar";
import { SRD_BUILDER_LIBRARY } from "@/lib/character-builder/srd";

/**
 * PC builder plan, Phase 7af: cantrips that attack with a weapon. True Strike (one attack with a weapon it carries, the
 * spellcasting ability for the attack and damage, radiant or the weapon's type, more radiant from 5th level) and
 * Shillelagh (a minute of a club's or quarterstaff's melee attacks that way, a d8 growing with level, force or the
 * weapon's type).
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const mod = (score: number) => Math.floor((score - 10) / 2);

/** Every d20 a 15; other dice their highest. */
const steady: RandomSource = { next: () => 0.999, nextInt: (min, max) => (max === 20 ? 15 : max), fork: () => steady };

/** The character in the fighter's place beside a 200 hp goblin with these defenses. */
function scene(definition: CreatureDefinition, defenses: CreatureDefinition["damageAdjustments"] = []) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  const goblin = sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...goblin, maxHp: 200, damageAdjustments: defenses }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 3, y: 9 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 16, y: 1 }; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  state.rng = steady;
  const dealt = () => state.log.filter((entry) => entry.type === "DamageApplied" && entry.data?.targetId === "enemy-goblin-1");
  return { state, dealt };
}

describe("True Strike", () => {
  const bard = (level: number) => actor(quickBuild(sources, { classId: "srd:class:bard", level }));

  it("a copy of the spell for each weapon it carries, in place of the spell's own action", () => {
    const definition = bard(5);
    const actions = getExecutableActions(definition);
    const strikes = actions.filter((action) => action.name.startsWith("True Strike"));
    expect(strikes.length).toBe((definition.weapons ?? []).filter((weapon) => weapon.baseWeapon && weapon.baseWeapon !== "unarmed-strike").length);
    expect(strikes.length).toBeGreaterThan(0);
    for (const strike of strikes) {
      expect(strike).toMatchObject({ kind: "attack", actionType: "action", spellLevel: 0, ability: "cha", viaWeapon: {} });
      expect(familyKey(strike.id)).not.toBe(strike.id);
    }
    // A spell, so never a swing of the Attack action.
    expect(genericBases("weapon", actions).some((action) => action.name.startsWith("True Strike"))).toBe(false);
  });

  it("Charisma for the attack and damage, radiant against a creature that resists the weapon, 1d6 radiant more at 5th level", () => {
    const definition = bard(5);
    const strike = getExecutableActions(definition).find((action) => action.name === "True Strike (Dagger)")!;
    const { state, dealt } = scene(definition, [{ type: "resistance", damageType: "piercing" }]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", strike.id);
    const components = dealt()[0]!.data!.components as Array<{ damageType: string; finalAmount: number }>;
    expect(components.map((component) => component.damageType)).toEqual(["radiant", "radiant"]);
    expect(components.reduce((sum, component) => sum + component.finalAmount, 0)).toBe(4 + mod(definition.abilities.cha) + 6);
  });

  it("one hotbar button, a variant for each weapon", () => {
    const definition = bard(5);
    const { state } = scene(definition);
    const buttons = hotbarFor(state.snapshot, "pc-fighter").tabs.flatMap((tab) => tab.buttons);
    const strike = buttons.find((button) => button.name === "True Strike")!;
    expect(strike.variants.map((variant) => variant.label)).toEqual((definition.weapons ?? [])
      .filter((weapon) => weapon.baseWeapon && weapon.baseWeapon !== "unarmed-strike").map((weapon) => weapon.name));
  });

  it("no extra radiant below 5th level", () => {
    const strike = getExecutableActions(bard(5)).find((action) => action.name === "True Strike (Dagger)")!;
    expect("damage" in strike && strike.damage.length).toBe(2);
    const low = getExecutableActions({ ...bard(5), character: { ...bard(5).character!, level: 4 } }).find((action) => action.name === "True Strike (Dagger)")!;
    expect("damage" in low && low.damage.length).toBe(1);
  });
});

describe("Shillelagh", () => {
  const druid = () => actor(quickBuild(sources, { classId: "srd:class:druid", level: 5 }));

  it("the staff's attacks with Wisdom and a d10 (at 5th level), only while the spell lasts", () => {
    const definition = druid();
    const actions = getExecutableActions(definition);
    const staff = actions.find((action) => action.name === "Quarterstaff (Shillelagh)")!;
    expect(staff).toMatchObject({ kind: "attack", ability: "wis", whileCondition: { id: "shillelagh", name: "Shillelagh" } });
    expect(actions.some((action) => action.name === "Sickle (Shillelagh)")).toBe(false);
    const { state, dealt } = scene(definition);
    expect(actionProblem(state.snapshot, "pc-fighter", staff.id)).toBe("Only while Shillelagh lasts");
    resolveBuffAction(state, "pc-fighter", actions.find((action) => action.name === "Shillelagh")!.id, ["pc-fighter"]);
    expect(actionProblem(state.snapshot, "pc-fighter", staff.id)).toBeUndefined();
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", staff.id);
    expect(dealt()[0]!.data!.totalApplied).toBe(10 + mod(definition.abilities.wis));
  });

  it("on the hotbar beside the plain staff, which comes first until the spell is on", () => {
    const definition = druid();
    const { state } = scene(definition);
    const staff = hotbarFor(state.snapshot, "pc-fighter").tabs.flatMap((tab) => tab.buttons).find((button) => button.name === "Quarterstaff")!;
    expect(staff.variants.map((variant) => [variant.label, variant.problem])).toEqual([["Normal", undefined], ["Shillelagh", "Only while Shillelagh lasts"]]);
  });

  it("isn't offered without a club or quarterstaff", () => {
    const definition = druid();
    const bare = { ...definition, weapons: (definition.weapons ?? []).filter((weapon) => weapon.baseWeapon !== "quarterstaff") };
    expect(getExecutableActions(bare).some((action) => action.name.includes("Shillelagh"))).toBe(false);
  });

  it("cast with a class's ability", () => {
    const spell = SRD_BUILDER_LIBRARY.spell!("srd:spell:shillelagh-2024")!;
    const cast = castWith(spell, "int");
    expect(cast.action?.kind === "buff" && cast.action.imbuesWeapon?.ability).toBe("int");
  });
});
