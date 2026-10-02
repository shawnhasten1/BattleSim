"use client";

import { ImagePlus } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { DEFAULT_MAP_IMAGE_SETTINGS } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { deriveSceneMetrics } from "@/components/scene/metrics";
import { detectGrid, gridForPxPerSquare, imageFitSize, readUsualPxPerSquare, squaresInBounds, type GridFit, type GridGuess } from "@/lib/gridInference";
import { readMapImageFile, type ImagePixelSize } from "@/lib/imageResize";
import { Modal } from "@/components/ui/Modal";
import { GridFitPicker, replacementMessage, sameSquares } from "./GridFitPicker";
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
  const updateMapImageSettings = useEncounterStore((s) => s.updateMapImageSettings);
  const [imageStatus, setImageStatus] = useState<string | null>(null);

  const grid = encounter.map.grid;
  const { cellSize, gridLineWidth, gridLineColor, gridLineOpacity, canvasSettings, imageSettings, paddingPx, imageBox } = deriveSceneMetrics(encounter.map);
  const paddingSquares = cellSize > 0 ? paddingPx / cellSize : 0;
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
            Padding (sq)
            <input type="number" value={paddingSquares} min={0} max={10} step={0.5} onChange={(e) => updateMapPadding(Number(e.target.value))} />
          </label>
          <label className={styles.field}>Line px<input type="number" value={gridLineWidth} min={0.5} max={4} step={0.5} onChange={(e) => updateGrid({ lineWidthPx: Number(e.target.value) })} /></label>
          <label className={styles.field}>Color<input type="color" value={gridLineColor} onChange={(e) => updateGrid({ lineColor: e.target.value })} /></label>
          <label className={`${styles.field} ${styles.wide}`}>
            Grid opacity {Math.round(gridLineOpacity * 100)}%
            <input type="range" value={gridLineOpacity} min={0} max={1} step={0.01} onChange={(e) => updateGrid({ lineOpacity: Number(e.target.value) })} />
          </label>
        </div>

        {imageBox.pinned && fitSize && imageSettings.pxPerSquare ? (
          <PinnedImageFields
            size={fitSize}
            pxPerSquare={imageSettings.pxPerSquare}
            origin={{ x: imageSettings.originX ?? 0, y: imageSettings.originY ?? 0 }}
            grid={{ columns: grid.width, rows: grid.height, distancePerSquare: grid.distancePerSquare }}
            opacity={imageSettings.opacity}
            onPick={applyImageFit}
            onFitGrid={fitGridToImage}
            onOpacity={(opacity) => updateMapImageSettings({ opacity })}
          />
        ) : (
          <>
            {mapImageDataUrl ? (
              <>
                <h4>Image{fitSize ? ` · ${fitSize.widthPx} × ${fitSize.heightPx} px` : ""}</h4>
                <p className={styles.status}>
                  Not pinned to the grid: it&apos;s placed in screen pixels, so changing the square size moves it off the grid.
                </p>
                {fitSize ? (
                  <UnpinnedFitPicker size={fitSize} columns={grid.width} distancePerSquare={grid.distancePerSquare} onPick={applyImageFit} />
                ) : null}
                <p className={styles.status}>Lined it up by hand? This keeps it exactly where it is.</p>
                <button type="button" className={styles.secondary} onClick={pinMapImageInPlace}>
                  Pin image to grid, where it is now
                </button>
              </>
            ) : null}

            <h4>Canvas & image</h4>
            <div className={styles.grid3}>
              <label className={styles.field}>Scene W<input type="number" value={Math.round(canvasSettings.widthPx)} min={120} max={8000} onChange={(e) => updateMapCanvas({ widthPx: Number(e.target.value) })} /></label>
              <label className={styles.field}>Scene H<input type="number" value={Math.round(canvasSettings.heightPx)} min={120} max={8000} onChange={(e) => updateMapCanvas({ heightPx: Number(e.target.value) })} /></label>
              <label className={styles.field}>Opacity<input type="number" value={imageSettings.opacity} min={0} max={1} step={0.05} onChange={(e) => updateMapImageSettings({ opacity: Number(e.target.value) })} /></label>
              <label className={styles.field}>Image X<input type="number" value={imageSettings.offsetX} min={-1000} max={1000} onChange={(e) => updateMapImageSettings({ offsetX: Number(e.target.value) })} /></label>
              <label className={styles.field}>Image Y<input type="number" value={imageSettings.offsetY} min={-1000} max={1000} onChange={(e) => updateMapImageSettings({ offsetY: Number(e.target.value) })} /></label>
              <label className={`${styles.field} ${styles.wide}`}>
                Image scale {Math.round(imageSettings.scale)}%
                <input type="range" value={imageSettings.scale} min={25} max={400} step={1} onChange={(e) => updateMapImageSettings({ scale: Number(e.target.value) })} />
              </label>
            </div>
            <button type="button" className={styles.secondary} onClick={() => updateMapImageSettings(DEFAULT_MAP_IMAGE_SETTINGS)}>
              Reset image transform
            </button>
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
  onOpacity: (opacity: number) => void;
}

/**
 * A pinned background: the grid it was read as, the other readings a click
 * away, and, when the grid no longer covers it square for square, Fit grid to
 * image. Its place is set by its px per square, so there's no X/Y/scale.
 */
function PinnedImageFields({ size, pxPerSquare, origin, grid, opacity, onPick, onFitGrid, onOpacity }: PinnedImageFieldsProps) {
  // The squares the image covers from the grid's corner, at its px per square.
  const covered = gridForPxPerSquare({ widthPx: size.widthPx - origin.x, heightPx: size.heightPx - origin.y }, pxPerSquare);
  const options = readingsOf(size).filter((reading) => !sameSquares(reading, covered));
  const gridMatches = covered.columns === grid.columns && covered.rows === grid.rows;
  return (
    <>
      <h4>Image · {size.widthPx} × {size.heightPx} px, pinned to the grid</h4>
      <GridFitPicker
        imageSize={size}
        value={covered}
        options={options}
        prompt=""
        distancePerSquare={grid.distancePerSquare}
        onPick={onPick}
      />
      {!gridMatches && squaresInBounds(covered) ? (
        <button type="button" className={styles.secondary} onClick={onFitGrid}>
          Fit grid to image: {covered.columns} × {covered.rows} squares (now {grid.columns} × {grid.rows})
        </button>
      ) : null}
      <div className={styles.grid3}>
        <label className={styles.field}>Opacity<input type="number" value={opacity} min={0} max={1} step={0.05} onChange={(e) => onOpacity(Number(e.target.value))} /></label>
      </div>
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
