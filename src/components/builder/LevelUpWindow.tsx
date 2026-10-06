"use client";

import { useMemo, useState } from "react";
import {
  buildCharacter,
  buildLabel,
  entryLabel,
  multiclassProblems,
  orderedChanges,
  readBuild,
  rebuildActor,
  storedChoice,
  withChoice,
  withLevelUp,
  withSuggestions,
  type CharacterBuild
} from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { useEncounterStore } from "@/store/encounter-store";
import { ChoiceControl } from "./ChoiceControl";
import { BESIDE_SHEET, ChangeList } from "./CharacterBuilder";
import { MissingCatalogNotice, useBuilderSources } from "./CatalogGate";
import styles from "./builder.module.css";

/**
 * Level up (plan, Phase 2): what the next level gives, and only the choices it asks for, already filled in with the
 * builder's suggestions. The DM changes any, sees what applying does (and what it keeps of their edits), and applies it
 * as one undo step.
 */
export function LevelUpWindow({ definitionId, onClose }: { definitionId: string; onClose: () => void }) {
  const definition = useEncounterStore((s) => s.encounter.definitions.find((entry) => entry.id === definitionId));
  const { sources, missing, loading } = useBuilderSources(readBuild(definition));
  if (missing.length) return <MissingCatalogNotice title="Level up" missing={missing} loading={loading} onClose={onClose} initialPosition={BESIDE_SHEET} />;
  return <LevelUpBody definitionId={definitionId} onClose={onClose} sources={sources} />;
}

function LevelUpBody({ definitionId, onClose, sources }: { definitionId: string; onClose: () => void; sources: BuildSources }) {
  const definition = useEncounterStore((s) => s.encounter.definitions.find((entry) => entry.id === definitionId));
  const rebuildCharacter = useEncounterStore((s) => s.rebuildCharacter);
  const saved = readBuild(definition);
  const [draft, setDraft] = useState<CharacterBuild | undefined>(() => (saved && saved.levels.length < 20 ? withSuggestions(withLevelUp(saved), sources) : undefined));
  const [update, setUpdate] = useState<string[]>([]);
  const built = useMemo(() => (draft ? buildCharacter(draft, sources) : undefined), [draft, sources]);
  const preview = useMemo(() => (draft && definition ? rebuildActor(definition, draft, sources) : undefined), [draft, definition, sources]);

  if (!definition || !saved || !draft || !built || !preview) {
    return (
      <FloatingWindow title="Level up" onClose={onClose} width={420} storageKey="level-up" initialPosition={BESIDE_SHEET}>
        <p className={styles.dim}>{saved && saved.levels.length >= 20 ? "This character is already 20th level." : "This actor wasn't made with the character builder."}</p>
      </FloatingWindow>
    );
  }

  const newIndex = draft.levels.length - 1;
  // This level's choices, any still open, and earlier ones the level up made again (a spell a new feature now makes
  // always prepared is swapped for another).
  const remade = (slot: (typeof built.choices)[number]) =>
    JSON.stringify(storedChoice(saved, slot.scope, slot.path, slot.spec) ?? null) !== JSON.stringify(storedChoice(draft, slot.scope, slot.path, slot.spec) ?? null);
  const slots = built.choices.filter((slot) => (slot.scope.kind === "level" && slot.scope.index === newIndex) || slot.pending || remade(slot));
  const changes = orderedChanges(preview.changes).filter((change) => !(change.kind === "field" && (change.key === "field:classes" || change.key === "field:level")));
  const classId = draft.levels[newIndex]!.classId;
  const classLevel = draft.levels.filter((entry) => entry.classId === classId).length;
  const className = sources.catalog.classes.find((entry) => entry.id === classId)?.name ?? "";
  const die = sources.catalog.classes.find((entry) => entry.id === classId)?.hitDie ?? 8;
  // Its classes, then the rest of the catalog: a level in a new one is multiclassing (plan D11).
  const owned = [...new Set(saved.levels.map((entry) => entry.classId))];
  const others = sources.catalog.classes.filter((entry) => !owned.includes(entry.id));
  const prerequisites = multiclassProblems(saved, classId, sources);

  function chooseClass(next: string) {
    setDraft(withSuggestions(withLevelUp(saved!, next), sources));
    setUpdate([]);
  }

  return (
    <FloatingWindow title={`Level up · ${definition.name}`} ariaLabel="Level up" onClose={onClose} width={520} storageKey="level-up" initialPosition={BESIDE_SHEET}>
      <div className={styles.builder}>
        <p className={styles.lede}>
          {buildLabel(saved, sources)} → <strong>{className} {classLevel}</strong>
        </p>

        <label className={styles.field}>
          Class to level
          <select aria-label="Class to level" value={classId} onChange={(event) => chooseClass(event.target.value)}>
            {owned.map((id) => {
              const entry = sources.catalog.classes.find((candidate) => candidate.id === id);
              const levels = saved.levels.filter((level) => level.classId === id).length;
              return <option key={id} value={id}>{`${entry ? entryLabel(entry) : id} (${levels} → ${levels + 1})`}</option>;
            })}
            {others.length ? (
              <optgroup label="A new class (multiclass)">
                {others.map((entry) => <option key={entry.id} value={entry.id}>{entryLabel(entry)}</option>)}
              </optgroup>
            ) : null}
          </select>
        </label>
        {prerequisites.length ? (
          <p className={styles.warning} role="note">
            Multiclassing needs 13 in each class&apos;s primary ability: {prerequisites.join("; ")}. You can still take it.
          </p>
        ) : null}

        {draft.hp.method === "rolled" ? (
          <label className={styles.field}>
            Hit die roll (d{die})
            <input
              type="number" min={1} max={die} aria-label="Hit die roll"
              value={draft.hp.rolls?.[newIndex - 1] ?? ""} placeholder={String(die / 2 + 1)}
              onChange={(event) => {
                const rolls = [...(draft.hp.rolls ?? [])];
                rolls[newIndex - 1] = Math.min(die, Math.max(1, Math.round(Number(event.target.value) || die / 2 + 1)));
                setDraft({ ...draft, hp: { ...draft.hp, rolls } });
              }}
            />
          </label>
        ) : null}

        <section className={styles.section} aria-label="Choices">
          <h4>{slots.length ? "Choices at this level" : "No choices at this level"}</h4>
          {slots.some((slot) => !(slot.scope.kind === "level" && slot.scope.index === newIndex) && !slot.pending)
            ? <p className={styles.dim}>An earlier choice is made again: what it had is now given another way.</p>
            : null}
          {slots.map((slot) => (
            <ChoiceControl
              key={`${JSON.stringify(slot.scope)}|${slot.path.join("/")}`}
              slot={slot}
              onChange={(value) => setDraft(withChoice(draft, slot.scope, slot.path, value, slot.spec))}
            />
          ))}
        </section>

        <section className={styles.section} aria-label="What changes">
          <h4>What changes</h4>
          <ChangeList changes={changes} update={update} onUpdate={setUpdate} />
        </section>

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>Cancel</button>
          <button
            type="button" className={styles.primary}
            onClick={() => {
              rebuildCharacter(definitionId, draft, update);
              onClose();
            }}
          >
            Level up to {draft.levels.length}
          </button>
        </div>
      </div>
    </FloatingWindow>
  );
}
