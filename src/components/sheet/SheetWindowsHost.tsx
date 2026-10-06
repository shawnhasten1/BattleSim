"use client";

import { useEffect, useRef } from "react";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";
import { useSheetWindowsStore } from "@/store/sheet-windows-store";
import { ActorSheet } from "./ActorSheet";
import abilityStyles from "./abilities/abilities.module.css";
import styles from "./SheetWindowsHost.module.css";

/**
 * Every open sheet window (CHARACTER_SHEET_WINDOWS_PLAN.md Part 1), kept in step with the encounter: a window whose
 * token is deleted shows another of its creature's tokens, or closes with the last one; a token made its own creature,
 * or changing form, takes its window along; switching scenes closes them all. Messages about the windows themselves
 * show here, outside any window.
 */
export function SheetWindowsHost({ compendium }: { compendium: Compendium }) {
  const windows = useSheetWindowsStore((s) => s.windows);
  const notice = useSheetWindowsStore((s) => s.notice);
  const reconcile = useSheetWindowsStore((s) => s.reconcile);
  const closeAll = useSheetWindowsStore((s) => s.closeAll);
  const clearNotice = useSheetWindowsStore((s) => s.clearNotice);
  const combatants = useEncounterStore((s) => s.encounter.combatants);
  const definitions = useEncounterStore((s) => s.encounter.definitions);
  const scene = useEncounterStore((s) => s.currentEncounterId ?? s.encounter.id);

  useEffect(() => {
    reconcile({ combatants, definitions });
  }, [reconcile, combatants, definitions]);

  const shownScene = useRef(scene);
  useEffect(() => {
    if (shownScene.current === scene) return;
    shownScene.current = scene;
    closeAll();
  }, [scene, closeAll]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clearNotice, 8000);
    return () => window.clearTimeout(timer);
  }, [notice, clearNotice]);

  // Stacked by focus: rank 0 at the back. Rendered in the order they opened, so focusing one doesn't remount any.
  const byFocus = [...windows].sort((a, b) => a.z - b.z);
  const front = byFocus.at(-1)?.id;

  return (
    <>
      {windows.map((sheet) => (
        <ActorSheet key={sheet.id} sheet={sheet} rank={byFocus.indexOf(sheet)} front={sheet.id === front} compendium={compendium} />
      ))}
      {notice ? (
        <div className={`${abilityStyles.toast} ${styles.notice}`} role="status">
          <span>{notice.message}</span>
          {notice.undo ? (
            <button type="button" onClick={() => { notice.undo!(); clearNotice(); }}>Undo</button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
