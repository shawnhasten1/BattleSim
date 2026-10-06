"use client";

import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { getDefinition } from "@/engine";
import type { Compendium } from "@/hooks/useCompendium";
import type { CompendiumDragPayload } from "@/lib/compendium";
import { creatureScope, libraryStatus, tokensOf } from "@/lib/actor-sheet/scope";
import type { AbilityRef } from "@/lib/ability-editor/refs";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AUTOMATION_HELP } from "@/lib/sheet-help";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { openPopup, PopoutFrame, PopoutWindow, type PopupBounds } from "@/components/ui/PopoutWindow";
import { RelocatableSlot, useRelocatable } from "@/components/ui/Relocatable";
import { OwnerDocumentContext } from "@/hooks/useOwnerDocument";
import { readJson, writeJson } from "@/lib/persist";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useEncounterStore } from "@/store/encounter-store";
import { shownDefinitionId, useSheetWindowsStore, type SheetKind, type SheetStyle, type SheetWindow } from "@/store/sheet-windows-store";
import { CODEX_PALETTE_IDS, CODEX_PALETTES } from "@/lib/actor-sheet/codex";
import type { ContextMenuItem } from "@/components/ui/ContextMenu";
import { parseSrdDragPayload, SRD_DRAG_MIME } from "@/data/srd";
import { SheetGuardContext, type EditorGuard } from "./SheetGuard";
import { UnsavedPrompt } from "./UnsavedPrompt";
import { AutomationCount, VitalsStrip } from "./SheetHeader";
import { SheetMenu, type SheetToast } from "./SheetMenu";
import { ScopedTabs, type SheetTabId } from "./ScopedTabs";
import { StatsTab } from "./sheet-tabs/StatsTab";
import { ActionsTab } from "./sheet-tabs/ActionsTab";
import { TokenTab } from "./sheet-tabs/TokenTab";
import { StyleSwitch } from "./StyleSwitch";
import { SHEET_STYLES } from "./styles/registry";
import abilityStyles from "./abilities/abilities.module.css";
import styles from "./sheet.module.css";

// The Codex's code, styles and font load the first time one opens (plan D11).
const CodexSheet = lazy(() => import("./codex/CodexSheet").then((module) => ({ default: module.CodexSheet })));
/** A popped-out sheet's first size, until one has been popped out and sized (then that's remembered, per style). */
const POPUP_SIZE: PopupBounds = { width: 760, height: 900 };

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
  const popOutWindow = useSheetWindowsStore((s) => s.popOut);
  const setWindowStyle = useSheetWindowsStore((s) => s.setStyle);
  const palette = useSheetWindowsStore((s) => s.palette);
  const setPalette = useSheetWindowsStore((s) => s.setPalette);
  const dockWindow = useSheetWindowsStore((s) => s.dock);
  const undo = useEncounterStore((s) => s.undo);
  const redo = useEncounterStore((s) => s.redo);
  const tab = sheet.tab;
  const popup = sheet.popup;
  // The body, rendered once into a node that the frames take turns holding, so popping out or docking keeps what's open
  // inside (an ability being edited) as it was.
  const holder = useRelocatable(styles.frameContent);
  // The document this window is in when it isn't popped out (the main page's, unless a test puts it elsewhere).
  const inheritedDocument = useContext(OwnerDocumentContext);
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
  // The builder and Homebrew windows open in the main page: a popped-out sheet that opened one says so.
  const builderWindow = useBuilderUiStore((s) => s.window);
  const homebrewOpen = useBuilderUiStore((s) => s.homebrew);
  const seenBuilder = useRef({ builderWindow, homebrewOpen });
  useEffect(() => {
    const opened = (builderWindow !== null && builderWindow !== seenBuilder.current.builderWindow) || (homebrewOpen && !seenBuilder.current.homebrewOpen);
    seenBuilder.current = { builderWindow, homebrewOpen };
    if (opened && popup && front) setToast({ message: "Opened in the main window." });
  }, [builderWindow, homebrewOpen, popup, front]);

  // Its token, or (gone a moment before the host moves the window on) another token of its creature.
  const combatant = encounter.combatants.find((candidate) => candidate.id === sheet.combatantId)
    ?? encounter.combatants.find((candidate) => shownDefinitionId(candidate) === sheet.definitionId);
  if (!combatant) return null;
  const definition = getDefinition(encounter, combatant);
  const tokens = tokensOf(encounter, definition.id);
  const status = libraryStatus(definition, definitionsLibrary, templateDefinitionIds);
  const scope = creatureScope(encounter, definition, status);
  const kind: SheetKind = definition.character || combatant.faction === "party" ? "pc" : "other";
  const style = SHEET_STYLES[sheet.style];

  /** Run `action` now, or once the DM has answered "Save your changes?". */
  function attempt(action: () => void) {
    if (guardRef.current?.dirty) setPending(() => action);
    else action();
  }

  function setTab(next: SheetTabId) {
    setWindowTab(sheet.id, next);
  }

  /** Standard or the Codex, remembered for this kind of actor (D5). Asks first if an ability has unsaved changes. */
  function switchStyle(next: SheetStyle) {
    attempt(() => setWindowStyle(sheet.id, next, kind));
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
  const titleText = tokens.length > 1
    ? `${definition.name} · ${tokens.length} tokens`
    : combatant.displayName === definition.name ? definition.name : `${combatant.displayName} · ${definition.name}`;

  /** Into a browser window of its own (Part 2), where the last one of this style was, or a message if it was blocked. */
  function popOut() {
    const bounds = readJson<PopupBounds>(`popup:sheet-${sheet.style}`, POPUP_SIZE);
    const opened = openPopup(`battlesim-${sheet.id}`, bounds, `${titleText} — BattleSim`);
    if (!opened) {
      setToast({ message: "Your browser blocked the pop-out. Allow pop-ups for this site and try again." });
      return;
    }
    popOutWindow(sheet.id, opened);
  }

  /** The DM closed the browser window: a sheet with unsaved changes comes back into the page, any other closes. */
  function onPopupClosed() {
    if (guardRef.current?.dirty) dockWindow(sheet.id);
    else closeWindow(sheet.id);
  }

  const paletteItems: ContextMenuItem[] = sheet.style === "codex"
    ? [
        { heading: "Codex colours" },
        ...CODEX_PALETTE_IDS.map((id): ContextMenuItem => ({
          label: CODEX_PALETTES[id].label,
          checked: id === palette,
          onSelect: () => setPalette(id)
        }))
      ]
    : [];

  const controls = (
    <>
      <StyleSwitch style={sheet.style} onChange={switchStyle} />
      <AutomationCount definition={definition} combatant={combatant} onOpen={() => { if (tab !== "abilities") attempt(() => setTab("abilities")); }} />
      <SheetMenu
        combatant={combatant} definition={definition} status={status} guard={attempt} onToast={showToast}
        onOwnCreature={() => { setTab("stats"); setFocusName(true); }}
        onShowToken={switchToken}
        extraItems={paletteItems}
      />
      <InfoTooltip label="About automation levels" content={AUTOMATION_HELP} />
    </>
  );

  const prompt = pending ? (
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
  ) : null;

  const toastView = toast ? (
    // The Abilities tab's undo toast, for messages from the ⋯ menu and drops.
    <div className={abilityStyles.toast} role="status">
      <span>{toast.message}</span>
      {toast.undo ? (
        <button type="button" onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>
      ) : null}
    </div>
  ) : null;

  const body = holder ? createPortal(
    // Menus and tooltips inside open in the sheet's own document: the popup's while it's popped out.
    <OwnerDocumentContext.Provider value={popup ? popup.document : inheritedDocument}>
      {sheet.style === "codex" ? (
        <>
          {prompt ? <div className={styles.frameHead}>{prompt}</div> : null}
          <div className={styles.frameScroll}>
            <Suspense fallback={<p className={styles.loading}>Opening the Codex…</p>}>
              <CodexSheet combatant={combatant} definition={definition} tokens={tokens} onShowToken={switchToken} palette={palette} />
            </Suspense>
            {toastView}
          </div>
        </>
      ) : (
        <>
          <div className={styles.frameHead}>
            <VitalsStrip combatant={combatant} definition={definition} tokens={tokens} onShowToken={switchToken} />
            <ScopedTabs
              tab={tab} onSelect={(next) => attempt(() => setTab(next))}
              creature={definition.name} creatureCaption={scope.caption} creatureHelp={scope.help} token={combatant.displayName}
            />
            {prompt}
          </div>
          <div className={styles.frameScroll}>
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
            {toastView}
          </div>
        </>
      )}
    </OwnerDocumentContext.Provider>,
    holder
  ) : null;

  if (popup) {
    return (
      <>
        {body}
        <PopoutWindow popup={popup} title={`${titleText} — BattleSim`} onClosed={onPopupClosed} onBounds={(bounds) => writeJson(`popup:sheet-${sheet.style}`, bounds)}>
          <PopoutFrame
            title={title} ariaLabel={`${definition.name} sheet`} controls={controls}
            onUndo={undo} onRedo={redo} onDock={() => dockWindow(sheet.id)} onFocus={() => focusWindow(sheet.id)}
            dropActive={dropActive} onDragOver={onDragOver} onDragLeave={() => setDropActive(false)} onDrop={onDrop}
          >
            <RelocatableSlot node={holder} className={styles.frameSlot} />
          </PopoutFrame>
        </PopoutWindow>
      </>
    );
  }

  return (
    <>
      {body}
      {/* Keyed by style: each style is its own size, remembered apart (the body is relocatable, so nothing inside is lost). */}
      <FloatingWindow
        key={sheet.style}
        title={title}
        ariaLabel={`${definition.name} sheet`}
        width={style.width}
        resizable={style.limits}
        initialHeight={style.height}
        initialPosition={useSheetWindowsStore.getState().positions[sheet.id] ?? sheet.origin}
        storageKey={`sheet-${sheet.style}`}
        restorePosition={false}
        onMove={(position) => notePosition(sheet.id, position)}
        zIndex={rank}
        onFocus={() => focusWindow(sheet.id)}
        onClose={() => attempt(() => closeWindow(sheet.id))}
        onPopOut={popOut}
        scrollBody={false}
        headerExtra={controls}
        dropActive={dropActive}
        onDragOver={onDragOver}
        onDragLeave={() => setDropActive(false)}
        onDrop={onDrop}
      >
        <RelocatableSlot node={holder} className={styles.frameSlot} />
      </FloatingWindow>
    </>
  );
}
