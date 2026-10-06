import { describe, expect, it } from "vitest";
import {
  buildCharacter,
  buildLabel,
  multiclassProblems,
  quickBuild,
  withLevelUp,
  withSuggestions,
  type CharacterBuild
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/** PC builder plan, Phase 9a: a level in a second class (D11). */

const sources = SRD_BUILD_SOURCES;
const rogue3 = () => quickBuild(sources, { classId: "srd:class:rogue", level: 3 });
const plus = (build: CharacterBuild, classId: string) => withSuggestions(withLevelUp(build, classId), sources);

describe("multiclass prerequisites", () => {
  it("need 13 in the new class's primary ability and the current ones'; one of the Fighter's is enough", () => {
    const build = rogue3();
    const scores = buildCharacter(build, sources).fields.abilities;
    expect(scores.dex).toBeGreaterThanOrEqual(13);
    expect(multiclassProblems(build, "srd:class:fighter", sources)).toEqual([]);
    expect(multiclassProblems(build, "srd:class:wizard", sources)).toEqual(scores.int >= 13 ? [] : [`Wizard needs Intelligence 13 (it has ${scores.int})`]);
    // Both of the Monk's.
    const monk = multiclassProblems(build, "srd:class:monk", sources);
    if (scores.wis < 13) expect(monk).toEqual([`Monk needs Wisdom 13 (it has ${scores.wis})`]);
    // A class it has already: nothing to check.
    expect(multiclassProblems(build, "srd:class:rogue", sources)).toEqual([]);
  });

  it("check the current classes too: a Wizard with Strength and Dexterity under 13 can't easily leave", () => {
    const wizard = quickBuild(sources, { classId: "srd:class:wizard", level: 2, abilities: { method: "manual", base: { str: 8, dex: 12, con: 14, int: 15, wis: 12, cha: 8 } } });
    const scores = buildCharacter(wizard, sources).fields.abilities;
    expect(multiclassProblems(wizard, "srd:class:fighter", sources)).toEqual([`Fighter needs Strength 13 or Dexterity 13 (it has Strength ${scores.str}, Dexterity ${scores.dex})`]);
  });
});

describe("a second class", () => {
  it("adds its level 1 features, keeps the first class's saves, and its hit die counts as the average", () => {
    const build = plus(rogue3(), "srd:class:fighter");
    const built = buildCharacter(build, sources);
    expect(built.warnings).toEqual([]);
    expect(built.fields.classes.map((entry) => [entry.name, entry.level])).toEqual([["Rogue", 3], ["Fighter", 1]]);
    expect(built.fields.saves).toEqual(buildCharacter(rogue3(), sources).fields.saves);
    const names = built.features.map((entry) => entry.feature.name);
    expect(names).toEqual(expect.arrayContaining(["Sneak Attack", "Second Wind"]));
    const con = Math.floor((built.fields.abilities.con - 10) / 2);
    expect(built.fields.maxHp - buildCharacter(rogue3(), sources).fields.maxHp).toBe(6 + con);
    expect(buildLabel(build, sources)).toMatch(/^Rogue 3 \(Thief\) \/ Fighter 1 · /);
  });

  it("a Rogue, Bard or Ranger taken later asks for one skill from its list; a Fighter taken later doesn't", () => {
    const fighter = quickBuild(sources, { classId: "srd:class:fighter", level: 2 });
    const intoRogue = buildCharacter(plus(fighter, "srd:class:rogue"), sources);
    const skill = intoRogue.choices.find((slot) => slot.path.join("/") === "multiclass-skills");
    expect(skill?.spec).toMatchObject({ kind: "skills", count: 1 });
    expect(skill?.pending).toBe(false);
    const intoFighter = buildCharacter(plus(rogue3(), "srd:class:fighter"), sources);
    expect(intoFighter.choices.some((slot) => slot.path.join("/") === "multiclass-skills")).toBe(false);
  });

  it("casters combine their slots: a Wizard 3 / Cleric 2 casts as a 5th-level caster", () => {
    let build = quickBuild(sources, { classId: "srd:class:wizard", level: 3 });
    build = plus(plus(build, "srd:class:cleric"), "srd:class:cleric");
    const slots = buildCharacter(build, sources).resources;
    expect([1, 2, 3].map((level) => slots[`slot-${level}`] ?? 0)).toEqual([4, 3, 2]);
  });
});
