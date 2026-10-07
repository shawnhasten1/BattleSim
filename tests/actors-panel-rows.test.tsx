// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatureDefinition } from "@/engine";
import { ActorsPanel } from "@/components/sidebar/ActorsPanel";
import { SheetWindowsHost } from "@/components/sheet/SheetWindowsHost";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";
import { useLibrarySyncStore } from "@/store/library-sync-store";
import { resetSheetWindows, sheetWindows } from "./helpers/sheet";

/**
 * The Actors tab's rows and menus (ACTORS_TAB_PLAN.md, Phase 3): a click selects, a double-click or Enter opens the
 * sheet, + and dragging add tokens, and ⋯ or a right-click opens the actor's menu, with Delete for your own actors and
 * the scene's (never an SRD monster's or a template's).
 */

const pristine = useEncounterStore.getState();
const compendium = { status: "", setStatus: () => undefined } as unknown as Compendium;
const store = () => useEncounterStore.getState();
const tokensOf = (definitionId: string) => store().encounter.combatants.filter((combatant) => combatant.definitionId === definitionId);
const inScene = (id: string) => store().encounter.definitions.some((definition) => definition.id === id);

function boss(): CreatureDefinition {
  const goblin = pristine.encounter.definitions.find((definition) => definition.id === "def-goblin")!;
  return { ...structuredClone(goblin), id: "def-boss", name: "Goblin Boss", maxHp: 21 };
}

/** A library on a stub server: GET lists it, POST saves into it, PUT updates, DELETE removes. */
function stubLibrary(initial: CreatureDefinition[], templateIds: string[] = []) {
  const server = new Map(initial.map((definition) => [definition.id, structuredClone(definition)]));
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url === "/api/definitions" && method === "GET") return json({ definitions: [...server.values()], templateIds });
    if (url === "/api/definitions" && method === "POST") {
      const { definition } = JSON.parse(String(init!.body)) as { definition: CreatureDefinition };
      server.set(definition.id, definition);
      return json({ definition });
    }
    const id = decodeURIComponent(url.replace("/api/definitions/", ""));
    if (method === "DELETE") return server.delete(id) ? json({ ok: true }) : json({ error: "no" }, 404);
    if (method === "PUT") return json({ ok: true });
    return json({}, 404);
  }));
  useEncounterStore.setState({ definitionsLibrary: initial.map((definition) => structuredClone(definition)), templateDefinitionIds: templateIds });
  return { server, calls };
}

function Harness() {
  return (
    <>
      <ActorsPanel onOpenCreate={vi.fn()} onOpenSheet={vi.fn()} />
      <SheetWindowsHost compendium={compendium} />
    </>
  );
}

/** The row of `name` in the directory. */
const row = (name: string) => screen.getAllByText(name, { exact: true }).map((node) => node.closest("li")!).find((li) => li.querySelector("[aria-pressed]"))!;

async function menuOf(name: string): Promise<string[]> {
  await userEvent.click(within(row(name)).getByRole("button", { name: `More for ${name}` }));
  return screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
}

beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  resetSheetWindows();
  useLibrarySyncStore.getState().reset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useLibrarySyncStore.getState().reset();
});

describe("a row", () => {
  it("is selected by a click, and adds nothing", async () => {
    stubLibrary([boss()]);
    render(<Harness />);
    await userEvent.click(within(row("Goblin Boss")).getByText("Goblin Boss"));
    expect(within(row("Goblin Boss")).getByRole("button", { pressed: true })).toBeTruthy();
    expect(tokensOf("def-boss")).toHaveLength(0);
  });

  it("opens its sheet on a double-click, with no token on the map", async () => {
    stubLibrary([boss()]);
    render(<Harness />);
    await userEvent.dblClick(within(row("Goblin Boss")).getByText("Goblin Boss"));
    await screen.findByRole("dialog", { name: "Goblin Boss sheet" });
    expect(sheetWindows()[0]!.combatantId).toBeNull();
    expect(tokensOf("def-boss")).toHaveLength(0);
  });

  it("opens its sheet on Enter", async () => {
    stubLibrary([boss()]);
    render(<Harness />);
    within(row("Goblin Boss")).getByRole("button", { pressed: false }).focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Goblin Boss sheet" });
  });

  it("adds a token with +", async () => {
    stubLibrary([boss()]);
    render(<Harness />);
    await userEvent.click(within(row("Goblin Boss")).getByTitle("Add to the map as an enemy"));
    await waitFor(() => expect(tokensOf("def-boss")).toHaveLength(1));
    expect(tokensOf("def-boss")[0]!.faction).toBe("enemy");
  });
});

describe("its menu", () => {
  it("for your own actor: open, duplicate, export, delete", async () => {
    stubLibrary([boss()]);
    render(<Harness />);
    expect(await menuOf("Goblin Boss")).toEqual(["Open sheet", "Duplicate", "Export JSON", "Delete…"]);
  });

  it("for a creature only in this scene: open, save, export, remove", async () => {
    stubLibrary([]);
    render(<Harness />);
    expect(await menuOf("Test Fighter")).toEqual(["Open sheet", "Save to my library", "Export JSON", "Remove from this scene"]);
  });

  it("for a shared template: open, copy, export, and never delete", async () => {
    stubLibrary([boss()], ["def-boss"]);
    render(<Harness />);
    expect(await menuOf("Goblin Boss")).toEqual(["Open sheet", "Copy to my library", "Export JSON"]);
  });

  it("for an SRD monster: open, copy, export, and never delete", async () => {
    stubLibrary([]);
    render(<Harness />);
    const root = screen.getByTestId("srd-monsters-root");
    await userEvent.click(within(root).getByText("SRD Monsters"));
    await userEvent.click(within(root).getByText("Beast"));
    const wolf = within(root).getByText("Wolf", { exact: true }).closest("li")!;
    await userEvent.click(within(wolf).getByRole("button", { name: "More for Wolf" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Open sheet", "Copy to my library", "Export JSON"]);
  });

  it("opens on a right-click too", async () => {
    stubLibrary([boss()]);
    render(<Harness />);
    await userEvent.pointer({ keys: "[MouseRight]", target: within(row("Goblin Boss")).getByText("Goblin Boss") });
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toBeTruthy();
  });

  it("duplicates your actor into your library", async () => {
    const { server } = stubLibrary([boss()]);
    render(<Harness />);
    await menuOf("Goblin Boss");
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect([...server.values()].map((definition) => definition.name)).toContain("Goblin Boss (copy)"));
    expect(await screen.findByText("Added Goblin Boss (copy) to your library.")).toBeTruthy();
  });
});

describe("delete", () => {
  it("deletes your actor with no tokens at once, and Undo brings it back", async () => {
    const { server } = stubLibrary([boss()]);
    render(<Harness />);
    await menuOf("Goblin Boss");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    await waitFor(() => expect(server.has("def-boss")).toBe(false));
    const toast = await screen.findByText("Deleted Goblin Boss from your library.");
    expect(screen.queryByText("Goblin Boss", { exact: true })).toBeNull();
    await userEvent.click(within(toast.closest("[role=status]")! as HTMLElement).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.has("def-boss")).toBe(true));
    expect(await screen.findByText("Goblin Boss", { exact: true })).toBeTruthy();
  });

  it("asks first when it has tokens here: keeping them leaves this scene its own copy", async () => {
    const goblin = pristine.encounter.definitions.find((definition) => definition.id === "def-goblin")!;
    const { server } = stubLibrary([goblin]);
    render(<Harness />);
    await menuOf("Imported Goblin Stand-in");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Imported Goblin Stand-in?" });
    expect(dialog.textContent).toContain("2 tokens on this map");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete, keep tokens" }));
    await waitFor(() => expect(server.has("def-goblin")).toBe(false));
    expect(tokensOf("def-goblin")).toHaveLength(2);
    expect(inScene("def-goblin")).toBe(true);
    expect(within(row("Imported Goblin Stand-in")).getByText("this scene only")).toBeTruthy();
  });

  it("…or deletes its tokens too, and Undo brings back both", async () => {
    const goblin = pristine.encounter.definitions.find((definition) => definition.id === "def-goblin")!;
    const { server } = stubLibrary([goblin]);
    render(<Harness />);
    await menuOf("Imported Goblin Stand-in");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete with its 2 tokens" }));
    await waitFor(() => expect(tokensOf("def-goblin")).toHaveLength(0));
    expect(server.has("def-goblin")).toBe(false);
    expect(inScene("def-goblin")).toBe(false);
    const toast = (await screen.findByText(/Deleted Imported Goblin Stand-in from your library, with its tokens/)).closest("[role=status]") as HTMLElement;
    await userEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.has("def-goblin")).toBe(true));
    expect(tokensOf("def-goblin")).toHaveLength(2);
  });

  it("removes a creature only in this scene, with its tokens, as one undo step", async () => {
    stubLibrary([]);
    render(<Harness />);
    await menuOf("Test Fighter");
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove from this scene" }));
    await waitFor(() => expect(inScene("def-fighter")).toBe(false));
    expect(tokensOf("def-fighter")).toHaveLength(0);
    const toast = (await screen.findByText("Removed Test Fighter from this scene.")).closest("[role=status]") as HTMLElement;
    await userEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(inScene("def-fighter")).toBe(true);
    expect(tokensOf("def-fighter")).toHaveLength(1);
  });

  it("can't remove a creature another one summons by name", async () => {
    stubLibrary([]);
    const goblin = store().encounter.definitions.find((definition) => definition.id === "def-goblin")!;
    store().updateCreatureDefinition("def-goblin", {
      actions: [...(goblin.actions ?? []), {
        id: "call-fighter", name: "Call the Fighter", kind: "summon", actionType: "action", automationSupport: "full",
        options: [{ definitionId: "def-fighter", count: 1 }]
      } as unknown as NonNullable<CreatureDefinition["actions"]>[number]]
    });
    render(<Harness />);
    await menuOf("Test Fighter");
    const remove = screen.getByRole("menuitem", { name: "Remove from this scene" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(remove.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("refuses an SRD monster or a template in the store itself", async () => {
    stubLibrary([boss()], ["def-boss"]);
    expect((await store().deleteActor("srd:monster:wolf")).blocked).toBeTruthy();
    expect((await store().deleteActor("def-boss")).blocked).toBeTruthy();
  });
});

describe("folders", () => {
  it("asks before deleting one, saying its contents move up", async () => {
    stubLibrary([{ ...boss(), folderId: "f1" }]);
    const deleteActorFolder = vi.fn(async () => undefined);
    useEncounterStore.setState({ actorFolders: [{ id: "f1", name: "Goblins", parentId: null }] as never, deleteActorFolder });
    render(<Harness />);
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("Goblins") });
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete folder…" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Goblins?" });
    expect(dialog.textContent).toContain("Its 1 actor moves up a level");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete folder" }));
    expect(deleteActorFolder).toHaveBeenCalledWith("f1");
  });
});
