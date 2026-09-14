"use client";

import { Crosshair, ZoomIn, ZoomOut } from "lucide-react";
import { type CSSProperties, type DragEvent, useMemo, useState } from "react";
import { cellIntersectsArea, getDefinition, sizeFootprint, wallCover, type CombatantState, type CoverLevel, type CreatureDefinition, type WallSegment } from "@/engine";
import { isSurprised, useEncounterStore } from "@/store/encounter-store";
import { parseSrdDragPayload, SRD_DRAG_MIME } from "@/data/srd";
import { useDisplayEncounter, useIsReplaying } from "@/hooks/useDisplayEncounter";
import { useReplayPathWalk } from "@/hooks/useReplayPathWalk";
import { useSceneFeedback } from "@/hooks/useSceneFeedback";
import { clamp, pointsMatch } from "@/components/scene/coords";
import { deriveSceneMetrics } from "@/components/scene/metrics";
import { SceneOverlays } from "@/components/scene/SceneOverlays";
import { TokenHealthBar } from "@/components/scene/TokenHealthBar";
import { SceneFeedbackLayer } from "@/components/scene/SceneFeedbackLayer";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import type { SceneInteraction } from "@/hooks/useSceneInteraction";
import type { UseViewportResult } from "@/hooks/useViewport";

const WALL_COVER_ITEMS: Array<{ cover: CoverLevel; label: string }> = [
  { cover: "total", label: "Solid wall" },
  { cover: "three-quarters", label: "High wall — ¾ cover" },
  { cover: "half", label: "Low wall — ½ cover" },
  { cover: "none", label: "Marker — no cover" }
];

interface SceneCanvasProps {
  viewport: UseViewportResult;
  scene: SceneInteraction;
  showGrid: boolean;
  showHealthBars: boolean;
  onCanvasDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onCanvasDrop: (event: DragEvent<HTMLDivElement>) => void;
  /** Open the floating actor sheet (owned by the page). Invoked from the token context menu. */
  onEditActor?: () => void;
}

function tokenVisualsFor(definition: CreatureDefinition, combatant: CombatantState) {
  return { ...(definition.tokenVisuals ?? {}), ...(combatant.tokenVisuals ?? {}) };
}

/**
 * The pannable / zoomable scene stage: HUD readout, zoom controls, and the
 * transformed battlemap (background image, grid lines, SVG overlays, tokens,
 * and the token-overlay + feedback layers that sit above the tokens).
 * Interaction state and pointer logic live in `useSceneInteraction` /
 * `useViewport`; this component only wires them to the DOM and renders.
 */
export function SceneCanvas({ viewport, scene, showGrid, showHealthBars, onCanvasDragOver, onCanvasDrop, onEditActor }: SceneCanvasProps) {
  const map = useEncounterStore((state) => state.encounter.map);
  const replaySpeed = useEncounterStore((state) => state.replaySpeed);
  const mapImageDataUrl = useEncounterStore((state) => state.mapImageDataUrl);
  const removeCombatant = useEncounterStore((state) => state.removeCombatant);
  const removeCombatants = useEncounterStore((state) => state.removeCombatants);
  const duplicateCombatant = useEncounterStore((state) => state.duplicateCombatant);
  const updateHp = useEncounterStore((state) => state.updateHp);
  const setArrivesRound = useEncounterStore((state) => state.setArrivesRound);
  const toggleCombatantSurprised = useEncounterStore((state) => state.toggleCombatantSurprised);
  const combatRound = useEncounterStore((state) => state.encounter.round);
  const updateWalls = useEncounterStore((state) => state.updateWalls);
  const removeWalls = useEncounterStore((state) => state.removeWalls);
  const attachSrdWeapon = useEncounterStore((state) => state.attachSrdWeapon);
  const attachSrdSpell = useEncounterStore((state) => state.attachSrdSpell);
  const [srdDropTokenId, setSrdDropTokenId] = useState<string | null>(null);
  const encounter = useDisplayEncounter();
  const replaying = useIsReplaying();

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
  }
  const { floaties, areaFlashes } = useSceneFeedback(encounter);

  const metrics = useMemo(() => deriveSceneMetrics(map), [map]);
  const cellSize = metrics.cellSize;
  const { tool, pendingWallStart } = scene;
  // Tokens tween between cells only while replay is scrubbing/playing; editing
  // stays instant. Faster playback → snappier tween.
  const slideMs = replaying ? Math.round(clamp(620 / Math.max(0.1, replaySpeed), 90, 900)) : 0;
  // While playback steps onto a move, the token walks its recorded path one cell
  // at a time (each hop = `walk.hopMs`); otherwise it slides straight over `slideMs`.
  const walk = useReplayPathWalk(slideMs);
  const tokenMoveMs = walk.hopMs ?? slideMs;

  // One pass over the roster: everything the token, its HP bar, and any future
  // per-token overlay need, so the tokens and the overlay layer stay in sync.
  // A token being dragged with the Move tool renders at the live cursor pixel
  // (committed to the store only on drop) — both the token and its HP bar read
  // `x`/`y` from here, so they move together.
  const draggedToken = scene.draggedToken;
  const droppingTokenId = scene.droppingTokenId;
  const tokenLayouts = useMemo(
    () =>
      encounter.combatants.map((combatant) => {
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
          visuals: tokenVisualsFor(definition, combatant),
          hpOut: combatant.currentHp <= 0 || combatant.state !== "active",
          inActiveZone
        };
      }),
    [encounter, cellSize, draggedToken, droppingTokenId, walk.positions, map.grid.distancePerSquare]
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

  function tokenMenuItems(combatantId: string): ContextMenuItem[] {
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
          onEditActor?.();
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
      {replaying ? <div className="scene-replay-banner" aria-hidden="true">▶ Replay</div> : null}
      <div className="scene-hud">
        <div>
          <span>Tool</span>
          <strong>{tool === "wall" && pendingWallStart ? "wall endpoint" : tool}</strong>
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
        <button type="button" onClick={viewport.resetViewport} title="Reset viewport"><Crosshair size={16} /></button>
      </div>
      <div
        className={`battlemap scene-canvas ${tool === "move" && !replaying ? "tool-move" : ""}`}
        style={{
          width: metrics.scenePixelWidth,
          height: metrics.scenePixelHeight,
          transform: viewport.transform,
          // Position tween + HP-bar drain share the same beat; both are 0ms
          // outside replay so live editing is instant.
          ["--token-move-ms" as string]: `${tokenMoveMs}ms`,
          ["--hp-anim-ms" as string]: `${tokenMoveMs}ms`
        } as CSSProperties}
        onClick={replaying ? undefined : scene.onMapClick}
        onContextMenu={replaying ? undefined : scene.onMapContextMenu}
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
            style={{
              width: metrics.canvasSettings.widthPx,
              height: metrics.canvasSettings.heightPx,
              opacity: metrics.imageSettings.opacity,
              transform: `translate(${metrics.imageSettings.offsetX}px, ${metrics.imageSettings.offsetY}px) scale(${metrics.imageSettings.scale / 100})`
            }}
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
            opacity: showGrid ? metrics.gridLineOpacity : 0
          }}
        />
        <SceneOverlays
          scene={scene}
          map={map}
          gridPixelWidth={metrics.gridPixelWidth}
          gridPixelHeight={metrics.gridPixelHeight}
          replaying={replaying}
          areaFlashes={areaFlashes}
          activeZones={encounter.activeZones}
          round={encounter.round}
        />
        {tokenLayouts.map(({ combatant, size, x, y, dragging, dropping, visuals, inActiveZone }) => {
          const tokenImage = visuals.imageUrl;
          const tokenScale = clamp(visuals.scale ?? 1, 0.5, 1.5);
          return (
            <button
              key={combatant.id}
              type="button"
              className={`token ${tokenImage ? "image-token" : ""} ${combatant.faction} ${combatant.state} ${isSurprised(combatant) ? "surprised" : ""} ${scene.selectedCombatantIds.includes(combatant.id) ? "selected" : ""} ${dragging ? "dragging" : ""} ${dropping ? "dropping" : ""} ${srdDropTokenId === combatant.id ? "srd-drop-target" : ""} ${inActiveZone ? "in-active-zone" : ""}`}
              style={{
                left: x,
                top: y,
                width: size,
                height: size,
                borderColor: visuals.borderColor ?? undefined
              }}
              onDragOver={(event) => onTokenSrdDragOver(event, combatant.id)}
              onDragLeave={() => setSrdDropTokenId((current) => (current === combatant.id ? null : current))}
              onDrop={(event) => onTokenSrdDrop(event, combatant)}
              onPointerDown={replaying ? undefined : (event) => scene.onTokenPointerDown(event, combatant.id)}
              onClick={(event) => {
                if (replaying) return;
                if (tool === "delete") {
                  removeCombatant(combatant.id);
                  return;
                }
                // The Move tool drives select / drag / place from the pointer
                // handlers; its trailing click is inert here.
                if (tool === "move") return;
                scene.selectCombatantOnBoard(combatant.id, event.shiftKey);
              }}
              onContextMenu={
                replaying
                  ? undefined
                  : (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      scene.openTokenMenu(combatant.id, event.clientX, event.clientY);
                    }
              }
              title={inActiveZone ? `${combatant.displayName} · in zone` : combatant.displayName}
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

        {/* Above every token so an adjacent token never covers a bar. */}
        {showHealthBars ? (
          <div className="token-overlay-layer" aria-hidden="true">
            {tokenLayouts.map(({ combatant, definition, size, x, y, hpOut, dropping }) => (
              <TokenHealthBar
                key={combatant.id}
                current={combatant.currentHp}
                max={definition.maxHp}
                out={hpOut}
                x={x}
                y={y}
                size={size}
                dropping={dropping}
              />
            ))}
          </div>
        ) : null}

        <SceneFeedbackLayer floaties={floaties} cellSize={cellSize} />
      </div>

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
    </section>
  );
}
