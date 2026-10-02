"use client";

import { ImagePlus } from "lucide-react";
import { useMemo, useState, type ChangeEvent } from "react";
import { detectGrid, readUsualPxPerSquare, type GridFit, type GridGuess } from "@/lib/gridInference";
import { readMapImageFile, type MapImageFile } from "@/lib/imageResize";
import { describeFitReason, GridFitPicker, sameSquares } from "./GridFitPicker";
import styles from "./modals.module.css";

export interface GridChoice {
  width: number;
  height: number;
  distancePerSquare: number;
  squareSizePx: number;
  /** Set when the grid was read off the background image: its px per square, which pins the image. */
  pxPerSquare?: number;
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
  image: MapImageFile | null;
  onImageChange: (image: MapImageFile | null) => void;
}

/** Every reading of an image's grid, best first. */
function readingsOf(image: MapImageFile | null): GridGuess[] {
  if (!image?.size) return [];
  const { best, alternatives } = detectGrid({
    widthPx: image.size.widthPx,
    heightPx: image.size.heightPx,
    fileName: image.fileName,
    usualPxPerSquare: readUsualPxPerSquare().pxPerSquare
  });
  return best ? [best, ...alternatives] : [];
}

/**
 * Name + optional background + grid, shared by every "make a new map" entry
 * point (campaign create, scene-dropdown fresh start). With an image whose
 * size is known, the grid is read off it (MAP_IMPORT_PLAN.md §3.5): the best
 * reading is applied and the others are a click away. Without one, a preset
 * sets width/height, and feet-per-square and the on-screen square size stay
 * at their defaults unless Custom is opened.
 */
export function CreateEncounterFields({ name, onNameChange, grid, onGridChange, image, onImageChange }: CreateEncounterFieldsProps) {
  const [presetKey, setPresetKey] = useState<string>("landscape");
  const [custom, setCustom] = useState(false);
  const readings = useMemo(() => readingsOf(image), [image]);
  const [usualRemembered] = useState(() => readUsualPxPerSquare().remembered);

  function presetSize() {
    const preset = GRID_PRESETS.find((candidate) => candidate.key === presetKey);
    return !custom && preset ? { width: preset.width, height: preset.height } : { width: grid.width, height: grid.height };
  }

  function pickPreset(preset: (typeof GRID_PRESETS)[number]) {
    setPresetKey(preset.key);
    setCustom(false);
    onGridChange({ ...grid, width: preset.width, height: preset.height });
  }

  function applyFit(fit: GridFit) {
    onGridChange({ ...grid, width: fit.columns, height: fit.rows, pxPerSquare: fit.pxPerSquare });
  }

  function onImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void readMapImageFile(file).then((picked) => {
      if (!picked) return;
      onImageChange(picked);
      const [best] = readingsOf(picked);
      if (best) applyFit(best);
      else onGridChange({ ...grid, ...presetSize(), pxPerSquare: undefined });
    });
  }

  function removeImage() {
    onImageChange(null);
    onGridChange({ ...grid, ...presetSize(), pxPerSquare: undefined });
  }

  const imageSize = image?.size ?? null;
  const value = grid.pxPerSquare ? { columns: grid.width, rows: grid.height, pxPerSquare: grid.pxPerSquare } : null;
  const matching = value ? readings.find((reading) => sameSquares(reading, value)) : undefined;

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        Encounter name
        <input value={name} onChange={(e) => onNameChange(e.target.value)} autoFocus />
      </label>

      <h4>Background (optional)</h4>
      <label className={styles.upload}>
        <ImagePlus size={14} /> {image ? "Replace background image" : "Upload background image"}
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onImageUpload} />
      </label>
      {image ? (
        <button type="button" className={styles.secondary} onClick={removeImage}>
          Remove image — start with a blank grid
        </button>
      ) : (
        <p className={styles.status}>No image selected — the canvas will be sized to the grid below.</p>
      )}

      {imageSize ? (
        <>
          <h4>Grid · from the {imageSize.widthPx} × {imageSize.heightPx} px image</h4>
          <GridFitPicker
            imageSize={imageSize}
            value={value}
            valueNote={matching ? describeFitReason(matching.reason, usualRemembered) : value ? "set by you" : undefined}
            options={value ? readings.filter((reading) => !sameSquares(reading, value)) : readings}
            prompt="This image's size doesn't match a VTT export. How many squares across is it? Leave it blank to line it up later in Scene Config."
            distancePerSquare={grid.distancePerSquare}
            onPick={applyFit}
          />
          <div className={styles.grid3}>
            <label className={styles.field}>
              Feet / sq
              <input type="number" value={grid.distancePerSquare} min={1} max={20} onChange={(e) => onGridChange({ ...grid, distancePerSquare: Number(e.target.value) })} />
            </label>
          </div>
        </>
      ) : (
        <>
          <h4>Grid size</h4>
          {image ? <p className={styles.status}>Couldn&apos;t read this image&apos;s size, so pick a grid for it.</p> : null}
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
                Square size on screen
                <input type="number" value={grid.squareSizePx} min={20} max={200} onChange={(e) => onGridChange({ ...grid, squareSizePx: Number(e.target.value) })} />
              </label>
              <label className={styles.field}>
                Feet / sq
                <input type="number" value={grid.distancePerSquare} min={1} max={20} onChange={(e) => onGridChange({ ...grid, distancePerSquare: Number(e.target.value) })} />
              </label>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
