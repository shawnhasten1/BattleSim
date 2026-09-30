"use client";

import { AlertTriangle, ChevronLeft } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ActionDefinition, ActionRider, CreatureDefinition, WeaponDefinition } from "@/engine";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { findAbility, withAbility, withNewAbility, type AbilityList, type AbilityRecord, type AbilityRef } from "@/lib/ability-editor/refs";
import { sectionsFor, type SectionId } from "@/lib/ability-editor/sections";
import { abilityWarnings } from "@/lib/ability-editor/validate";
import { deepEqual } from "@/lib/deep-equal";
import { statblockFor, type StatblockEntry } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";
import { useEditorGuard } from "../SheetGuard";
import { UnsavedPrompt } from "../UnsavedPrompt";
import { attackSection, useParkedReaction, weaponSection, type AttackAction } from "./AbilitySections";
import { EditorSection } from "./EditorSection";
import type { NewPools } from "./LimitPicker";
import styles from "./ability-editor.module.css";

/** What the editor opens on: an ability already on the creature, or a new one headed for a list. */
export type AbilityEditorTarget =
  | { mode: "edit"; ref: AbilityRef }
  | { mode: "new"; list: AbilityList; record: AbilityRecord };

export interface AbilityEditorResult {
  /** Where the ability is now, when it was saved. */
  savedRef?: AbilityRef;
}

/** The sections Phase 2's editor has fields for, per kind of record. */
const WEAPON_SECTIONS: SectionId[] = ["basics", "use", "target", "roll", "damage", "effects", "while-active", "grants", "notes"];
const ATTACK_SECTIONS: SectionId[] = ["use", "target", "roll", "damage", "effects", "notes"];

/** Which new pools a record actually spends (a pool created and then not picked isn't added). */
function poolsUsedBy(record: AbilityRecord, pools: Record<string, number>): Record<string, number> {
  const spent = new Set<string>();
  const addCost = (cost: { resourceId: string } | undefined) => { if (cost) spent.add(cost.resourceId); };
  const riders: ActionRider[] = [];
  if ("kind" in record && typeof record.kind === "string") {
    const action = record as ActionDefinition;
    addCost("resourceCost" in action ? action.resourceCost : undefined);
    if ("riders" in action) riders.push(...(action.riders ?? []));
  } else if ("attackType" in record) {
    const weapon = record as WeaponDefinition;
    addCost(weapon.resourceCost);
    riders.push(...(weapon.onHit ?? []));
  }
  for (const rider of riders) addCost(rider.kind === "note" ? undefined : rider.resourceCost);
  return Object.fromEntries(Object.entries(pools).filter(([id]) => spent.has(id)));
}

/** Something that stops a save: the DM has to fix it first. */
function blockingProblem(record: AbilityRecord): { message: string; section?: SectionId } | null {
  if (!(record as { name?: string }).name?.trim()) return { message: "Give it a name first." };
  const riders = ("onHit" in record ? (record as WeaponDefinition).onHit : "riders" in record ? (record as { riders?: ActionRider[] }).riders : undefined) ?? [];
  if (riders.some((rider) => rider.kind !== "note" && rider.resourceCost && !rider.resourceCost.resourceId)) {
    return { message: "Choose which pool an effect's charges come from.", section: "effects" };
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

export function AbilityEditor({ definition, target, onClose, onOpenClassic }: {
  definition: CreatureDefinition;
  target: AbilityEditorTarget;
  onClose: (result: AbilityEditorResult) => void;
  /** Hands the ability to the old builder, for what this editor doesn't cover yet. */
  onOpenClassic?: () => void;
}) {
  const replaceAbilityRecord = useEncounterStore((s) => s.replaceAbilityRecord);
  const insertAbilityRecord = useEncounterStore((s) => s.insertAbilityRecord);
  const isNew = target.mode === "new";
  const [opened] = useState<AbilityRecord>(() => structuredClone(isNew ? target.record : findAbility(definition, target.ref)!));
  const [working, setWorking] = useState<AbilityRecord>(() => structuredClone(opened));
  const [pools, setPools] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  // "Save your changes?": what Discard does, and what follows a successful save (saving itself closes the editor).
  const [leaving, setLeaving] = useState<{ message: string; discard: () => void; afterSave?: () => void; saveLabel?: string; discardLabel?: string } | null>(null);
  const isWeapon = target.mode === "new" ? target.list === "weapons" : target.ref.list === "weapons";
  const available = isWeapon ? WEAPON_SECTIONS : ATTACK_SECTIONS;
  const [open, setOpen] = useState<Set<SectionId>>(() => new Set(isNew ? available : []));
  const parkedReaction = useParkedReaction();
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();

  const newPools: NewPools = useMemo(() => ({ pools, add: (id, size) => setPools((current) => ({ ...current, [id]: size })) }), [pools]);
  const name = (working as { name?: string }).name ?? "";
  const dirty = !deepEqual(working, opened);

  // New pools count as the creature's while editing, so the preview and warnings see them.
  const withPools = useMemo(
    () => (Object.keys(pools).length ? { ...definition, resources: { ...(definition.resources ?? {}), ...pools } } : definition),
    [definition, pools]
  );
  const where: AbilityRef | AbilityList = target.mode === "new" ? target.list : target.ref;
  const placed = useMemo(
    () => (target.mode === "new" ? withNewAbility(withPools, target.list, working) : withAbility(withPools, target.ref, working)),
    [target, withPools, working]
  );
  const entry = statblockFor(placed.definition, placed.ref);
  const warnings = useMemo(() => abilityWarnings(withPools, where, working), [withPools, where, working]);
  const sections = sectionsFor({ ref: placed.ref, record: working, definition: placed.definition }).filter((section) => {
    if (!available.includes(section.id)) return false;
    if (section.id === "while-active") return Boolean((working as WeaponDefinition).effects?.length);
    if (section.id === "grants") return Boolean((working as WeaponDefinition).grantedActions?.length);
    return true;
  });
  const flagged = new Set(warnings.map((warning) => warning.section).filter(Boolean));

  function update(next: AbilityRecord) {
    setWorking(next);
    setError(null);
  }

  function close(result: AbilityEditorResult = {}) {
    setLeaving(null);
    onClose(result);
  }

  function save(): boolean {
    const problem = blockingProblem(working);
    if (problem) {
      setError(problem.message);
      if (problem.section) setOpen((current) => new Set([...current, problem.section!]));
      else nameRef.current?.focus();
      return false;
    }
    if (!isNew && !dirty) {
      close();
      return true;
    }
    const used = poolsUsedBy(working, pools);
    const extras = Object.keys(used).length ? { pools: used } : undefined;
    const savedRef = target.mode === "new"
      ? insertAbilityRecord(definition.id, target.list, working, extras)
      : replaceAbilityRecord(definition.id, target.ref, working, extras);
    if (!savedRef) {
      setError("It couldn't be saved: this ability isn't on the creature any more (was it undone or deleted?).");
      return false;
    }
    close({ savedRef });
    return true;
  }

  function requestClose() {
    if (!dirty) return close();
    setLeaving({ message: `Save your changes to ${name || "this ability"}?`, discard: () => close() });
  }

  useEditorGuard({ dirty, label: name || "this ability", save, discard: () => close() });

  // Unsaved changes survive nothing outside the app: ask before the page goes away.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

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

  const sectionProps = isWeapon
    ? { weapon: working as WeaponDefinition, onChange: update, definition: withPools, newPools }
    : { action: working as AttackAction, onChange: update, definition: withPools, newPools, parkedReaction };
  const kindLabel = isWeapon ? "weapon" : "attack";

  return (
    <div ref={rootRef} className={styles.editor} tabIndex={-1} onKeyDown={onKeyDown} aria-label={`Edit ${name || `new ${kindLabel}`}`} role="region">
      <div className={styles.stickyHead}>
        <div className={styles.bar}>
          <button type="button" className={styles.back} onClick={requestClose} aria-label="Back to abilities">
            <ChevronLeft size={15} /> Abilities
          </button>
          <span className={styles.crumb}><span>/</span>{name || (isNew ? `New ${kindLabel}` : "Unnamed")}</span>
          {dirty ? <span className={styles.unsaved}>Unsaved</span> : null}
          <button type="button" className={styles.btn} onClick={() => close()}>Cancel</button>
          <button
            type="button" className={`${styles.btn} ${styles.primary}`} onClick={save}
            disabled={!isNew && !dirty} title={!isNew && !dirty ? "Nothing has changed" : "Ctrl+Enter"}
          >
            {isNew ? "Add to sheet" : "Save"}
          </button>
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
              {warning.section && available.includes(warning.section) ? (
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
          onChange={(event) => update({ ...working, name: event.target.value } as AbilityRecord)}
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
        >
          {isWeapon
            ? weaponSection(section.id, sectionProps as Parameters<typeof weaponSection>[1])
            : attackSection(section.id, sectionProps as Parameters<typeof attackSection>[1])}
          {section.id === "notes" && entry ? (
            <p className={styles.hint}>
              <SupportBadge entry={entry} />{" "}
              {entry.support === "reference" ? "The AI never uses it; it's on the sheet for you to resolve."
                : entry.notSimulated.length ? `Not simulated: ${entry.notSimulated.join(" ")}` : "Everything it does is simulated."}
            </p>
          ) : null}
        </EditorSection>
      ))}

      {onOpenClassic && !isNew ? (
        <p className={styles.classic}>
          Need something this editor doesn&apos;t cover yet, like turning it into a saving throw?{" "}
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
