import { render } from "@testing-library/react";
import { SheetWindowsHost } from "@/components/sheet/SheetWindowsHost";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";
import { useSheetWindowsStore } from "@/store/sheet-windows-store";

const pristineWindows = useSheetWindowsStore.getState();

/** No sheet windows open. */
export function resetSheetWindows() {
  useSheetWindowsStore.setState(pristineWindows, true);
}

/**
 * Open the sheet window of `combatantId` (the selected token when not given) and render the windows host, the way the
 * editor does. Any window already open stays open.
 */
export function renderSheet(compendium: Compendium, combatantId?: string) {
  const { selectedCombatantId, encounter } = useEncounterStore.getState();
  const id = combatantId ?? selectedCombatantId ?? encounter.combatants[0]!.id;
  useSheetWindowsStore.getState().open(id);
  return render(<SheetWindowsHost compendium={compendium} />);
}

export const sheetWindows = () => useSheetWindowsStore.getState().windows;
