"use client";

import type { SheetStyle } from "@/store/sheet-windows-store";
import { SHEET_STYLE_IDS, SHEET_STYLES } from "./styles/registry";
import styles from "./sheet.module.css";

/** Standard | Codex, in a sheet window's title bar (CHARACTER_SHEET_WINDOWS_PLAN.md D5). */
export function StyleSwitch({ style, onChange }: { style: SheetStyle; onChange: (style: SheetStyle) => void }) {
  return (
    <span className={styles.styleSwitch} role="group" aria-label="Sheet style">
      {SHEET_STYLE_IDS.map((id) => (
        <button key={id} type="button" aria-pressed={id === style} onClick={() => { if (id !== style) onChange(id); }}>
          {SHEET_STYLES[id].label}
        </button>
      ))}
    </span>
  );
}
