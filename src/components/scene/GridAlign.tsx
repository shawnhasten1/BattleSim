"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { DEFAULT_MAP_IMAGE_SETTINGS, type BattleMapState } from "@/engine";
import { getLocalPoint } from "@/components/scene/coords";
import { formatPx } from "@/components/modals/GridFitPicker";
import { squaresInBounds, squaresToCover } from "@/lib/gridInference";
import { defaultBoxCounts, findDrawnGrid, MIN_ALIGN_PX, normalizeOrigin, nudgePin, pinFromBox, resizePin, type SourcePoint } from "@/lib/gridAlign";
import { readImageLuma } from "@/lib/imageResize";
import { hasPlacedContent, useEncounterStore, type GridAlignDraft } from "@/store/encounter-store";
import styles from "./GridAlign.module.css";

/** Screen px of travel before a press is a drag (a box) rather than a click (a corner). */
const DRAG_THRESHOLD_PX = 4;

/** The map as it looks with the draft pin, for drawing while aligning. */
export function alignedMap(map: BattleMapState, draft: GridAlignDraft): BattleMapState {
  const { pxPerSquare, originX, originY, sourceWidthPx, sourceHeightPx } = draft;
  return { ...map, image: { ...DEFAULT_MAP_IMAGE_SETTINGS, ...map.image, pxPerSquare, originX, originY, sourceWidthPx, sourceHeightPx } };
}

/** Scene px to the image's own px, under the draft pin. */
function toSource(draft: GridAlignDraft, cellSize: number, x: number, y: number): SourcePoint {
  const scale = draft.pxPerSquare / cellSize;
  return { x: draft.originX + x * scale, y: draft.originY + y * scale };
}

/** The image's own px to scene px, under the draft pin. */
function toScene(draft: GridAlignDraft, cellSize: number, point: SourcePoint): SourcePoint {
  const scale = cellSize / draft.pxPerSquare;
  return { x: (point.x - draft.originX) * scale, y: (point.y - draft.originY) * scale };
}

interface GridAlignLayerProps {
  draft: GridAlignDraft;
  cellSize: number;
  gridPixelWidth: number;
  gridPixelHeight: number;
  /** The view is being panned (Space held, or a middle-button drag): presses aren't boxes. */
  panning: boolean;
}

/**
 * Align grid's layer over the scene: a bright copy of the grid to match the
 * image's own grid against, and the box the DM draws over that grid, corner to
 * corner (or by clicking two corners). The box is kept in the image's pixels,
 * so it moves with the image as the pin changes, and lands on the grid once
 * the two line up.
 */
export function GridAlignLayer({ draft, cellSize, gridPixelWidth, gridPixelHeight, panning }: GridAlignLayerProps) {
  const updateGridAlign = useEncounterStore((state) => state.updateGridAlign);
  const pressRef = useRef<{ clientX: number; clientY: number; point: SourcePoint; pointerId: number } | null>(null);
  const [dragBox, setDragBox] = useState<{ a: SourcePoint; b: SourcePoint } | null>(null);
  const [firstCorner, setFirstCorner] = useState<SourcePoint | null>(null);

  function pointOf(event: PointerEvent<HTMLDivElement>): SourcePoint {
    const local = getLocalPoint(event.currentTarget, event.clientX, event.clientY);
    return toSource(draft, cellSize, local.x, local.y);
  }

  function setBox(a: SourcePoint, b: SourcePoint) {
    const counts = defaultBoxCounts(a, b);
    const pin = pinFromBox(a, b, counts.across, counts.down);
    if (pin) updateGridAlign({ ...pin, box: { a, b, ...counts } });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    // Middle-drag and Space+drag pan the view: let them through to the stage.
    if (event.button !== 0 || panning) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pressRef.current = { clientX: event.clientX, clientY: event.clientY, point: pointOf(event), pointerId: event.pointerId };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const press = pressRef.current;
    if (!press) return;
    event.stopPropagation();
    if (!dragBox && Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) < DRAG_THRESHOLD_PX) return;
    setDragBox({ a: press.point, b: pointOf(event) });
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const press = pressRef.current;
    if (!press) return;
    event.stopPropagation();
    pressRef.current = null;
    if (event.currentTarget.hasPointerCapture(press.pointerId)) event.currentTarget.releasePointerCapture(press.pointerId);
    if (dragBox) {
      setDragBox(null);
      setFirstCorner(null);
      setBox(press.point, pointOf(event));
      return;
    }
    // A click: the first corner, or the second one, which completes the box.
    if (firstCorner) {
      setFirstCorner(null);
      setBox(firstCorner, press.point);
    } else {
      setFirstCorner(press.point);
    }
  }

  function onPointerCancel() {
    pressRef.current = null;
    setDragBox(null);
  }

  const shown = dragBox ?? draft.box ?? null;
  const from = shown ? toScene(draft, cellSize, shown.a) : null;
  const to = shown ? toScene(draft, cellSize, shown.b) : null;
  const corner = firstCorner ? toScene(draft, cellSize, firstCorner) : null;

  return (
    <div
      className={styles.layer}
      data-testid="grid-align-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      // The scene's own tools never see these: aligning edits nothing else.
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setFirstCorner(null);
      }}
    >
      <div className={styles.lines} style={{ width: gridPixelWidth, height: gridPixelHeight, backgroundSize: `${cellSize}px ${cellSize}px` }} />
      <svg className={styles.marks} aria-hidden="true">
        {from && to ? (
          <rect
            className={styles.box}
            x={Math.min(from.x, to.x)}
            y={Math.min(from.y, to.y)}
            width={Math.abs(to.x - from.x)}
            height={Math.abs(to.y - from.y)}
          />
        ) : null}
        {corner ? <circle className={styles.corner} cx={corner.x} cy={corner.y} r={4} /> : null}
      </svg>
    </div>
  );
}

function Stepper({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (value: number) => void }) {
  return (
    <span className={styles.stepper}>
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <output aria-label={label}>{value}</output>
      <button type="button" aria-label={`More ${label}`} onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}

/**
 * Align grid's controls: what to do, how many squares the box spans, px per
 * square and moving the image, fitting the grid to it, and Apply / Cancel.
 * Keys: arrows move the image (Shift: 10 px), + and − change px per square,
 * Enter applies, Escape cancels.
 */
export function GridAlignPanel({ draft }: { draft: GridAlignDraft }) {
  const grid = useEncounterStore((state) => state.encounter.map.grid);
  const updateGridAlign = useEncounterStore((state) => state.updateGridAlign);
  const applyGridAlign = useEncounterStore((state) => state.applyGridAlign);
  const cancelGridAlign = useEncounterStore((state) => state.cancelGridAlign);
  // Fit by default only when there's nothing on the map that a new grid could strand.
  const [fitGrid, setFitGrid] = useState(() => !hasPlacedContent(useEncounterStore.getState().encounter));
  // What's typed in the px box while it has focus; otherwise it shows the draft's own value, as it changes.
  const [pxTyped, setPxTyped] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const covered = {
    columns: squaresToCover(draft.sourceWidthPx - draft.originX, draft.pxPerSquare),
    rows: squaresToCover(draft.sourceHeightPx - draft.originY, draft.pxPerSquare)
  };
  const canFit = squaresInBounds(covered);
  const fit = fitGrid && canFit;
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLInputElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && target.type !== "checkbox") return;
      const state = useEncounterStore.getState();
      const current = state.gridAlign;
      if (!current) return;
      const step = event.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const move = moves[event.key];
      if (move) state.updateGridAlign(nudgePin(current, move[0], move[1]));
      else if (event.key === "+" || event.key === "=") state.updateGridAlign(resizePin(current, 0.1));
      else if (event.key === "-" || event.key === "_") state.updateGridAlign(resizePin(current, -0.1));
      else if (event.key === "Enter") state.applyGridAlign(fitRef.current);
      else if (event.key === "Escape") state.cancelGridAlign();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /** Read the grid off the background's own lines, if it has any. */
  async function findGrid() {
    const src = useEncounterStore.getState().mapImageDataUrl;
    if (!src) return;
    setFinding(true);
    setNote(null);
    const pixels = await readImageLuma(src);
    const found = pixels ? findDrawnGrid(pixels.luma, pixels.width, pixels.height) : null;
    setFinding(false);
    const current = useEncounterStore.getState().gridAlign;
    if (!pixels || !found || !current) {
      setNote("Couldn't find a grid drawn on this image. Box a square of it instead.");
      return;
    }
    // The stored copy may be downscaled: measure in the image's own pixels.
    const scaleX = current.sourceWidthPx / pixels.width;
    const scaleY = current.sourceHeightPx / pixels.height;
    const pxPerSquare = found.pxPerSquare * scaleX;
    updateGridAlign({
      pxPerSquare,
      originX: normalizeOrigin(found.originX * scaleX, pxPerSquare),
      originY: normalizeOrigin(found.originY * scaleY, pxPerSquare),
      box: undefined
    });
    setNote(`Found lines every ${formatPx(pxPerSquare)} px. Check them against the bright grid, and nudge if needed.`);
  }

  function setCounts(across: number, down: number) {
    const box = draft.box;
    if (!box) return;
    const pin = pinFromBox(box.a, box.b, across, down);
    if (pin) updateGridAlign({ ...pin, box: { ...box, across, down } });
  }

  function onPxText(text: string) {
    setPxTyped(text);
    const pxPerSquare = Number(text);
    if (text && Number.isFinite(pxPerSquare) && pxPerSquare >= MIN_ALIGN_PX) updateGridAlign({ pxPerSquare });
  }

  const move = (dx: number, dy: number) => updateGridAlign(nudgePin(draft, dx, dy));
  const box = draft.box;

  return (
    <aside className={styles.panel} aria-label="Align grid">
      <header className={styles.header}>
        <strong>Align grid</strong>
        <span>{Math.round(draft.sourceWidthPx)} × {Math.round(draft.sourceHeightPx)} px image</span>
      </header>
      <div className={styles.row}>
        <button type="button" className={styles.find} disabled={finding} onClick={() => void findGrid()}>
          {finding ? "Looking…" : "Find the drawn grid"}
        </button>
        {note ? <span className={styles.hint} role="status">{note}</span> : null}
      </div>
      <p className={styles.hint}>
        Or drag a box over one square of the map&apos;s own grid, corner to corner, or click two corners. A box over
        several squares is more accurate: say how many below.
      </p>
      {box ? (
        <div className={styles.row}>
          <span>The box spans</span>
          <Stepper label="squares across" value={box.across} min={box.down > 0 ? 0 : 1} onChange={(across) => setCounts(across, box.down)} />
          <span>across ×</span>
          <Stepper label="squares down" value={box.down} min={box.across > 0 ? 0 : 1} onChange={(down) => setCounts(box.across, down)} />
          <span>down</span>
        </div>
      ) : null}
      <div className={styles.row}>
        <label className={styles.field}>
          Image px per square
          <input
            type="number"
            min={MIN_ALIGN_PX}
            step={0.1}
            value={pxTyped ?? formatPx(draft.pxPerSquare)}
            onFocus={() => setPxTyped(formatPx(draft.pxPerSquare))}
            onBlur={() => setPxTyped(null)}
            onChange={(event) => onPxText(event.target.value)}
          />
        </label>
        <div className={styles.nudges} role="group" aria-label="Move the image">
          <button type="button" aria-label="Move the image left" onClick={() => move(-1, 0)}>←</button>
          <button type="button" aria-label="Move the image right" onClick={() => move(1, 0)}>→</button>
          <button type="button" aria-label="Move the image up" onClick={() => move(0, -1)}>↑</button>
          <button type="button" aria-label="Move the image down" onClick={() => move(0, 1)}>↓</button>
        </div>
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={fit} disabled={!canFit} onChange={(event) => setFitGrid(event.target.checked)} />
        {canFit
          ? `Fit columns and rows to the image: ${covered.columns} × ${covered.rows} squares${covered.columns === grid.width && covered.rows === grid.height ? "" : ` (now ${grid.width} × ${grid.height})`}`
          : `Fitting would make ${covered.columns} × ${covered.rows} squares; a map can be 4–120 a side.`}
      </label>
      <p className={styles.hint}>Arrow keys move the image (Shift: 10 px), + and − change px per square, Enter applies, Esc cancels.</p>
      <div className={styles.actions}>
        <button type="button" onClick={cancelGridAlign}>Cancel</button>
        <button type="button" className={styles.apply} onClick={() => applyGridAlign(fit)}>Apply</button>
      </div>
    </aside>
  );
}
