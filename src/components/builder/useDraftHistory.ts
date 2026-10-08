"use client";

import { useCallback, useRef, useState } from "react";
import type { CharacterBuild } from "@/lib/character-builder";
import { readJson, writeJson } from "@/lib/persist";

/** What the builder edits: the build, and (for a new character) its name. */
export interface Draft {
  build: CharacterBuild;
  name: string;
}

interface Stored extends Draft {
  version: 1;
  savedAt: number;
}

const KEY = (key: string) => `builder-draft:${key}`;
const LIMIT = 100;

function storedDraft(key: string): Stored | undefined {
  const stored = readJson<Stored | null>(KEY(key), null);
  // An older shape, or one too broken to build from, isn't offered.
  if (!stored || stored.version !== 1 || !stored.build || !Array.isArray(stored.build.levels) || !stored.build.levels.length) return undefined;
  return stored;
}

function forget(key: string) {
  try {
    window.localStorage.removeItem(`battlesim:${KEY(key)}`);
  } catch {
    /* private mode */
  }
}

/**
 * The builder's draft (CHARACTER_BUILDER_UX_PLAN.md D11), with undo and redo, kept in this browser until it's applied
 * or cancelled: closing the window by accident loses nothing. A draft kept from before is offered, not forced: `offer`
 * is it, `restore` takes it, `dismiss` starts over.
 */
export function useDraftHistory(key: string, initial: () => Draft | undefined, accepts: (draft: Draft) => boolean = () => true) {
  const [state, setState] = useState(() => ({ past: [] as Draft[], present: initial(), future: [] as Draft[] }));
  const [offer, setOffer] = useState<Stored | undefined>(() => {
    const stored = storedDraft(key);
    const start = state.present;
    if (!stored || !accepts(stored)) return undefined;
    // The same as where it starts: nothing to offer.
    return start && JSON.stringify(start) === JSON.stringify({ build: stored.build, name: stored.name }) ? undefined : stored;
  });
  const keyRef = useRef(key);
  keyRef.current = key;

  const keep = (draft: Draft | undefined) => {
    if (draft) writeJson(KEY(keyRef.current), { version: 1, savedAt: Date.now(), ...draft } satisfies Stored);
  };

  /** A change: one undo step. */
  const set = useCallback((next: Draft) => {
    setState((current) => {
      if (!current.present) return { past: [], present: next, future: [] };
      keep(next);
      return { past: [...current.past, current.present].slice(-LIMIT), present: next, future: [] };
    });
    setOffer(undefined);
  }, []);

  /** A change that isn't an undo step of its own (each letter of a name). */
  const replace = useCallback((next: Draft) => {
    setState((current) => ({ ...current, present: next }));
    keep(next);
  }, []);

  const undo = useCallback(() => {
    setState((current) => {
      const previous = current.past[current.past.length - 1];
      if (!previous || !current.present) return current;
      keep(previous);
      return { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setState((current) => {
      const next = current.future[0];
      if (!next || !current.present) return current;
      keep(next);
      return { past: [...current.past, current.present], present: next, future: current.future.slice(1) };
    });
  }, []);

  /** The kept draft, taken: where it starts is one undo away. */
  const restore = useCallback(() => {
    if (!offer) return;
    setState((current) => ({ past: current.present ? [current.present] : [], present: { build: offer.build, name: offer.name }, future: [] }));
    setOffer(undefined);
  }, [offer]);

  const dismiss = useCallback(() => {
    forget(keyRef.current);
    setOffer(undefined);
  }, []);

  /** Applied or cancelled: the kept draft goes. */
  const clear = useCallback(() => forget(keyRef.current), []);

  return {
    present: state.present,
    set,
    replace,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    offer,
    restore,
    dismiss,
    clear
  };
}
