import { describe, expect, it } from "vitest";
import {
  BUILDER_STEPS,
  buildCharacter,
  firstOpenStep,
  openChoices,
  startBuild,
  stepOf,
  withChoice,
  withSuggestions,
  type ChoiceSlot
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

// CHARACTER_BUILDER_UX_PLAN.md D2: which step of the builder each choice is made on, and how many each has open.

const choicesOf = (options: Parameters<typeof startBuild>[1]) => buildCharacter(startBuild(SRD_BUILD_SOURCES, options), SRD_BUILD_SOURCES).choices;
const where = (choices: readonly ChoiceSlot[], test: (slot: ChoiceSlot) => boolean) => choices.filter(test).map(stepOf);

describe("the builder's steps", () => {
  it("are six, in order", () => {
    expect(BUILDER_STEPS.map((step) => step.label)).toEqual(["Class", "Origin", "Abilities", "Spells", "Equipment", "Review"]);
  });

  it("put spells on Spells, wherever they come from, and a level's other choices on Class", () => {
    // A 2024 Wizard 5 with the Sage (Magic Initiate) and the Dwarf.
    const choices = choicesOf({ classId: "srd:class:wizard", level: 5, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" });
    const spells = choices.filter((slot) => slot.spec.kind === "spells");
    expect(spells.some((slot) => slot.scope.kind === "level")).toBe(true);
    expect(spells.some((slot) => slot.scope.kind === "background")).toBe(true);
    expect(new Set(spells.map(stepOf))).toEqual(new Set(["spells"]));
    // Skills and the subclass are the class's.
    expect(new Set(where(choices, (slot) => slot.scope.kind === "level" && slot.spec.kind !== "spells"))).toEqual(new Set(["class"]));
    // The background's ability increases are Abilities'; its other choices Origin's.
    expect(where(choices, (slot) => slot.scope.kind === "background" && slot.spec.kind === "abilities")).toEqual(["abilities"]);
    expect(new Set(where(choices, (slot) => slot.scope.kind !== "level" && slot.spec.kind !== "spells" && slot.spec.kind !== "abilities"))).toEqual(new Set(["origin"]));
  });

  it("keep an Ability Score Improvement's points with its feat, on Class", () => {
    const build = withSuggestions(startBuild(SRD_BUILD_SOURCES, { classId: "srd:class:fighter", level: 4 }), SRD_BUILD_SOURCES);
    const points = buildCharacter(build, SRD_BUILD_SOURCES).choices.filter((slot) => slot.scope.kind === "level" && slot.spec.kind === "abilities");
    expect(points.length).toBeGreaterThan(0);
    expect(new Set(points.map(stepOf))).toEqual(new Set(["class"]));
  });

  it("count each step's open choices, and the first step with one", () => {
    const fresh = choicesOf({ classId: "srd:class:wizard", level: 5, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" });
    const counts = openChoices(fresh);
    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(fresh.filter((slot) => slot.pending).length);
    expect(counts.review).toBe(0);
    expect(counts.class).toBeGreaterThan(0);
    expect(counts.spells).toBeGreaterThan(0);
    expect(firstOpenStep(fresh)).toBe("class");

    // Everything suggested, then one cantrip taken back: Spells is the only step left.
    const build = withSuggestions(startBuild(SRD_BUILD_SOURCES, { classId: "srd:class:wizard", level: 5, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" }), SRD_BUILD_SOURCES);
    const made = buildCharacter(build, SRD_BUILD_SOURCES).choices;
    expect(firstOpenStep(made)).toBeUndefined();
    const cantrips = made.find((slot) => slot.spec.kind === "spells" && slot.scope.kind === "level" && Array.isArray(slot.value) && slot.value.length > 1)!;
    const fewer = withChoice(build, cantrips.scope, cantrips.path, (cantrips.value as string[]).slice(1), cantrips.spec);
    const after = buildCharacter(fewer, SRD_BUILD_SOURCES).choices;
    expect(openChoices(after)).toEqual({ class: 0, origin: 0, abilities: 0, spells: 1, equipment: 0, review: 0 });
    expect(firstOpenStep(after)).toBe("spells");
  });
});
