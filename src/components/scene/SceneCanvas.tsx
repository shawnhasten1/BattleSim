"use client";

import { Crosshair, ZoomIn, ZoomOut } from "lucide-react";
import { type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { cellIntersectsArea, getDefinition, parseDiceExpression, sizeFootprint, wallCover, type CombatantState, type ConditionName, type CoverLevel, type CreatureDefinition, type DmChange, type TerrainZone, type WallSegment } from "@/engine";
import { hasVanished, isDominated, isSurprised, TERRAIN_BRUSH_PRESETS, useEncounterStore, type GridAlignDraft, type TerrainBrushId } from "@/store/encounter-store";
import { parseSrdDragPayload, SRD_DRAG_MIME } from "@/data/srd";
import { useDisplayEncounter, useIsPlayingBack, useIsReplaying } from "@/hooks/useDisplayEncounter";
import { PlayOverlay } from "@/components/play/PlayOverlay";
import { PlayMoveMarks } from "@/components/play/PlayMoveLayer";
import { PlayAimMarks, PlayAimTooltip } from "@/components/play/PlayAimLayer";
import { usePlayAimView } from "@/hooks/usePlayAim";
import { swingQuestion, turnOptionQuestion } from "@/hooks/usePlayMove";
import { usePlayMoveView } from "@/hooks/usePlayMove";
import { useReplayPathWalk } from "@/hooks/useReplayPathWalk";
import { useSceneFeedback } from "@/hooks/useSceneFeedback";
import { clamp, pointsMatch } from "@/components/scene/coords";
import { deriveSceneMetrics } from "@/components/scene/metrics";
import { SceneOverlays } from "@/components/scene/SceneOverlays";
import { TokenHealthBar } from "@/components/scene/TokenHealthBar";
import { SceneFeedbackLayer } from "@/components/scene/SceneFeedbackLayer";
import { ElevationLegend, ElevationPalette } from "@/components/scene/ElevationPalette";
import { alignedMap, alignmentShift, GridAlignLayer, GridAlignPanel } from "@/components/scene/GridAlign";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { tokenVisualsFor } from "@/lib/ui-helpers";
import { useDeviceTokenImages } from "@/store/token-pack-store";
import type { SceneInteraction } from "@/hooks/useSceneInteraction";
import type { UseViewportResult } from "@/hooks/useViewport";

const WALL_COVER_ITEMS: Array<{ cover: CoverLevel; label: string }> = [
  { cover: "total", label: "Solid wall" },
  { cover: "three-quarters", label: "High wall — ¾ cover" },
  { cover: "half", label: "Low wall — ½ cover" },
  { cover: "none", label: "Marker — no cover" }
];

/** Conditions the DM can put on or take off a creature in a played fight. */
const DM_CONDITIONS: ConditionName[] = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "poisoned", "prone", "restrained", "stunned"
];

const TERRAIN_TYPE_ITEMS: Array<{ brush: Exclude<TerrainBrushId, "eraser">; label: string }> = [
  { brush: "difficult", label: "Difficult — ×2 move cost" },
  { brush: "greaterDifficult", label: "Greater difficult — ×4 move cost" },
  { brush: "impassable", label: "Impassable — blocks movement" },
  { brush: "water", label: "Shallow water — walkers ×2, swimmers free" },
  { brush: "deepWater", label: "Deep water — swimmers and fliers only" },
  { brush: "rock", label: "Solid rock — burrowers only" },
  { brush: "cliff", label: "Cliff face — climbers and fliers only" },
  { brush: "acid", label: "Acid — DC 12 Dex, 2d6 acid (half on save)" },
  { brush: "lava", label: "Lava — 4d10 fire, no save" },
  { brush: "ice", label: "Ice — DC 10 Dex save or prone, no damage" }
];

interface SceneCanvasProps {
  viewport: UseViewportResult;
  scene: SceneInteraction;
  showGrid: boolean;
  /** Draw the ground-height tint, cliff edges and legend. The Elevation tool shows them regardless. */
  showElevation?: boolean;
  showHealthBars: boolean;
  onCanvasDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onCanvasDrop: (event: DragEvent<HTMLDivElement>) => void;
  /** Open the floating actor sheet (owned by the page). Invoked from the token context menu. */
  /** Opens a token's sheet window: its menu's "Edit sheet", or a double-click on it. */
  onEditActor?: (combatantId: string) => void;
  /** Open the battle report (owned by the page): Play's end card offers it. */
  onOpenReport?: () => void;
}

/**
 * The pannable / zoomable scene stage: HUD readout, zoom controls, and the
 * transformed battlemap (background image, grid lines, SVG overlays, tokens,
 * and the token-overlay + feedback layers that sit above the tokens).
 * Interaction state and pointer logic live in `useSceneInteraction` /
 * `useViewport`; this component only wires them to the DOM and renders.
 */
export function SceneCanvas({ viewport, scene, showGrid, showElevation = true, showHealthBars, onCanvasDragOver, onCanvasDrop, onEditActor, onOpenReport }: SceneCanvasProps) {
  const map = useEncounterStore((state) => state.encounter.map);
  const replaySpeed = useEncounterStore((state) => state.replaySpeed);
  const mapImageDataUrl = useEncounterStore((state) => state.mapImageDataUrl);
  const removeCombatant = useEncounterStore((state) => state.removeCombatant);
  const removeCombatants = useEncounterStore((state) => state.removeCombatants);
  const duplicateCombatant = useEncounterStore((state) => state.duplicateCombatant);

  // The last press on a token. A second plain press on it soon after, nearly in place, opens its sheet: no dblclick
  // reaches a token, because its first press captures the pointer on the battlemap.
  const lastPressRef = useRef<{ id: string; at: number; x: number; y: number } | null>(null);
  function isDoublePress(event: ReactPointerEvent, id: string): boolean {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      lastPressRef.current = null;
      return false;
    }
    const last = lastPressRef.current;
    const double = last !== null && last.id === id && event.timeStamp - last.at < 400 && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 6;
    lastPressRef.current = double ? null : { id, at: event.timeStamp, x: event.clientX, y: event.clientY };
    return double;
  }
  const updateHp = useEncounterStore((state) => state.updateHp);
  const setAltitude = useEncounterStore((state) => state.setAltitude);
  const adjustAltitude = useEncounterStore((state) => state.adjustAltitude);
  const setInLair = useEncounterStore((state) => state.setInLair);
  const setArrivesRound = useEncounterStore((state) => state.setArrivesRound);
  const toggleCombatantSurprised = useEncounterStore((state) => state.toggleCombatantSurprised);
  const playCommand = useEncounterStore((state) => state.playCommand);
  const playIdle = useEncounterStore((state) => Boolean(state.play && !state.play.pending && !state.play.playback));
  const combatRound = useEncounterStore((state) => state.encounter.round);
  const updateWalls = useEncounterStore((state) => state.updateWalls);
  const removeWalls = useEncounterStore((state) => state.removeWalls);
  const updateTerrainTiles = useEncounterStore((state) => state.updateTerrainTiles);
  const removeTerrainTiles = useEncounterStore((state) => state.removeTerrainTiles);
  const attachSrdWeapon = useEncounterStore((state) => state.attachSrdWeapon);
  const attachSrdItem = useEncounterStore((state) => state.attachSrdItem);
  const attachSrdSpell = useEncounterStore((state) => state.attachSrdSpell);
  const [srdDropTokenId, setSrdDropTokenId] = useState<string | null>(null);
  const encounter = useDisplayEncounter();
  const reviewing = useIsReplaying();
  // A review replay or Play's playback of the AI's turns drives the board; and while Play waits on a question the board
  // shows the moment it came up. The map can't be edited during either.
  const playingBack = useIsPlayingBack();
  const playing = useEncounterStore((state) => state.play !== null);
  const questionOpen = useEncounterStore((state) => Boolean(state.play?.pending) && !state.play?.playback);
  // A multiattack's next swing, and a legendary or lair action, are aimed on the map, so the map stays live for them.
  const aimedQuestion = useEncounterStore((state) => swingQuestion(state) !== null || turnOptionQuestion(state) !== null);
  const replaying = reviewing || playingBack || (questionOpen && !aimedQuestion);
  const playSpeed = useEncounterStore((state) => state.play?.playbackSpeed ?? 1);
  // The move a person is planning on their creature's turn: drawn on the map, summed up on the dock.
  const playMove = usePlayMoveView();
  const playAim = usePlayAimView();
  const yourTurnId = useEncounterStore((state) =>
    state.play && !state.play.pending && !state.play.playback && state.play.status.kind === "your-turn" ? state.play.status.actorId : null);
  const selectCombatant = useEncounterStore((state) => state.selectCombatant);

  function onTokenSrdDragOver(event: DragEvent<HTMLButtonElement>, combatantId: string) {
    if (replaying || !event.dataTransfer.types.includes(SRD_DRAG_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setSrdDropTokenId(combatantId);
  }

  function onTokenSrdDrop(event: DragEvent<HTMLButtonElement>, combatant: CombatantState) {
    const raw = event.dataTransfer.getData(SRD_DRAG_MIME);
    setSrdDropTokenId(null);
    if (replaying || !raw) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = parseSrdDragPayload(raw);
    if (payload?.kind === "weapon") attachSrdWeapon(combatant.definitionId, payload.id);
    else if (payload?.kind === "spell") attachSrdSpell(combatant.definitionId, payload.id);
    else if (payload?.kind === "item") attachSrdItem(combatant.definitionId, payload.id);
  }
  const { floaties, areaFlashes } = useSceneFeedback(encounter);

  // Align grid: while a draft is open for this scene, the image is drawn at the draft pin.
  const gridAlign = useEncounterStore((state) => state.gridAlign);
  const cancelGridAlign = useEncounterStore((state) => state.cancelGridAlign);
  const encounterId = useEncounterStore((state) => state.encounter.id);
  const aligning = gridAlign && gridAlign.encounterId === encounterId && !replaying ? gridAlign : null;
  useEffect(() => {
    if (gridAlign && gridAlign.encounterId !== encounterId) cancelGridAlign();
  }, [gridAlign, encounterId, cancelGridAlign]);

  const metrics = useMemo(() => deriveSceneMetrics(aligning ? alignedMap(map, aligning) : map), [map, aligning]);
  const frame = { width: metrics.framePixelWidth, height: metrics.framePixelHeight };

  // A scene opened for the first time (no saved view) is fitted to the stage.
  useEffect(() => {
    if (viewport.pendingFit) viewport.fitToView({ width: metrics.framePixelWidth, height: metrics.framePixelHeight });
    // `viewport` is rebuilt every render; the fit only needs redoing when it's pending or the map's size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.pendingFit, metrics.framePixelWidth, metrics.framePixelHeight]);

  // Align grid shifts the grid over the image: the scene (grid, walls, tokens) moves and the
  // image stays where it was on screen. Once applied, the grid settles back to the scene's
  // corner, so the view pans by the same amount and nothing jumps.
  const alignShift = aligning ? alignmentShift(aligning, metrics.cellSize) : null;
  const lastAlignRef = useRef<{ draft: GridAlignDraft; shift: { x: number; y: number } } | null>(null);
  useEffect(() => {
    if (aligning) {
      lastAlignRef.current = { draft: aligning, shift: alignShift ?? { x: 0, y: 0 } };
      return;
    }
    const last = lastAlignRef.current;
    lastAlignRef.current = null;
    const image = map.image;
    if (!last || !image) return;
    const applied = image.pxPerSquare === last.draft.pxPerSquare && image.originX === last.draft.originX && image.originY === last.draft.originY;
    const zoom = viewport.viewport.zoom;
    if (applied && (last.shift.x || last.shift.y)) viewport.panBy(last.shift.x * zoom, last.shift.y * zoom);
    // Runs as the draft changes and when it closes; `viewport` and `map` are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aligning]);
  const cellSize = metrics.cellSize;
  const { tool, pendingWallStart } = scene;

  // A person's creature's turn: select it, and bring it into view if it's off the edge.
  useEffect(() => {
    if (!yourTurnId) return;
    selectCombatant(yourTurnId);
    const actor = encounter.combatants.find((combatant) => combatant.id === yourTurnId);
    const stage = viewport.stageRef.current?.getBoundingClientRect();
    if (!actor || !stage?.width || !stage.height) return;
    const half = sizeFootprint(getDefinition(encounter, actor).size) / 2;
    const { x, y, zoom } = viewport.viewport;
    const screenX = x + (metrics.paddingXPx + (actor.position.x + half) * cellSize) * zoom;
    const screenY = y + (metrics.paddingYPx + (actor.position.y + half) * cellSize) * zoom;
    const margin = Math.min(120, stage.width / 4, stage.height / 4);
    if (screenX < margin || screenY < margin || screenX > stage.width - margin || screenY > stage.height - margin) {
      viewport.panBy(stage.width / 2 - screenX, stage.height / 2 - screenY);
    }
    // Only when the turn changes hands; the board and view are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yourTurnId]);
  // Tokens tween between cells only while replay is scrubbing/playing; editing
  // stays instant. Faster playback → snappier tween.
  const slideMs = replaying ? Math.round(clamp(620 / Math.max(0.1, playingBack ? Math.max(1, playSpeed) : replaySpeed), 90, 900)) : 0;
  // While playback steps onto a move, the token walks its recorded path one cell
  // at a time (each hop = `walk.hopMs`); otherwise it slides straight over `slideMs`.
  const walk = useReplayPathWalk(slideMs);
  const tokenMoveMs = walk.hopMs ?? slideMs;

  // One pass over the roster: everything the token, its HP bar, and any future
  // per-token overlay need, so the tokens and the overlay layer stay in sync.
  // A token being dragged with the Select tool renders at the live cursor pixel
  // (committed to the store only on drop) — both the token and its HP bar read
  // `x`/`y` from here, so they move together.
  const draggedToken = scene.draggedToken;
  const droppingTokenId = scene.droppingTokenId;
  const deviceImages = useDeviceTokenImages();
  const tokenLayouts = useMemo(
    () =>
      encounter.combatants.filter((combatant) => !hasVanished(combatant)).map((combatant) => {
        const definition = getDefinition(encounter, combatant);
        const footprint = sizeFootprint(definition.size);
        const drag = draggedToken?.id === combatant.id ? draggedToken : null;
        // During a traced replay move the token renders at the current path cell
        // rather than its (already-final) real position.
        const anchor = walk.positions.get(combatant.id) ?? combatant.position;
        const px = drag?.pixel
          ? drag.pixel
          : {
              x: (drag ? drag.cell.x : anchor.x) * cellSize,
              y: (drag ? drag.cell.y : anchor.y) * cellSize
            };
        // A standing zone can be subtle at a glance across a busy map — flag
        // any token currently inside one directly, so "is this player still
        // affected" doesn't depend on eyeballing polygon overlap.
        const inActiveZone = (encounter.activeZones ?? []).some((zone) =>
          cellIntersectsArea(anchor, zone.origin, zone.area, map.grid.distancePerSquare));
        return {
          combatant,
          definition,
          size: footprint * cellSize,
          x: px.x,
          y: px.y,
          dragging: Boolean(drag),
          dropping: droppingTokenId === combatant.id,
          visuals: tokenVisualsFor(definition, combatant, deviceImages),
          hpOut: combatant.currentHp <= 0 || combatant.state !== "active",
          inActiveZone,
          altitude: combatant.altitude ?? 0,
          // How far the token floats above its shadow: enough to read, small enough that a flier on the top row isn't cut off.
          lift: Math.min(8, 3 + (combatant.altitude ?? 0) / 10)
        };
      }),
    [encounter, cellSize, draggedToken, droppingTokenId, walk.positions, map.grid.distancePerSquare, deviceImages]
  );

  function wallMenuItems(): ContextMenuItem[] {
    // The menu acts on the whole selection: the selected walls plus every wall
    // touching a selected node.
    const nodes = scene.selectedWallNodes;
    const targetIds = Array.from(
      new Set([
        ...scene.selectedWallIds,
        ...map.walls
          .filter((wall) => nodes.some((node) => pointsMatch(node, wall.start) || pointsMatch(node, wall.end)))
          .map((wall) => wall.id)
      ])
    );
    const walls = targetIds
      .map((id) => map.walls.find((wall) => wall.id === id))
      .filter((wall): wall is WallSegment => Boolean(wall));
    if (walls.length === 0) return [];

    const n = walls.length;
    const every = (predicate: (wall: WallSegment) => boolean) => walls.every(predicate);
    const flag = (key: "blocksMovement" | "blocksSight" | "blocksProjectiles") => ({
      label: key === "blocksMovement" ? "Movement" : key === "blocksSight" ? "Sight" : "Projectiles",
      checked: every((wall) => wall[key]),
      keepOpen: true,
      disabled: key === "blocksProjectiles" && every((wall) => wallCover(wall) === "total"),
      onSelect: () => updateWalls(targetIds, { [key]: !every((wall) => wall[key]) })
    });

    return [
      { heading: n === 1 ? "Wall type" : `Wall type — ${n} selected` },
      ...WALL_COVER_ITEMS.map((entry) => ({
        label: entry.label,
        checked: every((wall) => wallCover(wall) === entry.cover),
        onSelect: () => updateWalls(targetIds, { cover: entry.cover })
      })),
      { separator: true },
      { heading: "Blocks" },
      flag("blocksMovement"),
      flag("blocksSight"),
      // Total cover always blocks line of effect, so the flag is pinned there.
      flag("blocksProjectiles"),
      { separator: true },
      {
        label: n === 1 ? "Delete segment" : `Delete ${n} segments`,
        danger: true,
        onSelect: () => {
          removeWalls(targetIds);
          scene.clearWallSelection();
        }
      }
    ];
  }

  function terrainMenuItems(): ContextMenuItem[] {
    const ids = scene.selectedTerrainIds;
    const tiles = ids
      .map((id) => map.terrain.find((tile) => tile.id === id))
      .filter((tile): tile is TerrainZone => Boolean(tile));
    if (tiles.length === 0) return [];

    const n = tiles.length;
    const every = (predicate: (tile: TerrainZone) => boolean) => tiles.every(predicate);
    const currentMultiplier = tiles[0].movementMultiplier ?? (tiles[0].type === "difficult" ? 2 : 1);
    const uniformMultiplier = every((tile) => (tile.movementMultiplier ?? (tile.type === "difficult" ? 2 : 1)) === currentMultiplier);
    // Acid and lava share `type: "hazard"`, so matching on type alone can't
    // tell them apart — compare the discriminating tag too.
    const matchesPreset = (tile: TerrainZone, preset: (typeof TERRAIN_BRUSH_PRESETS)[Exclude<TerrainBrushId, "eraser">]) =>
      tile.type === preset.type
      && (tile.movementMultiplier ?? 1) === (preset.movementMultiplier ?? 1)
      && (tile.tags?.[0] ?? null) === (preset.tags?.[0] ?? null);

    // Fine-tune a uniform hazard selection's own DC/damage-dice, beyond just
    // swapping between the 3 fixed presets — e.g. turn a DC 12 acid pool into
    // a DC 15 one, or "3d6 acid" instead of "2d6". Only shown when every
    // selected tile shares the same hazard (same tag), since editing DC on a
    // mixed acid+lava selection (lava has none) wouldn't mean anything.
    const uniformTag = every((tile) => (tile.tags?.[0] ?? null) === (tiles[0].tags?.[0] ?? null));
    const hazard = tiles[0].hazard;
    const uniformHazard = uniformTag && every((tile) => Boolean(tile.hazard)) && hazard;
    const damageComponent = hazard?.damage?.[0];
    const damageTerm = damageComponent ? parseDiceExpression(damageComponent.dice).terms[0] : undefined;
    const hazardTuningItems: ContextMenuItem[] = uniformHazard
      ? [
        { separator: true },
        { heading: "Hazard" },
        ...(hazard.saveAbility && hazard.dc != null
          ? [{
            stepper: {
              label: "Save DC",
              value: hazard.dc,
              steps: [-1, 1],
              disabled: !every((tile) => tile.hazard?.dc === hazard.dc),
              onStep: (delta: number) => updateTerrainTiles(ids, { hazard: { ...hazard, dc: Math.max(1, hazard.dc! + delta) } })
            }
          }]
          : []),
        ...(damageComponent && damageTerm
          ? [{
            stepper: {
              label: "Damage dice",
              value: damageTerm.count,
              sub: `d${damageTerm.sides} ${damageComponent.damageType}`,
              steps: [-1, 1],
              disabled: !every((tile) => tile.hazard?.damage?.[0]?.dice === damageComponent.dice),
              onStep: (delta: number) => updateTerrainTiles(ids, {
                hazard: {
                  ...hazard,
                  damage: [{ ...damageComponent, dice: `${Math.max(1, damageTerm.count + delta)}d${damageTerm.sides}` }]
                }
              })
            }
          }]
          : [])
      ]
      : [];

    return [
      { heading: n === 1 ? "Terrain type" : `Terrain type — ${n} selected` },
      ...TERRAIN_TYPE_ITEMS.map((entry) => {
        const preset = TERRAIN_BRUSH_PRESETS[entry.brush];
        return {
          label: entry.label,
          checked: every((tile) => matchesPreset(tile, preset)),
          onSelect: () => updateTerrainTiles(ids, {
            name: preset.name,
            type: preset.type,
            movementMultiplier: preset.movementMultiplier,
            tags: preset.tags,
            hazard: preset.hazard
          })
        };
      }),
      { separator: true },
      {
        stepper: {
          label: "Movement ×",
          value: currentMultiplier,
          steps: [-1, 1],
          disabled: !uniformMultiplier || !every((tile) => tile.type === "difficult"),
          onStep: (delta) => updateTerrainTiles(ids, { movementMultiplier: Math.max(1, currentMultiplier + delta) })
        }
      },
      ...hazardTuningItems,
      { separator: true },
      {
        label: n === 1 ? "Delete tile" : `Delete ${n} tiles`,
        danger: true,
        onSelect: () => {
          removeTerrainTiles(ids);
          scene.clearTerrainSelection();
        }
      }
    ];
  }

  /**
   * A token's menu while a fight is played: the DM's hand on it — HP, temporary HP, conditions, its reaction back —
   * each logged as the DM's, so the report and a replay see it. (Alt-drag moves it.)
   */
  function playTokenMenuItems(combatantId: string): ContextMenuItem[] {
    const combatant = encounter.combatants.find((entry) => entry.id === combatantId);
    if (!combatant) return [];
    const maxHp = getDefinition(encounter, combatant).maxHp;
    const hp = combatant.currentHp;
    const temp = combatant.tempHp ?? 0;
    const dm = (change: DmChange) => playCommand({ kind: "dm", change });
    const others = (combatant.conditions ?? []).filter((condition) => !DM_CONDITIONS.includes(condition.name));
    const label = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    return [
      { heading: combatant.displayName },
      {
        label: "Edit sheet",
        onSelect: () => {
          scene.selectCombatantOnBoard(combatant.id, false);
          onEditActor?.(combatant.id);
        }
      },
      { separator: true },
      { heading: playIdle ? "The DM's hand (logged)" : "The DM's hand: when the fight is waiting on you" },
      {
        stepper: {
          label: "HP",
          value: hp,
          sub: `/ ${maxHp}`,
          steps: [-5, -1, 1, 5],
          disabled: !playIdle,
          onStep: (delta) => dm({ kind: "hp", combatantId, hp: clamp(hp + delta, 0, maxHp) })
        }
      },
      {
        stepper: {
          label: "Temp HP",
          value: temp,
          steps: [-5, -1, 1, 5],
          disabled: !playIdle,
          onStep: (delta) => dm({ kind: "hp", combatantId, hp, tempHp: Math.max(0, temp + delta) })
        }
      },
      { label: "Set to full", disabled: !playIdle || hp >= maxHp, onSelect: () => dm({ kind: "hp", combatantId, hp: maxHp }) },
      { label: "Down (0 HP)", disabled: !playIdle || hp <= 0, onSelect: () => dm({ kind: "hp", combatantId, hp: 0 }) },
      { separator: true },
      { heading: "Conditions" },
      ...DM_CONDITIONS.map((name): ContextMenuItem => {
        const has = (combatant.conditions ?? []).find((condition) => condition.name === name);
        return {
          label: label(name),
          checked: Boolean(has),
          keepOpen: true,
          disabled: !playIdle,
          onSelect: () => dm(has ? { kind: "condition", combatantId, removeId: has.id } : { kind: "condition", combatantId, add: name })
        };
      }),
      ...others.map((condition): ContextMenuItem => ({
        label: `Take off ${condition.name === "custom" ? condition.sourceName ?? "an effect" : condition.name}`,
        disabled: !playIdle,
        onSelect: () => dm({ kind: "condition", combatantId, removeId: condition.id })
      })),
      { separator: true },
      { label: "Give back its reaction", disabled: !playIdle || combatant.actionEconomy?.reaction !== false, onSelect: () => dm({ kind: "reaction", combatantId }) },
      { label: "Move it freely", hint: "Alt-drag the token", disabled: true, onSelect: () => {} }
    ];
  }

  /** A door's menu while a fight is played: open or close it, as the DM. */
  function doorMenuItems(wallId: string): ContextMenuItem[] {
    const wall = map.walls.find((candidate) => candidate.id === wallId);
    if (!wall?.doorState) return [];
    const open = wall.doorState === "open";
    return [
      { heading: `Door (${wall.doorState})` },
      {
        label: open ? "Close the door" : "Open the door",
        disabled: !playIdle || wall.doorState === "destroyed",
        onSelect: () => playCommand({ kind: "dm", change: { kind: "door", wallId, open: !open } })
      }
    ];
  }

  function tokenMenuItems(combatantId: string): ContextMenuItem[] {
    if (playing) return playTokenMenuItems(combatantId);
    // Right-clicking a member of a 2+ selection acts on the whole set; anything
    // else acts on just the right-clicked token.
    const ids = scene.selectedCombatantIds.includes(combatantId)
      ? scene.selectedCombatantIds
      : [combatantId];

    const preCombat = combatRound <= 0;
    // Surprise's expiry is computed relative to round 0, and Auto Run/Batch
    // re-derive round numbering independently of the live turn order — marking
    // surprise once any round is already in progress can desync the two and
    // clear the condition before it does anything. Keep this strictly pre-combat.
    const canMarkSurprised = preCombat;

    if (ids.length >= 2) {
      const present = ids.filter((id) => encounter.combatants.some((entry) => entry.id === id));
      const arrivals = present.map((id) => encounter.combatants.find((c) => c.id === id)?.arrivesRound ?? 1);
      const allSame = new Set(arrivals).size === 1;
      const shown = allSame ? arrivals[0]! : Math.max(...arrivals);
      const anyBenched = arrivals.some((n) => n > 1);
      return [
        { heading: `${present.length} tokens` },
        { separator: true } as ContextMenuItem,
        { heading: "Flight" } as ContextMenuItem,
        {
          stepper: {
            label: "Altitude",
            value: Math.max(...present.map((id) => encounter.combatants.find((c) => c.id === id)?.altitude ?? 0)),
            sub: "ft (highest)",
            steps: [-10, -5, 5, 10],
            onStep: (delta: number) => adjustAltitude(present, delta)
          }
        } as ContextMenuItem,
        { label: "Land all", disabled: !present.some((id) => (encounter.combatants.find((c) => c.id === id)?.altitude ?? 0) > 0), onSelect: () => setAltitude(present, 0) } as ContextMenuItem,
        { separator: true } as ContextMenuItem,
        { label: "Duplicate all", onSelect: () => present.forEach((id) => duplicateCombatant(id)) },
        {
          label: "Delete all",
          danger: true,
          onSelect: () => {
            removeCombatants(present);
            scene.clearCombatantSelection();
          }
        },
        ...(canMarkSurprised
          ? [{ label: "Toggle surprised", onSelect: () => present.forEach((id) => toggleCombatantSurprised(id)) } as ContextMenuItem]
          : []),
        ...(preCombat
          ? [
              { separator: true } as ContextMenuItem,
              { heading: "Reinforcement" } as ContextMenuItem,
              {
                stepper: {
                  label: "Arrives round",
                  value: shown,
                  sub: !allSame ? "mixed" : shown > 1 ? "" : "on board",
                  steps: [-1, 1],
                  onStep: (delta: number) => setArrivesRound(present, shown + delta)
                }
              } as ContextMenuItem,
              { label: "All start on board", disabled: !anyBenched, onSelect: () => setArrivesRound(present, undefined) } as ContextMenuItem
            ]
          : [])
      ];
    }

    const combatant = encounter.combatants.find((entry) => entry.id === ids[0]);
    if (!combatant) return [];
    const maxHp = getDefinition(encounter, combatant).maxHp;
    const hp = combatant.currentHp;

    return [
      { heading: combatant.displayName },
      {
        label: "Edit sheet",
        onSelect: () => {
          scene.selectCombatantOnBoard(combatant.id, false);
          onEditActor?.(combatant.id);
        }
      },
      { separator: true },
      { heading: "Health" },
      {
        stepper: {
          label: "HP",
          value: hp,
          sub: `/ ${maxHp}`,
          steps: [-5, -1, 1, 5],
          onStep: (delta) => updateHp(combatant.id, clamp(hp + delta, 0, maxHp))
        }
      },
      { label: "Set to full", disabled: hp >= maxHp, onSelect: () => updateHp(combatant.id, maxHp) },
      { label: "Down (0 HP)", disabled: hp <= 0, onSelect: () => updateHp(combatant.id, 0) },
      { separator: true },
      { heading: "Flight" },
      {
        stepper: {
          label: "Altitude",
          value: combatant.altitude ?? 0,
          sub: "ft up",
          steps: [-10, -5, 5, 10],
          onStep: (delta) => adjustAltitude([combatant.id], delta)
        }
      },
      { label: "Land", disabled: (combatant.altitude ?? 0) <= 0, onSelect: () => setAltitude([combatant.id], 0) },
      ...((getDefinition(encounter, combatant).lairActions?.length ?? 0) > 0
        ? [
            { separator: true } as ContextMenuItem,
            {
              label: "In its lair (lair actions on initiative 20)",
              checked: Boolean(combatant.inLair),
              onSelect: () => setInLair([combatant.id], !combatant.inLair)
            } as ContextMenuItem
          ]
        : []),
      ...(canMarkSurprised
        ? [
            {
              label: "Surprised",
              checked: isSurprised(combatant),
              onSelect: () => toggleCombatantSurprised(combatant.id)
            } as ContextMenuItem
          ]
        : []),
      ...(preCombat
        ? [
            { separator: true } as ContextMenuItem,
            { heading: "Reinforcement" } as ContextMenuItem,
            {
              stepper: {
                label: "Arrives round",
                value: combatant.arrivesRound ?? 1,
                sub: combatant.arrivesRound ? "" : "on board",
                steps: [-1, 1],
                onStep: (delta: number) => setArrivesRound([combatant.id], (combatant.arrivesRound ?? 1) + delta)
              }
            } as ContextMenuItem,
            {
              label: "Start on board",
              disabled: !combatant.arrivesRound,
              onSelect: () => setArrivesRound([combatant.id], undefined)
            } as ContextMenuItem
          ]
        : []),
      { separator: true },
      { label: "Duplicate", onSelect: () => duplicateCombatant(combatant.id) },
      { label: "Delete", danger: true, onSelect: () => removeCombatant(combatant.id) }
    ];
  }

  return (
    <section
      ref={viewport.stageRef}
      className={`map-stage scene-stage ${replaying ? "replaying" : ""} ${viewport.isPanning ? "panning" : viewport.spacePanning ? "pan-ready" : ""}`}
      aria-label="Battlemap scene"
      {...viewport.stageProps}
    >
      {reviewing ? <div className="scene-replay-banner" aria-hidden="true">▶ Replay</div> : null}
      {playing && !reviewing ? <PlayOverlay onOpenReport={onOpenReport} move={playMove} aim={playAim} /> : null}
      <div className="scene-hud">
        <div>
          <span>Tool</span>
          <strong>{aligning ? "align grid" : tool === "wall" && pendingWallStart ? "wall endpoint" : tool}</strong>
        </div>
        <div>
          <span>Scene</span>
          <strong>{Math.round(metrics.scenePixelWidth)} x {Math.round(metrics.scenePixelHeight)}</strong>
        </div>
        <div>
          <span>Cell</span>
          <strong>{metrics.cellSize}px</strong>
        </div>
      </div>
      <div className="viewport-controls" aria-label="Viewport controls">
        <button type="button" onClick={() => viewport.zoomBy(1.15)} title="Zoom in"><ZoomIn size={16} /></button>
        <button type="button" onClick={() => viewport.zoomBy(1 / 1.15)} title="Zoom out"><ZoomOut size={16} /></button>
        <button type="button" onClick={() => viewport.fitToView(frame)} title="Fit the map to the view"><Crosshair size={16} /></button>
      </div>
      <div
        className={`battlemap-frame ${viewport.interacting ? "interacting" : ""}`}
        style={{
          width: metrics.framePixelWidth,
          height: metrics.framePixelHeight,
          transform: viewport.transform
        }}
      >
      <div
        className={`battlemap scene-canvas ${tool === "select" && !replaying ? "tool-select" : ""} ${tool === "elevation" && !replaying ? "tool-elevation" : ""} ${aligning ? "aligning" : ""}`}
        style={{
          width: metrics.scenePixelWidth,
          height: metrics.scenePixelHeight,
          top: metrics.paddingYPx + (alignShift?.y ?? 0),
          left: metrics.paddingXPx + (alignShift?.x ?? 0),
          // Position tween + HP-bar drain share the same beat; both are 0ms
          // outside replay so live editing is instant.
          ["--token-move-ms" as string]: `${tokenMoveMs}ms`,
          ["--hp-anim-ms" as string]: `${tokenMoveMs}ms`
        } as CSSProperties}
        onClick={replaying ? undefined : scene.onMapClick}
        onContextMenu={replaying ? undefined : scene.onMapContextMenu}
        onPointerDown={replaying ? undefined : scene.onMapPointerDown}
        onPointerMove={replaying ? undefined : scene.onMapPointerMove}
        onPointerLeave={replaying ? undefined : scene.onMapPointerLeave}
        onPointerUp={replaying ? undefined : scene.onMapPointerUp}
        onDragOver={replaying ? undefined : onCanvasDragOver}
        onDrop={replaying ? undefined : onCanvasDrop}
      >
        {mapImageDataUrl ? (
          <img
            className="map-image-layer"
            src={mapImageDataUrl}
            alt=""
            draggable={false}
            style={
              metrics.imageBox.pinned
                ? {
                    // The box has the image's own proportions, so `fill` neither
                    // crops nor stretches it. `maxWidth` lifts the global img cap,
                    // which would shrink a box that runs past the scene's edge.
                    left: metrics.imageBox.left,
                    top: metrics.imageBox.top,
                    width: metrics.imageBox.width,
                    height: metrics.imageBox.height,
                    maxWidth: "none",
                    objectFit: "fill",
                    opacity: metrics.imageSettings.opacity
                  }
                : {
                    width: metrics.imageBox.width,
                    height: metrics.imageBox.height,
                    opacity: metrics.imageSettings.opacity,
                    transform: `translate(${metrics.imageSettings.offsetX}px, ${metrics.imageSettings.offsetY}px) scale(${metrics.imageSettings.scale / 100})`
                  }
            }
          />
        ) : null}
        <div
          className="grid-layer"
          style={{
            width: metrics.gridPixelWidth,
            height: metrics.gridPixelHeight,
            backgroundImage: `linear-gradient(to right, ${metrics.gridLineColor} ${metrics.gridLineWidth}px, transparent ${metrics.gridLineWidth}px), linear-gradient(to bottom, ${metrics.gridLineColor} ${metrics.gridLineWidth}px, transparent ${metrics.gridLineWidth}px)`,
            backgroundSize: `${metrics.cellSize}px ${metrics.cellSize}px`,
            borderColor: metrics.gridLineColor,
            borderWidth: metrics.gridLineWidth,
            // Align grid draws its own, brighter grid.
            opacity: showGrid && !aligning ? metrics.gridLineOpacity : 0
          }}
        />
        <SceneOverlays
          scene={scene}
          map={map}
          gridPixelWidth={metrics.gridPixelWidth}
          gridPixelHeight={metrics.gridPixelHeight}
          replaying={replaying}
          showElevation={showElevation}
          areaFlashes={areaFlashes}
          activeZones={encounter.activeZones}
          round={encounter.round}
          playing={playing}
          playMove={playMove}
          playAim={playAim}
        />
        {tokenLayouts.filter((layout) => layout.altitude > 0).map(({ combatant, size, x, y }) => (
          <div
            key={`${combatant.id}-shadow`}
            className="token-shadow"
            aria-hidden="true"
            style={{ left: x + size * 0.12, top: y + size * 0.6, width: size * 0.76, height: size * 0.32 }}
          />
        ))}
        {tokenLayouts.map(({ combatant, size, x, y, dragging, dropping, visuals, inActiveZone, altitude, lift }) => {
          const tokenImage = visuals.imageUrl;
          const tokenScale = clamp(visuals.scale ?? 1, 0.5, 1.5);
          return (
            <button
              key={combatant.id}
              type="button"
              className={`token ${tokenImage ? "image-token" : ""} ${combatant.faction} ${combatant.state} ${isSurprised(combatant) ? "surprised" : ""} ${isDominated(combatant) ? "dominated" : ""} ${scene.selectedCombatantIds.includes(combatant.id) ? "selected" : ""} ${dragging ? "dragging" : ""} ${dropping ? "dropping" : ""} ${srdDropTokenId === combatant.id ? "srd-drop-target" : ""} ${inActiveZone ? "in-active-zone" : ""} ${altitude > 0 ? "airborne" : ""}`}
              style={{
                left: x,
                top: y,
                width: size,
                height: size,
                borderColor: visuals.borderColor ?? undefined,
                ...(altitude > 0 ? { ["--lift" as string]: `${lift}px` } : {})
              }}
              onDragOver={(event) => onTokenSrdDragOver(event, combatant.id)}
              onDragLeave={() => setSrdDropTokenId((current) => (current === combatant.id ? null : current))}
              onDrop={(event) => onTokenSrdDrop(event, combatant)}
              onPointerDown={replaying ? undefined : (event) => {
                if (isDoublePress(event, combatant.id)) onEditActor?.(combatant.id);
                scene.onTokenPointerDown(event, combatant.id);
              }}
              // The Select tool drives select / drag / place entirely from the
              // pointer handlers above; every other tool owns a different layer
              // (walls, terrain) and must not be able to select a token, so the
              // click itself is always inert here.
              onContextMenu={
                replaying
                  ? undefined
                  : (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      scene.openTokenMenu(combatant.id, event.clientX, event.clientY);
                    }
              }
              title={
                (isDominated(combatant)
                  ? `${combatant.displayName} · dominated`
                  : inActiveZone
                    ? `${combatant.displayName} · in zone`
                    : combatant.displayName) + (altitude > 0 ? ` · ${altitude} ft up` : "")
              }
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
              {altitude > 0 ? <span className="token-altitude" aria-label={`${altitude} feet up`}>↑{altitude}</span> : null}
              {visuals.showNameplate ? <span className="token-nameplate">{combatant.displayName}</span> : null}
            </button>
          );
        })}

        {/* Above every token so an adjacent token never covers a bar. */}
        {showHealthBars ? (
          <div className="token-overlay-layer" aria-hidden="true">
            {tokenLayouts.map(({ combatant, definition, size, x, y, hpOut, dropping }) => (
              <TokenHealthBar
                key={combatant.id}
                current={combatant.currentHp}
                max={definition.maxHp}
                temp={combatant.tempHp ?? 0}
                out={hpOut}
                x={x}
                y={y}
                size={size}
                dropping={dropping}
              />
            ))}
          </div>
        ) : null}

        {/* A move being planned, or an ability being aimed: marks and labels above the tokens and their bars. */}
        {playMove || playAim ? (
          <svg
            className="overlay play-move-marks"
            viewBox={`0 0 ${map.grid.width} ${map.grid.height}`}
            style={{ width: metrics.gridPixelWidth, height: metrics.gridPixelHeight }}
          >
            {playMove ? <PlayMoveMarks view={playMove} /> : null}
            {playAim ? <PlayAimMarks view={playAim} /> : null}
          </svg>
        ) : null}
        {playAim ? <PlayAimTooltip view={playAim} cellSize={cellSize} /> : null}

        <SceneFeedbackLayer floaties={floaties} cellSize={cellSize} />

        {aligning ? (
          <GridAlignLayer
            draft={aligning}
            cellSize={cellSize}
            gridPixelWidth={metrics.gridPixelWidth}
            gridPixelHeight={metrics.gridPixelHeight}
            panning={viewport.spacePanning || viewport.isPanning}
          />
        ) : null}
      </div>
      </div>

      {aligning ? (
        <GridAlignPanel draft={aligning} />
      ) : tool === "elevation" && !replaying ? (
        <ElevationPalette />
      ) : showElevation ? (
        <ElevationLegendCorner />
      ) : null}

      {scene.wallMenu && !replaying ? (
        <ContextMenu
          x={scene.wallMenu.x}
          y={scene.wallMenu.y}
          items={wallMenuItems()}
          onClose={scene.closeWallMenu}
        />
      ) : null}

      {scene.tokenMenu && !replaying ? (
        <ContextMenu
          x={scene.tokenMenu.x}
          y={scene.tokenMenu.y}
          items={tokenMenuItems(scene.tokenMenu.combatantId)}
          onClose={scene.closeTokenMenu}
        />
      ) : null}

      {scene.doorMenu && playing && !replaying ? (
        <ContextMenu
          x={scene.doorMenu.x}
          y={scene.doorMenu.y}
          items={doorMenuItems(scene.doorMenu.wallId)}
          onClose={scene.closeDoorMenu}
        />
      ) : null}

      {scene.terrainMenu && !replaying ? (
        <ContextMenu
          x={scene.terrainMenu.x}
          y={scene.terrainMenu.y}
          items={terrainMenuItems()}
          onClose={scene.closeTerrainMenu}
        />
      ) : null}
    </section>
  );
}

/** With no elevation tool open, a small legend still explains the tinted cells and heavy lines on the map. */
function ElevationLegendCorner() {
  return (
    <div className="elevation-legend-corner">
      <ElevationLegend compact />
    </div>
  );
}
