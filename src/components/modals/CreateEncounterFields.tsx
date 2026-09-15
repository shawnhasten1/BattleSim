"use client";

import { ImagePlus } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import styles from "./modals.module.css";

export interface GridChoice {
  width: number;
  height: number;
  distancePerSquare: number;
  squareSizePx: number;
}

export const DEFAULT_NEW_GRID: GridChoice = { width: 40, height: 30, distancePerSquare: 5, squareSizePx: 44 };

const GRID_PRESETS: Array<{ key: string; label: string; width: number; height: number }> = [
  { key: "landscape", label: "Landscape 40×30", width: 40, height: 30 },
  { key: "portrait", label: "Portrait 30×40", width: 30, height: 40 },
  { key: "square", label: "Square 40×40", width: 40, height: 40 }
];

interface CreateEncounterFieldsProps {
  name: string;
  onNameChange: (name: string) => void;
  grid: GridChoice;
  onGridChange: (grid: GridChoice) => void;
  imageDataUrl: string | null;
  onImageChange: (dataUrl: string | null) => void;
}

/**
 * Name + grid preset/custom picker + optional background upload, shared by
 * every "make a new map" entry point (campaign create, scene-dropdown fresh
 * start). A picked preset only sets width/height; feet-per-square and
 * px-per-square stay at their defaults unless Custom is opened.
 */
export function CreateEncounterFields({ name, onNameChange, grid, onGridChange, imageDataUrl, onImageChange }: CreateEncounterFieldsProps) {
  const [presetKey, setPresetKey] = useState<string>("landscape");
  const [custom, setCustom] = useState(false);

  function pickPreset(preset: (typeof GRID_PRESETS)[number]) {
    setPresetKey(preset.key);
    setCustom(false);
    onGridChange({ ...grid, width: preset.width, height: preset.height });
  }

  function onImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onImageChange(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        Encounter name
        <input value={name} onChange={(e) => onNameChange(e.target.value)} autoFocus />
      </label>

      <h4>Grid size</h4>
      <div className={styles.grid3}>
        {GRID_PRESETS.map((preset) => (
          <button
            type="button"
            key={preset.key}
            className={!custom && presetKey === preset.key ? styles.primary : styles.secondary}
            onClick={() => pickPreset(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <button type="button" className={custom ? styles.primary : styles.secondary} onClick={() => setCustom(true)}>
        Custom…
      </button>

      {custom ? (
        <div className={styles.grid3}>
          <label className={styles.field}>
            Columns
            <input type="number" value={grid.width} min={4} max={120} onChange={(e) => onGridChange({ ...grid, width: Number(e.target.value) })} />
          </label>
          <label className={styles.field}>
            Rows
            <input type="number" value={grid.height} min={4} max={120} onChange={(e) => onGridChange({ ...grid, height: Number(e.target.value) })} />
          </label>
          <label className={styles.field}>
            Grid px
            <input type="number" value={grid.squareSizePx} min={20} max={200} onChange={(e) => onGridChange({ ...grid, squareSizePx: Number(e.target.value) })} />
          </label>
          <label className={styles.field}>
            Feet / sq
            <input type="number" value={grid.distancePerSquare} min={1} max={20} onChange={(e) => onGridChange({ ...grid, distancePerSquare: Number(e.target.value) })} />
          </label>
        </div>
      ) : null}

      <h4>Background (optional)</h4>
      <label className={styles.upload}>
        <ImagePlus size={14} /> {imageDataUrl ? "Replace background image" : "Upload background image"}
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onImageUpload} />
      </label>
      {imageDataUrl ? (
        <button type="button" className={styles.secondary} onClick={() => onImageChange(null)}>
          Remove image — start with a blank grid
        </button>
      ) : (
        <p className={styles.status}>No image selected — the canvas will be sized to the grid above.</p>
      )}
    </div>
  );
}
