import { describe, expect, it } from "vitest";
import { DEFAULT_GRID_VISUALS, type BattleMapState } from "../src/engine";
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
    expect(m.paddingPx).toBe(0);
    expect(m.framePixelWidth).toBe(m.scenePixelWidth);
    expect(m.framePixelHeight).toBe(m.scenePixelHeight);
  });

  it("expands the frame by paddingSquares * cellSize on every side", () => {
    const m = deriveSceneMetrics(map({ squareSizePx: 40 }, { paddingSquares: 1 }));
    expect(m.paddingPx).toBe(40);
    expect(m.framePixelWidth).toBe(m.scenePixelWidth + 80);
    expect(m.framePixelHeight).toBe(m.scenePixelHeight + 80);
  });

  it("clamps a negative paddingSquares to 0", () => {
    const m = deriveSceneMetrics(map({}, { paddingSquares: -2 }));
    expect(m.paddingPx).toBe(0);
  });
});
