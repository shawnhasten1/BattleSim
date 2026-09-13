import { describe, expect, it } from "vitest";
import type { CreatureDefinition } from "@/engine";
import { buildFolderTree, wouldCreateCycle, type ActorFolder } from "@/lib/actor-folders";

function makeDefinition(id: string, name: string, folderId?: string | null): CreatureDefinition {
  return {
    id,
    name,
    folderId,
    size: "medium",
    armorClass: 10,
    maxHp: 1,
    speed: 30,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    actions: []
  };
}

describe("buildFolderTree", () => {
  it("nests folders by parentId and files definitions under their folderId", () => {
    const folders: ActorFolder[] = [
      { id: "party", name: "Party", parentId: null },
      { id: "monsters", name: "Monsters", parentId: null },
      { id: "specialty", name: "Specialty", parentId: "monsters" }
    ];
    const definitions = [
      makeDefinition("fighter", "Fighter", "party"),
      makeDefinition("ghast", "Ghast", "specialty"),
      makeDefinition("goblin", "Goblin", "monsters"),
      makeDefinition("loose", "Loose Actor", null)
    ];

    const tree = buildFolderTree(folders, definitions);

    expect(tree.roots.map((n) => n.folder.name)).toEqual(["Monsters", "Party"]);
    expect(tree.unfiled.map((d) => d.id)).toEqual(["loose"]);

    const monsters = tree.roots.find((n) => n.folder.id === "monsters")!;
    expect(monsters.definitions.map((d) => d.id)).toEqual(["goblin"]);
    expect(monsters.children.map((n) => n.folder.name)).toEqual(["Specialty"]);
    expect(monsters.children[0].definitions.map((d) => d.id)).toEqual(["ghast"]);

    const party = tree.roots.find((n) => n.folder.id === "party")!;
    expect(party.definitions.map((d) => d.id)).toEqual(["fighter"]);
  });

  it("treats a definition with a dangling folderId as unfiled", () => {
    const tree = buildFolderTree([], [makeDefinition("orphan", "Orphan", "missing-folder")]);
    expect(tree.roots).toEqual([]);
    expect(tree.unfiled.map((d) => d.id)).toEqual(["orphan"]);
  });
});

describe("wouldCreateCycle", () => {
  const folders: ActorFolder[] = [
    { id: "a", name: "A", parentId: null },
    { id: "b", name: "B", parentId: "a" },
    { id: "c", name: "C", parentId: "b" }
  ];

  it("allows moving a folder to root", () => {
    expect(wouldCreateCycle(folders, "b", null)).toBe(false);
  });

  it("rejects moving a folder into itself", () => {
    expect(wouldCreateCycle(folders, "a", "a")).toBe(true);
  });

  it("rejects moving a folder into its own descendant", () => {
    expect(wouldCreateCycle(folders, "a", "c")).toBe(true);
  });

  it("allows moving a folder into an unrelated folder", () => {
    expect(wouldCreateCycle(folders, "c", "a")).toBe(false);
  });
});
