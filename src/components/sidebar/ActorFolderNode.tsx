"use client";

import { ChevronDown, ChevronRight, Folder, UserPlus } from "lucide-react";
import { useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import type { CreatureDefinition } from "@/engine";
import type { ActorFolderNode as ActorFolderNodeData } from "@/lib/actor-folders";
import styles from "./ActorsPanel.module.css";

export type FolderEditState =
  | { mode: "rename"; folderId: string; initialName: string }
  | { mode: "create"; parentId: string | null };

interface ActorFolderNodeProps {
  node: ActorFolderNodeData;
  depth: number;
  expandedFolderIds: Set<string>;
  onToggleExpanded: (folderId: string) => void;
  editing: FolderEditState | null;
  onCommitRename: (folderId: string, name: string) => void;
  onCommitCreate: (parentId: string | null, name: string) => void;
  onCancelEdit: () => void;
  onFolderContextMenu: (event: MouseEvent, folderId: string) => void;
  onDropActorOnFolder: (definitionId: string, folderId: string) => void;
  onDropFolderOnFolder: (folderId: string, newParentId: string) => void;
  onDragStartFolder: (event: DragEvent<HTMLElement>, folderId: string) => void;
  onCreateActor: (folderId: string) => void;
  renderActorRow: (definition: CreatureDefinition) => ReactNode;
}

/** One folder row plus its nested children/definitions, recursively. */
export function ActorFolderNode(props: ActorFolderNodeProps) {
  const { node, depth } = props;
  const [dropActive, setDropActive] = useState(false);
  const expanded = props.expandedFolderIds.has(node.folder.id);
  const isRenaming = props.editing?.mode === "rename" && props.editing.folderId === node.folder.id;
  const isCreatingChild = props.editing?.mode === "create" && props.editing.parentId === node.folder.id;

  function onDragOver(event: DragEvent<HTMLElement>) {
    // dropEffect must agree with the dragged item's effectAllowed (set at dragstart) or
    // Chromium silently refuses the drop: actors drag as "copy", folders drag as "move".
    if (event.dataTransfer.types.includes("application/x-battle-sim-actor")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDropActive(true);
    } else if (event.dataTransfer.types.includes("application/x-battle-sim-folder")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropActive(true);
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    setDropActive(false);
    const actorRaw = event.dataTransfer.getData("application/x-battle-sim-actor");
    const folderRaw = event.dataTransfer.getData("application/x-battle-sim-folder");
    if (actorRaw) {
      event.preventDefault();
      try {
        const { definitionId } = JSON.parse(actorRaw) as { definitionId: string };
        props.onDropActorOnFolder(definitionId, node.folder.id);
      } catch {
        // ignore malformed payload
      }
    } else if (folderRaw) {
      event.preventDefault();
      try {
        const { folderId } = JSON.parse(folderRaw) as { folderId: string };
        if (folderId !== node.folder.id) props.onDropFolderOnFolder(folderId, node.folder.id);
      } catch {
        // ignore malformed payload
      }
    }
  }

  return (
    <li className={styles.folderItem}>
      <div
        className={`${styles.folderRow} ${dropActive ? styles.dropActive : ""}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        draggable={!isRenaming}
        onDragStart={(event) => props.onDragStartFolder(event, node.folder.id)}
        onDragOver={onDragOver}
        onDragLeave={() => setDropActive(false)}
        onDrop={onDrop}
        onContextMenu={(event) => props.onFolderContextMenu(event, node.folder.id)}
      >
        <button
          type="button"
          className={styles.folderToggle}
          onClick={() => props.onToggleExpanded(node.folder.id)}
          aria-label={expanded ? "Collapse folder" : "Expand folder"}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Folder size={14} />
        {isRenaming ? (
          <RenameInput
            initialName={props.editing && props.editing.mode === "rename" ? props.editing.initialName : node.folder.name}
            onCommit={(name) => props.onCommitRename(node.folder.id, name)}
            onCancel={props.onCancelEdit}
          />
        ) : (
          <span className={styles.folderName}>{node.folder.name}</span>
        )}
        {isRenaming ? null : (
          <button
            type="button"
            className={styles.folderCreateActor}
            title="Create actor in this folder"
            onClick={(event) => {
              event.stopPropagation();
              props.onCreateActor(node.folder.id);
            }}
          >
            <UserPlus size={13} />
          </button>
        )}
      </div>
      {expanded ? (
        <ul className={styles.list}>
          {isCreatingChild ? (
            <li className={styles.folderItem}>
              <div className={styles.folderRow} style={{ paddingLeft: 10 + (depth + 1) * 16 }}>
                <span className={styles.folderToggle} />
                <Folder size={14} />
                <RenameInput
                  initialName=""
                  placeholder="Folder name"
                  onCommit={(name) => props.onCommitCreate(node.folder.id, name)}
                  onCancel={props.onCancelEdit}
                />
              </div>
            </li>
          ) : null}
          {node.children.map((child) => (
            <ActorFolderNode key={child.folder.id} {...props} node={child} depth={depth + 1} />
          ))}
          {node.definitions.length === 0 && node.children.length === 0 && !isCreatingChild ? (
            <li className={styles.empty} style={{ paddingLeft: 10 + (depth + 1) * 16 }}>
              Empty folder
            </li>
          ) : null}
          {node.definitions.map((definition) => props.renderActorRow(definition))}
        </ul>
      ) : null}
    </li>
  );
}

export function RenameInput({
  initialName,
  placeholder,
  onCommit,
  onCancel
}: {
  initialName: string;
  placeholder?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  // Enter/Escape unmount this input, which fires a native blur — guard so the
  // blur handler below doesn't also commit (and double-create/rename).
  const settled = useRef(false);
  return (
    <input
      autoFocus
      className={styles.folderNameInput}
      value={value}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          settled.current = true;
          const trimmed = value.trim();
          if (trimmed) onCommit(trimmed);
          else onCancel();
        } else if (event.key === "Escape") {
          settled.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (settled.current) return;
        settled.current = true;
        const trimmed = value.trim();
        if (trimmed) onCommit(trimmed);
        else onCancel();
      }}
    />
  );
}
