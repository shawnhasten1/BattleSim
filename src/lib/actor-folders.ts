import type { CreatureDefinition, Id } from "@/engine";

export interface ActorFolder {
  id: Id;
  name: string;
  parentId: Id | null;
}

export interface ActorFolderNode {
  folder: ActorFolder;
  children: ActorFolderNode[];
  definitions: CreatureDefinition[];
}

export interface ActorFolderTree {
  roots: ActorFolderNode[];
  /** Definitions with no folderId (or a folderId that no longer resolves to a folder). */
  unfiled: CreatureDefinition[];
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

/**
 * Nests folders by parentId and files each definition under its folderId.
 * A definition whose folderId doesn't resolve to a known folder is treated
 * as unfiled rather than dropped, so a deleted/missing folder can't hide actors.
 */
export function buildFolderTree(folders: ActorFolder[], definitions: CreatureDefinition[]): ActorFolderTree {
  const nodesById = new Map<Id, ActorFolderNode>();
  for (const folder of folders) {
    nodesById.set(folder.id, { folder, children: [], definitions: [] });
  }

  const roots: ActorFolderNode[] = [];
  for (const node of nodesById.values()) {
    const parent = node.folder.parentId ? nodesById.get(node.folder.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const unfiled: CreatureDefinition[] = [];
  for (const definition of definitions) {
    const node = definition.folderId ? nodesById.get(definition.folderId) : undefined;
    if (node) node.definitions.push(definition);
    else unfiled.push(definition);
  }

  function sortByFolderName(a: ActorFolderNode, b: ActorFolderNode) {
    return byName(a.folder, b.folder);
  }
  function sortNode(node: ActorFolderNode) {
    node.children.sort(sortByFolderName);
    node.definitions.sort(byName);
    node.children.forEach(sortNode);
  }
  roots.sort(sortByFolderName);
  roots.forEach(sortNode);
  unfiled.sort(byName);

  return { roots, unfiled };
}

/** True if setting `folderId`'s parent to `candidateParentId` would create a cycle (moving a folder into itself or one of its own descendants). */
export function wouldCreateCycle(folders: ActorFolder[], folderId: Id, candidateParentId: Id | null): boolean {
  if (candidateParentId === null) return false;
  if (candidateParentId === folderId) return true;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(candidateParentId)?.parentId ?? null;
  while (current !== null) {
    if (current === folderId) return true;
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}
