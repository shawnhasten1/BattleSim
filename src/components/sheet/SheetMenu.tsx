"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import type { CombatantState, CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { exportCombatant } from "@/lib/actor-sheet/export";
import { ownCreatureBlock, type LibraryStatus } from "@/lib/actor-sheet/scope";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { readBuild } from "@/lib/character-builder";
import { useOwnerDocument } from "@/hooks/useOwnerDocument";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import styles from "./sheet.module.css";

export interface SheetToast {
  message: string;
  /** Offered beside the message ("Deleted Goblin 2. Undo"). */
  undo?: () => void;
}

/** A library actor you own has none: it's linked, so its changes are saved there already (ACTORS_TAB_PLAN.md D3). */
const SAVE_LABELS: Record<Exclude<LibraryStatus, "saved">, string> = {
  template: "Copy to my library",
  srd: "Save a copy to my library",
  scene: "Save to my library"
};

/**
 * The sheet's ⋯ menu: what the Actors panel offers for the selected token, from the sheet itself, and Make it its own
 * creature. Every item waits on `guard`, which asks first when an ability being edited has unsaved changes.
 */
export function SheetMenu({ combatant, definition, status, guard, onToast, onOwnCreature, onShowToken, extraItems }: {
  combatant: CombatantState;
  definition: CreatureDefinition;
  status: LibraryStatus;
  guard: (action: () => void) => void;
  onToast: (toast: SheetToast) => void;
  /** After Make it its own creature: Stats, with the new creature's name ready to rename. */
  onOwnCreature: () => void;
  /** Show another token of this creature in the window (the copy Duplicate token just made). */
  onShowToken?: (combatantId: string) => void;
  /** More items at the end, after a separator (the Codex's palettes). */
  extraItems?: ContextMenuItem[];
}) {
  const saveDefinition = useEncounterStore((s) => s.saveDefinition);
  const copyLibraryDefinition = useEncounterStore((s) => s.copyLibraryDefinition);
  const duplicateCombatant = useEncounterStore((s) => s.duplicateCombatant);
  const removeCombatant = useEncounterStore((s) => s.removeCombatant);
  const makeOwnCreature = useEncounterStore((s) => s.makeOwnCreature);
  const encounter = useEncounterStore((s) => s.encounter);
  const selectCombatant = useEncounterStore((s) => s.selectCombatant);
  const undo = useEncounterStore((s) => s.undo);
  const openBuilder = useBuilderUiStore((s) => s.open);
  // The menu's own document: a popped-out sheet exports from its own window.
  const ownerDocument = useOwnerDocument();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const build = readBuild(definition);

  async function save() {
    const name = definition.name;
    if (status === "template") {
      await copyLibraryDefinition(definition.id);
      onToast({ message: `Copied ${name} to your library.` });
      return;
    }
    await saveDefinition(definition.id);
    // Saving an SRD monster gives the scene's copy (and its tokens) a fresh id first: look for whichever it has now.
    const state = useEncounterStore.getState();
    const id = state.encounter.combatants.find((candidate) => candidate.id === combatant.id)?.definitionId ?? definition.id;
    const saved = state.definitionsLibrary.some((candidate) => candidate.id === id || candidate.id === definition.id);
    onToast({ message: saved ? `Saved ${name} in your library.` : `Couldn't save ${name} to your library.` });
  }

  function duplicate() {
    duplicateCombatant(combatant.id);
    const state = useEncounterStore.getState();
    const copy = state.encounter.combatants.find((candidate) => candidate.id === state.selectedCombatantId);
    if (copy && copy.id !== combatant.id) {
      onShowToken?.(copy.id);
      onToast({ message: `Added ${copy.displayName}, a copy of ${combatant.displayName}.` });
    }
  }

  function ownCreature() {
    if (!makeOwnCreature(combatant.id)) return;
    onOwnCreature();
    // Only the split it announces: anything done since would be undone instead.
    const depth = useEncounterStore.getState().undoStack.length;
    onToast({
      message: `${combatant.displayName} is its own creature now: changes to it reach only this token.`,
      undo: () => {
        if (useEncounterStore.getState().undoStack.length === depth) undo();
      }
    });
  }

  function remove() {
    removeCombatant(combatant.id);
    // Only the delete it announces: anything done since would be undone instead.
    const depth = useEncounterStore.getState().undoStack.length;
    onToast({
      message: `Deleted ${combatant.displayName}.`,
      undo: () => {
        if (useEncounterStore.getState().undoStack.length !== depth) return;
        undo();
        selectCombatant(combatant.id);
      }
    });
  }

  // Only worked out while the menu is open: it looks through every creature's summons.
  const block = menu ? ownCreatureBlock(encounter, combatant, definition) : undefined;
  const items: ContextMenuItem[] = [
    // A character made by the character builder levels up from here, as from Stats › Class & level.
    ...(build ? [
      {
        label: "Level up…",
        disabled: build.levels.length >= 20,
        onSelect: () => guard(() => openBuilder({ kind: "level-up", definitionId: definition.id }))
      },
      { label: "Open in the character builder…", onSelect: () => guard(() => openBuilder({ kind: "edit", definitionId: definition.id })) },
      { separator: true as const }
    ] : []),
    ...(status === "saved" ? [] : [{ label: SAVE_LABELS[status], onSelect: () => guard(() => void save()) }]),
    { label: "Export JSON", onSelect: () => guard(() => exportCombatant(combatant, definition, ownerDocument)) },
    { separator: true },
    { label: "Duplicate token", onSelect: () => guard(duplicate) },
    {
      label: "Make it its own creature",
      disabled: Boolean(block),
      hint: block ?? `A copy of ${definition.name} for this token alone, named ${combatant.displayName}.`,
      onSelect: () => guard(ownCreature)
    },
    { label: "Delete token", danger: true, onSelect: () => guard(remove) },
    ...(extraItems?.length ? [{ separator: true } as ContextMenuItem, ...extraItems] : [])
  ];

  return (
    <>
      <button
        type="button" className={styles.menuButton} aria-label="More actions" aria-haspopup="menu" aria-expanded={menu !== null}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: rect.left, y: rect.bottom + 4 });
        }}
      >
        <MoreHorizontal size={14} />
      </button>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} /> : null}
    </>
  );
}
