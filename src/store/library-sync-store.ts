"use client";

import { create } from "zustand";
import type { CreatureDefinition } from "@/engine";

/**
 * Linked library actors (ACTORS_TAB_PLAN.md, Phase 1): an edit to a library actor you own, in any scene, is saved to
 * the library a moment later. This store holds the saves waiting or running and how each one went, for the sheet's
 * title bar and the page's "leave anyway?" warning. The encounter store queues the saves; the library copy it keeps
 * follows each one that succeeds, through the handler it registers.
 */
export type LibrarySaveState = "pending" | "saving" | "saved" | "failed";

/** How long after the last edit an actor's save is sent: typing a name sends one save, not one per letter. */
export const LIBRARY_SAVE_DELAY_MS = 1000;

interface LibrarySyncState {
  /** Each actor's latest save, by definition id. */
  states: Record<string, LibrarySaveState>;
  /** Saves `definition` once its edits pause, replacing a save still waiting for the same actor. */
  queue: (definition: CreatureDefinition) => void;
  /** Sends the waiting save of `definitionId` (or of every actor) now. */
  flush: (definitionId?: string) => Promise<void>;
  /** Drops the waiting save of an actor that's going away (deleted from the library). */
  cancel: (definitionId: string) => void;
  /** Sends the failed save of `definitionId` again. */
  retry: (definitionId: string) => void;
  /** Ids whose save is waiting or running: the library loading meanwhile mustn't overwrite their scene copies. */
  busyIds: () => Set<string>;
  /** Forgets every save, sent or not (tests). */
  reset: () => void;
}

const waiting = new Map<string, CreatureDefinition>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** The definition each failed save tried, for Retry. */
const failed = new Map<string, CreatureDefinition>();
/** Saves on the wire, so a second one for the same actor waits its turn. */
const inFlight = new Map<string, Promise<void>>();

let onSaved: ((definition: CreatureDefinition) => void) | null = null;

/** The encounter store's hook: its library copy of an actor becomes what was just saved. */
export function onLibrarySaved(handler: (definition: CreatureDefinition) => void) {
  onSaved = handler;
}

export const useLibrarySyncStore = create<LibrarySyncState>((set, get) => {
  const setState = (id: string, state: LibrarySaveState | null) =>
    set((current) => {
      const states = { ...current.states };
      if (state) states[id] = state;
      else delete states[id];
      return { states };
    });

  async function send(id: string): Promise<void> {
    const before = inFlight.get(id);
    if (before) await before;
    const definition = waiting.get(id);
    if (!definition) return;
    waiting.delete(id);
    setState(id, "saving");
    const request = (async () => {
      try {
        const response = await fetch(`/api/definitions/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ definition })
        });
        if (!response.ok) throw new Error(String(response.status));
        failed.delete(id);
        onSaved?.(definition);
        // A newer edit queued while this one was on the wire keeps its own state.
        if (!waiting.has(id)) setState(id, "saved");
      } catch {
        failed.set(id, definition);
        if (!waiting.has(id)) setState(id, "failed");
      }
    })();
    inFlight.set(id, request);
    await request;
    if (inFlight.get(id) === request) inFlight.delete(id);
  }

  return {
    states: {},
    queue: (definition) => {
      const id = definition.id;
      waiting.set(id, definition);
      failed.delete(id);
      clearTimeout(timers.get(id));
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        void send(id);
      }, LIBRARY_SAVE_DELAY_MS));
      if (get().states[id] !== "pending") setState(id, "pending");
    },
    flush: async (definitionId) => {
      const ids = definitionId ? [definitionId] : [...waiting.keys()];
      await Promise.all(ids.map((id) => {
        clearTimeout(timers.get(id));
        timers.delete(id);
        return send(id);
      }));
    },
    cancel: (definitionId) => {
      clearTimeout(timers.get(definitionId));
      timers.delete(definitionId);
      waiting.delete(definitionId);
      failed.delete(definitionId);
      setState(definitionId, null);
    },
    retry: (definitionId) => {
      const definition = failed.get(definitionId);
      if (!definition) return;
      failed.delete(definitionId);
      waiting.set(definitionId, definition);
      void send(definitionId);
    },
    busyIds: () => new Set([...waiting.keys(), ...inFlight.keys()]),
    reset: () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      waiting.clear();
      failed.clear();
      inFlight.clear();
      set({ states: {} });
    }
  };
});

/** Whether any save is waiting or running: leaving the page now would lose it. */
export function hasUnsavedLibraryEdits(): boolean {
  return useLibrarySyncStore.getState().busyIds().size > 0;
}
