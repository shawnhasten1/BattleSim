"use client";

import { InfoTooltip } from "@/components/ui/InfoTooltip";
import styles from "./builder.module.css";

/** The builder's keyboard shortcuts (CHARACTER_BUILDER_UX_PLAN.md §6, Phase 9), in a "?" in the window's title bar. */
export function Shortcuts({ undo = false }: { undo?: boolean }) {
  const rows: Array<[string, string]> = [
    ...(undo ? [["Ctrl+Z", "Undo"], ["Ctrl+Shift+Z or Ctrl+Y", "Redo"]] as Array<[string, string]> : []),
    ["Tab, Shift+Tab", "Move between controls"],
    ["Arrow keys", "Move between cards (choosing as you go) or spell tiles"],
    ["Space", "Pick or unpick a chip or a spell"],
    ["Enter", "Open a folded spell grid; place a value on a score"],
    ["i", "Pin a rules card beside the step"],
    ["Esc", "Close a rules card"]
  ];
  return (
    <InfoTooltip
      label="Keyboard shortcuts" className={styles.titleButton}
      content={(
        <dl className={styles.shortcuts}>
          {rows.map(([keys, does]) => (
            <div key={keys}><dt>{keys}</dt><dd>{does}</dd></div>
          ))}
        </dl>
      )}
    >
      ?
    </InfoTooltip>
  );
}
