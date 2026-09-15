"use client";

import { Download, ImagePlus, Layers, Settings, Trash2, Upload, X } from "lucide-react";
import { type ChangeEvent } from "react";
import { encounterSnapshotSchema } from "@/engine";
import { useEncounterStore, type EditorTool } from "@/store/encounter-store";
import type { SceneInteraction } from "@/hooks/useSceneInteraction";
import { downloadJson, safeFileName } from "@/lib/ui-helpers";
import { ContextInspector } from "./ContextInspector";
import styles from "./ScenePanel.module.css";

interface ScenePanelProps {
  scene: SceneInteraction;
  onOpenConfig: () => void;
}

function toolReadout(
  tool: EditorTool,
  measuredDistance: number | null,
  measuredPathCostFeet: number | null,
  measuredPathReachable: boolean | undefined
): string {
  if (tool === "measure" && measuredDistance !== null) {
    return measuredPathReachable
      ? `${measuredDistance} ft direct, ${measuredPathCostFeet ?? 0} ft path`
      : `${measuredDistance} ft direct, path blocked`;
  }
  if (tool === "wall") return "Click grid intersections to draw walls; drag nodes to reshape.";
  if (tool === "terrain") return "Click the canvas to add a terrain zone, then edit it here.";
  if (tool === "select") return "Click or drag a token to select and move it.";
  return "Select a scene object or token to inspect.";
}

export function ScenePanel({ scene, onOpenConfig }: ScenePanelProps) {
  const encounter = useEncounterStore((state) => state.encounter);
  const mapImageDataUrl = useEncounterStore((state) => state.mapImageDataUrl);
  const setMapImage = useEncounterStore((state) => state.setMapImage);
  const pendingWallStart = useEncounterStore((state) => state.pendingWallStart);
  const cancelWallPlacement = useEncounterStore((state) => state.cancelWallPlacement);
  const deleteLastWall = useEncounterStore((state) => state.deleteLastWall);
  const deleteLastTerrain = useEncounterStore((state) => state.deleteLastTerrain);
  const removeWall = useEncounterStore((state) => state.removeWall);
  const removeTerrain = useEncounterStore((state) => state.removeTerrain);
  const removeTemplate = useEncounterStore((state) => state.removeTemplate);
  const replaceEncounter = useEncounterStore((state) => state.replaceEncounter);

  const map = encounter.map;
  const {
    tool,
    measuredDistance,
    measuredPath,
    measuredPathCostFeet,
    templateAffectedCombatants,
    selectedTemplateId,
    setSelectedWallId,
    setSelectedTerrainId,
    setSelectedTemplateId
  } = scene;

  function onImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setMapImage(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function importEncounter(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text) as { encounter?: unknown; mapImageDataUrl?: string | null };
    replaceEncounter(encounterSnapshotSchema.parse(parsed.encounter), parsed.mapImageDataUrl ?? null);
    event.target.value = "";
  }

  function selectWall(id: string) {
    setSelectedWallId(id);
    setSelectedTerrainId(null);
    setSelectedTemplateId(null);
  }
  function selectTerrain(id: string) {
    setSelectedTerrainId(id);
    setSelectedWallId(null);
    setSelectedTemplateId(null);
  }
  function selectTemplate(id: string) {
    setSelectedTemplateId(id);
    setSelectedWallId(null);
    setSelectedTerrainId(null);
  }

  const templates = map.templates ?? [];
  const nothingDrawn = map.walls.length === 0 && map.terrain.length === 0 && templates.length === 0;

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <h4>Background</h4>
        <div className={styles.bgRow}>
          <label className={styles.upload}>
            <ImagePlus size={14} />
            {mapImageDataUrl ? "Replace image" : "Upload image"}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onImageUpload} />
          </label>
          <button type="button" onClick={onOpenConfig}>
            <Settings size={14} /> Configure
          </button>
        </div>
        <div className={styles.ioRow}>
          <label className={styles.upload}>
            <Upload size={14} /> Import JSON
            <input type="file" accept="application/json" onChange={importEncounter} />
          </label>
          <button type="button" onClick={() => downloadJson(`${safeFileName(encounter.name)}.json`, { encounter, mapImageDataUrl })}>
            <Download size={14} /> Export JSON
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h4>Drawing</h4>
        <div className={styles.toolActions}>
          <button type="button" onClick={cancelWallPlacement} disabled={!pendingWallStart}>
            <X size={13} /> Finish wall
          </button>
          <button type="button" onClick={deleteLastWall}>
            <Trash2 size={13} /> Last wall
          </button>
          <button type="button" onClick={deleteLastTerrain}>
            <Trash2 size={13} /> Last terrain
          </button>
        </div>
        <p className={styles.readout}>
          {toolReadout(tool, measuredDistance, measuredPathCostFeet, measuredPath?.reachable)}
        </p>
        <p className={styles.readoutDim}>
          {templateAffectedCombatants.length
            ? `${templateAffectedCombatants.map((c) => c.displayName).join(", ")} in template`
            : "No template targets"}
        </p>
      </section>

      <ContextInspector scene={scene} />

      <section className={styles.section}>
        <h4>
          <Layers size={13} /> Layers ({map.walls.length + map.terrain.length + templates.length})
        </h4>
        {nothingDrawn ? (
          <p className={styles.readoutDim}>Draw walls, terrain, or templates to manage them here.</p>
        ) : null}
        <ul className={styles.layers}>
          {map.walls.map((wall, index) => (
            <li key={wall.id}>
              <button type="button" onClick={() => selectWall(wall.id)}>
                <strong>Wall {index + 1}</strong>
                <span>{wall.doorState ?? "wall"}</span>
              </button>
              <button type="button" onClick={() => removeWall(wall.id)} title="Remove wall"><Trash2 size={13} /></button>
            </li>
          ))}
          {map.terrain.map((terrain, index) => (
            <li key={terrain.id}>
              <button type="button" onClick={() => selectTerrain(terrain.id)}>
                <strong>{terrain.name} {index + 1}</strong>
                <span>{terrain.type}</span>
              </button>
              <button type="button" onClick={() => removeTerrain(terrain.id)} title="Remove terrain"><Trash2 size={13} /></button>
            </li>
          ))}
          {templates.map((template, index) => (
            <li key={template.id}>
              <button type="button" onClick={() => selectTemplate(template.id)}>
                <strong>{template.name || `Template ${index + 1}`}</strong>
                <span>{template.area.type} {template.area.size} ft</span>
              </button>
              <button
                type="button"
                title="Remove template"
                onClick={() => {
                  removeTemplate(template.id);
                  if (selectedTemplateId === template.id) setSelectedTemplateId(null);
                }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
