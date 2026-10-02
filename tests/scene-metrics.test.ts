import { describe, expect, it } from "vitest";
import { DEFAULT_GRID_VISUALS, DEFAULT_MAP_IMAGE_SETTINGS, type BattleMapState, type MapImageSettings } from "../src/engine";
import { deriveSceneMetrics } from "../src/components/scene/metrics";

function map(overrides: Partial<BattleMapState["grid"]> = {}, rest: Partial<BattleMapState> = {}): BattleMapState {
  return {
    id: "m",
    name: "m",
    grid: { width: 20, height: 15, distancePerSquare: 5, diagonalMode: "standard", ...overrides },
    walls: [],
    terrain: [],
    ...rest
  };
}

describe("deriveSceneMetrics", () => {
  it("falls back to default cell size and computes grid pixels", () => {
    const m = deriveSceneMetrics(map());
    expect(m.cellSize).toBe(DEFAULT_GRID_VISUALS.squareSizePx);
    expect(m.gridPixelWidth).toBe(20 * DEFAULT_GRID_VISUALS.squareSizePx);
    expect(m.gridPixelHeight).toBe(15 * DEFAULT_GRID_VISUALS.squareSizePx);
  });

  it("honors an explicit square size", () => {
    const m = deriveSceneMetrics(map({ squareSizePx: 60 }));
    expect(m.cellSize).toBe(60);
    expect(m.gridPixelWidth).toBe(1200);
  });

  it("scene pixels are the max of the canvas box and the grid box", () => {
    const small = deriveSceneMetrics(map({ squareSizePx: 40 }, { canvas: { widthPx: 100, heightPx: 100 } }));
    expect(small.scenePixelWidth).toBe(800); // grid wins
    const big = deriveSceneMetrics(map({ squareSizePx: 40 }, { canvas: { widthPx: 5000, heightPx: 5000 } }));
    expect(big.scenePixelWidth).toBe(5000); // canvas wins
  });

  it("clamps grid opacity to 0..1 and line width to >= 0.5", () => {
    const m = deriveSceneMetrics(map({ lineOpacity: 4, lineWidthPx: 0.1 }));
    expect(m.gridLineOpacity).toBe(1);
    expect(m.gridLineWidth).toBe(0.5);
  });

  it("defaults padding to 0 for maps without paddingSquares set", () => {
    const m = deriveSceneMetrics(map());
    expect(m.paddingXPx).toBe(0);
    expect(m.paddingYPx).toBe(0);
    expect(m.framePixelWidth).toBe(m.scenePixelWidth);
    expect(m.framePixelHeight).toBe(m.scenePixelHeight);
  });

  it("expands the frame by paddingSquares * cellSize on every side", () => {
    const m = deriveSceneMetrics(map({ squareSizePx: 40 }, { paddingSquares: 1 }));
    expect(m.paddingXPx).toBe(40);
    expect(m.paddingYPx).toBe(40);
    expect(m.framePixelWidth).toBe(m.scenePixelWidth + 80);
    expect(m.framePixelHeight).toBe(m.scenePixelHeight + 80);
  });

  it("clamps a negative paddingSquares to 0", () => {
    const m = deriveSceneMetrics(map({}, { paddingSquares: -2 }));
    expect(m.paddingXPx).toBe(0);
  });

  it("pads like Foundry: a percent of each side, rounded up to whole squares", () => {
    // 30 × 20 squares at 25%: 7.5 → 8 squares left and right, 5 top and bottom.
    const m = deriveSceneMetrics(map({ width: 30, height: 20, squareSizePx: 44 }, { paddingPercent: 25, paddingSquares: 1 }));
    expect(m.paddingXPx).toBe(8 * 44);
    expect(m.paddingYPx).toBe(5 * 44);
    expect(m.framePixelWidth).toBe((30 + 16) * 44);
    expect(m.framePixelHeight).toBe((20 + 10) * 44);
  });
});

/** A 30 x 20 Inkarnate export at 100 px per square (3000 x 2000), stored downscaled to 2048 x 1365. */
function pinnedImage(overrides: Partial<MapImageSettings> = {}): MapImageSettings {
  return {
    ...DEFAULT_MAP_IMAGE_SETTINGS,
    naturalWidthPx: 2048,
    naturalHeightPx: 1365,
    sourceWidthPx: 3000,
    sourceHeightPx: 2000,
    pxPerSquare: 100,
    ...overrides
  };
}

describe("deriveSceneMetrics image box", () => {
  it("places an unpinned image by its canvas box, as before pinning existed", () => {
    const m = deriveSceneMetrics(map(
      { squareSizePx: 40 },
      { canvas: { widthPx: 2048, heightPx: 1365 }, image: { ...DEFAULT_MAP_IMAGE_SETTINGS, offsetX: 12, scale: 150 } }
    ));
    expect(m.imageBox).toEqual({ left: 0, top: 0, width: 2048, height: 1365, pinned: false });
    expect(m.scenePixelWidth).toBe(2048);
    expect(m.scenePixelHeight).toBe(1365);
  });

  it.each([44, 60, 68.27])("covers exactly the 30 x 20 squares a pinned image was exported at, with %s px squares", (square) => {
    const m = deriveSceneMetrics(map(
      { width: 30, height: 20, squareSizePx: square },
      { canvas: { widthPx: 2048, heightPx: 1365 }, image: pinnedImage() }
    ));
    expect(m.imageBox.pinned).toBe(true);
    expect(m.imageBox.left).toBeCloseTo(0, 9);
    expect(m.imageBox.top).toBeCloseTo(0, 9);
    expect(m.imageBox.width).toBeCloseTo(30 * square, 9);
    expect(m.imageBox.height).toBeCloseTo(20 * square, 9);
    expect(m.scenePixelWidth).toBeCloseTo(m.gridPixelWidth, 9);
    expect(m.scenePixelHeight).toBeCloseTo(m.gridPixelHeight, 9);
  });

  it("ignores the canvas box and the offset/scale transform once pinned", () => {
    const m = deriveSceneMetrics(map(
      { width: 30, height: 20, squareSizePx: 44 },
      { canvas: { widthPx: 5000, heightPx: 5000 }, image: pinnedImage({ offsetX: 300, offsetY: -40, scale: 200 }) }
    ));
    expect(m.imageBox).toEqual({ left: 0, top: 0, width: 1320, height: 880, pinned: true });
    expect(m.scenePixelWidth).toBe(1320);
    expect(m.scenePixelHeight).toBe(880);
  });

  it("shifts a pinned image by its origin, measured in source px", () => {
    // 50 source px is half a square at 100 px per square: 22 px with 44 px squares.
    const m = deriveSceneMetrics(map(
      { width: 30, height: 20, squareSizePx: 44 },
      { image: pinnedImage({ originX: 50, originY: 100 }) }
    ));
    expect(m.imageBox.left).toBe(-22);
    expect(m.imageBox.top).toBe(-44);
    expect(m.imageBox.width).toBe(1320);
    // The part left of the grid's corner is cropped off, so the scene stays the grid.
    expect(m.scenePixelWidth).toBe(1320);
  });

  it("grows the scene to cover a pinned image wider than the grid", () => {
    const m = deriveSceneMetrics(map(
      { width: 30, height: 20, squareSizePx: 44 },
      { image: pinnedImage({ sourceWidthPx: 3200 }) }
    ));
    expect(m.imageBox.width).toBe(32 * 44);
    expect(m.scenePixelWidth).toBe(32 * 44);
    expect(m.scenePixelHeight).toBe(20 * 44);
  });

  it("stays unpinned unless px per square and the source size are both set", () => {
    const noSource = deriveSceneMetrics(map({}, { image: pinnedImage({ sourceWidthPx: undefined, sourceHeightPx: undefined }) }));
    expect(noSource.imageBox.pinned).toBe(false);
    const noPin = deriveSceneMetrics(map({}, { image: pinnedImage({ pxPerSquare: undefined }) }));
    expect(noPin.imageBox.pinned).toBe(false);
  });

  it("pads a pinned scene like any other", () => {
    const m = deriveSceneMetrics(map({ width: 30, height: 20, squareSizePx: 44 }, { image: pinnedImage(), paddingSquares: 1 }));
    expect(m.framePixelWidth).toBe(1320 + 88);
    expect(m.framePixelHeight).toBe(880 + 88);
  });
});
