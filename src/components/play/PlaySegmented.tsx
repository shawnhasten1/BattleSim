"use client";

import styles from "./play.module.css";

export interface PlaySegment<T> {
  value: T;
  label: string;
  title?: string;
}

/** A small one-of-several choice (You / AI, a playback speed), as a radio group. */
export function PlaySegmented<T extends string | number>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: Array<PlaySegment<T>>;
  onChange: (next: T) => void;
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** How one of a person's creatures' reactions is handled for the rest of the fight (D3). */
export const POLICY_OPTIONS: Array<PlaySegment<"ask" | "use" | "never">> = [
  { value: "ask", label: "Ask", title: "Ask each time it could be taken" },
  { value: "use", label: "Always", title: "Take it every time it's offered, without asking" },
  { value: "never", label: "Never", title: "Never take it" }
];

export const SPEED_OPTIONS: Array<PlaySegment<0 | 1 | 2 | 4>> = [
  { value: 0, label: "Instant", title: "The AI's turns happen at once" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
  { value: 4, label: "4×" }
];
