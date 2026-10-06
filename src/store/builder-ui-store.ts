"use client";

import { create } from "zustand";

/** What a new character starts from, when it's built step by step (Create Token › Character › Step through). */
export interface BuilderSeed {
  name: string;
  classId: string;
  level: number;
  backgroundId?: string;
  speciesId?: string;
}

/** The character builder's open window: a new character, a built one's whole recipe, or its next level. */
export type BuilderWindow =
  | { kind: "create"; seed: BuilderSeed }
  | { kind: "edit"; definitionId: string }
  | { kind: "level-up"; definitionId: string };

interface BuilderUiState {
  window: BuilderWindow | null;
  open: (window: BuilderWindow) => void;
  close: () => void;
  /** The Homebrew window (plan Phase 8b): open beside any builder window. */
  homebrew: boolean;
  openHomebrew: () => void;
  closeHomebrew: () => void;
}

/** Which character builder window is open. Not persisted and not undoable: the windows edit a draft until Apply. */
export const useBuilderUiStore = create<BuilderUiState>((set) => ({
  window: null,
  open: (window) => set({ window }),
  close: () => set({ window: null }),
  homebrew: false,
  openHomebrew: () => set({ homebrew: true }),
  closeHomebrew: () => set({ homebrew: false })
}));
