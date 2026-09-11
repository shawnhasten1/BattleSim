"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import type { CompendiumDragPayload } from "@/lib/compendium";
import { defaultFactionForDefinition } from "@/lib/ui-helpers";
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
import { CompendiumPanel } from "@/components/sidebar/CompendiumPanel";
import { ScenePanel } from "@/components/sidebar/ScenePanel";
import { ActorSheet } from "@/components/sheet/ActorSheet";
import { BattleReport } from "@/components/combat/BattleReport";
import { CreateTokenModal } from "@/components/modals/CreateTokenModal";
import { SceneConfigModal } from "@/components/modals/SceneConfigModal";
import { useViewport } from "@/hooks/useViewport";
import { useSceneInteraction } from "@/hooks/useSceneInteraction";
import { useCompendium } from "@/hooks/useCompendium";
import type { CreatureDefinition } from "@/engine";

type SidebarTab = "actors" | "compendium" | "combat" | "scene";
const SIDEBAR_TABS: ReadonlyArray<{ id: SidebarTab; label: string }> = [
  { id: "actors", label: "Actors" },
  { id: "compendium", label: "Compendium" },
  { id: "combat", label: "Combat" },
  { id: "scene", label: "Scene" }
];

export default function EncounterEditorPage() {
  const encounter = useEncounterStore((s) => s.encounter);
  const definitionsLibrary = useEncounterStore((s) => s.definitionsLibrary);
  const loadProjects = useEncounterStore((s) => s.loadProjects);
  const loadDefinitionsLibrary = useEncounterStore((s) => s.loadDefinitionsLibrary);
  const addCreatureDefinition = useEncounterStore((s) => s.addCreatureDefinition);
  const addLibraryDefinitionToEncounter = useEncounterStore((s) => s.addLibraryDefinitionToEncounter);

  const [rightTab, setRightTab] = useState<SidebarTab>("combat");
  const [showGrid, setShowGrid] = useState(true);
  const [showHealthBars, setShowHealthBars] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [modal, setModal] = useState<"create" | "scene" | null>(null);

  // Restore small view prefs after mount (keeps SSR output stable), then persist
  // on change. The `prefsReady` gate keeps the persist effects from firing
  // before the restore has run.
  const [prefsReady, setPrefsReady] = useState(false);
  useEffect(() => {
    const savedTab = readJson<SidebarTab>("sidebarTab", "combat");
    if (SIDEBAR_TABS.some((t) => t.id === savedTab)) setRightTab(savedTab);
    setShowGrid(readJson("showGrid", true));
    setShowHealthBars(readJson("showHealthBars", true));
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

  const viewport = useViewport();
  const scene = useSceneInteraction({ isPanning: viewport.isPanning, isPanningRef: viewport.isPanningRef });
  const compendium = useCompendium({ onCreatureImported: () => setModal(null) });

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
  }, [loadDefinitionsLibrary, loadProjects]);

  function onCanvasDragOver(event: DragEvent<HTMLDivElement>) {
    if (
      event.dataTransfer.types.includes("application/x-battle-sim-actor") ||
      event.dataTransfer.types.includes("application/x-battle-sim-compendium")
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function onCanvasDrop(event: DragEvent<HTMLDivElement>) {
    const actorRaw = event.dataTransfer.getData("application/x-battle-sim-actor");
    const compendiumRaw = event.dataTransfer.getData("application/x-battle-sim-compendium");
    if (!actorRaw && !compendiumRaw) return;
    event.preventDefault();
    const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
    const cell = {
      x: clamp(point.x, 0, encounter.map.grid.width - 1),
      y: clamp(point.y, 0, encounter.map.grid.height - 1)
    };

    if (actorRaw) {
      try {
        const payload = JSON.parse(actorRaw) as { definitionId?: string; faction?: "party" | "enemy" };
        if (!payload.definitionId) return;
        const definition = directory.find((candidate) => candidate.id === payload.definitionId);
        if (!definition) return;
        const faction = payload.faction ?? defaultFactionForDefinition(definition);
        if (savedDefinitionIds.has(payload.definitionId)) {
          addLibraryDefinitionToEncounter(payload.definitionId, faction, cell);
        } else {
          addCreatureDefinition(definition, faction, cell);
        }
      } catch {
        compendium.setStatus("Actor drop failed");
      }
      return;
    }

    try {
      const payload = JSON.parse(compendiumRaw) as CompendiumDragPayload;
      if (payload.resource !== "creature") {
        compendium.setStatus(`${payload.name} belongs on a token sheet`);
        return;
      }
      void compendium.importCreature(payload.slug || payload.objectKey, cell);
    } catch {
      compendium.setStatus("Compendium drop failed");
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
            showHealthBars={showHealthBars}
            onToggleHealthBars={() => setShowHealthBars((value) => !value)}
          />
        }
        main={
          <SceneCanvas
            viewport={viewport}
            scene={scene}
            showGrid={showGrid}
            showHealthBars={showHealthBars}
            onCanvasDragOver={onCanvasDragOver}
            onCanvasDrop={onCanvasDrop}
            onEditActor={() => setSheetOpen(true)}
          />
        }
        sidebar={
          <Sidebar tabs={SIDEBAR_TABS} activeId={rightTab} onSelect={(id) => setRightTab(id as SidebarTab)}>
            {rightTab === "actors" ? (
              <ActorsPanel
                compendium={compendium}
                onOpenCreate={() => setModal("create")}
                onOpenSheet={() => setSheetOpen(true)}
              />
            ) : null}
            {rightTab === "compendium" ? <CompendiumPanel compendium={compendium} /> : null}
            {rightTab === "combat" ? <CombatPanel /> : null}
            {rightTab === "scene" ? <ScenePanel scene={scene} onOpenConfig={() => setModal("scene")} /> : null}
          </Sidebar>
        }
      />

      {sheetOpen ? <ActorSheet compendium={compendium} onClose={() => setSheetOpen(false)} /> : null}
      {reportOpen ? <BattleReport onClose={() => setReportOpen(false)} /> : null}
      {modal === "create" ? <CreateTokenModal compendium={compendium} onClose={() => setModal(null)} /> : null}
      {modal === "scene" ? <SceneConfigModal onClose={() => setModal(null)} /> : null}
    </>
  );
}
