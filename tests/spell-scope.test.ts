import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveActivateFeatureAction,
  resolveAttack,
  resolveSaveDc,
  sampleEncounter,
  SeededRandom,
  type ActionDefinition,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7h: features scoped to some spells. A compiled spell knows its school and the class it's cast
 * as; Potent Spellcasting, Empowered Evocation and Elemental Affinity add an ability to one damage roll, Potent Cantrip
 * deals half on a miss or a made save, Improved Elemental Fury reaches farther, Innate Sorcery covers Sorcerer spells.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const quick = (classId: string, level: number) => quickBuild(sources, { classId: `srd:class:${classId}`, level });
const pick = (build: CharacterBuild, level: number, path: string[], value: Parameters<typeof withChoice>[3]) =>
  withSuggestions(withChoice(build, { kind: "level", index: level - 1 }, path, value), sources);
const named = (definition: CreatureDefinition, name: string): ActionDefinition => {
  const found = getExecutableActions(definition).find((entry) => entry.name === name);
  if (!found) throw new Error(`no ${name} among ${getExecutableActions(definition).map((entry) => entry.name).join(", ")}`);
  return found;
};
const damageOf = (action: ActionDefinition) => ("damage" in action ? action.damage : []);

/** Dice from a list, then a seeded stream. */
function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("spell-scope");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

describe("a spell knows its school and its class", () => {
  it("a class's spells are that class's, and Magic Initiate's count as their list's (an Acolyte's Sacred Flame)", () => {
    const cleric = actor(quick("cleric", 1));
    const sacredFlame = named(cleric, "Sacred Flame");
    expect(sacredFlame).toMatchObject({ spellClass: "cleric", spellSchool: "evocation" });
  });
});

describe("Potent Spellcasting", () => {
  it("a Cleric's: Wisdom on one damage roll of each Cleric cantrip, not a leveled spell", () => {
    const cleric = actor(pick(quick("cleric", 7), 7, ["blessed-strikes"], ["potent-spellcasting"]));
    expect(damageOf(named(cleric, "Sacred Flame"))[0]).toMatchObject({ abilityModifier: "wis" });
    const leveled = getExecutableActions(cleric).find((entry) => "spellLevel" in entry && (entry.spellLevel ?? 0) > 0 && "damage" in entry && entry.damage.length);
    if (leveled && "damage" in leveled) expect(leveled.damage[0]?.abilityModifier).not.toBe("wis");
    expect(featureStatblock(cleric.features!.find((feature) => feature.name === "Blessed Strikes: Potent Spellcasting")!, cleric).text)
      .toBe("It adds its Wisdom modifier to one damage roll of its Cleric cantrips.");
  });

  it("not with Divine Strike instead", () => {
    const cleric = actor(pick(quick("cleric", 7), 7, ["blessed-strikes"], ["divine-strike"]));
    expect(damageOf(named(cleric, "Sacred Flame"))[0]?.abilityModifier).toBeUndefined();
  });

  it("a Druid's reaches 300 ft farther from 15th level", () => {
    const at = (level: number) => actor(pick(quick("druid", level), 7, ["elemental-fury"], ["potent-spellcasting"]));
    const range = (definition: CreatureDefinition) => {
      const cantrip = getExecutableActions(definition).find((entry) => "spellLevel" in entry && entry.spellLevel === 0 && "range" in entry && entry.range >= 10);
      return cantrip && "range" in cantrip ? { name: cantrip.name, range: cantrip.range } : undefined;
    };
    const before = range(at(14))!;
    const after = getExecutableActions(at(15)).find((entry) => entry.name === before.name);
    expect(after && "range" in after ? after.range : 0).toBe(before.range + 300);
  });
});

describe("Innate Sorcery", () => {
  it("+1 to a Sorcerer spell's save DC, and nothing to another class's", () => {
    const sorcerer = actor(quick("sorcerer", 3));
    const snapshot = structuredClone(sampleEncounter);
    snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...sorcerer, id: "def-fighter" }];
    for (const token of snapshot.combatants) if (token.id === "pc-fighter") token.resources = { ...(sorcerer.resources ?? {}) };
    snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
    const state = createEngineState(snapshot);
    const me = state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    const save = getExecutableActions(sorcerer).find((entry): entry is Extract<ActionDefinition, { kind: "save" | "area-save" }> => (entry.kind === "save" || entry.kind === "area-save") && entry.spellClass === "sorcerer")!;
    const before = resolveSaveDc(save, sorcerer, me);
    resolveActivateFeatureAction(state, "pc-fighter", named(sorcerer, "Innate Sorcery").id);
    expect(resolveSaveDc(save, sorcerer, me)).toBe(before + 1);
    expect(resolveSaveDc({ ...save, spellClass: "wizard" } as typeof save, sorcerer, me)).toBe(before);
  });
});

describe("Elemental Affinity", () => {
  it("Charisma on one damage roll of a spell of its type, not on one of several beams", () => {
    let build = quick("sorcerer", 6);
    build = pick(build, 3, ["subclass"], "srd:subclass:draconic-sorcery");
    build = pick(build, 6, ["elemental-affinity"], ["fire"]);
    const sorcerer = actor(build);
    const fireBolt = getExecutableActions(sorcerer).find((entry) => entry.name === "Fire Bolt");
    if (fireBolt) expect(damageOf(fireBolt)[0]).toMatchObject({ abilityModifier: "cha" });
    const burning = getExecutableActions(sorcerer).find((entry) => entry.name === "Burning Hands");
    if (burning) expect(damageOf(burning)[0]).toMatchObject({ abilityModifier: "cha" });
    const cold = getExecutableActions(sorcerer).find((entry) => entry.name === "Ray of Frost");
    if (cold) expect(damageOf(cold)[0]?.abilityModifier).toBeUndefined();
    expect(fireBolt ?? burning).toBeDefined();
  });
});

describe("the Evoker", () => {
  const evoker = (level: number) => actor(pick(quick("wizard", level), 3, ["subclass"], "srd:subclass:evoker"));

  it("Potent Cantrip: half a cantrip's damage on a miss, or on a made save", () => {
    const wizard = evoker(3);
    const attack = getExecutableActions(wizard).find((entry) => entry.kind === "attack" && entry.spellLevel === 0)!;
    expect(attack).toMatchObject({ halfDamageOnMiss: true });
    const save = getExecutableActions(wizard).find((entry) => (entry.kind === "save" || entry.kind === "area-save") && entry.spellLevel === 0);
    if (save) expect(save).toMatchObject({ onSuccess: "half", halfDamageOnSuccess: true });

    const snapshot = structuredClone(sampleEncounter);
    snapshot.map.walls = [];
    snapshot.definitions = [
      ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
      { ...wizard, id: "def-fighter" },
      { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, armorClass: 40, maxHp: 100 }
    ];
    for (const token of snapshot.combatants) {
      if (token.id === "pc-fighter") token.position = { x: 3, y: 3 };
      if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 100; }
    }
    snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
    const state = createEngineState(snapshot);
    state.rng = scripted([5, 10, 10, 10, 10]);
    const result = resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack.id);
    expect(result.hit).toBe(false);
    expect(state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!.currentHp).toBeLessThan(100);
  });

  it("Empowered Evocation: Intelligence on one damage roll of a Wizard evocation spell, from 10th level", () => {
    const fireball = (definition: CreatureDefinition) => getExecutableActions(definition).find((entry) => entry.name === "Fireball");
    const tenth = fireball(evoker(10));
    expect(tenth).toBeDefined();
    expect(damageOf(tenth!)[0]).toMatchObject({ abilityModifier: "int" });
    expect(damageOf(fireball(evoker(9))!)[0]?.abilityModifier).toBeUndefined();
    const missile = getExecutableActions(evoker(10)).find((entry) => entry.name === "Magic Missile");
    if (missile) expect(damageOf(missile).some((component) => component.abilityModifier === "int")).toBe(false);
  });
});
