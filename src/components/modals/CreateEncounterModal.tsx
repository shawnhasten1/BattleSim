"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { CreateEncounterFields, DEFAULT_NEW_GRID, type GridChoice } from "./CreateEncounterFields";
import styles from "./modals.module.css";

export type CreateEncounterResult =
  | { name: string; mode: "clone" }
  | { name: string; mode: "fresh"; grid: GridChoice; imageDataUrl: string | null };

interface CreateEncounterModalProps {
  onClose: () => void;
  onSubmit: (result: CreateEncounterResult) => void | Promise<void>;
  defaultName?: string;
  /** Scene-dropdown "New scene" also offers cloning the currently-open map; the campaign create flow does not. */
  allowClone?: boolean;
  cloneLabel?: string;
}

/**
 * Name + (optionally) clone-vs-fresh toggle + grid/background picker for
 * creating a new encounter. Shared by the campaign "New Encounter" flow
 * (always fresh) and the scene-dropdown "New scene" flow (clone by default,
 * matching its prior behavior, with an explicit opt-out to start blank).
 */
export function CreateEncounterModal({ onClose, onSubmit, defaultName = "", allowClone = false, cloneLabel = "Clone current map" }: CreateEncounterModalProps) {
  const [name, setName] = useState(defaultName);
  const [mode, setMode] = useState<"clone" | "fresh">(allowClone ? "clone" : "fresh");
  const [grid, setGrid] = useState<GridChoice>(DEFAULT_NEW_GRID);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      if (mode === "clone") {
        await onSubmit({ name, mode: "clone" });
      } else {
        await onSubmit({ name, mode: "fresh", grid, imageDataUrl });
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New Encounter"
      footer={
        <>
          <button type="button" className={styles.secondary} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.primary} disabled={submitting || !name.trim()} onClick={() => void handleSubmit()}>
            {submitting ? "Creating…" : "Create"}
          </button>
        </>
      }
    >
      {allowClone ? (
        <div className={styles.grid2} style={{ marginBottom: 8 }}>
          <button type="button" className={mode === "clone" ? styles.primary : styles.secondary} onClick={() => setMode("clone")}>
            {cloneLabel}
          </button>
          <button type="button" className={mode === "fresh" ? styles.primary : styles.secondary} onClick={() => setMode("fresh")}>
            Start fresh
          </button>
        </div>
      ) : null}

      {mode === "clone" ? (
        <label className={styles.field}>
          Encounter name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
      ) : (
        <CreateEncounterFields
          name={name}
          onNameChange={setName}
          grid={grid}
          onGridChange={setGrid}
          imageDataUrl={imageDataUrl}
          onImageChange={setImageDataUrl}
        />
      )}
    </Modal>
  );
}
