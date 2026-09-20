"use client";

import { ChevronDown, ChevronRight, Copy, Folder, Lock, Swords, Users } from "lucide-react";
import type { DragEvent } from "react";
import { ActorThumbnail } from "@/components/ActorThumbnail";
import { GAP_CODES, type SrdMonsterIndexEntry } from "@/data/srd/monsters";
import { formatChallengeRating, type SrdMonsterTree } from "@/lib/srd-monster-tree";
import styles from "./ActorsPanel.module.css";

interface SrdMonsterFoldersProps {
  tree: SrdMonsterTree;
  expandedFolderIds: Set<string>;
  onToggleExpanded: (folderId: string) => void;
  onAdd: (monster: SrdMonsterIndexEntry, faction: "party" | "enemy") => void;
  onCopyToLibrary: (monster: SrdMonsterIndexEntry) => void;
  onDragStartMonster: (event: DragEvent<HTMLElement>, monster: SrdMonsterIndexEntry) => void;
}

/**
 * The permanent "SRD Monsters → Monster Type → monster" directory. It looks and behaves like the
 * user's own folders (same rows, same expand/collapse, same drag-to-map) but is read-only: no
 * rename, move, delete, context menu, or "create actor here".
 */
export function SrdMonsterFolders({ tree, expandedFolderIds, onToggleExpanded, onAdd, onCopyToLibrary, onDragStartMonster }: SrdMonsterFoldersProps) {
  const rootExpanded = expandedFolderIds.has(tree.id);

  return (
    <li className={styles.folderItem} data-testid="srd-monsters-root">
      <div className={`${styles.folderRow} ${styles.folderRowStatic}`} style={{ paddingLeft: 10 }} onClick={() => onToggleExpanded(tree.id)}>
        <button type="button" className={styles.folderToggle} aria-label={rootExpanded ? "Collapse SRD Monsters" : "Expand SRD Monsters"} aria-expanded={rootExpanded}>
          {rootExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Folder size={14} />
        <span className={styles.folderName}>{tree.name}</span>
        <span className={styles.folderCount}>{tree.count}</span>
        <span className={styles.folderLock} title="Permanent, read-only library folder" aria-label="Permanent folder">
          <Lock size={11} />
        </span>
      </div>

      {rootExpanded ? (
        <ul className={styles.list}>
          {tree.types.map((type) => {
            const expanded = expandedFolderIds.has(type.id);
            return (
              <li className={styles.folderItem} key={type.id}>
                <div className={`${styles.folderRow} ${styles.folderRowStatic}`} style={{ paddingLeft: 26 }} onClick={() => onToggleExpanded(type.id)}>
                  <button type="button" className={styles.folderToggle} aria-label={expanded ? `Collapse ${type.label}` : `Expand ${type.label}`} aria-expanded={expanded}>
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <Folder size={14} />
                  <span className={styles.folderName}>{type.label}</span>
                  <span className={styles.folderCount}>{type.monsters.length}</span>
                </div>
                {expanded ? (
                  <ul className={styles.list}>
                    {type.monsters.map((monster) => (
                      <li key={monster.id} draggable onDragStart={(event) => onDragStartMonster(event, monster)} title={gapSummary(monster)}>
                        <ActorThumbnail definition={{ name: monster.name }} />
                        <button type="button" className={styles.cardMain} onClick={() => onAdd(monster, "enemy")}>
                          <strong>{monster.name}</strong>
                          <span>
                            CR {formatChallengeRating(monster.cr)} · HP {monster.hp} · AC {monster.ac}
                            {monster.tier === "full" ? "" : ` · ${monster.tier === "partial" ? "Partial" : "Manual"}`}
                          </span>
                        </button>
                        <button type="button" onClick={() => onAdd(monster, "party")} title="Add as party"><Users size={14} /></button>
                        <button type="button" onClick={() => onAdd(monster, "enemy")} title="Add as enemy"><Swords size={14} /></button>
                        <button type="button" onClick={() => onCopyToLibrary(monster)} title="Copy to my library (editable)"><Copy size={14} /></button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

/** Tooltip: what, if anything, the engine doesn't automate for this creature yet. */
function gapSummary(monster: SrdMonsterIndexEntry): string {
  if (monster.gaps.length === 0) return `${monster.name} — fully automated`;
  return `${monster.name} — ${monster.tier === "manual" ? "not automated" : "partly automated"}:\n${monster.gaps.map((code) => `• ${GAP_CODES[code]}`).join("\n")}`;
}
