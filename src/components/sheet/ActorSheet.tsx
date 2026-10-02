"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { getDefinition } from "@/engine";
import { useSelectedCombatant } from "@/hooks/useSelectedCombatant";
import type { Compendium } from "@/hooks/useCompendium";
import type { CompendiumDragPayload } from "@/lib/compendium";
import { creatureScope, libraryStatus } from "@/lib/actor-sheet/scope";
import { readJson, writeJson } from "@/lib/persist";
import type { AbilityRef } from "@/lib/ability-editor/refs";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AUTOMATION_HELP } from "@/lib/sheet-help";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { useEncounterStore } from "@/store/encounter-store";
import { parseSrdDragPayload, SRD_DRAG_MIME } from "@/data/srd";
import { SheetGuardContext, type EditorGuard } from "./SheetGuard";
import { UnsavedPrompt } from "./UnsavedPrompt";
import { AutomationCount, VitalsStrip } from "./SheetHeader";
import { SheetMenu, type SheetToast } from "./SheetMenu";
import { ScopedTabs, type SheetTabId } from "./ScopedTabs";
import { StatsTab } from "./sheet-tabs/StatsTab";
import { ActionsTab } from "./sheet-tabs/ActionsTab";
import { TokenTab } from "./sheet-tabs/TokenTab";
import abilityStyles from "./abilities/abilities.module.css";

/** The tab the sheet opens on: the last one used, per browser (plan D10), or Stats. */
const TAB_KEY = "actor-sheet-tab";
function storedTab(): SheetTabId {
  const stored = readJson<string>(TAB_KEY, "stats");
  return stored === "abilities" || stored === "token" ? stored : "stats";
}

/**
 * Floating, draggable actor/token sheet for the selected combatant. Replaces
 * the old full-screen edit modal. Compendium items dragged anywhere onto the
 * window attach to this actor.
 *
 * Above its tabs, the token's vitals stay in view; the tabs are grouped by what they change (the creature, or this
 * token). While an ability editor inside has unsaved changes, the sheet asks before a tab switch, closing or a ⋯
 * action, and stays on that creature when another token is selected (asking whether to save first).
 */
export function ActorSheet({ compendium, onClose }: { compendium: Compendium; onClose: () => void }) {
  const { selectedCombatant, selectedDefinition } = useSelectedCombatant();
  const encounter = useEncounterStore((s) => s.encounter);
  const definitionsLibrary = useEncounterStore((s) => s.definitionsLibrary);
  const templateDefinitionIds = useEncounterStore((s) => s.templateDefinitionIds);
  const selectCombatant = useEncounterStore((s) => s.selectCombatant);
  const attachSrdWeapon = useEncounterStore((s) => s.attachSrdWeapon);
  const attachSrdSpell = useEncounterStore((s) => s.attachSrdSpell);
  const attachSrdFeature = useEncounterStore((s) => s.attachSrdFeature);
  const [tab, setTabState] = useState<SheetTabId>(storedTab);
  const [dropActive, setDropActive] = useState(false);
  const [toast, setToast] = useState<SheetToast | null>(null);
  // An ability the Token tab asked to open: the Abilities tab opens it in the editor as it mounts.
  const [openFirst, setOpenFirst] = useState<AbilityRef | null>(null);

  // The open editor's guard, and whether it has unsaved changes (state, so the sheet re-renders to pin itself).
  const guardRef = useRef<EditorGuard | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorLabel, setEditorLabel] = useState("");
  // The creature being edited while there are unsaved changes: the sheet stays on it.
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  // A tab switch, close or ⋯ action waiting on "Save your changes?".
  const [pending, setPending] = useState<(() => void) | null>(null);

  const register = useCallback((guard: EditorGuard | null) => {
    guardRef.current = guard;
    setEditorDirty(Boolean(guard?.dirty));
    setEditorLabel(guard?.label ?? "");
  }, []);
  const registry = useMemo(() => ({ register }), [register]);

  // A compendium message (a drop attached something, an import failed) shows as a toast, if it arrives while open.
  const shownStatus = useRef(compendium.status);
  useEffect(() => {
    if (compendium.status && compendium.status !== shownStatus.current) setToast({ message: compendium.status });
    shownStatus.current = compendium.status;
  }, [compendium.status]);
  // Taken once the Abilities tab has opened it: it mustn't open again, nor on another creature.
  useEffect(() => {
    if (tab === "abilities" && openFirst) setOpenFirst(null);
  }, [tab, openFirst]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const pinned = pinnedId ? encounter.combatants.find((combatant) => combatant.id === pinnedId) : undefined;
  const combatant = editorDirty && pinned ? pinned : selectedCombatant;
  // Pin on the first unsaved change; let go once the changes are saved or dropped.
  if (editorDirty && !pinnedId && combatant) setPinnedId(combatant.id);
  if (!editorDirty && pinnedId) setPinnedId(null);

  if (!combatant) return null;
  const definition = combatant === selectedCombatant && selectedDefinition ? selectedDefinition : getDefinition(encounter, combatant);
  const selectionMoved = editorDirty && pinned !== undefined && selectedCombatant !== undefined && selectedCombatant.id !== pinned.id;
  const status = libraryStatus(definition, definitionsLibrary, templateDefinitionIds);
  const scope = creatureScope(encounter, definition, status);

  /** Run `action` now, or once the DM has answered "Save your changes?". */
  function attempt(action: () => void) {
    if (guardRef.current?.dirty) setPending(() => action);
    else action();
  }

  function setTab(next: SheetTabId) {
    setTabState(next);
    writeJson(TAB_KEY, next);
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
          {combatant.displayName} <span>· {definition.name}</span>
        </>
      }
      ariaLabel={`${definition.name} sheet`}
      width={680}
      storageKey="actor-sheet"
      onClose={() => attempt(onClose)}
      headerExtra={
        <>
          <AutomationCount definition={definition} combatant={combatant} onOpen={() => { if (tab !== "abilities") attempt(() => setTab("abilities")); }} />
          <SheetMenu combatant={combatant} definition={definition} status={status} guard={attempt} onToast={setToast} />
          <InfoTooltip label="About automation levels" content={AUTOMATION_HELP} />
        </>
      }
      subheader={
        <>
          <VitalsStrip combatant={combatant} definition={definition} />
          <ScopedTabs
            tab={tab} onSelect={(next) => attempt(() => setTab(next))}
            creature={definition.name} creatureCaption={scope.caption} creatureHelp={scope.help} token={combatant.displayName}
          />
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
        </>
      }
      dropActive={dropActive}
      onDragOver={onDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <SheetGuardContext.Provider value={registry}>
        {tab === "stats" ? <StatsTab combatant={combatant} definition={definition} /> : null}
        {/* Keyed by creature: an ability being edited must not carry over to another creature when the selection changes. */}
        {tab === "abilities" ? (
          <ActionsTab key={definition.id} combatant={combatant} definition={definition} compendium={compendium} openFirst={openFirst ?? undefined} />
        ) : null}
        {tab === "token" ? (
          <TokenTab
            combatant={combatant} definition={definition}
            onOpenAbility={(ref) => attempt(() => { setOpenFirst(ref); setTab("abilities"); })}
          />
        ) : null}
      </SheetGuardContext.Provider>
      {toast ? (
        // The Abilities tab's undo toast, for messages from the ⋯ menu and drops.
        <div className={abilityStyles.toast} role="status">
          <span>{toast.message}</span>
          {toast.undo ? (
            <button type="button" onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>
          ) : null}
        </div>
      ) : null}
    </FloatingWindow>
  );
}
