// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SRD_MONSTER_INDEX, findSrdMonsterEntry, isSrdMonsterId, loadSrdMonster } from "@/data/srd/monsters";
import { CREATURE_TYPES } from "@/lib/creature-types";
import { buildSrdMonsterTree, formatChallengeRating, srdTypeFolderId } from "@/lib/srd-monster-tree";
import { useEncounterStore } from "@/store/encounter-store";
import { useCompendium } from "@/hooks/useCompendium";
import { ActorsPanel } from "@/components/sidebar/ActorsPanel";

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const state = () => useEncounterStore.getState();
const tokensOf = (definitionId: string) => state().encounter.combatants.filter((combatant) => combatant.definitionId === definitionId);

/** Records POSTs to /api/definitions and answers the follow-up library reload. */
function stubLibraryApi() {
  const posted: Array<{ id: string; name: string; folderId?: string | null }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const { definition } = JSON.parse(String(init.body)) as { definition: { id: string; name: string; folderId?: string | null } };
      posted.push({ id: definition.id, name: definition.name, folderId: definition.folderId });
      return { ok: true, json: async () => ({ definition }) } as Response;
    }
    return { ok: true, json: async () => ({ definitions: [], templateIds: [] }) } as Response;
  }));
  return posted;
}

describe("SRD monster library data", () => {
  it("indexes all 325 monsters under the srd:monster: namespace", () => {
    expect(SRD_MONSTER_INDEX).toHaveLength(325);
    expect(SRD_MONSTER_INDEX.every((entry) => isSrdMonsterId(entry.id))).toBe(true);
    expect(isSrdMonsterId("def-123")).toBe(false);
    expect(findSrdMonsterEntry("srd:monster:goblin")).toMatchObject({ name: "Goblin", type: "humanoid", cr: 0.25 });
  });

  it("loads a full definition on demand from every creature-type chunk", async () => {
    const firstOfEachType = new Map(SRD_MONSTER_INDEX.map((entry) => [entry.type, entry.id]));
    expect(firstOfEachType.size).toBe(14);
    for (const id of firstOfEachType.values()) {
      const definition = await loadSrdMonster(id);
      expect(definition?.id, id).toBe(id);
      expect(definition!.actions.length + (definition!.traits?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it("hands out private copies, so editing an actor can never change the library", async () => {
    const first = (await loadSrdMonster("srd:monster:goblin"))!;
    first.maxHp = 9999;
    first.actions.length = 0;
    const second = (await loadSrdMonster("srd:monster:goblin"))!;
    expect(second.maxHp).toBe(7);
    expect(second.actions.length).toBeGreaterThan(0);
    expect(await loadSrdMonster("srd:monster:not-a-monster")).toBeUndefined();
  });
});

describe("SRD Monsters → Monster Type tree", () => {
  it("has one folder per creature type, each holding its monsters alphabetically", () => {
    const tree = buildSrdMonsterTree();
    expect(tree.name).toBe("SRD Monsters");
    expect(tree.count).toBe(325);
    expect(tree.types.map((type) => type.label)).toEqual(CREATURE_TYPES.map((type) => type.label).sort((a, b) => a.localeCompare(b)));
    expect(tree.types.reduce((sum, type) => sum + type.monsters.length, 0)).toBe(325);
    for (const type of tree.types) {
      expect(type.monsters.every((monster) => monster.type === type.type)).toBe(true);
      const names = type.monsters.map((monster) => monster.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      expect(type.id).toBe(srdTypeFolderId(type.type));
    }
    expect(tree.types.find((type) => type.type === "dragon")!.monsters.map((monster) => monster.name)).toContain("Adult Red Dragon");
  });

  it("omits empty types and formats fractional challenge ratings", () => {
    const onlyBeasts = buildSrdMonsterTree(SRD_MONSTER_INDEX.filter((entry) => entry.type === "beast"));
    expect(onlyBeasts.types.map((type) => type.label)).toEqual(["Beast"]);
    expect([0.125, 0.25, 0.5, 1, 17].map(formatChallengeRating)).toEqual(["1/8", "1/4", "1/2", "1", "17"]);
  });
});

describe("addSrdMonster", () => {
  it("adds a token backed by the library definition, on the requested side and cell", async () => {
    await state().addSrdMonster("srd:monster:wolf", "enemy", { x: 4, y: 4 });
    const [token] = tokensOf("srd:monster:wolf");
    expect(token).toMatchObject({ faction: "enemy", position: { x: 4, y: 4 }, currentHp: 11, state: "active" });
    expect(state().encounter.definitions.find((definition) => definition.id === "srd:monster:wolf")).toMatchObject({ name: "Wolf", armorClass: 13 });
    await state().addSrdMonster("srd:monster:wolf", "party");
    expect(tokensOf("srd:monster:wolf").map((combatant) => combatant.faction)).toEqual(["enemy", "party"]);
  });

  it("reuses the scene's copy instead of resetting edits made to monsters already placed", async () => {
    await state().addSrdMonster("srd:monster:goblin");
    state().updateCreatureDefinition("srd:monster:goblin", { maxHp: 40 });
    await state().addSrdMonster("srd:monster:goblin");
    const copies = state().encounter.definitions.filter((definition) => definition.id === "srd:monster:goblin");
    expect(copies).toHaveLength(1);
    expect(copies[0]!.maxHp).toBe(40);
    expect(tokensOf("srd:monster:goblin")).toHaveLength(2);
    expect(tokensOf("srd:monster:goblin").map((combatant) => combatant.displayName)).toEqual(["Goblin 1", "Goblin 2"]);
  });

  it("reports a missing monster and adds nothing", async () => {
    const before = state().encounter.combatants.length;
    await state().addSrdMonster("srd:monster:nope");
    expect(state().encounter.combatants).toHaveLength(before);
    expect(state().definitionStatus).toMatch(/couldn't load/i);
  });
});

describe("customizing a library monster", () => {
  it("adoptSrdDefinition gives the definition and every token a fresh, non-library id and keeps edits", async () => {
    await state().addSrdMonster("srd:monster:goblin");
    await state().addSrdMonster("srd:monster:goblin");
    state().updateCreatureDefinition("srd:monster:goblin", { maxHp: 55 });

    const newId = state().adoptSrdDefinition("srd:monster:goblin")!;
    expect(isSrdMonsterId(newId)).toBe(false);
    expect(state().encounter.definitions.some((definition) => definition.id === "srd:monster:goblin")).toBe(false);
    expect(state().encounter.definitions.find((definition) => definition.id === newId)).toMatchObject({ name: "Goblin", maxHp: 55, source: { provider: "srd" } });
    expect(tokensOf(newId)).toHaveLength(2);
    expect(state().adoptSrdDefinition("def-fighter")).toBeUndefined();
  });

  it("saving a scene monster to the library never sends a global srd id (it would collide across users)", async () => {
    const posted = stubLibraryApi();
    await state().addSrdMonster("srd:monster:owlbear");
    await state().saveDefinition("srd:monster:owlbear");
    expect(posted).toHaveLength(1);
    expect(isSrdMonsterId(posted[0]!.id)).toBe(false);
    expect(posted[0]!.name).toBe("Owlbear");
    expect(tokensOf(posted[0]!.id)).toHaveLength(1); // the token now uses the saved actor
  });

  it("saving the selected SRD token works the same way", async () => {
    const posted = stubLibraryApi();
    await state().addSrdMonster("srd:monster:troll");
    state().selectCombatant(tokensOf("srd:monster:troll")[0]!.id);
    await state().saveSelectedDefinition();
    expect(posted).toHaveLength(1);
    expect(isSrdMonsterId(posted[0]!.id)).toBe(false);
  });

  it("'Copy to my library' saves a private editable copy without touching the scene", async () => {
    const posted = stubLibraryApi();
    const before = state().encounter.combatants.length;
    await state().saveSrdMonsterCopy("srd:monster:ogre");
    expect(posted).toEqual([expect.objectContaining({ name: "Ogre", folderId: null })]);
    expect(isSrdMonsterId(posted[0]!.id)).toBe(false);
    expect(state().encounter.combatants).toHaveLength(before);
  });

  it("dropping a library monster on one of the user's folders files a copy there", async () => {
    const posted = stubLibraryApi();
    await state().moveDefinitionToFolder("srd:monster:zombie", "folder-undead");
    expect(posted).toEqual([expect.objectContaining({ name: "Zombie", folderId: "folder-undead" })]);
    expect(isSrdMonsterId(posted[0]!.id)).toBe(false);

    // If it is already on the map, the scene's (possibly edited) version is what gets filed.
    await state().addSrdMonster("srd:monster:zombie");
    await state().moveDefinitionToFolder("srd:monster:zombie", "folder-undead");
    expect(posted).toHaveLength(2);
    expect(posted[1]!.id).not.toBe(posted[0]!.id);
    expect(tokensOf(posted[1]!.id)).toHaveLength(1);
  });
});

describe("SRD Monsters directory in the Actors panel", () => {
  function Harness() {
    return <ActorsPanel compendium={useCompendium()} onOpenCreate={vi.fn()} onOpenSheet={vi.fn()} />;
  }

  it("shows a permanent SRD Monsters root, collapsed, with its monster count", () => {
    render(<Harness />);
    const root = screen.getByTestId("srd-monsters-root");
    expect(within(root).getByText("SRD Monsters")).toBeTruthy();
    expect(within(root).getByText("325")).toBeTruthy();
    expect(within(root).getByLabelText("Permanent folder")).toBeTruthy();
    expect(within(root).queryByText("Beast")).toBeNull();
  });

  it("expands SRD Monsters → Monster Type → monster", async () => {
    render(<Harness />);
    const root = screen.getByTestId("srd-monsters-root");
    await userEvent.click(within(root).getByText("SRD Monsters"));
    for (const { label } of CREATURE_TYPES) expect(within(root).getByText(label), label).toBeTruthy();
    expect(within(root).queryByText("Wolf")).toBeNull();

    await userEvent.click(within(root).getByText("Beast"));
    const wolf = within(root).getByText("Wolf").closest("li")!;
    expect(within(wolf).getByText(/CR 1\/4 · HP 11 · AC 13/)).toBeTruthy();

    await userEvent.click(within(root).getByText("Beast"));
    expect(within(root).queryByText("Wolf")).toBeNull();
  });

  it("adds a monster to the scene from its row, as enemy or party", async () => {
    render(<Harness />);
    const root = screen.getByTestId("srd-monsters-root");
    await userEvent.click(within(root).getByText("SRD Monsters"));
    await userEvent.click(within(root).getByText("Beast"));
    const wolf = within(root).getByText("Wolf").closest("li")!;

    await userEvent.click(within(wolf).getByText("Wolf"));
    await waitFor(() => expect(tokensOf("srd:monster:wolf")).toHaveLength(1));
    expect(tokensOf("srd:monster:wolf")[0]!.faction).toBe("enemy");

    await userEvent.click(within(wolf).getByTitle("Add as party"));
    await waitFor(() => expect(tokensOf("srd:monster:wolf")).toHaveLength(2));
    expect(tokensOf("srd:monster:wolf")[1]!.faction).toBe("party");
  });

  it("drags as an ordinary actor so the map and user folders can accept it", async () => {
    render(<Harness />);
    const root = screen.getByTestId("srd-monsters-root");
    await userEvent.click(within(root).getByText("SRD Monsters"));
    await userEvent.click(within(root).getByText("Beast"));
    const row = within(root).getByText("Wolf").closest("li")!;
    const data: Record<string, string> = {};
    fireEvent.dragStart(row, { dataTransfer: { effectAllowed: "", setData: (type: string, value: string) => { data[type] = value; } } });
    // Same payload as any actor, plus how many the user's quantity stepper says to drop.
    expect(JSON.parse(data["application/x-battle-sim-actor"]!)).toEqual({ definitionId: "srd:monster:wolf", faction: "enemy", count: 1 });
  });

  it("is permanent: no rename, delete, move or create affordances, and it can't be dragged", async () => {
    render(<Harness />);
    const root = screen.getByTestId("srd-monsters-root");
    const rootRow = within(root).getByText("SRD Monsters").closest("div")!;
    expect(rootRow.getAttribute("draggable")).not.toBe("true");

    fireEvent.contextMenu(rootRow);
    expect(screen.queryByText("Delete folder")).toBeNull();
    expect(screen.queryByText("Rename")).toBeNull();
    expect(screen.queryByTitle("Create actor in this folder")).toBeNull();
    expect(within(root).queryByRole("textbox")).toBeNull();
  });

  it("keeps the user's own folder tools alongside it", () => {
    render(<Harness />);
    expect(screen.getByTitle("New folder")).toBeTruthy();
    expect(screen.getByText("Actor directory")).toBeTruthy();
  });
});
