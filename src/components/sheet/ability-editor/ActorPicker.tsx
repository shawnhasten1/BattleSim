"use client";

import { useMemo, useState } from "react";
import { SRD_MONSTER_INDEX } from "@/data/srd/monsters";
import { useEncounterStore } from "@/store/encounter-store";
import styles from "./ability-editor.module.css";

/** A creature a summon or a shapechange can name: a library monster or an actor in the scene. */
export interface PickableActor {
  id: string;
  name: string;
  detail: string;
}

/** A challenge rating as a statblock prints it: 1/8, 1/4, 1/2, 1, 2… */
const crText = (cr: number) => (cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr));

/** Where a creature comes from, for the row that names it: "SRD · CR 1/2 · beast", "in this scene". */
export function actorDetail(id: string): string {
  const library = SRD_MONSTER_INDEX.find((entry) => entry.id === id);
  if (library) return `SRD · CR ${crText(library.cr)} · ${library.type}`;
  return useEncounterStore.getState().encounter.definitions.some((definition) => definition.id === id) ? "in this scene" : "not in this scene";
}

/**
 * Search for a creature: the scene's actors and every SRD monster (a shapechanger's hidden forms are left out). At least
 * two letters; picked creatures aren't offered again.
 */
export function ActorPicker({ label, excludeId, taken, onPick }: {
  label: string;
  /** The creature itself (it can't change into itself). */
  excludeId?: string;
  /** Already picked. */
  taken: readonly string[];
  onPick: (actor: PickableActor) => void;
}) {
  const scene = useEncounterStore((s) => s.encounter.definitions);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (needle.length < 2) return [];
    const skip = new Set([...taken, ...(excludeId ? [excludeId] : [])]);
    const fromScene = scene
      .filter((actor) => !skip.has(actor.id) && !actor.hidden && actor.name.toLowerCase().includes(needle))
      .map((actor): PickableActor => ({ id: actor.id, name: actor.name, detail: "in this scene" }));
    const fromLibrary = SRD_MONSTER_INDEX
      .filter((entry) => !skip.has(entry.id) && !fromScene.some((actor) => actor.id === entry.id) && entry.name.toLowerCase().includes(needle))
      .map((entry): PickableActor => ({ id: entry.id, name: entry.name, detail: `SRD · CR ${crText(entry.cr)} · ${entry.type}` }));
    return [...fromScene, ...fromLibrary].slice(0, 8);
  }, [needle, scene, taken, excludeId]);

  return (
    <div className={styles.picker}>
      <input type="search" aria-label={label} placeholder={`${label}…`} value={query} onChange={(event) => setQuery(event.target.value)} />
      {results.length ? (
        <div className={styles.pickerResults} role="group" aria-label={`${label}: found`}>
          {results.map((actor) => (
            <button key={actor.id} type="button" onClick={() => { onPick(actor); setQuery(""); }}>
              {actor.name} <small>{actor.detail}</small>
            </button>
          ))}
        </div>
      ) : needle.length >= 2 ? <p className={styles.empty}>No creature called “{query.trim()}”.</p> : null}
    </div>
  );
}
