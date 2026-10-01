"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  activeFactions,
  admitReinforcements,
  spellcastingAbility,
  compareInitiative,
  createEngineState,
  applyCondition,
  despawnExpiredSummons,
  defaultConditionModifiers,
  DEFAULT_GRID_VISUALS,
  DEFAULT_MAP_IMAGE_SETTINGS,
  event,
  footprintCells,
  getDefinition,
  groundHeightAt,
  LEGENDARY_POINTS,
  planRamp,
  withGroundHeights,
  getExecutableActions,
  resolveDeathSave,
  rollDice,
  rollInitiative,
  runAutomatedEncounter,
  runBatchSimulations,
  runDownedTurn,
  finishTurn,
  runTurnStart,
  runLairWindow,
  sampleEncounter,
  sizeFootprint,
  takeAutomatedTurn,
  terrainAtCell,
  tickZones,
  updateDefeatState,
  type BatchSimulationSummary,
  type CombatantExportPackage,
  type CombatLogEvent,
  type CombatantState,
  type ConditionInstance,
  type ConditionName,
  type Faction,
  type Ability,
  type ActionDefinition,
  type CreatureDefinition,
  type CreatureType,
  type DamageType,
  type DeathEffectDefinition,
  type EncounterSnapshot,
  type FeatureEffect,
  type FeatureDefinition,
  type LegendaryActionRef,
  type PlacedTemplate,
  type Point,
  type SizeCategory,
  type SpellDefinition,
  type SimulationOutcome,
  type TerrainZone,
  type TerrainHazardEffect,
  type TerrainType,
  type TokenVisuals,
  type WeaponDefinition,
  normalizeWall,
  normalizeWeaponDefinition,
  normalizeSpellDefinition,
  normalizeActionDefinition,
  normalizeDeathEffectDefinition,
  type ActionRider,
  type CoverLevel,
  type WallSegment
} from "@/engine";
import { findSrdFeature, findSrdSpell, findSrdWeapon } from "@/data/srd";
import { isSrdMonsterId, loadSrdMonster } from "@/data/srd/monsters";
import { clampReplayIndex } from "@/lib/replay";
import { withoutDefinitionItem, type DefinitionItemType } from "@/lib/definition-edits";
import { findAbility, withNewAbility, withRecordAfter, type AbilityInsertTarget, type AbilityRecord, type AbilityRef } from "@/lib/ability-editor/refs";
import { featurePoolsToSeed, usagePools, withNewGrantedAction, withNewLegendaryAction, withOwnUsagePool, withReplacedAbility, type AbilityRecordExtras } from "@/lib/ability-editor/records";
import { withLegendaryPool } from "@/lib/ability-editor/legendary";
import { fullOf, refilledResources, withoutResource, withResourceSize } from "@/lib/actor-sheet/resources";
import { loadDependencies, withSpawnsSettled } from "@/lib/ability-editor/spawns";
import { castWith, withSettledSpellcasting } from "@/lib/ability-editor/spells";
import { deepEqual } from "@/lib/deep-equal";
import { downscaleDataUrl, getImageDimensions } from "@/lib/imageResize";
import { createEncounterStorage } from "@/lib/encounterStorage";
import { copyMapImage, deleteMapImage, getMapImage, putMapImage } from "@/lib/mapImageStore";
import { wouldCreateCycle, type ActorFolder } from "@/lib/actor-folders";

export type EditorTool = "select" | "measure" | "wall" | "terrain" | "elevation";

/** What the elevation tool does to the cells it is dragged over. */
export type ElevationMode = "set" | "raise" | "lower" | "ramp" | "flatten";

/** How much one pass of the raise / lower brush changes a cell: one stair step. */
export const ELEVATION_STEP_FT = 5;
/** The tallest ground the editor will paint; airborne creatures are separate (altitude). */
export const MAX_ELEVATION_FT = 500;

/** Grid + optional background for a brand-new (non-clone) map, chosen up front in the create-encounter flow. */
export interface NewMapOptions {
  grid?: { width: number; height: number; distancePerSquare: number; squareSizePx: number };
  imageDataUrl?: string | null;
}

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
  mapImageUrl?: string | null;
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
  /** Vercel Blob (CDN) URL for the current scene's background, if it's been synced to the server. Lets hydrateMapImage fall back to it on a device whose IndexedDB doesn't have this scene cached yet. */
  mapImageUrl: string | null;
  currentProjectId: string | null;
  currentEncounterId: string | null;
  projects: ProjectSummary[];
  projectStatus: string;
  definitionsLibrary: CreatureDefinition[];
  /** Ids within definitionsLibrary that are shared, read-only templates (not owned by you) — see copyLibraryDefinition. */
  templateDefinitionIds: string[];
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
  /** Rewind this fight to round 0 with the same combatants/map: full HP, no conditions, fresh resources, no initiative. */
  restartCombat: () => void;
  runAuto: () => Promise<void>;
  runBatch: (count: number) => void;
  setReplayIndex: (index: number) => void;
  setReplaySpeed: (speed: number) => void;
  exitReplay: () => void;
  reset: () => void;
  undo: () => void;
  redo: () => void;
  /**
   * Run `edit` (one or more store actions) so that what it commits joins the undo step of the last edit with the same
   * `key`, as long as nothing else was committed or undone in between. The sheet commits as you type, and passes one
   * key per focus of a field, so typing 256 into a box is one undo step, not three.
   */
  mergeEdits: (key: string, edit: () => void) => void;
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
  updateTerrain: (terrainId: string, updates: Partial<Pick<TerrainZone, "name" | "type" | "movementMultiplier" | "tags" | "hazard">>) => void;
  updateTerrainTiles: (terrainIds: string[], updates: Partial<Pick<TerrainZone, "name" | "type" | "movementMultiplier" | "tags" | "hazard">>) => void;
  removeTerrain: (terrainId: string) => void;
  removeTerrainTiles: (terrainIds: string[]) => void;
  /** Brush preset applied by the next tile the terrain tool paints/drags over. */
  terrainBrush: TerrainBrushId;
  setTerrainBrush: (brush: TerrainBrushId) => void;
  /** Paint (or erase, for the "eraser" brush) one 1x1 terrain tile per cell, as a single undo step — the terrain tool's click-and-drag brush stroke. */
  paintTerrainCells: (cells: Point[]) => void;
  /** The elevation tool's brush: what a drag does, the height "set" paints, and how wide a ramp is. */
  elevationMode: ElevationMode;
  elevationHeight: number;
  elevationRampWidth: number;
  setElevationMode: (mode: ElevationMode) => void;
  setElevationHeight: (feet: number) => void;
  setElevationRampWidth: (squares: number) => void;
  /** Apply the current elevation mode to a dragged-over set of cells, as one undo step. */
  paintElevationCells: (cells: Point[]) => void;
  /** Lay a ramp from `start` to `end` (drag from one end to the other) using the current width. */
  applyRamp: (start: Point, end: Point) => void;
  /** Level the whole map back to the datum. */
  clearElevation: () => void;
  /** Set how high above the ground these tokens are flying. 0 lands them. */
  setAltitude: (combatantIds: string[], feet: number) => void;
  /** Raise (or, negative, lower) these tokens' altitude by the same number of feet, as one undo step. */
  adjustAltitude: (combatantIds: string[], deltaFeet: number) => void;
  addTemplate: (template: Omit<PlacedTemplate, "id">) => string;
  updateTemplate: (templateId: string, updates: Partial<Omit<PlacedTemplate, "id">>) => void;
  removeTemplate: (templateId: string) => void;
  loadProjects: () => Promise<void>;
  saveProject: () => Promise<void>;
  loadProject: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  /** Creates a campaign with a single blank encounter, independent of whatever is currently open in the editor. Returns the new campaign id, or null on failure. */
  createCampaign: (name: string) => Promise<string | null>;
  /** Creates a blank encounter under an existing campaign without touching the editor's live state. Returns the new encounter id, or null on failure. */
  createEncounterInCampaign: (campaignId: string, name: string, options?: NewMapOptions) => Promise<string | null>;
  createEncounter: (name: string, options?: NewMapOptions & { fresh?: boolean }) => Promise<void>;
  saveCurrentEncounter: () => Promise<void>;
  loadEncounter: (encounterId: string) => Promise<void>;
  renameEncounter: (encounterId: string, name: string) => Promise<void>;
  duplicateEncounter: (encounterId?: string) => Promise<void>;
  deleteEncounter: (encounterId: string) => Promise<void>;
  updateEncounterMetadata: (updates: { name?: string; mapName?: string }) => void;
  loadDefinitionsLibrary: () => Promise<void>;
  saveSelectedDefinition: () => Promise<void>;
  saveDefinition: (definitionId: string) => Promise<void>;
  /**
   * Adds an SRD library monster to the scene as a token. Loads its definition on demand and reuses
   * the scene's copy if that monster is already there (so a second goblin shares — and doesn't
   * reset — the first one's definition).
   */
  addSrdMonster: (monsterId: string, faction?: "party" | "enemy", position?: Point, quantity?: number) => Promise<void>;
  /**
   * Adds definitions to the encounter with no token, skipping ids it already has — the creatures a summon or
   * transform names, which the engine can only use if they are embedded. One undo step.
   */
  embedDefinitions: (definitions: CreatureDefinition[]) => void;
  /**
   * Turns a scene actor that came from the SRD library into the user's own actor: a fresh id (library
   * ids are global, so saving one would collide across users) on the definition and every token using
   * it. Returns the new id, or undefined if there is nothing to adopt.
   */
  adoptSrdDefinition: (definitionId: string) => string | undefined;
  /** Saves a private, editable copy of a library monster to the user's own library ("Customize"). */
  saveSrdMonsterCopy: (monsterId: string, folderId?: string | null) => Promise<void>;
  /** Adds a token of a saved actor. When the scene already has that actor, the token shares the scene's copy and its edits. */
  addLibraryDefinitionToEncounter: (definitionId: string, faction?: "party" | "enemy", position?: Point) => Promise<void>;
  deleteLibraryDefinition: (definitionId: string) => Promise<void>;
  /** Clones a template (or your own actor) into your own library under a new id. The only way to customize a shared template. */
  copyLibraryDefinition: (definitionId: string) => Promise<void>;
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
  updateMapPadding: (paddingSquares: number) => void;
  updateHp: (combatantId: string, hp: number) => void;
  updateTactics: (combatantId: string, tactics: EncounterSnapshot["combatants"][number]["tacticsProfile"]) => void;
  updateFactionTactics: (faction: CombatantState["faction"], tactics: CombatantState["tacticsProfile"]) => void;
  updateResourceStance: (combatantId: string, stance: CombatantState["resourceStance"]) => void;
  updateFactionResourceStance: (faction: CombatantState["faction"], stance: CombatantState["resourceStance"]) => void;
  /** Toggle the "surprised" condition on one combatant — denies its first turn, self-expires at round 2. */
  toggleCombatantSurprised: (combatantId: string) => void;
  /** Add/remove "surprised" across every combatant in a faction. */
  setFactionSurprised: (faction: Faction, surprised: boolean) => void;
  updateTags: (combatantId: string, tags: CombatantState["tags"]) => void;
  updateResource: (combatantId: string, resourceId: string, amount: number) => void;
  updateDefinitionResource: (definitionId: string, resourceId: string, amount: number) => void;
  /**
   * A resource's full size on a creature (the Resources list), kept in step everywhere it's stored: the pool, a
   * weapon's charges, the uses of the abilities spending it, or the legendary actions a round (`withResourceSize`).
   * Tokens that were full follow it; the others keep what they have, capped at it, measured from before the edit (so
   * typing 12 over 3 isn't read as 1 on the way). A size for a pool a token lacks seeds it full. One undo step.
   */
  setResourceSize: (definitionId: string, resourceId: string, size: number) => void;
  /** Take a spell slot level, or a pool nothing spends any more, off a creature and its tokens. One undo step. */
  removeResource: (definitionId: string, resourceId: string) => void;
  /** Every resource of a token back to full and every recharge ready (legendary actions refill on their own). One undo step. */
  refillResources: (combatantId: string) => void;
  /** How many legendary actions a creature takes a round (1-10). One undo step; nothing for a creature without them. */
  setLegendaryPool: (definitionId: string, pool: number) => void;
  /** Put a condition on a token by hand, with the engine's modifiers for it and despite any immunity. One undo step. */
  applyConditionToCombatant: (combatantId: string, condition: ConditionName) => void;
  /**
   * Toggle one `prepOnly` buff spell "already active" on a combatant, before
   * combat starts — applies (or removes) its condition permanently (no
   * `expiresAt`; cleared by `restartCombat` like everything else), spends
   * (or refunds) its resource cost, and grants (never revokes) any temp HP.
   * No-ops if `actionId` isn't a `prepOnly` buff the combatant's definition
   * actually has.
   */
  togglePrepBuff: (combatantId: string, actionId: string) => void;
  clearConditions: (combatantId: string) => void;
  /** Take one condition off a token (the vitals strip's ×). One undo step; nothing when it doesn't have it. */
  removeCondition: (combatantId: string, conditionId: string) => void;
  replaceEncounter: (encounter: EncounterSnapshot, mapImageDataUrl?: string | null) => void;
  addCreatureDefinition: (definition: CreatureDefinition, faction?: "party" | "enemy", position?: Point) => void;
  /**
   * Adds `quantity` tokens of one definition in a single undo step, named "Goblin 3", "Goblin 4"… The
   * first goes at `position` (or the first free cell); the rest fill the nearest free cells around it,
   * respecting token size.
   */
  addCreatureTokens: (definition: CreatureDefinition, faction: "party" | "enemy", quantity: number, position?: Point) => void;
  importCombatantPackage: (input: CombatantExportPackage) => string;
  addBlankToken: (input: { name: string; faction: "party" | "enemy"; size: SizeCategory; type: CreatureType | undefined; ac: number; hp: number; speed: number; proficiencyBonus: number; abilities: CreatureDefinition["abilities"] }) => string;
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
  /** Merge a partial patch into one feature / trait (an optional rule switched on). One undo step. */
  updateFeature: (definitionId: string, featureId: string, patch: Partial<FeatureDefinition>) => void;
  /**
   * Delete a record from a creature, and what goes with it: its steps in any multiattack, and a multiattack left empty.
   * With a `replacement` (`id:<action>` or `any:<kind>`), routines that used it use that instead.
   */
  removeDefinitionItem: (definitionId: string, itemType: DefinitionItemType, itemId: string, replacement?: string) => void;
  /**
   * Put an edited ability back where `ref` points, whole: normalized for its list, keeping the ids of the record it
   * replaces, and moved to the list its type belongs in (an action made a bonus action, a feature made a trait).
   * Seeds any pool it needs that the creature lacks, and the `extras.pools` the editor created for it ("New pool…").
   * One undo step, none when nothing changed. Returns where the ability ended up, or `undefined` when `ref` points at
   * nothing.
   */
  replaceAbilityRecord: (definitionId: string, ref: AbilityRef, record: AbilityRecord, extras?: AbilityRecordExtras) => AbilityRef | undefined;
  /** Add a new ability with fresh ids, its pools seeded (a weapon's charges, a feature's pools, `extras.pools`). One undo step. Returns where it went. */
  insertAbilityRecord: (definitionId: string, where: AbilityInsertTarget, record: AbilityRecord, extras?: AbilityRecordExtras) => AbilityRef | undefined;
  /** Mark tokens as fighting in (or out of) their lair. */
  setInLair: (combatantIds: string[], inLair: boolean) => void;
  /** Clone a specific combatant (fresh id, full HP, no initiative) and select the copy. */
  duplicateCombatant: (combatantId: string) => void;
  /** Clone whatever combatant is currently selected. Thin wrapper over `duplicateCombatant`. */
  duplicateSelected: () => void;
}

function canTakeTurn(encounter: EncounterSnapshot, combatant: CombatantState): boolean {
  return combatant.state === "active"
    || (combatant.state === "downed" && combatant.downedRegen === true)
    || (encounter.rules.playerDeathSaves
      && combatant.faction === "party"
      && combatant.state === "downed"
      && !combatant.deathSaves?.stable);
}

export function isSurprised(combatant: CombatantState): boolean {
  return (combatant.conditions ?? []).some((condition) => condition.name === "surprised");
}

/** Currently fighting for its dominator's side (Dominate Person/Beast, Planar Binding). */
export function isDominated(combatant: CombatantState): boolean {
  return (combatant.conditions ?? []).some((condition) => condition.name === "dominated");
}

/** A fresh "surprised" condition: denies the bearer's first turn, then self-expires at the start of round 2. */
function surprisedCondition(encounter: EncounterSnapshot): ConditionInstance {
  return {
    id: "surprised",
    name: "surprised",
    startedRound: encounter.round,
    expiresAt: { round: Math.max(2, encounter.round + 1), turnIndex: 0, timing: "start" },
    modifiers: defaultConditionModifiers("surprised")
  };
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

export type TerrainBrushId = "difficult" | "greaterDifficult" | "impassable" | "water" | "deepWater" | "rock" | "cliff" | "acid" | "lava" | "ice" | "eraser";

interface TerrainBrushPreset {
  name: string;
  type: TerrainType;
  movementMultiplier?: number;
  /** Discriminates same-`type` presets for rendering (e.g. "acid" vs "lava", both `type: "hazard"`) — see `.terrain.hazard-*` in globals.css. */
  tags?: string[];
  hazard?: TerrainHazardEffect;
}

/** Presets for the terrain paint brush. "eraser" removes a painted tile instead of writing one. */
export const TERRAIN_BRUSH_PRESETS: Record<Exclude<TerrainBrushId, "eraser">, TerrainBrushPreset> = {
  difficult: { name: "Difficult Terrain", type: "difficult", movementMultiplier: 2 },
  greaterDifficult: { name: "Greater Difficult Terrain", type: "difficult", movementMultiplier: 4 },
  impassable: { name: "Impassable Terrain", type: "impassable" },
  // Movement modes: see `modeMultiplier` in geometry.ts. Shallow water slows walkers; swimmers and fliers cross it freely.
  water: { name: "Shallow Water", type: "custom", movementMultiplier: 2, tags: ["water"] },
  deepWater: { name: "Deep Water", type: "custom", tags: ["water", "deep"] },
  rock: { name: "Solid Rock", type: "custom", tags: ["solid"] },
  cliff: { name: "Cliff Face", type: "custom", tags: ["climbable"] },
  acid: {
    name: "Acid Pool",
    type: "hazard",
    tags: ["acid"],
    hazard: {
      trigger: ["on-enter", "start-of-turn-in-zone"],
      saveAbility: "dex",
      dc: 12,
      damage: [{ dice: "2d6", damageType: "acid" }],
      onSuccess: "half"
    }
  },
  lava: {
    name: "Lava",
    type: "hazard",
    tags: ["lava"],
    hazard: {
      trigger: ["on-enter", "start-of-turn-in-zone"],
      damage: [{ dice: "4d10", damageType: "fire" }]
    }
  },
  ice: {
    name: "Ice",
    type: "hazard",
    tags: ["ice"],
    hazard: {
      // Only checked on the step onto the ice, not every turn spent standing
      // on it — you either catch your footing or you're already down.
      trigger: ["on-enter"],
      saveAbility: "dex",
      dc: 10,
      // No damage component at all — this is the pure "status effect, no
      // damage" hazard shape the rider system needs to support (Phase 3).
      // The "prone" rider gates on the hazard's own save result via
      // `when: "on-save-fail"`, so it needs no separate `save` of its own.
      riders: [{
        kind: "condition",
        when: "on-save-fail",
        condition: "prone",
        duration: { kind: "until-start-of-next-turn" }
      }]
    }
  }
};

function terrainTilePolygon(cell: Point): Point[] {
  return [
    { x: cell.x, y: cell.y },
    { x: cell.x + 1, y: cell.y },
    { x: cell.x + 1, y: cell.y + 1 },
    { x: cell.x, y: cell.y + 1 }
  ];
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
  if (definition.defaultTactics) return definition.defaultTactics;
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
 * resource seed the pool needs. Shared by `attachSrdWeapon` and `withInsertedAbility`
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
 * Downscale an upload and decode its stored pixel dimensions, for callers that
 * need to bake a background straight into a snapshot being created (before any
 * encounter id exists to key `setMapImage`'s state-driven flow off of).
 */
async function prepareMapImage(dataUrl: string): Promise<{ value: string; naturalWidthPx: number; naturalHeightPx: number } | null> {
  if (!dataUrl.startsWith("data:image/")) return null;
  const resized = await downscaleDataUrl(dataUrl).catch(() => dataUrl);
  const dims = await getImageDimensions(resized);
  if (!dims) return null;
  return { value: resized, naturalWidthPx: dims.width, naturalHeightPx: dims.height };
}

/**
 * IndexedDB key for a scene's background image: the saved DB encounter id once
 * the scene has been saved, otherwise the snapshot's own id while it is a draft.
 * The save flows migrate the draft key to the DB key.
 */
function mapImageKey(state: Pick<EncounterStore, "currentEncounterId" | "encounter">): string {
  return state.currentEncounterId ?? state.encounter.id;
}

/**
 * True when a replacement image's proportions differ enough from the map's
 * previous background that resizing the canvas to fit it could visibly
 * un-align walls/terrain/tokens that were placed against the old artwork.
 * Silent for maps with nothing placed yet — there's nothing to misalign.
 */
export function shouldWarnBeforeReplacingImage(encounter: EncounterSnapshot, dims: { width: number; height: number }): boolean {
  const map = encounter.map;
  const prev = map.image;
  if (!prev?.naturalWidthPx || !prev?.naturalHeightPx) return false;
  const hasPlacedContent = map.walls.length > 0 || map.terrain.length > 0 || encounter.combatants.length > 0;
  if (!hasPlacedContent) return false;
  const prevRatio = prev.naturalWidthPx / prev.naturalHeightPx;
  const newRatio = dims.width / dims.height;
  return Math.abs(prevRatio - newRatio) / prevRatio > 0.02;
}

export const useEncounterStore = create<EncounterStore>()(
  persist(
    (set, get) => {
      const hydrateMapImage = () => {
        const key = mapImageKey(get());
        void getMapImage(key).then((image) => {
          // Ignore if the user switched scenes while the read was in flight.
          if (mapImageKey(get()) !== key) return;
          if (image) {
            set({ mapImageDataUrl: image });
            return;
          }
          // Nothing cached locally for this scene (e.g. a different device than
          // the one that uploaded it) — fall back to the authenticated proxy for
          // the image synced at save time, and opportunistically cache it for
          // next time. The Blob store is private, so the raw CDN URL can't be
          // used directly as an <img> src.
          const remoteUrl = get().mapImageUrl;
          const proxyUrl = remoteUrl ? `/api/encounters/${encodeURIComponent(key)}/map-image` : null;
          set({ mapImageDataUrl: proxyUrl });
          if (proxyUrl) void putMapImage(key, proxyUrl);
        });
      };

      /** Best-effort push of a scene's background to Vercel Blob so it's visible cross-device. Never throws into a render or a store action. */
      const syncMapImageToServer = (encounterId: string, dataUrl: string | null) => {
        if (!encounterId) return;
        if (dataUrl) {
          void fetch(`/api/encounters/${encodeURIComponent(encounterId)}/map-image`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl })
          })
            .then((response) => (response.ok ? (response.json() as Promise<{ url?: string }>) : null))
            .then((data) => {
              if (data?.url) set({ mapImageUrl: data.url });
            })
            .catch(() => undefined);
        } else {
          void fetch(`/api/encounters/${encodeURIComponent(encounterId)}/map-image`, { method: "DELETE" })
            .then(() => set({ mapImageUrl: null }))
            .catch(() => undefined);
        }
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

      // `mergeEdits`: the key of the edit running now, and the last merged edit's key and the undo step it pushed.
      let mergingKey: string | null = null;
      let lastMerge: { key: string; step: EncounterSnapshot } | null = null;

      /** Whether a commit now joins the undo step of the edit in progress, nothing having been committed or undone since. */
      const continuesMerge = () => mergingKey !== null && lastMerge?.key === mergingKey && get().undoStack[0] === lastMerge.step;

      /** The encounter as it was before the edit in progress began: the undo step a merged edit is joining, or now. */
      const editBase = (): EncounterSnapshot => (continuesMerge() ? get().undoStack[0]! : get().encounter);

      const commitEncounter = (
        encounter: EncounterSnapshot,
        extras: Partial<EncounterStore> = {}
      ) => {
        const undoStack = continuesMerge() ? get().undoStack : [structuredClone(get().encounter), ...get().undoStack].slice(0, 50);
        lastMerge = mergingKey ? { key: mergingKey, step: undoStack[0]! } : null;
        set({
          encounter: normalizeEncounterVisuals(encounter),
          undoStack,
          redoStack: [],
          outcome: null,
          batchSummary: null,
          replayBase: null,
          replayIndex: null,
          ...extras
        });
      };

      /**
       * Commit a creature after an ability edit; tokens of it get any pool they lack (existing values are kept). The
       * creatures it summons or changes into that the editor fetched (`embed`) come in the same step, and its forms get
       * its shapechanges (see `withSpawnsSettled`).
       */
      const commitAbilityChange = (encounter: EncounterSnapshot, definitionId: string, next: CreatureDefinition, seeded: Record<string, number>, embed?: CreatureDefinition[]) => {
        const hasSeeds = Object.keys(seeded).length > 0;
        commitEncounter({
          ...encounter,
          definitions: withSpawnsSettled(encounter.definitions.map((candidate) => (candidate.id === definitionId ? next : candidate)), next, embed),
          combatants: hasSeeds
            ? encounter.combatants.map((combatant) => combatant.definitionId === definitionId
              ? { ...combatant, resources: { ...seeded, ...(combatant.resources ?? {}) } }
              : combatant)
            : encounter.combatants
        });
      };


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
      mapImageUrl: null,
      currentProjectId: null,
      currentEncounterId: null,
      projects: [],
      projectStatus: "",
      definitionsLibrary: [],
      templateDefinitionIds: [],
      definitionStatus: "",
      actorFolders: [],
      folderStatus: "",
      undoStack: [],
      redoStack: [],
      tool: "select",
      pendingWallStart: null,
      wallCoverDraft: "total",
      setWallCoverDraft: (cover) => set({ wallCoverDraft: cover }),
      terrainBrush: "difficult",
      setTerrainBrush: (brush) => set({ terrainBrush: brush }),
      elevationMode: "set",
      elevationHeight: 10,
      elevationRampWidth: 2,
      setElevationMode: (mode) => set({ elevationMode: mode }),
      setElevationHeight: (feet) => set({ elevationHeight: Math.max(-MAX_ELEVATION_FT, Math.min(MAX_ELEVATION_FT, Math.round(feet) || 0)) }),
      setElevationRampWidth: (squares) => set({ elevationRampWidth: Math.max(1, Math.min(6, Math.round(squares) || 1)) }),
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

        if (state.tool === "terrain" || state.tool === "elevation") {
          // Terrain tiles and heights are painted via the click-and-drag brush (see
          // onMapPointerDown/Move/Up in useSceneInteraction + paintTerrainCells
          // below), not the plain click handler.
          return;
        }

        const selectedId = state.selectedCombatantId;
        if (state.tool !== "select" || !selectedId) {
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
      restartCombat: () => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          round: 0,
          turnIndex: 0,
          combatants: encounter.combatants.map((combatant) => {
            const definition = getDefinition(encounter, combatant);
            return {
              ...combatant,
              currentHp: definition.maxHp,
              tempHp: 0,
              initiative: undefined,
              conditions: [],
              deathSaves: undefined,
              actionEconomy: undefined,
              turnFlags: undefined,
              concentration: undefined,
              resources: defaultResourcesForDefinition(definition),
              state: combatant.arrivesRound ? "reserve" : "active"
            };
          })
        }, { log: [] });
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
          engine.snapshot.combatants.sort((a, b) => compareInitiative(engine.snapshot, a, b));
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
          finishTurn(engine, currentActor.id);
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
        // Idempotent within a round (a zone only expires once `round >=
        // expiresAtRound`), so — like `admitReinforcements` above — it's safe
        // to call on every step rather than only when `wrapped`.
        tickZones(engine);
        despawnExpiredSummons(engine);
        turnIndexes = eligibleIndexes();
        if (turnIndexes.length === 0) return;
        const next = wrapped || !turnHasStarted
          ? turnIndexes[0]?.index ?? 0
          : turnIndexes.find(({ index }) => index > current)?.index ?? turnIndexes[0]?.index ?? 0;
        encounter.turnIndex = next;

        const combatant = encounter.combatants[next];
        if (combatant) {
          // Lair actions on initiative 20 come before this turn if it's the first one below 20 (same as Auto Run).
          runLairWindow(engine, combatant);
          engine.log.push(event(engine, "TurnStarted", `${combatant.displayName} started an automated turn`, { combatantId: combatant.id, mode: "automated" }));
          // A regenerating monster stands up and takes a normal turn; anyone else rolls a death save.
          if (combatant.state === "downed" && runDownedTurn(engine, combatant) === "done") {
            closeActionEconomy(combatant);
            commitEncounter(encounter, { log: engine.log, selectedCombatantId: combatant.id, outcome: steppedOutcome(engine) });
            return;
          }

          runTurnStart(engine, combatant);
          try {
            takeAutomatedTurn(engine, combatant);
          } catch (error) {
            engine.log.push(event(engine, "AutomationWarning", `${combatant.displayName}: automated turn failed — ${error instanceof Error ? error.message : String(error)}`, { combatantId: combatant.id }));
          }
          finishTurn(engine, combatant.id);
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
      mergeEdits: (key, edit) => {
        const outer = mergingKey;
        mergingKey = key;
        try {
          edit();
        } finally {
          mergingKey = outer;
        }
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
      removeTerrain: (terrainId) => get().removeTerrainTiles([terrainId]),
      removeTerrainTiles: (terrainIds) => {
        if (terrainIds.length === 0) return;
        const ids = new Set(terrainIds);
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: { ...encounter.map, terrain: encounter.map.terrain.filter((terrain) => !ids.has(terrain.id)) }
        });
      },
      updateTerrain: (terrainId, updates) => get().updateTerrainTiles([terrainId], updates),
      updateTerrainTiles: (terrainIds, updates) => {
        if (terrainIds.length === 0) return;
        const ids = new Set(terrainIds);
        const encounter = get().encounter;
        // Retyping a tile's hazard (including clearing it back to `undefined`
        // for a non-hazard type) drops any stale per-round dedup state from
        // whatever hazard identity was there before.
        const patch = "hazard" in updates ? { ...updates, hazardAppliedRounds: undefined } : updates;
        commitEncounter({
          ...encounter,
          map: {
            ...encounter.map,
            terrain: encounter.map.terrain.map((terrain) => ids.has(terrain.id) ? { ...terrain, ...patch } : terrain)
          }
        });
      },
      paintTerrainCells: (cells) => {
        if (cells.length === 0) return;
        const brushId = get().terrainBrush;
        const encounter = get().encounter;
        const { width, height } = encounter.map.grid;
        const inBounds = (cell: Point) => cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height;
        const byCellKey = new Map<string, TerrainZone>(
          encounter.map.terrain
            .filter((tile): tile is TerrainZone & { cell: Point } => tile.cell != null)
            .map((tile) => [`${tile.cell.x},${tile.cell.y}`, tile])
        );
        let terrain = encounter.map.terrain;
        let changed = false;
        for (const cell of cells) {
          if (!inBounds(cell)) continue;
          const key = `${cell.x},${cell.y}`;
          const existing = byCellKey.get(key);
          if (brushId === "eraser") {
            if (existing) {
              terrain = terrain.filter((tile) => tile.id !== existing.id);
              byCellKey.delete(key);
              changed = true;
            }
            continue;
          }
          const preset = TERRAIN_BRUSH_PRESETS[brushId];
          const presetSignature = JSON.stringify([preset.name, preset.type, preset.movementMultiplier, preset.tags, preset.hazard]);
          if (existing) {
            const existingSignature = JSON.stringify([existing.name, existing.type, existing.movementMultiplier, existing.tags, existing.hazard]);
            if (existingSignature !== presetSignature) {
              const updated = {
                ...existing,
                name: preset.name,
                type: preset.type,
                movementMultiplier: preset.movementMultiplier,
                tags: preset.tags,
                hazard: preset.hazard,
                hazardAppliedRounds: undefined
              };
              terrain = terrain.map((tile) => (tile.id === existing.id ? updated : tile));
              byCellKey.set(key, updated);
              changed = true;
            }
            continue;
          }
          const tile: TerrainZone = {
            id: `terrain-${crypto.randomUUID()}`,
            name: preset.name,
            type: preset.type,
            movementMultiplier: preset.movementMultiplier,
            tags: preset.tags,
            hazard: preset.hazard,
            polygon: terrainTilePolygon(cell),
            cell
          };
          terrain = [...terrain, tile];
          byCellKey.set(key, tile);
          changed = true;
        }
        if (!changed) return;
        commitEncounter({ ...encounter, map: { ...encounter.map, terrain } });
      },
      paintElevationCells: (cells) => {
        const { elevationMode: mode, elevationHeight: paintHeight } = get();
        if (cells.length === 0 || mode === "ramp") return;
        const encounter = get().encounter;
        const { width, height } = encounter.map.grid;
        const updates = cells
          .filter((cell) => cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height)
          .map((cell) => {
            const current = groundHeightAt(encounter.map, cell);
            const next = mode === "set" ? paintHeight
              : mode === "raise" ? current + ELEVATION_STEP_FT
                : mode === "lower" ? current - ELEVATION_STEP_FT
                  : 0;
            return { cell, current, height: Math.max(-MAX_ELEVATION_FT, Math.min(MAX_ELEVATION_FT, next)) };
          })
          .filter((update) => update.height !== update.current);
        if (updates.length === 0) return;
        commitEncounter({
          ...encounter,
          map: { ...encounter.map, elevation: withGroundHeights(encounter.map.elevation, updates) }
        });
      },
      applyRamp: (start, end) => {
        const encounter = get().encounter;
        const plan = planRamp(encounter.map, start, end, get().elevationRampWidth);
        const updates = plan.cells.filter((entry) => entry.height !== groundHeightAt(encounter.map, entry.cell));
        if (updates.length === 0) return;
        commitEncounter({
          ...encounter,
          map: { ...encounter.map, elevation: withGroundHeights(encounter.map.elevation, updates) }
        });
      },
      clearElevation: () => {
        const encounter = get().encounter;
        if (!encounter.map.elevation) return;
        commitEncounter({ ...encounter, map: { ...encounter.map, elevation: undefined } });
      },
      setAltitude: (combatantIds, feet) => {
        const encounter = get().encounter;
        const ids = new Set(combatantIds);
        const altitude = Math.max(0, Math.min(MAX_ELEVATION_FT, Math.round(feet) || 0));
        let changed = false;
        const combatants = encounter.combatants.map((combatant) => {
          if (!ids.has(combatant.id) || (combatant.altitude ?? 0) === altitude) return combatant;
          changed = true;
          return { ...combatant, altitude: altitude > 0 ? altitude : undefined };
        });
        if (!changed) return;
        commitEncounter({ ...encounter, combatants });
      },
      adjustAltitude: (combatantIds, deltaFeet) => {
        const encounter = get().encounter;
        const ids = new Set(combatantIds);
        let changed = false;
        const combatants = encounter.combatants.map((combatant) => {
          if (!ids.has(combatant.id)) return combatant;
          const altitude = Math.max(0, Math.min(MAX_ELEVATION_FT, (combatant.altitude ?? 0) + deltaFeet));
          if (altitude === (combatant.altitude ?? 0)) return combatant;
          changed = true;
          return { ...combatant, altitude: altitude > 0 ? altitude : undefined };
        });
        if (!changed) return;
        commitEncounter({ ...encounter, combatants });
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
        const draftImage = get().mapImageDataUrl;
        set({
          currentProjectId: data.project.id,
          currentEncounterId: encounterId,
          projectStatus: "Saved"
        });
        if (encounterId) {
          migrateMapImageKey(draftKey, encounterId);
          if (draftImage) syncMapImageToServer(encounterId, draftImage);
        }
        await get().loadProjects();
      },
      loadProject: async (projectId) => {
        const response = await fetch(`/api/projects/${projectId}`);
        if (!response.ok) {
          set({ projectStatus: "Load failed" });
          return;
        }
        const data = await response.json() as { project: { id: string; encounters: Array<{ id: string; snapshotJson: EncounterSnapshot; mapImageUrl?: string | null }> } };
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
          mapImageUrl: data.project.encounters[0]?.mapImageUrl ?? null,
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
      createCampaign: async (name) => {
        const trimmedName = name.trim() || "Untitled Campaign";
        const snapshot = createSceneSnapshot(sampleEncounter, "New Encounter", "empty");
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, encounter: snapshot })
        });
        if (!response.ok) return null;
        const data = await response.json() as { project: { id: string } };
        return data.project.id;
      },
      createEncounterInCampaign: async (campaignId, name, options) => {
        const trimmedName = name.trim() || "Untitled Encounter";
        const snapshot = createSceneSnapshot(sampleEncounter, trimmedName, "empty");
        if (options?.grid) {
          const { width, height, distancePerSquare, squareSizePx } = options.grid;
          snapshot.map = {
            ...snapshot.map,
            grid: { ...snapshot.map.grid, width, height, distancePerSquare, squareSizePx },
            canvas: { widthPx: width * squareSizePx, heightPx: height * squareSizePx },
            image: { ...DEFAULT_MAP_IMAGE_SETTINGS },
            paddingSquares: 1,
            walls: [],
            terrain: [],
            templates: []
          };
        }
        const prepared = options?.imageDataUrl ? await prepareMapImage(options.imageDataUrl) : null;
        if (prepared) {
          snapshot.map.canvas = { widthPx: prepared.naturalWidthPx, heightPx: prepared.naturalHeightPx };
          snapshot.map.image = {
            ...DEFAULT_MAP_IMAGE_SETTINGS,
            naturalWidthPx: prepared.naturalWidthPx,
            naturalHeightPx: prepared.naturalHeightPx
          };
        }
        const response = await fetch("/api/encounters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: campaignId, name: trimmedName, encounter: snapshot })
        });
        if (!response.ok) return null;
        const data = await response.json() as { encounter: { id: string } };
        if (prepared) {
          void putMapImage(data.encounter.id, prepared.value);
          syncMapImageToServer(data.encounter.id, prepared.value);
        }
        return data.encounter.id;
      },
      createEncounter: async (name, options) => {
        const trimmedName = name.trim() || "Untitled Encounter";
        if (!get().currentProjectId) {
          await get().saveProject();
        }
        const projectId = get().currentProjectId;
        if (!projectId) {
          set({ projectStatus: "Create scene failed" });
          return;
        }
        const fresh = options?.fresh ?? false;
        const snapshot = createSceneSnapshot(fresh ? sampleEncounter : get().encounter, trimmedName, "empty");
        if (fresh && options?.grid) {
          const { width, height, distancePerSquare, squareSizePx } = options.grid;
          snapshot.map = {
            ...snapshot.map,
            grid: { ...snapshot.map.grid, width, height, distancePerSquare, squareSizePx },
            canvas: { widthPx: width * squareSizePx, heightPx: height * squareSizePx },
            image: { ...DEFAULT_MAP_IMAGE_SETTINGS },
            paddingSquares: 1,
            walls: [],
            terrain: [],
            templates: []
          };
        }
        const prepared = fresh && options?.imageDataUrl ? await prepareMapImage(options.imageDataUrl) : null;
        if (prepared) {
          snapshot.map.canvas = { widthPx: prepared.naturalWidthPx, heightPx: prepared.naturalHeightPx };
          snapshot.map.image = {
            ...DEFAULT_MAP_IMAGE_SETTINGS,
            naturalWidthPx: prepared.naturalWidthPx,
            naturalHeightPx: prepared.naturalHeightPx
          };
        }
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
          mapImageDataUrl: fresh ? (prepared?.value ?? null) : currentMapImage,
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
        if (fresh) {
          if (prepared) {
            void putMapImage(data.encounter.id, prepared.value);
            syncMapImageToServer(data.encounter.id, prepared.value);
          }
        } else if (currentMapImage) {
          // A cloned scene keeps the carried-over map layout, so carry its background too.
          void putMapImage(mapImageKey(get()), currentMapImage);
          syncMapImageToServer(data.encounter.id, currentMapImage);
        }
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
          mapImageUrl: data.encounter.mapImageUrl ?? null,
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
        void copyMapImage(sourceImageKey, mapImageKey(get())).then(() => {
          hydrateMapImage();
          const copiedImage = get().mapImageDataUrl;
          if (copiedImage) syncMapImageToServer(data.encounter.id, copiedImage);
        });
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
        const data = await response.json() as { definitions: CreatureDefinition[]; templateIds?: string[] };
        set({
          definitionsLibrary: data.definitions,
          templateDefinitionIds: data.templateIds ?? [],
          definitionStatus: `${data.definitions.length} saved definitions`
        });
      },
      saveSelectedDefinition: async () => {
        const state = get();
        const selected = state.encounter.combatants.find((combatant) => combatant.id === state.selectedCombatantId);
        let definition = selected ? state.encounter.definitions.find((candidate) => candidate.id === selected.definitionId) : undefined;
        if (!selected || !definition) {
          set({ definitionStatus: "No selected definition" });
          return;
        }
        if (isSrdMonsterId(definition.id)) {
          // Library ids are global: saving one as-is would collide with every other user's copy.
          const adoptedId = get().adoptSrdDefinition(definition.id);
          definition = get().encounter.definitions.find((candidate) => candidate.id === adoptedId) ?? definition;
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
        let definition = state.encounter.definitions.find((candidate) => candidate.id === definitionId)
          ?? state.definitionsLibrary.find((candidate) => candidate.id === definitionId);
        if (!definition) {
          set({ definitionStatus: "Definition not found" });
          return;
        }
        if (isSrdMonsterId(definition.id)) {
          const adoptedId = get().adoptSrdDefinition(definition.id);
          definition = get().encounter.definitions.find((candidate) => candidate.id === adoptedId) ?? definition;
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
      addSrdMonster: async (monsterId, faction = "enemy", position, quantity = 1) => {
        const place = async (definition: CreatureDefinition) => {
          // The creatures it can summon or become come along, or the engine couldn't run those actions.
          const embedded = await loadDependencies(definition, get().encounter.definitions);
          if (embedded.length > 0) get().embedDefinitions(embedded);
          if (quantity > 1) get().addCreatureTokens(definition, faction, quantity, position);
          else get().addCreatureDefinition(definition, faction, position);
        };
        // Already in the scene: share that definition. Replacing it would silently reset any edits
        // made to the monsters already placed.
        const inScene = get().encounter.definitions.find((candidate) => candidate.id === monsterId);
        if (inScene) {
          await place(inScene);
          return;
        }
        let definition: CreatureDefinition | undefined;
        try {
          definition = await loadSrdMonster(monsterId);
        } catch {
          definition = undefined;
        }
        if (!definition) {
          set({ definitionStatus: "Couldn't load that SRD monster" });
          return;
        }
        // Another add may have landed while the chunk loaded.
        const raced = get().encounter.definitions.find((candidate) => candidate.id === monsterId);
        await place(raced ?? definition);
      },
      embedDefinitions: (definitions) => {
        const encounter = get().encounter;
        const have = new Set(encounter.definitions.map((definition) => definition.id));
        const fresh = definitions.filter((definition) => definition?.id && !have.has(definition.id));
        if (fresh.length === 0) return;
        commitEncounter({ ...encounter, definitions: [...encounter.definitions, ...fresh] });
      },
      adoptSrdDefinition: (definitionId) => {
        const encounter = get().encounter;
        const definition = encounter.definitions.find((candidate) => candidate.id === definitionId);
        if (!definition || !isSrdMonsterId(definition.id)) {
          return undefined;
        }
        const newId = `def-${crypto.randomUUID()}`;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((candidate) => candidate.id === definitionId ? { ...candidate, id: newId } : candidate),
          combatants: encounter.combatants.map((combatant) => combatant.definitionId === definitionId ? { ...combatant, definitionId: newId } : combatant)
        });
        return newId;
      },
      saveSrdMonsterCopy: async (monsterId, folderId = null) => {
        let definition: CreatureDefinition | undefined;
        try {
          definition = await loadSrdMonster(monsterId);
        } catch {
          definition = undefined;
        }
        if (!definition) {
          set({ definitionStatus: "Couldn't load that SRD monster" });
          return;
        }
        const copy: CreatureDefinition = { ...definition, id: `def-${crypto.randomUUID()}`, folderId };
        const response = await fetch("/api/definitions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ definition: copy })
        });
        set({ definitionStatus: response.ok ? `${definition.name} copied to your library` : "Copy failed" });
        if (response.ok) {
          await get().loadDefinitionsLibrary();
        }
      },
      addLibraryDefinitionToEncounter: async (definitionId, faction = "enemy", position) => {
        // Already in the scene: another token of the scene's copy, as for SRD monsters. The library's copy would
        // replace it, silently undoing every edit made to it on the sheet, for every token of it.
        const definition = get().encounter.definitions.find((candidate) => candidate.id === definitionId)
          ?? get().definitionsLibrary.find((candidate) => candidate.id === definitionId);
        if (definition) {
          const embedded = await loadDependencies(definition, get().encounter.definitions);
          if (embedded.length > 0) get().embedDefinitions(embedded);
          get().addCreatureDefinition(definition, faction, position);
        }
      },
      deleteLibraryDefinition: async (definitionId) => {
        const response = await fetch(`/api/definitions/${encodeURIComponent(definitionId)}`, { method: "DELETE" });
        set({ definitionStatus: response.ok ? "Definition deleted" : "Definition delete failed" });
        await get().loadDefinitionsLibrary();
      },
      copyLibraryDefinition: async (definitionId) => {
        const response = await fetch(`/api/definitions/${encodeURIComponent(definitionId)}/copy`, { method: "POST" });
        set({ definitionStatus: response.ok ? "Copied to your library" : "Copy failed" });
        if (response.ok) {
          await get().loadDefinitionsLibrary();
        }
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
        if (isSrdMonsterId(definitionId)) {
          // SRD monsters live in a permanent read-only directory and can't be filed. Dropping one on a
          // folder makes the user their own copy there — of the scene's edited version if it's on the map.
          if (get().encounter.definitions.some((candidate) => candidate.id === definitionId)) {
            const adoptedId = get().adoptSrdDefinition(definitionId);
            if (adoptedId) {
              await get().moveDefinitionToFolder(adoptedId, folderId);
            }
          } else {
            await get().saveSrdMonsterCopy(definitionId, folderId);
          }
          return;
        }
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
          // Once the scene is actually saved, also push to Vercel Blob so it
          // follows the encounter to any other device. Drafts sync on first save instead.
          const encounterId = get().currentEncounterId;
          if (encounterId) syncMapImageToServer(encounterId, value);
        };

        // Record the image's own pixel dimensions and auto-size the canvas to
        // match, so the background is never silently cropped/stretched. Runs
        // on every upload, including replacing an existing background.
        const applyDims = (dims: { width: number; height: number }) => {
          const encounter = get().encounter;
          commitEncounter({
            ...encounter,
            map: {
              ...encounter.map,
              image: {
                ...DEFAULT_MAP_IMAGE_SETTINGS,
                ...encounter.map.image,
                naturalWidthPx: dims.width,
                naturalHeightPx: dims.height
              },
              canvas: { widthPx: dims.width, heightPx: dims.height }
            }
          });
        };

        if (!dataUrl) {
          applyMapImage(null);
          return;
        }

        // A raw upload/import data URL can be many MB. Shrink it before it is
        // stored (IndexedDB) or sent anywhere. The decode is async; apply the
        // result once it's ready.
        if (dataUrl.startsWith("data:image/")) {
          void downscaleDataUrl(dataUrl)
            .then(async (resized) => {
              const dims = await getImageDimensions(resized);
              if (dims && shouldWarnBeforeReplacingImage(get().encounter, dims)) {
                const proceed = typeof window === "undefined" || window.confirm(
                  "This image is a different shape than the current background. Resizing the canvas to fit it won't move any walls, terrain, or tokens, but they may no longer line up with the new artwork.\n\nReplace the background anyway?"
                );
                if (!proceed) return;
              }
              applyMapImage(resized);
              if (dims) applyDims(dims);
            })
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
      updateMapPadding: (paddingSquares) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          map: { ...encounter.map, paddingSquares: Math.max(0, paddingSquares) }
        });
      },
      updateHp: (combatantId, hp) => {
        const state = get();
        const engine = createEngineState(state.encounter);
        engine.log = [...state.log];
        const combatant = engine.snapshot.combatants.find((candidate) => candidate.id === combatantId);
        if (!combatant) return;
        const nextHp = Math.max(0, hp);
        combatant.currentHp = nextHp;
        if (nextHp <= 0) {
          // Same choke point a simulated attack's damage goes through — downs /
          // defeats at most once per transition and fires any death effect.
          updateDefeatState(engine, combatant);
        } else if (combatant.state === "downed" || combatant.state === "defeated") {
          combatant.state = "active";
          combatant.deathSaves = { successes: 0, failures: 0, stable: false };
          combatant.conditions = (combatant.conditions ?? []).filter((condition) => condition.name !== "unconscious");
        }
        commitEncounter(engine.snapshot, { log: engine.log });
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
      toggleCombatantSurprised: (combatantId) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => combatant.id === combatantId
            ? {
                ...combatant,
                conditions: isSurprised(combatant)
                  ? (combatant.conditions ?? []).filter((condition) => condition.name !== "surprised")
                  : [...(combatant.conditions ?? []), surprisedCondition(encounter)]
              }
            : combatant)
        });
      },
      setFactionSurprised: (faction, surprised) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((combatant) => {
            if (combatant.faction !== faction) return combatant;
            const withoutSurprised = (combatant.conditions ?? []).filter((condition) => condition.name !== "surprised");
            return {
              ...combatant,
              conditions: surprised ? [...withoutSurprised, surprisedCondition(encounter)] : withoutSurprised
            };
          })
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
      setResourceSize: (definitionId, resourceId, size) => {
        const encounter = get().encounter;
        const definition = encounter.definitions.find((candidate) => candidate.id === definitionId);
        if (!definition) return;
        const base = editBase();
        const baseDefinition = base.definitions.find((candidate) => candidate.id === definitionId) ?? definition;
        const oldFull = fullOf(baseDefinition, resourceId);
        const next = withResourceSize(definition, resourceId, size);
        const full = fullOf(next, resourceId) ?? size;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((candidate) => (candidate.id === definitionId ? next : candidate)),
          combatants: encounter.combatants.map((combatant) => {
            if ((combatant.activeForm?.definitionId ?? combatant.definitionId) !== definitionId) return combatant;
            const was = (base.combatants.find((candidate) => candidate.id === combatant.id) ?? combatant).resources?.[resourceId];
            // The engine refills legendary actions itself; a token that hasn't any yet is left to it.
            if (was === undefined && resourceId === LEGENDARY_POINTS) return combatant;
            const wasFull = was === undefined || oldFull === undefined || was >= oldFull;
            return { ...combatant, resources: { ...(combatant.resources ?? {}), [resourceId]: wasFull ? full : Math.min(was, full) } };
          })
        });
      },
      removeResource: (definitionId, resourceId) => {
        const encounter = get().encounter;
        const definition = encounter.definitions.find((candidate) => candidate.id === definitionId);
        if (!definition || definition.resources?.[resourceId] === undefined) return;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((candidate) => (candidate.id === definitionId ? withoutResource(candidate, resourceId) : candidate)),
          combatants: encounter.combatants.map((combatant) => {
            if ((combatant.activeForm?.definitionId ?? combatant.definitionId) !== definitionId || combatant.resources?.[resourceId] === undefined) return combatant;
            const { [resourceId]: _removed, ...resources } = combatant.resources;
            return { ...combatant, resources };
          })
        });
      },
      refillResources: (combatantId) => {
        const encounter = get().encounter;
        const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
        if (!combatant) return;
        const resources = refilledResources(getDefinition(encounter, combatant), combatant);
        if (deepEqual(resources, combatant.resources ?? {})) return;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((candidate) => (candidate.id === combatantId ? { ...candidate, resources } : candidate))
        });
      },
      setLegendaryPool: (definitionId, pool) => {
        const encounter = get().encounter;
        const definition = encounter.definitions.find((candidate) => candidate.id === definitionId);
        const next = definition ? withLegendaryPool(definition, pool) : undefined;
        if (!definition || !next || next === definition) return;
        commitEncounter({ ...encounter, definitions: encounter.definitions.map((candidate) => (candidate.id === definitionId ? next : candidate)) });
      },
      applyConditionToCombatant: (combatantId, condition) => {
        const state = get();
        const engine = createEngineState(state.encounter);
        engine.log = [...state.log];
        // The engine's own modifiers for the name: prone from the sheet is prone from a fall.
        applyCondition(engine, combatantId, {
          id: `${condition}-${crypto.randomUUID()}`,
          name: condition,
          startedRound: engine.snapshot.round,
          modifiers: defaultConditionModifiers(condition)
        }, { force: true }); // the DM's word beats a creature's immunity
        commitEncounter(engine.snapshot, { log: engine.log });
      },
      removeCondition: (combatantId, conditionId) => {
        const encounter = get().encounter;
        const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
        if (!combatant?.conditions?.some((condition) => condition.id === conditionId)) return;
        commitEncounter({
          ...encounter,
          combatants: encounter.combatants.map((candidate) => candidate.id === combatantId
            ? { ...candidate, conditions: (candidate.conditions ?? []).filter((condition) => condition.id !== conditionId) }
            : candidate)
        });
      },
      togglePrepBuff: (combatantId, actionId) => {
        const state = get();
        const encounter = state.encounter;
        const combatant = encounter.combatants.find((candidate) => candidate.id === combatantId);
        const definition = combatant && encounter.definitions.find((candidate) => candidate.id === combatant.definitionId);
        if (!combatant || !definition) {
          return;
        }
        const action = getExecutableActions(definition).find(
          (candidate): candidate is Extract<ActionDefinition, { kind: "buff" }> =>
            candidate.id === actionId && candidate.kind === "buff" && Boolean(candidate.prepOnly)
        );
        if (!action) {
          return;
        }
        const conditionId = action.appliedCondition.id ?? action.id;
        const alreadyActive = (combatant.conditions ?? []).some((condition) => condition.id === conditionId);

        if (alreadyActive) {
          // Toggle off: drop the condition, refund the resource. Temp HP is
          // deliberately left alone — see the plan's "no auto-revert" note.
          commitEncounter({
            ...encounter,
            combatants: encounter.combatants.map((candidate) => candidate.id !== combatantId ? candidate : {
              ...candidate,
              conditions: (candidate.conditions ?? []).filter((condition) => condition.id !== conditionId),
              resources: action.resourceCost
                ? {
                  ...(candidate.resources ?? {}),
                  [action.resourceCost.resourceId]: (candidate.resources?.[action.resourceCost.resourceId] ?? 0) + action.resourceCost.amount
                }
                : candidate.resources
            })
          });
          return;
        }

        const engine = createEngineState(encounter);
        engine.log = [...state.log];
        applyCondition(engine, combatantId, {
          id: conditionId,
          name: action.appliedCondition.name ?? "custom",
          sourceId: action.id,
          sourceName: action.name,
          sourceCombatantId: combatantId,
          // Not `engine.snapshot.round` — a prep buff is toggled before
          // initiative exists (round stays 0 until then) and is meant to
          // last the whole encounter regardless, so no `expiresAt` at all.
          startedRound: 0,
          modifiers: action.appliedCondition.modifiers,
          effects: action.appliedCondition.effects
        });
        const target = engine.snapshot.combatants.find((candidate) => candidate.id === combatantId);
        if (target) {
          if (action.resourceCost) {
            const current = target.resources?.[action.resourceCost.resourceId] ?? 0;
            target.resources = {
              ...(target.resources ?? {}),
              [action.resourceCost.resourceId]: Math.max(0, current - action.resourceCost.amount)
            };
          }
          if (action.tempHp?.length) {
            const amount = action.tempHp.reduce((sum, component) => sum + rollDice(component.dice, engine.rng).total, 0);
            target.tempHp = Math.max(target.tempHp, amount);
          }
        }
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
          position: position ?? openCellFor(encounter, sizeFootprint(definition.size)),
          currentHp: definition.maxHp,
          tempHp: 0,
          resources: defaultResourcesForDefinition(definition),
          state: "active" as const,
          tacticsProfile: defaultTacticsForDefinition(definition),
          ...(definition.defaultActiveForm ? { activeForm: { definitionId: definition.defaultActiveForm } } : {}),
          resourceStance: definition.defaultResourceStance ?? ("balanced" as const)
        };
        commitEncounter({
          ...encounter,
          definitions: dedupedDefinitions,
          combatants: [...encounter.combatants, combatant]
        }, {
          selectedCombatantId: combatant.id
        });
      },
      addCreatureTokens: (definition, faction, quantity, position) => {
        if (!definition?.id) {
          return;
        }
        const total = Math.max(1, Math.min(MAX_TOKEN_BATCH, Math.floor(Number(quantity)) || 1));
        const encounter = get().encounter;
        const definitions = [
          ...encounter.definitions.filter((candidate) => candidate?.id && candidate.id !== definition.id),
          definition
        ];
        const existing = encounter.combatants.filter((combatant) => combatant.definitionId === definition.id).length;
        const footprint = sizeFootprint(definition.size);
        const added: CombatantState[] = [];
        for (let index = 0; index < total; index += 1) {
          const working: EncounterSnapshot = { ...encounter, definitions, combatants: [...encounter.combatants, ...added] };
          const origin = added[0]?.position ?? position;
          const cell = index === 0
            ? position ?? openCellFor(working, footprint)
            : nearestOpenCell(working, origin ?? findOpenCell(working), footprint) ?? findOpenCell(working);
          added.push({
            id: `combatant-${crypto.randomUUID()}`,
            definitionId: definition.id,
            displayName: `${definition.name} ${existing + index + 1}`,
            faction,
            position: cell,
            currentHp: definition.maxHp,
            tempHp: 0,
            resources: defaultResourcesForDefinition(definition),
            state: "active",
            tacticsProfile: defaultTacticsForDefinition(definition),
            ...(definition.defaultActiveForm ? { activeForm: { definitionId: definition.defaultActiveForm } } : {}),
            resourceStance: definition.defaultResourceStance ?? "balanced"
          });
        }
        commitEncounter({
          ...encounter,
          definitions,
          combatants: [...encounter.combatants, ...added]
        }, {
          selectedCombatantId: added[added.length - 1]?.id ?? null
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
      addBlankToken: (input) => {
        const id = `def-${crypto.randomUUID()}`;
        get().addCreatureDefinition({
          id,
          name: input.name,
          source: { provider: "homebrew" },
          size: input.size,
          type: input.type,
          armorClass: input.ac,
          maxHp: input.hp,
          speed: input.speed,
          proficiencyBonus: input.proficiencyBonus,
          character: input.faction === "party" ? { level: 1, classes: [{ name: "Adventurer", level: 1 }] } : undefined,
          abilities: input.abilities,
          actions: []
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
        // A new max HP: tokens that were at full follow it, the others keep their HP, capped at it. "Were" is measured
        // before the edit began, so the 6 typed on the way from 52 to 60 can't cut a token's HP to 6.
        const base = editBase();
        const before = base.definitions.find((definition) => definition.id === definitionId);
        const maxHp = updates.maxHp;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? { ...definition, ...updates }
            : definition),
          combatants: maxHp === undefined ? encounter.combatants : encounter.combatants.map((combatant) => {
            // The tokens showing this creature's max HP: those in its form now.
            if ((combatant.activeForm?.definitionId ?? combatant.definitionId) !== definitionId) return combatant;
            const was = base.combatants.find((candidate) => candidate.id === combatant.id) ?? combatant;
            const wasFull = before !== undefined && was.currentHp >= before.maxHp;
            return { ...combatant, currentHp: wasFull ? maxHp : Math.min(Math.max(0, was.currentHp), maxHp) };
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
        // Cast with this creature's spellcasting ability: a library spell's DC or to-hit follows it (D5), and a heal or
        // damage that adds a spellcasting modifier adds this creature's.
        const spell = normalizeSpellDefinition(castWith(structuredClone(source), spellcastingAbility(definition)));
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
            ? withSettledSpellcasting({ ...candidate, spells: [...(candidate.spells ?? []), spell] })
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
        const seeded = featurePoolsToSeed(feature);

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
      setInLair: (combatantIds, inLair) => {
        const encounter = get().encounter;
        const ids = new Set(combatantIds);
        let changed = false;
        const combatants = encounter.combatants.map((combatant) => {
          if (!ids.has(combatant.id) || Boolean(combatant.inLair) === inLair) return combatant;
          changed = true;
          return { ...combatant, inLair: inLair || undefined, lastLairActionId: undefined };
        });
        if (!changed) return;
        commitEncounter({ ...encounter, combatants });
      },
      removeDefinitionItem: (definitionId, itemType, itemId, replacement) => {
        const encounter = get().encounter;
        commitEncounter({
          ...encounter,
          definitions: encounter.definitions.map((definition) => definition.id === definitionId
            ? withoutDefinitionItem(definition, itemType, itemId, replacement)
            : definition)
        });
      },
      replaceAbilityRecord: (definitionId, ref, record, extras) => {
        const encounter = get().encounter;
        const definition = encounter.definitions.find((candidate) => candidate.id === definitionId);
        const replaced = definition ? withReplacedAbility(definition, ref, record) : undefined;
        if (!definition || !replaced) return undefined;
        // A legendary action's editor also says how many the creature takes a round.
        const pooled = withNewPools(extras?.legendaryPool !== undefined ? withLegendaryPool(replaced.definition, extras.legendaryPool) : replaced.definition, extras?.pools);
        // A spell that now follows the spellcasting ability pins the creature's (see `withSettledSpellcasting`).
        const settled = withSettledSpellcasting(pooled.definition);
        if (deepEqual(settled, definition)) return replaced.ref;
        commitAbilityChange(encounter, definitionId, settled, { ...replaced.seeded, ...pooled.added }, extras?.embed);
        return replaced.ref;
      },
      insertAbilityRecord: (definitionId, where, record, extras) => {
        const encounter = get().encounter;
        const definition = encounter.definitions.find((candidate) => candidate.id === definitionId);
        const inserted = definition ? withInsertedAbility(definition, where, record) : undefined;
        if (!inserted) return undefined;
        const placed = extras?.after ? withRecordAfter(inserted.definition, inserted.ref, extras.after) : { definition: inserted.definition, ref: inserted.ref };
        const sized = extras?.legendaryPool !== undefined ? withLegendaryPool(placed.definition, extras.legendaryPool) : placed.definition;
        const pooled = withNewPools(sized, extras?.pools);
        commitAbilityChange(encounter, definitionId, withSettledSpellcasting(pooled.definition), { ...inserted.seeded, ...pooled.added }, extras?.embed);
        return placed.ref;
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
  // Counts every square a token covers, not just its top-left one: a Large token added earlier must not
  // have a small one dropped into its body. (Identical to the old scan while every token is 1×1.)
  const taken = occupiedCells(encounter);
  for (let y = 0; y < encounter.map.grid.height; y += 1) {
    for (let x = 0; x < encounter.map.grid.width; x += 1) {
      if (!taken.has(`${x},${y}`)) {
        return { x, y };
      }
    }
  }
  return { x: 0, y: 0 };
}

/** Every square covered by an existing token, at that token's own size. */
function occupiedCells(encounter: EncounterSnapshot): Set<string> {
  const taken = new Set<string>();
  for (const combatant of encounter.combatants) {
    const owner = encounter.definitions.find((candidate) => candidate.id === combatant.definitionId);
    for (const cell of footprintCells(combatant.position, owner ? sizeFootprint(owner.size) : 1)) {
      taken.add(`${cell.x},${cell.y}`);
    }
  }
  return taken;
}

/**
 * Where a newly added token goes when nobody chose a square. A 1×1 token takes the first free square
 * exactly as it always has; a bigger one (Large and up) needs a free footprint × footprint block, so a
 * dragon or ogre can't land on top of the tokens already in the top-left corner.
 */
function openCellFor(encounter: EncounterSnapshot, footprint: number): Point {
  if (footprint <= 1) {
    return findOpenCell(encounter);
  }
  const grid = encounter.map.grid;
  const taken = occupiedCells(encounter);
  for (let y = 0; y + footprint <= grid.height; y += 1) {
    for (let x = 0; x + footprint <= grid.width; x += 1) {
      const cells = footprintCells({ x, y }, footprint);
      if (!cells.some((cell) => taken.has(`${cell.x},${cell.y}`) || terrainAtCell(encounter.map.terrain, cell)?.type === "impassable")) {
        return { x, y };
      }
    }
  }
  return findOpenCell(encounter);
}

/** Upper bound on tokens added in one go, so a stray click can't bury the map. */
export const MAX_TOKEN_BATCH = 20;

/**
 * The free spot closest to `origin` for a token that covers `footprint` × `footprint` squares: in bounds,
 * not overlapping any existing token (each at its own size) and not on impassable terrain. Ties break
 * top-to-bottom, left-to-right so the result is deterministic.
 */
function nearestOpenCell(encounter: EncounterSnapshot, origin: Point, footprint: number): Point | undefined {
  const grid = encounter.map.grid;
  const taken = occupiedCells(encounter);
  let best: Point | undefined;
  let bestDistance = Infinity;
  for (let y = 0; y + footprint <= grid.height; y += 1) {
    for (let x = 0; x + footprint <= grid.width; x += 1) {
      const cells = footprintCells({ x, y }, footprint);
      if (cells.some((cell) => taken.has(`${cell.x},${cell.y}`) || terrainAtCell(encounter.map.terrain, cell)?.type === "impassable")) {
        continue;
      }
      const distance = (x - origin.x) ** 2 + (y - origin.y) ** 2;
      if (distance < bestDistance) {
        best = { x, y };
        bestDistance = distance;
      }
    }
  }
  return best;
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
/** The creature with each of `pools` it doesn't have yet, at its starting size; `added` says which were new. */
function withNewPools(definition: CreatureDefinition, pools: Record<string, number> | undefined): { definition: CreatureDefinition; added: Record<string, number> } {
  const added = Object.fromEntries(Object.entries(pools ?? {}).filter(([id]) => id.trim() && definition.resources?.[id] === undefined));
  if (Object.keys(added).length === 0) return { definition, added };
  return { definition: { ...definition, resources: { ...(definition.resources ?? {}), ...added } }, added };
}

/**
 * The creature with a new ability added the way the list's own add action adds one (fresh ids, the weapon's charge
 * pool namespaced, a feature's granted actions pointed at it), plus the pools it spends that the creature lacks.
 * Pools the creature has keep their values.
 */
function withInsertedAbility(
  definition: CreatureDefinition,
  where: AbilityInsertTarget,
  record: AbilityRecord
): { definition: CreatureDefinition; ref: AbilityRef; seeded: Record<string, number> } | undefined {
  let placed: { definition: CreatureDefinition; ref: AbilityRef } | undefined;
  let pools: Record<string, number> = {};
  if (where === "legendary") {
    placed = withNewLegendaryAction(definition, record as LegendaryActionRef, `legendary-${crypto.randomUUID()}`);
  } else if (typeof where === "object") {
    placed = withNewGrantedAction(definition, where.granted, record as ActionDefinition);
  } else if (where === "weapons") {
    const id = `weapon-${crypto.randomUUID()}`;
    const normalized = normalizeWeaponDefinition({ ...(record as WeaponDefinition), id }, definition.abilities);
    normalized.id = id;
    normalized.actionId = `weapon-action-${id}`;
    const { weapon, seeded } = prepareWeaponForAttach(normalized, id);
    placed = withNewAbility(definition, "weapons", weapon);
    pools = seeded ?? {};
  } else if (where === "spells") {
    const id = `spell-${crypto.randomUUID()}`;
    const spell = normalizeSpellDefinition({ ...(record as SpellDefinition), id });
    spell.id = id;
    if (spell.action) {
      const previous = (record as SpellDefinition).action?.id ?? "";
      spell.action = withOwnUsagePool({ ...spell.action, id: `spell-action-${id}` }, previous);
      // The spell's own cost follows its action's (see `spellLimit`).
      if (spell.resourceCost?.resourceId === `usage:${previous}` && "resourceCost" in spell.action && spell.action.resourceCost) spell.resourceCost = spell.action.resourceCost;
    }
    placed = withNewAbility(definition, "spells", spell);
  } else if (where === "features" || where === "traits") {
    const input = record as FeatureDefinition;
    const normalized = normalizeFeatureRecord(structuredClone(input), `feature-${crypto.randomUUID()}`);
    // Its granted abilities' own uses or recharge follow their new ids (see `withOwnUsagePool`).
    const feature = normalized.grantedActions
      ? { ...normalized, grantedActions: normalized.grantedActions.map((action, index) => withOwnUsagePool(action, input.grantedActions?.[index]?.id ?? "")) }
      : normalized;
    placed = withNewAbility(definition, where, feature);
    pools = featurePoolsToSeed(feature) ?? {};
  } else if (where === "deathEffects") {
    const id = `death-effect-${crypto.randomUUID()}`;
    const effect = normalizeDeathEffectDefinition({ ...(record as DeathEffectDefinition), id });
    effect.id = id;
    if (effect.action) effect.action = withOwnUsagePool({ ...effect.action, id: `death-effect-action-${id}` }, (record as DeathEffectDefinition).action?.id ?? "");
    placed = withNewAbility(definition, "deathEffects", effect);
  } else if (where === "lairActions") {
    const id = `lair-${crypto.randomUUID()}`;
    const action = normalizeActionDefinition({ ...(record as ActionDefinition), id, actionType: "action" } as ActionDefinition, "action");
    action.id = id;
    placed = withNewAbility(definition, "lairActions", withOwnUsagePool(action, (record as ActionDefinition).id));
  } else {
    const id = `action-${crypto.randomUUID()}`;
    const input = record as ActionDefinition;
    const fallback = input.actionType === "bonus" || input.actionType === "reaction" ? input.actionType : "action";
    const action = normalizeActionDefinition({ ...input, id }, fallback);
    action.id = id;
    placed = withNewAbility(definition, where, withOwnUsagePool(action, input.id));
  }
  if (!placed) return undefined;
  const added = findAbility(placed.definition, placed.ref);
  if (added) for (const [id, size] of usagePools(added)) pools[id] = size;
  const seeded = Object.fromEntries(Object.entries(pools).filter(([id]) => definition.resources?.[id] === undefined));
  const next = Object.keys(seeded).length
    ? { ...placed.definition, resources: { ...(definition.resources ?? {}), ...seeded } }
    : placed.definition;
  return { definition: next, ref: placed.ref, seeded };
}

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


