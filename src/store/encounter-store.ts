"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  activeFactions,
  admitReinforcements,
  createEngineState,
  applyCondition,
  applyTimedFeatureEffects,
  DEFAULT_GRID_VISUALS,
  DEFAULT_MAP_IMAGE_SETTINGS,
  event,
  expireConditions,
  getDefinition,
  getExecutableActions,
  resolveDeathSave,
  resetActionEconomy,
  rollInitiative,
  runAutomatedEncounter,
  runBatchSimulations,
  runRepeatedSaves,
  sampleEncounter,
  sizeFootprint,
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
  type PlacedTemplate,
  type Point,
  type SpellDefinition,
  type SimulationOutcome,
  type TerrainZone,
  type TokenVisuals,
  type WeaponDefinition,
  normalizeWall,
  normalizeWeaponDefinition,
  normalizeSpellDefinition,
  normalizeActionDefinition,
  type ActionRider,
  type CoverLevel,
  type WallSegment
} from "@/engine";
import { findSrdFeature, findSrdSpell, findSrdWeapon } from "@/data/srd";
import { clampReplayIndex } from "@/lib/replay";
import { downscaleDataUrl } from "@/lib/imageResize";
import { createEncounterStorage } from "@/lib/encounterStorage";
import { copyMapImage, deleteMapImage, getMapImage, putMapImage } from "@/lib/mapImageStore";
import { wouldCreateCycle, type ActorFolder } from "@/lib/actor-folders";

export type EditorTool = "select" | "move" | "measure" | "sight" | "wall" | "terrain" | "template" | "delete";

export type WallUpdate = Partial<Pick<WallSegment, "blocksMovement" | "blocksSight" | "blocksProjectiles" | "doorState" | "cover">>;

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  updatedAt: string;
  encounters?: EncounterSummary[];
}

export interface EncounterSummary {
  id: string;
  name: string;
  updatedAt?: string;
  projectId?: string;
  snapshotJson?: EncounterSnapshot;
}

interface EncounterStore {
  encounter: EncounterSnapshot;
  log: CombatLogEvent[];
  outcome: SimulationOutcome | null;
  batchSummary: BatchSimulationSummary | null;
  /** Pre-run board that the replay reducer folds the event log over. Null = not in replay. */
  replayBase: EncounterSnapshot | null;
  /** Number of log events currently applied by the replay scrubber. Null = not in replay. */
  replayIndex: number | null;
  /** Playback rate for "watch mode" (0.5 / 1 / 2 / 4). Lives here so the scene can tween tokens to match. */
  replaySpeed: number;
  selectedCombatantId: string | null;
  /** The *current* scene's background, mirrored from IndexedDB for rendering. Not persisted to localStorage. */
  mapImageDataUrl: string | null;
  currentProjectId: string | null;
  currentEncounterId: string | null;
  projects: ProjectSummary[];
  projectStatus: string;
  definitionsLibrary: CreatureDefinition[];
  definitionStatus: string;
  actorFolders: ActorFolder[];
  folderStatus: string;
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
  setReplayIndex: (index: number) => void;
  setReplaySpeed: (speed: number) => void;
  exitReplay: () => void;
  reset: () => void;
  undo: () => void;
  redo: () => void;
  deleteLastWall: () => void;
  deleteLastTerrain: () => void;
  removeWall: (wallId: string) => void;
  removeWalls: (wallIds: string[]) => void;
  updateWall: (wallId: string, updates: WallUpdate) => void;
  updateWalls: (wallIds: string[], updates: WallUpdate) => void;
  /** Cover level applied to the next wall drawn with the wall tool. */
  wallCoverDraft: CoverLevel;
  setWallCoverDraft: (cover: CoverLevel) => void;
  moveWallNode: (from: Point, to: Point) => void;
  deleteWallNode: (point: Point) => void;
  deleteWallNodes: (points: Point[]) => void;
  cancelWallPlacement: () => void;
  toggleDoorState: (wallId: string) => void;
  updateTerrain: (terrainId: string, updates: Partial<Pick<TerrainZone, "name" | "type" | "movementMultiplier" | "tags">>) => void;
  removeTerrain: (terrainId: string) => void;
  addTemplate: (template: Omit<PlacedTemplate, "id">) => string;
  updateTemplate: (templateId: string, updates: Partial<Omit<PlacedTemplate, "id">>) => void;
  removeTemplate: (templateId: string) => void;
  loadProjects: () => Promise<void>;
  saveProject: () => Promise<void>;
  loadProject: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  createEncounter: (name: string) => Promise<void>;
  saveCurrentEncounter: () => Promise<void>;
  loadEncounter: (encounterId: string) => Promise<void>;
  renameEncounter: (encounterId: string, name: string) => Promise<void>;
  duplicateEncounter: (encounterId?: string) => Promise<void>;
  deleteEncounter: (encounterId: string) => Promise<void>;
  updateEncounterMetadata: (updates: { name?: string; mapName?: string }) => void;
  loadDefinitionsLibrary: () => Promise<void>;
  saveSelectedDefinition: () => Promise<void>;
  saveDefinition: (definitionId: string) => Promise<void>;
  addLibraryDefinitionToEncounter: (definitionId: string, faction?: "party" | "enemy", position?: Point) => void;
  deleteLibraryDefinition: (definitionId: string) => Promise<void>;
  loadActorFolders: () => Promise<void>;
  createActorFolder: (name: string, parentId?: string | null) => Promise<void>;
  renameActorFolder: (folderId: string, name: string) => Promise<void>;
  moveActorFolder: (folderId: string, parentId: string | null) => Promise<void>;
  deleteActorFolder: (folderId: string) => Promise<void>;
  moveDefinitionToFolder: (definitionId: string, folderId: string | null) => Promise<void>;
  selectCombatant: (id: string | null) => void;
  setMapImage: (dataUrl: string | null) => void;
  /** Load the current scene's background from IndexedDB into `mapImageDataUrl`. */
  hydrateMapImage: () => void;
  updateGrid: (updates: Partial<EncounterSnapshot["map"]["grid"]>) => void;
  updateMapImageSettings: (updates: Partial<NonNullable<EncounterSnapshot["map"]["image"]>>) => void;
  updateMapCanvas: (updates: Partial<NonNullable<EncounterSnapshot["map"]["canvas"]>>) => void;
  updateHp: (combatantId: string, hp: number) => void;
  updateTactics: (combatantId: string, tactics: EncounterSnapshot["combatants"][number]["tacticsProfile"]) => void;
  updateFactionTactics: (faction: CombatantState["faction"], tactics: CombatantState["tacticsProfile"]) => void;
  updateResourceStance: (combatantId: string, stance: CombatantState["resourceStance"]) => void;
  updateFactionResourceStance: (faction: CombatantState["faction"], stance: CombatantState["resourceStance"]) => void;
  updateTags: (combatantId: string, tags: CombatantState["tags"]) => void;
  updateResource: (combatantId: string, resourceId: string, amount: number) => void;
  updateDefinitionResource: (definitionId: string, resourceId: string, amount: number) => void;
  applyConditionToCombatant: (combatantId: string, condition: ConditionName) => void;
  clearConditions: (combatantId: string) => void;
  replaceEncounter: (encounter: EncounterSnapshot, mapImageDataUrl?: string | null) => void;
  addCreatureDefinition: (definition: CreatureDefinition, faction?: "party" | "enemy", position?: Point) => void;
  importCombatantPackage: (input: CombatantExportPackage) => string;
  addCustomPc: (input: { name: string; ac: number; hp: number; speed: number; attackBonus: number; damageDice: string }) => string;
  addCustomToken: (input: { name: string; faction: "party" | "enemy"; ac: number; hp: number; speed: number; proficiencyBonus: number; abilities: CreatureDefinition["abilities"]; attackName: string; attackType: "melee" | "ranged"; attackAbility: Ability; damageDice: string; damageType: DamageType }) => string;
  updateCombatant: (combatantId: string, updates: Partial<Pick<CombatantState, "displayName" | "faction" | "position" | "tempHp" | "state" | "tacticsProfile" | "tokenVisuals">>) => void;
  /** Bench one or more tokens as reinforcements arriving on a given round (≤ 1 / undefined = on the board). */
  setArrivesRound: (combatantIds: string[], arrivesRound: number | undefined) => void;
  updateCombatantVisuals: (combatantId: string, updates: Partial<TokenVisuals>) => void;
  updateDefinitionVisuals: (definitionId: string, updates: Partial<TokenVisuals>) => void;
  removeCombatant: (combatantId: string) => void;
  /** Remove several combatants in one undo step. Keeps the current selection if it survives. */
  removeCombatants: (combatantIds: string[]) => void;
  /**
   * Move a combatant to any cell — no reachability / opportunity-attack / cost
   * check. The footprint is clamped onto the grid. One undo step; a no-op (no
   * undo entry) when the cell is unchanged.
   */
  placeCombatant: (combatantId: string, cell: Point) => void;
  updateCreatureDefinition: (definitionId: string, updates: Partial<CreatureDefinition>) => void;
  updateCreatureAbility: (definitionId: string, ability: Ability, value: number) => void;
  attachSpellDefinition: (definitionId: string, spell: SpellDefinition) => void;
  attachWeaponDefinition: (definitionId: string, weapon: WeaponDefinition) => void;
  /**
   * Attach a copy of a bundled SRD weapon to a definition. Deep-clones the
   * library entry, re-mints its id / actionId / rider ids, and — for a weapon
   * with a `charges` pool — namespaces the resource id, rewrites the matching
   * rider `resourceCost`, seeds `definition.resources`, and tops up existing
   * combatants of that definition. One undo step. Returns the new weapon id, or
   * `undefined` if the srd id or definition is unknown.
   */
  attachSrdWeapon: (definitionId: string, srdId: string) => string | undefined;
  /** Attach a copy of a bundled SRD spell to a definition. Re-mints id / action id / rider ids. One undo step. */
  attachSrdSpell: (definitionId: string, srdId: string) => string | undefined;
  attachFeatureDefinition: (definitionId: string, feature: FeatureDefinition) => void;
  /**
   * Attach a copy of a bundled SRD feature. Re-mints the feature id + every
   * `grantedActions` id, points `featureId` back at the fresh id, and seeds any
   * `resourceCost` pool (rage / action-surge / second-wind …) on the definition
   * and its combatants. One undo step. `undefined` if the srd id is unknown.
   */
  attachSrdFeature: (definitionId: string, srdId: string) => string | undefined;
  /** Add a fully-formed feature / trait from the guided builder (light-normalized, one undo step). Returns its id. */
  addFeatureV2: (definitionId: string, feature: FeatureDefinition) => string;
  /** Merge a partial patch into one feature / trait. One undo step. */
  updateFeature: (definitionId: string, featureId: string, patch: Partial<FeatureDefinition>) => void;
  addMultiattack: (definitionId: string, input: { name: string; attacks: Array<{ actionId: string; count: number; targetGroup?: number }> }) => void;
  /** Add a fully-formed weapon record from the guided builder (normalized, one undo step). Returns its id. */
  addWeaponV2: (definitionId: string, weapon: WeaponDefinition) => string;
  /** Add a fully-formed spell record from the guided builder. Returns its id. */
  addSpellV2: (definitionId: string, spell: SpellDefinition) => string;
  /** Add a fully-formed action from the guided builder; routed to actions / bonusActions / reactions by `actionType`. Returns its id. */
  addActionV2: (definitionId: string, action: ActionDefinition) => string;
  /** Merge a partial patch into one weapon and re-normalize it. One undo step. */
  updateWeapon: (definitionId: string, weaponId: string, patch: Partial<WeaponDefinition>) => void;
  /** Merge a partial patch into one spell and re-normalize it. One undo step. */
  updateSpell: (definitionId: string, spellId: string, patch: Partial<SpellDefinition>) => void;
  /** Merge a partial patch into one action (searched across actions / bonusActions / reactions) and re-normalize it. One undo step. */
  updateAction: (definitionId: string, actionId: string, patch: Partial<ActionDefinition>) => void;
  removeDefinitionItem: (definitionId: string, itemType: "weapon" | "spell" | "feature" | "trait" | "action" | "bonusAction" | "reaction", itemId: string) => void;
  /** Clone a specific combatant (fresh id, full HP, no initiative) and select the copy. */
  duplicateCombatant: (combatantId: string) => void;
  /** Clone whatever combatant is currently selected. Thin wrapper over `duplicateCombatant`. */
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
      walls: encounter.map.walls.map(normalizeWall),
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

/** Default movement / sight flags for a freshly drawn or re-levelled wall. */
function wallPresetFlags(cover: CoverLevel): Pick<WallSegment, "blocksMovement" | "blocksSight" | "blocksProjectiles"> {
  return {
    blocksMovement: cover !== "none",
    blocksSight: cover === "total",
    blocksProjectiles: cover === "total"
  };
}

function hasOpenActionEconomy(combatant: CombatantState): boolean {
  const actionEconomy = combatant.actionEconomy;
  // The reaction is deliberately excluded: a finished turn keeps its reaction
  // available (see `closeActionEconomy`), so it is not a signal that the turn's
  // end-of-turn bookkeeping still needs to run.
  return Boolean(actionEconomy && (actionEconomy.action || actionEconomy.bonus));
}

function closeActionEconomy(combatant: CombatantState): void {
  // Ending a turn spends the remaining action + bonus action, but NOT the
  // reaction: a creature keeps its reaction from the end of its turn until the
  // start of its next one — that is the whole window in which opportunity
  // attacks, Shield, Counterspell and Hellish Rebuke fire. `resetActionEconomy`
  // refreshes it at the start of the creature's next turn.
  const current = combatant.actionEconomy ?? { action: true, bonus: true, reaction: true };
  combatant.actionEconomy = { ...current, action: false, bonus: false };
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

/** Give every rider a fresh id so an attached copy never collides with the library entry or a sibling. */
function remintRiderIds(riders: ActionRider[] | undefined): ActionRider[] | undefined {
  return riders?.map((rider) => ({ ...rider, id: `rider-${crypto.randomUUID()}` }));
}

/** Rewrite a rider's charge `resourceCost.resourceId` from `from` to `to` (leaves other riders untouched). */
function rewriteRiderResourceId(riders: ActionRider[] | undefined, from: string, to: string): ActionRider[] | undefined {
  return riders?.map((rider) =>
    "resourceCost" in rider && rider.resourceCost?.resourceId === from
      ? { ...rider, resourceCost: { ...rider.resourceCost, resourceId: to } }
      : rider
  );
}

/** Rewrite a granted action's own `resourceCost.resourceId` from `from` to `to` (leaves other actions untouched). */
function rewriteActionResourceId(actions: ActionDefinition[] | undefined, from: string, to: string): ActionDefinition[] | undefined {
  return actions?.map((action) =>
    "resourceCost" in action && action.resourceCost?.resourceId === from
      ? { ...action, resourceCost: { ...action.resourceCost, resourceId: to } }
      : action
  );
}

/**
 * Finish preparing a weapon for attachment to a creature: mint a fresh id for
 * every `onHit` rider and `grantedActions` entry (scoped to `weaponId`, so two
 * copies of the same weapon never collide), namespace its charge pool to
 * `<weaponId>:<id>` and rewrite every reference to it, and compute the
 * resource seed the pool needs. Shared by `attachSrdWeapon` and `addWeaponV2`
 * so a custom-built weapon's charges work exactly like a library weapon's.
 */
function prepareWeaponForAttach(weapon: WeaponDefinition, weaponId: string): { weapon: WeaponDefinition; seeded?: Record<string, number> } {
  let next: WeaponDefinition = {
    ...weapon,
    onHit: remintRiderIds(weapon.onHit),
    grantedActions: weapon.grantedActions?.map((action, index) => ({ ...action, id: `${weaponId}-granted-${index + 1}` }))
  };

  let seeded: Record<string, number> | undefined;
  if (next.charges) {
    const fromId = next.charges.id;
    const chargeId = `${weaponId}:${fromId}`;
    const max = next.charges.max;
    next = {
      ...next,
      charges: { ...next.charges, id: chargeId },
      onHit: rewriteRiderResourceId(next.onHit, fromId, chargeId),
      grantedActions: rewriteActionResourceId(next.grantedActions, fromId, chargeId),
      resourceCost: next.resourceCost?.resourceId === fromId ? { ...next.resourceCost, resourceId: chargeId } : next.resourceCost
    };
    seeded = { [chargeId]: max };
  }

  return { weapon: next, seeded };
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

function createSceneSnapshot(source: EncounterSnapshot, name: string, mode: "empty" | "duplicate"): EncounterSnapshot {
  const snapshot = structuredClone(source);
  return normalizeEncounterVisuals({
    ...snapshot,
    id: `encounter-${crypto.randomUUID()}`,
    name,
    seed: `${source.seed}:scene:${crypto.randomUUID()}`,
    round: 0,
    turnIndex: 0,
    definitions: mode === "empty" ? [] : snapshot.definitions,
    combatants: mode === "empty"
      ? []
      : snapshot.combatants.map((combatant) => ({
        ...combatant,
        initiative: undefined,
        actionEconomy: undefined,
        concentration: undefined,
        state: combatant.state === "dead" || combatant.state === "defeated" || combatant.state === "fled" ? "active" : combatant.state
      }))
  });
}

/**
 * IndexedDB key for a scene's background image: the saved DB encounter id once
 * the scene has been saved, otherwise the snapshot's own id while it is a draft.
 * The save flows migrate the draft key to the DB key.
 */
function mapImageKey(state: Pick<EncounterStore, "currentEncounterId" | "encounter">): string {
  return state.currentEncounterId ?? state.encounter.id;
}

export const useEncounterStore = create<EncounterStore>()(
  persist(
    (set, get) => {
      const hydrateMapImage = () => {
        const key = mapImageKey(get());
        void getMapImage(key).then((image) => {
          // Ignore if the user switched scenes while the read was in flight.
          if (mapImageKey(get()) === key) {
            set({ mapImageDataUrl: image ?? null });
          }
        });
      };

      /** Move a scene's stored image from one key to another (draft id -> saved DB id). */
      const migrateMapImageKey = (fromKey: string, toKey: string) => {
        if (!fromKey || !toKey || fromKey === toKey) return;
        const image = get().mapImageDataUrl;
        void (async () => {
          if (image) await putMapImage(toKey, image);
          await deleteMapImage(fromKey);
        })();
      };

      const commitEncounter = (
        encounter: EncounterSnapshot,
        extras: Partial<EncounterStore> = {}
      ) => set({
        encounter: normalizeEncounterVisuals(encounter),
        undoStack: [structuredClone(get().encounter), ...get().undoStack].slice(0, 50),
        redoStack: [],
        outcome: null,
        batchSummary: null,
        replayBase: null,
        replayIndex: null,
        ...extras
      });

      return ({
      encounter: normalizeEncounterVisuals(structuredClone(sampleEncounter)),
      log: [],
      outcome: null,
      batchSummary: null,
      replayBase: null,
      replayIndex: null,
      replaySpeed: 1,
      selectedCombatantId: "pc-fighter",
      mapImageDataUrl: null,
      currentProjectId: null,
      currentEncounterId: null,
      projects: [],
      projectStatus: "",
      definitionsLibrary: [],
      definitionStatus: "",
      actorFolders: [],
      folderStatus: "",
      undoStack: [],
      redoStack: [],
      tool: "select",
      pendingWallStart: null,
      wallCoverDraft: "total",
      setWallCoverDraft: (cover) => set({ wallCoverDraft: cover }),
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
          const wall: WallSegment = normalizeWall({
            id: `wall-${crypto.randomUUID()}`,
            start: state.pendingWallStart,
            end: point,
            cover: state.wallCoverDraft,
            ...wallPresetFlags(state.wallCoverDraft)
          });
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

        if (state.tool === "delete") {
          return;
        }

        const selectedId = state.selectedCombatantId;
        if (state.tool !== "move" || !selectedId) {
          return;
        }
        // Free placement: drop the token wherever clicked, no range / OA / cost.
        get().placeCombatant(selectedId, point);
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
            runRepeatedSaves(engine, currentActor.id, "turn-end");
          }
          expireConditions(engine, "end");
          closeActionEconomy(currentActor);
        }

        const eligibleIndexes = () => encounter.combatants
          .map((combatant, index) => ({ combatant, index }))
          .filter(({ combatant }) => canTakeTurn(encounter, combatant));

        let turnIndexes = eligibleIndexes();
        if (turnIndexes.length === 0 && !encounter.combatants.some((c) => c.state === "reserve")) return;
        const current = encounter.turnIndex;
        const prospectiveNext = turnHasStarted
          ? turnIndexes.find(({ index }) => index > current)?.index ?? turnIndexes[0]?.index ?? 0
          : turnIndexes[0]?.index ?? 0;
        const wrapped = turnHasStarted && (turnIndexes.length === 0 || prospectiveNext <= current);
        encounter.round = encounter.round <= 0 ? 1 : wrapped ? encounter.round + 1 : encounter.round;

        // Scheduled reinforcements enter at the start of the round they are due.
        // Re-derive the eligible set afterward so an arrival takes its turn now.
        admitReinforcements(engine);
        turnIndexes = eligibleIndexes();
        if (turnIndexes.length === 0) return;
        const next = wrapped || !turnHasStarted
          ? turnIndexes[0]?.index ?? 0
          : turnIndexes.find(({ index }) => index > current)?.index ?? turnIndexes[0]?.index ?? 0;
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
          runRepeatedSaves(engine, combatant.id, "turn-start");
          resetActionEconomy(combatant);
          try {
            takeAutomatedTurn(engine, combatant);
          } catch (error) {
            engine.log.push(event(engine, "AutomationWarning", `${combatant.displayName}: automated turn failed — ${error instanceof Error ? error.message : String(error)}`, { combatantId: combatant.id }));
          }
          applyTimedFeatureEffects(engine, combatant.id, "turn-end");
          runRepeatedSaves(engine, combatant.id, "turn-end");
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
        // A tuning tool, not a VTT: the run does NOT overwrite the editable
        // board. Instead we keep the pre-run setup as `replayBase` and drop the
        // UI into replay/"watch" mode over the fresh event log, starting at the
        // beginning so the user can watch decisions unfold. Exiting replay (any
        // edit, or the Exit button) leaves the original setup intact to tweak.
        const base = structuredClone(get().encounter);
        const result = runAutomatedEncounter(get().encounter, 50);
        const encounterId = get().currentEncounterId;
        set({
          log: result.log,
          outcome: result.outcome,
          batchSummary: null,
          replayBase: base,
          replayIndex: 0,
          tool: "select",
          pendingWallStart: null
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
      setReplayIndex: (index) => {
        const state = get();
        if (state.replayBase == null) return;
        set({ replayIndex: clampReplayIndex(index, state.log.length) });
      },
      setReplaySpeed: (speed) => set({ replaySpeed: speed > 0 ? speed : 1 }),
      exitReplay: () => set({ replayBase: null, replayIndex: null }),
      reset: () => {
        void deleteMapImage(mapImageKey(get()));
        commitEncounter(structuredClone(sampleEncounter), {
          log: [],
          outcome: null,
          batchSummary: null,
          replayBase: null,
          replayIndex: null,
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
          replayBase: null,
          replayIndex: null,
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
          replayBase: null,
          replayIndex: null,
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
      removeWall: (wallId) => get().removeWalls([wallId]),
      removeWalls: (wallIds) => {
        if (wallIds.length === 0) return;
        const ids = new Set(wallIds);
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: { ...encounter.map, walls: encounter.map.walls.filter((wall) => !ids.has(wall.id)) }
        });
      },
      updateWall: (wallId, updates) => get().updateWalls([wallId], updates),
      updateWalls: (wallIds, updates) => {
        if (wallIds.length === 0) return;
        const ids = new Set(wallIds);
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            walls: encounter.map.walls.map((wall) => {
              if (!ids.has(wall.id)) return wall;
              // Re-levelling via the `cover` select re-applies that level's block preset;
              // the individual checkboxes can then still be tuned (they don't carry `cover`).
              const presets = updates.cover !== undefined && updates.cover !== wall.cover
                ? wallPresetFlags(updates.cover)
                : {};
              return normalizeWall({ ...wall, ...presets, ...updates });
            })
          }
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
      deleteWallNode: (point) => get().deleteWallNodes([point]),
      deleteWallNodes: (points) => {
        if (points.length === 0) return;
        const touches = (p: Point) => points.some((point) => pointsMatch(p, point));
        const encounter = get().encounter;
        const pending = get().pendingWallStart;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            walls: encounter.map.walls.filter((wall) => !touches(wall.start) && !touches(wall.end))
          }
        }, {
          pendingWallStart: pending && touches(pending) ? null : pending
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
      updateTerrain: (terrainId, updates) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            terrain: encounter.map.terrain.map((terrain) => terrain.id === terrainId ? { ...terrain, ...updates } : terrain)
          }
        });
      },
      addTemplate: (template) => {
        const encounter = get().encounter;
        const id = `template-${crypto.randomUUID()}`;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            templates: [...(encounter.map.templates ?? []), { id, ...template }]
          }
        });
        return id;
      },
      updateTemplate: (templateId, updates) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            templates: (encounter.map.templates ?? []).map((template) => template.id === templateId ? { ...template, ...updates } : template)
          }
        });
      },
      removeTemplate: (templateId) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            templates: (encounter.map.templates ?? []).filter((template) => template.id !== templateId)
          }
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
        if (state.currentProjectId && state.currentEncounterId) {
          await get().saveCurrentEncounter();
          return;
        }
        const payload = {
          name: state.encounter.name,
          encounter: state.encounter
        };
        if (state.currentProjectId) {
          const response = await fetch("/api/encounters", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, projectId: state.currentProjectId })
          });
          if (!response.ok) {
            set({ projectStatus: "Scene save failed" });
            return;
          }
          const data = await response.json() as { encounter: EncounterSummary };
          set({
            currentEncounterId: data.encounter.id,
            projectStatus: "Scene saved"
          });
          await get().loadProjects();
          return;
        }
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          set({ projectStatus: "Save failed" });
          return;
        }
        const data = await response.json() as { project: ProjectSummary & { encounters?: Array<{ id: string; name: string }> } };
        const encounterId = data.project.encounters?.[0]?.id ?? get().currentEncounterId;
        const draftKey = mapImageKey(get());
        set({
          currentProjectId: data.project.id,
          currentEncounterId: encounterId,
          projectStatus: "Saved"
        });
        if (encounterId) migrateMapImageKey(draftKey, encounterId);
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
          mapImageDataUrl: null,
          undoStack: [],
          redoStack: [],
          log: [],
          outcome: null,
          batchSummary: null,
          replayBase: null,
          replayIndex: null,
          projectStatus: "Loaded"
        });
        hydrateMapImage();
        await get().loadProjects();
      },
      deleteProject: async (projectId) => {
        const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
        set({ projectStatus: response.ok ? "Deleted" : "Delete failed" });
        if (get().currentProjectId === projectId) {
          set({ currentProjectId: null, currentEncounterId: null });
        }
        await get().loadProjects();
      },
      createEncounter: async (name) => {
        const trimmedName = name.trim() || "Untitled Encounter";
        if (!get().currentProjectId) {
          await get().saveProject();
        }
        const projectId = get().currentProjectId;
        if (!projectId) {
          set({ projectStatus: "Create scene failed" });
          return;
        }
        const snapshot = createSceneSnapshot(get().encounter, trimmedName, "empty");
        const response = await fetch("/api/encounters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, name: trimmedName, encounter: snapshot })
        });
        if (!response.ok) {
          set({ projectStatus: "Create scene failed" });
          return;
        }
        const data = await response.json() as { encounter: EncounterSummary };
        const normalizedSnapshot = normalizeEncounterVisuals(data.encounter.snapshotJson ?? snapshot);
        const currentMapImage = get().mapImageDataUrl;
        set({
          currentProjectId: projectId,
          currentEncounterId: data.encounter.id,
          encounter: normalizedSnapshot,
          selectedCombatantId: null,
          undoStack: [],
          redoStack: [],
          log: [],
          outcome: null,
          batchSummary: null,
          replayBase: null,
          replayIndex: null,
          projectStatus: "Scene created"
        });
        // A new scene keeps the carried-over map layout, so carry its background too.
        if (currentMapImage) void putMapImage(mapImageKey(get()), currentMapImage);
        await get().loadProjects();
      },
      saveCurrentEncounter: async () => {
        const state = get();
        if (!state.currentProjectId || !state.currentEncounterId) {
          await get().saveProject();
          return;
        }
        const response = await fetch(`/api/encounters/${encodeURIComponent(state.currentEncounterId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: state.encounter.name, encounter: state.encounter })
        });
        // The background is already in IndexedDB under this scene's id (written
        // by `setMapImage`); nothing image-related to do on save.
        set({ projectStatus: response.ok ? "Scene saved" : "Scene save failed" });
        if (response.ok) {
          await get().loadProjects();
        }
      },
      loadEncounter: async (encounterId) => {
        const response = await fetch(`/api/encounters/${encodeURIComponent(encounterId)}`);
        if (!response.ok) {
          set({ projectStatus: "Scene load failed" });
          return;
        }
        const data = await response.json() as { encounter: EncounterSummary };
        const snapshot = data.encounter.snapshotJson;
        if (!snapshot) {
          set({ projectStatus: "Scene has no snapshot" });
          return;
        }
        const normalizedSnapshot = normalizeEncounterVisuals(snapshot);
        set({
          currentProjectId: data.encounter.projectId ?? get().currentProjectId,
          currentEncounterId: data.encounter.id,
          encounter: normalizedSnapshot,
          mapImageDataUrl: null,
          selectedCombatantId: normalizedSnapshot.combatants[0]?.id ?? null,
          undoStack: [],
          redoStack: [],
          log: [],
          outcome: null,
          batchSummary: null,
          replayBase: null,
          replayIndex: null,
          projectStatus: "Scene loaded"
        });
        hydrateMapImage();
        await get().loadProjects();
      },
      renameEncounter: async (encounterId, name) => {
        const trimmedName = name.trim();
        if (!trimmedName) {
          set({ projectStatus: "Scene name required" });
          return;
        }
        const state = get();
        const encounter = state.currentEncounterId === encounterId
          ? { ...state.encounter, name: trimmedName }
          : undefined;
        const response = await fetch(`/api/encounters/${encodeURIComponent(encounterId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(encounter ? { name: trimmedName, encounter } : { name: trimmedName })
        });
        if (!response.ok) {
          set({ projectStatus: "Scene rename failed" });
          return;
        }
        set({
          encounter: encounter ? normalizeEncounterVisuals(encounter) : state.encounter,
          projectStatus: "Scene renamed"
        });
        await get().loadProjects();
      },
      duplicateEncounter: async (encounterId) => {
        if (!get().currentProjectId) {
          await get().saveProject();
        }
        const projectId = get().currentProjectId;
        if (!projectId) {
          set({ projectStatus: "Duplicate scene failed" });
          return;
        }
        let source = get().encounter;
        if (encounterId && encounterId !== get().currentEncounterId) {
          const loadResponse = await fetch(`/api/encounters/${encodeURIComponent(encounterId)}`);
          if (!loadResponse.ok) {
            set({ projectStatus: "Duplicate scene failed" });
            return;
          }
          const loaded = await loadResponse.json() as { encounter: EncounterSummary };
          if (loaded.encounter.snapshotJson) {
            source = loaded.encounter.snapshotJson;
          }
        }
        const snapshot = createSceneSnapshot(source, `${source.name} Copy`, "duplicate");
        const sourceImageKey = encounterId && encounterId !== get().currentEncounterId
          ? encounterId
          : mapImageKey(get());
        const response = await fetch("/api/encounters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, name: snapshot.name, encounter: snapshot })
        });
        if (!response.ok) {
          set({ projectStatus: "Duplicate scene failed" });
          return;
        }
        const data = await response.json() as { encounter: EncounterSummary };
        const normalizedSnapshot = normalizeEncounterVisuals(data.encounter.snapshotJson ?? snapshot);
        set({
          currentProjectId: projectId,
          currentEncounterId: data.encounter.id,
          encounter: normalizedSnapshot,
          mapImageDataUrl: null,
          selectedCombatantId: normalizedSnapshot.combatants[0]?.id ?? null,
          undoStack: [],
          redoStack: [],
          log: [],
          outcome: null,
          batchSummary: null,
          replayBase: null,
          replayIndex: null,
          projectStatus: "Scene duplicated"
        });
        void copyMapImage(sourceImageKey, mapImageKey(get())).then(() => hydrateMapImage());
        await get().loadProjects();
      },
      deleteEncounter: async (encounterId) => {
        const response = await fetch(`/api/encounters/${encodeURIComponent(encounterId)}`, { method: "DELETE" });
        if (!response.ok) {
          set({ projectStatus: "Scene delete failed" });
          return;
        }
        const wasCurrent = get().currentEncounterId === encounterId;
        set({
          currentEncounterId: wasCurrent ? null : get().currentEncounterId,
          mapImageDataUrl: wasCurrent ? null : get().mapImageDataUrl,
          projectStatus: "Scene deleted"
        });
        void deleteMapImage(encounterId);
        await get().loadProjects();
        if (wasCurrent) {
          const project = get().projects.find((candidate) => candidate.id === get().currentProjectId);
          const nextScene = project?.encounters?.find((candidate) => candidate.id !== encounterId);
          if (nextScene) {
            await get().loadEncounter(nextScene.id);
          }
        }
      },
      updateEncounterMetadata: (updates) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          name: updates.name ?? encounter.name,
          map: {
            ...encounter.map,
            name: updates.mapName ?? encounter.map.name
          }
        });
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
      saveDefinition: async (definitionId) => {
        const state = get();
        const definition = state.encounter.definitions.find((candidate) => candidate.id === definitionId)
          ?? state.definitionsLibrary.find((candidate) => candidate.id === definitionId);
        if (!definition) {
          set({ definitionStatus: "Definition not found" });
          return;
        }
        const response = await fetch("/api/definitions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ definition })
        });
        set({ definitionStatus: response.ok ? "Definition saved" : "Definition save failed" });
        if (response.ok) {
          await get().loadDefinitionsLibrary();
        }
      },
      addLibraryDefinitionToEncounter: (definitionId, faction = "enemy", position) => {
        const definition = get().definitionsLibrary.find((candidate) => candidate.id === definitionId);
        if (definition) {
          get().addCreatureDefinition(definition, faction, position);
        }
      },
      deleteLibraryDefinition: async (definitionId) => {
        const response = await fetch(`/api/definitions/${encodeURIComponent(definitionId)}`, { method: "DELETE" });
        set({ definitionStatus: response.ok ? "Definition deleted" : "Definition delete failed" });
        await get().loadDefinitionsLibrary();
      },
      loadActorFolders: async () => {
        const response = await fetch("/api/folders");
        if (!response.ok) {
          set({ folderStatus: "Folder list failed" });
          return;
        }
        const data = await response.json() as { folders: ActorFolder[] };
        set({ actorFolders: data.folders, folderStatus: "" });
      },
      createActorFolder: async (name, parentId = null) => {
        const response = await fetch("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, parentId })
        });
        set({ folderStatus: response.ok ? "" : "Folder create failed" });
        if (response.ok) await get().loadActorFolders();
      },
      renameActorFolder: async (folderId, name) => {
        const response = await fetch(`/api/folders/${encodeURIComponent(folderId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name })
        });
        set({ folderStatus: response.ok ? "" : "Folder rename failed" });
        if (response.ok) await get().loadActorFolders();
      },
      moveActorFolder: async (folderId, parentId) => {
        if (wouldCreateCycle(get().actorFolders, folderId, parentId)) {
          set({ folderStatus: "Cannot move a folder into itself or one of its own descendants" });
          return;
        }
        const response = await fetch(`/api/folders/${encodeURIComponent(folderId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId })
        });
        set({ folderStatus: response.ok ? "" : "Folder move failed" });
        if (response.ok) await get().loadActorFolders();
      },
      deleteActorFolder: async (folderId) => {
        const response = await fetch(`/api/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
        set({ folderStatus: response.ok ? "" : "Folder delete failed" });
        await get().loadActorFolders();
        await get().loadDefinitionsLibrary();
      },
      moveDefinitionToFolder: async (definitionId, folderId) => {
        const state = get();
        const definition = state.encounter.definitions.find((candidate) => candidate.id === definitionId)
          ?? state.definitionsLibrary.find((candidate) => candidate.id === definitionId);
        if (!definition) {
          set({ definitionStatus: "Definition not found" });
          return;
        }
        // Filing an actor into a folder implicitly saves it to the library (there's
        // nothing to organize otherwise) — mirrors saveDefinition's upsert-the-whole-blob call.
        const updated: CreatureDefinition = { ...definition, folderId };
        // Also patch the live encounter's copy (if any): the directory view merges
        // definitionsLibrary with encounter.definitions, preferring the latter, so
        // without this the folder move would appear to silently no-op for any actor
        // that's also placed in the current scene.
        if (state.encounter.definitions.some((candidate) => candidate.id === definitionId)) {
          commitEncounter({
            ...state.encounter,
            definitions: state.encounter.definitions.map((candidate) => candidate.id === definitionId ? updated : candidate)
          });
        }
        const response = await fetch("/api/definitions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ definition: updated })
        });
        set({ definitionStatus: response.ok ? "Actor moved" : "Move failed" });
        if (response.ok) {
          await get().loadDefinitionsLibrary();
        }
      },
      selectCombatant: (id) => set({ selectedCombatantId: id }),
      hydrateMapImage,
      setMapImage: (dataUrl) => {
        const applyMapImage = (value: string | null) => {
          const key = mapImageKey(get());
          set({ mapImageDataUrl: value });
          // IndexedDB is the source of truth for every scene's background; only
          // the current one is mirrored into state above (for rendering).
          if (value) void putMapImage(key, value);
          else void deleteMapImage(key);
        };

        // A raw upload/import data URL can be many MB. Shrink it before it is
        // stored (IndexedDB) or sent anywhere. The decode is async; apply the
        // result once it's ready.
        if (dataUrl && dataUrl.startsWith("data:image/")) {
          void downscaleDataUrl(dataUrl)
            .then((resized) => applyMapImage(resized))
            .catch(() => applyMapImage(dataUrl));
          return;
        }
        applyMapImage(dataUrl);
      },
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
      updateResourceStance: (combatantId, stance) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => combatant.id === combatantId
            ? { ...combatant, resourceStance: stance }
            : combatant)
        });
      },
      updateFactionResourceStance: (faction, stance) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => combatant.faction === faction
            ? { ...combatant, resourceStance: stance }
            : combatant)
        });
      },
      updateTags: (combatantId, tags) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => combatant.id === combatantId
            ? { ...combatant, tags }
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
          log: [],
          outcome: null,
          batchSummary: null,
          replayBase: null,
          replayIndex: null,
          selectedCombatantId: normalizedEncounter.combatants[0]?.id ?? null
        });
        // Routes the (possibly huge) imported image through the same downscale path.
        get().setMapImage(mapImageDataUrl);
      },
      addCreatureDefinition: (definition, faction = "enemy", position) => {
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
          position: position ?? findOpenCell(encounter),
          currentHp: definition.maxHp,
          tempHp: 0,
          resources: defaultResourcesForDefinition(definition),
          state: "active" as const,
          tacticsProfile: defaultTacticsForDefinition(definition),
          resourceStance: "balanced" as const
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
          tokenVisuals: imported?.tokenVisuals ? structuredClone(imported.tokenVisuals) : undefined,
          state: imported?.state ?? "active",
          tacticsProfile: imported?.tacticsProfile ?? defaultTacticsForDefinition(definition),
          resourceStance: imported?.resourceStance ?? "balanced"
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
        return definition.id;
      },
      addCustomPc: (input) => {
        return get().addCustomToken({
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
        return id;
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
      setArrivesRound: (combatantIds, arrivesRound) => {
        const encounter = get().encounter;
        const ids = new Set(combatantIds);
        // A future round benches the token as a ghosted reinforcement; anything
        // ≤ 1 (or cleared) puts it on the board. Only meaningful before combat
        // starts — once a token is `active`/`downed`/etc. we leave its state be.
        const at = typeof arrivesRound === "number" && arrivesRound > 1 ? Math.floor(arrivesRound) : undefined;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => {
            if (!ids.has(combatant.id)) return combatant;
            if (at) {
              return { ...combatant, arrivesRound: at, state: combatant.state === "active" ? "reserve" : combatant.state };
            }
            return { ...combatant, arrivesRound: undefined, state: combatant.state === "reserve" ? "active" : combatant.state };
          })
        });
      },
      updateCombatantVisuals: (combatantId, updates) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => {
            if (combatant.id !== combatantId) return combatant;
            const tokenVisuals = { ...(combatant.tokenVisuals ?? {}), ...updates };
            return {
              ...combatant,
              tokenVisuals: Object.fromEntries(Object.entries(tokenVisuals).filter(([, value]) => value !== undefined && value !== "")) as TokenVisuals
            };
          })
        });
      },
      updateDefinitionVisuals: (definitionId, updates) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => {
            if (definition.id !== definitionId) return definition;
            const tokenVisuals = { ...(definition.tokenVisuals ?? {}), ...updates };
            return {
              ...definition,
              tokenVisuals: Object.fromEntries(Object.entries(tokenVisuals).filter(([, value]) => value !== undefined && value !== "")) as TokenVisuals
            };
          })
        });
      },
      removeCombatant: (combatantId) => {
        get().removeCombatants([combatantId]);
      },
      removeCombatants: (combatantIds) => {
        const encounter = get().encounter;
        const doomed = new Set(combatantIds);
        const combatants = encounter.combatants.filter((combatant) => !doomed.has(combatant.id));
        if (combatants.length === encounter.combatants.length) {
          return;
        }
        const currentSelection = get().selectedCombatantId;
        const selectionSurvives = currentSelection != null && combatants.some((combatant) => combatant.id === currentSelection);
        commitEncounter({
          ...encounter,
          combatants
        }, {
          selectedCombatantId: selectionSurvives ? currentSelection : combatants[0]?.id ?? null
        });
      },
      placeCombatant: (combatantId, cell) => {
        const encounter = get().encounter;
        const combatant = encounter.combatants.find((entry) => entry.id === combatantId);
        if (!combatant) {
          return;
        }
        const footprint = sizeFootprint(getDefinition(encounter, combatant).size);
        const clampAxis = (value: number, span: number) =>
          Math.min(Math.max(0, Math.floor(value)), Math.max(0, span - footprint));
        const position = {
          x: clampAxis(cell.x, encounter.map.grid.width),
          y: clampAxis(cell.y, encounter.map.grid.height)
        };
        if (position.x === combatant.position.x && position.y === combatant.position.y) {
          return;
        }
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((entry) =>
            entry.id === combatantId ? { ...entry, position } : entry)
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
      attachSpellDefinition: (definitionId, spell) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? { ...definition, spells: [...(definition.spells ?? []).filter((candidate) => candidate.id !== spell.id), spell] }
            : definition)
        });
      },
      attachWeaponDefinition: (definitionId, weapon) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? { ...definition, weapons: [...(definition.weapons ?? []).filter((candidate) => candidate.id !== weapon.id), weapon] }
            : definition)
        });
      },
      attachSrdWeapon: (definitionId, srdId) => {
        const source = findSrdWeapon(srdId);
        const encounter = get().encounter;
        const definition = encounter.definitions.find((candidate) => candidate.id === definitionId);
        if (!source || !definition) return undefined;

        const weaponId = `weapon-${crypto.randomUUID()}`;
        const normalized = normalizeWeaponDefinition(structuredClone(source), definition.abilities);
        normalized.id = weaponId;
        normalized.actionId = `weapon-action-${weaponId}`;
        normalized.source = { provider: "homebrew", documentName: "SRD", slug: srdId, importedAt: new Date().toISOString() };
        const { weapon, seeded } = prepareWeaponForAttach(normalized, weaponId);

        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((candidate) => candidate.id === definitionId
            ? {
              ...candidate,
              weapons: [...(candidate.weapons ?? []), weapon],
              resources: seeded ? { ...(candidate.resources ?? {}), ...seeded } : candidate.resources
            }
            : candidate),
          combatants: seeded
            ? encounter.combatants.map((combatant) => combatant.definitionId === definitionId
              ? { ...combatant, resources: { ...seeded, ...(combatant.resources ?? {}) } }
              : combatant)
            : encounter.combatants
        });
        return weaponId;
      },
      attachSrdSpell: (definitionId, srdId) => {
        const source = findSrdSpell(srdId);
        const encounter = get().encounter;
        const definition = encounter.definitions.find((candidate) => candidate.id === definitionId);
        if (!source || !definition) return undefined;

        const spellId = `spell-${crypto.randomUUID()}`;
        const spell = normalizeSpellDefinition(structuredClone(source));
        spell.id = spellId;
        spell.source = { provider: "homebrew", documentName: "SRD", slug: srdId, importedAt: new Date().toISOString() };
        if (spell.action) {
          const action = { ...spell.action, id: `spell-action-${spellId}` };
          if ("riders" in action) {
            action.riders = remintRiderIds(action.riders);
          }
          spell.action = action;
        }

        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((candidate) => candidate.id === definitionId
            ? { ...candidate, spells: [...(candidate.spells ?? []), spell] }
            : candidate)
        });
        return spellId;
      },
      attachFeatureDefinition: (definitionId, feature) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => {
            if (definition.id !== definitionId) return definition;
            return feature.category === "trait"
              ? { ...definition, traits: [...(definition.traits ?? []).filter((candidate) => candidate.id !== feature.id), feature] }
              : { ...definition, features: [...(definition.features ?? []).filter((candidate) => candidate.id !== feature.id), feature] };
          })
        });
      },
      attachSrdFeature: (definitionId, srdId) => {
        const source = findSrdFeature(srdId);
        const encounter = get().encounter;
        const definition = encounter.definitions.find((candidate) => candidate.id === definitionId);
        if (!source || !definition) return undefined;

        const featureId = `feature-${crypto.randomUUID()}`;
        const feature = normalizeFeatureRecord(structuredClone(source), featureId, srdId);
        const seeded = seededResourcesForFeature(feature);

        const bucket: "features" | "traits" = feature.category === "trait" ? "traits" : "features";
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((candidate) => candidate.id === definitionId
            ? {
              ...candidate,
              [bucket]: [...(candidate[bucket] ?? []), feature],
              resources: seeded ? { ...(candidate.resources ?? {}), ...seeded } : candidate.resources
            }
            : candidate),
          combatants: seeded
            ? encounter.combatants.map((combatant) => combatant.definitionId === definitionId
              ? { ...combatant, resources: { ...seeded, ...(combatant.resources ?? {}) } }
              : combatant)
            : encounter.combatants
        });
        return featureId;
      },
      addFeatureV2: (definitionId, input) => {
        const encounter = get().encounter;
        const id = `feature-${crypto.randomUUID()}`;
        const feature = normalizeFeatureRecord(structuredClone(input), id);
        const seeded = seededResourcesForFeature(feature);
        const bucket: "features" | "traits" = feature.category === "trait" ? "traits" : "features";
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((candidate) => candidate.id === definitionId
            ? {
              ...candidate,
              [bucket]: [...(candidate[bucket] ?? []), feature],
              resources: seeded ? { ...(candidate.resources ?? {}), ...seeded } : candidate.resources
            }
            : candidate),
          combatants: seeded
            ? encounter.combatants.map((combatant) => combatant.definitionId === definitionId
              ? { ...combatant, resources: { ...seeded, ...(combatant.resources ?? {}) } }
              : combatant)
            : encounter.combatants
        });
        return id;
      },
      updateFeature: (definitionId, featureId, patch) => {
        const encounter = get().encounter;
        const patchIn = (list: FeatureDefinition[] | undefined) =>
          (list ?? []).map((feature) => feature.id === featureId
            ? normalizeFeatureRecord({ ...feature, ...patch, id: feature.id }, feature.id)
            : feature);
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? { ...definition, features: patchIn(definition.features), traits: patchIn(definition.traits) }
            : definition)
        });
      },
      addMultiattack: (definitionId, input) => {
        const encounter = get().encounter;
        const attacks = input.attacks
          .filter((step) => step.actionId)
          .map((step) => ({
            actionId: step.actionId,
            count: Math.max(1, Math.floor(step.count) || 1),
            targetGroup: step.targetGroup && step.targetGroup > 0 ? Math.floor(step.targetGroup) : undefined
          }));
        if (attacks.length === 0) return;
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
                  attacks,
                  automationSupport: "full" as const
                }
              ]
            }
            : definition)
        });
      },
      addWeaponV2: (definitionId, weaponInput) => {
        const encounter = get().encounter;
        const definition = encounter.definitions.find((candidate) => candidate.id === definitionId);
        const id = `weapon-${crypto.randomUUID()}`;
        const normalized = normalizeWeaponDefinition({ ...weaponInput, id }, definition?.abilities);
        normalized.id = id;
        normalized.actionId = `weapon-action-${id}`;
        const { weapon, seeded } = prepareWeaponForAttach(normalized, id);
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((candidate) => candidate.id === definitionId
            ? {
              ...candidate,
              weapons: [...(candidate.weapons ?? []), weapon],
              resources: seeded ? { ...(candidate.resources ?? {}), ...seeded } : candidate.resources
            }
            : candidate),
          combatants: seeded
            ? encounter.combatants.map((combatant) => combatant.definitionId === definitionId
              ? { ...combatant, resources: { ...seeded, ...(combatant.resources ?? {}) } }
              : combatant)
            : encounter.combatants
        });
        return id;
      },
      addSpellV2: (definitionId, spell) => {
        const encounter = get().encounter;
        const id = `spell-${crypto.randomUUID()}`;
        const normalized = normalizeSpellDefinition({ ...spell, id });
        normalized.id = id;
        if (normalized.action) {
          normalized.action = { ...normalized.action, id: `spell-action-${id}` };
        }
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((candidate) => candidate.id === definitionId
            ? { ...candidate, spells: [...(candidate.spells ?? []), normalized] }
            : candidate)
        });
        return id;
      },
      addActionV2: (definitionId, action) => {
        const encounter = get().encounter;
        const id = `action-${crypto.randomUUID()}`;
        const fallbackType = action.actionType === "bonus" || action.actionType === "reaction" ? action.actionType : "action";
        const normalized = normalizeActionDefinition({ ...action, id }, fallbackType);
        normalized.id = id;
        const bucket: "actions" | "bonusActions" | "reactions" =
          normalized.actionType === "bonus" ? "bonusActions" : normalized.actionType === "reaction" ? "reactions" : "actions";
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((candidate) => candidate.id === definitionId
            ? { ...candidate, [bucket]: [...(candidate[bucket] ?? []), normalized] }
            : candidate)
        });
        return id;
      },
      updateWeapon: (definitionId, weaponId, patch) => {
        const encounter = get().encounter;
        let seeded: Record<string, number> | undefined;
        const definitions = encounter.definitions.map((definition) => {
          if (definition.id !== definitionId) return definition;
          const weapons = (definition.weapons ?? []).map((weapon) => {
            if (weapon.id !== weaponId) return weapon;
            const merged = normalizeWeaponDefinition({ ...weapon, ...patch, id: weapon.id }, definition.abilities);
            merged.id = weapon.id;
            merged.actionId = weapon.actionId ?? `weapon-action-${weapon.id}`;
            // A pool that just gained a `charges` block (or is being seen for
            // the first time) needs a starting value — an edit shouldn't reset
            // an already-seeded pool back to max.
            if (merged.charges && definition.resources?.[merged.charges.id] === undefined) {
              seeded = { ...seeded, [merged.charges.id]: merged.charges.max };
            }
            return merged;
          });
          return {
            ...definition,
            weapons,
            resources: seeded ? { ...(definition.resources ?? {}), ...seeded } : definition.resources
          };
        });
        commitEncounter({
          ...encounter,
          definitions,
          combatants: seeded
            ? encounter.combatants.map((combatant) => combatant.definitionId === definitionId
              ? { ...combatant, resources: { ...seeded, ...(combatant.resources ?? {}) } }
              : combatant)
            : encounter.combatants
        });
      },
      updateSpell: (definitionId, spellId, patch) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => {
            if (definition.id !== definitionId) return definition;
            return {
              ...definition,
              spells: (definition.spells ?? []).map((spell) => {
                if (spell.id !== spellId) return spell;
                const merged = normalizeSpellDefinition({ ...spell, ...patch, id: spell.id });
                merged.id = spell.id;
                if (merged.action) {
                  merged.action = { ...merged.action, id: spell.action?.id ?? `spell-action-${spell.id}` };
                }
                return merged;
              })
            };
          })
        });
      },
      updateAction: (definitionId, actionId, patch) => {
        const encounter = get().encounter;
        const patchBucket = (list: ActionDefinition[] | undefined, fallback: "action" | "bonus" | "reaction") =>
          (list ?? []).map((action) => {
            if (action.id !== actionId) return action;
            const merged = normalizeActionDefinition({ ...action, ...patch, id: action.id }, fallback);
            merged.id = action.id;
            return merged;
          });
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? {
              ...definition,
              actions: patchBucket(definition.actions, "action"),
              bonusActions: definition.bonusActions ? patchBucket(definition.bonusActions, "bonus") : definition.bonusActions,
              reactions: definition.reactions ? patchBucket(definition.reactions, "reaction") : definition.reactions
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
      duplicateCombatant: (combatantId) => {
        const encounter = get().encounter;
        const source = encounter.combatants.find((combatant) => combatant.id === combatantId);
        if (!source) return;
        const definition = encounter.definitions.find((candidate) => candidate.id === source.definitionId);
        if (!definition) return;
        const duplicate: CombatantState = {
          // Deep clone so nested state (conditions, resources, tokenVisuals) isn't
          // shared with the source.
          ...structuredClone(source),
          id: `combatant-${crypto.randomUUID()}`,
          displayName: `${definition.name} ${encounter.combatants.filter((combatant) => combatant.definitionId === definition.id).length + 1}`,
          position: findOpenCell(encounter),
          currentHp: definition.maxHp,
          tempHp: 0,
          initiative: undefined,
          state: "active"
        };
        commitEncounter({ ...encounter, combatants: [...encounter.combatants, duplicate] }, {
          selectedCombatantId: duplicate.id
        });
      },
      duplicateSelected: () => {
        const selectedId = get().selectedCombatantId;
        if (selectedId) get().duplicateCombatant(selectedId);
      }
    });
    },
    {
      name: "battle-sim-encounter-v1",
      storage: createJSONStorage(() => createEncounterStorage()),
      partialize: (state) => ({
        encounter: state.encounter,
        log: state.log,
        // Map backgrounds live in IndexedDB (see mapImageStore), never here.
        selectedCombatantId: state.selectedCombatantId,
        currentProjectId: state.currentProjectId,
        currentEncounterId: state.currentEncounterId
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<EncounterStore> & {
          mapImagesByEncounterId?: Record<string, string>;
        };
        // One-time migration: earlier versions kept images in this localStorage
        // blob. Move any we find into IndexedDB, then drop them from state so
        // they stop being persisted.
        if (typeof indexedDB !== "undefined") {
          for (const [key, dataUrl] of Object.entries(persisted.mapImagesByEncounterId ?? {})) {
            if (typeof dataUrl === "string") void putMapImage(key, dataUrl);
          }
          if (typeof persisted.mapImageDataUrl === "string" && persisted.currentEncounterId) {
            void putMapImage(persisted.currentEncounterId, persisted.mapImageDataUrl);
          }
        }
        delete persisted.mapImagesByEncounterId;
        return {
          ...currentState,
          ...persisted,
          mapImageDataUrl: null,
          encounter: normalizeEncounterVisuals(persisted.encounter ?? currentState.encounter)
        };
      },
      onRehydrateStorage: () => (state) => {
        // localStorage is back; now pull this scene's background out of IndexedDB.
        state?.hydrateMapImage();
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

/**
 * Light-normalize a feature record for the sheet: pin the id, coerce the
 * category, and re-mint every `grantedActions` id (pointing `featureId` back at
 * this feature). `srdSlug` records provenance when the feature came from the
 * bundled library.
 */
function normalizeFeatureRecord(input: FeatureDefinition, id: string, srdSlug?: string): FeatureDefinition {
  const category: FeatureDefinition["category"] = input.category === "trait" ? "trait" : "feature";
  const grantedActions = (input.grantedActions ?? []).map((action, index) => {
    const nextId = `${id}-granted-${index + 1}`;
    return "featureId" in action
      ? { ...action, id: nextId, featureId: id }
      : { ...action, id: nextId };
  });
  return {
    ...input,
    id,
    category,
    grantedActions: grantedActions.length ? grantedActions : undefined,
    source: srdSlug
      ? { provider: "homebrew", documentName: "SRD", slug: srdSlug, importedAt: new Date().toISOString() }
      : input.source,
    automationSupport: input.automationSupport ?? "manual-only"
  };
}

/** Resource pools a feature's granted actions spend, seeded to a sensible default when the definition lacks them. */
function seededResourcesForFeature(feature: FeatureDefinition): Record<string, number> | undefined {
  const defaults: Record<string, number> = { rage: 3, "action-surge": 1, "second-wind": 1, "bardic-inspiration": 3 };
  const seeded: Record<string, number> = {};
  for (const action of feature.grantedActions ?? []) {
    const cost = "resourceCost" in action ? action.resourceCost : undefined;
    if (cost?.resourceId && defaults[cost.resourceId] !== undefined) {
      seeded[cost.resourceId] = defaults[cost.resourceId];
    }
  }
  return Object.keys(seeded).length ? seeded : undefined;
}
