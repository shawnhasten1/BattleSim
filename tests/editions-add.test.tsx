// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatureDefinition, SpellDefinition } from "@/engine";
import { parseSrdDragPayload, serializeSrdDragPayload } from "@/data/srd";
import { srd52Source } from "@/data/srd/2024/reference";
import { findSrd2024Spell } from "@/data/srd/2024/spells";
import { SRD_2024_SPELL_SCROLLS, findLibraryItem, findLibrarySpell } from "@/data/srd/library";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { prepareLibrary, searchAdd, type LibraryEntry } from "@/lib/ability-editor/add";
import { ownSpellScrolls } from "@/lib/ability-editor/scrolls";
import { preferEdition } from "@/lib/editions";
import { useEncounterStore } from "@/store/encounter-store";
import { openAdd, searchAdd as typeSearch } from "./helpers/abilities-tab";

/** EDITIONS_PLAN.md Phase 1: both editions' spells in Add ability, badged, with a 2014 · 2024 · Both filter. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((candidate) => candidate.id === "def-fighter")! as CreatureDefinition;
const fireballs = (entries: LibraryEntry[]) => entries.filter((entry) => entry.name === "Fireball").map((entry) => `${entry.id} ${entry.edition}`);

describe("the library across both editions", () => {
  it("lists both Fireballs under Both, and one under each edition", () => {
    expect(fireballs(searchAdd("fireball", "all", undefined).library)).toEqual(["srd:spell:fireball 2014", "srd:spell:fireball-2024 2024"]);
    expect(fireballs(searchAdd("fireball", "all", undefined, undefined, "2014").library)).toEqual(["srd:spell:fireball 2014"]);
    expect(fireballs(searchAdd("fireball", "all", undefined, undefined, "2024").library)).toEqual(["srd:spell:fireball-2024 2024"]);
  });

  it("under 2024 still lists the 2014 weapons and items, which have no 2024 versions", () => {
    const names = searchAdd("", "all", undefined, undefined, "2024").library.map((entry) => entry.name);
    expect(names).toContain("Longsword");
    expect(names).toContain("Potion of Healing");
    // …and a 2014 spell the 2024 library has no version of.
    const only2014 = searchAdd("", "spells", undefined, undefined, "2024").library.filter((entry) => entry.edition === "2014");
    expect(only2014.length).toBeGreaterThan(0);
  });

  it("hides the other edition's version, never an entry without an edition", () => {
    const entries = [{ k: "a", e: "2014" }, { k: "a", e: "2024" }, { k: "b", e: "2014" }, { k: "a", e: undefined }] as const;
    const shown = preferEdition(entries, "2024", (entry) => entry.e, (entry) => entry.k);
    expect(shown).toEqual([{ k: "a", e: "2024" }, { k: "b", e: "2014" }, { k: "a", e: undefined }]);
    expect(preferEdition(entries, "both", (entry) => entry.e, (entry) => entry.k)).toHaveLength(4);
  });

  it("lists reference-only spells for a search, not in a list without one", () => {
    const reference = (entries: LibraryEntry[]) => entries.filter((entry) => entry.reference);
    expect(reference(searchAdd("", "all", undefined).library)).toEqual([]);
    expect(reference(searchAdd("", "spells", undefined).library)).toEqual([]);
    const wish = searchAdd("wish", "all", undefined).library.filter((entry) => entry.name === "Wish");
    expect(wish.some((entry) => entry.reference && entry.edition === "2024")).toBe(true);
  });

  it("finds a 2024 spell by id, for the editor, a drop and the store", () => {
    expect(findLibrarySpell("srd:spell:fireball")?.source?.edition).toBe("2014");
    expect(findLibrarySpell("srd:spell:fireball-2024")?.source?.edition).toBe("2024");
    const prepared = prepareLibrary("spell", "srd:spell:fireball-2024", fighter())!;
    expect(prepared.record.source).toMatchObject({ documentKey: "srd-2024", edition: "2024" });
    expect(parseSrdDragPayload(serializeSrdDragPayload("spell", "srd:spell:fireball-2024"))).toEqual({ kind: "spell", id: "srd:spell:fireball-2024" });
    const id = store().attachSrdSpell("def-fighter", "srd:spell:fireball-2024")!;
    const spell = fighter().spells!.find((candidate) => candidate.id === id)!;
    expect(spell).toMatchObject({ name: "Fireball", level: 3, source: { edition: "2024" } });
    expect(spell.action).toBeTruthy();
  });
});

describe("scrolls of both editions", () => {
  it("SRD 5.2 has a scroll of each cantrip and 1st-level spell, at DC 13 and +5", () => {
    expect(SRD_2024_SPELL_SCROLLS.length).toBeGreaterThan(50);
    expect(SRD_2024_SPELL_SCROLLS.every((scroll) => scroll.source?.edition === "2024")).toBe(true);
    const missile = findLibraryItem("srd:item:scroll-of-magic-missile-2024")!;
    expect(missile).toMatchObject({ name: "Scroll of Magic Missile", type: "scroll" });
    expect(findLibraryItem("srd:item:scroll-of-fireball-2024")).toBeUndefined();
    const names = searchAdd("scroll magic missile", "items", undefined).library.map((entry) => `${entry.name} ${entry.edition}`);
    expect(names).toEqual(["Scroll of Magic Missile 2014", "Scroll of Magic Missile 2024"]);
  });

  it("a 2024 spell gets its own scroll only where the library has none", () => {
    const placed = (slug: string): SpellDefinition => ({ ...findSrd2024Spell(`srd:spell:${slug}-2024`)!, id: slug, source: srd52Source(`srd-2024_${slug}`) });
    const own = ownSpellScrolls({ spells: [placed("magic-missile"), placed("fireball")] }).map((scroll) => scroll.name);
    expect(own).toEqual(["Scroll of Fireball"]);
  });
});

describe("Add ability, on a sheet", () => {
  const renderFighter = (definition = fighter()) => {
    const combatant = store().encounter.combatants.find((candidate) => candidate.definitionId === "def-fighter")!;
    return render(<ActionsTab combatant={combatant} definition={definition} />);
  };
  const libraryRows = () => within(screen.getByRole("region", { name: "Library" })).getAllByRole("button", { name: /^Fireball ·/ });
  const editionGroup = () => within(screen.getByRole("group", { name: "Edition" }));

  it("badges each row, says which Add is which, and filters by edition", async () => {
    renderFighter();
    await typeSearch("fireball");
    expect(libraryRows().map((row) => row.querySelector("[data-edition]")?.textContent)).toEqual(["2014", "2024"]);
    expect(screen.getByRole("button", { name: "Add Fireball (2014)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Fireball (2024)" })).toBeTruthy();
    await userEvent.click(editionGroup().getByRole("button", { name: "2024" }));
    expect(libraryRows()).toHaveLength(1);
    // One Fireball left: its Add needs no edition to tell it apart.
    expect(screen.getByRole("button", { name: "Add Fireball" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add Fireball" }));
    expect(fighter().spells!.map((spell) => `${spell.name} ${spell.source?.edition}`)).toContain("Fireball 2024");
  });

  it("remembers the filter in this browser", async () => {
    const first = renderFighter();
    await openAdd();
    await userEvent.click(editionGroup().getByRole("button", { name: "2014" }));
    first.unmount();
    renderFighter();
    await openAdd();
    expect(editionGroup().getByRole("button", { name: "2014" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows Both when the browser's storage can't be read", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    renderFighter();
    await openAdd();
    expect(editionGroup().getByRole("button", { name: "Both" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("a built character's opens on its own edition, without changing what the others remember", async () => {
    const build = {
      version: 1, edition: "2024", abilities: { method: "manual", base: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 10 } },
      background: { increases: {} }, hp: { method: "average" }, levels: [{ classId: "srd:class:fighter", choices: {} }], made: {}
    };
    renderFighter({ ...fighter(), character: { build } });
    await openAdd();
    expect(editionGroup().getByRole("button", { name: "2024" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(editionGroup().getByRole("button", { name: "2014" }));
    cleanup();
    renderFighter();
    await openAdd();
    expect(editionGroup().getByRole("button", { name: "Both" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("marks only the edition on the sheet as on the sheet", async () => {
    const placed: SpellDefinition = { ...findSrd2024Spell("srd:spell:fireball-2024")!, id: "fireball", source: srd52Source("srd-2024_fireball") };
    store().insertAbilityRecord("def-fighter", "spells", placed);
    renderFighter();
    await typeSearch("fireball");
    expect(libraryRows().map((row) => `${row.querySelector("[data-edition]")?.textContent} ${/on the sheet/.test(row.textContent ?? "")}`))
      .toEqual(["2014 false", "2024 true"]);
  });
});
