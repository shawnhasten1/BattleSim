// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActionDefinition, CreatureDefinition, FeatureDefinition } from "@/engine";
import { SRD_2024_FEATURES, findSrd2024Feature } from "@/data/srd/2024/feature-library";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { prepareLibrary, searchAdd } from "@/lib/ability-editor/add";
import { featureAtLevel, startingLevel } from "@/lib/ability-editor/class-features";
import { buildCharacter } from "@/lib/character-builder/build";
import { quickBuild } from "@/lib/character-builder/quick";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { useEncounterStore } from "@/store/encounter-store";
import { searchAdd as typeSearch } from "./helpers/abilities-tab";

/** EDITIONS_PLAN.md Phase 2: the 2024 class features, feats and species traits in Add ability, at a class level. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => cleanup());

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((candidate) => candidate.id === "def-fighter")! as CreatureDefinition;
/** A monster: no class, no character level. */
const ogre = (): CreatureDefinition => ({
  id: "ogre", name: "Ogre", size: "large", armorClass: 11, maxHp: 59, speed: 40, proficiencyBonus: 2,
  abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 }, actions: []
});
const entry = (id: string) => findSrd2024Feature(id)!;
const healing = (feature: FeatureDefinition) => (feature.grantedActions![0] as Extract<ActionDefinition, { kind: "healing" }>).healing[0]!.dice;
const rageBonus = (feature: FeatureDefinition) => {
  const action = feature.grantedActions![0] as Extract<ActionDefinition, { kind: "activate-feature" }>;
  return (action.condition!.effects![0] as { damage: Array<{ dice: string }> }).damage[0]!.dice;
};

describe("the 2024 feature index", () => {
  it("lists class features, feats and species traits that run, each once, as 2024", () => {
    const ids = SRD_2024_FEATURES.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const feature of SRD_2024_FEATURES) {
      expect(feature.feature.source?.edition, feature.id).toBe("2024");
      expect(["full", "partial"]).toContain(feature.feature.automationSupport);
      expect(feature.feature.informational, feature.id).toBeFalsy();
    }
    const names = (kind: string) => SRD_2024_FEATURES.filter((feature) => feature.ownerKind === kind).map((feature) => feature.name);
    expect(names("class")).toEqual(expect.arrayContaining(["Rage", "Second Wind", "Action Surge", "Sneak Attack", "Extra Attack"]));
    expect(names("subclass")).toEqual(expect.arrayContaining(["Frenzy", "Improved Critical"]));
    expect(names("feat")).toEqual(expect.arrayContaining(["Alert", "Savage Attacker", "Defense"]));
    expect(names("species")).toEqual(expect.arrayContaining(["Relentless Endurance", "Breath Weapon"]));
  });

  it("leaves out what the builder places, and what works through something besides its feature", () => {
    const names = new Set(SRD_2024_FEATURES.map((feature) => `${feature.owner}: ${feature.name}`));
    // The builder's: spells, slots, invocation choices, an aura's range.
    for (const name of ["Wizard: Spellcasting", "Warlock: Pact Magic", "Warlock: Eldritch Invocations", "Paladin: Aura Expansion"]) expect(names.has(name), name).toBe(false);
    // Another grant's weapon or action, the creature's hit points: alone, they'd do nothing.
    for (const name of ["Monk: Martial Arts", "Monk: Stunning Strike", "Draconic Sorcery: Draconic Resilience", "Cleric: Sear Undead"]) expect(names.has(name), name).toBe(false);
  });
});

describe("a 2024 feature at a class level", () => {
  it("works its numbers out as the builder does: Second Wind and Rage", () => {
    const secondWind = entry("srd:feature:fighter-second-wind-2024");
    expect(healing(featureAtLevel(secondWind, 5, ogre()).feature)).toBe("1d10+5");
    expect(featureAtLevel(secondWind, 5, ogre()).pools).toEqual({ "second-wind": 3 });
    const rage = entry("srd:feature:barbarian-rage-2024");
    const at9 = featureAtLevel(rage, 9, ogre());
    expect(rageBonus(at9.feature)).toBe("3");
    expect(at9.pools).toEqual({ rage: 4 });
    expect(at9.feature.description).toMatch(/Added at Barbarian level 9/);
    expect(at9.feature.source).toMatchObject({ documentKey: "srd-2024", edition: "2024" });
  });

  it("matches the feature the builder puts on a Barbarian 9", () => {
    const build = quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:barbarian", level: 9 });
    const built = buildCharacter(build, SRD_BUILD_SOURCES).features.find((placed) => placed.feature.name === "Rage")!.feature;
    const added = featureAtLevel(entry("srd:feature:barbarian-rage-2024"), 9, ogre()).feature;
    expect(rageBonus(added)).toBe(rageBonus(built));
    expect(added.effects).toEqual(built.effects);
  });

  it("starts at the creature's level, never below the level it's gained", () => {
    const extraAttack = entry("srd:feature:fighter-extra-attack-2024");
    expect(startingLevel(extraAttack, ogre())).toBe(5);
    expect(startingLevel(entry("srd:feature:fighter-second-wind-2024"), ogre())).toBe(1);
    const fighter7 = { ...ogre(), character: { level: 7, classes: [{ name: "Fighter", level: 7 }] } };
    expect(startingLevel(extraAttack, fighter7)).toBe(7);
    expect(healing(prepareLibrary("feature", "srd:feature:fighter-second-wind-2024", fighter7)!.record as FeatureDefinition)).toBe("1d10+7");
  });

  it("takes the latest version reached: Font of Magic at 9th level", () => {
    const font = entry("srd:feature:sorcerer-font-of-magic-2024");
    expect(font.versions.length).toBeGreaterThan(1);
    expect(featureAtLevel(font, 9, ogre()).pools).toBeTruthy();
  });

  it("is attached by the store with its pool, on the creature and its tokens", () => {
    const id = store().attachSrdFeature("def-fighter", "srd:feature:barbarian-rage-2024", 9)!;
    const rage = fighter().features!.find((feature) => feature.id === id)!;
    expect(rageBonus(rage)).toBe("3");
    expect(fighter().resources?.rage).toBe(4);
    const token = store().encounter.combatants.find((combatant) => combatant.definitionId === "def-fighter")!;
    expect(token.resources?.rage).toBe(4);
  });

  it("is listed in Add beside the 2014 one, with what gives it", () => {
    const rages = searchAdd("rage", "features", undefined).library.filter((row) => row.name === "Rage");
    expect(rages.map((row) => `${row.edition} ${row.from ?? ""}`.trim())).toEqual(["2014", "2024 Barbarian 1"]);
  });
});

describe("Add ability on a sheet", () => {
  // The fighter with no class or character level: Add starts each 2024 feature at the level it's gained.
  const renderUnleveled = () => {
    const combatant = store().encounter.combatants.find((candidate) => candidate.definitionId === "def-fighter")!;
    return render(<ActionsTab combatant={combatant} definition={{ ...fighter(), character: undefined }} />);
  };

  it("adds a 2024 feature at the class level chosen in the panel", async () => {
    renderUnleveled();
    await typeSearch("second wind");
    const level = screen.getByRole("spinbutton", { name: "Class level for 2024 features" }) as HTMLInputElement;
    expect(level.value).toBe("");
    const row = () => within(screen.getByRole("region", { name: "Library" })).getByRole("button", { name: /^Second Wind · feature · Fighter 1/ });
    expect(row().textContent).toMatch(/1d10 \+ 1|1d10\+1/);
    await userEvent.type(level, "6");
    expect(row().textContent).toMatch(/1d10 \+ 6|1d10\+6/);
    await userEvent.click(screen.getByRole("button", { name: "Add Second Wind (2024, Fighter 1)" }));
    const added = fighter().features!.find((feature) => feature.name === "Second Wind" && feature.source?.edition === "2024")!;
    expect(healing(added)).toBe("1d10+6");
    expect(fighter().resources?.["second-wind"]).toBe(3);
  });
});
