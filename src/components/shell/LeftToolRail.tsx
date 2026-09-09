"use client";

import { Blocks, BrickWall, Eraser, Fence, Grid3x3, HeartPulse, MousePointer2, Move, Ruler, Shapes, SquareDashed, Target, Waypoints } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type { CoverLevel } from "@/engine";
import { useEncounterStore, type EditorTool } from "@/store/encounter-store";
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

const CORE_TOOLS: ToolDef[] = [
  { tool: "select", icon: <MousePointer2 size={18} />, label: "Select" },
  { tool: "move", icon: <Move size={18} />, label: "Move token" },
  { tool: "measure", icon: <Ruler size={18} />, label: "Measure" },
  { tool: "wall", icon: <BrickWall size={18} />, label: "Draw walls" }
];

const SIM_TOOLS: ToolDef[] = [
  { tool: "sight", icon: <Target size={18} />, label: "Line of sight / effect" },
  { tool: "template", icon: <Shapes size={18} />, label: "Area template" },
  { tool: "terrain", icon: <Waypoints size={18} />, label: "Terrain" },
  { tool: "delete", icon: <Eraser size={18} />, label: "Erase" }
];

/** Cover level for newly drawn walls — the sub-group shown under "Draw walls". */
const WALL_TYPES: Array<{ cover: CoverLevel; icon: ReactNode; label: string }> = [
  { cover: "total", icon: <BrickWall size={15} />, label: "Solid wall — total cover, blocks movement & sight" },
  { cover: "three-quarters", icon: <Blocks size={15} />, label: "High wall — three-quarters cover (+5 AC)" },
  { cover: "half", icon: <Fence size={15} />, label: "Low wall — half cover (+2 AC), shoot & see over" },
  { cover: "none", icon: <SquareDashed size={15} />, label: "Marker — no cover, blocks nothing" }
];

/**
 * Left tool rail. Core tools on top, simulation-specific tools below a divider,
 * then the view toggles (grid, health bars). Reads/writes the active tool from
 * the store; the toggles are view preferences owned by the page. While the wall
 * tool is active, an indented sub-group picks the cover level for new walls.
 */
export function LeftToolRail({ showGrid, onToggleGrid, showHealthBars, onToggleHealthBars }: LeftToolRailProps) {
  const tool = useEncounterStore((state) => state.tool);
  const setTool = useEncounterStore((state) => state.setTool);
  const pendingWallStart = useEncounterStore((state) => state.pendingWallStart);
  const wallCoverDraft = useEncounterStore((state) => state.wallCoverDraft);
  const setWallCoverDraft = useEncounterStore((state) => state.setWallCoverDraft);

  return (
    <div className={styles.rail} aria-label="Scene tools">
      {CORE_TOOLS.map((entry) => (
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
        </Fragment>
      ))}

      <div className={styles.divider} />

      {SIM_TOOLS.map((entry) => (
        <RailButton
          key={entry.tool}
          icon={entry.icon}
          label={entry.label}
          active={tool === entry.tool}
          onClick={() => setTool(entry.tool)}
        />
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
