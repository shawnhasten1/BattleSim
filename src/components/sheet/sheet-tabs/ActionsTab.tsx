"use client";

import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  spellcastingAbility,
  type ActionDefinition,
  type SummonActionDefinition,
  type TransformActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type DeathEffectDefinition,
  type FeatureDefinition,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
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
import { PoolsStrip } from "../abilities/PoolsStrip";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AUTOMATION_HELP } from "@/lib/sheet-help";
import type { Compendium } from "@/hooks/useCompendium";
import { BuilderForm } from "../builders/BuilderForm";
import { SummonEditor, TransformEditor } from "../builders/SpawnEditors";
import { mergeDraftEdit } from "../builders/save-delta";
import {
  actionFieldSchema,
  actionFromEffectDraft,
  applyDraftChange,
  deathEffectDraftFromDefinition,
  deathEffectFieldSchema,
  deathEffectFromDraft,
  effectDraftFromAction,
  featureBuilderContext,
  featureDraftFromDefinition,
  featureFieldSchema,
  featureFromDraft,
  spellDraftFromDefinition,
  spellFieldSchema,
  spellFromDraft,
  weaponDraftFromDefinition,
  weaponFieldSchema,
  weaponFromDraft,
  type BuilderDraft
} from "../builders/schemas";
import abilityStyles from "../abilities/abilities.module.css";
import styles from "../builders/builders.module.css";

/** What the classic builder form is open on (from the editor's "Open it in the classic editor", until Phase 8). */
type EditTarget =
  | { kind: "weapon"; id: string }
  | { kind: "spell"; id: string }
  | { kind: "deathEffect"; id: string }
  | { kind: "action"; id: string }
  | { kind: "feature"; id: string }
  | { kind: "lairAction"; id: string };

interface PendingRemoval {
  itemType: DefinitionItemType;
  itemId: string;
  name: string;
}

const MODE_KEY = "actions-builder-mode";
const MOVE_TYPES: Record<MoveTarget, ActionDefinition["actionType"]> = { actions: "action", bonus: "bonus", reactions: "reaction" };

function readMode(): "simple" | "advanced" {
  try {
    return localStorage.getItem(MODE_KEY) === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}

/**
 * The Abilities tab: what the creature has, in statblock order (plan §3.1), with its pools above, and Add (§3.2). Every
 * ability opens in the ability editor, in place of the list; the classic builder forms and the old summon and
 * shapechange editors are only reached from the editor's "Open it in the classic editor" (until Phase 8).
 */
export function ActionsTab({ combatant, definition, compendium }: { combatant: CombatantState; definition: CreatureDefinition; compendium?: Compendium }) {
  const updateWeapon = useEncounterStore((s) => s.updateWeapon);
  const updateSpell = useEncounterStore((s) => s.updateSpell);
  const updateAction = useEncounterStore((s) => s.updateAction);
  const updateFeature = useEncounterStore((s) => s.updateFeature);
  const addSpawnAction = useEncounterStore((s) => s.addSpawnAction);
  const definitionStatus = useEncounterStore((s) => s.definitionStatus);
  const sceneDefinitions = useEncounterStore((s) => s.encounter.definitions);
  const updateDeathEffect = useEncounterStore((s) => s.updateDeathEffect);
  const updateLairAction = useEncounterStore((s) => s.updateLairAction);
  const removeDefinitionItem = useEncounterStore((s) => s.removeDefinitionItem);
  const insertAbilityRecord = useEncounterStore((s) => s.insertAbilityRecord);
  const replaceAbilityRecord = useEncounterStore((s) => s.replaceAbilityRecord);
  const undo = useEncounterStore((s) => s.undo);
  const attachSrdWeapon = useEncounterStore((s) => s.attachSrdWeapon);
  const attachSrdSpell = useEncounterStore((s) => s.attachSrdSpell);
  const attachSrdFeature = useEncounterStore((s) => s.attachSrdFeature);

  // The old summon / shapechange editor, open on one from "Open it in the classic editor".
  const [spawnEditing, setSpawnEditing] = useState<SummonActionDefinition | TransformActionDefinition | null>(null);
  const [mode, setMode] = useState<"simple" | "advanced">(readMode);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [draft, setDraft] = useState<BuilderDraft>({});
  // The draft as the builder opened, so a save writes only what changed since (see save-delta.ts).
  const [initialDraft, setInitialDraft] = useState<BuilderDraft>({});
  const [addOpen, setAddOpen] = useState(false);
  // A delete waiting on "Delete Claws?" because a multiattack or a legendary action uses it, and what they'd use instead.
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [replacement, setReplacement] = useState("");
  // The ability editor, open in place of the list.
  const [abilityEditor, setAbilityEditor] = useState<SheetEditorTarget | null>(null);
  // The row the editor was on, focused when the list comes back (and highlighted, when it was saved).
  const [returnTo, setReturnTo] = useState<{ id: string; saved: boolean } | null>(null);
  // "Deleted Bite. Undo": the undo step the delete made, so Undo only ever undoes that.
  const [toast, setToast] = useState<{ message: string; depth: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  function setModePersisted(next: "simple" | "advanced") {
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* private mode */ }
  }

  const weapons = definition.weapons ?? [];
  const spells = definition.spells ?? [];
  const deathEffects = definition.deathEffects ?? [];
  const features = [...(definition.features ?? []), ...(definition.traits ?? [])];
  const nativeActions = definition.actions ?? [];
  const bonusActions = definition.bonusActions ?? [];
  const reactions = definition.reactions ?? [];
  const lairActions = definition.lairActions ?? [];

  const groups = useMemo(() => abilityList(definition, combatant), [definition, combatant]);
  // The feature builder picks a Pounce / Rampage follow-up from these.
  const featureContext = useMemo(() => featureBuilderContext(definition), [definition]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function openEdit(target: EditTarget, opened: BuilderDraft) {
    setDraft(opened);
    setInitialDraft(opened);
    setEdit(target);
    setAddOpen(false);
  }

  function openAbilityEditor(target: SheetEditorTarget) {
    setEdit(null);
    setAddOpen(false);
    setSpawnEditing(null);
    setAbilityEditor(target);
  }

  /** From the new editor to the classic builder, or the old summon / shapechange editor, until Phase 8 retires them. */
  function openClassic(ref: AbilityRef) {
    setAbilityEditor(null);
    const current = useEncounterStore.getState().encounter.definitions.find((candidate) => candidate.id === definition.id) ?? definition;
    const record = findAbility(current, ref);
    if (!record || !("id" in ref)) return;
    if (ref.list === "weapons") openEdit({ kind: "weapon", id: ref.id }, weaponDraftFromDefinition(record as WeaponDefinition));
    else if (ref.list === "spells") openEdit({ kind: "spell", id: ref.id }, spellDraftFromDefinition(record as SpellDefinition));
    else if (ref.list === "features" || ref.list === "traits") openEdit({ kind: "feature", id: ref.id }, featureDraftFromDefinition(record as FeatureDefinition, featureContext));
    else if (ref.list === "deathEffects") openEdit({ kind: "deathEffect", id: ref.id }, deathEffectDraftFromDefinition(record as DeathEffectDefinition));
    else if (ref.list === "lairActions") openEdit({ kind: "lairAction", id: ref.id }, effectDraftFromAction(record as ActionDefinition));
    else {
      const action = record as ActionDefinition;
      if (action.kind === "summon" || action.kind === "transform") {
        setEdit(null);
        setSpawnEditing(action);
      } else {
        openEdit({ kind: "action", id: ref.id }, effectDraftFromAction(action));
      }
    }
    setReturnTo({ id: ref.id, saved: false });
  }

  /** A row opens in the ability editor. */
  function openRow(row: ListRow) {
    if (row.opens === "none" || row.ref.list === "granted") return;
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

  /** The old summon / shapechange editor, under the row of the one it's open on. */
  function spawnEditorNode() {
    if (!spawnEditing) return null;
    const close = () => setSpawnEditing(null);
    const onSave = async (action: SummonActionDefinition | TransformActionDefinition) => {
      if (await addSpawnAction(definition.id, action, spawnEditing.id)) close();
    };
    return (
      <>
        {spawnEditing.kind === "summon"
          ? <SummonEditor ownerId={definition.id} sceneActors={sceneDefinitions} onCancel={close} initial={spawnEditing} onSave={onSave} />
          : <TransformEditor ownerId={definition.id} sceneActors={sceneDefinitions} onCancel={close} initial={spawnEditing} onSave={onSave} />}
        {definitionStatus ? <p role="alert" className={styles.maHint}>{definitionStatus}</p> : null}
      </>
    );
  }

  /**
   * Write an edit back. Only what the DM changed is written, so what the builder can't show survives the save; an
   * edit that changes nothing writes nothing (and adds no undo step).
   */
  function commitEdit<T>(stored: T | undefined, convert: (edited: BuilderDraft) => unknown, write: (record: T) => void) {
    if (!stored) return;
    const result = mergeDraftEdit(stored, initialDraft, draft, convert);
    if (result.changed) write(result.record);
  }

  function save() {
    if (!edit) return;
    if (edit.kind === "weapon") {
      commitEdit(weapons.find((weapon) => weapon.id === edit.id), weaponFromDraft, (record) => updateWeapon(definition.id, edit.id, record));
    } else if (edit.kind === "spell") {
      commitEdit(spells.find((spell) => spell.id === edit.id), spellFromDraft, (record) => updateSpell(definition.id, edit.id, record));
    } else if (edit.kind === "deathEffect") {
      commitEdit(deathEffects.find((effect) => effect.id === edit.id), deathEffectFromDraft, (record) => updateDeathEffect(definition.id, edit.id, record));
    } else if (edit.kind === "action") {
      commitEdit(
        [...nativeActions, ...bonusActions, ...reactions].find((action) => action.id === edit.id),
        (edited) => actionFromEffectDraft(edited),
        (record) => updateAction(definition.id, edit.id, record)
      );
    } else if (edit.kind === "feature") {
      commitEdit(features.find((feature) => feature.id === edit.id), (edited) => featureFromDraft(edited, featureContext), (record) => updateFeature(definition.id, edit.id, record));
    } else if (edit.kind === "lairAction") {
      commitEdit(lairActions.find((action) => action.id === edit.id), (edited) => actionFromEffectDraft(edited), (record) => updateLairAction(definition.id, edit.id, record));
    }
    setEdit(null);
  }

  function attachFromLibrary(kind: SrdEntryKind, id: string) {
    if (kind === "weapon") attachSrdWeapon(definition.id, id);
    else if (kind === "spell") attachSrdSpell(definition.id, id);
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
      case "reaction": openAbilityEditor({ mode: "new", list: "reactions", record: blankReaction() }); break;
      case "legendary": openAbilityEditor({ mode: "new", list: "legendary", record: blankLegendaryAction(definition) }); break;
      case "lair": openAbilityEditor({ mode: "new", list: "lairActions", record: blankLairAction() }); break;
      case "death": openAbilityEditor({ mode: "new", list: "deathEffects", record: blankDeathEffect() }); break;
      case "summon": openAbilityEditor({ mode: "new", list: "actions", record: blankSummon() }); break;
      case "transform": openAbilityEditor({ mode: "new", list: "actions", record: blankTransform() }); break;
    }
  }

  function builderFor(target: EditTarget) {
    const kind = target.kind;
    const specs = kind === "weapon"
      ? weaponFieldSchema(draft)
      : kind === "spell"
        ? spellFieldSchema(draft)
        : kind === "deathEffect"
          ? deathEffectFieldSchema(draft)
          : kind === "feature"
            ? featureFieldSchema(draft, featureContext)
            : actionFieldSchema(draft);
    return (
      <div className={styles.builder}>
        <div className={styles.headerRight} style={{ justifyContent: "flex-end", marginBottom: 6 }}>
          <InfoTooltip label="About automation levels" content={AUTOMATION_HELP} />
          <div className={styles.modeToggle}>
            <button type="button" className={mode === "simple" ? styles.on : ""} onClick={() => setModePersisted("simple")}>Simple</button>
            <button type="button" className={mode === "advanced" ? styles.on : ""} onClick={() => setModePersisted("advanced")}>Advanced</button>
          </div>
        </div>
        <BuilderForm specs={specs} draft={draft} mode={mode} onChange={(key, value) => setDraft((d) => applyDraftChange(d, key, value))} />
        <div className={styles.builderActions}>
          <button type="button" className={styles.builderCancel} onClick={() => setEdit(null)}>
            Cancel
          </button>
          <button type="button" className={styles.builderSave} onClick={save}>
            Save changes
          </button>
        </div>
      </div>
    );
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
      <div className={styles.confirmRemove} role="alertdialog" aria-label={`Delete ${name}?`}>
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
          <label className={styles.fieldInlineLabel}>
            Replace it with
            <select aria-label={`Replace ${name} with`} value={chosen ? replacement : ""} onChange={(e) => setReplacement(e.target.value)}>
              <option value="">nothing: {losses.length ? "remove the step" : "make it reference only"}</option>
              {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select>
          </label>
        ) : null}
        <div className={styles.builderActions}>
          <button type="button" className={styles.builderCancel} onClick={() => setPendingRemoval(null)}>
            Cancel
          </button>
          <button
            type="button" className={styles.confirmDelete}
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

  /** What sits under a row: its delete prompt, its classic builder form, its old summon or shapechange editor. */
  function underRow(row: ListRow) {
    const id = rowId(row);
    const confirming = pendingRemoval !== null && pendingRemoval.itemType === row.itemType && pendingRemoval.itemId === (row.ref.list === "legendary" ? String(row.ref.index) : id);
    const editing = edit !== null && edit.id === id;
    return (
      <>
        {confirming ? removalPrompt(pendingRemoval) : null}
        {editing ? builderFor(edit) : null}
        {spawnEditing?.id === id ? spawnEditorNode() : null}
      </>
    );
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
        // A legendary action has nothing in the classic editor to open it in.
        onOpenClassic={editingRef && editingRef.list !== "legendary" ? () => openClassic(editingRef) : undefined}
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
        <PoolsStrip definition={definition} combatant={combatant} />
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

      <div className={styles.group}>
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
