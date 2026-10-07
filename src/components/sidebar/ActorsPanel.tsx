"use client";

import { Copy, Download, FolderOpen, FolderPlus, Save, Swords, Trash2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from "react";
import { actualMaxHp, armorClassOf, type CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { openActorSheet } from "@/store/sheet-windows-store";
import { useSelectedCombatant } from "@/hooks/useSelectedCombatant";
import { ActorThumbnail } from "@/components/ActorThumbnail";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { defaultFactionForDefinition } from "@/lib/ui-helpers";
import { exportCombatant } from "@/lib/actor-sheet/export";
import { namedBy, tokensOf } from "@/lib/actor-sheet/scope";
import { previewToken } from "@/lib/actor-sheet/token";
import { buildFolderTree, type ActorFolderNode as FolderNodeData } from "@/lib/actor-folders";
import { isSrdMonsterId, loadSrdMonster, type SrdMonsterIndexEntry } from "@/data/srd/monsters";
import { SrdMonsterFolders } from "./SrdMonsterFolders";
import { ActorFolderNode, RenameInput, type FolderEditState } from "./ActorFolderNode";
import { ActorRow } from "./ActorRow";
import { ConfirmDialog, type ConfirmChoice } from "./ConfirmDialog";
import styles from "./ActorsPanel.module.css";

interface ActorsPanelProps {
  /** folderId, when opened from a folder's "create actor" icon, so the new actor is filed there automatically. */
  onOpenCreate: (folderId?: string) => void;
  /** Opens that token's sheet window. */
  onOpenSheet: (combatantId: string) => void;
}

/** Where an actor in the directory stands: yours, a shared template, only in this scene, or an SRD monster. */
type ActorKind = "mine" | "template" | "scene" | "srd";

interface PanelToast {
  message: string;
  undo?: () => void;
}

interface Confirm {
  title: string;
  message: string;
  choices: ConfirmChoice[];
}

/** The folder `folderId` in the tree, wherever it's nested. */
function findFolder(nodes: FolderNodeData[], folderId: string): FolderNodeData | undefined {
  for (const node of nodes) {
    if (node.folder.id === folderId) return node;
    const inner = findFolder(node.children, folderId);
    if (inner) return inner;
  }
  return undefined;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function ActorsPanel({ onOpenCreate, onOpenSheet }: ActorsPanelProps) {
  const encounter = useEncounterStore((state) => state.encounter);
  const definitionsLibrary = useEncounterStore((state) => state.definitionsLibrary);
  const templateDefinitionIds = useEncounterStore((state) => state.templateDefinitionIds);
  const benchIds = useEncounterStore((state) => state.benchIds);
  const definitionStatus = useEncounterStore((state) => state.definitionStatus);
  const actorFolders = useEncounterStore((state) => state.actorFolders);
  const folderStatus = useEncounterStore((state) => state.folderStatus);
  const addCreatureDefinition = useEncounterStore((state) => state.addCreatureDefinition);
  const addSrdMonster = useEncounterStore((state) => state.addSrdMonster);
  const saveSrdMonsterCopy = useEncounterStore((state) => state.saveSrdMonsterCopy);
  const addLibraryDefinitionToEncounter = useEncounterStore((state) => state.addLibraryDefinitionToEncounter);
  const copyLibraryDefinition = useEncounterStore((state) => state.copyLibraryDefinition);
  const duplicateLibraryDefinition = useEncounterStore((state) => state.duplicateLibraryDefinition);
  const deleteActor = useEncounterStore((state) => state.deleteActor);
  const restoreLibraryDefinition = useEncounterStore((state) => state.restoreLibraryDefinition);
  const saveDefinition = useEncounterStore((state) => state.saveDefinition);
  const saveSelectedDefinition = useEncounterStore((state) => state.saveSelectedDefinition);
  const loadDefinitionsLibrary = useEncounterStore((state) => state.loadDefinitionsLibrary);
  const loadActorFolders = useEncounterStore((state) => state.loadActorFolders);
  const createActorFolder = useEncounterStore((state) => state.createActorFolder);
  const renameActorFolder = useEncounterStore((state) => state.renameActorFolder);
  const moveActorFolder = useEncounterStore((state) => state.moveActorFolder);
  const deleteActorFolder = useEncounterStore((state) => state.deleteActorFolder);
  const moveDefinitionToFolder = useEncounterStore((state) => state.moveDefinitionToFolder);
  const duplicateSelected = useEncounterStore((state) => state.duplicateSelected);
  const removeCombatant = useEncounterStore((state) => state.removeCombatant);
  const undo = useEncounterStore((state) => state.undo);
  const { selectedCombatant, selectedDefinition } = useSelectedCombatant();

  const [rootDropActive, setRootDropActive] = useState(false);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<FolderEditState | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
  // The row picked (one at a time, across every folder), and the menu open for a row.
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [toast, setToast] = useState<PanelToast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const savedDefinitionIds = useMemo(
    () => new Set(definitionsLibrary.map((definition) => definition.id)),
    [definitionsLibrary]
  );
  const templateIdSet = useMemo(() => new Set(templateDefinitionIds), [templateDefinitionIds]);
  const directory = useMemo(() => {
    const byId = new Map<string, CreatureDefinition>();
    for (const definition of definitionsLibrary) byId.set(definition.id, definition);
    // The scene's creatures, less those only there for an open sheet (the bench) and SRD monsters (in their own folder).
    for (const definition of encounter.definitions) {
      if (isSrdMonsterId(definition.id) || (benchIds.includes(definition.id) && !byId.has(definition.id))) continue;
      byId.set(definition.id, definition);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [definitionsLibrary, encounter.definitions, benchIds]);
  const folderTree = useMemo(() => buildFolderTree(actorFolders, directory), [actorFolders, directory]);

  function kindOf(definitionId: string): ActorKind {
    if (isSrdMonsterId(definitionId)) return "srd";
    if (templateIdSet.has(definitionId)) return "template";
    return savedDefinitionIds.has(definitionId) ? "mine" : "scene";
  }

  function onSrdMonsterDragStart(event: DragEvent<HTMLElement>, monster: SrdMonsterIndexEntry, quantity: number) {
    event.dataTransfer.effectAllowed = "copy";
    // Same payload as any other actor; the SRD id is resolved (and loaded on demand) by the drop target.
    event.dataTransfer.setData("application/x-battle-sim-actor", JSON.stringify({ definitionId: monster.id, faction: "enemy", count: quantity }));
  }

  function onActorDragStart(event: DragEvent<HTMLElement>, definition: CreatureDefinition) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "application/x-battle-sim-actor",
      JSON.stringify({ definitionId: definition.id, faction: defaultFactionForDefinition(definition) })
    );
  }

  function onFolderDragStart(event: DragEvent<HTMLElement>, folderId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-battle-sim-folder", JSON.stringify({ folderId }));
  }

  function toggleExpanded(folderId: string) {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function onFolderContextMenu(event: MouseEvent, folderId: string) {
    event.preventDefault();
    setFolderMenu({ x: event.clientX, y: event.clientY, folderId });
  }

  function onRootDragOver(event: DragEvent<HTMLElement>) {
    // dropEffect must agree with the dragged item's effectAllowed (set at dragstart) or
    // Chromium silently refuses the drop: actors drag as "copy", folders drag as "move".
    if (event.dataTransfer.types.includes("application/x-battle-sim-actor")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setRootDropActive(true);
    } else if (event.dataTransfer.types.includes("application/x-battle-sim-folder")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setRootDropActive(true);
    }
  }

  function onRootDrop(event: DragEvent<HTMLElement>) {
    setRootDropActive(false);
    const actorRaw = event.dataTransfer.getData("application/x-battle-sim-actor");
    const folderRaw = event.dataTransfer.getData("application/x-battle-sim-folder");
    if (actorRaw) {
      event.preventDefault();
      try {
        const { definitionId } = JSON.parse(actorRaw) as { definitionId: string };
        void moveDefinitionToFolder(definitionId, null);
      } catch {
        // ignore malformed payload
      }
    } else if (folderRaw) {
      event.preventDefault();
      try {
        const { folderId } = JSON.parse(folderRaw) as { folderId: string };
        void moveActorFolder(folderId, null);
      } catch {
        // ignore malformed payload
      }
    }
  }

  /** A token of it on the map, on the side it fights on by default (party for a character). */
  function addToEncounter(definition: CreatureDefinition) {
    const faction = defaultFactionForDefinition(definition);
    if (savedDefinitionIds.has(definition.id)) {
      void addLibraryDefinitionToEncounter(definition.id, faction);
    } else {
      addCreatureDefinition(definition, faction);
    }
  }

  async function openSheet(definitionId: string) {
    const opened = await openActorSheet(definitionId);
    if (!opened) setToast({ message: "Couldn't open that sheet." });
  }

  /** Its JSON, as a token's export: one of its tokens here, or a new one. */
  function exportActor(definition: CreatureDefinition) {
    const token = tokensOf(useEncounterStore.getState().encounter, definition.id)[0];
    exportCombatant(token ?? previewToken(definition), definition);
  }

  /** Deletes it now, with Undo in the toast. `withTokens`: its tokens and its copy in this scene go too. */
  async function runDelete(definition: CreatureDefinition, withTokens: boolean) {
    const result = await deleteActor(definition.id, { withTokens });
    if (result.blocked) {
      setToast({ message: result.blocked });
      return;
    }
    // Only the delete it announces: anything done since would be undone instead.
    const depth = useEncounterStore.getState().undoStack.length;
    const message = result.fromLibrary
      ? `Deleted ${definition.name} from your library${result.sceneStep ? ", with its tokens" : ""}.`
      : `Removed ${definition.name} from this scene.`;
    setToast({
      message,
      undo: () => {
        if (result.sceneStep && useEncounterStore.getState().undoStack.length === depth) undo();
        if (result.fromLibrary && result.deleted) void restoreLibraryDefinition(result.deleted);
      }
    });
  }

  /** Delete…: at once for an actor with no tokens here (Undo in the toast), asking first when it has some (D6). */
  function requestDelete(definition: CreatureDefinition) {
    const kind = kindOf(definition.id);
    const tokens = tokensOf(encounter, definition.id).length;
    if (kind === "mine" && tokens > 0) {
      const blocked = namedBy(encounter, definition.id);
      setConfirm({
        title: `Delete ${definition.name}?`,
        message: `${definition.name} has ${plural(tokens, "token")} on this map. Keep them, and this scene keeps its own copy of ${definition.name}; or delete them too.`,
        choices: [
          { label: "Delete, keep tokens", onSelect: () => void runDelete(definition, false) },
          {
            label: `Delete with its ${plural(tokens, "token")}`, danger: true,
            blocked: blocked ? `${blocked}, so it can't leave this scene.` : undefined,
            onSelect: () => void runDelete(definition, true)
          }
        ]
      });
      return;
    }
    void runDelete(definition, true);
  }

  async function copyToLibrary(definitionId: string, name: string) {
    const copyId = isSrdMonsterId(definitionId) ? await saveSrdMonsterCopy(definitionId) : await copyLibraryDefinition(definitionId);
    setToast({ message: copyId ? `Copied ${name} to your library.` : `Couldn't copy ${name} to your library.` });
  }

  function definitionMenu(definition: CreatureDefinition): ContextMenuItem[] {
    const kind = kindOf(definition.id);
    const scene = useEncounterStore.getState().encounter;
    const inScene = scene.definitions.some((candidate) => candidate.id === definition.id);
    // Deleting takes it out of this scene too when it's only here, or has no token here.
    const leaves = inScene && (kind === "scene" || tokensOf(scene, definition.id).length === 0);
    const blocked = leaves ? namedBy(scene, definition.id) : undefined;
    return [
      { label: "Open sheet", onSelect: () => void openSheet(definition.id) },
      ...(kind === "scene" ? [{
        label: "Save to my library",
        onSelect: () => void saveDefinition(definition.id).then(() => setToast({ message: `Saved ${definition.name} to your library.` }))
      }] : []),
      ...(kind === "template" ? [{ label: "Copy to my library", onSelect: () => void copyToLibrary(definition.id, definition.name) }] : []),
      ...(kind === "mine" ? [{
        label: "Duplicate",
        onSelect: () => void duplicateLibraryDefinition(definition.id).then((copyId) =>
          setToast({ message: copyId ? `Added ${definition.name} (copy) to your library.` : `Couldn't duplicate ${definition.name}.` }))
      }] : []),
      { label: "Export JSON", onSelect: () => exportActor(definition) },
      // Never an SRD monster's or a shared template's (ACTORS_TAB_PLAN.md D4).
      ...(kind === "mine" || kind === "scene" ? [
        { separator: true } as ContextMenuItem,
        {
          label: kind === "mine" ? "Delete…" : "Remove from this scene",
          danger: true,
          disabled: Boolean(blocked),
          hint: blocked ? `${blocked}, so it can't leave this scene.` : undefined,
          onSelect: () => requestDelete(definition)
        }
      ] : [])
    ];
  }

  function srdMenu(monster: SrdMonsterIndexEntry): ContextMenuItem[] {
    return [
      { label: "Open sheet", onSelect: () => void openSheet(monster.id) },
      { label: "Copy to my library", onSelect: () => void copyToLibrary(monster.id, monster.name) },
      {
        label: "Export JSON",
        onSelect: () => void loadSrdMonster(monster.id).then((definition) => { if (definition) exportActor(definition); })
      }
    ];
  }

  function renderActorRow(definition: CreatureDefinition) {
    const kind = kindOf(definition.id);
    const source = kind === "scene" ? "this scene only"
      : definition.source?.documentName ?? definition.source?.provider ?? "homebrew";
    return (
      <ActorRow
        key={definition.id}
        name={definition.name}
        subtitle={`${source}${kind === "template" ? " · Template" : ""}`}
        thumbnail={<ActorThumbnail definition={definition} />}
        selected={selectedRowId === definition.id}
        addTitle={`Add to the map as ${defaultFactionForDefinition(definition) === "party" ? "party" : "an enemy"}`}
        onSelect={() => setSelectedRowId(definition.id)}
        onOpen={() => void openSheet(definition.id)}
        onAdd={() => addToEncounter(definition)}
        onMenu={(at) => setRowMenu({ ...at, items: definitionMenu(definition) })}
        onDragStart={(event) => onActorDragStart(event, definition)}
      />
    );
  }

  function requestFolderDelete(folderId: string) {
    const node = findFolder(folderTree.roots, folderId);
    if (!node) return;
    const actors = node.definitions.length;
    const folders = node.children.length;
    const contents = [actors ? plural(actors, "actor") : "", folders ? plural(folders, "subfolder") : ""].filter(Boolean).join(" and ");
    setConfirm({
      title: `Delete ${node.folder.name}?`,
      message: contents ? `Its ${contents} ${actors + folders === 1 ? "moves" : "move"} up a level; nothing in it is deleted.` : "It's empty.",
      choices: [{ label: "Delete folder", danger: true, onSelect: () => void deleteActorFolder(folderId) }]
    });
  }

  const folderMenuItems: ContextMenuItem[] | null = folderMenu
    ? [
        {
          label: "New subfolder",
          icon: <FolderPlus size={14} />,
          onSelect: () => {
            setExpandedFolderIds((prev) => new Set(prev).add(folderMenu.folderId));
            setEditing({ mode: "create", parentId: folderMenu.folderId });
          }
        },
        {
          label: "Rename",
          onSelect: () => {
            const folder = actorFolders.find((candidate) => candidate.id === folderMenu.folderId);
            if (folder) setEditing({ mode: "rename", folderId: folder.id, initialName: folder.name });
          }
        },
        { separator: true },
        {
          label: "Delete folder…",
          danger: true,
          onSelect: () => requestFolderDelete(folderMenu.folderId)
        }
      ]
    : null;

  function exportSelected() {
    if (!selectedCombatant || !selectedDefinition) return;
    exportCombatant(selectedCombatant, selectedDefinition);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.top}>
        <button type="button" className={styles.create} onClick={() => onOpenCreate()}>
          <UserPlus size={16} /> Create Token
        </button>
        <span className={styles.count}>{directory.length} actors · {encounter.combatants.length} tokens</span>
      </div>

      {selectedCombatant && selectedDefinition ? (
        <div className={styles.selection}>
          <div className={styles.summary}>
            <ActorThumbnail definition={selectedDefinition} combatant={selectedCombatant} />
            <div>
              <strong>{selectedCombatant.displayName}</strong>
              <span>{selectedDefinition.name} · {selectedCombatant.faction}</span>
              <span>AC {armorClassOf(selectedDefinition, selectedCombatant).total} · HP {selectedCombatant.currentHp}/{actualMaxHp(selectedDefinition, selectedCombatant)} · {selectedCombatant.state}</span>
            </div>
          </div>
          <div className={styles.actions}>
            <button type="button" onClick={() => onOpenSheet(selectedCombatant.id)}><Swords size={14} /> Sheet</button>
            <button type="button" onClick={duplicateSelected}><Copy size={14} /> Duplicate</button>
            <button type="button" onClick={exportSelected}><Download size={14} /> Export</button>
            {templateIdSet.has(selectedDefinition.id) ? (
              <button type="button" onClick={() => void copyLibraryDefinition(selectedDefinition.id)} title="Templates are read-only — this saves an editable copy to your library">
                <Copy size={14} /> Copy to My Library
              </button>
            ) : (
              <button type="button" onClick={() => void saveSelectedDefinition()}><Save size={14} /> Save</button>
            )}
            <button type="button" className={styles.danger} onClick={() => removeCombatant(selectedCombatant.id)}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      ) : (
        <p className={styles.empty}>Select a token on the map, or create one.</p>
      )}

      <div
        className={`${styles.dirHead} ${rootDropActive ? styles.dropActive : ""}`}
        onDragOver={onRootDragOver}
        onDragLeave={() => setRootDropActive(false)}
        onDrop={onRootDrop}
        title="Drop here to move to root"
      >
        <span>Actor directory</span>
        <div className={styles.dirHeadActions}>
          <button type="button" onClick={() => setEditing({ mode: "create", parentId: null })} title="New folder">
            <FolderPlus size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              void loadDefinitionsLibrary();
              void loadActorFolders();
            }}
            title="Refresh library"
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </div>
      {definitionStatus || folderStatus ? (
        <p className={styles.status}>{definitionStatus || folderStatus}</p>
      ) : null}

      <ul className={styles.list}>
        {editing?.mode === "create" && editing.parentId === null ? (
          <li className={styles.folderItem}>
            <div className={styles.folderRow} style={{ paddingLeft: 10 }}>
              <span className={styles.folderToggle} />
              <FolderPlus size={14} />
              <RenameInput
                initialName=""
                placeholder="Folder name"
                onCommit={(name) => {
                  void createActorFolder(name, null);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            </div>
          </li>
        ) : null}
        <SrdMonsterFolders
          expandedFolderIds={expandedFolderIds}
          onToggleExpanded={toggleExpanded}
          selectedId={selectedRowId}
          onSelect={setSelectedRowId}
          onOpen={(monster) => void openSheet(monster.id)}
          onAdd={(monster, faction, quantity) => void addSrdMonster(monster.id, faction, undefined, quantity)}
          onMenu={(monster, at) => setRowMenu({ ...at, items: srdMenu(monster) })}
          onDragStartMonster={onSrdMonsterDragStart}
        />
        {folderTree.roots.length === 0 && folderTree.unfiled.length === 0 && editing?.mode !== "create" ? (
          <li className={styles.empty}>No saved actors yet.</li>
        ) : null}
        {folderTree.roots.map((node) => (
          <ActorFolderNode
            key={node.folder.id}
            node={node}
            depth={0}
            expandedFolderIds={expandedFolderIds}
            onToggleExpanded={toggleExpanded}
            editing={editing}
            onCommitRename={(folderId, name) => {
              void renameActorFolder(folderId, name);
              setEditing(null);
            }}
            onCommitCreate={(parentId, name) => {
              void createActorFolder(name, parentId);
              setEditing(null);
            }}
            onCancelEdit={() => setEditing(null)}
            onFolderContextMenu={onFolderContextMenu}
            onDropActorOnFolder={(definitionId, folderId) => void moveDefinitionToFolder(definitionId, folderId)}
            onDropFolderOnFolder={(folderId, newParentId) => void moveActorFolder(folderId, newParentId)}
            onDragStartFolder={onFolderDragStart}
            onCreateActor={onOpenCreate}
            renderActorRow={renderActorRow}
          />
        ))}
        {folderTree.unfiled.map((definition) => renderActorRow(definition))}
      </ul>

      {toast ? (
        <div className={styles.toast} role="status">
          <span>{toast.message}</span>
          {toast.undo ? (
            <button type="button" onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>
          ) : null}
        </div>
      ) : null}

      {folderMenu && folderMenuItems ? (
        <ContextMenu x={folderMenu.x} y={folderMenu.y} items={folderMenuItems} onClose={() => setFolderMenu(null)} />
      ) : null}
      {rowMenu ? <ContextMenu x={rowMenu.x} y={rowMenu.y} items={rowMenu.items} onClose={() => setRowMenu(null)} /> : null}
      {confirm ? <ConfirmDialog title={confirm.title} message={confirm.message} choices={confirm.choices} onClose={() => setConfirm(null)} /> : null}
    </div>
  );
}
