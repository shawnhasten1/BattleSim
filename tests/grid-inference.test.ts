import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAP_IMAGE_SETTINGS, type BattleMapState, type MapImageSettings } from "@/engine";
import { deriveSceneMetrics } from "@/components/scene/metrics";
import {
  detectGrid,
  gridForColumns,
  gridForPxPerSquare,
  imageFitSize,
  pinInPlace,
  readUsualPxPerSquare,
  rememberUsualPxPerSquare,
  squaresToCover,
  type GridDetection
} from "@/lib/gridInference";

/** "30 × 20 @ 100" for each reading, best first. */
function readings(detection: GridDetection): string[] {
  return [detection.best, ...detection.alternatives]
    .filter((guess) => guess !== null)
    .map((guess) => `${guess.columns}x${guess.rows}@${Math.round(guess.pxPerSquare * 100) / 100}`);
}

const detect = (widthPx: number, heightPx: number, extra: Partial<Parameters<typeof detectGrid>[0]> = {}) =>
  detectGrid({ widthPx, heightPx, usualPxPerSquare: 100, ...extra });

describe("detectGrid: the plan's export sizes (MAP_IMPORT_PLAN.md §5)", () => {
  it.each([
    ["30 × 20 @ 100 px", 3000, 2000, ["30x20@100", "15x10@200", "60x40@50"]],
    ["30 × 25 @ 70 px (Roll20)", 2100, 1750, ["30x25@70", "42x35@50"]],
    ["40 × 40 @ 100 px", 4000, 4000, ["40x40@100", "20x20@200", "80x80@50"]],
    ["60 × 40 @ 100 px", 6000, 4000, ["60x40@100", "30x20@200", "120x80@50"]],
    ["33 × 17 @ 100 px", 3300, 1700, ["33x17@100", "66x34@50"]]
  ])("reads %s right first time", (_label, width, height, expected) => {
    expect(readings(detect(width, height))).toEqual(expected);
  });

  it("puts the real reading first among the alternatives when 100 also divides the image", () => {
    // 30 × 20 at 140 px and 24 × 18 at 200 px: 100 tiles both, so it wins until 140/200 is remembered.
    expect(readings(detect(4200, 2800))).toEqual(["42x28@100", "30x20@140", "60x40@70", "21x14@200"]);
    expect(readings(detect(4800, 3600))).toEqual(["48x36@100", "24x18@200", "96x72@50", "32x24@150"]);
  });

  it("asks rather than guessing for a plain 2K or 4K export", () => {
    expect(detect(2048, 1536).best).toBeNull();
    expect(detect(3840, 2160).best).toBeNull();
    expect(detect(2048, 1536).alternatives).toEqual([]);
  });

  it("tries the remembered size first, and still tries 100 after another is remembered", () => {
    expect(detect(4200, 2800, { usualPxPerSquare: 140 }).best).toMatchObject({ columns: 30, rows: 20, pxPerSquare: 140, reason: "usual" });
    // A 100 px export after 70 was remembered: 70 doesn't tile it, and 100 is still a common size.
    expect(detect(3000, 2000, { usualPxPerSquare: 70 }).best).toMatchObject({ columns: 30, rows: 20, pxPerSquare: 100, reason: "common" });
  });

  it("forgives a pixel of rounding on an edge", () => {
    expect(detect(3001, 1999).best).toMatchObject({ columns: 30, rows: 20, pxPerSquare: 100 });
    expect(detect(3002, 2000).best?.pxPerSquare).not.toBe(100);
  });

  it("keeps to 4–120 squares a side", () => {
    // 100 px reads 400 × 300 as 4 × 3: too few rows, so 50 px (8 × 6) is the reading.
    expect(detect(400, 300).best).toMatchObject({ columns: 8, rows: 6, pxPerSquare: 50 });
    // 12,100 px at 100 is 121 squares: too many, so 50 px is out too and 140, 70… don't tile it.
    expect(readings(detect(12100, 2000))).not.toContain("121x20@100");
  });
});

describe("detectGrid: the file name", () => {
  it.each([
    "Crypt [24x18].png",
    "crypt_24x18.jpg",
    "crypt 24 x 18.webp",
    "Crypt 24×18.png",
    "crypt-200px.png",
    "crypt 200 ppi.jpg",
    "crypt_200ppg.png",
    "crypt-200dpi.png"
  ])("reads %s", (fileName) => {
    expect(detect(4800, 3600, { fileName }).best).toMatchObject({ columns: 24, rows: 18, pxPerSquare: 200, reason: "filename" });
  });

  it("ignores counts that don't make square cells, and pixel sizes", () => {
    expect(detect(3000, 2000, { fileName: "crypt 30x30.png" }).best?.reason).toBe("usual");
    expect(detect(3000, 2000, { fileName: "crypt 3000x2000.png" }).best?.reason).toBe("usual");
  });
});

describe("detectGrid: the map's current grid (rule 1)", () => {
  it("keeps the current grid when the image fits it with square cells", () => {
    expect(detect(6000, 4000, { current: { columns: 30, rows: 20 } }).best).toMatchObject({ columns: 30, rows: 20, pxPerSquare: 200, reason: "current" });
  });

  it("only when passed: a blank map's preset doesn't win", () => {
    expect(detect(6000, 4000).best).toMatchObject({ columns: 60, rows: 40, reason: "usual" });
  });

  it("falls through when the image doesn't fit the current grid", () => {
    expect(detect(3000, 2000, { current: { columns: 40, rows: 30 } }).best).toMatchObject({ columns: 30, rows: 20, reason: "usual" });
  });
});

describe("typed values", () => {
  it("rounds to a whole square within 2% of one, else rounds up to cover the image", () => {
    expect(squaresToCover(2999, 100)).toBe(30);
    expect(squaresToCover(3001, 100)).toBe(30);
    expect(squaresToCover(3050, 100)).toBe(31);
    expect(squaresToCover(3010, 100)).toBe(31);
  });

  it("works out the other number from squares across or px per square", () => {
    expect(gridForColumns({ widthPx: 2048, heightPx: 1536 }, 40)).toEqual({ columns: 40, rows: 30, pxPerSquare: 51.2 });
    expect(gridForPxPerSquare({ widthPx: 2048, heightPx: 1536 }, 51.2)).toEqual({ columns: 40, rows: 30, pxPerSquare: 51.2 });
    expect(gridForPxPerSquare({ widthPx: 3000, heightPx: 2000 }, 140)).toEqual({ columns: 22, rows: 15, pxPerSquare: 140 });
  });
});

describe("imageFitSize", () => {
  it("measures against the file's own size when recorded, else the stored image's", () => {
    expect(imageFitSize({ ...DEFAULT_MAP_IMAGE_SETTINGS, naturalWidthPx: 2048, naturalHeightPx: 1365, sourceWidthPx: 3000, sourceHeightPx: 2000 })).toEqual({ widthPx: 3000, heightPx: 2000 });
    expect(imageFitSize({ ...DEFAULT_MAP_IMAGE_SETTINGS, naturalWidthPx: 2048, naturalHeightPx: 1365 })).toEqual({ widthPx: 2048, heightPx: 1365 });
    expect(imageFitSize({ ...DEFAULT_MAP_IMAGE_SETTINGS })).toBeNull();
  });
});

describe("pinInPlace: Pin image to grid keeps the image where it's drawn", () => {
  function mapWith(image: MapImageSettings, canvas: { widthPx: number; heightPx: number }, squareSizePx = 44): BattleMapState {
    return {
      id: "m",
      name: "m",
      grid: { width: 40, height: 30, distancePerSquare: 5, diagonalMode: "standard", squareSizePx },
      image,
      canvas,
      walls: [],
      terrain: []
    };
  }

  /** Where the unpinned image's picture is drawn: the canvas box, cover-fitted, moved, then scaled from its corner. */
  function drawnUnpinned(image: MapImageSettings, canvas: { widthPx: number; heightPx: number }) {
    const stored = { w: image.naturalWidthPx ?? canvas.widthPx, h: image.naturalHeightPx ?? canvas.heightPx };
    const cover = Math.max(canvas.widthPx / stored.w, canvas.heightPx / stored.h);
    const scale = image.scale / 100;
    return {
      left: image.offsetX + ((canvas.widthPx - stored.w * cover) / 2) * scale,
      top: image.offsetY + ((canvas.heightPx - stored.h * cover) / 2) * scale,
      width: stored.w * cover * scale,
      height: stored.h * cover * scale
    };
  }

  it.each([
    ["the default placement", { offsetX: 0, offsetY: 0, scale: 100 }, { widthPx: 2048, heightPx: 1365 }],
    ["an offset and a scale", { offsetX: 22, offsetY: -15, scale: 125 }, { widthPx: 2048, heightPx: 1365 }],
    ["a canvas of another shape (cover crops it)", { offsetX: 0, offsetY: 0, scale: 100 }, { widthPx: 1760, heightPx: 1320 }]
  ])("with %s", (_label, placement, canvas) => {
    const image: MapImageSettings = { ...DEFAULT_MAP_IMAGE_SETTINGS, ...placement, naturalWidthPx: 2048, naturalHeightPx: 1365, sourceWidthPx: 3000, sourceHeightPx: 2000 };
    const before = drawnUnpinned(image, canvas);
    const pin = pinInPlace(image, canvas, 44);
    expect(pin).not.toBeNull();
    const after = deriveSceneMetrics(mapWith({ ...image, ...pin! }, canvas)).imageBox;
    expect(after.pinned).toBe(true);
    expect(after.left).toBeCloseTo(before.left, 6);
    expect(after.top).toBeCloseTo(before.top, 6);
    expect(after.width).toBeCloseTo(before.width, 6);
    // Height follows the source's proportions, which the downscale rounds to the pixel.
    expect(after.height).toBeCloseTo(before.height, 0);
  });

  it("measures an old upload against its stored size", () => {
    const pin = pinInPlace({ ...DEFAULT_MAP_IMAGE_SETTINGS, naturalWidthPx: 2048, naturalHeightPx: 1365 }, { widthPx: 2048, heightPx: 1365 }, 44);
    expect(pin).toMatchObject({ sourceWidthPx: 2048, sourceHeightPx: 1365, originX: 0, originY: 0 });
    expect(pin!.pxPerSquare).toBeCloseTo(44, 9);
  });
});

describe("the usual px per square", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is 100 until one is remembered, then the one remembered", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => void stored.set(key, value)
      }
    });
    expect(readUsualPxPerSquare()).toEqual({ pxPerSquare: 100, remembered: false });
    rememberUsualPxPerSquare(140);
    expect(readUsualPxPerSquare()).toEqual({ pxPerSquare: 140, remembered: true });
    rememberUsualPxPerSquare(0);
    expect(readUsualPxPerSquare().pxPerSquare).toBe(140);
  });
});
