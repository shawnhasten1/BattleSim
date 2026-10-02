import { describe, expect, it } from "vitest";
import { defaultBoxCounts, findDrawnGrid, normalizeOrigin, nudgePin, pinFromBox, resizePin } from "@/lib/gridAlign";

describe("pinFromBox: a box over the image's own grid", () => {
  it("reads one square, corner to corner", () => {
    expect(pinFromBox({ x: 37, y: 12 }, { x: 137, y: 112 }, 1, 1)).toEqual({ pxPerSquare: 100, originX: 37, originY: 12 });
  });

  it("doesn't mind which way the box was dragged", () => {
    expect(pinFromBox({ x: 137, y: 112 }, { x: 37, y: 12 }, 1, 1)).toEqual({ pxPerSquare: 100, originX: 37, originY: 12 });
  });

  it("reads a box over several squares, the longer side counting for more", () => {
    expect(pinFromBox({ x: 37, y: 12 }, { x: 337, y: 212 }, 3, 2)).toEqual({ pxPerSquare: 100, originX: 37, originY: 12 });
    // Off by 3 px across 3 squares and 2 px down 1: (303 + 98) / 4.
    expect(pinFromBox({ x: 0, y: 0 }, { x: 303, y: 98 }, 3, 1)!.pxPerSquare).toBeCloseTo(100.25, 9);
  });

  it("reads two corners on one grid line", () => {
    expect(pinFromBox({ x: 37, y: 12 }, { x: 537, y: 12 }, 5, 0)).toEqual({ pxPerSquare: 100, originX: 37, originY: 12 });
    expect(pinFromBox({ x: 37, y: 12 }, { x: 37, y: 412 }, 0, 4)).toEqual({ pxPerSquare: 100, originX: 37, originY: 12 });
  });

  it("takes the grid line nearest the image's corner as the origin", () => {
    // A box three squares in from the corner still puts the origin at 37, 12.
    expect(pinFromBox({ x: 337, y: 312 }, { x: 437, y: 412 }, 1, 1)).toMatchObject({ originX: 37, originY: 12 });
  });

  it("refuses a box that spans no squares, or one too small to be a square", () => {
    expect(pinFromBox({ x: 0, y: 0 }, { x: 100, y: 100 }, 0, 0)).toBeNull();
    expect(pinFromBox({ x: 0, y: 0 }, { x: 2, y: 2 }, 1, 1)).toBeNull();
  });
});

describe("normalizeOrigin", () => {
  it("keeps a border's width", () => {
    expect(normalizeOrigin(37, 100)).toBe(37);
    expect(normalizeOrigin(237, 100)).toBe(37);
    expect(normalizeOrigin(60, 100)).toBe(60);
  });

  it("reads a line a hair short of a square as the image's edge, so the first column isn't lost", () => {
    expect(normalizeOrigin(99.5, 100)).toBeCloseTo(-0.5, 9);
    expect(normalizeOrigin(199, 100)).toBeCloseTo(-1, 9);
  });

  it("wraps negative values", () => {
    expect(normalizeOrigin(-63, 100)).toBe(37);
  });
});

describe("defaultBoxCounts", () => {
  it("is one square, or none along a side too thin to be one", () => {
    expect(defaultBoxCounts({ x: 0, y: 0 }, { x: 100, y: 96 })).toEqual({ across: 1, down: 1 });
    expect(defaultBoxCounts({ x: 0, y: 0 }, { x: 500, y: 3 })).toEqual({ across: 1, down: 0 });
    expect(defaultBoxCounts({ x: 0, y: 0 }, { x: 2, y: 400 })).toEqual({ across: 0, down: 1 });
  });
});

describe("nudging", () => {
  const pin = { pxPerSquare: 100, originX: 37, originY: 12 };

  it("moves the image right and down by lowering the origin", () => {
    expect(nudgePin(pin, 1, 0)).toEqual({ pxPerSquare: 100, originX: 36, originY: 12 });
    expect(nudgePin(pin, 0, -10)).toEqual({ pxPerSquare: 100, originX: 37, originY: 22 });
  });

  it("resizes in tenths, never below 4 px", () => {
    expect(resizePin(pin, 0.1).pxPerSquare).toBe(100.1);
    expect(resizePin({ ...pin, pxPerSquare: 4.05 }, -0.1).pxPerSquare).toBe(4);
  });
});

/** A deterministic pseudo-random sequence in [0, 1). */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A parchment image with dark grid lines every `period` px from `phase`, plus some noise. */
function gridImage(width: number, height: number, period: number, phase: { x: number; y: number }, options: { lineWidth?: number; noise?: number; rows?: boolean } = {}) {
  const { lineWidth = 2, noise = 12, rows = true } = options;
  const random = rng(7);
  const onLine = (at: number, start: number) => {
    const offset = (((at + 0.5 - start) % period) + period) % period;
    return offset < lineWidth || period - offset < 0.0001;
  };
  const luma = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const line = onLine(x, phase.x) || (rows && onLine(y, phase.y));
      luma[y * width + x] = (line ? 50 : 205) + (random() - 0.5) * 2 * noise;
    }
  }
  return luma;
}

describe("findDrawnGrid: a grid drawn on the image", () => {
  // The grid line goes through the middle of the drawn line: a 2 px line from x = 17 is centred on 18.

  it("finds a fractional spacing and its corner (a plain 2K export of a 40 × 30 map)", () => {
    const found = findDrawnGrid(gridImage(1024, 768, 51.2, { x: 17, y: 9 }), 1024, 768);
    expect(found).not.toBeNull();
    // Within 0.05 px: under a pixel of drift across all 20 squares.
    expect(found!.pxPerSquare).toBeCloseTo(51.2, 1);
    expect(Math.abs(found!.originX - 18)).toBeLessThan(0.5);
    expect(Math.abs(found!.originY - 10)).toBeLessThan(0.5);
  });

  it("finds thick lines starting at the image's edge", () => {
    const found = findDrawnGrid(gridImage(1200, 800, 100, { x: 0, y: 0 }, { lineWidth: 5, noise: 25 }), 1200, 800);
    expect(found).not.toBeNull();
    expect(found!.pxPerSquare).toBeCloseTo(100, 1);
    expect(Math.abs(found!.originX - 2.5)).toBeLessThan(0.5);
    expect(Math.abs(found!.originY - 2.5)).toBeLessThan(0.5);
  });

  it("uses one side's spacing for both when only that side has lines", () => {
    const found = findDrawnGrid(gridImage(900, 600, 70, { x: 30, y: 0 }, { rows: false }), 900, 600);
    expect(found).not.toBeNull();
    expect(found!.pxPerSquare).toBeCloseTo(70, 1);
    expect(Math.abs(found!.originX - 31)).toBeLessThan(0.5);
    expect(found!.originY).toBe(0);
  });

  it("finds nothing in art without a grid", () => {
    const width = 800;
    const height = 600;
    const random = rng(11);
    const luma = new Float32Array(width * height);
    const blobs = Array.from({ length: 25 }, () => ({ x: random() * width, y: random() * height, r: 10 + random() * 60, v: random() * 255 }));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = 90 + (x / width) * 80 + (random() - 0.5) * 30;
        for (const blob of blobs) if ((x - blob.x) ** 2 + (y - blob.y) ** 2 < blob.r ** 2) value = blob.v;
        luma[y * width + x] = value;
      }
    }
    expect(findDrawnGrid(luma, width, height)).toBeNull();
  });

  it("finds nothing in an image too small to show four squares", () => {
    expect(findDrawnGrid(gridImage(30, 30, 10, { x: 0, y: 0 }), 4, 4)).toBeNull();
  });
});
