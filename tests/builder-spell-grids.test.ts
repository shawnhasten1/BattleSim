import { describe, expect, it } from "vitest";
import {
  buildCharacter,
  gridView,
  mergeCatalog,
  NO_FILTERS,
  nextOpenSpellSlot,
  quickBuild,
  spellGroups,
  spellSlotKey,
  withChoice,
  yourSpells,
  type CharacterBuild,
  type ChoiceSlot,
  type ClassDefinition
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

// CHARACTER_BUILDER_UX_PLAN.md D4, §3.4: the spell grids' model. Each choice keeps its grid; what changes is how it
// reads (picks first, highest level first, what's had tucked away), "Your spells" over all of them, and what opens next.

const S = SRD_BUILD_SOURCES;
const spellSlots = (build: CharacterBuild, sources = S) => buildCharacter(build, sources).choices.filter((slot) => slot.spec.kind === "spells");
const picks = (slot: ChoiceSlot) => (Array.isArray(slot.value) ? (slot.value as string[]) : []);

function everyPickOnce(build: CharacterBuild, sources = S) {
  const built = buildCharacter(build, sources);
  const listed = yourSpells(build, built, sources);
  const all = listed.flatMap((level) => level.spells);
  // Each spell once, under its own level.
  expect(new Set(all.map((spell) => spell.id)).size).toBe(all.length);
  for (const level of listed) for (const spell of level.spells) expect(spell.level).toBe(level.level);
  // Every pick of every grid is there, linked to the grid that chose it.
  for (const slot of built.choices.filter((candidate) => candidate.spec.kind === "spells")) {
    for (const id of picks(slot)) {
      const spell = all.find((entry) => entry.id === id);
      expect(spell, `${id} from ${spellSlotKey(slot)}`).toBeDefined();
      expect(spell!.slots).toContain(spellSlotKey(slot));
    }
  }
  return all;
}

describe("Your spells", () => {
  it("lists a Wizard 5's and a Wizard 9's picks, each once, by level, linked to its grid", () => {
    for (const level of [5, 9]) {
      const build = quickBuild(S, { classId: "srd:class:wizard", level, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" });
      const all = everyPickOnce(build);
      expect(all.some((spell) => spell.level === 0)).toBe(true);
      expect(Math.max(...all.map((spell) => spell.level))).toBe(level === 5 ? 3 : 5);
      // Prepared spells are marked; a spellbook spell that isn't prepared isn't.
      expect(all.some((spell) => spell.level > 0 && spell.prepared)).toBe(true);
      if (level === 9) expect(all.some((spell) => spell.level > 0 && !spell.prepared)).toBe(true);
    }
  });

  it("says where an always-prepared or free-cast spell is from, and links it to no grid", () => {
    // A 2014 Life Domain cleric: Bless and Cure Wounds always prepared, from the domain.
    const cleric = quickBuild(S, { classId: "srd:class:cleric-2014", level: 3, backgroundId: "srd:background:acolyte-2014" });
    const all = everyPickOnce(cleric);
    const bless = all.find((spell) => spell.name === "Bless")!;
    expect(bless.always).toBe("Life Domain");
    expect(bless.prepared).toBe(true);
    expect(bless.slots).toEqual([]);
    // Magic Initiate's 1st-level spell: always prepared, and cast once without a slot.
    const wizard = quickBuild(S, { classId: "srd:class:wizard", level: 1, backgroundId: "srd:background:sage" });
    const built = buildCharacter(wizard, S);
    const initiate = built.choices.find((slot) => slot.scope.kind === "background" && slot.spec.kind === "spells" && slot.spec.what !== "cantrips")!;
    const spell = yourSpells(wizard, built, S).flatMap((level) => level.spells).find((entry) => entry.id === picks(initiate)[0])!;
    expect(spell.free).toBe("Magic Initiate");
    expect(spell.slots).toContain(spellSlotKey(initiate));
  });

  it("covers a warlock's pact magic and a homebrew class's own list", () => {
    everyPickOnce(quickBuild(S, { classId: "srd:class:warlock", level: 5 }));
    const gunslinger: ClassDefinition = {
      id: "homebrew:class:gunslinger", name: "Gunslinger", source: { provider: "homebrew" }, edition: "2024", hitDie: 8,
      primaryAbilities: ["dex"], saves: ["dex", "wis"], skills: { count: 2, from: ["acrobatics", "perception", "insight"] },
      weaponProficiency: ["simple"], armorTraining: ["light"],
      spellcasting: {
        ability: "wis", kind: "half", list: "gunslinger",
        spells: ["srd:spell:cure-wounds-2024", "srd:spell:faerie-fire-2024", "srd:spell:web-2024", "srd:spell:fire-bolt-2024"],
        cantrips: Array.from({ length: 20 }, () => 1), prepared: Array.from({ length: 20 }, (_, index) => Math.min(3, 1 + Math.floor(index / 4)))
      },
      subclassLevel: 3, subclassLabel: "Gunslinger Path", featLevels: [4, 8, 12, 16, 19], table: [], levels: [],
      suggested: { abilities: ["dex", "wis", "con", "str", "int", "cha"], tactics: "basic-ranged" }
    };
    const sources = mergeCatalog(S, [{ kind: "class", entry: gunslinger }]);
    // The Soldier: no Magic Initiate to bring another class's spells.
    const build = quickBuild(sources, { classId: gunslinger.id, level: 5, backgroundId: "srd:background:soldier" });
    const all = everyPickOnce(build, sources);
    expect(all.map((spell) => spell.id).every((id) => gunslinger.spellcasting!.spells!.includes(id))).toBe(true);
    const prepared = spellSlots(build, sources).find((slot) => slot.spec.kind === "spells" && slot.spec.what === "prepared")!;
    expect(prepared.options.map((option) => option.id).every((id) => gunslinger.spellcasting!.spells!.includes(id))).toBe(true);
  });
});

describe("a grid", () => {
  const wizard = quickBuild(S, { classId: "srd:class:wizard", level: 5, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" });

  it("puts its picks first, then the rest by level from the highest down, and tucks away what's in the book", () => {
    const slots = spellSlots(wizard);
    // Level 5's spellbook spells (Evocation Savant writes in the book too, but is a grid of its own).
    const book5 = slots.find((slot) => slot.scope.kind === "level" && slot.scope.index === 4 && slot.path[0] === "spellbook")!;
    const view = gridView(book5, NO_FILTERS, S);
    expect(view.chosen.map((tile) => tile.id)).toEqual(picks(book5));
    expect(view.top).toBe(3);
    expect(view.levels.map((level) => level.level)).toEqual([3, 2, 1]);
    // What earlier levels wrote in the spellbook is tucked away, with the reason.
    expect(view.tucked.length).toBeGreaterThan(0);
    expect(view.tucked.every((tile) => tile.reason === "already in the spellbook")).toBe(true);
    const shown = view.levels.flatMap((level) => level.tiles.map((tile) => tile.id));
    expect(shown.some((id) => view.tucked.some((tile) => tile.id === id) || picks(book5).includes(id))).toBe(false);
    expect(view.full).toBe(true);
  });

  it("lists only the spellbook's spells for a wizard's prepared grid, and a 2014 cleric's from the list", () => {
    const prepared = spellSlots(wizard).find((slot) => slot.scope.kind === "level" && slot.scope.index === 0 && slot.spec.kind === "spells" && slot.spec.what === "prepared")!;
    const book = spellSlots(wizard).filter((slot) => slot.spec.kind === "spells" && slot.spec.what === "spellbook").flatMap(picks);
    const view = gridView(prepared, NO_FILTERS, S);
    expect([...view.chosen, ...view.levels.flatMap((level) => level.tiles), ...view.tucked].every((tile) => book.includes(tile.id))).toBe(true);
    const cleric = quickBuild(S, { classId: "srd:class:cleric-2014", level: 5 });
    // Level 5's: a 2014 cleric prepares from the whole list, up to 3rd level.
    const clericPrepared = spellSlots(cleric).find((slot) => slot.scope.kind === "level" && slot.scope.index === 4 && slot.spec.kind === "spells" && slot.spec.what === "prepared")!;
    const clericView = gridView(clericPrepared, NO_FILTERS, S);
    expect(clericView.levels.map((level) => level.level)).toEqual([3, 2, 1]);
    // The domain's always-prepared spells are tucked away, saying why.
    expect(clericView.tucked.some((tile) => /always prepared \(Life Domain\)/.test(tile.reason ?? ""))).toBe(true);
  });

  it("filters by name, school, cost, what runs, concentration and ritual, and counts what's hidden", () => {
    const book1 = spellSlots(wizard).find((slot) => slot.scope.kind === "level" && slot.scope.index === 0 && slot.spec.kind === "spells" && slot.spec.what === "spellbook")!;
    const all = gridView(book1, NO_FILTERS, S);
    const shown = (view: typeof all) => view.levels.flatMap((level) => level.tiles);
    const ritual = gridView(book1, { ...NO_FILTERS, ritual: true }, S);
    expect(shown(ritual).length).toBeGreaterThan(0);
    expect(shown(ritual).every((tile) => tile.facts?.ritual)).toBe(true);
    expect(ritual.hidden).toBe(shown(all).length - shown(ritual).length);
    const evocation = gridView(book1, { ...NO_FILTERS, school: "evocation" }, S);
    expect(shown(evocation).every((tile) => tile.facts?.school === "evocation")).toBe(true);
    const reactions = gridView(book1, { ...NO_FILTERS, cost: "reaction" }, S);
    expect(shown(reactions).length).toBeGreaterThan(0);
    expect(shown(reactions).every((tile) => tile.facts?.cost === "reaction")).toBe(true);
    const runs = gridView(book1, { ...NO_FILTERS, runs: true }, S);
    expect(shown(runs).every((tile) => !tile.reference && tile.facts?.support !== "manual")).toBe(true);
    const named = gridView(book1, { ...NO_FILTERS, query: "magic m" }, S);
    expect(shown(named).map((tile) => tile.name)).toEqual(shown(all).filter((tile) => /magic m/i.test(tile.name)).map((tile) => tile.name));
  });

  it("opens the next open grid after one is finished, in the build's order", () => {
    const empty: CharacterBuild = { ...wizard, levels: wizard.levels.map((level) => ({ ...level, choices: Object.fromEntries(Object.entries(level.choices).filter(([key]) => !["cantrips", "spellbook", "prepared"].includes(key))) })) };
    const open = spellSlots(empty).filter((slot) => slot.pending);
    expect(open.length).toBeGreaterThan(2);
    const first = nextOpenSpellSlot(spellSlots(empty));
    expect(first && spellSlotKey(first)).toBe(spellSlotKey(open[0]!));
    // Finish the first: the next is the one after it.
    const done = withChoice(empty, first!.scope, first!.path, first!.suggestion, first!.spec);
    const next = nextOpenSpellSlot(spellSlots(done), spellSlotKey(first!));
    expect(next && spellSlotKey(next)).toBe(spellSlotKey(open[1]!));
    // Nothing open: nothing next.
    expect(nextOpenSpellSlot(spellSlots(wizard))).toBeUndefined();
  });
});

describe("the grids' groups", () => {
  it("puts Magic Initiate's grids under the background, and Evocation Savant's under its levels", () => {
    const build = quickBuild(S, { classId: "srd:class:wizard", level: 5, backgroundId: "srd:background:sage" });
    const groups = spellGroups(build, buildCharacter(build, S), S);
    expect(groups[0]!.label).toBe("Background · Sage · Magic Initiate");
    expect(groups[0]!.slots.every((slot) => slot.scope.kind === "background")).toBe(true);
    const savant = groups.filter((group) => group.slots.some((slot) => slot.path.join("/").includes("evocation-savant")));
    expect(savant.map((group) => group.label)).toEqual(["Level 3 · Wizard 3", "Level 5 · Wizard 5"]);
  });
});
