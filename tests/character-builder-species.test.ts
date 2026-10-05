import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAttack,
  sampleEncounter,
  SeededRandom,
  type ActionDefinition,
  type CreatureDefinition,
  type FeatureDefinition,
  type RandomSource
} from "@/engine";
import { SRD_2024_CATALOG } from "@/data/srd/2024";
import { SPECIES_COVERAGE, type CoverageEntry } from "@/data/srd/2024/coverage";
import { SRD_2024_REFERENCE } from "@/data/srd/2024/reference";
import {
  blankCharacter,
  buildCharacter,
  quickBuild,
  rebuildActor,
  speciesDefinitionSchema,
  withChoice,
  withSuggestions,
  type CharacterBuild,
  type ChoiceSpec,
  type FeatureGrant
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES, SRD_BUILDER_LIBRARY } from "@/lib/character-builder/srd";
import { speciesTraitKey } from "../scripts/srd-2024/coverage";

/** PC builder plan, Phase 6: the nine SRD 5.2 species. */

const sources = SRD_BUILD_SOURCES;
const quick = (speciesId: string, level = 1, classId = "srd:class:fighter"): CharacterBuild =>
  quickBuild(sources, { classId, level, speciesId: `srd:species:${speciesId}` });
const actor = (build: CharacterBuild, id = "def-fighter"): CreatureDefinition => rebuildActor(blankCharacter(id, "PC"), build, sources).definition;
const choose = (build: CharacterBuild, id: string, value: Parameters<typeof withChoice>[3]) =>
  withSuggestions(withChoice(build, { kind: "species" }, [id], value), sources);
const trait = (definition: CreatureDefinition, name: string): FeatureDefinition => {
  const found = [...(definition.traits ?? []), ...(definition.features ?? [])].find((entry) => entry.name === name);
  if (!found) throw new Error(`no ${name}: ${(definition.traits ?? []).map((entry) => entry.name).join(", ")}`);
  return found;
};
const action = (definition: CreatureDefinition, name: string): ActionDefinition => {
  const found = getExecutableActions(definition).find((entry) => entry.name === name);
  if (!found) throw new Error(`no ${name}: ${getExecutableActions(definition).map((entry) => entry.name).join(", ")}`);
  return found;
};

function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("species");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** The sample fight with this character in the fighter's place, the first goblin next to it. */
function fightWith(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") token.position = { x: 4, y: 3 };
    if (token.id === "enemy-goblin-2") token.position = { x: 9, y: 9 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "enemy-goblin-1");
  return createEngineState(snapshot);
}

describe("the species catalog", () => {
  it("has the nine SRD 5.2 species, each passing its schema", () => {
    expect(SRD_2024_CATALOG.species.map((entry) => entry.name)).toEqual(SRD_2024_REFERENCE.species.map((entry) => entry.name));
    for (const entry of SRD_2024_CATALOG.species) expect(speciesDefinitionSchema.safeParse(entry).success, entry.id).toBe(true);
  });

  it("covers every trait with a feature or a choice, marked as the audit says", () => {
    const agrees = (feature: FeatureDefinition, verdict: CoverageEntry["verdict"]) =>
      verdict === "builder" ? true
        : verdict === "info" ? Boolean(feature.informational)
          : verdict === "full" ? feature.automationSupport === "full" && !feature.informational
            : verdict === "partial" ? feature.automationSupport === "partial"
              : feature.automationSupport === "manual-only" && !feature.informational;
    const problems: string[] = [];
    for (const reference of SRD_2024_REFERENCE.species) {
      const species = SRD_2024_CATALOG.species.find((entry) => entry.name === reference.name)!;
      // Every feature it can give (in a pick option too), and every choice it asks.
      const features: Array<{ feature: FeatureDefinition; top: boolean }> = [];
      const choices: ChoiceSpec[] = [];
      const take = (grants: FeatureGrant[], specs: ChoiceSpec[] = [], top: boolean) => {
        for (const grant of grants) if (grant.feature && typeof grant.feature === "object") features.push({ feature: grant.feature, top });
        for (const spec of specs) {
          choices.push(spec);
          if (spec.kind === "pick") for (const option of spec.options) take(option.grants, option.choices, false);
        }
      };
      for (const level of species.levels) take(level.grants, level.choices, true);
      for (const entry of reference.traits) {
        const audit = SPECIES_COVERAGE[speciesTraitKey(reference.key, entry.name)]!;
        const mine = features.filter(({ feature }) => feature.source?.slug === `srd-2024_${species.id.replace("srd:species:", "")}:${entry.name}`);
        const slug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const asked = choices.some((spec) => spec.id === slug || ("label" in spec && spec.label?.startsWith(entry.name)));
        if (!mine.length && !asked) problems.push(`${reference.name}: ${entry.name} isn't given`);
        for (const { feature, top } of mine) if (top && !agrees(feature, audit.verdict)) problems.push(`${reference.name}: ${entry.name} is ${feature.automationSupport} but the audit says ${audit.verdict}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("names only spells the library has", () => {
    const missing: string[] = [];
    const walk = (grants: FeatureGrant[], specs: ChoiceSpec[] = []) => {
      for (const grant of grants) {
        for (const id of [...(grant.spells ?? []), ...(grant.freeCasts ?? []).map((free) => free.spell)]) if (!SRD_BUILDER_LIBRARY.spell!(id)) missing.push(id);
      }
      for (const spec of specs) if (spec.kind === "pick") for (const option of spec.options) walk(option.grants, option.choices);
    };
    for (const species of SRD_2024_CATALOG.species) for (const level of species.levels) walk(level.grants, level.choices);
    expect(missing).toEqual([]);
  });

  it("builds every species at every level with its suggestions, without warnings or open choices", { timeout: 60000 }, () => {
    for (const species of SRD_2024_CATALOG.species) {
      for (const level of [1, 3, 5, 11, 20]) {
        const built = buildCharacter(quickBuild(sources, { classId: "srd:class:wizard", level, speciesId: species.id }), sources);
        expect(built.warnings, `${species.id} ${level}`).toEqual([]);
        expect(built.choices.filter((slot) => slot.pending).map((slot) => slot.path.join("/")), `${species.id} ${level}`).toEqual([]);
      }
    }
  });
});

describe("each species", () => {
  it("sets size, speed and senses", () => {
    expect(actor(quick("gnome"))).toMatchObject({ size: "small", speed: 30, senses: { darkvision: 60 } });
    expect(actor(quick("goliath")).speed).toBe(35);
    expect(actor(quick("dwarf")).senses).toEqual({ darkvision: 120 });
    expect(actor(quick("halfling")).size).toBe("small");
    const human = withSuggestions({ ...quick("human"), species: { id: "srd:species:human", size: "small" } }, sources);
    expect(actor(human).size).toBe("small");
  });

  it("Dragonborn: a breath weapon of its ancestor's type, DC 8 + Con + proficiency, proficiency-bonus uses, growing with level", () => {
    const red = actor(choose(quick("dragonborn", 5), "draconic-ancestry", ["red"]));
    const cone = action(red, "Breath Weapon (cone)");
    expect(cone).toMatchObject({
      kind: "area-save", saveAbility: "dex", dcFormula: { base: 8, ability: "con", proficiency: true },
      area: { type: "cone", size: 15 }, damage: [{ dice: "1d10", damageType: "fire", scaling: { mode: "cantrip-by-level" } }],
      resourceCost: { resourceId: "breath-weapon" }
    });
    expect(action(red, "Breath Weapon (line)")).toMatchObject({ area: { type: "rectangle", size: 30, width: 5 } });
    expect(red.resources?.["breath-weapon"]).toBe(3);
    expect(trait(red, "Damage Resistance").effects?.[0]).toMatchObject({ adjustment: { type: "resistance", damageType: "fire" } });
  });

  it("Dwarf: resistant to poison, and a hit point per level", () => {
    const dwarf = actor(quick("dwarf", 5));
    const plain = actor(quickBuild(sources, { classId: "srd:class:fighter", level: 5 }));
    expect(dwarf.maxHp - plain.maxHp).toBe(5);
    expect(trait(dwarf, "Dwarven Resilience").effects).toEqual([
      { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "poison" } },
      { kind: "save-advantage", against: { conditions: ["poisoned"] } }
    ]);
  });

  it("Elf: its lineage's cantrip, and spells at 3rd and 5th level cast once free with the ability chosen", () => {
    let wood = choose(quick("elf", 5, "srd:class:fighter"), "elven-lineage", ["wood-elf"]);
    wood = choose(wood, "spellcasting-ability", ["wis"]);
    const elf = actor(wood);
    expect(elf.speed).toBe(35);
    expect(elf.spells!.map((entry) => entry.name).sort()).toEqual(["Druidcraft", "Longstrider (free)", "Pass without Trace (free)"]);
    expect(elf.spellcasting).toEqual({ ability: "wis" });
    expect(actor(choose(quick("elf", 2), "elven-lineage", ["drow"])).senses).toEqual({ darkvision: 120 });
    expect(actor(choose(quick("elf", 2), "elven-lineage", ["drow"])).spells!.map((entry) => entry.name)).toEqual(["Dancing Lights"]);
  });

  it("Gnome: advantage on mental saves; a forest gnome casts Speak with Animals free, proficiency-bonus times", () => {
    const gnome = actor(choose(quick("gnome", 5), "gnomish-lineage", ["forest-gnome"]));
    expect(trait(gnome, "Gnomish Cunning").effects?.[0]).toMatchObject({ kind: "save-advantage", abilities: ["int", "wis", "cha"] });
    expect(gnome.resources?.["speak-with-animals-free-casts"]).toBe(3);
  });

  it("Human: a skill, an origin feat, and the size chosen", () => {
    const built = buildCharacter(quick("human"), sources);
    expect(built.choices.find((slot) => slot.path[0] === "skillful")?.value).toHaveLength(1);
    expect(built.choices.find((slot) => slot.path[0] === "versatile")?.value).toEqual({ feat: "srd:feat:skilled" });
    expect(built.features.some((entry) => entry.key.startsWith("feat:srd:feat:skilled@species"))).toBe(true);
  });

  it("Tiefling: a legacy's resistance, cantrip and spells, and Thaumaturgy", () => {
    const infernal = actor(choose(quick("tiefling", 5, "srd:class:warlock"), "fiendish-legacy", ["infernal"]));
    expect(trait(infernal, "Fiendish Legacy: Infernal").effects?.[0]).toMatchObject({ adjustment: { damageType: "fire" } });
    expect(infernal.spells!.map((entry) => entry.name)).toEqual(expect.arrayContaining(["Fire Bolt", "Thaumaturgy", "Hellish Rebuke (free)"]));
  });

  it("a species' skill counts as had when the class's skills are chosen", () => {
    const built = buildCharacter(choose(quick("elf"), "keen-senses", ["perception"]), sources);
    const classSkills = built.choices.find((slot) => slot.path[0] === "class-skills")!;
    expect(classSkills.options.find((option) => option.id === "perception")?.taken).toBe(true);
  });
});

describe("species traits in a fight", () => {
  it("Relentless Endurance: an orc drops to 1 hit point instead of 0, once", () => {
    const orc = actor(quick("orc", 3));
    const state = fightWith(orc);
    const token = () => state.snapshot.combatants.find((entry) => entry.id === "pc-fighter")!;
    const scimitar = getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-goblin")!).find((entry) => entry.kind === "attack" && entry.attackType === "melee")!;
    token().currentHp = 2;
    state.rng = scripted([20, 6]);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", scimitar.id);
    expect(token().currentHp).toBe(1);
    expect(token().resources?.["relentless-endurance"]).toBe(0);
    state.snapshot.combatants.find((entry) => entry.id === "enemy-goblin-1")!.actionEconomy = undefined;
    state.rng = scripted([20, 6]);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", scimitar.id);
    expect(token().currentHp).toBe(0);
  });

  it("Storm's Thunder: a goliath hit by an attack answers with 1d8 thunder, without a roll", () => {
    const goliath = actor(choose(quick("goliath", 3), "giant-ancestry", ["storm"]));
    expect(goliath.resources?.["giant-ancestry"]).toBe(2);
    const state = fightWith(goliath);
    const goblin = state.snapshot.combatants.find((entry) => entry.id === "enemy-goblin-1")!;
    const scimitar = getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-goblin")!).find((entry) => entry.kind === "attack" && entry.attackType === "melee")!;
    const before = goblin.currentHp;
    state.rng = scripted([20, 3, 6]);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", scimitar.id);
    expect(state.log.some((entry) => entry.type === "ActionDeclared" && entry.data?.actionName === "Storm's Thunder")).toBe(true);
    expect(goblin.currentHp).toBeLessThan(before);
    expect(state.snapshot.combatants.find((entry) => entry.id === "pc-fighter")!.resources?.["giant-ancestry"]).toBe(1);
  });
});
