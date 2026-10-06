import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adoptionBuild,
  buildLabel,
  matchClass,
  mergeCatalog,
  readBuild,
  rebuildActor,
  sameNamedAbilities,
  withoutAbilities
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { creatureDefinitionSchema, parseCombatantPackage, type CreatureDefinition } from "@/engine";
import { PARTY_HOMEBREW } from "./fixtures/homebrew/party";

/** PC builder plan, Phase 9b: rebuilding a hand-built PC with the builder (D10), on the party's own actors. */

const actor = (file: string): CreatureDefinition => parseCombatantPackage(JSON.parse(readFileSync(file, "utf-8"))).definition;
const sources = mergeCatalog(SRD_BUILD_SOURCES, PARTY_HOMEBREW);

describe("rebuilding a hand-built PC", () => {
  it("matches its class by name, keeps its scores and hit point maximum, and adds no starting gear", () => {
    const barbarian = actor("barbarian-template.json");
    expect(matchClass("barbarian", sources)?.id).toBe("srd:class:barbarian");
    const adoption = adoptionBuild(barbarian, sources)!;
    expect(adoption.notes).toEqual([]);
    expect(adoption.build.levels).toHaveLength(6);
    const { definition } = rebuildActor(barbarian, adoption.build, sources);
    expect(definition.abilities).toEqual(barbarian.abilities);
    expect(definition.maxHp).toBe(barbarian.maxHp);
    expect(definition.weapons?.map((weapon) => weapon.name)).toEqual(barbarian.weapons?.map((weapon) => weapon.name));
    expect(definition.name).toBe(barbarian.name);
    expect(creatureDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(readBuild(definition)?.levels).toHaveLength(6);
  });

  it("lists the hand-made abilities named like the builder's, and can take them away", () => {
    const barbarian = actor("barbarian-template.json");
    const { definition } = rebuildActor(barbarian, adoptionBuild(barbarian, sources)!.build, sources);
    const twins = sameNamedAbilities(definition);
    expect(twins.map((record) => record.name).sort()).toEqual(["Attack", "Danger Sense", "Extra Attack", "Fast Movement", "Rage", "Reckless Attack", "Unarmored Defense"]);
    const cleaned = withoutAbilities(definition, twins);
    expect(sameNamedAbilities(cleaned)).toEqual([]);
    // The builder's versions stay, and so does the hand-made +1 Greataxe.
    expect(cleaned.features?.filter((feature) => feature.name === "Rage")).toHaveLength(1);
    expect(cleaned.weapons?.map((weapon) => weapon.name)).toEqual(["+1 Greataxe"]);
  });

  it("chooses a subclass it can match (the party's Arcane Trickster, homebrew), at its level", () => {
    const trickster = actor("arcane-trickster.party.json");
    const adoption = adoptionBuild(trickster, sources)!;
    expect(adoption.notes).toEqual([]);
    expect(adoption.build.levels[2]?.choices.subclass).toBe("homebrew:subclass:arcane-trickster");
    const { definition } = rebuildActor(trickster, adoption.build, sources);
    expect(buildLabel(readBuild(definition)!, sources)).toMatch(/^Rogue 6 \(Arcane Trickster\)/);
    expect(definition.resources?.["slot-1"]).toBe(3);
    expect(definition.abilities).toEqual(trickster.abilities);
    // Without the homebrew, it says so and lets the builder suggest one.
    const plain = adoptionBuild(trickster, SRD_BUILD_SOURCES)!;
    expect(plain.notes).toEqual(["Arcane Trickster isn't a Rogue subclass the builder has: the builder suggests one"]);
  });

  it("puts a class the builder hasn't got on the class given, or has nothing to adopt without one", () => {
    const odd = { ...actor("barbarian-template.json"), character: { level: 4, classes: [{ name: "Spellsword", level: 4 }] } } as CreatureDefinition;
    expect(adoptionBuild(odd, SRD_BUILD_SOURCES)).toBeUndefined();
    const adopted = adoptionBuild(odd, SRD_BUILD_SOURCES, "srd:class:fighter")!;
    expect(adopted.notes).toEqual(["Spellsword isn't a class the builder has: its levels go to Fighter"]);
    expect(adopted.build.levels.map((level) => level.classId)).toEqual(Array(4).fill("srd:class:fighter"));
    const classless = { ...odd, character: { level: 3 } } as CreatureDefinition;
    expect(adoptionBuild(classless, SRD_BUILD_SOURCES, "srd:class:wizard")!.build.levels).toHaveLength(3);
  });
});
