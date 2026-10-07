"use client";

import { useId } from "react";
import { useSheetMode } from "./sheet-mode";
import styles from "./sheet.module.css";

export type SheetTabId = "stats" | "abilities" | "token";

const TABS: Array<{ id: SheetTabId; label: string; scope: "creature" | "token" }> = [
  { id: "stats", label: "Stats", scope: "creature" },
  { id: "abilities", label: "Abilities", scope: "creature" },
  { id: "token", label: "Token", scope: "token" }
];

/**
 * The sheet's tabs, grouped by what they change (plan D1): Stats and Abilities change the creature, every token of it
 * in the scene; Token changes this token. A caption over each group says so, and each tab is described by its caption.
 */
export function ScopedTabs({ tab, onSelect, creature, creatureCaption, creatureHelp, token }: {
  tab: SheetTabId;
  onSelect: (tab: SheetTabId) => void;
  creature: string;
  creatureCaption: string;
  creatureHelp: string;
  token: string;
}) {
  const creatureId = useId();
  const tokenId = useId();
  // No token in the scene: the Token tab sets what each new one starts with.
  const { tokenless } = useSheetMode();
  return (
    <div className={styles.scopedTabs}>
      <div className={styles.scopes}>
        <span id={creatureId} className={styles.scope} title={creatureHelp}>
          <strong>{creature}</strong> · {creatureCaption}
        </span>
        {tokenless ? (
          <span id={tokenId} className={styles.scope} title={`No token of ${creature} is in this scene: the Token tab sets what every new one starts with.`}>
            <strong>New tokens</strong> · what each starts with
          </span>
        ) : (
          <span id={tokenId} className={styles.scope} title={`Changes here apply to ${token} only.`}>
            <strong>{token}</strong> · this token
          </span>
        )}
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Actor sheet sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === tab}
            aria-describedby={entry.scope === "creature" ? creatureId : tokenId}
            className={[entry.id === tab ? styles.active : "", entry.scope === "token" ? styles.tokenTab : ""].filter(Boolean).join(" ")}
            onClick={() => { if (entry.id !== tab) onSelect(entry.id); }}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}
