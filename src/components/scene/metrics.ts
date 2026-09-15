import { DEFAULT_GRID_VISUALS, DEFAULT_MAP_IMAGE_SETTINGS, type BattleMapState, type MapImageSettings } from "@/engine";

export interface SceneMetrics {
  cellSize: number;
  gridLineWidth: number;
  gridLineColor: string;
  gridLineOpacity: number;
  gridPixelWidth: number;
  gridPixelHeight: number;
  scenePixelWidth: number;
  scenePixelHeight: number;
  /** Visual buffer (Foundry-style scene padding) in px, one side. 0 for maps
   * without `paddingSquares` set. */
  paddingPx: number;
  /** Outer frame size = scene pixels + padding on every side. What actually
   * gets rendered/panned; `scenePixelWidth/Height` stays the unpadded content
   * size so existing canvas-size consumers are unaffected. */
  framePixelWidth: number;
  framePixelHeight: number;
  imageSettings: MapImageSettings;
  canvasSettings: { widthPx: number; heightPx: number };
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
  const scenePixelWidth = Math.max(canvasSettings.widthPx, gridPixelWidth);
  const scenePixelHeight = Math.max(canvasSettings.heightPx, gridPixelHeight);
  const paddingPx = Math.max(0, map.paddingSquares ?? 0) * cellSize;

  return {
    cellSize,
    gridLineWidth,
    gridLineColor,
    gridLineOpacity,
    gridPixelWidth,
    gridPixelHeight,
    scenePixelWidth,
    scenePixelHeight,
    paddingPx,
    framePixelWidth: scenePixelWidth + paddingPx * 2,
    framePixelHeight: scenePixelHeight + paddingPx * 2,
    imageSettings,
    canvasSettings
  };
}
