import type { ResizeLimits } from "@/hooks/useFloatingWindow";
import type { SheetStyle } from "@/store/sheet-windows-store";

export interface SheetStyleInfo {
  label: string;
  /** A new window's size in the page, until one of this style has been resized (then that's remembered). */
  width: number;
  height?: number;
  limits: ResizeLimits;
}

/**
 * The sheet styles (CHARACTER_SHEET_WINDOWS_PLAN.md Part 3). Each is another view over the same data and store actions;
 * adding one is a folder with its component, a line here, and its branch in ActorSheet's body.
 */
export const SHEET_STYLES: Record<SheetStyle, SheetStyleInfo> = {
  standard: { label: "Standard", width: 680, limits: { minWidth: 560, minHeight: 320, maxWidth: 1400 } },
  codex: { label: "Codex", width: 1060, height: 860, limits: { minWidth: 640, minHeight: 360, maxWidth: 1600 } }
};

export const SHEET_STYLE_IDS = Object.keys(SHEET_STYLES) as SheetStyle[];
