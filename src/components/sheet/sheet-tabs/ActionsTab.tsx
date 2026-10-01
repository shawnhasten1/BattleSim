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
import { multiattackLosses, withoutDefinitionItem, type DefinitionItemType } from "@/lib/definition-edits";
import type { Prepared } from "@/lib/ability-editor/add";
import { abilityList, duplicateOf, type ListRow, type MoveTarget } from "@/lib/ability-editor/list";
import { blankMultiattack, stepChoices } from "@/lib/ability-editor/sequence";
import { withActionType } from "@/lib/ability-editor/spells";
import { blankAttack, blankFeature, blankReaction, blankSpecialAction, blankSpell, blankWeapon } from "@/lib/ability-editor/templates";
import { findAbility, type AbilityRef } from "@/lib/ability-editor/refs";
import { AbilityEditor, type SheetEditorTarget } from "../ability-editor/AbilityEditor";
import { AbilitiesList, rowId } from "../abilities/AbilitiesList";
import { AddAbility, type BlankKind, type BuilderRecipe } from "../abilities/AddAbility";
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
  PRESETS,
  spellDraftFromDefinition,
  spellFieldSchema,
  spellFromDraft,
  weaponDraftFromDefinition,
  weaponFieldSchema,
  weaponFromDraft,
  type BuilderDraft,
  type BuilderKind
} from "../builders/schemas";
import abilityStyles from "../abilities/abilities.module.css";
import styles from "../builders/builders.module.css";

type EditTarget =
  | { kind: "weapon"; id: string }
  | { kind: "spell"; id: string }
  | { kind: "deathEffect"; id: string }
  | { kind: "action"; id: string }
  | { kind: "feature"; id: string }
  | { kind: "lairAction"; id: string }
  | { kind: "new"; builderKind: BuilderKind | "lairAction" };

interface PendingRemoval {
  itemType: DefinitionItemType;
  itemId: string;
  name: string;
}

/** The starting point for a new lair action: an eruption somewhere it can see. */
const NEW_LAIR_ACTION: ActionDefinition = {
  kind: "area-save", id: "", name: "Lair action", actionType: "action", saveAbility: "dex", dc: 15, range: 120,
  area: { type: "circle", size: 10 }, targeting: { origin: "point", range: 120 }, damage: [{ dice: "3d6", damageType: "fire" }],
  halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile", automationSupport: "full"
};

/** A blank death effect: a burst of poison when it drops. */
const NEW_DEATH_EFFECT: DeathEffectDefinition = {
  id: "", name: "New Death Effect", automationSupport: "full",
  action: {
    kind: "area-save", id: "", name: "New Death Effect", actionType: "action", saveAbility: "con", dc: 10, range: 0, area: { type: "circle", size: 10 },
    targeting: { origin: "self", range: 0 }, damage: [{ dice: "2d6", damageType: "poison" }], halfDamageOnSuccess: false, onSuccess: "negates",
    affects: "all", automationSupport: "full"
  }
};

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
 * The Abilities tab: what the creature has, in statblock order (plan §3.1), with its pools above, and Add (§3.2). The
 * ability editor opens in place of the list; death effects, lair actions and a spellcasting focus still use the builder
 * form, and summons and shapechanges their own editors (Phase 7).
 */
export function ActionsTab({ combatant, definition, compendium }: { combatant: CombatantState; definition: CreatureDefinition; compendium?: Compendium }) {
  const addWeaponV2 = useEncounterStore((s) => s.addWeaponV2);
  const addSpellV2 = useEncounterStore((s) => s.addSpellV2);
  const addActionV2 = useEncounterStore((s) => s.addActionV2);
  const addFeatureV2 = useEncounterStore((s) => s.addFeatureV2);
  const addDeathEffectV2 = useEncounterStore((s) => s.addDeathEffectV2);
  const updateWeapon = useEncounterStore((s) => s.updateWeapon);
  const updateSpell = useEncounterStore((s) => s.updateSpell);
  const updateAction = useEncounterStore((s) => s.updateAction);
  const updateFeature = useEncounterStore((s) => s.updateFeature);
  const addSpawnAction = useEncounterStore((s) => s.addSpawnAction);
  const definitionStatus = useEncounterStore((s) => s.definitionStatus);
  const sceneDefinitions = useEncounterStore((s) => s.encounter.definitions);
  const updateDeathEffect = useEncounterStore((s) => s.updateDeathEffect);
  const addLairAction = useEncounterStore((s) => s.addLairAction);
  const updateLairAction = useEncounterStore((s) => s.updateLairAction);
  const removeDefinitionItem = useEncounterStore((s) => s.removeDefinitionItem);
  const insertAbilityRecord = useEncounterStore((s) => s.insertAbilityRecord);
  const replaceAbilityRecord = useEncounterStore((s) => s.replaceAbilityRecord);
  const undo = useEncounterStore((s) => s.undo);
  const attachSrdWeapon = useEncounterStore((s) => s.attachSrdWeapon);
  const attachSrdSpell = useEncounterStore((s) => s.attachSrdSpell);
  const attachSrdFeature = useEncounterStore((s) => s.attachSrdFeature);

  const [spawnEditor, setSpawnEditor] = useState<"summon" | "transform" | null>(null);
  // The existing summon / shapechange being edited, or none when adding a new one.
  const [spawnEditing, setSpawnEditing] = useState<SummonActionDefinition | TransformActionDefinition | null>(null);
  const [mode, setMode] = useState<"simple" | "advanced">(readMode);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [draft, setDraft] = useState<BuilderDraft>({});
  // The draft as the builder opened, so a save writes only what changed since (see save-delta.ts).
  const [initialDraft, setInitialDraft] = useState<BuilderDraft>({});
  const [addOpen, setAddOpen] = useState(false);
  // A delete waiting on "Delete Claws?" because a multiattack would change with it, and what its steps would use instead.
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
  // Recipes the builder form still handles (a death burst), until the editor does.
  const builderRecipes: BuilderRecipe[] = PRESETS.filter((preset) => preset.kind === "deathEffect").map((preset) => ({
    label: preset.label, hint: "Fires once, when it drops to 0 HP", open: () => startNew(preset.kind, { ...preset.draft })
  }));

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
    setSpawnEditor(null);
    setSpawnEditing(null);
    setAbilityEditor(target);
  }

  /** From the new editor to the old builder, for what the editor doesn't cover yet. */
  function openClassic(ref: AbilityRef) {
    setAbilityEditor(null);
    const record = findAbility(useEncounterStore.getState().encounter.definitions.find((candidate) => candidate.id === definition.id) ?? definition, ref);
    if (!record) return;
    if (ref.list === "weapons") openEdit({ kind: "weapon", id: (record as WeaponDefinition).id }, weaponDraftFromDefinition(record as WeaponDefinition));
    else if (ref.list === "spells") openEdit({ kind: "spell", id: (record as SpellDefinition).id }, spellDraftFromDefinition(record as SpellDefinition));
    else if (ref.list === "features" || ref.list === "traits") openEdit({ kind: "feature", id: (record as FeatureDefinition).id }, featureDraftFromDefinition(record as FeatureDefinition, featureContext));
    else openEdit({ kind: "action", id: (record as ActionDefinition).id }, effectDraftFromAction(record as ActionDefinition));
  }

  /** A row: the editor, the builder form, or a summon / shapechange editor, by what it is. */
  function openRow(row: ListRow) {
    if (row.opens === "none" || !("id" in row.ref)) return;
    const record = findAbility(definition, row.ref);
    if (!record) return;
    if (row.opens === "editor") {
      openAbilityEditor({ mode: "edit", ref: row.ref });
      return;
    }
    if (row.opens === "spawn") {
      const action = record as SummonActionDefinition | TransformActionDefinition;
      setEdit(null);
      setAddOpen(false);
      setSpawnEditing(action);
      setSpawnEditor(action.kind);
      return;
    }
    switch (row.ref.list) {
      case "weapons": openEdit({ kind: "weapon", id: row.ref.id }, weaponDraftFromDefinition(record as WeaponDefinition)); break;
      case "spells": openEdit({ kind: "spell", id: row.ref.id }, spellDraftFromDefinition(record as SpellDefinition)); break;
      case "deathEffects": openEdit({ kind: "deathEffect", id: row.ref.id }, deathEffectDraftFromDefinition(record as DeathEffectDefinition)); break;
      case "lairActions": openEdit({ kind: "lairAction", id: row.ref.id }, effectDraftFromAction(record as ActionDefinition)); break;
      default: openEdit({ kind: "action", id: row.ref.id }, effectDraftFromAction(record as ActionDefinition));
    }
  }

  function duplicateRow(row: ListRow) {
    const copy = duplicateOf(definition, row.ref);
    if (!copy) return;
    const ref = insertAbilityRecord(definition.id, copy.list, copy.record, { after: copy.after });
    if (ref && "id" in ref) setReturnTo({ id: ref.id, saved: true });
  }

  function moveRow(row: ListRow, to: MoveTarget) {
    const action = findAbility(definition, row.ref) as ActionDefinition | undefined;
    if (!action) return;
    const moved = withActionType(action, MOVE_TYPES[to], undefined).action;
    const ref = replaceAbilityRecord(definition.id, row.ref, moved);
    if (ref && "id" in ref) setReturnTo({ id: ref.id, saved: true });
  }

  /** Delete a record, but ask first when a multiattack would lose a step (or be deleted) along with it. */
  function requestRemove(itemType: DefinitionItemType, itemId: string, name: string) {
    if (multiattackLosses(definition, itemType, itemId).length > 0) {
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

  /** The summon / shapechange editor: under Add for a new one, or under the row of the one being edited. */
  function spawnEditorNode() {
    return (
      <>
        {spawnEditor === "summon" ? (
          <SummonEditor
            ownerId={definition.id} sceneActors={sceneDefinitions} onCancel={() => { setSpawnEditor(null); setSpawnEditing(null); }}
            initial={spawnEditing?.kind === "summon" ? spawnEditing : undefined}
            onSave={async (action) => { if (await addSpawnAction(definition.id, action, spawnEditing?.id)) { setSpawnEditor(null); setSpawnEditing(null); } }}
          />
        ) : null}
        {spawnEditor === "transform" ? (
          <TransformEditor
            ownerId={definition.id} sceneActors={sceneDefinitions} onCancel={() => { setSpawnEditor(null); setSpawnEditing(null); }}
            initial={spawnEditing?.kind === "transform" ? spawnEditing : undefined}
            onSave={async (action) => { if (await addSpawnAction(definition.id, action, spawnEditing?.id)) { setSpawnEditor(null); setSpawnEditing(null); } }}
          />
        ) : null}
        {spawnEditor && definitionStatus ? <p role="alert" className={styles.maHint}>{definitionStatus}</p> : null}
      </>
    );
  }

  function startNew(builderKind: BuilderKind | "lairAction", initial: BuilderDraft) {
    openEdit({ kind: "new", builderKind }, initial);
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
    } else if (edit.kind === "new") {
      if (edit.builderKind === "weapon") addWeaponV2(definition.id, weaponFromDraft(draft));
      else if (edit.builderKind === "spell") addSpellV2(definition.id, spellFromDraft(draft));
      else if (edit.builderKind === "deathEffect") addDeathEffectV2(definition.id, deathEffectFromDraft(draft));
      else if (edit.builderKind === "feature") addFeatureV2(definition.id, featureFromDraft(draft, featureContext));
      else if (edit.builderKind === "lairAction") addLairAction(definition.id, actionFromEffectDraft(draft));
      else addActionV2(definition.id, actionFromEffectDraft(draft));
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

  function startBlank(kind: BlankKind) {
    switch (kind) {
      case "weapon": openAbilityEditor({ mode: "new", list: "weapons", record: blankWeapon() }); break;
      case "attack": openAbilityEditor({ mode: "new", list: "actions", record: blankAttack() }); break;
      case "special": openAbilityEditor({ mode: "new", list: "actions", record: blankSpecialAction() }); break;
      case "multiattack": openAbilityEditor({ mode: "new", list: "actions", record: blankMultiattack(definition) }); break;
      case "spell": openAbilityEditor({ mode: "new", list: "spells", record: blankSpell(spellcastingAbility(definition)) }); break;
      case "feature": openAbilityEditor({ mode: "new", list: "features", record: blankFeature() }); break;
      case "reaction": openAbilityEditor({ mode: "new", list: "reactions", record: blankReaction() }); break;
      case "lair": startNew("lairAction", effectDraftFromAction(NEW_LAIR_ACTION)); break;
      case "death": startNew("deathEffect", deathEffectDraftFromDefinition(NEW_DEATH_EFFECT)); break;
      case "summon":
      case "transform":
        setEdit(null);
        setAddOpen(false);
        setSpawnEditing(null);
        setSpawnEditor(kind);
        break;
    }
  }

  function builderFor(target: EditTarget) {
    const kind = target.kind === "new" ? target.builderKind : target.kind;
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
            {target.kind === "new" ? "Add to sheet" : "Save changes"}
          </button>
        </div>
      </div>
    );
  }

  /**
   * "Delete Claws?", under a row whose deletion would change a multiattack: what each routine is left with, or, with
   * a replacement picked, what it uses instead ("Multiattack uses Greataxe. Replace it with…").
   */
  function removalPrompt({ itemType, itemId, name }: PendingRemoval) {
    const losses = multiattackLosses(definition, itemType, itemId);
    const remaining = losses[0]?.definitionAfter ?? definition;
    const choices = stepChoices(remaining).filter((choice) => choice.group !== "ability" && !choice.missing);
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
        {choices.length ? (
          <label className={styles.fieldInlineLabel}>
            Replace it with
            <select aria-label={`Replace ${name} with`} value={chosen ? replacement : ""} onChange={(e) => setReplacement(e.target.value)}>
              <option value="">nothing: remove the step</option>
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

  /** What sits under a row: its delete prompt, its builder form, its summon or shapechange editor. */
  function underRow(row: ListRow) {
    const id = rowId(row);
    const confirming = pendingRemoval !== null && pendingRemoval.itemType === row.itemType && pendingRemoval.itemId === id;
    const editing = edit !== null && edit.kind !== "new" && edit.id === id;
    return (
      <>
        {confirming ? removalPrompt(pendingRemoval) : null}
        {editing ? builderFor(edit) : null}
        {spawnEditor && spawnEditing?.id === id ? spawnEditorNode() : null}
      </>
    );
  }

  if (abilityEditor) {
    return (
      <AbilityEditor
        key={abilityEditor.mode === "edit" ? `${abilityEditor.ref.list}:${"id" in abilityEditor.ref ? abilityEditor.ref.id : ""}` : `new:${abilityEditor.list}`}
        definition={definition}
        target={abilityEditor}
        onClose={({ savedRef }) => {
          const back = savedRef ?? (abilityEditor.mode === "edit" ? abilityEditor.ref : undefined);
          setAbilityEditor(null);
          if (back && "id" in back) setReturnTo({ id: back.id, saved: Boolean(savedRef) });
        }}
        onOpenClassic={abilityEditor.mode === "edit" ? () => openClassic(abilityEditor.ref) : undefined}
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
          builderRecipes={builderRecipes}
          onPrepared={openPrepared}
          onAttach={attachFromLibrary}
          onBlank={startBlank}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
      {spawnEditor && !spawnEditing ? spawnEditorNode() : null}
      {edit?.kind === "new" ? builderFor(edit) : null}

      <AbilitiesList
        groups={groups}
        flashId={returnTo?.saved ? returnTo.id : undefined}
        under={underRow}
        handlers={{
          onOpen: openRow,
          onDuplicate: duplicateRow,
          onMove: moveRow,
          onDelete: (row) => { if (row.itemType && "id" in row.ref) requestRemove(row.itemType, row.ref.id, row.name); },
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
