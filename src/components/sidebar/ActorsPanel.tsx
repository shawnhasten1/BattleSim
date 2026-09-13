"use client";

import { Copy, Download, FolderOpen, FolderPlus, Save, Swords, Trash2, UserPlus, Users } from "lucide-react";
import { useMemo, useState, type DragEvent, type MouseEvent } from "react";
import { ENCOUNTER_SCHEMA_VERSION, type CombatantExportPackage, type CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { useSelectedCombatant } from "@/hooks/useSelectedCombatant";
import type { Compendium } from "@/hooks/useCompendium";
import type { CompendiumDragPayload } from "@/lib/compendium";
import { ActorThumbnail } from "@/components/ActorThumbnail";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { defaultFactionForDefinition, downloadJson, safeFileName } from "@/lib/ui-helpers";
import { buildFolderTree } from "@/lib/actor-folders";
import { ActorFolderNode, RenameInput, type FolderEditState } from "./ActorFolderNode";
import styles from "./ActorsPanel.module.css";

interface ActorsPanelProps {
  compendium: Compendium;
  /** folderId, when opened from a folder's "create actor" icon, so the new actor is filed there automatically. */
  onOpenCreate: (folderId?: string) => void;
  onOpenSheet: () => void;
}

export function ActorsPanel({ compendium, onOpenCreate, onOpenSheet }: ActorsPanelProps) {
  const encounter = useEncounterStore((state) => state.encounter);
  const definitionsLibrary = useEncounterStore((state) => state.definitionsLibrary);
  const templateDefinitionIds = useEncounterStore((state) => state.templateDefinitionIds);
  const definitionStatus = useEncounterStore((state) => state.definitionStatus);
  const actorFolders = useEncounterStore((state) => state.actorFolders);
  const folderStatus = useEncounterStore((state) => state.folderStatus);
  const addCreatureDefinition = useEncounterStore((state) => state.addCreatureDefinition);
  const addLibraryDefinitionToEncounter = useEncounterStore((state) => state.addLibraryDefinitionToEncounter);
  const deleteLibraryDefinition = useEncounterStore((state) => state.deleteLibraryDefinition);
  const copyLibraryDefinition = useEncounterStore((state) => state.copyLibraryDefinition);
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
  const { selectedCombatant, selectedDefinition } = useSelectedCombatant();

  const [dropActive, setDropActive] = useState(false);
  const [rootDropActive, setRootDropActive] = useState(false);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<FolderEditState | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);

  const savedDefinitionIds = useMemo(
    () => new Set(definitionsLibrary.map((definition) => definition.id)),
    [definitionsLibrary]
  );
  const templateIdSet = useMemo(() => new Set(templateDefinitionIds), [templateDefinitionIds]);
  const directory = useMemo(() => {
    const byId = new Map<string, CreatureDefinition>();
    for (const definition of definitionsLibrary) byId.set(definition.id, definition);
    for (const definition of encounter.definitions) byId.set(definition.id, definition);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [definitionsLibrary, encounter.definitions]);
  const folderTree = useMemo(() => buildFolderTree(actorFolders, directory), [actorFolders, directory]);

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

  function renderActorRow(definition: CreatureDefinition) {
    const isSaved = savedDefinitionIds.has(definition.id);
    const isTemplate = templateIdSet.has(definition.id);
    return (
      <li key={definition.id} draggable onDragStart={(event) => onActorDragStart(event, definition)}>
        <ActorThumbnail definition={definition} />
        <button type="button" className={styles.cardMain} onClick={() => addToEncounter(definition, defaultFactionForDefinition(definition))}>
          <strong>{definition.name}</strong>
          <span>
            {isSaved ? definition.source?.documentName ?? definition.source?.provider ?? "homebrew" : "scene actor"}
            {isTemplate ? " · Template" : ""}
          </span>
        </button>
        <button type="button" onClick={() => addToEncounter(definition, "party")} title="Add as party"><Users size={14} /></button>
        <button type="button" onClick={() => addToEncounter(definition, "enemy")} title="Add as enemy"><Swords size={14} /></button>
        {isTemplate ? (
          <button type="button" onClick={() => void copyLibraryDefinition(definition.id)} title="Copy to my library">
            <Copy size={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => (isSaved ? void deleteLibraryDefinition(definition.id) : void saveDefinition(definition.id))}
            title={isSaved ? "Delete definition" : "Save to library"}
          >
            {isSaved ? <Trash2 size={14} /> : <Save size={14} />}
          </button>
        )}
      </li>
    );
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
          label: "Delete folder",
          danger: true,
          onSelect: () => void deleteActorFolder(folderMenu.folderId)
        }
      ]
    : null;

  function addToEncounter(definition: CreatureDefinition, faction: "party" | "enemy") {
    if (savedDefinitionIds.has(definition.id)) {
      addLibraryDefinitionToEncounter(definition.id, faction);
    } else {
      addCreatureDefinition(definition, faction);
    }
  }

  function exportSelected() {
    if (!selectedCombatant || !selectedDefinition) return;
    const { id, definitionId, initiative, actionEconomy, concentration, ...combatant } = selectedCombatant;
    const payload: CombatantExportPackage = {
      kind: "battle-sim-combatant",
      schemaVersion: ENCOUNTER_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      definition: structuredClone(selectedDefinition),
      combatant
    };
    downloadJson(`${safeFileName(selectedCombatant.displayName)}.${selectedCombatant.faction}.json`, payload);
  }

  function onSheetDragOver(event: DragEvent<HTMLElement>) {
    if (event.dataTransfer.types.includes("application/x-battle-sim-compendium")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDropActive(true);
    }
  }

  function onSheetDrop(event: DragEvent<HTMLElement>) {
    const raw = event.dataTransfer.getData("application/x-battle-sim-compendium");
    setDropActive(false);
    if (!raw) return;
    event.preventDefault();
    try {
      void compendium.attach(JSON.parse(raw) as CompendiumDragPayload);
    } catch {
      compendium.setStatus("Compendium drop failed");
    }
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
          <div
            className={`${styles.summary} ${dropActive ? styles.dropActive : ""}`}
            onDragOver={onSheetDragOver}
            onDragLeave={() => setDropActive(false)}
            onDrop={onSheetDrop}
          >
            <ActorThumbnail definition={selectedDefinition} combatant={selectedCombatant} />
            <div>
              <strong>{selectedCombatant.displayName}</strong>
              <span>{selectedDefinition.name} · {selectedCombatant.faction}</span>
              <span>AC {selectedDefinition.armorClass} · HP {selectedCombatant.currentHp}/{selectedDefinition.maxHp} · {selectedCombatant.state}</span>
            </div>
          </div>
          <div className={styles.actions}>
            <button type="button" onClick={onOpenSheet}><Swords size={14} /> Sheet</button>
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
      {compendium.status || definitionStatus || folderStatus ? (
        <p className={styles.status}>{definitionStatus || folderStatus || compendium.status}</p>
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
        {folderTree.roots.length === 0 && folderTree.unfiled.length === 0 && editing?.mode !== "create" ? (
          <li className={styles.empty}>No actors found.</li>
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

      {folderMenu && folderMenuItems ? (
        <ContextMenu x={folderMenu.x} y={folderMenu.y} items={folderMenuItems} onClose={() => setFolderMenu(null)} />
      ) : null}
    </div>
  );
}
