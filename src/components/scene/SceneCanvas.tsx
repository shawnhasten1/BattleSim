"use client";

import { Crosshair, ZoomIn, ZoomOut } from "lucide-react";
import { type CSSProperties, type DragEvent, useMemo } from "react";
import { getDefinition, sizeFootprint, type CombatantState, type CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { useDisplayEncounter, useIsReplaying } from "@/hooks/useDisplayEncounter";
import { useSceneFeedback } from "@/hooks/useSceneFeedback";
import { clamp } from "@/components/scene/coords";
import { deriveSceneMetrics } from "@/components/scene/metrics";
import { SceneOverlays } from "@/components/scene/SceneOverlays";
import { TokenHealthBar } from "@/components/scene/TokenHealthBar";
import { SceneFeedbackLayer } from "@/components/scene/SceneFeedbackLayer";
import type { SceneInteraction } from "@/hooks/useSceneInteraction";
import type { UseViewportResult } from "@/hooks/useViewport";

interface SceneCanvasProps {
  viewport: UseViewportResult;
  scene: SceneInteraction;
  showGrid: boolean;
  showHealthBars: boolean;
  onCanvasDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onCanvasDrop: (event: DragEvent<HTMLDivElement>) => void;
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
export function SceneCanvas({ viewport, scene, showGrid, showHealthBars, onCanvasDragOver, onCanvasDrop }: SceneCanvasProps) {
  const map = useEncounterStore((state) => state.encounter.map);
  const replaySpeed = useEncounterStore((state) => state.replaySpeed);
  const mapImageDataUrl = useEncounterStore((state) => state.mapImageDataUrl);
  const selectCombatant = useEncounterStore((state) => state.selectCombatant);
  const removeCombatant = useEncounterStore((state) => state.removeCombatant);
  const encounter = useDisplayEncounter();
  const replaying = useIsReplaying();
  const { floaties, areaFlashes } = useSceneFeedback(encounter);

  const metrics = useMemo(() => deriveSceneMetrics(map), [map]);
  const cellSize = metrics.cellSize;
  const { tool, pendingWallStart } = scene;
  // Tokens tween between cells only while replay is scrubbing/playing; editing
  // stays instant. Faster playback → snappier tween.
  const tokenMoveMs = replaying ? Math.round(clamp(620 / Math.max(0.1, replaySpeed), 90, 900)) : 0;

  // One pass over the roster: everything the token, its HP bar, and any future
  // per-token overlay need, so the tokens and the overlay layer stay in sync.
  const tokenLayouts = useMemo(
    () =>
      encounter.combatants.map((combatant) => {
        const definition = getDefinition(encounter, combatant);
        const footprint = sizeFootprint(definition.size);
        return {
          combatant,
          definition,
          size: footprint * cellSize,
          x: combatant.position.x * cellSize,
          y: combatant.position.y * cellSize,
          visuals: tokenVisualsFor(definition, combatant),
          hpOut: combatant.currentHp <= 0 || combatant.state !== "active"
        };
      }),
    [encounter, cellSize]
  );

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
        className="battlemap scene-canvas"
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
        />
        {tokenLayouts.map(({ combatant, size, x, y, visuals }) => {
          const tokenImage = visuals.imageUrl;
          const tokenScale = clamp(visuals.scale ?? 1, 0.5, 1.5);
          return (
            <button
              key={combatant.id}
              type="button"
              className={`token ${tokenImage ? "image-token" : ""} ${combatant.faction} ${combatant.state} ${combatant.id === scene.selectedCombatant?.id ? "selected" : ""}`}
              style={{
                left: x,
                top: y,
                width: size,
                height: size,
                borderColor: visuals.borderColor ?? undefined
              }}
              onClick={() => (tool === "delete" && !replaying ? removeCombatant(combatant.id) : selectCombatant(combatant.id))}
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

        {/* Above every token so an adjacent token never covers a bar. */}
        {showHealthBars ? (
          <div className="token-overlay-layer" aria-hidden="true">
            {tokenLayouts.map(({ combatant, definition, size, x, y, hpOut }) => (
              <TokenHealthBar
                key={combatant.id}
                current={combatant.currentHp}
                max={definition.maxHp}
                out={hpOut}
                x={x}
                y={y}
                size={size}
              />
            ))}
          </div>
        ) : null}

        <SceneFeedbackLayer floaties={floaties} cellSize={cellSize} />
      </div>
    </section>
  );
}
