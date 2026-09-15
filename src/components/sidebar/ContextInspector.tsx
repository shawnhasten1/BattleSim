"use client";

import { Trash2 } from "lucide-react";
import { type AreaTemplate, type CoverLevel, type PlacedTemplate, type TerrainType } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { clamp } from "@/components/scene/coords";
import type { SceneInteraction } from "@/hooks/useSceneInteraction";
import styles from "./ContextInspector.module.css";

const TERRAIN_TYPES: TerrainType[] = ["normal", "difficult", "impassable", "hazard", "cover", "elevation", "custom"];
const TEMPLATE_TYPES: AreaTemplate["type"][] = ["circle", "cone", "line", "square"];
const TEMPLATE_DIRECTIONS: NonNullable<AreaTemplate["direction"]>[] = ["north", "east", "south", "west"];
const COVER_LEVELS: Array<{ value: CoverLevel; label: string }> = [
  { value: "total", label: "Total — solid wall" },
  { value: "three-quarters", label: "Three-quarters — +5 AC" },
  { value: "half", label: "Half — +2 AC" },
  { value: "none", label: "None — marker only" }
];

interface ContextInspectorProps {
  scene: SceneInteraction;
}

/**
 * Contextual editors for whatever scene object is selected on the canvas: a
 * wall node, a wall, a terrain zone, or a template. Renders nothing until
 * something is selected.
 */
export function ContextInspector({ scene }: ContextInspectorProps) {
  const grid = useEncounterStore((state) => state.encounter.map.grid);
  const walls = useEncounterStore((state) => state.encounter.map.walls);
  const moveWallNode = useEncounterStore((state) => state.moveWallNode);
  const deleteWallNode = useEncounterStore((state) => state.deleteWallNode);
  const deleteWallNodes = useEncounterStore((state) => state.deleteWallNodes);
  const updateWall = useEncounterStore((state) => state.updateWall);
  const updateWalls = useEncounterStore((state) => state.updateWalls);
  const removeWall = useEncounterStore((state) => state.removeWall);
  const removeWalls = useEncounterStore((state) => state.removeWalls);
  const toggleDoorState = useEncounterStore((state) => state.toggleDoorState);
  const updateTerrain = useEncounterStore((state) => state.updateTerrain);
  const removeTerrain = useEncounterStore((state) => state.removeTerrain);
  const updateTemplate = useEncounterStore((state) => state.updateTemplate);
  const removeTemplate = useEncounterStore((state) => state.removeTemplate);

  const {
    selectedWallNode,
    setSelectedWallNode,
    setWallDragPoint,
    setDraggingWallNode,
    selectedWall,
    selectedWallIds,
    selectedWallNodes,
    selectedWallCount,
    selectedWallNodeCount,
    clearWallSelection,
    setSelectedWallId,
    selectedTerrain,
    setSelectedTerrainId,
    selectedTemplate,
    setSelectedTemplateId
  } = scene;

  const multiWalls = selectedWallCount > 1 ? walls.filter((wall) => selectedWallIds.includes(wall.id)) : [];
  const commonCover: CoverLevel | "" = multiWalls.length > 0
    && multiWalls.every((wall) => (wall.cover ?? "none") === (multiWalls[0].cover ?? "none"))
    ? (multiWalls[0].cover ?? "none")
    : "";

  const patchTemplate = (patch: Partial<Omit<PlacedTemplate, "id">>) => {
    if (selectedTemplate) {
      updateTemplate(selectedTemplate.id, patch);
    }
  };

  return (
    <div className={styles.inspector}>
      {selectedWallNodeCount > 1 ? (
        <section className={styles.block}>
          <header>
            <h4>Nodes ({selectedWallNodeCount} selected)</h4>
            <button
              type="button"
              className={styles.danger}
              title="Delete selected nodes"
              onClick={() => {
                deleteWallNodes(selectedWallNodes);
                clearWallSelection();
              }}
            >
              <Trash2 size={14} />
            </button>
          </header>
          <p className={styles.hint}>Deletes every wall touching a selected node.</p>
        </section>
      ) : null}

      {selectedWallCount > 1 ? (
        <section className={styles.block}>
          <header>
            <h4>Walls ({selectedWallCount} selected)</h4>
            <button
              type="button"
              className={styles.danger}
              title="Delete selected walls"
              onClick={() => {
                removeWalls(selectedWallIds);
                clearWallSelection();
              }}
            >
              <Trash2 size={14} />
            </button>
          </header>
          <div className={styles.stack}>
            <label>
              Cover
              <select
                value={commonCover}
                aria-label="Cover level for selected walls"
                onChange={(event) => updateWalls(selectedWallIds, { cover: event.target.value as CoverLevel })}
              >
                {commonCover === "" ? <option value="" disabled>Mixed</option> : null}
                {COVER_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>{level.label}</option>
                ))}
              </select>
            </label>
          </div>
        </section>
      ) : null}

      {selectedWallNodeCount === 1 && selectedWallNode ? (
        <section className={styles.block}>
          <header>
            <h4>Selected node</h4>
            <button
              type="button"
              className={styles.danger}
              title="Delete node"
              onClick={() => {
                deleteWallNode(selectedWallNode);
                setSelectedWallNode(null);
                setWallDragPoint(null);
                setDraggingWallNode(false);
              }}
            >
              <Trash2 size={14} />
            </button>
          </header>
          <div className={styles.grid2}>
            <label>
              X
              <input
                type="number"
                value={selectedWallNode.x}
                min={0}
                max={grid.width}
                step={0.5}
                onChange={(event) => {
                  const next = { ...selectedWallNode, x: clamp(Number(event.target.value), 0, grid.width) };
                  moveWallNode(selectedWallNode, next);
                  setSelectedWallNode(next);
                }}
              />
            </label>
            <label>
              Y
              <input
                type="number"
                value={selectedWallNode.y}
                min={0}
                max={grid.height}
                step={0.5}
                onChange={(event) => {
                  const next = { ...selectedWallNode, y: clamp(Number(event.target.value), 0, grid.height) };
                  moveWallNode(selectedWallNode, next);
                  setSelectedWallNode(next);
                }}
              />
            </label>
          </div>
        </section>
      ) : null}

      {selectedWall ? (
        <section className={styles.block}>
          <header>
            <h4>Wall</h4>
            <button
              type="button"
              className={styles.danger}
              title="Remove wall"
              onClick={() => {
                removeWall(selectedWall.id);
                setSelectedWallId(null);
              }}
            >
              <Trash2 size={14} />
            </button>
          </header>
          <div className={styles.stack}>
            <label>
              Cover
              <select
                value={selectedWall.cover ?? (selectedWall.blocksProjectiles ? "total" : "none")}
                aria-label="Wall cover level"
                onChange={(event) => updateWall(selectedWall.id, { cover: event.target.value as CoverLevel })}
              >
                {COVER_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>{level.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.checks}>
            <label>
              <input
                type="checkbox"
                checked={selectedWall.blocksMovement}
                onChange={(event) => updateWall(selectedWall.id, { blocksMovement: event.target.checked })}
              />
              Blocks movement
            </label>
            <label>
              <input
                type="checkbox"
                checked={selectedWall.blocksSight}
                onChange={(event) => updateWall(selectedWall.id, { blocksSight: event.target.checked })}
              />
              Blocks sight
            </label>
            <label>
              <input
                type="checkbox"
                checked={selectedWall.blocksProjectiles}
                onChange={(event) => updateWall(selectedWall.id, { blocksProjectiles: event.target.checked })}
              />
              Blocks projectiles
            </label>
          </div>
          <div className={styles.grid2}>
            <select
              value={selectedWall.doorState ?? "closed"}
              aria-label="Door state"
              onChange={(event) =>
                updateWall(selectedWall.id, {
                  doorState: event.target.value as NonNullable<typeof selectedWall.doorState>
                })
              }
            >
              <option value="closed">Closed wall</option>
              <option value="open">Open door</option>
              <option value="locked">Locked door</option>
              <option value="destroyed">Destroyed</option>
            </select>
            <button type="button" onClick={() => toggleDoorState(selectedWall.id)}>Toggle door</button>
          </div>
        </section>
      ) : null}

      {selectedTerrain ? (
        <section className={styles.block}>
          <header>
            <h4>Terrain</h4>
            <button
              type="button"
              className={styles.danger}
              title="Remove terrain"
              onClick={() => {
                removeTerrain(selectedTerrain.id);
                setSelectedTerrainId(null);
              }}
            >
              <Trash2 size={14} />
            </button>
          </header>
          <div className={styles.stack}>
            <input
              value={selectedTerrain.name}
              aria-label="Terrain name"
              onChange={(event) => updateTerrain(selectedTerrain.id, { name: event.target.value })}
            />
            <select
              value={selectedTerrain.type}
              aria-label="Terrain type"
              onChange={(event) => updateTerrain(selectedTerrain.id, { type: event.target.value as TerrainType })}
            >
              {TERRAIN_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <label>
              Movement ×
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={selectedTerrain.movementMultiplier ?? (selectedTerrain.type === "difficult" ? 2 : 1)}
                onChange={(event) => updateTerrain(selectedTerrain.id, { movementMultiplier: Number(event.target.value) })}
              />
            </label>
          </div>
        </section>
      ) : null}

      {selectedTemplate ? (
        <section className={styles.block}>
          <header>
            <h4>Template</h4>
            <button
              type="button"
              className={styles.danger}
              title="Remove template"
              onClick={() => {
                removeTemplate(selectedTemplate.id);
                setSelectedTemplateId(null);
              }}
            >
              <Trash2 size={14} />
            </button>
          </header>
          <div className={styles.stack}>
            <input
              value={selectedTemplate.name}
              aria-label="Template name"
              onChange={(event) => patchTemplate({ name: event.target.value })}
            />
            <div className={styles.grid2}>
              <select
                value={selectedTemplate.area.type}
                aria-label="Template shape"
                onChange={(event) => patchTemplate({ area: { ...selectedTemplate.area, type: event.target.value as AreaTemplate["type"] } })}
              >
                {TEMPLATE_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <select
                value={selectedTemplate.area.direction ?? "east"}
                aria-label="Template direction"
                onChange={(event) =>
                  patchTemplate({ area: { ...selectedTemplate.area, direction: event.target.value as NonNullable<AreaTemplate["direction"]> } })
                }
              >
                {TEMPLATE_DIRECTIONS.map((direction) => (
                  <option key={direction} value={direction}>{direction}</option>
                ))}
              </select>
            </div>
            <div className={styles.grid2}>
              <label>
                Size ft
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={selectedTemplate.area.size}
                  onChange={(event) => patchTemplate({ area: { ...selectedTemplate.area, size: Number(event.target.value) } })}
                />
              </label>
              <label>
                Width ft
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={selectedTemplate.area.width ?? 5}
                  onChange={(event) => patchTemplate({ area: { ...selectedTemplate.area, width: Number(event.target.value) } })}
                />
              </label>
            </div>
            <div className={styles.grid2}>
              <label>
                Origin X
                <input
                  type="number"
                  value={selectedTemplate.origin.x}
                  onChange={(event) =>
                    patchTemplate({ origin: { ...selectedTemplate.origin, x: clamp(Number(event.target.value), 0, grid.width - 1) } })
                  }
                />
              </label>
              <label>
                Origin Y
                <input
                  type="number"
                  value={selectedTemplate.origin.y}
                  onChange={(event) =>
                    patchTemplate({ origin: { ...selectedTemplate.origin, y: clamp(Number(event.target.value), 0, grid.height - 1) } })
                  }
                />
              </label>
            </div>
            <label className={styles.colorRow}>
              Color
              <input
                type="color"
                value={selectedTemplate.color ?? "#287277"}
                onChange={(event) => patchTemplate({ color: event.target.value })}
              />
            </label>
          </div>
        </section>
      ) : null}
    </div>
  );
}
