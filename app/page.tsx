"use client";

import {
  BrickWall,
  Copy,
  Download,
  Dices,
  FolderOpen,
  ImagePlus,
  Import,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  SkipForward,
  Swords,
  Trash2,
  Undo2,
  Upload,
  UserPlus,
  Waypoints,
  X
} from "lucide-react";
import { type ChangeEvent, type MouseEvent, type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_GRID_VISUALS, DEFAULT_MAP_IMAGE_SETTINGS, abilityModifier, ENCOUNTER_SCHEMA_VERSION, findPath, getDefinition, getExecutableActions, gridDistance, lineOfEffect, parseCombatantPackage, resolveAttackBonus, resolveSaveDc, sizeFootprint, type Ability, type ActionDefinition, type CombatantExportPackage, type CombatantState, type CreatureDefinition, type DamageType, type SpellDefinition } from "@/engine";
import { encounterSnapshotSchema } from "@/engine";
import { useEncounterStore, type EditorTool } from "@/store/encounter-store";

const defaultCellSize = DEFAULT_GRID_VISUALS.squareSizePx;

interface CreatureSearchResult {
  key: string;
  slug: string;
  name: string;
  documentKey?: string;
  documentTitle?: string;
}

interface SpellSearchResult {
  key: string;
  slug: string;
  name: string;
  level?: number;
  documentKey?: string;
  documentTitle?: string;
}

const abilities: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const damageTypes: DamageType[] = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

export default function EncounterEditorPage() {
  const {
    encounter,
    log,
    outcome,
    batchSummary,
    projects,
    projectStatus,
    definitionsLibrary,
    definitionStatus,
    selectedCombatantId,
    mapImageDataUrl,
    tool,
    pendingWallStart,
    setTool,
    handleMapClick,
    rollInitiativeNow,
    advanceTurn,
    runAuto,
    runBatch,
    reset,
    undo,
    redo,
    deleteLastWall,
    deleteLastTerrain,
    removeWall,
    moveWallNode,
    deleteWallNode,
    cancelWallPlacement,
    toggleDoorState,
    removeTerrain,
    loadProjects,
    saveProject,
    loadProject,
    deleteProject,
    loadDefinitionsLibrary,
    saveSelectedDefinition,
    addLibraryDefinitionToEncounter,
    deleteLibraryDefinition,
    selectCombatant,
    setMapImage,
    updateGrid,
    updateMapImageSettings,
    updateMapCanvas,
    updateHp,
    updateTactics,
    updateFactionTactics,
    updateResource,
    updateDefinitionResource,
    applyConditionToCombatant,
    clearConditions,
    replaceEncounter,
    addCreatureDefinition,
    importCombatantPackage,
    addCustomToken,
    updateCombatant,
    removeCombatant,
    updateCreatureDefinition,
    updateCreatureAbility,
    addWeapon,
    addSpell,
    attachSpellDefinition,
    addFeatureOrTrait,
    addStructuredAction,
    addMultiattack,
    removeDefinitionItem,
    mapBasicAttack,
    duplicateSelected
  } = useEncounterStore();
  const [createForm, setCreateForm] = useState({
    name: "Bandit",
    faction: "enemy" as "party" | "enemy",
    ac: 13,
    hp: 11,
    speed: 30,
    proficiencyBonus: 2,
    attackName: "Scimitar",
    attackType: "melee" as "melee" | "ranged",
    attackAbility: "str" as Ability,
    damageDice: "1d6",
    damageType: "slashing" as DamageType,
    abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 } as CreatureDefinition["abilities"]
  });
  const [weaponForm, setWeaponForm] = useState({ name: "Longsword", attackType: "melee" as "melee" | "ranged", ability: "str" as Ability, range: 5, reach: 5, damageDice: "1d8", damageType: "slashing" as DamageType });
  const [spellForm, setSpellForm] = useState({ name: "Fire Bolt", level: 0, castingTime: "action" as "action" | "bonus" | "reaction", ability: "int" as Ability, range: 120, damageDice: "1d10", damageType: "fire" as DamageType, resourceId: "" });
  const [featureForm, setFeatureForm] = useState({ category: "feature" as "feature" | "trait", name: "Pack Tactics", description: "", effectPreset: "pack-tactics" as "none" | "pack-tactics" | "swarm" | "defense" | "resource-regain" });
  const [actionForm, setActionForm] = useState({ kind: "attack" as "attack" | "save" | "area-save" | "healing", name: "Power Strike", actionType: "action" as "action" | "bonus", attackType: "melee" as "melee" | "ranged" | "spell", ability: "str" as Ability, saveAbility: "dex" as Ability, dc: 13, range: 5, areaSize: 20, damageDice: "1d8", damageType: "slashing" as DamageType });
  const [multiattackForm, setMultiattackForm] = useState({ name: "Multiattack", actionIds: [] as string[], count: 2 });
  const [resourceForm, setResourceForm] = useState({ resourceId: "slot-1", current: 1, maximum: 1 });
  const [query, setQuery] = useState("goblin");
  const [searchResults, setSearchResults] = useState<CreatureSearchResult[]>([]);
  const [spellQuery, setSpellQuery] = useState("fire bolt");
  const [spellSearchResults, setSpellSearchResults] = useState<SpellSearchResult[]>([]);
  const [importStatus, setImportStatus] = useState<string>("");
  const [activeModal, setActiveModal] = useState<"create" | "edit" | null>(null);
  const [wallCursorPoint, setWallCursorPoint] = useState<{ x: number; y: number } | null>(null);
  const [selectedWallNode, setSelectedWallNode] = useState<{ x: number; y: number } | null>(null);
  const [draggingWallNode, setDraggingWallNode] = useState(false);
  const [wallDragPoint, setWallDragPoint] = useState<{ x: number; y: number } | null>(null);
  const logEndRef = useRef<HTMLLIElement | null>(null);
  const suppressNextMapClickRef = useRef(false);
  const gridSettings = {
    ...DEFAULT_GRID_VISUALS,
    ...encounter.map.grid
  };
  const imageSettings = {
    ...DEFAULT_MAP_IMAGE_SETTINGS,
    ...encounter.map.image
  };
  const canvasSettings = encounter.map.canvas ?? {
    widthPx: encounter.map.grid.width * defaultCellSize,
    heightPx: encounter.map.grid.height * defaultCellSize
  };
  const cellSize = gridSettings.squareSizePx || defaultCellSize;
  const gridLineWidth = Math.max(0.5, gridSettings.lineWidthPx ?? DEFAULT_GRID_VISUALS.lineWidthPx);
  const gridLineColor = gridSettings.lineColor || DEFAULT_GRID_VISUALS.lineColor;
  const gridLineOpacity = Math.min(1, Math.max(0, gridSettings.lineOpacity ?? DEFAULT_GRID_VISUALS.lineOpacity));
  const gridPixelWidth = encounter.map.grid.width * cellSize;
  const gridPixelHeight = encounter.map.grid.height * cellSize;
  const scenePixelWidth = Math.max(canvasSettings.widthPx, gridPixelWidth);
  const scenePixelHeight = Math.max(canvasSettings.heightPx, gridPixelHeight);
  const activeWallNode = draggingWallNode && wallDragPoint ? wallDragPoint : selectedWallNode;
  const displayWalls = useMemo(() => {
    if (!selectedWallNode || !wallDragPoint) {
      return encounter.map.walls;
    }
    return encounter.map.walls.map((wall) => ({
      ...wall,
      start: pointsMatch(wall.start, selectedWallNode) ? wallDragPoint : wall.start,
      end: pointsMatch(wall.end, selectedWallNode) ? wallDragPoint : wall.end
    }));
  }, [encounter.map.walls, selectedWallNode, wallDragPoint]);
  const wallNodes = useMemo(() => uniqueWallNodes(displayWalls), [displayWalls]);

  const selectedCombatant = encounter.combatants.find((combatant) => combatant.id === selectedCombatantId) ?? encounter.combatants[0];
  const selectedDefinition = selectedCombatant ? getDefinition(encounter, selectedCombatant) : null;
  const selectedActions = selectedDefinition ? getExecutableActions(selectedDefinition) : [];
  const selectedAttackActions = selectedActions.filter((action) => action.kind === "attack");
  const selectedResourceIds = selectedCombatant && selectedDefinition
    ? resourceIdsForEditor(selectedDefinition, selectedCombatant)
    : [];
  const enemies = encounter.combatants.filter((combatant) => combatant.faction !== selectedCombatant?.faction && combatant.state === "active");
  const nearestEnemy = selectedCombatant
    ? [...enemies].sort((a, b) => gridDistance(selectedCombatant.position, a.position, encounter.map.grid)
      - gridDistance(selectedCombatant.position, b.position, encounter.map.grid))[0]
    : null;
  const selectedTacticsProfile = selectedCombatant?.tacticsProfile ?? "basic-melee";
  const currentCombatant = encounter.round > 0 ? encounter.combatants[encounter.turnIndex] ?? null : null;
  const currentDefinition = currentCombatant ? getDefinition(encounter, currentCombatant) : null;
  const currentTurnEvents = currentCombatant
    ? log.filter((entry) => entry.round === encounter.round && entry.turnIndex === encounter.turnIndex).slice(-5)
    : [];
  const latestTurnEvent = [...currentTurnEvents]
    .reverse()
    .find((entry) => entry.type === "AiDecision" || entry.type === "ActionDeclared" || entry.type === "AttackRolled" || entry.type === "SaveRolled" || entry.type === "AutomationWarning");
  const partyTactics = factionTacticsValue(encounter.combatants, "party");
  const enemyTactics = factionTacticsValue(encounter.combatants, "enemy");

  useEffect(() => {
    void loadProjects();
    void loadDefinitionsLibrary();
  }, [loadDefinitionsLibrary, loadProjects]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [log.length]);

  useEffect(() => {
    if (draggingWallNode) {
      return;
    }
    if (selectedWallNode && !wallNodes.some((node) => pointsMatch(node, selectedWallNode))) {
      setSelectedWallNode(null);
      setWallDragPoint(null);
      setDraggingWallNode(false);
    }
  }, [draggingWallNode, selectedWallNode, wallNodes]);

  const previewPath = useMemo(() => {
    if (!selectedCombatant || !nearestEnemy || !selectedDefinition) {
      return null;
    }
    return findPath(
      encounter.map,
      selectedCombatant.position,
      nearestEnemy.position,
      sizeFootprint(selectedDefinition.size),
      encounter.combatants
        .filter((combatant) => combatant.id !== selectedCombatant.id && combatant.id !== nearestEnemy.id && combatant.state === "active")
        .map((combatant) => combatant.position)
    );
  }, [encounter, nearestEnemy, selectedCombatant, selectedDefinition]);

  async function searchOpen5e() {
    setImportStatus("Searching");
    const response = await fetch(`/api/open5e/creatures?query=${encodeURIComponent(query)}&limit=10`);
    if (!response.ok) {
      setImportStatus("Search failed");
      return;
    }
    const data = await response.json() as { results: CreatureSearchResult[] };
    setSearchResults(data.results);
    setImportStatus(`${data.results.length} results`);
  }

  async function importCreature(slug: string) {
    setImportStatus("Importing");
    const response = await fetch(`/api/open5e/creatures/${encodeURIComponent(slug)}`);
    if (!response.ok) {
      setImportStatus("Import failed");
      return;
    }
    const data = await response.json() as { definition?: CreatureDefinition; error?: string };
    if (!data.definition?.id) {
      setImportStatus(data.error ?? "Import returned no creature definition");
      return;
    }
    addCreatureDefinition(data.definition, "enemy");
    setImportStatus("Imported as mapped creature");
    setActiveModal(null);
  }

  async function searchOpen5eSpells() {
    setImportStatus("Searching spells");
    const response = await fetch(`/api/open5e/spells?query=${encodeURIComponent(spellQuery)}&limit=10`);
    if (!response.ok) {
      setImportStatus("Spell search failed");
      return;
    }
    const data = await response.json() as { results: SpellSearchResult[] };
    setSpellSearchResults(data.results);
    setImportStatus(`${data.results.length} spell results`);
  }

  async function importSpell(slug: string) {
    if (!selectedDefinition) return;
    setImportStatus("Importing spell");
    const response = await fetch(`/api/open5e/spells/${encodeURIComponent(slug)}`);
    if (!response.ok) {
      setImportStatus("Spell import failed");
      return;
    }
    const data = await response.json() as { spell?: SpellDefinition; error?: string };
    if (!data.spell?.id) {
      setImportStatus(data.error ?? "Import returned no spell");
      return;
    }
    attachSpellDefinition(selectedDefinition.id, data.spell);
    setImportStatus("Spell attached as reference-only");
  }

  function onMapClick(event: MouseEvent<HTMLDivElement>) {
    if (suppressNextMapClickRef.current) {
      suppressNextMapClickRef.current = false;
      return;
    }
    if (!(event.target instanceof HTMLElement) || event.target.closest(".token")) {
      return;
    }
    const point = tool === "wall"
      ? getSnappedWallPoint(event.currentTarget, event.clientX, event.clientY, cellSize, encounter.map.grid.width, encounter.map.grid.height)
      : getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
    const { x, y } = point;
    const inBounds = tool === "wall"
      ? x >= 0 && y >= 0 && x <= encounter.map.grid.width && y <= encounter.map.grid.height
      : x >= 0 && y >= 0 && x < encounter.map.grid.width && y < encounter.map.grid.height;
    if (inBounds) {
      handleMapClick(point);
    }
  }

  function onMapPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (tool !== "wall") {
      return;
    }
    const point = getSnappedWallPoint(event.currentTarget, event.clientX, event.clientY, cellSize, encounter.map.grid.width, encounter.map.grid.height);
    setWallCursorPoint(point);
    if (draggingWallNode) {
      setWallDragPoint(point);
    }
  }

  function onMapPointerLeave() {
    setWallCursorPoint(null);
  }

  function onMapPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!draggingWallNode || !selectedWallNode || !wallDragPoint) {
      return;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    moveWallNode(selectedWallNode, wallDragPoint);
    setSelectedWallNode(wallDragPoint);
    setDraggingWallNode(false);
    setWallDragPoint(null);
    window.setTimeout(() => {
      suppressNextMapClickRef.current = false;
    }, 50);
  }

  function onWallNodePointerDown(event: PointerEvent<SVGCircleElement>, node: { x: number; y: number }) {
    event.preventDefault();
    event.stopPropagation();
    suppressNextMapClickRef.current = true;
    event.currentTarget.ownerSVGElement?.parentElement?.setPointerCapture?.(event.pointerId);
    setSelectedWallNode(node);
    setDraggingWallNode(true);
    setWallDragPoint(node);
  }

  function onImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setMapImage(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  function exportEncounter() {
    downloadJson(`${safeFileName(encounter.name)}.json`, { encounter, mapImageDataUrl });
  }

  function exportSelectedCombatant() {
    if (!selectedCombatant || !selectedDefinition) return;
    const { id, definitionId, initiative, actionEconomy, concentration, ...combatant } = selectedCombatant;
    const payload: CombatantExportPackage = {
      kind: "battle-sim-combatant",
      schemaVersion: ENCOUNTER_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      definition: structuredClone(selectedDefinition),
      combatant
    };
    downloadJson(`${safeFileName(selectedCombatant.displayName)}.${selectedCombatant.faction}.json`, payload);
  }

  async function importEncounter(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text) as { encounter?: unknown; mapImageDataUrl?: string | null };
    replaceEncounter(encounterSnapshotSchema.parse(parsed.encounter), parsed.mapImageDataUrl ?? null);
    event.target.value = "";
  }

  async function importCombatantJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const payload = parseCombatantJson(parsed);
      importCombatantPackage(payload);
      setImportStatus(`Imported ${payload.combatant?.displayName ?? payload.definition.name}`);
      setActiveModal(null);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Token import failed");
    } finally {
      event.target.value = "";
    }
  }

  function createCustomToken() {
    addCustomToken(createForm);
    setActiveModal(null);
    setCreateForm({ ...createForm, name: `${createForm.faction === "party" ? "PC" : "Enemy"} ${encounter.combatants.length + 1}` });
  }

  function deleteSelectedToken() {
    if (!selectedCombatant) return;
    removeCombatant(selectedCombatant.id);
    setActiveModal(null);
  }

  function addSelectedWeapon() {
    if (!selectedDefinition) return;
    addWeapon(selectedDefinition.id, weaponForm);
    setWeaponForm({ ...weaponForm, name: "New Weapon" });
  }

  function addSelectedSpell() {
    if (!selectedDefinition) return;
    addSpell(selectedDefinition.id, { ...spellForm, resourceId: spellForm.resourceId.trim() || undefined });
    setSpellForm({ ...spellForm, name: "New Spell" });
  }

  function addSelectedFeature() {
    if (!selectedDefinition || !featureForm.name.trim()) return;
    addFeatureOrTrait(selectedDefinition.id, featureForm);
    setFeatureForm({ ...featureForm, name: "", description: "", effectPreset: "none" });
  }

  function addSelectedAction() {
    if (!selectedDefinition) return;
    addStructuredAction(selectedDefinition.id, actionForm);
    setActionForm({ ...actionForm, name: "New Action" });
  }

  function toggleMultiattackAction(actionId: string) {
    setMultiattackForm((current) => ({
      ...current,
      actionIds: current.actionIds.includes(actionId)
        ? current.actionIds.filter((id) => id !== actionId)
        : [...current.actionIds, actionId]
    }));
  }

  function addSelectedMultiattack() {
    if (!selectedDefinition) return;
    addMultiattack(selectedDefinition.id, multiattackForm);
    setMultiattackForm({ ...multiattackForm, actionIds: [] });
  }

  function addSelectedResource() {
    if (!selectedCombatant || !selectedDefinition || !resourceForm.resourceId.trim()) return;
    const resourceId = resourceForm.resourceId.trim();
    updateResource(selectedCombatant.id, resourceId, resourceForm.current);
    updateDefinitionResource(selectedDefinition.id, resourceId, resourceForm.maximum);
    setResourceForm({ resourceId: "", current: 1, maximum: 1 });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>D&D Battle Simulator</h1>
          <span>{encounter.name} - autosaved locally</span>
        </div>
        <div className="toolbar">
          <button type="button" onClick={rollInitiativeNow} title="Roll initiative">
            <Dices size={18} />
            Initiative
          </button>
          <button type="button" onClick={advanceTurn} title="Step to the next combatant turn">
            <SkipForward size={18} />
            Step
          </button>
          <button type="button" onClick={() => void runAuto()} title="Run one automated encounter">
            <Swords size={18} />
            Run
          </button>
          <button type="button" onClick={() => runBatch(100)} title="Run 100 headless simulations">
            <Waypoints size={18} />
            Batch 100
          </button>
          <button type="button" onClick={reset} title="Reset encounter">
            <RotateCcw size={18} />
            Reset
          </button>
          <button type="button" onClick={undo} title="Undo">
            <Undo2 size={18} />
            Undo
          </button>
          <button type="button" onClick={redo} title="Redo">
            <Redo2 size={18} />
            Redo
          </button>
          <button type="button" onClick={() => void saveProject()} title="Save project">
            <Save size={18} />
            Save
          </button>
          <button type="button" onClick={exportEncounter} title="Export encounter JSON">
            <Import size={18} />
            Export
          </button>
        </div>
      </header>

      <section className="turn-status" aria-label="Current turn status">
        <div>
          <span>Round</span>
          <strong>{encounter.round || "-"}</strong>
        </div>
        <div>
          <span>Current</span>
          <strong>{currentCombatant?.displayName ?? "Not started"}</strong>
        </div>
        <div>
          <span>Tactic</span>
          <strong>{currentCombatant ? labelTactics(currentCombatant.tacticsProfile) : "-"}</strong>
        </div>
        <div>
          <span>HP</span>
          <strong>{currentCombatant && currentDefinition ? `${currentCombatant.currentHp}/${currentDefinition.maxHp}` : "-"}</strong>
        </div>
        <div className="turn-event-summary">
          <span>Latest</span>
          <strong>{latestTurnEvent?.message ?? (outcome ? `${outcome.winner ?? "No faction"} wins` : "Step to begin")}</strong>
        </div>
      </section>

      <section className="workspace">
        <aside className="left-panel">
          <div className="sidebar-heading">
            <div>
              <h2>Map Workspace</h2>
              <span>{encounter.map.grid.width} x {encounter.map.grid.height} grid, {encounter.map.grid.distancePerSquare} ft squares</span>
            </div>
            <strong>{encounter.map.walls.length + encounter.map.terrain.length}</strong>
          </div>

          <section className="sidebar-section">
            <div className="section-title">
              <h3>Setup</h3>
              <span>{mapImageDataUrl ? "Image loaded" : "No image"}</span>
            </div>
            <div className="quick-actions">
              <label className="upload primary-command">
                <ImagePlus size={18} />
                <span>Upload</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onImageUpload} />
              </label>
              <label className="upload">
                <Import size={18} />
                <span>Import</span>
                <input type="file" accept="application/json" onChange={importEncounter} />
              </label>
            </div>
            <div className="sidebar-metrics">
              <div><span>Scene</span><strong>{Math.round(canvasSettings.widthPx)} x {Math.round(canvasSettings.heightPx)}</strong></div>
              <div><span>Cell</span><strong>{cellSize}px</strong></div>
              <div><span>Grid</span><strong>{Math.round(gridLineOpacity * 100)}%</strong></div>
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-title">
              <h3>Draw</h3>
              <span>{tool === "wall" && pendingWallStart ? "Choose wall end" : tool === "terrain" ? "Paint terrain" : "Select tokens"}</span>
            </div>
            <div className="tool-grid">
              <ToolButton active={tool === "select"} tool="select" setTool={setTool} icon={<MousePointer2 size={18} />} label="Select" />
              <ToolButton active={tool === "wall"} tool="wall" setTool={setTool} icon={<BrickWall size={18} />} label={pendingWallStart ? "End Wall" : "Wall"} />
              <ToolButton active={tool === "terrain"} tool="terrain" setTool={setTool} icon={<Waypoints size={18} />} label="Terrain" />
            </div>
            <div className="tool-actions">
              <button type="button" onClick={cancelWallPlacement} disabled={!pendingWallStart}><X size={16} /> Finish Wall</button>
              <button type="button" onClick={deleteLastWall}><Trash2 size={16} /> Last Wall</button>
              <button type="button" onClick={deleteLastTerrain}><Trash2 size={16} /> Last Terrain</button>
            </div>
            {selectedWallNode ? (
              <div className="node-editor">
                <div className="section-title tight-title">
                  <h3>Selected Node</h3>
                  <button
                    type="button"
                    className="icon-danger"
                    onClick={() => {
                      deleteWallNode(selectedWallNode);
                      setSelectedWallNode(null);
                      setWallDragPoint(null);
                      setDraggingWallNode(false);
                    }}
                    title="Delete selected node"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="grid-form node-edit-grid">
                  <label>X <input type="number" value={selectedWallNode.x} min={0} max={encounter.map.grid.width} step={0.5} onChange={(event) => {
                    const next = { ...selectedWallNode, x: clamp(Number(event.target.value), 0, encounter.map.grid.width) };
                    moveWallNode(selectedWallNode, next);
                    setSelectedWallNode(next);
                  }} /></label>
                  <label>Y <input type="number" value={selectedWallNode.y} min={0} max={encounter.map.grid.height} step={0.5} onChange={(event) => {
                    const next = { ...selectedWallNode, y: clamp(Number(event.target.value), 0, encounter.map.grid.height) };
                    moveWallNode(selectedWallNode, next);
                    setSelectedWallNode(next);
                  }} /></label>
                </div>
              </div>
            ) : null}
          </section>

          <details className="sidebar-section compact-disclosure" open>
            <summary>
              <span>Layers</span>
              <small>{encounter.map.walls.length} walls, {encounter.map.terrain.length} terrain</small>
            </summary>
            <div className="layer-list">
              {encounter.map.walls.length === 0 && encounter.map.terrain.length === 0 ? (
                <p className="empty-panel">Draw walls or terrain to manage them here.</p>
              ) : null}
              {encounter.map.walls.map((wall, index) => (
                <div key={wall.id}>
                  <button type="button" onClick={() => toggleDoorState(wall.id)}>
                    <strong>Wall {index + 1}</strong>
                    <span>{wall.doorState ?? "wall"}</span>
                  </button>
                  <button type="button" onClick={() => removeWall(wall.id)} title="Remove wall"><Trash2 size={16} /></button>
                </div>
              ))}
              {encounter.map.terrain.map((terrain, index) => (
                <div key={terrain.id}>
                  <button type="button">
                    <strong>{terrain.name} {index + 1}</strong>
                    <span>{terrain.type}</span>
                  </button>
                  <button type="button" onClick={() => removeTerrain(terrain.id)} title="Remove terrain"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </details>

          <details className="sidebar-section compact-disclosure">
            <summary>
              <span>Grid & Image</span>
              <small>calibration</small>
            </summary>
            <div className="grid-form map-control-grid">
              <label>Columns <input type="number" value={encounter.map.grid.width} min={4} max={80} onChange={(event) => updateGrid({ width: Number(event.target.value) })} /></label>
              <label>Rows <input type="number" value={encounter.map.grid.height} min={4} max={80} onChange={(event) => updateGrid({ height: Number(event.target.value) })} /></label>
              <label>Scene W <input type="number" value={Math.round(canvasSettings.widthPx)} min={120} max={5000} onChange={(event) => updateMapCanvas({ widthPx: Number(event.target.value) })} /></label>
              <label>Scene H <input type="number" value={Math.round(canvasSettings.heightPx)} min={120} max={5000} onChange={(event) => updateMapCanvas({ heightPx: Number(event.target.value) })} /></label>
              <label>Grid px <input type="number" value={cellSize} min={20} max={160} onChange={(event) => updateGrid({ squareSizePx: Number(event.target.value) })} /></label>
              <label>Feet/sq <input type="number" value={encounter.map.grid.distancePerSquare} min={1} max={20} onChange={(event) => updateGrid({ distancePerSquare: Number(event.target.value) })} /></label>
              <label>Line px <input type="number" value={gridLineWidth} min={0.5} max={4} step={0.5} onChange={(event) => updateGrid({ lineWidthPx: Number(event.target.value) })} /></label>
              <label>Color <input type="color" value={gridLineColor} onChange={(event) => updateGrid({ lineColor: event.target.value })} /></label>
              <label className="wide-field">
                <span>Grid opacity {Math.round(gridLineOpacity * 100)}%</span>
                <input type="range" value={gridLineOpacity} min={0} max={1} step={0.01} onChange={(event) => updateGrid({ lineOpacity: Number(event.target.value) })} />
              </label>
              <label>Image X <input type="number" value={imageSettings.offsetX} min={-500} max={500} onChange={(event) => updateMapImageSettings({ offsetX: Number(event.target.value) })} /></label>
              <label>Image Y <input type="number" value={imageSettings.offsetY} min={-500} max={500} onChange={(event) => updateMapImageSettings({ offsetY: Number(event.target.value) })} /></label>
              <label>Scale % <input type="number" value={imageSettings.scale} min={25} max={300} onChange={(event) => updateMapImageSettings({ scale: Number(event.target.value) })} /></label>
              <label>Opacity <input type="number" value={imageSettings.opacity} min={0} max={1} step={0.05} onChange={(event) => updateMapImageSettings({ opacity: Number(event.target.value) })} /></label>
              <label className="wide-field">
                <span>Image scale {Math.round(imageSettings.scale)}%</span>
                <input type="range" value={imageSettings.scale} min={25} max={300} step={1} onChange={(event) => updateMapImageSettings({ scale: Number(event.target.value) })} />
              </label>
              <button type="button" className="wide-command" onClick={() => updateMapImageSettings(DEFAULT_MAP_IMAGE_SETTINGS)}>Reset Image</button>
            </div>
          </details>

          <details className="sidebar-section compact-disclosure">
            <summary>
              <span>Tactics</span>
              <small>auto combat</small>
            </summary>
            <div className="faction-tactics">
              <label>
                <span>Party</span>
                <select value={partyTactics} onChange={(event) => updateFactionTactics("party", event.target.value as CombatantState["tacticsProfile"])}>
                  <option value="mixed" disabled>Mixed</option>
                  <option value="basic-melee">Basic melee</option>
                  <option value="basic-ranged">Basic ranged</option>
                  <option value="skirmisher">Skirmisher</option>
                  <option value="brute">Brute</option>
                  <option value="defender">Defender</option>
                  <option value="controller">Controller</option>
                </select>
              </label>
              <label>
                <span>Enemies</span>
                <select value={enemyTactics} onChange={(event) => updateFactionTactics("enemy", event.target.value as CombatantState["tacticsProfile"])}>
                  <option value="mixed" disabled>Mixed</option>
                  <option value="basic-melee">Basic melee</option>
                  <option value="basic-ranged">Basic ranged</option>
                  <option value="skirmisher">Skirmisher</option>
                  <option value="brute">Brute</option>
                  <option value="defender">Defender</option>
                  <option value="controller">Controller</option>
                </select>
              </label>
            </div>
          </details>

          <details className="sidebar-section compact-disclosure">
            <summary>
              <span>Projects</span>
              <small>{projects.length} saved</small>
            </summary>
            <button type="button" className="wide-command" onClick={() => void loadProjects()}><FolderOpen size={18} /> Refresh Projects</button>
            <span className="status-text">{projectStatus}</span>
            <div className="project-list">
              {projects.length === 0 ? <p className="empty-panel">No saved projects found.</p> : null}
              {projects.map((project) => (
                <div key={project.id}>
                  <button type="button" onClick={() => void loadProject(project.id)}>
                    <strong>{project.name}</strong>
                    <span>{new Date(project.updatedAt).toLocaleString()}</span>
                  </button>
                  <button type="button" title="Delete project" onClick={() => void deleteProject(project.id)}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </details>

          <details className="sidebar-section compact-disclosure">
            <summary>
              <span>Definitions</span>
              <small>{definitionsLibrary.length} sheets</small>
            </summary>
            <div className="quick-actions">
              <button type="button" className="wide-command" onClick={() => void saveSelectedDefinition()}><Save size={18} /> Save Sheet</button>
              <button type="button" className="wide-command" onClick={() => void loadDefinitionsLibrary()}><FolderOpen size={18} /> Refresh</button>
            </div>
            <span className="status-text">{definitionStatus}</span>
            <div className="definition-list">
              {definitionsLibrary.length === 0 ? <p className="empty-panel">No saved definitions found.</p> : null}
              {definitionsLibrary.map((definition) => (
                <div key={definition.id}>
                  <button type="button" onClick={() => addLibraryDefinitionToEncounter(definition.id, "party")}>
                    <strong>{definition.name}</strong>
                    <span>{definition.source?.documentName ?? definition.source?.provider ?? "homebrew"}</span>
                  </button>
                  <button type="button" onClick={() => addLibraryDefinitionToEncounter(definition.id, "enemy")} title="Add as enemy"><Swords size={16} /></button>
                  <button type="button" onClick={() => void deleteLibraryDefinition(definition.id)} title="Delete definition"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </details>
        </aside>

        <section className="map-stage" aria-label="Battlemap">
          <div
            className="battlemap"
            style={{
              width: scenePixelWidth,
              height: scenePixelHeight
            }}
            onClick={onMapClick}
            onPointerMove={onMapPointerMove}
            onPointerLeave={onMapPointerLeave}
            onPointerUp={onMapPointerUp}
          >
            {mapImageDataUrl ? (
              <img
                className="map-image-layer"
                src={mapImageDataUrl}
                alt=""
                draggable={false}
                style={{
                  width: canvasSettings.widthPx,
                  height: canvasSettings.heightPx,
                  opacity: imageSettings.opacity,
                  transform: `translate(${imageSettings.offsetX}px, ${imageSettings.offsetY}px) scale(${imageSettings.scale / 100})`
                }}
              />
            ) : null}
            <div
              className="grid-layer"
              style={{
                width: gridPixelWidth,
                height: gridPixelHeight,
                backgroundImage: `linear-gradient(to right, ${gridLineColor} ${gridLineWidth}px, transparent ${gridLineWidth}px), linear-gradient(to bottom, ${gridLineColor} ${gridLineWidth}px, transparent ${gridLineWidth}px)`,
                backgroundSize: `${cellSize}px ${cellSize}px`,
                borderColor: gridLineColor,
                borderWidth: gridLineWidth,
                opacity: gridLineOpacity
              }}
            />
            <svg
              className="overlay"
              viewBox={`0 0 ${encounter.map.grid.width} ${encounter.map.grid.height}`}
              style={{
                width: gridPixelWidth,
                height: gridPixelHeight
              }}
            >
              {encounter.map.terrain.map((zone) => (
                <polygon key={zone.id} points={zone.polygon.map((point) => `${point.x},${point.y}`).join(" ")} className={`terrain ${zone.type}`} />
              ))}
              {previewPath?.cells.map((cell, index) => (
                <rect key={`${cell.x}-${cell.y}-${index}`} x={cell.x + 0.16} y={cell.y + 0.16} width="0.68" height="0.68" className="path-cell" />
              ))}
              {displayWalls.map((wall) => (
                <line key={wall.id} x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y} className="wall-line" />
              ))}
              {tool === "wall" && pendingWallStart && wallCursorPoint && !pointsMatch(pendingWallStart, wallCursorPoint) ? (
                <line
                  x1={pendingWallStart.x}
                  y1={pendingWallStart.y}
                  x2={wallCursorPoint.x}
                  y2={wallCursorPoint.y}
                  className="wall-preview-line"
                />
              ) : null}
              {pendingWallStart ? <circle cx={pendingWallStart.x} cy={pendingWallStart.y} r="0.12" className="wall-start" /> : null}
              {tool === "wall" && wallCursorPoint ? <circle cx={wallCursorPoint.x} cy={wallCursorPoint.y} r="0.09" className="wall-cursor" /> : null}
              {wallNodes.map((node) => (
                <circle
                  key={`${node.x}-${node.y}`}
                  cx={node.x}
                  cy={node.y}
                  r="0.11"
                  className={`wall-node ${activeWallNode && pointsMatch(activeWallNode, node) ? "selected" : ""}`}
                  onPointerDown={(event) => onWallNodePointerDown(event, node)}
                />
              ))}
              {selectedCombatant && nearestEnemy ? (
                <line
                  x1={selectedCombatant.position.x + 0.5}
                  y1={selectedCombatant.position.y + 0.5}
                  x2={nearestEnemy.position.x + 0.5}
                  y2={nearestEnemy.position.y + 0.5}
                  className={lineOfEffect(encounter.map, selectedCombatant.position, nearestEnemy.position) ? "target-line clear" : "target-line blocked"}
                />
              ) : null}
            </svg>
            {encounter.combatants.map((combatant) => {
              const definition = getDefinition(encounter, combatant);
              const footprint = sizeFootprint(definition.size);
              return (
                <button
                  key={combatant.id}
                  type="button"
                  className={`token ${combatant.faction} ${combatant.state} ${combatant.id === selectedCombatant?.id ? "selected" : ""}`}
                  style={{
                    left: combatant.position.x * cellSize,
                    top: combatant.position.y * cellSize,
                    width: footprint * cellSize,
                    height: footprint * cellSize
                  }}
                  onClick={() => selectCombatant(combatant.id)}
                  title={combatant.displayName}
                >
                  {combatant.displayName.slice(0, 2)}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="right-panel">
          <h2>Tokens</h2>
          <button type="button" className="wide-command primary-command" onClick={() => setActiveModal("create")}>
            <UserPlus size={18} />
            Create Token
          </button>
          {selectedCombatant && selectedDefinition ? (
            <>
              <div className="selection-summary">
                <strong>{selectedCombatant.displayName}</strong>
                <span>{selectedDefinition.name} - {selectedCombatant.faction}</span>
                <div>
                  <span>AC {selectedDefinition.armorClass}</span>
                  <span>HP {selectedCombatant.currentHp}/{selectedDefinition.maxHp}</span>
                  <span>{selectedCombatant.state}</span>
                </div>
              </div>
              <div className="panel-actions">
                <button type="button" onClick={() => setActiveModal("edit")}><Swords size={18} /> Update</button>
                <button type="button" onClick={duplicateSelected}><Copy size={18} /> Duplicate</button>
                <button type="button" onClick={exportSelectedCombatant}><Download size={18} /> Export JSON</button>
                <button type="button" onClick={() => void saveSelectedDefinition()}><Save size={18} /> Save Sheet</button>
                <button type="button" className="danger-command" onClick={deleteSelectedToken}><Trash2 size={18} /> Delete</button>
              </div>
            </>
          ) : (
            <p className="empty-panel">Select a token on the map or create one.</p>
          )}
        </aside>
      </section>

      {activeModal === "create" ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Create token">
          <div className="modal-panel compact-modal">
            <div className="modal-heading">
              <div>
                <h2>Create Token</h2>
                <span>Build a custom combatant or add one from a saved/imported definition.</span>
              </div>
              <button type="button" onClick={() => setActiveModal(null)} title="Close"><X size={18} /></button>
            </div>
            <h3>Custom Token</h3>
            <label className="upload secondary-upload">
              <Upload size={18} />
              <span>Import Player / Enemy JSON</span>
              <input type="file" accept="application/json" onChange={importCombatantJson} />
            </label>
            <div className="builder-grid">
              <input value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} aria-label="Token name" />
              <select value={createForm.faction} onChange={(event) => setCreateForm({ ...createForm, faction: event.target.value as "party" | "enemy" })} aria-label="Faction">
                <option value="party">Party</option>
                <option value="enemy">Enemy</option>
              </select>
              <input type="number" value={createForm.ac} onChange={(event) => setCreateForm({ ...createForm, ac: Number(event.target.value) })} aria-label="Armor class" />
              <input type="number" value={createForm.hp} onChange={(event) => setCreateForm({ ...createForm, hp: Number(event.target.value) })} aria-label="Hit points" />
              <input type="number" value={createForm.speed} onChange={(event) => setCreateForm({ ...createForm, speed: Number(event.target.value) })} aria-label="Speed" />
              <input type="number" value={createForm.proficiencyBonus} onChange={(event) => setCreateForm({ ...createForm, proficiencyBonus: Number(event.target.value) })} aria-label="Proficiency bonus" />
            </div>
            <div className="ability-grid">
              {abilities.map((ability) => (
                <label key={ability}>
                  <span>{ability.toUpperCase()}</span>
                  <input type="number" value={createForm.abilities[ability]} onChange={(event) => setCreateForm({ ...createForm, abilities: { ...createForm.abilities, [ability]: Number(event.target.value) } })} />
                  <strong>{formatBonus(abilityModifier(createForm.abilities[ability]))}</strong>
                </label>
              ))}
            </div>
            <h3>Primary Attack</h3>
            <div className="builder-grid">
              <input value={createForm.attackName} onChange={(event) => setCreateForm({ ...createForm, attackName: event.target.value })} aria-label="Attack name" />
              <select value={createForm.attackType} onChange={(event) => setCreateForm({ ...createForm, attackType: event.target.value as "melee" | "ranged" })} aria-label="Attack type">
                <option value="melee">Melee</option>
                <option value="ranged">Ranged</option>
              </select>
              <SelectAbility value={createForm.attackAbility} onChange={(attackAbility) => setCreateForm({ ...createForm, attackAbility })} />
              <input value={createForm.damageDice} onChange={(event) => setCreateForm({ ...createForm, damageDice: event.target.value })} aria-label="Damage dice" />
              <SelectDamageType value={createForm.damageType} onChange={(damageType) => setCreateForm({ ...createForm, damageType })} />
            </div>
            <button type="button" className="wide-command primary-command" onClick={createCustomToken}><UserPlus size={18} /> Create Custom Token</button>
            <h3>Definition Library</h3>
            <div className="definition-list modal-list">
              {definitionsLibrary.map((definition) => (
                <div key={definition.id}>
                  <button type="button" onClick={() => { addLibraryDefinitionToEncounter(definition.id, "party"); setActiveModal(null); }}>
                    <strong>{definition.name}</strong>
                    <span>{definition.source?.documentName ?? definition.source?.provider ?? "homebrew"}</span>
                  </button>
                  <button type="button" onClick={() => { addLibraryDefinitionToEncounter(definition.id, "enemy"); setActiveModal(null); }} title="Add as enemy"><Swords size={16} /></button>
                  <button type="button" onClick={() => void deleteLibraryDefinition(definition.id)} title="Delete definition"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <h3>Open5e Creature</h3>
            <div className="search-row">
              <input value={query} onChange={(event) => setQuery(event.target.value)} />
              <button type="button" onClick={searchOpen5e} title="Search Open5e"><Search size={18} /></button>
            </div>
            <span className="status-text">{importStatus}</span>
            <div className="search-results modal-list">
              {searchResults.map((result, index) => (
                <button key={result.key || `${result.documentKey ?? "doc"}-${result.slug}-${index}`} type="button" onClick={() => void importCreature(result.slug)}>
                  <strong>{result.name}</strong>
                  <span>{result.documentTitle ?? result.documentKey ?? "Open5e"}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "edit" && selectedCombatant && selectedDefinition ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Update token">
          <div className="modal-panel">
            <div className="modal-heading">
              <div>
                <h2>Update Token</h2>
                <span>{selectedCombatant.displayName}</span>
              </div>
              <button type="button" onClick={() => setActiveModal(null)} title="Close"><X size={18} /></button>
            </div>
            <div className="modal-columns">
              <section>
                <h3>Token Instance</h3>
                <div className="builder-grid">
                  <input value={selectedCombatant.displayName} onChange={(event) => updateCombatant(selectedCombatant.id, { displayName: event.target.value })} aria-label="Token display name" />
                  <select value={selectedCombatant.faction} onChange={(event) => updateCombatant(selectedCombatant.id, { faction: event.target.value as typeof selectedCombatant.faction })} aria-label="Faction">
                    <option value="party">Party</option>
                    <option value="enemy">Enemy</option>
                    <option value="neutral">Neutral</option>
                  </select>
                  <select value={selectedCombatant.state} onChange={(event) => updateCombatant(selectedCombatant.id, { state: event.target.value as typeof selectedCombatant.state })} aria-label="State">
                    <option value="active">Active</option>
                    <option value="downed">Downed</option>
                    <option value="defeated">Defeated</option>
                    <option value="dead">Dead</option>
                    <option value="fled">Fled</option>
                  </select>
                  <input type="number" value={selectedCombatant.currentHp} onChange={(event) => updateHp(selectedCombatant.id, Number(event.target.value))} aria-label="Current HP" />
                  <input type="number" value={selectedCombatant.tempHp} onChange={(event) => updateCombatant(selectedCombatant.id, { tempHp: Number(event.target.value) })} aria-label="Temporary HP" />
                  <select value={selectedTacticsProfile} onChange={(event) => updateTactics(selectedCombatant.id, event.target.value as typeof selectedCombatant.tacticsProfile)} aria-label="Tactics">
                    <option value="basic-melee">Basic melee</option>
                    <option value="basic-ranged">Basic ranged</option>
                    <option value="skirmisher">Skirmisher</option>
                    <option value="brute">Brute</option>
                    <option value="defender">Defender</option>
                    <option value="controller">Controller</option>
                  </select>
                  <input type="number" value={selectedCombatant.position.x} onChange={(event) => updateCombatant(selectedCombatant.id, { position: { ...selectedCombatant.position, x: Number(event.target.value) } })} aria-label="X position" />
                  <input type="number" value={selectedCombatant.position.y} onChange={(event) => updateCombatant(selectedCombatant.id, { position: { ...selectedCombatant.position, y: Number(event.target.value) } })} aria-label="Y position" />
                </div>
                <h3>Sheet</h3>
                <div className="metric-grid">
                  <label><span>Name</span><input value={selectedDefinition.name} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { name: event.target.value })} /></label>
                  <label><span>AC</span><input type="number" value={selectedDefinition.armorClass} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { armorClass: Number(event.target.value) })} /></label>
                  <label><span>Max HP</span><input type="number" value={selectedDefinition.maxHp} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { maxHp: Number(event.target.value) })} /></label>
                  <label><span>Speed</span><input type="number" value={selectedDefinition.speed} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { speed: Number(event.target.value) })} /></label>
                  <label><span>Prof</span><input type="number" value={selectedDefinition.proficiencyBonus ?? 2} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { proficiencyBonus: Number(event.target.value) })} /></label>
                </div>
                <div className="builder-grid two-col sheet-meta">
                  <input value={selectedDefinition.character?.classes?.[0]?.name ?? ""} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { character: { ...(selectedDefinition.character ?? {}), classes: [{ name: event.target.value, level: selectedDefinition.character?.classes?.[0]?.level ?? selectedDefinition.character?.level ?? 1 }] } })} aria-label="Class" placeholder="Class" />
                  <input type="number" value={selectedDefinition.character?.level ?? selectedDefinition.character?.classes?.[0]?.level ?? 1} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { character: { ...(selectedDefinition.character ?? {}), level: Number(event.target.value), classes: [{ name: selectedDefinition.character?.classes?.[0]?.name ?? "", level: Number(event.target.value) }] } })} aria-label="Level" />
                </div>
                <h3>Abilities</h3>
                <div className="ability-grid">
                  {abilities.map((ability) => (
                    <label key={ability}>
                      <span>{ability.toUpperCase()}</span>
                      <input type="number" value={selectedDefinition.abilities[ability]} onChange={(event) => updateCreatureAbility(selectedDefinition.id, ability, Number(event.target.value))} />
                      <strong>{formatBonus(abilityModifier(selectedDefinition.abilities[ability]))}</strong>
                    </label>
                  ))}
                </div>
                <h3>Resources & Conditions</h3>
                <div className="resource-grid">
                  {selectedResourceIds.map((resourceId) => (
                    <label key={resourceId}>
                      <span>{resourceId}</span>
                      <input type="number" min={0} value={selectedCombatant.resources?.[resourceId] ?? 0} onChange={(event) => updateResource(selectedCombatant.id, resourceId, Number(event.target.value))} aria-label={`${resourceId} current`} />
                      <small>Default</small>
                      <input type="number" min={0} value={selectedDefinition.resources?.[resourceId] ?? 0} onChange={(event) => updateDefinitionResource(selectedDefinition.id, resourceId, Number(event.target.value))} aria-label={`${resourceId} default`} />
                    </label>
                  ))}
                </div>
                <div className="resource-builder">
                  <input value={resourceForm.resourceId} onChange={(event) => setResourceForm({ ...resourceForm, resourceId: event.target.value })} aria-label="Resource id" placeholder="slot-3" />
                  <input type="number" min={0} value={resourceForm.current} onChange={(event) => setResourceForm({ ...resourceForm, current: Number(event.target.value) })} aria-label="Current uses" />
                  <input type="number" min={0} value={resourceForm.maximum} onChange={(event) => setResourceForm({ ...resourceForm, maximum: Number(event.target.value) })} aria-label="Default uses" />
                  <button type="button" onClick={addSelectedResource} title="Add resource"><Plus size={16} /></button>
                </div>
                <div className="condition-row">
                  {(["poisoned", "prone", "restrained", "unconscious"] as const).map((condition) => (
                    <button key={condition} type="button" onClick={() => applyConditionToCombatant(selectedCombatant.id, condition)}>{condition}</button>
                  ))}
                  <button type="button" onClick={() => clearConditions(selectedCombatant.id)}>clear</button>
                </div>
                <div className="condition-list">
                  {(selectedCombatant.conditions ?? []).map((condition) => <span key={condition.id}>{condition.name}</span>)}
                </div>
              </section>
              <section>
                <h3>Weapons</h3>
                <div className="builder-grid">
                  <input value={weaponForm.name} onChange={(event) => setWeaponForm({ ...weaponForm, name: event.target.value })} aria-label="Weapon name" />
                  <select value={weaponForm.attackType} onChange={(event) => setWeaponForm({ ...weaponForm, attackType: event.target.value as "melee" | "ranged" })} aria-label="Weapon type"><option value="melee">Melee</option><option value="ranged">Ranged</option></select>
                  <SelectAbility value={weaponForm.ability} onChange={(ability) => setWeaponForm({ ...weaponForm, ability })} />
                  <input type="number" value={weaponForm.range} onChange={(event) => setWeaponForm({ ...weaponForm, range: Number(event.target.value) })} aria-label="Weapon range" />
                  <input value={weaponForm.damageDice} onChange={(event) => setWeaponForm({ ...weaponForm, damageDice: event.target.value })} aria-label="Weapon damage dice" />
                  <SelectDamageType value={weaponForm.damageType} onChange={(damageType) => setWeaponForm({ ...weaponForm, damageType })} />
                </div>
                <button type="button" className="wide-command" onClick={addSelectedWeapon}><Plus size={18} /> Add Weapon</button>
                <EditableItemList items={(selectedDefinition.weapons ?? []).map((weapon) => ({ id: weapon.id, name: weapon.name, detail: `${weapon.attackType} ${weapon.ability.toUpperCase()} ${weapon.damage.map((component) => `${component.dice} ${component.damageType}`).join(", ")}`, type: "weapon" as const }))} definitionId={selectedDefinition.id} removeDefinitionItem={removeDefinitionItem} />
                <h3>Spells</h3>
                <div className="builder-grid">
                  <input value={spellForm.name} onChange={(event) => setSpellForm({ ...spellForm, name: event.target.value })} aria-label="Spell name" />
                  <input type="number" value={spellForm.level} onChange={(event) => setSpellForm({ ...spellForm, level: Number(event.target.value) })} aria-label="Spell level" />
                  <select value={spellForm.castingTime} onChange={(event) => setSpellForm({ ...spellForm, castingTime: event.target.value as "action" | "bonus" | "reaction" })} aria-label="Casting time"><option value="action">Action</option><option value="bonus">Bonus</option><option value="reaction">Reaction</option></select>
                  <SelectAbility value={spellForm.ability} onChange={(ability) => setSpellForm({ ...spellForm, ability })} />
                  <input type="number" value={spellForm.range} onChange={(event) => setSpellForm({ ...spellForm, range: Number(event.target.value) })} aria-label="Spell range" />
                  <input value={spellForm.damageDice} onChange={(event) => setSpellForm({ ...spellForm, damageDice: event.target.value })} aria-label="Spell damage dice" />
                  <SelectDamageType value={spellForm.damageType} onChange={(damageType) => setSpellForm({ ...spellForm, damageType })} />
                  <input value={spellForm.resourceId} onChange={(event) => setSpellForm({ ...spellForm, resourceId: event.target.value })} aria-label="Spell resource" placeholder="slot-1" />
                </div>
                <button type="button" className="wide-command" onClick={addSelectedSpell}><Sparkles size={18} /> Add Spell</button>
                <EditableItemList items={(selectedDefinition.spells ?? []).map((spell) => ({ id: spell.id, name: spell.name, detail: `level ${spell.level} ${spell.castingTime} ${spell.range} ft ${formatAutomationSupport(spell.automationSupport)}`, type: "spell" as const }))} definitionId={selectedDefinition.id} removeDefinitionItem={removeDefinitionItem} />
                <h3>Features & Traits</h3>
                <div className="builder-grid two-col">
                  <select value={featureForm.category} onChange={(event) => setFeatureForm({ ...featureForm, category: event.target.value as "feature" | "trait" })} aria-label="Feature category"><option value="feature">Feature</option><option value="trait">Trait</option></select>
                  <input value={featureForm.name} onChange={(event) => setFeatureForm({ ...featureForm, name: event.target.value })} aria-label="Feature name" />
                  <select value={featureForm.effectPreset} onChange={(event) => setFeatureForm({ ...featureForm, effectPreset: event.target.value as typeof featureForm.effectPreset })} aria-label="Feature effect"><option value="none">Reference note</option><option value="pack-tactics">Pack Tactics</option><option value="swarm">Swarm Damage</option><option value="defense">Defense Bonus</option><option value="resource-regain">Regain Use</option></select>
                  <textarea value={featureForm.description} onChange={(event) => setFeatureForm({ ...featureForm, description: event.target.value })} aria-label="Feature description" />
                </div>
                <button type="button" className="wide-command" onClick={addSelectedFeature}><Plus size={18} /> Add Feature / Trait</button>
                <EditableItemList items={[...(selectedDefinition.features ?? []), ...(selectedDefinition.traits ?? [])].map((feature) => ({ id: feature.id, name: feature.name, detail: `${feature.category} - ${formatAutomationSupport(feature.automationSupport)}${feature.effects?.length ? ` - ${feature.effects.map((effect) => effect.kind).join(", ")}` : ""}`, type: feature.category }))} definitionId={selectedDefinition.id} removeDefinitionItem={removeDefinitionItem} />
                <h3>Actions & Bonus Actions</h3>
                <div className="builder-grid">
                  <input value={actionForm.name} onChange={(event) => setActionForm({ ...actionForm, name: event.target.value })} aria-label="Action name" />
                  <select value={actionForm.kind} onChange={(event) => setActionForm({ ...actionForm, kind: event.target.value as typeof actionForm.kind })} aria-label="Action kind"><option value="attack">Attack</option><option value="save">Save</option><option value="area-save">Area Save</option><option value="healing">Healing</option></select>
                  <select value={actionForm.actionType} onChange={(event) => setActionForm({ ...actionForm, actionType: event.target.value as "action" | "bonus" })} aria-label="Action timing"><option value="action">Action</option><option value="bonus">Bonus</option></select>
                  <select value={actionForm.attackType} onChange={(event) => setActionForm({ ...actionForm, attackType: event.target.value as "melee" | "ranged" | "spell" })} aria-label="Attack type"><option value="melee">Melee</option><option value="ranged">Ranged</option><option value="spell">Spell</option></select>
                  <SelectAbility value={actionForm.ability} onChange={(ability) => setActionForm({ ...actionForm, ability })} />
                  <SelectAbility value={actionForm.saveAbility} onChange={(saveAbility) => setActionForm({ ...actionForm, saveAbility })} />
                  <input type="number" value={actionForm.dc} onChange={(event) => setActionForm({ ...actionForm, dc: Number(event.target.value) })} aria-label="Save DC" />
                  <input type="number" value={actionForm.range} onChange={(event) => setActionForm({ ...actionForm, range: Number(event.target.value) })} aria-label="Action range" />
                  <input type="number" value={actionForm.areaSize} onChange={(event) => setActionForm({ ...actionForm, areaSize: Number(event.target.value) })} aria-label="Area size" />
                  <input value={actionForm.damageDice} onChange={(event) => setActionForm({ ...actionForm, damageDice: event.target.value })} aria-label="Action damage dice" />
                  <SelectDamageType value={actionForm.damageType} onChange={(damageType) => setActionForm({ ...actionForm, damageType })} />
                </div>
                <button type="button" className="wide-command" onClick={addSelectedAction}><Swords size={18} /> Add Action</button>
                <div className="multiattack-builder">
                  <input value={multiattackForm.name} onChange={(event) => setMultiattackForm({ ...multiattackForm, name: event.target.value })} aria-label="Multiattack name" />
                  <input type="number" min={1} value={multiattackForm.count} onChange={(event) => setMultiattackForm({ ...multiattackForm, count: Number(event.target.value) })} aria-label="Multiattack count" />
                  <div className="check-list">
                    {selectedAttackActions.map((action) => (
                      <label key={action.id}>
                        <input type="checkbox" checked={multiattackForm.actionIds.includes(action.id)} onChange={() => toggleMultiattackAction(action.id)} />
                        <span>{action.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button type="button" className="wide-command" onClick={addSelectedMultiattack}><Plus size={18} /> Add Multiattack</button>
                <EditableItemList items={selectedActions.map((action) => ({ id: action.id, name: action.name, detail: describeAction(action, selectedDefinition), type: action.actionType === "bonus" ? "bonusAction" as const : action.actionType === "reaction" ? "reaction" as const : "action" as const }))} definitionId={selectedDefinition.id} removeDefinitionItem={removeDefinitionItem} />
                <h3>Open5e Spell Import</h3>
                <div className="search-row">
                  <input value={spellQuery} onChange={(event) => setSpellQuery(event.target.value)} />
                  <button type="button" onClick={searchOpen5eSpells} title="Search Open5e spells"><Search size={18} /></button>
                </div>
                <div className="search-results modal-list">
                  {spellSearchResults.map((result, index) => (
                    <button key={result.key || `${result.documentKey ?? "doc"}-${result.slug}-${index}`} type="button" onClick={() => void importSpell(result.slug)}>
                      <strong>{result.name}</strong>
                      <span>level {result.level ?? 0} - {result.documentTitle ?? result.documentKey ?? "Open5e"}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="bottom-panel">
        <div className="initiative">
          {encounter.combatants.map((combatant) => (
            <button key={combatant.id} type="button" className={combatant.id === selectedCombatant?.id ? "active" : ""} onClick={() => selectCombatant(combatant.id)}>
              <span>{combatant.displayName}</span>
              <strong>{combatant.initiative ?? "-"}</strong>
            </button>
          ))}
        </div>
        <div className="report-panel">
          <div className="log-heading">
            <strong>{batchSummary ? "Batch Report" : "Combat Log"}</strong>
            <span>{outcome ? `${outcome.winner ?? "No winner"} after ${outcome.rounds} rounds` : "Ready"}</span>
          </div>
          {batchSummary ? (
            <>
              <div className="report-grid">
                <div><span>Party win</span><strong>{percent(batchSummary.partyWinRate)}</strong></div>
                <div><span>Enemy win</span><strong>{percent(batchSummary.enemyWinRate)}</strong></div>
                <div><span>TPK</span><strong>{percent(batchSummary.tpkRate)}</strong></div>
                <div><span>Avg rounds</span><strong>{batchSummary.rounds.average}</strong></div>
                <div><span>Difficulty</span><strong>{batchSummary.difficultyLabel}</strong></div>
                <div><span>Deaths</span><strong>{percent(batchSummary.characterDeathRate)}</strong></div>
                <div><span>P90 rounds</span><strong>{batchSummary.rounds.p90}</strong></div>
                <div><span>HP left</span><strong>{batchSummary.remainingHpByFaction.party ?? 0}</strong></div>
              </div>
              <div className="metrics-table">
                {batchSummary.damageByCombatant.map((metric) => (
                  <div key={metric.combatantId}>
                    <span>{metric.displayName}</span>
                    <strong>{metric.damageDealt} dealt</strong>
                    <strong>{metric.damageTaken} taken</strong>
                    <strong>{metric.endingHp} HP left</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <ol className="log-list">
              {(log.length ? log : [{ id: "empty", message: "No events recorded yet" }]).map((entry) => (
                <li key={entry.id}>
                  <span>{entry.message}</span>
                  {"type" in entry ? <small>{entry.type}</small> : null}
                  {"data" in entry && entry.data ? (
                    <details>
                      <summary>details</summary>
                      <pre>{JSON.stringify(entry.data, null, 2)}</pre>
                    </details>
                  ) : null}
                </li>
              ))}
              <li ref={logEndRef} className="log-end" aria-hidden="true" />
            </ol>
          )}
        </div>
      </footer>
    </main>
  );
}

function ToolButton({ active, tool, setTool, icon, label }: { active: boolean; tool: EditorTool; setTool: (tool: EditorTool) => void; icon: ReactNode; label: string }) {
  return <button type="button" className={`tool ${active ? "active" : ""}`} onClick={() => setTool(tool)}>{icon}{label}</button>;
}

function getCellPoint(element: HTMLElement, clientX: number, clientY: number, cellSize: number) {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.floor((clientX - rect.left) / cellSize),
    y: Math.floor((clientY - rect.top) / cellSize)
  };
}

function getSnappedWallPoint(element: HTMLElement, clientX: number, clientY: number, cellSize: number, width: number, height: number) {
  const rect = element.getBoundingClientRect();
  const x = (clientX - rect.left) / cellSize;
  const y = (clientY - rect.top) / cellSize;
  return {
    x: clamp(Math.round(x * 2) / 2, 0, width),
    y: clamp(Math.round(y * 2) / 2, 0, height)
  };
}

function uniqueWallNodes(walls: Array<{ start: { x: number; y: number }; end: { x: number; y: number } }>) {
  const nodes: Array<{ x: number; y: number }> = [];
  for (const wall of walls) {
    for (const point of [wall.start, wall.end]) {
      if (!nodes.some((node) => pointsMatch(node, point))) {
        nodes.push(point);
      }
    }
  }
  return nodes;
}

function pointsMatch(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type EditableItemType = "weapon" | "spell" | "feature" | "trait" | "action" | "bonusAction" | "reaction";

function EditableItemList({
  items,
  definitionId,
  removeDefinitionItem
}: {
  items: Array<{ id: string; name: string; detail: string; type: EditableItemType }>;
  definitionId: string;
  removeDefinitionItem: (definitionId: string, itemType: EditableItemType, itemId: string) => void;
}) {
  return (
    <div className="action-list compact-list">
      {items.map((item) => (
        <div key={`${item.type}-${item.id}`} className="action-item">
          <strong>{item.name}</strong>
          <span>{item.detail}</span>
          <button type="button" onClick={() => removeDefinitionItem(definitionId, item.type, item.id)} title={`Remove ${item.type}`}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SelectAbility({ value, onChange }: { value: Ability; onChange: (ability: Ability) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as Ability)} aria-label="Ability">
      {abilities.map((ability) => <option key={ability} value={ability}>{ability.toUpperCase()}</option>)}
    </select>
  );
}

function SelectDamageType({ value, onChange }: { value: DamageType; onChange: (damageType: DamageType) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as DamageType)} aria-label="Damage type">
      {damageTypes.map((damageType) => <option key={damageType} value={damageType}>{damageType}</option>)}
    </select>
  );
}

function describeAction(action: ActionDefinition, definition: CreatureDefinition): string {
  if (action.kind === "attack") return `${action.actionType} ${action.attackType} ${formatBonus(resolveAttackBonus(action, definition))}, ${action.damage.map((component) => `${component.dice}${component.abilityModifier ? ` + ${component.abilityModifier.toUpperCase()}` : ""} ${component.damageType}`).join(", ")}`;
  if (action.kind === "healing") return `healing ${action.range} ft`;
  if (action.kind === "unsupported") return "mapping required";
  if (action.kind === "activate-feature") return `${action.actionType} activates ${action.featureId}`;
  if (action.kind === "multiattack") return action.attacks.map((step) => `${step.count} x ${step.actionId}`).join(", ");
  return `${action.saveAbility.toUpperCase()} DC ${resolveSaveDc(action, definition)}`;
}

function formatAutomationSupport(value: string): string {
  return value === "manual-only" ? "reference-only" : value;
}

function labelTactics(value: CombatantState["tacticsProfile"]): string {
  switch (value) {
    case "basic-ranged":
      return "Basic ranged";
    case "skirmisher":
      return "Skirmisher";
    case "brute":
      return "Brute";
    case "defender":
      return "Defender";
    case "controller":
      return "Controller";
    case "basic-melee":
    default:
      return "Basic melee";
  }
}

function resourceIdsForEditor(definition: CreatureDefinition, combatant: CombatantState): string[] {
  const ids = new Set<string>();
  Object.keys(definition.resources ?? {}).forEach((resourceId) => ids.add(resourceId));
  Object.keys(combatant.resources ?? {}).forEach((resourceId) => ids.add(resourceId));
  getExecutableActions(definition).forEach((action) => {
    if ("resourceCost" in action && action.resourceCost?.resourceId) {
      ids.add(action.resourceCost.resourceId);
    }
  });
  if (ids.size === 0) {
    ids.add("limited-use");
  }
  return [...ids].sort((a, b) => resourceSortKey(a).localeCompare(resourceSortKey(b)) || a.localeCompare(b));
}

function resourceSortKey(resourceId: string): string {
  const slotMatch = /^slot-(\d+)$/.exec(resourceId);
  if (slotMatch) {
    return `00-slot-${slotMatch[1].padStart(2, "0")}`;
  }
  return `10-${resourceId}`;
}

function factionTacticsValue(
  combatants: CombatantState[],
  faction: CombatantState["faction"]
): CombatantState["tacticsProfile"] | "mixed" {
  const tactics = combatants
    .filter((combatant) => combatant.faction === faction)
    .map((combatant) => combatant.tacticsProfile);
  const first = tactics[0];
  if (!first) return "basic-melee";
  return tactics.every((candidate) => candidate === first) ? first : "mixed";
}

function parseCombatantJson(parsed: unknown): CombatantExportPackage {
  return parseCombatantPackage(parsed);
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "combatant";
}

function formatBonus(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
