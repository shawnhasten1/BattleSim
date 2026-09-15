"use client";

import { ImagePlus } from "lucide-react";
import { type ChangeEvent } from "react";
import { DEFAULT_MAP_IMAGE_SETTINGS } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { deriveSceneMetrics } from "@/components/scene/metrics";
import { Modal } from "@/components/ui/Modal";
import styles from "./modals.module.css";

export function SceneConfigModal({ onClose }: { onClose: () => void }) {
  const encounter = useEncounterStore((s) => s.encounter);
  const mapImageDataUrl = useEncounterStore((s) => s.mapImageDataUrl);
  const setMapImage = useEncounterStore((s) => s.setMapImage);
  const updateEncounterMetadata = useEncounterStore((s) => s.updateEncounterMetadata);
  const updateGrid = useEncounterStore((s) => s.updateGrid);
  const updateMapCanvas = useEncounterStore((s) => s.updateMapCanvas);
  const updateMapPadding = useEncounterStore((s) => s.updateMapPadding);
  const updateMapImageSettings = useEncounterStore((s) => s.updateMapImageSettings);

  const grid = encounter.map.grid;
  const { cellSize, gridLineWidth, gridLineColor, gridLineOpacity, canvasSettings, imageSettings, paddingPx } = deriveSceneMetrics(encounter.map);
  const paddingSquares = cellSize > 0 ? paddingPx / cellSize : 0;

  function onImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setMapImage(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  return (
    <Modal open onClose={onClose} title="Scene Configuration">
      <div className={styles.form}>
        <div className={styles.grid2}>
          <label className={styles.field}>
            Encounter name
            <input value={encounter.name} onChange={(e) => updateEncounterMetadata({ name: e.target.value })} />
          </label>
          <label className={styles.field}>
            Map name
            <input value={encounter.map.name} onChange={(e) => updateEncounterMetadata({ mapName: e.target.value })} />
          </label>
        </div>

        <label className={styles.upload}>
          <ImagePlus size={14} /> {mapImageDataUrl ? "Replace background image" : "Upload background image"}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onImageUpload} />
        </label>

        <h4>Grid</h4>
        <div className={styles.grid3}>
          <label className={styles.field}>Columns<input type="number" value={grid.width} min={4} max={120} onChange={(e) => updateGrid({ width: Number(e.target.value) })} /></label>
          <label className={styles.field}>Rows<input type="number" value={grid.height} min={4} max={120} onChange={(e) => updateGrid({ height: Number(e.target.value) })} /></label>
          <label className={styles.field}>Grid px<input type="number" value={cellSize} min={20} max={200} onChange={(e) => updateGrid({ squareSizePx: Number(e.target.value) })} /></label>
          <label className={styles.field}>Feet / sq<input type="number" value={grid.distancePerSquare} min={1} max={20} onChange={(e) => updateGrid({ distancePerSquare: Number(e.target.value) })} /></label>
          <label className={styles.field}>Line px<input type="number" value={gridLineWidth} min={0.5} max={4} step={0.5} onChange={(e) => updateGrid({ lineWidthPx: Number(e.target.value) })} /></label>
          <label className={styles.field}>Color<input type="color" value={gridLineColor} onChange={(e) => updateGrid({ lineColor: e.target.value })} /></label>
          <label className={`${styles.field} ${styles.wide}`}>
            Grid opacity {Math.round(gridLineOpacity * 100)}%
            <input type="range" value={gridLineOpacity} min={0} max={1} step={0.01} onChange={(e) => updateGrid({ lineOpacity: Number(e.target.value) })} />
          </label>
        </div>

        <h4>Canvas & image</h4>
        <div className={styles.grid3}>
          <label className={styles.field}>Scene W<input type="number" value={Math.round(canvasSettings.widthPx)} min={120} max={8000} onChange={(e) => updateMapCanvas({ widthPx: Number(e.target.value) })} /></label>
          <label className={styles.field}>Scene H<input type="number" value={Math.round(canvasSettings.heightPx)} min={120} max={8000} onChange={(e) => updateMapCanvas({ heightPx: Number(e.target.value) })} /></label>
          <label className={styles.field}>
            Padding (sq)
            <input type="number" value={paddingSquares} min={0} max={10} step={0.5} onChange={(e) => updateMapPadding(Number(e.target.value))} />
          </label>
          <label className={styles.field}>Image X<input type="number" value={imageSettings.offsetX} min={-1000} max={1000} onChange={(e) => updateMapImageSettings({ offsetX: Number(e.target.value) })} /></label>
          <label className={styles.field}>Image Y<input type="number" value={imageSettings.offsetY} min={-1000} max={1000} onChange={(e) => updateMapImageSettings({ offsetY: Number(e.target.value) })} /></label>
          <label className={styles.field}>Opacity<input type="number" value={imageSettings.opacity} min={0} max={1} step={0.05} onChange={(e) => updateMapImageSettings({ opacity: Number(e.target.value) })} /></label>
          <label className={`${styles.field} ${styles.wide}`}>
            Image scale {Math.round(imageSettings.scale)}%
            <input type="range" value={imageSettings.scale} min={25} max={400} step={1} onChange={(e) => updateMapImageSettings({ scale: Number(e.target.value) })} />
          </label>
        </div>
        <button type="button" className={styles.secondary} onClick={() => updateMapImageSettings(DEFAULT_MAP_IMAGE_SETTINGS)}>
          Reset image transform
        </button>
      </div>
    </Modal>
  );
}
