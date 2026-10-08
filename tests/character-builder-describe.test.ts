import { describe, expect, it } from "vitest";
import {
  buildCharacter,
  describeBackground,
  describeClass,
  describeMastery,
  describeOption,
  describeSkill,
  describeSpecies,
  describeSpell,
  hitPointRows,
  quickBuild,
  scoreRows,
  spellFacts,
  type BackgroundDefinition
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { SKILLS } from "@/lib/actor-sheet/edits";
import { MASTERY_TEXT, SKILL_TEXT_2014, SKILL_TEXT_2024 } from "@/data/srd/rules-text";

// CHARACTER_BUILDER_UX_PLAN.md Phase 1: what the rules cards say, worked out from the records the builder applies.

const S = SRD_BUILD_SOURCES;
const background = (id: string) => S.catalog.backgrounds.find((entry) => entry.id === id)!;
const species = (id: string) => S.catalog.species.find((entry) => entry.id === id)!;
const give = (entry: { gives: Array<{ label: string; value: string }> }, label: string) => entry.gives.find((row) => row.label === label)?.value;

describe("what a background gives, per edition", () => {
  it("a 2024 background: three abilities, an origin feat, skills, a tool and its packages", () => {
    const sage = describeBackground(background("srd:background:sage"), S);
    expect(sage.edition).toBe("2024");
    expect(give(sage, "Ability scores")).toBe("CON, INT, WIS: +2 and +1, or +1 to all three");
    expect(give(sage, "Origin feat")).toBe("Magic Initiate (Wizard)");
    expect(give(sage, "Skills")).toBe("Arcana, History");
    expect(give(sage, "Tool")).toBe("Calligrapher's Supplies");
    expect(give(sage, "Equipment")).toMatch(/^A: A quarterstaff.*; or B: 50 GP$/);
    expect(sage.text).toContain("Magic Initiate (Wizard).");
  });

  it("a 2014 background: its feature, and no ability increases (they come from the race)", () => {
    const acolyte = describeBackground(background("srd:background:acolyte-2014"), S);
    expect(acolyte.edition).toBe("2014");
    expect(give(acolyte, "Feature")).toBe("Shelter of the Faithful");
    expect(give(acolyte, "Ability scores")).toBe("None: under the 2014 rules they come from your race");
    expect(give(acolyte, "Origin feat")).toBeUndefined();
    expect(acolyte.text).toMatch(/Shelter of the Faithful|As an acolyte/);
  });

  it("a homebrew background without a description still says what it gives", () => {
    const homebrew: BackgroundDefinition = {
      id: "homebrew:background:hermit", name: "Hermit", source: { provider: "homebrew" }, edition: "2024",
      abilities: ["con", "wis", "cha"], skills: ["medicine", "religion"], feat: "srd:feat:magic-initiate"
    };
    const hermit = describeBackground(homebrew, S);
    expect(hermit.source).toBe("Homebrew");
    expect(give(hermit, "Ability scores")).toBe("CON, WIS, CHA: +2 and +1, or +1 to all three");
    expect(give(hermit, "Skills")).toBe("Medicine, Religion");
    expect(give(hermit, "Origin feat")).toBe("Magic Initiate");
  });
});

describe("what a species or race gives, per edition", () => {
  it("the 2024 Dwarf: no increases (they come from the background), 30 ft, darkvision 120", () => {
    const dwarf = describeSpecies(species("srd:species:dwarf"), S);
    expect(dwarf.subtitle).toBe("Species");
    expect(give(dwarf, "Speed")).toBe("30 ft");
    expect(give(dwarf, "Senses")).toBe("Darkvision 120 ft");
    expect(give(dwarf, "Ability scores")).toBe("None: under the 2024 rules they come from your background");
    expect(give(dwarf, "Traits")).toContain("Dwarven Toughness");
  });

  it("the 2014 Dwarf: +2 CON, 25 ft, darkvision 60, and its subrace", () => {
    const dwarf = describeSpecies(species("srd:species:dwarf-2014"), S);
    expect(dwarf.subtitle).toBe("Race");
    expect(give(dwarf, "Ability scores")).toBe("+2 CON");
    expect(give(dwarf, "Speed")).toBe("25 ft");
    expect(give(dwarf, "Senses")).toBe("Darkvision 60 ft");
    expect(give(dwarf, "Subrace")).toBe("Hill Dwarf (+1 WIS)");
  });

  it("the Half-Elf's increases of the player's choice", () => {
    const halfElf = describeSpecies(species("srd:species:half-elf-2014"), S);
    expect(give(halfElf, "Ability scores")).toBe("+2 CHA, +1 to 2 others of your choice");
  });
});

describe("rules text", () => {
  it("every skill has text in both editions, and every mastery property has its text", () => {
    for (const skill of SKILLS) {
      expect(SKILL_TEXT_2024[skill.id], skill.id).toBeTruthy();
      expect(SKILL_TEXT_2014[skill.id], skill.id).toBeTruthy();
      expect(describeSkill(skill.id, "2014").text).toBe(SKILL_TEXT_2014[skill.id]);
    }
    expect(Object.keys(MASTERY_TEXT).sort()).toEqual(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]);
    const longsword = describeMastery("longsword", S);
    expect(give(longsword, "Mastery")).toBe("Sap");
    expect(longsword.text).toContain("Disadvantage on its next attack roll");
  });

  it("a spell: its facts, its effect, its text and whether it runs", () => {
    const fireball = describeSpell("srd:spell:fireball-2024", S);
    expect(fireball.subtitle).toBe("3rd-level evocation");
    expect(fireball.facts.slice(0, 2)).toEqual(["Action", "150 feet"]);
    expect(fireball.effect).toBe("DEX save · 8d6 fire · 20-ft sphere");
    expect(fireball.support).toBe("full");
    expect(fireball.tone).toBe("fire");
    expect(fireball.higherLevels).toMatch(/1d6/);
    expect(spellFacts("srd:spell:fireball-2024", S)).toMatchObject({ level: 3, school: "evocation", cost: "action", tone: "fire", concentration: false });
    expect(spellFacts("srd:spell:shield-2024", S)?.cost).toBe("reaction");
  });

  it("a class: its hit die, saves, training and when its subclass comes", () => {
    const wizard = describeClass(S.catalog.classes.find((entry) => entry.id === "srd:class:wizard")!);
    expect(give(wizard, "Hit die")).toBe("d6");
    expect(give(wizard, "Saving throws")).toBe("Intelligence, Wisdom");
    expect(give(wizard, "Spellcasting")).toBe("Full caster (Intelligence)");
    expect(wizard.summary).toBeTruthy();
  });
});

describe("every option of every SRD class describes itself", () => {
  it("at level 20, in both editions: a title, and words to show", () => {
    const empty: string[] = [];
    for (const classDefinition of S.catalog.classes) {
      const built = buildCharacter(quickBuild(S, { classId: classDefinition.id, level: 20 }), S);
      for (const slot of built.choices) {
        for (const option of slot.options) {
          const card = describeOption(slot, option, S, classDefinition.edition);
          expect(card.title, `${classDefinition.id} ${slot.spec.kind} ${option.id}`).toBeTruthy();
          if (slot.spec.kind !== "abilities" && !card.text && !card.summary && card.gives.length === 0) empty.push(`${classDefinition.id}: ${slot.spec.kind} ${option.id}`);
        }
      }
    }
    expect(empty).toEqual([]);
  }, 180_000);
});

describe("where things came from", () => {
  const build = quickBuild(S, { classId: "srd:class:wizard", level: 5, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" });
  const built = buildCharacter(build, S);

  it("each feature knows the level it came at and what gave it", () => {
    const at = (name: string) => built.features.find((entry) => entry.feature.name === name);
    expect(at("Memorize Spell")).toMatchObject({ gainedAt: 5, ownerName: "Wizard" });
    expect(at("Potent Cantrip")).toMatchObject({ gainedAt: 3, ownerName: "Evoker" });
    expect(at("Dwarven Toughness")).toMatchObject({ gainedAt: 1, ownerName: "Dwarf" });
    expect(at("Magic Initiate")?.gainedAt).toBeUndefined();
  });

  it("hit points, level by level, with Dwarven Toughness", () => {
    const rows = hitPointRows(built.breakdown, built.fields.maxHp);
    expect(rows).toEqual([
      { label: "Level 1 (Wizard)", value: "d6 at its most, 6, CON +2 = 8" },
      { label: "Levels 2–5 (Wizard)", value: "d6 average, 4, CON +2 = 6 each" },
      { label: "Dwarven Toughness", value: "+5" },
      { label: "Maximum", value: "37" }
    ]);
  });

  it("a score: its base, each increase and what gave it", () => {
    expect(scoreRows("int", build.abilities.base.int, built.breakdown, built.fields.abilities.int)).toEqual([
      { label: "Base", value: "15" },
      { label: "Sage", value: "+2" },
      { label: "Ability Score Improvement (level 4)", value: "+2" },
      { label: "Score", value: "19" },
      { label: "Modifier", value: "+4" }
    ]);
  });
});
