"use client";

import { Check, ChevronDown, Copy, FolderOpen, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEncounterStore } from "@/store/encounter-store";
import styles from "./SceneDropdown.module.css";

/**
 * Top-bar scene switcher + encounter directory. Replaces the old Encounters
 * sidebar tab: browse projects → scenes, load one, and create / rename /
 * duplicate / delete without leaving the bar.
 */
export function SceneDropdown() {
  const encounterName = useEncounterStore((state) => state.encounter.name);
  const projects = useEncounterStore((state) => state.projects);
  const projectStatus = useEncounterStore((state) => state.projectStatus);
  const currentProjectId = useEncounterStore((state) => state.currentProjectId);
  const currentEncounterId = useEncounterStore((state) => state.currentEncounterId);
  const loadProjects = useEncounterStore((state) => state.loadProjects);
  const saveProject = useEncounterStore((state) => state.saveProject);
  const loadProject = useEncounterStore((state) => state.loadProject);
  const deleteProject = useEncounterStore((state) => state.deleteProject);
  const loadEncounter = useEncounterStore((state) => state.loadEncounter);
  const createEncounter = useEncounterStore((state) => state.createEncounter);
  const renameEncounter = useEncounterStore((state) => state.renameEncounter);
  const duplicateEncounter = useEncounterStore((state) => state.duplicateEncounter);
  const deleteEncounter = useEncounterStore((state) => state.deleteEncounter);

  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((value) => !value)}>
        {encounterName}
        <ChevronDown size={12} />
      </button>

      {open ? (
        <div className={styles.menu}>
          <div className={styles.menuHead}>
            <span>Encounters</span>
            <div>
              <button type="button" title="Save project" onClick={() => void saveProject()}><Save size={13} /></button>
              <button type="button" title="Refresh" onClick={() => void loadProjects()}><FolderOpen size={13} /></button>
            </div>
          </div>

          {newName === null ? (
            <button type="button" className={styles.newBtn} onClick={() => setNewName(`${encounterName} Variant`)}>
              <Plus size={13} /> New scene
            </button>
          ) : (
            <form
              className={styles.inlineForm}
              onSubmit={(event) => {
                event.preventDefault();
                void createEncounter(newName.trim() || "New Encounter");
                setNewName(null);
                setOpen(false);
              }}
            >
              <input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} />
              <button type="submit" title="Create"><Check size={13} /></button>
              <button type="button" title="Cancel" onClick={() => setNewName(null)}><X size={13} /></button>
            </form>
          )}

          <div className={styles.projects}>
            {projects.length === 0 ? <p className={styles.empty}>No saved projects.</p> : null}
            {projects.map((project) => (
              <div key={project.id} className={project.id === currentProjectId ? styles.projectActive : styles.project}>
                <div className={styles.projectHead}>
                  <button type="button" onClick={() => void loadProject(project.id)}>{project.name}</button>
                  <button type="button" title="Delete project" onClick={() => void deleteProject(project.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
                {(project.encounters ?? []).map((sceneRow) =>
                  rename?.id === sceneRow.id ? (
                    <form
                      key={sceneRow.id}
                      className={styles.inlineForm}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void renameEncounter(sceneRow.id, rename.name.trim() || sceneRow.name);
                        setRename(null);
                      }}
                    >
                      <input autoFocus value={rename.name} onChange={(event) => setRename({ id: sceneRow.id, name: event.target.value })} />
                      <button type="submit" title="Save"><Check size={13} /></button>
                      <button type="button" title="Cancel" onClick={() => setRename(null)}><X size={13} /></button>
                    </form>
                  ) : (
                    <div
                      key={sceneRow.id}
                      className={sceneRow.id === currentEncounterId ? styles.sceneActive : styles.scene}
                    >
                      <button
                        type="button"
                        className={styles.sceneMain}
                        onClick={() => {
                          void loadEncounter(sceneRow.id);
                          setOpen(false);
                        }}
                      >
                        {sceneRow.name}
                      </button>
                      <button type="button" title="Rename" onClick={() => setRename({ id: sceneRow.id, name: sceneRow.name })}>
                        <Pencil size={12} />
                      </button>
                      <button type="button" title="Duplicate" onClick={() => void duplicateEncounter(sceneRow.id)}>
                        <Copy size={12} />
                      </button>
                      <button type="button" title="Delete" onClick={() => void deleteEncounter(sceneRow.id)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>

          {projectStatus ? <p className={styles.status}>{projectStatus}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
