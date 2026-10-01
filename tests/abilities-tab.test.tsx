// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionDefinition, CreatureDefinition } from "@/engine";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";
import { group, openAdd, rowMenu, searchAdd, useRecipe } from "./helpers/abilities-tab";

/** Phase 6: the list in statblock order, its rows' menu, the pools strip, and Add's one search. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => { document.body.innerHTML = ""; });

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition;
const token = () => store().encounter.combatants.find((c) => c.id === "pc-fighter")!;

function LiveTab({ compendium }: { compendium?: Compendium }) {
  const encounter = useEncounterStore((s) => s.encounter);
  return (
    <ActionsTab
      combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!}
      definition={encounter.definitions.find((d) => d.id === "def-fighter")!}
      compendium={compendium}
    />
  );
}

/** The fighter, changed in place (a legendary action, an optional rule) before the tab renders. */
function patchFighter(patch: Partial<CreatureDefinition>) {
  const encounter = store().encounter;
  useEncounterStore.setState({
    encounter: { ...encounter, definitions: encounter.definitions.map((d) => (d.id === "def-fighter" ? { ...d, ...patch } : d)) }
  });
}

const fillIn = () => [...document.querySelectorAll<HTMLElement>("[data-section]")].filter((section) => section.textContent?.includes("fill in")).map((section) => section.dataset.section);

describe("the list", { timeout: 20000 }, () => {
  it("duplicates a row as a copy right after it", async () => {
    render(<LiveTab />);
    await rowMenu("Longsword", "Duplicate");
    expect(fighter().actions.map((action) => action.name)).toEqual(["Longsword", "Longsword (copy)"]);
    expect(fighter().actions[1]!.id).not.toBe("longsword");
    const rows = group("Actions").getAllByRole("button", { name: /^Edit / }).map((button) => button.getAttribute("aria-label"));
    expect(rows.slice(rows.indexOf("Edit Longsword"), rows.indexOf("Edit Longsword") + 2)).toEqual(["Edit Longsword", "Edit Longsword (copy)"]);
  });

  it("moves an action to the bonus actions in one undo step", async () => {
    render(<LiveTab />);
    const depth = store().undoStack.length;
    await rowMenu("Longsword", "Move to bonus actions");
    expect(fighter().actions).toEqual([]);
    expect(fighter().bonusActions?.find((action) => action.id === "longsword")).toMatchObject({ actionType: "bonus" });
    expect(group("Bonus actions").getByRole("button", { name: "Edit Longsword" })).toBeTruthy();
    expect(store().undoStack.length).toBe(depth + 1);
  });

  it("opens a legendary action in the editor: what it costs, how many a round, and what it uses", async () => {
    patchFighter({ legendary: { pool: 3, actions: [{ name: "Swipe", cost: 2, description: "It makes a longsword attack.", actionId: "longsword" }] } });
    render(<LiveTab />);
    const legendary = screen.getByRole("region", { name: "Legendary actions" });
    expect(legendary.textContent).toContain("3 a round");
    expect(within(legendary).getByText("2 actions")).toBeTruthy();
    await userEvent.click(within(legendary).getByRole("button", { name: "Edit Swipe" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Does/ }));
    expect(screen.getByRole("radiogroup", { name: "It" }).querySelector("[aria-checked=true]")?.textContent).toBe("Uses one of its abilities");
    expect((screen.getByLabelText("Uses") as HTMLSelectElement).value).toBe("longsword");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Costs" })).getByRole("radio", { name: "1 action" }));
    const pool = screen.getByLabelText("Legendary actions a round");
    await userEvent.clear(pool);
    await userEvent.type(pool, "2");
    const depth = store().undoStack.length;
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(fighter().legendary).toMatchObject({ pool: 2, actions: [{ name: "Swipe", cost: 1, actionId: "longsword" }] });
    expect(store().undoStack.length).toBe(depth + 1);

    await rowMenu("Swipe", "Duplicate");
    expect(fighter().legendary!.actions.map((entry) => entry.name)).toEqual(["Swipe", "Swipe (copy)"]);
    await rowMenu("Swipe (copy)", "Delete");
    expect(fighter().legendary!.actions.map((entry) => entry.name)).toEqual(["Swipe"]);
  });

  it("switches an optional rule on and off from its row", async () => {
    const help: ActionDefinition = { kind: "healing", id: "help", name: "Call Help", actionType: "action", range: 0, healing: [{ dice: "1d4" }], targeting: { target: "self" }, automationSupport: "full" };
    patchFighter({ traits: [{ id: "variant", name: "Variant: Call Help", category: "trait", optional: true, automationSupport: "full", grantedActions: [help] }] });
    render(<LiveTab />);
    const row = group("Actions").getByRole("button", { name: "Edit Variant: Call Help" }).parentElement!;
    await userEvent.click(within(row).getByRole("checkbox", { name: "Use it" }));
    expect(fighter().traits![0]!.enabled).toBe(true);
  });

  it("says why a row is simulated or not on its dot", () => {
    patchFighter({ actions: [...fighter().actions, { kind: "unsupported", id: "roar", name: "Roar", actionType: "action", description: "It roars.", automationSupport: "unsupported" }] });
    render(<LiveTab />);
    const roar = group("Actions").getByRole("button", { name: "Edit Roar" }).parentElement!;
    expect(within(roar).getByRole("img").getAttribute("aria-label")).toBe("Reference only: the AI never uses it.");
    const longsword = group("Actions").getByRole("button", { name: "Edit Longsword" }).parentElement!;
    expect(within(longsword).getByRole("img").getAttribute("aria-label")).toBe("Simulated: the AI uses it as written.");
  });
});

describe("the pools strip", { timeout: 20000 }, () => {
  it("shows the pools, and edits what's left now and the full size", async () => {
    render(<LiveTab />);
    const pools = screen.getByRole("group", { name: "Pools" });
    expect(within(pools).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Second Wind: 1/1", "Action Surge: 1/1"]);
    await userEvent.click(within(pools).getByRole("button", { name: "Second Wind: 1/1" }));
    const sizes = screen.getByRole("group", { name: "Pool sizes" });
    const full = within(sizes).getByLabelText("Second Wind full");
    await userEvent.clear(full);
    await userEvent.type(full, "2");
    expect(fighter().resources?.["second-wind"]).toBe(2);
    const now = within(sizes).getByLabelText("Action Surge now");
    await userEvent.clear(now);
    await userEvent.type(now, "0");
    expect(token().resources?.["action-surge"]).toBe(0);
  });
});

describe("Add", { timeout: 20000 }, () => {
  it("opens a recipe with the sections to fill in highlighted, and saves it with a pool of its own", async () => {
    render(<LiveTab />);
    await useRecipe("Breath weapon");
    expect(fillIn()).toEqual(["target", "roll", "damage"]);
    expect(screen.getByRole("button", { name: /^Target/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /^Use & cost/ }).getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));
    const breath = fighter().actions.find((action) => action.name === "Breath Weapon")!;
    expect(breath).toMatchObject({ kind: "area-save", usage: { kind: "recharge" }, resourceCost: { resourceId: `usage:${breath.id}` } });
    expect(fighter().resources?.[`usage:${breath.id}`]).toBe(1);
  });

  it("copies a monster's ability into the editor and adds it on Save", async () => {
    render(<LiveTab />);
    await searchAdd("parry");
    const monsters = await screen.findByRole("region", { name: "From SRD monsters" });
    const parry = await within(monsters).findByRole("button", { name: /^Parry · Bandit Captain/ });
    await userEvent.click(parry);
    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Parry"));
    expect(fighter().reactions ?? []).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));
    expect(fighter().reactions?.map((action) => action.name)).toEqual(["Parry"]);
  });

  it("takes the first thing found on Enter, and Escape clears the search before closing", async () => {
    render(<LiveTab />);
    await searchAdd("greataxe");
    await userEvent.keyboard("{Enter}");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Greataxe");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fighter().weapons ?? []).toEqual([]);

    await searchAdd("bow");
    await userEvent.keyboard("{Escape}");
    expect((screen.getByRole("searchbox", { name: "Search abilities" }) as HTMLInputElement).value).toBe("");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Add ability" })).toBeNull();
  });

  it("adds a library row as it is with +, and stays open for the next one", async () => {
    render(<LiveTab />);
    await searchAdd("greataxe");
    await userEvent.click(screen.getByRole("button", { name: "Add Greataxe" }));
    expect(fighter().weapons?.map((weapon) => weapon.name)).toEqual(["Greataxe"]);
    expect(screen.getByRole("status").textContent?.trim()).toBe("Added Greataxe.Done");
    const search = screen.getByRole("searchbox", { name: "Search abilities" }) as HTMLInputElement;
    expect(document.activeElement).toBe(search);
    expect([search.selectionStart, search.selectionEnd]).toEqual([0, "greataxe".length]);
    expect(within(screen.getByRole("region", { name: "Library" })).getByRole("button", { name: /^Greataxe · weapon · on the sheet/ })).toBeTruthy();

    await searchAdd("extra attack");
    await userEvent.click(screen.getByRole("button", { name: "Add Extra Attack" }));
    expect(fighter().features?.map((feature) => feature.name)).toContain("Extra Attack");
    expect(screen.getByRole("status").textContent?.trim()).toBe("Added Extra Attack.Done");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("region", { name: "Add ability" })).toBeNull();
    expect(group("Actions").getByRole("button", { name: "Edit Greataxe" })).toBeTruthy();
  });

  it("lets library rows be dragged onto the sheet", async () => {
    render(<LiveTab />);
    await searchAdd("longbow");
    const row = within(screen.getByRole("region", { name: "Library" })).getByRole("button", { name: /^Longbow ·/ }).parentElement!;
    expect(row.getAttribute("draggable")).toBe("true");
  });

  it("searches Open5e spells for the same words", async () => {
    const compendium = {
      status: "1 compendium results", results: [{ key: "a", slug: "fire-storm-x", name: "Firestorm X", resource: "spell", level: 7, documentTitle: "Kobold Press" }],
      setQuery: vi.fn(), search: vi.fn(async () => undefined), importSpell: vi.fn(async () => undefined)
    } as unknown as Compendium;
    render(<LiveTab compendium={compendium} />);
    await openAdd();
    await searchAdd("firestorm");
    await userEvent.click(screen.getByRole("button", { name: /Search Open5e spells for “firestorm”/ }));
    expect(compendium.search).toHaveBeenCalledWith("spells", "firestorm");
    await userEvent.click(within(screen.getByRole("region", { name: "Open5e" })).getByRole("button", { name: /^Firestorm X/ }));
    expect(compendium.importSpell).toHaveBeenCalledWith("fire-storm-x", "def-fighter");
  });
});
