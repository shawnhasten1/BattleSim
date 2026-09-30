"use client";

import { createContext, useContext, useEffect, useRef } from "react";

/** What the sheet needs from an open editor before it switches tab, closes, or follows another token. */
export interface EditorGuard {
  /** Unsaved changes. */
  dirty: boolean;
  /** "Bite": named in the question. */
  label: string;
  /** Save; `false` when it couldn't (a missing name), so the sheet stays put. */
  save: () => boolean;
  discard: () => void;
}

interface GuardRegistry {
  register: (guard: EditorGuard | null) => void;
}

export const SheetGuardContext = createContext<GuardRegistry | null>(null);

/**
 * Tell the sheet around this editor about its unsaved changes. Outside a sheet (a test rendering the tab alone) it
 * does nothing.
 */
export function useEditorGuard(guard: EditorGuard) {
  const registry = useContext(SheetGuardContext);
  const latest = useRef(guard);
  latest.current = guard;
  useEffect(() => {
    if (!registry) return;
    registry.register({
      dirty: guard.dirty,
      label: guard.label,
      save: () => latest.current.save(),
      discard: () => latest.current.discard()
    });
  }, [registry, guard.dirty, guard.label]);
  useEffect(() => () => registry?.register(null), [registry]);
}
