import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The Abilities tab's steps as a DM takes them (Phase 6): Add's one search, its sections and Start from scratch, and a
 * row's ⋯ menu. Component tests drive the tab through these rather than through its markup.
 */

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Opens Add ability, unless it's open already. */
export async function openAdd(): Promise<void> {
  if (!screen.queryByRole("region", { name: "Add ability" })) await userEvent.click(screen.getByRole("button", { name: "Add ability" }));
}

/** Types `query` into Add's search box (replacing what's there). */
export async function searchAdd(query: string): Promise<void> {
  await openAdd();
  const box = screen.getByRole("searchbox", { name: "Search abilities" });
  await userEvent.clear(box);
  if (query) await userEvent.type(box, query);
}

/** Add → Start from scratch → `label` ("Weapon", "Attack", "Special action", "Trait or feature", "Multiattack"…). */
export async function startFromScratch(label: string): Promise<void> {
  await openAdd();
  await userEvent.click(within(screen.getByRole("region", { name: "Start from scratch" })).getByRole("button", { name: label }));
}

/** Add → search → the recipe named `label` (the editor opens on it). */
export async function useRecipe(label: string, query = label): Promise<void> {
  await searchAdd(query);
  await userEvent.click(within(screen.getByRole("region", { name: "Recipes" })).getByRole("button", { name: new RegExp(`^${escape(label)} ·`) }));
}

/**
 * Add effect (the one in `scope`) → search `query` → the row whose name starts with `row`: a kind's label, or an
 * example's ("Pack Tactics"). Picking it adds the effect, filled in, and opens its card.
 */
export async function pickEffect(scope: ReturnType<typeof within>, query: string, row: string | RegExp = query): Promise<void> {
  await userEvent.click(scope.getByRole("button", { name: "Add effect" }));
  const picker = within(screen.getByRole("dialog", { name: "Add effect" }));
  await userEvent.type(picker.getByRole("searchbox", { name: "Search effects" }), query);
  await userEvent.click(picker.getByRole("button", { name: typeof row === "string" ? new RegExp(`^${escape(row)}`) : row }));
}

/** Add → search → a library row: the editor opens on a copy, added on Save. */
export async function openFromLibrary(name: string, query = name): Promise<void> {
  await searchAdd(query);
  await userEvent.click(within(screen.getByRole("region", { name: "Library" })).getByRole("button", { name: new RegExp(`^${escape(name)} ·`) }));
}

/** Add → search → a library row's "+": added as it is. */
export async function addFromLibrary(name: string, query = name): Promise<void> {
  await searchAdd(query);
  await userEvent.click(screen.getByRole("button", { name: `Add ${name}` }));
}

/** A row's ⋯ menu → `item` ("Duplicate", "Delete", "Move to bonus actions"). */
export async function rowMenu(name: string, item: string): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: `More for ${name}` }));
  await userEvent.click(screen.getByRole("menuitem", { name: item }));
}

/** The list group with this title ("Traits", "Actions", "Bonus actions", "Spellcasting"…). */
export const group = (title: string) => within(screen.getByRole("region", { name: title }));
