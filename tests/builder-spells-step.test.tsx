// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuilderHost } from "@/components/builder/BuilderHost";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useCatalogStore } from "@/store/catalog-store";
import { useEncounterStore } from "@/store/encounter-store";

// CHARACTER_BUILDER_UX_PLAN.md D4, §3.4: the Spells step. Finished grids fold to a line; an open grid shows its picks
// first, then the rest from the highest level down, with what's had tucked away; one set of filters serves them all;
// finishing a grid opens the next one still open.

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  useBuilderUiStore.setState({ window: null, homebrew: false });
  useCatalogStore.getState().setEntries([]);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  useBuilderUiStore.getState().close();
});

const WIZARD = { name: "Tamsin", classId: "srd:class:wizard", level: 5, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" };
const rail = (builder: HTMLElement, name: string) =>
  within(within(builder).getByRole("navigation", { name: "Builder steps" })).getByRole("button", { name: new RegExp(`^\\d+\\s*${name}`) });

async function openSpells() {
  useBuilderUiStore.getState().open({ kind: "create", seed: WIZARD });
  render(<BuilderHost onCreated={() => undefined} />);
  const builder = screen.getByRole("dialog", { name: "Character builder" });
  await userEvent.click(rail(builder, "Spells"));
  return builder;
}
/** The folded line of a level's grid: the n-th one named `title`. */
const line = (builder: HTMLElement, title: RegExp, nth = 0) => within(builder).getAllByRole("button", { name: title, expanded: false })[nth]!;
const tiles = (scope: HTMLElement) => within(scope).queryAllByRole("checkbox");
const checked = (scope: HTMLElement) => tiles(scope).filter((tile) => tile.getAttribute("aria-checked") === "true");
const card = () => screen.queryByRole("complementary", { name: /: rules$/ });

describe("the Spells step", { timeout: 30000 }, () => {
  it("folds every finished grid to a line, under what asks for it, and lists your spells", async () => {
    const builder = await openSpells();
    // Nothing open: every grid is done.
    expect(within(builder).queryByRole("group", { name: "Spellbook" })).toBeNull();
    const background = within(builder).getByRole("region", { name: "Background · Sage · Magic Initiate" });
    expect(within(background).getByRole("button", { name: /^Two cantrips\s*2 of 2/ })).toBeTruthy();
    expect(within(builder).getByRole("region", { name: "Level 5 · Wizard 5" })).toBeTruthy();
    const yours = within(builder).getByRole("region", { name: "Your spells" });
    const fireball = within(yours).getByRole("button", { name: /^Fireball/ });
    expect(within(fireball).getByLabelText("prepared")).toBeTruthy();
    // A name in "Your spells" opens the grid that chose it.
    await userEvent.click(fireball);
    const savant = within(builder).getByRole("group", { name: "Evocation Savant: an evocation spell for the spellbook" });
    expect(checked(savant).map((tile) => tile.getAttribute("aria-label"))).toEqual(["Fireball"]);
  });

  it("opens a grid with its picks first, then by level from the highest, the spellbook's own tucked away", async () => {
    const builder = await openSpells();
    await userEvent.click(line(builder, /^Spellbook/, 4));
    const book = within(builder).getByRole("group", { name: "Spellbook" });
    const rows = within(book).getAllByRole("group").map((group) => group.getAttribute("aria-label"));
    expect(rows).toEqual(["Spellbook: chosen", "Spellbook: 3rd level", "Spellbook: 2nd level", "Spellbook: 1st level"]);
    expect(book.textContent).toMatch(/up to 3rd level/);
    expect(book.textContent).toMatch(/Tucked away: \d+ already in your spellbook\./);
    await userEvent.click(within(book).getByRole("button", { name: "Show" }));
    const tucked = within(book).getByRole("group", { name: "Spellbook: tucked away" });
    expect(tiles(tucked).every((tile) => tile.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(tucked.textContent).toMatch(/already in the spellbook/);
    // Folding it again.
    await userEvent.click(within(book).getByRole("button", { name: /^Spellbook/, expanded: true }));
    expect(within(builder).queryByRole("group", { name: "Spellbook" })).toBeNull();
  });

  it("dims the rest of a full grid, and its cards say why; a grid of one swaps its pick", async () => {
    const builder = await openSpells();
    await userEvent.click(line(builder, /^Spellbook/));
    const book = within(builder).getByRole("group", { name: "Spellbook" });
    const others = tiles(within(book).getByRole("group", { name: "Spellbook: 1st level" }));
    expect(others.every((tile) => tile.getAttribute("aria-disabled") === "true")).toBe(true);
    act(() => { others[0]!.focus(); });
    expect(card()!.textContent).toMatch(/Spellbook is full: remove one to swap/);
    await userEvent.click(line(builder, /^A 1st-level spell/));
    const one = within(builder).getByRole("group", { name: "A 1st-level spell, always prepared" });
    const before = checked(one).map((tile) => tile.getAttribute("aria-label"));
    const other = tiles(within(one).getByRole("group", { name: "A 1st-level spell, always prepared: 1st level" }))[0]!;
    const name = other.getAttribute("aria-label");
    await userEvent.click(other);
    expect(checked(one).map((tile) => tile.getAttribute("aria-label"))).toEqual([name]);
    expect(name).not.toEqual(before[0]);
  });

  it("shares one set of filters across the grids, and says when they hide everything", async () => {
    const builder = await openSpells();
    await userEvent.click(line(builder, /^Spellbook/, 4));
    const book = within(builder).getByRole("group", { name: "Spellbook" });
    const filters = within(builder).getByRole("search", { name: "Spell filters" });
    await userEvent.type(within(filters).getByRole("searchbox", { name: "Search spells" }), "ar");
    const shown = within(book).queryAllByRole("group").filter((group) => /level$/.test(group.getAttribute("aria-label")!)).flatMap(tiles);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((tile) => /ar/i.test(tile.getAttribute("aria-label")!))).toBe(true);
    expect(book.textContent).toMatch(/more hidden by the filters/);
    await userEvent.click(within(filters).getByRole("checkbox", { name: "Ritual" }));
    const rituals = within(book).queryAllByRole("group").filter((group) => /level$/.test(group.getAttribute("aria-label")!)).flatMap(tiles);
    expect(rituals.every((tile) => within(tile).queryByTitle("Ritual"))).toBe(true);
    await userEvent.type(within(filters).getByRole("searchbox", { name: "Search spells" }), "zzz");
    expect(book.textContent).toMatch(/No spells match the filters\./);
    await userEvent.click(within(book).getByRole("button", { name: "Clear filters" }));
    expect((within(filters).getByRole("searchbox", { name: "Search spells" }) as HTMLInputElement).value).toBe("");
    expect(book.textContent).not.toMatch(/No spells match/);
  });

  it("opens the next open grid when one is finished", async () => {
    const builder = await openSpells();
    await userEvent.click(line(builder, /^Spellbook/));
    const book = within(builder).getByRole("group", { name: "Spellbook" });
    // Shield out of the spellbook: the book needs one more, and Prepared (which had it) one more too.
    await userEvent.click(within(within(book).getByRole("group", { name: "Spellbook: chosen" })).getByRole("checkbox", { name: "Shield" }));
    expect(within(builder).getByText(/2 choices still open/)).toBeTruthy();
    expect(within(builder).queryByRole("group", { name: "Prepared spells" })).toBeNull();
    await userEvent.click(tiles(within(book).getByRole("group", { name: "Spellbook: 1st level" })).find((tile) => tile.getAttribute("aria-label") !== "Shield")!);
    // The book folds, and Prepared opens.
    expect(within(builder).queryByRole("group", { name: "Spellbook" })).toBeNull();
    const prepared = within(builder).getByRole("group", { name: "Prepared spells" });
    expect(checked(prepared)).toHaveLength(3);
    await userEvent.click(within(prepared).getByRole("button", { name: "✦ Choose for me" }));
    // Its suggestion took a spell a later level had prepared, so that one's open now: "Next open choice" goes there.
    expect(within(builder).queryByRole("group", { name: "Prepared spells" })).toBeNull();
    await userEvent.click(within(builder).getByRole("button", { name: "Next open choice ›" }));
    const later = within(builder).getByRole("group", { name: "Prepared spells" });
    await userEvent.click(within(later).getByRole("button", { name: "✦ Choose for me" }));
    expect(within(builder).getByText("All made")).toBeTruthy();
  });

  it("moves between tiles with the arrow keys", async () => {
    const builder = await openSpells();
    await userEvent.click(line(builder, /^Cantrips/));
    const grid = within(builder).getByRole("group", { name: "Cantrips" });
    const all = tiles(grid);
    act(() => { all[0]!.focus(); });
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(all[1]);
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(document.activeElement).toBe(all[all.length - 1]);
  });

  it("opens a level's grid from its line in Class", async () => {
    useBuilderUiStore.getState().open({ kind: "create", seed: WIZARD });
    render(<BuilderHost onCreated={() => undefined} />);
    const builder = screen.getByRole("dialog", { name: "Character builder" });
    await userEvent.click(within(within(builder).getByRole("region", { name: "Level 3" })).getByRole("button", { name: /Spells ›$/ }));
    expect(rail(builder, "Spells").getAttribute("aria-current")).toBe("step");
    expect(within(builder).getByRole("group", { name: "Evocation Savant: two evocation spells for the spellbook" })).toBeTruthy();
  });
});
