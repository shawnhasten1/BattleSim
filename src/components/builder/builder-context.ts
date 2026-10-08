"use client";

import { createContext, useContext } from "react";
import type { CreatureDefinition, Edition } from "@/engine";
import type { BuildChange, BuiltCharacter, CharacterBuild, BuilderStep } from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";
import type { EditionChoice } from "@/lib/editions";
import type { SheetStyle } from "@/store/sheet-windows-store";

/** Everything a step of the builder reads and changes (CHARACTER_BUILDER_UX_PLAN.md §1). */
export interface BuilderModel {
  build: CharacterBuild;
  /** A change to the build: one undo step. */
  set: (next: CharacterBuild) => void;
  built: BuiltCharacter;
  /** The actor the build would make, and (editing) what applying changes. */
  preview: { definition: CreatureDefinition; changes: BuildChange[] };
  sources: BuildSources;
  /** The lists' edition filter (2014, 2024 or both). */
  filter: EditionChoice;
  /** The character's own edition: its first class's. */
  edition: Edition;
  creating: boolean;
  adopting: boolean;
  /** The actor being edited or rebuilt. */
  definition?: CreatureDefinition;
  look: SheetStyle;
  go: (step: BuilderStep) => void;
}

export const BuilderContext = createContext<BuilderModel | null>(null);

export function useBuilder(): BuilderModel {
  const model = useContext(BuilderContext);
  if (!model) throw new Error("useBuilder outside the builder");
  return model;
}
