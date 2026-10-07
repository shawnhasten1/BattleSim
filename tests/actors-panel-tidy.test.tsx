// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatureDefinition } from "@/engine";
import { ActorsPanel } from "@/components/sidebar/ActorsPanel";
import { directoryLine, matchesActorQuery } from "@/lib/actor-sheet/summaries";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * The tidied Actors tab (ACTORS_TAB_PLAN.md, Phase 4): one search over your actors, the scene's own and the SRD
 * monsters; "Add ×" for every row; a line per actor saying what it is and how many are on the map; and a status line
 * only for what went wrong.
 */

const pristine = useEncounterStore.getState();
const store = () => useEncounterStore.getState();
const tokensOf = (definitionId: string) => store().encounter.combatants.filter((combatant) => combatant.definitionId === definitionId);
const goblin = () => pristine.encounter.definitions.find((definition) => definition.id === "def-goblin")!;

function boss(): CreatureDefinition {
  return { ...structuredClone(goblin()), id: "def-boss", name: "Goblin Boss", maxHp: 21, challengeRating: 1, folderId: "f1" };
}

function hero(): CreatureDefinition {
  return {
    ...structuredClone(pristine.encounter.definitions.find((definition) => definition.id === "def-fighter")!),
    id: "def-hero", name: "Aria", folderId: null,
    character: { level: 5, classes: [{ name: "Fighter", level: 5 }] }
  };
}

function withLibrary(definitions: CreatureDefinition[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
    JSON.stringify(url === "/api/definitions" ? { definitions, templateIds: [] } : {}), { status: 200 }
  )));
  useEncounterStore.setState({
    definitionsLibrary: definitions.map((definition) => structuredClone(definition)),
    templateDefinitionIds: [],
    actorFolders: [{ id: "f1", name: "Goblins", parentId: null }, { id: "f2", name: "Empty", parentId: null }]
  });
}

const search = () => screen.getByRole("searchbox", { name: "Search actors" });
const myActors = () => screen.getByRole("list", { name: "My actors" });

beforeEach(() => {
  useEncounterStore.setState(pristine, true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("an actor's line", () => {
  it("says what it is, its HP and AC, and how many are on the map", () => {
    expect(directoryLine(boss())).toMatch(/^CR 1 · HP 21 · AC \d+$/);
    expect(directoryLine(hero(), 2)).toMatch(/^Level 5 Fighter · HP \d+ · AC \d+ · ×2 on map$/);
  });

  it("is found by name, type, class or source", () => {
    expect(matchesActorQuery(hero(), "fight")).toBe(true);
    expect(matchesActorQuery(boss(), "goblin boss")).toBe(true);
    expect(matchesActorQuery(boss(), "dragon")).toBe(false);
  });

  it("shows on its row", () => {
    withLibrary([boss()]);
    render(<ActorsPanel onOpenCreate={vi.fn()} />);
    expect(within(screen.getByRole("list", { name: "This scene only" })).getByText(/HP 7 · AC \d+ · ×2 on map/)).toBeTruthy();
  });
});

describe("the directory's groups", () => {
  it("puts your actors first, then the scene's own, then the SRD monsters", () => {
    withLibrary([boss(), hero()]);
    render(<ActorsPanel onOpenCreate={vi.fn()} />);
    const lists = screen.getAllByRole("list").filter((list) => list.getAttribute("aria-label"));
    expect(lists.map((list) => list.getAttribute("aria-label"))).toEqual(["My actors", "This scene only", "SRD monsters"]);
    expect(within(myActors()).getByText("Aria")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "This scene only" })).getByText("Test Fighter")).toBeTruthy();
  });

  it("leaves out a creature only there for an open sheet, and SRD monsters on the map", async () => {
    withLibrary([]);
    store().benchCreature({ ...boss(), id: "def-ghost", name: "Ghost Only Benched" });
    await store().addSrdMonster("srd:monster:wolf", "enemy");
    render(<ActorsPanel onOpenCreate={vi.fn()} />);
    const scene = screen.getByRole("list", { name: "This scene only" });
    expect(within(scene).queryByText("Ghost Only Benched")).toBeNull();
    expect(within(scene).queryByText("Wolf")).toBeNull();
  });
});

describe("the search", () => {
  it("narrows every group at once, opening the folders with matches and hiding the rest", async () => {
    withLibrary([boss(), hero()]);
    render(<ActorsPanel onOpenCreate={vi.fn()} />);
    expect(within(myActors()).queryByText("Goblin Boss")).toBeNull(); // in its folder, closed
    await userEvent.type(search(), "boss");
    expect(within(myActors()).getByText("Goblin Boss")).toBeTruthy();
    expect(within(myActors()).queryByText("Aria")).toBeNull();
    expect(within(myActors()).queryByText("Empty")).toBeNull();
    expect(screen.queryByRole("list", { name: "This scene only" })).toBeNull();
  });

  it("says when none of your actors match", async () => {
    withLibrary([boss()]);
    render(<ActorsPanel onOpenCreate={vi.fn()} />);
    await userEvent.type(search(), "zzz");
    expect(within(myActors()).getByText("None of your actors match “zzz”.")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect((search() as HTMLInputElement).value).toBe("");
  });
});

describe("Add ×", () => {
  it("adds that many of your own actor with +", async () => {
    withLibrary([hero()]);
    render(<ActorsPanel onOpenCreate={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("Increase quantity"));
    await userEvent.click(screen.getByLabelText("Increase quantity"));
    const row = within(myActors()).getByText("Aria").closest("li")!;
    await userEvent.click(within(row).getByTitle("Add 3 to the map as party"));
    await waitFor(() => expect(tokensOf("def-hero")).toHaveLength(3));
    expect(tokensOf("def-hero").every((token) => token.faction === "party")).toBe(true);
  });

  it("puts the count in a drag of your own actor too", async () => {
    withLibrary([hero()]);
    render(<ActorsPanel onOpenCreate={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("Increase quantity"));
    const row = within(myActors()).getByText("Aria").closest("li")!;
    const data: Record<string, string> = {};
    fireEvent.dragStart(row, { dataTransfer: { effectAllowed: "", setData: (type: string, value: string) => { data[type] = value; } } });
    expect(JSON.parse(data["application/x-battle-sim-actor"]!)).toEqual({ definitionId: "def-hero", faction: "party", count: 2 });
  });
});

describe("the status line", () => {
  it("says nothing when the library loads, and what went wrong when something does", async () => {
    withLibrary([boss()]);
    render(<ActorsPanel onOpenCreate={vi.fn()} />);
    await store().loadDefinitionsLibrary();
    expect(screen.queryByRole("alert")).toBeNull();
    useEncounterStore.setState({ definitionStatus: "Definition library failed" });
    expect((await screen.findByRole("alert")).textContent).toBe("Definition library failed");
  });
});
