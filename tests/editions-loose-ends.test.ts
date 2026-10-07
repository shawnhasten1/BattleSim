import { describe, expect, it } from "vitest";
import { open5eClassId } from "@/adapters";
import { sampleEncounter } from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";
import {
  adoptionBuild,
  blankCharacter,
  blankEntry,
  buildCharacter,
  epicBoonLevelOf,
  matchClass,
  quickParty,
  rebuildActor,
  type BackgroundDefinition,
  type ClassDefinition
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { editionTwin } from "@/lib/editions";

/** EDITIONS_PLAN.md Phase 11: the loose ends. */

const sources = SRD_BUILD_SOURCES;

describe("an Open5e 2014 subclass", () => {
  it("attaches to the bundled SRD 5.1 class: srd_fighter is srd:class:fighter-2014", () => {
    expect(open5eClassId("srd_fighter")).toBe("srd:class:fighter-2014");
    expect(open5eClassId("srd-2024_fighter")).toBe("srd:class:fighter");
    expect(open5eClassId("a5e_marshal")).toBe("open5e:class:a5e_marshal");
    expect(sources.catalog.classes.some((entry) => entry.id === open5eClassId("srd_warlock"))).toBe(true);
  });
});

describe("Rebuild with the builder, in an edition", () => {
  const handmade = { ...blankCharacter("pc", "Torvin"), character: { level: 5, classes: [{ name: "Fighter", level: 5 }] } };

  it("matches the class in the edition asked for, the first one otherwise", () => {
    expect(matchClass("Fighter", sources)?.id).toBe("srd:class:fighter");
    expect(matchClass("Fighter", sources, "2014")?.id).toBe("srd:class:fighter-2014");
    expect(matchClass("fighter", sources, "2024")?.id).toBe("srd:class:fighter");
  });

  it("a hand-built Fighter 5, rebuilt in 2014, is a 2014 Fighter 5 with its scores", () => {
    const adoption = adoptionBuild(handmade, sources, undefined, "2014")!;
    expect(adoption.build.levels.map((level) => level.classId)).toEqual(Array.from({ length: 5 }, () => "srd:class:fighter-2014"));
    expect(buildCharacter(adoption.build, sources).fields.abilities).toEqual(handmade.abilities);
  });
});

describe("a Quick party from both editions", () => {
  it("the other edition's version of an SRD class, and a homebrew one kept", () => {
    const classes = sources.catalog.classes;
    expect(editionTwin(classes, "srd:class:wizard", "2014")).toBe("srd:class:wizard-2014");
    expect(editionTwin(classes, "srd:class:wizard-2014", "2024")).toBe("srd:class:wizard");
    expect(editionTwin(classes, "srd:class:wizard", "2024")).toBe("srd:class:wizard");
    const homebrew = { id: "homebrew:class:spellsword", name: "Wizard", edition: "2024" as const, source: { provider: "homebrew" as const } };
    expect(editionTwin([...classes, homebrew], homebrew.id, "2014")).toBe(homebrew.id);
  });

  it("a party of a 2014 Fighter and Rogue with a 2024 Cleric and Wizard builds, and fights with legal actions", { timeout: 60000 }, () => {
    const party = quickParty(sources, ["srd:class:fighter-2014", "srd:class:cleric", "srd:class:rogue-2014", "srd:class:wizard"], 5);
    expect(party.map((member) => member.name)).toEqual(["Fighter", "Cleric", "Rogue", "Wizard"]);
    for (const member of party) expect(buildCharacter(member.build, sources).warnings, member.name).toEqual([]);
    const actors = party.map((member, index) => ({ ...rebuildActor(blankCharacter(`pc-${index}`, member.name), member.build, sources).definition, id: `def-party-${index}` }));
    const snapshot = structuredClone(sampleEncounter);
    snapshot.definitions = [...snapshot.definitions, ...actors];
    const template = snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    snapshot.combatants = [
      ...snapshot.combatants.filter((token) => token.faction !== "party"),
      ...actors.map((actor, index) => ({ ...structuredClone(template), id: `pc-${index}`, definitionId: actor.id, displayName: actor.name, currentHp: actor.maxHp, resources: { ...(actor.resources ?? {}) }, position: { x: 1, y: 1 + index * 2 } }))
    ];
    const result = runAutomatedEncounter({ ...snapshot, seed: "mixed-party" }, 8);
    expect(result.outcome.warnings).toEqual([]);
  });
});

describe("the homebrew editor's editions", () => {
  it("a new 2014 class has an Ability Score Improvement at 19th level and no Epic Boon; a 2024 one its Epic Boon", () => {
    const old = blankEntry("class", "Spellsword", [], undefined, "2014").entry as ClassDefinition;
    expect(old).toMatchObject({ edition: "2014", featLevels: [4, 8, 12, 16, 19] });
    expect(epicBoonLevelOf(old)).toBeUndefined();
    const current = blankEntry("class", "Spellsword", []).entry as ClassDefinition;
    expect(current).toMatchObject({ edition: "2024", featLevels: [4, 8, 12, 16] });
    expect(epicBoonLevelOf(current)).toBe(19);
  });

  it("a new 2014 background has no increases or feat; a 2014 subclass, feat and race are 2014", () => {
    const background = blankEntry("background", "Hermit", [], undefined, "2014").entry as BackgroundDefinition;
    expect(background.abilities).toBeUndefined();
    expect(background.feat).toBeUndefined();
    for (const kind of ["subclass", "feat", "species"] as const) expect(blankEntry(kind, "New", [], undefined, "2014").entry.edition).toBe("2014");
  });
});
