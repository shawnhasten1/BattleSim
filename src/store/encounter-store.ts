"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  activeFactions,
  createEngineState,
  applyCondition,
  applyTimedFeatureEffects,
  DEFAULT_GRID_VISUALS,
  DEFAULT_MAP_IMAGE_SETTINGS,
  event,
  expireConditions,
  getDefinition,
  getExecutableActions,
  moveCombatant,
  resolveDeathSave,
  resetActionEconomy,
  rollInitiative,
  runAutomatedEncounter,
  runBatchSimulations,
  sampleEncounter,
  takeAutomatedTurn,
  type BatchSimulationSummary,
  type CombatantExportPackage,
  type CombatLogEvent,
  type CombatantState,
  type ConditionName,
  type Ability,
  type ActionDefinition,
  type CreatureDefinition,
  type DamageType,
  type EncounterSnapshot,
  type FeatureEffect,
  type FeatureDefinition,
  type Point,
  type SpellDefinition,
  type SimulationOutcome,
  type TerrainZone,
  type WeaponDefinition,
  type WallSegment
} from "@/engine";

export type EditorTool = "select" | "wall" | "terrain";

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  updatedAt: string;
  encounters?: Array<{ id: string; name: string }>;
}

interface EncounterStore {
  encounter: EncounterSnapshot;
  log: CombatLogEvent[];
  outcome: SimulationOutcome | null;
  batchSummary: BatchSimulationSummary | null;
  selectedCombatantId: string | null;
  mapImageDataUrl: string | null;
  currentProjectId: string | null;
  currentEncounterId: string | null;
  projects: ProjectSummary[];
  projectStatus: string;
  definitionsLibrary: CreatureDefinition[];
  definitionStatus: string;
  undoStack: EncounterSnapshot[];
  redoStack: EncounterSnapshot[];
  tool: EditorTool;
  pendingWallStart: Point | null;
  setTool: (tool: EditorTool) => void;
  handleMapClick: (point: Point) => void;
  rollInitiativeNow: () => void;
  advanceTurn: () => void;
  runAuto: () => Promise<void>;
  runBatch: (count: number) => void;
  reset: () => void;
  undo: () => void;
  redo: () => void;
  deleteLastWall: () => void;
  deleteLastTerrain: () => void;
  removeWall: (wallId: string) => void;
  moveWallNode: (from: Point, to: Point) => void;
  deleteWallNode: (point: Point) => void;
  cancelWallPlacement: () => void;
  toggleDoorState: (wallId: string) => void;
  removeTerrain: (terrainId: string) => void;
  loadProjects: () => Promise<void>;
  saveProject: () => Promise<void>;
  loadProject: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  loadDefinitionsLibrary: () => Promise<void>;
  saveSelectedDefinition: () => Promise<void>;
  addLibraryDefinitionToEncounter: (definitionId: string, faction?: "party" | "enemy") => void;
  deleteLibraryDefinition: (definitionId: string) => Promise<void>;
  selectCombatant: (id: string | null) => void;
  setMapImage: (dataUrl: string | null) => void;
  updateGrid: (updates: Partial<EncounterSnapshot["map"]["grid"]>) => void;
  updateMapImageSettings: (updates: Partial<NonNullable<EncounterSnapshot["map"]["image"]>>) => void;
  updateMapCanvas: (updates: Partial<NonNullable<EncounterSnapshot["map"]["canvas"]>>) => void;
  updateHp: (combatantId: string, hp: number) => void;
  updateTactics: (combatantId: string, tactics: EncounterSnapshot["combatants"][number]["tacticsProfile"]) => void;
  updateFactionTactics: (faction: CombatantState["faction"], tactics: CombatantState["tacticsProfile"]) => void;
  updateResource: (combatantId: string, resourceId: string, amount: number) => void;
  updateDefinitionResource: (definitionId: string, resourceId: string, amount: number) => void;
  applyConditionToCombatant: (combatantId: string, condition: ConditionName) => void;
  clearConditions: (combatantId: string) => void;
  replaceEncounter: (encounter: EncounterSnapshot, mapImageDataUrl?: string | null) => void;
  addCreatureDefinition: (definition: CreatureDefinition, faction?: "party" | "enemy") => void;
  importCombatantPackage: (input: CombatantExportPackage) => void;
  addCustomPc: (input: { name: string; ac: number; hp: number; speed: number; attackBonus: number; damageDice: string }) => void;
  addCustomToken: (input: { name: string; faction: "party" | "enemy"; ac: number; hp: number; speed: number; proficiencyBonus: number; abilities: CreatureDefinition["abilities"]; attackName: string; attackType: "melee" | "ranged"; attackAbility: Ability; damageDice: string; damageType: DamageType }) => void;
  updateCombatant: (combatantId: string, updates: Partial<Pick<CombatantState, "displayName" | "faction" | "position" | "tempHp" | "state" | "tacticsProfile">>) => void;
  removeCombatant: (combatantId: string) => void;
  updateCreatureDefinition: (definitionId: string, updates: Partial<CreatureDefinition>) => void;
  updateCreatureAbility: (definitionId: string, ability: Ability, value: number) => void;
  addWeapon: (definitionId: string, input: { name: string; attackType: "melee" | "ranged"; ability: Ability; range: number; reach?: number; damageDice: string; damageType: DamageType }) => void;
  addSpell: (definitionId: string, input: { name: string; level: number; castingTime: "action" | "bonus" | "reaction"; ability: Ability; range: number; damageDice: string; damageType: DamageType; resourceId?: string }) => void;
  attachSpellDefinition: (definitionId: string, spell: SpellDefinition) => void;
  addFeatureOrTrait: (definitionId: string, input: { category: "feature" | "trait"; name: string; description?: string; effectPreset?: "none" | "pack-tactics" | "swarm" | "defense" | "resource-regain" }) => void;
  addStructuredAction: (definitionId: string, input: { kind: "attack" | "save" | "area-save" | "healing"; name: string; actionType: "action" | "bonus"; attackType: "melee" | "ranged" | "spell"; ability: Ability; saveAbility: Ability; dc: number; range: number; areaSize: number; damageDice: string; damageType: DamageType }) => void;
  addMultiattack: (definitionId: string, input: { name: string; actionIds: string[]; count: number }) => void;
  removeDefinitionItem: (definitionId: string, itemType: "weapon" | "spell" | "feature" | "trait" | "action" | "bonusAction" | "reaction", itemId: string) => void;
  mapBasicAttack: (definitionId: string, input?: { attackBonus?: number; damageDice?: string }) => void;
  duplicateSelected: () => void;
}

function canTakeTurn(encounter: EncounterSnapshot, combatant: CombatantState): boolean {
  return combatant.state === "active"
    || (encounter.rules.playerDeathSaves
      && combatant.faction === "party"
      && combatant.state === "downed"
      && !combatant.deathSaves?.stable);
}

function normalizeEncounterVisuals(encounter: EncounterSnapshot): EncounterSnapshot {
  const grid = {
    ...DEFAULT_GRID_VISUALS,
    ...encounter.map.grid
  };
  return {
    ...encounter,
    map: {
      ...encounter.map,
      grid,
      image: {
        ...DEFAULT_MAP_IMAGE_SETTINGS,
        ...encounter.map.image
      },
      canvas: {
        widthPx: encounter.map.canvas?.widthPx ?? grid.width * DEFAULT_GRID_VISUALS.squareSizePx,
        heightPx: encounter.map.canvas?.heightPx ?? grid.height * DEFAULT_GRID_VISUALS.squareSizePx
      }
    }
  };
}

function hasOpenActionEconomy(combatant: CombatantState): boolean {
  const actionEconomy = combatant.actionEconomy;
  return Boolean(actionEconomy && (actionEconomy.action || actionEconomy.bonus || actionEconomy.reaction));
}

function closeActionEconomy(combatant: CombatantState): void {
  combatant.actionEconomy = { action: false, bonus: false, reaction: false };
}

function defaultTacticsForDefinition(definition: CreatureDefinition): CombatantState["tacticsProfile"] {
  const fullActions = getExecutableActions(definition).filter((action) => action.automationSupport === "full");
  return fullActions.some((action) => action.kind === "attack" && (action.attackType === "ranged" || action.attackType === "spell"))
    ? "basic-ranged"
    : "basic-melee";
}

function defaultResourcesForDefinition(definition: CreatureDefinition): Record<string, number> | undefined {
  if (!definition.resources || Object.keys(definition.resources).length === 0) {
    return undefined;
  }
  return structuredClone(definition.resources);
}

function steppedOutcome(engine: ReturnType<typeof createEngineState>): SimulationOutcome | null {
  const factions = [...activeFactions(engine.snapshot)];
  if (factions.length > 1) {
    return null;
  }
  const winner = factions[0] ?? null;
  if (!engine.log.some((entry) => entry.type === "CombatEnded")) {
    engine.log.push(event(engine, "CombatEnded", winner ? `${winner} wins` : "Combat has no active factions", {
      winner,
      rounds: engine.snapshot.round
    }));
  }
  return {
    winner,
    rounds: engine.snapshot.round,
    completed: winner !== null,
    warnings: engine.log
      .filter((entry) => entry.type === "AutomationWarning")
      .map((entry) => entry.message)
  };
}

export const useEncounterStore = create<EncounterStore>()(
  persist(
    (set, get) => {
      const commitEncounter = (
        encounter: EncounterSnapshot,
        extras: Partial<EncounterStore> = {}
      ) => set({
        encounter: normalizeEncounterVisuals(encounter),
        undoStack: [structuredClone(get().encounter), ...get().undoStack].slice(0, 50),
        redoStack: [],
        outcome: null,
        batchSummary: null,
        ...extras
      });

      return ({
      encounter: normalizeEncounterVisuals(structuredClone(sampleEncounter)),
      log: [],
      outcome: null,
      batchSummary: null,
      selectedCombatantId: "pc-fighter",
      mapImageDataUrl: null,
      currentProjectId: null,
      currentEncounterId: null,
      projects: [],
      projectStatus: "",
      definitionsLibrary: [],
      definitionStatus: "",
      undoStack: [],
      redoStack: [],
      tool: "select",
      pendingWallStart: null,
      setTool: (tool) => set({ tool, pendingWallStart: null }),
      handleMapClick: (point) => {
        const state = get();
        if (state.tool === "wall") {
          if (!state.pendingWallStart) {
            set({ pendingWallStart: point });
            return;
          }
          if (pointsMatch(state.pendingWallStart, point)) {
            return;
          }
          const wall: WallSegment = {
            id: `wall-${crypto.randomUUID()}`,
            start: state.pendingWallStart,
            end: point,
            blocksMovement: true,
            blocksSight: true,
            blocksProjectiles: true
          };
          commitEncounter({
            ...state.encounter,
            map: { ...state.encounter.map, walls: [...state.encounter.map.walls, wall] }
          }, {
            pendingWallStart: point,
          });
          return;
        }

        if (state.tool === "terrain") {
          const terrain: TerrainZone = {
            id: `terrain-${crypto.randomUUID()}`,
            name: "Difficult Terrain",
            type: "difficult",
            movementMultiplier: 2,
            polygon: [
              { x: point.x, y: point.y },
              { x: Math.min(state.encounter.map.grid.width, point.x + 3), y: point.y },
              { x: Math.min(state.encounter.map.grid.width, point.x + 3), y: Math.min(state.encounter.map.grid.height, point.y + 3) },
              { x: point.x, y: Math.min(state.encounter.map.grid.height, point.y + 3) }
            ]
          };
          commitEncounter({
            ...state.encounter,
            map: { ...state.encounter.map, terrain: [...state.encounter.map.terrain, terrain] }
          });
          return;
        }

        const selectedId = state.selectedCombatantId;
        if (!selectedId) {
          return;
        }
        const engine = createEngineState(state.encounter);
        engine.log = [...state.log];
        try {
          moveCombatant(engine, selectedId, point, { provokeOpportunityAttacks: state.encounter.round > 0 });
          commitEncounter(engine.snapshot, { log: engine.log });
        } catch {
          set({
            log: [...state.log, {
              id: `illegal-move-${Date.now()}`,
              round: state.encounter.round,
              turnIndex: state.encounter.turnIndex,
              type: "AutomationWarning",
              message: "Destination is not reachable this turn"
            }]
          });
        }
      },
      rollInitiativeNow: () => {
        const state = get();
        const engine = createEngineState({ ...state.encounter, seed: `${state.encounter.seed}:initiative:${state.log.length}` });
        engine.log = [...state.log];
        rollInitiative(engine);
        commitEncounter(engine.snapshot, { log: engine.log });
      },
      advanceTurn: () => {
        const state = get();
        const previousActorId = state.encounter.combatants[state.encounter.turnIndex]?.id;
        const hadInitiative = state.encounter.combatants.every((combatant) => typeof combatant.initiative === "number");
        const engine = createEngineState({ ...state.encounter, seed: `${state.encounter.seed}:turn:${state.log.length}` });
        engine.log = [...state.log];
        if (!hadInitiative) {
          rollInitiative(engine);
        } else {
          engine.snapshot.combatants.sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0) || a.id.localeCompare(b.id));
          const sortedCurrentIndex = engine.snapshot.round > 0
            ? engine.snapshot.combatants.findIndex((combatant) => combatant.id === previousActorId)
            : -1;
          if (sortedCurrentIndex >= 0) {
            engine.snapshot.turnIndex = sortedCurrentIndex;
          }
        }
        const encounter = engine.snapshot;
        const turnHasStarted = hadInitiative && encounter.round > 0;
        const currentActor = turnHasStarted ? encounter.combatants[encounter.turnIndex] : undefined;
        if (currentActor && hasOpenActionEconomy(currentActor)) {
          if (currentActor.state === "active") {
            applyTimedFeatureEffects(engine, currentActor.id, "turn-end");
          }
          expireConditions(engine, "end");
          closeActionEconomy(currentActor);
        }

        const turnIndexes = encounter.combatants
          .map((combatant, index) => ({ combatant, index }))
          .filter(({ combatant }) => canTakeTurn(encounter, combatant));
        if (turnIndexes.length === 0) return;
        const current = encounter.turnIndex;
        const next = turnHasStarted
          ? turnIndexes.find(({ index }) => index > current)?.index ?? turnIndexes[0]?.index ?? 0
          : turnIndexes[0]?.index ?? 0;
        const wrapped = turnHasStarted && next <= current;
        encounter.round = encounter.round <= 0 ? 1 : wrapped ? encounter.round + 1 : encounter.round;
        encounter.turnIndex = next;

        const combatant = encounter.combatants[next];
        if (combatant) {
          engine.log.push(event(engine, "TurnStarted", `${combatant.displayName} started an automated turn`, { combatantId: combatant.id, mode: "automated" }));
          if (combatant.state === "downed") {
            resolveDeathSave(engine, combatant.id);
            closeActionEconomy(combatant);
            commitEncounter(encounter, { log: engine.log, selectedCombatantId: combatant.id, outcome: steppedOutcome(engine) });
            return;
          }

          expireConditions(engine, "start");
          applyTimedFeatureEffects(engine, combatant.id, "turn-start");
          resetActionEconomy(combatant);
          takeAutomatedTurn(engine, combatant);
          applyTimedFeatureEffects(engine, combatant.id, "turn-end");
          expireConditions(engine, "end");
          closeActionEconomy(combatant);
        }
        commitEncounter(encounter, {
          log: engine.log,
          selectedCombatantId: combatant?.id ?? state.selectedCombatantId,
          outcome: steppedOutcome(engine)
        });
      },
      runAuto: async () => {
        const result = runAutomatedEncounter(get().encounter, 50);
        const encounterId = get().currentEncounterId;
        commitEncounter(result.snapshot, {
          log: result.log,
          outcome: result.outcome,
          batchSummary: null,
          selectedCombatantId: result.snapshot.combatants[0]?.id ?? null
        });
        if (encounterId) {
          await fetch("/api/simulation-runs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              encounterId,
              seed: result.snapshot.seed,
              outcome: result.outcome.winner ?? "round-limit",
              rounds: result.outcome.rounds,
              snapshot: result.snapshot,
              metrics: result.outcome,
              eventLog: result.log
            })
          });
        }
      },
      runBatch: (count) => {
        const summary = runBatchSimulations(get().encounter, count, { seedPrefix: get().encounter.seed, maxRounds: 50 });
        set({ batchSummary: summary });
      },
      reset: () => {
        commitEncounter(structuredClone(sampleEncounter), {
          log: [],
          outcome: null,
          batchSummary: null,
          selectedCombatantId: "pc-fighter",
          mapImageDataUrl: null,
          tool: "select",
          pendingWallStart: null
        });
      },
      undo: () => {
        const [previous, ...rest] = get().undoStack;
        if (!previous) return;
        set({
          encounter: previous,
          undoStack: rest,
          redoStack: [structuredClone(get().encounter), ...get().redoStack].slice(0, 50),
          log: [...get().log, {
            id: `undo-${Date.now()}`,
            round: previous.round,
            turnIndex: previous.turnIndex,
            type: "AutomationWarning",
            message: "Undo applied"
          }]
        });
      },
      redo: () => {
        const [next, ...rest] = get().redoStack;
        if (!next) return;
        set({
          encounter: next,
          redoStack: rest,
          undoStack: [structuredClone(get().encounter), ...get().undoStack].slice(0, 50),
          log: [...get().log, {
            id: `redo-${Date.now()}`,
            round: next.round,
            turnIndex: next.turnIndex,
            type: "AutomationWarning",
            message: "Redo applied"
          }]
        });
      },
      deleteLastWall: () => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: { ...encounter.map, walls: encounter.map.walls.slice(0, -1) }
        });
      },
      deleteLastTerrain: () => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: { ...encounter.map, terrain: encounter.map.terrain.slice(0, -1) }
        });
      },
      removeWall: (wallId) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: { ...encounter.map, walls: encounter.map.walls.filter((wall) => wall.id !== wallId) }
        });
      },
      moveWallNode: (from, to) => {
        if (pointsMatch(from, to)) return;
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            walls: encounter.map.walls
              .map((wall) => ({
                ...wall,
                start: pointsMatch(wall.start, from) ? to : wall.start,
                end: pointsMatch(wall.end, from) ? to : wall.end
              }))
              .filter((wall) => !pointsMatch(wall.start, wall.end))
          }
        }, {
          pendingWallStart: pointsMatch(get().pendingWallStart ?? { x: -1, y: -1 }, from)
            ? to
            : get().pendingWallStart
        });
      },
      deleteWallNode: (point) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            walls: encounter.map.walls.filter((wall) => !pointsMatch(wall.start, point) && !pointsMatch(wall.end, point))
          }
        }, {
          pendingWallStart: pointsMatch(get().pendingWallStart ?? { x: -1, y: -1 }, point)
            ? null
            : get().pendingWallStart
        });
      },
      cancelWallPlacement: () => set({ pendingWallStart: null }),
      toggleDoorState: (wallId) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            walls: encounter.map.walls.map((wall) => wall.id === wallId
              ? {
                ...wall,
                doorState: wall.doorState === "open" ? "closed" : "open"
              }
              : wall)
          }
        });
      },
      removeTerrain: (terrainId) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: { ...encounter.map, terrain: encounter.map.terrain.filter((terrain) => terrain.id !== terrainId) }
        });
      },
      loadProjects: async () => {
        const response = await fetch("/api/projects");
        if (!response.ok) {
          set({ projectStatus: "Project list failed" });
          return;
        }
        const data = await response.json() as { projects: ProjectSummary[] };
        set({ projects: data.projects, projectStatus: `${data.projects.length} saved projects` });
      },
      saveProject: async () => {
        const state = get();
        const payload = {
          name: state.encounter.name,
          encounter: state.encounter
        };
        const response = await fetch(state.currentProjectId ? `/api/projects/${state.currentProjectId}` : "/api/projects", {
          method: state.currentProjectId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          set({ projectStatus: "Save failed" });
          return;
        }
        const data = await response.json() as { project: ProjectSummary & { encounters?: Array<{ id: string; name: string }> } };
        set({
          currentProjectId: data.project.id,
          currentEncounterId: data.project.encounters?.[0]?.id ?? get().currentEncounterId,
          projectStatus: "Saved"
        });
        await get().loadProjects();
      },
      loadProject: async (projectId) => {
        const response = await fetch(`/api/projects/${projectId}`);
        if (!response.ok) {
          set({ projectStatus: "Load failed" });
          return;
        }
        const data = await response.json() as { project: { id: string; encounters: Array<{ id: string; snapshotJson: EncounterSnapshot }> } };
        const snapshot = data.project.encounters[0]?.snapshotJson;
        if (!snapshot) {
          set({ projectStatus: "Project has no encounter" });
          return;
        }
        const normalizedSnapshot = normalizeEncounterVisuals(snapshot);
        set({
          currentProjectId: data.project.id,
          currentEncounterId: data.project.encounters[0]?.id ?? null,
          encounter: normalizedSnapshot,
          selectedCombatantId: normalizedSnapshot.combatants[0]?.id ?? null,
          undoStack: [],
          redoStack: [],
          log: [],
          outcome: null,
          batchSummary: null,
          projectStatus: "Loaded"
        });
      },
      deleteProject: async (projectId) => {
        const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
        set({ projectStatus: response.ok ? "Deleted" : "Delete failed" });
        if (get().currentProjectId === projectId) {
          set({ currentProjectId: null, currentEncounterId: null });
        }
        await get().loadProjects();
      },
      loadDefinitionsLibrary: async () => {
        const response = await fetch("/api/definitions");
        if (!response.ok) {
          set({ definitionStatus: "Definition library failed" });
          return;
        }
        const data = await response.json() as { definitions: CreatureDefinition[] };
        set({ definitionsLibrary: data.definitions, definitionStatus: `${data.definitions.length} saved definitions` });
      },
      saveSelectedDefinition: async () => {
        const state = get();
        const selected = state.encounter.combatants.find((combatant) => combatant.id === state.selectedCombatantId);
        const definition = selected ? state.encounter.definitions.find((candidate) => candidate.id === selected.definitionId) : undefined;
        if (!selected || !definition) {
          set({ definitionStatus: "No selected definition" });
          return;
        }
        const definitionToSave: CreatureDefinition = selected.resources && !definition.resources
          ? { ...definition, resources: structuredClone(selected.resources) }
          : definition;
        const response = await fetch("/api/definitions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ definition: definitionToSave })
        });
        set({ definitionStatus: response.ok ? "Definition saved" : "Definition save failed" });
        if (response.ok) {
          await get().loadDefinitionsLibrary();
        }
      },
      addLibraryDefinitionToEncounter: (definitionId, faction = "enemy") => {
        const definition = get().definitionsLibrary.find((candidate) => candidate.id === definitionId);
        if (definition) {
          get().addCreatureDefinition(definition, faction);
        }
      },
      deleteLibraryDefinition: async (definitionId) => {
        const response = await fetch(`/api/definitions/${encodeURIComponent(definitionId)}`, { method: "DELETE" });
        set({ definitionStatus: response.ok ? "Definition deleted" : "Definition delete failed" });
        await get().loadDefinitionsLibrary();
      },
      selectCombatant: (id) => set({ selectedCombatantId: id }),
      setMapImage: (dataUrl) => set({ mapImageDataUrl: dataUrl }),
      updateGrid: (updates) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            canvas: encounter.map.canvas ?? {
              widthPx: encounter.map.grid.width * DEFAULT_GRID_VISUALS.squareSizePx,
              heightPx: encounter.map.grid.height * DEFAULT_GRID_VISUALS.squareSizePx
            },
            grid: { ...encounter.map.grid, ...updates }
          }
        });
      },
      updateMapImageSettings: (updates) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            image: {
              ...DEFAULT_MAP_IMAGE_SETTINGS,
              ...encounter.map.image,
              ...updates
            }
          }
        });
      },
      updateMapCanvas: (updates) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            canvas: {
              widthPx: encounter.map.canvas?.widthPx ?? encounter.map.grid.width * DEFAULT_GRID_VISUALS.squareSizePx,
              heightPx: encounter.map.canvas?.heightPx ?? encounter.map.grid.height * DEFAULT_GRID_VISUALS.squareSizePx,
              ...updates
            }
          }
        });
      },
      updateHp: (combatantId, hp) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => {
            if (combatant.id !== combatantId) return combatant;
            const nextState = hp <= 0 ? (combatant.faction === "party" ? "downed" : "defeated") : "active";
            return { ...combatant, currentHp: Math.max(0, hp), state: nextState };
          })
        });
      },
      updateTactics: (combatantId, tactics) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => combatant.id === combatantId
            ? { ...combatant, tacticsProfile: tactics }
            : combatant)
        });
      },
      updateFactionTactics: (faction, tactics) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => combatant.faction === faction
            ? { ...combatant, tacticsProfile: tactics }
            : combatant)
        });
      },
      updateResource: (combatantId, resourceId, amount) => {
        const encounter = get().encounter;
        const normalizedResourceId = resourceId.trim();
        if (!normalizedResourceId) return;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => combatant.id === combatantId
            ? {
              ...combatant,
              resources: {
                ...(combatant.resources ?? {}),
                [normalizedResourceId]: Math.max(0, Math.floor(amount))
              }
            }
            : combatant)
        });
      },
      updateDefinitionResource: (definitionId, resourceId, amount) => {
        const encounter = get().encounter;
        const normalizedResourceId = resourceId.trim();
        if (!normalizedResourceId) return;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? {
              ...definition,
              resources: {
                ...(definition.resources ?? {}),
                [normalizedResourceId]: Math.max(0, Math.floor(amount))
              }
            }
            : definition)
        });
      },
      applyConditionToCombatant: (combatantId, condition) => {
        const state = get();
        const engine = createEngineState(state.encounter);
        engine.log = [...state.log];
        applyCondition(engine, combatantId, {
          id: `${condition}-${crypto.randomUUID()}`,
          name: condition,
          startedRound: engine.snapshot.round,
          modifiers: condition === "poisoned"
            ? { attackRoll: -2 }
            : condition === "restrained"
              ? { attackRoll: -2, movementMultiplier: 999 }
              : condition === "prone"
                ? { movementMultiplier: 2 }
                : undefined
        });
        commitEncounter(engine.snapshot, { log: engine.log });
      },
      clearConditions: (combatantId) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => combatant.id === combatantId
            ? { ...combatant, conditions: [], concentration: undefined }
            : combatant)
        });
      },
      replaceEncounter: (encounter, mapImageDataUrl = null) => {
        const normalizedEncounter = normalizeEncounterVisuals(encounter);
        set({
          encounter: normalizedEncounter,
          mapImageDataUrl,
          log: [],
          outcome: null,
          batchSummary: null,
          selectedCombatantId: normalizedEncounter.combatants[0]?.id ?? null
        });
      },
      addCreatureDefinition: (definition, faction = "enemy") => {
        if (!definition?.id) {
          return;
        }
        const encounter = get().encounter;
        const dedupedDefinitions = [
          ...encounter.definitions.filter((candidate) => candidate?.id && candidate.id !== definition.id),
          definition
        ];
        const count = encounter.combatants.filter((combatant) => combatant.definitionId === definition.id).length + 1;
        const combatant = {
          id: `combatant-${crypto.randomUUID()}`,
          definitionId: definition.id,
          displayName: `${definition.name} ${count}`,
          faction,
          position: findOpenCell(encounter),
          currentHp: definition.maxHp,
          tempHp: 0,
          resources: defaultResourcesForDefinition(definition),
          state: "active" as const,
          tacticsProfile: defaultTacticsForDefinition(definition)
        };
        commitEncounter({
          ...encounter,
          definitions: dedupedDefinitions,
          combatants: [...encounter.combatants, combatant]
        }, {
          selectedCombatantId: combatant.id
        });
      },
      importCombatantPackage: (input) => {
        const encounter = get().encounter;
        const imported = input.combatant;
        const importedResources = imported?.resources ? structuredClone(imported.resources) : undefined;
        const definition: CreatureDefinition = {
          ...structuredClone(input.definition),
          id: `def-${crypto.randomUUID()}`,
          resources: input.definition.resources
            ? structuredClone(input.definition.resources)
            : importedResources
        };
        const combatant: CombatantState = {
          id: `combatant-${crypto.randomUUID()}`,
          definitionId: definition.id,
          displayName: imported?.displayName ?? definition.name,
          faction: imported?.faction ?? "enemy",
          position: findOpenCell(encounter),
          currentHp: Math.min(definition.maxHp, Math.max(0, imported?.currentHp ?? definition.maxHp)),
          tempHp: Math.max(0, imported?.tempHp ?? 0),
          deathSaves: imported?.deathSaves ? structuredClone(imported.deathSaves) : undefined,
          conditions: imported?.conditions ? structuredClone(imported.conditions) : undefined,
          resources: importedResources ?? defaultResourcesForDefinition(definition),
          state: imported?.state ?? "active",
          tacticsProfile: imported?.tacticsProfile ?? defaultTacticsForDefinition(definition)
        };
        commitEncounter({
          ...encounter,
          definitions: [...encounter.definitions, definition],
          combatants: [...encounter.combatants, combatant]
        }, {
          selectedCombatantId: combatant.id,
          log: [...get().log, {
            id: `import-combatant-${Date.now()}`,
            round: encounter.round,
            turnIndex: encounter.turnIndex,
            type: "AutomationWarning",
            message: `Imported ${combatant.displayName} from JSON`
          }]
        });
      },
      addCustomPc: (input) => {
        get().addCustomToken({
          name: input.name,
          faction: "party",
          ac: input.ac,
          hp: input.hp,
          speed: input.speed,
          proficiencyBonus: Math.max(2, input.attackBonus - 2),
          abilities: { str: 14, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
          attackName: "Primary Attack",
          attackType: "melee",
          attackAbility: "str",
          damageDice: input.damageDice,
          damageType: "slashing"
        });
      },
      addCustomToken: (input) => {
        const id = `def-${crypto.randomUUID()}`;
        get().addCreatureDefinition({
          id,
          name: input.name,
          source: { provider: "homebrew" },
          size: "medium",
          armorClass: input.ac,
          maxHp: input.hp,
          speed: input.speed,
          proficiencyBonus: input.proficiencyBonus,
          character: input.faction === "party" ? { level: 1, classes: [{ name: "Adventurer", level: 1 }] } : undefined,
          abilities: input.abilities,
          actions: [
            {
              kind: "attack",
              id: `attack-${id}`,
              name: input.attackName,
              actionType: "action",
              attackType: input.attackType,
              ability: input.attackAbility,
              attackBonusFormula: { ability: input.attackAbility, proficiency: true },
              range: input.attackType === "ranged" ? 80 : 5,
              reach: input.attackType === "melee" ? 5 : undefined,
              damage: [{ dice: input.damageDice, damageType: input.damageType, abilityModifier: input.attackAbility }],
              automationSupport: "full"
            }
          ]
        }, input.faction);
      },
      updateCombatant: (combatantId, updates) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => combatant.id === combatantId
            ? { ...combatant, ...updates }
            : combatant)
        });
      },
      removeCombatant: (combatantId) => {
        const encounter = get().encounter;
        const combatants = encounter.combatants.filter((combatant) => combatant.id !== combatantId);
        commitEncounter({
          ...encounter,
          combatants
        }, {
          selectedCombatantId: combatants[0]?.id ?? null
        });
      },
      updateCreatureDefinition: (definitionId, updates) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? { ...definition, ...updates }
            : definition),
          combatants: encounter.combatants.map((combatant) => {
            if (combatant.definitionId !== definitionId || updates.maxHp === undefined) return combatant;
            return {
              ...combatant,
              currentHp: Math.min(Math.max(0, combatant.currentHp), updates.maxHp)
            };
          })
        });
      },
      updateCreatureAbility: (definitionId, ability, value) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? { ...definition, abilities: { ...definition.abilities, [ability]: value } }
            : definition)
        });
      },
      addWeapon: (definitionId, input) => {
        const encounter = get().encounter;
        const weaponId = `weapon-${crypto.randomUUID()}`;
        const weapon: WeaponDefinition = {
          id: weaponId,
          name: input.name,
          attackType: input.attackType,
          ability: input.ability,
          range: input.range,
          reach: input.attackType === "melee" ? input.reach ?? input.range : undefined,
          damage: [{ dice: input.damageDice, damageType: input.damageType, abilityModifier: input.ability }],
          actionId: `weapon-action-${weaponId}`
        };
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? { ...definition, weapons: [...(definition.weapons ?? []), weapon] }
            : definition)
        });
      },
      addSpell: (definitionId, input) => {
        const encounter = get().encounter;
        const spellId = `spell-${crypto.randomUUID()}`;
        const spell: SpellDefinition = {
          id: spellId,
          name: input.name,
          level: input.level,
          castingTime: input.castingTime,
          range: input.range,
          resourceCost: input.resourceId ? { resourceId: input.resourceId, amount: 1 } : undefined,
          automationSupport: "full",
          action: {
            kind: "attack",
            id: `spell-action-${spellId}`,
            name: input.name,
            actionType: input.castingTime,
            attackType: "spell",
            ability: input.ability,
            attackBonusFormula: { ability: input.ability, proficiency: true },
            range: input.range,
            damage: [{ dice: input.damageDice, damageType: input.damageType }],
            resourceCost: input.resourceId ? { resourceId: input.resourceId, amount: 1 } : undefined,
            automationSupport: "full"
          }
        };
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? { ...definition, spells: [...(definition.spells ?? []), spell] }
            : definition)
        });
      },
      attachSpellDefinition: (definitionId, spell) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? { ...definition, spells: [...(definition.spells ?? []).filter((candidate) => candidate.id !== spell.id), spell] }
            : definition)
        });
      },
      addFeatureOrTrait: (definitionId, input) => {
        const encounter = get().encounter;
        const feature: FeatureDefinition = {
          id: `${input.category}-${crypto.randomUUID()}`,
          name: input.name,
          category: input.category,
          description: input.description,
          effects: featureEffectsFromPreset(input.effectPreset),
          automationSupport: input.effectPreset && input.effectPreset !== "none" ? "full" : "manual-only"
        };
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => {
            if (definition.id !== definitionId) return definition;
            return input.category === "feature"
              ? { ...definition, features: [...(definition.features ?? []), feature] }
              : { ...definition, traits: [...(definition.traits ?? []), feature] };
          })
        });
      },
      addStructuredAction: (definitionId, input) => {
        const encounter = get().encounter;
        const id = `action-${crypto.randomUUID()}`;
        const action: ActionDefinition = input.kind === "healing"
          ? {
            kind: "healing",
            id,
            name: input.name,
            actionType: input.actionType,
            range: input.range,
            healing: [{ dice: input.damageDice, abilityModifier: input.ability }],
            automationSupport: "full"
          }
          : input.kind === "save"
            ? {
              kind: "save",
              id,
              name: input.name,
              actionType: input.actionType,
              saveAbility: input.saveAbility,
              dc: input.dc,
              range: input.range,
              damage: [{ dice: input.damageDice, damageType: input.damageType }],
              halfDamageOnSuccess: true,
              automationSupport: "full"
            }
            : input.kind === "area-save"
              ? {
                kind: "area-save",
                id,
                name: input.name,
                actionType: input.actionType,
                saveAbility: input.saveAbility,
                dc: input.dc,
                range: input.range,
                area: { type: "circle", size: input.areaSize },
                damage: [{ dice: input.damageDice, damageType: input.damageType }],
                halfDamageOnSuccess: true,
                affects: "hostile",
                automationSupport: "full"
              }
              : {
                kind: "attack",
                id,
                name: input.name,
                actionType: input.actionType,
                attackType: input.attackType,
                ability: input.ability,
                attackBonusFormula: { ability: input.ability, proficiency: true },
                range: input.range,
                reach: input.attackType === "melee" ? input.range : undefined,
                damage: [{ dice: input.damageDice, damageType: input.damageType, abilityModifier: input.attackType === "spell" ? undefined : input.ability }],
                automationSupport: "full"
              };
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => {
            if (definition.id !== definitionId) return definition;
            if (input.actionType === "bonus") {
              return { ...definition, bonusActions: [...(definition.bonusActions ?? []), action] };
            }
            return { ...definition, actions: [...definition.actions, action] };
          })
        });
      },
      addMultiattack: (definitionId, input) => {
        const encounter = get().encounter;
        const uniqueActionIds = input.actionIds.filter(Boolean);
        if (uniqueActionIds.length === 0) return;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? {
              ...definition,
              actions: [
                ...definition.actions,
                {
                  kind: "multiattack" as const,
                  id: `multiattack-${crypto.randomUUID()}`,
                  name: input.name,
                  actionType: "action" as const,
                  attacks: uniqueActionIds.map((actionId) => ({ actionId, count: Math.max(1, input.count) })),
                  automationSupport: "full" as const
                }
              ]
            }
            : definition)
        });
      },
      removeDefinitionItem: (definitionId, itemType, itemId) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => {
            if (definition.id !== definitionId) return definition;
            const removedActionIds = new Set<string>([itemId]);
            if (itemType === "weapon") {
              const weapon = (definition.weapons ?? []).find((item) => item.id === itemId);
              if (weapon?.actionId) removedActionIds.add(weapon.actionId);
              removedActionIds.add(`weapon:${itemId}`);
            }
            if (itemType === "spell") {
              const spell = (definition.spells ?? []).find((item) => item.id === itemId);
              if (spell?.action?.id) removedActionIds.add(spell.action.id);
            }
            const weaponIdsFromAction = itemType === "action"
              ? new Set((definition.weapons ?? [])
                .filter((weapon) => removedActionIds.has(weapon.actionId ?? `weapon:${weapon.id}`))
                .map((weapon) => weapon.id))
              : new Set<string>();
            const spellIdsFromAction = itemType === "action"
              ? new Set((definition.spells ?? [])
                .filter((spell) => spell.action?.id && removedActionIds.has(spell.action.id))
                .map((spell) => spell.id))
              : new Set<string>();
            const scrubbedActions = (definition.actions ?? [])
              .filter((action) => itemType !== "action" || !removedActionIds.has(action.id))
              .map((action) => action.kind === "multiattack"
                ? {
                  ...action,
                  attacks: action.attacks.filter((step) => !removedActionIds.has(step.actionId))
                }
                : action)
              .filter((action) => action.kind !== "multiattack" || action.attacks.length > 0);
            return {
              ...definition,
              weapons: itemType === "weapon" || weaponIdsFromAction.size > 0 ? (definition.weapons ?? []).filter((item) => item.id !== itemId && !weaponIdsFromAction.has(item.id)) : definition.weapons,
              spells: itemType === "spell" || spellIdsFromAction.size > 0 ? (definition.spells ?? []).filter((item) => item.id !== itemId && !spellIdsFromAction.has(item.id)) : definition.spells,
              features: itemType === "feature" ? (definition.features ?? []).filter((item) => item.id !== itemId) : definition.features,
              traits: itemType === "trait" ? (definition.traits ?? []).filter((item) => item.id !== itemId) : definition.traits,
              actions: scrubbedActions,
              bonusActions: itemType === "bonusAction" ? (definition.bonusActions ?? []).filter((item) => item.id !== itemId) : definition.bonusActions,
              reactions: itemType === "reaction" ? (definition.reactions ?? []).filter((item) => item.id !== itemId) : definition.reactions
            };
          })
        });
      },
      mapBasicAttack: (definitionId, input = {}) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => {
            if (definition.id !== definitionId) return definition;
            return {
              ...definition,
              actions: [
                ...definition.actions.filter((action) => action.kind !== "unsupported"),
                {
                  kind: "attack" as const,
                  id: `mapped-basic-${definitionId}`,
                  name: "Mapped Basic Attack",
                  actionType: "action" as const,
                  attackType: "melee" as const,
                  ability: "str" as const,
                  attackBonus: input.attackBonus ?? 4,
                  range: 5,
                  reach: 5,
                  damage: [{ dice: input.damageDice ?? "1d6", damageType: "slashing" as const, abilityModifier: "str" as const }],
                  automationSupport: "full" as const
                }
              ]
            };
          })
        });
      },
      duplicateSelected: () => {
        const encounter = get().encounter;
        const selected = encounter.combatants.find((combatant) => combatant.id === get().selectedCombatantId);
        if (!selected) return;
        const definition = encounter.definitions.find((candidate) => candidate.id === selected.definitionId);
        if (!definition) return;
        const duplicate = {
          ...selected,
          id: `combatant-${crypto.randomUUID()}`,
          displayName: `${definition.name} ${encounter.combatants.filter((combatant) => combatant.definitionId === definition.id).length + 1}`,
          position: findOpenCell(encounter),
          currentHp: definition.maxHp,
          tempHp: 0,
          initiative: undefined,
          state: "active" as const
        };
        commitEncounter({ ...encounter, combatants: [...encounter.combatants, duplicate] }, {
          selectedCombatantId: duplicate.id
        });
      }
    });
    },
    {
      name: "battle-sim-encounter-v1",
      partialize: (state) => ({
        encounter: state.encounter,
        log: state.log,
        mapImageDataUrl: state.mapImageDataUrl,
        selectedCombatantId: state.selectedCombatantId,
        currentProjectId: state.currentProjectId,
        currentEncounterId: state.currentEncounterId
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<EncounterStore> | undefined;
        return {
          ...currentState,
          ...persisted,
          encounter: normalizeEncounterVisuals(persisted?.encounter ?? currentState.encounter)
        };
      }
    }
  )
);

function findOpenCell(encounter: EncounterSnapshot): Point {
  for (let y = 0; y < encounter.map.grid.height; y += 1) {
    for (let x = 0; x < encounter.map.grid.width; x += 1) {
      const occupied = encounter.combatants.some((combatant) => combatant.position.x === x && combatant.position.y === y);
      if (!occupied) {
        return { x, y };
      }
    }
  }
  return { x: 0, y: 0 };
}

function pointsMatch(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
}

function featureEffectsFromPreset(preset: "none" | "pack-tactics" | "swarm" | "defense" | "resource-regain" | undefined): FeatureEffect[] | undefined {
  if (!preset || preset === "none") {
    return undefined;
  }
  if (preset === "pack-tactics") {
    return [{
      kind: "attack-advantage",
      condition: "ally-adjacent-to-target"
    }];
  }
  if (preset === "swarm") {
    return [{
      kind: "swarm-damage",
      fullHpDamage: [{ dice: "2d6", damageType: "piercing" }],
      bloodiedDamage: [{ dice: "1d6", damageType: "piercing" }]
    }];
  }
  if (preset === "defense") {
    return [{
      kind: "armor-class-bonus",
      bonus: { base: 1 }
    }];
  }
  return [{
    kind: "resource-regain",
    timing: "turn-start",
    resourceId: "limited-use",
    amount: { base: 1 },
    max: 1
  }];
}
