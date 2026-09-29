"use client";

import { useMemo, useState } from "react";
import type { CreatureDefinition, SummonActionDefinition, SummonOption, TransformActionDefinition, TransformForm } from "@/engine";
import { SRD_MONSTER_INDEX } from "@/data/srd/monsters";
import styles from "./builders.module.css";

/** A creature the caller can pick: a library monster or an actor already in the scene. */
export interface PickableActor {
  id: string;
  name: string;
  detail: string;
}

/**
 * Search + pick one creature — the same picker for a summon's options and a transform's forms. Lists every SRD
 * monster (except hidden shapechanger forms) and the scene's own actors; the caller gets an id back.
 */
export function ActorPicker({
  sceneActors, excludeId, onPick, label = "Add a creature"
}: { sceneActors: CreatureDefinition[]; excludeId?: string; onPick: (actor: PickableActor) => void; label?: string }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const scene = sceneActors
      .filter((actor) => actor.id !== excludeId && !actor.hidden && actor.name.toLowerCase().includes(needle))
      .map((actor): PickableActor => ({ id: actor.id, name: actor.name, detail: "in this scene" }));
    const library = SRD_MONSTER_INDEX
      .filter((entry) => entry.id !== excludeId && entry.name.toLowerCase().includes(needle))
      .map((entry): PickableActor => ({ id: entry.id, name: entry.name, detail: `SRD · CR ${entry.cr} · ${entry.type}` }));
    return [...scene, ...library].slice(0, 8);
  }, [query, sceneActors, excludeId]);

  return (
    <div>
      <input
        className={styles.pickerSearch} type="search" aria-label={label} placeholder={`${label}…`} value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className={styles.chips}>
        {results.map((actor) => (
          <button key={actor.id} type="button" title={actor.detail} onClick={() => { onPick(actor); setQuery(""); }}>
            {actor.name} <small>{actor.detail}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

const idOf = (actor: PickableActor) => actor.id.replace(/^srd:monster:/, "");

export function SummonEditor({
  ownerId, sceneActors, initial, onSave, onCancel
}: { ownerId: string; sceneActors: CreatureDefinition[]; initial?: SummonActionDefinition; onSave: (action: SummonActionDefinition) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "Summon");
  const [options, setOptions] = useState<SummonOption[]>(initial?.options ?? []);
  const [chance, setChance] = useState<number | "">(initial?.chance ?? "");
  const [choice, setChoice] = useState<"pick" | "random">(initial?.choice ?? "pick");
  const [duration, setDuration] = useState<number | "">(initial ? (initial.durationRounds ?? "") : 10);
  const [concentration, setConcentration] = useState(initial?.concentration ?? false);
  const [usesOnce, setUsesOnce] = useState(Boolean(initial?.resourceCost));
  const [actionType, setActionType] = useState<"action" | "bonus">(initial?.actionType === "bonus" ? "bonus" : "action");

  const countText = (option: SummonOption) => (typeof option.count === "number" ? String(option.count) : option.count.dice);
  // What's typed in each count box, so clearing it to type "2d6" doesn't snap back to "1" mid-edit.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const setCount = (index: number, text: string) => {
    setDrafts((current) => ({ ...current, [options[index]!.id]: text }));
    setOptions((rows) => rows.map((row, i) => {
    if (i !== index) return row;
    const trimmed = text.trim();
    return { ...row, count: /d/i.test(trimmed) ? { dice: trimmed.toLowerCase() } : Math.max(1, Number(trimmed) || 1) };
    }));
  };

  function save() {
    if (options.length === 0) return;
    const id = initial?.id ?? "summon";
    onSave({
      kind: "summon", id, name: name.trim() || "Summon", actionType, range: 60, options,
      choice, chance: chance === "" ? undefined : Math.min(100, Math.max(1, chance)),
      durationRounds: duration === "" ? undefined : Math.max(1, duration),
      concentration: concentration || undefined, maxGeneration: 1,
      ...(usesOnce ? { resourceCost: initial?.resourceCost ?? { resourceId: `usage:${id}`, amount: 1 }, usage: { kind: "uses" as const, uses: 1 } } : {}),
      automationSupport: "full"
    });
  }

  return (
    <div className={styles.riderCard} aria-label="Summon editor">
      <div className={styles.riderRow}>
        <label className={styles.fieldInlineLabel}>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className={styles.fieldInlineLabel}>
          Costs
          <select value={actionType} onChange={(e) => setActionType(e.target.value as "action" | "bonus")}>
            <option value="action">an action</option>
            <option value="bonus">a bonus action</option>
          </select>
        </label>
      </div>
      <ActorPicker
        sceneActors={sceneActors} excludeId={undefined} label="Add a creature to summon"
        onPick={(actor) => setOptions((rows) => (rows.some((row) => row.definitionId === actor.id) ? rows : [...rows, { id: idOf(actor), definitionId: actor.id, label: actor.name, count: 1 }]))}
      />
      {options.map((option, index) => (
        <div key={option.id} className={styles.riderRow}>
          <strong>{option.label}</strong>
          <label className={styles.fieldInlineLabel}>
            How many
            <input aria-label={`Count for ${option.label}`} value={drafts[option.id] ?? countText(option)} placeholder="1 or 2d4" onChange={(e) => setCount(index, e.target.value)} />
          </label>
          <button type="button" className={styles.riderRemove} style={{ flex: "0 0 auto", minWidth: 0 }} aria-label={`Remove ${option.label}`} onClick={() => setOptions((rows) => rows.filter((_, i) => i !== index))}>×</button>
        </div>
      ))}
      {options.length > 1 ? (
        <label className={styles.fieldInlineLabel}>
          Which one
          <select aria-label="Which one" value={choice} onChange={(e) => setChoice(e.target.value as "pick" | "random")}>
            <option value="pick">the summoner chooses the best</option>
            <option value="random">chosen at random</option>
          </select>
        </label>
      ) : null}
      <div className={styles.riderRow}>
        <label className={styles.fieldInlineLabel}>
          % chance it works
          <input type="number" min={1} max={100} placeholder="always" aria-label="Chance" value={chance} onChange={(e) => setChance(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <label className={styles.fieldInlineLabel}>
          Rounds they stay
          <input type="number" min={1} placeholder="whole fight" aria-label="Duration" value={duration} onChange={(e) => setDuration(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={concentration} onChange={(e) => setConcentration(e.target.checked)} /> concentration
        </label>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={usesOnce} onChange={(e) => setUsesOnce(e.target.checked)} /> once per encounter
        </label>
      </div>
      <div className={styles.riderRow}>
        <button type="button" className={styles.spawnBtnPrimary} onClick={save} disabled={options.length === 0}>{initial ? "Save changes" : "Add summon"}</button>
        <button type="button" className={styles.spawnBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function TransformEditor({
  ownerId, sceneActors, initial, onSave, onCancel
}: { ownerId: string; sceneActors: CreatureDefinition[]; initial?: TransformActionDefinition; onSave: (action: TransformActionDefinition) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "Shapechanger");
  const [forms, setForms] = useState<TransformForm[]>(initial?.forms ?? []);
  const [revertOnDeath, setRevertOnDeath] = useState(initial?.revertOnDeath ?? true);

  function save() {
    if (forms.length === 0) return;
    onSave({ kind: "transform", id: initial?.id ?? "shapechange", name: name.trim() || "Shapechanger", actionType: "action", forms, canRevert: true, revertOnDeath, automationSupport: "full" });
  }

  return (
    <div className={styles.riderCard} aria-label="Shapechange editor">
      <label className={styles.fieldInlineLabel}>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <ActorPicker
        sceneActors={sceneActors} excludeId={ownerId} label="Add a form to change into"
        onPick={(actor) => setForms((rows) => (rows.some((row) => row.definitionId === actor.id) ? rows : [...rows, { id: idOf(actor), label: actor.name, definitionId: actor.id }]))}
      />
      {forms.map((form, index) => (
        <div key={form.id} className={styles.riderRow}>
          <label className={styles.fieldInlineLabel}>
            Form
            <input aria-label={`Label for ${form.label}`} value={form.label} onChange={(e) => setForms((rows) => rows.map((row, i) => (i === index ? { ...row, label: e.target.value } : row)))} />
          </label>
          <button type="button" className={styles.riderRemove} style={{ flex: "0 0 auto", minWidth: 0 }} aria-label={`Remove ${form.label}`} onClick={() => setForms((rows) => rows.filter((_, i) => i !== index))}>×</button>
        </div>
      ))}
      <label className={styles.checkLabel}>
        <input type="checkbox" checked={revertOnDeath} onChange={(e) => setRevertOnDeath(e.target.checked)} /> returns to its true form when it dies
      </label>
      <div className={styles.riderRow}>
        <button type="button" className={styles.spawnBtnPrimary} onClick={save} disabled={forms.length === 0}>{initial ? "Save changes" : "Add shapechange"}</button>
        <button type="button" className={styles.spawnBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
