import { describe, expect, it } from "vitest";
import {
  anchoredZoom,
  getCellPoint,
  getSnappedWallPoint,
  uniqueWallNodes,
  type ViewportState
} from "../src/components/scene/coords";

/**
 * Stand-in for the `.battlemap` element. A `scale(zoom)` transform makes the
 * bounding rect `zoom` times the layout size; a pan shifts `left`/`top`.
 */
function stubBattlemap(zoom: number, screenLeft: number, screenTop: number, layoutW = 1000, layoutH = 800) {
  return {
    clientWidth: layoutW,
    clientHeight: layoutH,
    getBoundingClientRect: () =>
      ({
        left: screenLeft,
        top: screenTop,
        width: layoutW * zoom,
        height: layoutH * zoom,
        right: screenLeft + layoutW * zoom,
        bottom: screenTop + layoutH * zoom,
        x: screenLeft,
        y: screenTop,
        toJSON: () => ({})
      }) as DOMRect
  };
}

const CELL = 44;

describe("getCellPoint", () => {
  it("maps screen pixels to floored cells at zoom 1, no pan", () => {
    expect(getCellPoint(stubBattlemap(1, 0, 0), 150, 90, CELL)).toEqual({ x: 3, y: 2 });
  });

  it("is zoom-invariant: 2x zoom halves the effective pixel distance", () => {
    const atOne = getCellPoint(stubBattlemap(1, 0, 0), 150, 90, CELL);
    const atTwo = getCellPoint(stubBattlemap(2, 0, 0), 300, 180, CELL);
    expect(atTwo).toEqual(atOne);
  });

  it("accounts for pan (rect offset) at fractional zoom", () => {
    // zoom 0.5 -> domScale 2. left=120,top=64. (170-120)*2/44 = 2.27 ; (115-64)*2/44 = 2.31
    expect(getCellPoint(stubBattlemap(0.5, 120, 64), 170, 115, CELL)).toEqual({ x: 2, y: 2 });
  });

  it("returns negative cells for points above/left of the grid origin", () => {
    expect(getCellPoint(stubBattlemap(1, 200, 100), 100, 50, CELL)).toEqual({ x: -3, y: -2 });
  });
});

describe("getSnappedWallPoint", () => {
  it("snaps to the nearest half cell and clamps to the grid", () => {
    // local x ~ 1.1 cells -> 1.0 ; local y ~ 1.4 cells -> 1.5
    expect(getSnappedWallPoint(stubBattlemap(1, 0, 0), 48, 62, CELL, 20, 20)).toEqual({ x: 1, y: 1.5 });
  });

  it("clamps past the far edge", () => {
    expect(getSnappedWallPoint(stubBattlemap(1, 0, 0), 5000, 5000, CELL, 20, 16)).toEqual({ x: 20, y: 16 });
  });

  it("stays correct under zoom", () => {
    expect(getSnappedWallPoint(stubBattlemap(2, 0, 0), 176, 176, CELL, 20, 20)).toEqual({ x: 2, y: 2 });
  });
});

describe("anchoredZoom", () => {
  const base: ViewportState = { x: 40, y: 25, zoom: 1 };

  it("keeps the world point under the cursor fixed on screen", () => {
    const stageRect = { left: 0, top: 0 };
    const anchor = { x: 300, y: 200 };
    const before = { x: (anchor.x - base.x) / base.zoom, y: (anchor.y - base.y) / base.zoom };
    const next = anchoredZoom(base, 2, stageRect, anchor);
    const after = { x: (anchor.x - next.x) / next.zoom, y: (anchor.y - next.y) / next.zoom };
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("clamps zoom to the allowed range", () => {
    expect(anchoredZoom(base, 99, null, null).zoom).toBe(3);
    expect(anchoredZoom(base, 0.01, null, null).zoom).toBe(0.3);
  });

  it("only changes zoom when there is no anchor", () => {
    expect(anchoredZoom(base, 1.5, null, null)).toEqual({ x: 40, y: 25, zoom: 1.5 });
  });
});

describe("uniqueWallNodes", () => {
  it("dedupes shared endpoints", () => {
    const nodes = uniqueWallNodes([
      { start: { x: 0, y: 0 }, end: { x: 2, y: 0 } },
      { start: { x: 2, y: 0 }, end: { x: 2, y: 3 } }
    ]);
    expect(nodes).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 3 }
    ]);
  });
});
