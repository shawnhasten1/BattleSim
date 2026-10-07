"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { defaultFactionForDefinition } from "@/lib/ui-helpers";
import { isSrdMonsterId } from "@/data/srd/monsters";
import { readJson, writeJson } from "@/lib/persist";
import { useEncounterStore } from "@/store/encounter-store";
import { AppShell } from "@/components/shell/AppShell";
import { LeftToolRail } from "@/components/shell/LeftToolRail";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { clamp, getCellPoint } from "@/components/scene/coords";
import { deriveSceneMetrics } from "@/components/scene/metrics";
import { ActorsPanel } from "@/components/sidebar/ActorsPanel";
import { CombatPanel } from "@/components/sidebar/CombatPanel";
import { ScenePanel } from "@/components/sidebar/ScenePanel";
import { SheetWindowsHost } from "@/components/sheet/SheetWindowsHost";
import { BattleReport } from "@/components/combat/BattleReport";
import { CreateTokenModal } from "@/components/modals/CreateTokenModal";
import { SceneConfigModal } from "@/components/modals/SceneConfigModal";
import { BuilderHost } from "@/components/builder/BuilderHost";
import { useViewport } from "@/hooks/useViewport";
import { useSceneInteraction } from "@/hooks/useSceneInteraction";
import { useCompendium } from "@/hooks/useCompendium";
import { useSyncEncounterRoute, type EncounterRouteParams } from "@/hooks/useSyncEncounterRoute";
import type { CreatureDefinition } from "@/engine";
import { useCatalogStore } from "@/store/catalog-store";
import { useMyLibraryStore } from "@/store/my-library-store";
import { hasUnsavedLibraryEdits, useLibrarySyncStore } from "@/store/library-sync-store";
import { useSheetWindowsStore } from "@/store/sheet-windows-store";

/** Open the sheet of a token: the one given, or the selected one (a token just created, imported or built is selected). */
function openSheet(combatantId?: string) {
  const { selectedCombatantId, encounter } = useEncounterStore.getState();
  const id = combatantId ?? selectedCombatantId ?? encounter.combatants[0]?.id;
  if (id) useSheetWindowsStore.getState().open(id);
}

type SidebarTab = "actors" | "combat" | "scene";
const SIDEBAR_TABS: ReadonlyArray<{ id: SidebarTab; label: string }> = [
  { id: "actors", label: "Actors" },
  { id: "combat", label: "Combat" },
  { id: "scene", label: "Scene" }
];

interface EncounterEditorProps {
  /**
   * The campaign/encounter this instance was loaded for, when mounted at
   * `/campaigns/[id]/encounters/[encounterId]`. Null for the sandbox (`/`),
   * which has no canonical URL of its own — see useSyncEncounterRoute.
   */
  routeParams?: EncounterRouteParams | null;
}

/**
 * The full battle-sim editor shell: top bar, tool rail, canvas, sidebar, and
 * the floating sheet/report/modal windows. Reused by both the sandbox page
 * and the per-encounter route page — see EncounterRouteParams for how they differ.
 */
export function EncounterEditor({ routeParams = null }: EncounterEditorProps) {
  const encounter = useEncounterStore((s) => s.encounter);
  const definitionsLibrary = useEncounterStore((s) => s.definitionsLibrary);
  const loadProjects = useEncounterStore((s) => s.loadProjects);
  const loadDefinitionsLibrary = useEncounterStore((s) => s.loadDefinitionsLibrary);
  const loadActorFolders = useEncounterStore((s) => s.loadActorFolders);
  const addCreatureDefinition = useEncounterStore((s) => s.addCreatureDefinition);
  const addSrdMonster = useEncounterStore((s) => s.addSrdMonster);
  const addLibraryDefinitionToEncounter = useEncounterStore((s) => s.addLibraryDefinitionToEncounter);
  const addCreatureTokens = useEncounterStore((s) => s.addCreatureTokens);

  useSyncEncounterRoute(routeParams);

  const [rightTab, setRightTab] = useState<SidebarTab>("combat");
  const [showGrid, setShowGrid] = useState(true);
  const [showHealthBars, setShowHealthBars] = useState(true);
  const [showElevation, setShowElevation] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [modal, setModal] = useState<"create" | "scene" | null>(null);
  const [createFolderId, setCreateFolderId] = useState<string | null>(null);

  // Restore small view prefs after mount (keeps SSR output stable), then persist
  // on change. The `prefsReady` gate keeps the persist effects from firing
  // before the restore has run.
  const [prefsReady, setPrefsReady] = useState(false);
  useEffect(() => {
    const savedTab = readJson<SidebarTab>("sidebarTab", "combat");
    if (SIDEBAR_TABS.some((t) => t.id === savedTab)) setRightTab(savedTab);
    setShowGrid(readJson("showGrid", true));
    setShowHealthBars(readJson("showHealthBars", true));
    setShowElevation(readJson("showElevation", true));
    setPrefsReady(true);
  }, []);
  useEffect(() => {
    if (prefsReady) writeJson("sidebarTab", rightTab);
  }, [prefsReady, rightTab]);
  useEffect(() => {
    if (prefsReady) writeJson("showGrid", showGrid);
  }, [prefsReady, showGrid]);
  useEffect(() => {
    if (prefsReady) writeJson("showHealthBars", showHealthBars);
  }, [prefsReady, showHealthBars]);
  useEffect(() => {
    if (prefsReady) writeJson("showElevation", showElevation);
  }, [prefsReady, showElevation]);

  // Each scene keeps its own view (keyed like its background image).
  const sceneKey = useEncounterStore((state) => state.currentEncounterId ?? state.encounter.id);
  const viewport = useViewport(sceneKey);
  const scene = useSceneInteraction({ isPanning: viewport.isPanning, isPanningRef: viewport.isPanningRef });
  const compendium = useCompendium({
    onCreatureImported: () => {
      setModal(null);
      openSheet();
    }
  });

  const cellSize = useMemo(() => deriveSceneMetrics(encounter.map).cellSize, [encounter.map]);
  const savedDefinitionIds = useMemo(
    () => new Set(definitionsLibrary.map((definition) => definition.id)),
    [definitionsLibrary]
  );
  const directory = useMemo(() => {
    const byId = new Map<string, CreatureDefinition>();
    for (const definition of definitionsLibrary) byId.set(definition.id, definition);
    for (const definition of encounter.definitions) byId.set(definition.id, definition);
    return [...byId.values()];
  }, [definitionsLibrary, encounter.definitions]);

  useEffect(() => {
    void loadProjects();
    void loadDefinitionsLibrary();
    void loadActorFolders();
    // The account's homebrew classes, subclasses, feats, backgrounds and species, for the character builder.
    void useCatalogStore.getState().load();
    // The abilities saved to My library, for Add ability on any creature.
    void useMyLibraryStore.getState().load();
  }, [loadActorFolders, loadDefinitionsLibrary, loadProjects]);

  // A change to a library actor is saved a moment after it's made: leaving before then asks first.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedLibraryEdits()) return;
      void useLibrarySyncStore.getState().flush();
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function onCanvasDragOver(event: DragEvent<HTMLDivElement>) {
    if (event.dataTransfer.types.includes("application/x-battle-sim-actor")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function onCanvasDrop(event: DragEvent<HTMLDivElement>) {
    const actorRaw = event.dataTransfer.getData("application/x-battle-sim-actor");
    if (!actorRaw) return;
    event.preventDefault();
    const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
    const cell = {
      x: clamp(point.x, 0, encounter.map.grid.width - 1),
      y: clamp(point.y, 0, encounter.map.grid.height - 1)
    };

    try {
      const payload = JSON.parse(actorRaw) as { definitionId?: string; faction?: "party" | "enemy"; count?: number };
      if (!payload.definitionId) return;
      if (isSrdMonsterId(payload.definitionId)) {
        // Bundled library monster: loaded on demand, and the scene's copy is reused if it's already there.
        void addSrdMonster(payload.definitionId, payload.faction ?? "enemy", cell, payload.count ?? 1);
        return;
      }
      const definition = directory.find((candidate) => candidate.id === payload.definitionId);
      if (!definition) return;
      const faction = payload.faction ?? defaultFactionForDefinition(definition);
      // As many as the Actors tab's "Add ×" said when the drag began.
      const count = payload.count ?? 1;
      if (savedDefinitionIds.has(payload.definitionId)) {
        void addLibraryDefinitionToEncounter(payload.definitionId, faction, cell, count);
      } else if (count > 1) {
        addCreatureTokens(definition, faction, count, cell);
      } else {
        addCreatureDefinition(definition, faction, cell);
      }
    } catch {
      // ignore malformed payload
    }
  }

  return (
    <>
      <AppShell
        topBar={
          <TopBar
            onOpenBuilder={() => {
              setModal("create");
              setRightTab("actors");
            }}
            onOpenSceneConfig={() => setModal("scene")}
            onOpenReport={() => setReportOpen(true)}
          />
        }
        rail={
          <LeftToolRail
            showGrid={showGrid}
            onToggleGrid={() => setShowGrid((value) => !value)}
            showElevation={showElevation}
            onToggleElevation={() => setShowElevation((value) => !value)}
            showHealthBars={showHealthBars}
            onToggleHealthBars={() => setShowHealthBars((value) => !value)}
          />
        }
        main={
          <SceneCanvas
            viewport={viewport}
            scene={scene}
            showGrid={showGrid}
            showElevation={showElevation}
            showHealthBars={showHealthBars}
            onCanvasDragOver={onCanvasDragOver}
            onCanvasDrop={onCanvasDrop}
            onEditActor={openSheet}
            onOpenReport={() => setReportOpen(true)}
          />
        }
        sidebar={
          <Sidebar tabs={SIDEBAR_TABS} activeId={rightTab} onSelect={(id) => setRightTab(id as SidebarTab)}>
            {rightTab === "actors" ? (
              <ActorsPanel
                onOpenCreate={(folderId) => {
                  setCreateFolderId(folderId ?? null);
                  setModal("create");
                }}
              />
            ) : null}
            {rightTab === "combat" ? <CombatPanel /> : null}
            {rightTab === "scene" ? <ScenePanel scene={scene} onOpenConfig={() => setModal("scene")} /> : null}
          </Sidebar>
        }
      />

      <SheetWindowsHost compendium={compendium} />
      {reportOpen ? <BattleReport onClose={() => setReportOpen(false)} /> : null}
      {modal === "create" ? (
        <CreateTokenModal
          compendium={compendium}
          targetFolderId={createFolderId}
          onCreated={() => openSheet()}
          onClose={() => {
            setModal(null);
            setCreateFolderId(null);
          }}
        />
      ) : null}
      {modal === "scene" ? <SceneConfigModal onClose={() => setModal(null)} /> : null}
      <BuilderHost onCreated={() => openSheet()} />
    </>
  );
}
