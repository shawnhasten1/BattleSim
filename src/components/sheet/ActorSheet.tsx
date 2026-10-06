"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { getDefinition } from "@/engine";
import type { Compendium } from "@/hooks/useCompendium";
import type { CompendiumDragPayload } from "@/lib/compendium";
import { creatureScope, libraryStatus, tokensOf } from "@/lib/actor-sheet/scope";
import type { AbilityRef } from "@/lib/ability-editor/refs";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AUTOMATION_HELP } from "@/lib/sheet-help";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { useEncounterStore } from "@/store/encounter-store";
import { shownDefinitionId, useSheetWindowsStore, type SheetWindow } from "@/store/sheet-windows-store";
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

/**
 * One sheet window (CHARACTER_SHEET_WINDOWS_PLAN.md): a creature, edited for every token of it, with one of its tokens
 * shown for the values that are that token's own (D2). Floating and draggable; several can be open at once, each in
 * front when it's used. Compendium items dropped anywhere onto the window attach to this creature.
 *
 * Above its tabs, the shown token's vitals stay in view, with a switcher when the creature has several tokens. While an
 * ability editor inside has unsaved changes, the window asks before a tab switch, closing or a ⋯ action. Switching the
 * token never asks: the ability belongs to the creature, which stays the same.
 */
export function ActorSheet({ sheet, rank, front, compendium }: {
  sheet: SheetWindow;
  /** Its place in the stack of sheet windows, 0 at the back. */
  rank: number;
  /** In front of every other sheet window: the one compendium messages show in. */
  front: boolean;
  compendium: Compendium;
}) {
  const encounter = useEncounterStore((s) => s.encounter);
  const definitionsLibrary = useEncounterStore((s) => s.definitionsLibrary);
  const templateDefinitionIds = useEncounterStore((s) => s.templateDefinitionIds);
  const selectCombatant = useEncounterStore((s) => s.selectCombatant);
  const attachSrdWeapon = useEncounterStore((s) => s.attachSrdWeapon);
  const attachSrdSpell = useEncounterStore((s) => s.attachSrdSpell);
  const attachSrdFeature = useEncounterStore((s) => s.attachSrdFeature);
  const attachSrdItem = useEncounterStore((s) => s.attachSrdItem);
  const closeWindow = useSheetWindowsStore((s) => s.close);
  const focusWindow = useSheetWindowsStore((s) => s.focus);
  const setWindowTab = useSheetWindowsStore((s) => s.setTab);
  const showToken = useSheetWindowsStore((s) => s.showToken);
  const setDirty = useSheetWindowsStore((s) => s.setDirty);
  const notePosition = useSheetWindowsStore((s) => s.notePosition);
  const tab = sheet.tab;
  const [dropActive, setDropActive] = useState(false);
  const [toast, setToast] = useState<SheetToast | null>(null);
  // An ability the Token tab asked to open: the Abilities tab opens it in the editor as it mounts.
  const [openFirst, setOpenFirst] = useState<AbilityRef | null>(null);
  // A creature just made from this token: Stats focuses its name, selected, ready to rename.
  const [focusName, setFocusName] = useState(false);

  // The open editor's guard, and whether it has unsaved changes (state, so the window re-renders).
  const guardRef = useRef<EditorGuard | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorLabel, setEditorLabel] = useState("");
  // A tab switch, close or ⋯ action waiting on "Save your changes?".
  const [pending, setPending] = useState<(() => void) | null>(null);

  const register = useCallback((guard: EditorGuard | null) => {
    guardRef.current = guard;
    setEditorDirty(Boolean(guard?.dirty));
    setEditorLabel(guard?.label ?? "");
  }, []);
  const registry = useMemo(() => ({ register }), [register]);
  // A window with unsaved changes is never closed to make room for another (D3).
  useEffect(() => setDirty(sheet.id, editorDirty), [setDirty, sheet.id, editorDirty]);

  // A compendium message (a drop attached something, an import failed) shows as a toast in the window in front, if it
  // arrives while it's open.
  const shownStatus = useRef(compendium.status);
  useEffect(() => {
    if (front && compendium.status && compendium.status !== shownStatus.current) setToast({ message: compendium.status });
    shownStatus.current = compendium.status;
  }, [front, compendium.status]);
  // Taken once the Abilities tab has opened it: it mustn't open again, nor on another creature.
  useEffect(() => {
    if (tab === "abilities" && openFirst) setOpenFirst(null);
  }, [tab, openFirst]);
  // Taken once Stats has focused the name (its effect runs before this one).
  useEffect(() => {
    if (focusName) setFocusName(false);
  }, [focusName]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Its token, or (gone a moment before the host moves the window on) another token of its creature.
  const combatant = encounter.combatants.find((candidate) => candidate.id === sheet.combatantId)
    ?? encounter.combatants.find((candidate) => shownDefinitionId(candidate) === sheet.definitionId);
  if (!combatant) return null;
  const definition = getDefinition(encounter, combatant);
  const tokens = tokensOf(encounter, definition.id);
  const status = libraryStatus(definition, definitionsLibrary, templateDefinitionIds);
  const scope = creatureScope(encounter, definition, status);

  /** Run `action` now, or once the DM has answered "Save your changes?". */
  function attempt(action: () => void) {
    if (guardRef.current?.dirty) setPending(() => action);
    else action();
  }

  function setTab(next: SheetTabId) {
    setWindowTab(sheet.id, next);
  }

  /** Show `id`'s own values, and select it on the map. */
  function switchToken(id: string) {
    showToken(sheet.id, id);
    selectCombatant(id);
  }

  /** A toast in this window, or outside it when the window is about to close (its creature's last token deleted). */
  function showToast(next: SheetToast) {
    if (tokensOf(useEncounterStore.getState().encounter, definition.id).length) setToast(next);
    else useSheetWindowsStore.getState().notify(next);
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
    // In front, so the compendium's message about this drop shows here.
    focusWindow(sheet.id);
    const srdRaw = event.dataTransfer.getData(SRD_DRAG_MIME);
    if (srdRaw) {
      event.preventDefault();
      const payload = parseSrdDragPayload(srdRaw);
      if (payload?.kind === "weapon") attachSrdWeapon(definition.id, payload.id);
      else if (payload?.kind === "spell") attachSrdSpell(definition.id, payload.id);
      else if (payload?.kind === "feature") attachSrdFeature(definition.id, payload.id);
      else if (payload?.kind === "item") attachSrdItem(definition.id, payload.id);
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

  const title = tokens.length > 1
    ? <>{definition.name} <span>· {tokens.length} tokens</span></>
    : combatant.displayName === definition.name
      ? definition.name
      : <>{combatant.displayName} <span>· {definition.name}</span></>;

  return (
    <FloatingWindow
      title={title}
      ariaLabel={`${definition.name} sheet`}
      width={680}
      initialPosition={sheet.origin}
      storageKey={`sheet-${sheet.style}`}
      restorePosition={false}
      onMove={(position) => notePosition(sheet.id, position)}
      zIndex={rank}
      onFocus={() => focusWindow(sheet.id)}
      onClose={() => attempt(() => closeWindow(sheet.id))}
      headerExtra={
        <>
          <AutomationCount definition={definition} combatant={combatant} onOpen={() => { if (tab !== "abilities") attempt(() => setTab("abilities")); }} />
          <SheetMenu
            combatant={combatant} definition={definition} status={status} guard={attempt} onToast={showToast}
            onOwnCreature={() => { setTab("stats"); setFocusName(true); }}
            onShowToken={switchToken}
          />
          <InfoTooltip label="About automation levels" content={AUTOMATION_HELP} />
        </>
      }
      subheader={
        <>
          <VitalsStrip combatant={combatant} definition={definition} tokens={tokens} onShowToken={switchToken} />
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
        </>
      }
      dropActive={dropActive}
      onDragOver={onDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <SheetGuardContext.Provider value={registry}>
        {tab === "stats" ? <StatsTab combatant={combatant} definition={definition} focusName={focusName} /> : null}
        {/* Keyed by creature: an ability being edited must not carry over to another creature (made its own, or a new form). */}
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
