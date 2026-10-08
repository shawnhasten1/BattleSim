"use client";

import { create } from "zustand";
import type { CombatantState, CreatureDefinition, EncounterSnapshot } from "@/engine";
import { isSrdMonsterId, loadSrdMonster } from "@/data/srd/monsters";
import type { SheetTabId } from "@/components/sheet/ScopedTabs";
import { readJson, writeJson } from "@/lib/persist";
import { paletteFrom, type CodexPaletteId } from "@/lib/actor-sheet/codex";
import { useEncounterStore } from "./encounter-store";
import { useLibrarySyncStore } from "./library-sync-store";

/** How a sheet looks: today's sheet, or the Codex (CHARACTER_SHEET_WINDOWS_PLAN.md Part 3). */
export type SheetStyle = "standard" | "codex";

/**
 * One open sheet window (plan Part 1). It edits a creature, and every edit to the creature reaches all of its tokens
 * (D2). The values that belong to one token (HP, conditions, spent slots, the Token tab) are those of `combatantId`.
 */
export interface SheetWindow {
  id: string;
  definitionId: string;
  /**
   * The token whose values it shows, or null for a creature with no token in the scene, opened from the Actors tab
   * (ACTORS_TAB_PLAN.md, Phase 2): its creature is on the bench while the window is open.
   */
  combatantId: string | null;
  style: SheetStyle;
  tab: SheetTabId;
  /** Focus order: the highest is in front, and the lowest closes first when there are too many (D3). */
  z: number;
  /** Where it opens in the page: cascaded from the window in front. */
  origin: { x: number; y: number };
  /** Its own browser window while it's popped out (Part 2), or null while it's in the page. */
  popup: Window | null;
  /** Its ability editor has unsaved changes: never closed to make room. */
  dirty: boolean;
}

export interface SheetNotice {
  message: string;
  /** Offered beside the message. */
  undo?: () => void;
}

export interface OpenOptions {
  style?: SheetStyle;
  tab?: SheetTabId;
}

/** At most this many sheets are open, in the page and popped out (D3). */
export const MAX_SHEET_WINDOWS = 8;
/** How far down and right a new window opens from the one in front. */
export const CASCADE_STEP = 28;
const DEFAULT_ORIGIN = { x: 72, y: 60 };

const TAB_KEY = "actor-sheet-tab";
const STYLE_KEY = "sheet-style";
const PALETTE_KEY = "codex-palette";

/** The Codex's palette, per browser (D6): Dark until Light is picked. */
function storedPalette(): CodexPaletteId {
  return paletteFrom(readJson<unknown>(PALETTE_KEY, "dark"));
}

/** The creature a token shows now: a shapechanger in another form shows that form. */
export function shownDefinitionId(combatant: Pick<CombatantState, "definitionId" | "activeForm">): string {
  return combatant.activeForm?.definitionId ?? combatant.definitionId;
}

/** The tab a new window opens on: the last one used, per browser, or Stats. */
function storedTab(): SheetTabId {
  const stored = readJson<string>(TAB_KEY, "stats");
  return stored === "abilities" || stored === "token" ? stored : "stats";
}

/** Player characters and everything else each remember the style they were last shown in (D5). */
export type SheetKind = "pc" | "other";
export function storedStyle(kind: SheetKind): SheetStyle {
  const stored = readJson<Partial<Record<SheetKind, SheetStyle>>>(STYLE_KEY, {});
  return stored[kind] === "codex" ? "codex" : "standard";
}
/** Remembers the style new windows of this kind open in (the builder shares the PC sheets'). */
export function rememberStyle(kind: SheetKind, style: SheetStyle) {
  const stored = readJson<Partial<Record<SheetKind, SheetStyle>>>(STYLE_KEY, {});
  writeJson(STYLE_KEY, { ...stored, [kind]: style });
}

/** A new window's spot: down and right of the window in front (wrapping before it leaves the viewport), or `base`. */
function cascadeFrom(front: { x: number; y: number } | undefined, base: { x: number; y: number }) {
  if (!front) return base;
  const width = typeof window === "undefined" ? 1600 : window.innerWidth;
  const height = typeof window === "undefined" ? 900 : window.innerHeight;
  const next = { x: front.x + CASCADE_STEP, y: front.y + CASCADE_STEP };
  if (next.x > width - 360 || next.y > height - 240) return { x: DEFAULT_ORIGIN.x + CASCADE_STEP / 2, y: DEFAULT_ORIGIN.y };
  return next;
}

let nextId = 0;

interface SheetWindowsState {
  windows: SheetWindow[];
  /**
   * A message for the DM shown by the host, outside any window: "Closed the Goblin sheet to make room", or a sheet's own
   * toast when that sheet just closed (its creature's last token was deleted from it).
   */
  notice: SheetNotice | null;
  /** Each window's last position in the page, for cascading (not a render input, so outside `windows`). */
  positions: Record<string, { x: number; y: number }>;
  /** Every Codex's palette, per browser. */
  palette: CodexPaletteId;
  setPalette: (palette: CodexPaletteId) => void;
  /**
   * Open the sheet of a token: its creature's window, if one is open (now showing that token, in front), or a new one.
   * Returns the window's id, or null when no window could be opened.
   */
  open: (combatantId: string, options?: OpenOptions) => string | null;
  /**
   * Open the sheet of a creature in the scene's definitions: a token's, when one shows it, or a window with no token
   * (its creature on the bench). Returns the window's id, or null.
   */
  openCreature: (definitionId: string, options?: OpenOptions) => string | null;
  close: (id: string) => void;
  closeAll: () => void;
  focus: (id: string) => void;
  showToken: (id: string, combatantId: string) => void;
  setTab: (id: string, tab: SheetTabId) => void;
  setStyle: (id: string, style: SheetStyle, kind?: SheetKind) => void;
  setDirty: (id: string, dirty: boolean) => void;
  popOut: (id: string, popup: Window) => void;
  dock: (id: string) => void;
  notePosition: (id: string, position: { x: number; y: number }) => void;
  notify: (notice: SheetNotice) => void;
  clearNotice: () => void;
  /**
   * Keep the windows in step with the encounter: tokens removed, made their own creature, or changing form; a window
   * with no token taking the first token placed of its creature.
   */
  reconcile: (encounter: Pick<EncounterSnapshot, "combatants" | "definitions">) => void;
}

/** Open sheet windows. UI only: not undoable, and not persisted (D4), except each kind's last style and the last tab. */
export const useSheetWindowsStore = create<SheetWindowsState>((set, get) => {
  const topZ = () => get().windows.reduce((top, entry) => Math.max(top, entry.z), 0);

  /** A window going: its library actor's last change is saved now, and its creature leaves the bench. */
  function release(entry: SheetWindow) {
    void useLibrarySyncStore.getState().flush(entry.definitionId);
    if (entry.combatantId === null) useEncounterStore.getState().unbenchCreature(entry.definitionId);
  }

  /** Opens (or brings to the front) the window of `definitionId`, showing `combatant`, or no token when null. */
  function place(definitionId: string, combatant: CombatantState | null, options: OpenOptions): string | null {
    const encounter = useEncounterStore.getState().encounter;
    const combatantId = combatant?.id ?? null;
    const z = topZ() + 1;
    const existing = get().windows.find((entry) => entry.definitionId === definitionId);
    if (existing) {
      set((state) => ({
        windows: state.windows.map((entry) =>
          entry.id === existing.id
            ? { ...entry, combatantId, z, ...(options.tab ? { tab: options.tab } : {}), ...(options.style ? { style: options.style } : {}) }
            : entry
        )
      }));
      if (existing.popup && !existing.popup.closed) existing.popup.focus();
      return existing.id;
    }

    let windows = get().windows;
    let notice: SheetNotice | null = null;
    if (windows.length >= MAX_SHEET_WINDOWS) {
      const oldest = [...windows].filter((entry) => !entry.dirty).sort((a, b) => a.z - b.z)[0];
      if (!oldest) {
        set({ notice: { message: `${MAX_SHEET_WINDOWS} sheets are open, each with unsaved changes. Save or close one first.` } });
        return null;
      }
      windows = windows.filter((entry) => entry.id !== oldest.id);
      const oldName = encounter.definitions.find((definition) => definition.id === oldest.definitionId)?.name ?? "a";
      notice = { message: `Closed the ${oldName} sheet: ${MAX_SHEET_WINDOWS} sheets can be open at once.` };
      release(oldest);
    }

    const definition = encounter.definitions.find((candidate) => candidate.id === definitionId);
    const kind: SheetKind = definition?.character || combatant?.faction === "party" ? "pc" : "other";
    const front = windows.filter((entry) => !entry.popup).sort((a, b) => b.z - a.z)[0];
    const frontPosition = front ? get().positions[front.id] ?? front.origin : undefined;
    const style = options.style ?? storedStyle(kind);
    const base = readJson<{ x: number; y: number }>(`win:sheet-${style}`, DEFAULT_ORIGIN);
    const id = `sheet-${(nextId += 1)}`;
    const entry: SheetWindow = {
      id,
      definitionId,
      combatantId,
      style,
      tab: options.tab ?? storedTab(),
      z,
      origin: cascadeFrom(frontPosition, base),
      popup: null,
      dirty: false
    };
    set({ windows: [...windows, entry], ...(notice ? { notice } : {}) });
    return id;
  }

  return {
    windows: [],
    notice: null,
    positions: {},
    palette: storedPalette(),
    setPalette: (palette) => {
      writeJson(PALETTE_KEY, palette);
      set({ palette });
    },

    open: (combatantId, options = {}) => {
      const encounter = useEncounterStore.getState().encounter;
      const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
      if (!combatant) return null;
      return place(shownDefinitionId(combatant), combatant, options);
    },

    openCreature: (definitionId, options = {}) => {
      const encounter = useEncounterStore.getState().encounter;
      if (!encounter.definitions.some((definition) => definition.id === definitionId)) return null;
      const token = encounter.combatants.find((candidate) => shownDefinitionId(candidate) === definitionId);
      return place(definitionId, token ?? null, options);
    },

    close: (id) => {
      const closing = get().windows.find((entry) => entry.id === id);
      set((state) => {
        const { [id]: _dropped, ...positions } = state.positions;
        return { windows: state.windows.filter((entry) => entry.id !== id), positions };
      });
      if (closing) release(closing);
    },

    closeAll: () => {
      const closing = get().windows;
      set({ windows: [], positions: {} });
      closing.forEach(release);
    },

    focus: (id) => {
      const target = get().windows.find((entry) => entry.id === id);
      if (!target || target.z === topZ()) return;
      const z = topZ() + 1;
      set((state) => ({ windows: state.windows.map((entry) => (entry.id === id ? { ...entry, z } : entry)) }));
    },

    showToken: (id, combatantId) =>
      set((state) => ({ windows: state.windows.map((entry) => (entry.id === id ? { ...entry, combatantId } : entry)) })),

    setTab: (id, tab) => {
      writeJson(TAB_KEY, tab);
      set((state) => ({ windows: state.windows.map((entry) => (entry.id === id ? { ...entry, tab } : entry)) }));
    },

    setStyle: (id, style, kind) => {
      if (kind) rememberStyle(kind, style);
      set((state) => ({ windows: state.windows.map((entry) => (entry.id === id ? { ...entry, style } : entry)) }));
    },

    setDirty: (id, dirty) => {
      const target = get().windows.find((entry) => entry.id === id);
      if (!target || target.dirty === dirty) return;
      set((state) => ({ windows: state.windows.map((entry) => (entry.id === id ? { ...entry, dirty } : entry)) }));
    },

    popOut: (id, popup) =>
      set((state) => ({ windows: state.windows.map((entry) => (entry.id === id ? { ...entry, popup, z: topZ() + 1 } : entry)) })),

    dock: (id) => set((state) => ({
      windows: state.windows.map((entry) =>
        entry.id === id ? { ...entry, popup: null, origin: state.positions[id] ?? entry.origin, z: topZ() + 1 } : entry
      )
    })),

    notePosition: (id, position) => set((state) => ({ positions: { ...state.positions, [id]: position } })),

    notify: (notice) => set({ notice }),
    clearNotice: () => set({ notice: null }),

    reconcile: (encounter) => {
      const windows = get().windows;
      if (!windows.length) return;
      const byId = new Map(encounter.combatants.map((combatant) => [combatant.id, combatant]));
      const definitionIds = new Set(encounter.definitions.map((definition) => definition.id));
      let changed = false;
      const next: SheetWindow[] = [];
      // Front first: when two windows come to show one creature (a token changed form), the one in front stays.
      for (const entry of [...windows].sort((a, b) => b.z - a.z)) {
        let { definitionId, combatantId } = entry;
        const token = combatantId === null ? undefined : byId.get(combatantId);
        if (token) {
          // Made its own creature, or changed form: the window follows its token.
          definitionId = shownDefinitionId(token);
        } else {
          // Another token of its creature; for a window with no token, the first one placed (it's a token's sheet now).
          const other = encounter.combatants.find((combatant) => shownDefinitionId(combatant) === definitionId);
          if (other) {
            combatantId = other.id;
          } else if (combatantId !== null) {
            // Its creature's last token went: it closes with it. A window opened with no token stays while its creature does.
            changed = true;
            continue;
          }
        }
        if (!definitionIds.has(definitionId)) {
          changed = true;
          continue;
        }
        const twin = next.find((kept) => kept.definitionId === definitionId);
        if (twin) {
          // Merged into the window in front, which keeps showing its own token.
          changed = true;
          continue;
        }
        if (definitionId !== entry.definitionId || combatantId !== entry.combatantId) {
          changed = true;
          next.push({ ...entry, definitionId, combatantId });
        } else {
          next.push(entry);
        }
      }
      if (!changed) return;
      const order = new Map(windows.map((entry, index) => [entry.id, index]));
      next.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      set({ windows: next });
    }
  };
});

/**
 * Opens an actor's sheet from the Actors tab (ACTORS_TAB_PLAN.md, Phase 2): its token's, when one is in the scene;
 * otherwise its creature goes on the bench (from the scene, your library, or the SRD) and the sheet opens with no token.
 * Returns the window's id, or null when the creature couldn't be found.
 */
export async function openActorSheet(definitionId: string, options?: OpenOptions): Promise<string | null> {
  const store = useEncounterStore.getState();
  if (!store.encounter.definitions.some((definition) => definition.id === definitionId)) {
    let definition: CreatureDefinition | undefined = store.definitionsLibrary.find((candidate) => candidate.id === definitionId);
    if (!definition && isSrdMonsterId(definitionId)) {
      try {
        definition = await loadSrdMonster(definitionId);
      } catch {
        definition = undefined;
      }
    }
    if (!definition) return null;
    useEncounterStore.getState().benchCreature(definition);
  }
  return useSheetWindowsStore.getState().openCreature(definitionId, options);
}
