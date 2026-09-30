"use client";

import { useEffect, useRef } from "react";
import styles from "./ability-editor/ability-editor.module.css";

/** "Save changes to Bite?": asked before unsaved edits would be lost. Keep editing is the safe default. */
export function UnsavedPrompt({ message, onSave, onDiscard, onKeep, saveLabel = "Save", discardLabel = "Discard" }: {
  message: string;
  onSave: () => void;
  onDiscard: () => void;
  onKeep: () => void;
  saveLabel?: string;
  discardLabel?: string;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { keepRef.current?.focus(); }, []);
  return (
    <div
      className={styles.prompt} role="alertdialog" aria-label="Unsaved changes"
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onKeep(); } }}
    >
      <p>{message}</p>
      <div className={styles.promptActions}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={onSave}>{saveLabel}</button>
        <button type="button" className={styles.btn} onClick={onDiscard}>{discardLabel}</button>
        <button ref={keepRef} type="button" className={styles.btn} onClick={onKeep}>Keep editing</button>
      </div>
    </div>
  );
}
