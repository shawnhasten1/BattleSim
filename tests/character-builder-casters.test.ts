import { describe, expect, it } from "vitest";
import {
  armorClassOf,
  createEngineState,
  getExecutableActions,
  resolveActivateFeatureAction,
  resolveAreaSaveAction,
  resolveSaveDc,
  sampleEncounter,
  SeededRandom,
  type ActionDefinition,
  type CreatureDefinition,
  type FeatureDefinition,
  type RandomSource
} from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";
import { SRD_2024_REFERENCE } from "@/data/srd/2024/reference";
import { blankCharacter, buildCharacter, quickBuild, rebuildActor, withChoice, withSuggestions as suggest, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES, SRD_BUILDER_LIBRARY } from "@/lib/character-builder/srd";

/** PC builder plan, Phase 5b: the Wizard (Evoker), Sorcerer (Draconic), Cleric (Life), Bard (Lore) and Druid (Land). */

const sources = SRD_BUILD_SOURCES;
const spell = (slug: string) => `srd:spell:${slug}-2024`;
const quick = (classId: string, level: number, backgroundId = "srd:background:soldier"): CharacterBuild =>
  quickBuild(sources, { classId: `srd:class:${classId}`, level, backgroundId });
const actor = (build: CharacterBuild, id = "def-pc"): CreatureDefinition => rebuildActor(blankCharacter(id, "PC"), build, sources).definition;
const built = (classId: string, level: number) => actor(quick(classId, level), `def-${classId}-${level}`);

const feature = (definition: CreatureDefinition, id: string): FeatureDefinition => {
  const found = definition.features?.find((entry) => entry.id === id);
  if (!found) throw new Error(`no ${id}: ${(definition.features ?? []).map((entry) => entry.id).join(", ")}`);
  return found;
};
const action = (definition: CreatureDefinition, name: string): ActionDefinition => {
  const found = getExecutableActions(definition).find((entry) => entry.name === name);
  if (!found) throw new Error(`no ${name}: ${getExecutableActions(definition).map((entry) => entry.name).join(", ")}`);
  return found;
};
const column = (classKey: string, id: string) =>
  SRD_2024_REFERENCE.classes.find((entry) => entry.key === `srd-2024_${classKey}`)!.columns.find((entry) => entry.id === id)!.values;
const leveled = (definition: CreatureDefinition) => (definition.spells ?? []).filter((entry) => entry.level > 0 && !/\((free|at will)\)$/.test(entry.name));

function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("casters");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** The sample fight with this character in the fighter's place; `undead` makes the first goblin undead. */
function fightWith(definition: CreatureDefinition, options: { undead?: boolean } = {}) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  const goblin = snapshot.definitions.find((entry) => entry.id === "def-goblin")!;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...goblin, maxHp: 40 },
    ...(options.undead ? [{ ...goblin, id: "def-zombie", name: "Zombie", type: "undead" as const, maxHp: 40 }] : [])
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") { token.position = { x: 5, y: 3 }; token.currentHp = 40; if (options.undead) token.definitionId = "def-zombie"; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 3, y: 5 }; token.currentHp = 40; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  return createEngineState(snapshot);
}

describe("the Wizard (Evoker)", () => {
  it("prepares its table's number of spells from a book that starts at six and grows by two a level", () => {
    const build = quick("wizard", 5);
    const book = buildCharacter(build, sources).choices.filter((slot) => slot.path[0] === "spellbook" && slot.characterLevel !== undefined);
    expect(book.map((slot) => slot.count)).toEqual([6, 2, 2, 2, 2]);
    expect(leveled(actor(build))).toHaveLength(column("wizard", "prepared-spells")[4] as number);
  });

  it("Scholar: expertise in one of its academic skills", () => {
    const wizard = built("wizard", 2);
    const pb = 2;
    const expert = Object.entries(wizard.skills ?? {}).filter(([skill, bonus]) =>
      ["arcana", "history", "investigation", "medicine", "nature", "religion"].includes(skill) && bonus === Math.floor((wizard.abilities.int - 10) / 2) + 2 * pb);
    expect(expert).toHaveLength(1);
  });

  it("Evocation Savant writes evocation spells into the book, two at 3rd level and one with each new slot level", () => {
    const slots = buildCharacter(quick("wizard", 7), sources).choices.filter((slot) => slot.path[0] === "evocation-savant");
    expect(slots.map((slot) => [slot.characterLevel, slot.count])).toEqual([[3, 2], [5, 1], [7, 1]]);
    for (const slot of slots) {
      for (const id of slot.value as string[]) expect(SRD_BUILDER_LIBRARY.spell!(id)!.school, id).toBe("evocation");
    }
    expect(Math.max(...slots[0]!.options.map((option) => option.level ?? 0))).toBe(2);
  });

  it("Spell Mastery casts a 1st- and a 2nd-level spell at will; Signature Spells two 3rd-level spells once each", () => {
    const wizard = built("wizard", 20);
    const atWill = wizard.spells!.filter((entry) => entry.name.endsWith("(at will)"));
    expect(atWill.map((entry) => entry.level).sort()).toEqual([1, 2]);
    for (const entry of atWill) {
      expect(entry.resourceCost).toBeUndefined();
      expect(entry.castingTime).toBe("action");
      expect(entry.action && "resourceCost" in entry.action ? entry.action.resourceCost : undefined).toBeUndefined();
    }
    const signature = wizard.spells!.filter((entry) => entry.level === 3 && entry.name.endsWith("(free)"));
    expect(signature).toHaveLength(2);
    for (const entry of signature) expect(wizard.resources?.[entry.resourceCost!.resourceId]).toBe(1);
  });

  it("runs Potent Cantrip, Empowered Evocation and Sculpt Spells (7w), and Overchannel's first use (7ad)", () => {
    const wizard = built("wizard", 14);
    for (const id of ["evoker-potent-cantrip", "evoker-empowered-evocation", "evoker-sculpt-spells"]) expect(feature(wizard, id).automationSupport).toBe("full");
    expect(feature(wizard, "evoker-overchannel").automationSupport).toBe("partial");
  });
});

describe("the Sorcerer (Draconic Sorcery)", () => {
  it("knows four cantrips at 1st level, and has its table's sorcery points", () => {
    const first = buildCharacter(quick("sorcerer", 1), sources).choices.find((slot) => slot.path[0] === "cantrips")!;
    expect(first.count).toBe(4);
    expect(first.value).toContain(spell("sorcerous-burst"));
    expect(built("sorcerer", 1).resources?.["sorcery-points"]).toBeUndefined();
    expect(built("sorcerer", 9).resources?.["sorcery-points"]).toBe(9);
  });

  it("Innate Sorcery: +1 to its spell save DC and advantage on spell attacks while it lasts", () => {
    const sorcerer = built("sorcerer", 5);
    expect(sorcerer.resources?.["innate-sorcery"]).toBe(2);
    const state = fightWith(sorcerer);
    const token = () => state.snapshot.combatants.find((entry) => entry.id === "pc-fighter")!;
    const definition = state.snapshot.definitions.find((entry) => entry.id === "def-fighter")!;
    const fireball = action(definition, "Fireball") as Extract<ActionDefinition, { kind: "area-save" }>;
    const before = resolveSaveDc(fireball, definition, token());
    resolveActivateFeatureAction(state, "pc-fighter", action(definition, "Innate Sorcery").id);
    expect(resolveSaveDc(fireball, definition, token())).toBe(before + 1);
    expect(token().resources?.["innate-sorcery"]).toBe(1);
  });

  it("Metamagic: two options at 2nd, 10th and 17th level, never the same one twice", () => {
    const sorcerer = built("sorcerer", 17);
    const options = sorcerer.features!.filter((entry) => entry.name.startsWith("Metamagic: "));
    expect(options).toHaveLength(6);
    expect(new Set(options.map((entry) => entry.name)).size).toBe(6);
    // Phases 7v and 7w: every option runs.
    for (const option of options) expect(option.automationSupport, option.name).toBe("full");
  });

  it("Draconic Resilience: AC 10 + Dex + Cha unarmored, and a hit point per sorcerer level", () => {
    const mod = (score: number) => Math.floor((score - 10) / 2);
    const third = built("sorcerer", 3);
    expect(armorClassOf(third).total).toBe(10 + mod(third.abilities.dex) + mod(third.abilities.cha));
    const second = built("sorcerer", 2);
    expect(third.maxHp - second.maxHp).toBe(4 + mod(third.abilities.con) + 3);
  });

  it("Draconic Spells are always prepared, beside the prepared ones; Elemental Affinity gives a resistance", () => {
    const sorcerer = built("sorcerer", 6);
    expect(sorcerer.spells!.filter((entry) => entry.id.startsWith("draconic-sorcery-")).map((entry) => entry.name).sort())
      .toEqual(["Alter Self", "Chromatic Orb", "Command", "Dragon's Breath", "Fear", "Fly"]);
    const affinity = sorcerer.features!.find((entry) => entry.name.startsWith("Elemental Affinity"))!;
    expect(affinity.effects?.[0]).toMatchObject({ kind: "damage-adjustment", adjustment: { type: "resistance" } });
  });
});

describe("the Cleric (Life Domain)", () => {
  it("Divine Spark heals or harms, a d8 more at 7th, 13th and 18th level; Channel Divinity by the table", () => {
    for (const [level, dice] of [[2, "1d8"], [7, "2d8"], [13, "3d8"], [18, "4d8"]] as const) {
      const cleric = built("cleric", level);
      expect(action(cleric, "Divine Spark: Heal"), `level ${level}`).toMatchObject({ healing: [{ dice, abilityModifier: "wis" }], resourceCost: { resourceId: "channel-divinity" } });
      expect(action(cleric, "Divine Spark: Harm"), `level ${level}`).toMatchObject({ damage: [{ dice }], saveAbility: "con" });
      expect(cleric.resources?.["channel-divinity"], `level ${level}`).toBe(column("cleric", "channel-divinity")[level - 1]);
    }
  });

  it("Turn Undead frightens and incapacitates undead only; from 5th level it also sears them", () => {
    const state = fightWith(built("cleric", 5), { undead: true });
    // Both fail their saves; the sear rolls 3 on each d8.
    state.rng = scripted([1, 1, 3, 3, 3, 3, 3]);
    const definition = state.snapshot.definitions.find((entry) => entry.id === "def-fighter")!;
    const turn = action(definition, "Turn Undead");
    expect(turn).toMatchObject({ riders: [{ condition: "frightened" }, { condition: "incapacitated" }, { kind: "damage", restrictToCreatureTypes: ["undead"] }] });
    resolveAreaSaveAction(state, "pc-fighter", state.snapshot.combatants.find((entry) => entry.id === "pc-fighter")!.position, turn.id);
    const zombie = state.snapshot.combatants.find((entry) => entry.id === "enemy-goblin-1")!;
    const goblin = state.snapshot.combatants.find((entry) => entry.id === "enemy-goblin-2")!;
    expect(zombie.conditions?.map((condition) => condition.name).sort()).toEqual(["frightened", "incapacitated"]);
    expect(zombie.currentHp).toBeLessThan(40);
    expect(goblin.conditions ?? []).toEqual([]);
    expect(goblin.currentHp).toBe(40);
  });

  it("Life Domain spells are always prepared, and Divine Strike adds radiant damage (2d8 from 14th level)", () => {
    const third = built("cleric", 3);
    expect(third.spells!.filter((entry) => entry.id.startsWith("life-domain-")).map((entry) => entry.name).sort())
      .toEqual(["Aid", "Bless", "Cure Wounds", "Lesser Restoration"]);
    // The prepared spells don't double up on them.
    expect(third.spells!.filter((entry) => entry.name === "Bless")).toHaveLength(1);
    const seventh = built("cleric", 7);
    expect(seventh.features!.find((entry) => entry.name === "Blessed Strikes: Divine Strike")?.effects?.[0])
      .toMatchObject({ kind: "damage-bonus", oncePerTurn: true, damage: [{ dice: "1d8", damageType: "radiant" }] });
    expect(built("cleric", 14).features!.find((entry) => entry.name === "Blessed Strikes: Divine Strike")?.effects?.[0])
      .toMatchObject({ damage: [{ dice: "2d8" }] });
  });

  it("Thaumaturge: an extra cantrip", () => {
    let build = quick("cleric", 1);
    build = withSuggestions(withChoice(build, { kind: "level", index: 0 }, ["divine-order"], ["thaumaturge"]));
    const cantrips = buildCharacter(build, sources).choices.filter((slot) => slot.spec.kind === "spells" && slot.spec.what === "cantrips" && slot.scope.kind === "level");
    expect(cantrips.map((slot) => slot.count).sort()).toEqual([1, 3]);
  });
});

describe("the Bard (College of Lore)", () => {
  it("inspires Charisma-modifier times, with expertise at 2nd and 9th level", () => {
    const bard = built("bard", 9);
    expect(bard.resources?.["bardic-inspiration"]).toBe(Math.max(1, Math.floor((bard.abilities.cha - 10) / 2)));
    expect(buildCharacter(quick("bard", 9), sources).choices.filter((slot) => slot.spec.kind === "expertise").map((slot) => slot.count)).toEqual([2, 2]);
  });

  it("Magical Secrets: from 10th level, prepared spells (not cantrips) can come from the Cleric, Druid and Wizard lists", () => {
    const at = (level: number, choice: string) => buildCharacter(quick("bard", level), sources).choices.find((slot) => slot.characterLevel === level && slot.path[0] === choice);
    expect(at(9, "prepared")!.options.some((option) => option.id === spell("fireball"))).toBe(false);
    expect(at(10, "prepared")!.options.some((option) => option.id === spell("fireball"))).toBe(true);
    expect(at(10, "cantrips")!.options.some((option) => option.id === spell("fire-bolt"))).toBe(false);
  });

  it("Cutting Words: its reaction, a Bardic Inspiration die off a foe's hit (7am)", () => {
    for (const [level, die] of [[3, "1d6"], [5, "1d8"], [10, "1d10"], [15, "1d12"]] as const) {
      const bard = built("bard", level);
      expect(feature(bard, "college-of-lore-cutting-words").effects?.[0], `level ${level}`).toMatchObject({
        kind: "d20-change", rolls: ["attack"], change: "subtract", dice: die, reaction: true, againstFoes: { withinFt: 60 }, resourceCost: { resourceId: "bardic-inspiration" }
      });
    }
  });

  it("Magical Discoveries: two Cleric, Druid or Wizard spells, cantrips included; Words of Creation at 20th", () => {
    const slot = buildCharacter(quick("bard", 6), sources).choices.find((entry) => entry.path[0] === "magical-discoveries")!;
    expect(slot.count).toBe(2);
    expect(slot.options.some((option) => option.level === 0)).toBe(true);
    expect(slot.options.some((option) => option.id === spell("fireball"))).toBe(true);
    expect(slot.options.some((option) => option.id === spell("vicious-mockery"))).toBe(false);
    const twentieth = built("bard", 20);
    expect(twentieth.spells!.map((entry) => entry.name)).toEqual(expect.arrayContaining(["Power Word Heal", "Power Word Kill"]));
  });
});

describe("the Druid (Circle of the Land)", () => {
  it("counts Wild Shape's uses (shifting is reference until Phase 7), and Land's Aid spends one", () => {
    const druid = built("druid", 3);
    expect(druid.resources?.["wild-shape"]).toBe(2);
    expect(feature(druid, "druid-wild-shape").automationSupport).toBe("manual-only");
    expect(action(druid, "Land's Aid")).toMatchObject({ kind: "area-save", saveAbility: "con", damage: [{ dice: "2d6" }], resourceCost: { resourceId: "wild-shape", amount: 1 } });
    expect(action(built("druid", 10), "Land's Aid")).toMatchObject({ damage: [{ dice: "3d6" }] });
    expect(action(built("druid", 14), "Land's Aid")).toMatchObject({ damage: [{ dice: "4d6" }] });
  });

  it("gives its land's circle spells as the druid reaches their levels", () => {
    const polar = (level: number) => {
      let build = quick("druid", level);
      build = withSuggestions(withChoice(build, { kind: "level", index: 2 }, ["land"], ["polar"]));
      return actor(build).spells!.filter((entry) => entry.id.startsWith("circle-of-the-land-")).map((entry) => entry.name).sort();
    };
    expect(polar(3)).toEqual(["Fog Cloud", "Hold Person", "Ray of Frost"]);
    expect(polar(5)).toEqual(["Fog Cloud", "Hold Person", "Ray of Frost", "Sleet Storm"]);
    expect(polar(9)).toEqual(expect.arrayContaining(["Cone of Cold", "Ice Storm"]));
  });

  it("Natural Recovery casts one circle spell once without a slot; Nature's Ward: no poison, and the land's resistance", () => {
    const druid = built("druid", 10);
    const free = druid.spells!.filter((entry) => entry.name.endsWith("(free)") && entry.id.startsWith("circle-of-the-land-"));
    expect(free).toHaveLength(1);
    expect(free[0]!.level).toBeGreaterThan(0);
    expect(druid.conditionImmunities).toContain("poisoned");
    expect(druid.features!.some((entry) => entry.name.startsWith("Nature's Ward (") && entry.effects?.[0]?.kind === "damage-adjustment")).toBe(true);
  });

  it("Primal Strike adds 1d8 on a weapon hit, 2d8 from 15th level; Speak with Animals is always prepared", () => {
    expect(built("druid", 7).features!.find((entry) => entry.name === "Elemental Fury: Primal Strike")?.effects?.[0]).toMatchObject({ damage: [{ dice: "1d8" }] });
    expect(built("druid", 15).features!.find((entry) => entry.name === "Elemental Fury: Primal Strike")?.effects?.[0]).toMatchObject({ damage: [{ dice: "2d8" }] });
    expect(built("druid", 1).spells!.some((entry) => entry.id === "druid-speak-with-animals")).toBe(true);
  });
});

describe("built casters in a fight", { timeout: 30000 }, () => {
  for (const classId of ["wizard", "sorcerer", "cleric", "bard", "druid"]) {
    it(`the AI casts a ${classId}'s spells`, () => {
      const definition = built(classId, 5);
      const state = fightWith(definition);
      const result = runAutomatedEncounter({ ...state.snapshot, seed: classId, round: 0, turnIndex: 0 }, 20);
      const names = new Set(definition.spells!.map((entry) => entry.name));
      const cast = result.log.filter((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "pc-fighter" && names.has(String(entry.data?.actionName)));
      expect(cast.length, classId).toBeGreaterThan(0);
      expect(result.outcome.completed).toBe(true);
    });
  }
});


/** The suggestions for whatever a changed choice opened (a Thaumaturge's cantrip, a land's spells). */
function withSuggestions(build: CharacterBuild): CharacterBuild {
  return suggest(build, sources);
}
