"use client";

import { cellsInArea, lineOfEffect, wallCover, type BattleMapState } from "@/engine";
import { pointsMatch } from "@/components/scene/coords";
import type { SceneInteraction } from "@/hooks/useSceneInteraction";
import type { ActiveAreaFlash } from "@/hooks/useSceneFeedback";

interface SceneOverlaysProps {
  scene: SceneInteraction;
  map: BattleMapState;
  gridPixelWidth: number;
  gridPixelHeight: number;
  /** During replay only the persistent geometry (terrain/walls/templates) is drawn — the
   * editing gizmos (movement preview, target line, measure/sight) are suppressed. */
  replaying?: boolean;
  /** Transient AoE-shape flashes from `useSceneFeedback` (replay / Step playback). */
  areaFlashes?: ActiveAreaFlash[];
}

/**
 * The SVG overlay layer drawn in grid units on top of the battlemap: terrain
 * polygons, movement + measured paths, placed and draft templates, walls, wall
 * preview/cursor/nodes, the nearest-enemy line-of-effect line, and the sight /
 * measure gizmos. Ported verbatim from the old inline canvas markup.
 */
export function SceneOverlays({ scene, map, gridPixelWidth, gridPixelHeight, replaying = false, areaFlashes = [] }: SceneOverlaysProps) {
  const {
    tool,
    pendingWallStart,
    selectedCombatant,
    nearestEnemy,
    selectedWallIds,
    selectedWallNodes,
    selectedTerrainId,
    selectedTemplateId,
    selectWall,
    clearWallSelection,
    setSelectedTerrainId,
    setSelectedTemplateId,
    selectedTemplate,
    displayWalls,
    openWallMenu,
    openNodeMenu,
    wallNodes,
    draggingWallNode,
    wallDragPoint,
    wallCursorPoint,
    templateDraft,
    templatePreviewCells,
    measureStart,
    measureEnd,
    sightStart,
    sightEnd,
    measuredDistance,
    measuredPath,
    measuredPathCostFeet,
    sightResult,
    previewPath,
    onWallNodePointerDown,
    onTemplatePointerDown
  } = scene;

  return (
    <svg
      className="overlay"
      viewBox={`0 0 ${map.grid.width} ${map.grid.height}`}
      style={{ width: gridPixelWidth, height: gridPixelHeight }}
    >
      {map.terrain.map((zone) => (
        <polygon
          key={zone.id}
          points={zone.polygon.map((point) => `${point.x},${point.y}`).join(" ")}
          className={`terrain ${zone.type} ${zone.id === selectedTerrainId ? "selected" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            setSelectedTerrainId(zone.id);
            clearWallSelection();
            setSelectedTemplateId(null);
          }}
        />
      ))}
      {areaFlashes.map((flash) => (
        <g key={flash.id} className={`area-flash ${flash.damageType ? `dmg-${flash.damageType}` : "dmg-generic"}`}>
          {flash.cells.map((cell) => (
            <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width="1" height="1" />
          ))}
        </g>
      ))}
      {!replaying && previewPath?.cells.map((cell, index) => (
        <rect key={`${cell.x}-${cell.y}-${index}`} x={cell.x + 0.16} y={cell.y + 0.16} width="0.68" height="0.68" className="path-cell" />
      ))}
      {!replaying && measuredPath?.cells.map((cell, index) => (
        <rect
          key={`measure-path-${cell.x}-${cell.y}-${index}`}
          x={cell.x + 0.08}
          y={cell.y + 0.08}
          width="0.84"
          height="0.84"
          className={measuredPath.reachable ? "measured-path-cell" : "measured-path-cell blocked"}
        />
      ))}
      {(map.templates ?? []).map((template) => (
        <g key={template.id} className={`placed-template ${template.id === selectedTemplateId ? "selected" : ""}`}>
          {cellsInArea(map, template.origin, template.area).map((cell) => (
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
                clearWallSelection();
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
        <g key={wall.id}>
          {/* Invisible fat stroke so thin low/marker walls are actually clickable. */}
          <line
            x1={wall.start.x}
            y1={wall.start.y}
            x2={wall.end.x}
            y2={wall.end.y}
            className="wall-hit"
            onClick={(event) => {
              event.stopPropagation();
              selectWall(wall.id, event.shiftKey);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openWallMenu(wall.id, event.clientX, event.clientY);
            }}
          />
          <line
            x1={wall.start.x}
            y1={wall.start.y}
            x2={wall.end.x}
            y2={wall.end.y}
            className={`wall-line cover-${wallCover(wall)} ${selectedWallIds.includes(wall.id) ? "selected" : ""}`}
          />
        </g>
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
      {!replaying && wallNodes.map((node) => {
        const nodeSelected =
          selectedWallNodes.some((selected) => pointsMatch(selected, node)) ||
          (draggingWallNode && wallDragPoint != null && pointsMatch(wallDragPoint, node));
        return (
          <circle
            key={`${node.x}-${node.y}`}
            cx={node.x}
            cy={node.y}
            r="0.11"
            className={`wall-node ${nodeSelected ? "selected" : ""}`}
            onPointerDown={(event) => onWallNodePointerDown(event, node)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openNodeMenu(node, event.clientX, event.clientY);
            }}
          />
        );
      })}
      {!replaying && selectedCombatant && nearestEnemy ? (
        <line
          x1={selectedCombatant.position.x + 0.5}
          y1={selectedCombatant.position.y + 0.5}
          x2={nearestEnemy.position.x + 0.5}
          y2={nearestEnemy.position.y + 0.5}
          className={lineOfEffect(map, selectedCombatant.position, nearestEnemy.position) ? "target-line clear" : "target-line blocked"}
        />
      ) : null}
      {!replaying && sightStart && sightEnd ? (
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
            {sightResult
              ? `${sightResult.distance} ft ${sightResult.sight ? "LOS" : "no LOS"} ${sightResult.effect ? "LOE" : "no LOE"}${sightResult.cover !== "none" ? ` · ${sightResult.cover === "three-quarters" ? "¾" : sightResult.cover} cover` : ""}`
              : ""}
          </text>
        </g>
      ) : null}
      {!replaying && measureStart && measureEnd ? (
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
          <text x={(measureStart.x + measureEnd.x) / 2 + 0.5} y={(measureStart.y + measureEnd.y) / 2 + 0.3} className="measure-label">
            {measuredDistance} ft {measuredPath?.reachable ? `/ ${measuredPathCostFeet} ft path` : "/ blocked"}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
