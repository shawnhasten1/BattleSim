"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ActionDefinition, CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { actionStatblock } from "@/lib/statblock";
import { legendaryLosses, multiattackLosses, withoutDefinitionItem, type DefinitionItemType } from "@/lib/definition-edits";
import { duplicateOf, type ListRow, type MoveTarget } from "@/lib/ability-editor/list";
import { stepChoices } from "@/lib/ability-editor/sequence";
import { withActionType } from "@/lib/ability-editor/spells";
import { withWorn } from "@/lib/ability-editor/items";
import { findAbility } from "@/lib/ability-editor/refs";
import { refRowId, rowId } from "./AbilitiesList";
import styles from "./abilities.module.css";

/*
 * What a row's ⋯ menu and switches do, for every sheet that lists abilities (Standard's Abilities tab and the Codex):
 * Duplicate, Move to…, Delete (asking first when a multiattack or a legendary action uses the record, with "Deleted
 * Bite. Undo" after), Use it, and Worn. Both sheets call these, so they behave the same.
 */

const MOVE_TYPES: Record<MoveTarget, ActionDefinition["actionType"]> = { actions: "action", bonus: "bonus", reactions: "reaction" };

/** Duplicate, Move to…, Use it and Worn. Duplicate and Move return the row id of the record to show (the copy, the moved one). */
export function useRowEdits(definition: CreatureDefinition) {
  const insertAbilityRecord = useEncounterStore((s) => s.insertAbilityRecord);
  const replaceAbilityRecord = useEncounterStore((s) => s.replaceAbilityRecord);
  const updateFeature = useEncounterStore((s) => s.updateFeature);
  return {
    duplicate(row: ListRow): string | undefined {
      const copy = duplicateOf(definition, row.ref);
      if (!copy) return undefined;
      const ref = insertAbilityRecord(definition.id, copy.list, copy.record, { after: copy.after });
      return ref && ref.list !== "granted" ? refRowId(ref) : undefined;
    },
    move(row: ListRow, to: MoveTarget): string | undefined {
      const action = findAbility(definition, row.ref) as ActionDefinition | undefined;
      if (!action) return undefined;
      const ref = replaceAbilityRecord(definition.id, row.ref, withActionType(action, MOVE_TYPES[to], undefined).action);
      return ref && "id" in ref ? ref.id : undefined;
    },
    /** An optional rule switched on or off. */
    setOptional(row: ListRow, on: boolean) {
      if ("id" in row.ref) updateFeature(definition.id, row.ref.id, { enabled: on ? true : undefined });
    },
    /** Armor or a shield put on or taken off. */
    setWorn(row: ListRow, on: boolean) {
      if (row.ref.list !== "items") return;
      const id = row.ref.id;
      const item = definition.items?.find((candidate) => candidate.id === id);
      if (item) replaceAbilityRecord(definition.id, row.ref, withWorn(item, on));
    }
  };
}

interface PendingRemoval {
  itemType: DefinitionItemType;
  itemId: string;
  name: string;
}

/**
 * Deleting a row: `request` deletes it at once, or, when a multiattack would lose a step or a legendary action what it
 * uses, opens "Delete Claws?" under the row (`under`). A delete shows `toast`, "Deleted Bite. Undo".
 */
export function useAbilityRemoval(definition: CreatureDefinition, { fieldClassName }: {
  /** The prompt's Replace it with, in the sheet's own field style (the Codex's). */
  fieldClassName?: string;
} = {}) {
  const removeDefinitionItem = useEncounterStore((s) => s.removeDefinitionItem);
  const undo = useEncounterStore((s) => s.undo);
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  // "Deleted Bite. Undo": the undo step the delete made, so Undo only ever undoes that.
  const [toast, setToast] = useState<{ message: string; depth: number } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function remove(itemType: DefinitionItemType, itemId: string, name: string, replacement?: string) {
    removeDefinitionItem(definition.id, itemType, itemId, replacement);
    setToast({ message: `Deleted ${name}.`, depth: useEncounterStore.getState().undoStack.length });
  }

  function undoDelete() {
    // Only the delete it announced: anything done since would be undone instead.
    if (toast && useEncounterStore.getState().undoStack.length === toast.depth) undo();
    setToast(null);
  }

  /** Delete a row's record, but ask first when a multiattack would lose a step, or a legendary action what it uses. */
  function request(row: ListRow) {
    if (!row.itemType) return;
    const itemId = row.ref.list === "legendary" ? String(row.ref.index) : "id" in row.ref ? row.ref.id : undefined;
    if (itemId === undefined) return;
    if (multiattackLosses(definition, row.itemType, itemId).length > 0 || legendaryLosses(definition, row.itemType, itemId).length > 0) {
      setPending({ itemType: row.itemType, itemId, name: row.name });
      return;
    }
    remove(row.itemType, itemId, row.name);
  }

  /** What sits under a row: its delete prompt, while it's asked. */
  function under(row: ListRow): ReactNode {
    const asking = pending !== null && pending.itemType === row.itemType
      && pending.itemId === (row.ref.list === "legendary" ? String(row.ref.index) : rowId(row));
    if (!asking) return null;
    return (
      <RemovalPrompt
        key={`${pending.itemType}:${pending.itemId}`}
        definition={definition}
        pending={pending}
        fieldClassName={fieldClassName}
        onCancel={() => setPending(null)}
        onConfirm={(replacement) => {
          setPending(null);
          remove(pending.itemType, pending.itemId, pending.name, replacement);
        }}
      />
    );
  }

  const toastNode = toast ? (
    <div className={styles.toast} role="status">
      <span>{toast.message}</span>
      <button type="button" onClick={undoDelete}>Undo</button>
    </div>
  ) : null;

  return { request, under, toast: toastNode };
}

/**
 * "Delete Claws?", under a row whose deletion would change a multiattack or leave a legendary action with nothing to
 * use: what each is left with, or, with a replacement picked, what it uses instead ("Multiattack uses Greataxe…").
 */
function RemovalPrompt({ definition, pending, fieldClassName, onCancel, onConfirm }: {
  definition: CreatureDefinition;
  pending: PendingRemoval;
  fieldClassName?: string;
  onCancel: () => void;
  onConfirm: (replacement: string | undefined) => void;
}) {
  const { itemType, itemId, name } = pending;
  const [replacement, setReplacement] = useState("");
  const losses = multiattackLosses(definition, itemType, itemId);
  const legendary = legendaryLosses(definition, itemType, itemId);
  const remaining = losses[0]?.definitionAfter ?? withoutDefinitionItem(definition, itemType, itemId);
  // A legendary action can only be given another ability, not "any attack".
  const choices = stepChoices(remaining).filter((choice) => choice.group !== "ability" && !choice.missing && (losses.length > 0 || choice.value.startsWith("id:")));
  const chosen = choices.find((choice) => choice.value === replacement);
  const replaced = chosen ? withoutDefinitionItem(definition, itemType, itemId, chosen.value) : undefined;
  const deleted = chosen ? [] : losses.filter((loss) => !loss.after);
  const confirmLabel = deleted.length === 0 ? `Delete ${name}`
    : deleted.length === 1 ? `Delete ${name} and ${deleted[0]!.multiattack.name}`
      : `Delete ${name} and ${deleted.length} multiattacks`;
  const routineAfter = (id: string) => replaced?.actions.concat(replaced.bonusActions ?? [], replaced.reactions ?? []).find((action) => action.id === id);
  return (
    <div className={styles.confirm} role="alertdialog" aria-label={`Delete ${name}?`}>
      <strong>Delete {name}?</strong>
      {losses.map((loss) => {
        const swapped = routineAfter(loss.multiattack.id);
        return (
          <p key={loss.multiattack.id}>
            {swapped && replaced
              ? `${loss.multiattack.name} uses ${name}. With ${chosen!.label} instead, ${loss.multiattack.name} will be: ${actionStatblock(swapped, replaced).short}.`
              : loss.after
                ? `${loss.multiattack.name} uses ${name}. Without it, ${loss.multiattack.name} will be: ${actionStatblock(loss.after, loss.definitionAfter).short}.`
                : `${loss.multiattack.name} uses only ${name}, so it will be deleted too.`}
          </p>
        );
      })}
      {legendary.map(({ index, entry }) => (
        <p key={`legendary-${index}`}>
          {chosen?.value.startsWith("id:")
            ? `${entry.name}, a legendary action, uses ${name}. With ${chosen.label} instead, it will use ${chosen.label}.`
            : `${entry.name}, a legendary action, uses ${name}. Without it, ${entry.name} will be reference only.`}
        </p>
      ))}
      {choices.length ? (
        <label className={styles.confirmLabel}>
          Replace it with
          <select className={fieldClassName} aria-label={`Replace ${name} with`} value={chosen ? replacement : ""} onChange={(e) => setReplacement(e.target.value)}>
            <option value="">nothing: {losses.length ? "remove the step" : "make it reference only"}</option>
            {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
        </label>
      ) : null}
      <div className={styles.confirmActions}>
        <button type="button" className={styles.confirmCancel} onClick={onCancel}>Cancel</button>
        <button type="button" className={styles.confirmDelete} onClick={() => onConfirm(chosen?.value)}>{confirmLabel}</button>
      </div>
    </div>
  );
}
