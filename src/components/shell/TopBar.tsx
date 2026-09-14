"use client";

import { LayoutGrid, LogOut, Redo2, RotateCcw, ScrollText, Save, Settings, Swords, Undo2 } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { useEncounterStore } from "@/store/encounter-store";
import { SceneDropdown } from "./SceneDropdown";
import styles from "./TopBar.module.css";

interface TopBarProps {
  /** Opens the Encounter Builder flow (Create Token modal + Actors tab). */
  onOpenBuilder: () => void;
  /** Opens the scene configuration modal. */
  onOpenSceneConfig: () => void;
  /** Opens the post-combat battle report window. */
  onOpenReport: () => void;
}

/**
 * Shell top bar: scene switcher/directory, Encounter Builder, and the
 * history / save / settings controls. Turn and simulation controls live in the
 * Combat panel.
 */
export function TopBar({ onOpenBuilder, onOpenSceneConfig, onOpenReport }: TopBarProps) {
  const undo = useEncounterStore((state) => state.undo);
  const redo = useEncounterStore((state) => state.redo);
  const saveProject = useEncounterStore((state) => state.saveProject);
  const reset = useEncounterStore((state) => state.reset);
  const hasOutcome = useEncounterStore((state) => state.outcome != null);
  const currentProjectId = useEncounterStore((state) => state.currentProjectId);
  const { data: session } = useSession();

  return (
    <div className={styles.bar}>
      <SceneDropdown />

      <button type="button" className={styles.builder} onClick={onOpenBuilder}>
        <Swords size={15} /> Encounter Builder
      </button>

      <div className={styles.spacer} />

      <div className={styles.group}>
        <a href={currentProjectId ? `/campaigns/${currentProjectId}` : "/campaigns"} title="Back to campaigns">
          <LayoutGrid size={16} />
        </a>
        <button type="button" onClick={undo} title="Undo">
          <Undo2 size={16} />
        </button>
        <button type="button" onClick={redo} title="Redo">
          <Redo2 size={16} />
        </button>
        <button type="button" onClick={() => void saveProject()} title="Save">
          <Save size={16} />
        </button>
        <button type="button" onClick={reset} title="Reset encounter">
          <RotateCcw size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenReport}
          disabled={!hasOutcome}
          title={hasOutcome ? "Battle report" : "Battle report (finish a fight first)"}
        >
          <ScrollText size={16} />
        </button>
        <button type="button" onClick={onOpenSceneConfig} title="Scene settings">
          <Settings size={16} />
        </button>
        <button
          type="button"
          onClick={() => void signOut({ redirectTo: "/login" })}
          title={session?.user?.email ? `Sign out (${session.user.email})` : "Sign out"}
        >
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
}
