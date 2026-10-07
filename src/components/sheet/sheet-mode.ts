"use client";

import { createContext, useContext } from "react";

/**
 * How a sheet window is open (ACTORS_TAB_PLAN.md, Phase 2), for the parts inside that differ:
 * - `tokenless`: its creature has no token in the scene (opened from the Actors tab). What belongs to one token (hit
 *   points, conditions, what's left of its pools, its name and side) is hidden; a preview token stands in for reading.
 * - `readOnly`: an SRD monster or a shared template opened that way, which can't change. Its boxes don't take typing;
 *   the store refuses any other edit, and the sheet offers Copy to my library.
 */
export interface SheetMode {
  tokenless: boolean;
  readOnly: boolean;
}

export const SheetModeContext = createContext<SheetMode>({ tokenless: false, readOnly: false });

export const useSheetMode = () => useContext(SheetModeContext);
