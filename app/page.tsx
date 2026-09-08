"use client";

import {
  BookOpen,
  BrickWall,
  ChartColumn,
  Copy,
  Crosshair,
  Download,
  Dices,
  Eraser,
  FolderOpen,
  ImagePlus,
  Import,
  Layers,
  ListOrdered,
  MousePointer2,
  Move,
  Plus,
  Redo2,
  RotateCcw,
  Ruler,
  Save,
  Search,
  Settings,
  Shapes,
  Sparkles,
  SkipForward,
  Swords,
  Target,
  Trash2,
  Undo2,
  Upload,
  UserPlus,
  Users,
  Waypoints,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { type ChangeEvent, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode, type WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_GRID_VISUALS, DEFAULT_MAP_IMAGE_SETTINGS, abilityModifier, cellsInArea, combatantsInArea, ENCOUNTER_SCHEMA_VERSION, findPath, getDefinition, getExecutableActions, gridDistance, lineOfEffect, lineOfSight, parseCombatantPackage, resolveAttackBonus, resolveSaveDc, sizeFootprint, type Ability, type ActionDefinition, type AreaTemplate, type CombatantExportPackage, type CombatantState, type ConditionName, type CreatureDefinition, type DamageType, type FeatureDefinition, type PlacedTemplate, type SpellDefinition, type TerrainType, type WeaponDefinition } from "@/engine";
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

type CompendiumCategory = "all" | "creatures" | "spells" | "items" | "features" | "conditions";
type CompendiumResource = "creature" | "spell" | "item" | "weapon" | "feature" | "condition" | "rule";
type SheetTab = "token" | "summary" | "stats" | "actions" | "inventory" | "spells" | "features" | "resources" | "automation" | "tactics";

interface CompendiumSearchResult {
  key: string;
  objectKey: string;
  slug: string;
  name: string;
  resource: CompendiumResource;
  model?: string;
  route?: string;
  level?: number;
  documentKey?: string;
  documentTitle?: string;
  text?: string;
  highlighted?: string;
}

type CompendiumDragPayload = Pick<CompendiumSearchResult, "objectKey" | "slug" | "name" | "resource" | "model" | "route" | "level" | "documentKey" | "documentTitle" | "text">;

interface SheetItemSummary {
  id: string;
  name: string;
  detail: string;
  type: EditableItemType;
  source?: {
    provider?: string;
    documentKey?: string;
    documentName?: string;
    slug?: string;
    importedAt?: string;
  };
  description?: string;
  automationSupport?: string;
}

const abilities: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const damageTypes: DamageType[] = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const compendiumCategories: Array<{ id: CompendiumCategory; label: string }> = [
  { id: "creatures", label: "Creatures" },
  { id: "spells", label: "Spells" },
  { id: "items", label: "Items" },
  { id: "features", label: "Features" },
  { id: "conditions", label: "Conditions" },
  { id: "all", label: "All" }
];
const supportedConditions: ConditionName[] = [
  "blinded",
  "charmed",
  "deafened",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious"
];
const terrainTypes: TerrainType[] = ["normal", "difficult", "impassable", "hazard", "cover", "elevation", "custom"];
const templateTypes: AreaTemplate["type"][] = ["circle", "cone", "line", "square"];
const templateDirections: NonNullable<AreaTemplate["direction"]>[] = ["north", "east", "south", "west"];
const sheetTabs: Array<{ id: SheetTab; label: string }> = [
  { id: "token", label: "Token" },
  { id: "summary", label: "Summary" },
  { id: "stats", label: "Stats" },
  { id: "actions", label: "Actions" },
  { id: "inventory", label: "Inventory" },
  { id: "spells", label: "Spells" },
  { id: "features", label: "Features" },
  { id: "resources", label: "Resources" },
  { id: "automation", label: "Automation" },
  { id: "tactics", label: "Tactics" }
];
type SidebarTab = "encounters" | "actors" | "srd" | "combat" | "reports" | "settings";
type ViewportState = { x: number; y: number; zoom: number };

const minZoom = 0.3;
const maxZoom = 3;

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
    currentProjectId,
    currentEncounterId,
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
    updateWall,
    moveWallNode,
    deleteWallNode,
    cancelWallPlacement,
    toggleDoorState,
    updateTerrain,
    removeTerrain,
    addTemplate,
    updateTemplate,
    removeTemplate,
    loadProjects,
    saveProject,
    loadProject,
    deleteProject,
    createEncounter,
    loadEncounter,
    renameEncounter,
    duplicateEncounter,
    deleteEncounter,
    updateEncounterMetadata,
    loadDefinitionsLibrary,
    saveSelectedDefinition,
    saveDefinition,
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
    updateCombatantVisuals,
    updateDefinitionVisuals,
    removeCombatant,
    updateCreatureDefinition,
    updateCreatureAbility,
    addWeapon,
    addSpell,
    attachSpellDefinition,
    attachWeaponDefinition,
    attachFeatureDefinition,
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
  const [compendiumTab, setCompendiumTab] = useState<CompendiumCategory>("creatures");
  const [compendiumQuery, setCompendiumQuery] = useState("goblin");
  const [compendiumDocumentKey, setCompendiumDocumentKey] = useState("");
  const [compendiumResults, setCompendiumResults] = useState<CompendiumSearchResult[]>([]);
  const [importStatus, setImportStatus] = useState<string>("");
  const [activeModal, setActiveModal] = useState<"create" | "edit" | "scene" | "new-scene" | "rename-scene" | null>(null);
  const [rightTab, setRightTab] = useState<SidebarTab>("combat");
  const [activeSheetTab, setActiveSheetTab] = useState<SheetTab>("token");
  const [inspectedSheetItem, setInspectedSheetItem] = useState<SheetItemSummary | null>(null);
  const [sceneForm, setSceneForm] = useState({ name: "New Encounter" });
  const [renameSceneForm, setRenameSceneForm] = useState<{ id: string; name: string } | null>(null);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [sheetDropActive, setSheetDropActive] = useState(false);
  const [viewport, setViewport] = useState<ViewportState>({ x: 80, y: 72, zoom: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [spacePanning, setSpacePanning] = useState(false);
  const [wallCursorPoint, setWallCursorPoint] = useState<{ x: number; y: number } | null>(null);
  const [selectedWallNode, setSelectedWallNode] = useState<{ x: number; y: number } | null>(null);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedTerrainId, setSelectedTerrainId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [draggingWallNode, setDraggingWallNode] = useState(false);
  const [draggingTemplateId, setDraggingTemplateId] = useState<string | null>(null);
  const [wallDragPoint, setWallDragPoint] = useState<{ x: number; y: number } | null>(null);
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number } | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{ x: number; y: number } | null>(null);
  const [sightStart, setSightStart] = useState<{ x: number; y: number } | null>(null);
  const [sightEnd, setSightEnd] = useState<{ x: number; y: number } | null>(null);
  const [templateDraft, setTemplateDraft] = useState<Omit<PlacedTemplate, "id">>({
    name: "20 ft Circle",
    origin: { x: 0, y: 0 },
    area: { type: "circle", size: 20, direction: "east", width: 5 },
    affects: "all",
    color: "#287277"
  });
  const logEndRef = useRef<HTMLLIElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const panStartRef = useRef<{ clientX: number; clientY: number; x: number; y: number; pointerId: number } | null>(null);
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
  const selectedWall = selectedWallId ? encounter.map.walls.find((wall) => wall.id === selectedWallId) ?? null : null;
  const selectedTerrain = selectedTerrainId ? encounter.map.terrain.find((terrain) => terrain.id === selectedTerrainId) ?? null : null;
  const selectedTemplate = selectedTemplateId ? (encounter.map.templates ?? []).find((template) => template.id === selectedTemplateId) ?? null : null;
  const templatePreview = selectedTemplate ?? templateDraft;
  const definitionsById = useMemo(() => new Map(encounter.definitions.map((definition) => [definition.id, definition])), [encounter.definitions]);
  const templatePreviewCells = useMemo(() => cellsInArea(encounter.map, templatePreview.origin, templatePreview.area), [encounter.map, templatePreview]);
  const templateAffectedCombatants = useMemo(
    () => combatantsInArea(encounter.map, templatePreview.origin, templatePreview.area, encounter.combatants, definitionsById),
    [definitionsById, encounter.combatants, encounter.map, templatePreview]
  );

  const selectedCombatant = encounter.combatants.find((combatant) => combatant.id === selectedCombatantId) ?? encounter.combatants[0];
  const selectedDefinition = selectedCombatant ? getDefinition(encounter, selectedCombatant) : null;
  const selectedActions = selectedDefinition ? getExecutableActions(selectedDefinition) : [];
  const selectedAttackActions = selectedActions.filter((action) => action.kind === "attack");
  const selectedResourceIds = selectedCombatant && selectedDefinition
    ? resourceIdsForEditor(selectedDefinition, selectedCombatant)
    : [];
  const selectedWeaponItems: SheetItemSummary[] = selectedDefinition
    ? (selectedDefinition.weapons ?? []).map((weapon) => ({
      id: weapon.id,
      name: weapon.name,
      detail: `${weapon.attackType} ${weapon.ability.toUpperCase()} ${weapon.damage.map((component) => `${component.dice} ${component.damageType}`).join(", ")}`,
      type: "weapon" as const,
      source: weapon.source,
      automationSupport: "full",
      description: weapon.properties?.join(", ")
    }))
    : [];
  const selectedSpellItems: SheetItemSummary[] = selectedDefinition
    ? (selectedDefinition.spells ?? []).map((spell) => ({
      id: spell.id,
      name: spell.name,
      detail: `level ${spell.level} ${spell.castingTime} ${spell.range} ft ${formatAutomationSupport(spell.automationSupport)}`,
      type: "spell" as const,
      source: spell.source,
      automationSupport: spell.automationSupport,
      description: spell.description
    }))
    : [];
  const selectedFeatureItems: SheetItemSummary[] = selectedDefinition
    ? [...(selectedDefinition.features ?? []), ...(selectedDefinition.traits ?? [])].map((feature) => ({
      id: feature.id,
      name: feature.name,
      detail: `${feature.category} - ${formatAutomationSupport(feature.automationSupport)}${feature.effects?.length ? ` - ${feature.effects.map((effect) => effect.kind).join(", ")}` : ""}`,
      type: feature.category,
      source: feature.source,
      automationSupport: feature.automationSupport,
      description: feature.description
    }))
    : [];
  const selectedActionItems: SheetItemSummary[] = selectedDefinition
    ? selectedActions.map((action) => ({
      id: action.id,
      name: action.name,
      detail: describeAction(action, selectedDefinition),
      type: action.actionType === "bonus" ? "bonusAction" as const : action.actionType === "reaction" ? "reaction" as const : "action" as const,
      automationSupport: action.automationSupport,
      description: action.kind === "unsupported" ? action.description : undefined
    }))
    : [];
  const automationItems = [...selectedActionItems, ...selectedSpellItems, ...selectedFeatureItems, ...selectedWeaponItems];
  const automationCounts = automationItems.reduce((counts, item) => {
    const key = item.automationSupport ?? "manual-only";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const enemies = encounter.combatants.filter((combatant) => combatant.faction !== selectedCombatant?.faction && combatant.state === "active");
  const nearestEnemy = selectedCombatant
    ? [...enemies].sort((a, b) => gridDistance(selectedCombatant.position, a.position, encounter.map.grid)
      - gridDistance(selectedCombatant.position, b.position, encounter.map.grid))[0]
    : null;
  const selectedTacticsProfile = selectedCombatant?.tacticsProfile ?? "basic-melee";
  const occupiedCellsForSelected = selectedCombatant
    ? encounter.combatants
      .filter((combatant) => combatant.id !== selectedCombatant.id && combatant.state === "active")
      .map((combatant) => combatant.position)
    : [];
  const measuredDistance = measureStart && measureEnd ? gridDistance(measureStart, measureEnd, encounter.map.grid) : null;
  const measuredPath = measureStart && measureEnd && selectedDefinition
    ? findPath(encounter.map, measureStart, measureEnd, sizeFootprint(selectedDefinition.size), occupiedCellsForSelected)
    : null;
  const measuredPathCostFeet = measuredPath?.reachable ? measuredPath.cost * encounter.map.grid.distancePerSquare : null;
  const sightResult = sightStart && sightEnd
    ? {
      sight: lineOfSight(encounter.map, sightStart, sightEnd),
      effect: lineOfEffect(encounter.map, sightStart, sightEnd),
      distance: gridDistance(sightStart, sightEnd, encounter.map.grid)
    }
    : null;
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
  const activeProject = projects.find((project) => project.id === currentProjectId) ?? null;
  const projectScenes = activeProject?.encounters ?? [];
  const savedDefinitionIds = useMemo(() => new Set(definitionsLibrary.map((definition) => definition.id)), [definitionsLibrary]);
  const actorDirectoryDefinitions = useMemo(() => {
    const definitionsById = new Map<string, CreatureDefinition>();
    for (const definition of definitionsLibrary) {
      definitionsById.set(definition.id, definition);
    }
    for (const definition of encounter.definitions) {
      definitionsById.set(definition.id, definition);
    }
    return [...definitionsById.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [definitionsLibrary, encounter.definitions]);

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

  useEffect(() => {
    if (tool !== "measure") {
      setMeasureStart(null);
      setMeasureEnd(null);
    }
    if (tool !== "sight") {
      setSightStart(null);
      setSightEnd(null);
    }
  }, [tool]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code === "Space" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement)) {
        event.preventDefault();
        setSpacePanning(true);
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") {
        setSpacePanning(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

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

  async function importCreature(slug: string, position?: { x: number; y: number }) {
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
    addCreatureDefinition(data.definition, "enemy", position);
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

  async function importSpell(slug: string, definitionId = selectedDefinition?.id) {
    if (!definitionId) {
      setImportStatus("Select a token sheet first");
      return;
    }
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
    attachSpellDefinition(definitionId, data.spell);
    setImportStatus("Spell attached as reference-only");
  }

  async function searchCompendium(category = compendiumTab) {
    setImportStatus("Searching compendium");
    const params = new URLSearchParams({
      query: compendiumQuery,
      category,
      limit: "18"
    });
    if (compendiumDocumentKey.trim()) {
      params.set("documentKey", compendiumDocumentKey.trim());
    }
    const response = await fetch(`/api/open5e/compendium?${params.toString()}`);
    if (!response.ok) {
      setImportStatus("Compendium search failed");
      return;
    }
    const data = await response.json() as { results: CompendiumSearchResult[] };
    setCompendiumResults(data.results);
    setImportStatus(`${data.results.length} compendium results`);
  }

  function onCompendiumDragStart(event: DragEvent<HTMLElement>, result: CompendiumSearchResult) {
    const payload: CompendiumDragPayload = {
      objectKey: result.objectKey,
      slug: result.slug,
      name: result.name,
      resource: result.resource,
      model: result.model,
      route: result.route,
      level: result.level,
      documentKey: result.documentKey,
      documentTitle: result.documentTitle,
      text: result.text
    };
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-battle-sim-compendium", JSON.stringify(payload));
  }

  async function attachCompendiumToSheet(payload: CompendiumDragPayload, definitionId = selectedDefinition?.id, combatantId = selectedCombatant?.id) {
    if (!definitionId && payload.resource !== "condition") {
      setImportStatus("Select a token sheet first");
      return;
    }
    if (payload.resource === "creature") {
      await importCreature(payload.slug || payload.objectKey);
      return;
    }
    if (payload.resource === "spell") {
      await importSpell(payload.slug || payload.objectKey, definitionId);
      return;
    }
    if (payload.resource === "condition") {
      if (!combatantId) {
        setImportStatus("Select a token before applying a condition");
        return;
      }
      const condition = conditionFromCompendiumName(payload.name);
      if (!condition) {
        setImportStatus(`${payload.name} is manual-only`);
        return;
      }
      applyConditionToCombatant(combatantId, condition);
      setImportStatus(`${payload.name} applied`);
      return;
    }
    if (!definitionId) {
      return;
    }
    if (payload.resource === "item" || payload.resource === "weapon") {
      const imported = await importCompendiumContent(payload);
      if (imported?.weapon) {
        attachWeaponDefinition(definitionId, imported.weapon);
        setImportStatus("Weapon attached as structured attack");
        return;
      }
      if (imported?.feature) {
        attachFeatureDefinition(definitionId, imported.feature);
        setImportStatus("Item attached as manual-only reference");
        return;
      }
      setImportStatus("Item import returned no supported content");
      return;
    }
    attachFeatureDefinition(definitionId, featureFromCompendiumPayload(payload));
    setImportStatus("Feature attached as manual-only reference");
  }

  async function importCompendiumContent(payload: CompendiumDragPayload): Promise<{ weapon?: WeaponDefinition; feature?: FeatureDefinition } | null> {
    if (!payload.route || !payload.objectKey) {
      return { feature: featureFromCompendiumPayload(payload) };
    }
    const params = new URLSearchParams({
      route: payload.route,
      key: payload.objectKey
    });
    const response = await fetch(`/api/open5e/compendium/content?${params.toString()}`);
    if (!response.ok) {
      setImportStatus("Compendium import failed");
      return null;
    }
    return await response.json() as { weapon?: WeaponDefinition; feature?: FeatureDefinition };
  }

  function onSheetDragOver(event: DragEvent<HTMLElement>) {
    if (event.dataTransfer.types.includes("application/x-battle-sim-compendium")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setSheetDropActive(true);
    }
  }

  function onSheetDragLeave() {
    setSheetDropActive(false);
  }

  function onSheetDrop(event: DragEvent<HTMLElement>) {
    const raw = event.dataTransfer.getData("application/x-battle-sim-compendium");
    if (!raw) return;
    event.preventDefault();
    setSheetDropActive(false);
    try {
      void attachCompendiumToSheet(JSON.parse(raw) as CompendiumDragPayload);
    } catch {
      setImportStatus("Compendium drop failed");
    }
  }

  function zoomViewport(nextZoom: number, anchor?: { x: number; y: number }) {
    setViewport((current) => {
      const stage = stageRef.current;
      const zoom = clamp(nextZoom, minZoom, maxZoom);
      if (!stage || !anchor) {
        return { ...current, zoom };
      }
      const rect = stage.getBoundingClientRect();
      const anchorX = anchor.x - rect.left;
      const anchorY = anchor.y - rect.top;
      const worldX = (anchorX - current.x) / current.zoom;
      const worldY = (anchorY - current.y) / current.zoom;
      return {
        zoom,
        x: anchorX - worldX * zoom,
        y: anchorY - worldY * zoom
      };
    });
  }

  function onStageWheel(event: WheelEvent<HTMLElement>) {
    event.preventDefault();
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    zoomViewport(viewport.zoom * zoomFactor, { x: event.clientX, y: event.clientY });
  }

  function onStagePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 1 && !(event.button === 0 && spacePanning)) {
      return;
    }
    event.preventDefault();
    panStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      x: viewport.x,
      y: viewport.y,
      pointerId: event.pointerId
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function onStagePointerMove(event: PointerEvent<HTMLElement>) {
    const panStart = panStartRef.current;
    if (!panStart) {
      return;
    }
    event.preventDefault();
    setViewport((current) => ({
      ...current,
      x: panStart.x + event.clientX - panStart.clientX,
      y: panStart.y + event.clientY - panStart.clientY
    }));
  }

  function endPanning(event: PointerEvent<HTMLElement>) {
    const panStart = panStartRef.current;
    if (!panStart) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(panStart.pointerId)) {
      event.currentTarget.releasePointerCapture(panStart.pointerId);
    }
    panStartRef.current = null;
    setIsPanning(false);
  }

  function onMapClick(event: MouseEvent<HTMLDivElement>) {
    if (isPanning || panStartRef.current) {
      return;
    }
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
      if (tool === "template") {
        const id = addTemplate({ ...templateDraft, origin: point });
        setSelectedTemplateId(id);
        return;
      }
      if (tool === "sight") {
        if (!sightStart) {
          setSightStart(point);
          setSightEnd(point);
        } else {
          setSightEnd(point);
        }
        return;
      }
      if (tool === "measure") {
        if (!measureStart) {
          setMeasureStart(point);
          setMeasureEnd(point);
        } else {
          setMeasureEnd(point);
        }
        return;
      }
      handleMapClick(point);
    }
  }

  function onMapPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (isPanning || panStartRef.current) {
      return;
    }
    if (draggingTemplateId) {
      const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
      updateTemplate(draggingTemplateId, {
        origin: {
          x: clamp(point.x, 0, encounter.map.grid.width - 1),
          y: clamp(point.y, 0, encounter.map.grid.height - 1)
        }
      });
      return;
    }
    if (tool === "measure" && measureStart) {
      const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
      setMeasureEnd({
        x: clamp(point.x, 0, encounter.map.grid.width - 1),
        y: clamp(point.y, 0, encounter.map.grid.height - 1)
      });
      return;
    }
    if (tool === "sight" && sightStart) {
      const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
      setSightEnd({
        x: clamp(point.x, 0, encounter.map.grid.width - 1),
        y: clamp(point.y, 0, encounter.map.grid.height - 1)
      });
      return;
    }
    if (tool === "template" && !selectedTemplateId) {
      const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
      setTemplateDraft((current) => ({
        ...current,
        origin: {
          x: clamp(point.x, 0, encounter.map.grid.width - 1),
          y: clamp(point.y, 0, encounter.map.grid.height - 1)
        }
      }));
      return;
    }
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
    if (draggingTemplateId) {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDraggingTemplateId(null);
      window.setTimeout(() => {
        suppressNextMapClickRef.current = false;
      }, 50);
      return;
    }
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

  function onTemplatePointerDown(event: PointerEvent<SVGRectElement>, templateId: string) {
    event.preventDefault();
    event.stopPropagation();
    suppressNextMapClickRef.current = true;
    event.currentTarget.ownerSVGElement?.parentElement?.setPointerCapture?.(event.pointerId);
    setSelectedTemplateId(templateId);
    setSelectedWallId(null);
    setSelectedTerrainId(null);
    setDraggingTemplateId(templateId);
  }

  function onImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setMapImage(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  function onTokenImageUpload(event: ChangeEvent<HTMLInputElement>, scope: "token" | "definition") {
    const file = event.target.files?.[0];
    if (!file || !selectedCombatant || !selectedDefinition) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = typeof reader.result === "string" ? reader.result : undefined;
      if (!imageUrl) return;
      if (scope === "token") {
        updateCombatantVisuals(selectedCombatant.id, { imageUrl });
      } else {
        updateDefinitionVisuals(selectedDefinition.id, { imageUrl });
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function onActorDragStart(event: DragEvent<HTMLElement>, definition: CreatureDefinition, faction?: "party" | "enemy") {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-battle-sim-actor", JSON.stringify({
      definitionId: definition.id,
      faction: faction ?? defaultFactionForDefinition(definition)
    }));
  }

  function onCanvasDragOver(event: DragEvent<HTMLDivElement>) {
    if (event.dataTransfer.types.includes("application/x-battle-sim-actor") || event.dataTransfer.types.includes("application/x-battle-sim-compendium")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function onCanvasDrop(event: DragEvent<HTMLDivElement>) {
    const raw = event.dataTransfer.getData("application/x-battle-sim-actor");
    const compendiumRaw = event.dataTransfer.getData("application/x-battle-sim-compendium");
    if (!raw && !compendiumRaw) return;
    event.preventDefault();
    const point = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
    const clampedPoint = {
      x: clamp(point.x, 0, encounter.map.grid.width - 1),
      y: clamp(point.y, 0, encounter.map.grid.height - 1)
    };
    if (raw) {
      try {
        const payload = JSON.parse(raw) as { definitionId?: string; faction?: "party" | "enemy" };
        if (!payload.definitionId) return;
        const definition = actorDirectoryDefinitions.find((candidate) => candidate.id === payload.definitionId);
        if (!definition) return;
      if (savedDefinitionIds.has(payload.definitionId)) {
        addLibraryDefinitionToEncounter(payload.definitionId, payload.faction ?? defaultFactionForDefinition(definition), clampedPoint);
      } else {
        addCreatureDefinition(definition, payload.faction ?? defaultFactionForDefinition(definition), clampedPoint);
      }
      } catch {
        setImportStatus("Actor drop failed");
      }
      return;
    }
    try {
      const payload = JSON.parse(compendiumRaw) as CompendiumDragPayload;
      if (payload.resource !== "creature") {
        setImportStatus(`${payload.name} belongs on a token sheet`);
        return;
      }
      void importCreature(payload.slug || payload.objectKey, clampedPoint);
    } catch {
      setImportStatus("Compendium drop failed");
    }
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

  function openNewSceneModal() {
    setSceneForm({ name: `${encounter.name} Variant` });
    setActiveModal("new-scene");
  }

  function openRenameSceneModal(scene: { id: string; name: string }) {
    setRenameSceneForm({ id: scene.id, name: scene.name });
    setActiveModal("rename-scene");
  }

  async function createSceneFromForm() {
    await createEncounter(sceneForm.name);
    setActiveModal(null);
  }

  async function renameSceneFromForm() {
    if (!renameSceneForm) return;
    await renameEncounter(renameSceneForm.id, renameSceneForm.name);
    setActiveModal(null);
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
    <main className={`app-shell foundry-shell ${bottomPanelOpen ? "log-open" : "log-closed"} ${isPanning || spacePanning ? "pan-ready" : ""}`}>
      <header className="topbar scene-topbar">
        <div className="scene-title">
          <h1>{encounter.name}</h1>
          <span>{encounter.map.grid.width} x {encounter.map.grid.height}, {encounter.map.grid.distancePerSquare} ft squares, zoom {Math.round(viewport.zoom * 100)}%</span>
        </div>
        <div className="toolbar scene-toolbar">
          <button type="button" onClick={rollInitiativeNow} title="Roll initiative"><Dices size={18} /> Initiative</button>
          <button type="button" onClick={advanceTurn} title="Step to the next combatant turn"><SkipForward size={18} /> Step</button>
          <button type="button" onClick={() => void runAuto()} title="Run one automated encounter"><Swords size={18} /> Run</button>
          <button type="button" onClick={() => runBatch(100)} title="Run 100 headless simulations"><Waypoints size={18} /> Batch 100</button>
          <button type="button" onClick={undo} title="Undo"><Undo2 size={18} /> Undo</button>
          <button type="button" onClick={redo} title="Redo"><Redo2 size={18} /> Redo</button>
          <button type="button" onClick={() => void saveProject()} title="Save project"><Save size={18} /> Save</button>
          <button type="button" onClick={reset} title="Reset encounter"><RotateCcw size={18} /> Reset</button>
        </div>
      </header>

      <section className="scene-body">
        <aside className="left-tool-rail" aria-label="Scene tools">
          <ToolButton active={tool === "select"} tool="select" setTool={setTool} icon={<MousePointer2 size={20} />} label="Select" />
          <ToolButton active={tool === "move"} tool="move" setTool={setTool} icon={<Move size={20} />} label="Move" />
          <ToolButton active={tool === "measure"} tool="measure" setTool={setTool} icon={<Ruler size={20} />} label="Measure" />
          <ToolButton active={tool === "sight"} tool="sight" setTool={setTool} icon={<Target size={20} />} label="Sight" />
          <ToolButton active={tool === "wall"} tool="wall" setTool={setTool} icon={<BrickWall size={20} />} label={pendingWallStart ? "Wall End" : "Walls"} />
          <ToolButton active={tool === "terrain"} tool="terrain" setTool={setTool} icon={<Waypoints size={20} />} label="Terrain" />
          <ToolButton active={tool === "template"} tool="template" setTool={setTool} icon={<Shapes size={20} />} label="Template" />
          <ToolButton active={tool === "delete"} tool="delete" setTool={setTool} icon={<Eraser size={20} />} label="Delete" />
        </aside>

        <section
          ref={stageRef}
          className={`map-stage scene-stage ${isPanning ? "panning" : ""}`}
          aria-label="Battlemap scene"
          onWheel={onStageWheel}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={endPanning}
          onPointerCancel={endPanning}
        >
          <div className="scene-hud">
            <div>
              <span>Tool</span>
              <strong>{tool === "wall" && pendingWallStart ? "wall endpoint" : tool}</strong>
            </div>
            <div>
              <span>Scene</span>
              <strong>{Math.round(scenePixelWidth)} x {Math.round(scenePixelHeight)}</strong>
            </div>
            <div>
              <span>Cell</span>
              <strong>{cellSize}px</strong>
            </div>
          </div>
          <div className="viewport-controls" aria-label="Viewport controls">
            <button type="button" onClick={() => zoomViewport(viewport.zoom * 1.15)} title="Zoom in"><ZoomIn size={16} /></button>
            <button type="button" onClick={() => zoomViewport(viewport.zoom / 1.15)} title="Zoom out"><ZoomOut size={16} /></button>
            <button type="button" onClick={() => setViewport({ x: 80, y: 72, zoom: 1 })} title="Reset viewport"><Crosshair size={16} /></button>
          </div>
          <div
            className="battlemap scene-canvas"
            style={{
              width: scenePixelWidth,
              height: scenePixelHeight,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
            }}
            onClick={onMapClick}
            onPointerMove={onMapPointerMove}
            onPointerLeave={onMapPointerLeave}
            onPointerUp={onMapPointerUp}
            onDragOver={onCanvasDragOver}
            onDrop={onCanvasDrop}
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
                <polygon
                  key={zone.id}
                  points={zone.polygon.map((point) => `${point.x},${point.y}`).join(" ")}
                  className={`terrain ${zone.type} ${zone.id === selectedTerrainId ? "selected" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedTerrainId(zone.id);
                    setSelectedWallId(null);
                    setSelectedTemplateId(null);
                  }}
                />
              ))}
              {previewPath?.cells.map((cell, index) => (
                <rect key={`${cell.x}-${cell.y}-${index}`} x={cell.x + 0.16} y={cell.y + 0.16} width="0.68" height="0.68" className="path-cell" />
              ))}
              {measuredPath?.cells.map((cell, index) => (
                <rect key={`measure-path-${cell.x}-${cell.y}-${index}`} x={cell.x + 0.08} y={cell.y + 0.08} width="0.84" height="0.84" className={measuredPath.reachable ? "measured-path-cell" : "measured-path-cell blocked"} />
              ))}
              {(encounter.map.templates ?? []).map((template) => (
                <g key={template.id} className={`placed-template ${template.id === selectedTemplateId ? "selected" : ""}`}>
                  {cellsInArea(encounter.map, template.origin, template.area).map((cell) => (
                    <rect
                      key={`${template.id}-${cell.x}-${cell.y}`}
                      x={cell.x}
                      y={cell.y}
                      width="1"
                      height="1"
                      className="template-cell"
                      style={{ fill: template.color ?? undefined, stroke: template.color ?? undefined }}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedTemplateId(template.id);
                        setSelectedWallId(null);
                        setSelectedTerrainId(null);
                      }}
                      onPointerDown={(event) => onTemplatePointerDown(event, template.id)}
                    />
                  ))}
                  <text x={template.origin.x + 0.5} y={template.origin.y + 0.5} className="template-label">{template.area.size} ft</text>
                </g>
              ))}
              {tool === "template" && !selectedTemplate ? (
                <g className="template-layer draft-template">
                  {templatePreviewCells.map((cell) => (
                    <rect key={`draft-${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width="1" height="1" className="template-cell" style={{ fill: templateDraft.color, stroke: templateDraft.color }} />
                  ))}
                  <text x={templateDraft.origin.x + 0.5} y={templateDraft.origin.y + 0.5} className="template-label">{templateDraft.area.size} ft</text>
                </g>
              ) : null}
              {displayWalls.map((wall) => (
                <line
                  key={wall.id}
                  x1={wall.start.x}
                  y1={wall.start.y}
                  x2={wall.end.x}
                  y2={wall.end.y}
                  className={`wall-line ${wall.id === selectedWallId ? "selected" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedWallId(wall.id);
                    setSelectedTerrainId(null);
                    setSelectedTemplateId(null);
                  }}
                />
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
              {sightStart && sightEnd ? (
                <g className="sight-layer">
                  <line
                    x1={sightStart.x + 0.5}
                    y1={sightStart.y + 0.5}
                    x2={sightEnd.x + 0.5}
                    y2={sightEnd.y + 0.5}
                    className={sightResult?.sight && sightResult.effect ? "sight-line clear" : "sight-line blocked"}
                  />
                  <circle cx={sightStart.x + 0.5} cy={sightStart.y + 0.5} r="0.1" className="measure-point" />
                  <circle cx={sightEnd.x + 0.5} cy={sightEnd.y + 0.5} r="0.1" className="measure-point" />
                  <text x={(sightStart.x + sightEnd.x) / 2 + 0.5} y={(sightStart.y + sightEnd.y) / 2 + 0.3} className="measure-label">
                    {sightResult ? `${sightResult.distance} ft ${sightResult.sight ? "LOS" : "no LOS"} ${sightResult.effect ? "LOE" : "no LOE"}` : ""}
                  </text>
                </g>
              ) : null}
              {measureStart && measureEnd ? (
                <g className="measure-layer">
                  <line
                    x1={measureStart.x + 0.5}
                    y1={measureStart.y + 0.5}
                    x2={measureEnd.x + 0.5}
                    y2={measureEnd.y + 0.5}
                    className="measure-line"
                  />
                  <circle cx={measureStart.x + 0.5} cy={measureStart.y + 0.5} r="0.1" className="measure-point" />
                  <circle cx={measureEnd.x + 0.5} cy={measureEnd.y + 0.5} r="0.1" className="measure-point" />
                  <text
                    x={(measureStart.x + measureEnd.x) / 2 + 0.5}
                    y={(measureStart.y + measureEnd.y) / 2 + 0.3}
                    className="measure-label"
                  >
                    {measuredDistance} ft {measuredPath?.reachable ? `/ ${measuredPathCostFeet} ft path` : "/ blocked"}
                  </text>
                </g>
              ) : null}
            </svg>
            {encounter.combatants.map((combatant) => {
              const definition = getDefinition(encounter, combatant);
              const footprint = sizeFootprint(definition.size);
              const visuals = tokenVisualsFor(definition, combatant);
              const tokenImage = visuals.imageUrl;
              const tokenScale = clamp(visuals.scale ?? 1, 0.5, 1.5);
              return (
                <button
                  key={combatant.id}
                  type="button"
                  className={`token ${tokenImage ? "image-token" : ""} ${combatant.faction} ${combatant.state} ${combatant.id === selectedCombatant?.id ? "selected" : ""}`}
                  style={{
                    left: combatant.position.x * cellSize,
                    top: combatant.position.y * cellSize,
                    width: footprint * cellSize,
                    height: footprint * cellSize,
                    borderColor: visuals.borderColor ?? undefined
                  }}
                  onClick={() => tool === "delete" ? removeCombatant(combatant.id) : selectCombatant(combatant.id)}
                  title={combatant.displayName}
                >
                  {tokenImage ? (
                    <img
                      src={tokenImage}
                      alt=""
                      draggable={false}
                      style={{
                        transform: `scale(${tokenScale})`,
                        filter: visuals.tint ? `drop-shadow(0 0 5px ${visuals.tint})` : undefined
                      }}
                    />
                  ) : (
                    <span className="token-initials">{combatant.displayName.slice(0, 2)}</span>
                  )}
                  {visuals.showNameplate ? <span className="token-nameplate">{combatant.displayName}</span> : null}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="right-panel scene-sidebar">
          <nav className="sidebar-tabs" aria-label="Scene directories">
            <SidebarTabButton active={rightTab === "encounters"} tab="encounters" setTab={setRightTab} icon={<FolderOpen size={18} />} label="Encounters" />
            <SidebarTabButton active={rightTab === "actors"} tab="actors" setTab={setRightTab} icon={<Users size={18} />} label="Actors" />
            <SidebarTabButton active={rightTab === "srd"} tab="srd" setTab={setRightTab} icon={<BookOpen size={18} />} label="SRD" />
            <SidebarTabButton active={rightTab === "combat"} tab="combat" setTab={setRightTab} icon={<ListOrdered size={18} />} label="Combat" />
            <SidebarTabButton active={rightTab === "reports"} tab="reports" setTab={setRightTab} icon={<ChartColumn size={18} />} label="Reports" />
            <SidebarTabButton active={rightTab === "settings"} tab="settings" setTab={setRightTab} icon={<Settings size={18} />} label="Settings" />
          </nav>
          <div className="sidebar-tab-body">
            {rightTab === "encounters" ? (
              <>
                <div className="sidebar-heading">
                  <div>
                    <h2>Encounters</h2>
                    <span>{activeProject ? activeProject.name : "save to create a project"}</span>
                  </div>
                  <strong>{projectScenes.length || "-"}</strong>
                </div>
                <div className="quick-actions">
                  <button type="button" className="wide-command primary-command" onClick={() => void saveProject()}><Save size={18} /> Save Scene</button>
                  <button type="button" className="wide-command" onClick={openNewSceneModal}><Plus size={18} /> New Scene</button>
                  <button type="button" className="wide-command" onClick={() => void duplicateEncounter(currentEncounterId ?? undefined)}><Copy size={18} /> Duplicate</button>
                  <button type="button" className="wide-command" onClick={() => setActiveModal("scene")}><Settings size={18} /> Configure</button>
                  <label className="upload">
                    <Import size={18} />
                    <span>Import</span>
                    <input type="file" accept="application/json" onChange={importEncounter} />
                  </label>
                  <button type="button" className="wide-command" onClick={exportEncounter}><Download size={18} /> Export</button>
                </div>
                <button type="button" className="wide-command sidebar-command" onClick={() => void loadProjects()}><FolderOpen size={18} /> Refresh Projects</button>
                <span className="status-text">{projectStatus}</span>
                <div className="scene-directory">
                  {projects.length === 0 ? <p className="empty-panel">No saved projects found.</p> : null}
                  {projects.map((project) => (
                    <div key={project.id} className={`project-folder ${project.id === currentProjectId ? "active" : ""}`}>
                      <div className="project-folder-heading">
                        <button type="button" onClick={() => void loadProject(project.id)}>
                          <strong>{project.name}</strong>
                          <span>{new Date(project.updatedAt).toLocaleString()}</span>
                        </button>
                        <button type="button" title="Delete project" onClick={() => void deleteProject(project.id)}><Trash2 size={16} /></button>
                      </div>
                      <div className="scene-list">
                        {(project.encounters ?? []).length === 0 ? <p className="empty-panel">No encounters in this project.</p> : null}
                        {(project.encounters ?? []).map((scene) => (
                          <div key={scene.id} className={`scene-row ${scene.id === currentEncounterId ? "active" : ""}`}>
                            <button type="button" onClick={() => void loadEncounter(scene.id)}>
                              <strong>{scene.name}</strong>
                              <span>{scene.updatedAt ? new Date(scene.updatedAt).toLocaleString() : "saved scene"}</span>
                            </button>
                            <button type="button" title="Rename scene" onClick={() => openRenameSceneModal(scene)}><Settings size={15} /></button>
                            <button type="button" title="Duplicate scene" onClick={() => void duplicateEncounter(scene.id)}><Copy size={15} /></button>
                            <button type="button" title="Delete scene" onClick={() => void deleteEncounter(scene.id)}><Trash2 size={15} /></button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {rightTab === "actors" ? (
              <>
                <div className="sidebar-heading">
                  <div>
                    <h2>Actors</h2>
                    <span>{actorDirectoryDefinitions.length} available actors</span>
                  </div>
                  <strong>{encounter.combatants.length}</strong>
                </div>
                <button type="button" className="wide-command primary-command" onClick={() => setActiveModal("create")}><UserPlus size={18} /> Create Token</button>
                {selectedCombatant && selectedDefinition ? (
                  <>
                    <div className={`selection-summary actor-selection-summary sheet-drop-target ${sheetDropActive ? "drop-active" : ""}`} onDragOver={onSheetDragOver} onDragLeave={onSheetDragLeave} onDrop={onSheetDrop}>
                      <ActorThumbnail definition={selectedDefinition} combatant={selectedCombatant} />
                      <div>
                        <strong>{selectedCombatant.displayName}</strong>
                        <span>{selectedDefinition.name} - {selectedCombatant.faction}</span>
                        <div>
                          <span>AC {selectedDefinition.armorClass}</span>
                          <span>HP {selectedCombatant.currentHp}/{selectedDefinition.maxHp}</span>
                          <span>{selectedCombatant.state}</span>
                        </div>
                      </div>
                    </div>
                    <div className="panel-actions">
                      <button type="button" onClick={() => { setActiveSheetTab("token"); setActiveModal("edit"); }}><Swords size={18} /> Update</button>
                      <button type="button" onClick={duplicateSelected}><Copy size={18} /> Duplicate</button>
                      <button type="button" onClick={exportSelectedCombatant}><Download size={18} /> Export JSON</button>
                      <button type="button" onClick={() => void saveSelectedDefinition()}><Save size={18} /> Save Sheet</button>
                      <button type="button" className="danger-command" onClick={deleteSelectedToken}><Trash2 size={18} /> Delete</button>
                    </div>
                  </>
                ) : (
                  <p className="empty-panel">Select a token on the map or create one.</p>
                )}
                <div className="quick-actions sidebar-command">
                  <button type="button" className="wide-command" onClick={() => void saveSelectedDefinition()}><Save size={18} /> Save Sheet</button>
                  <button type="button" className="wide-command" onClick={() => void loadDefinitionsLibrary()}><FolderOpen size={18} /> Refresh</button>
                </div>
                <span className="status-text">{definitionStatus}</span>
                <div className="actor-directory">
                  {actorDirectoryDefinitions.length === 0 ? <p className="empty-panel">No actors found.</p> : null}
                  {actorDirectoryDefinitions.map((definition) => {
                    const isSaved = savedDefinitionIds.has(definition.id);
                    return (
                    <div
                      key={definition.id}
                      className="actor-card"
                      draggable
                      onDragStart={(event) => onActorDragStart(event, definition)}
                    >
                      <ActorThumbnail definition={definition} />
                      <button type="button" className="actor-card-main" onClick={() => isSaved ? addLibraryDefinitionToEncounter(definition.id, defaultFactionForDefinition(definition)) : addCreatureDefinition(definition, defaultFactionForDefinition(definition))}>
                        <strong>{definition.name}</strong>
                        <span>{isSaved ? definition.source?.documentName ?? definition.source?.provider ?? "homebrew" : "scene actor"}</span>
                      </button>
                      <button type="button" onClick={() => isSaved ? addLibraryDefinitionToEncounter(definition.id, "party") : addCreatureDefinition(definition, "party")} title="Add as party"><Users size={16} /></button>
                      <button type="button" onClick={() => isSaved ? addLibraryDefinitionToEncounter(definition.id, "enemy") : addCreatureDefinition(definition, "enemy")} title="Add as enemy"><Swords size={16} /></button>
                      <button type="button" onClick={() => isSaved ? void deleteLibraryDefinition(definition.id) : void saveDefinition(definition.id)} title={isSaved ? "Delete definition" : "Save sheet"}>{isSaved ? <Trash2 size={16} /> : <Save size={16} />}</button>
                    </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {rightTab === "srd" ? (
              <>
                <div className="sidebar-heading">
                  <div>
                    <h2>SRD Compendium</h2>
                    <span>Open5e V2 search</span>
                  </div>
                  <strong>{compendiumResults.length}</strong>
                </div>
                <div className="compendium-tabs" role="tablist" aria-label="Compendium sections">
                  {compendiumCategories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={compendiumTab === category.id ? "active" : ""}
                      onClick={() => {
                        setCompendiumTab(category.id);
                        void searchCompendium(category.id);
                      }}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
                <div className="search-row compendium-search-row">
                  <input value={compendiumQuery} onChange={(event) => setCompendiumQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchCompendium(); }} />
                  <button type="button" onClick={() => void searchCompendium()} title="Search Open5e"><Search size={18} /></button>
                </div>
                <input className="source-filter" value={compendiumDocumentKey} onChange={(event) => setCompendiumDocumentKey(event.target.value)} aria-label="Source document key" placeholder="source key" />
                <span className="status-text">{importStatus}</span>
                <div className="compendium-results">
                  {compendiumResults.map((result, index) => (
                    <div
                      key={result.key || `${result.documentKey ?? "doc"}-${result.objectKey}-${index}`}
                      className={`compendium-card ${result.resource}`}
                      draggable
                      onDragStart={(event) => onCompendiumDragStart(event, result)}
                    >
                      <button type="button" className="compendium-card-main" onClick={() => void attachCompendiumToSheet(result)}>
                        <strong>{result.name}</strong>
                        <span>{compendiumMeta(result)}</span>
                        {result.text || result.highlighted ? <small>{snippet(result.text ?? stripMarkup(result.highlighted ?? ""))}</small> : null}
                      </button>
                      <button type="button" onClick={() => void attachCompendiumToSheet(result)} title="Add to selected sheet"><Plus size={16} /></button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {rightTab === "combat" ? (
              <>
                <div className="sidebar-heading">
                  <div>
                    <h2>Combat</h2>
                    <span>{outcome ? `${outcome.winner ?? "No faction"} wins` : "ready"}</span>
                  </div>
                  <strong>{encounter.round || "-"}</strong>
                </div>
                <div className="turn-status compact-turn-status" aria-label="Current turn status">
                  <div><span>Current</span><strong>{currentCombatant?.displayName ?? "Not started"}</strong></div>
                  <div><span>Tactic</span><strong>{currentCombatant ? labelTactics(currentCombatant.tacticsProfile) : "-"}</strong></div>
                  <div><span>HP</span><strong>{currentCombatant && currentDefinition ? `${currentCombatant.currentHp}/${currentDefinition.maxHp}` : "-"}</strong></div>
                  <div className="turn-event-summary"><span>Latest</span><strong>{latestTurnEvent?.message ?? "Step to begin"}</strong></div>
                </div>
                <div className="quick-actions">
                  <button type="button" className="wide-command" onClick={rollInitiativeNow}><Dices size={18} /> Initiative</button>
                  <button type="button" className="wide-command" onClick={advanceTurn}><SkipForward size={18} /> Step</button>
                  <button type="button" className="wide-command primary-command" onClick={() => void runAuto()}><Swords size={18} /> Auto Run</button>
                  <button type="button" className="wide-command" onClick={() => runBatch(100)}><Waypoints size={18} /> Batch 100</button>
                </div>
                {selectedCombatant && selectedDefinition ? (
                  <div className="selection-summary">
                    <strong>{selectedCombatant.displayName}</strong>
                    <span>{selectedDefinition.name}</span>
                    <div>
                      <span>AC {selectedDefinition.armorClass}</span>
                      <span>HP {selectedCombatant.currentHp}/{selectedDefinition.maxHp}</span>
                      <span>{selectedCombatant.state}</span>
                    </div>
                  </div>
                ) : null}
                <div className="faction-tactics">
                  <label>
                    <span>Party tactics</span>
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
                    <span>Enemy tactics</span>
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
              </>
            ) : null}

            {rightTab === "reports" ? (
              <>
                <div className="sidebar-heading">
                  <div>
                    <h2>Reports</h2>
                    <span>{batchSummary ? "batch summary" : "no batch run"}</span>
                  </div>
                  <strong>{batchSummary?.rounds.average ?? "-"}</strong>
                </div>
                <button type="button" className="wide-command primary-command" onClick={() => runBatch(100)}><ChartColumn size={18} /> Run Batch 100</button>
                {batchSummary ? (
                  <>
                    <div className="report-grid sidebar-report-grid">
                      <div><span>Party win</span><strong>{percent(batchSummary.partyWinRate)}</strong></div>
                      <div><span>Enemy win</span><strong>{percent(batchSummary.enemyWinRate)}</strong></div>
                      <div><span>TPK</span><strong>{percent(batchSummary.tpkRate)}</strong></div>
                      <div><span>Avg rounds</span><strong>{batchSummary.rounds.average}</strong></div>
                      <div><span>Difficulty</span><strong>{batchSummary.difficultyLabel}</strong></div>
                      <div><span>Deaths</span><strong>{percent(batchSummary.characterDeathRate)}</strong></div>
                    </div>
                    <div className="metrics-table sidebar-metrics-table">
                      {batchSummary.damageByCombatant.map((metric) => (
                        <div key={metric.combatantId}>
                          <span>{metric.displayName}</span>
                          <strong>{metric.damageDealt} dealt</strong>
                          <strong>{metric.damageTaken} taken</strong>
                          <strong>{metric.endingHp} HP</strong>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="empty-panel">Run a batch simulation to populate encounter tuning metrics.</p>
                )}
              </>
            ) : null}

            {rightTab === "settings" ? (
              <>
                <div className="sidebar-heading">
                  <div>
                    <h2>Scene Settings</h2>
                    <span>{mapImageDataUrl ? "background loaded" : "no background image"}</span>
                  </div>
                  <strong>{encounter.map.walls.length + encounter.map.terrain.length}</strong>
                </div>
                <label className="upload primary-command">
                  <ImagePlus size={18} />
                  <span>Upload Map</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onImageUpload} />
                </label>
                <button type="button" className="wide-command sidebar-command" onClick={() => setActiveModal("scene")}><Settings size={18} /> Configure Scene</button>
                <div className="tool-actions">
                  <button type="button" onClick={cancelWallPlacement} disabled={!pendingWallStart}><X size={16} /> Finish Wall</button>
                  <button type="button" onClick={deleteLastWall}><Trash2 size={16} /> Last Wall</button>
                  <button type="button" onClick={deleteLastTerrain}><Trash2 size={16} /> Last Terrain</button>
                </div>
                <div className="scene-tool-readout">
                  <strong>{toolReadout(tool, measuredDistance, measuredPathCostFeet, measuredPath?.reachable, sightResult)}</strong>
                  <span>{templateAffectedCombatants.length ? `${templateAffectedCombatants.map((combatant) => combatant.displayName).join(", ")} in template` : "No template targets"}</span>
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
                {selectedWall ? (
                  <div className="node-editor">
                    <div className="section-title tight-title">
                      <h3>Wall Inspector</h3>
                      <button type="button" className="icon-danger" onClick={() => { removeWall(selectedWall.id); setSelectedWallId(null); }} title="Remove selected wall"><Trash2 size={16} /></button>
                    </div>
                    <div className="check-list scene-check-list">
                      <label><input type="checkbox" checked={selectedWall.blocksMovement} onChange={(event) => updateWall(selectedWall.id, { blocksMovement: event.target.checked })} /><span>Blocks movement</span></label>
                      <label><input type="checkbox" checked={selectedWall.blocksSight} onChange={(event) => updateWall(selectedWall.id, { blocksSight: event.target.checked })} /><span>Blocks sight</span></label>
                      <label><input type="checkbox" checked={selectedWall.blocksProjectiles} onChange={(event) => updateWall(selectedWall.id, { blocksProjectiles: event.target.checked })} /><span>Blocks projectiles</span></label>
                    </div>
                    <div className="builder-grid two-col scene-edit-grid">
                      <select value={selectedWall.doorState ?? "closed"} onChange={(event) => updateWall(selectedWall.id, { doorState: event.target.value as NonNullable<typeof selectedWall.doorState> })} aria-label="Door state">
                        <option value="closed">Closed wall</option>
                        <option value="open">Open door</option>
                        <option value="locked">Locked door</option>
                        <option value="destroyed">Destroyed</option>
                      </select>
                      <button type="button" onClick={() => toggleDoorState(selectedWall.id)}>Toggle Door</button>
                    </div>
                  </div>
                ) : null}
                {selectedTerrain ? (
                  <div className="node-editor">
                    <div className="section-title tight-title">
                      <h3>Terrain Inspector</h3>
                      <button type="button" className="icon-danger" onClick={() => { removeTerrain(selectedTerrain.id); setSelectedTerrainId(null); }} title="Remove selected terrain"><Trash2 size={16} /></button>
                    </div>
                    <div className="builder-grid scene-edit-grid">
                      <input value={selectedTerrain.name} onChange={(event) => updateTerrain(selectedTerrain.id, { name: event.target.value })} aria-label="Terrain name" />
                      <select value={selectedTerrain.type} onChange={(event) => updateTerrain(selectedTerrain.id, { type: event.target.value as TerrainType })} aria-label="Terrain type">
                        {terrainTypes.map((terrainType) => <option key={terrainType} value={terrainType}>{terrainType}</option>)}
                      </select>
                      <input type="number" min={0.5} step={0.5} value={selectedTerrain.movementMultiplier ?? (selectedTerrain.type === "difficult" ? 2 : 1)} onChange={(event) => updateTerrain(selectedTerrain.id, { movementMultiplier: Number(event.target.value) })} aria-label="Movement multiplier" />
                    </div>
                  </div>
                ) : null}
                <div className="node-editor">
                  <div className="section-title tight-title">
                    <h3>Template Tool</h3>
                    {selectedTemplate ? <button type="button" className="icon-danger" onClick={() => { removeTemplate(selectedTemplate.id); setSelectedTemplateId(null); }} title="Remove selected template"><Trash2 size={16} /></button> : null}
                  </div>
                  <div className="builder-grid scene-edit-grid">
                    <input value={templatePreview.name} onChange={(event) => selectedTemplate ? updateTemplate(selectedTemplate.id, { name: event.target.value }) : setTemplateDraft({ ...templateDraft, name: event.target.value })} aria-label="Template name" />
                    <select value={templatePreview.area.type} onChange={(event) => {
                      const area = { ...templatePreview.area, type: event.target.value as AreaTemplate["type"] };
                      selectedTemplate ? updateTemplate(selectedTemplate.id, { area }) : setTemplateDraft({ ...templateDraft, area });
                    }} aria-label="Template type">
                      {templateTypes.map((templateType) => <option key={templateType} value={templateType}>{templateType}</option>)}
                    </select>
                    <input type="number" min={5} step={5} value={templatePreview.area.size} onChange={(event) => {
                      const area = { ...templatePreview.area, size: Number(event.target.value) };
                      selectedTemplate ? updateTemplate(selectedTemplate.id, { area }) : setTemplateDraft({ ...templateDraft, area });
                    }} aria-label="Template size" />
                    <select value={templatePreview.area.direction ?? "east"} onChange={(event) => {
                      const area = { ...templatePreview.area, direction: event.target.value as NonNullable<AreaTemplate["direction"]> };
                      selectedTemplate ? updateTemplate(selectedTemplate.id, { area }) : setTemplateDraft({ ...templateDraft, area });
                    }} aria-label="Template direction">
                      {templateDirections.map((direction) => <option key={direction} value={direction}>{direction}</option>)}
                    </select>
                    <input type="number" min={5} step={5} value={templatePreview.area.width ?? 5} onChange={(event) => {
                      const area = { ...templatePreview.area, width: Number(event.target.value) };
                      selectedTemplate ? updateTemplate(selectedTemplate.id, { area }) : setTemplateDraft({ ...templateDraft, area });
                    }} aria-label="Template width" />
                    <input type="color" value={templatePreview.color ?? "#287277"} onChange={(event) => selectedTemplate ? updateTemplate(selectedTemplate.id, { color: event.target.value }) : setTemplateDraft({ ...templateDraft, color: event.target.value })} aria-label="Template color" />
                    <input type="number" value={templatePreview.origin.x} onChange={(event) => {
                      const origin = { ...templatePreview.origin, x: clamp(Number(event.target.value), 0, encounter.map.grid.width - 1) };
                      selectedTemplate ? updateTemplate(selectedTemplate.id, { origin }) : setTemplateDraft({ ...templateDraft, origin });
                    }} aria-label="Template X" />
                    <input type="number" value={templatePreview.origin.y} onChange={(event) => {
                      const origin = { ...templatePreview.origin, y: clamp(Number(event.target.value), 0, encounter.map.grid.height - 1) };
                      selectedTemplate ? updateTemplate(selectedTemplate.id, { origin }) : setTemplateDraft({ ...templateDraft, origin });
                    }} aria-label="Template Y" />
                  </div>
                </div>
                <h3><Layers size={14} /> Layers</h3>
                <div className="layer-list">
                  {encounter.map.walls.length === 0 && encounter.map.terrain.length === 0 && !(encounter.map.templates ?? []).length ? <p className="empty-panel">Draw walls, terrain, or templates to manage them here.</p> : null}
                  {encounter.map.walls.map((wall, index) => (
                    <div key={wall.id}>
                      <button type="button" onClick={() => { setSelectedWallId(wall.id); setSelectedTerrainId(null); setSelectedTemplateId(null); }}>
                        <strong>Wall {index + 1}</strong>
                        <span>{wall.doorState ?? "wall"}</span>
                      </button>
                      <button type="button" onClick={() => removeWall(wall.id)} title="Remove wall"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  {encounter.map.terrain.map((terrain, index) => (
                    <div key={terrain.id}>
                      <button type="button" onClick={() => { setSelectedTerrainId(terrain.id); setSelectedWallId(null); setSelectedTemplateId(null); }}>
                        <strong>{terrain.name} {index + 1}</strong>
                        <span>{terrain.type}</span>
                      </button>
                      <button type="button" onClick={() => removeTerrain(terrain.id)} title="Remove terrain"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  {(encounter.map.templates ?? []).map((template, index) => (
                    <div key={template.id}>
                      <button type="button" onClick={() => { setSelectedTemplateId(template.id); setSelectedWallId(null); setSelectedTerrainId(null); }}>
                        <strong>{template.name || `Template ${index + 1}`}</strong>
                        <span>{template.area.type} {template.area.size} ft</span>
                      </button>
                      <button type="button" onClick={() => { removeTemplate(template.id); if (selectedTemplateId === template.id) setSelectedTemplateId(null); }} title="Remove template"><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </aside>
      </section>

      <footer className="bottom-panel scene-bottom">
        <div className="bottom-panel-heading">
          <button type="button" onClick={() => setBottomPanelOpen(!bottomPanelOpen)}>{bottomPanelOpen ? "Hide" : "Show"} Tracker</button>
          <span>{encounter.combatants.length} combatants</span>
        </div>
        {bottomPanelOpen ? (
          <div className="bottom-panel-content">
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
          </div>
        ) : null}
      </footer>

      {activeModal === "new-scene" ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Create encounter scene">
          <div className="modal-panel compact-modal">
            <div className="modal-heading">
              <div>
                <h2>Create Scene</h2>
                <span>Creates an empty encounter scene using the current map and grid setup.</span>
              </div>
              <button type="button" onClick={() => setActiveModal(null)} title="Close"><X size={18} /></button>
            </div>
            <div className="builder-grid two-col">
              <input value={sceneForm.name} onChange={(event) => setSceneForm({ name: event.target.value })} aria-label="Scene name" />
              <button type="button" className="wide-command primary-command" onClick={() => void createSceneFromForm()}><Plus size={18} /> Create</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "rename-scene" && renameSceneForm ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Rename encounter scene">
          <div className="modal-panel compact-modal">
            <div className="modal-heading">
              <div>
                <h2>Rename Scene</h2>
                <span>Updates the saved encounter name and the active scene name when applicable.</span>
              </div>
              <button type="button" onClick={() => setActiveModal(null)} title="Close"><X size={18} /></button>
            </div>
            <div className="builder-grid two-col">
              <input value={renameSceneForm.name} onChange={(event) => setRenameSceneForm({ ...renameSceneForm, name: event.target.value })} aria-label="Scene name" />
              <button type="button" className="wide-command primary-command" onClick={() => void renameSceneFromForm()}><Save size={18} /> Rename</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "scene" ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Configure scene">
          <div className="modal-panel compact-modal">
            <div className="modal-heading">
              <div>
                <h2>Scene Configuration</h2>
                <span>Assign the background image and calibrate the grid used by simulation.</span>
              </div>
              <button type="button" onClick={() => setActiveModal(null)} title="Close"><X size={18} /></button>
            </div>
            <div className="builder-grid two-col">
              <input value={encounter.name} onChange={(event) => updateEncounterMetadata({ name: event.target.value })} aria-label="Encounter name" />
              <input value={encounter.map.name} onChange={(event) => updateEncounterMetadata({ mapName: event.target.value })} aria-label="Map name" />
            </div>
            <label className="upload primary-command">
              <ImagePlus size={18} />
              <span>{mapImageDataUrl ? "Replace Background Image" : "Upload Background Image"}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onImageUpload} />
            </label>
            <div className="grid-form map-control-grid scene-config-grid">
              <label>Columns <input type="number" value={encounter.map.grid.width} min={4} max={120} onChange={(event) => updateGrid({ width: Number(event.target.value) })} /></label>
              <label>Rows <input type="number" value={encounter.map.grid.height} min={4} max={120} onChange={(event) => updateGrid({ height: Number(event.target.value) })} /></label>
              <label>Scene W <input type="number" value={Math.round(canvasSettings.widthPx)} min={120} max={8000} onChange={(event) => updateMapCanvas({ widthPx: Number(event.target.value) })} /></label>
              <label>Scene H <input type="number" value={Math.round(canvasSettings.heightPx)} min={120} max={8000} onChange={(event) => updateMapCanvas({ heightPx: Number(event.target.value) })} /></label>
              <label>Grid px <input type="number" value={cellSize} min={20} max={200} onChange={(event) => updateGrid({ squareSizePx: Number(event.target.value) })} /></label>
              <label>Feet/sq <input type="number" value={encounter.map.grid.distancePerSquare} min={1} max={20} onChange={(event) => updateGrid({ distancePerSquare: Number(event.target.value) })} /></label>
              <label>Line px <input type="number" value={gridLineWidth} min={0.5} max={4} step={0.5} onChange={(event) => updateGrid({ lineWidthPx: Number(event.target.value) })} /></label>
              <label>Color <input type="color" value={gridLineColor} onChange={(event) => updateGrid({ lineColor: event.target.value })} /></label>
              <label className="wide-field">
                <span>Grid opacity {Math.round(gridLineOpacity * 100)}%</span>
                <input type="range" value={gridLineOpacity} min={0} max={1} step={0.01} onChange={(event) => updateGrid({ lineOpacity: Number(event.target.value) })} />
              </label>
              <label>Image X <input type="number" value={imageSettings.offsetX} min={-1000} max={1000} onChange={(event) => updateMapImageSettings({ offsetX: Number(event.target.value) })} /></label>
              <label>Image Y <input type="number" value={imageSettings.offsetY} min={-1000} max={1000} onChange={(event) => updateMapImageSettings({ offsetY: Number(event.target.value) })} /></label>
              <label>Scale % <input type="number" value={imageSettings.scale} min={25} max={400} onChange={(event) => updateMapImageSettings({ scale: Number(event.target.value) })} /></label>
              <label>Opacity <input type="number" value={imageSettings.opacity} min={0} max={1} step={0.05} onChange={(event) => updateMapImageSettings({ opacity: Number(event.target.value) })} /></label>
              <label className="wide-field">
                <span>Image scale {Math.round(imageSettings.scale)}%</span>
                <input type="range" value={imageSettings.scale} min={25} max={400} step={1} onChange={(event) => updateMapImageSettings({ scale: Number(event.target.value) })} />
              </label>
              <button type="button" className="wide-command" onClick={() => updateMapImageSettings(DEFAULT_MAP_IMAGE_SETTINGS)}>Reset Image</button>
            </div>
          </div>
        </div>
      ) : null}

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
        <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Actor and token sheet">
          <div className={`actor-sheet-window sheet-drop-target ${sheetDropActive ? "drop-active" : ""}`} onDragOver={onSheetDragOver} onDragLeave={onSheetDragLeave} onDrop={onSheetDrop}>
            <div className="sheet-heading">
              <ActorThumbnail definition={selectedDefinition} combatant={selectedCombatant} />
              <div>
                <h2>{selectedDefinition.name}</h2>
                <span>{selectedCombatant.displayName} - {selectedCombatant.faction} - {sourceLabel(selectedDefinition.source)}</span>
              </div>
              <AutomationBadge value={automationSummary(automationCounts)} />
              <button type="button" onClick={() => setActiveModal(null)} title="Close"><X size={18} /></button>
            </div>
            <div className="sheet-layout">
              <nav className="sheet-tabs" aria-label="Actor sheet tabs">
                {sheetTabs.map((tab) => (
                  <button key={tab.id} type="button" className={activeSheetTab === tab.id ? "active" : ""} onClick={() => setActiveSheetTab(tab.id)}>
                    {tab.label}
                  </button>
                ))}
              </nav>
              <section className="sheet-body">
                {activeSheetTab === "token" ? (
                  <div className="sheet-section-grid">
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
                        <input value={selectedDefinition.size} readOnly aria-label="Token footprint size" />
                      </div>
                    </section>
                    <section>
                      <h3>Token Visual</h3>
                      <div className="token-visual-editor">
                        <ActorThumbnail definition={selectedDefinition} combatant={selectedCombatant} />
                        <div className="token-visual-actions">
                          <label className="upload">
                            <ImagePlus size={18} />
                            <span>Token Image</span>
                            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onTokenImageUpload(event, "token")} />
                          </label>
                          <label className="upload">
                            <ImagePlus size={18} />
                            <span>Actor Default</span>
                            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onTokenImageUpload(event, "definition")} />
                          </label>
                          <button type="button" onClick={() => updateCombatantVisuals(selectedCombatant.id, { imageUrl: undefined })}>Clear Token Image</button>
                          <button type="button" onClick={() => updateDefinitionVisuals(selectedDefinition.id, { imageUrl: undefined })}>Clear Default</button>
                        </div>
                        <div className="builder-grid token-visual-fields">
                          <label><span>Scale</span><input type="number" min={0.5} max={1.5} step={0.05} value={selectedCombatant.tokenVisuals?.scale ?? selectedDefinition.tokenVisuals?.scale ?? 1} onChange={(event) => updateCombatantVisuals(selectedCombatant.id, { scale: Number(event.target.value) })} /></label>
                          <label><span>Border</span><input type="color" value={selectedCombatant.tokenVisuals?.borderColor ?? selectedDefinition.tokenVisuals?.borderColor ?? "#ffffff"} onChange={(event) => updateCombatantVisuals(selectedCombatant.id, { borderColor: event.target.value })} /></label>
                          <label><span>Tint</span><input type="color" value={selectedCombatant.tokenVisuals?.tint ?? selectedDefinition.tokenVisuals?.tint ?? "#287277"} onChange={(event) => updateCombatantVisuals(selectedCombatant.id, { tint: event.target.value })} /></label>
                        </div>
                        <label className="check-line">
                          <input type="checkbox" checked={selectedCombatant.tokenVisuals?.showNameplate ?? selectedDefinition.tokenVisuals?.showNameplate ?? false} onChange={(event) => updateCombatantVisuals(selectedCombatant.id, { showNameplate: event.target.checked })} />
                          <span>Show token nameplate</span>
                        </label>
                      </div>
                    </section>
                    <section className="wide-sheet-section">
                      <h3>Conditions</h3>
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
                  </div>
                ) : null}

                {activeSheetTab === "summary" ? (
                  <div className="sheet-section-grid">
                    <section>
                      <h3>Actor Summary</h3>
                      <div className="metric-grid">
                        <label><span>Name</span><input value={selectedDefinition.name} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { name: event.target.value })} /></label>
                        <label><span>AC</span><input type="number" value={selectedDefinition.armorClass} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { armorClass: Number(event.target.value) })} /></label>
                        <label><span>Max HP</span><input type="number" value={selectedDefinition.maxHp} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { maxHp: Number(event.target.value) })} /></label>
                        <label><span>Speed</span><input type="number" value={selectedDefinition.speed} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { speed: Number(event.target.value) })} /></label>
                        <label><span>Prof</span><input type="number" value={selectedDefinition.proficiencyBonus ?? 2} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { proficiencyBonus: Number(event.target.value) })} /></label>
                      </div>
                    </section>
                    <section>
                      <h3>Source</h3>
                      <div className="sheet-source-grid">
                        <span>{sourceLabel(selectedDefinition.source)}</span>
                        <span>{selectedDefinition.source?.slug ?? selectedDefinition.id}</span>
                        <span>{selectedDefinition.source?.importedAt ? new Date(selectedDefinition.source.importedAt).toLocaleString() : "local"}</span>
                      </div>
                    </section>
                    <section className="wide-sheet-section">
                      <h3>Class Metadata</h3>
                      <div className="builder-grid two-col sheet-meta">
                        <input value={selectedDefinition.character?.classes?.[0]?.name ?? ""} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { character: { ...(selectedDefinition.character ?? {}), classes: [{ name: event.target.value, level: selectedDefinition.character?.classes?.[0]?.level ?? selectedDefinition.character?.level ?? 1 }] } })} aria-label="Class" placeholder="Class" />
                        <input type="number" value={selectedDefinition.character?.level ?? selectedDefinition.character?.classes?.[0]?.level ?? 1} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { character: { ...(selectedDefinition.character ?? {}), level: Number(event.target.value), classes: [{ name: selectedDefinition.character?.classes?.[0]?.name ?? "", level: Number(event.target.value) }] } })} aria-label="Level" />
                      </div>
                    </section>
                  </div>
                ) : null}

                {activeSheetTab === "stats" ? (
                  <div className="sheet-section-grid">
                    <section className="wide-sheet-section">
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
                    </section>
                    <section className="wide-sheet-section">
                      <h3>Combat Profile</h3>
                      <div className="metric-grid">
                        <label><span>Size</span><input value={selectedDefinition.size} readOnly /></label>
                        <label><span>AC</span><input type="number" value={selectedDefinition.armorClass} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { armorClass: Number(event.target.value) })} /></label>
                        <label><span>HP</span><input type="number" value={selectedDefinition.maxHp} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { maxHp: Number(event.target.value) })} /></label>
                        <label><span>Speed</span><input type="number" value={selectedDefinition.speed} onChange={(event) => updateCreatureDefinition(selectedDefinition.id, { speed: Number(event.target.value) })} /></label>
                      </div>
                    </section>
                  </div>
                ) : null}

                {activeSheetTab === "actions" ? (
                  <div className="sheet-section-grid">
                    <section className="wide-sheet-section">
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
                      <EditableItemList items={selectedActionItems} definitionId={selectedDefinition.id} removeDefinitionItem={removeDefinitionItem} onInspect={setInspectedSheetItem} />
                    </section>
                  </div>
                ) : null}

                {activeSheetTab === "inventory" ? (
                  <div className="sheet-section-grid">
                    <section className="wide-sheet-section">
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
                      <EditableItemList items={selectedWeaponItems} definitionId={selectedDefinition.id} removeDefinitionItem={removeDefinitionItem} onInspect={setInspectedSheetItem} />
                    </section>
                  </div>
                ) : null}

                {activeSheetTab === "spells" ? (
                  <div className="sheet-section-grid">
                    <section className="wide-sheet-section">
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
                      <EditableItemList items={selectedSpellItems} definitionId={selectedDefinition.id} removeDefinitionItem={removeDefinitionItem} onInspect={setInspectedSheetItem} />
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
                ) : null}

                {activeSheetTab === "features" ? (
                  <div className="sheet-section-grid">
                    <section className="wide-sheet-section">
                      <h3>Features & Traits</h3>
                      <div className="builder-grid two-col">
                        <select value={featureForm.category} onChange={(event) => setFeatureForm({ ...featureForm, category: event.target.value as "feature" | "trait" })} aria-label="Feature category"><option value="feature">Feature</option><option value="trait">Trait</option></select>
                        <input value={featureForm.name} onChange={(event) => setFeatureForm({ ...featureForm, name: event.target.value })} aria-label="Feature name" />
                        <select value={featureForm.effectPreset} onChange={(event) => setFeatureForm({ ...featureForm, effectPreset: event.target.value as typeof featureForm.effectPreset })} aria-label="Feature effect"><option value="none">Reference note</option><option value="pack-tactics">Pack Tactics</option><option value="swarm">Swarm Damage</option><option value="defense">Defense Bonus</option><option value="resource-regain">Regain Use</option></select>
                        <textarea value={featureForm.description} onChange={(event) => setFeatureForm({ ...featureForm, description: event.target.value })} aria-label="Feature description" />
                      </div>
                      <button type="button" className="wide-command" onClick={addSelectedFeature}><Plus size={18} /> Add Feature / Trait</button>
                      <EditableItemList items={selectedFeatureItems} definitionId={selectedDefinition.id} removeDefinitionItem={removeDefinitionItem} onInspect={setInspectedSheetItem} />
                    </section>
                  </div>
                ) : null}

                {activeSheetTab === "resources" ? (
                  <div className="sheet-section-grid">
                    <section className="wide-sheet-section">
                      <h3>HP & Resources</h3>
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
                    </section>
                  </div>
                ) : null}

                {activeSheetTab === "automation" ? (
                  <div className="sheet-section-grid">
                    <section>
                      <h3>Automation Support</h3>
                      <div className="automation-summary-grid">
                        <div><span>Full</span><strong>{automationCounts.full ?? 0}</strong></div>
                        <div><span>Partial</span><strong>{automationCounts.partial ?? 0}</strong></div>
                        <div><span>Reference</span><strong>{automationCounts["manual-only"] ?? 0}</strong></div>
                        <div><span>Unsupported</span><strong>{automationCounts.unsupported ?? 0}</strong></div>
                      </div>
                    </section>
                    <section>
                      <h3>Batch Readiness</h3>
                      <div className="sheet-source-grid">
                        <span>{(automationCounts["manual-only"] ?? 0) + (automationCounts.unsupported ?? 0) > 0 ? "manual review required" : "ready"}</span>
                        <span>{selectedActions.length} executable actions visible to the engine</span>
                        <span>{selectedDefinition.actions.filter((action) => action.kind === "unsupported").length} unmapped source actions</span>
                      </div>
                    </section>
                    <section className="wide-sheet-section">
                      <EditableItemList items={automationItems} definitionId={selectedDefinition.id} removeDefinitionItem={removeDefinitionItem} onInspect={setInspectedSheetItem} />
                    </section>
                  </div>
                ) : null}

                {activeSheetTab === "tactics" ? (
                  <div className="sheet-section-grid">
                    <section>
                      <h3>Token Tactics</h3>
                      <div className="builder-grid two-col">
                        <select value={selectedTacticsProfile} onChange={(event) => updateTactics(selectedCombatant.id, event.target.value as typeof selectedCombatant.tacticsProfile)} aria-label="Tactics">
                          <option value="basic-melee">Basic melee</option>
                          <option value="basic-ranged">Basic ranged</option>
                          <option value="skirmisher">Skirmisher</option>
                          <option value="brute">Brute</option>
                          <option value="defender">Defender</option>
                          <option value="controller">Controller</option>
                        </select>
                        <input value={selectedCombatant.faction} readOnly aria-label="Faction" />
                      </div>
                    </section>
                    <section>
                      <h3>Simulation Assumptions</h3>
                      <div className="sheet-source-grid">
                        <span>Map-aware pathing uses walls, terrain, occupancy, and footprint size.</span>
                        <span>AI only considers executable actions with full automation support.</span>
                        <span>Reference-only and unsupported content is visible in the automation tab.</span>
                      </div>
                    </section>
                  </div>
                ) : null}
              </section>
              <aside className="sheet-inspector">
                <SheetItemInspector item={inspectedSheetItem} fallbackItems={automationItems} />
              </aside>
            </div>
          </div>
        </div>
      ) : null}

    </main>
  );
}

function ToolButton({ active, tool, setTool, icon, label }: { active: boolean; tool: EditorTool; setTool: (tool: EditorTool) => void; icon: ReactNode; label: string }) {
  return <button type="button" className={`tool ${active ? "active" : ""}`} onClick={() => setTool(tool)} title={label}>{icon}<span>{label}</span></button>;
}

function SidebarTabButton({ active, tab, setTab, icon, label }: { active: boolean; tab: SidebarTab; setTab: (tab: SidebarTab) => void; icon: ReactNode; label: string }) {
  return <button type="button" className={active ? "active" : ""} onClick={() => setTab(tab)} title={label}>{icon}<span>{label}</span></button>;
}

function AutomationBadge({ value }: { value: string }) {
  return <span className={`automation-badge ${automationClass(value)}`}>{formatAutomationSupport(value)}</span>;
}

function SheetItemInspector({ item, fallbackItems }: { item: SheetItemSummary | null; fallbackItems: SheetItemSummary[] }) {
  const selectedItem = item ?? fallbackItems.find((candidate) => candidate.automationSupport === "manual-only" || candidate.automationSupport === "unsupported") ?? fallbackItems[0] ?? null;
  if (!selectedItem) {
    return (
      <div className="sheet-inspector-empty">
        <h3>Inspector</h3>
        <span>No sheet item selected.</span>
      </div>
    );
  }

  return (
    <div className="sheet-item-sheet">
      <div>
        <h3>{selectedItem.name}</h3>
        <span>{selectedItem.type}</span>
      </div>
      <AutomationBadge value={selectedItem.automationSupport ?? "manual-only"} />
      <dl>
        <div>
          <dt>Source</dt>
          <dd>{sourceLabel(selectedItem.source)}</dd>
        </div>
        <div>
          <dt>Key</dt>
          <dd>{selectedItem.source?.slug ?? selectedItem.id}</dd>
        </div>
        <div>
          <dt>Mapping</dt>
          <dd>{mappingLabel(selectedItem)}</dd>
        </div>
      </dl>
      <p>{selectedItem.description?.trim() || selectedItem.detail}</p>
    </div>
  );
}

function ActorThumbnail({ definition, combatant }: { definition: CreatureDefinition; combatant?: CombatantState }) {
  const visuals = combatant ? tokenVisualsFor(definition, combatant) : definition.tokenVisuals ?? {};
  const label = combatant?.displayName ?? definition.name;
  return (
    <div className="actor-thumbnail" style={{ borderColor: visuals.borderColor ?? undefined }}>
      {visuals.imageUrl ? <img src={visuals.imageUrl} alt="" draggable={false} /> : <span>{label.slice(0, 2)}</span>}
    </div>
  );
}

function tokenVisualsFor(definition: CreatureDefinition, combatant: CombatantState) {
  return {
    ...(definition.tokenVisuals ?? {}),
    ...(combatant.tokenVisuals ?? {})
  };
}

function defaultFactionForDefinition(definition: CreatureDefinition): "party" | "enemy" {
  return definition.character ? "party" : "enemy";
}

function conditionFromCompendiumName(name: string): ConditionName | undefined {
  const normalized = name.trim().toLowerCase();
  return supportedConditions.find((condition) => condition === normalized);
}

function featureFromCompendiumPayload(payload: CompendiumDragPayload): FeatureDefinition {
  const documentKey = payload.documentKey ?? "unknown";
  const sourceKey = payload.objectKey || payload.slug || safeFileName(payload.name);
  return {
    id: `open5e:${documentKey}:${sourceKey}:feature`,
    name: payload.name,
    category: payload.resource === "condition" ? "trait" : "feature",
    description: payload.text,
    automationSupport: "manual-only",
    source: {
      provider: "open5e",
      documentKey: payload.documentKey,
      documentName: payload.documentTitle,
      slug: sourceKey,
      importedAt: new Date().toISOString()
    }
  };
}

function compendiumMeta(result: CompendiumSearchResult): string {
  const resource = result.resource === "rule" ? "Rule" : result.resource[0]?.toUpperCase() + result.resource.slice(1);
  const detail = result.resource === "spell" ? `level ${result.level ?? 0}` : result.model;
  return [resource, detail, result.documentTitle ?? result.documentKey ?? "Open5e"].filter(Boolean).join(" - ");
}

function stripMarkup(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function snippet(value: string): string {
  const cleaned = stripMarkup(value);
  return cleaned.length > 132 ? `${cleaned.slice(0, 129)}...` : cleaned;
}

function sourceLabel(source?: { provider?: string; documentKey?: string; documentName?: string }): string {
  if (!source) return "homebrew";
  return [source.documentName ?? source.provider, source.documentKey].filter(Boolean).join(" - ");
}

function automationSummary(counts: Record<string, number>): string {
  if ((counts.unsupported ?? 0) > 0) return "unsupported";
  if ((counts["manual-only"] ?? 0) > 0) return "manual-only";
  if ((counts.partial ?? 0) > 0) return "partial";
  return "full";
}

function automationClass(value: string): string {
  if (value === "full") return "full";
  if (value === "partial") return "partial";
  if (value === "unsupported") return "unsupported";
  return "manual";
}

function mappingLabel(item: SheetItemSummary): string {
  if (item.automationSupport === "full") return "structured executable";
  if (item.automationSupport === "partial") return "partial structured mapping";
  if (item.automationSupport === "unsupported") return "mapping required";
  return "manual-only reference";
}

function toolReadout(
  tool: EditorTool,
  measuredDistance: number | null,
  measuredPathCostFeet: number | null,
  measuredPathReachable: boolean | undefined,
  sightResult: { sight: boolean; effect: boolean; distance: number } | null
): string {
  if (tool === "measure" && measuredDistance !== null) {
    return measuredPathReachable
      ? `${measuredDistance} ft direct, ${measuredPathCostFeet ?? 0} ft path`
      : `${measuredDistance} ft direct, path blocked`;
  }
  if (tool === "sight" && sightResult) {
    return `${sightResult.distance} ft, ${sightResult.sight ? "LOS clear" : "LOS blocked"}, ${sightResult.effect ? "LOE clear" : "LOE blocked"}`;
  }
  if (tool === "template") {
    return "Click the canvas to place the configured template.";
  }
  if (tool === "wall") {
    return "Click grid intersections to draw walls; drag nodes to reshape.";
  }
  if (tool === "terrain") {
    return "Click the canvas to add a terrain zone, then edit it here.";
  }
  return "Select a scene object or token to inspect.";
}

function getCellPoint(element: HTMLElement, clientX: number, clientY: number, cellSize: number) {
  const rect = element.getBoundingClientRect();
  const scaleX = element.clientWidth / Math.max(1, rect.width);
  const scaleY = element.clientHeight / Math.max(1, rect.height);
  return {
    x: Math.floor(((clientX - rect.left) * scaleX) / cellSize),
    y: Math.floor(((clientY - rect.top) * scaleY) / cellSize)
  };
}

function getSnappedWallPoint(element: HTMLElement, clientX: number, clientY: number, cellSize: number, width: number, height: number) {
  const rect = element.getBoundingClientRect();
  const scaleX = element.clientWidth / Math.max(1, rect.width);
  const scaleY = element.clientHeight / Math.max(1, rect.height);
  const x = ((clientX - rect.left) * scaleX) / cellSize;
  const y = ((clientY - rect.top) * scaleY) / cellSize;
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
  removeDefinitionItem,
  onInspect
}: {
  items: SheetItemSummary[];
  definitionId: string;
  removeDefinitionItem: (definitionId: string, itemType: EditableItemType, itemId: string) => void;
  onInspect?: (item: SheetItemSummary) => void;
}) {
  return (
    <div className="action-list compact-list">
      {items.map((item) => (
        <div key={`${item.type}-${item.id}`} className="action-item">
          <button type="button" className="action-item-main" onClick={() => onInspect?.(item)}>
            <strong>{item.name}</strong>
            <span>{item.detail}</span>
            {item.automationSupport ? <AutomationBadge value={item.automationSupport} /> : null}
          </button>
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
