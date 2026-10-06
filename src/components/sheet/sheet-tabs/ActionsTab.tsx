"use client";

import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CombatantState, CreatureDefinition } from "@/engine";
import type { Prepared } from "@/lib/ability-editor/add";
import { abilityList, type ListRow } from "@/lib/ability-editor/list";
import { findAbility, refKey, type AbilityRef } from "@/lib/ability-editor/refs";
import { AbilityEditor, type SheetEditorTarget } from "../ability-editor/AbilityEditor";
import { AbilitiesList, refRowId } from "../abilities/AbilitiesList";
import { AddAbility, type BlankKind } from "../abilities/AddAbility";
import { blankTarget, preparedTarget, useAttachFromLibrary } from "../abilities/add-targets";
import { useAbilityRemoval, useRowEdits } from "../abilities/row-actions";
import { ResourceList } from "../abilities/ResourceList";
import { SpellcastingHeading } from "../abilities/SpellcastingHeading";
import { ItemOffers } from "../abilities/ItemOffers";
import { UpcastOffers } from "../abilities/UpcastOffers";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AUTOMATION_HELP } from "@/lib/sheet-help";
import type { Compendium } from "@/hooks/useCompendium";
import abilityStyles from "../abilities/abilities.module.css";

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
  const edits = useRowEdits(definition);
  const removal = useAbilityRemoval(definition);

  const [addOpen, setAddOpen] = useState(false);
  // The ability editor, open in place of the list: on `openFirst`, when the creature has it.
  const [abilityEditor, setAbilityEditor] = useState<SheetEditorTarget | null>(() =>
    openFirst && openFirst.list !== "granted" && findAbility(definition, openFirst) ? { mode: "edit", ref: openFirst } : null);
  // The row the editor was on, focused when the list comes back (and highlighted, when it was saved).
  const [returnTo, setReturnTo] = useState<{ id: string; saved: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => abilityList(definition, combatant), [definition, combatant]);

  function openAbilityEditor(target: SheetEditorTarget) {
    setAddOpen(false);
    setAbilityEditor(target);
  }

  /** A row opens in the ability editor. */
  function openRow(row: ListRow) {
    if (row.ref.list === "granted") return;
    openAbilityEditor({ mode: "edit", ref: row.ref });
  }

  /** Show a row the list just changed (a copy, or one moved): focused and highlighted. */
  function show(id: string | undefined) {
    if (id) setReturnTo({ id, saved: true });
  }

  const attachFromLibrary = useAttachFromLibrary(definition.id);

  function openPrepared(prepared: Prepared) {
    openAbilityEditor(preparedTarget(prepared));
  }

  /** Start from scratch: every kind opens in the ability editor on a blank record. */
  function startBlank(kind: BlankKind) {
    openAbilityEditor(blankTarget(kind, definition));
  }

  useEffect(() => {
    if (!returnTo || abilityEditor) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(returnTo.id)}"]`);
    node?.scrollIntoView({ block: "nearest" });
    node?.querySelector<HTMLButtonElement>('button[aria-label^="Edit "]')?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setReturnTo(null), 1800);
    return () => window.clearTimeout(timer);
  }, [returnTo, abilityEditor]);

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
        under={removal.under}
        heading={(group) => (group.spellcasting ? <SpellcastingHeading definition={definition} facts={group.spellcasting} /> : undefined)}
        handlers={{
          onOpen: openRow,
          onDuplicate: (row) => show(edits.duplicate(row)),
          onMove: (row, to) => show(edits.move(row, to)),
          onDelete: removal.request,
          onToggleOptional: edits.setOptional,
          onToggleWorn: edits.setWorn
        }}
      />

      <div className={abilityStyles.standard}>
        <h4>Standard actions</h4>
        <p style={{ margin: 0, fontSize: 11, color: "var(--ui-text-dim)" }}>
          Every creature can Dash · Disengage · Dodge · Hide · Help — no setup needed.
        </p>
      </div>

      {removal.toast}
    </div>
  );
}
