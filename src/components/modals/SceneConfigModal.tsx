"use client";

import { ImagePlus } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { useEncounterStore } from "@/store/encounter-store";
import { deriveSceneMetrics } from "@/components/scene/metrics";
import { detectGrid, gridForPxPerSquare, imageFitSize, readUsualPxPerSquare, squaresInBounds, type GridFit, type GridGuess } from "@/lib/gridInference";
import { readMapImageFile, type ImagePixelSize } from "@/lib/imageResize";
import { Modal } from "@/components/ui/Modal";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { formatPx, GridFitPicker, replacementMessage, sameSquares } from "./GridFitPicker";
import styles from "./modals.module.css";

/** Every reading of an image's grid by its size alone, best first. */
function readingsOf(size: ImagePixelSize): GridGuess[] {
  const { best, alternatives } = detectGrid({ widthPx: size.widthPx, heightPx: size.heightPx, usualPxPerSquare: readUsualPxPerSquare().pxPerSquare });
  return best ? [best, ...alternatives] : [];
}

export function SceneConfigModal({ onClose }: { onClose: () => void }) {
  const encounter = useEncounterStore((s) => s.encounter);
  const mapImageDataUrl = useEncounterStore((s) => s.mapImageDataUrl);
  const replaceMapImage = useEncounterStore((s) => s.replaceMapImage);
  const applyImageFit = useEncounterStore((s) => s.applyImageFit);
  const fitGridToImage = useEncounterStore((s) => s.fitGridToImage);
  const pinMapImageInPlace = useEncounterStore((s) => s.pinMapImageInPlace);
  const updateEncounterMetadata = useEncounterStore((s) => s.updateEncounterMetadata);
  const updateGrid = useEncounterStore((s) => s.updateGrid);
  const updateMapCanvas = useEncounterStore((s) => s.updateMapCanvas);
  const updateMapPadding = useEncounterStore((s) => s.updateMapPadding);
  const updateMapPaddingPercent = useEncounterStore((s) => s.updateMapPaddingPercent);
  const updateMapImageSettings = useEncounterStore((s) => s.updateMapImageSettings);
  const startGridAlign = useEncounterStore((s) => s.startGridAlign);
  const [imageStatus, setImageStatus] = useState<string | null>(null);

  /** Align grid happens on the map itself, so the modal gets out of the way. */
  function alignGrid() {
    startGridAlign();
    onClose();
  }

  const grid = encounter.map.grid;
  const { cellSize, gridLineWidth, gridLineColor, gridLineOpacity, canvasSettings, imageSettings, imageBox } = deriveSceneMetrics(encounter.map);
  const paddingPercent = encounter.map.paddingPercent;
  const paddingChoice = paddingPercent ? "percent" : String(encounter.map.paddingSquares ?? 0);
  const fitSize = imageFitSize(imageSettings);

  function onImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void readMapImageFile(file).then((picked) => {
      if (picked) setImageStatus(replacementMessage(replaceMapImage(picked)));
    });
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
        {imageStatus ? <p className={styles.status} role="status">{imageStatus}</p> : null}

        <h4>Grid</h4>
        <div className={styles.grid3}>
          <label className={styles.field}>Columns<input type="number" value={grid.width} min={4} max={120} onChange={(e) => updateGrid({ width: Number(e.target.value) })} /></label>
          <label className={styles.field}>Rows<input type="number" value={grid.height} min={4} max={120} onChange={(e) => updateGrid({ height: Number(e.target.value) })} /></label>
          <label className={styles.field}>Feet / sq<input type="number" value={grid.distancePerSquare} min={1} max={20} onChange={(e) => updateGrid({ distancePerSquare: Number(e.target.value) })} /></label>
          <label className={styles.field}>Square size on screen<input type="number" value={cellSize} min={20} max={200} onChange={(e) => updateGrid({ squareSizePx: Number(e.target.value) })} /></label>
          <label className={styles.field}>
            Padding
            <select
              value={paddingChoice}
              onChange={(e) => (e.target.value === "percent" ? updateMapPaddingPercent(25) : updateMapPadding(Number(e.target.value)))}
            >
              <option value="0">None</option>
              <option value="1">1 square</option>
              <option value="2">2 squares</option>
              <option value="3">3 squares</option>
              {["0", "1", "2", "3", "percent"].includes(paddingChoice) ? null : <option value={paddingChoice}>{paddingChoice} squares</option>}
              <option value="percent">{paddingPercent ?? 25}%, like Foundry</option>
            </select>
          </label>
          <label className={styles.field}>Line px<input type="number" value={gridLineWidth} min={0.5} max={4} step={0.5} onChange={(e) => updateGrid({ lineWidthPx: Number(e.target.value) })} /></label>
          <label className={styles.field}>Color<input type="color" value={gridLineColor} onChange={(e) => updateGrid({ lineColor: e.target.value })} /></label>
          <label className={`${styles.field} ${styles.wide}`}>
            Grid opacity {Math.round(gridLineOpacity * 100)}%
            <input type="range" value={gridLineOpacity} min={0} max={1} step={0.01} onChange={(e) => updateGrid({ lineOpacity: Number(e.target.value) })} />
          </label>
        </div>

        {mapImageDataUrl && imageBox.pinned && fitSize && imageSettings.pxPerSquare ? (
          <PinnedImageFields
            size={fitSize}
            pxPerSquare={imageSettings.pxPerSquare}
            origin={{ x: imageSettings.originX ?? 0, y: imageSettings.originY ?? 0 }}
            grid={{ columns: grid.width, rows: grid.height, distancePerSquare: grid.distancePerSquare }}
            opacity={imageSettings.opacity}
            onPick={applyImageFit}
            onFitGrid={fitGridToImage}
            onAlign={alignGrid}
            onOrigin={(origin) => updateMapImageSettings(origin)}
            onOpacity={(opacity) => updateMapImageSettings({ opacity })}
          />
        ) : mapImageDataUrl ? (
          <>
            <h4>Image{fitSize ? ` · ${fitSize.widthPx} × ${fitSize.heightPx} px` : ""}</h4>
            <p className={styles.status}>
              Not pinned to the grid: it&apos;s placed in screen pixels, so changing the square size moves it off the grid.
            </p>
            {fitSize ? (
              <UnpinnedFitPicker size={fitSize} columns={grid.width} distancePerSquare={grid.distancePerSquare} onPick={applyImageFit} />
            ) : null}
            <p className={styles.status}>A map with its own grid drawn on, or a border? Line that grid up on the map.</p>
            <button type="button" className={styles.secondary} onClick={alignGrid}>
              Align grid…
            </button>
            <p className={styles.status}>Lined it up by hand? This keeps it exactly where it is.</p>
            <button type="button" className={styles.secondary} onClick={pinMapImageInPlace}>
              Pin image to grid, where it is now
            </button>
            <div className={styles.grid3}>
              <label className={styles.field}>Opacity<input type="number" value={imageSettings.opacity} min={0} max={1} step={0.05} onChange={(e) => updateMapImageSettings({ opacity: Number(e.target.value) })} /></label>
            </div>
          </>
        ) : (
          <>
            <h4>Canvas</h4>
            <div className={styles.grid3}>
              <label className={styles.field}>Scene W<input type="number" value={Math.round(canvasSettings.widthPx)} min={120} max={8000} onChange={(e) => updateMapCanvas({ widthPx: Number(e.target.value) })} /></label>
              <label className={styles.field}>Scene H<input type="number" value={Math.round(canvasSettings.heightPx)} min={120} max={8000} onChange={(e) => updateMapCanvas({ heightPx: Number(e.target.value) })} /></label>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

interface PinnedImageFieldsProps {
  size: ImagePixelSize;
  pxPerSquare: number;
  origin: { x: number; y: number };
  grid: { columns: number; rows: number; distancePerSquare: number };
  opacity: number;
  onPick: (fit: GridFit) => void;
  onFitGrid: () => void;
  onAlign: () => void;
  onOrigin: (origin: { originX: number } | { originY: number }) => void;
  onOpacity: (opacity: number) => void;
}

/**
 * A pinned background: the grid it was read as, the other readings a click
 * away, Fit grid to image when the grid no longer covers it square for square,
 * the grid's offset over it to type, and Align grid to fine-tune it on the
 * map. Its place is set by its px per square and offset, so there's no X/Y/scale.
 */
function PinnedImageFields({ size, pxPerSquare, origin, grid, opacity, onPick, onFitGrid, onAlign, onOrigin, onOpacity }: PinnedImageFieldsProps) {
  // The image's own squares at its px per square, whatever the offset; and the squares the grid
  // needs from its corner to cover all of it, which the offset can change by a partial square.
  const reading = gridForPxPerSquare(size, pxPerSquare);
  const covered = gridForPxPerSquare({ widthPx: size.widthPx - origin.x, heightPx: size.heightPx - origin.y }, pxPerSquare);
  const options = readingsOf(size).filter((option) => !sameSquares(option, reading));
  const gridMatches = reading.columns === grid.columns && reading.rows === grid.rows;
  return (
    <>
      <h4>Image · {size.widthPx} × {size.heightPx} px, pinned to the grid</h4>
      <GridFitPicker
        imageSize={size}
        value={reading}
        options={options}
        prompt=""
        distancePerSquare={grid.distancePerSquare}
        onPick={onPick}
      />
      {!gridMatches && squaresInBounds(covered) ? (
        <button type="button" className={styles.secondary} onClick={onFitGrid}>
          Fit grid to cover the image: {covered.columns} × {covered.rows} squares (now {grid.columns} × {grid.rows})
        </button>
      ) : null}
      <div className={styles.grid3}>
        <label className={styles.field}>
          Grid offset X
          <DecimalInput value={origin.x} format={formatPx} onCommit={(originX) => onOrigin({ originX })} />
        </label>
        <label className={styles.field}>
          Grid offset Y
          <DecimalInput value={origin.y} format={formatPx} onCommit={(originY) => onOrigin({ originY })} />
        </label>
        <label className={styles.field}>Opacity<input type="number" value={opacity} min={0} max={1} step={0.05} onChange={(e) => onOpacity(Number(e.target.value))} /></label>
      </div>
      <p className={styles.status}>
        Grid offset is in the image&apos;s own pixels ({formatPx(pxPerSquare)} to a square): more moves the grid right or down over the
        map. Arrow keys in a box step it (Shift: 10).
      </p>
      <button type="button" className={styles.secondary} onClick={onAlign}>
        Align grid…
      </button>
    </>
  );
}

/** An unpinned background's readings, to pin it by size instead of where it's drawn. */
function UnpinnedFitPicker({ size, columns, distancePerSquare, onPick }: { size: ImagePixelSize; columns: number; distancePerSquare: number; onPick: (fit: GridFit) => void }) {
  const readings = readingsOf(size);
  return (
    <GridFitPicker
      imageSize={size}
      value={null}
      options={readings}
      prompt={
        readings.length
          ? "Set the grid from the image's size:"
          : `This image's size doesn't match a VTT export. How many squares across is it? (This map has ${columns}.)`
      }
      distancePerSquare={distancePerSquare}
      columnsHint={columns}
      onPick={onPick}
    />
  );
}
