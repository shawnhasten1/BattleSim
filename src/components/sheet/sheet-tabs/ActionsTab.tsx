"use client";

import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { spellcastingAbility, type ActionDefinition, type CombatantState, type CreatureDefinition } from "@/engine";
import type { SrdEntryKind } from "@/data/srd";
import { useEncounterStore } from "@/store/encounter-store";
import { actionStatblock } from "@/lib/statblock";
import { legendaryLosses, multiattackLosses, withoutDefinitionItem, type DefinitionItemType } from "@/lib/definition-edits";
import type { Prepared } from "@/lib/ability-editor/add";
import { blankLegendaryAction } from "@/lib/ability-editor/legendary";
import { abilityList, duplicateOf, type ListRow, type MoveTarget } from "@/lib/ability-editor/list";
import { blankMultiattack, stepChoices } from "@/lib/ability-editor/sequence";
import { withActionType } from "@/lib/ability-editor/spells";
import {
  blankAttack,
  blankDeathEffect,
  blankFeature,
  blankItem,
  blankLairAction,
  blankReaction,
  blankSpecialAction,
  blankSpell,
  blankSummon,
  blankTransform,
  blankWeapon
} from "@/lib/ability-editor/templates";
import { findAbility, refKey, type AbilityRef } from "@/lib/ability-editor/refs";
import { AbilityEditor, type SheetEditorTarget } from "../ability-editor/AbilityEditor";
import { AbilitiesList, refRowId, rowId } from "../abilities/AbilitiesList";
import { AddAbility, type BlankKind } from "../abilities/AddAbility";
import { ResourceList } from "../abilities/ResourceList";
import { SpellcastingHeading } from "../abilities/SpellcastingHeading";
import { ItemOffers } from "../abilities/ItemOffers";
import { UpcastOffers } from "../abilities/UpcastOffers";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AUTOMATION_HELP } from "@/lib/sheet-help";
import type { Compendium } from "@/hooks/useCompendium";
import abilityStyles from "../abilities/abilities.module.css";

interface PendingRemoval {
  itemType: DefinitionItemType;
  itemId: string;
  name: string;
}

const MOVE_TYPES: Record<MoveTarget, ActionDefinition["actionType"]> = { actions: "action", bonus: "bonus", reactions: "reaction" };

/**
 * The Abilities tab: what the creature has, in statblock order (plan §3.1), with every resource it spends above (the
 * actor sheet plan's D5), and Add (§3.2). Every ability opens in the ability editor, in place of the list.
 */
export function ActionsTab({ combatant, definition, compendium, openFirst }: {
  combatant: CombatantState;
  definition: CreatureDefinition;
  compendium?: Compendium;
  /** An ability to open in the editor straight away (one the Token tab's What the AI will use named). */
  openFirst?: AbilityRef;
}) {
  const updateFeature = useEncounterStore((s) => s.updateFeature);
  const removeDefinitionItem = useEncounterStore((s) => s.removeDefinitionItem);
  const insertAbilityRecord = useEncounterStore((s) => s.insertAbilityRecord);
  const replaceAbilityRecord = useEncounterStore((s) => s.replaceAbilityRecord);
  const undo = useEncounterStore((s) => s.undo);
  const attachSrdWeapon = useEncounterStore((s) => s.attachSrdWeapon);
  const attachSrdSpell = useEncounterStore((s) => s.attachSrdSpell);
  const attachSrdFeature = useEncounterStore((s) => s.attachSrdFeature);
  const attachSrdItem = useEncounterStore((s) => s.attachSrdItem);

  const [addOpen, setAddOpen] = useState(false);
  // A delete waiting on "Delete Claws?" because a multiattack or a legendary action uses it, and what they'd use instead.
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [replacement, setReplacement] = useState("");
  // The ability editor, open in place of the list: on `openFirst`, when the creature has it.
  const [abilityEditor, setAbilityEditor] = useState<SheetEditorTarget | null>(() =>
    openFirst && openFirst.list !== "granted" && findAbility(definition, openFirst) ? { mode: "edit", ref: openFirst } : null);
  // The row the editor was on, focused when the list comes back (and highlighted, when it was saved).
  const [returnTo, setReturnTo] = useState<{ id: string; saved: boolean } | null>(null);
  // "Deleted Bite. Undo": the undo step the delete made, so Undo only ever undoes that.
  const [toast, setToast] = useState<{ message: string; depth: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => abilityList(definition, combatant), [definition, combatant]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function openAbilityEditor(target: SheetEditorTarget) {
    setAddOpen(false);
    setAbilityEditor(target);
  }

  /** A row opens in the ability editor. */
  function openRow(row: ListRow) {
    if (row.ref.list === "granted") return;
    openAbilityEditor({ mode: "edit", ref: row.ref });
  }

  function duplicateRow(row: ListRow) {
    const copy = duplicateOf(definition, row.ref);
    if (!copy) return;
    const ref = insertAbilityRecord(definition.id, copy.list, copy.record, { after: copy.after });
    if (ref && ref.list !== "granted") setReturnTo({ id: refRowId(ref), saved: true });
  }

  function moveRow(row: ListRow, to: MoveTarget) {
    const action = findAbility(definition, row.ref) as ActionDefinition | undefined;
    if (!action) return;
    const moved = withActionType(action, MOVE_TYPES[to], undefined).action;
    const ref = replaceAbilityRecord(definition.id, row.ref, moved);
    if (ref && "id" in ref) setReturnTo({ id: ref.id, saved: true });
  }

  /** Delete a record, but ask first when a multiattack would lose a step, or a legendary action what it uses. */
  function requestRemove(itemType: DefinitionItemType, itemId: string, name: string) {
    if (multiattackLosses(definition, itemType, itemId).length > 0 || legendaryLosses(definition, itemType, itemId).length > 0) {
      setPendingRemoval({ itemType, itemId, name });
      setReplacement("");
      return;
    }
    remove(itemType, itemId, name);
  }

  function remove(itemType: DefinitionItemType, itemId: string, name: string, replacementValue?: string) {
    removeDefinitionItem(definition.id, itemType, itemId, replacementValue);
    setToast({ message: `Deleted ${name}.`, depth: useEncounterStore.getState().undoStack.length });
  }

  function undoDelete() {
    // Only the delete it announced: anything done since would be undone instead.
    if (toast && useEncounterStore.getState().undoStack.length === toast.depth) undo();
    setToast(null);
  }

  function attachFromLibrary(kind: SrdEntryKind, id: string) {
    if (kind === "weapon") attachSrdWeapon(definition.id, id);
    else if (kind === "spell") attachSrdSpell(definition.id, id);
    else if (kind === "item") attachSrdItem(definition.id, id);
    else attachSrdFeature(definition.id, id);
  }

  function openPrepared(prepared: Prepared) {
    openAbilityEditor({ mode: "new", list: prepared.list, record: prepared.record, focus: prepared.focus, pools: prepared.pools });
  }

  /** Start from scratch: every kind opens in the ability editor on a blank record. */
  function startBlank(kind: BlankKind) {
    switch (kind) {
      case "weapon": openAbilityEditor({ mode: "new", list: "weapons", record: blankWeapon() }); break;
      case "attack": openAbilityEditor({ mode: "new", list: "actions", record: blankAttack() }); break;
      case "special": openAbilityEditor({ mode: "new", list: "actions", record: blankSpecialAction() }); break;
      case "multiattack": openAbilityEditor({ mode: "new", list: "actions", record: blankMultiattack(definition) }); break;
      case "spell": openAbilityEditor({ mode: "new", list: "spells", record: blankSpell(spellcastingAbility(definition)) }); break;
      case "feature": openAbilityEditor({ mode: "new", list: "features", record: blankFeature() }); break;
      case "item": openAbilityEditor({ mode: "new", list: "items", record: blankItem() }); break;
      case "reaction": openAbilityEditor({ mode: "new", list: "reactions", record: blankReaction() }); break;
      case "legendary": openAbilityEditor({ mode: "new", list: "legendary", record: blankLegendaryAction(definition) }); break;
      case "lair": openAbilityEditor({ mode: "new", list: "lairActions", record: blankLairAction() }); break;
      case "death": openAbilityEditor({ mode: "new", list: "deathEffects", record: blankDeathEffect() }); break;
      case "summon": openAbilityEditor({ mode: "new", list: "actions", record: blankSummon() }); break;
      case "transform": openAbilityEditor({ mode: "new", list: "actions", record: blankTransform() }); break;
    }
  }

  /**
   * "Delete Claws?", under a row whose deletion would change a multiattack or leave a legendary action with nothing to
   * use: what each is left with, or, with a replacement picked, what it uses instead ("Multiattack uses Greataxe…").
   */
  function removalPrompt({ itemType, itemId, name }: PendingRemoval) {
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
      <div className={abilityStyles.confirm} role="alertdialog" aria-label={`Delete ${name}?`}>
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
          <label className={abilityStyles.confirmLabel}>
            Replace it with
            <select aria-label={`Replace ${name} with`} value={chosen ? replacement : ""} onChange={(e) => setReplacement(e.target.value)}>
              <option value="">nothing: {losses.length ? "remove the step" : "make it reference only"}</option>
              {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select>
          </label>
        ) : null}
        <div className={abilityStyles.confirmActions}>
          <button type="button" className={abilityStyles.confirmCancel} onClick={() => setPendingRemoval(null)}>
            Cancel
          </button>
          <button
            type="button" className={abilityStyles.confirmDelete}
            onClick={() => {
              setPendingRemoval(null);
              remove(itemType, itemId, name, chosen?.value);
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (!returnTo || abilityEditor) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(returnTo.id)}"]`);
    node?.scrollIntoView({ block: "nearest" });
    node?.querySelector<HTMLButtonElement>('button[aria-label^="Edit "]')?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setReturnTo(null), 1800);
    return () => window.clearTimeout(timer);
  }, [returnTo, abilityEditor]);

  /** What sits under a row: its delete prompt. */
  function underRow(row: ListRow) {
    const confirming = pendingRemoval !== null && pendingRemoval.itemType === row.itemType
      && pendingRemoval.itemId === (row.ref.list === "legendary" ? String(row.ref.index) : rowId(row));
    return confirming ? removalPrompt(pendingRemoval) : null;
  }

  if (abilityEditor) {
    const editingRef = abilityEditor.mode === "edit" ? abilityEditor.ref : undefined;
    return (
      <AbilityEditor
        key={editingRef ? refKey(editingRef) : `new:${abilityEditor.mode === "new" && typeof abilityEditor.list === "string" ? abilityEditor.list : "granted"}`}
        definition={definition}
        target={abilityEditor}
        onClose={({ savedRef }) => {
          const back = savedRef ?? editingRef;
          setAbilityEditor(null);
          if (back && back.list !== "granted") setReturnTo({ id: refRowId(back), saved: Boolean(savedRef) });
        }}
      />
    );
  }

  return (
    <div ref={listRef}>
      <div className={abilityStyles.top}>
        <div className={abilityStyles.topRow}>
          <button type="button" className={abilityStyles.addBtn} aria-expanded={addOpen} onClick={() => setAddOpen((value) => !value)}>
            <Plus size={14} /> Add ability
          </button>
          <span className={abilityStyles.spacer} />
          <InfoTooltip label="About automation levels" content={AUTOMATION_HELP} />
        </div>
        <ResourceList definition={definition} combatant={combatant} />
        <UpcastOffers definition={definition} />
        <ItemOffers definition={definition} />
      </div>

      {addOpen ? (
        <AddAbility
          definition={definition}
          compendium={compendium}
          onPrepared={openPrepared}
          onAttach={attachFromLibrary}
          onBlank={startBlank}
          onClose={() => setAddOpen(false)}
        />
      ) : null}

      <AbilitiesList
        groups={groups}
        flashId={returnTo?.saved ? returnTo.id : undefined}
        under={underRow}
        heading={(group) => (group.spellcasting ? <SpellcastingHeading definition={definition} facts={group.spellcasting} /> : undefined)}
        handlers={{
          onOpen: openRow,
          onDuplicate: duplicateRow,
          onMove: moveRow,
          onDelete: (row) => {
            if (!row.itemType) return;
            if (row.ref.list === "legendary") requestRemove("legendary", String(row.ref.index), row.name);
            else if ("id" in row.ref) requestRemove(row.itemType, row.ref.id, row.name);
          },
          onToggleOptional: (row, on) => { if ("id" in row.ref) updateFeature(definition.id, row.ref.id, { enabled: on ? true : undefined }); }
        }}
      />

      <div className={abilityStyles.standard}>
        <h4>Standard actions</h4>
        <p style={{ margin: 0, fontSize: 11, color: "var(--ui-text-dim)" }}>
          Every creature can Dash · Disengage · Dodge · Hide · Help — no setup needed.
        </p>
      </div>

      {toast ? (
        <div className={abilityStyles.toast} role="status">
          <span>{toast.message}</span>
          <button type="button" onClick={undoDelete}>Undo</button>
        </div>
      ) : null}
    </div>
  );
}
