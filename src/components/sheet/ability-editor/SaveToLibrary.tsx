"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SavedAbility } from "@/lib/ability-editor/my-library";
import { Segmented } from "./controls";
import styles from "./ability-editor.module.css";

/**
 * "Save to my library": the name it's kept under, and for a copy of an entry already saved, whether to update that
 * entry or save a new one beside it. Nothing on the sheet changes: the ability is still saved (or not) with the
 * editor's own button.
 */
export function SaveToLibrary({ defaultName, linked, onSave, onCancel }: {
  defaultName: string;
  /** The entry this was made from, when it's still saved: it can be updated. */
  linked?: SavedAbility;
  onSave: (name: string, mode: "new" | "update") => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [mode, setMode] = useState<"new" | "update">(linked ? "update" : "new");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const nameId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function save() {
    if (!name.trim()) {
      setProblem("Give it a name.");
      return;
    }
    setBusy(true);
    const failed = await onSave(name.trim(), mode);
    setBusy(false);
    if (failed) setProblem(failed);
  }

  return (
    <div
      className={styles.prompt} role="group" aria-label="Save to my library"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); onCancel(); }
        if (event.key === "Enter" && event.target === inputRef.current) { event.preventDefault(); void save(); }
      }}
    >
      <p>Keep a copy in <strong>My library</strong>, to add to any creature from Add ability.</p>
      <div className={styles.libraryRow}>
        <label htmlFor={nameId}>Name in my library</label>
        <input ref={inputRef} id={nameId} value={name} onChange={(event) => { setName(event.target.value); setProblem(null); }} />
      </div>
      {linked ? (
        <Segmented
          label="Save it as" value={mode}
          options={[{ value: "update", label: `An update to “${linked.name}”` }, { value: "new", label: "A new one" }]}
          onChange={setMode}
        />
      ) : null}
      {problem ? <p className={styles.error} role="alert">{problem}</p> : null}
      <div className={styles.promptActions}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : mode === "update" && linked ? "Update in my library" : "Save to my library"}
        </button>
        <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
