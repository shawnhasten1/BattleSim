"use client";

import { Ban, Blocks, BrickWall, Droplet, Eraser, Fence, Flame, Footprints, Grid3x3, HeartPulse, Mountain, Ruler, Snowflake, SquareDashed, User, Waypoints } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type { CoverLevel } from "@/engine";
import { useEncounterStore, type EditorTool, type TerrainBrushId } from "@/store/encounter-store";
import styles from "./LeftToolRail.module.css";

interface LeftToolRailProps {
  showGrid: boolean;
  onToggleGrid: () => void;
  showHealthBars: boolean;
  onToggleHealthBars: () => void;
}

interface ToolDef {
  tool: EditorTool;
  icon: ReactNode;
  label: string;
}

const TOOLS: ToolDef[] = [
  { tool: "select", icon: <User size={18} />, label: "Select / move actors" },
  { tool: "measure", icon: <Ruler size={18} />, label: "Measure" },
  { tool: "wall", icon: <BrickWall size={18} />, label: "Walls — select, move, draw" },
  { tool: "terrain", icon: <Waypoints size={18} />, label: "Terrain" }
];

/** Cover level for newly drawn walls — the sub-group shown under "Draw walls". */
const WALL_TYPES: Array<{ cover: CoverLevel; icon: ReactNode; label: string }> = [
  { cover: "total", icon: <BrickWall size={15} />, label: "Solid wall — total cover, blocks movement & sight" },
  { cover: "three-quarters", icon: <Blocks size={15} />, label: "High wall — three-quarters cover (+5 AC)" },
  { cover: "half", icon: <Fence size={15} />, label: "Low wall — half cover (+2 AC), shoot & see over" },
  { cover: "none", icon: <SquareDashed size={15} />, label: "Marker — no cover, blocks nothing" }
];

/** Paint-brush preset for the terrain tool — the sub-group shown under "Terrain". */
const TERRAIN_BRUSHES: Array<{ brush: TerrainBrushId; icon: ReactNode; label: string }> = [
  { brush: "difficult", icon: <Footprints size={15} />, label: "Difficult terrain — half speed (×2 move cost)" },
  { brush: "greaterDifficult", icon: <Mountain size={15} />, label: "Greater difficult terrain — quarter speed (×4 move cost)" },
  { brush: "impassable", icon: <Ban size={15} />, label: "Impassable — blocks movement entirely" },
  { brush: "acid", icon: <Droplet size={15} />, label: "Acid — DC 12 Dex save, 2d6 acid damage (half on save)" },
  { brush: "lava", icon: <Flame size={15} />, label: "Lava — 4d10 fire damage, no save" },
  { brush: "ice", icon: <Snowflake size={15} />, label: "Ice — DC 10 Dex save or fall prone, no damage" },
  { brush: "eraser", icon: <Eraser size={15} />, label: "Eraser — clear painted terrain" }
];

/**
 * Left tool rail. Each tool owns its own layer of the scene — Select only
 * touches actor tokens, Wall only touches walls, Terrain only touches terrain
 * zones — mirroring Foundry's separate layers. Reads/writes the active tool
 * from the store; the grid/health-bar toggles below are view preferences owned
 * by the page. While the wall tool is active, an indented sub-group picks the
 * cover level for new walls; while the terrain tool is active, a sub-group
 * picks the paint-brush preset for the click-and-drag terrain tile brush.
 */
export function LeftToolRail({ showGrid, onToggleGrid, showHealthBars, onToggleHealthBars }: LeftToolRailProps) {
  const tool = useEncounterStore((state) => state.tool);
  const setTool = useEncounterStore((state) => state.setTool);
  const pendingWallStart = useEncounterStore((state) => state.pendingWallStart);
  const wallCoverDraft = useEncounterStore((state) => state.wallCoverDraft);
  const setWallCoverDraft = useEncounterStore((state) => state.setWallCoverDraft);
  const terrainBrush = useEncounterStore((state) => state.terrainBrush);
  const setTerrainBrush = useEncounterStore((state) => state.setTerrainBrush);

  return (
    <div className={styles.rail} aria-label="Scene tools">
      {TOOLS.map((entry) => (
        <Fragment key={entry.tool}>
          <RailButton
            icon={entry.icon}
            label={entry.tool === "wall" && pendingWallStart ? "Finish wall (Enter or right-click)" : entry.label}
            active={tool === entry.tool}
            onClick={() => setTool(entry.tool)}
          />
          {entry.tool === "wall" && tool === "wall" ? (
            <div className={styles.subGroup} role="group" aria-label="Wall type">
              {WALL_TYPES.map((wallType) => (
                <RailButton
                  key={wallType.cover}
                  icon={wallType.icon}
                  label={wallType.label}
                  active={wallCoverDraft === wallType.cover}
                  small
                  onClick={() => setWallCoverDraft(wallType.cover)}
                />
              ))}
            </div>
          ) : null}
          {entry.tool === "terrain" && tool === "terrain" ? (
            <div className={styles.subGroup} role="group" aria-label="Terrain brush">
              {TERRAIN_BRUSHES.map((terrainType) => (
                <RailButton
                  key={terrainType.brush}
                  icon={terrainType.icon}
                  label={terrainType.label}
                  active={terrainBrush === terrainType.brush}
                  small
                  onClick={() => setTerrainBrush(terrainType.brush)}
                />
              ))}
            </div>
          ) : null}
        </Fragment>
      ))}

      <div className={styles.divider} />

      <RailButton
        icon={<Grid3x3 size={18} />}
        label={showGrid ? "Hide grid" : "Show grid"}
        active={showGrid}
        onClick={onToggleGrid}
      />

      <RailButton
        icon={<HeartPulse size={18} />}
        label={showHealthBars ? "Hide health bars" : "Show health bars"}
        active={showHealthBars}
        onClick={onToggleHealthBars}
      />
    </div>
  );
}

function RailButton({
  icon,
  label,
  active,
  onClick,
  small = false
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      className={[styles.tool, small ? styles.small : "", active ? styles.active : ""].filter(Boolean).join(" ")}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {icon}
    </button>
  );
}
