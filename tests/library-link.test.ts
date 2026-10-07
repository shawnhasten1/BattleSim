import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleEncounter, type CreatureDefinition, type EncounterSnapshot } from "@/engine";
import { changedLibraryActors, ownedLibraryIds, syncLibraryActors } from "@/lib/library-link";
import { useEncounterStore } from "@/store/encounter-store";
import { hasUnsavedLibraryEdits, LIBRARY_SAVE_DELAY_MS, useLibrarySyncStore } from "@/store/library-sync-store";

/**
 * Linked library actors (ACTORS_TAB_PLAN.md, Phase 1): a library actor you own is one creature wherever it's used. An
 * edit in a scene is saved to the library a moment later; a scene opening, or the library loading, takes the library's
 * version. Templates, SRD monsters and creatures only in a scene aren't linked.
 */

const pristine = useEncounterStore.getState();
const store = () => useEncounterStore.getState();
const sync = () => useLibrarySyncStore.getState();
const goblin = () => store().encounter.definitions.find((definition) => definition.id === "def-goblin")!;
const token = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!;

/** A fetch that answers the definition saves (or fails them) and one scene, recording every call. */
function stubServer(options: { failSaves?: boolean; scene?: EncounterSnapshot; library?: CreatureDefinition[] } = {}) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.startsWith("/api/definitions/") && method === "PUT") return options.failSaves ? json({ error: "nope" }, 500) : json({ ok: true });
    if (url === "/api/definitions") return json({ definitions: structuredClone(options.library ?? []), templateIds: [] });
    if (url === "/api/encounters/e1") return json({ encounter: { id: "e1", projectId: "c1", name: "Fight", snapshotJson: structuredClone(options.scene ?? sampleEncounter) } });
    if (url === "/api/projects") return json({ projects: [] });
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const saves = (calls: Array<{ url: string; method: string; body?: unknown }>) => calls.filter((call) => call.method === "PUT");

/** The goblin in your library, as the scene has it. */
function ownGoblin(templateIds: string[] = []) {
  useEncounterStore.setState({ definitionsLibrary: [goblin()], templateDefinitionIds: templateIds });
}

beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  sync().reset();
  vi.useFakeTimers();
});
afterEach(() => {
  sync().reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("which actors are linked", () => {
  it("are the library's less the shared templates", () => {
    expect([...ownedLibraryIds([{ id: "a" }, { id: "b" }], ["b"])]).toEqual(["a"]);
  });

  it("an edit is to be saved when it changed one of yours, and only then", () => {
    const library = [goblin()];
    const before = store().encounter.definitions;
    const renamed = before.map((definition) => (definition.id === "def-goblin" ? { ...definition, name: "Boss" } : definition));
    expect(changedLibraryActors(before, renamed, library, []).map((definition) => definition.name)).toEqual(["Boss"]);
    // A template isn't yours; nothing changed; a copy equal to the library's (undo put it back, a sync) saves nothing.
    expect(changedLibraryActors(before, renamed, library, ["def-goblin"])).toEqual([]);
    expect(changedLibraryActors(before, before, library, [])).toEqual([]);
    const cloned = before.map((definition) => structuredClone(definition));
    expect(changedLibraryActors(before, cloned, library, [])).toEqual([]);
  });
});

describe("syncing a scene to the library", () => {
  it("replaces your stale copies, leaving templates, busy actors and equal copies alone", () => {
    const encounter = structuredClone(sampleEncounter);
    const newer = { ...structuredClone(encounter.definitions.find((definition) => definition.id === "def-goblin")!), name: "Goblin Boss" };
    const synced = syncLibraryActors(encounter, [newer], []);
    expect(synced.definitions.find((definition) => definition.id === "def-goblin")!.name).toBe("Goblin Boss");
    expect(syncLibraryActors(encounter, [newer], ["def-goblin"])).toBe(encounter);
    expect(syncLibraryActors(encounter, [newer], [], new Set(["def-goblin"]))).toBe(encounter);
    expect(syncLibraryActors(synced, [newer], [])).toBe(synced);
  });

  it("moves the tokens of a creature that grew back onto the grid", () => {
    const encounter = structuredClone(sampleEncounter);
    const edge = { x: encounter.map.grid.width - 1, y: encounter.map.grid.height - 1 };
    encounter.combatants = encounter.combatants.map((combatant) => (combatant.id === "enemy-goblin-1" ? { ...combatant, position: edge } : combatant));
    const huge = { ...structuredClone(encounter.definitions.find((definition) => definition.id === "def-goblin")!), size: "huge" as const };
    const synced = syncLibraryActors(encounter, [huge], []);
    expect(synced.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!.position).toEqual({ x: edge.x - 2, y: edge.y - 2 });
  });
});

describe("in the store", () => {
  it("an edit to your library actor is saved once its edits pause, and the library copy follows", async () => {
    const calls = stubServer();
    ownGoblin();
    store().updateCreatureDefinition("def-goblin", { name: "Goblin Boss" });
    store().updateCreatureDefinition("def-goblin", { name: "Goblin Boss!" });
    expect(sync().states["def-goblin"]).toBe("pending");
    expect(hasUnsavedLibraryEdits()).toBe(true);
    expect(saves(calls)).toEqual([]);
    await vi.advanceTimersByTimeAsync(LIBRARY_SAVE_DELAY_MS);
    expect(saves(calls)).toHaveLength(1);
    expect(saves(calls)[0]!.url).toBe("/api/definitions/def-goblin");
    expect((calls.at(-1)!.body as { definition: CreatureDefinition }).definition.name).toBe("Goblin Boss!");
    expect(sync().states["def-goblin"]).toBe("saved");
    expect(store().definitionsLibrary[0]!.name).toBe("Goblin Boss!");
    expect(hasUnsavedLibraryEdits()).toBe(false);
  });

  it("undo saves the earlier version", async () => {
    const calls = stubServer();
    ownGoblin();
    store().updateCreatureDefinition("def-goblin", { name: "Goblin Boss" });
    await vi.advanceTimersByTimeAsync(LIBRARY_SAVE_DELAY_MS);
    store().undo();
    await vi.advanceTimersByTimeAsync(LIBRARY_SAVE_DELAY_MS);
    expect(saves(calls)).toHaveLength(2);
    expect((saves(calls)[1]!.body as { definition: CreatureDefinition }).definition.name).toBe("Imported Goblin Stand-in");
    store().redo();
    await vi.advanceTimersByTimeAsync(LIBRARY_SAVE_DELAY_MS);
    expect((saves(calls)[2]!.body as { definition: CreatureDefinition }).definition.name).toBe("Goblin Boss");
  });

  it("never saves a template, an SRD monster or a creature only in this scene", async () => {
    const calls = stubServer();
    ownGoblin(["def-goblin"]);
    store().updateCreatureDefinition("def-goblin", { name: "Not mine" });
    store().updateCreatureDefinition("def-fighter", { name: "Scene only" });
    await vi.advanceTimersByTimeAsync(LIBRARY_SAVE_DELAY_MS * 2);
    expect(saves(calls)).toEqual([]);
    expect(sync().states).toEqual({});
  });

  it("a failed save says so, and Retry sends it again", async () => {
    const calls = stubServer({ failSaves: true });
    ownGoblin();
    store().updateCreatureDefinition("def-goblin", { name: "Goblin Boss" });
    await vi.advanceTimersByTimeAsync(LIBRARY_SAVE_DELAY_MS);
    expect(sync().states["def-goblin"]).toBe("failed");
    stubServer();
    sync().retry("def-goblin");
    await vi.advanceTimersByTimeAsync(0);
    expect(sync().states["def-goblin"]).toBe("saved");
    expect(saves(calls)).toHaveLength(1);
  });

  it("Make it its own creature stops the link: the new creature is the scene's alone", async () => {
    const calls = stubServer();
    ownGoblin();
    const ownId = store().makeOwnCreature("enemy-goblin-1")!;
    store().updateCreatureDefinition(ownId, { name: "Gribble" });
    await vi.advanceTimersByTimeAsync(LIBRARY_SAVE_DELAY_MS * 2);
    expect(saves(calls)).toEqual([]);
  });

  it("the library loading gives the scene its version, tokens at full following, and saves nothing", async () => {
    const newer = { ...structuredClone(goblin()), name: "Goblin Boss", maxHp: 21 };
    const calls = stubServer({ library: [newer] });
    useEncounterStore.setState({ encounter: { ...store().encounter, combatants: store().encounter.combatants.map((combatant) => (combatant.id === "enemy-goblin-2" ? { ...combatant, currentHp: 3 } : combatant)) } });
    await store().loadDefinitionsLibrary();
    expect(goblin().name).toBe("Goblin Boss");
    expect(token("enemy-goblin-1").currentHp).toBe(21);
    expect(token("enemy-goblin-2").currentHp).toBe(3);
    await vi.advanceTimersByTimeAsync(LIBRARY_SAVE_DELAY_MS * 2);
    expect(saves(calls)).toEqual([]);
  });

  it("…and its undo history, so undoing something else can't bring back the old copy", async () => {
    stubServer({ library: [{ ...structuredClone(goblin()), name: "Goblin Boss" }] });
    store().updateCombatant("pc-fighter", { displayName: "Sir Fighter" });
    await store().loadDefinitionsLibrary();
    store().undo();
    expect(goblin().name).toBe("Goblin Boss");
    expect(token("pc-fighter").displayName).not.toBe("Sir Fighter");
  });

  it("…but keeps the scene's copy of an actor whose save hasn't gone yet", async () => {
    stubServer({ library: [structuredClone(goblin())] });
    ownGoblin();
    store().updateCreatureDefinition("def-goblin", { name: "Goblin Boss" });
    await store().loadDefinitionsLibrary();
    expect(goblin().name).toBe("Goblin Boss");
  });

  it("a scene opening takes the library's version of your actors", async () => {
    const calls = stubServer();
    useEncounterStore.setState({ definitionsLibrary: [{ ...structuredClone(goblin()), name: "Goblin Boss" }], templateDefinitionIds: [] });
    await store().loadEncounter("e1");
    expect(goblin().name).toBe("Goblin Boss");
    await vi.advanceTimersByTimeAsync(LIBRARY_SAVE_DELAY_MS * 2);
    expect(saves(calls)).toEqual([]);
  });
});
