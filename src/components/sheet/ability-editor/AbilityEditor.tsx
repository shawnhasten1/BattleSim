"use client";

import { AlertTriangle, ChevronLeft } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  spellcastingAbility,
  type ActionDefinition,
  type ActionRider,
  type CreatureDefinition,
  type FeatureDefinition,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { convertAction, type ConvertibleKind, type ParkedRecords } from "@/lib/ability-editor/conversions";
import { withGrantedAt, type Activation } from "@/lib/ability-editor/features";
import { featurePoolsToSeed } from "@/lib/ability-editor/records";
import { findAbility, withAbility, withNewAbility, type AbilityList, type AbilityRecord, type AbilityRef, type GrantingList } from "@/lib/ability-editor/refs";
import { sectionsFor, type SectionId } from "@/lib/ability-editor/sections";
import { withSpellAction } from "@/lib/ability-editor/spells";
import { abilityWarnings } from "@/lib/ability-editor/validate";
import { deepEqual } from "@/lib/deep-equal";
import { statblockFor, type StatblockEntry } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";
import { useEditorGuard } from "../SheetGuard";
import { UnsavedPrompt } from "../UnsavedPrompt";
import { useParkedReaction, weaponSection } from "./AbilitySections";
import { actionSection } from "./ActionSections";
import { EditorSection } from "./EditorSection";
import { featureSection } from "./FeatureSections";
import type { NewPools } from "./LimitPicker";
import { spellSection } from "./SpellSections";
import styles from "./ability-editor.module.css";

/**
 * What the editor opens on: an ability already on the creature, a new one headed for a list, or (nested) an ability a
 * feature or item grants, edited inside its parent's editor and handed back to it on Done.
 */
export type AbilityEditorTarget =
  | { mode: "edit"; ref: AbilityRef }
  | {
    mode: "new";
    list: AbilityList;
    record: AbilityRecord;
    /** A recipe's sections to fill in: they open, highlighted, and the rest stay closed. */
    focus?: SectionId[];
    /** Pools it spends that the creature may lack (a copied monster ability's), offered as new pools. */
    pools?: Record<string, number>;
  }
  | {
    mode: "nested";
    /** Where it sits in its parent's granted abilities, on the creature as the parent's editor has it. */
    ref: Extract<AbilityRef, { list: "granted" }>;
    record: ActionDefinition;
    /** Not on the parent yet: Done adds it. */
    isNew: boolean;
    parentName: string;
    onDone: (record: ActionDefinition) => void;
    /** Each change, so the parent counts it as unsaved and a save from outside (switching tab) keeps it. */
    onWorking: (record: ActionDefinition) => void;
  };

/** What the sheet opens the editor on (a nested editor is only ever opened by another editor). */
export type SheetEditorTarget = Exclude<AbilityEditorTarget, { mode: "nested" }>;

export interface AbilityEditorResult {
  /** Where the ability is now, when it was saved. */
  savedRef?: AbilityRef;
}

type RecordType = "weapon" | "spell" | "action" | "feature";

/** The sections the editor has fields for, per kind of record (each shows only when it applies). */
const SECTIONS: Record<RecordType, SectionId[]> = {
  weapon: ["basics", "use", "target", "roll", "damage", "effects", "while-active", "grants", "notes"],
  spell: ["basics", "use", "target", "roll", "outcome", "damage", "effects", "while-active", "lingering", "notes"],
  action: ["sequence", "use", "target", "roll", "outcome", "damage", "effects", "while-active", "lingering", "notes"],
  feature: ["basics", "use", "while-active", "aura", "grants", "notes"]
};

/** What the ability is after switching to a kind. */
const NOW: Record<ConvertibleKind, string> = {
  attack: "It's an attack roll now.", save: "It's a saving throw now.", "area-save": "It's an area saving throw now.",
  healing: "It heals now.", buff: "It grants a benefit now.", reposition: "It teleports now.", unsupported: "It's reference only now."
};

/** What a switch did, said once under "How it works". A save becoming an area (or back) needs no note. */
function conversionNote(from: ActionDefinition["kind"], to: ConvertibleKind, fresh: boolean): string {
  if (fresh || from === "unsupported") return `${NOW[to]} The simulator uses it: check each section below.`;
  if ((from === "save" && to === "area-save") || (from === "area-save" && to === "save")) return "";
  const gates = from === "attack" && (to === "save" || to === "area-save") ? " Its on-hit effects happen on a failed save now."
    : (from === "save" || from === "area-save") && to === "attack" ? " Its failed-save effects happen on a hit now." : "";
  return `${NOW[to]}${gates} Anything that didn't fit is kept: switch back to get it as it was.`;
}

/** The effects (riders) a record carries: a weapon's on-hit effects, or its action's. */
function ridersOf(record: AbilityRecord, type: RecordType): ActionRider[] {
  if (type === "weapon") return (record as WeaponDefinition).onHit ?? [];
  const action = type === "spell" ? (record as SpellDefinition).action : type === "action" ? (record as ActionDefinition) : undefined;
  return (action && "riders" in action ? action.riders : undefined) ?? [];
}

/** Every pool id a record mentions, anywhere inside it: costs, its effects' pools, what it grants. */
function poolIdsIn(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) poolIdsIn(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "resourceId" && typeof item === "string") into.add(item);
      else poolIdsIn(item, into);
    }
  }
  return into;
}

/** Which new pools a record actually spends (a pool created and then not picked isn't added). */
function poolsUsedBy(record: AbilityRecord, pools: Record<string, number>): Record<string, number> {
  const spent = poolIdsIn(record);
  return Object.fromEntries(Object.entries(pools).filter(([id]) => spent.has(id)));
}

/** An effect anywhere in the record that spends or fills a pool, with none chosen yet. */
function poollessEffect(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(poollessEffect);
  if (!value || typeof value !== "object") return false;
  const record = value as { kind?: unknown; resourceId?: unknown };
  if ((record.kind === "resource-regain" || record.kind === "auto-succeed-save" || record.kind === "survive-lethal") && record.resourceId === "") return true;
  return Object.values(value).some(poollessEffect);
}

/** Something that stops a save: the DM has to fix it first. */
function blockingProblem(record: AbilityRecord, type: RecordType): { message: string; section?: SectionId } | null {
  if (!(record as { name?: string }).name?.trim()) return { message: "Give it a name first." };
  if (ridersOf(record, type).some((rider) => rider.kind !== "note" && rider.resourceCost && !rider.resourceCost.resourceId)) {
    return { message: "Choose which pool an effect's charges come from.", section: "effects" };
  }
  if (poollessEffect((record as { effects?: unknown }).effects) || poollessEffect((record as { grantedActions?: unknown }).grantedActions)
    || poollessEffect((record as { action?: unknown }).action) || ("kind" in record && poollessEffect(record))) {
    return { message: "Choose which pool an effect uses.", section: "while-active" };
  }
  return null;
}

function SupportBadge({ entry }: { entry: StatblockEntry }) {
  const partial = entry.support === "simulated" && entry.notSimulated.length > 0;
  const tone = entry.support === "reference" || entry.support === "no-effect" ? styles.reference : partial ? styles.partial : styles.simulated;
  const label = entry.support === "reference" ? "Reference only" : entry.support === "no-effect" ? "No combat effect" : partial ? "Partly simulated" : "Simulated";
  return (
    <span className={`${styles.support} ${tone}`}>
      <span className={styles.supportDot} aria-hidden />
      {label}
    </span>
  );
}

type Granting = { grantedActions?: ActionDefinition[] };

export function AbilityEditor({ definition, target, onClose, onOpenClassic, pools: sharedPools }: {
  definition: CreatureDefinition;
  target: AbilityEditorTarget;
  onClose: (result: AbilityEditorResult) => void;
  /** Hands the ability to the old builder, for what this editor doesn't cover yet. */
  onOpenClassic?: () => void;
  /** A nested editor's pools are its parent's: a pool made for a granted ability is saved with the parent. */
  pools?: NewPools;
}) {
  const replaceAbilityRecord = useEncounterStore((s) => s.replaceAbilityRecord);
  const insertAbilityRecord = useEncounterStore((s) => s.insertAbilityRecord);
  const nestedTarget = target.mode === "nested" ? target : undefined;
  const isNew = target.mode === "new" || Boolean(nestedTarget?.isNew);
  const [opened] = useState<AbilityRecord>(() => structuredClone(
    target.mode === "edit" ? findAbility(definition, target.ref)! : target.record
  ));
  const [working, setWorking] = useState<AbilityRecord>(() => structuredClone(opened));
  const [ownPools, setOwnPools] = useState<Record<string, number>>(() => (target.mode === "new" ? { ...(target.pools ?? {}) } : {}));
  const [error, setError] = useState<string | null>(null);
  // "Save your changes?": what Discard does, and what follows a successful save (saving itself closes the editor).
  const [leaving, setLeaving] = useState<{ message: string; discard: () => void; afterSave?: () => void; saveLabel?: string; discardLabel?: string } | null>(null);
  // Earlier versions of the action, one per kind it has been this session, and what the last switch did.
  const [parked, setParked] = useState<ParkedRecords>({});
  const [note, setNote] = useState<string | undefined>(undefined);
  // A granted ability open in this editor, nested (index null: a new one), and its edits so far.
  const [nested, setNested] = useState<{ index: number | null; record: ActionDefinition } | null>(null);
  const [nestedWorking, setNestedWorking] = useState<ActionDefinition | null>(null);
  const list: AbilityList = target.mode === "new" ? target.list : target.mode === "edit" ? (target.ref.list === "legendary" || target.ref.list === "granted" ? "actions" : target.ref.list) : "actions";
  const type: RecordType = list === "weapons" ? "weapon" : list === "spells" ? "spell" : list === "features" || list === "traits" ? "feature" : "action";
  const available = SECTIONS[type];
  // A new record opens every section (a recipe only the ones to fill in); a multiattack opens on its routine.
  const focus = target.mode === "new" ? target.focus ?? [] : [];
  const [open, setOpen] = useState<Set<SectionId>>(() => new Set(focus.length ? focus
    : isNew ? available : type === "action" && (opened as ActionDefinition).kind === "multiattack" ? ["sequence"] : []));
  const parkedReaction = useParkedReaction();
  const parkedActivation = useRef<Activation | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();

  const ownNewPools: NewPools = useMemo(() => ({ pools: ownPools, add: (id, size) => setOwnPools((current) => ({ ...current, [id]: size })) }), [ownPools]);
  // Pools a save adds on its own (Rage's 3, Legendary Resistance's 3) are offered as the creature's while editing.
  const seeds = useMemo(() => {
    const all = type === "feature" ? featurePoolsToSeed(working as FeatureDefinition) ?? {} : {};
    return Object.fromEntries(Object.entries(all).filter(([id]) => definition.resources?.[id] === undefined));
  }, [type, working, definition]);
  const given = sharedPools ?? ownNewPools;
  const newPools: NewPools = useMemo(() => ({ pools: { ...seeds, ...given.pools }, add: given.add }), [seeds, given]);
  const pools = newPools.pools;
  const name = (working as { name?: string }).name ?? "";
  // What a save writes: the record, with a granted ability still open in it as it stands.
  const merged = nested && nestedWorking ? (withGrantedAt(working as Granting, nested.index, nestedWorking) as AbilityRecord) : working;
  const nestedChanged = Boolean(nested) && (nested!.index === null || !deepEqual(nestedWorking, nested!.record));
  const dirty = !deepEqual(working, opened) || nestedChanged;

  // New pools count as the creature's while editing, so the preview and warnings see them.
  const withPools = useMemo(
    () => (Object.keys(pools).length ? { ...definition, resources: { ...(definition.resources ?? {}), ...pools } } : definition),
    [definition, pools]
  );
  const where: AbilityRef | AbilityList = target.mode === "new" ? target.list : target.ref;
  const placeRecord = (record: AbilityRecord) => (target.mode === "new" ? withNewAbility(withPools, target.list, record) : withAbility(withPools, target.ref, record));
  const placed = useMemo(() => placeRecord(working), [target, withPools, working]); // eslint-disable-line react-hooks/exhaustive-deps
  const entry = statblockFor(placed.definition, placed.ref);
  const warnings = useMemo(() => abilityWarnings(withPools, where, working), [withPools, where, working]);
  const sectionList = (record: AbilityRecord) => sectionsFor({ ref: placed.ref, record, definition: placed.definition }).filter((section) => available.includes(section.id));
  const sections = sectionList(working);
  const flagged = new Set(warnings.map((warning) => warning.section).filter(Boolean));

  function update(next: AbilityRecord) {
    setWorking(next);
    setError(null);
  }

  // A nested editor tells its parent about each change.
  useEffect(() => {
    nestedTarget?.onWorking(working as ActionDefinition);
    // Only when the record changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working]);

  /**
   * Switch what kind of ability it is. A spell with nothing to cast yet gets an action of that kind, spending what the
   * spell does. Sections the new kind brings (Healing, Lingering area) open so it's clear what to fill in.
   */
  function convert(to: ConvertibleKind, then?: (converted: ActionDefinition) => ActionDefinition) {
    const spell = type === "spell" ? (working as SpellDefinition) : undefined;
    const current: ActionDefinition = spell
      ? spell.action ?? { kind: "unsupported", id: "", name: spell.name, actionType: spell.castingTime, automationSupport: "unsupported" }
      : (working as ActionDefinition);
    // "Saving throw" brings back an earlier area when an area is what it was.
    const kind = to === "save" && parked["area-save"] && !parked.save && current.kind !== "area-save" ? "area-save" : to;
    const options = spell ? { spell: true, spellcasting: spellcastingAbility(withPools) } : {};
    const result = convertAction(current, kind, parked, options);
    let action = then ? then(result.action) : result.action;
    let next: AbilityRecord = action;
    if (spell) {
      if (!spell.action && spell.resourceCost && "resourceCost" in action && !action.resourceCost) action = { ...action, resourceCost: spell.resourceCost } as ActionDefinition;
      const cast = withSpellAction(spell, action);
      next = !spell.action || current.kind === "unsupported" ? { ...cast, automationSupport: "full" } : cast;
    }
    setParked(result.parked);
    setNote(conversionNote(current.kind, kind, Boolean(spell && !spell.action)));
    const before = new Set(sections.map((section) => section.id));
    const added = sectionList(next).map((section) => section.id).filter((id) => !before.has(id));
    if (added.length) setOpen((currentOpen) => new Set([...currentOpen, ...added]));
    update(next);
  }

  function close(result: AbilityEditorResult = {}) {
    setLeaving(null);
    onClose(result);
  }

  function save(): boolean {
    if (nested && nestedWorking) {
      const nestedProblem = blockingProblem(nestedWorking, "action");
      if (nestedProblem) {
        setError(`${nestedWorking.name || "The ability it grants"}: ${nestedProblem.message}`);
        return false;
      }
    }
    const record = merged;
    const problem = blockingProblem(record, type);
    if (problem) {
      setError(problem.message);
      if (problem.section) setOpen((current) => new Set([...current, problem.section!]));
      else nameRef.current?.focus();
      return false;
    }
    if (nestedTarget) {
      if (dirty || isNew) nestedTarget.onDone(record as ActionDefinition);
      close();
      return true;
    }
    if (!isNew && !dirty) {
      close();
      return true;
    }
    const used = poolsUsedBy(record, pools);
    const extras = Object.keys(used).length ? { pools: used } : undefined;
    const savedRef = target.mode === "new"
      ? insertAbilityRecord(definition.id, target.list, record, extras)
      : target.mode === "edit" ? replaceAbilityRecord(definition.id, target.ref, record, extras) : undefined;
    if (!savedRef) {
      setError("It couldn't be saved: this ability isn't on the creature any more (was it undone or deleted?).");
      return false;
    }
    close({ savedRef });
    return true;
  }

  function requestClose() {
    if (!dirty) return close();
    setLeaving(nestedTarget
      ? { message: `Keep your changes to ${name || "this ability"}?`, discard: () => close(), saveLabel: "Keep them", discardLabel: "Discard" }
      : { message: `Save your changes to ${name || "this ability"}?`, discard: () => close() });
  }

  useEditorGuard({ dirty, label: name || "this ability", save, discard: () => close() }, !nestedTarget);

  // Unsaved changes survive nothing outside the app: ask before the page goes away.
  useEffect(() => {
    if (!dirty || nestedTarget) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, nestedTarget]);

  useEffect(() => {
    if (isNew) {
      nameRef.current?.focus();
      nameRef.current?.select();
    } else {
      rootRef.current?.focus({ preventScroll: true });
    }
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from a granted ability: the editor takes focus again.
  const wasNested = useRef(false);
  useEffect(() => {
    if (wasNested.current && !nested) rootRef.current?.focus({ preventScroll: true });
    wasNested.current = Boolean(nested);
  }, [nested]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      // The editor answers Escape itself; the window around it mustn't close.
      event.stopPropagation();
      if (leaving) setLeaving(null);
      else requestClose();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      save();
      return;
    }
    // The map pans on Space; inside the editor, Space presses a button.
    if (event.key === " ") event.stopPropagation();
  }

  function showSection(id: SectionId) {
    setOpen((current) => new Set([...current, id]));
    requestAnimationFrame(() => {
      const head = rootRef.current?.querySelector<HTMLButtonElement>(`[data-section="${id}"] button`);
      head?.scrollIntoView({ block: "nearest" });
      head?.focus({ preventScroll: true });
    });
  }

  const toggle = (id: SectionId) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allOpen = sections.every((section) => open.has(section.id));

  function openGranted(index: number | null, action: ActionDefinition) {
    setNested({ index, record: structuredClone(action) });
    setNestedWorking(action);
    setError(null);
  }

  // A granted ability open: its editor stands in for this one, which keeps its state underneath.
  if (nested) {
    const parentRecord = withGrantedAt(working as Granting, nested.index, nested.record) as AbilityRecord;
    const parentPlaced = placeRecord(parentRecord);
    const parentRef = parentPlaced.ref as { list: GrantingList; id: string };
    const finish = () => { setNested(null); setNestedWorking(null); };
    return (
      <AbilityEditor
        key={`nested:${nested.index ?? "new"}:${nested.record.id}`}
        definition={parentPlaced.definition}
        pools={newPools}
        target={{
          mode: "nested",
          ref: { list: "granted", parent: { list: parentRef.list, id: parentRef.id }, id: nested.record.id },
          record: nested.record,
          isNew: nested.index === null,
          parentName: name || "this ability",
          onDone: (record) => update(withGrantedAt(working as Granting, nested.index, record) as AbilityRecord),
          onWorking: setNestedWorking
        }}
        onClose={finish}
      />
    );
  }

  const common = { definition: withPools, newPools, parkedReaction, onConvert: convert, conversionNote: note };
  function renderSection(id: SectionId) {
    if (type === "weapon") return weaponSection(id, { weapon: working as WeaponDefinition, onChange: update, definition: withPools, newPools, onOpenGranted: openGranted });
    if (type === "spell") return spellSection(id, { ...common, spell: working as SpellDefinition, onChange: update });
    if (type === "feature") {
      return featureSection(id, {
        feature: working as FeatureDefinition, onChange: update, definition: withPools, newPools, parkedReaction, parkedActivation, onOpenGranted: openGranted
      });
    }
    return actionSection(id, { ...common, action: working as ActionDefinition, onChange: update });
  }
  const actionKind = type === "action" ? (working as ActionDefinition).kind : undefined;
  const kindLabel = type === "weapon" ? "weapon" : type === "spell" ? "spell" : type === "feature" ? (working as FeatureDefinition).category
    : actionKind === "attack" ? "attack" : actionKind === "multiattack" ? "multiattack" : "action";

  return (
    <div ref={rootRef} className={styles.editor} tabIndex={-1} onKeyDown={onKeyDown} aria-label={`Edit ${name || `new ${kindLabel}`}`} role="region">
      <div className={styles.stickyHead}>
        <div className={styles.bar}>
          <button type="button" className={styles.back} onClick={requestClose} aria-label={nestedTarget ? `Back to ${nestedTarget.parentName}` : "Back to abilities"}>
            <ChevronLeft size={15} /> {nestedTarget ? nestedTarget.parentName : "Abilities"}
          </button>
          <span className={styles.crumb}>
            <span>{nestedTarget ? "›" : "/"}</span>{name || (isNew ? `New ${kindLabel}` : "Unnamed")}
          </span>
          {dirty ? <span className={styles.unsaved}>{nestedTarget ? "Changed" : "Unsaved"}</span> : null}
          <button type="button" className={styles.btn} onClick={() => close()}>Cancel</button>
          {nestedTarget ? (
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={save} title={`Back to ${nestedTarget.parentName}, keeping this (saved with it). Ctrl+Enter`}>
              Done
            </button>
          ) : (
            <button
              type="button" className={`${styles.btn} ${styles.primary}`} onClick={save}
              disabled={!isNew && !dirty} title={!isNew && !dirty ? "Nothing has changed" : "Ctrl+Enter"}
            >
              {isNew ? "Add to sheet" : "Save"}
            </button>
          )}
        </div>
        {entry ? (
          <div className={styles.preview} role="group" aria-label="Preview">
            <p className={styles.previewText}>
              <span className={styles.previewTitle}>{entry.title}.</span> {entry.text}
            </p>
            <SupportBadge entry={entry} />
          </div>
        ) : null}
        {entry?.notSimulated.length ? <p className={styles.notSimulated}>Not simulated: {entry.notSimulated.join(" ")}</p> : null}
      </div>

      {leaving ? (
        <UnsavedPrompt
          message={leaving.message}
          saveLabel={leaving.saveLabel}
          discardLabel={leaving.discardLabel}
          onSave={() => { if (save()) leaving.afterSave?.(); }}
          onDiscard={() => leaving.discard()}
          onKeep={() => setLeaving(null)}
        />
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {warnings.length ? (
        <ul className={styles.warnings} aria-label="Warnings">
          {warnings.map((warning) => (
            <li key={`${warning.id}:${warning.message}`} className={styles.warning}>
              <AlertTriangle size={13} aria-hidden />
              <span>{warning.message}</span>
              {warning.section && sections.some((section) => section.id === warning.section) ? (
                <button type="button" className={styles.linkBtn} onClick={() => showSection(warning.section!)}>Show</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className={styles.nameRow}>
        <label htmlFor={nameId} className={styles.label}>Name</label>
        <input
          id={nameId} ref={nameRef} value={name} aria-invalid={error !== null && !name.trim()}
          onChange={(event) => {
            // A spell's action carries its name too (the log and the AI show it); so does a feature's activation.
            const renamed = { ...working, name: event.target.value } as AbilityRecord;
            const spell = type === "spell" ? (renamed as SpellDefinition) : undefined;
            if (spell?.action && spell.action.name === (working as SpellDefinition).name) {
              update({ ...spell, action: { ...spell.action, name: event.target.value } });
              return;
            }
            const feature = type === "feature" ? (renamed as FeatureDefinition) : undefined;
            if (feature?.grantedActions?.some((action) => action.kind === "activate-feature" && action.name === (working as FeatureDefinition).name)) {
              update({
                ...feature,
                grantedActions: feature.grantedActions.map((action) => (action.kind === "activate-feature" && action.name === (working as FeatureDefinition).name
                  ? { ...action, name: event.target.value } : action))
              });
              return;
            }
            update(renamed);
          }}
        />
      </div>

      <div className={styles.sectionsTools}>
        <button type="button" className={styles.linkBtn} onClick={() => setOpen(allOpen ? new Set() : new Set(sections.map((section) => section.id)))}>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {sections.map((section) => (
        <EditorSection
          key={section.id}
          id={section.id}
          title={section.title}
          summary={section.summary}
          open={open.has(section.id)}
          onToggle={() => toggle(section.id)}
          flagged={flagged.has(section.id)}
          suggested={focus.includes(section.id)}
        >
          {renderSection(section.id)}
          {section.id === "notes" && entry ? (
            <p className={styles.hint}>
              <SupportBadge entry={entry} />{" "}
              {entry.support === "reference" ? "The AI never uses it; it's on the sheet for you to resolve."
                : entry.support === "no-effect" ? "Nothing in it changes a fight."
                  : entry.notSimulated.length ? `Not simulated: ${entry.notSimulated.join(" ")}` : "Everything it does is simulated."}
            </p>
          ) : null}
        </EditorSection>
      ))}

      {onOpenClassic && target.mode === "edit" ? (
        <p className={styles.classic}>
          Need something this editor doesn&apos;t cover yet?{" "}
          <button
            type="button" className={styles.linkBtn}
            onClick={() => (dirty
              ? setLeaving({ message: "Open it in the classic editor? Save your changes here first, or they're discarded.", discard: onOpenClassic, afterSave: onOpenClassic, saveLabel: "Save and open", discardLabel: "Discard and open" })
              : onOpenClassic())}
          >
            Open it in the classic editor
          </button>
          <InfoTooltip label="About the classic editor" content={<p>The older, all-in-one form. It will go once this editor covers every kind of ability.</p>} />
        </p>
      ) : null}
    </div>
  );
}
