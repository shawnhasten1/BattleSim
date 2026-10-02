import { DEFAULT_GRID_VISUALS, DEFAULT_MAP_IMAGE_SETTINGS, type BattleMapState, type MapImageSettings } from "@/engine";

/**
 * Where the background image is drawn inside the (unpadded) scene, in scene px.
 * A pinned image is placed in grid squares, from its own px per square, so it
 * scales with the grid and can't drift from it. An unpinned one fills
 * `map.canvas` at 0,0 and the canvas applies the image offset/scale transform
 * on top, as before pinning existed.
 */
export interface ImageBox {
  left: number;
  top: number;
  width: number;
  height: number;
  pinned: boolean;
}

export interface SceneMetrics {
  cellSize: number;
  gridLineWidth: number;
  gridLineColor: string;
  gridLineOpacity: number;
  gridPixelWidth: number;
  gridPixelHeight: number;
  scenePixelWidth: number;
  scenePixelHeight: number;
  /** Visual buffer (Foundry-style scene padding) in px: left and right, then
   * top and bottom. Whole squares; 0 for maps without padding set. */
  paddingXPx: number;
  paddingYPx: number;
  /** Outer frame size = scene pixels + padding on every side. What actually
   * gets rendered/panned; `scenePixelWidth/Height` stays the unpadded content
   * size so existing canvas-size consumers are unaffected. */
  framePixelWidth: number;
  framePixelHeight: number;
  imageSettings: MapImageSettings;
  canvasSettings: { widthPx: number; heightPx: number };
  imageBox: ImageBox;
}

/** The image's grid fit, if it has one: px per square and the source size it's measured against. */
function imagePin(image: MapImageSettings) {
  const { pxPerSquare, sourceWidthPx, sourceHeightPx } = image;
  if (!pxPerSquare || !sourceWidthPx || !sourceHeightPx) return null;
  return { pxPerSquare, sourceWidthPx, sourceHeightPx, originX: image.originX ?? 0, originY: image.originY ?? 0 };
}

/**
 * Render dimensions derived purely from map config. Shared by the canvas and
 * the scene-config modal so both agree on cell size, grid pixels, etc.
 * Ported verbatim from the inline derivations in the old page component.
 */
export function deriveSceneMetrics(map: BattleMapState): SceneMetrics {
  const gridSettings = { ...DEFAULT_GRID_VISUALS, ...map.grid };
  const imageSettings = { ...DEFAULT_MAP_IMAGE_SETTINGS, ...map.image };
  const canvasSettings = map.canvas ?? {
    widthPx: map.grid.width * DEFAULT_GRID_VISUALS.squareSizePx,
    heightPx: map.grid.height * DEFAULT_GRID_VISUALS.squareSizePx
  };
  const cellSize = gridSettings.squareSizePx || DEFAULT_GRID_VISUALS.squareSizePx;
  const gridLineWidth = Math.max(0.5, gridSettings.lineWidthPx ?? DEFAULT_GRID_VISUALS.lineWidthPx);
  const gridLineColor = gridSettings.lineColor || DEFAULT_GRID_VISUALS.lineColor;
  const gridLineOpacity = Math.min(1, Math.max(0, gridSettings.lineOpacity ?? DEFAULT_GRID_VISUALS.lineOpacity));
  const gridPixelWidth = map.grid.width * cellSize;
  const gridPixelHeight = map.grid.height * cellSize;
  const pin = imagePin(imageSettings);
  const imageBox: ImageBox = pin
    ? {
        left: pin.originX ? (-pin.originX / pin.pxPerSquare) * cellSize : 0,
        top: pin.originY ? (-pin.originY / pin.pxPerSquare) * cellSize : 0,
        width: (pin.sourceWidthPx / pin.pxPerSquare) * cellSize,
        height: (pin.sourceHeightPx / pin.pxPerSquare) * cellSize,
        pinned: true
      }
    : { left: 0, top: 0, width: canvasSettings.widthPx, height: canvasSettings.heightPx, pinned: false };
  // The scene covers the grid and the image's far edge. Unpinned, that's
  // max(canvas, grid), as it always was.
  const scenePixelWidth = Math.max(imageBox.left + imageBox.width, gridPixelWidth);
  const scenePixelHeight = Math.max(imageBox.top + imageBox.height, gridPixelHeight);
  // Foundry pads each side by a share of that axis, rounded up to whole squares.
  const percent = map.paddingPercent;
  const squares = Math.max(0, map.paddingSquares ?? 0);
  const paddingFor = (scenePx: number) => (percent ? Math.ceil((percent / 100) * (scenePx / cellSize) - 1e-9) : squares) * cellSize;
  const paddingXPx = paddingFor(scenePixelWidth);
  const paddingYPx = paddingFor(scenePixelHeight);

  return {
    cellSize,
    gridLineWidth,
    gridLineColor,
    gridLineOpacity,
    gridPixelWidth,
    gridPixelHeight,
    scenePixelWidth,
    scenePixelHeight,
    paddingXPx,
    paddingYPx,
    framePixelWidth: scenePixelWidth + paddingXPx * 2,
    framePixelHeight: scenePixelHeight + paddingYPx * 2,
    imageSettings,
    canvasSettings,
    imageBox
  };
}
