"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { blankFeature, grantKeyFor, grantKeysOf, type ChoiceSpec, type ClassLevel, type FeatureGrant } from "@/lib/character-builder";
import { blankChoice, ChoiceEditor, CHOICE_KINDS } from "./ChoiceEditor";
import { useHomebrew } from "./controls";
import { GrantEditor } from "./GrantEditor";
import styles from "./homebrew.module.css";

/** A choice's name in a level's summary. */
function choiceName(choice: ChoiceSpec): string {
  if ("label" in choice && choice.label) return choice.label;
  return CHOICE_KINDS.find((entry) => entry.kind === choice.kind)?.label ?? choice.kind;
}

/**
 * Levels 1 to 20 of a class, subclass or species: each level's features (grants) and choices, closed to a one-line
 * summary until opened. What the builder adds at a level by itself (a feat at a feat level, the Epic Boon at 19, the
 * table's numbers) is shown beside the summary, not edited here.
 */
export function LevelsEditor({ levels, onChange, implicit, ownList, noun = "Level" }: {
  levels: ClassLevel[];
  onChange: (next: ClassLevel[]) => void;
  implicit?: (level: number) => string[];
  ownList?: string;
  /** "Level", or "Character level" for a species. */
  noun?: string;
}) {
  const { library, editFeature } = useHomebrew();
  const [open, setOpen] = useState<number | null>(null);
  const keys = grantKeysOf(levels);

  function setLevel(level: number, next: ClassLevel) {
    const rest = levels.filter((entry) => entry.level !== level);
    const kept = next.grants.length || next.choices?.length ? [...rest, next] : rest;
    onChange(kept.sort((a, b) => a.level - b.level));
  }

  function addFeature(level: number, entry: ClassLevel) {
    editFeature(blankFeature("New feature", "new-feature"), level, true, (feature, pools) => {
      const key = grantKeyFor(feature.name, keys);
      const [poolId, size] = Object.entries(pools)[0] ?? [];
      const grant: FeatureGrant = { key, feature, ...(poolId ? { pool: { id: poolId, size: size! } } : {}) };
      setLevel(level, { ...entry, grants: [...entry.grants, grant] });
    });
  }

  return (
    <div className={styles.options} role="list" aria-label="Levels">
      {Array.from({ length: 20 }, (_, index) => index + 1).map((level) => {
        const entry: ClassLevel = levels.find((candidate) => candidate.level === level) ?? { level, grants: [] };
        const names = [
          ...entry.grants.map((grant) => (typeof grant.feature === "string" ? library.feature(grant.feature)?.name ?? grant.feature : grant.feature?.name ?? grant.key)),
          ...(entry.choices ?? []).map(choiceName),
          ...(implicit?.(level) ?? [])
        ];
        const isOpen = open === level;
        return (
          <div key={level} className={styles.levelRow} role="listitem">
            <button type="button" className={styles.levelHead} onClick={() => setOpen(isOpen ? null : level)} aria-expanded={isOpen} aria-label={`${noun} ${level}`}>
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <strong>{noun} {level}</strong>
              <span>{names.length ? names.join(", ") : "—"}</span>
            </button>
            {isOpen ? (
              <div className={styles.levelBody}>
                {entry.grants.map((grant, grantIndex) => (
                  <GrantEditor
                    key={`${grant.key}-${grantIndex}`} grant={grant} level={level} earlierKeys={keys}
                    onChange={(next) => setLevel(level, { ...entry, grants: entry.grants.map((g, i) => (i === grantIndex ? next : g)) })}
                    onRemove={() => setLevel(level, { ...entry, grants: entry.grants.filter((_, i) => i !== grantIndex) })}
                  />
                ))}
                {(entry.choices ?? []).map((choice, choiceIndex) => (
                  <ChoiceEditor
                    key={`${choice.id}-${choiceIndex}`} choice={choice} level={level} earlierKeys={keys} ownList={ownList}
                    onChange={(next) => setLevel(level, { ...entry, choices: (entry.choices ?? []).map((c, i) => (i === choiceIndex ? next : c)) })}
                    onRemove={() => {
                      const choices = (entry.choices ?? []).filter((_, i) => i !== choiceIndex);
                      const { choices: _old, ...rest } = entry;
                      setLevel(level, choices.length ? { ...rest, choices } : rest);
                    }}
                  />
                ))}
                <div className={styles.row}>
                  <button type="button" className={styles.btn} onClick={() => addFeature(level, entry)}>+ Feature</button>
                  <label className={styles.field}>
                    Add a choice
                    <select
                      value="" aria-label={`Add a choice at ${noun.toLowerCase()} ${level}`}
                      onChange={(event) => {
                        if (!event.target.value) return;
                        const taken = (entry.choices ?? []).map((choice) => choice.id);
                        const choice = blankChoice(event.target.value as ChoiceSpec["kind"], taken);
                        setLevel(level, { ...entry, choices: [...(entry.choices ?? []), choice] });
                      }}
                    >
                      <option value="">Choose a kind…</option>
                      {CHOICE_KINDS.map((kind) => <option key={kind.kind} value={kind.kind}>{kind.label}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
