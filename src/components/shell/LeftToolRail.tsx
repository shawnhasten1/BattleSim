"use client";

import { BrickWall, Eraser, Grid3x3, HeartPulse, MousePointer2, Move, Ruler, Shapes, Target, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
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

/**
 * Left tool rail. Core tools on top, simulation-specific tools below a divider,
 * then the view toggles (grid, health bars). Reads/writes the active tool from
 * the store; the toggles are view preferences owned by the page.
 */
export function LeftToolRail({ showGrid, onToggleGrid, showHealthBars, onToggleHealthBars }: LeftToolRailProps) {
  const tool = useEncounterStore((state) => state.tool);
  const setTool = useEncounterStore((state) => state.setTool);
  const pendingWallStart = useEncounterStore((state) => state.pendingWallStart);

  return (
    <div className={styles.rail} aria-label="Scene tools">
      {CORE_TOOLS.map((entry) => (
        <RailButton
          key={entry.tool}
          icon={entry.icon}
          label={entry.tool === "wall" && pendingWallStart ? "Finish wall" : entry.label}
          active={tool === entry.tool}
          onClick={() => setTool(entry.tool)}
        />
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
  onClick
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={[styles.tool, active ? styles.active : ""].filter(Boolean).join(" ")}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {icon}
    </button>
  );
}
