"use client";

import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { getDefinition } from "@/engine";
import { useSelectedCombatant } from "@/hooks/useSelectedCombatant";
import type { Compendium } from "@/hooks/useCompendium";
import type { CompendiumDragPayload } from "@/lib/compendium";
import { buildSheetItems } from "@/lib/sheet";
import { sourceLabel } from "@/lib/ui-helpers";
import { AutomationBadge } from "@/components/ui/AutomationBadge";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AUTOMATION_HELP } from "@/lib/sheet-help";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { useEncounterStore } from "@/store/encounter-store";
import { parseSrdDragPayload, SRD_DRAG_MIME } from "@/data/srd";
import { SheetGuardContext, type EditorGuard } from "./SheetGuard";
import { UnsavedPrompt } from "./UnsavedPrompt";
import { StatsTab } from "./sheet-tabs/StatsTab";
import { ActionsTab } from "./sheet-tabs/ActionsTab";
import { TacticsTab } from "./sheet-tabs/TacticsTab";
import { TokenTab } from "./sheet-tabs/TokenTab";
import styles from "./sheet.module.css";

const TABS = [
  { id: "stats", label: "Stats" },
  { id: "abilities", label: "Abilities" },
  { id: "tactics", label: "Tactics" },
  { id: "token", label: "Token" }
] as const;
type SheetTabId = (typeof TABS)[number]["id"];

/**
 * Floating, draggable actor/token sheet for the selected combatant. Replaces
 * the old full-screen edit modal. Compendium items dragged anywhere onto the
 * window attach to this actor.
 *
 * While an ability editor inside has unsaved changes, the sheet asks before a tab switch or closing, and stays on
 * that creature when another token is selected (asking whether to save first).
 */
export function ActorSheet({ compendium, onClose }: { compendium: Compendium; onClose: () => void }) {
  const { selectedCombatant, selectedDefinition } = useSelectedCombatant();
  const encounter = useEncounterStore((s) => s.encounter);
  const selectCombatant = useEncounterStore((s) => s.selectCombatant);
  const attachSrdWeapon = useEncounterStore((s) => s.attachSrdWeapon);
  const attachSrdSpell = useEncounterStore((s) => s.attachSrdSpell);
  const attachSrdFeature = useEncounterStore((s) => s.attachSrdFeature);
  const [tab, setTab] = useState<SheetTabId>("token");
  const [dropActive, setDropActive] = useState(false);

  // The open editor's guard, and whether it has unsaved changes (state, so the sheet re-renders to pin itself).
  const guardRef = useRef<EditorGuard | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorLabel, setEditorLabel] = useState("");
  // The creature being edited while there are unsaved changes: the sheet stays on it.
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  // A tab switch or close waiting on "Save your changes?".
  const [pending, setPending] = useState<(() => void) | null>(null);

  const register = useCallback((guard: EditorGuard | null) => {
    guardRef.current = guard;
    setEditorDirty(Boolean(guard?.dirty));
    setEditorLabel(guard?.label ?? "");
  }, []);
  const registry = useMemo(() => ({ register }), [register]);

  const pinned = pinnedId ? encounter.combatants.find((combatant) => combatant.id === pinnedId) : undefined;
  const combatant = editorDirty && pinned ? pinned : selectedCombatant;
  // Pin on the first unsaved change; let go once the changes are saved or dropped.
  if (editorDirty && !pinnedId && combatant) setPinnedId(combatant.id);
  if (!editorDirty && pinnedId) setPinnedId(null);

  if (!combatant) return null;
  const definition = combatant === selectedCombatant && selectedDefinition ? selectedDefinition : getDefinition(encounter, combatant);
  const items = buildSheetItems(definition);
  const selectionMoved = editorDirty && pinned !== undefined && selectedCombatant !== undefined && selectedCombatant.id !== pinned.id;

  /** Run `action` now, or once the DM has answered "Save your changes?". */
  function attempt(action: () => void) {
    if (guardRef.current?.dirty) setPending(() => action);
    else action();
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    const types = event.dataTransfer.types;
    if (types.includes("application/x-battle-sim-compendium") || types.includes(SRD_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDropActive(true);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    setDropActive(false);
    const srdRaw = event.dataTransfer.getData(SRD_DRAG_MIME);
    if (srdRaw) {
      event.preventDefault();
      const payload = parseSrdDragPayload(srdRaw);
      if (payload?.kind === "weapon") attachSrdWeapon(definition.id, payload.id);
      else if (payload?.kind === "spell") attachSrdSpell(definition.id, payload.id);
      else if (payload?.kind === "feature") attachSrdFeature(definition.id, payload.id);
      return;
    }
    const raw = event.dataTransfer.getData("application/x-battle-sim-compendium");
    if (!raw) return;
    event.preventDefault();
    try {
      void compendium.attach(JSON.parse(raw) as CompendiumDragPayload, definition.id, combatant!.id);
    } catch {
      compendium.setStatus("Compendium drop failed");
    }
  }

  return (
    <FloatingWindow
      title={
        <>
          {definition.name} <span>· {combatant.displayName}</span>
        </>
      }
      ariaLabel={`${definition.name} sheet`}
      width={680}
      storageKey="actor-sheet"
      onClose={() => attempt(onClose)}
      headerExtra={
        <>
          <AutomationBadge value={items.worst} />
          <InfoTooltip label="About automation levels" content={AUTOMATION_HELP} />
        </>
      }
      dropActive={dropActive}
      onDragOver={onDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <div className={styles.tabs} role="tablist" aria-label="Actor sheet sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === tab}
            className={entry.id === tab ? styles.active : ""}
            onClick={() => { if (entry.id !== tab) attempt(() => setTab(entry.id)); }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {pending ? (
        <UnsavedPrompt
          message={`Save your changes to ${editorLabel || "this ability"} first?`}
          onSave={() => {
            const run = pending;
            setPending(null);
            if (guardRef.current?.save() !== false) run();
          }}
          onDiscard={() => {
            const run = pending;
            setPending(null);
            guardRef.current?.discard();
            run();
          }}
          onKeep={() => setPending(null)}
        />
      ) : null}
      {selectionMoved ? (
        <UnsavedPrompt
          message={`You selected ${selectedCombatant!.displayName}. Save your changes to ${editorLabel || "this ability"} on ${combatant.displayName} first?`}
          saveLabel="Save and switch"
          discardLabel="Discard and switch"
          onSave={() => { guardRef.current?.save(); }}
          onDiscard={() => { guardRef.current?.discard(); }}
          onKeep={() => selectCombatant(combatant.id)}
        />
      ) : null}
      {compendium.status ? <p className={styles.status}>{compendium.status}</p> : null}
      <p className={styles.status} style={{ borderBottom: "1px solid var(--ui-border)" }}>
        {combatant.faction} · {sourceLabel(definition.source)}
      </p>

      <SheetGuardContext.Provider value={registry}>
        {tab === "stats" ? <StatsTab combatant={combatant} definition={definition} /> : null}
        {/* Keyed by creature: an ability being edited must not carry over to another creature when the selection changes. */}
        {tab === "abilities" ? <ActionsTab key={definition.id} combatant={combatant} definition={definition} compendium={compendium} /> : null}
        {tab === "tactics" ? <TacticsTab combatant={combatant} definition={definition} /> : null}
        {tab === "token" ? <TokenTab combatant={combatant} definition={definition} /> : null}
      </SheetGuardContext.Provider>
    </FloatingWindow>
  );
}
