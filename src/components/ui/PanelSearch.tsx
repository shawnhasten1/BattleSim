"use client";

import type { KeyboardEvent } from "react";
import styles from "./PanelSearch.module.css";

interface PanelSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Called on Enter. */
  onSubmit?: () => void;
  /** Optional trailing button (e.g. "+ New", search icon text). */
  actionLabel?: string;
  onAction?: () => void;
}

/** Search input with an optional trailing action button. Sits at a panel's top. */
export function PanelSearch({ value, onChange, placeholder, onSubmit, actionLabel, onAction }: PanelSearchProps) {
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && onSubmit) onSubmit();
  }

  return (
    <div className={styles.search}>
      <input
        className={styles.input}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {actionLabel ? (
        <button type="button" className={styles.action} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
