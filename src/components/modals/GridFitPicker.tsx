"use client";

import { useState } from "react";
import {
  gridForColumns,
  gridForPxPerSquare,
  MAX_SQUARES,
  MIN_SQUARES,
  readUsualPxPerSquare,
  rememberUsualPxPerSquare,
  squaresInBounds,
  type GridFit,
  type GridFitReason,
  type GridGuess
} from "@/lib/gridInference";
import type { ImagePixelSize } from "@/lib/imageResize";
import type { ImageReplacement } from "@/store/encounter-store";
import styles from "./modals.module.css";

/** How a reading was chosen: one of those offered, or typed in. */
export type FitPick = "option" | "typed-px" | "typed-columns";

/** "100", "51.2", "68.27". */
export function formatPx(pxPerSquare: number): string {
  return String(Math.round(pxPerSquare * 100) / 100);
}

export function describeFitReason(reason: GridFitReason, usualRemembered: boolean): string {
  switch (reason) {
    case "current":
      return "keeps this map's grid";
    case "filename":
      return "from the file name";
    case "usual":
      return usualRemembered ? "the size you used last" : "the usual VTT size";
    case "common":
      return "a common VTT size";
  }
}

export const sameSquares = (a: GridFit, b: GridFit) => a.columns === b.columns && a.rows === b.rows;

/** What an upload did to the grid, for a status line. Null when there's nothing to say. */
export function replacementMessage(outcome: ImageReplacement | { kind: "cancelled" }): string | null {
  switch (outcome.kind) {
    case "keep-grid":
      return `Kept the grid: ${outcome.fit.columns} × ${outcome.fit.rows} squares, ${formatPx(outcome.fit.pxPerSquare)} px per square in the image.`;
    case "new-grid":
      return `Grid set from the image: ${outcome.fit.columns} × ${outcome.fit.rows} squares, ${formatPx(outcome.fit.pxPerSquare)} px per square.`;
    case "ask":
      return "This image's size doesn't match a VTT export, so it isn't pinned to the grid yet. Say how many squares across it is under Image.";
    case "unmeasured":
      return "Couldn't read this image's size, so it's placed as before.";
    case "cancelled":
      return null;
  }
}

interface GridFitPickerProps {
  imageSize: ImagePixelSize;
  /** The reading in use, or null before one is chosen. */
  value: GridFit | null;
  /** Said after `value`: where it came from. */
  valueNote?: string;
  /** Other readings, one click each. */
  options: GridGuess[];
  /** Said in place of a reading when none is chosen. */
  prompt: string;
  distancePerSquare: number;
  /** Shown in Squares across before anything's typed: the map's current columns. */
  columnsHint?: number;
  onPick: (fit: GridFit, how: FitPick) => void;
}

/**
 * The grid read off a background image: the reading in use, the others one
 * click away, and Other… to type squares across or px per square (each fills
 * in the other). A size the DM picks or types as px is remembered for the next
 * upload (D4); one worked out from squares across isn't, since that's a
 * one-off for an image that isn't a VTT export.
 */
export function GridFitPicker({ imageSize, value, valueNote, options, prompt, distancePerSquare, columnsHint, onPick }: GridFitPickerProps) {
  const [typing, setTyping] = useState(false);
  const [columnsText, setColumnsText] = useState("");
  const [pxText, setPxText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [usualRemembered] = useState(() => readUsualPxPerSquare().remembered);
  const showTyped = typing || (!value && options.length === 0);

  function pick(fit: GridFit, how: FitPick) {
    if (how !== "typed-columns") rememberUsualPxPerSquare(fit.pxPerSquare);
    onPick(fit, how);
  }

  function typed(fit: GridFit | null, how: FitPick) {
    if (!fit) {
      setProblem(null);
      return;
    }
    if (!squaresInBounds(fit)) {
      setProblem(`That's ${fit.columns} × ${fit.rows} squares; a map can be ${MIN_SQUARES}–${MAX_SQUARES} squares a side.`);
      return;
    }
    setProblem(null);
    pick(fit, how);
  }

  function onColumns(text: string) {
    // Typing keeps the boxes open, even once a typed reading is in use.
    setTyping(true);
    setColumnsText(text);
    const columns = Number(text);
    if (!text || !Number.isInteger(columns) || columns <= 0) {
      typed(null, "typed-columns");
      return;
    }
    const fit = gridForColumns(imageSize, columns);
    setPxText(formatPx(fit.pxPerSquare));
    typed(fit, "typed-columns");
  }

  function onPx(text: string) {
    setTyping(true);
    setPxText(text);
    const pxPerSquare = Number(text);
    if (!text || !Number.isFinite(pxPerSquare) || pxPerSquare <= 0) {
      typed(null, "typed-px");
      return;
    }
    const fit = gridForPxPerSquare(imageSize, pxPerSquare);
    setColumnsText(String(fit.columns));
    typed(fit, "typed-px");
  }

  function toggleTyped() {
    if (!typing && value) {
      setColumnsText(String(value.columns));
      setPxText(formatPx(value.pxPerSquare));
    }
    setTyping(!typing);
  }

  return (
    <div className={styles.fit} role="group" aria-label="Grid from the image">
      <p className={styles.fitLine}>
        {value ? (
          <>
            <strong>{value.columns} × {value.rows} squares</strong> · {value.columns * distancePerSquare} × {value.rows * distancePerSquare} ft
            {" · "}{formatPx(value.pxPerSquare)} px per square
            {valueNote ? <span className={styles.fitNote}> — {valueNote}</span> : null}
          </>
        ) : prompt}
      </p>
      {value || options.length > 0 ? (
        <div className={styles.chips}>
          {options.map((option) => (
            <button
              key={`${option.columns}x${option.rows}`}
              type="button"
              className={styles.chip}
              title={describeFitReason(option.reason, usualRemembered)}
              onClick={() => pick(option, "option")}
            >
              {option.columns} × {option.rows} · {formatPx(option.pxPerSquare)} px
            </button>
          ))}
          <button type="button" className={styles.chip} aria-expanded={showTyped} onClick={toggleTyped}>
            Other…
          </button>
        </div>
      ) : null}
      {showTyped ? (
        <div className={styles.grid2}>
          <label className={styles.field}>
            Squares across
            <input
              type="number"
              min={MIN_SQUARES}
              max={MAX_SQUARES}
              value={columnsText}
              placeholder={columnsHint ? String(columnsHint) : undefined}
              onChange={(event) => onColumns(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            Image px per square
            <input type="number" min={1} step="any" value={pxText} onChange={(event) => onPx(event.target.value)} />
          </label>
          {problem ? <p className={`${styles.status} ${styles.wide}`} role="alert">{problem}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
