"use client";

import { useBuilderUiStore } from "@/store/builder-ui-store";
import { CharacterBuilder } from "./CharacterBuilder";
import { LevelUpWindow } from "./LevelUpWindow";

/** The character builder's window, whichever is open. `onCreated` opens the new character's sheet. */
export function BuilderHost({ onCreated }: { onCreated: () => void }) {
  const window = useBuilderUiStore((s) => s.window);
  const close = useBuilderUiStore((s) => s.close);
  if (!window) return null;
  if (window.kind === "level-up") return <LevelUpWindow key={window.definitionId} definitionId={window.definitionId} onClose={close} />;
  if (window.kind === "edit") return <CharacterBuilder key={window.definitionId} definitionId={window.definitionId} onClose={close} />;
  return <CharacterBuilder key={`create-${window.seed.classId}-${window.seed.name}`} seed={window.seed} onClose={close} onCreated={onCreated} />;
}
