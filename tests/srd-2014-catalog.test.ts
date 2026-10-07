import { describe, expect, it } from "vitest";
import { creatureDefinitionSchema, getExecutableActions, sampleEncounter, type ActionDefinition } from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";
import { SRD_2014_CATALOG } from "@/data/srd/2014";
import {
  backgroundDefinitionSchema,
  blankCharacter,
  buildCharacter,
  classDefinitionSchema,
  featDefinitionSchema,
  quickBuild,
  readBuild,
  rebuildActor,
  speciesDefinitionSchema,
  subclassDefinitionSchema,
  withChoice,
  withLevelUp,
  withSuggestions
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { editionOf } from "@/lib/editions";

/** EDITIONS_PLAN.md Phases 6 to 9: the 2014 catalog, built and fought with. */

const sources = SRD_BUILD_SOURCES;

describe("the 2014 catalog", () => {
  it("passes the catalog's schemas, each entry coming back exactly as it went in", () => {
    const roundTrips = (schema: { parse(value: unknown): unknown }, entries: Array<{ id: string }>) => {
      for (const entry of entries) {
        const json = JSON.parse(JSON.stringify(entry));
        expect(schema.parse(json), entry.id).toEqual(json);
      }
    };
    roundTrips(classDefinitionSchema, SRD_2014_CATALOG.classes);
    roundTrips(subclassDefinitionSchema, SRD_2014_CATALOG.subclasses);
    roundTrips(featDefinitionSchema, SRD_2014_CATALOG.feats);
    roundTrips(backgroundDefinitionSchema, SRD_2014_CATALOG.backgrounds);
    roundTrips(speciesDefinitionSchema, SRD_2014_CATALOG.species);
  });

  it("is all 2014, under ids that never meet a 2024 entry's, in the builder beside the 2024 catalog", () => {
    const { classes, subclasses, feats, backgrounds, species } = SRD_2014_CATALOG;
    for (const entry of [...classes, ...subclasses, ...feats, ...backgrounds, ...species]) {
      expect(entry.edition, entry.id).toBe("2014");
      expect(editionOf(entry.source), entry.id).toBe("2014");
      expect(entry.id, entry.id).toMatch(/-2014$/);
      expect(sources.catalog[classes.includes(entry as never) ? "classes" : subclasses.includes(entry as never) ? "subclasses" : feats.includes(entry as never) ? "feats" : backgrounds.includes(entry as never) ? "backgrounds" : "species"].some((candidate: { id: string }) => candidate.id === entry.id)).toBe(true);
    }
    for (const subclass of subclasses) expect(classes.some((entry) => entry.id === subclass.classId), subclass.id).toBe(true);
  });

  it("levels every 2014 class from 1 to 20 into a valid actor, which the AI fights with using only legal actions", { timeout: 180000 }, () => {
    const problems: string[] = [];
    for (const definition of SRD_2014_CATALOG.classes) {
      let build = quickBuild(sources, { classId: definition.id, level: 1 });
      let actor = rebuildActor(blankCharacter("def-fighter", definition.name), build, sources).definition;
      for (let level = 1; level <= 20; level += 1) {
        if (level > 1) {
          build = withSuggestions(withLevelUp(readBuild(actor)!), sources);
          actor = rebuildActor(actor, build, sources).definition;
        }
        const built = buildCharacter(build, sources);
        for (const warning of built.warnings) problems.push(`${definition.id} ${level}: ${warning}`);
        const parsed = creatureDefinitionSchema.safeParse(actor);
        if (!parsed.success) problems.push(`${definition.id} ${level}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
        if (level % 4 !== 1 && level !== 20) continue;
        const snapshot = structuredClone(sampleEncounter);
        snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), actor];
        for (const token of snapshot.combatants) {
          if (token.id === "pc-fighter") { token.currentHp = actor.maxHp; token.resources = { ...(actor.resources ?? {}) }; }
        }
        const result = runAutomatedEncounter({ ...snapshot, seed: `${definition.id}-${level}` }, 6);
        for (const warning of result.outcome.warnings) problems.push(`${definition.id} ${level}: ${warning}`);
      }
      // No Epic Boon: its 19th level is an Ability Score Improvement.
      expect(buildCharacter(readBuild(actor)!, sources).choices.some((slot) => slot.spec.id === "epic-boon"), definition.id).toBe(false);
    }
    expect(problems).toEqual([]);
  });
});

describe("the first 2014 characters (Phase 6)", () => {
  it("a 2014 Fighter 5, Hill Dwarf, Acolyte: the race's increases, the 2014 features, the line-by-line equipment", () => {
    let build = quickBuild(sources, { classId: "srd:class:fighter-2014", level: 5, backgroundId: "srd:background:acolyte-2014", speciesId: "srd:species:dwarf-2014", abilities: { method: "standard-array", base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } } });
    build = withChoice(build, { kind: "species" }, ["subrace"], ["hill-dwarf"]);
    const built = buildCharacter(build, sources);
    expect(built.warnings).toEqual([]);
    // +2 Constitution (Dwarf) and +1 Wisdom (Hill Dwarf); the 4th level ASI's +2 Strength (the suggestion).
    expect(built.fields.abilities).toMatchObject({ con: 16, wis: 13, str: 17 });
    // Hit points: 10 + 4 × 6, +3 Constitution a level, +1 a level (Dwarven Toughness).
    expect(built.fields.maxHp).toBe(10 + 4 * 6 + 5 * 3 + 5);
    expect(built.fields.speed).toBe(25);
    const names = built.features.map((entry) => entry.feature.name);
    expect(names).toEqual(expect.arrayContaining(["Second Wind", "Action Surge", "Extra Attack", "Improved Critical", "Dwarven Resilience", "Dwarven Toughness", "Shelter of the Faithful", "Defense"]));
    expect(names).not.toContain("Weapon Mastery");
    expect(names).not.toContain("Tactical Mind");
    const secondWind = built.features.find((entry) => entry.feature.name === "Second Wind")!.feature;
    expect((secondWind.grantedActions![0] as Extract<ActionDefinition, { kind: "healing" }>).healing[0]!.dice).toBe("1d10+5");
    expect(built.resources).toMatchObject({ "second-wind": 1, "action-surge": 1 });
    expect(built.masteries).toEqual([]);
    expect(built.equipment.map((entry) => entry.ref).sort()).toEqual(["srd:item:chain-mail", "srd:item:shield", "srd:weapon:light-crossbow", "srd:weapon:longsword"]);
    // The features' ids keep the class's plain name.
    expect(built.features.find((entry) => entry.feature.name === "Second Wind")!.feature.id).toBe("fighter-second-wind");
  });

  it("a 2014 Champion's later features: Remarkable Athlete on initiative, Superior Critical, Survivor", () => {
    const built = buildCharacter(quickBuild(sources, { classId: "srd:class:fighter-2014", level: 18 }), sources);
    const feature = (name: string) => built.features.find((entry) => entry.feature.name === name)?.feature;
    // Proficiency bonus +6: half, rounded up, is 3.
    expect(feature("Remarkable Athlete")!.effects).toEqual([{ kind: "initiative", bonus: { base: 3 } }]);
    expect(feature("Superior Critical")!.effects![0]).toMatchObject({ kind: "critical-range", minimum: 18 });
    expect(feature("Improved Critical")).toBeUndefined();
    expect(feature("Survivor")!.effects![0]).toMatchObject({ kind: "hp-regen", whileBloodied: true });
    expect(feature("Extra Attack (three attacks)")).toBeDefined();
  });

  it("a 2014 Rogue: Sneak Attack by its table, Stroke of Luck a hit, and none of the 2024 rogue's", () => {
    const built = buildCharacter(quickBuild(sources, { classId: "srd:class:rogue-2014", level: 20 }), sources);
    const names = built.features.map((entry) => entry.feature.name);
    expect(names).not.toEqual(expect.arrayContaining(["Cunning Strike"]));
    expect(names).not.toContain("Steady Aim");
    const sneak = built.features.find((entry) => entry.feature.name === "Sneak Attack")!.feature;
    expect((sneak.effects![0] as { damage: Array<{ dice: string }> }).damage[0]!.dice).toBe("10d6");
    expect(built.features.find((entry) => entry.feature.name === "Stroke of Luck")!.feature.effects).toEqual([
      { kind: "d20-change", rolls: ["attack"], change: "hit", resourceCost: { resourceId: "stroke-of-luck", amount: 1 } }
    ]);
    // Slippery Mind: Wisdom saves only (2024 adds Charisma).
    expect(Object.keys(built.fields.saves).sort()).toEqual(["dex", "int", "wis"]);
  });

  it("a 2014 Human takes +1 to every score; the Grappler wants Strength 13", () => {
    const built = buildCharacter(quickBuild(sources, { classId: "srd:class:rogue-2014", backgroundId: "srd:background:acolyte-2014", speciesId: "srd:species:human-2014", abilities: { method: "manual", base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } } }), sources);
    expect(built.fields.abilities).toEqual({ str: 11, dex: 11, con: 11, int: 11, wis: 11, cha: 11 });
    const grappler = SRD_2014_CATALOG.feats.find((feat) => feat.id === "srd:feat:grappler-2014")!;
    expect(grappler.prerequisite).toMatchObject({ abilities: { str: 13 } });
  });

  it("a 2014 Fighter's fighting styles are 2014's, and its Protection is a reaction", () => {
    const styles = SRD_2014_CATALOG.feats.filter((feat) => feat.category === "fighting-style").map((feat) => feat.name);
    expect(styles).toEqual(["Archery", "Defense", "Dueling", "Great Weapon Fighting", "Protection", "Two-Weapon Fighting"]);
    let build = quickBuild(sources, { classId: "srd:class:fighter-2014" });
    build = withChoice(build, { kind: "level", index: 0 }, ["fighting-style"], { feat: "srd:feat:protection-2014" });
    const actor = rebuildActor(blankCharacter("pc", "Guard"), build, sources).definition;
    const protection = getExecutableActions(actor).find((action) => action.name === "Protection")!;
    expect(protection).toMatchObject({ actionType: "reaction", reaction: { trigger: { kind: "ally-targeted-by-attack", withinFt: 5 } } });
  });
});
