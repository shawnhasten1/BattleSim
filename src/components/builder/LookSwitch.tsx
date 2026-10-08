"use client";

import type { ReactNode } from "react";
import type { CodexPaletteId } from "@/lib/actor-sheet/codex";
import type { SheetStyle } from "@/store/sheet-windows-store";
import styles from "./builder.module.css";

/**
 * A builder window's look, in its title bar (CHARACTER_BUILDER_UX_PLAN.md D1): Standard or the Codex, shared with the PC
 * sheets, and in the Codex its colours. `children` follow (the builder's undo and redo).
 */
export function LookSwitch({ look, onLook, palette, onPalette, children }: {
  look: SheetStyle;
  onLook: (next: SheetStyle) => void;
  palette: CodexPaletteId;
  onPalette: (next: CodexPaletteId) => void;
  children?: ReactNode;
}) {
  return (
    <span className={styles.titleControls}>
      <span role="group" aria-label="Builder look" className={styles.lookSwitch}>
        {(["standard", "codex"] as const).map((id) => (
          <button key={id} type="button" aria-pressed={look === id} onClick={() => onLook(id)}>{id === "standard" ? "Standard" : "Codex"}</button>
        ))}
      </span>
      {look === "codex" ? (
        <span role="group" aria-label="Codex colours" className={styles.lookSwitch}>
          {(["dark", "light"] as const).map((id) => (
            <button key={id} type="button" aria-pressed={palette === id} onClick={() => onPalette(id)}>{id === "dark" ? "Dark" : "Light"}</button>
          ))}
        </span>
      ) : null}
      {children}
    </span>
  );
}
