"use client";

import { EDITION_CHOICES, EDITION_NAMES, type Edition, type EditionChoice } from "@/lib/editions";
import styles from "./Edition.module.css";

/** "2014" or "2024" beside a library entry (EDITIONS_PLAN.md D2); nothing for an entry without an edition. */
export function EditionBadge({ edition }: { edition: Edition | undefined }) {
  if (!edition) return null;
  return <span className={styles.badge} data-edition={edition} title={EDITION_NAMES[edition]}>{edition}</span>;
}

/** A list's 2014 · 2024 · Both filter: which version shows where there are two. */
export function EditionFilter({ value, onChange, label = "Edition" }: { value: EditionChoice; onChange: (next: EditionChoice) => void; label?: string }) {
  return (
    <div className={styles.filter} role="group" aria-label={label}>
      {EDITION_CHOICES.map((choice) => (
        <button key={choice.value} type="button" aria-pressed={value === choice.value} title={choice.title} onClick={() => onChange(choice.value)}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}
