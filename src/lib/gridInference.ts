import type { MapImageSettings } from "@/engine";
import type { ImagePixelSize } from "@/lib/imageResize";
import { readJson, writeJson } from "@/lib/persist";

/**
 * Reading a battlemap's grid off the image itself (MAP_IMPORT_PLAN.md §3.3).
 * A VTT export is exactly columns × its px per square: Inkarnate's "VTT (Grid)"
 * export at 100 px per square makes a 30 × 20 map 3000 × 2000. So the image's
 * own pixel size, and sometimes its file name, is enough to find the grid.
 * Detection is pure; only the remembered usual size touches storage.
 */

/** Foundry's default, and what Inkarnate's VTT exports are set to (D1). */
export const DEFAULT_PX_PER_SQUARE = 100;
/** Squares a side a map can have (Scene Config's limits). */
export const MIN_SQUARES = 4;
export const MAX_SQUARES = 120;
/**
 * Px per square that VTT exports commonly use, most common first; the usual
 * size is tried before these. 256, 128 and 64 are left out on purpose:
 * power-of-two images (2048 × 1536, a plain 2K export) divide by them and
 * would read as nonsense like 8 × 6 squares.
 */
export const COMMON_PX_PER_SQUARE: readonly number[] = [100, 140, 70, 200, 50, 150, 300];

export interface GridFit {
  columns: number;
  rows: number;
  /** Pixels per square in the image's own (source) size. */
  pxPerSquare: number;
}

/** Where a reading came from: the map's grid, the file name, the usual size, or a common one. */
export type GridFitReason = "current" | "filename" | "usual" | "common";

export interface GridGuess extends GridFit {
  reason: GridFitReason;
}

export interface GridDetection {
  /** The reading to apply, or null when nothing fits and the DM has to say. */
  best: GridGuess | null;
  /** Every other exact fit, up to three, to offer one click away. */
  alternatives: GridGuess[];
}

export interface DetectGridInput {
  widthPx: number;
  heightPx: number;
  fileName?: string;
  /** Tried before the common sizes: 100 until the DM confirms another. */
  usualPxPerSquare?: number;
  /** The map's grid. Pass it only when replacing a background, or once anything is placed (rule 1). */
  current?: { columns: number; rows: number };
}

export function squaresInBounds(fit: Pick<GridFit, "columns" | "rows">): boolean {
  return fit.columns >= MIN_SQUARES && fit.rows >= MIN_SQUARES && fit.columns <= MAX_SQUARES && fit.rows <= MAX_SQUARES;
}

/** The fit when `px` tiles the image exactly (±1 px an edge, for rounding). */
function exactFit(widthPx: number, heightPx: number, px: number): GridFit | null {
  const columns = Math.round(widthPx / px);
  const rows = Math.round(heightPx / px);
  if (Math.abs(columns * px - widthPx) > 1 || Math.abs(rows * px - heightPx) > 1) return null;
  const fit = { columns, rows, pxPerSquare: px };
  return squaresInBounds(fit) ? fit : null;
}

/** The fit for a known columns × rows, when that makes square cells (within 1%). */
function fitForCounts(widthPx: number, heightPx: number, columns: number, rows: number): GridFit | null {
  if (!squaresInBounds({ columns, rows })) return null;
  const across = widthPx / columns;
  const down = heightPx / rows;
  return Math.abs(across - down) / across <= 0.01 ? { columns, rows, pxPerSquare: across } : null;
}

/** "Crypt [30x20].png", "crypt_30x20.jpg", "30 x 20", "30×20". Never "3000x2000". */
const COUNTS_IN_NAME = /(?<!\d)(\d{1,3})\s*[x×]\s*(\d{1,3})(?!\d)/gi;
/** "100px", "140 ppi", "70ppg", "200dpi". */
const PX_IN_NAME = /(?<!\d)(\d{2,3})\s*(?:px|ppi|ppg|dpi)(?![a-z])/gi;

function fitFromFileName(widthPx: number, heightPx: number, fileName: string): GridFit | null {
  for (const match of fileName.matchAll(COUNTS_IN_NAME)) {
    const fit = fitForCounts(widthPx, heightPx, Number(match[1]), Number(match[2]));
    if (fit) return fit;
  }
  for (const match of fileName.matchAll(PX_IN_NAME)) {
    const fit = exactFit(widthPx, heightPx, Number(match[1]));
    if (fit) return fit;
  }
  return null;
}

/**
 * Read a grid off an image's own size. In order, first match wins `best`:
 * the map's current grid (rule 1), the file name, the usual px per square,
 * then the common sizes. Each reading appears once (by columns × rows).
 */
export function detectGrid(input: DetectGridInput): GridDetection {
  const { widthPx, heightPx } = input;
  const usual = input.usualPxPerSquare ?? DEFAULT_PX_PER_SQUARE;
  const guesses: GridGuess[] = [];
  const add = (fit: GridFit | null, reason: GridFitReason) => {
    if (fit && !guesses.some((guess) => guess.columns === fit.columns && guess.rows === fit.rows)) guesses.push({ ...fit, reason });
  };
  if (widthPx > 0 && heightPx > 0) {
    if (input.current) add(fitForCounts(widthPx, heightPx, input.current.columns, input.current.rows), "current");
    if (input.fileName) add(fitFromFileName(widthPx, heightPx, input.fileName), "filename");
    add(exactFit(widthPx, heightPx, usual), "usual");
    for (const px of COMMON_PX_PER_SQUARE) if (px !== usual) add(exactFit(widthPx, heightPx, px), "common");
  }
  const [best = null, ...alternatives] = guesses;
  return { best, alternatives: alternatives.slice(0, 3) };
}

/**
 * Squares needed to cover `lengthPx` at `pxPerSquare`: the nearest whole number
 * when within 2% of one (rounding in the export), otherwise rounded up so the
 * grid covers the whole image.
 */
export function squaresToCover(lengthPx: number, pxPerSquare: number): number {
  const exact = lengthPx / pxPerSquare;
  const nearest = Math.round(exact);
  return Math.abs(exact - nearest) <= 0.02 ? nearest : Math.ceil(exact);
}

/** The grid an image covers at a typed px per square. */
export function gridForPxPerSquare(size: ImagePixelSize, pxPerSquare: number): GridFit {
  return { columns: squaresToCover(size.widthPx, pxPerSquare), rows: squaresToCover(size.heightPx, pxPerSquare), pxPerSquare };
}

/** The grid an image covers at a typed number of squares across. */
export function gridForColumns(size: ImagePixelSize, columns: number): GridFit {
  const pxPerSquare = size.widthPx / columns;
  return { columns, rows: squaresToCover(size.heightPx, pxPerSquare), pxPerSquare };
}

/** The size a fit is measured against: the file's own when recorded, else the stored image's. */
export function imageFitSize(image: MapImageSettings | undefined): ImagePixelSize | null {
  const widthPx = image?.sourceWidthPx ?? image?.naturalWidthPx;
  const heightPx = image?.sourceHeightPx ?? image?.naturalHeightPx;
  return widthPx && heightPx ? { widthPx, heightPx } : null;
}

/**
 * The pin that keeps an unpinned image exactly where it's drawn now (Pin image
 * to grid, D5). Unpinned, the image fills `canvas` with `object-fit: cover`
 * (centred, the longer side cropped), then moves by the offset and scales from
 * its top-left. Null when there's nothing to measure.
 */
export function pinInPlace(
  image: MapImageSettings,
  canvas: { widthPx: number; heightPx: number },
  cellSize: number
): Required<Pick<MapImageSettings, "sourceWidthPx" | "sourceHeightPx" | "pxPerSquare" | "originX" | "originY">> | null {
  const storedWidth = image.naturalWidthPx ?? canvas.widthPx;
  const storedHeight = image.naturalHeightPx ?? canvas.heightPx;
  const size = imageFitSize(image) ?? { widthPx: storedWidth, heightPx: storedHeight };
  if (!(storedWidth > 0 && storedHeight > 0 && canvas.widthPx > 0 && canvas.heightPx > 0 && cellSize > 0)) return null;
  const scale = image.scale / 100;
  const cover = Math.max(canvas.widthPx / storedWidth, canvas.heightPx / storedHeight);
  const left = image.offsetX + ((canvas.widthPx - storedWidth * cover) / 2) * scale;
  const top = image.offsetY + ((canvas.heightPx - storedHeight * cover) / 2) * scale;
  // Screen px per source px, from the width the whole picture is drawn at.
  const zoom = (storedWidth * cover * scale) / size.widthPx;
  return {
    sourceWidthPx: size.widthPx,
    sourceHeightPx: size.heightPx,
    pxPerSquare: cellSize / zoom,
    originX: left ? -left / zoom : 0,
    originY: top ? -top / zoom : 0
  };
}

const USUAL_KEY = "map-import:px-per-square";

/** The px per square tried first: the last one confirmed in this browser (D4), else 100. */
export function readUsualPxPerSquare(): { pxPerSquare: number; remembered: boolean } {
  const stored = readJson<unknown>(USUAL_KEY, null);
  return typeof stored === "number" && Number.isFinite(stored) && stored > 0
    ? { pxPerSquare: stored, remembered: true }
    : { pxPerSquare: DEFAULT_PX_PER_SQUARE, remembered: false };
}

/** Remember a px per square the DM chose (a chip, or typed), for the next upload. */
export function rememberUsualPxPerSquare(pxPerSquare: number): void {
  if (Number.isFinite(pxPerSquare) && pxPerSquare > 0) writeJson(USUAL_KEY, pxPerSquare);
}
